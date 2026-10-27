// ============================================================
// mock-power360.mjs — Portail Xtream Codes SIMULÉ (données factices de démonstration)
// ------------------------------------------------------------
// Profil du compte (carte « Grattez ici vos paramètres d'accès ») :
//   - Serveur  : portail-xtream.example:8000 (ici 127.0.0.1:8998)
//   - Utilisateur / mot de passe : 000000000000 / 000000000000
//   - Max connexions simultanées : 1 (abonnement mono-connexion)
// Comportement REPRODUIT des vrais panels Xtream :
//   - player_api.php : auth=1, status=Active, exp_date, active_cons EN DIRECT,
//     max_connections=1, allowed_output_formats=[m3u8,ts]
//   - action=get_live_categories / get_live_streams (12 chaînes FR)
//   - /live/{u}/{p}/{id}.m3u8 → VRAI HLS : playlist glissante (segments de 2 s,
//     fenêtre de 4) + segments /live/{u}/{p}/{id}-{seq}.ts — comme les portails
//     Xtream réels. La « connexion » est une SESSION ouverte par la playlist et
//     maintenue par ses rafraîchissements (TTL 8 s, balayage 2 s) — les segments
//     n'ouvrent PAS de connexion (ils appartiennent à la session).
//   - Les SEGMENTS et les flux continus servent du VRAI MPEG-TS (moteur ffmpeg
//     pré-généré au démarrage : mire testsrc2 + tonalités) → décodable par
//     hls.js / mpegts.js dans le navigateur, comme chez un vrai portail.
//   - /live/{u}/{p}/{id}.ts  → flux TS CONTINU (chaque ouverture = 1 connexion)
//   - DÉPASSEMENT DE QUOTA : la NOUVELLE connexion/session gagne, la PLUS ANCIENNE
//     est COUPÉE (comportement « newest wins » des panels Xtream) → événement
//   - /stats → JSON { active_cons, max_connections, totalOpens, openById, events }
// Port 8998.
// ============================================================
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const PORT = 8998
const USERNAME = '000000000000'
const PASSWORD = '000000000000'
const MAX_CONNECTIONS = 1

// ---- Moteur MPEG-TS réel (ffmpeg) : 5 segments de 2 s rejoués en boucle ----
const SEG_DIR = path.join(os.tmpdir(), 'power360-segs')
const SEG_REAL = [] // { file, bytes }
function buildRealSegments() {
  try {
    fs.mkdirSync(SEG_DIR, { recursive: true })
    for (let i = 0; i < 5; i++) {
      const f = path.join(SEG_DIR, `seg${i}.ts`)
      execFileSync('ffmpeg', [
        '-y', '-loglevel', 'error',
        '-f', 'lavfi', '-i', `testsrc2=size=320x180:rate=25:duration=2`,
        '-f', 'lavfi', '-i', `sine=frequency=${440 + i * 110}:duration=2`,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
        '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '32k',
        '-mpegts_flags', 'resend_headers', '-f', 'mpegts', f,
      ])
      SEG_REAL.push({ file: f, bytes: fs.readFileSync(f) })
    }
    console.log(`Moteur MPEG-TS réel : ${SEG_REAL.length} segments ffmpeg prêts`)
  } catch (e) {
    console.log('ffmpeg indisponible — segments synthétiques de repli:', e.message)
    SEG_REAL.length = 0
  }
}
buildRealSegments()

const CHANNELS = [
  { id: 1001, name: 'TF1 HD', cat: 1 },
  { id: 1002, name: 'France 2 HD', cat: 1 },
  { id: 1003, name: 'M6 HD', cat: 1 },
  { id: 1004, name: 'France 3 HD', cat: 1 },
  { id: 1005, name: 'Arte HD', cat: 1 },
  { id: 1006, name: 'BFM TV HD', cat: 1 },
  { id: 1007, name: 'CNEWS HD', cat: 1 },
  { id: 1008, name: 'LCP HD', cat: 1 },
  { id: 1009, name: 'Euronews FR HD', cat: 1 },
  { id: 1010, name: 'TV5 Monde HD', cat: 1 },
  { id: 1011, name: 'RMC Découverte HD', cat: 1 },
  { id: 1012, name: '6ter HD', cat: 1 },
]

