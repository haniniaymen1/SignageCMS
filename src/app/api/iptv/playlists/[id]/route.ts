import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, unauthorized } from '@/lib/auth'
import { can, forbidden } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

// PATCH : rafraîchir une playlist (re-télécharger la source URL)
export async function PATCH(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const _u = await getSessionUser(_req)
  if (!_u) return unauthorized()
  if (!(await can(_u, 'iptv', 'update'))) return forbidden()
  const { id } = await ctx.params
  try {
    const playlist = await db.iptvPlaylist.findUnique({ where: { id } })
    if (!playlist) return NextResponse.json({ error: 'Playlist introuvable' }, { status: 404 })
    if (playlist.sourceType !== 'url' || !playlist.url)
      return NextResponse.json(
        { error: 'Seules les playlists issues d’une URL peuvent être rafraîchies' },
        { status: 400 }
      )

    let raw = ''
    try {
      const res = await fetch(playlist.url, {
        headers: { 'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20', Accept: '*/*' },
        redirect: 'follow',
        signal: AbortSignal.timeout(30000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      raw = await res.text()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'inaccessible'
      await db.iptvPlaylist.update({ where: { id }, data: { status: 'error', error: msg } })
      return NextResponse.json({ error: `Échec du rafraîchissement : ${msg}` }, { status: 400 })
    }

    const { parseM3U } = await import('@/lib/m3u')
    const parsed = parseM3U(raw).slice(0, parseInt(process.env.IPTV_MAX_CHANNELS || '50000', 10))
    if (parsed.length === 0)
      return NextResponse.json({ error: 'Aucune chaîne détectée' }, { status: 400 })

    await db.$transaction([
      db.iptvChannel.deleteMany({ where: { playlistId: id } }),
      db.iptvPlaylist.update({
        where: { id },
        data: {
          status: 'ok',
          error: null,
          channelCount: parsed.length,
          channels: { create: parsed },
        },
      }),
    ])

    const updated = await db.iptvPlaylist.findUnique({
      where: { id },
      include: { _count: { select: { channels: true } } },
    })
    return NextResponse.json({ playlist: updated, imported: parsed.length })
  } catch (e) {
    console.error('PATCH /api/iptv/playlists/[id] error:', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// DELETE : supprimer la playlist et ses chaînes
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const _u = await getSessionUser(_req)
  if (!_u) return unauthorized()
  if (!(await can(_u, 'iptv', 'delete'))) return forbidden()
  const { id } = await ctx.params
  try {
    await db.iptvPlaylist.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('DELETE /api/iptv/playlists/[id] error:', e)
    return NextResponse.json({ error: 'Suppression impossible' }, { status: 500 })
  }
}
