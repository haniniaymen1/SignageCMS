import type { NextRequest } from 'next/server'

/**
 * Garde anti-SSRF partagée (v3.11).
 *
 * Le CMS embarque trois relais côté serveur — proxy de pages web (/api/webpage/proxy/**),
 * proxy IPTV (/api/iptv/proxy) et vérification d'intégrabilité (/api/webpage/embeddable).
 * Sans garde, un attaquant ayant accès au port HTTP du CMS peut s'en servir pour
 * atteindre des ressources INTERNES invisibles depuis l'extérieur :
 *   - métadonnées cloud (169.254.169.254),
 *   - services internes du réseau LAN (10.x, 192.168.x, 172.16-31.x),
 *   - services locaux du serveur lui-même (127.0.0.1, [::1], localhost).
 *
 * La garde refuse toute cible non publique :
 *   - protocole http/https uniquement, identifiants (user:pass@host) interdits ;
 *   - adresses IP littérales privées / boucle / lien-local / CGNAT refusées ;
 *   - noms d'hôte résolus via getaddrinfo : si TOUTES les adresses obtenues ne sont
 *     pas publiques, la cible est refusée (anti-DNS-rebinding : la résolution est
 *     revérifiée avec un TTL court).
 *
 * Usage légitime préservé : les écrans affichent des SITES PUBLICS — un site
 * intranet doit être intégré par son URL publique joignable, ou hébergé comme média.
 */

const DNS_TTL_MS = 60 * 1000
const dnsCache = new Map<string, { ok: boolean; at: number }>()

/** Plages IPv4 non publiques (RFC 1918/6598/1112 + boucle + lien-local + broadcast). */
function isPrivateIpv4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  if (!m) return true // format invalide → refus par précaution
  const [a, b] = [Number(m[1]), Number(m[2])]
  if ([a, b, Number(m[3]), Number(m[4])].some((n) => n > 255)) return true
  if (a === 0 || a === 10 || a === 127) return true // this-network / privé / boucle
  if (a === 169 && b === 254) return true // lien-local (métadonnées cloud incluses)
  if (a === 172 && b >= 16 && b <= 31) return true // privé
  if (a === 192 && b === 168) return true // privé
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT (RFC 6598)
  if (a === 192 && b === 0) return true // 192.0.0.0/24 (protocole) + 192.0.2.0/24 (doc)
  if (a === 198 && (b === 18 || b === 19)) return true // bench (RFC 2544)
  if (a === 224) return true // multicast et au-delà (224-255)
  return false
}

/** Adresses IPv6 non publiques (boucle, lien-local, ULA, documentation, multicast). */
function isPrivateIpv6(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0]
  if (v === '::' || v === '::1') return true
  if (/^f[cd]/.test(v)) return true // fc00::/7 ULA + fd00::/8
  if (/^fe[89ab]/.test(v)) return true // fe80::/10 lien-local
  if (/^ff/.test(v)) return true // multicast
  if (/^2001:(db8|0:)/.test(v)) return true // documentation / discard
  return false
}

export function isPrivateLiteralHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return isPrivateIpv4(h)
  if (h.includes(':')) return isPrivateIpv6(h)
  return false
}

async function resolvesToPublicIp(hostname: string): Promise<boolean> {
  const key = hostname.toLowerCase()
  const hit = dnsCache.get(key)
  if (hit && Date.now() - hit.at < DNS_TTL_MS) return hit.ok

  let ok = false
  try {
    const dns = await import(/* turbopackIgnore: true */ 'dns')
    const lookup = (family?: number) =>
      new Promise<string[]>((resolve) => {
        dns.lookup(key, { all: true, ...(family ? { family } : {}) }, (err, addrs) =>
          resolve(err ? [] : addrs.map((a) => a.address))
        )
      })
    let addrs = await lookup(4)
    if (!addrs.length) addrs = await lookup()
    ok = addrs.length > 0 && !addrs.some((a) => isPrivateIpv4(a) || isPrivateIpv6(a))
  } catch {
    ok = false // hôte non résolvable : refus (le fetch échouerait de toute façon)
  }
  dnsCache.set(key, { ok, at: Date.now() })
  if (dnsCache.size > 5000) dnsCache.clear()
  return ok
}

export interface TargetGuardResult {
  ok: boolean
  target?: URL
  reason?: string
}

/**
 * Valide une URL cible pour les relais serveur. Retourne l'URL normalisée si OK.
 * `checkDns` force la résolution : utile pour les proxys full-content (webpage,
 * IPTV). Pour une simple vérification d'en-têtes (embeddable), la résolution est
 * également appliquée — coût négligeable, protection identique.
 */
export async function validatePublicTarget(raw: string): Promise<TargetGuardResult> {
  const trimmed = (raw || '').trim()
  if (!trimmed) return { ok: false, reason: 'Adresse cible manquante' }
  let target: URL
  try {
    target = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
  } catch {
    return { ok: false, reason: 'URL invalide' }
  }
  if (!['http:', 'https:'].includes(target.protocol)) {
    return { ok: false, reason: 'Protocole non autorisé' }
  }
  if (target.username || target.password) {
    return { ok: false, reason: 'Identifiants dans l\u2019URL non autorisés' }
  }
  const host = target.hostname
  if (isPrivateLiteralHost(host)) {
    return { ok: false, reason: 'Adresse interne ou locale non autorisée' }
  }
  if (!(await resolvesToPublicIp(host))) {
    return { ok: false, reason: 'Adresse interne ou locale non autorisée' }
  }
  return { ok: true, target }
}

/** Hôte de la requête entrante (pour le garde anti-récursion des proxys). */
export function requestHostOf(req: NextRequest): string {
  return (req.headers.get('host') || '').toLowerCase()
}