// ---- Registre des connexions ouvertes (comportement panel) ----
const openConns = new Set() // flux .ts continus — ordre d'insertion → premier = plus ancien
const sessions = new Map() // sessions HLS (playlist .m3u8) : id → { last, order }
let totalOpens = 0
const events = [] // { t, event, id, by? }
function logEvent(ev) {
  events.push({ t: new Date().toISOString(), ...ev })
  if (events.length > 300) events.shift()
}

// ---- Sessions HLS : ouverture via playlist, TTL 8 s, newest-wins ----
const SESSION_TTL_MS = 8000
function touchSession(id) {
  const now = Date.now()
  const s = sessions.get(id)
  if (s) {
    s.last = now
    return
  }
  while (sessions.size >= MAX_CONNECTIONS) {
    let oldestId = null
    let oldestLast = Infinity
    for (const [k, v] of sessions) {
      if (v.last < oldestLast) {
        oldestLast = v.last
        oldestId = k
      }
    }
    if (oldestId === null) break
    sessions.delete(oldestId)
    logEvent({ event: 'killed', id: oldestId, by: id, reason: 'max_connections reached (newest wins)' })
  }
  sessions.set(id, { last: now })
  totalOpens++
  logEvent({ event: 'open', id })
}
setInterval(() => {
  const now = Date.now()
  for (const [id, s] of sessions) {
    if (now - s.last > SESSION_TTL_MS) {
      sessions.delete(id)
      logEvent({ event: 'close', id })
    }
  }
}, 2000).unref()

const SEG_MS = 2000 // durée d'un segment HLS
const SEG_BYTES = 256 * 1024 // taille d'un segment HLS

function parseStreamPath(path) {
  // /live/{u}/{p}/{id}.(ts|m3u8) — flux continus et playlists
  const m = new RegExp(`^/live/${USERNAME}/${PASSWORD}/(\\d+)\\.(ts|m3u8)$`).exec(path)
  if (!m) return null
  const id = Number(m[1])
  return CHANNELS.some((c) => c.id === id) ? { id, ext: m[2] } : null
}

function parseSegmentPath(path) {
  // /live/{u}/{p}/{id}-{seq}.ts — segments HLS (appartiennent à la session,
  // n'ouvrent PAS de connexion fournisseur)
  const m = new RegExp(`^/live/${USERNAME}/${PASSWORD}/(\\d+)-\\d+\\.ts$`).exec(path)
  if (!m) return null
  const id = Number(m[1])
  return CHANNELS.some((c) => c.id === id) ? id : null
}

