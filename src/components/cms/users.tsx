'use client'

import { useEffect, useState } from 'react'
import {
  Plus, Search, Trash2, Pencil, Users as UsersIcon, Shield, ShieldCheck, UserCog,
  Ban, CheckCircle2, KeyRound, LockOpen, Eye, EyeOff, Network,
} from 'lucide-react'
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
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/hooks/use-toast'
import { useResource, apiCreate, apiUpdate, apiDelete, formatDate, formatDateTime } from './api-client'
import LdapImportDialog from './ldap-import'

interface UserRow {
  id: string
  username: string
  email: string
  name: string
  role: string
  status: string
  hasPassword?: boolean
  authProvider?: string
  lastLogin: string | null
  createdAt: string
  userGroup?: { id: string; name: string } | null
}

interface Me {
  id: string
  username: string
  role: string
  name: string
}

interface UserGroupRow {
  id: string
  name: string
  _count?: { users: number }
}

const ROLE_BADGES: Record<string, string> = {
  admin: 'bg-orange-100 text-orange-700',
  user: 'bg-sky-100 text-sky-700',
  'read-only': 'bg-slate-100 text-slate-600',
}
const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrateur',
  user: 'Utilisateur',
  'read-only': 'Lecture seule',
}

export default function UsersView() {
  const { data: users, refresh: refreshUsers } = useResource<UserRow>('users')
  const { data: groups, refresh: refreshGroups } = useResource<UserGroupRow>('user-groups')
  const { toast } = useToast()

  const [search, setSearch] = useState('')
  const [dlgOpen, setDlgOpen] = useState(false)
  const [editing, setEditing] = useState<UserRow | null>(null)
  const [grpOpen, setGrpOpen] = useState(false)
  const [editGroup, setEditGroup] = useState<UserGroupRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ type: string; id: string; name: string } | null>(null)

  const [form, setForm] = useState({ name: '', username: '', email: '', role: 'user', groupId: '', password: '', confirm: '' })
  const [groupForm, setGroupForm] = useState({ name: '' })
  const [me, setMe] = useState<Me | null>(null)
  const [pwTarget, setPwTarget] = useState<UserRow | null>(null)
  const [pwForm, setPwForm] = useState({ next: '', confirm: '' })
  const [showPw, setShowPw] = useState(false)
  const [ldapOpen, setLdapOpen] = useState(false)

  useEffect(() => {
    fetch('/api/auth/me').then((r) => r.json()).then((d) => setMe(d.user)).catch(() => {})
  }, [])
  const isAdmin = me?.role === 'admin'

  const openAdd = () => {
    setEditing(null)
    setForm({ name: '', username: '', email: '', role: 'user', groupId: '', password: '', confirm: '' })
    setDlgOpen(true)
  }
  const openEdit = (u: UserRow) => {
    setEditing(u)
    setForm({ name: u.name, username: u.username, email: u.email, role: u.role, groupId: u.userGroup?.id ?? '', password: '', confirm: '' })
    setDlgOpen(true)
  }

  const save = async () => {
    if (!form.name.trim() || !form.username.trim() || !form.email.trim()) {
      toast({ title: 'Champs requis', description: 'Nom, identifiant et email sont obligatoires', variant: 'destructive' })
      return
    }
    // Mot de passe : obligatoire à la création, optionnel en modification
    let password: string | undefined
    if (!editing || form.password) {
      if (form.password.length < 6) {
        toast({ title: 'Mot de passe trop court', description: '6 caractères minimum', variant: 'destructive' })
        return
      }
      if (form.password !== form.confirm) {
        toast({ title: 'Confirmation différente', description: 'Les deux mots de passe ne correspondent pas', variant: 'destructive' })
        return
      }
      password = form.password
    }
    const payload: Record<string, unknown> = {
      name: form.name,
      username: form.username,
      email: form.email,
      role: form.role,
      userGroupId: form.groupId || null,
      ...(password ? { password } : {}),
    }
    const ok = editing ? await apiUpdate('users', editing.id, payload) : await apiCreate('users', payload)
    if (ok) {
      toast({ title: editing ? 'Utilisateur modifié' : 'Utilisateur créé', description: form.name })
      setDlgOpen(false)
      refreshUsers()
    } else {
      toast({ title: 'Erreur', description: "L'enregistrement a échoué (identifiant ou email déjà pris ?)", variant: 'destructive' })
    }
  }

  const savePassword = async () => {
    if (!pwTarget) return
    if (pwForm.next.length < 6) {
      toast({ title: 'Mot de passe trop court', description: '6 caractères minimum', variant: 'destructive' })
      return
    }
    if (pwForm.next !== pwForm.confirm) {
      toast({ title: 'Confirmation différente', description: 'Les deux mots de passe ne correspondent pas', variant: 'destructive' })
      return
    }
    const ok = await apiUpdate('users', pwTarget.id, { password: pwForm.next })
    if (ok) {
      toast({ title: 'Mot de passe défini', description: pwTarget.name })
      setPwTarget(null)
      setPwForm({ next: '', confirm: '' })
      refreshUsers()
    } else {
      toast({ title: 'Erreur', description: 'Le changement a échoué', variant: 'destructive' })
    }
  }

  const toggleStatus = async (u: UserRow) => {
    await apiUpdate('users', u.id, { status: u.status === 'active' ? 'disabled' : 'active' })
    refreshUsers()
  }

  const saveGroup = async () => {
    if (!groupForm.name.trim()) return
    const ok = editGroup
      ? await apiUpdate('user-groups', editGroup.id, { name: groupForm.name })
      : await apiCreate('user-groups', { name: groupForm.name })
    if (ok) {
      toast({ title: editGroup ? 'Groupe modifié' : 'Groupe créé', description: groupForm.name })
      setGrpOpen(false)
      refreshGroups()
    } else {
      toast({ title: 'Erreur', description: 'Ce nom existe peut-être déjà', variant: 'destructive' })
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    const ok = await apiDelete(deleteTarget.type, deleteTarget.id)
    if (ok) {
      toast({ title: 'Supprimé', description: deleteTarget.name })
      if (deleteTarget.type === 'users') refreshUsers()
      else refreshGroups()
    }
    setDeleteTarget(null)
  }

  const toggleShowPw = () => setShowPw((v) => !v)

  const passwordFields = (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-1.5">
        <Label>{editing ? 'Nouveau mot de passe' : 'Mot de passe *'}</Label>
        <div className="relative">
          <Input
            type={showPw ? 'text' : 'password'}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder={editing ? 'Laisser vide = inchangé' : '6 caractères minimum'}
            className="pr-10"
            autoComplete="new-password"
          />
          <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" onClick={toggleShowPw}>
            {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Confirmation {editing && form.password ? '*' : ''}</Label>
        <Input
          type={showPw ? 'text' : 'password'}
          value={form.confirm}
          onChange={(e) => setForm({ ...form, confirm: e.target.value })}
          placeholder={editing && !form.password ? '—' : 'Répéter le mot de passe'}
          autoComplete="new-password"
        />
      </div>
    </div>
  )

  const filteredUsers = users.filter((u) =>
    `${u.name} ${u.username} ${u.email}`.toLowerCase().includes(search.toLowerCase())
  )
  const filteredGroups = groups.filter((g) => g.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {!isAdmin && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Consultation seule — seuls les administrateurs peuvent gérer les comptes.
          </div>
        )}
        <div className="relative ml-auto w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher…" className="pl-9" />
        </div>
        <Button variant="outline" className="border-orange-300 text-orange-600 hover:bg-orange-50" onClick={() => setLdapOpen(true)} disabled={!isAdmin}>
          <Network className="h-4 w-4" /> Importer LDAP
        </Button>
        <Button className="bg-orange-500 hover:bg-orange-600" onClick={openAdd} disabled={!isAdmin}>
          <Plus className="h-4 w-4" /> Ajouter un utilisateur
        </Button>
      </div>

      <Tabs defaultValue="users">
        <TabsList className="bg-white">
          <TabsTrigger value="users" className="gap-2"><UsersIcon className="h-4 w-4" />Utilisateurs ({users.length})</TabsTrigger>
          <TabsTrigger value="groups" className="gap-2"><UserCog className="h-4 w-4" />Groupes ({groups.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <Card className="border-slate-200">
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-200">
                    <TableHead>Utilisateur</TableHead>
                    <TableHead className="hidden md:table-cell">Identifiant</TableHead>
                    <TableHead className="hidden lg:table-cell">Email</TableHead>
                    <TableHead>Rôle</TableHead>
                    <TableHead className="hidden md:table-cell">Groupe</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead className="hidden lg:table-cell">Mot de passe</TableHead>
                    <TableHead className="hidden lg:table-cell">Créé le</TableHead>
                    <TableHead className="hidden xl:table-cell">Dernière connexion</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((u) => (
                    <TableRow key={u.id} className="border-slate-100">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-9 w-9">
                            <AvatarFallback className="bg-orange-500 text-xs font-bold text-white">
                              {u.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-slate-800">{u.name}</span>
                              {u.authProvider === 'ldap' && (
                                <Badge className="border-transparent bg-emerald-100 text-[10px] text-emerald-700" title="Compte importé depuis LDAP — mot de passe vérifié par l'annuaire">
                                  LDAP
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden text-slate-600 md:table-cell">@{u.username}</TableCell>
                      <TableCell className="hidden text-slate-500 lg:table-cell">{u.email}</TableCell>
                      <TableCell>
                        <Badge className={`border-transparent ${ROLE_BADGES[u.role]}`}>
                          {u.role === 'admin' ? <ShieldCheck className="mr-1 h-3 w-3" /> : <Shield className="mr-1 h-3 w-3" />}
                          {ROLE_LABELS[u.role] ?? u.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden text-slate-500 md:table-cell">{u.userGroup?.name ?? '—'}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Switch checked={u.status === 'active'} onCheckedChange={() => toggleStatus(u)} disabled={!isAdmin} />
                          <span className={`flex items-center gap-1 text-xs ${u.status === 'active' ? 'text-emerald-600' : 'text-slate-400'}`}>
                            {u.status === 'active' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                            {u.status === 'active' ? 'Actif' : 'Désactivé'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {u.hasPassword ? (
                          <span className="flex items-center gap-1.5 text-xs text-emerald-600" title="Mot de passe défini">
                            <KeyRound className="h-3.5 w-3.5" /> Défini
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 text-xs text-slate-400" title="Aucun mot de passe — ce compte ne peut pas se connecter">
                            <LockOpen className="h-3.5 w-3.5" /> Aucun
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-slate-400 lg:table-cell">{formatDate(u.createdAt)}</TableCell>
                      <TableCell className="hidden text-slate-400 xl:table-cell">{formatDateTime(u.lastLogin)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" title="Définir / changer le mot de passe" disabled={!isAdmin}
                            onClick={() => { setPwTarget(u); setPwForm({ next: '', confirm: '' }) }}>
                            <KeyRound className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="sm" disabled={!isAdmin} onClick={() => openEdit(u)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="sm" className="text-red-500" disabled={!isAdmin || u.username === me?.username}
                            title={u.username === me?.username ? 'Impossible de supprimer votre propre compte' : 'Supprimer'}
                            onClick={() => setDeleteTarget({ type: 'users', id: u.id, name: u.name })}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredUsers.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={10} className="py-10 text-center text-slate-400">Aucun utilisateur trouvé</TableCell>
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
              <Card key={g.id} className="border-slate-200">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                      <UserCog className="h-5 w-5" />
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => { setEditGroup(g); setGroupForm({ name: g.name }); setGrpOpen(true) }}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" className="text-red-500" onClick={() => setDeleteTarget({ type: 'user-groups', id: g.id, name: g.name })}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 font-semibold text-slate-900">{g.name}</div>
                  <div className="mt-1 text-xs text-slate-500">{g._count?.users ?? 0} utilisateur(s)</div>
                </CardContent>
              </Card>
            ))}
            <button
              className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 text-slate-400 transition-colors hover:border-orange-400 hover:text-orange-500"
              onClick={() => { setEditGroup(null); setGroupForm({ name: '' }); setGrpOpen(true) }}
            >
              <Plus className="h-6 w-6" />
              <span className="text-sm font-medium">Nouveau groupe</span>
            </button>
          </div>
        </TabsContent>
      </Tabs>

      {/* Dialogue utilisateur */}
      <Dialog open={dlgOpen} onOpenChange={setDlgOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Modifier l\u2019utilisateur' : 'Nouvel utilisateur'}</DialogTitle>
            <DialogDescription>Les utilisateurs accèdent au CMS selon leur rôle et leur groupe.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Nom complet *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex : Marie Dupont" />
              </div>
              <div className="space-y-1.5">
                <Label>Identifiant *</Label>
                <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="marie.d" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Email *</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="exemple@domaine.fr" />
            </div>
            {passwordFields}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Rôle</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Administrateur</SelectItem>
                    <SelectItem value="user">Utilisateur</SelectItem>
                    <SelectItem value="read-only">Lecture seule</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Groupe</Label>
                <Select value={form.groupId || undefined} onValueChange={(v) => setForm({ ...form, groupId: v === 'none' ? '' : v })}>
                  <SelectTrigger><SelectValue placeholder="Aucun" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Aucun</SelectItem>
                    {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlgOpen(false)}>Annuler</Button>
            <Button className="bg-orange-500 hover:bg-orange-600" onClick={save}>{editing ? 'Enregistrer' : 'Créer'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialogue mot de passe (réinitialisation par l'admin) */}
      <Dialog open={!!pwTarget} onOpenChange={(o) => !o && setPwTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-orange-500" /> Mot de passe — {pwTarget?.name}
            </DialogTitle>
            <DialogDescription>
              Définissez un nouveau mot de passe pour « {pwTarget?.username} ». L&apos;utilisateur devra l&apos;utiliser à sa prochaine connexion.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nouveau mot de passe *</Label>
              <div className="relative">
                <Input
                  type={showPw ? 'text' : 'password'}
                  value={pwForm.next}
                  onChange={(e) => setPwForm({ ...pwForm, next: e.target.value })}
                  placeholder="6 caractères minimum"
                  className="pr-10"
                  autoFocus
                />
                <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" onClick={toggleShowPw}>
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Confirmation *</Label>
              <Input
                type={showPw ? 'text' : 'password'}
                value={pwForm.confirm}
                onChange={(e) => setPwForm({ ...pwForm, confirm: e.target.value })}
                placeholder="Répéter le mot de passe"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwTarget(null)}>Annuler</Button>
            <Button className="bg-orange-500 hover:bg-orange-600" onClick={savePassword}>Définir le mot de passe</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialogue groupe */}
      <Dialog open={grpOpen} onOpenChange={setGrpOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editGroup ? 'Modifier le groupe' : 'Nouveau groupe d\u2019utilisateurs'}</DialogTitle>
            <DialogDescription>Les groupes simplifient la gestion des permissions.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Nom du groupe *</Label>
            <Input value={groupForm.name} onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })} placeholder="Ex : Équipe Communication" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGrpOpen(false)}>Annuler</Button>
            <Button className="bg-orange-500 hover:bg-orange-600" onClick={saveGroup}>{editGroup ? 'Enregistrer' : 'Créer'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialogue import LDAP */}
      <LdapImportDialog open={ldapOpen} onOpenChange={setLdapOpen} groups={groups} onImported={refreshUsers} />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer la suppression</AlertDialogTitle>
            <AlertDialogDescription>« {deleteTarget?.name} » sera définitivement supprimé.</AlertDialogDescription>
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
