'use client'

import { useEffect, useState } from 'react'
import { Save, Building, Calendar, Globe2, Wrench, MonitorSmartphone, Repeat } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'

interface SettingRow {
  id: string
  key: string
  value: string
}

const DEFAULTS: Record<string, string> = {
  cmsName: 'SignageCMS',
  cmsEmail: 'admin@signage.local',
  language: 'fr',
  dateFormat: 'dd/mm/yyyy',
  timezone: 'Europe/Paris',
  defaultLayoutDuration: '60',
  defaultWidgetDuration: '10',
  maintenanceMode: 'false',
  sendMail: 'true',
  idleTimeout: '30',
  maxUploadSize: '50',
  autoLayoutReplace: 'true',
  playerLoop: 'true',
  statsEnabled: 'true',
  logRetentionDays: '30',
  playerApiKey: 'SK-LIVE-9X4A2B',
}

export default function SettingsView() {
  const { toast } = useToast()
  const [values, setValues] = useState<Record<string, string>>(DEFAULTS)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/resource/settings')
      .then((r) => r.json())
      .then((rows: SettingRow[]) => {
        if (Array.isArray(rows) && rows.length) {
          setValues((prev) => ({ ...prev, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) }))
        }
      })
      .catch(() => {})
  }, [])

  const set = (key: string, value: string) => setValues((v) => ({ ...v, [key]: value }))

  const save = async () => {
    setSaving(true)
    try {
      // Mise à jour simple : PUT de chaque clé existante, POST des nouvelles
      const existing: SettingRow[] = await fetch('/api/resource/settings').then((r) => r.json())
      const existingKeys = new Set(existing.map((e) => e.key))
      for (const [key, value] of Object.entries(values)) {
        const id = existing.find((e) => e.key === key)?.id
        if (id) {
          await fetch(`/api/resource/settings/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value }),
          })
        } else if (!existingKeys.has(key)) {
          await fetch('/api/resource/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, value }),
          })
        }
      }
      toast({ title: 'Paramètres enregistrés' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Paramètres du CMS</h2>
          <p className="text-sm text-slate-500">Configurez votre application d&apos;affichage dynamique.</p>
        </div>
        <Button className="bg-orange-500 hover:bg-orange-600" onClick={save} disabled={saving}>
          <Save className="h-4 w-4" /> {saving ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </div>

      <Tabs defaultValue="general">
        <TabsList className="bg-white">
          <TabsTrigger value="general" className="gap-2"><Building className="h-4 w-4" />Général</TabsTrigger>
          <TabsTrigger value="display" className="gap-2"><MonitorSmartphone className="h-4 w-4" />Affichage</TabsTrigger>
          <TabsTrigger value="locale" className="gap-2"><Globe2 className="h-4 w-4" />Régional</TabsTrigger>
          <TabsTrigger value="maintenance" className="gap-2"><Wrench className="h-4 w-4" />Maintenance</TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <Card className="border-slate-200">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><Building className="h-4 w-4 text-orange-500" />Identité du CMS</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Nom de l&apos;application</Label>
                  <Input value={values.cmsName} onChange={(e) => set('cmsName', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Email de l&apos;administrateur</Label>
                  <Input value={values.cmsEmail} onChange={(e) => set('cmsEmail', e.target.value)} />
                </div>
              </div>
              <Separator />
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex items-center justify-between rounded-lg border border-slate-100 p-3">
                  <div>
                    <div className="text-sm font-medium">Statistiques d&apos;utilisation</div>
                    <div className="text-xs text-slate-400">Collecter les preuves de diffusion</div>
                  </div>
                  <Switch checked={values.statsEnabled === 'true'} onCheckedChange={(v) => set('statsEnabled', String(v))} />
                </div>
                <div className="flex items-center justify-between rounded-lg border border-slate-100 p-3">
                  <div>
                    <div className="text-sm font-medium">Notifications email</div>
                    <div className="text-xs text-slate-400">Alertes en cas d&apos;écran hors ligne</div>
                  </div>
                  <Switch checked={values.sendMail === 'true'} onCheckedChange={(v) => set('sendMail', String(v))} />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="display">
          <Card className="border-slate-200">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><MonitorSmartphone className="h-4 w-4 text-orange-500" />Comportement des écrans</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Durée par défaut des présentations (s)</Label>
                  <Input type="number" value={values.defaultLayoutDuration} onChange={(e) => set('defaultLayoutDuration', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Durée par défaut des widgets (s)</Label>
                  <Input type="number" value={values.defaultWidgetDuration} onChange={(e) => set('defaultWidgetDuration', e.target.value)} />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-slate-100 p-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium"><Repeat className="h-3.5 w-3.5 text-orange-500" />Lecture en boucle (par événement)</div>
                  <div className="text-xs text-slate-400">
                    Depuis la v3.8, la répétition en boucle se règle événement par événement, dans
                    <span className="font-semibold"> Planification → dialogue de l&apos;événement → « Répéter en boucle »</span>.
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">Chaque événement persiste son réglage ON/OFF en base ; appliqué au lecteur web et à l&apos;application Android, conservé après redémarrage.</div>
                </div>
                <Badge variant="outline" className="border-orange-200 text-orange-600">§16 v3.8+</Badge>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-slate-100 p-3">
                <div>
                  <div className="text-sm font-medium">Remplacement automatique</div>
                  <div className="text-xs text-slate-400">Remplacer la présentation de l&apos;écran dès qu&apos;une nouvelle planification démarre</div>
                </div>
                <Switch checked={values.autoLayoutReplace === 'true'} onCheckedChange={(v) => set('autoLayoutReplace', String(v))} />
              </div>
              <div className="space-y-1.5">
                <Label>Clé API des lecteurs (connecteur Android / Windows / webOS)</Label>
                <Input value={values.playerApiKey} onChange={(e) => set('playerApiKey', e.target.value)} className="font-mono text-sm" />
                <p className="text-xs text-slate-400">Utilisez cette clé pour connecter vos lecteurs au CMS.</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="locale">
          <Card className="border-slate-200">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><Calendar className="h-4 w-4 text-orange-500" />Langue et format</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>Langue</Label>
                  <Select value={values.language} onValueChange={(v) => set('language', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fr">Français</SelectItem>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="es">Español</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Format de date</Label>
                  <Select value={values.dateFormat} onValueChange={(v) => set('dateFormat', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dd/mm/yyyy">JJ/MM/AAAA</SelectItem>
                      <SelectItem value="mm/dd/yyyy">MM/JJ/AAAA</SelectItem>
                      <SelectItem value="yyyy-mm-dd">AAAA-MM-JJ</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Fuseau horaire</Label>
                  <Select value={values.timezone} onValueChange={(v) => set('timezone', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Europe/Paris">Europe/Paris</SelectItem>
                      <SelectItem value="Africa/Lagos">Africa/Lagos</SelectItem>
                      <SelectItem value="UTC">UTC</SelectItem>
                      <SelectItem value="America/New_York">America/New_York</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="maintenance">
          <Card className="border-slate-200">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><Wrench className="h-4 w-4 text-orange-500" />Maintenance</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div>
                  <div className="text-sm font-medium text-amber-800">Mode maintenance</div>
                  <div className="text-xs text-amber-600">Désactive l&apos;accès au CMS pour les non-administrateurs</div>
                </div>
                <Switch checked={values.maintenanceMode === 'true'} onCheckedChange={(v) => set('maintenanceMode', String(v))} />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>Expiration de session (min)</Label>
                  <Input type="number" value={values.idleTimeout} onChange={(e) => set('idleTimeout', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Taille max d&apos;upload (Mo)</Label>
                  <Input type="number" value={values.maxUploadSize} onChange={(e) => set('maxUploadSize', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Rétention des journaux (jours)</Label>
                  <Input type="number" value={values.logRetentionDays} onChange={(e) => set('logRetentionDays', e.target.value)} />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
