// ============================================================
// Pool de connexions IPTV — comptabilisation préventive + mode strict
// ------------------------------------------------------------
// Répond à la contrainte « 1 compte / N connexions simultanées » :
//   * 1 connexion fournisseur = 1 flux = 1 chaîne (limite physique).
//   * Une chaîne déjà diffusée via un hub est rejouable sur N écrans
//     sans consommer de connexion supplémentaire (partage serveur).
//   * Pour diffuser PLUSIEURS CHAÎNES DIFFÉRENTES en même temps, il faut
//     autant de « slots » de connexion (pack multi-connexions du compte
//     ou comptes supplémentaires). Le pool répartit automatiquement les
//     nouvelles chaînes sur les comptes disposant encore de capacité,
//     et le mode strict interdit de dépasser les quotas déclarés
//     (protège contre les blocages / bannisements du portail).
// ============================================================

import { db } from '@/lib/db'
import { listHubs, type HubInfo } from '@/lib/stream-hub'

const STRICT_KEY = 'iptv.strictConnections'

/**
 * Normalisation d'URL pour les rapprochements hub ↔ chaîne : Bun réécrit
 * 127.0.0.1 → localhost dans les URLs de requête, il faut donc aligner les
 * deux formes avant toute comparaison (sinon le pool ne retrouve pas ses
 * chaînes et les quotas ne sont jamais décomptés).
 */
function normUrl(u: string): string {
  try {
    const x = new URL(u)
    const host = x.hostname === '127.0.0.1' ? 'localhost' : x.hostname
    return `${x.protocol}//${host}${x.port ? ':' + x.port : ''}${x.pathname}${x.search}`
  } catch {
    return u
  }
}

/**
 * Variantes d'une URL pour la recherche en base : les chaînes peuvent être
 * stockées avec 127.0.0.1 ou localhost (Bun réécrit la forme des requêtes).
 */
function urlVariants(u: string): string[] {
  const n = normUrl(u)
  const swapped = n.replace('//localhost:', '//127.0.0.1:')
  return [...new Set([u, n, swapped])]
}

export interface ProviderPoolEntry {
  providerId: string
  name: string
  max: number // 0 = illimité / inconnu
  used: number // hubs actifs (slot réellement consommé)
  starting: number // hubs en cours de connexion (réservations)
  available: number // -1 = illimité
}

export interface PoolSnapshot {
  strict: boolean
  total: { used: number; max: number; unlimited: boolean }
  providers: ProviderPoolEntry[]
}

// ---------- Mode strict (réglage persistant) ----------

export async function getStrict(): Promise<boolean> {
  try {
    const row = await db.setting.findUnique({ where: { key: STRICT_KEY } })
    return row?.value === '1'
  } catch {
    return false
  }
}

export async function setStrict(value: boolean): Promise<void> {
  await db.setting.upsert({
    where: { key: STRICT_KEY },
    update: { value: value ? '1' : '0' },
    create: { key: STRICT_KEY, value: value ? '1' : '0' },
  })
}

// ---------- Réservations synchrones (anti-course) ----------
// Entre le moment où le proxy décide d'ouvrir une connexion et celui où le
// hub est visible, deux demandes simultanées pourraient dépasser le quota.
// La réservation est synchronique : elle compte jusqu'à ce que le hub soit
// enregistré (materialisé), puis c'est le hub lui-même qui est compté.

interface Reservation {
  providerId: string
  materialized: boolean
}

const reservations = new Map<string, Reservation>()
let reservationSeq = 0

export function reserveSlot(providerId: string): string {
  const token = `res-${++reservationSeq}`
  reservations.set(token, { providerId, materialized: false })
  return token
}

export function materializeSlot(token: string): void {
  const r = reservations.get(token)
  if (r) r.materialized = true
}

export function releaseSlot(token: string): void {
  reservations.delete(token)
}

function reservedCount(providerId: string): number {
  let n = 0
  for (const r of reservations.values()) {
    if (r.providerId === providerId && !r.materialized) n++
  }
  return n
}

// ---------- Usage par fournisseur ----------

async function loadChannelsForUrls(urls: string[]) {
  if (!urls.length) return []
  const variants = [...new Set(urls.flatMap((u) => urlVariants(u)))].slice(0, 800)
  return db.iptvChannel.findMany({
    where: { url: { in: variants } },
    select: { url: true, providerId: true },
    take: 400,
  })
}

