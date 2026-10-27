import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  xtreamRequest,
  buildStreamUrl,
  buildM3UUrl,
  xtreamStreamId,
  type XtreamCategory,
  type XtreamLiveStream,
  type XtreamVodStream,
  type XtreamSeries,
} from '@/lib/xtream'
import { getSessionUser, unauthorized } from '@/lib/auth'
import { can, forbidden } from '@/lib/permissions'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const LIMIT_PER_TYPE = parseInt(process.env.IPTV_MAX_PER_TYPE || '50000', 10)
const CHUNK = 400

// Les gros portails (3000+ chaînes) peuvent mettre plusieurs minutes à générer
// get_live_streams / get_vod_streams / get_series — timeout large + 1 reprise.
const LIST_TIMEOUT_MS = 280000

async function fetchListWithRetry<T>(
  host: string,
  username: string,
  password: string,
  action: string
): Promise<T> {
  try {
    return await xtreamRequest<T>(host, username, password, action, undefined, LIST_TIMEOUT_MS)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!/délai|timeout|ne répond pas/i.test(msg)) throw e
    // reprise unique : le portail recalculait sa liste, on retente une fois
    return await xtreamRequest<T>(host, username, password, action, undefined, LIST_TIMEOUT_MS)
  }
}

function catNameMap(cats: XtreamCategory[] | null): Map<string, string> {
  const m = new Map<string, string>()
  for (const c of cats || []) m.set(String(c.id), c.name || 'Divers')
  return m
}

async function insertChunks<T>(rows: T[], fn: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await fn(rows.slice(i, i + CHUNK))
  }
}

export async function POST(req: NextRequest) {
  const _u = await getSessionUser(req)
  if (!_u) return unauthorized()
  if (!(await can(_u, 'iptv', 'update'))) return forbidden()
  try {
    const body = await req.json()
    const type: string = body.type || 'all' // live | vod | series | all

    // Multi-comptes : compte ciblé par providerId, sinon le plus ancien (premier ajouté)
    const provider = body.providerId
      ? await db.iptvProvider.findUnique({ where: { id: String(body.providerId) } })
      : await db.iptvProvider.findFirst({ orderBy: { createdAt: 'asc' } })
    if (!provider) return NextResponse.json({ error: 'Aucun portail Xtream connecté' }, { status: 400 })

    const { host, username, password } = provider
    const result = { live: 0, vod: 0, series: 0, m3uUrl: buildM3UUrl(host, username, password) }

    const doLive = type === 'live' || type === 'all'
    const doVod = type === 'vod' || type === 'all'
    const doSeries = type === 'series' || type === 'all'

    // ===== LIVE =====
    if (doLive) {
      const [cats, streams] = await Promise.all([
        xtreamRequest<XtreamCategory[]>(host, username, password, 'get_live_categories', undefined, 30000),
        fetchListWithRetry<XtreamLiveStream[]>(host, username, password, 'get_live_streams'),
      ])
      const catsMap = catNameMap(cats)
      const list = Array.isArray(streams) ? streams.slice(0, LIMIT_PER_TYPE) : []
      const rows = list
        .map((s) => {
          const sid = xtreamStreamId(s)
          if (!sid) return null // pas d'identifiant valide → écarté (jamais d'URL undefined)
          const ext = 'm3u8'
          return {
            providerId: provider.id,
            name: (s.stream_name || s.name || `Flux ${sid}`).toString().trim(),
            url: buildStreamUrl(host, username, password, 'live', sid, ext),
            logo: (s.stream_icon || '').toString() || null,
            group: catsMap.get(String(s.category_id)) || 'Divers',
            kind: 'live',
            streamId: sid,
            containerExt: ext,
          }
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
      await db.iptvChannel.deleteMany({ where: { kind: 'live', providerId: provider.id } })
      await insertChunks(rows, (chunk) => db.iptvChannel.createMany({ data: chunk }))
      result.live = rows.length
    }

    // ===== VOD =====
    if (doVod) {
      const [cats, streams] = await Promise.all([
        xtreamRequest<XtreamCategory[]>(host, username, password, 'get_vod_categories', undefined, 30000),
        fetchListWithRetry<XtreamVodStream[]>(host, username, password, 'get_vod_streams'),
      ])
      const catsMap = catNameMap(cats)
      const list = Array.isArray(streams) ? streams.slice(0, LIMIT_PER_TYPE) : []
      const rows = list
        .map((s) => {
          const sid = xtreamStreamId(s)
          if (!sid) return null
          const ext = (s.container_extension || 'mp4').toString().replace(/[^a-z0-9]/gi, '') || 'mp4'
          return {
            providerId: provider.id,
            name: (s.name || s.stream_name || `Vidéo ${sid}`).toString().trim(),
            url: buildStreamUrl(host, username, password, 'vod', sid, ext),
            logo: (s.stream_icon || '').toString() || null,
            group: catsMap.get(String(s.category_id)) || 'Divers',
            kind: 'vod',
            streamId: sid,
            containerExt: ext,
          }
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
      await db.iptvChannel.deleteMany({ where: { kind: 'vod', providerId: provider.id } })
      await insertChunks(rows, (chunk) => db.iptvChannel.createMany({ data: chunk }))
      result.vod = rows.length
    }

    // ===== SÉRIES =====
    if (doSeries) {
      const [cats, series] = await Promise.all([
        xtreamRequest<XtreamCategory[]>(host, username, password, 'get_series_categories', undefined, 30000),
        fetchListWithRetry<XtreamSeries[]>(host, username, password, 'get_series'),
      ])
      const catsMap = catNameMap(cats)
      const list = Array.isArray(series) ? series.slice(0, LIMIT_PER_TYPE) : []
      const rows = list
        .map((s) => {
          const sid = xtreamStreamId(s)
          if (!sid) return null
          return {
            providerId: provider.id,
            name: (s.name || `Série ${sid}`).toString().trim(),
            url: '', // résolu par épisode via get_series_info
            logo: (s.cover || '').toString() || null,
            group: catsMap.get(String(s.category_id)) || 'Divers',
            kind: 'series',
            streamId: sid,
            containerExt: null,
          }
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
      await db.iptvChannel.deleteMany({ where: { kind: 'series', providerId: provider.id } })
      await insertChunks(rows, (chunk) => db.iptvChannel.createMany({ data: chunk }))
      result.series = rows.length
    }

    const updated = await db.iptvProvider.update({
      where: { id: provider.id },
      data: {
        lastSyncAt: new Date(),
        liveCount: doLive ? result.live : undefined,
        vodCount: doVod ? result.vod : undefined,
        seriesCount: doSeries ? result.series : undefined,
        status: 'connected',
        lastError: null,
      },
    })

    // Compteurs réels de CE compte (scopés par providerId)
    const [live, vod, series] = await Promise.all([
      db.iptvChannel.count({ where: { kind: 'live', providerId: provider.id } }),
      db.iptvChannel.count({ where: { kind: 'vod', providerId: provider.id } }),
      db.iptvChannel.count({ where: { kind: 'series', providerId: provider.id } }),
    ])
    await db.iptvProvider.update({
      where: { id: provider.id },
      data: { liveCount: live, vodCount: vod, seriesCount: series },
    })

    return NextResponse.json({
      imported: result,
      provider: { ...updated, liveCount: live, vodCount: vod, seriesCount: series, password: '••••••••', rawInfo: undefined },
    })
  } catch (e) {
    console.error('POST /api/iptv/xtream/sync error:', e)
    const msg = e instanceof Error ? e.message : 'Synchronisation impossible'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
