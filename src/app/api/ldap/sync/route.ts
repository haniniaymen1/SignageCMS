import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, unauthorized } from '@/lib/auth'
import { loadLdapConfig, mergeWithOverrides, syncLdapUsers } from '@/lib/ldap'

export const dynamic = 'force-dynamic'

/**
 * Import / synchronisation : crée et met à jour les comptes du CMS
 * à partir des utilisateurs d'une OU LDAP précise.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return unauthorized()
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Réservé aux administrateurs' }, { status: 403 })
  }
  try {
    const body = (await req.json().catch(() => ({}))) as {
      ou?: string
      defaultRole?: string
      groupId?: string | null
      disableMissing?: boolean
      overrides?: Record<string, unknown>
    }
    const saved = await loadLdapConfig()
    const cfg = mergeWithOverrides(saved, body.overrides)
    const stats = await syncLdapUsers(cfg, {
      ou: body.ou,
      defaultRole: body.defaultRole,
      groupId: body.groupId ?? null,
      disableMissing: body.disableMissing,
    })
    return NextResponse.json({ ok: true, stats })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Import LDAP impossible' },
      { status: 502 }
    )
  }
}
