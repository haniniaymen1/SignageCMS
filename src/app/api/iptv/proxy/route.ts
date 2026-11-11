import { NextRequest, NextResponse } from 'next/server'
import { cachedFetch, findHub, startHub } from '@/lib/stream-hub'
import { materializeSlot, planLiveSources, releaseSlot, reserveSlot } from '@/lib/connection-pool'
import { validatePublicTarget } from '@/lib/ssrf-guard'

export const dynamic = 'force-dynamic'

/**
 * Proxy de streaming IPTV avec PARTAGE + POOL DE CONNEXIONS + TIMESHIFT :
 * - playlists m3u8/m3u réécrites (tous les segments/clés passent par le proxy),
 *   mises en cache très court : plusieurs écrans sur la MÊME chaîne ne génèrent
 *   qu'un seul fetch amont par segment (déduplication simultanée + TTL) ;
 * - flux continus (.ts/.flv demandés avec mode=live par le lecteur) redistribués
 *   via un hub : UNE SEULE connexion chez le fournisseur pour N écrans ;
 * - POOL DE CONNEXIONS : avant d'ouvrir une nouvelle connexion, le serveur
 *   vérifie la capacité restante de chaque compte (quota maxConnections) et
 *   ordonne les sources : compte d'origine si un slot est libre, sinon les
 *   mêmes chaînes chez les autres comptes du pool (répartition automatique) ;
 * - MODE STRICT (réglage) : dépassement de quota interdit → refus clair 429
 *   sans solliciter le portail (protège du blocage/ban fournisseur) ;
 * - TIMESHIFT : &delay=<secondes> → l'écran reçoit le flux enregistré avec le
 *   décalage demandé (ex. 60 = rediffusion 1 min après le direct) ; le hub
 *   enregistre le flux sur disque et le redistribue décalé — toujours UNE
 *   seule connexion amont, quel que soit le nombre d'écrans décalés ;
 * - bascule de secours : si le portail refuse (401/403/429…), le proxy retente
 *   automatiquement la même chaîne (même nom ou même tvg-id) chez un autre compte.
 * Les chaînes DIFFÉRENTES consomment 1 connexion chacune : c'est la limite
 * physique du fournisseur (1 flux = 1 connexion) — le pool les répartit sur
 * les slots disponibles, et chaque chaîne reste multi-écrans via le hub.
 */

const UA = 'VLC/3.0.20 LibVLC/3.0.20'
const PLAYLIST_TTL_MS = 1500

// Certains portails Xtream sont capricieux : timeouts et refus alternent pour
// une MÊME IP autorisée. Des re-tentatives rapprochées (courte temporisation)
// rétablissent la majorité des lectures sans changer le comportement nominal.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function isPlaylistUrl(url: string, contentType: string): boolean {
  if (/mpegurl/i.test(contentType)) return true
  if (/\.m3u8(\?|$)/i.test(url) || /format=m3u8/i.test(url)) return true
  if (/\.m3u($|\?)/i.test(url)) return true
  return false
}

function upstreamHeaders(req: NextRequest, withRange = false): Record<string, string> {
  const h: Record<string, string> = { 'User-Agent': UA, Accept: '*/*' }
  const referer = req.headers.get('x-iptv-referer')
  if (referer) h['Referer'] = referer
  if (withRange) {
    const range = req.headers.get('range')
    if (range) h['Range'] = range
  }
  return h
}

function rewritePlaylist(text: string, base: URL, channelId: string | null): string {
  const suffix = channelId ? `&ch=${encodeURIComponent(channelId)}` : ''
  const proxify = (u: string) => {
    try {
      const abs = new URL(u, base).toString()
      return `/api/iptv/proxy?url=${encodeURIComponent(abs)}${suffix}`
    } catch {
      return u
    }
  }
  return text
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim()
      if (!t) return line
      if (t.startsWith('#')) {
        // réécrire les attributs URI="…" (#EXT-X-KEY, #EXT-X-MAP…)
        return line.replace(/URI="([^"]+)"/g, (_m, u: string) => `URI="${proxify(u)}"`)
      }
      return proxify(t)
    })
    .join('\n')
}

