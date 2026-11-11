'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Plus, Search, Image as ImageIcon, FileText, Music, Video, Upload, Trash2, Tv,
  Pencil, FolderOpen, Grid2x2, List, Presentation, RefreshCw, AlertTriangle,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/hooks/use-toast'
import { useResource, apiCreate, apiUpdate, apiDelete, formatBytes, formatDate, MEDIA_TYPE_META } from './api-client'
import IptvStreamPlayer from './iptv-player'

interface MediaItem {
  id: string
  name: string
  type: string
  fileName: string
  fileSize: number
  url: string
  duration: number
  slides?: string[] | string | null
  tags?: string | null
  createdAt: string
}

function firstSlide(m: MediaItem): string | null {
  if (!m.slides) return null
  try {
    const raw = typeof m.slides === 'string' ? JSON.parse(m.slides) : m.slides
    return Array.isArray(raw) && raw.length > 0 ? raw[0] : null
  } catch {
    return null
  }
}

function slideCount(m: MediaItem): number {
  if (!m.slides) return 0
  try {
    const raw = typeof m.slides === 'string' ? JSON.parse(m.slides) : m.slides
    return Array.isArray(raw) ? raw.length : 0
  } catch {
    return 0
  }
}

export default function MediaView() {
  const { data: media, refresh, loading } = useResource<MediaItem>('media')
  const { toast } = useToast()
  const fileInput = useRef<HTMLInputElement>(null)

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [editTarget, setEditTarget] = useState<MediaItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<MediaItem | null>(null)
  const [previewTarget, setPreviewTarget] = useState<MediaItem | null>(null)
  // v3.11.9 — reconversion manuelle des présentations/PDF sans slides
  const [reconverting, setReconverting] = useState<string | null>(null)

  const reconvert = async (m: MediaItem) => {
    if (reconverting) return
    setReconverting(m.id)
    try {
      const res = await fetch(`/api/resource/media/${m.id}/reconvert`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (res.ok && body.ok) {
        toast({ title: 'Conversion réussie', description: `${body.slides} slide(s) générée(s) pour « ${m.name} »` })
        refresh()
      } else {
        toast({ title: 'Reconversion impossible', description: body.error || `Erreur ${res.status}`, variant: 'destructive', duration: 12000 })
      }
    } catch {
      toast({ title: 'Reconversion impossible', description: 'Serveur injoignable', variant: 'destructive' })
    } finally {
      setReconverting(null)
    }
  }

  // v3.11.15 — le champ « Durée (s) » est retiré des dialogues d'upload et
  // d'édition : c'était une métadonnée sans effet sur la lecture (les widgets
  // de présentation ont leur propre durée). La colonne `duration` reste en
  // base et l'API conserve sa valeur par défaut (10) pour la compatibilité.
  const [uploadForm, setUploadForm] = useState({ name: '' })
  const [editForm, setEditForm] = useState({ name: '', tags: '' })

  // Limite de taille affichée dans le dialogue : valeur réelle du setting maxUploadSize
  // (v3.11.4 — l'ancien texte codé en dur « max 50 Mo » était obsolète)
  const [maxUploadMb, setMaxUploadMb] = useState(500)
  useEffect(() => {
    let cancelled = false
    fetch('/api/resource/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((rows: Array<{ key: string; value: string }> | null) => {
        if (cancelled || !Array.isArray(rows)) return
        const n = parseInt(rows.find((s) => s.key === 'maxUploadSize')?.value ?? '', 10)
        if (Number.isFinite(n) && n > 0) setMaxUploadMb(n)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const doUpload = async () => {
    const file = fileInput.current?.files?.[0]
    if (!file) {
      toast({ title: 'Aucun fichier', description: 'Sélectionnez un fichier à téléverser', variant: 'destructive' })
      return
    }
    setUploading(true)
    setUploadProgress(0)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('name', uploadForm.name || file.name)
      // XHR pour afficher la progression réelle du transfert
      const data = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', '/api/upload')
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100))
        }
        xhr.onload = () => {
          try {
            const body = JSON.parse(xhr.responseText || '{}')
            if (xhr.status >= 200 && xhr.status < 300) resolve(body)
            else reject(new Error(body.error || `Échec de l'upload (code ${xhr.status})`))
          } catch {
            reject(new Error(`Échec de l'upload (code ${xhr.status})`))
          }
        }
        xhr.onerror = () => reject(new Error('Serveur injoignable pendant le transfert'))
        xhr.ontimeout = () => reject(new Error('Délai dépassé pendant le transfert'))
        xhr.send(fd)
      })
      void data
      // v3.11.9 — la réponse d'upload peut embarquer un diagnostic de conversion
      const warn = typeof data.slidesWarning === 'string' ? data.slidesWarning : null
      if (warn) {
        toast({ title: 'Média ajouté — conversion impossible', description: warn, variant: 'destructive', duration: 12000 })
      } else {
        toast({ title: 'Média ajouté', description: uploadForm.name || file.name })
      }
      setUploadOpen(false)
      setUploadForm({ name: '' })
      refresh()
    } catch (e) {
      toast({ title: 'Erreur', description: e instanceof Error ? e.message : "L'upload a échoué", variant: 'destructive' })
    } finally {
      setUploading(false)
      setUploadProgress(0)
    }
  }

  const saveEdit = async () => {
    if (!editTarget) return
    const ok = await apiUpdate('media', editTarget.id, {
      name: editForm.name,
      tags: editForm.tags,
    })
    if (ok) {
      toast({ title: 'Média modifié', description: editForm.name })
      setEditTarget(null)
      refresh()
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    const ok = await apiDelete('media', deleteTarget.id)
    if (ok) {
      toast({ title: 'Média supprimé', description: deleteTarget.name })
      refresh()
    }
    setDeleteTarget(null)
  }

  const typeIcon = (type: string) => {
    const cls = 'h-8 w-8'
    switch (type) {
      case 'image': return <ImageIcon className={`${cls} text-orange-500`} />
      case 'video': return <Video className={`${cls} text-red-500`} />
      case 'pdf': return <FileText className={`${cls} text-rose-500`} />
      case 'audio': return <Music className={`${cls} text-emerald-500`} />
      case 'stream': return <Tv className={`${cls} text-sky-500`} />
      case 'presentation': return <Presentation className={`${cls} text-violet-500`} />
      default: return <FileText className={`${cls} text-slate-400`} />
    }
  }

  const filtered = media.filter((m) => {
    const matchSearch = m.name.toLowerCase().includes(search.toLowerCase())
    const matchType = typeFilter === 'all' || m.type === typeFilter
    return matchSearch && matchType
  })

  const totalSize = media.reduce((s, m) => s + m.fileSize, 0)

  return (
    <div className="space-y-4">
      {/* Barre d'actions */}
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={typeFilter} onValueChange={setTypeFilter}>
          <TabsList className="bg-white">
            <TabsTrigger value="all">Tous ({media.length})</TabsTrigger>
            <TabsTrigger value="image">Images</TabsTrigger>
            <TabsTrigger value="video">Vidéos</TabsTrigger>
            <TabsTrigger value="presentation">Présentations</TabsTrigger>
            <TabsTrigger value="pdf">PDF</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative ml-auto w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher un média…" className="pl-9" />
        </div>
        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as 'grid' | 'list')}>
          <TabsList className="bg-white">
            <TabsTrigger value="grid"><Grid2x2 className="h-4 w-4" /></TabsTrigger>
            <TabsTrigger value="list"><List className="h-4 w-4" /></TabsTrigger>
          </TabsList>
        </Tabs>
        <Button className="bg-orange-500 hover:bg-orange-600" onClick={() => setUploadOpen(true)}>
          <Upload className="h-4 w-4" /> Téléverser un média
        </Button>
      </div>

      <div className="flex items-center gap-2 text-sm text-slate-500">
        <FolderOpen className="h-4 w-4" />
        {media.length} fichiers · {formatBytes(totalSize)} utilisés
      </div>

      {/* Grille */}
      {viewMode === 'grid' ? (
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {filtered.map((m) => (
            <Card key={m.id} className="group overflow-hidden border-slate-200 transition-all hover:-translate-y-0.5 hover:shadow-md">
              <button
                className="relative block h-36 w-full overflow-hidden bg-slate-100"
                onClick={() => setPreviewTarget(m)}
                aria-label={`Aperçu de ${m.name}`}
              >
                {m.type === 'image' && m.url ? (
                   
                  <img src={m.url} alt={m.name} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                ) : firstSlide(m) ? (
                  <img src={firstSlide(m)!} alt={m.name} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">{typeIcon(m.type)}</div>
                )}
                <span className="absolute right-2 top-2">
                  <Badge className="border-transparent bg-black/60 text-white text-[10px] uppercase">{m.type}</Badge>
                </span>
                {['presentation', 'pdf'].includes(m.type) && slideCount(m) === 0 && (
                  <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-amber-500/90 px-2 py-0.5 text-[10px] font-semibold text-white">
                    <AlertTriangle className="h-3 w-3" /> Non converti
                  </span>
                )}
                {slideCount(m) > 0 && (
                  <span className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white">
                    {slideCount(m)} slides
                  </span>
                )}
              </button>
              <CardContent className="p-3">
                <div className="truncate text-sm font-medium text-slate-800">{m.name}</div>
                <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
                  <span>{formatBytes(m.fileSize)}</span>
                  <span>{formatDate(m.createdAt)}</span>
                </div>
                <div className="mt-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  {['presentation', 'pdf'].includes(m.type) && (
                    <Button variant="ghost" size="sm" className="h-7 flex-1 text-xs text-violet-600 hover:text-violet-700" title="Relancer la conversion en slides" disabled={reconverting === m.id} onClick={() => reconvert(m)}>
                      <RefreshCw className={`h-3.5 w-3.5 ${reconverting === m.id ? 'animate-spin' : ''}`} />
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="h-7 flex-1 text-xs" onClick={() => { setEditTarget(m); setEditForm({ name: m.name, tags: m.tags ?? '' }) }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 flex-1 text-xs text-red-500 hover:text-red-600" onClick={() => setDeleteTarget(m)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {filtered.length === 0 && !loading && (
            <div className="col-span-full flex flex-col items-center gap-2 py-16 text-slate-400">
              <ImageIcon className="h-12 w-12" />
              <p className="text-sm">Aucun média. Téléversez votre premier fichier !</p>
            </div>
          )}
        </div>
      ) : (
        /* Liste */
        <Card className="border-slate-200">
          <CardContent className="p-0">
            {filtered.map((m) => (
              <div key={m.id} className="flex items-center gap-4 border-b border-slate-100 p-3 last:border-0 hover:bg-slate-50">
                <div className="flex h-12 w-16 items-center justify-center overflow-hidden rounded-md bg-slate-100">
                  {m.type === 'image' && m.url ? (
                     
                    <img src={m.url} alt={m.name} className="h-full w-full object-cover" />
                  ) : typeIcon(m.type)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-800">{m.name}</div>
                  <div className="text-xs text-slate-400">{m.fileName}</div>
                </div>
                <Badge variant="outline" className={`border ${MEDIA_TYPE_META[m.type]?.color ?? 'text-slate-600 bg-slate-50 border-slate-200'}`}>
                  {MEDIA_TYPE_META[m.type]?.label ?? m.type}
                </Badge>
                <span className="hidden w-20 text-right text-xs text-slate-400 sm:block">{formatBytes(m.fileSize)}</span>
                <span className="hidden w-24 text-right text-xs text-slate-400 md:block">{formatDate(m.createdAt)}</span>
                <Button variant="ghost" size="sm" onClick={() => { setEditTarget(m); setEditForm({ name: m.name, tags: m.tags ?? '' }) }}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" className="text-red-500" onClick={() => setDeleteTarget(m)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {filtered.length === 0 && !loading && (
              <div className="py-16 text-center text-sm text-slate-400">Aucun média trouvé</div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Dialogue upload */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Téléverser un média</DialogTitle>
            <DialogDescription>Ajoutez une image, une vidéo ou un document à la bibliothèque.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div
              className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-slate-300 p-6 text-center hover:border-orange-400 hover:bg-orange-50/40"
              onClick={() => fileInput.current?.click()}
            >
              <Upload className="h-8 w-8 text-slate-400" />
              <div className="text-sm text-slate-600">Cliquez pour sélectionner un fichier</div>
              <div className="text-xs text-slate-400">Images, vidéos, audio, PDF, PowerPoint (ppt/pptx/pps/ppsx/odp) — max {maxUploadMb} Mo (réglable dans Paramètres)</div>
              <input ref={fileInput} type="file" className="hidden" accept="image/*,video/*,audio/*,application/pdf,.ppt,.pptx,.pps,.ppsx,.odp" />
            </div>
            <div className="space-y-1.5">
              <Label>Nom du média</Label>
              <Input value={uploadForm.name} onChange={(e) => setUploadForm({ ...uploadForm, name: e.target.value })} placeholder="Ex : Bannière Promo" />
            </div>
            {uploading && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Transfert en cours…</span>
                  <span className="font-semibold tabular-nums">{uploadProgress} %</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-orange-500 transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)}>Annuler</Button>
            <Button className="bg-orange-500 hover:bg-orange-600" onClick={doUpload} disabled={uploading}>
              {uploading ? 'Téléversement…' : 'Téléverser'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialogue édition */}
      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifier le média</DialogTitle>
            <DialogDescription>{editTarget?.fileName}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nom</Label>
              <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Étiquettes</Label>
              <Input value={editForm.tags} onChange={(e) => setEditForm({ ...editForm, tags: e.target.value })} placeholder="promo, accueil…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>Annuler</Button>
            <Button className="bg-orange-500 hover:bg-orange-600" onClick={saveEdit}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Aperçu média */}
      <Dialog open={!!previewTarget} onOpenChange={(o) => !o && setPreviewTarget(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{previewTarget?.name}</DialogTitle>
            <DialogDescription>{previewTarget?.fileName} · {previewTarget ? formatBytes(previewTarget.fileSize) : ''}</DialogDescription>
          </DialogHeader>
          {previewTarget?.type === 'image' && (
             
            <img src={previewTarget.url} alt={previewTarget.name} className="w-full rounded-lg" />
          )}
          {previewTarget?.type === 'video' && (
            <video src={previewTarget.url} controls autoPlay muted className="w-full rounded-lg" />
          )}
          {previewTarget?.type === 'audio' && (
            <audio src={previewTarget.url} controls className="w-full" />
          )}
          {previewTarget?.type === 'stream' && (
            <div className="space-y-2">
              <IptvStreamPlayer url={previewTarget.url} className="aspect-video w-full rounded-lg" />
              <p className="text-center text-xs text-slate-400">Flux IPTV lu en direct via le proxy intégré (HLS / MPEG-TS)</p>
            </div>
          )}
          {(previewTarget?.type === 'presentation' || previewTarget?.type === 'pdf') && firstSlide(previewTarget) && (
            <div className="space-y-2">
              <img src={firstSlide(previewTarget)!} alt={previewTarget.name} className="w-full rounded-lg" />
              <p className="text-center text-xs text-slate-400">
                {slideCount(previewTarget)} slide(s) convertie(s) — diffusée en carrousel automatique dans le lecteur
              </p>
            </div>
          )}
          {previewTarget && !['image', 'video', 'audio', 'stream', 'presentation', 'pdf'].includes(previewTarget.type) && (
            <div className="flex h-48 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
              Aperçu non disponible pour ce type
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Suppression */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer le média ?</AlertDialogTitle>
            <AlertDialogDescription>
              « {deleteTarget?.name} » sera définitivement supprimé de la bibliothèque.
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
