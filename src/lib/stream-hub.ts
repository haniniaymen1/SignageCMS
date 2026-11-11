// ============================================================
// Partage de connexions IPTV côté serveur CMS
// ------------------------------------------------------------
// Objectif : réduire le nombre de connexions consommées chez le
// fournisseur IPTV quand plusieurs écrans diffusent une chaîne :
//   - Même chaîne HLS (m3u8) sur N écrans → 1 seul fetch amont par
//     segment et par playlist (cache TTL + déduplication simultanée).
//   - Même chaîne TS/FLV continue sur N écrans → UNE SEULE connexion
//     amont (StreamHub : le serveur récupère le flux une fois et le
//     redistribue en direct à tous les lecteurs).
//   - Chaînes DIFFÉRENTES = 1 connexion chacune (limite physique :
//     1 flux = 1 connexion chez le fournisseur), avec bascule
//     automatique sur un compte de secours si le portail refuse.
//   - TIMESHIFT : le hub peut ENREGISTRER le flux sur disque (tampon
//     rotatif) et le rediffuser avec un décalage (ex. +1 min) sur
//     N écrans — toujours avec la SEULE connexion amont de l'historique.
// ============================================================

const UA = 'VLC/3.0.20 LibVLC/3.0.20'

// ---------- Cache HTTP (segments HLS, clés AES, playlists) ----------
interface CacheEntry {
  status: number
  headers: Record<string, string>
  body: Uint8Array
  bytes: number
  expiresAt: number
  /** URL finale après redirections (portails qui délèguent les flux à un CDN) */
  finalUrl?: string
}

const MAX_CACHE_BYTES = 256 * 1024 * 1024 // budget mémoire 256 Mo
const MAX_ENTRY_BYTES = 64 * 1024 * 1024 // une entrée > 64 Mo est servie mais pas mise en cache
const DEFAULT_TTL_MS = 20000 // durée de partage d'un segment
const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<CacheEntry | null>>()
let statsHits = 0
let statsMisses = 0
let statsSaved = 0 // requêtes amont évitées (partage entre écrans)
let cacheBytes = 0

export interface CacheStats {
  entries: number
  bytes: number
  hits: number
  misses: number
  saved: number
}

export function cacheStats(): CacheStats {
  return { entries: cache.size, bytes: cacheBytes, hits: statsHits, misses: statsMisses, saved: statsSaved }
}

function evict() {
  while (cacheBytes > MAX_CACHE_BYTES) {
    const oldest = cache.keys().next().value as string | undefined
    if (oldest === undefined) break
    const e = cache.get(oldest)
    if (e) cacheBytes -= e.bytes
    cache.delete(oldest)
  }
}

export interface CachedResult {
  entry: CacheEntry | null
  fromCache: boolean
}

export interface CachedFetchOpts {
  headers?: Record<string, string>
  timeoutMs?: number
  ttlMs?: number
  statusRef?: { current: number } // renseigné avec le code HTTP du portail sur échec
}

/**
 * GET amont mis en cache (TTL) avec déduplication des requêtes simultanées :
 * si 4 écrans demandent le même segment en même temps, un seul fetch part
 * chez le fournisseur et les 4 reçoivent les mêmes octets.
 */
export async function cachedFetch(url: string, opts: CachedFetchOpts = {}): Promise<CachedResult> {
  const hit = cache.get(url)
  if (hit) {
    if (hit.expiresAt > Date.now()) {
      statsHits++
      return { entry: hit, fromCache: true }
    }
    cache.delete(url)
    cacheBytes -= hit.bytes
  }
  const running = inflight.get(url)
  if (running) {
    statsSaved++
    return running.then((entry) => ({ entry, fromCache: false }))
  }
  const promise = (async (): Promise<CacheEntry | null> => {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: '*/*', ...(opts.headers ?? {}) },
        redirect: 'follow',
        cache: 'no-store',
        signal: AbortSignal.timeout(opts.timeoutMs ?? 20000),
      })
      if (!res.ok) {
        if (opts.statusRef) opts.statusRef.current = res.status
        return null
      }
      const body = new Uint8Array(await res.arrayBuffer())
      // Trop volumineux (VOD) : servi sans mise en cache pour préserver la mémoire
      if (body.byteLength > MAX_ENTRY_BYTES) return {
        status: res.status,
        headers: { 'content-type': res.headers.get('content-type') || 'application/octet-stream' },
        body,
        bytes: body.byteLength,
        expiresAt: 0,
        finalUrl: res.url || undefined,
      }
      const entry: CacheEntry = {
        status: res.status,
        headers: { 'content-type': res.headers.get('content-type') || 'application/octet-stream' },
        body,
        bytes: body.byteLength,
        expiresAt: Date.now() + (opts.ttlMs ?? DEFAULT_TTL_MS),
        finalUrl: res.url || undefined,
      }
      cache.set(url, entry)
      cacheBytes += entry.bytes
      evict()
      statsMisses++
      return entry
    } catch {
      return null
    } finally {
      setTimeout(() => inflight.delete(url), 0)
    }
  })()
  inflight.set(url, promise)
  return promise.then((entry) => ({ entry, fromCache: false }))
}

