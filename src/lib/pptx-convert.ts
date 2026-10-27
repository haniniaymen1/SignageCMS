/**
 * Conversion des présentations (PPT / PPTX / PPS / PPSX / ODP) et PDF en images PNG par slide.
 * Pipeline : soffice --headless -> PDF -> pdftoppm -png -r 110 -> public/uploads/<stem>-slides/slide-N.png
 */
import { execFile } from 'child_process'
import { promises as fs, existsSync } from 'fs'
import path from 'path'
import os from 'os'
import { pathToFileURL } from 'url'

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads')

/**
 * Résout le binaire LibreOffice : variable d'environnement SOFFICE_PATH prioritaire,
 * puis emplacements d'installation Windows usuels, sinon nom simple (résolu par le PATH).
 * v3.11.11 — ajout de l'installation « par utilisateur » (%LOCALAPPDATA%\Programs).
 */
function resolveSoffice(): string {
  const fromEnv = process.env.SOFFICE_PATH
  if (fromEnv) return fromEnv
  if (process.platform === 'win32') {
    const candidates = [
      'C:/Program Files/LibreOffice/program/soffice.exe',
      'C:/Program Files (x86)/LibreOffice/program/soffice.exe',
      path.join(process.env.ProgramFiles ?? 'C:/Program Files', 'LibreOffice/program/soffice.exe'),
      path.join(process.env['LocalAppData'] ?? '', 'Programs', 'LibreOffice', 'program', 'soffice.exe'),
    ]
    for (const c of candidates) {
      if (!c || !c.includes('/')) continue
      try { if (existsSync(c)) return c } catch { /* ignore */ }
    }
    return 'soffice.exe' // dernier recours : recherché dans le PATH
  }
  return 'soffice'
}

/**
 * Résout le binaire pdftoppm (Poppler) : PDFTOPPM_PATH prioritaire,
 * puis emplacements Windows usuels (C:\poppler\Library\bin, choco, Program Files), sinon PATH.
 */
function resolvePdftoppm(): string {
  const fromEnv = process.env.PDFTOPPM_PATH
  if (fromEnv) return fromEnv
  if (process.platform === 'win32') {
    const candidates = [
      'C:/poppler/Library/bin/pdftoppm.exe',
      'C:/Program Files/poppler/Library/bin/pdftoppm.exe',
      'C:/ProgramData/chocolatey/bin/pdftoppm.exe',
    ]
    for (const c of candidates) {
      try { if (existsSync(c)) return c } catch { /* ignore */ }
    }
    return 'pdftoppm.exe' // dernier recours : recherché dans le PATH
  }
  return 'pdftoppm'
}

// v3.11.11 — résolution REFAITE à chaque vérification (voir checkConversionTools) :
// si LibreOffice/Poppler/ffmpeg sont installés APRÈS le démarrage du serveur CMS,
// ils sont détectés sans redémarrage (les anciennes constantes figeaient le chemin
// « binaire absent » pris au boot).
let SOFFICE_BIN = resolveSoffice()
let PDFTOPPM_BIN = resolvePdftoppm()
let FFMPEG_BIN = resolveFfmpeg()

export const PRES_EXT = ['.ppt', '.pptx', '.pps', '.ppsx', '.odp'] as const
export const PDF_EXT = '.pdf'

function isPresFile(name: string) {
  return PRES_EXT.some((ext) => name.toLowerCase().endsWith(ext))
}

