'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Play, Timer, Wifi, Info, AlertTriangle, CircleAlert, Download, TrendingUp,
} from 'lucide-react'
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer,
  Tooltip as ReTooltip, XAxis, YAxis, Legend,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime, timeAgo } from './api-client'

interface Proof {
  id: string
  display: string
  media: string
  layout?: string | null
  count: number
  duration: number
  date: string
}

interface LogItem {
  id: string
  level: string
  display: string | null
  message: string
  createdAt: string
}

export default function ReportsView() {
  const [proof, setProof] = useState<Proof[]>([])
  const [logs, setLogs] = useState<LogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [logFilter, setLogFilter] = useState('all')

  useEffect(() => {
    async function load() {
      try {
        const [p, l] = await Promise.all([
          fetch('/api/resource/proof-of-play').then((r) => r.json()),
          fetch('/api/resource/logs').then((r) => r.json()),
        ])
        setProof(p)
        setLogs(l)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const kpis = useMemo(() => {
    const totalLectures = proof.reduce((s, p) => s + p.count, 0)
    const totalDuree = proof.reduce((s, p) => s + p.duration, 0)
    const displays = new Set(proof.map((p) => p.display)).size
    const heures = Math.floor(totalDuree / 3600)
    const minutes = Math.round((totalDuree % 3600) / 60)
    return {
      totalLectures,
      totalDuree,
      dureeFormatee: heures > 0 ? `${heures} h ${minutes} min` : `${minutes} min`,
      displays,
      bandePassante: Math.round(totalLectures * 3.1 * 10) / 10,
    }
  }, [proof])

  const parMedia = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of proof) map.set(p.media, (map.get(p.media) ?? 0) + p.count)
    return [...map.entries()]
      .map(([media, lectures]) => ({ media, lectures }))
      .sort((a, b) => b.lectures - a.lectures)
      .slice(0, 8)
  }, [proof])

  const parJour = useMemo(() => {
    const map = new Map<string, { lectures: number; duree: number }>()
    for (let i = 6; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      map.set(d.toDateString(), { lectures: 0, duree: 0 })
    }
    for (const p of proof) {
      const key = new Date(p.date).toDateString()
      if (map.has(key)) {
        const cur = map.get(key)!
        map.set(key, { lectures: cur.lectures + p.count, duree: cur.duree + p.duration })
      }
    }
    return [...map.entries()].map(([date, v]) => ({
      jour: new Date(date).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' }),
      ...v,
    }))
  }, [proof])

  const filteredLogs = logs.filter((l) => logFilter === 'all' || l.level === logFilter)

  const exportCsv = () => {
    const rows = [
      ['Écran', 'Média', 'Présentation', 'Lectures', 'Durée (s)', 'Date'],
      ...proof.map((p) => [p.display, p.media, p.layout ?? '', p.count, p.duration, p.date]),
    ]
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(';')).join('\n')
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `rapport-diffusion-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const logIcon = (level: string) =>
    level === 'erreur' ? CircleAlert : level === 'avertissement' ? AlertTriangle : Info
  const logStyle = (level: string) =>
    level === 'erreur'
      ? 'text-red-500 bg-red-50'
      : level === 'avertissement'
        ? 'text-amber-500 bg-amber-50'
        : 'text-sky-500 bg-sky-50'

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-72 rounded-xl" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { icon: Play, label: 'Lectures totales', value: kpis.totalLectures, color: 'bg-orange-500' },
          { icon: Timer, label: 'Temps de diffusion', value: kpis.dureeFormatee, color: 'bg-emerald-500' },
          { icon: TrendingUp, label: 'Écrans actifs', value: kpis.displays, color: 'bg-violet-500' },
          { icon: Wifi, label: 'Bande passante', value: `${kpis.bandePassante} Mo`, color: 'bg-cyan-500' },
        ].map((k) => (
          <Card key={k.label} className="border-slate-200">
            <CardContent className="flex items-center gap-4 p-5">
              <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${k.color} text-white`}>
                <k.icon className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xl font-bold text-slate-900">{k.value}</div>
                <div className="text-xs text-slate-500">{k.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Graphiques */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-slate-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Lectures par média (Top 8)</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={parMedia} layout="vertical" margin={{ left: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis type="category" dataKey="media" width={120} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <ReTooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} formatter={(v: number) => [v, 'Lectures']} />
                <Bar dataKey="lectures" fill="#f97316" radius={[0, 6, 6, 0]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Activité des 7 derniers jours</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={parJour}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="jour" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <ReTooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="lectures" name="Lectures" stroke="#f97316" strokeWidth={2.5} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="duree" name="Durée (s)" stroke="#10b981" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Journal */}
      <Card className="border-slate-200">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">Journal d&apos;événements</CardTitle>
          <div className="flex items-center gap-2">
            <Tabs value={logFilter} onValueChange={setLogFilter}>
              <TabsList className="bg-slate-50">
                <TabsTrigger value="all">Tous</TabsTrigger>
                <TabsTrigger value="info">Info</TabsTrigger>
                <TabsTrigger value="avertissement">Avertissements</TabsTrigger>
                <TabsTrigger value="erreur">Erreurs</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="mr-1 h-3.5 w-3.5" /> Exporter CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent className="max-h-96 overflow-y-auto p-0">
          <Table>
            <TableHeader className="sticky top-0 bg-white">
              <TableRow className="border-slate-200">
                <TableHead className="w-12" />
                <TableHead>Message</TableHead>
                <TableHead className="hidden md:table-cell">Écran</TableHead>
                <TableHead className="hidden sm:table-cell">Niveau</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredLogs.map((l) => {
                const Icon = logIcon(l.level)
                return (
                  <TableRow key={l.id} className="border-slate-100">
                    <TableCell>
                      <div className={`flex h-7 w-7 items-center justify-center rounded-full ${logStyle(l.level)}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                    </TableCell>
                    <TableCell className="text-slate-700">{l.message}</TableCell>
                    <TableCell className="hidden text-slate-500 md:table-cell">{l.display ?? '—'}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge
                        variant="outline"
                        className={
                          l.level === 'erreur'
                            ? 'border-red-200 text-red-600'
                            : l.level === 'avertissement'
                              ? 'border-amber-200 text-amber-600'
                              : 'border-sky-200 text-sky-600'
                        }
                      >
                        {l.level}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-slate-400">{formatDateTime(l.createdAt)}</TableCell>
                  </TableRow>
                )
              })}
              {filteredLogs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-slate-400">Aucun événement</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
