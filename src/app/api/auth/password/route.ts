import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, hashPassword, verifyPassword, createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * Changement de mot de passe personnel (l'utilisateur connecté).
 * Body : { current, next }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getSessionUser(req)
    if (!session) return NextResponse.json({ error: 'Authentification requise' }, { status: 401 })

    const body = await req.json().catch(() => null)
    const current = String(body?.current ?? '')
    const next = String(body?.next ?? '')

    if (next.length < 6) {
      return NextResponse.json(
        { error: 'Le nouveau mot de passe doit contenir au moins 6 caractères' },
        { status: 400 }
      )
    }

    const user = await db.user.findUnique({ where: { id: session.id } })
    if (!user) return NextResponse.json({ error: 'Compte introuvable' }, { status: 404 })

    // Si un mot de passe existe déjà, l'actuel est exigé
    if (user.password && !verifyPassword(current, user.password)) {
      return NextResponse.json({ error: 'Mot de passe actuel incorrect' }, { status: 400 })
    }

    // Révoque les anciens jetons et renvoie une session fraîche pour l'utilisateur courant
    await db.user.update({
      where: { id: user.id },
      data: { password: hashPassword(next), tokenValidAfter: new Date() },
    })
    const token = await createSessionToken(user.id, user.role)
    const res = NextResponse.json({ ok: true })
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE,
    })
    return res
  } catch (e) {
    console.error('POST /api/auth/password error:', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
