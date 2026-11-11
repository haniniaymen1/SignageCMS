import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, unauthorized } from '@/lib/auth'
import { can, forbidden } from '@/lib/permissions'
import { cacheStats, findHub, listHubs, startHub, stopHub } from '@/lib/stream-hub'
import { computePool, getStrict, planLiveSources, materializeSlot, releaseSlot, reserveSlot, setStrict } from '@/lib/connection-pool'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const UA = 'VLC/3.0.20 LibVLC/3.0.20'

/**
 * GET — connexions IPTV actives côté serveur CMS, en temps réel + état du POOL.
 * Montre le partage de flux : pour chaque chaîne diffusée, le nombre
 * d'écrans qui partagent la MÊME connexion fournisseur (viewers),
 * le compte utilisé (et si une bascule de secours est active), et
 * l'état TIMESHIFT (enregistrement, durée du tampon, écrans décalés).
 * `pool` : par compte, les connexions utilisées vs le quota déclaré
 * (maxConnections) et les slots restants — c'est ce que le serveur utilise
 * pour répartir automatiquement les chaînes différentes sur les comptes.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return unauthorized()
  if (!(await can(user, 'iptv', 'view'))) return forbidden()
  try {
    const hubs = listHubs()
    const urls = [...new Set(hubs.map((h) => h.source || h.url).filter(Boolean))]
    const channels = urls.length
      ? await db.iptvChannel.findMany({
          where: { url: { in: urls } },
          select: { url: true, name: true, providerId: true },
          take: 200,
        })
      : []
    const byUrl = new Map(channels.map((c) => [c.url, c]))
    const providerIds = [...new Set(channels.map((c) => c.providerId).filter((v): v is string => !!v))]
    const providers = providerIds.length
      ? await db.iptvProvider.findMany({
          where: { id: { in: providerIds } },
          select: { id: true, name: true, maxConnections: true },
        })
      : []
    const byId = new Map(providers.map((p) => [p.id, p]))

    const pool = await computePool()

    return NextResponse.json({
      hubs: hubs.map((h) => {
        const chan = byUrl.get(h.source || h.url)
        const prov = chan?.providerId ? byId.get(chan.providerId) : undefined
        return {
          url: h.url,
          source: h.source,
          channel: chan?.name ?? null,
          provider: prov?.name ?? null,
          providerMax: prov?.maxConnections ?? 0,
          viewers: h.viewers,
          bytes: h.bytes,
          startedAt: h.startedAt,
          reconnects: h.reconnects,
          connecting: h.connecting,
          upstreamStatus: h.upstreamStatus ?? 0,
          failover: h.sourceIndex > 0,
          // Timeshift
          recording: h.recording ?? false,
          bufferedSeconds: h.bufferedSeconds ?? 0,
          bufferedBytes: h.bufferedBytes ?? 0,
          delayedViewers: h.delayedViewers ?? 0,
          recordPersist: h.recordPersist ?? false,
        }
      }),
      cache: cacheStats(),
      pool,
    })
  } catch (e) {
    console.error('GET /api/iptv/connections error:', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

/**
 * POST — actions sur les flux actifs :
 *  - { url }                          → coupe manuellement le flux (libère la connexion fournisseur) ;
 *  - { url, timeshift: 'on', ch? }    → DÉMARRE l'enregistrement timeshift (hub dédié maintenu
 *                                       ouvert même sans écran — le tampon disque grossit) ;
 *  - { url, timeshift: 'off' }        → arrête l'enregistrement (refusé si des écrans décalés
 *                                       sont actifs) ; ferme le hub s'il n'a plus d'écran.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return unauthorized()
  if (!(await can(user, 'iptv', 'create'))) return forbidden()
  const body = (await req.json().catch(() => ({}))) as { url?: string; timeshift?: string; ch?: string }
  const url = String(body.url || '')
  if (!url) return NextResponse.json({ error: 'URL manquante' }, { status: 400 })
  const ts = String(body.timeshift || '')

  // Démarrer l'enregistrement timeshift
  if (ts === 'on') {
    let hub = findHub(url)
    if (!hub) {
      const plan = await planLiveSources(String(body.ch || ''), url)
      if (!plan.ok) {
        return NextResponse.json({ error: plan.reason }, { status: 429 })
      }
      const token = plan.reserveProviderId ? reserveSlot(plan.reserveProviderId) : null
      hub = startHub(
        url,
        { 'User-Agent': UA, Accept: '*/*' },
        async () => plan.sources,
        token ? () => releaseSlot(token) : undefined,
        { timeshift: true, recordPersist: true }
      )
      if (token) materializeSlot(token)
    } else {
      hub.enableTimeshift()
      hub.recordPersist = true
    }
    const ready = await hub.waitForSource(15000)
    if (!ready.ok) {
      hub.close('source inaccessible')
      return NextResponse.json({ error: 'Flux inaccessible — enregistrement impossible' }, { status: 502 })
    }
    return NextResponse.json({ ok: true, hub: { url: hub.url, recording: hub.recording, bufferedSeconds: hub.info().bufferedSeconds } })
  }

  // Arrêter l'enregistrement timeshift
  if (ts === 'off') {
    const hub = findHub(url)
    if (!hub) return NextResponse.json({ error: 'Aucun flux actif pour cette URL' }, { status: 404 })
    if (hub.delayedViewers > 0) {
      return NextResponse.json(
        { error: 'Des écrans en rediffusion décalée sont actifs — arrêtez-les avant de stopper l’enregistrement' },
        { status: 400 }
      )
    }
    hub.disableTimeshift()
    return NextResponse.json({ ok: true })
  }

  const ok = stopHub(url)
  return NextResponse.json({ ok })
}

/** PUT { strict } — active/désactive le mode strict du pool de connexions. */
export async function PUT(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return unauthorized()
  if (!(await can(user, 'iptv', 'update'))) return forbidden()
  const body = (await req.json().catch(() => ({}))) as { strict?: boolean }
  try {
    await setStrict(Boolean(body.strict))
    return NextResponse.json({ ok: true, strict: await getStrict() })
  } catch (e) {
    console.error('PUT /api/iptv/connections error:', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
