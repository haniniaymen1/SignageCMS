'use client'

import { useEffect, useState } from 'react'
import {
  Plus, Search, Trash2, Pencil, ListVideo, Clock, ArrowUp, ArrowDown, Music2, Tv,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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

interface PlaylistWidget {
  id: string
  type: string
  name: string
  duration: number
  position: number
  media?: { id: string; name: string; url: string; type: string } | null
  config?: string
}

interface Playlist {
  id: string
  name: string
  description?: string | null
  duration: number
  widgets: PlaylistWidget[]
}

interface IptvChannelLight {
  id: string
  name: string
  url: string
  logo: string | null
  group: string | null
}

const TYPE_LABELS: Record<string, string> = {
  image: 'Image', video: 'Vidéo', text: 'Texte', clock: 'Horloge',
  weather: 'Météo', rss: 'Fil RSS', audio: 'Audio', webpage: 'Page web', iptv: 'Chaîne IPTV',
}

export default function PlaylistsView() {
  const { data: playlists, refresh } = useResource<Playlist>('playlists')
  const { data: mediaList } = useResource<{ id: string; name: string; type: string; url: string; duration: number }>('media')
  const { toast } = useToast()

  const [search, setSearch] = useState('')
  const [dlgOpen, setDlgOpen] = useState(false)
  const [editOpen, setEditOpen] = useState<Playlist | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Playlist | null>(null)
  const [form, setForm] = useState({ name: '', description: '' })
  const [itemForm, setItemForm] = useState({ type: 'image', mediaId: '', duration: 10, channelUrl: '', channelName: '', channelDelay: '' })
  const [chSearch, setChSearch] = useState('')
  const [chResults, setChResults] = useState<IptvChannelLight[]>([])
  const [chTotal, setChTotal] = useState(0)
  const [chLoading, setChLoading] = useState(false)

  // Recherche SERVEUR sur TOUTES les chaînes (debounce 300 ms) — la base peut
  // contenir des dizaines de milliers de chaînes, impossible de tout charger.
  useEffect(() => {
    let cancelled = false
    const t = setTimeout(() => {
      setChLoading(true)
      fetch(`/api/iptv/channels?take=50&search=${encodeURIComponent(chSearch)}`)
        .then((r) => r.json())
        .then((d) => { if (!cancelled) { setChResults(d.items ?? []); setChTotal(d.total ?? 0) } })
        .catch(() => {})
        .finally(() => { if (!cancelled) setChLoading(false) })
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [chSearch])

  const save = async () => {
    if (!form.name.trim()) return
    const ok = await apiCreate('playlists', { name: form.name, description: form.description || null, duration: 0 })
    if (ok) {
      toast({ title: 'Playlist créée', description: form.name })
      setDlgOpen(false)
      setForm({ name: '', description: '' })
      refresh()
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    const ok = await apiDelete('playlists', deleteTarget.id)
    if (ok) { toast({ title: 'Playlist supprimée', description: deleteTarget.name }); refresh() }
    setDeleteTarget(null)
  }

  // Ajout d'un élément à une playlist
  const addItem = async (playlist: Playlist) => {
    const media = mediaList.find((m) => m.id === itemForm.mediaId)
    if (itemForm.type === 'image' || itemForm.type === 'video') {
      if (!media) {
        toast({ title: 'Sélection requise', description: 'Choisissez un média', variant: 'destructive' })
        return
      }
    }
    if (itemForm.type === 'iptv' && !itemForm.channelUrl) {
      toast({ title: 'Sélection requise', description: 'Choisissez une chaîne IPTV', variant: 'destructive' })
      return
    }
    const ok = await apiCreate('widgets', {
      playlistId: playlist.id,
      type: itemForm.type,
      name: itemForm.type === 'iptv'
        ? itemForm.channelName
        : media ? media.name : `${TYPE_LABELS[itemForm.type] ?? itemForm.type}`,
      duration: itemForm.duration,
      mediaId: media?.id ?? null,
      position: playlist.widgets.length,
      config: itemForm.type === 'iptv'
        ? JSON.stringify({
            channelUrl: itemForm.channelUrl,
            channelName: itemForm.channelName,
            ...(parseInt(itemForm.channelDelay, 10) > 0 ? { delay: parseInt(itemForm.channelDelay, 10) } : {}),
          })
        : undefined,
    })
    if (ok) { toast({ title: 'Élément ajouté' }); refresh() }
  }

  const removeItem = async (playlist: Playlist, widgetId: string) => {
    const ok = await apiDelete('widgets', widgetId)
    if (ok) { toast({ title: 'Élément retiré' }); refresh() }
  }

  const moveItem = async (playlist: Playlist, index: number, dir: -1 | 1) => {
    const target = playlist.widgets[index + dir]
    const current = playlist.widgets[index]
    if (!target || !current) return
    await Promise.all([
      apiUpdate('widgets', current.id, { position: index + dir }),
      apiUpdate('widgets', target.id, { position: index }),
    ])
    refresh()
  }

  const saveInfo = async () => {
    if (!editOpen) return
    const ok = await apiUpdate('playlists', editOpen.id, {
      name: editOpen.name,
      description: editOpen.description,
      duration: editOpen.widgets.reduce((s, w) => s + w.duration, 0),
    })
    if (ok) { toast({ title: 'Playlist modifiée', description: editOpen.name }); setEditOpen(null); refresh() }
  }

  const filtered = playlists.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative ml-auto w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher une playlist…" className="pl-9" />
        </div>
        <Button className="bg-orange-500 hover:bg-orange-600" onClick={() => setDlgOpen(true)}>
          <Plus className="h-4 w-4" /> Nouvelle playlist
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((p) => (
          <Card key={p.id} className="border-slate-200 transition-shadow hover:shadow-md">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-50 text-violet-500">
                  <ListVideo className="h-5 w-5" />
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setEditOpen(p)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" className="text-red-500" onClick={() => setDeleteTarget(p)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="mt-3 font-semibold text-slate-900">{p.name}</div>
              <div className="truncate text-xs text-slate-400">{p.description || 'Aucune description'}</div>
              <div className="mt-3 flex items-center gap-2">
                <Badge variant="outline" className="border-slate-200 text-slate-500">{p.widgets.length} élément(s)</Badge>
                <Badge variant="outline" className="border-slate-200 text-slate-500">
                  <Clock className="mr-1 h-3 w-3" /> {formatDuration(p.widgets.reduce((s, w) => s + w.duration, 0))}
                </Badge>
              </div>
              {p.widgets.length > 0 && (
                <div className="mt-3 flex gap-1 overflow-x-auto">
                  {p.widgets.slice(0, 6).map((w) =>
                    w.media?.type === 'image' && w.media.url ? (
                       
                      <img key={w.id} src={w.media.url} alt="" className="h-10 w-14 shrink-0 rounded border border-slate-200 object-cover" />
                    ) : (
                      <div key={w.id} className="flex h-10 w-14 shrink-0 items-center justify-center rounded border border-slate-200 bg-slate-50 text-[9px] text-slate-400">
                        {TYPE_LABELS[w.type] ?? w.type}
                      </div>
                    )
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full flex flex-col items-center gap-2 py-16 text-slate-400">
            <ListVideo className="h-12 w-12" />
            <p className="text-sm">Aucune playlist. Créez-en une pour enchaîner du contenu.</p>
          </div>
        )}
      </div>

      {/* Création */}
      <Dialog open={dlgOpen} onOpenChange={setDlgOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouvelle playlist</DialogTitle>
            <DialogDescription>Une playlist est une séquence de contenus lus les uns après les autres.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nom *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex : Promotions du jour" />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlgOpen(false)}>Annuler</Button>
            <Button className="bg-orange-500 hover:bg-orange-600" onClick={save}>Créer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Édition */}
      <Dialog open={!!editOpen} onOpenChange={(o) => !o && setEditOpen(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Modifier la playlist</DialogTitle>
            <DialogDescription>Gérez les éléments et leurs propriétés.</DialogDescription>
          </DialogHeader>
          {editOpen && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Nom</Label>
                  <Input value={editOpen.name} onChange={(e) => setEditOpen({ ...editOpen, name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Description</Label>
                  <Input value={editOpen.description ?? ''} onChange={(e) => setEditOpen({ ...editOpen, description: e.target.value })} />
                </div>
              </div>

              {/* Ajouter un élément */}
              <div className="rounded-lg border border-dashed border-slate-300 p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Ajouter un élément</div>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="w-36 space-y-1">
                    <Label className="text-xs">Type</Label>
                    <Select value={itemForm.type} onValueChange={(v) => setItemForm({ ...itemForm, type: v, mediaId: '', channelUrl: '', channelName: '', channelDelay: '' })}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="image">Image</SelectItem>
                        <SelectItem value="video">Vidéo</SelectItem>
                        <SelectItem value="iptv">Chaîne IPTV (direct)</SelectItem>
                        <SelectItem value="clock">Horloge</SelectItem>
                        <SelectItem value="text">Texte</SelectItem>
                        <SelectItem value="weather">Météo</SelectItem>
                        <SelectItem value="rss">Fil RSS</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {['image', 'video'].includes(itemForm.type) && (
                    <div className="w-56 space-y-1">
                      <Label className="text-xs">Média</Label>
                      <Select value={itemForm.mediaId || undefined} onValueChange={(v) => setItemForm({ ...itemForm, mediaId: v })}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="Choisir…" /></SelectTrigger>
                        <SelectContent>
                          {mediaList.filter((m) => m.type === itemForm.type).map((m) => (
                            <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {itemForm.type === 'iptv' && (
                    <div className="w-64 space-y-1">
                      <Label className="text-xs">Chaîne IPTV</Label>
                      {itemForm.channelUrl ? (
                        <div className="flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-2 py-1.5 text-xs text-sky-700">
                          <Tv className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate font-medium">{itemForm.channelName}</span>
                          <button
                            className="ml-auto shrink-0 text-sky-400 hover:text-sky-700"
                            onClick={() => setItemForm({ ...itemForm, channelUrl: '', channelName: '' })}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <Input className="h-9 text-xs" value={chSearch} onChange={(e) => setChSearch(e.target.value)} placeholder="Rechercher une chaîne…" />
                          <div className="max-h-44 overflow-y-auto rounded-md border border-slate-200 bg-white">
                            {chLoading && <div className="p-2 text-center text-xs text-slate-400">Recherche…</div>}
                            {!chLoading && chResults.length === 0 && (
                              <div className="p-2 text-center text-xs text-slate-400">Aucune chaîne trouvée</div>
                            )}
                            {chResults.map((c) => (
                              <button
                                key={c.id}
                                onClick={() => setItemForm({ ...itemForm, channelUrl: c.url, channelName: c.name })}
                                className="flex w-full items-center gap-2 border-b border-slate-100 px-2 py-1.5 text-left text-xs last:border-0 transition-colors hover:bg-orange-50"
                              >
                                <Tv className="h-3.5 w-3.5 shrink-0 text-slate-300" />
                                <span className="min-w-0 flex-1 truncate text-slate-700">{c.name}</span>
                                {c.group && <span className="shrink-0 text-[10px] text-slate-400">{c.group}</span>}
                              </button>
                            ))}
                          </div>
                          <div className="text-[10px] text-slate-400">{chTotal.toLocaleString('fr-FR')} chaîne(s) au total — tapez pour filtrer</div>
                        </>
                      )}
                      <div className="space-y-1">
                        <Label className="text-xs">Décalage timeshift (s)</Label>
                        <Input type="number" min={0} step={5} className="h-9" value={itemForm.channelDelay} onChange={(e) => setItemForm({ ...itemForm, channelDelay: e.target.value })} placeholder="0 = direct" />
                      </div>
                    </div>
                  )}
                  <div className="w-28 space-y-1">
                    <Label className="text-xs">Durée (s)</Label>
                    <Input type="number" min={1} className="h-9" value={itemForm.duration} onChange={(e) => setItemForm({ ...itemForm, duration: parseInt(e.target.value) || 10 })} />
                  </div>
                  <Button className="h-9 bg-orange-500 hover:bg-orange-600" onClick={() => addItem(editOpen)}>
                    <Plus className="h-4 w-4" /> Ajouter
                  </Button>
                </div>
              </div>

              {/* Liste des éléments */}
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {editOpen.widgets.map((w, i) => (
                  <div key={w.id} className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 p-2">
                    {w.type === 'iptv' ? <Tv className="h-4 w-4 shrink-0 text-sky-500" /> : <Music2 className="h-4 w-4 shrink-0 text-slate-400" />}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-800">{w.name}</div>
                      <div className="text-xs text-slate-400">{TYPE_LABELS[w.type] ?? w.type} · {w.duration}s</div>
                    </div>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={i === 0} onClick={() => moveItem(editOpen, i, -1)}>
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={i === editOpen.widgets.length - 1} onClick={() => moveItem(editOpen, i, 1)}>
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500" onClick={() => removeItem(editOpen, w.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                {editOpen.widgets.length === 0 && (
                  <div className="py-6 text-center text-sm text-slate-400">Playlist vide — ajoutez des éléments ci-dessus.</div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(null)}>Fermer</Button>
            <Button className="bg-orange-500 hover:bg-orange-600" onClick={saveInfo}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer la playlist ?</AlertDialogTitle>
            <AlertDialogDescription>« {deleteTarget?.name} » et ses éléments seront supprimés.</AlertDialogDescription>
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
