'use client'

import { useEffect, useState } from 'react'
import {
  LayoutDashboard, Monitor, Images, LayoutTemplate, ListVideo,
  Megaphone, CalendarDays, BarChart3, Users, Settings, Menu, X,
  Search, Bell, ChevronDown, CircleUser, Tv, LogOut, KeyRound, ShieldCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { APP_VERSION } from '@/lib/version'
import { clearToken } from '@/lib/auth-token'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import DashboardView from './dashboard'
import DisplaysView from './displays'
import MediaView from './media-library'
import IptvView from './iptv'
import LayoutsView from './layouts'
import PlaylistsView from './playlists'
import CampaignsView from './campaigns'
import ScheduleView from './schedule'
import ReportsView from './reports'
import UsersView from './users'
import SettingsView from './settings'
import PermissionsView from './permissions'

export type ViewId =
  | 'dashboard' | 'displays' | 'media' | 'iptv' | 'layouts' | 'playlists'
  | 'campaigns' | 'schedule' | 'reports' | 'users' | 'settings' | 'permissions'

const MENU: { id: ViewId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
  { id: 'displays', label: 'Écrans', icon: Monitor },
  { id: 'media', label: 'Bibliothèque de médias', icon: Images },
  { id: 'iptv', label: 'TV / IPTV', icon: Tv },
  { id: 'layouts', label: 'Présentations', icon: LayoutTemplate },
  { id: 'playlists', label: 'Playlists', icon: ListVideo },
  { id: 'campaigns', label: 'Campagnes', icon: Megaphone },
  { id: 'schedule', label: 'Planification', icon: CalendarDays },
  { id: 'reports', label: 'Rapports', icon: BarChart3 },
  { id: 'users', label: 'Utilisateurs', icon: Users },
  { id: 'settings', label: 'Paramètres', icon: Settings },
  { id: 'permissions', label: 'Rôles & droits', icon: ShieldCheck },
]

// Sections de la barre latérale
const GENERAL_IDS: ViewId[] = ['dashboard', 'displays', 'media', 'iptv', 'layouts', 'playlists', 'campaigns', 'schedule']
const ADMIN_IDS: ViewId[] = ['reports', 'users', 'settings', 'permissions']

export default function Shell() {
  const [view, setView] = useState<ViewId>('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [designLayoutId, setDesignLayoutId] = useState<string | null>(null)
  const { toast } = useToast()

  // Utilisateur connecté (session) + permissions de son rôle
  const [me, setMe] = useState<{
    name: string; username: string; email: string; role: string;
    permissions?: Record<string, string[]> | null;
  } | null>(null)
  const [pwOpen, setPwOpen] = useState(false)
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' })

  useEffect(() => {
    fetch('/api/auth/me').then((r) => r.json()).then((d) => setMe({ ...d.user, permissions: d.permissions ?? null })).catch(() => {})
  }, [])

  const ROLE_LABELS: Record<string, string> = {
    admin: 'Administrateur', user: 'Utilisateur', 'read-only': 'Lecture seule',
  }

  const changeMyPassword = async () => {
    if (pwForm.next.length < 6) {
      toast({ title: 'Mot de passe trop court', description: '6 caractères minimum', variant: 'destructive' })
      return
    }
    if (pwForm.next !== pwForm.confirm) {
      toast({ title: 'Confirmation différente', description: 'Les deux mots de passe ne correspondent pas', variant: 'destructive' })
      return
    }
    const res = await fetch('/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current: pwForm.current, next: pwForm.next }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      toast({ title: 'Mot de passe modifié', description: 'Utilisez-le à votre prochaine connexion' })
      setPwOpen(false)
      setPwForm({ current: '', next: '', confirm: '' })
    } else {
      toast({ title: 'Erreur', description: data.error ?? 'Le changement a échoué', variant: 'destructive' })
    }
  }

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    clearToken()
    window.location.href = '/login'
  }

  // Droits d'accès : pages visibles selon les permissions du rôle (admin = tout)
  const canSee = (id: ViewId): boolean => {
    if (!me) return true // avant chargement : tout afficher (l'API bloquera au besoin)
    if (me.role === 'admin') return true
    if (id === 'permissions') return false // réservé à l'administrateur
    return (me.permissions?.[id] ?? []).includes('view')
  }

  // Vue effective : si la vue courante devient interdite (changement de droits),
  // retomber sur le tableau de bord sans effet ni rendu interdit
  const activeView: ViewId = !me || canSee(view) ? view : 'dashboard'

  const initials = (me?.name ?? 'A')
    .split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()

  const menuSection = (ids: ViewId[]) =>
    MENU.filter((item) => ids.includes(item.id) && canSee(item.id))

  const current = MENU.find((m) => m.id === activeView)
  const CurrentIcon = current?.icon

  const openDesigner = (layoutId: string) => {
    setDesignLayoutId(layoutId)
    setView('layouts')
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-screen bg-slate-100">
        {/* ===== Barre latérale ===== */}
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-[#141d2e] text-slate-300 transition-transform lg:static lg:translate-x-0',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          {/* Logo */}
          <div className="flex h-16 items-center gap-3 border-b border-white/10 px-5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/20">
              <Monitor className="h-5 w-5" />
            </div>
            <div>
              <div className="text-base font-bold tracking-tight text-white">SignageCMS</div>
              <div className="text-[10px] uppercase tracking-widest text-orange-400">Affichage dynamique</div>
            </div>
            <button
              className="ml-auto text-slate-400 hover:text-white lg:hidden"
              onClick={() => setSidebarOpen(false)}
              aria-label="Fermer le menu"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Menu */}
          <nav className="flex-1 overflow-y-auto px-3 py-4">
            <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Général
            </div>
            <ul className="space-y-1">
              {menuSection(GENERAL_IDS).map((item) => (
                <li key={item.id}>
                  <button
                    onClick={() => { setView(item.id); setSidebarOpen(false) }}
                    className={cn(
                      'group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                      activeView === item.id
                        ? 'bg-orange-500/15 text-orange-300'
                        : 'text-slate-300 hover:bg-white/5 hover:text-white'
                    )}
                  >
                    <item.icon className={cn('h-[18px] w-[18px]', activeView === item.id ? 'text-orange-400' : 'text-slate-400 group-hover:text-white')} />
                    {item.label}
                    {activeView === item.id && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-orange-400" />}
                  </button>
                </li>
              ))}
            </ul>
            <div className="mb-2 mt-6 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Administration
            </div>
            <ul className="space-y-1">
              {menuSection(ADMIN_IDS).map((item) => (
                <li key={item.id}>
                  <button
                    onClick={() => { setView(item.id); setSidebarOpen(false) }}
                    className={cn(
                      'group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                      activeView === item.id
                        ? 'bg-orange-500/15 text-orange-300'
                        : 'text-slate-300 hover:bg-white/5 hover:text-white'
                    )}
                  >
                    <item.icon className={cn('h-[18px] w-[18px]', activeView === item.id ? 'text-orange-400' : 'text-slate-400 group-hover:text-white')} />
                    {item.label}
                    {activeView === item.id && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-orange-400" />}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {/* Pied de sidebar */}
          <div className="border-t border-white/10 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-700">
                <CircleUser className="h-5 w-5 text-slate-300" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-white">{me?.name ?? '…'}</div>
                <div className="truncate text-xs text-slate-400">{me?.email || me?.username || ''}</div>
              </div>
              <button
                className="ml-auto rounded-md p-2 text-slate-400 hover:bg-white/5 hover:text-white"
                title="Déconnexion"
                onClick={logout}
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-2 text-center text-[10px] uppercase tracking-widest text-slate-500">
              SignageCMS v{APP_VERSION}
            </div>
          </div>
        </aside>

        {/* Overlay mobile */}
        {sidebarOpen && (
          <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
        )}

        {/* ===== Contenu principal ===== */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* En-tête */}
          <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-slate-200 bg-white px-4 sm:px-6">
            <button
              className="rounded-md p-2 hover:bg-slate-100 lg:hidden"
              onClick={() => setSidebarOpen(true)}
              aria-label="Ouvrir le menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 text-sm text-slate-500">
              {CurrentIcon && <CurrentIcon className="h-4 w-4 text-orange-500" />}
              <span className="font-semibold text-slate-900">{current?.label}</span>
            </div>

            <div className="relative ml-auto hidden w-72 md:block">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input placeholder="Rechercher…" className="h-9 rounded-full bg-slate-50 pl-9 text-sm" />
            </div>

            <Button
              size="sm"
              className="ml-auto hidden h-9 bg-orange-500 hover:bg-orange-600 md:ml-0 md:inline-flex"
              onClick={() => setView('dashboard')}
            >
              <Bell className="h-4 w-4" />
              <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-[10px] font-bold text-orange-600">3</span>
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-slate-100">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-500 text-sm font-bold text-white">{initials}</div>
                  <ChevronDown className="h-4 w-4 text-slate-500" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>
                  <div className="font-medium">{me?.name ?? 'Mon compte'}</div>
                  <div className="text-xs font-normal text-slate-500">{ROLE_LABELS[me?.role ?? ''] ?? ''}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setPwOpen(true)}>
                  <KeyRound className="mr-2 h-4 w-4" /> Changer mon mot de passe
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setView('settings')}>Paramètres</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-red-600" onClick={logout}>
                  <LogOut className="mr-2 h-4 w-4" /> Déconnexion
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </header>

          {/* Vues */}
          <main className="flex-1 p-4 sm:p-6">
            {activeView === 'dashboard' && <DashboardView onNavigate={(v) => setView(v as ViewId)} />}
            {activeView === 'displays' && <DisplaysView onOpenDesigner={openDesigner} />}
            {activeView === 'media' && <MediaView />}
            {activeView === 'iptv' && <IptvView />}
            {activeView === 'layouts' && <LayoutsView designLayoutId={designLayoutId} onExitDesign={() => setDesignLayoutId(null)} />}
            {activeView === 'playlists' && <PlaylistsView />}
            {activeView === 'campaigns' && <CampaignsView />}
            {activeView === 'schedule' && <ScheduleView />}
            {activeView === 'reports' && <ReportsView />}
            {activeView === 'users' && <UsersView />}
            {activeView === 'settings' && <SettingsView />}
            {activeView === 'permissions' && <PermissionsView />}
          </main>

          {/* Pied de page */}
          <footer className="mt-auto border-t border-slate-200 bg-white px-6 py-3 text-center text-xs text-slate-400">
            SignageCMS v1.0 — Gestion d&apos;affichage dynamique · © {new Date().getFullYear()}
          </footer>
        </div>
      </div>

      {/* Dialogue : changer mon mot de passe */}
      <Dialog open={pwOpen} onOpenChange={setPwOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-orange-500" /> Changer mon mot de passe
            </DialogTitle>
            <DialogDescription>
              Connecté en tant que <span className="font-medium">{me?.username}</span>. Le mot de passe doit contenir au moins 6 caractères.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Mot de passe actuel</Label>
              <Input
                type="password"
                value={pwForm.current}
                onChange={(e) => setPwForm({ ...pwForm, current: e.target.value })}
                autoComplete="current-password"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Nouveau</Label>
                <Input
                  type="password"
                  value={pwForm.next}
                  onChange={(e) => setPwForm({ ...pwForm, next: e.target.value })}
                  placeholder="6 caractères min."
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Confirmation</Label>
                <Input
                  type="password"
                  value={pwForm.confirm}
                  onChange={(e) => setPwForm({ ...pwForm, confirm: e.target.value })}
                  placeholder="Répéter"
                  autoComplete="new-password"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwOpen(false)}>Annuler</Button>
            <Button className="bg-orange-500 hover:bg-orange-600" onClick={changeMyPassword}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  )
}