async function loadProviders() {
  return db.iptvProvider.findMany({
    select: { id: true, name: true, maxConnections: true },
    orderBy: { createdAt: 'asc' },
    take: 100,
  })
}

function mapHubsToProviders(hubs: HubInfo[], urlToProvider: Map<string, string | null>) {
  // used : slot effectivement consommé (source effective, sinon URL demandée)
  // starting : hub en cours de connexion rattaché à son compte d'origine
  const used = new Map<string, number>()
  const starting = new Map<string, number>()
  for (const h of hubs) {
    const eff = normUrl(h.source || h.url)
    const effPid = urlToProvider.get(eff) ?? urlToProvider.get(normUrl(h.url)) ?? ''
    if (h.connecting && !h.source) {
      const pid = urlToProvider.get(normUrl(h.url)) ?? ''
      if (pid) starting.set(pid, (starting.get(pid) ?? 0) + 1)
      continue
    }
    if (effPid) used.set(effPid, (used.get(effPid) ?? 0) + 1)
  }
  return { used, starting }
}

/** Snapshot du pool pour l'API / UI : usage en direct, quotas, slots libres. */
export async function computePool(): Promise<PoolSnapshot> {
  const [hubs, providers] = await Promise.all([Promise.resolve(listHubs()), loadProviders()])
  const urlMaps = await loadChannelsForUrls(hubs.flatMap((h) => [h.url, h.source]))
  const urlToProvider = new Map(urlMaps.map((c) => [normUrl(c.url), c.providerId]))
  const { used, starting } = mapHubsToProviders(hubs, urlToProvider)

  let totalUsed = 0
  let totalMax = 0
  let unlimited = false
  const entries: ProviderPoolEntry[] = providers.map((p) => {
    const u = (used.get(p.id) ?? 0) + reservedCount(p.id)
    const max = p.maxConnections ?? 0
    totalUsed += u
    if (max > 0) totalMax += max
    else unlimited = true
    return {
      providerId: p.id,
      name: p.name,
      max,
      used: u,
      starting: starting.get(p.id) ?? 0,
      available: max > 0 ? Math.max(0, max - u) : -1,
    }
  })

  return { strict: await getStrict(), total: { used: totalUsed, max: totalMax, unlimited }, providers: entries }
}

// ---------- Planification des sources pour une nouvelle connexion ----------

export interface SourcePlan {
  ok: boolean
  sources: string[]
  reserveProviderId: string | null
  reason?: string
}

interface ProviderInfo {
  id: string
  name: string
  maxConnections: number
}

async function usageForPlanning(): Promise<{
  urlToProvider: Map<string, string | null>
  providers: ProviderInfo[]
  hubs: HubInfo[]
}> {
  const hubs = listHubs()
  const [channels, providers] = await Promise.all([
    loadChannelsForUrls(hubs.flatMap((h) => [h.url, h.source])),
    loadProviders(),
  ])
  return {
    hubs,
    providers,
    urlToProvider: new Map(channels.map((c) => [normUrl(c.url), c.providerId])),
  }
}

function countUsedFor(
  providerId: string,
  hubs: HubInfo[],
  urlToProvider: Map<string, string | null>
): number {
  let n = reservedCount(providerId)
  for (const h of hubs) {
    if (h.connecting && !h.source) {
      if ((urlToProvider.get(normUrl(h.url)) ?? '') === providerId) n++
      continue
    }
    const eff = normUrl(h.source || h.url)
    if ((urlToProvider.get(eff) ?? urlToProvider.get(normUrl(h.url)) ?? '') === providerId) n++
  }
  return n
}

function capacityOf(p: ProviderInfo, used: number): number {
  return p.maxConnections > 0 ? p.maxConnections - used : Number.POSITIVE_INFINITY
}

/**
 * Planifie l'ordre des sources amont pour UNE nouvelle connexion (mode=live).
 *  1. Le compte d'origine s'il reste de la capacité (ou quota inconnu) ;
 *  2. Les mêmes chaînes (nom / tvg-id) chez les autres comptes, comptes
 *     triés par capacité décroissante ;
 *  3. En dernier recours les sources à capacité épuisée (le portail dira
 *     peut-être oui malgré le quota déclaré).
 * Mode strict : si aucune source n'a de capacité réelle, la connexion est
 * refusée sans même solliciter le portail (ok:false + raison claire).
 */
