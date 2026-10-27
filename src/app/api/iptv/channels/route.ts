import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, unauthorized } from '@/lib/auth'
import { can, forbidden } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

// GET /api/iptv/channels?search=&group=&playlistId=&providerId=&kind=&skip=0&take=120&meta=1
export async function GET(req: NextRequest) {
  const _u = await getSessionUser(req)
  if (!_u) return unauthorized()
  if (!(await can(_u, 'iptv', 'view'))) return forbidden()
  try {
    const sp = req.nextUrl.searchParams
    const search = sp.get('search')?.trim()
    const group = sp.get('group')?.trim()
    const playlistId = sp.get('playlistId')?.trim()
    const providerId = sp.get('providerId')?.trim()
    const kind = sp.get('kind')?.trim()
    const skip = parseInt(sp.get('skip') || '0', 10) || 0
    const take = Math.min(parseInt(sp.get('take') || '120', 10) || 120, 500)

    const where: Record<string, unknown> = {}
    if (playlistId) where.playlistId = playlistId
    if (providerId && providerId !== 'all') where.providerId = providerId
    if (group) where.group = group
    if (kind && kind !== 'all') where.kind = kind
    if (search) {
      where.name = { contains: search }
    }

    const [items, total] = await Promise.all([
      db.iptvChannel.findMany({
        where,
        orderBy: { name: 'asc' },
        skip,
        take,
      }),
      db.iptvChannel.count({ where }),
    ])

    if (sp.get('meta')) {
      const baseMeta: Record<string, unknown> = {}
      if (playlistId) baseMeta.playlistId = playlistId
      if (providerId && providerId !== 'all') baseMeta.providerId = providerId
      if (kind && kind !== 'all') baseMeta.kind = kind
      const groupRows = await db.iptvChannel.findMany({
        where: playlistId || providerId || kind ? baseMeta : undefined,
        distinct: ['group'],
        select: { group: true },
        orderBy: { group: 'asc' },
      })
      const groups = groupRows.map((g) => g.group).filter((g): g is string => !!g)
      return NextResponse.json({ items, total, groups })
    }

    return NextResponse.json({ items, total })
  } catch (e) {
    console.error('GET /api/iptv/channels error:', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
