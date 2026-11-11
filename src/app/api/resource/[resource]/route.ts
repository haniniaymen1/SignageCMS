import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, hashPassword, unauthorized } from '@/lib/auth'
import type { SessionUser } from '@/lib/auth'
import { can, forbidden, moduleForResource, actionForMethod } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export const RESOURCE_CONFIG: Record<string, {
  model: string
  includes?: Record<string, unknown>
  orderBy?: Record<string, 'asc' | 'desc'>
}> = {
  displays: {
    model: 'display',
    includes: { group: true },
    orderBy: { name: 'asc' },
  },
  'display-groups': {
    model: 'displayGroup',
    includes: { _count: { select: { displays: true, events: true } } },
    orderBy: { name: 'asc' },
  },
  media: {
    model: 'media',
    orderBy: { createdAt: 'desc' },
  },
  layouts: {
    model: 'layout',
    includes: {
      regions: { include: { widgets: { include: { media: true } } } },
      _count: { select: { campaigns: true, events: true } },
    },
    orderBy: { createdAt: 'desc' },
  },
  playlists: {
    model: 'playlist',
    includes: { widgets: { include: { media: true }, orderBy: { position: 'asc' } } },
    orderBy: { createdAt: 'desc' },
  },
  widgets: {
    model: 'widget',
    includes: { media: true },
    orderBy: { position: 'asc' },
  },
  campaigns: {
    model: 'campaign',
    includes: { layouts: { include: { layout: true }, orderBy: { displayOrder: 'asc' } }, _count: { select: { events: true } } },
    orderBy: { createdAt: 'desc' },
  },
  'campaign-layouts': {
    model: 'campaignLayout',
    includes: { layout: true },
  },
  events: {
    model: 'scheduleEvent',
    includes: { layout: true, campaign: true, displayGroup: true },
    orderBy: { start: 'asc' },
  },
  users: {
    model: 'user',
    includes: { userGroup: true },
    orderBy: { createdAt: 'asc' },
  },
  'user-groups': {
    model: 'userGroup',
    includes: { _count: { select: { users: true } } },
    orderBy: { name: 'asc' },
  },
  logs: {
    model: 'logEntry',
    orderBy: { createdAt: 'desc' },
  },
  'proof-of-play': {
    model: 'proofOfPlay',
    orderBy: { date: 'desc' },
  },
  settings: {
    model: 'setting',
    orderBy: { key: 'asc' },
  },
}

export function getDelegate(model: string) {
  return (db as unknown as Record<string, Record<string, (args?: unknown) => Promise<unknown>>>)[model]
}

/**
 * Authentification de la requête.
 * Exception : GET /api/resource/layouts[/:id] reste ouvert — les lecteurs d'écrans
 * récupèrent la présentation à diffuser avec leur clé matérielle (sans compte).
 */
export async function requireUser(req: NextRequest, resource: string): Promise<SessionUser | NextResponse> {
  if (req.method === 'GET' && resource === 'layouts') {
    // Lecteurs d'écrans : accès en lecture sans compte
    return { id: '', username: 'player', name: 'Lecteur', email: '', role: 'player', status: 'active', hasPassword: true }
  }
  const user = await getSessionUser(req)
  if (!user) return unauthorized()
  return user
}

export function isResponse(v: unknown): v is NextResponse {
  return v instanceof NextResponse || (typeof Response !== 'undefined' && v instanceof Response)
}

// Ne jamais renvoyer le hash — exposer seulement hasPassword
function sanitizeUserItem(item: Record<string, unknown>): Record<string, unknown> {
  if (!item || typeof item !== 'object' || !('password' in item)) return item
  const { password, ...rest } = item
  return { ...rest, hasPassword: !!password }
}

// ---------- Paramètres protégés (v3.11) ----------
// Le secret de signature des sessions (authSecret) vit dans la table Setting.
// L'exposer via /api/resource/settings permettrait à N'IMPORTE QUEL utilisateur
// authentifié (même lecture seule) de falsifier des jetons admin (HMAC connu).
// Ces clés sont donc masquées en lecture et interdites en écriture via l'API.
// Comparaison en minuscules systématique : la clé réelle en base est
// « authSecret » (camelCase) — une liste mixte-case ne matcherait jamais
// key.toLowerCase(). Le motif accepte aussi les collages camelCase
// (ex. « authSecret », « myApiKey ») en tolérant une lettre avant/après.
const PROTECTED_SETTING_KEYS = ['authsecret', 'auth_secret']
const PROTECTED_SETTING_PATTERN = /(^|_|[a-z])(secret|password|passwd|token|apikey|api_key|privatekey)($|_|[a-z])/i

