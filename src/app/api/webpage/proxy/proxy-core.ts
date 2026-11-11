import { NextRequest, NextResponse } from 'next/server'
import { validatePublicTarget } from '@/lib/ssrf-guard'

/**
 * GET/POST /api/webpage/proxy?url=...
 * Proxy de pages web du CMS (§5 / §25 du cahier des charges).
 *
 * Objectif : afficher dans l'iframe du widget « Page web » des sites qui refusent
 * l'intégration (X-Frame-Options / CSP frame-ancestors). Le proxy :
 *   - récupère la page côté serveur avec un User-Agent de navigateur réel
 *   - NE transmet PAS les en-têtes de refus d'intégration (ils ne sortent jamais)
 *   - réécrit le HTML : <base>, liens/formulaires/iframes via le proxy,
 *     suppression des meta CSP, gestion du charset, injection d'un crochet JS
 *     pour fetch/XHR (les applications dynamiques continuent de fonctionner)
 *   - conserve les cookies du site (jar en mémoire) pour que les connexions
 *     (formulaires de login) fonctionnent
 *
 * Limites documentées (voir Matrice de tests §21.4) :
 *   - WebSocket non proxyfié
 *   - écritures document.cookie côté client non persistées dans le jar
 *   - redirections JS par location.href non interceptables (la page d'erreur
 *     du navigateur peut alors apparaître ; recharger via le bouton du widget)
 */

export const PROXY_PATH = '/api/webpage/proxy/'
const MAX_HTML_BYTES = 8 * 1024 * 1024
const MAX_PASSTHROUGH_BYTES = 50 * 1024 * 1024
const FETCH_TIMEOUT_MS = 20_000

// Jar de cookies en mémoire : hôte -> (nom -> valeur). Un seul serveur CMS =
// état partagé entre tous les lecteurs (comportement voulu pour l'affichage).
const cookieJar = new Map<string, Map<string, string>>()

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

// ---------- Cookies ----------

function jarFor(host: string): Map<string, string> {
  let jar = cookieJar.get(host)
  if (!jar) {
    jar = new Map()
    cookieJar.set(host, jar)
  }
  return jar
}

function storeCookies(host: string, setCookies: string[]) {
  if (!setCookies?.length) return
  const jar = jarFor(host)
  for (const raw of setCookies) {
    const firstPair = raw.split(';')[0]?.trim()
    if (!firstPair) continue
    const eq = firstPair.indexOf('=')
    if (eq <= 0) continue
    const name = firstPair.slice(0, eq).trim()
    const value = firstPair.slice(eq + 1).trim()
    if (!name) continue
    // cookie d'expiration vide : suppression
    if (/expires=thu, 01 jan 1970/i.test(raw) || value === '' || /^delete$/i.test(value)) {
      jar.delete(name)
    } else {
      jar.set(name, value)
    }
  }
}

function cookieHeaderFor(host: string): string {
  const jar = cookieJar.get(host)
  if (!jar || jar.size === 0) return ''
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}

// ---------- URL helpers ----------

