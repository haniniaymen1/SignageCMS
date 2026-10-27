import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * POST /api/player/register
 * Enregistrement du lecteur Android (APK) auprès du CMS.
 * Body : { hardwareKey: string, name?: string, version?: string, resolution?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const hardwareKey = String(body.hardwareKey || '').trim()
    if (!hardwareKey) {
      return NextResponse.json({ ok: false, error: 'Clé matérielle manquante' }, { status: 400 })
    }

    const display = await db.display.findUnique({
      where: { hardwareKey },
      include: { group: true },
    })
    if (!display) {
      return NextResponse.json({
        ok: false,
        error: `Écran introuvable pour la clé « ${hardwareKey} ». Vérifiez la clé dans le CMS (Écrans) ou ajoutez un nouvel écran.`,
      }, { status: 404 })
    }

    const patch: Record<string, unknown> = {
      status: 'online',
      lastAccess: new Date(),
    }
    if (body.resolution && typeof body.resolution === 'string') patch.resolution = body.resolution

    await db.display.update({ where: { id: display.id }, data: patch })
    await db.logEntry.create({
      data: {
        level: 'info',
        display: display.name,
        message: `Lecteur Android connecté${body.version ? ` (v${body.version})` : ''} — enregistrement réussi`,
      },
    })

    return NextResponse.json({
      ok: true,
      display: {
        id: display.id,
        name: display.name,
        hardwareKey: display.hardwareKey,
        resolution: (body.resolution as string) || display.resolution,
        group: display.group ? { id: display.group.id, name: display.group.name } : null,
        layoutId: display.layoutId,
      },
      settings: {
        schedulePollInterval: 60,   // secondes entre deux mises à jour de planification
        heartbeatInterval: 30,      // secondes entre deux battements de cœur
        proofOfPlay: true,
      },
    })
  } catch (e) {
    console.error('POST /api/player/register error:', e)
    return NextResponse.json({ ok: false, error: 'Erreur serveur' }, { status: 500 })
  }
}
