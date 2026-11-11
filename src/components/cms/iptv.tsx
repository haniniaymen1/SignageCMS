'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Tv, Plus, Search, Play, Trash2, RefreshCw, Radio, ListPlus, FolderPlus,
  Link2, FileUp, ClipboardPaste, CircleAlert, CircleCheck, Loader2, Globe,
  Server, CalendarClock, Signal, Clapperboard, Library, Clock3, ShieldCheck,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { formatDate } from './api-client'
import IptvStreamPlayer from './iptv-player'

interface IptvSource {
  id: string
  name: string
  sourceType: string
  url: string | null
  channelCount: number
  status: string
  error: string | null
  createdAt: string
  _count: { channels: number }
}

export interface IptvChannel {
  id: string
  name: string
  url: string
  logo: string | null
  group: string | null
  tvgId: string | null
  language: string | null
  kind?: string // playlist | live | vod | series
  streamId?: string | null
  providerId?: string | null // compte Xtream d'origine — multi-comptes
}

interface XtreamProvider {
  id: string
  name: string
  host: string
  username: string
  status: string // connected | error | expired
  expiry: string | null
  maxConnections: number
  activeConnections: number
  isTrial: boolean
  timezone: string | null
  allowedFormats: string | null
  lastError: string | null
  lastSyncAt: string | null
  liveCount: number
  vodCount: number
  seriesCount: number
}

interface SeriesEpisode {
  id: string
  episodeNum: number
  title: string
  image: string | null
  plot: string | null
  duration: string | null
  url: string
}

interface SeriesInfoData {
  name: string | null
  cover: string | null
  plot: string | null
  genre: string | null
  seasons: Array<{ season: number; episodes: SeriesEpisode[] }>
}

interface PoolProviderUi {
  providerId: string
  name: string
  max: number
  used: number
  starting: number
  available: number
}

interface HubInfoUi {
  url: string
  channel: string | null
  provider: string | null
  providerMax: number
  viewers: number
  bytes: number
  failover: boolean
  recording: boolean
  bufferedSeconds: number
  delayedViewers: number
  recordPersist: boolean
}

const KIND_LABELS: Record<string, { label: string; cls: string }> = {
  live: { label: 'LIVE', cls: 'bg-red-500 text-white' },
  vod: { label: 'VOD', cls: 'bg-sky-500 text-white' },
  series: { label: 'SÉRIE', cls: 'bg-violet-500 text-white' },
}

interface PlaylistLight { id: string; name: string }

const EXAMPLE_LISTS = [
  { name: 'France — iptv-org', url: 'https://iptv-org.github.io/iptv/countries/fr.m3u' },
  { name: 'Généraliste monde — iptv-org (échantillon)', url: 'https://iptv-org.github.io/iptv/languages/fra.m3u' },
]

const PAGE_SIZE = 96

