'use client'

import { useMemo, useState } from 'react'
import {
  ChevronLeft, ChevronRight, Plus, Trash2, CalendarDays, Clock, Repeat, Zap, LayoutTemplate, Megaphone,
  Monitor, MonitorCheck, Search, AlertTriangle, Pencil,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
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
import { DateTime24 } from './datetime-24'
import { cn } from '@/lib/utils'

interface EventItem {
  id: string
  name: string
  type: string
  start: string
  end: string
  isPriority: boolean
  loop?: boolean // §16 v3.8+ — boucle ON/OFF par événement
  color: string
  layout?: { id: string; name: string } | null
  campaign?: { id: string; name: string } | null
  displayGroup?: { id: string; name: string } | null
  targetType?: string // all | group | displays
  displayIds?: string | null // JSON array des IDs d'écrans ciblés
}

interface ScreenItem {
  id: string
  name: string
  status: string
  group?: { id: string; name: string } | null
}

// Libellé de la cible d'un événement (tous les écrans / groupe / écrans sélectionnés)
function targetLabel(ev: EventItem, displays: ScreenItem[]): string {
  if (ev.targetType === 'displays' && ev.displayIds) {
    try {
      const ids = JSON.parse(ev.displayIds) as string[]
      const names = ids
        .map((id) => displays.find((d) => d.id === id)?.name)
        .filter((n): n is string => !!n)
      if (names.length === 0) return `${ids.length} écran(s)`
      if (names.length === 1) return names[0]
      if (names.length <= 2) return names.join(', ')
      return `${names[0]} +${names.length - 1} autre(s)`
    } catch {
      return 'Écrans sélectionnés'
    }
  }
  return ev.displayGroup?.name ?? 'Tous les écrans'
}

// §1 — Les cibles de deux événements se recouvrent-elles ?
function targetsOverlap(a: EventItem, b: EventItem, displays: ScreenItem[]): boolean {
  const ta = a.targetType || 'all'
  const tb = b.targetType || 'all'
  if (ta === 'all' || tb === 'all') return true
  const idsOf = (ev: EventItem): string[] | null => {
    if (ev.targetType === 'displays' && ev.displayIds) {
      try { return JSON.parse(ev.displayIds) as string[] } catch { return [] }
    }
    return null
  }
  if (ta === 'group' && tb === 'group') return a.displayGroup?.id === b.displayGroup?.id
  if (ta === 'group' && tb === 'displays') {
    const ids = idsOf(b) ?? []
    return ids.some((id) => displays.find((d) => d.id === id)?.group?.id === a.displayGroup?.id)
  }
  if (ta === 'displays' && tb === 'group') {
    const ids = idsOf(a) ?? []
    return ids.some((id) => displays.find((d) => d.id === id)?.group?.id === b.displayGroup?.id)
  }
  const ia = idsOf(a) ?? []
  const ib = idsOf(b) ?? []
  return ia.some((id) => ib.includes(id))
}

function overlapsInTime(a: EventItem, b: EventItem): boolean {
  return new Date(a.start).getTime() < new Date(b.end).getTime() &&
    new Date(b.start).getTime() < new Date(a.end).getTime()
}

const DAY_NAMES = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
const HOURS = Array.from({ length: 15 }, (_, i) => i + 6) // 6h → 20h

function startOfWeek(d: Date): Date {
  const date = new Date(d)
  const day = (date.getDay() + 6) % 7 // lundi = 0
  date.setDate(date.getDate() - day)
  date.setHours(0, 0, 0, 0)
  return date
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// §24 — Répartition des événements d'un jour en colonnes (lanes) pour éviter
// la superposition illisible des événements qui se chevauchent.
function layoutDayLanes(dayEvents: EventItem[]): { laneOf: Map<string, number>; lanes: number } {
  const sorted = [...dayEvents].sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime() ||
      new Date(a.end).getTime() - new Date(b.end).getTime()
  )
  const laneEnds: number[] = []
  const laneOf = new Map<string, number>()
  for (const ev of sorted) {
    const s = new Date(ev.start).getTime()
    let lane = laneEnds.findIndex((end) => end <= s)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(0)
    }
    laneEnds[lane] = Math.max(laneEnds[lane], new Date(ev.end).getTime())
    laneOf.set(ev.id, lane)
  }
  return { laneOf, lanes: Math.max(laneEnds.length, 1) }
}

