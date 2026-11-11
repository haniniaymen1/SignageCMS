'use client'

import { useCallback, useEffect, useState } from 'react'
import { clearToken } from '@/lib/auth-token'

// Session expirée → purge du jeton de secours et retour à la page de connexion
function redirectIfUnauthorized(status: number) {
  if (status === 401 && typeof window !== 'undefined') {
    clearToken()
    window.location.href = '/login'
    return true
  }
  return false
}

// Hook générique pour charger une ressource de l'API
export function useResource<T>(resource: string | null) {
  const [data, setData] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!resource) return
    try {
      setLoading(true)
      const res = await fetch(`/api/resource/${resource}`)
      if (redirectIfUnauthorized(res.status)) return
      if (!res.ok) throw new Error('Erreur de chargement')
      setData(await res.json())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur')
    } finally {
      setLoading(false)
    }
  }, [resource])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { data, loading, error, refresh, setData }
}

export async function apiCreate<T>(resource: string, body: Record<string, unknown>): Promise<T | null> {
  const res = await fetch(`/api/resource/${resource}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (redirectIfUnauthorized(res.status)) return null
  if (!res.ok) return null
  return res.json()
}

export async function apiUpdate<T>(resource: string, id: string, body: Record<string, unknown>): Promise<T | null> {
  const res = await fetch(`/api/resource/${resource}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (redirectIfUnauthorized(res.status)) return null
  if (!res.ok) return null
  return res.json()
}

export async function apiDelete(resource: string, id: string): Promise<boolean> {
  const res = await fetch(`/api/resource/${resource}/${id}`, { method: 'DELETE' })
  if (redirectIfUnauthorized(res.status)) return false
  return res.ok
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 o'
  const k = 1024
  const sizes = ['o', 'Ko', 'Mo', 'Go']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m === 0) return `${s}s`
  return `${m}m ${s}s`
}

export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function formatDateTime(d: string | Date | null | undefined): string {
  if (!d) return '—'
  return new Date(d).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

export function timeAgo(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "à l'instant"
  if (mins < 60) return `il y a ${mins} min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `il y a ${hours} h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `il y a ${days} j`
  return formatDate(d)
}

// Icônes de widget (noms lucide gérés côté composants)
export const WIDGET_TYPES: Record<string, { label: string; icon: string; color: string }> = {
  text: { label: 'Texte', icon: 'Type', color: '#8b5cf6' },
  image: { label: 'Image', icon: 'Image', color: '#f97316' },
  video: { label: 'Vidéo', icon: 'Video', color: '#ef4444' },
  clock: { label: 'Horloge', icon: 'Clock', color: '#10b981' },
  weather: { label: 'Météo', icon: 'CloudSun', color: '#06b6d4' },
  rss: { label: 'Fil RSS', icon: 'Rss', color: '#eab308' },
  webpage: { label: 'Page web', icon: 'Globe', color: '#64748b' },
  iptv: { label: 'Flux IPTV', icon: 'Tv', color: '#0ea5e9' },
  presentation: { label: 'PowerPoint', icon: 'Presentation', color: '#a855f7' },
}

export const MEDIA_TYPE_META: Record<string, { label: string; color: string }> = {
  image: { label: 'Image', color: 'text-orange-600 bg-orange-50 border-orange-200' },
  video: { label: 'Vidéo', color: 'text-red-600 bg-red-50 border-red-200' },
  pdf: { label: 'PDF', color: 'text-rose-600 bg-rose-50 border-rose-200' },
  presentation: { label: 'Présentation', color: 'text-violet-600 bg-violet-50 border-violet-200' },
  audio: { label: 'Audio', color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  dataset: { label: 'Jeu de données', color: 'text-violet-600 bg-violet-50 border-violet-200' },
  stream: { label: 'Flux IPTV', color: 'text-sky-600 bg-sky-50 border-sky-200' },
  fichier: { label: 'Fichier', color: 'text-slate-600 bg-slate-50 border-slate-200' },
}
