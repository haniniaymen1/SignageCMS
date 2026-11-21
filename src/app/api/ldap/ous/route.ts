import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, unauthorized } from '@/lib/auth'
import { listLdapOUs, loadLdapConfig, mergeWithOverrides } from '@/lib/ldap'

export const dynamic = 'force-dynamic'

/**
 * Liste les unités d'organisation (OU) disponibles sous la base DN.
 * Sert à remplir la liste déroulante « OU spécifique » de l'interface d'import.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return unauthorized()
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Réservé aux administrateurs' }, { status: 403 })
  }
  try {
    const body = (await req.json().catch(() => ({}))) as { overrides?: Record<string, unknown> }
    const saved = await loadLdapConfig()
    const cfg = mergeWithOverrides(saved, body.overrides)
    const ous = await listLdapOUs(cfg)
    return NextResponse.json({ ous })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Liste des OU impossible' },
      { status: 502 }
    )
  }
}
