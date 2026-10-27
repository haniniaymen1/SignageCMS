'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import { AlertTriangle, Globe, Loader2, RotateCcw, Search, Tv, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { detectStreamKind } from '@/lib/m3u'
import { robustPlay } from '@/lib/autoplay'

// mpegts.js est chargé dynamiquement (ne supporte pas le rendu SSR)
type MpegtsApi = typeof import('mpegts.js')['default']
type MpegtsPlayer = ReturnType<MpegtsApi['createPlayer']>
let mpegtsPromise: Promise<MpegtsApi> | null = null
function loadMpegts(): Promise<MpegtsApi> {
  if (!mpegtsPromise) {
    mpegtsPromise = import('mpegts.js').then((m) => {
      const mod = m as unknown as { default?: MpegtsApi }
      return mod.default ?? (m as unknown as MpegtsApi)
    })
  }
  return mpegtsPromise
}

// dash.js est chargé dynamiquement (MPEG-DASH .mpd — le navigateur ne sait pas
// le lire nativement et le paquet est volumineux : import à la demande)
type DashApi = typeof import('dashjs')
type DashPlayer = import('dashjs').MediaPlayerClass
let dashPromise: Promise<DashApi> | null = null
function loadDash(): Promise<DashApi> {
  if (!dashPromise) {
    dashPromise = import('dashjs').then((m) => {
      const mod = m as unknown as { default?: DashApi }
      return mod.default ?? (m as unknown as DashApi)
    })
  }
  return dashPromise
}

export function proxyUrl(url: string): string {
  return `/api/iptv/proxy?url=${encodeURIComponent(url)}`
}

// Page servie en HTTPS + flux HTTP du fournisseur : le navigateur bloque le
// mixed-content. Si le panel n'annonce pas de port HTTPS utilisable, la
// lecture directe est impossible — message clair plutôt que blocage muet.
const MIXED_MSG =
  "Lecture directe impossible ici : cette page est en HTTPS et le flux du fournisseur est en HTTP (mixed-content bloqué par le navigateur), et le fournisseur refuse les flux depuis l'IP de ce serveur. " +
  'Déployez le CMS sur votre réseau local (page en http://…) pour lire cette chaîne — le bouton « Diagnostic » affiche le verdict complet.'

interface Props {
  url: string
  className?: string
  muted?: boolean
  autoPlay?: boolean
  controls?: boolean
  /** Timeshift : décalage en secondes par rapport au direct (0/undefined = direct). */
  delay?: number
}

type PlayMode = 'proxy' | 'direct'

/**
 * Lecteur IPTV universel :
 * - MODE PROXY (défaut) : tous les flux passent par le proxy anti-CORS intégré
 *   (contourne CORS + mixed-content HTTPS→HTTP, partage multi-écrans, timeshift) ;
 * - MODE DIRECT (secours automatique) : le NAVIGATEUR lit le flux directement
 *   chez le fournisseur — utile quand le fournisseur refuse l'IP du serveur
 *   (blocage anti-datacenter / verrouillage IP) tout en acceptant celle du
 *   client. Depuis une page HTTPS, la variante HTTPS annoncée par le panel
 *   (server_info.https_port) est tentée automatiquement ; sinon message clair.
 * - .m3u8 / .m3u  → HLS via hls.js
 * - .ts / .flv    → mpegts.js en live
 * - .mpd          → MPEG-DASH via dash.js
 * - .mp4 / autres → lecture directe de la balise <video>
 * - delay > 0     → flux TIMEShift : lecture MPEG-TS du hub serveur
 *   (mode=live&delay=N) — toujours via le proxy, 1 seule connexion fournisseur.
 */
