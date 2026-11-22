import { NextRequest, NextResponse } from 'next/server'
import { handleProxyTarget } from '../proxy-core'

export const dynamic = 'force-dynamic'

/**
 * GET/POST /api/webpage/proxy/https/site.com/chemin?requête
 *
 * Proxy de pages web sous FORME CHEMIN (§5 / §25 du cahier des charges).
 * L'URL cible est encodée dans le chemin : le premier segment est le schéma,
 * le second le domaine, la suite le chemin du site. La chaîne de requête de
 * l'appel est ajoutée telle quelle à l'URL cible.
 *
 * Avantage décisif : les URLs relatives des pages servies (liens, formulaires
 * générés côté client, redirections JS) se résolvent naturellement dans le
 * préfixe du proxy et restent donc dans le CMS — impossible d'échapper vers
 * le site réel (le refus d'intégration X-Frame-Options ne peut plus se déclencher).
 */
function targetFromRequest(req: NextRequest): string | null {
  const rawPath = new URL(req.url).pathname
  const prefix = '/api/webpage/proxy/'
  if (!rawPath.startsWith(prefix)) return null
  let rest = rawPath.slice(prefix.length)
  if (rest.endsWith('/')) rest = rest.slice(0, -1)
  // https/site/chemin → https://site/chemin (encodages conservés)
  const slash = rest.indexOf('/')
  const scheme = slash === -1 ? rest : rest.slice(0, slash)
  if (scheme !== 'http' && scheme !== 'https') return null
  if (slash === -1) return `${scheme}://`
  return `${scheme}://${rest.slice(slash + 1)}`
}

export async function GET(req: NextRequest) {
  const target = targetFromRequest(req)
  if (!target) {
    return NextResponse.json({ error: 'Chemin de proxy invalide' }, { status: 400 })
  }
  const search = new URL(req.url).search
  return handleProxyTarget(req, 'GET', search ? target + search : target)
}

export async function POST(req: NextRequest) {
  const target = targetFromRequest(req)
  if (!target) {
    return NextResponse.json({ error: 'Chemin de proxy invalide' }, { status: 400 })
  }
  const search = new URL(req.url).search
  return handleProxyTarget(req, 'POST', search ? target + search : target)
}