function corsHeaders(): Record<string, string> {
  return { 'Access-Control-Allow-Origin': '*' }
}

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get('url')
  if (!target || !/^https?:\/\//i.test(target)) {
    return new NextResponse('Paramètre url manquant ou invalide', { status: 400 })
  }
  // Garde anti-SSRF (v3.11) : seules les cibles PUBLIQUES sont proxifiées.
  // Les portails IPTV sont des services internet — une adresse interne est
  // soit une erreur de configuration, soit une tentative d'exploration du LAN.
  const guard = await validatePublicTarget(target)
  if (!guard.ok || !guard.target) {
    return new NextResponse(guard.reason || 'Cible non autorisée', { status: 400 })
  }
  const ch = req.nextUrl.searchParams.get('ch')
  const live = req.nextUrl.searchParams.get('mode') === 'live'
  // Timeshift : décalage demandé en secondes (0/absent = direct)
  const delaySec = Math.max(0, parseInt(req.nextUrl.searchParams.get('delay') || '0', 10) || 0)
  const headers = upstreamHeaders(req)
  const range = req.headers.get('range')

  try {
    // ---------- 1) Flux continu (mode=live) : hub partagé, 1 connexion amont pour N écrans ----------
    if (live) {
      let hub = findHub(target)
      if (!hub) {
        // Planification du pool : capacité restante par compte, ordre des
        // sources, refus préventif en mode strict (aucun portail sollicité).
        const plan = await planLiveSources(ch ?? '', target)
        if (!plan.ok) {
          return new NextResponse(JSON.stringify({ error: plan.reason }), {
            status: 429,
            headers: { 'content-type': 'application/json', ...corsHeaders() },
          })
        }
        // Réservation synchronique (anti-course) libérée à la fermeture du hub.
        const token = plan.reserveProviderId ? reserveSlot(plan.reserveProviderId) : null
        // Enregistrement synchronique dans le registre → pas de double connexion
        // si deux écrans demandent la même chaîne au même instant.
        hub = startHub(
          target,
          headers,
          async () => plan.sources,
          token ? () => releaseSlot(token) : undefined,
          { timeshift: delaySec > 0 }
        )
        if (token) materializeSlot(token)
      } else if (delaySec > 0 && !hub.recording) {
        hub.enableTimeshift()
      }

      // ---------- 1b) Écran en rediffusion décalée (timeshift) ----------
      if (delaySec > 0) {
        const ready = await hub.waitForDelayedSource(delaySec * 1000, 30000)
        if (!ready.ok) {
          return new NextResponse(
            JSON.stringify({
              error:
                `Tampon timeshift insuffisant : le décalage demandé (${delaySec} s) n'est pas encore ` +
                `enregistré. Le direct est en cours d'enregistrement — réessayez dans quelques instants.`,
            }),
            { status: 502, headers: { 'content-type': 'application/json', ...corsHeaders() } }
          )
        }
        const out = new Headers()
        out.set('Content-Type', hub.contentType || 'video/mp2t')
        out.set('Cache-Control', 'no-store')
        out.set('x-iptv-hub', '1')
        out.set('x-iptv-viewers', String(hub.viewers()))
        out.set('x-iptv-delay', String(delaySec))
        for (const [k, v] of Object.entries(corsHeaders())) out.set(k, v)
        return new NextResponse(hub.attachDelayed(delaySec * 1000), { status: 200, headers: out })
      }

      const ready = await hub.waitForSource(15000)
      if (!ready.ok) {
        const st = hub.upstreamStatus
        const detail =
          st === 401 || st === 402 || st === 403
            ? ` — le portail a refusé l'accès au flux (HTTP ${st}) : quota de connexions atteint (un autre appareil regarde déjà ?), identifiants refusés ou IP du serveur bloquée par le fournisseur — utilisez le bouton « Diagnostic » ou « Lecture directe » du lecteur`
            : st === 429
              ? ' — quota de connexions du compte atteint (HTTP 429)'
              : st
                ? ` — le portail a répondu HTTP ${st}`
                : ' — portail injoignable ou délai dépassé'
        return new NextResponse(
          `Flux inaccessible (toutes les sources ont échoué${ch ? ', bascule de secours tentée' : ''}${detail})`,
          { status: 502, headers: corsHeaders() }
        )
      }
      const out = new Headers()
      out.set('Content-Type', hub.contentType || 'video/mp2t')
      out.set('Cache-Control', 'no-store')
      out.set('x-iptv-hub', '1')
      out.set('x-iptv-viewers', String(hub.viewers()))
      out.set('x-iptv-failover', hub.sourceIndex > 0 ? '1' : '0')
      for (const [k, v] of Object.entries(corsHeaders())) out.set(k, v)
      return new NextResponse(hub.attach(), { status: 200, headers: out })
    }

    // ---------- 2) Playlists .m3u8/.m3u : cache court + réécriture + failover ----------
    if (isPlaylistUrl(target, '')) {
      // Ordre des sources selon la capacité du pool (compte d'origine si un
      // slot est libre, sinon secours chez les autres comptes). Un fetch de
      // playlist est bref : pas de refus strict ni de réservation ici.
      const plan = await planLiveSources(ch ?? '', target)
      const candidates = plan.ok && plan.sources.length ? plan.sources : [target]
      let entry: Awaited<ReturnType<typeof cachedFetch>>['entry'] = null
      let used = { url: target, alt: false, fromCache: false }
      const stRef = { current: 0 }
      // 3 rondes de tentatives (toutes les sources candidates) — les portails
      // capricieux répondent souvent dès la 2ᵉ ronde. MAIS : un refus d'auth
      // déterministe (401/402/403) n'est PAS re-tenté, et un budget total de
      // 10 s est imposé (timeout par tentative 8 s) pour ne jamais laisser un
      // écran bloqué dans le vide — le lecteur affiche l'erreur rapidement.
      const deadline = Date.now() + 10000
      for (let attempt = 0; attempt < 3 && !entry; attempt++) {
        if (attempt > 0) await sleep(600 * attempt)
        if (Date.now() > deadline) break
        for (const url of candidates) {
          const r = await cachedFetch(url, { headers, ttlMs: PLAYLIST_TTL_MS, timeoutMs: 8000, statusRef: stRef })
          if (r.entry) {
            entry = r.entry
            used = { url, alt: url !== target, fromCache: r.fromCache }
            break
          }
          if (stRef.current === 401 || stRef.current === 402 || stRef.current === 403) break
        }
        if (stRef.current === 401 || stRef.current === 402 || stRef.current === 403) break
      }
      if (!entry) {
        const st = stRef.current
        const detail =
          st === 401 || st === 402 || st === 403
            ? ` — le portail a refusé l'accès (HTTP ${st}) : quota de connexions atteint (un autre appareil regarde déjà ?), identifiants refusés ou IP du serveur bloquée par le fournisseur — utilisez le bouton « Diagnostic » ou « Lecture directe » du lecteur`
            : st === 429
              ? ' — quota de connexions atteint (HTTP 429)'
              : st
                ? ` — le portail a répondu HTTP ${st}`
                : ' — portail injoignable ou délai dépassé'
        return new NextResponse(`Playlist inaccessible : ${target}${detail}`, { status: 502, headers: corsHeaders() })
      }
      const text = new TextDecoder().decode(entry.body)
      // Base de réécriture = URL FINALE après redirections : les portails qui
      // délèguent les flux à un CDN (302 → frontcdn…) servent leurs segments
      // depuis ce CDN — réécrire depuis l'URL d'origine casserait la lecture.
      const rewritten = rewritePlaylist(text, new URL(entry.finalUrl || used.url), ch)
      const out: Record<string, string> = {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-store',
        'x-iptv-cache': used.fromCache ? 'hit' : 'miss',
        ...(used.alt ? { 'x-iptv-failover': '1' } : {}),
        ...corsHeaders(),
      }
      return new NextResponse(rewritten, { status: 200, headers: out })
    }

    // ---------- 3) Segments HLS (.ts/.m2ts) et clés AES : cache partagé entre écrans ----------
    // (les URLs .ts sans Range proviennent des playlists réécrites ; les flux .ts
    //  continus du lecteur arrivent avec mode=live et sont gérés par le hub)
    if (!range && /\.(ts|m2ts)(\?|$)/i.test(target)) {
      let seg: Awaited<ReturnType<typeof cachedFetch>> = { entry: null, fromCache: false }
      const segSt = { current: 0 }
      for (let attempt = 0; attempt < 3 && !seg.entry; attempt++) {
        if (attempt > 0) await sleep(400 * attempt)
        seg = await cachedFetch(target, { headers, timeoutMs: 25000, statusRef: segSt })
        // Refus d'auth déterministe : inutile d'insister
        if (segSt.current === 401 || segSt.current === 402 || segSt.current === 403) break
      }
      const { entry, fromCache } = seg
      if (!entry) {
        return new NextResponse(`Segment inaccessible : ${target}`, { status: 502, headers: corsHeaders() })
      }
      const out = new Headers()
      out.set('Content-Type', entry.headers['content-type'] || 'video/mp2t')
      out.set('Content-Length', String(entry.bytes))
      out.set('Cache-Control', 'no-store')
      out.set('x-iptv-cache', fromCache ? 'hit' : 'miss')
      for (const [k, v] of Object.entries(corsHeaders())) out.set(k, v)
      return new NextResponse(entry.body as unknown as BodyInit, { status: 200, headers: out })
    }

    // ---------- 4) Autres flux (VOD, Range, formats directs) : transmission en streaming ----------
    const upstream = await fetch(target, {
      headers: upstreamHeaders(req, true),
      redirect: 'follow',
      cache: 'no-store',
      signal: AbortSignal.timeout(45000),
    })

    const contentType = upstream.headers.get('content-type') || ''

    // Playlist « masquée » (URL sans extension mais contenu m3u8/m3u)
    if (upstream.ok && isPlaylistUrl(target, contentType)) {
      const text = await upstream.text()
      const rewritten = rewritePlaylist(text, new URL(upstream.url || target), ch)
      return new NextResponse(rewritten, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-store',
          ...corsHeaders(),
        },
      })
    }

    // Transmission binaire en streaming
    const out = new Headers()
    const passthrough = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control']
    for (const h of passthrough) {
      const v = upstream.headers.get(h)
      if (v) out.set(h, v)
    }
    for (const [k, v] of Object.entries(corsHeaders())) out.set(k, v)
    if (!out.has('Content-Type')) out.set('Content-Type', 'application/octet-stream')

    return new NextResponse(upstream.body, { status: upstream.status, headers: out })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'upstream error'
    console.error('GET /api/iptv/proxy error:', msg)
    return new NextResponse(`Flux inaccessible : ${msg}`, { status: 502 })
  }
}
