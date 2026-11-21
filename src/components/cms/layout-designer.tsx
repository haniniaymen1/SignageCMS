'use client'

import { useEffect, useRef, useState } from 'react'
import {
  ChevronLeft, Save, Upload, Play, Plus, Trash2, GripVertical, Palette, Clock,
  Type, Image as ImageIcon, Video, CloudSun, Rss, Globe, Copy, Tv, Search, Presentation,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { apiUpdate, useResource, WIDGET_TYPES, formatDuration } from './api-client'
import { WidgetRenderer, type WidgetData } from './widget-renderer'
import LayoutPreviewModal from './layout-preview'

interface Widget extends WidgetData {
  mediaId?: string | null
  position: number
  media?: { id: string; url: string; name: string; type: string; slides?: string[] | string | null } | null
}

const MEDIA_WIDGET_TYPES = ['image', 'video', 'presentation', 'pdf']

interface Region {
  id: string
  name: string
  left: number
  top: number
  width: number
  height: number
  zIndex: number
  widgets: Widget[]
}

interface LayoutFull {
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
}

const WIDGET_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  text: Type, image: ImageIcon, video: Video, clock: Clock, weather: CloudSun, rss: Rss, webpage: Globe, iptv: Tv, presentation: Presentation,
}

interface IptvChannelLight {
  id: string
  name: string
  url: string
  logo: string | null
  group: string | null
}

