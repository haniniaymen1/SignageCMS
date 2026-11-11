'use client'

import { useEffect, useMemo, useState } from 'react'
import { Monitor, Play } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { WidgetRenderer, type WidgetData } from './widget-renderer'

interface Region {
  id: string
  name: string
  left: number
  top: number
  width: number
  height: number
  zIndex: number
  widgets: WidgetData[]
}

interface Layout {
  id: string
  name: string
  backgroundColor: string
  backgroundImage?: string | null
  regions: Region[]
}

interface Display {
  id: string
  name: string
  status: string
  resolution: string
  layoutId?: string | null
}

export default function DisplayPreview({
  open, onClose, display, layouts, onOpenDesigner,
}: {
  open: boolean
  onClose: () => void
  display: Display
  layouts: { id: string; name: string; status: string }[]
  onOpenDesigner: (id: string) => void
}) {
  const [fullLayout, setFullLayout] = useState<Layout | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!open || !display.layoutId) return
    fetch(`/api/resource/layouts/${display.layoutId}`)
      .then((r) => r.json())
      .then((l) => setFullLayout(l))
      .catch(() => setFullLayout(null))
  }, [open, display.layoutId])

  // Cycle de lecture des widgets par région
  useEffect(() => {
    if (!open) return
    const t = setInterval(() => setTick((v) => v + 1), 1000)
    return () => clearInterval(t)
  }, [open])

  const assignedLayoutName = layouts.find((l) => l.id === display.layoutId)?.name

  const activeWidgets = useMemo(() => {
    if (!fullLayout?.regions) return new Map<string, WidgetData>()
    const map = new Map<string, WidgetData>()
    for (const region of fullLayout.regions) {
      const widgets = [...(region.widgets ?? [])].sort((a, b) => a.position - b.position)
      if (widgets.length === 0) continue
      const total = widgets.reduce((s, w) => s + (w.duration || 10), 0)
      let elapsed = tick % Math.max(total, 1)
      for (const w of widgets) {
        const d = w.duration || 10
        if (elapsed < d) { map.set(region.id, w); break }
        elapsed -= d
      }
    }
    return map
  }, [fullLayout, tick])

  const isPortrait = display.resolution.startsWith('1080x1920')

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Monitor className="h-5 w-5 text-orange-500" /> Aperçu : {display.name}
          </DialogTitle>
          <DialogDescription>
            {display.status === 'online' ? 'En ligne' : 'Hors ligne'} · {display.resolution}
            {assignedLayoutName ? ` · Présentation : ${assignedLayoutName}` : ' · Aucune présentation affectée'}
          </DialogDescription>
        </DialogHeader>

        {fullLayout ? (
          <div className="flex flex-col items-center">
            <div
              className="relative w-full overflow-hidden rounded-lg border-4 border-slate-800 shadow-2xl"
              style={{
                aspectRatio: isPortrait ? '9/16' : '16/9',
                backgroundColor: fullLayout.backgroundColor,
              }}
            >
              {[...fullLayout.regions]
                .sort((a, b) => a.zIndex - b.zIndex)
                .map((region) => {
                  const active = activeWidgets.get(region.id)
                  return (
                    <div
                      key={region.id}
                      className="absolute overflow-hidden"
                      style={{
                        left: `${region.left}%`,
                        top: `${region.top}%`,
                        width: `${region.width}%`,
                        height: `${region.height}%`,
                        zIndex: region.zIndex,
                      }}
                    >
                      {active ? (
                        <WidgetRenderer widget={active} interactive={false} />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-white/5 text-xs text-white/30">
                          Région vide
                        </div>
                      )}
                    </div>
                  )
                })}
              {fullLayout.regions.length === 0 && (
                <div className="flex h-full w-full items-center justify-center text-white/30 text-sm">
                  Présentation vide
                </div>
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => onOpenDesigner(fullLayout.id)}>
                Ouvrir dans l&apos;éditeur
              </Button>
            </div>
          </div>
        ) : display.layoutId ? (
          <div className="flex h-64 items-center justify-center text-slate-400">Chargement de la présentation…</div>
        ) : (
          <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-slate-300 text-slate-400">
            <Play className="h-10 w-10" />
            <p className="text-sm">Aucune présentation affectée à cet écran.<br />Modifiez l&apos;écran pour lui affecter une présentation.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
