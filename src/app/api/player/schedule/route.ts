import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * GET /api/player/schedule?hardwareKey=...
 * Retourne la planification active pour l'écran identifié par sa clé matérielle
 * — planification active de l'écran.
 *
 * Ciblages supportés (ScheduleEvent) :
 *  - targetType "all"      : tous les écrans (displayGroupId null)
 *  - targetType "group"    : le groupe d'écrans auquel appartient l'écran
 *  - targetType "displays" : liste explicite d'écrans (displayIds = JSON array)
 *    (compatibilité : événements anciens avec displayGroupId renseigné et
 *     targetType par défaut "all" restent résolus comme ciblage de groupe)
 *
 * Ordre de priorité :
 *  1. Événements planifiés actifs ciblant l'écran (prioritaires d'abord)
 *  2. Présentation par défaut affectée à l'écran
 *
 * §16 (v3.8+) — chaque item embarque `loop` (ON/OFF) : la répétition en boucle
 * est décidée événement par événement dans le dialogue de planification.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const hardwareKey = (searchParams.get('hardwareKey') || '').trim()
    if (!hardwareKey) {
      return NextResponse.json({ ok: false, error: 'Clé matérielle manquante' }, { status: 400 })
    }

    const display = await db.display.findUnique({ where: { hardwareKey } })
    if (!display) {
      return NextResponse.json({ ok: false, error: 'Écran introuvable (clé invalide)' }, { status: 404 })
    }

    // Marque l'écran comme en ligne à chaque consultation de la planification
    await db.display.update({
      where: { id: display.id },
      data: { status: 'online', lastAccess: new Date() },
    })

    const now = new Date()

    // Conditions de ciblage : l'écran est concerné si
    //  a) l'événement cible son groupe (displayGroupId == display.groupId)
    //  b) l'événement cible tous les écrans (displayGroupId null + targetType all)
    //  c) l'événement liste explicitement l'écran (displayIds contient son id)
    const or: Prisma.ScheduleEventWhereInput[] = [
      { displayGroupId: null, targetType: 'all' },
      { displayIds: { contains: `"${display.id}"` } },
    ]
    if (display.groupId) {
      or.push({ displayGroupId: display.groupId })
    }

    const events = await db.scheduleEvent.findMany({
      where: { OR: or, start: { lte: now }, end: { gte: now } },
      orderBy: [{ isPriority: 'desc' }, { displayOrder: 'asc' }],
      include: {
        layout: true,
        campaign: { include: { layouts: { include: { layout: true }, orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }] } } },
      },
    })

    const items: Array<{
      id: string
      name: string
      type: 'layout' | 'campaign'
      layoutIds: string[]
      isPriority: boolean
      loop: boolean
      start: string
      end: string
    }> = []

    for (const ev of events) {
      if (ev.layoutId && ev.layout) {
        items.push({
          id: ev.id, name: ev.layout.name, type: 'layout', layoutIds: [ev.layoutId],
          isPriority: ev.isPriority, loop: ev.loop !== false,
          start: ev.start.toISOString(), end: ev.end.toISOString(),
        })
      } else if (ev.campaignId && ev.campaign) {
        const layoutIds = ev.campaign.layouts.map((cl) => cl.layoutId)
        if (layoutIds.length > 0) {
          items.push({
            id: ev.id, name: ev.campaign.name, type: 'campaign', layoutIds,
            isPriority: ev.isPriority, loop: ev.loop !== false,
            start: ev.start.toISOString(), end: ev.end.toISOString(),
          })
        }
      }
    }

    // Repli : présentation affectée directement à l'écran
    if (items.length === 0 && display.layoutId) {
      items.push({
        id: 'default', name: 'Présentation par défaut', type: 'layout',
        layoutIds: [display.layoutId], isPriority: false, loop: true,
        start: now.toISOString(), end: now.toISOString(),
      })
    }

    // Compatibilité APK ≤ 2.3 : setting global conservé dans la réponse,
    // mais la boucle est désormais décidée PAR ÉVÉNEMENT (item.loop, §16 v3.8+)
    let playerLoop = true
    try {
      const loopSetting = await db.setting.findUnique({ where: { key: 'playerLoop' } })
      if (loopSetting) playerLoop = loopSetting.value !== 'false'
    } catch { /* valeur par défaut : activée */ }

    return NextResponse.json({
      ok: true,
      time: now.toISOString(),
      display: { id: display.id, name: display.name },
      playerLoop,
      items,
    })
  } catch (e) {
    console.error('GET /api/player/schedule error:', e)
    return NextResponse.json({ ok: false, error: 'Erreur serveur' }, { status: 500 })
  }
}
