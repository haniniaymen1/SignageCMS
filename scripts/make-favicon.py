#!/usr/bin/env python3
"""Génère les icônes SignageCMS : favicon.ico (16/32/48), apple-touch-icon.png,
icon-192.png — écran orange arrondi + bouton lecture blanc (identité du CMS)."""
from PIL import Image, ImageDraw

OUT = '/home/z/my-project/public'

ORANGE_TOP = (249, 115, 22)    # #f97316
ORANGE_BOT = (234, 88, 12)     # #ea580c
WHITE = (255, 255, 255, 255)
PLAY = (234, 88, 12, 255)


def base(size: int) -> Image.Image:
    s = size
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Fond dégradé vertical orange, coin arrondi
    radius = int(s * 0.22)
    mask = Image.new('L', (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=255)
    grad = Image.new('RGBA', (s, s))
    gd = ImageDraw.Draw(grad)
    for y in range(s):
        t = y / max(1, s - 1)
        c = tuple(int(ORANGE_TOP[i] + (ORANGE_BOT[i] - ORANGE_TOP[i]) * t) for i in range(3)) + (255,)
        gd.line([(0, y), (s, y)], fill=c)
    img.paste(grad, (0, 0), mask)

    u = s / 256.0  # unité
    # Écran (moniteur) blanc
    d.rounded_rectangle([56 * u, 60 * u, 200 * u, 166 * u], radius=int(12 * u), fill=WHITE)
    # Bouton lecture orange centré dans l'écran
    d.polygon([(110 * u, 88 * u), (110 * u, 138 * u), (154 * u, 113 * u)], fill=PLAY)
    # Pied + base
    d.rounded_rectangle([116 * u, 166 * u, 140 * u, 188 * u], radius=int(4 * u), fill=WHITE)
    d.rounded_rectangle([88 * u, 188 * u, 168 * u, 202 * u], radius=int(7 * u), fill=WHITE)
    return img


def main() -> None:
    # favicon.ico multi-résolutions
    base(256).save(f'{OUT}/favicon-256.png')
    base(256).save(f'{OUT}/favicon.ico', format='ICO', sizes=[(16, 16), (32, 32), (48, 48)])
    # apple-touch-icon + icon 192
    base(180).save(f'{OUT}/apple-touch-icon.png')
    base(192).save(f'{OUT}/icon-192.png')
    print('OK icônes générées dans', OUT)


if __name__ == '__main__':
    main()
