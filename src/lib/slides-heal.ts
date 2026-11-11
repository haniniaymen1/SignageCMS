/**
 * v3.11.9 — Auto-réparation des présentations sans slides.
 *
 * Problème : sur un serveur où LibreOffice/pdftoppm manquaient (ou en cas
 * d'échec ponctuel), les médias de type présentation/PDF ont été enregistrés
 * SANS slides : le lecteur web ET l'APK affichent « Aucune slide convertie »
 * et il fallait re-téléverser le fichier après correction du serveur.
 *
 * Solution : quand un layout servi au lecteur contient un média présentation
 * sans slides, la conversion est relancée EN ARRIÈRE-PLAN (sans bloquer la
 * réponse). Au prochain rafraîchissement de planification (60 s), le lecteur
 * reçoit les slides — aucun re-upload, aucun clic, web ET APK réparés.
 *
 * Garde-fou : une seule tentative par média toutes les 10 minutes (en mémoire)
 * pour ne pas relancer soffice en boucle si le fichier est réellement
 * illisible ou si un binaire manque toujours.
 */
import { db } from '@/lib/db'
import { convertToSlides, checkConversionTools } from '@/lib/pptx-convert'

const HEALABLE_TYPES = new Set(['presentation', 'pdf'])
const THROTTLE_MS = 10 * 60 * 1000

const attempts = new Map<string, number>()

/** Extrait la liste de slides d'un média (champ JSON stringifié ou tableau). */
export function parseSlidesField(slides: unknown): string[] {
  if (!slides) return []
  try {
    const raw = typeof slides === 'string' ? JSON.parse(slides) : slides
    return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string' && s.length > 0) : []
  } catch {
    return []
  }
}

/**
 * Relance si nécessaire la conversion en slides d'un média, en arrière-plan.
 * @returns true si une tentative vient d'être déclenchée.
 */
export function maybeHealSlidesInBackground(media: {
  id: string
  type: string
  fileName?: string | null
  slides?: unknown
}): boolean {
  if (!media || !HEALABLE_TYPES.has(media.type)) return false
  if (parseSlidesField(media.slides).length > 0) return false
  if (!media.fileName) return false

  const last = attempts.get(media.id) ?? 0
  if (Date.now() - last < THROTTLE_MS) return false
  attempts.set(media.id, Date.now())

  void (async () => {
    try {
      const tools = await checkConversionTools()
      if (!tools.soffice || !tools.pdftoppm) {
        console.warn(`[slides-heal] ${media.id} : outils de conversion manquants (soffice=${tools.soffice} pdftoppm=${tools.pdftoppm}) — installez LibreOffice + Poppler sur le serveur`)
        return
      }
      console.log(`[slides-heal] reconversion en arrière-plan de ${media.fileName}`)
      const slides = await convertToSlides(media.fileName)
      if (slides && slides.length > 0) {
        await db.media.update({ where: { id: media.id }, data: { slides } })
        console.log(`[slides-heal] ${media.fileName} : ${slides.length} slides régénérées ✓`)
      } else {
        console.warn(`[slides-heal] ${media.fileName} : conversion sans résultat (fichier illisible ?)`)
      }
    } catch (e) {
      console.error(`[slides-heal] échec de reconversion pour ${media.fileName}:`, e)
    }
  })()

  return true
}

/** Parcourt un layout servi au lecteur et déclenche les réparations utiles. */
export function healLayoutSlidesInBackground(layout: {
  regions?: Array<{ widgets?: Array<{ media?: { id: string; type: string; fileName?: string | null; slides?: unknown } | null } | null> | null }> | null
}): number {
  let triggered = 0
  for (const region of layout?.regions ?? []) {
    for (const widget of region?.widgets ?? []) {
      if (widget?.media && maybeHealSlidesInBackground(widget.media)) triggered++
    }
  }
  return triggered
}
