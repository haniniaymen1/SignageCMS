import { db } from './db'
import { NextResponse } from 'next/server'
import type { SessionUser } from './auth'

/**
 * Gestion fine des droits par rôle.
 *
 * L'administrateur définit, pour chaque rôle non-admin (user, read-only),
 * les actions autorisées par module (page du CMS + ses API).
 * La matrice est stockée dans la table Setting (clé rolePermissions) au format JSON :
 *   { "user": { "displays": ["view","create",...], ... }, "read-only": { ... } }
 * admin possède toujours tous les droits (non éditable).
 * Les modules absents de la matrice enregistrée retombent sur les défauts.
 */

export type PermAction = 'view' | 'create' | 'update' | 'delete'
export type PermissionMatrix = Record<string, Record<string, PermAction[]>>

export const ALL_ACTIONS: PermAction[] = ['view', 'create', 'update', 'delete']

export const ACTION_LABELS: { id: PermAction; label: string }[] = [
  { id: 'view', label: 'Voir' },
  { id: 'create', label: 'Créer' },
  { id: 'update', label: 'Modifier' },
  { id: 'delete', label: 'Supprimer' },
]

export interface PermModule {
  id: string
  label: string
  description: string
  actions: PermAction[] // actions proposées pour ce module (dashboard = voir seulement)
  resources: string[] // ressources /api/resource/** couvertes par le module
}

const CRUD: PermAction[] = ['view', 'create', 'update', 'delete']

export const MODULES: PermModule[] = [
  {
    id: 'dashboard',
    label: 'Tableau de bord',
    description: 'Statistiques et vue générale',
    actions: ['view'],
    resources: [],
  },
  {
    id: 'displays',
    label: 'Écrans',
    description: 'Écrans, groupes d\u2019écrans, statut en ligne',
    actions: CRUD,
    resources: ['displays', 'display-groups'],
  },
  {
    id: 'media',
    label: 'Bibliothèque de médias',
    description: 'Images, vidéos, audio, PDF, présentations importées',
    actions: CRUD,
    resources: ['media'],
  },
  {
    id: 'iptv',
    label: 'TV / IPTV',
    description: 'Comptes Xtream, playlists m3u, chaînes, synchronisation',
    actions: CRUD,
    resources: [],
  },
  {
    id: 'layouts',
    label: 'Présentations',
    description: 'Layouts, régions, widgets, concepteur',
    actions: CRUD,
    resources: ['layouts', 'widgets'],
  },
  {
    id: 'playlists',
    label: 'Playlists',
    description: 'Séquences de médias',
    actions: CRUD,
    resources: ['playlists'],
  },
  {
    id: 'campaigns',
    label: 'Campagnes',
    description: 'Campagnes multi-présentations',
    actions: CRUD,
    resources: ['campaigns', 'campaign-layouts'],
  },
  {
    id: 'schedule',
    label: 'Planification',
    description: 'Événements de diffusion (cible : tous, groupe, écrans)',
    actions: CRUD,
    resources: ['events'],
  },
  {
    id: 'reports',
    label: 'Rapports',
    description: 'Journaux et preuves de diffusion',
    actions: CRUD,
    resources: ['logs', 'proof-of-play'],
  },
  {
    id: 'users',
    label: 'Utilisateurs',
    description: 'Comptes, groupes d\u2019utilisateurs, mots de passe',
    actions: CRUD,
    resources: ['users', 'user-groups'],
  },
  {
    id: 'settings',
    label: 'Paramètres',
    description: 'Paramètres généraux du CMS',
    actions: CRUD,
    resources: ['settings'],
  },
]

export const EDITABLE_ROLES: { id: string; label: string }[] = [
  { id: 'user', label: 'Utilisateur' },
  { id: 'read-only', label: 'Lecture seule' },
]

const FULL: Record<string, PermAction[]> = Object.fromEntries(MODULES.map((m) => [m.id, m.actions]))
const VIEW_ONLY: Record<string, PermAction[]> = Object.fromEntries(MODULES.map((m) => [m.id, ['view'] as PermAction[]]))

