import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/webpage/proxy/sw.js
 *
 * Service Worker du proxy de pages web (§5 / §25).
 * Portée : /api/webpage/proxy/ — n'intercepte QUE les requêtes des pages
 * proxyfiées (le CMS lui-même est hors de portée). Il re-préfixe toute
 * requête same-origin hors proxy (images lazy-loading créées par le JS du
 * site, SVG cartographiques, CSS dynamiques, fetch racine-relatifs…) avec le
 * site courant déduit de l'URL du document client (ou de son referer).
 */
export async function GET(_req: NextRequest) {
  const sw = `// Service Worker proxy SignageCMS — portée /api/webpage/proxy/
self.addEventListener('install', function () { self.skipWaiting() })
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()) })

function sitePrefixe(refUrl) {
  var m = String(refUrl || '').match(/^https?:\\/\\/[^/]+\\/api\\/webpage\\/proxy\\/(https?)\\/([^/?#]+)/)
  return m ? m[1] + '/' + m[2] : null
}

self.addEventListener('fetch', function (e) {
  try {
    var req = e.request
    if (req.method !== 'GET' && req.method !== 'HEAD') return
    var url = new URL(req.url)
    if (url.origin !== self.location.origin) return // CDN absolus : direct
    if (url.pathname.indexOf('/api/webpage/proxy/') === 0) return // déjà proxyfié

    e.respondWith((async function () {
      try {
        var ref = req.headers.get('referer') || req.headers.get('referrer') || ''
        var client = null
        try { client = e.clientId ? await self.clients.get(e.clientId) : null } catch (err) {}
        if (client && client.url) ref = client.url
        var prefixe = sitePrefixe(ref)
        if (!prefixe) return fetch(req) // hors contexte proxy : comportement normal
        var proxied = '/api/webpage/proxy/' + prefixe + url.pathname + url.search
        return fetch(proxied, { method: req.method, headers: req.headers })
      } catch (err) {
        return fetch(req)
      }
    })())
  } catch (err) { /* pas d'interception */ }
})
`
  return new Response(sw, {
    status: 200,
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Service-Worker-Allowed': '/api/webpage/proxy/',
      'Cache-Control': 'no-store',
    },
  })
}
