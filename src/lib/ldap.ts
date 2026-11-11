import { Client } from 'ldapts'
import { db } from './db'

// ---------- Types ----------

export interface LdapSettings {
  enabled: boolean
  url: string
  bindDn: string
  bindPassword: string
  baseDn: string
  userOu: string
  userFilter: string
  usernameAttr: string
  emailAttr: string
  nameAttr: string
  defaultRole: string
  groupId: string | null
  disableMissing: boolean
}

export interface LdapUserEntry {
  dn: string
  username: string
  name: string
  email: string
}

export interface SyncStats {
  found: number
  created: number
  updated: number
  disabled: number
  skipped: number
  errors: string[]
}

type LdapConfigRow = {
  id: string
  enabled: boolean
  url: string
  bindDn: string
  bindPassword: string
  baseDn: string
  userOu: string
  userFilter: string
  usernameAttr: string
  emailAttr: string
  nameAttr: string
  defaultRole: string
  groupId: string | null
  disableMissing: boolean
  lastSyncAt: Date | null
  lastSyncResult: string | null
  lastError: string | null
}

const VALID_ROLES = ['admin', 'user', 'read-only']
const TIMEOUT_MS = 6000

// ---------- Configuration ----------

/** Charge (ou crée) la configuration LDAP singleton */
export async function loadLdapConfig(): Promise<LdapConfigRow> {
  const existing = await db.ldapConfig.findUnique({ where: { id: 'default' } })
  if (existing) return existing
  return db.ldapConfig.create({ data: { id: 'default' } })
}

/** Champs modifiables via l'API — liste blanche stricte */
export function sanitizeLdapConfigInput(body: Record<string, unknown>): Partial<LdapSettings> {
  const out: Partial<LdapSettings> = {}
  if (typeof body.enabled === 'boolean') out.enabled = body.enabled
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  if (body.url !== undefined) out.url = str(body.url)
  if (body.bindDn !== undefined) out.bindDn = str(body.bindDn)
  if (body.bindPassword !== undefined && str(body.bindPassword) !== '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022') {
    out.bindPassword = str(body.bindPassword)
  }
  if (body.baseDn !== undefined) out.baseDn = str(body.baseDn)
  if (body.userOu !== undefined) out.userOu = str(body.userOu)
  if (body.userFilter !== undefined) out.userFilter = str(body.userFilter) || '(objectClass=person)'
  if (body.usernameAttr !== undefined) out.usernameAttr = str(body.usernameAttr) || 'uid'
  if (body.emailAttr !== undefined) out.emailAttr = str(body.emailAttr) || 'mail'
  if (body.nameAttr !== undefined) out.nameAttr = str(body.nameAttr) || 'cn'
  if (body.defaultRole !== undefined && VALID_ROLES.includes(str(body.defaultRole))) out.defaultRole = str(body.defaultRole)
  if (body.groupId !== undefined) out.groupId = str(body.groupId) || null
  if (typeof body.disableMissing === 'boolean') out.disableMissing = body.disableMissing
  return out
}

/** Configuration envoyée au client — mot de passe de liaison jamais retourné */
export function maskLdapConfig(row: LdapConfigRow) {
  const { bindPassword, ...rest } = row
  return { ...rest, bindPassword: '', hasBindPassword: !!bindPassword }
}

/** Fusionne la config enregistrée avec les champs fournis par le client (test / import à chaud) */
export function mergeWithOverrides(
  saved: LdapConfigRow,
  overrides?: Record<string, unknown> | null
): LdapConfigRow {
  if (!overrides || typeof overrides !== 'object') return saved
  const patch = sanitizeLdapConfigInput(overrides)
  const merged = { ...saved, ...patch } as LdapConfigRow
  // Mot de passe masqué non fourni → conserver celui enregistré
  if (!merged.bindPassword && saved.bindPassword && overrides.bindPassword === undefined) {
    merged.bindPassword = saved.bindPassword
  }
  return merged
}

// ---------- Client LDAP ----------