/** Défauts = comportement historique (utilisateur : tout sauf comptes/paramètres en écriture) */
export const DEFAULT_MATRIX: PermissionMatrix = {
  user: { ...FULL, users: ['view'], settings: ['view'] },
  'read-only': { ...VIEW_ONLY },
}

const SETTING_KEY = 'rolePermissions'

function sanitizeMatrix(raw: unknown): PermissionMatrix {
  const out: PermissionMatrix = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [role, mods] of Object.entries(raw as Record<string, unknown>)) {
    if (!EDITABLE_ROLES.some((r) => r.id === role)) continue
    if (!mods || typeof mods !== 'object') continue
    out[role] = {}
    for (const [mod, actions] of Object.entries(mods as Record<string, unknown>)) {
      if (!MODULES.some((m) => m.id === mod) || !Array.isArray(actions)) continue
      const valid = actions.filter((a): a is PermAction => ALL_ACTIONS.includes(a as PermAction))
      out[role][mod] = Array.from(new Set(valid))
    }
  }
  return out
}

/** Matrice effective : défauts fusionnés avec la configuration enregistrée */
export async function getRolePermissions(): Promise<PermissionMatrix> {
  const merged: PermissionMatrix = {}
  for (const r of EDITABLE_ROLES) merged[r.id] = { ...(DEFAULT_MATRIX[r.id] ?? {}) }
  try {
    const row = await db.setting.findUnique({ where: { key: SETTING_KEY } })
    if (row?.value) {
      const saved = sanitizeMatrix(JSON.parse(row.value))
      for (const role of Object.keys(merged)) {
        merged[role] = { ...merged[role], ...(saved[role] ?? {}) }
      }
    }
  } catch {
    // config absente/corrompue → défauts
  }
  return merged
}

/** Enregistre la matrice (déjà nettoyée) et renvoie la matrice effective */
export async function saveRolePermissions(raw: unknown): Promise<PermissionMatrix> {
  const clean = sanitizeMatrix(raw)
  const value = JSON.stringify(clean)
  await db.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value },
    create: { key: SETTING_KEY, value },
  })
  return getRolePermissions()
}

/** Droit effectif d'un utilisateur sur un module/action. admin = toujours autorisé. */
export async function can(user: SessionUser | null, moduleId: string, action: PermAction): Promise<boolean> {
  if (!user) return false
  if (user.role === 'admin') return true
  const mod = MODULES.find((m) => m.id === moduleId)
  if (!mod || !mod.actions.includes(action)) return false
  const matrix = await getRolePermissions()
  const allowed = matrix[user.role]?.[moduleId]
  return Array.isArray(allowed) && allowed.includes(action)
}

/** Ressource /api/resource/** → module de permission (null si inconnue) */
export function moduleForResource(resource: string): string | null {
  for (const m of MODULES) if (m.resources.includes(resource)) return m.id
  return null
}

/** Action requise selon la méthode HTTP */
export function actionForMethod(method: string): PermAction {
  switch (method) {
    case 'POST':
      return 'create'
    case 'PUT':
    case 'PATCH':
      return 'update'
    case 'DELETE':
      return 'delete'
    default:
      return 'view'
  }
}

/** 403 standardisée */
export function forbidden(): NextResponse {
  return NextResponse.json({ error: 'Permission refusée pour votre rôle' }, { status: 403 })
}

/** Permissions d'un rôle pour le client (/api/auth/me) — null si rôle inconnu */
export async function permissionsForRole(role: string): Promise<Record<string, PermAction[]> | null> {
  if (role === 'admin') return Object.fromEntries(MODULES.map((m) => [m.id, m.actions]))
  if (!EDITABLE_ROLES.some((r) => r.id === role)) return null
  const matrix = await getRolePermissions()
  return matrix[role] ?? null
}