// ---------- StreamHub : 1 connexion amont → N écrans (flux continus) ----------

// Connexion amont via node:http(s) : destruction déterministe du socket
// (AbortController de fetch ne ferme pas toujours la connexion sous Bun).
import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// ============================================================
// TIMESHIFT — enregistrement disque rotatif + rediffusion décalée
// ------------------------------------------------------------
// Le hub écrit les octets diffusés dans un tampon disque (fichiers
// de 32 Mo, purge par durée/taille) : N écrans peuvent regarder la
// MÊME chaîne avec un décalage (ex. +1 min) sans consommer de
// connexion fournisseur supplémentaire — l'enregistrement reste la
// SEULE connexion amont. Chaque octet est indexé {offset, instant} :
// un écran décalé de D secondes ne reçoit un bloc que D secondes
// après sa diffusion (rythme temps réel naturel).
// ============================================================

const ROTATE_BYTES = 32 * 1024 * 1024 // rotation des fichiers tampon
const RETENTION_MS = Math.max(60_000, (parseInt(process.env.TIMESHIFT_RETENTION_MIN || '12', 10) || 12) * 60_000)
const RETENTION_BYTES = Math.max(
  64 * 1024 * 1024,
  (parseInt(process.env.TIMESHIFT_RETENTION_MB || '300', 10) || 300) * 1024 * 1024
)

interface ShiftEntry {
  g0: number // offset global de début
  g1: number // offset global de fin
  t: number // instant de diffusion (ms epoch)
  f: number // n° de fichier
  fo: number // offset dans le fichier
}

function sleepMs(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve()
  return new Promise((r) => {
    const t = setTimeout(done, ms)
    function done() {
      clearTimeout(t)
      signal?.removeEventListener('abort', done)
      r()
    }
    signal?.addEventListener('abort', done, { once: true })
  })
}

/** Tampon disque rotatif d'un hub (enregistrement + lectures décalées). */
class DiskBuffer {
  dir = path.join(os.tmpdir(), 'cms-timeshift')
  head = 0
  fileBytes = 0
  seq = 0
  entries: ShiftEntry[] = []
  private writer: fs.WriteStream | null = null
  private fds = new Map<number, fs.promises.FileHandle>()

  constructor(readonly id: string) {
    try {
      fs.mkdirSync(this.dir, { recursive: true })
    } catch {
      /* noop */
    }
    this.open()
  }

  private filePath(seq: number): string {
    return path.join(this.dir, `${this.id}-${seq}.tsdata`)
  }

  private open() {
    this.writer = fs.createWriteStream(this.filePath(this.seq), { flags: 'a' })
    this.writer.on('error', () => {
      /* disque plein / fichier supprimé : l'écriture s'arrête silencieusement */
    })
  }

  get active(): boolean {
    return !!this.writer
  }

  append(data: Uint8Array) {
    if (!this.writer) return
    const g0 = this.head
    try {
      this.writer.write(Buffer.from(data))
    } catch {
      return
    }
    this.entries.push({ g0, g1: g0 + data.length, t: Date.now(), f: this.seq, fo: this.fileBytes })
    this.head = g0 + data.length
    this.fileBytes += data.length
    if (this.fileBytes >= ROTATE_BYTES) {
      try {
        this.writer.end()
      } catch {
        /* noop */
      }
      this.seq++
      this.fileBytes = 0
      this.open()
    }
  }

  /** True si le tampon couvre `delayMs` de direct (écran décalé démarrable). */
  covers(delayMs: number): boolean {
    const first = this.entries[0]
    return !!first && first.t <= Date.now() - delayMs
  }

  /** Durée enregistrée (s) et octets enregistrés. */
  stats(): { seconds: number; bytes: number } {
    const first = this.entries[0]
    if (!first) return { seconds: 0, bytes: 0 }
    return {
      seconds: Math.max(0, Math.round((Date.now() - first.t) / 1000)),
      bytes: this.head - first.g0,
    }
  }

