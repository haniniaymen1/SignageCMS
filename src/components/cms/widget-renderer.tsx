'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CloudSun, ExternalLink, Image as ImageIcon, Presentation, RefreshCw, Rss, Tv, Type, VideoOff } from 'lucide-react'
import { robustPlay } from '@/lib/autoplay'
import IptvStreamPlayer from './iptv-player'

export interface WidgetData {
  id: string
  type: string
  name: string
  duration: number
  config: string
  media?: { id: string; url: string; name: string; type: string; slides?: string[] | string | null } | null
  position: number
}

export interface WidgetRendererProps {
  widget: WidgetData
  /** Lecture en boucle des médias (setting CMS « playerLoop ») — défaut : activée */
  loop?: boolean
  /** Interaction activée (clics, formulaires dans les pages web) — défaut : activée */
  interactive?: boolean
}

function parseSlides(media: WidgetData['media']): string[] {
  if (!media?.slides) return []
  try {
    const raw = typeof media.slides === 'string' ? JSON.parse(media.slides) : media.slides
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

function parseConfig(config: string): Record<string, string> {
  try {
    return JSON.parse(config || '{}')
  } catch {
    return {}
  }
}

// ============ Son piloté par le CMS (v3.11.14) ============
// v3.11.14 — le bouton volume / muet du lecteur web est SUPPRIMÉ : le volume
// et l'activation muet sont décidés UNIQUEMENT côté CMS (case « Démarrer muet »
// du widget dans l'éditeur de présentation, lue via cfg.muted). Aucun réglage
// local sur la page /player ni dans les aperçus — une seule source de vérité.

// ============ Image avec repli élégant (v3.11.5) ============
// TIFF/TIF/ICO ne sont pas décodés par tous les navigateurs : au lieu d'une
// image cassée (icône navigateur), afficher une carte explicative discrète.
function ImageMedia({ url, name }: { url: string; name: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-slate-900 text-white/40">
        <ImageIcon className="h-8 w-8" />
        <span className="px-4 text-center text-xs leading-snug">
          Format d&apos;image non lisible par ce navigateur
          <span className="text-white/25"> ({name.split('.').pop()?.toUpperCase()})</span>
        </span>
      </div>
    )
  }
  return (
    <img
      src={url}
      alt={name}
      className="h-full w-full object-cover"
      onError={() => setFailed(true)}
    />
  )
}

// ============ Horloge numérique ============

function ClockWidget({ cfg }: { cfg: Record<string, string> }) {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  const time = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', hour12: false })
  const date = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
  return (
    <div className="flex h-full w-full flex-col items-center justify-center" style={{ color: cfg.color || '#fff' }}>
      <div
        className="font-bold leading-none"
        style={{ fontSize: `${cfg.size || 72}px` }}
      >
        {time}
      </div>
      <div className="mt-2 text-xl capitalize opacity-80">{date}</div>
    </div>
  )
}

// ============ Météo simulée ============

function WeatherWidget({ cfg }: { cfg: Record<string, string> }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center text-white">
      <CloudSun className="h-16 w-16 text-yellow-300" />
      <div className="mt-2 text-5xl font-bold" style={{ color: cfg.color || '#fff' }}>21°C</div>
      <div className="mt-1 text-lg opacity-85">{cfg.city || 'Paris'} · Ensoleillé</div>
    </div>
  )
}

// ============ Fil RSS défilant ============

function RssWidget({ cfg }: { cfg: Record<string, string> }) {
  const items = [
    'Les écrans dynamiques augmentent la notoriété de 47 % en point de vente',
    'Nouveau : planification simplifiée depuis le calendrier du CMS',
    "L'affichage dynamique réduit le perçu d'attente de 35 %",
  ]
  return (
    <div className="flex h-full w-full flex-col justify-center overflow-hidden">
      <div className="flex items-center gap-2 border-b border-white/20 pb-2 text-sm font-semibold uppercase tracking-wide text-white/80">
        <Rss className="h-4 w-4" /> {cfg.title || 'Actualités'}
      </div>
      <div className="mt-3 space-y-2 text-white">
        {items.map((item, i) => (
          <div key={i} className="text-lg leading-snug">• {item}</div>
        ))}
      </div>
    </div>
  )
}