export default function IptvStreamPlayer({ url, className, muted = false, autoPlay = true, controls = true, delay = 0 }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState<'loading' | 'playing' | 'buffering' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [mode, setMode] = useState<PlayMode>('proxy')
  const [diag, setDiag] = useState<string>('')
  const [diagLoading, setDiagLoading] = useState(false)
  // La page est-elle servie en HTTP ? (en HTTPS, un flux HTTP du fournisseur
  // nécessite sa variante HTTPS — port annoncé par le panel — sinon mixed-content)
  const [httpPage, setHttpPage] = useState(false)
  useEffect(() => {
    setHttpPage(window.location.protocol === 'http:')
  }, [])
  const shifted = delay > 0
  const autoTried = useRef(false)
  const probeErrRef = useRef<string | null>(null)
  useEffect(() => {
    autoTried.current = false
    probeErrRef.current = null
  }, [url])

  const destroy = useCallback(() => {
    const video = videoRef.current
    if (video) {
      video.pause()
      video.removeAttribute('src')
      try { video.load() } catch { /* noop */ }
    }
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !url) return

    let hls: Hls | null = null
    let mts: MpegtsPlayer | null = null
    let dashPlayer: DashPlayer | null = null
    let disposed = false

    queueMicrotask(() => {
      if (!disposed) {
        setStatus('loading')
        setErrorMsg('')
        setDiag('')
      }
    })

    const kind = detectStreamKind(url)
    const useDirect = mode === 'direct' && !shifted
    // Timeshift : le hub serveur renvoie un MPEG-TS continu décalé → forcer la voie mpegts
    const kind2 = shifted ? 'ts' : kind
    const src = useDirect
      ? url
      : shifted
        ? `${proxyUrl(url)}&mode=live&delay=${delay}`
        : proxyUrl(url)

    const fail = (msg: string) => {
      if (disposed) return
      setStatus('error')
      setErrorMsg(msg)
    }

    // Résolution de la source en MODE DIRECT : depuis une page HTTPS, un flux
    // HTTP serait bloqué (mixed-content) → tenter la variante HTTPS du
    // fournisseur (port annoncé par le panel via /api/iptv/https-url).
    const resolveDirectSrc = async (): Promise<string | null> => {
      if (httpPage || url.startsWith('https:')) return url
      try {
        const res = await fetch(`/api/iptv/https-url?url=${encodeURIComponent(url)}`)
        const j = await res.json()
        return j?.url || null
      } catch {
        return null
      }
    }

    // SONDE (mode proxy) : récupère la VRAIE raison d'un refus du proxy
    // (compte occupé, quota atteint, portail injoignable, IP refusée) avant de
    // lancer le lecteur — sinon hls.js/mpegts masquent le message derrière une
    // erreur générique « réseau ». Résultat mémorisé : hls.js réutilise la
    // raison déjà connue au lieu de re-sonder (échec rapide, pas d'attente).
    const probeProxy = async (): Promise<string | null> => {
      try {
        const ctrl = new AbortController()
        const t = setTimeout(() => ctrl.abort(), 12000)
        const res = await fetch(src, { signal: ctrl.signal, headers: { Accept: '*/*' } })
        clearTimeout(t)
        if (res.ok) {
          try { await res.body?.cancel() } catch { /* le lecteur reprendra le flux */ }
          probeErrRef.current = null
          return null // flux disponible → lecteur
        }
        const text = (await res.text().catch(() => '')) || ''
        try { await res.body?.cancel() } catch { /* noop */ }
        const err = text.trim().slice(0, 300) || `Le serveur a répondu HTTP ${res.status}`
        probeErrRef.current = err
        return err
      } catch {
        return probeErrRef.current // réseau/abort → raison déjà connue sinon null
      }
    }

    const onProxyFail = async (probeErr: string | null) => {
      // Bascule de secours AUTOMATIQUE en lecture directe navigateur : quand le
      // fournisseur refuse l'IP du serveur mais accepte celle du client, le
      // navigateur peut lire le flux directement (CORS ouvert sur les portails
      // Xtream). Une seule tentative automatique par URL.
      if (probeErr && !shifted && !autoTried.current) {
        autoTried.current = true
        if (!disposed) {
          setStatus('loading')
          setMode('direct')
        }
        return
      }
      if (probeErr) {
        const blocage = /HTTP 40[123]/.test(probeErr)
        fail(
          probeErr +
            (blocage && !shifted
              ? " — Si le diagnostic confirme un blocage de l'IP du serveur par le fournisseur, la lecture via ce serveur est impossible par conception : déployez le CMS sur un réseau autorisé par le fournisseur (comme vos applications IPTV)."
              : '')
        )
      }
      // probeErr === null → laisser le lecteur (hls.js/mpegts.js) gérer
    }

    void (async () => {
      let finalSrc = src
      if (useDirect) {
        const r = await resolveDirectSrc()
        if (disposed) return
        if (!r) {
          fail(MIXED_MSG)
          return
        }
        finalSrc = r
      }

      if (kind2 === 'hls') {
        if (Hls.isSupported()) {
          if (!useDirect) {
            const probeErr = await probeProxy()
            if (disposed) return
            if (probeErr) {
              await onProxyFail(probeErr)
              return
            }
          }
          const h = new Hls({
            manifestLoadingTimeOut: 15000,
            manifestLoadingMaxRetry: 2,
            levelLoadingTimeOut: 15000,
            fragLoadingTimeOut: 25000,
            fragLoadingMaxRetry: 3,
            liveDurationInfinity: true,
            enableWorker: true,
            lowLatencyMode: true,
            // Démarrage live rapide : certains portails diffusent des segments
            // de 7 à 15 s ; le réglage par défaut (3 durées cibles) attendrait
            // jusqu'à 45 s avant la première image.
            liveSyncDurationCount: 1,
            liveMaxLatencyDurationCount: 4,
            maxBufferLength: 12,
            maxMaxBufferLength: 30,
          })
          hls = h
          h.loadSource(finalSrc)
          h.attachMedia(video)
          h.on(Hls.Events.MANIFEST_PARSED, () => {
            if (autoPlay) robustPlay(video)
          })
          h.on(Hls.Events.ERROR, (_evt, data) => {
            if (data.fatal) {
              switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR: {
                  // En mode proxy, la raison est déjà connue (sonde) → échec
                  // rapide et précis. Sinon une courte sonde la récupère.
                  if (!useDirect) {
                    void (async () => {
                      const probeErr = probeErrRef.current ?? (await probeProxy())
                      if (disposed) return
                      if (probeErr) await onProxyFail(probeErr)
                      else fail('Flux inaccessible ou hors ligne (réseau)')
                    })()
                  } else {
                    fail('Flux direct inaccessible : le fournisseur refuse ce flux depuis votre navigateur (CORS/IP) ou le serveur HTTPS du panel est indisponible.')
                  }
                  break
                }
                case Hls.ErrorTypes.MEDIA_ERROR:
                  try { h.recoverMediaError() } catch { fail('Erreur de décodage du flux') }
                  break
                default:
                  fail('Lecture du flux impossible')
              }
            }
          })
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          // Safari natif
          video.src = finalSrc
          if (autoPlay) robustPlay(video)
        } else {
          fail('HLS non supporté par ce navigateur')
        }
      } else if (kind2 === 'ts') {
        try {
          if (!useDirect) {
            const probeErr = await probeProxy()
            if (disposed) return
            if (probeErr) {
              await onProxyFail(probeErr)
              return
            }
          }
          const mpegts = await loadMpegts()
          if (disposed) return
          if (mpegts.isSupported()) {
            mts = mpegts.createPlayer(
              { type: 'mpegts', isLive: true, url: finalSrc },
              { liveBufferLatencyChasing: !shifted, enableStashBuffer: false }
            )
            const player = mts
            player.attachMediaElement(video)
            player.load()
            // v3.11.13 — repli muet si l'autoplay est refusé (jamais figé) ;
            // on passe par player.play() qui gère l'état interne de mpegts.js
            if (autoPlay) {
              Promise.resolve(player.play()).catch(() => {
                video.muted = true
                Promise.resolve(player.play()).catch(() => { /* re-tentative geste */ })
              })
            }
            player.on(mpegts.Events.ERROR, () =>
              fail(
                useDirect
                  ? 'Flux MPEG-TS direct inaccessible : le fournisseur refuse ce flux depuis votre navigateur (CORS/IP).'
                  : 'Flux MPEG-TS inaccessible ou hors ligne'
              )
            )
          } else {
            fail('Lecture MPEG-TS non supportée par ce navigateur')
          }
        } catch {
          fail('Impossible de charger le lecteur MPEG-TS')
        }
      } else if (kind2 === 'mpd') {
        try {
          // DASH en lecture DIRECTE navigateur : la spécification DASH impose
          // CORS sur le CDN (segments requis par le navigateur), donc le
          // lecteur peut les appeler lui-même ; le proxy ne réécrit pas le
          // XML MPD (ses segments relatifs seraient résolus à tort contre
          // l'URL du proxy). En HTTPS un flux HTTP resterait bloqué par le
          // navigateur (mixed-content) → message clair.
          if (httpPage || url.startsWith('https:')) {
            const dash = await loadDash()
            if (disposed) return
            const player = dash.MediaPlayer().create()
            dashPlayer = player
            player.on('error', () =>
              fail('Flux DASH inaccessible, hors ligne ou non conforme (MPD illisible)')
            )
            player.initialize(video, url, autoPlay)
          } else {
            fail(MIXED_MSG)
          }
        } catch {
          fail('Impossible de charger le lecteur DASH')
        }
      } else {
        video.src = finalSrc
        if (autoPlay) robustPlay(video)
      }
    })()

    const onPlaying = () => !disposed && setStatus('playing')
    // Après le premier démarrage, les micro-coupures live affichent un indicateur discret (pas d'overlay plein écran)
    const onWaiting = () =>
      !disposed && setStatus((s) => (s === 'error' || s === 'loading' ? s : 'buffering'))
    const onError = () => !disposed && kind2 === 'direct' && fail('Flux inaccessible ou format non supporté')
    video.addEventListener('playing', onPlaying)
    video.addEventListener('waiting', onWaiting)
    video.addEventListener('error', onError)

    return () => {
      disposed = true
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('waiting', onWaiting)
      video.removeEventListener('error', onError)
      try {
        hls?.destroy()
      } catch { /* noop */ }
      try {
        mts?.pause()
        mts?.unload()
        mts?.detachMediaElement()
        mts?.destroy()
      } catch { /* noop */ }
      try {
        dashPlayer?.reset()
      } catch { /* noop */ }
      destroy()
    }
  }, [url, autoPlay, attempt, delay, mode, shifted, httpPage, destroy])

  const runDiag = async () => {
    setDiagLoading(true)
    setDiag('')
    try {
      const res = await fetch(`/api/iptv/diagnose?url=${encodeURIComponent(url)}`)
      const j = await res.json()
      const parts: string[] = []
      if (j.dnsError) parts.push(j.dnsError)
      else if (j.ip) parts.push(`DNS : ${j.host} → ${j.ip}`)
      if (j.api) {
        parts.push(
          j.api.status === 200
            ? `API fournisseur : OK (compte « ${j.api.accountStatus ?? '?'} », ${j.api.activeCons ?? '?'} connexion(s)/${j.api.maxCons ?? '?'}${j.api.expiry ? `, expire le ${j.api.expiry}` : ''})`
            : `API fournisseur : HTTP ${j.api.status}${j.api.error ? ` (${j.api.error})` : ''}`
        )
      }
      parts.push(
        j.stream?.status === 200
          ? `Flux : OK (HTTP 200, ${j.stream.ms} ms)`
          : `Flux depuis ce serveur : ${j.stream?.status ? `HTTP ${j.stream.status}` : (j.stream?.error || 'injoignable')}`
      )
      setDiag(`${parts.join(' · ')}\n➜ ${j.verdict ?? ''}`)
    } catch {
      setDiag('Diagnostic indisponible (erreur réseau interne).')
    } finally {
      setDiagLoading(false)
    }
  }

  return (
    <div className={`relative overflow-hidden bg-black ${className ?? ''}`}>
      <video
        ref={(el) => {
          videoRef.current = el
          // v3.11.13 — l'ATTRIBUT muted doit être présent au chargement pour
          // l'autoplay muet (Safari/Firefox/WebView) ; React ne pose que la
          // propriété. defaultMuted seul : ne perturbe pas le son courant.
          if (el) el.defaultMuted = muted
        }}
        className="h-full w-full object-contain"
        muted={muted}
        controls={controls}
        playsInline
        autoPlay={autoPlay}
      />
      {status === 'loading' && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 text-white">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="text-xs opacity-80">
            Connexion au flux… {mode === 'direct' ? '(lecture directe navigateur)' : ''}
          </span>
        </div>
      )}
      {status === 'buffering' && (
        <div className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1.5 rounded bg-black/60 px-2 py-1 text-[10px] text-white">
          <Loader2 className="h-3 w-3 animate-spin" /> Mise en mémoire tampon…
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 overflow-y-auto bg-black/80 px-4 py-3 text-center text-white">
          <AlertTriangle className="h-8 w-8 shrink-0 text-amber-400" />
          <div className="text-sm font-medium">Lecture impossible</div>
          <div className="max-w-md text-xs opacity-70 whitespace-pre-wrap">{errorMsg || 'Ce flux ne répond pas. Il peut être hors ligne, géo-restreint ou protégé.'}</div>
          <div className="mt-1 flex flex-wrap items-center justify-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="border-white/30 bg-transparent text-white hover:bg-white/10"
              onClick={() => { setStatus('loading'); setAttempt((a) => a + 1) }}
            >
              <RotateCcw className="mr-1 h-3.5 w-3.5" /> Réessayer
            </Button>
            {mode === 'proxy' && !shifted && (
              <Button
                size="sm"
                variant="outline"
                className="border-white/30 bg-transparent text-white hover:bg-white/10"
                onClick={() => { setStatus('loading'); setMode('direct') }}
              >
                <Zap className="mr-1 h-3.5 w-3.5" /> Lecture directe
              </Button>
            )}
            {mode === 'direct' && (
              <Button
                size="sm"
                variant="outline"
                className="border-white/30 bg-transparent text-white hover:bg-white/10"
                onClick={() => { setStatus('loading'); setMode('proxy') }}
              >
                <Globe className="mr-1 h-3.5 w-3.5" /> Via le proxy
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="border-white/30 bg-transparent text-white hover:bg-white/10"
              onClick={() => void runDiag()}
              disabled={diagLoading}
            >
              {diagLoading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Search className="mr-1 h-3.5 w-3.5" />} Diagnostic
            </Button>
          </div>
          {diag && (
            <div className="mt-1 max-h-32 max-w-md overflow-y-auto whitespace-pre-wrap rounded bg-white/10 px-2 py-1.5 text-left text-[11px] leading-relaxed opacity-90">
              {diag}
            </div>
          )}
        </div>
      )}
      <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-1 rounded bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-white">
        <Tv className="h-3 w-3" /> {delay > 0 ? `Décalé +${delay >= 60 ? `${Math.round(delay / 60)} min` : `${delay} s`}` : 'Direct'}
        {mode === 'direct' && delay === 0 ? ' · navigateur' : ''}
      </div>
    </div>
  )
}