  /** Entrée contenant un offset global donné (null si purgée ou à venir). */
  entryFor(offset: number): ShiftEntry | null {
    const list = this.entries
    let lo = 0
    let hi = list.length - 1
    let found: ShiftEntry | null = null
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (list[mid].g0 <= offset) {
        found = list[mid]
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    return found && found.g1 > offset ? found : null
  }

  /** Dernière entrée diffusée avant (ou à) l'instant `ts` — départ d'un écran décalé. */
  entryAtTime(ts: number): ShiftEntry | null {
    const list = this.entries
    let lo = 0
    let hi = list.length - 1
    let found: ShiftEntry | null = null
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (list[mid].t <= ts) {
        found = list[mid]
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    return found
  }

  async read(offset: number, max: number): Promise<Buffer | null> {
    const e = this.entryFor(offset)
    if (!e) return null
    const len = Math.min(e.g1 - offset, max)
    if (len <= 0) return null
    try {
      let fd = this.fds.get(e.f)
      if (!fd) {
        fd = await fs.promises.open(this.filePath(e.f), 'r')
        this.fds.set(e.f, fd)
      }
      const buf = Buffer.alloc(len)
      const { bytesRead } = await fd.read(buf, 0, len, e.fo + (offset - e.g0))
      if (bytesRead <= 0) return null
      return bytesRead === len ? buf : buf.subarray(0, bytesRead)
    } catch {
      return null
    }
  }

  private async closeFds() {
    for (const [, fd] of this.fds) {
      try {
        await fd.close()
      } catch {
        /* noop */
      }
    }
    this.fds.clear()
  }

  /**
   * Purge : rétention par durée ET par taille totale — en respectant la
   * position du plus vieil écran décalé actif (minKeepOffset). Sans écran
   * décalé, seul le plafond de rétention s'applique (jamais tout purger).
   */
  prune(minKeepOffset?: number) {
    const keepT = Date.now() - RETENTION_MS // entrées intégralement plus vieilles
    const cutB = this.head - RETENTION_BYTES // plafond de taille totale
    const bounds: number[] = [Number.POSITIVE_INFINITY]
    if (cutB > 0) bounds.push(cutB)
    if (minKeepOffset !== undefined && Number.isFinite(minKeepOffset)) bounds.push(minKeepOffset)
    const keepFrom = Math.min(...bounds)
    const list = this.entries
    let i = 0
    if (Number.isFinite(keepFrom)) {
      while (i < list.length && list[i].g1 <= keepFrom) i++
    }
    let j = 0
    while (j < list.length && list[j].t < keepT) j++
    const cut = Math.max(i, j)
    if (cut > 0) list.splice(0, cut)
    // Fichiers sans aucune entrée restante → suppression
    const used = new Set(list.map((e) => e.f))
    for (let s = 0; s < this.seq; s++) {
      if (!used.has(s)) {
        try {
          fs.unlink(this.filePath(s), () => {})
        } catch {
          /* noop */
        }
      }
    }
  }

  async stop(removeFiles: boolean) {
    try {
      this.writer?.end()
    } catch {
      /* noop */
    }
    this.writer = null
    await this.closeFds()
    if (removeFiles) {
      for (let s = 0; s <= this.seq; s++) {
        try {
          await fs.promises.unlink(this.filePath(s))
        } catch {
          /* noop */
        }
      }
    }
  }
}

/**
 * Source HLS pour hub en enregistrement : suit la playlist en continu
 * (poll), télécharge chaque NOUVEAU segment et le pousse dans le hub.
 * Le flux reconstruit est un MPEG-TS continu — c'est ce qui permet le
 * timeshift sur les chaînes HLS (chaque segment = connexion brève).
 */
async function* hlsSourceChunks(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  alive: () => boolean
): AsyncGenerator<Uint8Array> {
  const seen = new Map<string, true>()
  let consecFails = 0 // échecs consécutifs de playlist (réseau)
  let target = url
  let hops = 0
  while (alive() && !signal.aborted) {
    let pollMs = 3000
    let endlist = false
    try {
      const res = await fetch(target, {
        headers: { ...headers, Accept: '*/*' },
        redirect: 'follow',
        cache: 'no-store',
        signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      })
      if (res.ok) {
        consecFails = 0
        const text = await res.text()
        const base = new URL(target)
        // PLAYLIST MASTER (#EXT-X-STREAM-INF) : suivre sa première variante.
        // Le hub enregistre UN flux média — sans ce suivi, les lignes de la
        // variante seraient prises pour des segments et le TEXTE de la
        // playlist serait enregistré dans le tampon TS : lecture impossible
        // côté écran. (Panels Xtream et CDN diffusent souvent un master.)
        let variant: string | null = null
        let prevWasStreamInf = false
        for (const line of text.split(/\r?\n/)) {
          const t = line.trim()
          if (t.startsWith('#EXT-X-STREAM-INF')) {
            prevWasStreamInf = true
            continue
          }
          if (!t || t.startsWith('#')) {
            prevWasStreamInf = false
            continue
          }
          if (prevWasStreamInf) {
            variant = t
            break
          }
        }
        if (variant) {
          try {
            void res.body?.cancel()
          } catch {
            /* noop */
          }
          if (++hops > 3) throw new Error('upstream-master-recursion')
          try {
            target = new URL(variant, base).toString()
          } catch {
            throw new Error('upstream-variante-invalide')
          }
          continue // re-poll immédiat sur la variante (pas d'attente)
        }
        let segDur = 6
        for (const line of text.split(/\r?\n/)) {
          if (signal.aborted) return
          const t = line.trim()
          if (t.startsWith('#EXTINF:')) {
            const m = /#EXTINF:([\d.]+)/.exec(t)
            if (m) segDur = Math.max(1, parseFloat(m[1]))
            continue
          }
          if (t === '#EXT-X-ENDLIST') {
            endlist = true
            continue
          }
          if (!t || t.startsWith('#')) continue
          let abs: string
          try {
            abs = new URL(t, base).toString()
          } catch {
            continue
          }
          if (seen.has(abs)) continue
          seen.set(abs, true)
          try {
            const rs = await fetch(abs, {
              headers,
              redirect: 'follow',
              cache: 'no-store',
              signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
            })
            if (rs.ok && rs.body) {
              const reader = rs.body.getReader()
              try {
                for (;;) {
                  if (signal.aborted) break
                  const { done, value } = await reader.read()
                  if (done) break
                  if (value && value.length) yield new Uint8Array(value)
                }
              } finally {
                // Ne JAMAIS abandonner un lecteur sans le fermer : un corps
                // non consommé maintient le socket amont ouvert (connexion
                // fournisseur orpheline côté portail).
                try {
                  void reader.cancel()
                } catch {
                  /* noop */
                }
                try {
                  void rs.body.cancel()
                } catch {
                  /* noop */
                }
              }
            } else {
              try {
                void rs.body?.cancel()
              } catch {
                /* noop */
              }
            }
          } catch {
            /* segment manquant → suivant */
          }
        }
        pollMs = Math.max(1000, Math.round((segDur * 1000) / 2))
      } else {
        try {
          void res.body?.cancel()
        } catch {
          /* noop */
        }
        // Refus du portail (compte occupé / banni / quota) : inutile de
        // boucler indéfiniment — on arrête le suivi, le hub réessaiera via
        // sa boucle de reconnexion (sondage + close après MAX_RECONNECTS).
        if (res.status === 401 || res.status === 402 || res.status === 403 || res.status === 429) {
          throw new Error(`upstream-refus-${res.status}`)
        }
        consecFails++
        if (consecFails >= 8) {
          throw new Error(`upstream-hors-ligne-${res.status || 0}`)
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/^upstream-(refus|hors-ligne)/.test(msg)) throw e // propagé au hub
      /* playlist injoignable → nouvelle tentative */
    }
    if (seen.size > 400) {
      let n = seen.size - 200
      for (const k of seen.keys()) {
        if (n-- <= 0) break
        seen.delete(k)
      }
    }
    if (endlist) return
    if (signal.aborted) return
    await sleepMs(pollMs, signal)
  }
}

interface UpstreamConn {
  status: number
  contentType: string
  chunks: AsyncIterable<Uint8Array>
  abort: () => void
}

function connectUpstream(url: string, headers: Record<string, string>, timeoutMs = 15000, depth = 0): Promise<UpstreamConn> {
  return new Promise((resolve, reject) => {
    let u: URL
    try {
      u = new URL(url)
    } catch (e) {
      reject(e)
      return
    }
    const mod = u.protocol === 'https:' ? https : http
    const req = mod.request(
      u,
      {
        method: 'GET',
        headers: { ...headers, Connection: 'close' },
        rejectUnauthorized: false,
      } as https.RequestOptions,
      (res) => {
        const status = res.statusCode || 0
        const location = res.headers.location
        // Suivi des redirections des portails IPTV (301/302/303/307/308)
        if (status >= 300 && status < 400 && location && depth < 3) {
          res.resume()
          const next = new URL(location, u).toString()
          connectUpstream(next, headers, timeoutMs, depth + 1).then(resolve, reject)
          return
        }
        resolve({
          status: res.statusCode || 0,
          contentType: String(res.headers['content-type'] || ''),
          chunks: res as unknown as AsyncIterable<Uint8Array>,
          abort: () => {
            try {
              res.destroy()
            } catch {
              /* noop */
            }
            try {
              req.destroy()
            } catch {
              /* noop */
            }
          },
        })
      }
    )
    req.setTimeout(timeoutMs, () => {
      try {
        req.destroy(new Error('délai dépassé'))
      } catch {
        /* noop */
      }
      reject(new Error('délai dépassé'))
    })
    req.on('error', (e) => reject(e))
    req.end()
  })
}

const MAX_HUB_BUFFER = 12 * 1024 * 1024 // 12 Mo de tolérance par hub (mémoire)
const IDLE_CLOSE_MS = 15000 // arrêt du flux amont 15 s après le dernier écran
const MAX_RECONNECTS = 5

interface HubClient {
  controller: ReadableStreamDefaultController<Uint8Array>
  offset: number
  closed: boolean
  delayed?: number // décalage demandé (ms) — écran timeshift
}

export interface HubInfo {
  url: string // URL demandée (clé de partage)
  source: string // URL amont réellement utilisée (après failover éventuel)
  sourceIndex: number // 0 = source demandée, 1+ = compte de secours
  viewers: number
  bytes: number
  startedAt: number
  reconnects: number
  connecting: boolean
  contentType: string
  recording?: boolean // timeshift : enregistrement disque actif
  bufferedSeconds?: number // timeshift : durée enregistrée (s)
  bufferedBytes?: number // timeshift : taille du tampon (octets)
  delayedViewers?: number // écrans en rediffusion décalée
  recordPersist?: boolean // enregistrement maintenu sans écran (« Enregistrer »)
  upstreamStatus?: number // dernier code HTTP du portail (401 = compte occupé/refusé)
}

export interface SourceResult {
  ok: boolean
  source: string
  sourceIndex: number
}

type HubSourcesResolver = () => Promise<string[]>

class StreamHub {
  private clients = new Set<HubClient>()
  private chunks: { offset: number; data: Uint8Array }[] = []
  private headOffset = 0
  private bytes = 0
  private stopped = false
  private reconnects = 0
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  upstreamStatus = 0 // dernier code HTTP non-OK renvoyé par le portail (0 = aucun)
  private readonly startedAt = Date.now()
  private waiters = new Set<(v: SourceResult) => void>()
  private sourceResult: SourceResult | null = null
  private currentAbort: (() => void) | null = null
  private upstreamCtl: AbortController | null = null // avorte TOUT l'amont HLS à la fermeture
  private disk: DiskBuffer | null = null
  private diskPrunes = 0
  recordPersist = false
  onClose: (() => void) | null = null
  source = ''
  sourceIndex = 0
  connecting = true
  contentType = 'video/mp2t'

  constructor(
    readonly url: string,
    private sourcesResolver: HubSourcesResolver,
    private headers: Record<string, string>
  ) {}

  viewers(): number {
    let n = 0
    for (const c of this.clients) if (!c.closed) n++
    return n
  }

  get delayedViewers(): number {
    let n = 0
    for (const c of this.clients) if (!c.closed && c.delayed) n++
    return n
  }

  get recording(): boolean {
    return !!this.disk
  }

  /** Active l'enregistrement timeshift (tampon disque) de ce hub. */
  enableTimeshift(): void {
    if (this.disk || this.stopped) return
    const id =
      hubKey(this.url)
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .slice(-60) + '-' + Math.random().toString(36).slice(2, 6)
    this.disk = new DiskBuffer(id)
  }

  /** Désactive l'enregistrement (supprime le tampon) ; ferme le hub sans écran. */
  disableTimeshift(): void {
    const d = this.disk
    this.disk = null
    this.recordPersist = false
    if (d) void d.stop(true)
    if (this.clients.size === 0 && !this.stopped) this.close('enregistrement arrêté')
  }

  /** Promesse résolue dès que le flux amont répond (ou échoue définitivement). */
  waitForSource(timeoutMs = 15000): Promise<SourceResult> {
    if (this.sourceResult) return Promise.resolve(this.sourceResult)
    return new Promise((resolve) => {
      const w = (v: SourceResult) => {
        clearTimeout(timer)
        this.waiters.delete(w)
        resolve(v)
      }
      const timer = setTimeout(() => {
        this.waiters.delete(w)
        resolve({ ok: false, source: '', sourceIndex: -1 })
      }, timeoutMs)
      this.waiters.add(w)
    })
  }

  /** Résolu dès que le tampon disque couvre `delayMs` de direct (écran décalé prêt). */
  waitForDelayedSource(delayMs: number, timeoutMs = 30000): Promise<SourceResult> {
    const t0 = Date.now()
    return new Promise((resolve) => {
      const tick = () => {
        if (this.stopped) {
          resolve({ ok: false, source: '', sourceIndex: -1 })
          return
        }
        if (this.disk && this.disk.entries.length > 0 && this.disk.covers(delayMs)) {
          resolve({ ok: true, source: this.source, sourceIndex: this.sourceIndex })
          return
        }
        if (!this.connecting && !this.source && (!this.disk || this.disk.entries.length === 0)) {
          resolve({ ok: false, source: '', sourceIndex: -1 })
          return
        }
        if (Date.now() - t0 >= timeoutMs) {
          resolve({ ok: false, source: '', sourceIndex: -1 })
          return
        }
        setTimeout(tick, 250)
      }
      tick()
    })
  }

  private settleSource(v: SourceResult) {
    if (!this.sourceResult) this.sourceResult = v
    for (const w of [...this.waiters]) w(this.sourceResult)
  }

  /** Chaque écran reçoit son propre ReadableStream alimenté par le flux amont partagé. */
  attach(): ReadableStream<Uint8Array> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    let client: HubClient | null = null
    return new ReadableStream<Uint8Array>({
      start: (c) => {
        client = { controller: c, offset: this.headOffset, closed: false }
        this.clients.add(client)
        this.pump(client)
      },
      pull: () => {
        if (client && !client.closed) this.pump(client)
      },
      cancel: () => {
        if (client && !client.closed) this.detach(client)
      },
    })
  }

  /**
   * Écran en rediffusion décalée : lit le tampon disque en attendant que
   * chaque bloc ait « D secondes d'âge » — rythme temps réel naturel,
   * aucune connexion fournisseur supplémentaire.
   */
  attachDelayed(delayMs: number): ReadableStream<Uint8Array> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    let client: HubClient | null = null
    return new ReadableStream<Uint8Array>({
      start: (c) => {
        const entry =
          (this.disk && (this.disk.entryAtTime(Date.now() - delayMs) || this.disk.entries[0])) || null
        client = { controller: c, offset: entry ? entry.g0 : this.headOffset, closed: false, delayed: delayMs }
        this.clients.add(client)
        void this.pumpDelayed(client)
      },
      cancel: () => {
        if (client && !client.closed) this.detach(client)
      },
    })
  }

  private async pumpDelayed(c: HubClient) {
    const delayMs = c.delayed ?? 0
    while (!c.closed && !this.stopped) {
      const disk = this.disk
      if (!disk) break
      const desired = c.controller.desiredSize
      if (desired !== null && desired <= 0) {
        await sleepMs(40)
        continue
      }
      const e = disk.entryFor(c.offset)
      if (!e) {
        if (c.offset >= disk.head) {
          await sleepMs(150) // le direct n'a pas encore écrit ce qui suit
          continue
        }
        const first = disk.entries[0]
        if (!first) {
          await sleepMs(150)
          continue
        }
        c.offset = first.g0 // zone purgée → rattraper le plus ancien disponible
        continue
      }
      const waitMs = e.t + delayMs - Date.now()
      if (waitMs > 0) {
        await sleepMs(Math.min(waitMs, 1000))
        continue
      }
      const data = await disk.read(c.offset, 262144)
      if (!data || data.length === 0) {
        await sleepMs(150)
        continue
      }
      try {
        c.controller.enqueue(data)
      } catch {
        this.detach(c)
        return
      }
      c.offset += data.length
    }
  }

  detach(c: HubClient) {
    c.closed = true
    this.clients.delete(c)
    if (this.clients.size === 0 && !this.recordPersist) this.scheduleIdleClose()
  }

  private scheduleIdleClose() {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => {
      if (this.clients.size === 0 && !this.recordPersist) this.close('plus aucun écran connecté')
    }, IDLE_CLOSE_MS)
  }