function newClient(url: string): Client {
  if (!url) throw new Error('URL du serveur LDAP manquante')
  if (!/^ldaps?:\/\//i.test(url)) throw new Error("URL LDAP invalide — doit commencer par ldap:// ou ldaps://")
  return new Client({ url, timeout: TIMEOUT_MS, connectTimeout: TIMEOUT_MS })
}

async function withClient<T>(cfg: LdapSettings, userDn: string, userPassword: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = newClient(cfg.url)
  try {
    // Liaison avec le compte technique si fourni, sinon anonyme
    if (userDn || userPassword) {
      await client.bind(userDn, userPassword)
    }
    return await fn(client)
  } finally {
    try { await client.unbind() } catch { /* connexion déjà fermée */ }
  }
}

function serviceBind(cfg: LdapSettings): { dn: string; password: string } {
  return { dn: cfg.bindDn, password: cfg.bindPassword }
}

/** Échappe les caractères spéciaux d'un filtre LDAP (RFC 4515) */
export function escapeLdapFilter(value: string): string {
  return value.replace(/\\/g, '\\5c').replace(/\*/g, '\\2a').replace(/\(/g, '\\28').replace(/\)/g, '\\29').replace(/\0/g, '\\00')
}

function friendlyLdapError(e: unknown): Error {
  const raw = e instanceof Error ? e.message : String(e)
  // ldapts renvoie « Code: 0x31 » pour invalidCredentials (49) — codes connus traduits
  const codeMatch = raw.match(/Code:\s*0x([0-9a-f]+)/i)
  const ldapCode = codeMatch ? parseInt(codeMatch[1], 16) : null
  if (ldapCode === 49 || /invalid credentials|InvalidCredentialsError|data 49/i.test(raw)) {
    return new Error('Identifiants du compte technique refusés par le serveur LDAP')
  }
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|Timeout/i.test(raw)) {
    return new Error(`Serveur LDAP injoignable (${raw.split('\n')[0].slice(0, 120)})`)
  }
  return new Error(raw.split('\n')[0].slice(0, 200))
}

// ---------- Opérations ----------

/** Teste la connexion : liaison avec le compte technique + lecture du contexte de nommage */
export async function testLdapConnection(cfg: LdapSettings): Promise<{ ok: true; message: string; namingContext?: string }> {
  if (!cfg.url) throw new Error('URL du serveur LDAP manquante')
  try {
    const info = await withClient(cfg, cfg.bindDn, cfg.bindPassword, async (client) => {
      const { searchEntries } = await client.search('', { scope: 'base' })
      return (searchEntries[0] ?? null) as unknown as Record<string, unknown> | null
    })
    // Lecture insensible à la casse (comportement variable selon les serveurs / attributs renvoyés)
    let ctx = ''
    if (info && typeof info === 'object') {
      for (const [k, v] of Object.entries(info)) {
        const lk = k.toLowerCase()
        if (lk === 'namingcontexts' || lk === 'defaultnamingcontext') {
          ctx = firstAttr(v as string | string[] | Buffer | Buffer[] | undefined)
          if (ctx) break
        }
      }
    }
    return { ok: true, message: 'Connexion LDAP réussie', namingContext: ctx || undefined }
  } catch (e) {
    throw friendlyLdapError(e)
  }
}

function firstAttr(v: string | string[] | Buffer | Buffer[] | undefined): string {
  if (!v) return ''
  const first = Array.isArray(v) ? v[0] : v
  return typeof first === 'string' ? first : first.toString('utf8')
}

function attr(entry: Record<string, unknown>, name: string): string {
  const v = entry[name]
  if (!v) return ''
  const first = Array.isArray(v) ? v[0] : v
  if (first instanceof Buffer) return first.toString('utf8')
  return typeof first === 'string' ? first : String(first ?? '')
}

/**
 * Liste les unités d'organisation (et conteneurs) sous la base DN.
 * Utilisée par l'interface pour laisser l'administrateur choisir l'OU précise à importer.
 */
export async function listLdapOUs(cfg: LdapSettings): Promise<{ dn: string; name: string }[]> {
  if (!cfg.baseDn) throw new Error('Base DN manquante')
  const service = serviceBind(cfg)
  try {
    return await withClient(cfg, service.dn, service.password, async (client) => {
      const { searchEntries } = await client.search(cfg.baseDn, {
        scope: 'one',
        filter: '(|(objectClass=organizationalUnit)(objectClass=container))',
        attributes: ['ou', 'cn', 'name'],
      })
      const ous = searchEntries
        .map((e) => {
          const dn = e.dn
          const attrs = e as unknown as Record<string, unknown>
          const name = attr(attrs, 'ou') || attr(attrs, 'cn') || attr(attrs, 'name') || dn
          return { dn, name }
        })
        .filter((o) => o.dn)
      // Racine toujours proposée (recherche globale sur la base)
      return [{ dn: cfg.baseDn, name: 'Racine — toute la base' }, ...ous.sort((a, b) => a.name.localeCompare(b.name))]
    })
  } catch (e) {
    throw friendlyLdapError(e)
  }
}