export function isProtectedSettingKey(key: unknown): boolean {
  if (typeof key !== 'string' || !key) return false
  if (PROTECTED_SETTING_KEYS.includes(key.toLowerCase())) return true
  return PROTECTED_SETTING_PATTERN.test(key)
}

// Liste des détails : ne jamais renvoyer la valeur des paramètres protégés
function sanitizeSettingItem(item: Record<string, unknown>): Record<string, unknown> {
  if (!item || typeof item !== 'object' || !('key' in item)) return item
  if (isProtectedSettingKey(item.key)) {
    return { ...item, value: '' }
  }
  return item
}

function sanitizeItems(items: unknown, model: string): unknown {
  if (model === 'user' && Array.isArray(items)) {
    return items.map((it) => sanitizeUserItem(it as Record<string, unknown>))
  }
  if (model === 'setting' && Array.isArray(items)) {
    return items.map((it) => sanitizeSettingItem(it as Record<string, unknown>))
  }
  return items
}

// Prépare les données utilisateur : hache le mot de passe s'il est fourni
export function prepareUserData(model: string, body: Record<string, unknown>): Record<string, unknown> {
  if (model !== 'user') return body
  const data = { ...body }
  const pwd = data.password
  if (typeof pwd === 'string' && pwd.length >= 4) {
    data.password = hashPassword(pwd)
  } else {
    delete data.password // chaîne vide ou absente : aucun changement
  }
  return data
}

// GET : liste des ressources
export async function GET(req: NextRequest, ctx: { params: Promise<{ resource: string }> }) {
  const { resource } = await ctx.params
  const config = RESOURCE_CONFIG[resource]
  if (!config) return NextResponse.json({ error: 'Ressource inconnue' }, { status: 404 })

  const auth = await requireUser(req, resource)
  if (isResponse(auth)) return auth

  // Droits fins : lecture du module associé à la ressource (lecteurs exclus)
  if (auth.role !== 'player') {
    const mod = moduleForResource(resource)
    if (!mod || !(await can(auth, mod, 'view'))) return forbidden()
  }

  const delegate = getDelegate(config.model)
  if (!delegate?.findMany) return NextResponse.json({ error: 'Modèle introuvable' }, { status: 404 })

  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search')

  let where: Record<string, unknown> | undefined
  if (search && config.model === 'user') {
    where = {
      OR: [
        { name: { contains: search } },
        { username: { contains: search } },
        { email: { contains: search } },
      ],
    }
  }

  try {
    const items = await delegate.findMany({
      include: config.includes,
      orderBy: config.orderBy,
      where,
      // v3.11 : limite bornée (1..10 000) — évite les extractions massives / DoS mémoire
      take: searchParams.get('limit')
        ? Math.min(Math.max(parseInt(searchParams.get('limit')!, 10) || 0, 1), 10000)
        : undefined,
    })
    return NextResponse.json(sanitizeItems(items, config.model))
  } catch (e) {
    console.error(`GET /api/resource/${resource} error:`, e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// POST : création d'une ressource
export async function POST(req: NextRequest, ctx: { params: Promise<{ resource: string }> }) {
  const { resource } = await ctx.params
  const config = RESOURCE_CONFIG[resource]
  if (!config) return NextResponse.json({ error: 'Ressource inconnue' }, { status: 404 })

  const auth = await requireUser(req, resource)
  if (isResponse(auth)) return auth
  const mod = moduleForResource(resource)
  if (!mod || !(await can(auth, mod, actionForMethod(req.method)))) return forbidden()

  const delegate = getDelegate(config.model)
  if (!delegate?.create) return NextResponse.json({ error: 'Modèle introuvable' }, { status: 404 })

  try {
    const body = (await req.json()) as Record<string, unknown>

    // Paramètres protégés (v3.11) : authSecret et assimilés ne sont pas créables via l'API
    if (config.model === 'setting' && isProtectedSettingKey(body.key)) {
      return NextResponse.json({ error: 'Paramètre système protégé' }, { status: 403 })
    }

    const item = await delegate.create({ data: prepareUserData(config.model, body), include: config.includes })
    const sanitized = sanitizeItems([item], config.model) as Record<string, unknown>[] | unknown
    return NextResponse.json(
      Array.isArray(sanitized) && sanitized[0] ? sanitized[0] : (item as Record<string, unknown>),
      { status: 201 }
    )
  } catch (e) {
    console.error(`POST /api/resource/${resource} error:`, e)
    return NextResponse.json({ error: 'Création impossible' }, { status: 400 })
  }
}