// ============ Texte riche ============

function TextWidget({ cfg }: { cfg: Record<string, string> }) {
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center text-center"
      style={{
        color: cfg.color || '#ffffff',
        backgroundColor: cfg.bg || 'transparent',
        fontSize: `${cfg.size || 36}px`,
        fontWeight: cfg.bold === 'true' ? 700 : 400,
      }}
    >
      {cfg.title ? <div className="mb-2 text-2xl font-bold uppercase tracking-wide">{cfg.title}</div> : null}
      <div className="leading-snug whitespace-pre-wrap px-4">{cfg.message || 'Votre texte ici'}</div>
    </div>
  )
}

// ============ Carrousel de slides (présentation PowerPoint/PDF convertie en PNG) ============

function PresentationWidget({ widget, loop = true }: { widget: WidgetData; loop?: boolean }) {
  const slides = parseSlides(widget.media)
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    if (slides.length <= 1) return
    // durée du widget répartie entre les slides, minimum 5 s par slide
    const per = Math.max(5, Math.round((widget.duration || 30) / slides.length)) * 1000
    const t = setInterval(() => {
      setIdx((i) => {
        if (loop) return (i + 1) % slides.length
        return i + 1 < slides.length ? i + 1 : i // boucle désactivée : rester sur la dernière slide
      })
    }, per)
    return () => clearInterval(t)
  }, [slides.length, widget.duration, loop])
  if (slides.length === 0) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-slate-900 text-white/40">
        <Presentation className="h-10 w-10" />
        <span className="text-xs">Aucune slide convertie</span>
        {/* v3.11.9 — la conversion est relancée automatiquement en arrière-plan
            par le serveur (ou via « Reconvertir » dans la bibliothèque) :
            les slides apparaîtront au prochain rafraîchissement (60 s). */}
        <span className="px-6 text-center text-[10px] leading-snug text-white/25">
          Reconversion en cours côté serveur — les slides apparaîtront automatiquement.
        </span>
      </div>
    )
  }
  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-900">
      {slides.map((src, i) => (
        <img
          key={src}
          src={src}
          alt={`${widget.media?.name || 'Slide'} ${i + 1}`}
          className="absolute inset-0 h-full w-full object-contain transition-opacity duration-500"
          style={{ opacity: i === idx ? 1 : 0 }}
        />
      ))}
      {slides.length > 1 && (
        <div className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white/80">
          {idx + 1} / {slides.length}
        </div>
      )}
    </div>
  )
}

// ============ Vidéo — son piloté par le CMS (§6) et boucle (§16) ============

