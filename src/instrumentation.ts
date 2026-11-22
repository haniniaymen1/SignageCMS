// Instrumentation serveur — fiabilisation DNS + redirections pour fetch global.
//
// Contexte réel constaté : la résolution DNS de certains runtimes (c-ares de
// Bun) échoue de façon INTERMITTENTE ou bloque (« The operation timed out »,
// « Unable to connect ») sur des portails IPTV joignables par ailleurs
// (getaddrinfo système OK, curl OK). Symptôme utilisateur : « IPTV non
// fonctionnel » — ajout de compte ou lecture de flux qui échoue « parfois ».
//
// Stratégie (transparente pour tout le code : API portail, proxy IPTV, hubs,
// playlists M3U) :
//  1. HTTP (cas IPTV) : résolution PROACTIVE via node:dns (getaddrinfo
//     système, fiable) + cache 5 min, puis requête DIRECTE par IP avec
//     en-tête Host d'origine — zéro recours à c-ares.
//  2. HTTPS : chemin nominal par nom d'hôte (SNI/certificat), repli unique
//     par IP sur erreur réseau large.
//  3. Redirections 301/302/303/307/308 suivies MANUELLEMENT : chaque saut
//     profite du même traitement DNS (les redirections vers un serveur de
//     flux différent, ex. sX.xxx.net:8080, sinon contourneraient le repli).

const ipCache = new Map<string, { ip: string; at: number; bad?: boolean }>()
const IP_TTL_MS = 5 * 60 * 1000
const NEG_TTL_MS = 60 * 1000

function isIp(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || /:/.test(host)
}

/** getaddrinfo système (fiable) — essai IPv4 puis sans contrainte de famille */
async function resolveIp(hostname: string): Promise<string | null> {
  const hit = ipCache.get(hostname)
  if (hit && !hit.bad && Date.now() - hit.at < IP_TTL_MS) return hit.ip
  if (hit?.bad && Date.now() - hit.at < NEG_TTL_MS) return null
  const spec = 'node:' + 'dns'
  const dns = (await import(/* turbopackIgnore: true */ spec)) as {
    lookup: (h: string, o: { family?: number }, cb: (e: NodeJS.ErrnoException | null, a: string) => void) => void
  }
  const tryLookup = (family?: number) =>
    new Promise<string | null>((resolve) => {
      dns.lookup(hostname, family ? { family } : {}, (err, addr) => resolve(err || !addr ? null : addr))
    })
  const ip = (await tryLookup(4)) || (await tryLookup())
  ipCache.set(hostname, ip ? { ip, at: Date.now() } : { ip: '', at: Date.now(), bad: true })
  if (!ip) console.log(`[dns] getaddrinfo ÉCHEC pour ${hostname}`)
  return ip || null
}

function withIp(u: URL, ip: string): string {
  const port = u.port ? `:${u.port}` : ''
  return `${u.protocol}//${ip}${port}${u.pathname}${u.search}`
}

