'use client'

import { useEffect, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { WidgetRenderer, type WidgetData } from './widget-renderer'

interface PreviewRegion {
  id: string
  name: string
  left: number
  top: number
  width: number
  height: number
  zIndex: number
  widgets: WidgetData[]
}

export interface PreviewLayout {
  name: string
  width: number
  height: number
  backgroundColor: string
  backgroundImage?: string | null
  regions: PreviewRegion[]
}

export default function LayoutPreviewModal({
  open, onClose, layout,
}: {
  open: boolean
  onClose: () => void
  layout: PreviewLayout | null
}) {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!open) return
    const t = setInterval(() => setTick((v) => v + 1), 1000)
    return () => clearInterval(t)
  }, [open])

  const activeWidgets = useMemo(() => {
    const map = new Map<string, WidgetData>()
    if (!layout?.regions) return map
    for (const region of layout.regions) {
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
  }, [layout, tick])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Aperçu : {layout?.name}</DialogTitle>
          <DialogDescription>
            Lecture cyclique des widgets — comme sur l&apos;écran final.
          </DialogDescription>
        </DialogHeader>
        <div
          className="relative w-full overflow-hidden rounded-lg border-4 border-slate-800 shadow-2xl"
          style={{ aspectRatio: `${layout?.width ?? 16}/${layout?.height ?? 9}`, backgroundColor: layout?.backgroundColor }}
        >
          {layout?.backgroundImage && (
             
            <img src={layout.backgroundImage} alt="" className="absolute inset-0 h-full w-full object-cover" />
          )}
          {[...(layout?.regions ?? [])]
            .sort((a, b) => a.zIndex - b.zIndex)
            .map((region) => {
              const active = activeWidgets.get(region.id)
              return (
                <div
                  key={region.id}
                  className="absolute overflow-hidden"
                  style={{
                    left: `${region.left}%`, top: `${region.top}%`,
                    width: `${region.width}%`, height: `${region.height}%`,
                    zIndex: region.zIndex,
                  }}
                >
                  {active ? (
                    <WidgetRenderer widget={active} interactive={false} />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-white/30">Région vide</div>
                  )}
                </div>
              )
            })}
          {(layout?.regions ?? []).length === 0 && (
            <div className="flex h-full w-full items-center justify-center text-white/30">Présentation vide</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
