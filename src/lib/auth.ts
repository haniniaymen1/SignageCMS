import { randomBytes } from 'crypto'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { db } from './db'
import { SESSION_COOKIE, SESSION_MAX_AGE, SESSION_TTL_MS, signSession, verifySession } from './session'
import { verifyPassword } from './password'

export { hashPassword, verifyPassword } from './password'
export { SESSION_COOKIE, SESSION_MAX_AGE } from './session'

// ---------- Secret de signature (persisté en base, table Setting) ----------
export async function getAuthSecret(): Promise<string> {
  const key = 'authSecret'
  const existing = await db.setting.findUnique({ where: { key } })
  if (existing?.value) return existing.value
  const value = randomBytes(32).toString('hex')
  await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } })
  return value
}

// ---------- Utilisateur courant ----------
export interface SessionUser {
  id: string
  username: string
  name: string
  email: string
  role: string
  status: string
  hasPassword: boolean
}

interface DbUser {
  id: string
  username: string
  name: string
  email: string
  role: string
  status: string
  password: string
  ldapDn?: string | null
}

function toSessionUser(u: DbUser | null): SessionUser | null {
  if (!u) return null
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    email: u.email,
    role: u.role,
    status: u.status,
    hasPassword: !!u.password,
  }
}

async function userFromToken(token?: string | null): Promise<SessionUser | null> {
  if (!token) return null
  try {
    const secret = await getAuthSecret()
    const payload = await verifySession(token, secret)
    if (!payload) return null
    const user = (await db.user.findUnique({ where: { id: payload.uid } })) as DbUser & { tokenValidAfter?: Date | null } | null
    if (!user || user.status !== 'active') return null
    // Révocation serveur : jeton émis avant la dernière déconnexion / changement de mot de passe
    if (user.tokenValidAfter && (payload.iat ?? 0) < user.tokenValidAfter.getTime()) return null
    return toSessionUser(user)
  } catch {
    return null
  }
}

/** Pour les routes API (NextRequest) — cookie de session OU en-tête Authorization: Bearer */
export async function getSessionUser(req: NextRequest): Promise<SessionUser | null> {
  const h = req.headers.get('authorization') ?? ''
  const bearer = h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : null
  return userFromToken(req.cookies.get(SESSION_COOKIE)?.value ?? bearer)
}

/** Pour les composants serveur (next/headers) */
export async function getSessionUserFromCookies(): Promise<SessionUser | null> {
  const store = await cookies()
  return userFromToken(store.get(SESSION_COOKIE)?.value)
}

/** Génère le jeton de session signé pour un utilisateur */
export async function createSessionToken(userId: string, role: string): Promise<string> {
  const secret = await getAuthSecret()
  const now = Date.now()
  return signSession({ uid: userId, role, iat: now, exp: now + SESSION_TTL_MS }, secret)
}

// ---------- Autorisations ----------
const ADMIN_ONLY_WRITES = ['users', 'user-groups', 'settings']

/**
 * Droit d'écriture sur une ressource :
 * - admin : tout
 * - utilisateur standard : tout sauf gestion des comptes et paramètres
 * - lecture seule : rien
 */
export function canWriteResource(user: SessionUser, resource: string): boolean {
  if (user.role === 'admin') return true
  if (user.role === 'read-only') return false
  return !ADMIN_ONLY_WRITES.includes(resource)
}

/** Réponse 401 standardisée */
export function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'Authentification requise' }, { status: 401 })
}

/** Recherche un utilisateur par identifiant, avec repli insensible à la casse (clavier mobile) */
export async function findUserByUsernameLoose(username: string): Promise<DbUser | null> {
  const exact = (await db.user.findUnique({ where: { username } })) as DbUser | null
  if (exact) return exact
  const rows = await db.$queryRaw<DbUser[]>`SELECT * FROM User WHERE username = ${username} COLLATE NOCASE LIMIT 1`
  return rows[0] ?? null
}

/** Vérifie la combinaison identifiant / mot de passe (utilisé par /api/auth/login) */
export async function checkCredentials(username: string, password: string): Promise<DbUser | null> {
  // Tolérance mobile : supprime les espaces accidentels en début/fin de mot de passe
  const pwd = password.trim()
  const user = await findUserByUsernameLoose(username)
  if (!user || !verifyPassword(pwd, user.password)) return null
  return user
}
