import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { xtreamRequest, buildStreamUrl, type XtreamEpisode } from '@/lib/xtream'
import { getSessionUser, unauthorized } from '@/lib/auth'
import { can, forbidden } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

interface SeriesInfoResponse {
  info?: Record<string, unknown>
  episodes?: Record<string, XtreamEpisode[]>
  seasons?: Array<Record<string, unknown>>
}

/**
 * GET /api/iptv/xtream/series-info?seriesId=123&providerId=...
 * Renvoie les saisons/épisodes d'une série Xtream avec leurs URLs de streaming.
 * Multi-comptes : providerId ciblé, sinon le plus ancien.
 */
export async function GET(req: NextRequest) {
  const _u = await getSessionUser(req)
  if (!_u) return unauthorized()
  if (!(await can(_u, 'iptv', 'view'))) return forbidden()
  try {
    const seriesId = req.nextUrl.searchParams.get('seriesId')
    if (!seriesId) return NextResponse.json({ error: 'seriesId requis' }, { status: 400 })

    const providerId = req.nextUrl.searchParams.get('providerId')?.trim()
    const provider = providerId
      ? await db.iptvProvider.findUnique({ where: { id: providerId } })
      : await db.iptvProvider.findFirst({ orderBy: { createdAt: 'asc' } })
    if (!provider) return NextResponse.json({ error: 'Aucun portail Xtream connecté' }, { status: 400 })

    const data = await xtreamRequest<SeriesInfoResponse>(
      provider.host,
      provider.username,
      provider.password,
      'get_series_info',
      { series_id: seriesId },
      45000
    )

    const seasons: Array<{ season: number; episodes: unknown[] }> = []
    const epMap = data.episodes || {}
    const seasonKeys = Object.keys(epMap).sort((a, b) => Number(a) - Number(b))

    for (const key of seasonKeys) {
      const eps = Array.isArray(epMap[key]) ? epMap[key] : []
      const mapped = eps.map((ep) => ({
        id: String(ep.id),
        episodeNum: Number(ep.episode_num) || 0,
        title: (ep.title || `Épisode ${ep.episode_num}`).toString(),
        containerExt: (ep.container_extension || 'mp4').toString().replace(/[^a-z0-9]/gi, '') || 'mp4',
        image: (ep.info?.movie_image as string | undefined) || null,
        plot: (ep.info?.plot as string | undefined) || null,
        duration: (ep.info?.duration as string | undefined) || null,
        url: buildStreamUrl(provider.host, provider.username, provider.password, 'series', ep.id, (ep.container_extension || 'mp4').toString()),
      }))
      seasons.push({ season: Number(key), episodes: mapped })
    }

    return NextResponse.json({
      name: (data.info?.name as string) || null,
      cover: (data.info?.cover as string) || null,
      plot: (data.info?.plot as string) || null,
      genre: (data.info?.genre as string) || null,
      seasons,
    })
  } catch (e) {
    console.error('GET /api/iptv/xtream/series-info error:', e)
    const msg = e instanceof Error ? e.message : 'Erreur serveur'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
