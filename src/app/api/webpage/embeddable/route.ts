import { NextRequest, NextResponse } from 'next/server'
import { validatePublicTarget } from '@/lib/ssrf-guard'

export const dynamic = 'force-dynamic'

/**
 * GET /api/webpage/embeddable?url=...
 * Vérifie côté serveur si un site autorise l'intégration dans une iframe
 * (en-têtes X-Frame-Options / Content-Security-Policy frame-ancestors).
 * Utilisé par le widget page web du lecteur pour afficher un diagnostic fiable
 * lorsque le site refuse d'être affiché dans une autre page.
 * v3.11 : garde anti-SSRF — seules les adresses publiques sont vérifiées.
 */
export async function GET(req: NextRequest) {
  const raw = (new URL(req.url).searchParams.get('url') || '').trim()
  if (!raw) {
    return NextResponse.json({ error: 'Paramètre url manquant' }, { status: 400 })
  }
  const guard = await validatePublicTarget(raw)
  if (!guard.ok || !guard.target) {
    return NextResponse.json({ error: guard.reason || 'Cible non autorisée' }, { status: 400 })
  }
  const target: URL = guard.target

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(target.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        // UA de navigateur réel : certains sites renvoient une page d'erreur
        // (avec X-Frame-Options) aux robots, mais servent le vrai site aux navigateurs
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.6',
      },
    })

    const xfo = (res.headers.get('x-frame-options') || '').toLowerCase()
    const csp = (res.headers.get('content-security-policy') || '').toLowerCase()

    const xfoBlocks = xfo.includes('deny') || xfo.includes('sameorigin')
    // frame-ancestors 'none' ou 'self' (sans mention de http/https) interdit l'intégration
    const ancestors = [...csp.matchAll(/frame-ancestors([^;]*)/g)].map((m) => m[1]).join(' ')
    const ancestorsBlocks =
      ancestors.length > 0 &&
      !(ancestors.includes('*') || ancestors.includes('http') || ancestors.includes('https'))

    // Sur une erreur (403 anti-robot, 429…) les en-têtes ne reflètent pas ce que
    // verrait un vrai navigateur : on ne conclut pas au blocage.
    const responseOk = res.status < 400

    return NextResponse.json({
      ok: true,
      url: target.toString(),
      status: res.status,
      embeddable: responseOk && !(xfoBlocks || ancestorsBlocks),
      reason:
        !responseOk
          ? `réponse HTTP ${res.status} (vérification non concluante)`
          : xfoBlocks
            ? `x-frame-options: ${xfo}`
            : ancestorsBlocks
              ? 'content-security-policy: frame-ancestors restrictif'
              : null,
    })
  } catch (e) {
    // Site injoignable depuis le serveur : on laisse le navigateur tenter (réseau local différent)
    return NextResponse.json({
      ok: true,
      url: target.toString(),
      embeddable: true,
      reason: e instanceof Error && e.name === 'AbortError' ? 'délai dépassé' : 'vérification impossible',
      checked: false,
    })
  } finally {
    clearTimeout(timer)
  }
}