function absolutize(u: string, base: string): string | null {
  if (!u) return null
  const t = u.trim()
  if (!t || /^(data:|javascript:|mailto:|tel:|blob:|about:|#)/i.test(t)) return null
  try {
    return new URL(t, base).href
  } catch {
    return null
  }
}

/**
 * URL de proxy sous FORME CHEMIN : /api/webpage/proxy/https/site/chemin
 * Les URLs relatives des pages servies à ce chemin se résolvent naturellement
 * dans le proxy — aucune réécriture nécessaire pour les liens relatifs, et les
 * formulaires générés côté client fonctionnent sans échapper vers le site réel.
 */
function proxyUrl(abs: string): string {
  return `${PROXY_PATH}${abs.replace('://', '/')}`
}

/** Réécrit toutes les occurrences d'un attribut dans les balises <tag ...>. */
function rewriteTagAttributes(
  html: string,
  tag: string,
  attrs: string[],
  pageUrl: string,
  stripTarget: boolean,
  rewriteAbsolute = true,
): string {
  const tagRe = new RegExp(`<${tag}(\\s[^>]*)?>`, 'gi')
  return html.replace(tagRe, (full) => {
    let out = full
    for (const attr of attrs) {
      const attrRe = new RegExp(`\\b${attr}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
      out = out.replace(attrRe, (m, _all, dq, sq, bare) => {
        const value = (dq ?? sq ?? bare ?? '').replace(/&amp;/gi, '&')
        const abs = absolutize(value, pageUrl)
        if (!abs) return m
        const newVal = proxyUrl(abs).replace(/&/g, '&amp;')
        return `${attr}="${newVal}"`
      })
    }
    if (stripTarget) out = out.replace(/\starget\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    return out
  })
}

/** Réécrit les URLs absolues d'un attribut srcset vers le proxy. */
function rewriteSrcset(html: string, pageUrl: string): string {
  return html.replace(/\ssrcset\s*=\s*("([^"]*)"|'([^']*)')/gi, (m, _q, dq, sq) => {
    const raw = (dq ?? sq ?? '').trim()
    if (!raw) return m
    const out = raw
      .split(',')
      .map((part) => {
        const seg = part.trim().split(/\s+/)
        if (/^(https?:)?\/\//i.test(seg[0])) return part
        const abs = absolutize(seg[0], pageUrl)
        if (!abs) return part
        seg[0] = proxyUrl(abs)
        return seg.join(' ')
      })
      .join(', ')
    return ` srcset="${out.replace(/"/g, '&quot;')}"`
  })
}

/** Réécrit les URL racine-relatifs dans les blocs <style> (url("/x.css"), @import "/y"). */
function rewriteInlineStyles(html: string, pageUrl: string): string {
  return html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (full, css: string) => {
    const rewritten = css
      .replace(/url\(\s*(['"]?)\/(?!\/)([^'")]+)\1\s*\)/gi, (m, q, path) => {
        const abs = absolutize(`/${path}`, pageUrl)
        return abs ? `url(${q}${proxyUrl(abs)}${q})` : m
      })
      .replace(/@import\s+(['"])\/(?!\/)([^'"]+)\1/gi, (m, q, path) => {
        const abs = absolutize(`/${path}`, pageUrl)
        return abs ? `@import ${q}${proxyUrl(abs)}${q}` : m
      })
    return full.replace(css, () => rewritten)
  })
}

/** Supprime les balises meta CSP, les anciennes <base>, les integrity et les meta charset. */
function stripBlockingMetas(html: string): string {
  return html
    .replace(/<meta[^>]+http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi, '')
    .replace(/<base\b[^>]*>/gi, '')
    .replace(/\sintegrity\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/<meta[^>]+charset\s*=\s*["']?[^"'>\s]+["']?[^>]*>/gi, '')
}

/** Réécrit meta refresh : content="5; url=..." */
function rewriteMetaRefresh(html: string, pageUrl: string): string {
  return html.replace(
    /(<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*")([^"]*)(")/gi,
    (m, pre: string, content: string, post: string) => {
      const parts = content.split(/;\s*(?:url\s*=\s*)?/i)
      if (parts.length < 2) return m
      const target = parts.slice(1).join(';').trim().replace(/^['"]|['"]$/g, '')
      const abs = absolutize(target, pageUrl)
      if (!abs) return m
      return `${pre}${parts[0]}; url=${proxyUrl(abs).replace(/&/g, '&amp;')}${post}`
    },
  )
}

// Crochet JS injecté dans les pages proxyfiées.
// Architecture PAR CHEMIN (/api/webpage/proxy/https/site/…) : les URLs relatives
// se résolvent d'elles-mêmes dans le proxy. Le crochet complète pour :
//   - fetch/XHR avec URL absolue vers le site → réécrites en forme chemin
//   - fetch/XHR racine-relatifs (/api/…) → re-préfixés avec le site courant
//   - navigations same-origin échappées (formulaires générés côté client,
//     location.href='/chemin') → interceptées via l'API Navigation et re-proxyfiées
const HOOK_SCRIPT = `<script>(function(){
var P='/api/webpage/proxy/';
function sitePrefix(){
  var m=location.pathname.match(/^\\/api\\/webpage\\/proxy\\/(https?)\\/([^\\/]+)/);
  return m ? (P+m[1]+'/'+m[2]) : null;
}
function wrap(u){
  try{
    if(typeof u!=='string')return u;
    if(u.indexOf('/api/webpage/proxy/')!==-1)return u;
    var a=new URL(u,location.href);
    if(!/^https?:/.test(a.protocol))return u;
    if(a.pathname.indexOf('/api/webpage/proxy/')===0)return u;
    var sp=sitePrefix();
    if(a.origin===location.origin){
      if(!sp)return u;
      return sp+a.pathname+a.search+a.hash;
    }
    return P+a.href.replace('://','/');
  }catch(e){return u}
}
if(window.fetch){
  var F=window.fetch;
  window.fetch=function(i,n){
    try{
      var u=(i&&i.url)?i.url:String(i);
      if(typeof u==='string')return F.call(this,wrap(u),n);
    }catch(e){}
    return F.apply(this,arguments);
  };
}
try{
  var X=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(m,u){
    try{u=wrap(String(u))}catch(e){}
    var rest=[].slice.call(arguments,2);
    return X.apply(this,[m,u].concat(rest));
  };
}catch(e){}
try{
  var WO=window.open;
  window.open=function(u){
    try{u=wrap(String(u))}catch(e){}
    return WO.call(window,u,'_self');
  };
}catch(e){}
try{
  var NAV=window.navigation;
  if(NAV&&NAV.addEventListener){
    NAV.addEventListener('navigate',function(ev){
      try{
        if(!ev||!ev.destination)return;
        if(ev.hashChange||ev.downloadRequest)return;
        if(ev.destination.sameDocument)return;
        var dest=ev.destination.url||'';
        if(!dest||dest.indexOf('/api/webpage/proxy/')!==-1)return;
        var sp=sitePrefix();
        if(!sp)return;
        var u=new URL(dest);
        if(u.origin!==location.origin)return;
        ev.intercept({handler:function(){location.replace(sp+u.pathname+u.search+u.hash);}});
      }catch(err){}
    });
  }
}catch(e){}
try{
  if(navigator.serviceWorker){
    navigator.serviceWorker.register('/api/webpage/proxy/sw.js',{scope:'/api/webpage/proxy/'}).catch(function(){});
  }
}catch(e){}
})();<\/script>`

// ---------- Réponse HTML proxyfiée ----------

function buildHtmlResponse(text: string, finalUrl: string): NextResponse {
  let html = text

  html = stripBlockingMetas(html)
  html = rewriteMetaRefresh(html, finalUrl)
  html = rewriteSrcset(html, finalUrl)
  // PAS de <base> (c'est lui qui faisait échapper formulaires et navigations client
  // vers le site réel). Toutes les URLs relatives/racine-relatives (liens, formulaires,
  // assets, lazy-loading) sont réécrites en forme chemin du proxy ; seules les URLs
  // absolues d'assets (CDN) restent chargées directement.
  html = rewriteTagAttributes(html, 'a', ['href'], finalUrl, true)
  html = rewriteTagAttributes(html, 'area', ['href'], finalUrl, true)
  html = rewriteTagAttributes(html, 'form', ['action'], finalUrl, true)
  html = rewriteTagAttributes(html, 'iframe', ['src'], finalUrl, false)
  html = rewriteTagAttributes(html, 'link', ['href'], finalUrl, false, false)
  html = rewriteTagAttributes(html, 'script', ['src'], finalUrl, false, false)
  html = rewriteTagAttributes(html, 'img', ['src', 'data-src', 'data-lazy-src'], finalUrl, false, false)
  html = rewriteTagAttributes(html, 'source', ['src'], finalUrl, false, false)
  html = rewriteTagAttributes(html, 'video', ['src', 'poster'], finalUrl, false, false)
  html = rewriteTagAttributes(html, 'audio', ['src'], finalUrl, false, false)
  html = rewriteTagAttributes(html, 'track', ['src'], finalUrl, false, false)
  html = rewriteTagAttributes(html, 'embed', ['src'], finalUrl, false, false)
  html = rewriteTagAttributes(html, 'object', ['data'], finalUrl, false, false)
  html = rewriteTagAttributes(html, 'input', ['src'], finalUrl, false, false)
  html = rewriteTagAttributes(html, 'use', ['href', 'xlink:href'], finalUrl, false, false)
  html = rewriteInlineStyles(html, finalUrl)

  const inject = `<meta charset="utf-8">${HOOK_SCRIPT}`
  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, (m) => `${m}${inject}`)
  } else if (/<html[^>]*>/i.test(html)) {
    html = html.replace(/<html[^>]*>/i, (m) => `${m}<head>${inject}</head>`)
  } else {
    html = `<head>${inject}</head>${html}`
  }

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-CMS-Proxy': '1',
    },
  })
}

function errorPage(message: string, retryUrl: string, detail?: string): NextResponse {
  const safe = message.replace(/[<>]/g, '')
  const safeDetail = (detail || '').replace(/[<>]/g, '').slice(0, 300)
  return new NextResponse(
    `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<style>body{font-family:sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.box{text-align:center;max-width:520px;padding:32px}h2{margin:0 0 12px}p{color:#94a3b8;line-height:1.5}
button{margin-top:20px;background:#f97316;color:#fff;border:0;border-radius:8px;padding:10px 20px;font-size:14px;cursor:pointer}</style></head>
<body><div class="box"><h2>Page web inaccessible</h2><p>${safe}</p>
${safeDetail ? `<p style="font-size:12px">${safeDetail}</p>` : ''}
<button onclick="location.reload()">Réessayer</button></div>
<script>setTimeout(function(){location.reload()},30000)</script></body></html>`,
    {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    },
  )
}

// ---------- Traitement principal ----------

export async function handleProxyTarget(
  req: NextRequest,
  method: 'GET' | 'POST',
  rawTarget: string,
): Promise<NextResponse> {
  const raw = rawTarget.trim()
  if (!raw) return NextResponse.json({ error: 'Adresse cible manquante' }, { status: 400 })

  // Garde anti-SSRF (v3.11) : seules les cibles PUBLIQUES sont proxifiées.
  // Protège le LAN du serveur, les métadonnées cloud et le CMS lui-même.
  const guard = await validatePublicTarget(raw)
  if (!guard.ok || !guard.target) {
    return NextResponse.json({ error: guard.reason || 'Cible non autorisée' }, { status: 400 })
  }
  const target = guard.target

  // Garde anti-récursion : ne pas proxifier le CMS lui-même
  const requestHost = (req.headers.get('host') || '').toLowerCase()
  if (requestHost && target.host.toLowerCase() === requestHost) {
    return errorPage('Cette adresse pointe vers le CMS lui-même et ne peut pas être affichée via le proxy.', req.url)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const headers: Record<string, string> = {
      'User-Agent': BROWSER_UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.6',
      'Upgrade-Insecure-Requests': '1',
    }
    const cookies = cookieHeaderFor(target.host)
    if (cookies) headers['Cookie'] = cookies
    if (method === 'POST') {
      const ct = req.headers.get('content-type')
      if (ct) headers['Content-Type'] = ct
      if (req.headers.get('origin')) headers['Origin'] = target.origin
      headers['Referer'] = target.origin + '/'
    }

    const body = method === 'POST' ? await req.arrayBuffer() : undefined
    const res = await fetch(target.toString(), {
      method,
      redirect: 'follow',
      signal: controller.signal,
      headers,
      body: body && body.byteLength > 0 ? Buffer.from(body) : undefined,
    })

    // Cookies du site dans le jar
    try {
      const sc = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? []
      const finalHost = res.url ? new URL(res.url).host : target.host
      storeCookies(finalHost, sc)
    } catch {
      /* jar optionnel */
    }

    const contentType = res.headers.get('content-type') || 'application/octet-stream'
    const finalUrl = res.url || target.toString()

    // Contenu non HTML : transmission directe (assets, JSON, flux…)
    if (!/text\/html|application\/xhtml/i.test(contentType)) {
      const buf = await res.arrayBuffer()
      if (buf.byteLength > MAX_PASSTHROUGH_BYTES) {
        return errorPage('Le contenu dépasse la taille maximale prise en charge par le proxy.', finalUrl)
      }
      return new NextResponse(Buffer.from(buf), {
        status: res.status,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'no-store',
          'X-CMS-Proxy': '1',
        },
      })
    }

    // HTML : décodage charset puis réécriture
    let buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength > MAX_HTML_BYTES) {
      buf = buf.subarray(0, MAX_HTML_BYTES)
    }
    let charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1]?.toLowerCase() || ''
    if (!charset) {
      const head = buf.subarray(0, 2048).toString('latin1')
      charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1]?.toLowerCase() || 'utf-8'
    }
    let text: string
    try {
      text = new TextDecoder(charset, { fatal: false }).decode(buf)
    } catch {
      text = buf.toString('utf-8')
    }

    if (!res.ok && res.status >= 400 && text.length < 2048) {
      return errorPage(
        `Le site a répondu avec une erreur HTTP ${res.status}.`,
        finalUrl,
        'Certaines pages protégées (anti-robot) ne sont pas affichables via un proxy.',
      )
    }

    return buildHtmlResponse(text, finalUrl)
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    return errorPage(
      aborted
        ? 'Le site met trop de temps à répondre (délai de 20 s dépassé).'
        : 'Le site est injoignable depuis le serveur CMS.',
      target.toString(),
      e instanceof Error ? e.message : undefined,
    )
  } finally {
    clearTimeout(timer)
  }
}