function startStream(req, res, id) {
  // Quota : la nouvelle connexion gagne, la plus ancienne est coupée
  while (openConns.size >= MAX_CONNECTIONS) {
    const oldest = openConns.values().next().value
    if (!oldest) break
    openConns.delete(oldest)
    try {
      oldest.res.destroy()
    } catch {
      /* noop */
    }
    logEvent({ event: 'killed', id: oldest.id, by: id, reason: 'max_connections reached (newest wins)' })
  }
  const conn = { id, res }
  openConns.add(conn)
  totalOpens++
  logEvent({ event: 'open', id })
  // Vrai MPEG-TS en continu : les segments ffmpeg sont rejoués en boucle
  // (comme un flux TS de portail réel) — repli sur des blocs synthétiques
  // si ffmpeg n'était pas disponible au démarrage.
  const mark = (id % 249) + 1
  const synth = Buffer.alloc(64 * 1024, mark)
  let segIdx = 0
  let done = false
  const cleanup = () => {
    if (done) return
    done = true
    clearInterval(timer)
    openConns.delete(conn)
    logEvent({ event: 'close', id })
  }
  res.writeHead(200, { 'content-type': 'video/mp2t' })
  const timer = setInterval(() => {
    if (res.destroyed || res.writableEnded) {
      cleanup()
      return
    }
    try {
      if (SEG_REAL.length > 0) {
        const s = SEG_REAL[segIdx % SEG_REAL.length]
        segIdx++
        res.write(s.bytes)
      } else {
        res.write(synth)
      }
    } catch {
      cleanup()
    }
  }, SEG_REAL.length > 0 ? 2000 : 40)
  res.on('close', cleanup)
  res.on('error', cleanup)
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url || '/', `http://${req.headers.host}`)
  const path = u.pathname

  // ---------- Statistiques ----------
  if (path === '/stats') {
    const openById = {}
    for (const c of openConns) openById[c.id] = (openById[c.id] || 0) + 1
    for (const id of sessions.keys()) openById[id] = (openById[id] || 0) + 1
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        active_cons: openConns.size + sessions.size,
        max_connections: MAX_CONNECTIONS,
        totalOpens,
        openById,
        events,
      })
    )
    return
  }

  // ---------- API Xtream player_api.php ----------
  if (path === '/player_api.php') {
    const username = u.searchParams.get('username') || ''
    const password = u.searchParams.get('password') || ''
    const action = u.searchParams.get('action') || ''
    if (username !== USERNAME || password !== PASSWORD) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          user_info: { auth: 0, status: 'Invalid credentials', message: 'Identifiants invalides' },
          server_info: {},
        })
      )
      return
    }
    if (action === 'get_live_categories') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify([{ id: 1, name: 'France | TNT', parent_id: 0 }]))
      return
    }
    if (action === 'get_live_streams') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify(
          CHANNELS.map((c) => ({
            stream_id: c.id,
            name: c.name,
            stream_name: c.name,
            stream_icon: '',
            category_id: String(c.cat),
            tv_archive: 0,
            direct_source: '',
          }))
        )
      )
      return
    }
    if (action === 'get_vod_categories' || action === 'get_series_categories') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify([]))
      return
    }
    if (action === 'get_vod_streams' || action === 'get_series') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify([]))
      return
    }
    // Auth simple (sans action) — active_cons en DIRECT comme un vrai panel
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        user_info: {
          username: USERNAME,
          password: PASSWORD,
          auth: 1,
          status: 'Active',
          exp_date: String(Math.floor(Date.now() / 1000) + 30 * 86400),
          is_trial: '0',
          active_cons: String(openConns.size + sessions.size),
          created_at: String(Math.floor(Date.now() / 1000) - 10 * 86400),
          max_connections: String(MAX_CONNECTIONS),
          allowed_output_formats: ['m3u8', 'ts'],
        },
        server_info: {
          url: 'portail-xtream.example',
          port: '8000',
          https_port: '443',
          server_protocol: 'http',
          timezone: 'Africa/Tunis',
        },
      })
    )
    return
  }

  // ---------- VRAI HLS : playlist glissante (session) + segments ----------
  const seg = parseSegmentPath(path)
  if (seg !== null) {
    if (SEG_REAL.length > 0) {
      // Segment MPEG-TS réel (ffmpeg) — décodable par les lecteurs navigateur
      const s = SEG_REAL[seg % SEG_REAL.length]
      res.writeHead(200, {
        'content-type': 'video/mp2t',
        'content-length': String(s.bytes.length),
        'cache-control': 'no-store',
      })
      res.end(s.bytes)
    } else {
      const mark = (seg % 249) + 1
      res.writeHead(200, {
        'content-type': 'video/mp2t',
        'content-length': String(SEG_BYTES),
        'cache-control': 'no-store',
      })
      res.end(Buffer.alloc(SEG_BYTES, mark))
    }
    return
  }

  const st = parseStreamPath(path)
  if (st !== null && st.ext === 'm3u8') {
    touchSession(st.id)
    const cur = Math.floor(Date.now() / SEG_MS)
    const first = cur - 3
    let body = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n'
    body += `#EXT-X-MEDIA-SEQUENCE:${first}\n`
    for (let n = first; n <= cur; n++) {
      body += '#EXTINF:2.0,\n'
      body += `/live/${USERNAME}/${PASSWORD}/${st.id}-${n}.ts\n`
    }
    res.writeHead(200, {
      'content-type': 'application/vnd.apple.mpegurl',
      'cache-control': 'no-store',
    })
    res.end(body)
    return
  }
  if (st !== null && st.ext === 'ts') {
    startStream(req, res, st.id)
    return
  }

  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('not found')
})

server.listen(PORT, () => console.log(`Portail Xtream simulé Power360 sur http://127.0.0.1:${PORT}`))
