// Parseur de playlists M3U / M3U8 (IPTV)
// Supporte les attributs #EXTINF : tvg-id, tvg-name, tvg-logo, group-title, tvg-language

export interface ParsedChannel {
  name: string
  url: string
  logo: string | null
  group: string | null
  tvgId: string | null
  language: string | null
}

const ATTR_RE = /([a-zA-Z0-9_-]+)="([^"]*)"/g

function safeName(raw: string): string {
  const n = raw.trim().replace(/\s+/g, ' ')
  return n || 'Chaîne sans nom'
}

/**
 * Analyse le contenu texte d'une playlist M3U et extrait les chaînes.
 * - ignore les lignes #EXTVLCOPT, #EXTGRP (les options VLC), #EXT-X-* (HLS)
 * - supporte aussi les simples listes d'URL (une URL par ligne)
 */
export function parseM3U(content: string): ParsedChannel[] {
  const lines = content.split(/\r?\n/)
  const channels: ParsedChannel[] = []
  const seen = new Set<string>()
  let pending: {
    name: string
    logo: string | null
    group: string | null
    tvgId: string | null
    language: string | null
  } | null = null

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    if (line.toUpperCase().startsWith('#EXTM3U')) continue

    if (/^#EXTINF:/i.test(line)) {
      const attrs: Record<string, string> = {}
      ATTR_RE.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = ATTR_RE.exec(line))) attrs[m[1].toLowerCase()] = m[2]
      const commaIdx = line.lastIndexOf(',')
      const name = commaIdx >= 0 ? safeName(line.slice(commaIdx + 1)) : ''
      pending = {
        name: name || safeName(attrs['tvg-name'] || ''),
        logo: attrs['tvg-logo'] || null,
        group: attrs['group-title'] || null,
        tvgId: attrs['tvg-id'] || null,
        language: attrs['tvg-language'] || null,
      }
      continue
    }

    if (line.startsWith('#')) continue // directives non supportées (#EXTVLCOPT, #EXTGRP, HLS…)

    // Ligne d'URL
    const url = line
    const key = url + '|' + (pending?.name ?? '')
    if (!/^https?:\/\//i.test(url) && !url.startsWith('/')) {
      pending = null
      continue
    }
    if (seen.has(key)) {
      pending = null
      continue
    }
    seen.add(key)

    channels.push({
      name: pending?.name || safeName(decodeURIComponent(url.split('/').pop() || url)),
      url,
      logo: pending?.logo || null,
      group: pending?.group || null,
      tvgId: pending?.tvgId || null,
      language: pending?.language || null,
    })
    pending = null
  }

  return channels
}

/** Détecte le type de flux à partir de son URL */
export function detectStreamKind(url: string): 'hls' | 'ts' | 'mpd' | 'direct' {
  const clean = url.split('?')[0].toLowerCase()
  if (clean.endsWith('.m3u8') || clean.includes('.m3u8')) return 'hls'
  if (/\.m3u($|\?)/i.test(url)) return 'hls' // playlists m3u brutes interprétées comme HLS côté proxy
  if (clean.endsWith('.ts') || clean.endsWith('.m2ts')) return 'ts'
  if (clean.endsWith('.flv')) return 'ts' // mpegts.js gère aussi le FLV live
  if (clean.endsWith('.mpd')) return 'mpd' // DASH via dash.js (MPD MP4/Tira)
  return 'direct'
}