/** Tri naturel des noms de fichiers (slide-1, slide-2, ..., slide-10) */
function naturalSort(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

/**
 * Convertit un fichier de présentation/PDF déposé dans UPLOAD_DIR en slides PNG.
 * @param savedFileName nom du fichier déjà enregistré dans public/uploads
 * @returns liste d'URLs publiques (/uploads/<stem>-slides/slide-N.png) ou null si non applicable
 */
export async function convertToSlides(savedFileName: string): Promise<string[] | null> {
  const lower = savedFileName.toLowerCase()
  const isPres = isPresFile(savedFileName)
  const isPdf = lower.endsWith(PDF_EXT)
  if (!isPres && !isPdf) return null

  const stem = path.basename(savedFileName).replace(/\.[^.]+$/, '')
  const outDir = path.join(UPLOAD_DIR, `${stem}-slides`)
  await fs.mkdir(outDir, { recursive: true })
  const loProfile = path.join(os.tmpdir(), 'lo-profile')
  await fs.mkdir(loProfile, { recursive: true })

  // 1) Obtenir un PDF : soit le fichier directement, soit via LibreOffice (profil isolé)
  let pdfPath: string
  if (isPdf) {
    pdfPath = path.join(UPLOAD_DIR, savedFileName)
  } else {
    await run(SOFFICE_BIN, [
      '--headless',
      `-env:UserInstallation=${pathToFileURL(loProfile).toString()}`,
      '--convert-to', 'pdf', '--outdir', UPLOAD_DIR, path.join(UPLOAD_DIR, savedFileName),
    ], 240_000)
    pdfPath = path.join(UPLOAD_DIR, `${stem}.pdf`)
    // On conserve le PDF intermédiaire (utile comme aperçu), laissés en place.
  }

  // 2) Rasterisation en PNG (110 dpi : bon compromis qualité/poids pour écrans)
  await run(PDFTOPPM_BIN, ['-png', '-r', '110', pdfPath, path.join(outDir, 'slide')], 240_000)

  // 3) Lister et trier les PNG générés
  const files = (await fs.readdir(outDir)).filter((f) => f.toLowerCase().endsWith('.png')).sort(naturalSort)
  if (files.length === 0) return null
  return files.map((f) => `/uploads/${stem}-slides/${f}`)
}

// ============================================================================
// v3.11.5 — Normalisation des images illisibles par les navigateurs et Android
// TIFF/TIF/ICO ne sont décodés ni par Chromium/Firefox ni par Android Bitmap :
// dès que ffmpeg est disponible, ils sont convertis en PNG à l'upload.
// Sans ffmpeg (déploiement Windows sans outil), le fichier d'origine est
// conservé et le lecteur web affiche un message de repli élégant.
// ============================================================================

const BROWSER_IMAGE_EXTS = ['.tiff', '.tif', '.ico']

/** Résout ffmpeg : FFMPEG_PATH prioritaire, emplacements Windows usuels, sinon PATH. */
function resolveFfmpeg(): string {
  const fromEnv = process.env.FFMPEG_PATH
  if (fromEnv) return fromEnv
  if (process.platform === 'win32') {
    const candidates = [
      'C:/ffmpeg/bin/ffmpeg.exe',
      'C:/Program Files/ffmpeg/bin/ffmpeg.exe',
      'C:/ProgramData/chocolatey/bin/ffmpeg.exe',
    ]
    for (const c of candidates) {
      try { if (existsSync(c)) return c } catch { /* ignore */ }
    }
    return 'ffmpeg.exe'
  }
  return 'ffmpeg'
}

// ============================================================================
// v3.11.9 — Diagnostic des outils de conversion
// La conversion des présentations (soffice + pdftoppm) et la normalisation
// d'images (ffmpeg) échouaient SILENCIEUSEMENT quand un binaire manque sur le
// serveur : l'upload répondait 201, le média n'avait aucune slide et le lecteur
// affichait « Aucune slide convertie » sans explication. Ce diagnostic est
// exposé à l'upload (avertissement) et au dialogue de connexion (§11).
// ============================================================================

// ============================================================================
// v3.11.11 — SONDE FIABILISÉE (fenêtre « installer LibreOffice » récurrente)
// L'ancienne sonde exécutait `soffice.exe --version` / `pdftoppm.exe --version` :
//  - soffice.exe est un binaire GUI Windows : code de sortie et sortie console
//    non fiables (surtout en session de service / juste après installation) ;
//  - pdftoppm n'accepte PAS `--version` (option `-v`) : il le traite comme un
//    nom de fichier et sort en erreur → outils « manquants » pour toujours ;
//  - le résultat était figé au démarrage du CMS (chemin résolu une fois).
// Désormais : un chemin de fichier EXISTANT suffit (même critère que
// install.bat / install-tools.ps1) ; un nom simple est résolu via `where.exe`
// (Windows) ou `command -v` (Unix) — sans exécuter le binaire.
// ============================================================================

export interface ConversionTools {
  soffice: boolean
  pdftoppm: boolean
  ffmpeg: boolean
}

let toolsCache: ConversionTools | null = null
let toolsCacheAt = 0

function probe(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    // 1) Chemin de fichier existant → installé (déterministe, sans exécution)
    if (bin && (bin.includes('/') || bin.includes('\\'))) {
      try { if (existsSync(bin)) { resolve(true); return } } catch { /* ignore */ }
    }
    // 2) Windows : `where.exe` recherche le nom simple dans le PATH
    if (process.platform === 'win32') {
      try {
        execFile('where.exe', [bin], { timeout: 5_000, maxBuffer: 1 * 1024 * 1024 }, (err, stdout) => {
          resolve(!err && String(stdout || '').trim().length > 0)
        })
      } catch {
        resolve(false)
      }
      return
    }
    // 3) Unix : `command -v` (les outils Poppler sortent leur version sur stderr
    //    avec un code non nul — ne JAMAIS tester par exécution de --version)
    try {
      execFile('/bin/sh', ['-c', `command -v ${JSON.stringify(bin)}`], { timeout: 5_000, maxBuffer: 1 * 1024 * 1024 }, (err) => {
        resolve(!err)
      })
    } catch {
      resolve(false)
    }
  })
}

