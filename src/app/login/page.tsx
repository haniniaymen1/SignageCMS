'use client'

import { useEffect, useRef, useState } from 'react'
import { Monitor, Eye, EyeOff, LogIn, Info, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { saveToken } from '@/lib/auth-token'
import { APP_VERSION } from '@/lib/version'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // Détection iframe : l'autoremplissage et les cookies y sont moins fiables.
  // v3.11.6 — initialisation DÉTERMINISTE (false partout) puis détection après
  // montage : l'ancien useState(() => typeof window !== 'undefined' && …)
  // rendait un arbre différent entre le serveur (false) et le client dans
  // l'iframe d'aperçu (true) → erreur d'hydratation React (bouton fantôme).
  const [inIframe, setInIframe] = useState(false)
  useEffect(() => {
    try {
      setInIframe(window.self !== window.top)
    } catch {
      // accès inter-origine refusé ⇒ on est nécessairement dans une iframe
      setInIframe(true)
    }
  }, [])
  // Références DOM : l'autoremplissage Chrome modifie les champs SANS déclencher
  // onChange de React — on lit donc les valeurs réelles du DOM à la soumission.
  const usernameRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const u = (usernameRef.current?.value ?? username).trim()
    const p = (passwordRef.current?.value ?? password).trim()
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Connexion impossible')
        return
      }
      if (data.token) saveToken(data.token)
      // Rechargement complet : le serveur voit le cookie (ou le jeton de secours)
      window.location.href = '/'
    } catch {
      setError('Serveur injoignable — réessayez')
    } finally {
      setLoading(false)
    }
  }

  const openNewTab = () => {
    window.open(window.location.href, '_blank')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 bg-[radial-gradient(ellipse_at_top,#1e293b,#0f172a_60%)] p-4">
      <div className="w-full max-w-md">
        {/* Carte de connexion */}
        <div className="rounded-2xl border border-white/10 bg-white shadow-2xl">
          <div className="flex flex-col items-center gap-2 px-8 pt-10 pb-2">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/30">
              <Monitor className="h-7 w-7" />
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">SignageCMS</h1>
            <p className="text-sm text-slate-500">Connexion à votre espace d&apos;affichage dynamique</p>
          </div>

          <form onSubmit={submit} className="space-y-4 px-8 py-6">
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="username">Identifiant</Label>
              <Input
                id="username"
                name="username"
                ref={usernameRef}
                autoFocus
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="ex : admin"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Mot de passe</Label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  ref={passwordRef}
                  type={showPwd ? 'text' : 'password'}
                  autoComplete="current-password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600"
                  onClick={() => setShowPwd((v) => !v)}
                  aria-label={showPwd ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                >
                  {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <Button type="submit" disabled={loading} className="w-full bg-orange-500 hover:bg-orange-600">
              <LogIn className="h-4 w-4" />
              {loading ? 'Connexion…' : 'Se connecter'}
            </Button>
            {inIframe && (
              <Button
                type="button"
                onClick={openNewTab}
                variant="outline"
                className="w-full border-orange-200 text-orange-700 hover:bg-orange-50"
              >
                <ExternalLink className="h-4 w-4" />
                Ouvrir dans un nouvel onglet
              </Button>
            )}
          </form>

          <div className="mx-8 mb-8 flex items-start gap-2 rounded-lg bg-slate-50 px-4 py-3 text-xs text-slate-500">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
            <div>
              Connectez-vous avec le compte fourni par votre administrateur.
              <br />
              <span className="text-slate-400">
                Identifiant en minuscules, sans espace. Utilisez l&apos;icône œil pour vérifier ce qui est réellement
                saisi. Si la connexion boucle, utilisez le bouton « Ouvrir dans un nouvel onglet ».
              </span>
            </div>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          SignageCMS v{APP_VERSION} — Les écrans (lecteurs) se connectent avec leur clé matérielle, sans compte.
        </p>
      </div>
    </div>
  )
}
