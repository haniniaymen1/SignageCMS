'use client'

import { useEffect, useState } from 'react'
import {
  Network, PlugZap, RefreshCw, Download, Search, FolderTree, CheckCircle2, XCircle, Info, UserPlus,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'

interface LdapConfigView {
  enabled: boolean
  url: string
  bindDn: string
  bindPassword: string
  hasBindPassword: boolean
  baseDn: string
  userOu: string
  userFilter: string
  usernameAttr: string
  emailAttr: string
  nameAttr: string
  defaultRole: string
  groupId: string | null
  disableMissing: boolean
  lastSyncAt: string | null
  lastSyncResult: string | null
  lastError: string | null
}

interface OuRow { dn: string; name: string }

interface PreviewUser {
  dn: string
  username: string
  name: string
  email: string
  exists: boolean
  role?: string
  status?: string
}

interface GroupRow { id: string; name: string }

const EMPTY_CFG: LdapConfigView = {
  enabled: false,
  url: '',
  bindDn: '',
  bindPassword: '',
  hasBindPassword: false,
  baseDn: '',
  userOu: '',
  userFilter: '(objectClass=person)',
  usernameAttr: 'uid',
  emailAttr: 'mail',
  nameAttr: 'cn',
  defaultRole: 'user',
  groupId: null,
  disableMissing: false,
  lastSyncAt: null,
  lastSyncResult: null,
  lastError: null,
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrateur',
  user: 'Utilisateur',
  'read-only': 'Lecture seule',
}

export default function LdapImportDialog({
  open, onOpenChange, groups, onImported,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  groups: GroupRow[]
  onImported: () => void
}) {
  const { toast } = useToast()
  const [cfg, setCfg] = useState<LdapConfigView>(EMPTY_CFG)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string } | null>(null)
  const [ous, setOus] = useState<OuRow[]>([])
  const [loadingOus, setLoadingOus] = useState(false)
  const [preview, setPreview] = useState<PreviewUser[] | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [importing, setImporting] = useState(false)

  const set = (patch: Partial<LdapConfigView>) => setCfg((c) => ({ ...c, ...patch }))

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setTestResult(null)
    setPreview(null)
    fetch('/api/ldap')
      .then((r) => r.json())
      .then((d) => setCfg({ ...EMPTY_CFG, ...(d.config ?? {}) }))
      .catch(() => toast({ title: 'Erreur', description: 'Chargement de la configuration LDAP impossible', variant: 'destructive' }))
      .finally(() => setLoading(false))
  }, [open, toast])

  /** Identifiants saisis à chaud (test / OU / aperçu avant enregistrement) */
  const overrides = () => {
    const o: Record<string, unknown> = {
      url: cfg.url, bindDn: cfg.bindDn, baseDn: cfg.baseDn,
      userOu: cfg.userOu, userFilter: cfg.userFilter,
      usernameAttr: cfg.usernameAttr, emailAttr: cfg.emailAttr, nameAttr: cfg.nameAttr,
    }
    if (cfg.bindPassword.trim()) o.bindPassword = cfg.bindPassword
    return o
  }

  const runTest = async () => {
    if (!cfg.url.trim()) {
      toast({ title: 'URL requise', description: 'Saisissez ldap://hote:389 ou ldaps://hote:636', variant: 'destructive' })
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const r = await fetch('/api/ldap/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides: overrides() }),
      })
      const d = await r.json()
      setTestResult(d.ok ? { ok: true, message: d.namingContext ? `Connexion réussie — contexte : ${d.namingContext}` : 'Connexion réussie' } : { ok: false, message: d.error })
    } catch {
      setTestResult({ ok: false, message: 'Test impossible' })
    } finally {
      setTesting(false)
    }
  }

  const loadOus = async () => {
    setLoadingOus(true)
    try {
      const r = await fetch('/api/ldap/ous', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides: overrides() }),
      })
      const d = await r.json()
      if (d.ous) setOus(d.ous)
      else toast({ title: 'Échec', description: d.error ?? 'Liste des OU impossible', variant: 'destructive' })
    } catch {
      toast({ title: 'Erreur réseau', description: 'Impossible de joindre le serveur LDAP', variant: 'destructive' })
    } finally {
      setLoadingOus(false)
    }
  }

  const runPreview = async () => {
    const ou = cfg.userOu.trim() || cfg.baseDn.trim()
    if (!ou) {
      toast({ title: 'OU requise', description: "Choisissez une unité d'organisation", variant: 'destructive' })
      return
    }
    setPreviewing(true)
    try {
      const r = await fetch('/api/ldap/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ou, overrides: overrides() }),
      })
      const d = await r.json()
      if (d.users) setPreview(d.users)
      else toast({ title: 'Échec', description: d.error ?? 'Recherche impossible', variant: 'destructive' })
    } catch {
      toast({ title: 'Erreur réseau', description: 'Recherche impossible', variant: 'destructive' })
    } finally {
      setPreviewing(false)
    }
  }

  const saveConfig = async () => {
    setSaving(true)
    try {
      const r = await fetch('/api/ldap', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: cfg.enabled, url: cfg.url, bindDn: cfg.bindDn, baseDn: cfg.baseDn,
          userOu: cfg.userOu, userFilter: cfg.userFilter, usernameAttr: cfg.usernameAttr,
          emailAttr: cfg.emailAttr, nameAttr: cfg.nameAttr, defaultRole: cfg.defaultRole,
          groupId: cfg.groupId, disableMissing: cfg.disableMissing,
          ...(cfg.bindPassword.trim() ? { bindPassword: cfg.bindPassword } : {}),
        }),
      })
      const d = await r.json()
      if (r.ok && d.config) {
        setCfg({ ...EMPTY_CFG, ...d.config })
        toast({ title: 'Configuration enregistrée', description: 'La connexion LDAP est prête à être utilisée' })
      } else {
        toast({ title: 'Erreur', description: d.error ?? "Enregistrement impossible", variant: 'destructive' })
      }
    } finally {
      setSaving(false)
    }
  }

  const runImport = async () => {
    const ou = cfg.userOu.trim() || cfg.baseDn.trim()
    if (!ou) {
      toast({ title: 'OU requise', description: "Choisissez une unité d'organisation", variant: 'destructive' })
      return
    }
    setImporting(true)
    try {
      const r = await fetch('/api/ldap/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ou, defaultRole: cfg.defaultRole, groupId: cfg.groupId, disableMissing: cfg.disableMissing,
          overrides: overrides(),
        }),
      })
      const d = await r.json()
      if (d.ok) {
        const s = d.stats
        toast({
          title: `Import terminé — ${s.found} utilisateur(s) dans l'OU`,
          description: `${s.created} créé(s), ${s.updated} mis à jour${s.disabled ? `, ${s.disabled} désactivé(s)` : ''}${s.skipped ? `, ${s.skipped} ignoré(s)` : ''}`,
        })
        onImported()
        onOpenChange(false)
      } else {
        toast({ title: 'Import impossible', description: d.error, variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Erreur réseau', description: 'Import impossible', variant: 'destructive' })
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Network className="h-5 w-5 text-orange-500" /> Importer des utilisateurs depuis LDAP
          </DialogTitle>
          <DialogDescription>
            Connectez-vous à votre annuaire (Active Directory, OpenLDAP…) et importez précisément
            les utilisateurs d&apos;une unité d&apos;organisation (OU) choisie.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-slate-400">
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Chargement de la configuration…
          </div>
        ) : (
          <div className="space-y-5">
            {/* Connexion */}
            <section className="space-y-3 rounded-lg border border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <PlugZap className="h-4 w-4 text-orange-500" /> Connexion au serveur
                </h4>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">Authentification LDAP à la connexion</span>
                  <Switch checked={cfg.enabled} onCheckedChange={(v) => set({ enabled: v })} />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>URL du serveur *</Label>
                  <Input value={cfg.url} onChange={(e) => set({ url: e.target.value })} placeholder="ldap://annuaire.exemple.fr:389" />
                </div>
                <div className="space-y-1.5">
                  <Label>Base DN *</Label>
                  <Input value={cfg.baseDn} onChange={(e) => set({ baseDn: e.target.value })} placeholder="dc=entreprise,dc=fr" />
                </div>
                <div className="space-y-1.5">
                  <Label>Compte technique (Bind DN)</Label>
                  <Input value={cfg.bindDn} onChange={(e) => set({ bindDn: e.target.value })} placeholder="cn=lecture-seule,ou=services,dc=entreprise,dc=fr" />
                </div>
                <div className="space-y-1.5">
                  <Label>Mot de passe {cfg.hasBindPassword ? '(enregistré)' : ''}</Label>
                  <Input
                    type="password"
                    value={cfg.bindPassword}
                    onChange={(e) => set({ bindPassword: e.target.value })}
                    placeholder={cfg.hasBindPassword ? 'Laisser vide = inchangé' : 'Mot de passe du compte technique'}
                    autoComplete="new-password"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" size="sm" onClick={runTest} disabled={testing}>
                  {testing ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <PlugZap className="mr-2 h-4 w-4" />}
                  Tester la connexion
                </Button>
                {testResult?.ok && (
                  <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600">
                    <CheckCircle2 className="h-4 w-4" /> {testResult.message}
                  </span>
                )}
                {testResult && !testResult.ok && (
                  <span className="flex items-center gap-1.5 text-xs font-medium text-red-500">
                    <XCircle className="h-4 w-4" /> {testResult.message}
                  </span>
                )}
              </div>
            </section>

            {/* OU spécifique */}
            <section className="space-y-3 rounded-lg border border-slate-200 p-4">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <FolderTree className="h-4 w-4 text-orange-500" /> Unité d&apos;organisation (OU) à importer
              </h4>
              <div className="flex flex-wrap items-end gap-3">
                <Button variant="outline" size="sm" onClick={loadOus} disabled={loadingOus || !cfg.url.trim()}>
                  {loadingOus ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <FolderTree className="mr-2 h-4 w-4" />}
                  Charger les OU de l&apos;annuaire
                </Button>
                {ous.length > 0 && (
                  <div className="min-w-56 flex-1 space-y-1.5">
                    <Label>Choisir dans l&apos;arborescence</Label>
                    <Select value={cfg.userOu} onValueChange={(v) => set({ userOu: v })}>
                      <SelectTrigger><SelectValue placeholder="Sélectionner une OU" /></SelectTrigger>
                      <SelectContent className="max-h-64">
                        {ous.map((o) => (
                          <SelectItem key={o.dn} value={o.dn}>{o.name} — {o.dn}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>OU spécifique (DN exact) — utilisé pour l&apos;import et l&apos;authentification</Label>
                <Input value={cfg.userOu} onChange={(e) => set({ userOu: e.target.value })} placeholder="ou=Personnel,dc=entreprise,dc=fr" />
                <p className="text-xs text-slate-400">
                  Seuls les utilisateurs contenus dans cette branche seront importés. Laissez vide pour toute la base.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Filtre de recherche</Label>
                  <Input value={cfg.userFilter} onChange={(e) => set({ userFilter: e.target.value })} placeholder="(objectClass=person)" />
                </div>
                <div className="flex items-center gap-2 pt-5">
                  <Switch checked={cfg.disableMissing} onCheckedChange={(v) => set({ disableMissing: v })} id="disable-missing" />
                  <Label htmlFor="disable-missing" className="cursor-pointer text-xs">
                    Désactiver les comptes LDAP absents de l&apos;OU lors de l&apos;import
                  </Label>
                </div>
              </div>
            </section>

            {/* Attributs et attribution */}
            <section className="space-y-3 rounded-lg border border-slate-200 p-4">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <Info className="h-4 w-4 text-orange-500" /> Attributs et attribution
              </h4>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>Attribut identifiant</Label>
                  <Select value={cfg.usernameAttr} onValueChange={(v) => set({ usernameAttr: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="uid">uid (OpenLDAP)</SelectItem>
                      <SelectItem value="sAMAccountName">sAMAccountName (AD)</SelectItem>
                      <SelectItem value="cn">cn</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Attribut nom</Label>
                  <Select value={cfg.nameAttr} onValueChange={(v) => set({ nameAttr: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cn">cn</SelectItem>
                      <SelectItem value="displayName">displayName</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Attribut email</Label>
                  <Select value={cfg.emailAttr} onValueChange={(v) => set({ emailAttr: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mail">mail</SelectItem>
                      <SelectItem value="userPrincipalName">userPrincipalName</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Rôle des nouveaux comptes</Label>
                  <Select value={cfg.defaultRole} onValueChange={(v) => set({ defaultRole: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Administrateur</SelectItem>
                      <SelectItem value="user">Utilisateur</SelectItem>
                      <SelectItem value="read-only">Lecture seule</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Groupe CMS des nouveaux comptes</Label>
                  <Select
                    value={cfg.groupId || 'none'}
                    onValueChange={(v) => set({ groupId: v === 'none' ? null : v })}
                  >
                    <SelectTrigger><SelectValue placeholder="Aucun" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Aucun</SelectItem>
                      {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-xs text-slate-400">
                À la connexion, les utilisateurs de l&apos;OU s&apos;authentifient par l&apos;annuaire — leur mot de passe LDAP n&apos;est jamais stocké ici.
              </p>
            </section>

            {/* Aperçu */}
            <section className="space-y-3 rounded-lg border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <Search className="h-4 w-4 text-orange-500" /> Aperçu de l&apos;import
                </h4>
                <Button variant="outline" size="sm" onClick={runPreview} disabled={previewing || !cfg.url.trim()}>
                  {previewing ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                  Rechercher les utilisateurs
                </Button>
              </div>
              {preview && (
                preview.length === 0 ? (
                  <p className="rounded-md bg-slate-50 py-6 text-center text-sm text-slate-400">
                    Aucun utilisateur trouvé — vérifiez l&apos;OU, le filtre et les attributs.
                  </p>
                ) : (
                  <ScrollArea className="max-h-56 rounded-md border border-slate-100">
                    <div className="divide-y divide-slate-100">
                      {preview.map((u) => (
                        <div key={u.dn} className="flex items-center justify-between gap-3 px-3 py-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-slate-700">{u.name}</div>
                            <div className="truncate text-xs text-slate-400">@{u.username} · {u.dn}</div>
                          </div>
                          {u.exists ? (
                            <Badge className="shrink-0 border-transparent bg-slate-100 text-slate-600">Déjà présent</Badge>
                          ) : (
                            <Badge className="shrink-0 border-transparent bg-emerald-100 text-emerald-700">
                              <UserPlus className="mr-1 h-3 w-3" /> Nouveau
                            </Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )
              )}
              {(cfg.lastSyncResult || cfg.lastError) && (
                <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  {cfg.lastSyncAt && <span>Dernier import : {new Date(cfg.lastSyncAt).toLocaleString('fr-FR', { hour12: false })} — </span>}
                  {cfg.lastSyncResult}
                  {cfg.lastError && <span className="text-red-500"> — {cfg.lastError}</span>}
                </div>
              )}
            </section>
          </div>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={saveConfig} disabled={saving}>
            {saving ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            Enregistrer la configuration
          </Button>
          <Button className="bg-orange-500 hover:bg-orange-600" onClick={runImport} disabled={importing || !cfg.url.trim()}>
            {importing ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Importer depuis l&apos;OU
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