  private pump(c: HubClient) {
    if (c.closed || this.stopped) return
    if (this.chunks.length > 0) {
      const oldest = this.chunks[0].offset
      if (c.offset < oldest) c.offset = oldest // écran trop lent → saut au direct (comportement live)
    }
    for (const chunk of this.chunks) {
      if (c.offset >= this.headOffset) break
      const desired = c.controller.desiredSize ?? 1
      if (desired <= 0) break // contre-pression : attendre le pull suivant
      const end = chunk.offset + chunk.data.length
      if (c.offset >= end) continue
      const start = c.offset - chunk.offset
      try {
        c.controller.enqueue(chunk.data.subarray(start))
      } catch {
        this.detach(c)
        return
      }
      c.offset = end
    }
  }

  private broadcast(data: Uint8Array) {
    this.chunks.push({ offset: this.headOffset, data })
    this.headOffset += data.length
    this.bytes += data.length
    if (this.disk) {
      this.disk.append(data)
      if (++this.diskPrunes >= 500) {
        this.diskPrunes = 0
        let min = Number.POSITIVE_INFINITY
        for (const c of this.clients) if (!c.closed && c.delayed) min = Math.min(min, c.offset)
        this.disk.prune(Number.isFinite(min) ? min : undefined)
      }
    }
    let buffered = this.headOffset - (this.chunks[0]?.offset ?? this.headOffset)
    while (buffered > MAX_HUB_BUFFER && this.chunks.length > 1) {
      this.chunks.shift()
      buffered = this.headOffset - this.chunks[0].offset
    }
    for (const c of [...this.clients]) if (!c.delayed) this.pump(c)
  }