function VideoWidget({ widget, cfg, loop }: { widget: WidgetData; cfg: Record<string, string>; loop: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  // v3.11.5 — repli élégant si le navigateur ne peut pas décoder le conteneur
  // (AVI, MPEG-PS, TS…) : carte explicative au lieu d'un rectangle noir.
  const [failed, setFailed] = useState(false)
  // Son : piloté UNIQUEMENT par la configuration CMS du widget (case « Démarrer
  // muet » de l'éditeur ; défaut muet pour respecter l'autoplay des navigateurs).
  // v3.11.14 — la préférence mémorisée de l'ancien bouton volume est retirée :
  // elle pouvait faire démarrer une vidéo avec le son contrairement à la
  // configuration CMS enregistrée sur le serveur.
  const wantSound = cfg.muted === 'false'

  // v3.11.13 — filets de lecture : montage explicite et re-tentative « canplay »
  // pour ne jamais laisser une vidéo figée sur la 1re image (refus d'autoplay).
  // v3.11.14 — le 1er geste utilisateur ne fait que lever la restriction
  // d'autoplay du navigateur (plus aucun réglage de volume local).
  useEffect(() => {
    const video = videoRef.current
    if (!video || failed) return
    robustPlay(video)
    const onCanPlay = () => { if (video.paused && !video.ended) robustPlay(video) }
    video.addEventListener('canplay', onCanPlay)
    // Premier geste sur la page : le navigateur autorise désormais le son
    // (activation collante). Si le CMS demande du son et que le navigateur
    // avait imposé le muet (refus d'autoplay initial), le geste rétablit
    // l'état voulu par la configuration CMS — jamais un choix local.
    const unlock = () => {
      if (wantSound && video.muted) {
        video.muted = false
        if (video.volume === 0) video.volume = 1
      }
      if (video.paused && !video.ended) robustPlay(video)
    }
    document.addEventListener('pointerdown', unlock, { passive: true })
    document.addEventListener('touchstart', unlock, { passive: true })
    document.addEventListener('keydown', unlock)
    return () => {
      video.removeEventListener('canplay', onCanPlay)
      document.removeEventListener('pointerdown', unlock)
      document.removeEventListener('touchstart', unlock)
      document.removeEventListener('keydown', unlock)
    }
  }, [widget.media?.url, failed, wantSound])

  // Attribution du ref : pose l'ATTRIBUT muted (defaultMuted) avant tout
  // chargement — condition d'autoplay sur Safari/Firefox/WebView que React
  // ne satisfait pas (il ne pose que la propriété). Re-posé uniquement si la
  // configuration muet du widget (CMS) change, jamais à chaque rendu.
  const attachVideo = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el
    if (el) {
      el.defaultMuted = !wantSound
      el.muted = !wantSound
    }
  }, [wantSound])

  if (!widget.media?.url) {
    return <div className="flex h-full w-full items-center justify-center text-white/40 text-sm">Aucune vidéo</div>
  }
  if (failed) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-slate-950 text-white/45">
        <VideoOff className="h-8 w-8" />
        <span className="px-4 text-center text-xs leading-snug">
          Format vidéo non lisible par ce navigateur
          <span className="text-white/25"> ({widget.media.name.split('.').pop()?.toUpperCase()})</span>
        </span>
        <span className="px-6 text-center text-[11px] text-white/25">
          Lisible sur le lecteur Android (VLC) — convertissez en MP4/H.264 pour le lecteur web
        </span>
      </div>
    )
  }
  return (
    <div className="relative h-full w-full">
      <video
        ref={attachVideo}
        src={widget.media.url}
        className="h-full w-full object-cover"
        style={{ objectFit: cfg.fit === 'contain' ? 'contain' : 'cover', backgroundColor: cfg.fit === 'contain' ? '#000' : undefined }}
        autoPlay
        muted={!wantSound}
        loop={loop && cfg.loop !== 'false'}
        playsInline
        onError={() => setFailed(true)}
        // Quand la boucle est désactivée : la vidéo s'arrête à la fin et gèle la dernière image
        // jusqu'à la fin de sa durée d'affichage configurée, puis passe au média suivant.
      />
    </div>
  )
}

// ============ Page web réelle et interactive (§5 / §25) ============

