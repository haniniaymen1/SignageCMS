import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, unauthorized } from '@/lib/auth'
import { can, forbidden } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const _u = await getSessionUser(req)
  if (!_u) return unauthorized()
  if (!(await can(_u, 'dashboard', 'view'))) return forbidden()
  try {
    const [displays, online, media, layouts, users, playlists, events, logs, proof, iptvChannels, iptvSources] = await Promise.all([
      db.display.count(),
      db.display.count({ where: { status: 'online' } }),
      db.media.count(),
      db.layout.count(),
      db.user.count(),
      db.playlist.count(),
      db.scheduleEvent.count(),
      db.logEntry.findMany({ orderBy: { createdAt: 'desc' }, take: 8 }),
      db.proofOfPlay.findMany({ orderBy: { date: 'asc' }, take: 200 }),
      db.iptvChannel.count(),
      db.iptvPlaylist.count(),
    ])

    // Statistiques de bande passante (7 derniers jours) simulées à partir du proof-of-play
    const days: { jour: string; bandePassante: number; lectures: number }[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const label = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' })
      const dayProof = proof.filter(
        (p) => new Date(p.date).toDateString() === d.toDateString()
      )
      const lectures = dayProof.reduce((s, p) => s + p.count, 0)
      days.push({
        jour: label,
        bandePassante: Math.round(lectures * 0.42 * 10) / 10 + lectures * 2.7,
        lectures,
      })
    }

    // Répartition des types de médias
    const allMedia = await db.media.findMany({ select: { type: true } })
    const mediaParType = Object.entries(
      allMedia.reduce<Record<string, number>>((acc, m) => {
        acc[m.type] = (acc[m.type] || 0) + 1
        return acc
      }, {})
    ).map(([type, count]) => ({ type, count }))

    return NextResponse.json({
      totalDisplays: displays,
      onlineDisplays: online,
      offlineDisplays: displays - online,
      totalMedia: media,
      totalLayouts: layouts,
      totalUsers: users,
      totalPlaylists: playlists,
      totalEvents: events,
      totalIptvChannels: iptvChannels,
      totalIptvSources: iptvSources,
      logs,
      bandwidth: days,
      mediaParType,
    })
  } catch (e) {
    console.error('GET /api/stats error:', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
