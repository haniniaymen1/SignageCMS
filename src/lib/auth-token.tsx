'use client'

import { useEffect } from 'react'

/**
 * Jeton de session de secours (localStorage) + injection automatique Bearer.
 *
 * Contexte : dans l'iframe de prévisualisation, les cookies peuvent être
 * bloqués (cookies tiers). Le login renvoie alors le jeton de session dans
 * la réponse JSON ; il est stocké ici et injecté dans TOUTES les requêtes
 * /api/** du CMS via un wrapper de window.fetch — la session survit même
 * sans cookies. Le lecteur (/api/player/**) reste hors périmètre (clé
 * matérielle).
 */
const KEY = 'cms_token'

export function saveToken(token: string) {
  try { localStorage.setItem(KEY, token) } catch { /* stockage indisponible */ }
}

export function getToken(): string | null {
  try { return localStorage.getItem(KEY) } catch { return null }
}

export function clearToken() {
  try { localStorage.removeItem(KEY) } catch { /* stockage indisponible */ }
}

let installed = false

export function installBearerFetch() {
  if (installed || typeof window === 'undefined') return
  installed = true
  const orig = window.fetch.bind(window)
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : null
    if (
      url &&
      url.startsWith('/api/') &&
      !url.startsWith('/api/player/') && // lecteurs : clé matérielle, pas de compte
      !url.startsWith('/api/auth/login') // login lui-même : pas encore de jeton
    ) {
      const token = getToken()
      if (token) {
        const headers = new Headers(init?.headers ?? undefined)
        if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)
        return orig(input, { ...init, headers })
      }
    }
    return orig(input, init)
  }) as typeof window.fetch
}

/** Monté une fois dans le layout racine : installe le wrapper dès le premier rendu. */
export function AuthFetchSetup() {
  useEffect(() => {
    installBearerFetch()
  }, [])
  return null
}