  /** Boucle amont : connexion (avec bascule de secours) puis redistribution, reconnexion sur coupure. */
  async run() {
    const sources = await this.sourcesResolver()
    while (!this.stopped) {
      let connected = false
      for (let i = 0; i < sources.length; i++) {
        if (this.stopped) return
        const src = sources[i]
        const isHls = /\.(m3u8?)(\?|$)/i.test(src)
        try {
          if (isHls) {
            // SONDAGE : la playlist répond-elle vraiment ? Un portail qui
            // refuse (401 compte occupé, 403, 429) ne doit PAS être annoncé
            // comme source valide — sinon les écrans restent suspendus sans
            // un seul octet, sans message d'erreur.
            const probe = await fetch(src, {
              headers: { ...this.headers, Accept: '*/*' },
              redirect: 'follow',
              cache: 'no-store',
              signal: AbortSignal.timeout(12000),
            })
            if (!probe.ok) {
              try {
                void probe.body?.cancel()
              } catch {
                /* noop */
              }
              this.upstreamStatus = probe.status
              continue // source refusée → suivante
            }
            try {
              void probe.body?.cancel()
            } catch {
              /* noop */
            }
            // Chaîne HLS : suivi de playlist + téléchargement des NOUVEAUX
            // segments → flux MPEG-TS continu (partage multi-écrans ET
            // enregistrement timeshift, avec ou sans tampon disque).
            this.source = src
            this.sourceIndex = i
            this.contentType = 'video/mp2t'
            this.connecting = false
            this.reconnects = 0
            this.settleSource({ ok: true, source: src, sourceIndex: i })
            connected = true
            // Contrôleur lié au cycle du hub : close() avorte immédiatement
            // la playlist ET les segments en vol (aucune requête « fantôme »
            // ne doit subsister après l'arrêt — connexion fournisseur libérée).
            this.upstreamCtl = new AbortController()
            const sig = this.upstreamCtl.signal
            for await (const chunk of hlsSourceChunks(src, this.headers, sig, () => !this.stopped)) {
              if (this.stopped) break
              this.broadcast(chunk)
            }
            this.upstreamCtl = null
            break
          }
          let conn: UpstreamConn | null = null
          conn = await connectUpstream(src, this.headers)
          if (this.stopped) {
            // Le hub a été arrêté pendant la connexion : NE PAS laisser un
            // flux « zombie » consommer une connexion fournisseur orpheline.
            conn.abort()
            return
          }
          this.currentAbort = conn.abort
          if (conn.status >= 200 && conn.status < 300) {
            this.source = src
            this.sourceIndex = i
            this.contentType = conn.contentType || 'video/mp2t'
            this.connecting = false
            this.reconnects = 0 // succès → le compteur de coupures repart de zéro
            this.settleSource({ ok: true, source: this.source, sourceIndex: i })
            connected = true
            try {
              for await (const chunk of conn.chunks) {
                if (chunk && chunk.length) this.broadcast(chunk)
              }
            } catch {
              /* lecture interrompue */
            } finally {
              if (this.currentAbort === conn.abort) this.currentAbort = null
            }
            break
          }
          conn.abort() // libérer le socket des sources refusées
          this.upstreamStatus = conn.status
        } catch {
          /* source injoignable → suivante */
        }
      }
      if (!connected && this.connecting) {
        this.connecting = false
        this.settleSource({ ok: false, source: '', sourceIndex: -1 })
      }
      if (this.stopped) return
      if (this.clients.size === 0) {
        if (this.recordPersist) {
          await sleepMs(1000) // enregistrement sans écran : le hub continue de capter
          continue
        }
        this.close('plus aucun écran connecté')
        return
      }
      if (this.reconnects >= MAX_RECONNECTS) {
        this.close('trop de coupures amont')
        return
      }
      this.reconnects++
      await new Promise((r) => setTimeout(r, 1000))
    }
  }

