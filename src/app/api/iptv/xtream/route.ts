import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { xtreamAuth, expiryToDate, normalizeHost } from '@/lib/xtream'
import { getSessionUser, unauthorized } from '@/lib/auth'
import { can, forbidden } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

/** Masque les champs sensibles d'un compte Xtream */
function mask(provider: {
  password: string
  rawInfo?: string | null
} & Record<string, unknown>) {
  return { ...provider, password: '••••••••', rawInfo: undefined }
}

/** GET — liste de TOUS les portails Xtream connectés (mots de passe masqués) */
export async function GET(req: NextRequest) {
  const _u = await getSessionUser(req)
  if (!_u) return unauthorized()
  if (!(await can(_u, 'iptv', 'view'))) return forbidden()
  try {
    const providers = await db.iptvProvider.findMany({ orderBy: { createdAt: 'asc' } })
    return NextResponse.json({ providers: providers.map(mask) })
  } catch (e) {
    console.error('GET /api/iptv/xtream error:', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

/**
 * POST — ajoute un NOUVEAU compte Xtream (multi-comptes).
 * Si le couple (host, username) existe déjà : mise à jour du compte.
 * Si le mot de passe change pour ce couple : ses contenus importés sont
 * réinitialisés (les autres comptes ne sont PAS touchés).
 */
export async function POST(req: NextRequest) {
  const _u = await getSessionUser(req)
  if (!_u) return unauthorized()
  if (!(await can(_u, 'iptv', 'create'))) return forbidden()
  try {
    const body = await req.json()
    const host = normalizeHost(String(body.host || ''))
    const username = String(body.username || '').trim()
    const password = String(body.password || '').trim()
    const name = String(body.name || '').trim() || username

    if (!host || !/^https?:\/\//i.test(host))
      return NextResponse.json({ error: 'URL du portail invalide (ex : http://host:port)' }, { status: 400 })
    if (!username || !password)
      return NextResponse.json({ error: "L'utilisateur et le mot de passe sont requis" }, { status: 400 })

    let auth
    try {
      auth = await xtreamAuth(host, username, password)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Connexion impossible'
      const hint = /ne répond pas|impossible|inaccessible/i.test(msg)
        ? ' Note : depuis un aperçu cloud, les ports non standard (ex : 2095) peuvent être bloqués — l\u2019application fonctionnera depuis votre serveur/VPS ou en local.'
        : ''
      await db.iptvProvider.updateMany({
        where: { host, username },
        data: { status: 'error', lastError: msg },
      })
      return NextResponse.json({ error: msg + hint }, { status: 502 })
    }

    const ui = auth.user_info
    const si = auth.server_info
    const expiry = expiryToDate(ui.exp_date)
    const isExpired = expiry ? expiry.getTime() < Date.now() : false

    const data = {
      name,
      host,
      username,
      password,
      status: isExpired ? 'expired' : 'connected',
      expiry,
      maxConnections: parseInt(ui.max_connections || '0', 10) || 0,
      activeConnections: parseInt(ui.active_cons || '0', 10) || 0,
      isTrial: ui.is_trial === '1' || ui.is_trial === 'true',
      timezone: si?.timezone ?? null,
      allowedFormats: Array.isArray(ui.allowed_output_formats) ? ui.allowed_output_formats.join(',') : null,
      rawInfo: JSON.stringify({ user_info: ui, server_info: si }),
      lastError: null,
    }

    // Multi-comptes : on cherche CE compte (host+username), pas « le dernier »
    const existing = await db.iptvProvider.findFirst({ where: { host, username } })
    let provider
    if (existing) {
      const passwordChanged = existing.password !== password
      provider = await db.iptvProvider.update({ where: { id: existing.id }, data })
      if (passwordChanged) {
        // Contenus de CE compte seulement réinitialisés
        await db.iptvChannel.deleteMany({ where: { providerId: existing.id, kind: { not: 'playlist' } } })
        provider = await db.iptvProvider.update({
          where: { id: existing.id },
          data: { liveCount: 0, vodCount: 0, seriesCount: 0, lastSyncAt: null },
        })
      }
    } else {
      provider = await db.iptvProvider.create({ data })
    }

    return NextResponse.json({ provider: mask(provider) })
  } catch (e) {
    console.error('POST /api/iptv/xtream error:', e)
    return NextResponse.json({ error: 'Erreur lors de la connexion au portail' }, { status: 500 })
  }
}

/**
 * DELETE — supprime UN compte Xtream (?id=...) et SES contenus importés.
 * Sans id : supprime tous les comptes et tous les contenus Xtream.
 * Les chaînes des playlists M3U (kind = playlist) ne sont jamais touchées.
 */
export async function DELETE(req: NextRequest) {
  const _u = await getSessionUser(req)
  if (!_u) return unauthorized()
  if (!(await can(_u, 'iptv', 'delete'))) return forbidden()
  try {
    const id = req.nextUrl.searchParams.get('id')?.trim()
    if (id) {
      await db.iptvChannel.deleteMany({ where: { providerId: id, kind: { not: 'playlist' } } })
      await db.iptvProvider.delete({ where: { id } }).catch(() => null)
    } else {
      await db.iptvChannel.deleteMany({ where: { kind: { not: 'playlist' } } })
      await db.iptvProvider.deleteMany({})
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('DELETE /api/iptv/xtream error:', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
