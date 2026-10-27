import { NextRequest, NextResponse } from 'next/server'
import { promises as fs, createWriteStream } from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import busboy from 'busboy'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { can } from '@/lib/permissions'
import { convertToSlides, convertToBrowserImage, checkConversionTools, slidesFailureMessage } from '@/lib/pptx-convert'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads')

const TYPE_BY_EXT: Record<string, string> = {
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image',
  '.webp': 'image', '.svg': 'image', '.bmp': 'image', '.ico': 'image', '.tiff': 'image', '.tif': 'image',
  '.mp4': 'video', '.webm': 'video', '.mov': 'video', '.mkv': 'video', '.avi': 'video',
  '.m4v': 'video', '.mpeg': 'video', '.mpg': 'video', '.3gp': 'video', '.ts': 'video',
  '.mp3': 'audio', '.wav': 'audio', '.ogg': 'audio', '.m4a': 'audio', '.aac': 'audio', '.flac': 'audio',
  '.pdf': 'pdf',
  '.ppt': 'presentation', '.pptx': 'presentation', '.pps': 'presentation', '.ppsx': 'presentation', '.odp': 'presentation',
  '.json': 'dataset', '.csv': 'dataset', '.xlsx': 'dataset', '.xls': 'dataset',
}

// Taille maximale configurable (Mo) — setting `maxUploadSize`, surcharge env MAX_UPLOAD_MB
async function getMaxUploadMb(): Promise<number> {
  const env = parseInt(process.env.MAX_UPLOAD_MB || '', 10)
  if (Number.isFinite(env) && env > 0) return env
  try {
    const row = await db.setting.findUnique({ where: { key: 'maxUploadSize' } })
    const n = parseInt(row?.value || '50', 10)
    return Number.isFinite(n) && n > 0 ? n : 50
  } catch {
    return 50
  }
}

// Espace disque disponible sur le volume d'upload (Node 18.15+ : fs.statfs)
async function getFreeSpaceMb(dir: string): Promise<number | null> {
  try {
    const statfs = await (fs as unknown as { statfs?: (p: string) => Promise<{ bsize: number; bavail: number }> }).statfs?.(dir)
    if (!statfs) return null
    return Math.floor((statfs.bsize * statfs.bavail) / (1024 * 1024))
  } catch {
    return null
  }
}