export default function LayoutDesigner({
  layoutId, onExit, onPreview,
}: {
  layoutId: string
  onExit: () => void
  onPreview: (id: string) => void
}) {
  const { toast } = useToast()
  const canvasRef = useRef<HTMLDivElement>(null)

  const [layout, setLayout] = useState<LayoutFull | null>(null)
  const [meta, setMeta] = useState({ name: '', duration: 60, backgroundColor: '#0f172a' })
  const [regions, setRegions] = useState<Region[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [widgetDlg, setWidgetDlg] = useState<{ regionId: string; widget?: Widget } | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)

  // Chargement
  useEffect(() => {
    fetch(`/api/resource/layouts/${layoutId}`)
      .then((r) => r.json())
      .then((l: LayoutFull) => {
        setLayout(l)
        setMeta({ name: l.name, duration: l.duration, backgroundColor: l.backgroundColor })
        setRegions(l.regions.map((r) => ({ ...r, widgets: [...r.widgets].sort((a, b) => a.position - b.position) })))
      })
  }, [layoutId])

  const markDirty = () => setDirty(true)
  const selectedRegion = regions.find((r) => r.id === selected) ?? null

  // ===== Manipulation des régions =====
  const addRegion = () => {
    const n = regions.length + 1
    const newRegion: Region = {
      id: `new-${Date.now()}`,
      name: `Région ${n}`,
      left: 10 * (n - 1),
      top: 10 * (n - 1),
      width: 50,
      height: 50,
      zIndex: n,
      widgets: [],
    }
    setRegions([...regions, newRegion])
    setSelected(newRegion.id)
    markDirty()
  }

  const updateRegion = (id: string, patch: Partial<Region>) => {
    setRegions(regions.map((r) => (r.id === id ? { ...r, ...patch } : r)))
    markDirty()
  }

  const deleteRegion = (id: string) => {
    setRegions(regions.filter((r) => r.id !== id))
    if (selected === id) setSelected(null)
    markDirty()
  }

  const duplicateRegion = (r: Region) => {
    const copy: Region = {
      ...r,
      id: `new-${Date.now()}`,
      name: `${r.name} (copie)`,
      left: Math.min(r.left + 5, 90),
      top: Math.min(r.top + 5, 90),
      widgets: r.widgets.map((w) => ({ ...w, id: `new-${Math.random().toString(36).slice(2)}` })),
    }
    setRegions([...regions, copy])
    setSelected(copy.id)
    markDirty()
  }

  // Glisser-déposer : déplacement
  const dragState = useRef<{ mode: 'move' | 'resize'; id: string; startX: number; startY: number; orig: Region } | null>(null)

  const onRegionMouseDown = (e: React.MouseEvent, r: Region, mode: 'move' | 'resize') => {
    e.stopPropagation()
    e.preventDefault()
    setSelected(r.id)
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    dragState.current = { mode, id: r.id, startX: e.clientX, startY: e.clientY, orig: { ...r } }

    const onMove = (ev: MouseEvent) => {
      const st = dragState.current
      if (!st || !canvasRef.current) return
      const rectNow = canvasRef.current.getBoundingClientRect()
      const dxPct = ((ev.clientX - st.startX) / rectNow.width) * 100
      const dyPct = ((ev.clientY - st.startY) / rectNow.height) * 100
      setRegions((prev) =>
        prev.map((r0) => {
          if (r0.id !== st.id) return r0
          if (st.mode === 'move') {
            return {
              ...r0,
              left: Math.max(0, Math.min(100 - st.orig.width, st.orig.left + dxPct)),
              top: Math.max(0, Math.min(100 - st.orig.height, st.orig.top + dyPct)),
            }
          }
          return {
            ...r0,
            width: Math.max(5, Math.min(100 - st.orig.left, st.orig.width + dxPct)),
            height: Math.max(5, Math.min(100 - st.orig.top, st.orig.height + dyPct)),
          }
        })
      )
    }
    const onUp = () => {
      dragState.current = null
      setDirty(true)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // ===== Widgets =====
  const addWidget = (regionId: string, widget: Omit<Widget, 'id'>) => {
    setRegions((prev) =>
      prev.map((r) => {
        if (r.id !== regionId) return r
        return { ...r, widgets: [...r.widgets, { ...widget, id: `new-${Date.now()}` }] }
      })
    )
    markDirty()
  }

  const updateWidget = (regionId: string, widgetId: string, patch: Partial<Widget>) => {
    setRegions((prev) =>
      prev.map((r) =>
        r.id !== regionId ? r : { ...r, widgets: r.widgets.map((w) => (w.id === widgetId ? { ...w, ...patch } : w)) }
      )
    )
    markDirty()
  }

  const deleteWidget = (regionId: string, widgetId: string) => {
    setRegions((prev) =>
      prev.map((r) => (r.id !== regionId ? r : { ...r, widgets: r.widgets.filter((w) => w.id !== widgetId) }))
    )
    markDirty()
  }

  // ===== Sauvegarde =====
  const save = async (publishAfter?: boolean) => {
    if (!layout) return
    setSaving(true)
    try {
      const payload = {
        name: meta.name || 'Sans titre',
        duration: meta.duration,
        backgroundColor: meta.backgroundColor,
        ...(publishAfter !== undefined ? {} : {}),
        regions: {
          deleteMany: {},
          create: regions.map((r, i) => ({
            name: r.name,
            left: Math.round(r.left),
            top: Math.round(r.top),
            width: Math.round(r.width),
            height: Math.round(r.height),
            zIndex: r.zIndex || i + 1,
            widgets: {
              create: r.widgets.map((w, j) => ({
                type: w.type,
                name: w.name,
                duration: w.duration,
                mediaId: w.mediaId || null,
                config: typeof w.config === 'string' ? w.config : JSON.stringify(w.config),
                position: j,
              })),
            },
          })),
        },
      }
      const ok = await apiUpdate('layouts', layoutId, payload)
      if (ok) {
        if (publishAfter !== undefined) {
          const published = await apiUpdate('layouts', layoutId, { status: publishAfter ? 'publie' : 'brouillon' })
          if (published) setLayout((l) => (l ? { ...l, status: publishAfter ? 'publie' : 'brouillon' } : l))
        } else {
          setLayout({ ...layout, name: payload.name, regions: (ok as LayoutFull).regions })
        }
        setDirty(false)
        toast({ title: 'Présentation enregistrée', description: meta.name })
        // Recharger pour obtenir les vrais IDs
        const fresh = await fetch(`/api/resource/layouts/${layoutId}`).then((r) => r.json())
        setLayout(fresh)
        setRegions(fresh.regions.map((r: Region) => ({ ...r, widgets: [...r.widgets].sort((a: Widget, b: Widget) => a.position - b.position) })))
      } else {
        toast({ title: 'Erreur', description: "L'enregistrement a échoué", variant: 'destructive' })
      }
    } finally {
      setSaving(false)
    }
  }

  if (!layout) {
    return <div className="flex h-96 items-center justify-center text-slate-400">Chargement de l&apos;éditeur…</div>
  }

  return (
    <div className="space-y-4">
      {/* Barre supérieure */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <Button variant="ghost" size="sm" onClick={onExit}>
          <ChevronLeft className="h-4 w-4" /> Retour
        </Button>
        <Separator orientation="vertical" className="h-6" />
        <Input
          value={meta.name}
          onChange={(e) => { setMeta({ ...meta, name: e.target.value }); markDirty() }}
          className="h-9 w-56 font-semibold"
        />
        <Badge className={layout.status === 'publie' ? 'border-transparent bg-emerald-500 text-white' : 'border-transparent bg-slate-700 text-white'}>
          {layout.status === 'publie' ? 'Publié' : 'Brouillon'}
        </Badge>
        {dirty && <span className="text-xs font-medium text-orange-500">Modifications non enregistrées</span>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Palette className="h-4 w-4 text-slate-400" />
            <input
              type="color"
              value={meta.backgroundColor}
              onChange={(e) => { setMeta({ ...meta, backgroundColor: e.target.value }); markDirty() }}
              className="h-8 w-8 cursor-pointer rounded border border-slate-200"
              aria-label="Couleur de fond"
            />
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Clock className="h-4 w-4" />
            <Input
              type="number"
              min={5}
              value={meta.duration}
              onChange={(e) => { setMeta({ ...meta, duration: parseInt(e.target.value) || 60 }); markDirty() }}
              className="h-8 w-16"
            />
            s
          </div>
          <Button size="sm" variant="outline" onClick={() => setPreviewOpen(true)}>
            <Play className="h-4 w-4" /> Aperçu
          </Button>
          <Button size="sm" variant="outline" onClick={() => save(true)}>
            <Upload className="h-4 w-4" /> Publier
          </Button>
          <Button size="sm" className="bg-orange-500 hover:bg-orange-600" onClick={() => save()} disabled={saving}>
            <Save className="h-4 w-4" /> {saving ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-4 xl:flex-row">
        {/* Canvas */}
        <div className="flex-1">
          <div className="flex items-center justify-between pb-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Canevas {layout.width} × {layout.height}
            </span>
            <Button size="sm" variant="outline" onClick={addRegion}>
              <Plus className="h-4 w-4" /> Ajouter une région
            </Button>
          </div>
          <div
            ref={canvasRef}
            className="relative w-full cursor-default overflow-hidden rounded-lg border-2 border-slate-300 shadow-inner select-none"
            style={{ aspectRatio: `${layout.width}/${layout.height}`, backgroundColor: meta.backgroundColor }}
            onMouseDown={() => setSelected(null)}
          >
            {[...regions].sort((a, b) => a.zIndex - b.zIndex).map((r) => (
              <div
                key={r.id}
                onMouseDown={(e) => onRegionMouseDown(e, r, 'move')}
                className={cn(
                  'absolute cursor-move overflow-hidden transition-shadow',
                  selected === r.id ? 'ring-2 ring-orange-500 ring-offset-1' : 'ring-1 ring-white/40 hover:ring-orange-300'
                )}
                style={{
                  left: `${r.left}%`, top: `${r.top}%`,
                  width: `${r.width}%`, height: `${r.height}%`,
                  zIndex: r.zIndex,
                  backgroundColor: 'rgba(15,23,42,0.25)',
                }}
              >
                {/* Rendu du premier widget en arrière-plan */}
                {r.widgets.length > 0 && (
                  <div className="pointer-events-none absolute inset-0 opacity-80">
                    <WidgetRenderer widget={r.widgets[0]} />
                  </div>
                )}
                {/* Étiquette */}
                <div className="absolute left-0 top-0 flex items-center gap-1 bg-orange-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  <GripVertical className="h-3 w-3" />
                  {r.name}
                  {r.widgets.length > 0 && <span className="opacity-75">· {r.widgets.length} widget(s)</span>}
                </div>
                {/* Poignée de redimensionnement */}
                <div
                  onMouseDown={(e) => onRegionMouseDown(e, r, 'resize')}
                  className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize bg-orange-500/80 hover:bg-orange-600"
                  title="Redimensionner"
                />
              </div>
            ))}
            {regions.length === 0 && (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-slate-500">
                <Plus className="h-10 w-10" />
                <p className="text-sm">Cliquez sur « Ajouter une région » pour commencer</p>
              </div>
            )}
          </div>
        </div>

        {/* Panneau propriétés */}
        <div className="w-full shrink-0 xl:w-80">
          <div className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">
              {selectedRegion ? `Région : ${selectedRegion.name}` : 'Aucune région sélectionnée'}
            </div>
            {selectedRegion ? (
              <ScrollArea className="max-h-[540px]">
                <div className="space-y-4 p-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Nom de la région</Label>
                    <Input
                      className="h-8"
                      value={selectedRegion.name}
                      onChange={(e) => updateRegion(selectedRegion.id, { name: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {([['left', 'X (%)'], ['top', 'Y (%)'], ['width', 'Largeur (%)'], ['height', 'Hauteur (%)'], ['zIndex', 'Ordre Z']] as const).map(([k, label]) => (
                      <div key={k} className="space-y-1">
                        <Label className="text-xs">{label}</Label>
                        <Input
                          type="number"
                          className="h-8"
                          value={Math.round(selectedRegion[k])}
                          onChange={(e) => updateRegion(selectedRegion.id, { [k]: parseInt(e.target.value) || 0 })}
                        />
                      </div>
                    ))}
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Widgets ({selectedRegion.widgets.length})
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => setWidgetDlg({ regionId: selectedRegion.id })}
                    >
                      <Plus className="h-3 w-3" /> Ajouter
                    </Button>
                  </div>
                  {selectedRegion.widgets.map((w, i) => {
                    const Icon = WIDGET_ICONS[w.type] ?? Type
                    return (
                      <div key={w.id} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 p-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-white shadow-sm">
                          <Icon className="h-4 w-4 text-orange-500" />
                        </div>
                        <button className="min-w-0 flex-1 text-left" onClick={() => setWidgetDlg({ regionId: selectedRegion.id, widget: w })}>
                          <div className="truncate text-xs font-medium text-slate-800">{w.name}</div>
                          <div className="text-[10px] text-slate-400">{WIDGET_TYPES[w.type]?.label ?? w.type} · {w.duration}s</div>
                        </button>
                        <div className="flex flex-col gap-0.5">
                          <button
                            className="text-[10px] text-slate-400 hover:text-slate-700 disabled:opacity-30"
                            disabled={i === 0}
                            onClick={() => {
                              const arr = [...selectedRegion.widgets]
                              ;[arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]
                              updateRegion(selectedRegion.id, { widgets: arr.map((x, j) => ({ ...x, position: j })) })
                            }}
                          >▲</button>
                          <button
                            className="text-[10px] text-slate-400 hover:text-slate-700 disabled:opacity-30"
                            disabled={i === selectedRegion.widgets.length - 1}
                            onClick={() => {
                              const arr = [...selectedRegion.widgets]
                              ;[arr[i], arr[i + 1]] = [arr[i + 1], arr[i]]
                              updateRegion(selectedRegion.id, { widgets: arr.map((x, j) => ({ ...x, position: j })) })
                            }}
                          >▼</button>
                        </div>
                        <button className="text-red-400 hover:text-red-600" onClick={() => deleteWidget(selectedRegion.id, w.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )
                  })}
                  <Separator />
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => duplicateRegion(selectedRegion)}>
                      <Copy className="h-3.5 w-3.5" /> Dupliquer
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1 text-red-600 hover:bg-red-50" onClick={() => deleteRegion(selectedRegion.id)}>
                      <Trash2 className="h-3.5 w-3.5" /> Supprimer
                    </Button>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Astuce : faites glisser la région sur le canevas pour la déplacer, ou utilisez la poignée orange pour la redimensionner.
                  </div>
                </div>
              </ScrollArea>
            ) : (
              <div className="p-6 text-center text-sm text-slate-400">
                Sélectionnez une région sur le canevas pour éditer ses propriétés et ses widgets.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Dialogue widget */}
      {widgetDlg && (
        <WidgetDialog
          regionName={regions.find((r) => r.id === widgetDlg.regionId)?.name ?? ''}
          widget={widgetDlg.widget}
          onClose={() => setWidgetDlg(null)}
          onSave={(w) => {
            if (widgetDlg.widget) {
              updateWidget(widgetDlg.regionId, widgetDlg.widget.id, w)
            } else {
              addWidget(widgetDlg.regionId, { ...w, name: w.name ?? 'Widget', type: w.type ?? 'text', position: 0 } as Omit<Widget, 'id'>)
            }
            setWidgetDlg(null)
          }}
        />
      )}

      {/* Aperçu */}
      <LayoutPreviewModal open={previewOpen} onClose={() => setPreviewOpen(false)} layout={{ ...layout, ...meta, regions }} />
    </div>
  )
}

// ====== Dialogue de création/édition de widget ======
function WidgetDialog({
  regionName, widget, onClose, onSave,
}: {
  regionName: string
  widget?: Widget
  onClose: () => void
  onSave: (w: Partial<Widget>) => void
}) {
  const { data: mediaList } = useResource<{ id: string; name: string; type: string; url: string; duration: number }>('media')
  const [type, setType] = useState(widget?.type ?? 'text')
  const [name, setName] = useState(widget?.name ?? '')
  const [duration, setDuration] = useState(widget?.duration ?? 10)
  const [mediaId, setMediaId] = useState<string>(widget?.mediaId ?? '')
  const [cfg, setCfg] = useState<Record<string, string>>(() => {
    try { return JSON.parse(widget?.config ?? '{}') } catch { return {} }
  })

  const selectedMedia = mediaList.find((m) => m.id === mediaId)

  const submit = () => {
    const finalName = name || `${WIDGET_TYPES[type].label} — ${regionName}`
    const finalMediaId = MEDIA_WIDGET_TYPES.includes(type) ? mediaId || null : null
    if (MEDIA_WIDGET_TYPES.includes(type) && !finalMediaId) {
      return // interdit sans média
    }
    if (type === 'iptv' && !(cfg.channelUrl || cfg.url)) {
      return // interdit sans chaîne
    }
    onSave({
      type,
      name: finalName,
      duration,
      mediaId: finalMediaId,
      media: selectedMedia ?? undefined,
      config: JSON.stringify(cfg),
    })
  }

  return (
    <DialogRoot onClose={onClose}>
      <div className="space-y-4">
        {/* Choix du type */}
        <div className="space-y-1.5">
          <Label className="text-xs">Type de widget</Label>
          <div className="grid grid-cols-4 gap-2">
            {Object.entries(WIDGET_TYPES).map(([t, meta]) => {
              const Icon = WIDGET_ICONS[t] ?? Type
              return (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-lg border p-2 text-[10px] font-medium transition-colors',
                    type === t ? 'border-orange-500 bg-orange-50 text-orange-600' : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {meta.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Nom du widget</Label>
            <Input className="h-8" value={name} onChange={(e) => setName(e.target.value)} placeholder={WIDGET_TYPES[type].label} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Durée (secondes)</Label>
            <Input className="h-8" type="number" min={1} value={duration} onChange={(e) => setDuration(parseInt(e.target.value) || 10)} />
          </div>
        </div>

        {/* Sélecteur de média */}
        {MEDIA_WIDGET_TYPES.includes(type) && (
          <div className="space-y-1.5">
            <Label className="text-xs">Média de la bibliothèque *</Label>
            <ScrollArea className="max-h-40 rounded-lg border border-slate-200 p-2">
              <div className="grid grid-cols-3 gap-2">
                {mediaList.filter((m) => m.type === type).map((m) => (
                  <button
                    key={m.id}
                    onClick={() => { setMediaId(m.id); if (!name) setName(m.name) }}
                    className={cn(
                      'overflow-hidden rounded-md border-2 transition-colors',
                      mediaId === m.id ? 'border-orange-500' : 'border-transparent hover:border-slate-300'
                    )}
                  >
                    {m.type === 'image' ? (
                       
                      <img src={m.url} alt={m.name} className="h-14 w-full object-cover" />
                    ) : (
                      <div className="flex h-14 w-full items-center justify-center bg-slate-100"><Presentation className="h-5 w-5 text-slate-400" /></div>
                    )}
                    <div className="truncate px-1 py-0.5 text-[9px] text-slate-500">{m.name}</div>
                  </button>
                ))}
                {mediaList.filter((m) => m.type === type).length === 0 && (
                  <div className="col-span-3 py-4 text-center text-xs text-slate-400">
                    Aucun média de ce type dans la bibliothèque
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Configurations par type */}
        {type === 'text' && (
          <div className="space-y-2 rounded-lg bg-slate-50 p-3">
            <div className="space-y-1">
              <Label className="text-xs">Titre (optionnel)</Label>
              <Input className="h-8" value={cfg.title ?? ''} onChange={(e) => setCfg({ ...cfg, title: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Message</Label>
              <textarea
                className="h-20 w-full rounded-md border border-slate-200 p-2 text-sm"
                value={cfg.message ?? ''}
                onChange={(e) => setCfg({ ...cfg, message: e.target.value })}
                placeholder="Votre message…"
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Taille police</Label>
                <Input className="h-8" type="number" value={cfg.size ?? '36'} onChange={(e) => setCfg({ ...cfg, size: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Couleur texte</Label>
                <input type="color" className="h-8 w-full cursor-pointer rounded border" value={cfg.color ?? '#ffffff'} onChange={(e) => setCfg({ ...cfg, color: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Fond</Label>
                <input type="color" className="h-8 w-full cursor-pointer rounded border" value={cfg.bg ?? '#00000000'} onChange={(e) => setCfg({ ...cfg, bg: e.target.value })} />
              </div>
            </div>
          </div>
        )}
        {type === 'video' && (
          <div className="space-y-2 rounded-lg bg-slate-50 p-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="video-muted" className="text-xs">Démarrer muet (autoplay autorisé)</Label>
              <input
                id="video-muted" type="checkbox" className="h-4 w-4 accent-orange-500"
                checked={cfg.muted !== 'false'}
                onChange={(e) => setCfg({ ...cfg, muted: e.target.checked ? 'true' : 'false' })}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="video-loop" className="text-xs">Boucler la vidéo (indépendamment du switch global)</Label>
              <input
                id="video-loop" type="checkbox" className="h-4 w-4 accent-orange-500"
                checked={cfg.loop !== 'false'}
                onChange={(e) => setCfg({ ...cfg, loop: e.target.checked ? 'true' : 'false' })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Ajustement (remplir / contenir)</Label>
              <Select value={cfg.fit === 'contain' ? 'contain' : 'cover'} onValueChange={(v) => setCfg({ ...cfg, fit: v })}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cover">Remplir (crop)</SelectItem>
                  <SelectItem value="contain">Contenir (bandes noires)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-[11px] text-slate-400">Le son reste réglable directement dans le lecteur sans interrompre la lecture.</p>
          </div>
        )}
        {type === 'clock' && (
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3">
            <div className="space-y-1">
              <Label className="text-xs">Taille horloge</Label>
              <Input className="h-8" type="number" value={cfg.size ?? '72'} onChange={(e) => setCfg({ ...cfg, size: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Couleur</Label>
              <input type="color" className="h-8 w-full cursor-pointer rounded border" value={cfg.color ?? '#ffffff'} onChange={(e) => setCfg({ ...cfg, color: e.target.value })} />
            </div>
          </div>
        )}
        {type === 'weather' && (
          <div className="space-y-1 rounded-lg bg-slate-50 p-3">
            <Label className="text-xs">Ville</Label>
            <Input className="h-8" value={cfg.city ?? ''} onChange={(e) => setCfg({ ...cfg, city: e.target.value })} placeholder="Paris" />
          </div>
        )}
        {type === 'rss' && (
          <div className="space-y-1 rounded-lg bg-slate-50 p-3">
            <Label className="text-xs">Titre du fil</Label>
            <Input className="h-8" value={cfg.title ?? ''} onChange={(e) => setCfg({ ...cfg, title: e.target.value })} placeholder="Actualités" />
          </div>
        )}
        {type === 'webpage' && (
          <div className="space-y-2 rounded-lg bg-slate-50 p-3">
            <div className="space-y-1">
              <Label className="text-xs">URL de la page</Label>
              <Input className="h-8" value={cfg.url ?? ''} onChange={(e) => setCfg({ ...cfg, url: e.target.value })} placeholder="https://exemple.com" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Chargement</Label>
              <select
                className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-xs"
                value={cfg.mode ?? 'auto'}
                onChange={(e) => setCfg({ ...cfg, mode: e.target.value })}
              >
                <option value="auto">Automatique (recommandé)</option>
                <option value="proxy">Toujours via le proxy CMS</option>
                <option value="direct">Direct (iframe seule)</option>
              </select>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="web-interactive" className="text-xs">Interactif (clics, formulaires, saisie)</Label>
              <input
                id="web-interactive" type="checkbox" className="h-4 w-4 accent-orange-500"
                checked={cfg.interactive !== 'false'}
                onChange={(e) => setCfg({ ...cfg, interactive: e.target.checked ? 'true' : 'false' })}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Rafraîchissement (min, 0 = jamais)</Label>
                <Input className="h-8" type="number" min={0} value={cfg.refresh ?? '0'} onChange={(e) => setCfg({ ...cfg, refresh: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Zoom (%)</Label>
                <Input className="h-8" type="number" min={25} max={300} value={cfg.zoom ?? '100'} onChange={(e) => setCfg({ ...cfg, zoom: e.target.value })} />
              </div>
            </div>
            <p className="text-[11px] leading-snug text-slate-400">
              Certains sites refusent l&apos;intégration (X-Frame-Options / CSP). En mode automatique, le lecteur bascule tout seul vers le proxy du CMS : la page s&apos;affiche et reste interactive (liens, boutons, formulaires, connexion).
            </p>
          </div>
        )}
        {type === 'iptv' && (
          <IptvChannelPicker cfg={cfg} setCfg={setCfg} onPickName={(n) => setName(n)} />
        )}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Annuler</Button>
        <Button className="bg-orange-500 hover:bg-orange-600" onClick={submit}>
          {widget ? 'Enregistrer' : 'Ajouter le widget'}
        </Button>
      </div>
    </DialogRoot>
  )
}

// Sélecteur de chaîne IPTV pour les widgets
function IptvChannelPicker({
  cfg, setCfg, onPickName,
}: {
  cfg: Record<string, string>
  setCfg: (c: Record<string, string>) => void
  onPickName: (n: string) => void
}) {
  const [channels, setChannels] = useState<IptvChannelLight[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)

  // Recherche SERVEUR sur TOUTES les chaînes (debounce 300 ms) — la base peut
  // contenir des dizaines de milliers de chaînes, impossible de tout charger.
  useEffect(() => {
    let cancelled = false
    const t = setTimeout(() => {
      setLoading(true)
      fetch(`/api/iptv/channels?take=50&search=${encodeURIComponent(search)}`)
        .then((r) => r.json())
        .then((d) => { if (!cancelled) { setChannels(d.items ?? []); setTotal(d.total ?? 0) } })
        .catch(() => {})
        .finally(() => { if (!cancelled) setLoading(false) })
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [search])

  const filtered = channels.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="space-y-2 rounded-lg bg-slate-50 p-3">
      <div className="flex items-baseline justify-between">
        <Label className="text-xs">Chaîne IPTV *</Label>
        <span className="text-[10px] text-slate-400">{total > 0 ? `${total.toLocaleString('fr-FR')} chaînes — tapez pour filtrer` : ''}</span>
      </div>
      {cfg.channelUrl && (
        <div className="flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-2 py-1.5 text-xs text-sky-700">
          <Tv className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate font-medium">{cfg.channelName || 'Chaîne sélectionnée'}</span>
          <button
            className="ml-auto shrink-0 text-sky-400 hover:text-sky-700"
            onClick={() => { setCfg({ ...cfg, channelUrl: '', channelName: '' }) }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div className="space-y-1">
        <Label className="text-xs">Décalage timeshift (secondes, 0 = direct)</Label>
        <Input type="number" min={0} step={5} className="h-8" value={cfg.delay ?? ''} onChange={(e) => setCfg({ ...cfg, delay: e.target.value })} placeholder="Ex. 30" />
      </div>
      {!cfg.channelUrl && (
        <>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <Input className="h-8 pl-7 text-xs" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher parmi toutes les chaînes…" />
          </div>
          <ScrollArea className="max-h-44 rounded-md border border-slate-200 bg-white">
            {loading && <div className="p-3 text-center text-xs text-slate-400">Chargement…</div>}
            {!loading && filtered.length === 0 && (
              <div className="p-3 text-center text-xs text-slate-400">
                Aucune chaîne. Importez une source M3U dans le module TV / IPTV.
              </div>
            )}
            <div className="divide-y divide-slate-100">
              {filtered.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setCfg({ ...cfg, channelUrl: c.url, channelName: c.name })
                    onPickName(c.name)
                  }}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors hover:bg-orange-50"
                >
                  {c.logo ? (
                    <img src={c.logo} alt="" className="h-5 w-8 shrink-0 rounded object-contain" onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden' }} />
                  ) : (
                    <Tv className="h-4 w-4 shrink-0 text-slate-300" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-slate-700">{c.name}</span>
                  {c.group && <span className="shrink-0 text-[10px] text-slate-400">{c.group}</span>}
                </button>
              ))}
            </div>
          </ScrollArea>
          <details className="text-xs text-slate-400">
            <summary className="cursor-pointer select-none">Ou saisir une URL de flux manuellement</summary>
            <Input
              className="mt-1 h-8 text-xs"
              value={cfg.url ?? ''}
              onChange={(e) => setCfg({ ...cfg, url: e.target.value })}
              placeholder="http://serveur:port/live.m3u8"
            />
          </details>
        </>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex items-center gap-2">
          <Checkbox
            id="iptv-muted"
            checked={cfg.muted !== 'false'}
            onCheckedChange={(v) => setCfg({ ...cfg, muted: v === false ? 'false' : 'true' })}
          />
          <Label htmlFor="iptv-muted" className="text-xs">Muet</Label>
        </div>
        <div className="space-y-0.5">
          <Label className="text-[10px] text-slate-400">Volume (0–100)</Label>
          <Input className="h-7" type="number" min={0} max={100} value={cfg.volume ?? '80'} onChange={(e) => setCfg({ ...cfg, volume: e.target.value })} />
        </div>
      </div>
    </div>
  )
}

// Petit enrobage du dialogue pour la lisibilité
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
function DialogRoot({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Widget</DialogTitle>
          <DialogDescription>Choisissez un type de contenu et configurez-le.</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}
