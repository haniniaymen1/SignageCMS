// Portail Xtream Codes de test (localhost:3999)
// Simule player_api.php + flux HLS live / VOD mp4 pour valider l'intégration de bout en bout.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const USER = 'testuser'
const PASS = 'testpass'
const SEG = readFileSync(join(import.meta.dir, 'testseg.ts'))
const MP4 = readFileSync(join(import.meta.dir, 'testvid.mp4'))

const json = (data: unknown) =>
  new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })

const USER_INFO = {
  user_info: {
    username: USER, password: PASS, message: 'Bienvenue', auth: 1, status: 'Active',
    exp_date: String(Math.floor(Date.now() / 1000) + 86400 * 300), is_trial: '0',
    active_cons: '0', created_at: '1700000000', max_connections: '2',
    allowed_output_formats: ['m3u8', 'ts'],
  },
  server_info: { url: 'localhost', port: '3999', server_protocol: 'http', timezone: 'Europe/Athens' },
}

const LIVE_CATS = [
  { id: '1', name: 'FR — Généralistes', parent_id: 0 },
  { id: '2', name: 'FR — Sport', parent_id: 0 },
]
const LIVE_STREAMS = [
  { id: 101, name: 'Test Info 24', stream_name: 'Test Info 24', stream_icon: '', category_id: '1', tv_archive: 0 },
  { id: 102, name: 'Test Sport HD', stream_name: 'Test Sport HD', stream_icon: '', category_id: '2', tv_archive: 0 },
]
const VOD_CATS = [{ id: '10', name: 'Films Action', parent_id: 0 }]
const VOD_STREAMS = [
  { id: 201, name: 'Test Film Action', stream_icon: '', category_id: '10', container_extension: 'mp4', rating: '7.5' },
]
const SERIES_CATS = [{ id: '20', name: 'Séries Drama', parent_id: 0 }]
const SERIES = [
  { series_id: 301, name: 'Test Série Drama', cover: '', category_id: '20', plot: 'Une série de test.', genre: 'Drama' },
]

Bun.serve({
  port: 3999,
  idleTimeout: 60,
  async fetch(req) {
    const url = new URL(req.url)
    const p = url.pathname
    const q = url.searchParams

    // === API player_api.php ===
    if (p === '/player_api.php') {
      if (q.get('username') !== USER || q.get('password') !== PASS) {
        return json({ user_info: { auth: 0, status: 'Disabled', message: 'Invalid credentials' } })
      }
      const action = q.get('action')
      if (!action) return json(USER_INFO)
      if (action === 'get_live_categories') return json(LIVE_CATS)
      if (action === 'get_live_streams') return json(LIVE_STREAMS)
      if (action === 'get_vod_categories') return json(VOD_CATS)
      if (action === 'get_vod_streams') return json(VOD_STREAMS)
      if (action === 'get_series_categories') return json(SERIES_CATS)
      if (action === 'get_series') return json(SERIES)
      if (action === 'get_series_info') {
        return json({
          info: { name: 'Test Série Drama', cover: '', plot: 'Une série de test.', genre: 'Drama' },
          seasons: [{ season: 1 }],
          episodes: {
            '1': [
              { id: 9001, episode_num: 1, title: 'Le début', container_extension: 'mp4' },
              { id: 9002, episode_num: 2, title: 'La suite', container_extension: 'mp4' },
            ],
          },
        })
      }
      return json([])
    }

    // === VOD / Séries mp4 (vraie vidéo H.264) ===
    if (p.startsWith('/movie/') && p.endsWith('.mp4')) {
      return new Response(MP4, { headers: { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' } })
    }
    if (p.startsWith('/series/') && p.endsWith('.mp4')) {
      return new Response(MP4, { headers: { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' } })
    }

    // === Flux HLS live ===
    if (p.match(/^\/live\/[^/]+\/[^/]+\/(\d+)\.m3u8$/)) {
      const id = p.match(/^\/live\/[^/]+\/[^/]+\/(\d+)\.m3u8$/)![1]
      const playlist = [
        '#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:4', '#EXT-X-MEDIA-SEQUENCE:0',
        '#EXTINF:4.0,', `/live/u/p/${id}seg1.ts`,
        '#EXTINF:4.0,', `/live/u/p/${id}seg1.ts`,
      ].join('\n') + '\n'
      return new Response(playlist, { headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } })
    }
    if (p.match(/^\/live\/[^/]+\/[^/]+\/\d+seg1\.ts$/)) {
      return new Response(SEG, { headers: { 'Content-Type': 'video/mp2t' } })
    }

    // === get.php (playlist m3u_plus) ===
    if (p === '/get.php') {
      const m3u = [
        '#EXTM3U',
        '#EXTINF:-1 tvg-logo="" group-title="FR — Généralistes",Test Info 24',
        `http://localhost:3999/live/${q.get('username')}/${q.get('password')}/101.m3u8`,
        '#EXTINF:-1 tvg-logo="" group-title="FR — Sport",Test Sport HD',
        `http://localhost:3999/live/${q.get('username')}/${q.get('password')}/102.m3u8`,
      ].join('\n') + '\n'
      return new Response(m3u, { headers: { 'Content-Type': 'audio/x-mpegurl' } })
    }

    return new Response('Not found', { status: 404 })
  },
})

console.log('Portail Xtream de test démarré sur http://localhost:3999')
