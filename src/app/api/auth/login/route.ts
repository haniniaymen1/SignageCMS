import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'
import { db } from '@/lib/db'
import { checkCredentials, createSessionToken, findUserByUsernameLoose, hashPassword, SESSION_COOKIE, SESSION_MAX_AGE } from '@/lib/auth'
import { ldapAuthenticate, ldapBindByDn, loadLdapConfig, upsertLdapUser } from '@/lib/ldap'

export const dynamic = 'force-dynamic'

// ---------- Limiteur de tentatives (v3.11) ----------
// En mémoire : N tentatives échouées par couple identifiant+IP sur une fenêtre
// glissante. Suffisant en mono-instance (déploiement standard du CMS) ; un
// déploiement multi-instance utilisera un limiteur partagé (Redis) si nécessaire.
const MAX_ATTEMPTS = 10
const WINDOW_MS = 15 * 60 * 1000
const MAX_PER_IP = 40 // garde globale anti-énumération massive
const attempts = new Map<string, { count: number; first: number }>()

function attemptKey(username: string, ip: string): string {
  return `${username.toLowerCase().slice(0, 64)}|${ip}`
}

function registerFailure(username: string, ip: string): number {
  const now = Date.now()
  for (const key of [attemptKey(username, ip), `__ip__|${ip}`]) {
    const rec = attempts.get(key)
    if (!rec || now - rec.first > WINDOW_MS) {
      attempts.set(key, { count: 1, first: now })
    } else {
      rec.count++
    }
  }
  if (attempts.size > 10000) attempts.clear()
  const rec = attempts.get(attemptKey(username, ip))
  return rec?.count ?? 1
}

function isBlocked(username: string, ip: string): boolean {
  const now = Date.now()
  const rec = attempts.get(attemptKey(username, ip))
  if (rec && now - rec.first <= WINDOW_MS && rec.count >= MAX_ATTEMPTS) return true
  const ipRec = attempts.get(`__ip__|${ip}`)
  if (ipRec && now - ipRec.first <= WINDOW_MS && ipRec.count >= MAX_PER_IP) return true
  return false
}

function clearFailures(username: string, ip: string): void {
  attempts.delete(attemptKey(username, ip))
}

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip') || 'local'
}

// ---------- Mot de passe admin initial (v3.11) ----------
// Fini « admin123 » connu par défaut : à la (re)création du compte admin sans
// ADMIN_DEFAULT_PASSWORD, un mot de passe ALEATOIRE est généré, affiché une fois
// dans la console du serveur et déposé dans db/admin-credentials.txt. L'administrateur
// le change ensuite depuis l'interface (Utilisateurs) puis supprime ce fichier.
function generateStrongPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const bytes = randomBytes(14)
  let out = ''
  for (let i = 0; i < 14; i++) out += alphabet[bytes[i] % alphabet.length]
  return `${out.slice(0, 4)}-${out.slice(4, 9)}-${out.slice(9)}`
}

async function writeAdminCredentials(username: string, password: string): Promise<void> {
  const line = [
    '=== Identifiants administrateur SignageCMS ===',
    `Créés le ${new Date().toLocaleString('fr-FR')}`,
    `Utilisateur : ${username}`,
    `Mot de passe : ${password}`,
    '',
    'CHANGEZ ce mot de passe depuis le CMS (Utilisateurs), puis SUPPRIMEZ ce fichier.',
    '',
  ].join('\n')
  try {
    await fs.mkdir(path.join(process.cwd(), 'db'), { recursive: true })
    await fs.writeFile(path.join(process.cwd(), 'db', 'admin-credentials.txt'), line, { mode: 0o600 })
  } catch {
    /* si l'écriture échoue, le mot de passe reste visible dans la console du serveur */
  }
}

interface LoginUser {
  id: string
  username: string
  name: string
  email: string
  role: string
  status: string
}

