'use client'

import { useEffect, useState } from 'react'
import {
  Monitor, Images, LayoutTemplate, CalendarDays, Users, ListVideo, Tv,
  ArrowUpRight, ArrowDownRight, Info, AlertTriangle, CircleAlert,
} from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as ReTooltip, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { timeAgo } from './api-client'

interface Stats {
  totalDisplays: number
  onlineDisplays: number
  offlineDisplays: number
  totalMedia: number
  totalLayouts: number
  totalUsers: number
  totalPlaylists: number
  totalEvents: number
  totalIptvChannels: number
  totalIptvSources: number
  logs: { id: string; level: string; display: string | null; message: string; createdAt: string }[]
  bandwidth: { jour: string; bandePassante: number; lectures: number }[]
  mediaParType: { type: string; count: number }[]
}

interface DisplayRow {
  id: string
  name: string
  status: string
  lastAccess: string | null
  group?: { name: string } | null
}

export default function DashboardView({ onNavigate }: { onNavigate: (v: string) => void }) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [displays, setDisplays] = useState<DisplayRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const [s, d] = await Promise.all([
          fetch('/api/stats').then((r) => r.json()),
          fetch('/api/resource/displays').then((r) => r.json()),
        ])
        setStats(s)
        setDisplays(Array.isArray(d) ? d.slice(0, 6) : [])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-72 rounded-xl lg:col-span-2" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      </div>
    )
  }

  const statCards = [
    {
      label: 'Écrans connectés',
      value: stats ? `${stats.onlineDisplays} / ${stats.totalDisplays}` : '—',
      sub: 'en ligne maintenant',
      icon: Monitor,
      color: 'bg-emerald-500',
      trend: '+2 cette semaine',
      up: true,
      view: 'displays',
    },
    {
      label: 'Médias',
      value: stats?.totalMedia ?? '—',
      sub: 'dans la bibliothèque',
      icon: Images,
      color: 'bg-orange-500',
      trend: '+3 ce mois',
      up: true,
      view: 'media',
    },
    {
      label: 'Présentations',
      value: stats?.totalLayouts ?? '—',
      sub: 'créées au total',
      icon: LayoutTemplate,
      color: 'bg-violet-500',
      trend: '+1 aujourd\'hui',
      up: true,
      view: 'layouts',
    },
    {
      label: 'Chaînes IPTV',
      value: stats?.totalIptvChannels ?? '—',
      sub: `${stats?.totalIptvSources ?? 0} source(s) M3U`,
      icon: Tv,
      color: 'bg-sky-500',
      trend: 'direct via HLS / MPEG-TS',
      up: true,
      view: 'iptv',
    },
    {
      label: 'Planifications',
      value: stats?.totalEvents ?? '—',
      sub: 'événements programmés',
      icon: CalendarDays,
      color: 'bg-cyan-500',
      trend: '-1 cette semaine',
      up: false,
      view: 'schedule',
    },
  ]

  const logIcon = (level: string) =>
    level === 'erreur' ? CircleAlert : level === 'avertissement' ? AlertTriangle : Info
  const logColor = (level: string) =>
    level === 'erreur' ? 'text-red-500 bg-red-50' : level === 'avertissement' ? 'text-amber-500 bg-amber-50' : 'text-sky-500 bg-sky-50'

  return (
    <div className="space-y-6">
      {/* Bienvenue */}
      <div className="rounded-xl bg-gradient-to-r from-[#141d2e] via-[#1c2a42] to-[#28395c] p-6 text-white shadow-lg">
        <h1 className="text-2xl font-bold">Bonjour, bienvenue sur SignageCMS</h1>
        <p className="mt-1 text-sm text-slate-300">
          Votre réseau d&apos;affichage dynamique en un coup d&apos;œil — {stats?.onlineDisplays ?? 0} écran(s) en ligne sur {stats?.totalDisplays ?? 0}.
        </p>
      </div>

      {/* Cartes statistiques */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {statCards.map((s) => (
          <Card
            key={s.label}
            className="cursor-pointer border-slate-200 transition-all hover:-translate-y-0.5 hover:shadow-md"
            onClick={() => onNavigate(s.view)}
          >
            <CardContent className="flex items-center gap-4 p-5">
              <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${s.color} text-white shadow-md`}>
                <s.icon className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="text-2xl font-bold text-slate-900">{s.value}</div>
                <div className="truncate text-xs text-slate-500">{s.label} · {s.sub}</div>
                <div className={`mt-1 flex items-center gap-1 text-[11px] font-medium ${s.up ? 'text-emerald-600' : 'text-red-500'}`}>
                  {s.up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                  {s.trend}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Graphiques */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-slate-200 lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Consommation du réseau (Mo) · 7 derniers jours</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats?.bandwidth ?? []}>
                <defs>
                  <linearGradient id="bw" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f97316" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#f97316" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="jour" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <ReTooltip
                  contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
                  formatter={(v: number) => [`${v} Mo`, 'Consommation']}
                />
                <Area type="monotone" dataKey="bandePassante" stroke="#f97316" strokeWidth={2.5} fill="url(#bw)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">État du parc d&apos;écrans</CardTitle>
          </CardHeader>
          <CardContent className="flex h-64 flex-col">
            <div className="flex flex-1 items-center justify-center gap-8">
              <div className="relative h-36 w-36">
                <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
                  <circle cx="18" cy="18" r="15.9" fill="none" stroke="#e2e8f0" strokeWidth="4" />
                  {(() => {
                    const total = stats?.totalDisplays || 1
                    const online = stats?.onlineDisplays || 0
                    const pct = (online / total) * 100
                    const cir = 2 * Math.PI * 15.9
                    return (
                      <circle
                        cx="18" cy="18" r="15.9" fill="none" stroke="#10b981" strokeWidth="4"
                        strokeDasharray={`${(pct / 100) * cir} ${cir}`} strokeLinecap="round"
                      />
                    )
                  })()}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-bold text-slate-900">{stats?.onlineDisplays ?? 0}</span>
                  <span className="text-[10px] uppercase text-slate-400">en ligne</span>
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <span className="h-3 w-3 rounded-full bg-emerald-500" /> En ligne
                  <span className="ml-1 font-bold">{stats?.onlineDisplays ?? 0}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="h-3 w-3 rounded-full bg-slate-300" /> Hors ligne
                  <span className="ml-1 font-bold">{stats?.offlineDisplays ?? 0}</span>
                </div>
              </div>
            </div>
            <Button
              variant="outline" size="sm" className="w-full border-slate-300"
              onClick={() => onNavigate('displays')}
            >
              Voir tous les écrans
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Logs + stats secondaires */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-slate-200 lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">Journal d&apos;activité</CardTitle>
            <Button variant="ghost" size="sm" className="text-orange-600 hover:text-orange-700" onClick={() => onNavigate('reports')}>
              Tout voir
            </Button>
          </CardHeader>
          <CardContent className="max-h-72 space-y-3 overflow-y-auto">
            {stats?.logs?.length ? stats.logs.map((log) => {
              const Icon = logIcon(log.level)
              return (
                <div key={log.id} className="flex items-start gap-3 text-sm">
                  <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${logColor(log.level)}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-slate-800">{log.message}</div>
                    <div className="text-xs text-slate-400">{log.display ?? 'Système'} · {timeAgo(log.createdAt)}</div>
                  </div>
                </div>
              )
            }) : <div className="py-6 text-center text-sm text-slate-400">Aucun événement</div>}
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Aperçu rapide</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { icon: Users, label: 'Utilisateurs', value: stats?.totalUsers ?? 0, view: 'users' },
              { icon: ListVideo, label: 'Playlists', value: stats?.totalPlaylists ?? 0, view: 'playlists' },
            ].map((r) => (
              <button
                key={r.label}
                onClick={() => onNavigate(r.view)}
                className="flex w-full items-center gap-3 rounded-lg border border-slate-100 p-3 text-left transition-colors hover:bg-slate-50"
              >
                <r.icon className="h-5 w-5 text-slate-400" />
                <span className="text-sm text-slate-600">{r.label}</span>
                <span className="ml-auto text-lg font-bold text-slate-900">{r.value}</span>
              </button>
            ))}
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Types de médias</div>
              <div className="flex flex-wrap gap-1.5">
                {(stats?.mediaParType ?? []).map((m) => (
                  <Badge key={m.type} variant="outline" className="border-slate-200 bg-white text-slate-600">
                    {m.type} · {m.count}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tableau écrans récents */}
      <Card className="border-slate-200">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">Derniers écrans</CardTitle>
          <Button variant="ghost" size="sm" className="text-orange-600 hover:text-orange-700" onClick={() => onNavigate('displays')}>
            Tout voir
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-slate-200">
                <TableHead>Écran</TableHead>
                <TableHead>Groupe</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="hidden sm:table-cell">Dernier accès</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displays.map((d) => (
                <TableRow key={d.id} className="border-slate-100">
                  <TableCell className="font-medium text-slate-800">{d.name}</TableCell>
                  <TableCell className="text-slate-500">{d.group?.name ?? '—'}</TableCell>
                  <TableCell>
                    <Badge
                      className={
                        d.status === 'online'
                          ? 'border-transparent bg-emerald-100 text-emerald-700'
                          : 'border-transparent bg-slate-100 text-slate-500'
                      }
                    >
                      {d.status === 'online' ? 'En ligne' : 'Hors ligne'}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden text-slate-500 sm:table-cell">{timeAgo(d.lastAccess)}</TableCell>
                </TableRow>
              ))}
              {displays.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-slate-400">Aucun écran enregistré</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