function normalizeUser(entry: Record<string, unknown>, cfg: LdapSettings): LdapUserEntry | null {
  const dn = String((entry as { dn?: string }).dn ?? '')
  if (!dn) return null
  const username =
    attr(entry, cfg.usernameAttr) || attr(entry, 'uid') || attr(entry, 'sAMAccountName') || attr(entry, 'cn')
  if (!username) return null
  const name = attr(entry, cfg.nameAttr) || attr(entry, 'displayName') || attr(entry, 'cn') || attr(entry, 'name') || username
  const email = attr(entry, cfg.emailAttr) || attr(entry, 'mail') || ''
  return { dn, username: username.trim(), name: name.trim(), email: email.trim() }
}

/** Recherche les utilisateurs contenus dans une OU précise (scope sous-arbre de l'OU) */
export async function searchLdapUsers(cfg: LdapSettings, ouDn?: string): Promise<LdapUserEntry[]> {
  const base = (ouDn || cfg.userOu || cfg.baseDn || '').trim()
  if (!base) throw new Error('Aucune OU spécifiée — choisissez une unité d\u2019organisation')
  const filter = cfg.userFilter || '(objectClass=person)'
  const service = serviceBind(cfg)
  try {
    return await withClient(cfg, service.dn, service.password, async (client) => {
      const { searchEntries } = await client.search(base, {
        scope: 'sub',
        filter,
        attributes: [cfg.usernameAttr, cfg.emailAttr, cfg.nameAttr, 'uid', 'sAMAccountName', 'cn', 'displayName', 'mail'],
      })
      const seen = new Set<string>()
      const users: LdapUserEntry[] = []
      for (const e of searchEntries) {
        const u = normalizeUser(e as unknown as Record<string, unknown>, cfg)
        if (u && !seen.has(u.dn.toLowerCase())) {
          seen.add(u.dn.toLowerCase())
          users.push(u)
        }
      }
      return users.sort((a, b) => a.username.localeCompare(b.username))
    })
  } catch (e) {
    throw friendlyLdapError(e)
  }
}

/** Recherche un utilisateur LDAP par identifiant (pour l'authentification à la connexion) */
async function findLdapUserByLogin(cfg: LdapSettings, username: string): Promise<LdapUserEntry | null> {
  const base = cfg.userOu || cfg.baseDn
  if (!base || !username) return null
  const filter = `(&${cfg.userFilter || '(objectClass=person)'}(${cfg.usernameAttr || 'uid'}=${escapeLdapFilter(username)}))`
  const service = serviceBind(cfg)
  return withClient(cfg, service.dn, service.password, async (client) => {
    const { searchEntries } = await client.search(base, {
      scope: 'sub',
      filter,
      attributes: [cfg.usernameAttr, cfg.emailAttr, cfg.nameAttr, 'uid', 'sAMAccountName', 'cn', 'displayName', 'mail'],
    })
    for (const e of searchEntries) {
      const u = normalizeUser(e as unknown as Record<string, unknown>, cfg)
      if (u && u.username.toLowerCase() === username.toLowerCase()) return u
    }
    return null
  })
}

/**
 * Authentifie un utilisateur contre le LDAP : recherche son DN puis teste le mot de passe par liaison directe.
 * Retourne l'entrée LDAP si le mot de passe est correct, null sinon.
 */
export async function ldapAuthenticate(cfg: LdapSettings, username: string, password: string): Promise<LdapUserEntry | null> {
  const entry = await findLdapUserByLogin(cfg, username)
  if (!entry) return null
  try {
    await withClient(cfg, entry.dn, password, async () => true)
    return entry
  } catch {
    return null
  }
}

/** Vérifie le mot de passe d'un compte DÉJÀ importé en liant directement son DN stocké */
export async function ldapBindByDn(cfg: LdapSettings, dn: string, password: string): Promise<boolean> {
  if (!dn || !password) return false
  try {
    await withClient(cfg, dn, password, async () => true)
    return true
  } catch {
    return false
  }
}

// ---------- Synchronisation ----------

async function findUserForLdapEntry(u: LdapUserEntry) {
  const byDn = await db.user.findFirst({ where: { ldapDn: u.dn } })
  if (byDn) return byDn
  const rows = await db.$queryRaw<{ id: string }[]>`SELECT id FROM User WHERE username = ${u.username} COLLATE NOCASE LIMIT 1`
  return rows[0] ? db.user.findUnique({ where: { id: rows[0].id } }) : null
}

