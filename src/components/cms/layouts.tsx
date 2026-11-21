'use client'

import { useState } from 'react'
import {
  Plus, Search, Trash2, Palette, Play, Tv, Clock, Upload,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { useResource, apiCreate, apiUpdate, apiDelete, formatDuration } from './api-client'
import LayoutDesigner from './layout-designer'
import LayoutPreviewModal, { type PreviewLayout } from './layout-preview'

interface Region {
  id: string
  name: string
  left: number
  top: number
  width: number
  height: number
  zIndex: number
  widgets: { id: string; type: string; name: string; duration: number; config: string; media?: { url: string; type: string; name: string } | null }[]
}

interface LayoutItem {
  id: string
  name: string
  description?: string | null
  width: number
  height: number
  duration: number
  backgroundColor: string
  backgroundImage?: string | null
  status: string
  regions: Region[]
  _count?: { campaigns: number; events: number }
}

export function LayoutThumbnail({ layout, className }: { layout: LayoutItem; className?: string }) {
  return (
    <div
      className={`relative overflow-hidden ${className ?? ''}`}
      style={{ aspectRatio: `${layout.width}/${layout.height}`, backgroundColor: layout.backgroundColor }}
    >
      {layout.backgroundImage && (
         
        <img src={layout.backgroundImage} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}
      {layout.regions.map((r) => {
        const w = r.widgets?.[0]
        return (
          <div
            key={r.id}
            className="absolute flex items-center justify-center overflow-hidden border border-white/30 text-[8px]"
            style={{
              left: `${r.left}%`, top: `${r.top}%`, width: `${r.width}%`, height: `${r.height}%`,
              zIndex: r.zIndex, backgroundColor: 'rgba(255,255,255,0.08)',
            }}
          >
            {w?.type === 'image' && w.media?.url ? (
               
              <img src={w.media.url} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="px-1 text-white/60">{r.name}</span>
            )}
          </div>
        )
      })}
      {layout.regions.length === 0 && (
        <div className="flex h-full w-full items-center justify-center text-[10px] text-white/30">Présentation vide</div>
      )}
    </div>
  )
}

export default function LayoutsView({
  designLayoutId, onExitDesign,
}: {
  designLayoutId: string | null
  onExitDesign: () => void
}) {
  const { data: layouts, refresh, loading } = useResource<LayoutItem>('layouts')
  const { toast } = useToast()

  const [search, setSearch] = useState('')
  const [dlgOpen, setDlgOpen] = useState(false)
  const [previewLayout, setPreviewLayout] = useState<LayoutItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<LayoutItem | null>(null)
  const [form, setForm] = useState({ name: '', description: '', resolution: '1920x1080' })

  // Si un identifiant de conception est demandé depuis une autre vue, ouvrir l'éditeur
  const [internalDesign, setInternalDesign] = useState<string | null>(null)
  const designing = designLayoutId ?? internalDesign

  const exitDesign = () => {
    setInternalDesign(null)
    onExitDesign()
    refresh()
  }

  const save = async () => {
    if (!form.name.trim()) return
    const [w, h] = form.resolution.split('x').map(Number)
    const created = await apiCreate<LayoutItem>('layouts', {
      name: form.name,
      description: form.description || null,
      width: w,
      height: h,
      backgroundColor: '#0f172a',
      duration: 60,
      status: 'brouillon',
    })
    if (created) {
      toast({ title: 'Présentation créée', description: form.name })
      setDlgOpen(false)
      setForm({ name: '', description: '', resolution: '1920x1080' })
      refresh()
      // Ouvrir directement l'éditeur
      setInternalDesign(created.id)
    } else {
      toast({ title: 'Erreur', description: 'Création impossible', variant: 'destructive' })
    }
  }

  const togglePublish = async (l: LayoutItem) => {
    const ok = await apiUpdate('layouts', l.id, { status: l.status === 'publie' ? 'brouillon' : 'publie' })
    if (ok) {
      toast({
        title: l.status === 'publie' ? 'Présentation dépubliée' : 'Présentation publiée',
        description: l.name,
      })
      refresh()
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    const ok = await apiDelete('layouts', deleteTarget.id)
    if (ok) {
      toast({ title: 'Présentation supprimée', description: deleteTarget.name })
      refresh()
    }
    setDeleteTarget(null)
  }

  // ====== MODE ÉDITEUR ======
  if (designing) {
    return (
      <LayoutDesigner
        layoutId={designing}
        onExit={exitDesign}
        onPreview={(id) => {
          const l = layouts.find((x) => x.id === id)
          if (l) setPreviewLayout(l)
        }}
      />
    )
  }

  const filtered = layouts.filter((l) => l.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative ml-auto w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher une présentation…" className="pl-9" />
        </div>
        <Button className="bg-orange-500 hover:bg-orange-600" onClick={() => setDlgOpen(true)}>
          <Plus className="h-4 w-4" /> Nouvelle présentation
        </Button>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-64 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((l) => (
            <Card key={l.id} className="group overflow-hidden border-slate-200 transition-all hover:-translate-y-0.5 hover:shadow-md">
              <div className="relative">
                <LayoutThumbnail layout={l} />
                <div className="absolute left-2 top-2">
                  <Badge className={l.status === 'publie' ? 'border-transparent bg-emerald-500 text-white' : 'border-transparent bg-slate-700/80 text-white'}>
                    {l.status === 'publie' ? 'Publié' : 'Brouillon'}
                  </Badge>
                </div>
                <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button size="sm" className="bg-orange-500 hover:bg-orange-600" onClick={() => setInternalDesign(l.id)}>
                    <Palette className="mr-1 h-4 w-4" /> Concevoir
                  </Button>
                  <Button size="sm" variant="outline" className="bg-white/90" onClick={() => setPreviewLayout(l)}>
                    <Play className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-800">{l.name}</div>
                    <div className="mt-0.5 flex items-center gap-3 text-xs text-slate-400">
                      <span className="flex items-center gap-1"><Tv className="h-3 w-3" />{l.width}×{l.height}</span>
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{formatDuration(l.duration)}</span>
                      <span>{l.regions?.length ?? 0} région(s)</span>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="sm">⋯</Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setInternalDesign(l.id)}><Palette className="mr-2 h-4 w-4" /> Concevoir</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setPreviewLayout(l)}><Play className="mr-2 h-4 w-4" /> Aperçu</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => togglePublish(l)}>
                        <Upload className="mr-2 h-4 w-4" /> {l.status === 'publie' ? 'Dépublier' : 'Publier'}
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-red-600" onClick={() => setDeleteTarget(l)}>
                        <Trash2 className="mr-2 h-4 w-4" /> Supprimer
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardContent>
            </Card>
          ))}
          {filtered.length === 0 && !loading && (
            <div className="col-span-full flex flex-col items-center gap-2 py-16 text-slate-400">
              <LayoutTemplateIcon />
              <p className="text-sm">Aucune présentation. Créez votre première mise en page !</p>
            </div>
          )}
        </div>
      )}

      {/* Dialogue création */}
      <Dialog open={dlgOpen} onOpenChange={setDlgOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouvelle présentation</DialogTitle>
            <DialogDescription>Une présentation (layout) est un canevas composé de régions dans lesquelles vous placez des widgets.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nom *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex : Menu Restaurant" />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
            </div>
            <div className="space-y-1.5">
              <Label>Résolution</Label>
              <Select value={form.resolution} onValueChange={(v) => setForm({ ...form, resolution: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1920x1080">1920 × 1080 (paysage)</SelectItem>
                  <SelectItem value="1080x1920">1080 × 1920 (portrait)</SelectItem>
                  <SelectItem value="1280x720">1280 × 720</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlgOpen(false)}>Annuler</Button>
            <Button className="bg-orange-500 hover:bg-orange-600" onClick={save}>Créer et concevoir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Aperçu */}
      {previewLayout && (
        <LayoutPreviewModal open={!!previewLayout} onClose={() => setPreviewLayout(null)} layout={previewLayout as unknown as PreviewLayout | null} />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer la présentation ?</AlertDialogTitle>
            <AlertDialogDescription>
              « {deleteTarget?.name} » et toutes ses régions seront supprimées définitivement.
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

function LayoutTemplateIcon() {
  return (
    <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-slate-100">
      <Tv className="h-7 w-7 text-slate-400" />
    </div>
  )
}
