import { NextRequest, NextResponse } from 'next/server'
import { getDelegate, requireUser, isResponse, prepareUserData, RESOURCE_CONFIG, isProtectedSettingKey } from '../route'
import { can, forbidden, moduleForResource, actionForMethod } from '@/lib/permissions'
import { healLayoutSlidesInBackground } from '@/lib/slides-heal'

export const dynamic = 'force-dynamic'

// Ne jamais renvoyer le hash — exposer seulement hasPassword
function sanitizeUserItem(item: Record<string, unknown>): Record<string, unknown> {
  if (!item || typeof item !== 'object' || !('password' in item)) return item
  const { password, ...rest } = item
  return { ...rest, hasPassword: !!password }
}

// Détail d'un paramètre : valeur masquée si clé protégée (v3.11)
function sanitizeItem(item: Record<string, unknown>, model: string): Record<string, unknown> {
  const cleaned = sanitizeUserItem(item)
  if (model === 'setting' && isProtectedSettingKey(cleaned?.key)) {
    return { ...cleaned, value: '' }
  }
  return cleaned
}

// GET : détail d'une ressource
export async function GET(req: NextRequest, ctx: { params: Promise<{ resource: string; id: string }> }) {
  const { resource, id } = await ctx.params
  const config = RESOURCE_CONFIG[resource]
  if (!config) return NextResponse.json({ error: 'Ressource inconnue' }, { status: 404 })

  const auth = await requireUser(req, resource)
  if (isResponse(auth)) return auth

  // Droits fins : lecture du module associé (lecteurs exclus)
  if (auth.role !== 'player') {
    const mod = moduleForResource(resource)
    if (!mod || !(await can(auth, mod, 'view'))) return forbidden()
  }

  const delegate = getDelegate(config.model)
  if (!delegate?.findUnique) return NextResponse.json({ error: 'Modèle introuvable' }, { status: 404 })

  try {
    const item = await delegate.findUnique({ where: { id }, include: config.includes })
    if (!item) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

    // v3.11.9 — auto-réparation : un layout servi au lecteur contenant une
    // présentation/PDF sans slides relance la conversion en arrière-plan
    // (sans ralentir la réponse). Au prochain rafraîchissement (60 s), les
    // slides sont là — corrige aussi les médias déjà téléversés avant
    // l'installation des outils, pour le web ET l'APK.
    if (resource === 'layouts') {
      try {
        healLayoutSlidesInBackground(item as Parameters<typeof healLayoutSlidesInBackground>[0])
      } catch { /* jamais bloquant */ }
    }

    return NextResponse.json(sanitizeItem(item as Record<string, unknown>, config.model))
  } catch (e) {
    console.error(`GET /api/resource/${resource}/${id} error:`, e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// PUT : mise à jour
export async function PUT(req: NextRequest, ctx: { params: Promise<{ resource: string; id: string }> }) {
  const { resource, id } = await ctx.params
  const config = RESOURCE_CONFIG[resource]
  if (!config) return NextResponse.json({ error: 'Ressource inconnue' }, { status: 404 })

  const auth = await requireUser(req, resource)
  if (isResponse(auth)) return auth
  const mod = moduleForResource(resource)
  if (!mod || !(await can(auth, mod, actionForMethod(req.method)))) return forbidden()

  const delegate = getDelegate(config.model)
  if (!delegate?.update) return NextResponse.json({ error: 'Modèle introuvable' }, { status: 404 })

  try {
    const body = (await req.json()) as Record<string, unknown>

    // Paramètres protégés (v3.11) : authSecret et assimilés non modifiables via l'API.
    // Le changement de clé de signature se fait uniquement côté serveur (révocation totale
    // des sessions via la base) — jamais par une requête HTTP.
    if (config.model === 'setting') {
      const existing = await delegate.findUnique({ where: { id } }) as Record<string, unknown> | null
      if (existing && (isProtectedSettingKey(existing.key) || isProtectedSettingKey(body.key))) {
        return NextResponse.json({ error: 'Paramètre système protégé' }, { status: 403 })
      }
    }

    // Garde-fous sur son propre compte
    if (config.model === 'user' && auth.id === id) {
      if (body.status === 'disabled') {
        return NextResponse.json({ error: 'Impossible de désactiver votre propre compte' }, { status: 400 })
      }
      if (body.role && body.role !== 'admin') {
        return NextResponse.json(
          { error: 'Impossible de retirer votre propre rôle administrateur' },
          { status: 400 }
        )
      }
    }

    // Réinitialisation du mot de passe d'un AUTRE utilisateur : révoque ses sessions en cours
    if (config.model === 'user' && auth.id !== id && typeof body.password === 'string' && body.password.length >= 4) {
      body.tokenValidAfter = new Date()
    }

    const item = await delegate.update({
      where: { id },
      data: prepareUserData(config.model, body),
      include: config.includes,
    })
    return NextResponse.json(sanitizeItem(item as Record<string, unknown>, config.model))
  } catch (e) {
    console.error(`PUT /api/resource/${resource}/${id} error:`, e)
    return NextResponse.json({ error: 'Mise à jour impossible' }, { status: 400 })
  }
}

// DELETE : suppression
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ resource: string; id: string }> }) {
  const { resource, id } = await ctx.params
  const config = RESOURCE_CONFIG[resource]
  if (!config) return NextResponse.json({ error: 'Ressource inconnue' }, { status: 404 })

  const auth = await requireUser(req, resource)
  if (isResponse(auth)) return auth
  const mod = moduleForResource(resource)
  if (!mod || !(await can(auth, mod, actionForMethod(req.method)))) return forbidden()

  if (config.model === 'user' && auth.id === id) {
    return NextResponse.json({ error: 'Impossible de supprimer votre propre compte' }, { status: 400 })
  }

  const delegate = getDelegate(config.model)
  if (!delegate?.delete) return NextResponse.json({ error: 'Modèle introuvable' }, { status: 404 })

  try {
    await delegate.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(`DELETE /api/resource/${resource}/${id} error:`, e)
    return NextResponse.json({ error: 'Suppression impossible' }, { status: 400 })
  }
}
