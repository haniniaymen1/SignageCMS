'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ShieldCheck, Save, RotateCcw, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

interface PermActionDef {
  id: 'view' | 'create' | 'update' | 'delete'
  label: string
}
interface PermModuleDef {
  id: string
  label: string
  description: string
  actions: PermActionDef['id'][]
  resources: string[]
}
type Matrix = Record<string, Record<string, string[]>>

interface Payload {
  modules: PermModuleDef[]
  editableRoles: { id: string; label: string }[]
  matrix: Matrix
  defaults: Matrix
  isAdmin: boolean
}

const ACTION_LABELS: Record<string, string> = {
  view: 'Voir',
  create: 'Créer',
  update: 'Modifier',
  delete: 'Supprimer',
}

export default function PermissionsView() {
  const { toast } = useToast()
  const [data, setData] = useState<Payload | null>(null)
  const [draft, setDraft] = useState<Matrix>({})
  const [activeRole, setActiveRole] = useState<string>('user')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/permissions')
      if (!res.ok) throw new Error()
      const payload = (await res.json()) as Payload
      setData(payload)
      setDraft(JSON.parse(JSON.stringify(payload.matrix)))
    } catch {
      toast({ title: 'Erreur', description: 'Chargement des droits impossible', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  const dirty = useMemo(
    () => data !== null && JSON.stringify(draft) !== JSON.stringify(data.matrix),
    [data, draft]
  )

  const toggle = (role: string, moduleId: string, action: string) => {
    setDraft((prev) => {
      const next = JSON.parse(JSON.stringify(prev)) as Matrix
      if (!next[role]) next[role] = {}
      const list = new Set(next[role][moduleId] ?? [])
      if (list.has(action)) list.delete(action)
      else list.add(action)
      next[role][moduleId] = Array.from(list)
      return next
    })
  }

  const toggleRow = (role: string, mod: PermModuleDef, checked: boolean) => {
    setDraft((prev) => {
      const next = JSON.parse(JSON.stringify(prev)) as Matrix
      if (!next[role]) next[role] = {}
      next[role][mod.id] = checked ? [...mod.actions] : []
      return next
    })
  }

  const save = async () => {
    if (!data) return
    setSaving(true)
    try {
      const res = await fetch('/api/permissions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matrix: draft }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: 'Erreur', description: payload.error ?? 'Enregistrement impossible', variant: 'destructive' })
        return
      }
      setData((d) => (d ? { ...d, matrix: payload.matrix } : d))
      setDraft(JSON.parse(JSON.stringify(payload.matrix)))
      toast({ title: 'Droits enregistrés', description: 'Les permissions sont appliquées immédiatement à tous les comptes du rôle.' })
    } catch {
      toast({ title: 'Erreur', description: 'Serveur injoignable', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const resetDefaults = async () => {
    if (!data) return
    const empty: Matrix = {}
    for (const r of data.editableRoles) empty[r.id] = {}
    setSaving(true)
    try {
      const res = await fetch('/api/permissions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matrix: empty }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: 'Erreur', description: payload.error ?? 'Réinitialisation impossible', variant: 'destructive' })
        return
      }
      setData((d) => (d ? { ...d, matrix: payload.matrix } : d))
      setDraft(JSON.parse(JSON.stringify(payload.matrix)))
      toast({ title: 'Valeurs par défaut rétablies' })
    } catch {
      toast({ title: 'Erreur', description: 'Serveur injoignable', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Chargement des droits…
      </div>
    )
  }
  if (!data) return null

  const roleLabel = data.editableRoles.find((r) => r.id === activeRole)?.label ?? activeRole
  const rolePerms = draft[activeRole] ?? {}

  return (
    <div className="space-y-4">
      {/* En-tête */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Rôles &amp; droits d&apos;accès</h2>
            <p className="text-xs text-slate-500">
              Définissez précisément les pages et actions autorisées pour chaque rôle. L&apos;administrateur a
              toujours tous les droits. Appliqué immédiatement, sans déconnexion.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={resetDefaults} disabled={saving} size="sm">
            <RotateCcw className="h-4 w-4" /> Défauts
          </Button>
          <Button
            onClick={save}
            disabled={saving || !dirty}
            size="sm"
            className="bg-orange-500 hover:bg-orange-600"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Enregistrer
          </Button>
        </div>
      </div>

      {/* Onglets de rôle */}
      <div className="flex flex-wrap items-center gap-2">
        {data.editableRoles.map((r) => (
          <button
            key={r.id}
            onClick={() => setActiveRole(r.id)}
            className={cn(
              'rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
              activeRole === r.id
                ? 'border-orange-300 bg-orange-50 text-orange-700'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            )}
          >
            {r.label}
          </button>
        ))}
        <Badge variant="outline" className="border-slate-300 bg-slate-50 text-slate-500">
          Administrateur — tous droits (non modifiable)
        </Badge>
      </div>

      {/* Matrice */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3 font-medium">Page / Module</th>
              {(['view', 'create', 'update', 'delete'] as const).map((a) => (
                <th key={a} className="w-24 px-3 py-3 text-center font-medium">
                  {ACTION_LABELS[a]}
                </th>
              ))}
              <th className="w-24 px-3 py-3 text-center font-medium">Tout</th>
            </tr>
          </thead>
          <tbody>
            {data.modules.map((mod) => {
              const current = rolePerms[mod.id] ?? []
              const allChecked = mod.actions.length > 0 && mod.actions.every((a) => current.includes(a))
              return (
                <tr key={mod.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{mod.label}</div>
                    <div className="text-xs text-slate-400">{mod.description}</div>
                  </td>
                  {(['view', 'create', 'update', 'delete'] as const).map((a) => {
                    const enabled = mod.actions.includes(a)
                    const checked = current.includes(a)
                    return (
                      <td key={a} className="px-3 py-3 text-center">
                        <Checkbox
                          checked={enabled && checked}
                          disabled={!enabled}
                          onCheckedChange={() => toggle(activeRole, mod.id, a)}
                          aria-label={`${ACTION_LABELS[a]} — ${mod.label}`}
                          className={cn(!enabled && 'opacity-30')}
                        />
                      </td>
                    )
                  })}
                  <td className="px-3 py-3 text-center">
                    <Checkbox
                      checked={allChecked}
                      onCheckedChange={(v) => toggleRow(activeRole, mod, !!v)}
                      aria-label={`Tout — ${mod.label}`}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400">
        Rôle actif : <span className="font-medium text-slate-600">{roleLabel}</span>. « Voir » donne l&apos;accès à la
        page et à la lecture de ses données ; sans « Voir », la page est masquée et ses API refusées (401/403).
        Les modifications s&apos;appliquent immédiatement à tous les comptes du rôle, sans reconnexion.
      </p>
    </div>
  )
}
