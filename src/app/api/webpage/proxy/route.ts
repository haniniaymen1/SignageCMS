import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * GET/POST /api/webpage/proxy?url=https://site/chemin
 *
 * Forme historique du proxy. Redirige (307 — méthode et corps conservés) vers
 * la FORME CHEMIN /api/webpage/proxy/https/site/chemin?requête, seule forme où
 * les URLs relatives des pages se résolvent dans le proxy (voir [...path]/route.ts).
 */
export async function GET(req: NextRequest) {
  return redirectToPathForm(req)
}

export async function POST(req: NextRequest) {
  return redirectToPathForm(req)
}

function redirectToPathForm(req: NextRequest): NextResponse {
  const raw = (new URL(req.url).searchParams.get('url') || '').trim()
  if (!raw) {
    return NextResponse.json({ error: 'Paramètre url manquant' }, { status: 400 })
  }
  let target: URL
  try {
    target = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return NextResponse.json({ error: 'URL invalide' }, { status: 400 })
  }
  if (!['http:', 'https:'].includes(target.protocol)) {
    return NextResponse.json({ error: 'Protocole non autorisé' }, { status: 400 })
  }
  const pathForm = `/api/webpage/proxy/${target.toString().replace('://', '/')}`
  // Location RELATIVE : jamais d'hôte interne (0.0.0.0) exposé aux lecteurs distants
  return new NextResponse(null, { status: 307, headers: { Location: pathForm } })
}