/** Crée ou met à jour UN compte à partir d'une entrée LDAP (utilisée par l'import et la connexion) */
export async function upsertLdapUser(u: LdapUserEntry, opts: { role: string; groupId: string | null }) {
  const existing = await findUserForLdapEntry(u)
  const email = u.email || `${u.username.toLowerCase()}@ldap.local`
  if (existing) {
    const updated = await db.user.update({
      where: { id: existing.id },
      data: {
        name: u.name || existing.name,
        email,
        authProvider: 'ldap',
        ldapDn: u.dn,
        // un compte LDAP réapparu dans l'OU est réactivé ; un compte désactivé manuellement en local est préservé
        status: existing.status === 'disabled' && existing.authProvider === 'ldap' ? 'active' : existing.status,
        // le rôle par défaut ne s'applique qu'aux comptes déjà LDAP (jamais à un admin)
        ...(existing.authProvider === 'ldap' && existing.role !== 'admin' ? { role: opts.role } : {}),
        userGroupId: existing.userGroupId ?? opts.groupId,
      },
    })
    return { user: updated, created: false }
  }
  // Conflit d'email avec un compte local existant → email de secours (unicité garantie)
  let safeEmail = email
  if (email) {
    const taken = await db.user.findFirst({ where: { email } })
    if (taken && taken.ldapDn !== u.dn) safeEmail = `${u.username.toLowerCase()}@ldap.local`
  }
  const created = await db.user.create({
    data: {
      username: u.username,
      email: safeEmail,
      name: u.name || u.username,
      password: '', // les comptes LDAP s'authentifient via le serveur LDAP
      role: opts.role,
      status: 'active',
      authProvider: 'ldap',
      ldapDn: u.dn,
      userGroupId: opts.groupId,
    },
  })
  return { user: created, created: true }
}

/**
 * Synchronise les comptes du CMS avec les utilisateurs d'une OU LDAP précise :
 * crée les nouveaux, met à jour les existants, et désactive éventuellement
 * les comptes LDAP qui ne sont plus présents dans l'OU.
 */
export async function syncLdapUsers(
  cfg: LdapSettings,
  opts: { ou?: string; defaultRole?: string; groupId?: string | null; disableMissing?: boolean }
): Promise<SyncStats> {
  const ou = (opts.ou || cfg.userOu || '').trim()
  const role = VALID_ROLES.includes(opts.defaultRole ?? '') ? opts.defaultRole! : cfg.defaultRole || 'user'
  const groupId = opts.groupId !== undefined ? opts.groupId : cfg.groupId
  const disableMissing = opts.disableMissing ?? cfg.disableMissing

  const users = await searchLdapUsers(cfg, ou)
  const stats: SyncStats = { found: users.length, created: 0, updated: 0, disabled: 0, skipped: 0, errors: [] }
  if (users.length === 0) throw new Error('Aucun utilisateur trouvé dans cette OU (vérifiez le filtre et les attributs)')

  const presentDns = new Set<string>()
  const seenUsernames = new Set<string>()

  for (const u of users) {
    try {
      const dnKey = u.dn.toLowerCase()
      presentDns.add(dnKey)
      // Conflit d'identifiant avec un autre utilisateur LDAP de la même OU
      if (seenUsernames.has(u.username.toLowerCase())) {
        stats.skipped++
        stats.errors.push(`Identifiant dupliqué ignoré : ${u.username}`)
        continue
      }
      seenUsernames.add(u.username.toLowerCase())
      // Ne jamais toucher le compte admin local (anti-verrouillage)
      if (u.username.toLowerCase() === 'admin') {
        stats.skipped++
        continue
      }
      const { created } = await upsertLdapUser(u, { role, groupId: groupId ?? null })
      if (created) stats.created++
      else stats.updated++
    } catch (e) {
      stats.skipped++
      stats.errors.push(`${u.username} : ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (disableMissing) {
    const ldapUsers = await db.user.findMany({ where: { authProvider: 'ldap', ldapDn: { not: null } } })
    for (const lu of ldapUsers) {
      if (lu.role === 'admin') continue // jamais de désactivation d'admin
      if (lu.ldapDn && !presentDns.has(lu.ldapDn.toLowerCase()) && lu.status === 'active') {
        await db.user.update({ where: { id: lu.id }, data: { status: 'disabled' } })
        stats.disabled++
      }
    }
  }

  const summary = `${stats.created} créé(s), ${stats.updated} mis à jour, ${stats.disabled} désactivé(s), ${stats.skipped} ignoré(s)`
  await db.ldapConfig.update({
    where: { id: 'default' },
    data: { lastSyncAt: new Date(), lastSyncResult: summary, lastError: stats.errors.length ? stats.errors.join(' ; ').slice(0, 500) : null },
  })
  return stats
}
