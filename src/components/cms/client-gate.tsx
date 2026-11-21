'use client'

import { useEffect, useState } from 'react'
import { Loader2, Monitor } from 'lucide-react'
import Shell from '@/components/cms/shell'
import { getToken } from '@/lib/auth-token'

/**
 * Repli de la porte d'entrée quand aucun cookie de session n'est lisible
 * côté serveur (cookies bloqués dans l'iframe de prévisualisation).
 * Vérifie la session via /api/auth/me avec le jeton Bearer de secours ;
 * rend le CMS si valide, sinon renvoie vers /login.
 */
export default function ClientGate() {
  const [ok, setOk] = useState(false)

  useEffect(() => {
    const token = getToken()
    fetch('/api/auth/me', {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      cache: 'no-store',
    })
      .then(async (r) => {
        // /api/auth/me répond 200 même sans session ({user:null}) : il faut
        // vérifier qu'un utilisateur est réellement connecté avant d'entrer.
        const data = await r.json().catch(() => null)
        if (r.ok && data?.user) setOk(true)
        else window.location.replace('/login')
      })
      .catch(() => window.location.replace('/login'))
  }, [])

  if (ok) return <Shell />

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-900 text-slate-300">
      <Monitor className="h-8 w-8 text-orange-500" />
      <div className="flex items-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Vérification de la session…
      </div>
    </div>
  )
}
