'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Copy, ExternalLink, Monitor, Smartphone } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

interface Display {
  id: string
  name: string
  hardwareKey: string
  status: string
}

interface ServerInfo {
  hostname: string
  port: number
  addresses: string[]
  primary: string | null
}

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]', '0.0.0.0']

function CopyBtn({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8 shrink-0 gap-1.5"
      onClick={async () => {
        try { await navigator.clipboard.writeText(value) } catch {
          const ta = document.createElement('textarea')
          ta.value = value
          document.body.appendChild(ta)
          ta.select()
          document.execCommand('copy')
          document.body.removeChild(ta)
        }
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
      {label ?? 'Copier'}
    </Button>
  )
}

/**
 * Dialogue « Connecter Android » : affiche l'URL du lecteur, la clé matérielle,
 * un QR code et les instructions de connexion pour une application APK Android.
 * Si le CMS est ouvert via localhost/127.0.0.1, l'adresse est automatiquement
 * remplacée par l'IP réseau réelle du serveur (cahier des charges §11) :
 * un QR code contenant localhost n'est pas joignable depuis l'appareil Android.
 */
export default function AndroidConnectDialog({ display, onClose }: { display: Display; onClose: () => void }) {
  const [tab, setTab] = useState('apk')
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null)
  const [manualHost, setManualHost] = useState('')

  useEffect(() => {
    let alive = true
    fetch('/api/server-info')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d) setServerInfo(d) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  const { playerUrl, adjusted, hostUsed } = useMemo(() => {
    if (typeof window === 'undefined') return { playerUrl: '', adjusted: false, hostUsed: '' }
    const origin = window.location.origin
    const url = new URL(origin)
    const isLocal = LOCAL_HOSTS.includes(url.hostname)
    let host = url.hostname
    let adjusted = false
    const port = url.port || serverInfo?.port || '3000'
    if (isLocal) {
      const ip = manualHost || serverInfo?.primary
      if (ip) {
        host = ip
        adjusted = true
      }
    }
    const scheme = url.protocol.replace(':', '')
    const shownPort = adjusted && port === '3000' ? '3000' : port
    const final = `${scheme}://${host}${shownPort ? `:${shownPort}` : ''}/player?key=${encodeURIComponent(display.hardwareKey)}`
    return { playerUrl: final, adjusted, hostUsed: `${scheme}://${host}${shownPort ? `:${shownPort}` : ''}` }
  }, [display.hardwareKey, serverInfo, manualHost])

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-2xl sm:max-w-2xl max-h-[calc(100dvh-1rem)] gap-2 overflow-y-auto p-3 [overflow-wrap:anywhere] sm:gap-3 sm:p-5">
        <DialogHeader className="gap-1 space-y-0">
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-emerald-600" />
            Connecter « {display.name} » depuis Android
          </DialogTitle>
          <DialogDescription>
            Installez l&apos;application APK sur l&apos;appareil (tablette, TV Box, boîtier d&apos;affichage) puis connectez-la.
          </DialogDescription>
        </DialogHeader>

        {/* Avertissement localhost → IP réelle (§11) */}
        {adjusted && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-[11px] leading-snug text-amber-800">
            <div className="mb-1 flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-3.5 w-3.5" /> Adresse ajustée pour l&apos;appareil Android</div>
            Vous accédez au CMS via <code className="rounded bg-white px-1">localhost</code>, qui n&apos;est pas joignable depuis un autre appareil.
            L&apos;adresse ci-dessous utilise l&apos;IP réseau réelle du serveur ({hostUsed}).
            {serverInfo && serverInfo.addresses.length > 1 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="font-medium">Autres interfaces :</span>
                {serverInfo.addresses.filter((a) => a !== (manualHost || serverInfo.primary)).map((a) => (
                  <button key={a} className="rounded border border-amber-400 bg-white px-2 py-0.5 font-mono text-[11px] hover:bg-amber-100" onClick={() => setManualHost(a)}>{a}</button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* QR + informations de connexion */}
        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:p-4">
          <div className="flex flex-row items-center justify-center gap-2 sm:flex-col">
            <div className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
              {playerUrl && <QRCodeSVG value={playerUrl} size={100} level="M" />}
            </div>
            <span className="text-[11px] font-medium text-slate-500">Scanner depuis<br className="hidden sm:block" /> l&apos;appareil</span>
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <div>
              <div className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Adresse du lecteur (CMS)</div>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700">
                  {playerUrl}
                </code>
                <CopyBtn value={playerUrl} />
              </div>
            </div>
            <div>
              <div className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Clé de l&apos;écran</div>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs font-semibold text-slate-800">
                  {display.hardwareKey}
                </code>
                <CopyBtn value={display.hardwareKey} />
              </div>
            </div>
            <a
              href={playerUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-orange-600 hover:text-orange-700 hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Tester le lecteur dans le navigateur
            </a>
          </div>
        </div>

        {/* Méthodes de connexion */}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid h-auto w-full grid-cols-3 bg-white">
            <TabsTrigger value="apk" className="gap-1.5 px-1 py-1.5 text-xs"><Smartphone className="h-3.5 w-3.5 shrink-0" />App APK</TabsTrigger>
            <TabsTrigger value="kiosk" className="gap-1.5 px-1 py-1.5 text-xs"><Monitor className="h-3.5 w-3.5 shrink-0" />Navigateur kiosque</TabsTrigger>
            <TabsTrigger value="steps" className="gap-1.5 px-1 py-1.5 text-xs"><Monitor className="h-3.5 w-3.5 shrink-0" />Étapes</TabsTrigger>
          </TabsList>

          <TabsContent value="apk" className="mt-1.5">
            <ol className="list-decimal space-y-1 pl-5 text-[13px] leading-snug text-slate-600">
              <li>Des <span className="font-semibold">APK précompilés et signés</span> sont fournis avec le CMS (dossier <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">download/</code>) : installez <span className="font-semibold">SignageCMS-Player-universal.apk</span> directement, ou compilez le projet source <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">Build → Build APK</code>.</li>
              <li>Sur l&apos;appareil Android, autorisez « Installer des applications inconnues » puis installez l&apos;APK.</li>
              <li>Au premier lancement, saisissez <span className="font-semibold">l&apos;adresse du serveur CMS</span> (ex. <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{hostUsed || 'http://votre-serveur:3000'}</code>) et <span className="font-semibold">la clé de l&apos;écran</span> ci-dessus.</li>
              <li>L&apos;application s&apos;enregistre automatiquement : <span className="font-semibold">plein écran</span>, écran allumé, reconnexion après coupure réseau.</li>
              <li>Formats gérés nativement (moteurs VLC + ExoPlayer) : vidéos <span className="font-medium">MP4, MKV, AVI, WMV, MPG, MOV, TS, FLV, 3GP, WebM</span>, images <span className="font-medium">JPG, PNG, GIF, WebP, BMP, SVG</span> et IPTV <span className="font-medium">HLS m3u/m3u8, MPEG-TS, RTSP, RTMP, UDP</span>.</li>
              <li>L&apos;écran apparaît <span className="font-semibold text-emerald-600">En ligne</span> dans le CMS ; la planification se met à jour automatiquement (60 s).</li>
            </ol>
          </TabsContent>

          <TabsContent value="kiosk" className="mt-1.5">
            <ol className="list-decimal space-y-1 pl-5 text-[13px] leading-snug text-slate-600">
              <li>Sur l&apos;appareil Android, ouvrez Chrome (ou installez <span className="font-semibold">Fully Kiosk Browser</span> depuis le Play Store).</li>
              <li>Ouvrez <span className="font-semibold">l&apos;adresse du lecteur</span> ci-dessus (ou scannez le QR code).</li>
              <li>Le lecteur se connecte avec la clé, puis affiche les présentations programmées.</li>
              <li>Dans Chrome : menu ⋮ → <span className="font-semibold">Ajouter à l&apos;écran d&apos;accueil</span> pour un raccourci plein écran. Dans Fully Kiosk : activez « Kiosk Mode » et « Keep screen on ».</li>
            </ol>
          </TabsContent>

          <TabsContent value="steps" className="mt-1.5">
            <div className="space-y-1.5 text-[13px] leading-snug text-slate-600">
              <div className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed">
                <p className="mb-1 font-semibold text-slate-700">Comment ça marche ?</p>
                <p>
                  L&apos;application Android se connecte au CMS via l&apos;API lecteur : <code className="rounded bg-white px-1">/api/player/register</code> (enregistrement avec la clé),
                  puis <code className="rounded bg-white px-1">/api/player/schedule</code> (planification, 60 s), <code className="rounded bg-white px-1">/api/player/heartbeat</code> (statut en ligne, 30 s)
                  et <code className="rounded bg-white px-1">/api/player/stats</code> (preuves de diffusion). Les présentations, régions et widgets — y compris les flux IPTV m3u/m3u8 — sont rendus nativement par le lecteur.
                </p>
              </div>
              <ol className="list-decimal space-y-1.5 pl-5">
                <li>Créez l&apos;écran dans le CMS (fait : « {display.name} », clé <code className="rounded bg-slate-100 px-1 font-mono text-xs">{display.hardwareKey}</code>).</li>
                <li>Affectez une présentation ou planifiez un événement sur son groupe.</li>
                <li>Installez l&apos;APK et saisissez l&apos;adresse + la clé.</li>
                <li>L&apos;écran passe « En ligne » et diffuse le contenu.</li>
              </ol>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
