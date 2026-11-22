'use client'

import { useState } from 'react'
import { Plus, Search, Trash2, Pencil, Megaphone, LayoutTemplate, CalendarDays, ArrowUp, ArrowDown, Save } from 'lucide-react'
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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/hooks/use-toast'
import { useResource, apiCreate, apiUpdate, apiDelete } from './api-client'

interface CampaignLayoutItem {
  id: string
  displayOrder: number
  layout: { id: string; name: string; duration: number }
}

interface Campaign {
  id: string
  name: string
  description?: string | null
  layouts: CampaignLayoutItem[]
  _count?: { events: number }
}

export default function CampaignsView() {
  const { data: campaigns, refresh } = useResource<Campaign>('campaigns')
  const { data: layouts } = useResource<{ id: string; name: string; duration: number }>('layouts')
  const { toast } = useToast()

  const [search, setSearch] = useState('')
  const [dlgOpen, setDlgOpen] = useState(false)
  const [manageOpenId, setManageOpenId] = useState<string | null>(null)
  // Le dialogue suit TOUJOURS la liste fraîche (les réordonnancements sont visibles immédiatement)
  const manageOpen = campaigns.find((c) => c.id === manageOpenId) ?? null
  const [deleteTarget, setDeleteTarget] = useState<Campaign | null>(null)
  const [form, setForm] = useState({ name: '', description: '' })
  const [layoutId, setLayoutId] = useState('')
  const [editForm, setEditForm] = useState({ name: '', description: '' })

  const save = async () => {
    if (!form.name.trim()) return
    const ok = await apiCreate('campaigns', { name: form.name, description: form.description || null })
    if (ok) {
      toast({ title: 'Campagne créée', description: form.name })
      setDlgOpen(false)
      setForm({ name: '', description: '' })
      refresh()
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    const ok = await apiDelete('campaigns', deleteTarget.id)
    if (ok) { toast({ title: 'Campagne supprimée', description: deleteTarget.name }); refresh() }
    setDeleteTarget(null)
  }

  const openManage = (c: Campaign) => {
    setManageOpenId(c.id)
    setEditForm({ name: c.name, description: c.description || '' })
  }

  // §4 — Renommer / modifier la description de la campagne
  const saveCampaign = async () => {
    if (!manageOpen || !editForm.name.trim()) return
    const ok = await apiUpdate('campaigns', manageOpen.id, {
      name: editForm.name,
      description: editForm.description || null,
    })
    if (ok) {
      toast({ title: 'Campagne modifiée', description: editForm.name })
      refresh()
    }
  }

  const addLayout = async (campaign: Campaign) => {
    if (!layoutId) return
    // v3.11.10 — ordre = max(existing) + 1 (et non length + 1) : deux ajouts
    // rapprochés ne peuvent plus créer de displayOrder DOUBLON, qui rendait
    // l'ordre de diffusion arbitraire côté lecteur.
    const maxOrder = campaign.layouts.reduce((m, cl) => Math.max(m, cl.displayOrder), 0)
    const ok = await apiCreate('campaign-layouts', {
      campaignId: campaign.id,
      layoutId,
      displayOrder: maxOrder + 1,
    })
    if (ok) {
      toast({ title: 'Présentation ajoutée à la campagne' })
      setLayoutId('')
      refresh()
    }
  }

  const removeLayout = async (itemId: string) => {
    const ok = await apiDelete('campaign-layouts', itemId)
    if (ok) { toast({ title: 'Présentation retirée' }); refresh() }
  }

  // §4 — Réordonnancement : échange avec le voisin (haut/bas) puis renumérotation
  // v3.11.10 — la liste cible est renumérotée ENTIÈREMENT (1..n) : opération
  // idempotente, tolérante aux clics rapides ▲▼ (données non encore rafraîchies)
  // et aux doublons de displayOrder hérités d'anciennes versions.
  const moveLayout = async (campaign: Campaign, itemId: string, dir: -1 | 1) => {
    const ordered = [...campaign.layouts].sort((a, b) => a.displayOrder - b.displayOrder)
    const idx = ordered.findIndex((cl) => cl.id === itemId)
    const swapWith = idx + dir
    if (idx < 0 || swapWith < 0 || swapWith >= ordered.length) return
    const next = [...ordered]
    ;[next[idx], next[swapWith]] = [next[swapWith], next[idx]]
    await Promise.all(next.map((cl, i) => apiUpdate('campaign-layouts', cl.id, { displayOrder: i + 1 })))
    toast({ title: 'Ordre de diffusion mis à jour' })
    refresh()
  }

  const filtered = campaigns.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
  const totalDuration = (c: Campaign) => c.layouts.reduce((s, l) => s + l.layout.duration, 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative ml-auto w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher une campagne…" className="pl-9" />
        </div>
        <Button className="bg-orange-500 hover:bg-orange-600" onClick={() => setDlgOpen(true)}>
          <Plus className="h-4 w-4" /> Nouvelle campagne
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((c) => (
          <Card key={c.id} className="border-slate-200 transition-shadow hover:shadow-md">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-50 text-cyan-600">
                  <Megaphone className="h-5 w-5" />
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => openManage(c)} title="Gérer les présentations">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" className="text-red-500" onClick={() => setDeleteTarget(c)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="mt-3 font-semibold text-slate-900">{c.name}</div>
              <div className="truncate text-xs text-slate-400">{c.description || 'Aucune description'}</div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-slate-200 text-slate-500">
                  <LayoutTemplate className="mr-1 h-3 w-3" /> {c.layouts.length} présentation(s)
                </Badge>
                <Badge variant="outline" className="border-slate-200 text-slate-500">
                  <CalendarDays className="mr-1 h-3 w-3" /> {c._count?.events ?? 0} planification(s)
                </Badge>
                {c.layouts.length > 0 && <Badge className="border-transparent bg-orange-100 text-orange-700">~{totalDuration(c)}s</Badge>}
              </div>
              {c.layouts.length > 0 && (
                <div className="mt-3 space-y-1">
                  {[...c.layouts].sort((a, b) => a.displayOrder - b.displayOrder).map((cl, i) => (
                    <div key={cl.id} className="flex items-center gap-2 rounded bg-slate-50 px-2 py-1 text-xs text-slate-600">
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 text-[9px] font-bold text-white">{i + 1}</span>
                      {cl.layout.name}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full flex flex-col items-center gap-2 py-16 text-slate-400">
            <Megaphone className="h-12 w-12" />
            <p className="text-sm">Aucune campagne. Les campagnes regroupent plusieurs présentations à diffuser ensemble.</p>
          </div>
        )}
      </div>

      {/* Création */}
      <Dialog open={dlgOpen} onOpenChange={setDlgOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouvelle campagne</DialogTitle>
            <DialogDescription>Une campagne enchaîne plusieurs présentations et se planifie comme un tout.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nom *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex : Campagne Noël" />
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

      {/* Gestion des présentations : ajout, réordonnancement, suppression + renommage (§4) */}
      <Dialog open={!!manageOpen} onOpenChange={(o) => !o && setManageOpenId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Campagne : {manageOpen?.name}</DialogTitle>
            <DialogDescription>Ajoutez, réordonnez (▲▼) ou retirez des présentations — l&apos;ordre définit la séquence de diffusion.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Renommage de la campagne */}
            <div className="space-y-2 rounded-lg border border-slate-100 bg-slate-50 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Identité de la campagne</div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} placeholder="Nom de la campagne" />
                <Input value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} placeholder="Description (optionnelle)" />
              </div>
              <Button size="sm" variant="outline" onClick={saveCampaign} disabled={!editForm.name.trim()}>
                <Save className="mr-1 h-3.5 w-3.5" /> Enregistrer le nom
              </Button>
            </div>

            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <Label>Présentation à ajouter</Label>
                <Select value={layoutId || undefined} onValueChange={setLayoutId}>
                  <SelectTrigger><SelectValue placeholder="Choisir une présentation…" /></SelectTrigger>
                  <SelectContent>
                    {layouts.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button className="bg-orange-500 hover:bg-orange-600" onClick={() => manageOpen && addLayout(manageOpen)}>
                <Plus className="h-4 w-4" /> Ajouter
              </Button>
            </div>
            <div className="space-y-2">
              {manageOpen && [...manageOpen.layouts].sort((a, b) => a.displayOrder - b.displayOrder).map((cl, i, arr) => (
                <div key={cl.id} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 p-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-orange-500 text-xs font-bold text-white">{i + 1}</span>
                  <div className="flex-1 text-sm text-slate-700">{cl.layout.name}</div>
                  <span className="text-xs text-slate-400">{cl.layout.duration}s</span>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-slate-400 disabled:opacity-25" disabled={i === 0} onClick={() => manageOpen && moveLayout(manageOpen, cl.id, -1)} title="Monter">
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-slate-400 disabled:opacity-25" disabled={i === arr.length - 1} onClick={() => manageOpen && moveLayout(manageOpen, cl.id, 1)} title="Descendre">
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500" onClick={() => removeLayout(cl.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              {manageOpen?.layouts.length === 0 && (
                <div className="py-6 text-center text-sm text-slate-400">Aucune présentation dans cette campagne.</div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManageOpenId(null)}>Fermer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer la campagne ?</AlertDialogTitle>
            <AlertDialogDescription>« {deleteTarget?.name} » sera supprimée définitivement.</AlertDialogDescription>
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
