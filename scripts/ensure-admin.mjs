#!/usr/bin/env node
// ============================================================
//  SignageCMS (v3.11.23) - Creation du compte admin a l'installation
//  ------------------------------------------------------------
//  Appelé par deploy/linux/install.sh, deploy/linux/start.sh,
//  deploy/windows/install.bat et deploy/windows/start-cms.bat.
//
//  Effet : si aucun compte admin actif n'existe, crée le compte
//  "admin" avec un mot de passe ALEATOIRE (même règle que la route
//  de connexion /api/auth/login) et écrit db/admin-credentials.txt
//  à côté de la base (dérivé de DATABASE_URL). Le mot de passe est
//  aussi affiché ici, donc visible dans la console d'installation
//  ou dans le journal de démarrage.
//
//  Si un compte admin actif existe déjà : RIEN n'est modifié et un
//  admin-credentials.txt existant n'est jamais écrasé.
//  Surcharge : ADMIN_DEFAULT_PASSWORD (environnement ou .env) impose
//  le mot de passe ; dans ce cas le fichier n'est pas écrit.
//  En cas d'échec (base absente, client Prisma non généré...), le
//  script sort en erreur sans rien casser : la route de connexion
//  garde son auto-réparation (création au 1er essai de connexion).
//
//  Usage : node scripts/ensure-admin.mjs [--env /chemin/.env]
// ============================================================
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { randomBytes, scryptSync } from 'crypto'
import path from 'path'
import { fileURLToPath } from 'url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(SCRIPT_DIR, '..')

// ---- option --env (tests / environnement non standard) ----
// Quand --env est fourni, le FICHIER a priorité sur l'environnement
// hérité du shell (robustesse : un DATABASE_URL exporté par session ne
// doit pas détourner le script vers une autre base).
let envPath = null
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--env' && argv[i + 1]) {
    envPath = path.resolve(argv[i + 1])
    i++
  }
}
if (!envPath) envPath = path.join(ROOT, '.env')

function readEnvFile(file) {
  const out = {}
  try {
    for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq <= 0) continue
      const key = line.slice(0, eq).trim()
      let val = line.slice(eq + 1).trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      out[key] = val
    }
  } catch {
    /* .env absent : les variables d'environnement peuvent suffire */
  }
  return out
}

const envFile = readEnvFile(envPath)
// --env explicite : le fichier gagne sur l'environnement hérité ;
// sinon : environnement puis .env du projet (comportement standard).
const dbUrl = envPath !== path.join(ROOT, '.env')
  ? (envFile.DATABASE_URL || process.env.DATABASE_URL || '')
  : (process.env.DATABASE_URL || envFile.DATABASE_URL || '')
const adminDefaultPassword = envPath !== path.join(ROOT, '.env')
  ? (envFile.ADMIN_DEFAULT_PASSWORD || process.env.ADMIN_DEFAULT_PASSWORD || '')
  : (process.env.ADMIN_DEFAULT_PASSWORD || envFile.ADMIN_DEFAULT_PASSWORD || '')

if (!dbUrl || !dbUrl.startsWith('file:')) {
  console.error('[ensure-admin] DATABASE_URL absente ou invalide (fichier ' + envPath + ').')
  console.error('[ensure-admin] Installez d abord (install.sh / install.bat) ou creez le .env.')
  process.exit(1)
}

// Chemin de la base : absolu dans toutes les installations standard
// (install.sh, install.bat, start.sh écrivent un chemin absolu).
const raw = dbUrl.slice('file:'.length)
const dbPath = path.isAbsolute(raw) ? raw : path.resolve(ROOT, raw)
const dbDir = path.dirname(dbPath)
const credsPath = path.join(dbDir, 'admin-credentials.txt')

// DATABASE_URL absolue explicite pour le client Prisma (indépendante du cwd).
process.env.DATABASE_URL = 'file:' + dbPath.replace(/\\/g, '/')

function generateStrongPassword() {
  // Identique à src/app/api/auth/login/route.ts (alphabet sans caractères ambigus)
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const bytes = randomBytes(14)
  let out = ''
  for (let i = 0; i < 14; i++) out += alphabet[bytes[i] % alphabet.length]
  return `${out.slice(0, 4)}-${out.slice(4, 9)}-${out.slice(9)}`
}

function hashPassword(password) {
  // Identique à src/lib/password.ts (scrypt intégré Node — aucune dépendance)
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `scrypt:${salt}:${hash}`
}

async function main() {
  let PrismaClient
  try {
    const mod = await import('@prisma/client')
    PrismaClient = mod.default?.PrismaClient ?? mod.PrismaClient
  } catch {
    console.error('[ensure-admin] Client Prisma introuvable (node_modules/.prisma).')
    console.error('[ensure-admin] Lancez d abord : npm install && npx prisma generate')
    process.exit(1)
  }

  mkdirSync(dbDir, { recursive: true })
  const db = new PrismaClient()

  try {
    const activeAdmins = await db.user.count({ where: { role: 'admin', status: 'active' } })
    if (activeAdmins > 0) {
      console.log('[ensure-admin] Un compte admin actif existe deja - rien a modifier.')
      if (!existsSync(credsPath)) {
        console.log('[ensure-admin] Remarque : admin-credentials.txt est absent (supprime ou jamais ecrit).')
        console.log('[ensure-admin] Mot de passe perdu ? Reinitialisez le compte en une commande :')
        console.log('[ensure-admin]   Linux   : sudo bash deploy/linux/reset-admin.sh')
        console.log('[ensure-admin]   Windows : deploy\\windows\\reset-admin.bat')
        console.log('[ensure-admin] (un nouveau mot de passe y est affiche immediatement)')
      } else {
        console.log('[ensure-admin] (admin-credentials.txt non modifie)')
      }
      return
    }

    const generated = !adminDefaultPassword
    const password = adminDefaultPassword || generateStrongPassword()
    const hashed = hashPassword(password)
    await db.user.upsert({
      where: { username: 'admin' },
      update: { password: hashed, status: 'active', role: 'admin' },
      create: {
        username: 'admin',
        email: 'admin@signage.local',
        name: 'Admin',
        password: hashed,
        role: 'admin',
        status: 'active',
      },
    })

    if (generated) {
      const line = [
        '=== Identifiants administrateur SignageCMS ===',
        `Créés le ${new Date().toLocaleString('fr-FR')}`,
        'Utilisateur : admin',
        `Mot de passe : ${password}`,
        '',
        'CHANGEZ ce mot de passe depuis le CMS (Utilisateurs), puis SUPPRIMEZ ce fichier.',
        '',
      ].join('\n')
      writeFileSync(credsPath, line, { mode: 0o600 })
      console.log('')
      console.log('============================================================')
      console.log('  Compte administrateur SignageCMS cree')
      console.log('  Utilisateur  : admin')
      console.log(`  Mot de passe : ${password}`)
      console.log(`  Fichier      : ${credsPath}`)
      console.log('  Changez-le apres connexion puis supprimez ce fichier !')
      console.log('============================================================')
      console.log('')
    } else {
      console.log('[ensure-admin] Compte admin (re)cree avec ADMIN_DEFAULT_PASSWORD (fichier non ecrit).')
    }
  } finally {
    await db.$disconnect().catch(() => {})
  }
}

main().catch((e) => {
  console.error('[ensure-admin] Echec : ' + (e && e.message ? e.message : e))
  console.error('[ensure-admin] Le compte admin sera cree au premier essai de connexion.')
  process.exit(1)
})
