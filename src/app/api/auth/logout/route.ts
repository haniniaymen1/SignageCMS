import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, SESSION_COOKIE } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // Révocation serveur : tout jeton émis avant maintenant devient invalide
  const user = await getSessionUser(req)
  if (user) {
    await db.user.update({ where: { id: user.id }, data: { tokenValidAfter: new Date() } }).catch(() => {})
  }
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 })
  return res
}