export default function IptvView() {
  const { toast } = useToast()

  // Sources
  const [sources, setSources] = useState<IptvSource[]>([])
  const [totalChannels, setTotalChannels] = useState(0)
  const [sourcesLoading, setSourcesLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [refreshingId, setRefreshingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<IptvSource | null>(null)
  const [form, setForm] = useState<{ name: string; sourceType: string; url: string; content: string }>({
    name: '', sourceType: 'url', url: '', content: '',
  })
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Chaînes
  const [channels, setChannels] = useState<IptvChannel[]>([])
  const [channelTotal, setChannelTotal] = useState(0)
  const [groups, setGroups] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [groupFilter, setGroupFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [channelsLoading, setChannelsLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [preview, setPreview] = useState<IptvChannel | null>(null)

  // Ajout à playlist
  const [playlists, setPlaylists] = useState<PlaylistLight[]>([])
  const [playlistDlg, setPlaylistDlg] = useState<IptvChannel | null>(null)
  const [targetPlaylist, setTargetPlaylist] = useState('')

  // Portail Xtream — MULTI-COMPTES
  const [providers, setProviders] = useState<XtreamProvider[]>([])
  const [providerLoading, setProviderLoading] = useState(true)
  const [xtTab, setXtTab] = useState('channels')
  const [xtFormOpen, setXtFormOpen] = useState(false)
  const [xtForm, setXtForm] = useState({ name: '', host: '', username: '', password: '' })
  const [connecting, setConnecting] = useState(false)
  const [syncing, setSyncing] = useState<string | null>(null) // clé « providerId:type »
  const [deleteAccountTarget, setDeleteAccountTarget] = useState<XtreamProvider | null>(null)
  const [kindFilter, setKindFilter] = useState('all')
  const [accountFilter, setAccountFilter] = useState('all') // filtre chaînes par compte Xtream

  // Séries — épisodes
  const [series, setSeries] = useState<IptvChannel | null>(null)
  const [seriesInfo, setSeriesInfo] = useState<SeriesInfoData | null>(null)
  const [seriesLoading, setSeriesLoading] = useState(false)
  const [playingEpisode, setPlayingEpisode] = useState<SeriesEpisode | null>(null)

  // Connexions actives + pool multi-comptes + mode strict + timeshift
  const [conns, setConns] = useState<{ hubs: HubInfoUi[]; pool: { strict: boolean; providers: PoolProviderUi[] } } | null>(null)
  // Timeshift de l'aperçu : décalage choisi + état enregistrement de la chaîne
  const [previewDelay, setPreviewDelay] = useState('0')
  const [previewRecording, setPreviewRecording] = useState(false)

  const loadSources = useCallback(async () => {
    try {
      const res = await fetch('/api/iptv/playlists')
      const data = await res.json()
      setSources(data.playlists ?? [])
      setTotalChannels(data.totalChannels ?? 0)
    } catch {
      // silencieux
    } finally {
      setSourcesLoading(false)
    }
  }, [])

  const loadPlaylists = useCallback(async () => {
    try {
      const res = await fetch('/api/resource/playlists')
      const data = await res.json()
      setPlaylists(data ?? [])
    } catch {
      // silencieux
    }
  }, [])

  useEffect(() => {
    loadSources()
    loadPlaylists()
  }, [loadSources, loadPlaylists])

  const loadProviders = useCallback(async () => {
    try {
      const res = await fetch('/api/iptv/xtream')
      const data = await res.json()
      setProviders(data.providers ?? [])
    } catch {
      // silencieux
    } finally {
      setProviderLoading(false)
    }
  }, [])

  useEffect(() => {
    loadProviders()
  }, [loadProviders])

  // Connexions actives / pool / mode strict — rafraîchissement continu
  const loadConns = useCallback(async () => {
    try {
      const res = await fetch('/api/iptv/connections')
      if (!res.ok) return
      const data = await res.json()
      setConns({ hubs: data.hubs ?? [], pool: data.pool ?? { strict: false, providers: [] } })
    } catch {
      // silencieux
    }
  }, [])

  useEffect(() => {
    loadConns()
    const t = setInterval(loadConns, 4000)
    return () => clearInterval(t)
  }, [loadConns])

  // Bascule du mode strict (protection anti-dépassement des quotas)
  const toggleStrict = useCallback(async (v: boolean) => {
    try {
      const res = await fetch('/api/iptv/connections', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strict: v }),
      })
      if (!res.ok) throw new Error()
      toast({ title: v ? 'Mode strict activé' : 'Mode strict désactivé', description: v ? 'Le serveur refusera toute connexion au-delà des quotas déclarés (protection anti-ban).' : 'Le serveur laissera le portail trancher en cas de dépassement.' })
      loadConns()
    } catch {
      toast({ title: 'Modification impossible', variant: 'destructive' })
    }
  }, [toast, loadConns])

  // Enregistrement timeshift d'une chaîne (on/off) depuis l'aperçu
  const toggleRecording = useCallback(async (ch: IptvChannel, on: boolean) => {
    try {
      const res = await fetch('/api/iptv/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: ch.url, timeshift: on ? 'on' : 'off', ch: ch.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Erreur')
      setPreviewRecording(on)
      toast({
        title: on ? 'Enregistrement démarré' : 'Enregistrement arrêté',
        description: on
          ? 'La chaîne est enregistrée sur disque (timeshift) : elle peut être rediffusée avec un décalage sur N écrans — une seule connexion fournisseur.'
          : 'Le tampon a été supprimé.',
      })
      loadConns()
    } catch (e) {
      toast({ title: 'Timeshift', description: e instanceof Error ? e.message : 'Erreur', variant: 'destructive' })
    }
  }, [toast, loadConns])

  // Synchronise l'état enregistrement/décalage quand l'aperçu s'ouvre
  useEffect(() => {
    if (!preview) {
      setPreviewDelay('0')
      return
    }
    setPreviewDelay('0')
    let alive = true
    fetch('/api/iptv/connections')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d) return
        const hub = (d.hubs ?? []).find((h: { url: string }) => h.url === preview.url)
        setPreviewRecording(Boolean(hub?.recording))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [preview])

  // Recherche débouncée
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 400)
    return () => clearTimeout(t)
  }, [search])

  const loadChannels = useCallback(
    async (reset: boolean, skip = 0) => {
      const params = new URLSearchParams({ take: String(PAGE_SIZE), skip: String(skip), meta: '1' })
      if (debounced) params.set('search', debounced)
      if (groupFilter !== 'all') params.set('group', groupFilter)
      if (sourceFilter !== 'all') params.set('playlistId', sourceFilter)
      if (kindFilter !== 'all') params.set('kind', kindFilter)
      if (accountFilter !== 'all') params.set('providerId', accountFilter)
      try {
        const res = await fetch(`/api/iptv/channels?${params.toString()}`)
        const data = await res.json()
        setChannels((prev) => (reset ? (data.items ?? []) : [...prev, ...(data.items ?? [])]))
        setChannelTotal(data.total ?? 0)
        if (reset) setGroups(data.groups ?? [])
      } catch {
        // silencieux
      }
    },
    [debounced, groupFilter, sourceFilter, kindFilter, accountFilter]
  )

  const initialLoad = useRef(false)
  useEffect(() => {
    if (!initialLoad.current) {
      initialLoad.current = true
    }
    setChannelsLoading(true)
    const p = loadChannels(true).finally(() => setChannelsLoading(false))
    return () => { void p }
  }, [loadChannels])

  const loadMore = async () => {
    setLoadingMore(true)
    await loadChannels(false, channels.length)
    setLoadingMore(false)
  }

  // ===== Gestion des sources =====
  const handleFile = async (file: File) => {
    const text = await file.text()
    setForm((f) => ({ ...f, sourceType: 'file', content: text, name: f.name || file.name.replace(/\.m3u8?$/i, '') }))
  }

  const importSource = async (presetName?: string, presetUrl?: string) => {
    const name = (presetName ?? form.name).trim()
    const url = (presetUrl ?? form.url).trim()
    if (!name) { toast({ title: 'Nom requis', variant: 'destructive' }); return }
    if (form.sourceType === 'url' && !url) { toast({ title: 'URL requise', variant: 'destructive' }); return }
    if (form.sourceType === 'paste' && !form.content.trim()) { toast({ title: 'Contenu requis', variant: 'destructive' }); return }
    if (form.sourceType === 'file' && !form.content.trim()) { toast({ title: 'Choisissez un fichier M3U', variant: 'destructive' }); return }

    setImporting(true)
    try {
      const res = await fetch('/api/iptv/playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, sourceType: form.sourceType, url, content: form.content }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Import impossible')
      toast({ title: 'Playlist importée', description: `${data.imported} chaîne(s) ajoutée(s)` })
      setAddOpen(false)
      setForm({ name: '', sourceType: 'url', url: '', content: '' })
      await loadSources()
      await loadChannels(true)
    } catch (e) {
      toast({ title: "Échec de l'import", description: e instanceof Error ? e.message : 'Erreur', variant: 'destructive' })
    } finally {
      setImporting(false)
    }
  }

  const refreshSource = async (src: IptvSource) => {
    setRefreshingId(src.id)
    try {
      const res = await fetch(`/api/iptv/playlists/${src.id}`, { method: 'PATCH' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Rafraîchissement impossible')
      toast({ title: 'Source rafraîchie', description: `${data.imported} chaîne(s)` })
      await loadSources()
      await loadChannels(true)
    } catch (e) {
      toast({ title: 'Erreur', description: e instanceof Error ? e.message : 'Erreur', variant: 'destructive' })
    } finally {
      setRefreshingId(null)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    const res = await fetch(`/api/iptv/playlists/${deleteTarget.id}`, { method: 'DELETE' })
    if (res.ok) {
      toast({ title: 'Source supprimée', description: deleteTarget.name })
      await loadSources()
      await loadChannels(true)
    }
    setDeleteTarget(null)
  }

  // ===== Portail Xtream (multi-comptes) =====
  const connectXtream = async () => {
    if (!xtForm.host.trim() || !xtForm.username.trim() || !xtForm.password.trim()) {
      toast({ title: 'Champs requis', description: 'URL du portail, utilisateur et mot de passe.', variant: 'destructive' })
      return
    }
    setConnecting(true)
    try {
      const res = await fetch('/api/iptv/xtream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(xtForm),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Connexion impossible')
      toast({ title: 'Compte Xtream ajouté', description: `${data.provider.name} — compte ${data.provider.status === 'expired' ? 'expiré' : 'actif'}` })
      setXtForm({ name: '', host: '', username: '', password: '' })
      setXtFormOpen(false)
      await loadProviders()
    } catch (e) {
      toast({ title: 'Échec de connexion', description: e instanceof Error ? e.message : 'Erreur', variant: 'destructive' })
    } finally {
      setConnecting(false)
    }
  }

  const syncXtream = async (type: 'live' | 'vod' | 'series' | 'all', providerId: string) => {
    setSyncing(`${providerId}:${type}`)
    try {
      const res = await fetch('/api/iptv/xtream/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, providerId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Synchronisation impossible')
      const updated = data.provider as XtreamProvider
      setProviders((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)))
      const r = data.imported
      toast({
        title: 'Synchronisation terminée',
        description: `${r.live} live · ${r.vod} VOD · ${r.series} séries importé(s)`,
      })
      await loadChannels(true)
    } catch (e) {
      toast({ title: 'Échec de la synchronisation', description: e instanceof Error ? e.message : 'Erreur', variant: 'destructive' })
    } finally {
      setSyncing(null)
    }
  }

  const deleteXtreamAccount = async () => {
    if (!deleteAccountTarget) return
    const res = await fetch(`/api/iptv/xtream?id=${encodeURIComponent(deleteAccountTarget.id)}`, { method: 'DELETE' })
    if (res.ok) {
      toast({ title: 'Compte supprimé', description: `${deleteAccountTarget.name} et ses contenus importés ont été retirés.` })
      await loadProviders()
      await loadChannels(true)
    } else {
      toast({ title: 'Erreur', description: 'Suppression impossible', variant: 'destructive' })
    }
    setDeleteAccountTarget(null)
  }

  // ===== Séries — chargement des épisodes =====
  const openSeries = async (ch: IptvChannel) => {
    setSeries(ch)
    setSeriesInfo(null)
    setPlayingEpisode(null)
    setSeriesLoading(true)
    try {
      const res = await fetch(`/api/iptv/xtream/series-info?seriesId=${encodeURIComponent(ch.streamId || '')}${ch.providerId ? `&providerId=${encodeURIComponent(ch.providerId)}` : ''}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Épisodes indisponibles')
      setSeriesInfo(data)
    } catch (e) {
      toast({ title: 'Erreur', description: e instanceof Error ? e.message : 'Chargement impossible', variant: 'destructive' })
      setSeries(null)
    } finally {
      setSeriesLoading(false)
    }
  }

  // ===== Actions sur les chaînes =====
  const addToMediaLibrary = async (ch: IptvChannel) => {
    const res = await fetch('/api/resource/media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: ch.name,
        type: 'stream',
        fileName: ch.name,
        url: ch.url,
        duration: 0,
        fileSize: 0,
      }),
    })
    if (res.ok) {
      toast({ title: 'Ajouté à la médiathèque', description: `${ch.name} (flux IPTV)` })
    } else {
      toast({ title: 'Erreur', description: 'Ajout impossible', variant: 'destructive' })
    }
  }

  const addToPlaylist = async () => {
    if (!playlistDlg || !targetPlaylist) return
    const res = await fetch('/api/resource/widgets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playlistId: targetPlaylist,
        type: 'iptv',
        name: playlistDlg.name,
        duration: 60,
        position: 99,
        config: JSON.stringify({ channelUrl: playlistDlg.url, channelName: playlistDlg.name }),
      }),
    })
    if (res.ok) {
      toast({ title: 'Chaîne ajoutée à la playlist', description: playlistDlg.name })
      setPlaylistDlg(null)
      setTargetPlaylist('')
    } else {
      toast({ title: 'Erreur', description: 'Ajout impossible', variant: 'destructive' })
    }
  }

  const channelCard = (ch: IptvChannel) => {
    const kindMeta = ch.kind ? KIND_LABELS[ch.kind] : undefined
    return (
    <Card key={ch.id} className="group overflow-hidden border-slate-200 transition-shadow hover:shadow-md">
      <div className="relative flex h-24 items-center justify-center bg-slate-50">
        {ch.logo ? (
          <img
            src={ch.logo}
            alt={ch.name}
            className="max-h-20 max-w-[80%] object-contain p-2"
            loading="lazy"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        ) : (
          ch.kind === 'vod' ? <Clapperboard className="h-8 w-8 text-slate-300" />
            : ch.kind === 'series' ? <Library className="h-8 w-8 text-slate-300" />
            : <Tv className="h-8 w-8 text-slate-300" />
        )}
        {kindMeta && (
          <span className={`absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide ${kindMeta.cls}`}>
            {kindMeta.label}
          </span>
        )}
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
          <Button
            size="sm"
            className="h-8 bg-orange-500 hover:bg-orange-600"
            onClick={() => (ch.kind === 'series' ? openSeries(ch) : setPreview(ch))}
          >
            <Play className="h-3.5 w-3.5" /> {ch.kind === 'series' ? 'Épisodes' : 'Aperçu'}
          </Button>
        </div>
      </div>
      <CardContent className="p-3">
        <div className="truncate text-sm font-medium text-slate-800" title={ch.name}>{ch.name}</div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <Badge variant="outline" className="max-w-full truncate border-slate-200 text-[10px] text-slate-500">
            {ch.group || 'Sans groupe'}
          </Badge>
          {ch.kind !== 'series' && (
            <div className="flex shrink-0 gap-0.5">
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Ajouter à la médiathèque" onClick={() => addToMediaLibrary(ch)}>
                <FolderPlus className="h-3.5 w-3.5 text-slate-500" />
              </Button>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Ajouter à une playlist" onClick={() => setPlaylistDlg(ch)}>
                <ListPlus className="h-3.5 w-3.5 text-slate-500" />
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
    )
  }

  // Carte d'un compte Xtream (une par portail — multi-comptes)
  const providerCard = (p: XtreamProvider) => (
    <Card key={p.id} className="border-slate-200">
      <CardContent className="space-y-5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-800 text-white">
              <Server className="h-6 w-6" />
            </div>
            <div>
              <div className="text-lg font-semibold text-slate-900">{p.name}</div>
              <div className="font-mono text-xs text-slate-400">{p.host} · {p.username}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {p.status === 'connected' && (
              <Badge className="border-transparent bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                <CircleCheck className="mr-1 h-3.5 w-3.5" /> Connecté
              </Badge>
            )}
            {p.status === 'expired' && (
              <Badge className="border-transparent bg-red-100 text-red-700 hover:bg-red-100">
                <CircleAlert className="mr-1 h-3.5 w-3.5" /> Abonnement expiré
              </Badge>
            )}
            {p.status === 'error' && (
              <Badge className="border-transparent bg-amber-100 text-amber-700 hover:bg-amber-100">
                <CircleAlert className="mr-1 h-3.5 w-3.5" /> Erreur
              </Badge>
            )}
            {p.isTrial && (
              <Badge variant="outline" className="border-slate-200 text-slate-500">Essai</Badge>
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
            <div className="flex items-center gap-1.5 text-xs text-slate-500"><CalendarClock className="h-3.5 w-3.5" /> Expire le</div>
            <div className="mt-1 text-sm font-semibold text-slate-800">{p.expiry ? formatDate(p.expiry) : 'Illimité'}</div>
          </div>
          <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
            <div className="flex items-center gap-1.5 text-xs text-slate-500"><Signal className="h-3.5 w-3.5" /> Connexions</div>
            <div className="mt-1 text-sm font-semibold text-slate-800">{p.activeConnections} active(s) / max {p.maxConnections || '∞'}</div>
          </div>
          <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
            <div className="flex items-center gap-1.5 text-xs text-slate-500"><Clock3 className="h-3.5 w-3.5" /> Dernière synchro</div>
            <div className="mt-1 text-sm font-semibold text-slate-800">{p.lastSyncAt ? formatDate(p.lastSyncAt) : 'Jamais'}</div>
          </div>
          <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
            <div className="flex items-center gap-1.5 text-xs text-slate-500"><Globe className="h-3.5 w-3.5" /> Fuseau / Formats</div>
            <div className="mt-1 truncate text-sm font-semibold text-slate-800">{p.timezone || '—'} · {p.allowedFormats || '—'}</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="flex items-center gap-3 rounded-lg border border-red-100 bg-red-50/50 p-3">
            <Radio className="h-5 w-5 text-red-500" />
            <div><div className="text-lg font-bold text-slate-900">{p.liveCount}</div><div className="text-xs text-slate-500">Chaînes Live</div></div>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-sky-100 bg-sky-50/50 p-3">
            <Clapperboard className="h-5 w-5 text-sky-500" />
            <div><div className="text-lg font-bold text-slate-900">{p.vodCount}</div><div className="text-xs text-slate-500">Films (VOD)</div></div>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-violet-100 bg-violet-50/50 p-3">
            <Library className="h-5 w-5 text-violet-500" />
            <div><div className="text-lg font-bold text-slate-900">{p.seriesCount}</div><div className="text-xs text-slate-500">Séries</div></div>
          </div>
        </div>

        {p.lastError && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{p.lastError}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
          <Button className="bg-orange-500 hover:bg-orange-600" disabled={syncing !== null} onClick={() => syncXtream('live', p.id)}>
            {syncing === `${p.id}:live` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Synchroniser Live
          </Button>
          <Button variant="outline" disabled={syncing !== null} onClick={() => syncXtream('vod', p.id)}>
            {syncing === `${p.id}:vod` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Clapperboard className="mr-2 h-4 w-4" />}
            Films (VOD)
          </Button>
          <Button variant="outline" disabled={syncing !== null} onClick={() => syncXtream('series', p.id)}>
            {syncing === `${p.id}:series` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Library className="mr-2 h-4 w-4" />}
            Séries
          </Button>
          <Button variant="outline" disabled={syncing !== null} onClick={() => syncXtream('all', p.id)}>
            {syncing === `${p.id}:all` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
            Tout synchroniser
          </Button>
          <Button variant="outline" className="ml-auto border-red-200 text-red-600 hover:bg-red-50" disabled={syncing !== null} onClick={() => setDeleteAccountTarget(p)}>
            <Trash2 className="mr-2 h-4 w-4" /> Supprimer ce compte
          </Button>
        </div>
      </CardContent>
    </Card>
  )

  return (
    <div className="space-y-4">
      {/* Stats rapides */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border-slate-200"><CardContent className="flex items-center gap-3 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-50 text-sky-600"><Radio className="h-5 w-5" /></div>
          <div><div className="text-xl font-bold text-slate-900">{sources.length}</div><div className="text-xs text-slate-500">Sources M3U</div></div>
        </CardContent></Card>
        <Card className="border-slate-200"><CardContent className="flex items-center gap-3 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-50 text-orange-600"><Tv className="h-5 w-5" /></div>
          <div><div className="text-xl font-bold text-slate-900">{totalChannels}</div><div className="text-xs text-slate-500">Chaînes IPTV</div></div>
        </CardContent></Card>
        <Card className="border-slate-200"><CardContent className="flex items-center gap-3 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"><Globe className="h-5 w-5" /></div>
          <div><div className="text-xl font-bold text-slate-900">{groups.length || '—'}</div><div className="text-xs text-slate-500">Groupes détectés</div></div>
        </CardContent></Card>
      </div>

      <Tabs value={xtTab} onValueChange={setXtTab} className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="channels"><Tv className="mr-1.5 h-4 w-4" /> Chaînes</TabsTrigger>
            <TabsTrigger value="portal"><Server className="mr-1.5 h-4 w-4" /> Portail Xtream</TabsTrigger>
            <TabsTrigger value="sources"><Link2 className="mr-1.5 h-4 w-4" /> Sources M3U</TabsTrigger>
          </TabsList>
          {xtTab !== 'portal' && (
            <Button className="bg-orange-500 hover:bg-orange-600" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" /> Ajouter une source M3U
            </Button>
          )}
        </div>

        {/* ===== ONGLET CHAINES ===== */}
        <TabsContent value="channels" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher une chaîne…" className="pl-9" />
            </div>
            <Select value={kindFilter} onValueChange={setKindFilter}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les types</SelectItem>
                <SelectItem value="live">Live TV</SelectItem>
                <SelectItem value="vod">Films (VOD)</SelectItem>
                <SelectItem value="series">Séries</SelectItem>
                <SelectItem value="playlist">Playlists M3U</SelectItem>
              </SelectContent>
            </Select>
            <Select value={groupFilter} onValueChange={setGroupFilter}>
              <SelectTrigger className="w-52"><SelectValue placeholder="Tous les groupes" /></SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="all">Tous les groupes</SelectItem>
                {groups.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={accountFilter} onValueChange={setAccountFilter}>
              <SelectTrigger className="w-56"><SelectValue placeholder="Tous les comptes Xtream" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les comptes Xtream</SelectItem>
                {providers.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="w-52"><SelectValue placeholder="Toutes les sources" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes les sources M3U</SelectItem>
                {sources.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <span className="ml-auto text-xs text-slate-400">{channels.length} / {channelTotal} chaîne(s)</span>
          </div>

          {channelsLoading ? (
            <div className="flex flex-col items-center gap-2 py-16 text-slate-400">
              <Loader2 className="h-8 w-8 animate-spin" /><p className="text-sm">Chargement des chaînes…</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                {channels.map(channelCard)}
              </div>
              {channels.length === 0 && (
                <div className="col-span-full flex flex-col items-center gap-2 py-16 text-slate-400">
                  <Tv className="h-12 w-12" />
                  <p className="text-sm">Aucune chaîne. Ajoutez une source M3U pour importer des flux IPTV.</p>
                  <Button className="mt-2 bg-orange-500 hover:bg-orange-600" onClick={() => setAddOpen(true)}>
                    <Plus className="h-4 w-4" /> Importer une playlist M3U
                  </Button>
                </div>
              )}
              {channels.length < channelTotal && (
                <div className="flex justify-center pt-2">
                  <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                    {loadingMore ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Charger plus de chaînes
                  </Button>
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* ===== ONGLET PORTAIL XTREAM (multi-comptes) ===== */}
        <TabsContent value="portal" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-slate-500">
              {providers.length === 0
                ? 'Aucun compte Xtream pour le moment.'
                : `${providers.length} compte(s) Xtream connecté(s) — synchronisez chaque compte indépendamment.`}
            </div>
            <Button
              className="bg-orange-500 hover:bg-orange-600"
              onClick={() => setXtFormOpen((o) => !o)}
            >
              <Plus className="h-4 w-4" /> Ajouter un compte
            </Button>
          </div>

          {/* Formulaire d'ajout d'un compte (repliable, toujours accessible) */}
          {xtFormOpen && (
            <Card className="border-orange-200">
              <CardContent className="space-y-4 p-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-800 text-white">
                    <Server className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900">Ajouter un portail Xtream Codes</div>
                    <div className="text-xs text-slate-400">API player_api.php — vous pouvez ajouter autant de comptes que nécessaire</div>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Nom du compte</Label>
                    <Input value={xtForm.name} onChange={(e) => setXtForm({ ...xtForm, name: e.target.value })} placeholder="Ex : DOBRA Balkan" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>URL du portail *</Label>
                    <Input value={xtForm.host} onChange={(e) => setXtForm({ ...xtForm, host: e.target.value })} placeholder="http://host:port" className="font-mono text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Utilisateur *</Label>
                    <Input value={xtForm.username} onChange={(e) => setXtForm({ ...xtForm, username: e.target.value })} placeholder="username" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Mot de passe *</Label>
                    <Input type="password" value={xtForm.password} onChange={(e) => setXtForm({ ...xtForm, password: e.target.value })} placeholder="password" />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setXtFormOpen(false)}>Annuler</Button>
                  <Button className="bg-orange-500 hover:bg-orange-600" onClick={connectXtream} disabled={connecting}>
                    {connecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Server className="mr-2 h-4 w-4" />}
                    Se connecter et ajouter
                  </Button>
                </div>
                <p className="text-xs text-slate-400">
                  Les identifiants sont stockés localement dans la base de l&apos;application. Exemples d&apos;URL : <span className="font-mono">http://portail.tld:8080</span>, <span className="font-mono">http://host:2095</span>.
                </p>
              </CardContent>
            </Card>
          )}

          {providerLoading ? (
            <div className="flex flex-col items-center gap-2 py-16 text-slate-400">
              <Loader2 className="h-8 w-8 animate-spin" /><p className="text-sm">Chargement des comptes…</p>
            </div>
          ) : providers.length > 0 ? (
            <div className="space-y-4">{providers.map(providerCard)}</div>
          ) : !xtFormOpen ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-slate-200 py-12 text-slate-400">
              <Server className="h-12 w-12" />
              <p className="text-sm">Connectez votre premier portail Xtream pour importer chaînes Live, VOD et séries.</p>
              <Button className="bg-orange-500 hover:bg-orange-600" onClick={() => setXtFormOpen(true)}>
                <Plus className="h-4 w-4" /> Ajouter un compte
              </Button>
            </div>
          ) : null}

          {/* ===== Connexions, pool multi-comptes, partage de flux et timeshift ===== */}
          <Card className="border-slate-200">
            <CardContent className="space-y-4 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Signal className="h-4 w-4 text-orange-500" />
                  <h3 className="text-sm font-semibold text-slate-800">Connexions, pool multi-comptes, partage de flux et timeshift</h3>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={conns?.pool.strict ?? false}
                    onCheckedChange={(v) => toggleStrict(v)}
                  />
                  <span className="text-xs font-medium text-slate-600">Mode strict</span>
                </div>
              </div>
              <p className="text-xs leading-relaxed text-slate-500">
                1 connexion fournisseur = 1 flux = 1 chaîne. La MÊME chaîne est diffusée sur N écrans via une seule connexion
                (partage serveur), et le <span className="font-medium">timeshift</span> enregistre une chaîne sur disque pour la
                rediffuser avec un décalage (ex. +1 min) — toujours sans connexion supplémentaire. Pour PLUSIEURS chaînes
                DIFFÉRENTES simultanées, il faut autant de slots (pack multi-connexions ou comptes supplémentaires) : le pool
                les répartit automatiquement. Le mode strict refuse d&apos;aller au-delà des quotas déclarés (protège du bannissement).
              </p>
              {(conns?.pool.providers ?? []).map((p) => (
                <div key={p.providerId} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-700">{p.name}</span>
                    <span className="text-slate-500">
                      {p.used}/{p.max || '∞'} slots · {p.available < 0 ? 'illimité' : `${p.available} libre(s)`}
                      {p.starting > 0 ? ` · ${p.starting} en cours` : ''}
                    </span>
                  </div>
                  <Progress
                    value={p.max > 0 ? Math.min(100, (p.used / p.max) * 100) : (p.used > 0 ? 100 : 0)}
                    className="h-2"
                  />
                </div>
              ))}
              {(conns?.hubs ?? []).length > 0 && (
                <div className="space-y-2 pt-1">
                  {(conns?.hubs ?? []).map((h) => (
                    <div key={h.url} className="flex flex-wrap items-center gap-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-xs">
                      <Radio className="h-3.5 w-3.5 text-red-500" />
                      <span className="max-w-[240px] truncate font-medium text-slate-700">{h.channel || h.url}</span>
                      {h.provider && <Badge variant="outline" className="text-[10px]">{h.provider}</Badge>}
                      <span className="text-slate-500">{h.viewers} écran(s)</span>
                      {h.failover && <Badge className="bg-amber-500 text-[10px] text-white">secours</Badge>}
                      {h.recording && (
                        <Badge className="bg-red-600 text-[10px] text-white">
                          ● ENREGISTREMENT · tampon {h.bufferedSeconds} s
                        </Badge>
                      )}
                      {h.delayedViewers > 0 && (
                        <Badge className="bg-sky-600 text-[10px] text-white">{h.delayedViewers} écran(s) décalé(s)</Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          {providers.length > 0 && (
            <p className="text-xs text-slate-400">
              La synchronisation importe les catégories et contenus de CHAQUE portail dans l&apos;onglet Chaînes (filtrables par compte). Les chaînes Live y sont diffusables dans les playlists, présentations et écrans.
            </p>
          )}
        </TabsContent>

        {/* ===== ONGLET SOURCES ===== */}
        <TabsContent value="sources">
          <Card className="border-slate-200">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead className="hidden md:table-cell">Source</TableHead>
                  <TableHead>Chaînes</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="hidden lg:table-cell">Ajouté le</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sources.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium text-slate-800">{s.name}</TableCell>
                    <TableCell className="hidden max-w-[280px] truncate text-xs text-slate-400 md:table-cell" title={s.url ?? ''}>
                      {s.sourceType === 'url' ? s.url : s.sourceType === 'file' ? 'Fichier téléversé' : 'Contenu collé'}
                    </TableCell>
                    <TableCell><Badge variant="outline" className="border-slate-200 text-slate-600">{s._count.channels}</Badge></TableCell>
                    <TableCell>
                      {s.status === 'ok' && (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><CircleCheck className="h-3.5 w-3.5" /> Active</span>
                      )}
                      {s.status === 'error' && (
                        <span className="inline-flex items-center gap-1 text-xs text-red-500" title={s.error ?? ''}><CircleAlert className="h-3.5 w-3.5" /> Erreur</span>
                      )}
                      {s.status === 'pending' && <span className="text-xs text-slate-400">En attente</span>}
                    </TableCell>
                    <TableCell className="hidden text-xs text-slate-400 lg:table-cell">{formatDate(s.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" title="Rafraîchir" disabled={s.sourceType !== 'url' || refreshingId === s.id} onClick={() => refreshSource(s)}>
                          {refreshingId === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        </Button>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-red-500" title="Supprimer" onClick={() => setDeleteTarget(s)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {sources.length === 0 && !sourcesLoading && (
                  <TableRow><TableCell colSpan={6} className="py-10 text-center text-sm text-slate-400">Aucune source M3U pour le moment.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ===== Dialogue d'ajout de source ===== */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajouter une source IPTV</DialogTitle>
            <DialogDescription>
              Importez une playlist M3U / M3U8 depuis une URL, un fichier ou en collant son contenu.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'url', label: 'URL', icon: Link2 },
                { id: 'file', label: 'Fichier', icon: FileUp },
                { id: 'paste', label: 'Coller', icon: ClipboardPaste },
              ].map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setForm({ ...form, sourceType: opt.id })}
                  className={`flex flex-col items-center gap-1 rounded-lg border p-2.5 text-xs font-medium transition-colors ${
                    form.sourceType === opt.id
                      ? 'border-orange-500 bg-orange-50 text-orange-600'
                      : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  <opt.icon className="h-4 w-4" /> {opt.label}
                </button>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label>Nom de la source *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex : Chaînes France" />
            </div>
            {form.sourceType === 'url' && (
              <div className="space-y-1.5">
                <Label>URL de la playlist M3U / M3U8 *</Label>
                <Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://exemple.com/playlist.m3u" />
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <span className="text-xs text-slate-400">Exemples :</span>
                  {EXAMPLE_LISTS.map((ex) => (
                    <button
                      key={ex.url}
                      onClick={() => setForm({ ...form, name: form.name || ex.name, url: ex.url })}
                      className="rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-600 transition-colors hover:border-orange-300 hover:bg-orange-50 hover:text-orange-600"
                    >
                      {ex.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {form.sourceType === 'file' && (
              <div className="space-y-1.5">
                <Label>Fichier .m3u / .m3u8 *</Label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".m3u,.m3u8,text/plain"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed border-slate-300 py-6 text-sm text-slate-500 hover:border-orange-400 hover:bg-orange-50/50"
                >
                  <FileUp className="h-6 w-6" />
                  {form.content ? 'Fichier chargé ✓ — cliquer pour changer' : 'Cliquer pour choisir un fichier'}
                </button>
              </div>
            )}
            {form.sourceType === 'paste' && (
              <div className="space-y-1.5">
                <Label>Contenu M3U *</Label>
                <Textarea rows={6} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder={'#EXTM3U\n#EXTINF:-1 tvg-logo="…" group-title="News",Chaîne Info\nhttp://flux.exemple.com/live.m3u8'} className="font-mono text-xs" />
              </div>
            )}
            <p className="text-xs text-slate-400">Limite : 5 000 chaînes par source. Les flux seront lus via le proxy anti-CORS intégré.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Annuler</Button>
            <Button className="bg-orange-500 hover:bg-orange-600" onClick={() => importSource()} disabled={importing}>
              {importing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Analyser et importer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Aperçu d'une chaîne ===== */}
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {preview?.logo && (
                <img src={preview.logo} alt="" className="h-6 w-6 rounded object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
              )}
              {preview?.name}
            </DialogTitle>
            <DialogDescription>
              {preview?.group || 'Sans groupe'} · Flux lu via le proxy intégré (HLS / MPEG-TS)
            </DialogDescription>
          </DialogHeader>
          {preview && (
            <div className="space-y-3">
              <IptvStreamPlayer url={preview.url} delay={parseInt(previewDelay, 10) || 0} className="aspect-video w-full rounded-lg" />
              <div className="flex flex-wrap items-center gap-2 rounded-md bg-slate-50 p-2">
                <Clock3 className="h-4 w-4 text-slate-500" />
                <span className="text-xs font-medium text-slate-600">Timeshift (rediffusion décalée)</span>
                <Select value={previewDelay} onValueChange={setPreviewDelay}>
                  <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Direct</SelectItem>
                    <SelectItem value="30">+ 30 secondes</SelectItem>
                    <SelectItem value="60">+ 1 minute</SelectItem>
                    <SelectItem value="120">+ 2 minutes</SelectItem>
                    <SelectItem value="300">+ 5 minutes</SelectItem>
                  </SelectContent>
                </Select>
                {previewRecording ? (
                  <Button variant="outline" size="sm" className="ml-auto border-red-200 text-red-600 hover:bg-red-50" onClick={() => toggleRecording(preview, false)}>
                    <CircleAlert className="mr-1 h-4 w-4" /> Arrêter l&apos;enregistrement
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" className="ml-auto border-red-200 text-red-600 hover:bg-red-50" onClick={() => toggleRecording(preview, true)}>
                    <Radio className="mr-1 h-4 w-4" /> Enregistrer (timeshift)
                  </Button>
                )}
              </div>
              <p className="text-[11px] leading-relaxed text-slate-400">
                Le décalage nécessite que la chaîne soit enregistrée : au premier usage, le serveur enregistre le direct puis
                démarre la lecture dès que le tampon couvre le décalage choisi. Une seule connexion fournisseur est consommée,
                quel que soit le nombre d&apos;écrans décalés.
              </p>
              {/* §22.1 — Les identifiants du portail ne doivent pas s'afficher à l'écran : URL masquée */}
              <div className="truncate rounded bg-slate-50 p-2 font-mono text-xs text-slate-500" title="URL du flux (identifiants masqués — utiliser « Copier le lien » pour l'adresse complète)">
                {(() => {
                  try {
                    const u = new URL(preview.url)
                    const maskedPath = u.pathname.split('/').map((seg) => (/^[A-Za-z0-9_-]{8,}$/.test(seg) ? '••••••••' : seg)).join('/')
                    return u.origin + maskedPath
                  } catch { return 'flux de la chaîne (masqué)' }
                })()}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" onClick={() => navigator.clipboard?.writeText(preview.url)}>
                  <Link2 className="mr-1 h-4 w-4" /> Copier le lien
                </Button>
                <Button variant="outline" onClick={() => addToMediaLibrary(preview)}>
                  <FolderPlus className="mr-1 h-4 w-4" /> Ajouter à la médiathèque
                </Button>
                <Button className="bg-orange-500 hover:bg-orange-600" onClick={() => setPlaylistDlg(preview)}>
                  <ListPlus className="mr-1 h-4 w-4" /> Ajouter à une playlist
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ===== Aperçu d'une série (saisons / épisodes) ===== */}
      <Dialog
        open={!!series}
        onOpenChange={(o) => {
          if (!o) {
            setSeries(null)
            setSeriesInfo(null)
            setPlayingEpisode(null)
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {series?.logo && (
                <img src={series.logo} alt="" className="h-8 w-8 rounded object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
              )}
              {seriesInfo?.name || series?.name}
            </DialogTitle>
            <DialogDescription className="line-clamp-2">
              {seriesInfo?.genre ? `${seriesInfo.genre} · ` : ''}
              {seriesInfo?.plot || 'Chargement des saisons et épisodes…'}
            </DialogDescription>
          </DialogHeader>
          {seriesLoading ? (
            <div className="flex flex-col items-center gap-2 py-10 text-slate-400">
              <Loader2 className="h-8 w-8 animate-spin" /><p className="text-sm">Chargement des épisodes…</p>
            </div>
          ) : playingEpisode ? (
            <div className="space-y-3">
              <IptvStreamPlayer url={playingEpisode.url} className="aspect-video w-full rounded-lg" />
              <div className="flex items-center justify-between gap-2">
                <Button variant="outline" onClick={() => setPlayingEpisode(null)}>
                  ← Retour aux épisodes
                </Button>
                <span className="truncate text-sm font-medium text-slate-700">{playingEpisode.title}</span>
              </div>
            </div>
          ) : (
            <div className="max-h-[50vh] space-y-4 overflow-y-auto pr-1">
              {(seriesInfo?.seasons || []).map((s) => (
                <div key={s.season}>
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Saison {s.season} · {s.episodes.length} épisode(s)
                  </div>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {s.episodes.map((ep) => (
                      <button
                        key={ep.id}
                        onClick={() => setPlayingEpisode(ep)}
                        className="flex items-center gap-2 rounded-lg border border-slate-200 p-2 text-left text-xs text-slate-700 transition-colors hover:border-orange-400 hover:bg-orange-50"
                      >
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-orange-100 text-[10px] font-bold text-orange-600">
                          {ep.episodeNum}
                        </span>
                        <span className="truncate" title={ep.title}>{ep.title}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {seriesInfo && (!seriesInfo.seasons || seriesInfo.seasons.length === 0) && (
                <div className="flex flex-col items-center gap-2 py-10 text-slate-400">
                  <Library className="h-10 w-10" />
                  <p className="text-sm">Aucun épisode disponible pour cette série.</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ===== Suppression d'un compte Xtream ===== */}
      <AlertDialog open={!!deleteAccountTarget} onOpenChange={(o) => !o && setDeleteAccountTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce compte Xtream ?</AlertDialogTitle>
            <AlertDialogDescription>
              Le compte « {deleteAccountTarget?.name} » ({deleteAccountTarget?.host}) et TOUS ses contenus importés (chaînes Live, VOD, séries) seront supprimés.
              Les autres comptes Xtream et les playlists M3U ne sont pas touchés. Les widgets IPTV déjà créés resteront fonctionnels (URL directe conservée).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={deleteXtreamAccount}>Supprimer ce compte</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ===== Ajout à une playlist ===== */}
      <Dialog open={!!playlistDlg} onOpenChange={(o) => !o && setPlaylistDlg(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Ajouter à une playlist</DialogTitle>
            <DialogDescription>La chaîne « {playlistDlg?.name} » sera diffusée en direct dans la playlist choisie.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Playlist *</Label>
            <Select value={targetPlaylist || undefined} onValueChange={setTargetPlaylist}>
              <SelectTrigger><SelectValue placeholder="Choisir une playlist…" /></SelectTrigger>
              <SelectContent>
                {playlists.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {playlists.length === 0 && <p className="text-xs text-slate-400">Créez d&apos;abord une playlist dans le module Playlists.</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlaylistDlg(null)}>Annuler</Button>
            <Button className="bg-orange-500 hover:bg-orange-600" onClick={addToPlaylist} disabled={!targetPlaylist}>Ajouter</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Suppression source ===== */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette source M3U ?</AlertDialogTitle>
            <AlertDialogDescription>
              « {deleteTarget?.name} » et ses {deleteTarget?._count.channels} chaîne(s) seront supprimées.
              Les widgets IPTV déjà créés resteront fonctionnels (URL conservée).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={confirmDelete}>Supprimer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
