'use client'

import { useState } from 'react'
import { Check, Copy, Monitor, Pencil, Play, Plus, RefreshCw, Smartphone, Trash2, LayoutGrid, Search } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/hooks/use-toast'
import { useResource, apiCreate, apiUpdate, apiDelete, formatDateTime, timeAgo } from './api-client'
import DisplayPreview from './display-preview'
import AndroidConnectDialog from './android-connect-dialog'

interface Display {
  id: string
  hardwareKey: string
  name: string
  description?: string | null
  status: string
  resolution: string
  lastAccess: string | null
  storageUsed: number
  layoutId?: string | null
  group?: { id: string; name: string } | null
}

interface DisplayGroup {
  id: string
  name: string
  _count?: { displays: number; events: number }
}

export default function DisplaysView({ onOpenDesigner }: { onOpenDesigner: (id: string) => void }) {
  const { data: displays, refresh: refreshDisplays } = useResource<Display>('displays')
  const { data: groups, refresh: refreshGroups } = useResource<DisplayGroup>('display-groups')
  const { data: layouts } = useResource<{ id: string; name: string; status: string }>('layouts')
  const { toast } = useToast()

  const [tab, setTab] = useState('screens')
  const [search, setSearch] = useState('')
  const [dlgOpen, setDlgOpen] = useState(false)
  const [editing, setEditing] = useState<Display | null>(null)
  const [grpOpen, setGrpOpen] = useState(false)
  const [editGroup, setEditGroup] = useState<DisplayGroup | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [connectDisplay, setConnectDisplay] = useState<Display | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ type: string; id: string; name: string } | null>(null)

  const [form, setForm] = useState({ name: '', description: '', groupId: '', resolution: '1920x1080' })
  const [groupForm, setGroupForm] = useState({ name: '', description: '' })

  const openAdd = () => {
    setEditing(null)
    setForm({ name: '', description: '', groupId: '', resolution: '1920x1080' })
    setDlgOpen(true)
  }
  const openEdit = (d: Display) => {
    setEditing(d)
    setForm({ name: d.name, description: d.description ?? '', groupId: d.group?.id ?? '', resolution: d.resolution })
    setDlgOpen(true)
  }

  const save = async () => {
    if (!form.name.trim()) return
    const payload = {
      name: form.name,
      description: form.description || null,
      resolution: form.resolution,
      groupId: form.groupId || null,
      lastAccess: new Date().toISOString(),
    }
    const ok = editing
      ? await apiUpdate('displays', editing.id, payload)
      : await apiCreate('displays', { ...payload, hardwareKey: `KEY-${Date.now().toString(36).toUpperCase()}`, status: 'online' })
    if (ok) {
      toast({ title: editing ? 'Écran modifié' : 'Écran ajouté', description: form.name })
      setDlgOpen(false)
      refreshDisplays()
    } else {
      toast({ title: 'Erreur', description: 'Enregistrement impossible', variant: 'destructive' })
    }
  }

  const saveGroup = async () => {
    if (!groupForm.name.trim()) return
    const ok = editGroup
      ? await apiUpdate('display-groups', editGroup.id, { name: groupForm.name, description: groupForm.description })
      : await apiCreate('display-groups', { name: groupForm.name, description: groupForm.description })
    if (ok) {
      toast({ title: editGroup ? 'Groupe modifié' : 'Groupe créé', description: groupForm.name })
      setGrpOpen(false)
      refreshGroups()
    } else {
      toast({ title: 'Erreur', description: 'Enregistrement impossible', variant: 'destructive' })
    }
  }

  const toggleStatus = async (d: Display) => {
    await apiUpdate('displays', d.id, { status: d.status === 'online' ? 'offline' : 'online', lastAccess: new Date().toISOString() })
    refreshDisplays()
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    const ok = await apiDelete(deleteTarget.type, deleteTarget.id)
    if (ok) {
      toast({ title: 'Supprimé', description: deleteTarget.name })
      if (deleteTarget.type === 'displays') refreshDisplays()
      else refreshGroups()
    }
    setDeleteTarget(null)
  }

  const filtered = displays.filter((d) => d.name.toLowerCase().includes(search.toLowerCase()))
  const filteredGroups = groups.filter((g) => g.name.toLowerCase().includes(search.toLowerCase()))
  const previewDisplay = displays.find((d) => d.id === previewId)

  return (
    <div className="space-y-4">
      {/* Barre d'actions */}
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="bg-white">
            <TabsTrigger value="screens" className="gap-2"><Monitor className="h-4 w-4" />Écrans</TabsTrigger>
            <TabsTrigger value="groups" className="gap-2"><LayoutGrid className="h-4 w-4" />Groupes</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative ml-auto w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher…" className="pl-9" />
        </div>
        {tab === 'screens' ? (
          <Button className="bg-orange-500 hover:bg-orange-600" onClick={openAdd}>
            <Plus className="h-4 w-4" /> Ajouter un écran
          </Button>
        ) : (
          <Button className="bg-orange-500 hover:bg-orange-600" onClick={() => { setEditGroup(null); setGroupForm({ name: '', description: '' }); setGrpOpen(true) }}>
            <Plus className="h-4 w-4" /> Ajouter un groupe
          </Button>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsContent value="screens">
          <Card className="border-slate-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Écrans connectés ({filtered.length})</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-200">
                    <TableHead>Écran</TableHead>
                    <TableHead className="hidden md:table-cell">Clé matérielle</TableHead>
                    <TableHead>Groupe</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead className="hidden lg:table-cell">Résolution</TableHead>
                    <TableHead className="hidden lg:table-cell">Dernier accès</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((d) => (
                    <TableRow key={d.id} className="border-slate-100">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${d.status === 'online' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                            <Monitor className="h-4.5 w-4.5" />
                          </div>
                          <div>
                            <div className="font-medium text-slate-800">{d.name}</div>
                            <div className="text-xs text-slate-400">{d.description || '—'}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden font-mono text-xs text-slate-500 md:table-cell">{d.hardwareKey}</TableCell>
                      <TableCell className="text-slate-600">{d.group?.name ?? '—'}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5">
                          <span className={`h-2 w-2 rounded-full ${d.status === 'online' ? 'animate-pulse bg-emerald-500' : 'bg-slate-300'}`} />
                          <Badge variant="outline" className={d.status === 'online' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500'}>
                            {d.status === 'online' ? 'En ligne' : 'Hors ligne'}
                          </Badge>
                        </span>
                      </TableCell>
                      <TableCell className="hidden text-slate-500 lg:table-cell">{d.resolution}</TableCell>
                      <TableCell className="hidden text-slate-500 lg:table-cell">{formatDateTime(d.lastAccess)}</TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm">⋯</Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setPreviewId(d.id)}>
                              <Play className="mr-2 h-4 w-4" /> Aperçu
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setConnectDisplay(d)}>
                              <Smartphone className="mr-2 h-4 w-4" /> Connecter Android
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => toggleStatus(d)}>
                              <RefreshCw className="mr-2 h-4 w-4" /> {d.status === 'online' ? 'Marquer hors ligne' : 'Marquer en ligne'}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openEdit(d)}>
                              <Pencil className="mr-2 h-4 w-4" /> Modifier
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-red-600" onClick={() => setDeleteTarget({ type: 'displays', id: d.id, name: d.name })}>
                              <Trash2 className="mr-2 h-4 w-4" /> Supprimer
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="py-10 text-center text-slate-400">
                        Aucun écran. Cliquez sur « Ajouter un écran » pour commencer.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="groups">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filteredGroups.map((g) => (
              <Card key={g.id} className="border-slate-200 transition-shadow hover:shadow-md">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-50 text-orange-500">
                      <LayoutGrid className="h-5 w-5" />
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" size="sm">⋯</Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => { setEditGroup(g); setGroupForm({ name: g.name, description: '' }); setGrpOpen(true) }}>
                          <Pencil className="mr-2 h-4 w-4" /> Modifier
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-red-600" onClick={() => setDeleteTarget({ type: 'display-groups', id: g.id, name: g.name })}>
                          <Trash2 className="mr-2 h-4 w-4" /> Supprimer
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="mt-3 font-semibold text-slate-900">{g.name}</div>
                  <div className="mt-1 flex items-center gap-4 text-xs text-slate-500">
                    <span>{g._count?.displays ?? 0} écran(s)</span>
                    <span>{g._count?.events ?? 0} événement(s)</span>
                  </div>
                </CardContent>
              </Card>
            ))}
            {filteredGroups.length === 0 && (
              <div className="col-span-full py-10 text-center text-slate-400">Aucun groupe créé.</div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Dialogue écran */}
      <Dialog open={dlgOpen} onOpenChange={setDlgOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Modifier l\u2019écran' : 'Nouvel écran'}</DialogTitle>
            <DialogDescription>Enregistrez un lecteur d&apos;affichage et affectez-le à un groupe.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nom de l&apos;écran *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex : Écran Hall d'accueil" />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Emplacement, étage…" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Groupe d&apos;écrans</Label>
                <Select value={form.groupId} onValueChange={(v) => setForm({ ...form, groupId: v === 'none' ? '' : v })}>
                  <SelectTrigger><SelectValue placeholder="Aucun" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Aucun</SelectItem>
                    {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Résolution</Label>
                <Select value={form.resolution} onValueChange={(v) => setForm({ ...form, resolution: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1920x1080">1920 × 1080</SelectItem>
                    <SelectItem value="1280x720">1280 × 720</SelectItem>
                    <SelectItem value="1080x1920">1080 × 1920 (portrait)</SelectItem>
                    <SelectItem value="3840x2160">3840 × 2160 (4K)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlgOpen(false)}>Annuler</Button>
            <Button className="bg-orange-500 hover:bg-orange-600" onClick={save}>{editing ? 'Enregistrer' : 'Ajouter'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialogue groupe */}
      <Dialog open={grpOpen} onOpenChange={setGrpOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editGroup ? 'Modifier le groupe' : 'Nouveau groupe d\u2019écrans'}</DialogTitle>
            <DialogDescription>Les groupes permettent de diffuser du contenu sur plusieurs écrans à la fois.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nom du groupe *</Label>
              <Input value={groupForm.name} onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })} placeholder="Ex : Écrans Siège" />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input value={groupForm.description} onChange={(e) => setGroupForm({ ...groupForm, description: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGrpOpen(false)}>Annuler</Button>
            <Button className="bg-orange-500 hover:bg-orange-600" onClick={saveGroup}>{editGroup ? 'Enregistrer' : 'Créer'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialogue connexion Android */}
      {connectDisplay && (
        <AndroidConnectDialog display={connectDisplay} onClose={() => setConnectDisplay(null)} />
      )}

      {/* Aperçu plein écran */}
      {previewDisplay && (
        <DisplayPreview
          open={!!previewId}
          onClose={() => setPreviewId(null)}
          display={previewDisplay}
          layouts={layouts}
          onOpenDesigner={onOpenDesigner}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer la suppression</AlertDialogTitle>
            <AlertDialogDescription>
              Voulez-vous vraiment supprimer « {deleteTarget?.name} » ? Cette action est irréversible.
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
