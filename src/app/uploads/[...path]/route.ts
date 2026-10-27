import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

/**
 * Service des fichiers téléversés (médias + slides PNG).
 * Indispensable en mode standalone : le manifeste statique est figé au démarrage,
 * les fichiers ajoutés ensuite ne seraient pas servis — cette route lit le disque
 * à chaque requête. Accès SANS session : les lecteurs d'écrans chargent les médias
 * avec leur clé matérielle (aucun compte).
 */
const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads')

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.m4v': 'video/x-m4v',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac',
  '.pdf': 'application/pdf',
  '.json': 'application/json', '.csv': 'text/csv', '.txt': 'text/plain',
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await ctx.params
  const safe = (parts ?? []).filter((p) => p && !p.includes('..') && !p.includes('\\'))
  if (!safe.length) return new NextResponse('Introuvable', { status: 404 })

  const filePath = path.join(UPLOAD_DIR, ...safe)
  if (!filePath.startsWith(UPLOAD_DIR + path.sep) && filePath !== UPLOAD_DIR) {
    return new NextResponse('Interdit', { status: 403 })
  }

  try {
    const stat = await fs.stat(filePath)
    if (!stat.isFile()) return new NextResponse('Introuvable', { status: 404 })
    const data = await fs.readFile(filePath)
    const ext = path.extname(filePath).toLowerCase()
    // v3.11 : un SVG peut contenir du JavaScript — servi sans protection, il
    // exécuterait du code dans l'origine du CMS (XSS stocké). La CSP « sandbox »
    // neutralise scripts et formulaires tout en laissant l'affichage fonctionner
    // (images, vidéos, PDF, audio). nosniff s'applique à tous les fichiers.
    const strict = ext === '.svg' || ext === '.html' || ext === '.htm' || ext === '.json'
    const headers: Record<string, string> = {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Content-Length': String(stat.size),
      'Cache-Control': 'public, max-age=3600',
      'Accept-Ranges': 'none',
      'X-Content-Type-Options': 'nosniff',
    }
    if (strict) {
      headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; sandbox"
      headers['Content-Disposition'] = 'inline'
    }
    return new NextResponse(new Uint8Array(data), { headers })
  } catch {
    return new NextResponse('Introuvable', { status: 404 })
  }
}
