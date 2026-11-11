import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, unauthorized } from '@/lib/auth'
import { loadLdapConfig, maskLdapConfig, sanitizeLdapConfigInput } from '@/lib/ldap'

export const dynamic = 'force-dynamic'

/** Configuration LDAP — réservée aux administrateurs */
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return unauthorized()
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Réservé aux administrateurs' }, { status: 403 })
  }
  const cfg = await loadLdapConfig()
  return NextResponse.json({ config: maskLdapConfig(cfg) })
}

export async function PUT(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return unauthorized()
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Réservé aux administrateurs' }, { status: 403 })
  }
  try {
    await loadLdapConfig()
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const patch = sanitizeLdapConfigInput(body)
    if (patch.url && !/^ldaps?:\/\//i.test(patch.url)) {
      return NextResponse.json({ error: 'URL invalide — utilisez ldap:// ou ldaps://' }, { status: 400 })
    }
    const saved = await db.ldapConfig.update({ where: { id: 'default' }, data: patch })
    return NextResponse.json({ config: maskLdapConfig(saved) })
  } catch (e) {
    console.error('PUT /api/ldap error:', e)
    return NextResponse.json({ error: "Impossible d'enregistrer la configuration" }, { status: 500 })
  }
}