export async function planLiveSources(channelId: string, originUrl: string): Promise<SourcePlan> {
  const empty: SourcePlan = { ok: true, sources: [originUrl], reserveProviderId: null }
  if (!channelId) return empty

  let channel: { name: string; tvgId: string | null; providerId: string | null; url: string } | null = null
  try {
    channel = await db.iptvChannel.findUnique({
      where: { id: channelId },
      select: { name: true, tvgId: true, providerId: true, url: true },
    })
  } catch {
    return empty
  }
  if (!channel) return empty

  const { hubs, providers, urlToProvider } = await usageForPlanning()
  const byId = new Map(providers.map((p) => [p.id, p]))
  const origin = channel.providerId ? byId.get(channel.providerId) : undefined

  const usageOf = (p: ProviderInfo | undefined) => (p ? countUsedFor(p.id, hubs, urlToProvider) : 0)
  const capOf = (p: ProviderInfo | undefined) => (p ? capacityOf(p, usageOf(p)) : Number.POSITIVE_INFINITY)

  const originCap = capOf(origin)

  // Chaînes de secours (même nom / même tvg-id) chez d'autres comptes
  const alts: { url: string; providerId: string | null }[] = []
  try {
    const or: { name?: string; tvgId?: string }[] = [{ name: channel.name }]
    if (channel.tvgId) or.push({ tvgId: channel.tvgId })
    const candidates = await db.iptvChannel.findMany({
      where: {
        OR: or,
        id: { not: channelId },
        url: { not: originUrl },
        kind: { in: ['live', 'playlist'] },
      },
      orderBy: { createdAt: 'asc' },
      take: 6,
      select: { url: true, providerId: true },
    })
    alts.push(...candidates)
  } catch {
    /* pas de secours */
  }

  // Trier les secours : capacité décroissante, puis ordre de création
  const altWithCap = alts
    .map((a) => ({ ...a, cap: a.providerId ? capOf(byId.get(a.providerId)) : Number.POSITIVE_INFINITY }))
    .sort((x, y) => y.cap - x.cap)

  const withCap = altWithCap.filter((a) => a.cap > 0)
  const withoutCap = altWithCap.filter((a) => a.cap <= 0)

  const sources: string[] = []
  if (originCap > 0) sources.push(originUrl)
  for (const a of withCap) sources.push(a.url)
  if (originCap <= 0) sources.push(originUrl)
  for (const a of withoutCap) sources.push(a.url)

  // Re-vérification SYNCHRONIQUE : hubs et réservations ont pu changer pendant
  // les lectures DB — protège la fenêtre « planification → création du hub ».
  const freshHubs = listHubs()
  const originCapFresh = origin ? capacityOf(origin, countUsedFor(origin.id, freshHubs, urlToProvider)) : Number.POSITIVE_INFINITY
  const withCapFresh = withCap.filter(
    (a) => !a.providerId || capacityOf(byId.get(a.providerId) ?? { id: '', name: '', maxConnections: 0 }, countUsedFor(a.providerId, freshHubs, urlToProvider)) > 0
  )
  const strictNow = await getStrict()
  if (strictNow && originCapFresh <= 0 && withCapFresh.length === 0) {
    const name = origin?.name ?? 'ce compte'
    const max = origin?.maxConnections ?? 0
    return {
      ok: false,
      sources: [],
      reserveProviderId: null,
      reason:
        `Quota de connexions atteint : ${name} autorise ${max} connexion(s) simultanée(s), ` +
        `toutes occupées. Le mode strict interdit de dépasser ce quota. ` +
        `Options : diffuser la même chaîne (partagée) sur tous les écrans, attendre la libération ` +
        `d'un slot, souscrire un pack multi-connexions ou ajouter un compte au pool.`,
    }
  }

  // Réservation anti-course sur le compte de la première source
  const firstUrl = sources[0] ?? originUrl
  const firstPid =
    normUrl(firstUrl) === normUrl(originUrl)
      ? (channel.providerId ?? null)
      : (altWithCap.find((a) => normUrl(a.url) === normUrl(firstUrl))?.providerId ?? channel.providerId ?? null)

  return { ok: true, sources, reserveProviderId: firstPid }
}
