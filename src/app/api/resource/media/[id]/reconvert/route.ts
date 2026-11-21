import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { db } from '@/lib/db'
import { getSessionUser, unauthorized } from '@/lib/auth'
import { can, forbidden } from '@/lib/permissions'
import { convertToSlides, checkConversionTools, slidesFailureMessage } from '@/lib/pptx-convert'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * POST /api/resource/media/[id]/reconvert — v3.11.9
 * Relance la conversion en slides PNG d'un média présentation/PDF déjà
 * téléversé (répare les médias enregistrés SANS slides quand LibreOffice ou
 * Poppler manquaient au moment de l'upload — ou quand la conversion a échoué
 * ponctuellement). Réparable sans re-téléverser le fichier, effet immédiat
 * pour le lecteur web ET l'APK (champ `slides` de la planification).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(req)
  if (!user) return unauthorized()
  if (!(await can(user, 'media', 'edit'))) return forbidden()

  const { id } = await ctx.params
  try {
    const media = await db.media.findUnique({ where: { id } })
    if (!media) return NextResponse.json({ error: 'Média introuvable' }, { status: 404 })
    if (media.type !== 'presentation' && media.type !== 'pdf') {
      return NextResponse.json({ error: 'La reconversion ne concerne que les présentations et les PDF' }, { status: 400 })
    }

    const tools = await checkConversionTools(true)
    if (!tools.soffice || !tools.pdftoppm) {
      return NextResponse.json({ error: slidesFailureMessage(tools) }, { status: 409 })
    }

    const filePath = path.join(process.cwd(), 'public', 'uploads', path.basename(media.fileName || ''))
    try {
      await fs.access(filePath)
    } catch {
      return NextResponse.json({ error: 'Fichier source introuvable sur le serveur — re-téléversez le média' }, { status: 409 })
    }

    const slides = await convertToSlides(path.basename(filePath))
    if (!slides || slides.length === 0) {
      return NextResponse.json(
        { error: 'La conversion n\'a produit aucune slide — le fichier est peut-être illisible ou protégé par un mot de passe' },
        { status: 422 }
      )
    }

    const updated = await db.media.update({ where: { id }, data: { slides } })
    return NextResponse.json({ ok: true, slides: slides.length, media: updated })
  } catch (e) {
    console.error('POST /api/resource/media/[id]/reconvert error:', e)
    return NextResponse.json({ error: 'Erreur serveur pendant la reconversion' }, { status: 500 })
  }
}