  close(reason: string) {
    if (this.stopped) return
    this.stopped = true
    this.connecting = false
    if (this.idleTimer) clearTimeout(this.idleTimer)
    try {
      this.currentAbort?.()
    } catch {
      /* noop */
    }
    try {
      // Avorte la playlist HLS et les segments en cours de téléchargement :
      // sans cela, les requêtes « fantômes » continuent de rafraîchir la
      // session chez le fournisseur APRÈS l'arrêt (connexion résiduelle).
      this.upstreamCtl?.abort()
    } catch {
      /* noop */
    }
    const d = this.disk
    this.disk = null
    this.recordPersist = false
    if (d) void d.stop(true)
    for (const c of [...this.clients]) {
      c.closed = true
      try {
        c.controller.close()
      } catch {
        try {
          c.controller.error(new Error(reason))
        } catch {
          /* noop */
        }
      }
    }
    this.clients.clear()
    HUBS.delete(hubKey(this.url))
    try {
      this.onClose?.()
    } catch {
      /* noop */
    }
  }

  /** Hub utilisable (non arrêté) — accès public pour le registre. */
  get active(): boolean {
    return !this.stopped
  }

  info(): HubInfo {
    const st = this.disk ? this.disk.stats() : { seconds: 0, bytes: 0 }
    return {
      url: this.url,
      source: this.source,
      sourceIndex: this.sourceIndex,
      viewers: this.viewers(),
      bytes: this.bytes,
      startedAt: this.startedAt,
      reconnects: this.reconnects,
      connecting: this.connecting,
      contentType: this.contentType,
      upstreamStatus: this.upstreamStatus,
      recording: !!this.disk,
      bufferedSeconds: st.seconds,
      bufferedBytes: st.bytes,
      delayedViewers: this.delayedViewers,
      recordPersist: this.recordPersist,
    }
  }
}

