import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import os from 'os'
import { getSessionUser, unauthorized } from '@/lib/auth'
import { checkConversionTools } from '@/lib/pptx-convert'

export const dynamic = 'force-dynamic'

/**
 * GET /api/server-info
 * Fournit les adresses IP réseau réelles du serveur CMS (interfaces non internes).
 * Utilisée par le dialogue « Connecter Android » pour remplacer localhost
 * par une adresse joignable depuis l'appareil Android (cahier des charges §11).
 * v3.11 : session obligatoire — la topologie du LAN n'est pas une information publique.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return unauthorized()
  const ifaces = os.networkInterfaces()
  const addresses: string[] = []
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      // Interne = 127.0.0.1 / ::1 — on ne garde que les adresses LAN réelles
      if (!iface.internal && iface.family === 'IPv4') {
        addresses.push(iface.address)
      }
    }
  }
  // v3.11.9 — diagnostic des outils de conversion (présentations/PDF, images TIFF/ICO)
  const tools = await checkConversionTools().catch(() => ({ soffice: false, pdftoppm: false, ffmpeg: false }))

  return NextResponse.json({
    hostname: os.hostname(),
    port: Number(process.env.PORT || 3000),
    addresses,
    primary: addresses[0] || null,
    tools,
  })
}