const emptyForm = {
  name: '',
  type: 'layout',
  layoutId: '',
  campaignId: '',
  targetType: 'all',
  displayGroupId: '',
  displayIds: [] as string[],
  start: toLocalInput(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 8, 0)),
  end: toLocalInput(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 12, 0)),
  isPriority: false,
  loop: true, // §16 — boucle ON par défaut (persistée en base)
  color: '#f97316',
}

export default function ScheduleView() {
  const { data: events, refresh } = useResource<EventItem>('events')
  const { data: layouts } = useResource<{ id: string; name: string; status: string }>('layouts')
  const { data: campaigns } = useResource<{ id: string; name: string }>('campaigns')
  const { data: groups } = useResource<{ id: string; name: string }>('display-groups')
  const { data: displays } = useResource<ScreenItem>('displays')
  const { toast } = useToast()

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [dlgOpen, setDlgOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<EventItem | null>(null)
  const [screenSearch, setScreenSearch] = useState('')
  const [form, setForm] = useState(emptyForm)

  const now = new Date()

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart)
      d.setDate(d.getDate() + i)
      return d
    }),
    [weekStart]
  )

  const openCreate = () => {
    setEditingId(null)
    setForm({ ...emptyForm,
      start: toLocalInput(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 0)),
      end: toLocalInput(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0)),
    })
    setDlgOpen(true)
  }

  // §2 — Ouvre le dialogue pré-rempli pour modifier un événement existant
  const openEdit = (ev: EventItem) => {
    setEditingId(ev.id)
    setForm({
      name: ev.name,
      type: ev.type,
      layoutId: ev.layout?.id ?? '',
      campaignId: ev.campaign?.id ?? '',
      targetType: ev.targetType || 'all',
      displayGroupId: ev.displayGroup?.id ?? '',
      displayIds: (() => {
        try { return ev.displayIds ? (JSON.parse(ev.displayIds) as string[]) : [] } catch { return [] }
      })(),
      start: toLocalInput(new Date(ev.start)),
      end: toLocalInput(new Date(ev.end)),
      isPriority: ev.isPriority,
      loop: ev.loop !== false, // §16 — pré-rempli depuis l'événement existant
      color: ev.color || '#f97316',
    })
    setDlgOpen(true)
  }

  const save = async () => {
    if (!form.name.trim()) return
    if (form.type === 'layout' && !form.layoutId) {
      toast({ title: 'Présentation requise', variant: 'destructive' })
      return
    }
    if (form.type === 'campaign' && !form.campaignId) {
      toast({ title: 'Campagne requise', variant: 'destructive' })
      return
    }
    if (form.targetType === 'group' && !form.displayGroupId) {
      toast({ title: 'Groupe d\u2019écrans requis', description: 'Choisissez un groupe ou basculez sur « Tous les écrans ».', variant: 'destructive' })
      return
    }
    if (form.targetType === 'displays' && form.displayIds.length === 0) {
      toast({ title: 'Sélection requise', description: 'Cochez au moins un écran à cibler.', variant: 'destructive' })
      return
    }
    const payload = {
      name: form.name,
      type: form.type,
      layoutId: form.type === 'layout' ? form.layoutId : null,
      campaignId: form.type === 'campaign' ? form.campaignId : null,
      targetType: form.targetType,
      displayGroupId: form.targetType === 'group' ? form.displayGroupId : null,
      displayIds: form.targetType === 'displays' ? JSON.stringify(form.displayIds) : null,
      start: new Date(form.start).toISOString(),
      end: new Date(form.end).toISOString(),
      isPriority: form.isPriority,
      loop: form.loop, // §16 — persisté en base, appliqué par les lecteurs web + APK
      color: form.color,
    }
    let ok: unknown = null
    if (editingId) {
      ok = await apiUpdate('events', editingId, payload)
    } else {
      ok = await apiCreate('events', payload)
    }
    if (ok) {
      toast({
        title: editingId ? 'Événement modifié' : 'Événement planifié',
        description: form.name,
      })
      setDlgOpen(false)
      setEditingId(null)
      refresh()
    } else {
      toast({ title: 'Erreur', description: editingId ? 'Modification impossible' : 'Planification impossible', variant: 'destructive' })
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    const ok = await apiDelete('events', deleteTarget.id)
    if (ok) { toast({ title: 'Événement supprimé', description: deleteTarget.name }); refresh() }
    setDeleteTarget(null)
    setDlgOpen(false)
    setEditingId(null)
  }

  // Regroupement des événements par jour — les événements traversant minuit
  // ou sur plusieurs jours apparaissent sur chaque journée concernée.
  const eventsByDay = useMemo(() => {
    const map = new Map<string, EventItem[]>()
    for (const d of days) {
      const key = d.toDateString()
      const list: EventItem[] = []
      for (const ev of events) {
        const s = new Date(ev.start)
        const e = new Date(ev.end)
        const dayStart = new Date(d); dayStart.setHours(0, 0, 0, 0)
        const dayEnd = new Date(d); dayEnd.setHours(23, 59, 59, 999)
        if (s <= dayEnd && e >= dayStart) list.push(ev)
      }
      if (list.length > 0) map.set(key, list)
    }
    return map
  }, [events, days])

  // §1 — Détection des conflits d'horaire (chevauchement temporel + cible commune)
  const conflicts = useMemo(() => {
    const pairs: Array<{ a: EventItem; b: EventItem }> = []
    const sorted = [...events].sort((x, y) => new Date(x.start).getTime() - new Date(y.start).getTime())
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        if (!overlapsInTime(sorted[i], sorted[j])) continue
        if (targetsOverlap(sorted[i], sorted[j], displays)) {
          pairs.push({ a: sorted[i], b: sorted[j] })
        }
      }
    }
    return pairs
  }, [events, displays])

  const isThisWeek = startOfWeek(new Date()).getTime() === weekStart.getTime()

  // Écrans filtrés par recherche (dialogue de planification)
  const filteredScreens = useMemo(() => {
    const q = screenSearch.trim().toLowerCase()
    if (!q) return displays
    return displays.filter((d) =>
      d.name.toLowerCase().includes(q) || (d.group?.name ?? '').toLowerCase().includes(q)
    )
  }, [displays, screenSearch])

  const toggleScreen = (id: string) => {
    setForm((f) => ({
      ...f,
      displayIds: f.displayIds.includes(id)
        ? f.displayIds.filter((x) => x !== id)
        : [...f.displayIds, id],
    }))
  }

  return (
    <div className="space-y-4">
      {/* Navigation semaine */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
          <Button variant="ghost" size="sm" onClick={() => setWeekStart(new Date(weekStart.setDate(weekStart.getDate() - 7)))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <button
            className="px-3 text-sm font-semibold text-slate-700 hover:text-orange-600"
            onClick={() => setWeekStart(startOfWeek(new Date()))}
          >
            {weekStart.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} –{' '}
            {new Date(weekStart.getTime() + 6 * 86400000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
          </button>
          <Button variant="ghost" size="sm" onClick={() => setWeekStart(new Date(weekStart.setDate(weekStart.getDate() + 7)))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        {!isThisWeek && (
          <Button variant="outline" size="sm" onClick={() => setWeekStart(startOfWeek(new Date()))}>Aujourd&apos;hui</Button>
        )}
        <div className="ml-auto flex items-center gap-2 text-sm text-slate-500">
          <CalendarDays className="h-4 w-4" /> {events.length} événement(s) planifié(s)
        </div>
        <Button className="bg-orange-500 hover:bg-orange-600" onClick={openCreate}>
          <Plus className="h-4 w-4" /> Planifier un événement
        </Button>
      </div>

      {/* §1 — Alerte des conflits d'horaire */}
      {conflicts.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
            <AlertTriangle className="h-4 w-4" />
            {conflicts.length} conflit(s) d&apos;horaire détecté(s)
          </div>
          <p className="mt-1 text-xs text-amber-700">
            Ces événements se chevauchent sur les mêmes écrans. Le lecteur diffuse d&apos;abord les événements
            <span className="font-semibold"> prioritaires</span>, puis fait alterner les autres selon leur ordre. Modifiez les horaires pour supprimer l&apos;ambiguïté.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {conflicts.slice(0, 6).map(({ a, b }) => (
              <button
                key={`${a.id}-${b.id}`}
                onClick={() => openEdit(a)}
                className="flex items-center gap-1.5 rounded-full border border-amber-300 bg-white px-2.5 py-1 text-[11px] text-amber-900 hover:border-amber-500"
                title="Cliquer pour modifier le premier événement"
              >
                <Pencil className="h-3 w-3" />
                <span className="font-semibold">{a.name}</span>
                <span className="text-amber-500">↔</span>
                <span className="font-semibold">{b.name}</span>
                <span className="text-amber-600">
                  {new Date(a.start).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', hour12: false })}–
                  {new Date(a.end).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', hour12: false })}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Calendrier semaine */}
      <Card className="border-slate-200">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <div className="min-w-[840px]">
              {/* En-têtes jours */}
              <div className="grid grid-cols-[56px_repeat(7,1fr)] border-b border-slate-200 bg-slate-50">
                <div className="p-2" />
                {days.map((d, i) => {
                  const isToday = d.toDateString() === new Date().toDateString()
                  return (
                    <div key={i} className={cn('border-l border-slate-200 p-2 text-center', isToday && 'bg-orange-50')}>
                      <div className={cn('text-xs font-medium uppercase', isToday ? 'text-orange-600' : 'text-slate-400')}>
                        {DAY_NAMES[i]}
                      </div>
                      <div className={cn('mx-auto mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold',
                        isToday ? 'bg-orange-500 text-white' : 'text-slate-700')}>
                        {d.getDate()}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Lignes horaires */}
              <div className="relative">
                {HOURS.map((hour) => (
                  <div key={hour} className="grid grid-cols-[56px_repeat(7,1fr)] border-b border-slate-100">
                    <div className="border-r border-slate-200 p-1.5 text-right text-[10px] font-medium text-slate-400">
                      {hour}:00
                    </div>
                    {days.map((d, i) => (
                      <div key={i} className="min-h-[44px] border-l border-slate-100" />
                    ))}
                  </div>
                ))}

                {/* Événements — répartis en colonnes quand ils se chevauchent (§24) */}
                <div className="pointer-events-none absolute inset-0 grid grid-cols-[56px_repeat(7,1fr)]">
                  <div />
                  {days.map((d, i) => {
                    const dayEvents = eventsByDay.get(d.toDateString()) ?? []
                    const { laneOf, lanes } = layoutDayLanes(dayEvents)
                    const laneWidth = 100 / lanes
                    return (
                      <div key={i} className="pointer-events-auto relative border-l border-slate-100 p-1">
                        {dayEvents.map((ev) => {
                          const start = new Date(ev.start)
                          const end = new Date(ev.end)
                          // Bornage visuel à la fenêtre affichée (6h → 21h)
                          const winStart = new Date(d); winStart.setHours(HOURS[0], 0, 0, 0)
                          const winEnd = new Date(d); winEnd.setHours(23, 59, 59, 999)
                          const visStart = Math.max(start.getTime(), winStart.getTime())
                          const visEnd = Math.min(end.getTime(), winEnd.getTime())
                          const startHour = (visStart - winStart.getTime()) / 3600000
                          const durationH = Math.max((visEnd - visStart) / 3600000, 0.5)
                          const top = startHour * 44
                          const height = Math.max(durationH * 44 - 4, 24)
                          const lane = laneOf.get(ev.id) ?? 0
                          const Icon = ev.type === 'campaign' ? Megaphone : LayoutTemplate
                          return (
                            <button
                              key={ev.id}
                              onClick={() => openEdit(ev)}
                              className={cn(
                                'absolute z-10 overflow-hidden rounded-md border-l-4 p-1.5 text-left shadow-sm transition-all hover:shadow-md hover:brightness-105 hover:z-20',
                              )}
                              style={{
                                top,
                                height,
                                left: `calc(${lane * laneWidth}% + 2px)`,
                                width: `calc(${laneWidth}% - 4px)`,
                                backgroundColor: `${ev.color}18`,
                                borderColor: ev.color,
                                color: ev.color,
                              }}
                              title={`${ev.name} · ${start.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', hour12: false })} – ${end.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', hour12: false })} · ${targetLabel(ev, displays)}${ev.isPriority ? ' · Priorité haute' : ''} · Boucle ${ev.loop === false ? 'OFF' : 'ON'} (cliquer pour modifier)`}
                            >
                              <div className="flex items-center gap-1 text-[11px] font-semibold leading-tight">
                                <Icon className="h-3 w-3 shrink-0" />
                                <span className="truncate text-slate-800">{ev.name}</span>
                                {ev.isPriority && <Zap className="h-3 w-3 shrink-0 text-amber-500" />}
                              </div>
                              <div className="truncate text-[10px] text-slate-500">
                                {start.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', hour12: false })} –{' '}
                                {end.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', hour12: false })}
                              </div>
                              {height > 40 && (
                                <div className="truncate text-[10px] text-slate-400">{targetLabel(ev, displays)}</div>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Liste à venir */}
      <Card className="border-slate-200">
        <CardContent className="p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Clock className="h-4 w-4 text-orange-500" /> Prochaines diffusions
          </div>
          <div className="space-y-2">
            {[...events]
              .filter((e) => new Date(e.end) > new Date())
              .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
              .slice(0, 5)
              .map((ev) => (
                <div key={ev.id} className="flex items-center gap-3 rounded-lg border border-slate-100 p-2.5">
                  <span className="h-9 w-1.5 rounded-full" style={{ backgroundColor: ev.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-800">{ev.name}</div>
                    <div className="text-xs text-slate-400">
                      {targetLabel(ev, displays)} ·{' '}
                      {new Date(ev.start).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}
                    </div>
                  </div>
                  <Badge variant="outline" className="border-slate-200 text-slate-500">
                    {ev.type === 'campaign' ? 'Campagne' : 'Présentation'}
                  </Badge>
                  {ev.loop === false ? (
                    <Badge variant="outline" className="border-slate-300 text-slate-500">
                      <Repeat className="mr-1 h-3 w-3" />Boucle OFF
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-orange-200 text-orange-600">
                      <Repeat className="mr-1 h-3 w-3" />Boucle ON
                    </Badge>
                  )}
                  {ev.isPriority && <Badge className="border-transparent bg-amber-100 text-amber-700"><Zap className="mr-1 h-3 w-3" />Priorité</Badge>}
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-400 hover:text-orange-600" onClick={() => openEdit(ev)} title="Modifier">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            {events.filter((e) => new Date(e.end) > new Date()).length === 0 && (
              <div className="py-6 text-center text-sm text-slate-400">Aucune diffusion à venir. Planifiez votre premier événement !</div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Dialogue de planification / modification (§2) */}
      <Dialog open={dlgOpen} onOpenChange={(o) => { if (!o) { setDlgOpen(false); setEditingId(null) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? 'Modifier l\u2019événement' : 'Planifier un événement'}</DialogTitle>
            <DialogDescription>
              {editingId
                ? 'Modifiez les dates, horaires, contenu ou cible sans recréer l\u2019événement.'
                : 'Diffusez une présentation ou une campagne sur tous les écrans, un groupe d\u2019écrans ou des écrans sélectionnés.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nom de l&apos;événement *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex : Menu du midi" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Type de contenu</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="layout">Présentation</SelectItem>
                    <SelectItem value="campaign">Campagne</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1"><Monitor className="h-3.5 w-3.5" />Cible de diffusion</Label>
                <Select
                  value={form.targetType}
                  onValueChange={(v) => setForm({ ...form, targetType: v, displayGroupId: v === 'group' ? form.displayGroupId : '', displayIds: v === 'displays' ? form.displayIds : [] })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les écrans</SelectItem>
                    <SelectItem value="group">Par groupe d&apos;écrans</SelectItem>
                    <SelectItem value="displays">Choisir des écrans</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {form.targetType === 'group' && (
              <div className="space-y-1.5">
                <Label>Groupe d&apos;écrans *</Label>
                {groups.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 p-3 text-xs text-slate-400">
                    Aucun groupe existant — créez-en un dans <span className="font-semibold text-slate-500">Écrans &gt; Groupes</span>.
                  </div>
                ) : (
                  <Select value={form.displayGroupId || undefined} onValueChange={(v) => setForm({ ...form, displayGroupId: v })}>
                    <SelectTrigger><SelectValue placeholder="Choisir un groupe…" /></SelectTrigger>
                    <SelectContent>
                      {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {form.targetType === 'displays' && (
              <div className="space-y-2 rounded-lg border border-slate-200 p-3">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <Input
                      value={screenSearch}
                      onChange={(e) => setScreenSearch(e.target.value)}
                      placeholder="Rechercher un écran ou un groupe…"
                      className="h-8 pl-8 text-xs"
                    />
                  </div>
                  <Button
                    type="button" variant="outline" size="sm" className="h-8 text-xs"
                    onClick={() => setForm({ ...form, displayIds: filteredScreens.map((d) => d.id) })}
                  >
                    Tout cocher
                  </Button>
                  <Button
                    type="button" variant="outline" size="sm" className="h-8 text-xs"
                    onClick={() => setForm({ ...form, displayIds: [] })}
                  >
                    Effacer
                  </Button>
                </div>
                <div className="max-h-44 space-y-0.5 overflow-y-auto">
                  {filteredScreens.map((d) => (
                    <label
                      key={d.id}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50"
                    >
                      <Checkbox
                        checked={form.displayIds.includes(d.id)}
                        onCheckedChange={() => toggleScreen(d.id)}
                      />
                      <MonitorCheck className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{d.name}</span>
                      {d.group && (
                        <Badge variant="outline" className="border-slate-200 px-1.5 text-[10px] text-slate-400">{d.group.name}</Badge>
                      )}
                      <span
                        className={cn('h-2 w-2 shrink-0 rounded-full', d.status === 'online' ? 'bg-emerald-500' : 'bg-slate-300')}
                        title={d.status === 'online' ? 'En ligne' : 'Hors ligne'}
                      />
                    </label>
                  ))}
                  {filteredScreens.length === 0 && (
                    <div className="py-4 text-center text-xs text-slate-400">Aucun écran trouvé</div>
                  )}
                </div>
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>{form.displayIds.length} écran(s) sélectionné(s) sur {displays.length}</span>
                  {form.displayIds.length > 0 && (
                    <span className="max-w-[60%] truncate" title={form.displayIds.map((id) => displays.find((d) => d.id === id)?.name).filter(Boolean).join(', ')}>
                      {form.displayIds.map((id) => displays.find((d) => d.id === id)?.name).filter(Boolean).slice(0, 3).join(', ')}
                      {form.displayIds.length > 3 ? `…` : ''}
                    </span>
                  )}
                </div>
              </div>
            )}
            {form.type === 'layout' ? (
              <div className="space-y-1.5">
                <Label>Présentation *</Label>
                <Select value={form.layoutId || undefined} onValueChange={(v) => setForm({ ...form, layoutId: v })}>
                  <SelectTrigger><SelectValue placeholder="Choisir…" /></SelectTrigger>
                  <SelectContent>
                    {layouts.map((l) => <SelectItem key={l.id} value={l.id}>{l.name} {l.status === 'publie' ? '✓' : '(brouillon)'}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>Campagne *</Label>
                <Select value={form.campaignId || undefined} onValueChange={(v) => setForm({ ...form, campaignId: v })}>
                  <SelectTrigger><SelectValue placeholder="Choisir…" /></SelectTrigger>
                  <SelectContent>
                    {campaigns.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />Début <span className="text-[10px] font-normal text-slate-400">(format 24h)</span></Label>
                <DateTime24 value={form.start} onChange={(v) => setForm({ ...form, start: v })} />
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />Fin <span className="text-[10px] font-normal text-slate-400">(format 24h)</span></Label>
                <DateTime24 value={form.end} onChange={(v) => setForm({ ...form, end: v })} />
              </div>
            </div>
            <div className="grid grid-cols-2 items-center gap-4">
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.isPriority}
                  onCheckedChange={(v) => setForm({ ...form, isPriority: v })}
                />
                <Label className="flex items-center gap-1 text-sm"><Zap className="h-3.5 w-3.5 text-amber-500" />Priorité haute</Label>
              </div>
              <div className="flex items-center gap-2">
                {/* §16 — Switch boucle ON/OFF PAR ÉVÉNEMENT (remplace le switch global des Paramètres) */}
                <Switch
                  checked={form.loop}
                  onCheckedChange={(v) => setForm({ ...form, loop: v })}
                />
                <Label className="flex items-center gap-1 text-sm">
                  <Repeat className={cn('h-3.5 w-3.5', form.loop ? 'text-orange-500' : 'text-slate-400')} />
                  Répéter en boucle
                </Label>
              </div>
            </div>
            <p className="-mt-2 text-[11px] text-slate-400">
              Boucle {form.loop ? 'ON' : 'OFF'} : {form.loop
                ? 'les présentations et médias rejouent en boucle dans l\'ordre défini (web + Android).'
                : 'un seul passage, puis le dernier contenu reste affiché — aucune reprise automatique.'}
              {' '}Persisté après redémarrage du serveur et des lecteurs.
            </p>
          </div>
          <DialogFooter className="sm:justify-between">
            {editingId ? (
              <>
                <Button variant="ghost" className="text-red-500 hover:bg-red-50 hover:text-red-600" onClick={() => setDeleteTarget(events.find((e) => e.id === editingId) ?? null)}>
                  <Trash2 className="mr-1 h-4 w-4" /> Supprimer
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => { setDlgOpen(false); setEditingId(null) }}>Annuler</Button>
                  <Button className="bg-orange-500 hover:bg-orange-600" onClick={save}>Enregistrer</Button>
                </div>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setDlgOpen(false)}>Annuler</Button>
                <Button className="bg-orange-500 hover:bg-orange-600" onClick={save}>Planifier</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer l&apos;événement ?</AlertDialogTitle>
            <AlertDialogDescription>
              « {deleteTarget?.name} » ne sera plus diffusé aux dates prévues.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Conserver</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={confirmDelete}>Supprimer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
