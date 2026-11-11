import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, unauthorized } from '@/lib/auth'
import {
  MODULES,
  EDITABLE_ROLES,
  DEFAULT_MATRIX,
  getRolePermissions,
  saveRolePermissions,
  can,
  forbidden,
} from '@/lib/permissions'

export const dynamic = 'force-dynamic'

/** GET : matrice effective + métadonnées des modules (tout utilisateur authentifié) */
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return unauthorized()
  const matrix = await getRolePermissions()
  return NextResponse.json({
    modules: MODULES,
    editableRoles: EDITABLE_ROLES,
    matrix,
    defaults: DEFAULT_MATRIX,
    isAdmin: user.role === 'admin',
  })
}

/** PUT : enregistre la matrice (administrateur uniquement) */
export async function PUT(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return unauthorized()
  if (!(await can(user, 'users', 'update'))) return forbidden()

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || !body.matrix) {
    return NextResponse.json({ error: 'Matrice manquante' }, { status: 400 })
  }
  try {
    const matrix = await saveRolePermissions(body.matrix)
    return NextResponse.json({ ok: true, matrix })
  } catch (e) {
    console.error('PUT /api/permissions error:', e)
    return NextResponse.json({ error: 'Enregistrement impossible' }, { status: 500 })
  }
}
