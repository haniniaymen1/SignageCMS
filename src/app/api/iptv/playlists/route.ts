import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseM3U } from '@/lib/m3u'
import { getSessionUser, unauthorized } from '@/lib/auth'
import { can, forbidden } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

const MAX_CHANNELS = parseInt(process.env.IPTV_MAX_CHANNELS || '50000', 10)

/** GET — liste des playlists M3U */
export async function GET(req: NextRequest) {
  const _u = await getSessionUser(req)
  if (!_u) return unauthorized()
  if (!(await can(_u, 'iptv', 'view'))) return forbidden()
  try {
    const playlists = await db.iptvPlaylist.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { channels: true } } },
    })
    const totalChannels = await db.iptvChannel.count()
    return NextResponse.json({ playlists, totalChannels })
  } catch (e) {
    console.error('GET /api/iptv/playlists error:', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

/** Récupère le contenu brut d'une source M3U */
async function fetchContent(sourceType: string, url: string | null | undefined, content?: string): Promise<string> {
  if (sourceType === 'paste') {
    return content ?? ''
  }
  if (!url || !/^https?:\/\//i.test(url)) throw new Error('URL invalide')
  const res = await fetch(url, {
    headers: { 'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20', Accept: '*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`Source inaccessible (HTTP ${res.status})`)
  return await res.text()
}

export async function POST(req: NextRequest) {
  const _u = await getSessionUser(req)
  if (!_u) return unauthorized()
  if (!(await can(_u, 'iptv', 'create'))) return forbidden()
  try {
    const body = await req.json()
    const name: string = (body.name || '').trim()
    const sourceType: string = body.sourceType || 'url'
    const url: string | null = (body.url || '').trim() || null
    const content: string | undefined = body.content

    if (!name) return NextResponse.json({ error: 'Le nom est requis' }, { status: 400 })
    if (sourceType === 'url' && !url)
      return NextResponse.json({ error: "L'URL de la playlist est requise" }, { status: 400 })
    if (sourceType !== 'url' && (!content || !content.trim()))
      return NextResponse.json({ error: 'Aucun contenu M3U fourni' }, { status: 400 })

    let raw = ''
    try {
      raw = await fetchContent(sourceType, url, content)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Téléchargement impossible'
      return NextResponse.json({ error: `Échec du téléchargement : ${msg}` }, { status: 400 })
    }

    const parsed = parseM3U(raw)
    if (parsed.length === 0)
      return NextResponse.json({ error: 'Aucune chaîne détectée dans ce fichier M3U' }, { status: 400 })

    const kept = parsed.slice(0, MAX_CHANNELS)

    const playlist = await db.iptvPlaylist.create({
      data: {
        name,
        sourceType,
        url,
        status: 'ok',
        channelCount: kept.length,
        channels: { create: kept },
      },
      include: { _count: { select: { channels: true } } },
    })

    return NextResponse.json({ playlist, imported: kept.length }, { status: 201 })
  } catch (e) {
    console.error('POST /api/iptv/playlists error:', e)
    return NextResponse.json({ error: "Erreur lors de l'import" }, { status: 500 })
  }
}