/**
 * v3.11.3 — téléversement en STREAMING (busboy) au lieu de `formData()`.
 * L'ancienne approche bufférisait tout le fichier en mémoire (≈ 3-4× sa
 * taille) : un fichier de 400 Mo faisait grimper le serveur au-delà de la
 * mémoire disponible et le tuait (OOM). Désormais le fichier est écrit sur
 * le disque au fil de l'eau (mémoire constante), avec contrôle de la limite
 * PENDANT le flux : le surplus est coupé et le fichier partiel supprimé.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return NextResponse.json({ error: 'Authentification requise' }, { status: 401 })
  if (!(await can(user, 'media', 'create'))) {
    return NextResponse.json({ error: 'Permission refusée pour votre rôle' }, { status: 403 })
  }

  let savedTempPath: string | null = null

  const contentType = req.headers.get('content-type') || ''
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json(
      { error: 'Requête invalide : le téléversement doit être de type multipart/form-data.' },
      { status: 400 }
    )
  }

  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true })

    // Vérification de l'espace disque avant écriture
    const freeMb = await getFreeSpaceMb(UPLOAD_DIR)
    if (freeMb !== null && freeMb < 100) {
      return NextResponse.json(
        { error: `Espace disque insuffisant sur le serveur (${freeMb} Mo libres). Libérez de l'espace puis réessayez.` },
        { status: 507 }
      )
    }

    const maxMb = await getMaxUploadMb()
    const maxBytes = maxMb * 1024 * 1024

    // Parseur multipart en streaming
    const bb = busboy({
      headers: { 'content-type': contentType },
      limits: { fileSize: maxBytes, files: 1 },
    })

    const fields: Record<string, string> = {}
    let originalName = ''
    let fileSize = 0
    let tooLarge = false
    let missingFile = true

    const fileDone = new Promise<void>((resolve, reject) => {
      bb.on('file', (_field, stream, info) => {
        missingFile = false
        originalName = info.filename || ''
        const ext = path.extname(originalName).toLowerCase()
        if (!ext || !/^\.[a-z0-9]{1,10}$/.test(ext)) {
          stream.resume()
          reject(new Error(`Extension de fichier invalide ou manquante (« ${ext || 'aucune'} »)`))
          return
        }
        const type = TYPE_BY_EXT[ext]
        if (!type) {
          stream.resume()
          reject(new Error(
            `Format « ${ext} » non pris en charge. Formats acceptés : images (png, jpg, jpeg, gif, webp, svg, bmp, ico, tiff, tif), vidéos (mp4, webm, mov, mkv, avi, m4v, mpg, mpeg, 3gp, ts), audio (mp3, wav, ogg, m4a, aac, flac), pdf, présentations (ppt, pptx, pps, ppsx, odp), données (json, csv, xlsx, xls).`
          ))
          return
        }
        const savedName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`
        savedTempPath = path.join(UPLOAD_DIR, savedName)
        const out = createWriteStream(savedTempPath)
        let counter = 0
        stream.on('limit', () => {
          // busboy a atteint le plafond fileSize : fichier tronqué → refus
          tooLarge = true
          out.destroy()
          reject(new Error('TOO_LARGE'))
        })
        stream.on('data', (chunk: Buffer) => {
          counter += chunk.length
          if (counter > maxBytes) {
            tooLarge = true
            // Coupe le flux : limite dépassée pendant le transfert
            stream.destroy()
            out.destroy()
            reject(new Error('TOO_LARGE'))
          }
        })
        stream.pipe(out)
        out.on('finish', () => {
          fileSize = counter
          resolve()
        })
        out.on('error', reject)
      })
      bb.on('field', (name, val) => {
        fields[name] = val
      })
      bb.on('error', (err) => reject(err))
      bb.on('close', () => {
        // résolu par le flux du fichier ; si aucun fichier : signalé à la fin
        if (missingFile) reject(new Error('NO_FILE'))
      })
    })

    // Branche le corps de la requête (web stream → stream Node) dans busboy
    const nodeStream = Readable.fromWeb(req.body as unknown as import('stream/web').ReadableStream)
    await Promise.all([
      fileDone,
      pipeline(nodeStream, bb as unknown as NodeJS.WritableStream).catch(() => {
        /* les erreurs de flux sont portées par fileDone */
      }),
    ])

    if (missingFile && !savedTempPath) {
      return NextResponse.json({ error: 'Fichier manquant ou vide' }, { status: 400 })
    }
    if (tooLarge || !savedTempPath) {
      if (savedTempPath) await fs.rm(savedTempPath, { force: true })
      const sizeTxt = fileSize > 0 ? `${(fileSize / 1048576).toFixed(1)} Mo reçus` : 'taille inconnue'
      return NextResponse.json(
        { error: `Fichier trop volumineux (${sizeTxt} ; maximum autorisé : ${maxMb} Mo, réglable dans Paramètres)` },
        { status: 413 }
      )
    }

    const name = String(fields.name || originalName || 'Média').trim() || 'Média'
    const duration = parseInt(String(fields.duration || '10'), 10) || 10
    const savedName = path.basename(savedTempPath)
    const ext = path.extname(savedName).toLowerCase()
    const type = TYPE_BY_EXT[ext]

    // Présentations PPT/PPTX/ODP et PDF : conversion en slides PNG
    let slides: string[] | null = null
    let slidesWarning: string | null = null
    if (type === 'presentation' || type === 'pdf') {
      try {
        slides = await convertToSlides(savedName)
      } catch (e) {
        console.error('Conversion en slides échouée:', e)
      }
      // v3.11.9 — plus de défaillance silencieuse : si aucune slide n'a pu
      // être produite, la réponse d'upload embarque un diagnostic clair
      // (binaire manquant sur le serveur, fichier illisible…) et le média
      // reste réparable via « Reconvertir » dans la bibliothèque.
      if (!slides) {
        try {
          slidesWarning = slidesFailureMessage(await checkConversionTools())
        } catch {
          slidesWarning = 'La conversion en slides a échoué — vérifiez LibreOffice (soffice) et pdftoppm (Poppler) sur le serveur.'
        }
      }
    }

    // v3.11.5 — TIFF/TIF/ICO : illisibles dans les navigateurs et sur Android.
    // Si ffmpeg est disponible, conversion immédiate en PNG (sinon fichier conservé).
    let finalName = savedName
    if (type === 'image') {
      try {
        finalName = await convertToBrowserImage(savedName)
      } catch {
        finalName = savedName
      }
    }

    const media = await db.media.create({
      data: {
        name,
        type,
        fileName: finalName,
        fileSize,
        url: `/uploads/${finalName}`,
        duration,
        ...(slides ? { slides } : {}),
      },
    })
    return NextResponse.json(slidesWarning ? { ...media, slidesWarning } : media, { status: 201 })
  } catch (e) {
    const message = e instanceof Error ? e.message : ''
    // Nettoyage systématique d'un fichier partiel éventuel
    if (savedTempPath) await fs.rm(savedTempPath, { force: true }).catch(() => {})
    if (message === 'TOO_LARGE') {
      const maxMb = await getMaxUploadMb()
      return NextResponse.json(
        { error: `Fichier trop volumineux (maximum autorisé : ${maxMb} Mo, réglable dans Paramètres)` },
        { status: 413 }
      )
    }
    if (message === 'NO_FILE' || message === 'Fichier manquant ou vide') {
      return NextResponse.json({ error: 'Fichier manquant ou vide' }, { status: 400 })
    }
    if (message.startsWith('Extension de fichier invalide')) {
      return NextResponse.json({ error: message }, { status: 400 })
    }
    if (message.startsWith('Format «')) {
      return NextResponse.json({ error: message }, { status: 415 })
    }
    console.error('POST /api/upload error:', e)
    return NextResponse.json(
      { error: "L'upload a échoué (erreur serveur). Vérifiez la taille du fichier et réessayez." },
      { status: 500 }
    )
  }
}
