#!/usr/bin/env python3
"""Purge les identifiants réels (portails IPTV, cartes Xtream) des scripts de
développement — remplacés par des espaces réservés. Les identifiants réels
restent uniquement dans la base, gérés via l'interface IPTV du CMS."""
import os
import re

DIR = '/home/z/my-project/scripts'
EXTS = ('.py', '.sh', '.ts', '.mjs', '.js')

# (motif exact, remplacement) — identifiants réels → espaces réservés
REPLACEMENTS = [
    ('IPTV_USER_A_RENSEIGNER', 'IPTV_USER_A_RENSEIGNER'),
    ('IPTV_PASS_A_RENSEIGNER', 'IPTV_PASS_A_RENSEIGNER'),
    ('IPTV_PASS2_A_RENSEIGNER', 'IPTV_PASS2_A_RENSEIGNER'),
    ('MonPortail+', 'MonPortail+'),
    ('MonPortail', 'MonPortail'),
    ('portail-iptv2.example:25461', 'portail-iptv2.example:25461'),
    ('portail-iptv2', 'portail-iptv2'),
    ('portail-iptv1.example', 'portail-iptv1.example'),
    ('portail-xtream.example', 'portail-xtream.example'),
    ('000000000000', '000000000000'),
]

SECRET_PATTERN = re.compile(
    r'IPTV_USER_A_RENSEIGNER|IPTV_PASS_A_RENSEIGNER|IPTV_PASS2_A_RENSEIGNER|000000000000|portail-exemple\.(to|net)|portail-iptv2|g4\.power360\.net'
)


def main() -> None:
    changed = []
    for fn in sorted(os.listdir(DIR)):
        if not fn.endswith(EXTS):
            continue
        path = os.path.join(DIR, fn)
        try:
            with open(path, encoding='utf-8') as f:
                src = f.read()
        except (UnicodeDecodeError, OSError):
            continue
        if not SECRET_PATTERN.search(src):
            continue
        out = src
        for old, new in REPLACEMENTS:
            out = out.replace(old, new)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(out)
        changed.append(fn)
    print('Fichiers purgés:', len(changed))
    for fn in changed:
        print(' -', fn)
    # Vérification finale
    residue = []
    for fn in sorted(os.listdir(DIR)):
        if not fn.endswith(EXTS):
            continue
        try:
            with open(os.path.join(DIR, fn), encoding='utf-8') as f:
                if SECRET_PATTERN.search(f.read()):
                    residue.append(fn)
        except (UnicodeDecodeError, OSError):
            continue
    print('Résidus:', residue if residue else 'AUCUN')


if __name__ == '__main__':
    main()
