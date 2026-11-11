#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
patch-perms-iptv.py — Insère les contrôles de permissions fines (module iptv)
après chaque garde d'authentification des routes /api/iptv/**.

Chaque occurrence de  `if (!_u) return unauthorized()`  est suivie de :
    if (!(await can(_u, 'iptv', '<action>'))) return forbidden()

Actions par handler (ordre d'apparition dans chaque fichier) :
  channels          GET            -> view
  playlists         GET, POST      -> view, create
  playlists/[id]    PATCH, DELETE  -> update, delete
  xtream            GET, POST, DEL -> view, create, delete
  xtream/sync       POST           -> update
  xtream/series-info GET           -> view
"""
import re
import sys

BASE = '/home/z/my-project/src/app/api/iptv'

# fichier -> actions dans l'ordre des handlers
TARGETS = {
    'channels/route.ts': ['view'],
    'playlists/route.ts': ['view', 'create'],
    'playlists/[id]/route.ts': ['update', 'delete'],
    'xtream/route.ts': ['view', 'create', 'delete'],
    'xtream/sync/route.ts': ['update'],
    'xtream/series-info/route.ts': ['view'],
}

GUARD = 'if (!_u) return unauthorized()'


def add_import(src: str) -> str:
    if "from '@/lib/permissions'" in src:
        return src
    anchor = "from '@/lib/auth'"
    idx = src.find(anchor)
    if idx == -1:
        print(f"ERREUR: import @/lib/auth introuvable")
        sys.exit(1)
    eol = src.find('\n', idx)
    imp = "\nimport { can, forbidden } from '@/lib/permissions'"
    return src[:eol] + imp + src[eol:]


def main() -> int:
    for rel, actions in TARGETS.items():
        path = f"{BASE}/{rel}"
        with open(path, 'r', encoding='utf-8') as f:
            src = f.read()

        if 'return forbidden()' in src:
            print(f"SKIP (déjà patché): {rel}")
            continue

        occurrences = src.count(GUARD)
        if occurrences != len(actions):
            print(f"ERREUR: {rel} — {occurrences} gardes trouvées, {len(actions)} attendues")
            return 1

        src = add_import(src)

        parts = src.split(GUARD)
        rebuilt = parts[0]
        for i, action in enumerate(actions):
            rebuilt += (
                GUARD
                + f"\n  if (!(await can(_u, 'iptv', '{action}'))) return forbidden()"
                + parts[i + 1]
            )

        with open(path, 'w', encoding='utf-8') as f:
            f.write(rebuilt)
        print(f"OK {rel}: {', '.join(actions)}")

    return 0


if __name__ == '__main__':
    sys.exit(main())
