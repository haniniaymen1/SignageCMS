import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { permissionsForRole } from '@/lib/permissions'
import type { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  // Permissions du rôle pour le filtrage du menu côté client (admin = tout)
  const permissions = user ? await permissionsForRole(user.role) : null
  return NextResponse.json({ user, permissions })
}
