import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * POST /api/player/heartbeat
 * Battement de cœur du lecteur Android : maintient l'écran « en ligne »
 * et retourne l'heure serveur + les commandes en attente.
 * Body : { hardwareKey: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const hardwareKey = String(body.hardwareKey || '').trim()
    if (!hardwareKey) {
      return NextResponse.json({ ok: false, error: 'Clé matérielle manquante' }, { status: 400 })
    }

    const display = await db.display.findUnique({ where: { hardwareKey } })
    if (!display) {
      return NextResponse.json({ ok: false, error: 'Écran introuvable (clé invalide)' }, { status: 404 })
    }

    await db.display.update({
      where: { id: display.id },
      data: { status: 'online', lastAccess: new Date() },
    })

    return NextResponse.json({
      ok: true,
      time: new Date().toISOString(),
      commands: [], // réservé : collecte de journaux, capture d'écran, redémarrage…
      volume: 100,
    })
  } catch (e) {
    console.error('POST /api/player/heartbeat error:', e)
    return NextResponse.json({ ok: false, error: 'Erreur serveur' }, { status: 500 })
  }
}
