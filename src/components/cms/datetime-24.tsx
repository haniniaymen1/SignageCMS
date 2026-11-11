'use client'

// Champ « date + heure » garantissant le format 24 heures,
// indépendant de la locale du navigateur (remplace <input type="datetime-local">
// qui affiche AM/PM sur certains appareils).

import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

const HOURS_24 = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

interface DateTime24Props {
  /** Valeur au format `YYYY-MM-DDTHH:mm` (compatible datetime-local) */
  value: string
  onChange: (value: string) => void
  className?: string
}

export function DateTime24({ value, onChange, className }: DateTime24Props) {
  const [datePart, timePart] = (value || '').split('T')
  const date = datePart || todayStr()
  const [hh = '08', mm = '00'] = (timePart || '').split(':')

  const emit = (d: string, h: string, m: string) => onChange(`${d}T${h}:${m}`)

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <Input
        type="date"
        value={date}
        onChange={(e) => emit(e.target.value || todayStr(), hh, mm)}
        className="min-w-0 flex-1 px-2.5"
        aria-label="Date"
      />
      <Select value={hh} onValueChange={(v) => emit(date, v, mm)}>
        <SelectTrigger size="sm" className="w-[62px] shrink-0 px-2" aria-label="Heure (24h)">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-64">
          {HOURS_24.map((h) => (
            <SelectItem key={h} value={h} className="pr-5">{h}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="-mx-0.5 text-sm font-medium text-slate-400">:</span>
      <Select value={mm} onValueChange={(v) => emit(date, hh, v)}>
        <SelectTrigger size="sm" className="w-[58px] shrink-0 px-2" aria-label="Minute">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-64">
          {MINUTES.map((m) => (
            <SelectItem key={m} value={m} className="pr-5">{m}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
