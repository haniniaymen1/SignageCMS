'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { KeyRound, Loader2, Maximize, Monitor, Wifi, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { WidgetRenderer, type WidgetData } from '@/components/cms/widget-renderer'

// ============ Types ============

interface ScheduleItem {
  id: string
  name: string
  type: 'layout' | 'campaign'
  layoutIds: string[]
  isPriority: boolean
  loop?: boolean // §16 v3.8+ — boucle ON/OFF décidée par événement
  start?: string // v3.11.12 — fenêtre de l'événement (ISO) ; sert de clé de version
  end?: string   //        un changement de fenêtre ré-arme un événement joué
}

interface Region {
  id: string
  name: string
  left: number
  top: number
  width: number
  height: number
  zIndex: number
  widgets: WidgetData[]
}

interface LayoutFull {
  id: string
  name: string
  duration: number
  backgroundColor: string
  backgroundImage?: string | null
  regions: Region[]
}

interface DisplayInfo {
  id: string
  name: string
  hardwareKey: string
  resolution: string
  group?: { id: string; name: string } | null
}

const STORAGE_KEY = 'cms-player-key'

// ============ Page lecteur ============

export default function PlayerPage() {
  const [phase, setPhase] = useState<'connect' | 'connecting' | 'play'>('connect')
  const [keyInput, setKeyInput] = useState('')
  const [connectError, setConnectError] = useState<string | null>(null)
  const [display, setDisplay] = useState<DisplayInfo | null>(null)
  const [items, setItems] = useState<ScheduleItem[]>([])
  const [itemIndex, setItemIndex] = useState(0)
  const [layoutIndex, setLayoutIndex] = useState(0)      // position dans une campagne multi-présentations
  const [globalLoop, setGlobalLoop] = useState(true)     // repli compat APK ≤ 2.3 (setting playerLoop)
  const [layout, setLayout] = useState<LayoutFull | null>(null)
  const [tick, setTick] = useState(0)          // secondes écoulées dans la présentation courante
  const [reloadNonce, setReloadNonce] = useState(0) // v3.11.10 — relance le chargement après un échec réseau
  const [finishedKeys, setFinishedKeys] = useState<Set<string>>(new Set()) // v3.11.12 — événements boucle OFF déjà joués
  const [online, setOnline] = useState(true)
  const [clock, setClock] = useState(new Date())

  const keyRef = useRef('')
  const proofRef = useRef<{ signature: string; startedAt: number }>({ signature: '', startedAt: Date.now() })
  const scheduleFetchedRef = useRef(false)
  const lastItemIdRef = useRef('')
  const lastItemStartRef = useRef('')

  // ---------- Connexion ----------
  const connect = useCallback(async (hardwareKey: string) => {
    const key = hardwareKey.trim()
    if (!key) { setConnectError('Veuillez saisir la clé de l\u2019écran.'); return }
    setPhase('connecting')
    setConnectError(null)
    try {
      const res = await fetch('/api/player/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hardwareKey: key,
          version: '1.0',
          resolution: `${window.screen?.width ?? 0}x${window.screen?.height ?? 0}`,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setConnectError(data.error || 'Écran introuvable sur ce serveur CMS.')
        setPhase('connect')
        return
      }
      keyRef.current = key
      localStorage.setItem(STORAGE_KEY, key)
      setDisplay(data.display)
      setPhase('play')
      scheduleFetchedRef.current = false
    } catch {
      setConnectError('Serveur CMS injoignable. Vérifiez l\u2019adresse du serveur et la connexion réseau.')
      setPhase('connect')
    }
  }, [])

  // Auto-connexion via ?key=CLÉ ou clé mémorisée
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const urlKey = params.get('key')
    const savedKey = localStorage.getItem(STORAGE_KEY)
    if (urlKey) { setKeyInput(urlKey); connect(urlKey) }
    else if (savedKey) { setKeyInput(savedKey); connect(savedKey) }
  }, [connect])

  // ---------- Planification ----------
  const fetchSchedule = useCallback(async () => {
    if (!keyRef.current) return
    try {
      const res = await fetch(`/api/player/schedule?hardwareKey=${encodeURIComponent(keyRef.current)}`)
      const data = await res.json()
      if (res.ok && data.ok) {
        setOnline(true)
        const nextItems: ScheduleItem[] = data.items || []
        setGlobalLoop(data.playerLoop !== false)
        setItems(nextItems)
        setItemIndex((idx) => (idx >= nextItems.length ? 0 : idx))
      } else {
        setOnline(false)
      }
    } catch {
      setOnline(false)
    }
  }, [])

  // Battement de cœur toutes les 30 s
  useEffect(() => {
    if (phase !== 'play' || !keyRef.current) return
    const sendHeartbeat = async () => {
      try {
        const res = await fetch('/api/player/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hardwareKey: keyRef.current }),
        })
        setOnline(res.ok)
      } catch { setOnline(false) }
    }
    sendHeartbeat()
    const t = setInterval(sendHeartbeat, 30_000)
    return () => clearInterval(t)
  }, [phase])

  // Rafraîchissement de la planification toutes les 30 s (v3.11.10 : respect
  // plus strict des heures de début/fin des événements — bascule ≤ 30 s)
  useEffect(() => {
    if (phase !== 'play') return
    fetchSchedule()
    const t = setInterval(fetchSchedule, 30_000)
    return () => clearInterval(t)
  }, [phase, fetchSchedule])

  // ---------- Chargement de la présentation courante ----------
  // v3.11.12 — les événements « boucle OFF » déjà joués une fois sont écartés
  // de la liste visible : le lecteur passe à l'événement suivant ou à l'écran
  // d'attente au lieu de rester figé sur la dernière présentation. La clé
  // id|start|end fait qu'une modification de la fenêtre de l'événement (ou la
  // réactivation de la boucle) rejoue la séquence normalement.
  const visibleItems = useMemo(
    () => items.filter((it) => it.loop || !finishedKeys.has(`${it.id}|${it.start ?? ''}|${it.end ?? ''}`)),
    [items, finishedKeys]
  )
  const currentItem: ScheduleItem | undefined = visibleItems[itemIndex]

  // §16 v3.8+ — la boucle est decidée PAR ÉVÉNEMENT (item.loop) ; repli sur le
  // setting global si un serveur ancien ne renvoie pas la boucle de l'item.
  const eventLoop = currentItem ? currentItem.loop ?? globalLoop : true

  // Garde-fou : l'index d'item doit rester dans la liste VISIBLE (v3.11.12)
  useEffect(() => {
    if (itemIndex >= visibleItems.length) setItemIndex(0)
  }, [visibleItems.length, itemIndex])

  // Changement d'événement planifié : repartir de la première présentation,
  // chrono remis à zéro (v3.11.10 — y compris si la même présentation est
  // réutilisée par l'événement suivant, cas où aucun rechargement n'aurait lieu).
  // v3.11.12 — la fenêtre (start) fait partie de l'identité : un événement
  // re-programmé ou rejoué après sa fenêtre précédente repart du début.
  useEffect(() => {
    if (currentItem?.id && (currentItem.id !== lastItemIdRef.current || currentItem.start !== lastItemStartRef.current)) {
      lastItemIdRef.current = currentItem.id
      lastItemStartRef.current = currentItem.start ?? ''
      setLayoutIndex(0)
      setTick(0)
    }
  }, [currentItem?.id, currentItem?.start])

  // Changement de mode boucle (événement suivant) : repartir du début de la séquence
  useEffect(() => {
    setTick(0)
  }, [currentItem?.loop])

  // v3.11.10 — campagne raccourcie pendant la lecture (édition ▲▼/suppression) :
  // ramène l'index dans les bornes réelles de la séquence pour rester synchronisé
  useEffect(() => {
    const len = currentItem?.layoutIds?.length ?? 0
    if (len > 0 && layoutIndex >= len) setLayoutIndex(0)
  }, [currentItem?.layoutIds?.length, layoutIndex])

  useEffect(() => {
    const targetLayoutId = currentItem?.layoutIds?.[layoutIndex] ?? currentItem?.layoutIds?.[0]
    if (phase !== 'play' || !targetLayoutId) { setLayout(null); return }
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    fetch(`/api/resource/layouts/${targetLayoutId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('introuvable'))))
      .then((l: LayoutFull) => { if (!cancelled) { setLayout(l); setTick(0) } })
      .catch(() => {
        if (cancelled) return
        setLayout(null)
        // v3.11.10 — relance automatique : sans cela le lecteur restait bloqué
        // sur le spinner (l'effet ne se redéclenche pas, l'ID n'ayant pas changé)
        retryTimer = setTimeout(() => { if (!cancelled) setReloadNonce((n) => n + 1) }, 5_000)
      })
    return () => { cancelled = true; if (retryTimer) clearTimeout(retryTimer) }
  }, [phase, currentItem?.layoutIds?.[layoutIndex], reloadNonce])

  // ---------- Horloge / cycle de lecture ----------
  useEffect(() => {
    if (phase !== 'play') return
    const t = setInterval(() => { setTick((v) => v + 1); setClock(new Date()) }, 1000)
    return () => clearInterval(t)
  }, [phase])

  // ---------- Rotation des présentations selon leur durée (v3.11.12) ----------
  // - campagne : enchaîne TOUTES ses présentations dans l'ordre défini (displayOrder)
  // - boucle ON (événement, §16) : reprend au début après la fin
  // - boucle OFF (v3.11.12) : la séquence est jouée UNE fois, chaque présentation
  //   respecte sa durée, puis le lecteur QUITTE le contenu de l'événement →
  //   événement suivant, sinon écran d'attente (fini le figeage sur la dernière)
  //
  // CORRECTIF v3.11.10 (bug « ordre + durées non respectés ») : l'ancienne version
  // avançait l'index SANS remettre le chrono à zéro. Comme `layoutIndex` figure
  // dans les dépendances, l'effet se ré-exécutait aussitôt (tick valait toujours
  // un multiple de la durée) et avançait ENCORE — une cascade qui ne s'arrêtait
  // qu'à l'aboutissement d'un chargement, laissant l'index à une position
  // aléatoire : présentations sautées/répétées (ordre cassé) et durées erratiques.
  // Désormais chaque rotation remet `tick` à zéro dans le même lot de mises à
  // jour → exactement UNE avance par échéance, chronomètre repartant à l'instant
  // précis de la bascule (durées fidèles, ordre displayOrder strictement suivi).
  useEffect(() => {
    if (phase !== 'play' || !layout) return
    const dur = Math.max(layout.duration || 60, 10)
    if (tick <= 0 || tick % dur !== 0) return
    const ids = currentItem?.layoutIds ?? []
    // Une seule avance par échéance : chaque transition remet le chrono à zéro
    // DANS LE MÊME LOT que le changement d'index → le ré-exécution immédiate de
    // cet effet (déclenchée par le nouvel index) bute sur `tick <= 0` et stoppe
    // net toute cascade.
    if (layoutIndex + 1 < ids.length) {
      setTick(0)
      setLayoutIndex(Math.min(layoutIndex + 1, ids.length - 1))
    } else if (eventLoop && visibleItems.length > 1) {
      setTick(0)
      setLayoutIndex(0)
      setItemIndex((i) => (i + 1) % visibleItems.length)
    } else if (eventLoop && ids.length > 1) {
      setTick(0)
      setLayoutIndex(0)
    } else if (!eventLoop) {
      // v3.11.12 — boucle OFF, fin de séquence : l'événement a été joué UNE fois
      // (chaque présentation restée fidèlement sa durée). On QUITTE ce contenu :
      // l'événement est marqué « joué » et écarté de la liste visible → le
      // lecteur enchaîne sur l'événement suivant, sinon écran d'attente (horloge).
      // Correction du comportement v3.11.10 qui figeait la dernière présentation.
      const fkey = `${currentItem?.id ?? ''}|${currentItem?.start ?? ''}|${currentItem?.end ?? ''}`
      setTick(0)
      setLayoutIndex(0)
      setFinishedKeys((prev) => new Set(prev).add(fkey))
      setItemIndex((i) => (i + 1 < visibleItems.length ? i + 1 : 0))
    }
  }, [phase, tick, layout, currentItem?.layoutIds, layoutIndex, eventLoop, visibleItems.length, itemIndex])

  // ---------- Widgets actifs (cycle par durée) ----------
  // Boucle ON (événement) : cycle permanent ; Boucle OFF : la séquence est jouée
  // une fois, puis le dernier widget de chaque région reste affiché (aucune reprise).
  const activeWidgets = useMemo(() => {
    const map = new Map<string, WidgetData>()
    if (!layout?.regions) return map
    for (const region of layout.regions) {
      const widgets = [...(region.widgets ?? [])].sort((a, b) => a.position - b.position)
      if (widgets.length === 0) continue
      const total = widgets.reduce((s, w) => s + (w.duration || 10), 0)
      let elapsed = eventLoop ? tick % Math.max(total, 1) : Math.min(tick, Math.max(total, 1) - 1)
      for (const w of widgets) {
        const d = w.duration || 10
        if (elapsed < d) { map.set(region.id, w); break }
        elapsed -= d
      }
    }
    return map
  }, [layout, tick, eventLoop])

  // ---------- Preuve de diffusion (proof of play) ----------
  useEffect(() => {
    if (phase !== 'play') return
    const parts: string[] = []
    activeWidgets.forEach((w, regionId) => {
      parts.push(`${regionId}:${w.name}${w.media?.name ? `/${w.media.name}` : ''}`)
    })
    const signature = parts.join('|')
    const prev = proofRef.current
    if (prev.signature && prev.signature !== signature) {
      const duration = Math.round((Date.now() - prev.startedAt) / 1000)
      const widgetLabel = prev.signature.split('|')[0]?.split(':')[1] || 'Inconnu'
      if (duration >= 1) {
        fetch('/api/player/stats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            hardwareKey: keyRef.current,
            media: widgetLabel,
            layout: layout?.name || prev.signature,
            count: 1,
            duration,
          }),
        }).catch(() => { /* silencieux */ })
      }
    }
    if (prev.signature !== signature) proofRef.current = { signature, startedAt: Date.now() }
  }, [phase, activeWidgets, layout?.name])

  // ---------- Wake Lock (l'écran reste allumé) ----------
  useEffect(() => {
    if (phase !== 'play') return
    let sentinel: { release: () => Promise<void> } | null = null
    const request = async () => {
      try {
        const wl = await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen')
        if (wl) sentinel = wl
      } catch { /* non supporté */ }
    }
    request()
    const onVis = () => { if (document.visibilityState === 'visible') request() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      sentinel?.release().catch(() => { /* noop */ })
    }
  }, [phase])

  // ---------- Plein écran ----------
  const goFullscreen = () => {
    const el = document.documentElement
    if (!document.fullscreenElement) el.requestFullscreen?.().catch(() => { /* noop */ })
    else document.exitFullscreen?.().catch(() => { /* noop */ })
  }

  // ============ Écran de connexion ============

  if (phase !== 'play') {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-slate-950 p-6"
        style={{ cursor: 'default' }}
      >
        <div className="w-full max-w-md">
          <div className="mb-8 flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-500/15 text-orange-500">
              <Monitor className="h-8 w-8" />
            </div>
            <h1 className="mt-4 text-2xl font-bold text-white">Lecteur d&apos;affichage</h1>
            <p className="mt-1 text-sm text-slate-400">
              Connectez cet appareil au serveur CMS avec la clé de l&apos;écran
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-2xl">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="display-key" className="text-slate-300">Clé de l&apos;écran</Label>
                <Input
                  id="display-key"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && phase === 'connect' && connect(keyInput)}
                  placeholder="Ex : KEY-MZ3X8A"
                  className="border-slate-700 bg-slate-950 font-mono text-slate-100 placeholder:text-slate-600"
                  autoComplete="off"
                  autoFocus
                />
                <p className="text-xs text-slate-500">
                  La clé se trouve dans le CMS : <span className="text-slate-400">Écrans → ⋯ → Connecter Android</span>
                </p>
              </div>

              {connectError && (
                <div className="rounded-lg border border-red-900/60 bg-red-950/40 p-3 text-sm text-red-300">
                  {connectError}
                </div>
              )}

              <Button
                className="w-full bg-orange-500 hover:bg-orange-600"
                disabled={phase === 'connecting'}
                onClick={() => connect(keyInput)}
              >
                {phase === 'connecting' ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Connexion…</>
                ) : (
                  <><KeyRound className="mr-2 h-4 w-4" /> Se connecter au CMS</>
                )}
              </Button>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-600">
            <Monitor className="h-3.5 w-3.5" />
            SignageCMS Player · compatible Android / TV Box / Tablettes
          </div>

          <button
            onClick={goFullscreen}
            className="mx-auto mt-4 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-900 hover:text-slate-300"
          >
            <Maximize className="h-3.5 w-3.5" /> Passer en plein écran
          </button>
        </div>
      </div>
    )
  }

  // ============ Écran de lecture ============

  return (
    <div className="fixed inset-0 overflow-hidden bg-slate-950" style={{ cursor: 'none' }} data-tick={tick} data-layout-index={layoutIndex} data-item-index={itemIndex} data-dur={layout?.duration ?? 0}>
      {layout ? (
        <div
          className="relative h-full w-full"
          style={{ backgroundColor: layout.backgroundColor }}
        >
          {[...(layout.regions ?? [])]
            .sort((a, b) => a.zIndex - b.zIndex)
            .map((region) => {
              const active = activeWidgets.get(region.id)
              return (
                <div
                  key={region.id}
                  className="absolute overflow-hidden"
                  style={{
                    left: `${region.left}%`,
                    top: `${region.top}%`,
                    width: `${region.width}%`,
                    height: `${region.height}%`,
                    zIndex: region.zIndex,
                  }}
                >
                  {active ? (
                    <WidgetRenderer widget={active} loop={eventLoop} interactive />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-white/5 text-white/30">
                      <span className="text-xs">Région vide</span>
                    </div>
                  )}
                </div>
              )
            })}
          {(layout.regions ?? []).length === 0 && (
            <div className="flex h-full w-full items-center justify-center text-white/40">
              Présentation vide — ajoutez des régions dans le CMS
            </div>
          )}
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-4 text-center">
          <div className="text-6xl font-bold text-white tabular-nums">
            {clock.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', hour12: false })}
          </div>
          <div className="text-xl text-slate-300 capitalize">
            {clock.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
          <div className="mt-4 rounded-full border border-slate-800 bg-slate-900/60 px-4 py-1.5 text-sm text-slate-400">
            {display?.name} · Aucune présentation programmée
          </div>
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center text-slate-600">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      )}

      {/* Bandeau d'état discret */}
      <div className="pointer-events-none absolute bottom-3 right-3 z-50 flex items-center gap-2 rounded-full bg-black/40 px-3 py-1 text-[11px] text-white/50 backdrop-blur-sm">
        {online ? <Wifi className="h-3 w-3 text-emerald-400" /> : <WifiOff className="h-3 w-3 text-red-400" />}
        <span>{display?.name}</span>
        {currentItem && items.length > 0 && (
          <span className="text-white/30">· {currentItem.name}</span>
        )}
      </div>

      {/* Bouton plein écran discret */}
      <button
        onClick={goFullscreen}
        className="absolute right-3 top-3 z-50 rounded-full bg-black/40 p-2 text-white/40 opacity-30 backdrop-blur-sm transition-opacity hover:opacity-100"
        style={{ cursor: 'default' }}
        aria-label="Plein écran"
      >
        <Maximize className="h-4 w-4" />
      </button>
    </div>
  )
}