/** Vérifie la disponibilité des binaires de conversion (résultat mis en cache 60 s). */
export async function checkConversionTools(force = false): Promise<ConversionTools> {
  if (!force && toolsCache && Date.now() - toolsCacheAt < 60_000) return toolsCache
  // v3.11.11 — re-résolution à chaque vérification (installation à chaud sans redémarrage)
  SOFFICE_BIN = resolveSoffice()
  PDFTOPPM_BIN = resolvePdftoppm()
  FFMPEG_BIN = resolveFfmpeg()
  const [soffice, pdftoppm, ffmpeg] = await Promise.all([probe(SOFFICE_BIN), probe(PDFTOPPM_BIN), probe(FFMPEG_BIN)])
  toolsCache = { soffice, pdftoppm, ffmpeg }
  toolsCacheAt = Date.now()
  return toolsCache
}

/** Message utilisateur quand la conversion est impossible. */
export function slidesFailureMessage(tools: ConversionTools): string {
  const missing: string[] = []
  if (!tools.soffice) missing.push('LibreOffice (soffice)')
  if (!tools.pdftoppm) missing.push('Poppler (pdftoppm)')
  if (missing.length === 0) {
    return 'La conversion en slides a échoué alors que les outils sont installés — réessayez « Reconvertir » depuis la bibliothèque (détails dans les logs serveur).'
  }
  return `Conversion impossible : ${missing.join(' et ')} manquant${missing.length > 1 ? 's' : ''} sur le serveur. Installez${missing.length > 1 ? '-les' : '-le'} puis utilisez « Reconvertir » dans la bibliothèque.`
}

function runFfmpeg(args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(FFMPEG_BIN, args, { timeout: timeoutMs }, (err) => {
      if (err) reject(err)
      else resolve()
    })
    child.on('error', reject)
  })
}

/**
 * Convertit en PNG une image téléversée dans un format non lisible par les
 * navigateurs (TIFF/TIF/ICO). Retourne le nouveau nom de fichier en cas de
 * succès, ou le nom d'origine si la conversion est impossible (ffmpeg absent
 * ou échec) — l'appelant garde alors le comportement précédent.
 */
export async function convertToBrowserImage(savedFileName: string): Promise<string> {
  const ext = path.extname(savedFileName).toLowerCase()
  if (!BROWSER_IMAGE_EXTS.includes(ext)) return savedFileName

  const src = path.join(UPLOAD_DIR, savedFileName)
  const stem = path.basename(savedFileName).replace(/\.[^.]+$/, '')
  const tmpOut = path.join(UPLOAD_DIR, `${stem}.png`)
  try {
    // Une seule image (les TIFF multipages ne gardent que la première page)
    await runFfmpeg(['-y', '-i', src, '-frames:v', '1', tmpOut], 120_000)
    const stat = await fs.stat(tmpOut).catch(() => null)
    if (!stat || stat.size === 0) return savedFileName
    const finalName = `${stem}.png`
    if (finalName !== savedFileName) await fs.rm(src, { force: true })
    return finalName
  } catch {
    // ffmpeg absent, binaire cassé ou décodage impossible : conserver l'original
    await fs.rm(tmpOut, { force: true }).catch(() => {})
    return savedFileName
  }
}