const HUBS = new Map<string, StreamHub>()

/**
 * Clé normalisée d'un hub : Bun réécrit 127.0.0.1 → localhost dans les URLs de
 * requête ; on aligne les deux formes pour que arrêt/recherche retrouvent le hub.
 */
function hubKey(raw: string): string {
  try {
    const u = new URL(raw)
    const host = u.hostname === '127.0.0.1' ? 'localhost' : u.hostname
    return `${u.protocol}//${host}${u.port ? ':' + u.port : ''}${u.pathname}${u.search}`
  } catch {
    return raw
  }
}

/** Retrouve un hub vivant pour cette URL (les écrans suivants rejoignent le flux existant). */
export function findHub(url: string): StreamHub | undefined {
  const h = HUBS.get(hubKey(url))
  return h && h.active ? h : undefined
}

/**
 * Crée (synchroniquement) et démarre un hub. La résolution des sources amont
 * (avec bascule de secours éventuelle) est asynchrone et gérée par le hub.
 * L'enregistrement dans le registre est synchronique : deux écrans qui
 * demandent la même chaîne au même instant partagent bien le même hub.
 * `onClose` : rappel optionnel (libération du slot dans le pool de connexions).
 * `opts.timeshift` : démarre AVEC enregistrement (demande d'écran décalé) ;
 * `opts.recordPersist` : maintient le hub sans écran (bouton « Enregistrer »).
 */
export function startHub(
  url: string,
  headers: Record<string, string>,
  sourcesResolver: HubSourcesResolver,
  onClose?: () => void,
  opts?: { timeshift?: boolean; recordPersist?: boolean }
): StreamHub {
  const hub = new StreamHub(url, sourcesResolver, headers)
  HUBS.set(hubKey(url), hub)
  if (onClose) hub.onClose = onClose
  if (opts?.timeshift) hub.enableTimeshift()
  if (opts?.recordPersist) hub.recordPersist = true
  hub.run().catch(() => hub.close('erreur interne du hub'))
  return hub
}

export function listHubs(): HubInfo[] {
  return [...HUBS.values()].filter((h) => h.active).map((h) => h.info())
}

export function stopHub(url: string): boolean {
  const h = HUBS.get(hubKey(url))
  if (!h) return false
  h.close('arrêt manuel depuis l administration')
  return true
}