function WebpageWidget({ cfg, interactive }: { cfg: Record<string, string>; interactive: boolean }) {
  const url = cfg.url || ''
  // mode : « auto » (recommandé) = iframe direct puis proxy CMS si le site refuse
  // l'intégration ; « direct » = iframe seule ; « proxy » = toujours via le proxy
  const mode = cfg.mode === 'direct' || cfg.mode === 'proxy' ? cfg.mode : 'auto'
  // État de chargement indexé par la clé de la page : changer d'URL ou recharger
  // réinitialise l'état sans setState synchrone dans l'effet.
  const [loadState, setLoadState] = useState<{ key: string; loaded: boolean; timedOut: boolean }>({ key: '', loaded: false, timedOut: false })
  const [serverBlocked, setServerBlocked] = useState<{ url: string; reason: string | null } | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [proxyActive, setProxyActive] = useState(mode === 'proxy')
  const iframeRef = useRef<HTMLIFrameElement | null>(null)

  const normalizedUrl = (() => {
    if (!url) return ''
    return /^https?:\/\//i.test(url) ? url : `https://${url}`
  })()

  // Changement de mode ou d'URL : réinitialiser la bascule proxy
  // (ajustement d'état pendant le rendu — recommandé React, évite un effet de plus)
  const proxyResetKey = `${mode}|${normalizedUrl}`
  const [proxyResetPrev, setProxyResetPrev] = useState(proxyResetKey)
  if (proxyResetPrev !== proxyResetKey) {
    setProxyResetPrev(proxyResetKey)
    setProxyActive(mode === 'proxy')
    setServerBlocked(null)
  }

  // FORME CHEMIN : /api/webpage/proxy/https/site/chemin — les URLs relatives des
  // pages servies (liens, formulaires, navigations client) se résolvent dans le
  // proxy et ne peuvent plus échapper vers le site réel (X-Frame-Options).
  const iframeUrl = proxyActive
    ? `/api/webpage/proxy/${normalizedUrl.replace('://', '/')}`
    : normalizedUrl
  const uiKey = `${iframeUrl}|${reloadKey}`
  const page = loadState.key === uiKey ? loadState : { key: uiKey, loaded: false, timedOut: false }

  // Chargement trop long : en mode auto, tenter le proxy CMS avant d'afficher un diagnostic
  useEffect(() => {
    if (!normalizedUrl || proxyActive) return
    const t = setTimeout(() => {
      setLoadState((prev) =>
        prev.key === uiKey && !prev.loaded ? { ...prev, timedOut: true } : prev,
      )
    }, 12000)
    return () => clearTimeout(t)
  }, [uiKey, normalizedUrl, proxyActive, mode])

  // Bascule automatique vers le proxy si la page ne charge jamais (mode auto uniquement)
  // (réaction à un état asynchrone venu d'un autre effet : effet légitime, règle désactivée à dessein)
  useEffect(() => {
    if (mode === 'auto' && !proxyActive && page.timedOut && !page.loaded) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProxyActive(true)
    }
  }, [mode, proxyActive, page.timedOut, page.loaded])

  // Vérification serveur des en-têtes du site (fiable, contrairement au timeout navigateur).
  // Inutile en mode proxy : le proxy contourne les en-têtes de refus d'intégration.
  useEffect(() => {
    if (!normalizedUrl || proxyActive) return
    let cancelled = false
    fetch(`/api/webpage/embeddable?url=${encodeURIComponent(normalizedUrl)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) {
          if (d.embeddable === false) {
            setServerBlocked({ url: normalizedUrl, reason: d.reason ?? null })
            // §25 : ne jamais laisser une page « cassée » à l'écran — bascule automatique
            if (mode === 'auto') setProxyActive(true)
          } else {
            setServerBlocked(null)
          }
        }
      })
      .catch(() => { /* pas de diagnostic si la vérification échoue */ })
    return () => { cancelled = true }
  }, [normalizedUrl, reloadKey, proxyActive, mode])

  // Rafraîchissement automatique (minutes)
  useEffect(() => {
    const min = Number(cfg.refresh) || 0
    if (min <= 0) return
    const t = setInterval(() => setReloadKey((k) => k + 1), min * 60_000)
    return () => clearInterval(t)
  }, [cfg.refresh])

  if (!normalizedUrl) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-slate-800 text-slate-300">
        <GlobeHint />
        <span className="text-xs opacity-60">Aucune URL configurée pour cette page web</span>
      </div>
    )
  }

  const zoom = Number(cfg.zoom) || 100
  // Diagnostic : uniquement en mode direct — en proxy le contenu est toujours servi par le CMS
  const blocked =
    !proxyActive &&
    ((serverBlocked !== null && serverBlocked.url === normalizedUrl) ||
      (page.timedOut && !page.loaded))

  return (
    <div className="relative h-full w-full overflow-hidden bg-white" data-webpage-widget data-via-proxy={proxyActive ? '1' : '0'}>
      {/* iframe réelle : liens cliquables, formulaires, saisie de texte, navigation */}
      <div
        className="h-full w-full"
        style={{
          pointerEvents: interactive ? 'auto' : 'none',
          transform: zoom !== 100 ? `scale(${zoom / 100})` : undefined,
          transformOrigin: 'top left',
          width: zoom !== 100 ? `${10000 / zoom}%` : '100%',
          height: zoom !== 100 ? `${10000 / zoom}%` : '100%',
        }}
      >
        <iframe
          key={reloadKey}
          ref={iframeRef}
          src={iframeUrl}
          title="Page web"
          className="h-full w-full border-0"
          allow="autoplay; fullscreen; clipboard-write; encrypted-media; picture-in-picture"
          allowFullScreen
          referrerPolicy="no-referrer-when-downgrade"
          onLoad={() => setLoadState({ key: uiKey, loaded: true, timedOut: page.timedOut })}
        />
      </div>

      {/* Indicateur discret : la page est servie par le proxy CMS (site refusant l'intégration) */}
      {proxyActive && (
        <div
          className="absolute bottom-1.5 left-1.5 z-20 rounded-full bg-black/40 px-2 py-0.5 text-[10px] text-white/55"
          style={{ pointerEvents: 'none' }}
          title="Cette page est chargée via le proxy du CMS car elle refuse l'affichage intégré"
        >
          Via proxy CMS
        </div>
      )}

      {/* Aperçu CMS (interaction désactivée) : voile pour éviter les captures de clics parasites */}
      {!interactive && (
        <div className="pointer-events-none absolute inset-0 bg-transparent" title="Interaction désactivée dans l'aperçu du CMS" />
      )}

      {blocked && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-slate-900/95 p-6 text-center text-slate-200">
          <GlobeHint />
          <div className="max-w-md text-sm">
            Ce site refuse d&apos;être affiché dans une autre page
            <span className="text-slate-400"> {serverBlocked?.reason ? `(${serverBlocked.reason})` : '(en-tête X-Frame-Options / CSP)'}. C&apos;est une restriction imposée par le site lui-même.</span>
          </div>
          <a
            href={normalizedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600"
          >
            <ExternalLink className="h-4 w-4" /> Ouvrir dans un nouvel onglet
          </a>
        </div>
      )}

      {/* Contrôles discrets : recharger la page */}
      {interactive && (
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          className="absolute left-2 top-2 z-30 rounded-full bg-black/50 p-1.5 text-white/70 opacity-30 backdrop-blur-sm transition-opacity hover:opacity-100"
          title="Recharger la page"
          aria-label="Recharger la page web"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

function GlobeHint() {
  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-700/60 text-slate-300">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-6 w-6">
        <circle cx="12" cy="12" r="9" />
        <path d="M3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
      </svg>
    </div>
  )
}

// ============ Rendu principal d'un widget selon son type ============

export function WidgetRenderer({ widget, loop = true, interactive = true }: WidgetRendererProps) {
  const cfg = parseConfig(widget.config)

  switch (widget.type) {
    case 'clock':
      return <ClockWidget cfg={cfg} />
    case 'weather':
      return <WeatherWidget cfg={cfg} />
    case 'rss':
      return <RssWidget cfg={cfg} />
    case 'text':
      return <TextWidget cfg={cfg} />
    case 'image':
      return widget.media?.url ? (
        <ImageMedia url={widget.media.url} name={widget.media.name} />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-white/40">
          <ImageIcon className="h-10 w-10" />
        </div>
      )
    case 'video':
      return <VideoWidget widget={widget} cfg={cfg} loop={loop} />
    case 'presentation':
    case 'pdf':
      return <PresentationWidget widget={widget} loop={loop} />
    case 'iptv': {
      const channelUrl = cfg.channelUrl || cfg.url
      return channelUrl ? (
        <div className="relative h-full w-full" style={{ pointerEvents: interactive ? 'auto' : 'none' }}>
          <IptvStreamPlayer
            url={channelUrl}
            delay={Number(cfg.delay) || 0}
            className="h-full w-full"
            muted={cfg.muted !== 'false'}
            autoPlay
            controls={false}
          />
        </div>
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-slate-900 text-white/40">
          <Tv className="h-10 w-10" />
          <span className="text-xs">Aucune chaîne IPTV configurée</span>
        </div>
      )
    }
    case 'webpage':
      return <WebpageWidget cfg={cfg} interactive={interactive} />
    default:
      return (
        <div className="flex h-full w-full items-center justify-center gap-2 text-white/60">
          <Type className="h-5 w-5" /> {widget.name}
        </div>
      )
  }
}