async function issueSession(user: LoginUser) {
  await db.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } })
  const token = await createSessionToken(user.id, user.role)
  const res = NextResponse.json({
    user: { id: user.id, username: user.username, name: user.name, email: user.email, role: user.role },
    // Jeton de secours : si les cookies sont bloqués (iframe de prévisualisation,
    // cookies tiers), le client le stocke et l'envoie en Authorization: Bearer.
    token,
  })
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  })
  return res
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const username = String(body?.username ?? '').trim()
    const password = String(body?.password ?? '')
    if (!username || !password) {
      return NextResponse.json({ error: 'Identifiant et mot de passe requis' }, { status: 400 })
    }

    const ip = clientIp(req)
    if (isBlocked(username, ip)) {
      return NextResponse.json(
        { error: `Trop de tentatives échouées. Réessayez dans ${Math.ceil(WINDOW_MS / 60000)} minutes.` },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(WINDOW_MS / 1000)) } }
      )
    }

    // Auto-réparation anti-verrouillage : si aucun compte admin actif n'existe
    // (base fraîche non initialisée, compte désactivé par erreur…), recrée le compte par défaut.
    try {
      const activeAdmins = await db.user.count({ where: { role: 'admin', status: 'active' } })
      if (activeAdmins === 0) {
        // v3.11 : plus de mot de passe par défaut connu. Surcharge possible via
        // ADMIN_DEFAULT_PASSWORD (installations scriptées), sinon ALEATOIRE.
        const generated = !process.env.ADMIN_DEFAULT_PASSWORD
        const defaultAdminPassword = process.env.ADMIN_DEFAULT_PASSWORD || generateStrongPassword()
        await db.user.upsert({
          where: { username: 'admin' },
          update: { password: hashPassword(defaultAdminPassword), status: 'active', role: 'admin' },
          create: {
            username: 'admin',
            email: 'admin@signage.local',
            name: 'Admin',
            password: hashPassword(defaultAdminPassword),
            role: 'admin',
            status: 'active',
          },
        })
        if (generated) {
          await writeAdminCredentials('admin', defaultAdminPassword)
          console.warn(
            '\n' +
              '============================================================\n' +
              '  SignageCMS — compte administrateur (re)créé automatiquement\n' +
              `  Utilisateur  : admin\n` +
              `  Mot de passe : ${defaultAdminPassword}\n` +
              '  (également disponible dans db/admin-credentials.txt)\n' +
              '  Changez-le après connexion puis supprimez ce fichier !\n' +
              '============================================================\n'
          )
        }
      }
    } catch (e) {
      console.error('Auto-réparation admin échouée:', e)
    }

    const user = await findUserByUsernameLoose(username)
    if (user && user.status !== 'active') {
      return NextResponse.json({ error: 'Ce compte est désactivé' }, { status: 403 })
    }

    // 1) Authentification locale (prioritaire — un mot de passe local défini reste valable)
    if (user?.password) {
      const ok = await checkCredentials(username, password)
      if (ok) {
        clearFailures(username, ip)
        return issueSession(ok)
      }
      registerFailure(username, ip)
    }

    // 2) Repli LDAP (si activé) :
    //    a. compte déjà importé → liaison directe sur son DN stocké (quelle que soit son OU) ;
    //    b. compte inconnu → recherche dans l'OU configurée puis création automatique.
    const ldapCfg = await loadLdapConfig().catch(() => null)
    if (ldapCfg?.enabled) {
      try {
        if (user?.ldapDn) {
          const bound = await ldapBindByDn(ldapCfg, user.ldapDn, password.trim())
          if (bound) {
            clearFailures(username, ip)
            return issueSession(user)
          }
        } else {
          const entry = await ldapAuthenticate(ldapCfg, username, password.trim())
          if (entry) {
            const { user: ldapUser } = await upsertLdapUser(entry, {
              role: ldapCfg.defaultRole || 'user',
              groupId: ldapCfg.groupId ?? null,
            })
            if (ldapUser.status !== 'active') {
              return NextResponse.json({ error: 'Ce compte est désactivé' }, { status: 403 })
            }
            clearFailures(username, ip)
            return issueSession(ldapUser)
          }
        }
      } catch (e) {
        // Serveur LDAP injoignable → on retombe sur le refus local, sans bloquer la connexion
        console.error('LDAP indisponible lors de la connexion:', e instanceof Error ? e.message : e)
      }
    }

    registerFailure(username, ip)
    if (user && !user.password) {
      return NextResponse.json(
        { error: 'Aucun mot de passe défini pour ce compte — demandez à un administrateur' },
        { status: 401 }
      )
    }
    return NextResponse.json({ error: 'Identifiant ou mot de passe incorrect' }, { status: 401 })
  } catch (e) {
    console.error('POST /api/auth/login error:', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
