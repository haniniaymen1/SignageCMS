#!/usr/bin/env python3
"""Génère les documents de test pour le rapport : PPTX (4 slides), PPT legacy, PDF (6 pages)."""
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas as pdfcanvas

OUT = "/tmp/testdocs"

# ---------- PPTX 4 slides : "Menu du jour" ----------
prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)

ORANGE = RGBColor(0xF9, 0x73, 0x16)
DARK = RGBColor(0x1E, 0x29, 0x3B)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)

def add_slide(prs, title, lines, bg=DARK, accent=ORANGE):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    # fond
    from pptx.enum.shapes import MSO_SHAPE
    band = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, Inches(1.6))
    band.fill.solid(); band.fill.fore_color.rgb = accent; band.line.fill.background()
    tb = slide.shapes.add_textbox(Inches(0.6), Inches(0.35), Inches(12), Inches(1))
    p = tb.text_frame.paragraphs[0]
    p.text = title; p.alignment = PP_ALIGN.LEFT
    p.font.size = Pt(44); p.font.bold = True; p.font.color.rgb = WHITE
    body = slide.shapes.add_textbox(Inches(0.9), Inches(2.2), Inches(11.5), Inches(4.6))
    tf = body.text_frame; tf.word_wrap = True
    for i, line in enumerate(lines):
        para = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        para.text = line
        para.font.size = Pt(30 if i == 0 else 24)
        para.font.color.rgb = WHITE if i else accent
        para.space_after = Pt(14)
    return slide

add_slide(prs, "Menu du Jour — Lundi", [
    "Entrée : Velouté de potimarron",
    "Plat : Filet de bœuf, pommes grenailles",
    "Dessert : Tarte aux pommes maison",
    "Boisson incluse — Prix : 14,50 €",
])
add_slide(prs, "Menu du Jour — Mardi", [
    "Entrée : Salade de chèvre chaud",
    "Plat : Pavé de saumon, riz basmati",
    "Dessert : Mousse au chocolat",
    "Végétarien sur demande — Prix : 13,90 €",
])
add_slide(prs, "Horaires & Services", [
    "Service de 11 h 30 à 14 h 30",
    "Snack ouvert de 15 h à 18 h",
    "Wi-Fi gratuit — Terrasse couverte",
    "Réservations : poste 204",
])
add_slide(prs, "Bon Appétit !", [
    "Le menu change chaque semaine",
    "Retrouvez-le aussi sur l'écran d'accueil",
    "Equipe restauration Atlantic",
], bg=DARK)
prs.save(f"{OUT}/menu-resto.pptx")

# ---------- PPT legacy ( conversion via soffice : pptx -> ppt ) ----------
prs2 = Presentation()
prs2.slide_width = Inches(13.333); prs2.slide_height = Inches(7.5)
add_slide(prs2, "Affichage Dynamique — Vitrine", [
    "Message d'accueil en boucle",
    "Promotions de la semaine",
    "Flux IPTV en direct",
])
add_slide(prs2, "Promotions — Semaine 42", [
    "-30% sur le rayon électroménager",
    "2 pour 1 : café premium",
    "Fidélité : 100 points offerts",
])
add_slide(prs2, "Horaires Boutique", [
    "Lundi - Samedi : 9 h - 19 h",
    "Nocturne le vendredi jusqu'à 21 h",
])
add_slide(prs2, "Suivez-nous !", [
    "Réseaux sociaux et événements en magasin",
])
prs2.save(f"{OUT}/vitrine-source.pptx")

# ---------- PDF 6 pages : Catalogue ----------
W, H = A4
c = pdfcanvas.Canvas(f"{OUT}/catalogue-produits.pdf", pagesize=A4)
titles = [
    ("Catalogue Produits 2026", "Atlantic Distribution"),
    ("Écran LED 55 pouces", "Résolution 4K UHD - Dalle anti-reflet - Garantie 3 ans\nPrix : 449 € HT"),
    ("Player Android SignageCMS", "Kiosque plein écran - IPTV HLS/TS - Preuves de diffusion\nPrix : 119 € HT"),
    ("Pack Installation", "Montage mural + câblage + configuration CMS incluse\nPrix : 199 € HT"),
    ("Contrat Maintenance", "Supervision 24/7 - Mises à jour CMS - Hotline dédiée\nPrix : 39 € HT / mois"),
    ("Contact", "commercial@atlantic.example - 05 55 00 00 00"),
]
for i, (t, s) in enumerate(titles):
    c.setFillColorRGB(0.98, 0.97, 0.95); c.rect(0, 0, W, H, fill=1, stroke=0)
    c.setFillColorRGB(0.976, 0.451, 0.086); c.rect(0, H-60*mm, W, 30*mm, fill=1, stroke=0)
    c.setFillColorRGB(1, 1, 1); c.setFont("Helvetica-Bold", 30)
    c.drawString(25*mm, H-52*mm, t)
    c.setFillColorRGB(0.12, 0.16, 0.23); c.setFont("Helvetica", 20)
    c.drawString(25*mm, H-85*mm, s.split("\n")[0])
    if "\n" in s:
        c.setFont("Helvetica", 15)
        for j, line in enumerate(s.split("\n")[1:]):
            c.drawString(25*mm, H-100*mm - j*10*mm, line)
    c.setFillColorRGB(0.55, 0.55, 0.55); c.setFont("Helvetica", 10)
    c.drawRightString(W-20*mm, 15*mm, f"Page {i+1} / {len(titles)}")
    c.showPage()
c.save()

import subprocess
# PPT legacy : soffice convertit pptx -> ppt
subprocess.run(["soffice", "--headless", "-env:UserInstallation=file:///tmp/lo-conv2",
                "--convert-to", "ppt", "--outdir", OUT, f"{OUT}/vitrine-source.pptx"],
               check=True, capture_output=True, timeout=120)
import os
os.remove(f"{OUT}/vitrine-source.pptx")
os.rename(f"{OUT}/vitrine-source.ppt".replace("vitrine-source.ppt", "vitrine-source.ppt"), f"{OUT}/vitrine.ppt") if os.path.exists(f"{OUT}/vitrine-source.ppt") else None
print("Fichiers générés :")
for f in sorted(os.listdir(OUT)):
    print(" ", f, os.path.getsize(f"{OUT}/{f}"), "octets")