/** Signal de relance : frais si le signal d'origine a expiré de lui-même. */
function retrySignal(sig: AbortSignal | null | undefined): AbortSignal | undefined {
  if (!sig) return undefined
  if (!sig.aborted) return sig
  const reason = (sig as AbortSignal & { reason?: { name?: string } }).reason
  if (reason?.name === 'TimeoutError') return AbortSignal.timeout(30000)
  return sig // abort applicatif volontaire → on ne relance pas vraiment
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const g = globalThis as { fetch?: typeof fetch } & Record<string, unknown>
  if (g.__dnsFetchPatched) return
  g.__dnsFetchPatched = true

  const rawFetch = g.fetch!.bind(globalThis)
  const NETWORK_ERR = /timed? ?out|timeout|abort|enotfound|eai_again|econn(refused|reset|aborted)|ehostunreach|enetunreach|etimedout|epending|unable to connect|fetch failed|network|socket|connection (closed|error|refused|reset|terminated)/i

  async function hopFetch(input: RequestInfo | URL, init: RequestInit | undefined, depth: number): Promise<Response> {
    let url: URL
    try {
      url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    } catch {
      return rawFetch(input as RequestInfo, init)
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return rawFetch(input as RequestInfo, init)
    if (depth > 5) return rawFetch(input as RequestInfo, init)

    const host = url.hostname
    const isHttp = url.protocol === 'http:'

    // En-têtes de saut : on repart des en-têtes appelants SANS host hérité
    const headers = new Headers(init?.headers || (typeof input !== 'string' && !(input instanceof URL) ? input.headers : undefined))
    headers.delete('host')

    let target = input as string
    let byIp = false
    if (!isIp(host)) {
      const ip = await resolveIp(host)
      if (ip) {
        if (isHttp) {
          // HTTP : chemin principal par IP (Host conservé pour le vhost)
          headers.set('host', url.host)
          target = withIp(url, ip)
          byIp = true
          if (process.env.DNS_DEBUG === '1') console.log(`[dns] ${host} → ${ip} (par IP)`)
        }
        // HTTPS : on garde le nom d'hôte (SNI) ; l'IP servira de repli
      } else if (process.env.DNS_DEBUG === '1') {
        console.log(`[dns] ${host} : pas d'IP → chemin par nom d'hôte`)
      }
    }

    let res: Response
    try {
      res = await rawFetch(target, { ...init, headers, redirect: 'manual' })
    } catch (err) {
      const msg = err instanceof Error ? `${err.message} ${(err as Error & { cause?: Error }).cause?.message ?? ''}` : String(err)
      if (!NETWORK_ERR.test(msg)) throw err
      // Repli : par IP si on était par nom, par nom si on était par IP
      if (!byIp && !isIp(host)) {
        const ip = await resolveIp(host)
        if (ip) {
          const h2 = new Headers(headers)
          h2.set('host', url.host)
          try {
            res = await rawFetch(withIp(url, ip), { ...init, headers: h2, redirect: 'manual', signal: retrySignal(init?.signal) ?? AbortSignal.timeout(30000) })
          } catch {
            throw err
          }
        } else throw err
      } else if (byIp) {
        // l'IP a échoué → tentons le nom d'hôte (réponse c-ares différente possible)
        const h2 = new Headers(headers)
        h2.delete('host')
        try {
          res = await rawFetch(input as RequestInfo, { ...init, headers: h2, redirect: 'manual', signal: retrySignal(init?.signal) })
        } catch {
          throw err
        }
      } else throw err
    }

    // Suivi manuel des redirections : chaque saut repasse par hopFetch (DNS protégé)
    if (res.status >= 300 && res.status < 400 && res.status !== 304) {
      const loc = res.headers.get('location')
      if (loc) {
        const nextUrl = new URL(loc, url)
        const method = (init?.method || 'GET').toUpperCase()
        const keepBody = res.status === 307 || res.status === 308
        const nextInit: RequestInit = keepBody
          ? { ...init, redirect: 'manual' }
          : { method: method === 'HEAD' ? 'HEAD' : 'GET', headers: init?.headers, signal: init?.signal, redirect: 'manual' }
        try {
          await res.arrayBuffer() // libère la socket de la réponse 3xx
        } catch {
          /* corps 3xx illisible : sans importance */
        }
        return hopFetch(nextUrl.href, nextInit, depth + 1)
      }
    }
    return res
  }

  g.fetch = ((input: RequestInfo | URL, init?: RequestInit) => hopFetch(input, init, 0)) as typeof fetch

  console.log('[instrumentation] fetch fiabilisé (DNS getaddrinfo + redirections manuelles) activé')

  // v3.11.9 — avertissement au démarrage si les outils de conversion de documents
  // (LibreOffice + Poppler) sont absents : les PowerPoint/PDF ne seront pas
  // convertis en diapositives. On pointe vers les installateurs intégrés
  // (deploy/windows/install-tools.bat et deploy/linux/install-tools.sh).
  setTimeout(() => {
    import('@/lib/pptx-convert')
      .then(({ checkConversionTools }) => checkConversionTools())
      .then((tools) => {
        if (tools.soffice && tools.pdftoppm) return
        const missing = [
          !tools.soffice ? 'LibreOffice (soffice)' : null,
          !tools.pdftoppm ? 'Poppler (pdftoppm)' : null,
        ].filter(Boolean).join(' + ')
        console.warn('┌──────────────────────────────────────────────────────────────────┐')
        console.warn(`│  OUTIL DE CONVERSION MANQUANT : ${missing}`)
        console.warn('│  Les PowerPoint / PDF ne seront PAS convertis en diapositives.')
        console.warn('│  Installation automatique :')
        console.warn('│    Windows : deploy\\windows\\install-tools.bat (administrateur)')
        console.warn('│    Linux   : bash deploy/linux/install-tools.sh')
        console.warn('│  Puis bouton « Reconvertir » dans la bibliothèque de médias.')
        console.warn('└──────────────────────────────────────────────────────────────────┘')
      })
      .catch(() => { /* sonde indisponible : silence */ })
  }, 4000)

  // ── v3.11.10 — Auto-réparation de l'ordre des campagnes ──────────────────
  // Les ajouts rapides de présentations (ou d'anciennes versions) ont pu créer
  // des displayOrder DOUBLONS dans une même campagne ; le tri du lecteur devenait
  // alors arbitraire (ordre de diffusion non respecté). Au démarrage : renuméro-
  // tation contiguë 1..n (ordre relatif conservé) pour chaque campagne fautive.
  setTimeout(() => {
    import('@/lib/db')
      .then(async ({ db }) => {
        const campaigns = await db.campaign.findMany({ include: { layouts: true } })
        for (const c of campaigns) {
          if (c.layouts.length < 2) continue
          const sorted = [...c.layouts].sort((a, b) => a.displayOrder - b.displayOrder)
          const expected = sorted.map((_, i) => i + 1)
          const dirty = sorted.some((cl, i) => cl.displayOrder !== expected[i])
          if (!dirty) continue
          await db.$transaction(
            sorted.map((cl, i) => db.campaignLayout.update({ where: { id: cl.id }, data: { displayOrder: i + 1 } })),
          )
          console.log(`[repair] Campagne « ${c.name} » : ordre des présentations renuméroté (${sorted.length} entrées)`)
        }
      })
      .catch(() => { /* réparation indisponible : silence */ })
  }, 2500)
}
