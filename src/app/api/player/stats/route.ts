import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * POST /api/player/stats
 * Preuve de diffusion envoyée par le lecteur Android (SubmitStats de XMDS).
 * Body : { hardwareKey, media, layout, count?, duration? }
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

    const media = String(body.media || 'Inconnu').slice(0, 200)
    const layout = body.layout ? String(body.layout).slice(0, 200) : null
    const count = Number.isFinite(Number(body.count)) ? Math.max(1, Math.floor(Number(body.count))) : 1
    const duration = Number.isFinite(Number(body.duration)) ? Math.max(0, Math.floor(Number(body.duration))) : 0

    await db.proofOfPlay.create({ data: { display: display.name, media, layout, count, duration } })

    // Journal une fois toutes les 5 lectures pour éviter de saturer le journal
    if (count % 5 === 1) {
      await db.logEntry.create({
        data: {
          level: 'info',
          display: display.name,
          message: `Lecture : ${media}${layout ? ` — ${layout}` : ''} (${duration} s)`,
        },
      })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('POST /api/player/stats error:', e)
    return NextResponse.json({ ok: false, error: 'Erreur serveur' }, { status: 500 })
  }
}
