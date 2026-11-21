// Client API Xtream Codes (portails IPTV)
// Référence : player_api.php — auth, catégories, flux Live/VOD/Séries
// URLs de streaming : /live/{u}/{p}/{id}.m3u8 · /movie/{u}/{p}/{id}.{ext} · /series/{u}/{p}/{id}.{ext}

export interface XtreamUserInfo {
  username: string
  password: string
  message?: string
  auth: number
  status: string
  exp_date: string | null // epoch secondes
  is_trial: string
  active_cons: string
  created_at: string
  max_connections: string
  allowed_output_formats: string[]
}

export interface XtreamServerInfo {
  url: string
  port: string | number
  https_port?: string | number
  server_protocol: string
  timezone?: string
}

export interface XtreamAuthResponse {
  user_info: XtreamUserInfo
  server_info: XtreamServerInfo
}

export interface XtreamCategory {
  id: string | number
  name: string
  parent_id?: string | number
}

export interface XtreamLiveStream {
  stream_id?: number | string // champ réel renvoyé par player_api.php get_live_streams
  id?: number | string
  name?: string
  stream_name?: string
  stream_icon?: string
  category_id: string | number
  tv_archive?: number
  direct_source?: string
}

export interface XtreamVodStream {
  stream_id?: number | string // champ réel renvoyé par player_api.php get_vod_streams
  id?: number | string
  name?: string
  stream_name?: string
  stream_icon?: string
  category_id: string | number
  container_extension?: string
  rating?: string
}

export interface XtreamSeries {
  series_id?: number | string // champ réel renvoyé par player_api.php get_series
  id?: number | string
  name: string
  cover?: string
  category_id: string | number
  plot?: string
  genre?: string
}

export interface XtreamEpisode {
  id: number | string
  episode_num: number | string
  title: string
  container_extension?: string
  season?: number | string
  info?: { movie_image?: string; plot?: string; duration?: string } & Record<string, unknown>
}

/** Normalise l'hôte du portail : ajoute http:// si absent, supprime le / final */
export function normalizeHost(raw: string): string {
  let h = raw.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(h)) h = 'http://' + h
  return h
}

/**
 * Extrait l'identifiant réel d'une entrée player_api.php.
 * L'API Xtream renvoie stream_id (live/vod) ou series_id (séries) — jamais « id »
 * sur ces listes. Rejette les valeurs vides/undefined/null pour ne jamais
 * construire d'URL « undefined.m3u8 ».
 */
export function xtreamStreamId(entry: unknown): string {
  if (!entry || typeof entry !== 'object') return ''
  const o = entry as Record<string, unknown>
  for (const key of ['stream_id', 'id', 'series_id']) {
    const v = o[key]
    const s = v === undefined || v === null ? '' : `${v}`.trim()
    if (s && s !== 'undefined' && s !== 'null') return s
  }
  return ''
}

function apiBase(host: string, username: string, password: string): string {
  const h = normalizeHost(host)
  return `${h}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`
}

/** Appel générique player_api.php avec une action donnée */
export async function xtreamRequest<T>(
  host: string,
  username: string,
  password: string,
  action?: string,
  extraParams?: Record<string, string>,
  timeoutMs = 30000
): Promise<T> {
  let url = apiBase(host, username, password)
  if (action) url += `&action=${encodeURIComponent(action)}`
  if (extraParams) {
    for (const [k, v] of Object.entries(extraParams)) url += `&${encodeURIComponent(k)}=${encodeURIComponent(v)}`
  }
  let res: Response
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20',
        Accept: 'application/json, */*',
      },
      redirect: 'follow',
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (e) {
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause.message : ''
    const msg = e instanceof Error ? e.message : String(e)
    if (/timeout|abort/i.test(msg) || /timed? ?out|etimedout/i.test(cause)) {
      throw new Error(`Le portail ne répond pas (délai ${Math.round(timeoutMs / 1000)} s dépassé)`)
    }
    throw new Error(`Connexion au portail impossible${cause ? ` (${cause})` : ''}`)
  }
  if (!res.ok) throw new Error(`Portail inaccessible (HTTP ${res.status})`)
  const text = await res.text()
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error('Réponse du portail illisible (JSON attendu)')
  }
}

/** Teste l'authentification et renvoie les infos du compte */
export async function xtreamAuth(host: string, username: string, password: string): Promise<XtreamAuthResponse> {
  const data = await xtreamRequest<XtreamAuthResponse>(host, username, password, undefined, undefined, 20000)
  if (!data || !data.user_info) throw new Error('Portail Xtream invalide (réponse sans user_info)')
  if (Number(data.user_info.auth) !== 1) {
    throw new Error(data.user_info.message || 'Authentification refusée par le portail')
  }
  return data
}

/** Construit l'URL de streaming directe d'un contenu Xtream */
export function buildStreamUrl(
  host: string,
  username: string,
  password: string,
  kind: 'live' | 'vod' | 'series',
  streamId: string | number,
  ext = 'm3u8'
): string {
  const h = normalizeHost(host)
  const folder = kind === 'live' ? 'live' : kind === 'vod' ? 'movie' : 'series'
  return `${h}/${folder}/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamId}.${ext}`
}

/** URL get.php — playlist M3U complète du portail */
export function buildM3UUrl(host: string, username: string, password: string, output: 'ts' | 'm3u8' = 'm3u8'): string {
  const h = normalizeHost(host)
  return `${h}/get.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&type=m3u_plus&output=${output}`
}

/** Expiration lisible */
export function expiryToDate(expDate: string | null): Date | null {
  if (!expDate) return null
  const n = Number(expDate)
  if (!Number.isFinite(n) || n <= 0) return null
  return new Date(n * 1000)
}
