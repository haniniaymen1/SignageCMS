// Serveur IPTV fictif pour les tests E2E — simule un portail fournisseur :
// - playlists HLS (2 « comptes » : primary / second) avec segments comptés
// - flux TS continu (compte les connexions ouvertes / totales)
// - chaînes continues multiples /live/chN.ts (compteurs PAR CHAÎNE : openByPath,
//   totalByPath) pour tester le pool multi-chaînes / multi-comptes
// - chaîne « bloquée » (403 max connections) pour tester la bascule de secours
// - VOD mp4 avec support Range (régression)
// Port 8997 — stats sur /stats (JSON { hits, open, totalOpens, openByPath, totalByPath })
import http from 'node:http'

const PORT = 8997
const hits = Object.create(null)
let open = 0
let totalOpens = 0
const openByPath = Object.create(null)
const totalByPath = Object.create(null)

function playlist(base) {
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:6',
    '#EXTINF:6.0,',
    `${base}/seg1.ts`,
    '#EXTINF:6.0,',
    `${base}/seg2.ts`,
    '#EXTINF:6.0,',
    `${base}/seg3.ts`,
    '',
  ].join('\n')
}

const server = http.createServer((req, res) => {
  const path = (req.url || '/').split('?')[0]

  if (path === '/stats') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ hits, open, totalOpens, openByPath, totalByPath }))
    return
  }

  hits[path] = (hits[path] || 0) + 1

  if (path === '/live/primary/index.m3u8') {
    res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' })
    res.end(playlist(`http://${req.headers.host}/live/primary`))
    return
  }
  if (path === '/live/second/index.m3u8') {
    res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' })
    res.end(playlist(`http://${req.headers.host}/live/second`))
    return
  }
  if (/^\/live\/(primary|second)\/seg\d+\.ts$/.test(path)) {
    const marker = path.includes('/second/') ? 2 : 1
    setTimeout(() => {
      if (res.writableEnded || res.destroyed) return
      const body = Buffer.alloc(300 * 1024, marker)
      res.writeHead(200, { 'content-type': 'video/mp2t', 'content-length': body.length })
      res.end(body)
    }, 150)
    return
  }
  if (path === '/live/continuous.ts') {
    open++
    totalOpens++
    res.writeHead(200, { 'content-type': 'video/mp2t' })
    const buf = Buffer.alloc(64 * 1024, 7)
    let done = false
    const cleanup = () => {
      if (done) return
      done = true
      clearInterval(timer)
      open--
    }
    const timer = setInterval(() => {
      if (res.destroyed || res.writableEnded) {
        cleanup()
        return
      }
      try {
        res.write(buf)
      } catch {
        cleanup()
      }
    }, 40)
    res.on('close', cleanup)
    res.on('error', cleanup)
    return
  }
  // Chaînes continues multiples /live/<nom>.ts — compteurs par chaîne
  const chMatch = /^\/live\/([a-z0-9-]+)\.ts$/.exec(path)
  if (chMatch) {
    const key = chMatch[1]
    open++
    totalOpens++
    openByPath[key] = (openByPath[key] || 0) + 1
    totalByPath[key] = (totalByPath[key] || 0) + 1
    res.writeHead(200, { 'content-type': 'video/mp2t' })
    const buf = Buffer.alloc(64 * 1024, Number(key.slice(2)) % 250)
    let done = false
    const cleanup = () => {
      if (done) return
      done = true
      clearInterval(timer)
      open--
      openByPath[key] = Math.max(0, (openByPath[key] || 1) - 1)
    }
    const timer = setInterval(() => {
      if (res.destroyed || res.writableEnded) {
        cleanup()
        return
      }
      try {
        res.write(buf)
      } catch {
        cleanup()
      }
    }, 40)
    res.on('close', cleanup)
    res.on('error', cleanup)
    return
  }
  if (path === '/live/blocked/index.m3u8' || path === '/live/blocked/stream.ts') {
    res.writeHead(403, { 'content-type': 'text/plain' })
    res.end('max connections reached')
    return
  }
  if (path === '/vod/movie.mp4') {
    const total = 1000
    const range = req.headers.range
    if (range) {
      const m = /bytes=(\d+)-(\d+)?/.exec(range)
      const s = Number(m ? m[1] : 0)
      const e = Math.min(Number(m && m[2] ? m[2] : s + 99), total - 1)
      const body = Buffer.alloc(e - s + 1, 9)
      res.writeHead(206, {
        'content-type': 'video/mp4',
        'content-range': `bytes ${s}-${e}/${total}`,
        'content-length': body.length,
        'accept-ranges': 'bytes',
      })
      res.end(body)
    } else {
      const body = Buffer.alloc(total, 9)
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': total, 'accept-ranges': 'bytes' })
      res.end(body)
    }
    return
  }

  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('not found')
})

server.listen(PORT, '127.0.0.1', () => console.log(`mock upstream IPTV sur http://127.0.0.1:${PORT}`))
