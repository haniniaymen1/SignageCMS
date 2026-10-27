import { NextRequest, NextResponse } from 'next/server'
import dns from 'node:dns'
import { promisify } from 'node:util'

export const dynamic = 'force-dynamic'

/**
 * DIAGNOSTIC RÉSEAU IPTV — explique POURQUOI un flux ne passe pas depuis le serveur :
 * - DNS : le nom d'hôte du fournisseur se résout-il depuis ce serveur ?
 * - API Xtream : player_api.php avec les MÊMES identifiants que l'URL du flux
 *   (…/live/user/pass/id.ts) → compte valide ? quota ? état ?
 * - Flux : statut HTTP réel du flux demandé depuis CE serveur.
 * Verdict en français, actionnable (blocage anti-datacenter, quota, identifiants…).
 * Utilisé par le bouton « Diagnostic » de l'overlay d'erreur du lecteur IPTV.
 */

const UA = 'VLC/3.0.20 LibVLC/3.0.20'
const lookup = promisify(dns.lookup) as (h: string, o: object) => Promise<{ address: string; family: number }>

async function statusOf(url: string, timeoutMs: number): Promise<{ status: number; ms: number; error?: string; contentType?: string; body?: string }> {
  const t0 = Date.now()
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: '*/*' },
      redirect: 'follow',
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    })
    const ms = Date.now() - t0
    let body = ''
    if (!res.ok && /text|json|html/i.test(res.headers.get('content-type') || '')) {
      body = (await res.text().catch(() => '')).slice(0, 200)
    }
    try { await res.body?.cancel() } catch { /* noop */ }
    return { status: res.status, ms, contentType: res.headers.get('content-type') || '', body }
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, error: e instanceof Error ? e.message : 'erreur réseau' }
  }
}

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get('url')
  if (!target || !/^https?:\/\//i.test(target)) {
    return NextResponse.json({ error: 'Paramètre url manquant ou invalide' }, { status: 400 })
  }

  let host = ''
  try { host = new URL(target).hostname } catch { /* déjà validé */ }

  // 1) DNS
  let ip: string | null = null
  let dnsError = ''
  try {
    ip = (await lookup(host, { family: 0 })).address
  } catch {
    dnsError = 'Résolution DNS impossible depuis ce serveur'
  }

  // 2) API Xtream (si l'URL correspond au format /live/user/pass/id.ext)
  //    UN SEUL appel : le corps JSON est petit, lu directement ici.
  const m = target.match(/\/live\/([^/]+)\/([^/]+)\/\d+/)
  let api: {
    status: number; ms: number; error?: string
    accountStatus?: string; activeCons?: string | number; maxCons?: string | number; expiry?: string
  } | null = null
  if (m) {
    const [, user, pass] = m
    const u = new URL(target)
    const apiUrl = `${u.protocol}//${u.host}/player_api.php?username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`
    const t0 = Date.now()
    try {
      const res = await fetch(apiUrl, {
        headers: { 'User-Agent': UA, Accept: '*/*' },
        redirect: 'follow',
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      })
      const ms = Date.now() - t0
      api = { status: res.status, ms }
      if (res.status === 200) {
        try {
          const j = JSON.parse((await res.text()).slice(0, 20000))
          const ui = j?.user_info ?? {}
          api.accountStatus = ui.status
          api.activeCons = ui.active_cons
          api.maxCons = ui.max_connections
          if (ui.exp_date) api.expiry = new Date(Number(ui.exp_date) * 1000).toISOString().slice(0, 10)
        } catch { /* corps non JSON : on garde le statut brut */ }
      } else {
        try { await res.body?.cancel() } catch { /* noop */ }
      }
    } catch (e) {
      api = { status: 0, ms: Date.now() - t0, error: e instanceof Error ? e.message : 'erreur réseau' }
    }
  }

  // 3) Le flux lui-même, depuis CE serveur
  const stream = await statusOf(target, 12000)

  // 4) Verdict actionnable en français
  let verdict: string
  if (dnsError) {
    verdict = `Le nom du fournisseur (${host}) ne se résout pas depuis ce serveur — vérifiez le DNS du serveur CMS.`
  } else if (stream.status === 200) {
    verdict = 'Flux ACCESSIBLE depuis ce serveur : la lecture via le proxy devrait fonctionner. Réessayez la lecture.'
  } else if (stream.status === 401 || stream.status === 402 || stream.status === 403) {
    verdict =
      api && api.status === 200
        ? `Le fournisseur ACCEPTE l'API (compte « ${api.accountStatus ?? '?'} », ${api.activeCons ?? '?'} connexion(s) active(s) sur ${api.maxCons ?? '?'}), ` +
          `mais REFUSE le flux (HTTP ${stream.status}) depuis l'IP de ce serveur. ` +
          "C'est un blocage côté fournisseur (anti-datacenter ou verrouillage IP du compte) : la lecture via CE serveur est impossible par conception. " +
          "Solutions : « Lecture directe (navigateur) » si le CMS est servi en HTTP, ou déployer le CMS sur un réseau dont l'IP est autorisée par le fournisseur (comme vos applications IPTV)."
        : `Le fournisseur refuse l'API ET le flux (HTTP ${stream.status}) : identifiants refusés ou compte suspendu. Vérifiez le compte dans l'onglet IPTV.`
  } else if (stream.status === 429) {
    verdict = "Quota de connexions du compte atteint (HTTP 429) : un autre appareil utilise le flux. Attendez ou arrêtez l'autre lecture."
  } else if (stream.status === 0) {
    verdict =
      `Serveur du fournisseur INJOIGNABLE depuis ce serveur (${stream.error ?? 'délai dépassé'} après ${stream.ms} ms). ` +
      'Le fournisseur bloque probablement les IP de type datacenter/serveur. La lecture via CE serveur est impossible : déployez le CMS sur un réseau autorisé par le fournisseur.'
  } else {
    verdict = `Le flux a répondu HTTP ${stream.status} depuis ce serveur. ${stream.body ? `Détail : ${stream.body}` : ''}`
  }

  return NextResponse.json(
    { host, ip, dnsError, api, stream: { status: stream.status, ms: stream.ms, error: stream.error, contentType: stream.contentType }, verdict },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
