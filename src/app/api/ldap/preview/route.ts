import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, unauthorized } from '@/lib/auth'
import { loadLdapConfig, mergeWithOverrides, searchLdapUsers } from '@/lib/ldap'

export const dynamic = 'force-dynamic'

/**
 * Prévisualisation : liste les utilisateurs contenus dans une OU LDAP précise,
 * sans aucune modification de la base. Marque ceux qui existent déjà dans le CMS.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return unauthorized()
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Réservé aux administrateurs' }, { status: 403 })
  }
  try {
    const body = (await req.json().catch(() => ({}))) as { ou?: string; overrides?: Record<string, unknown> }
    const saved = await loadLdapConfig()
    const cfg = mergeWithOverrides(saved, body.overrides)
    const users = await searchLdapUsers(cfg, body.ou)
    const cmsUsers = await db.user.findMany({
      select: { username: true, ldapDn: true, role: true, status: true },
    })
    const preview = users.map((u) => {
      const match = cmsUsers.find(
        (e) =>
          (e.ldapDn && e.ldapDn === u.dn) ||
          e.username.toLowerCase() === u.username.toLowerCase()
      )
      return {
        ...u,
        exists: !!match,
        role: match?.role ?? null,
        status: match?.status ?? null,
      }
    })
    return NextResponse.json({ users: preview, total: preview.length })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Recherche LDAP impossible' },
      { status: 502 }
    )
  }
}
