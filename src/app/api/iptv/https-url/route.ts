import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * VARIANTE HTTPS D'UN FLUX IPTV — pour la lecture directe navigateur depuis une
 * page servie en HTTPS (sinon mixed-content bloqué par le navigateur) :
 * - retrouve le compte Xtream correspondant au host de l'URL du flux ;
 * - lit server_info.https_port annoncé par le panel (stocké dans rawInfo) ;
 * - renvoie la même URL de flux en https://host:https_port/… (sinon null).
 * Le portail réel peut malgré tout refuser ce port (pare-feu) : c'est une
 * tentative de secours — le lecteur affiche un message clair si elle échoue.
 */
export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get('url')
  if (!target || !/^https?:\/\//i.test(target)) {
    return NextResponse.json({ url: null, reason: 'Paramètre url manquant ou invalide' }, { status: 400 })
  }

  let host = ''
  try { host = new URL(target).hostname.toLowerCase() } catch {
    return NextResponse.json({ url: null, reason: 'URL invalide' }, { status: 400 })
  }

  try {
    const providers = await db.iptvProvider.findMany({ select: { host: true, rawInfo: true } })
    for (const p of providers) {
      let phost = ''
      try { phost = new URL(p.host).hostname.toLowerCase() } catch { continue }
      if (phost !== host) continue
      if (!p.rawInfo) continue
      try {
        const raw = JSON.parse(p.rawInfo)
        const httpsPort = String(raw?.server_info?.https_port ?? '').trim()
        if (!httpsPort || httpsPort === '0') continue
        const u = new URL(target)
        u.protocol = 'https:'
        u.port = httpsPort
        return NextResponse.json({ url: u.toString(), httpsPort }, { headers: { 'Cache-Control': 'no-store' } })
      } catch { /* rawInfo non JSON chez ce compte */ }
    }
  } catch {
    return NextResponse.json({ url: null, reason: 'Erreur base de données' }, { status: 500 })
  }

  return NextResponse.json({ url: null }, { headers: { 'Cache-Control': 'no-store' } })
}
