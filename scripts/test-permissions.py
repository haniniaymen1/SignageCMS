#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test-permissions.py — Tests E2E de la gestion fine des droits par rôle.

Scénarios :
  1. Admin : GET/PUT /api/permissions OK ; un non-admin reçoit 403 sur PUT.
  2. Retrait de « create » sur Écrans pour le rôle user  -> création refusée 403, lecture 200.
  3. Retrait de « view » sur Utilisateurs pour le rôle user -> lecture refusée 403, rétablie -> 200.
  4. Retrait de « view » sur Tableau de bord pour read-only -> /api/stats 403, rétabli -> 200.
  5. Rôle read-only (défauts) : lecture partout OK, écritures 403, IPTV lecture OK / écriture 403.
  6. /api/auth/me expose bien les permissions du rôle.
  7. Rétablissement des défauts -> création à nouveau possible -> nettoyage complet.
"""
import sys
import time

import requests

BASE = 'http://localhost:3000'
HW = f'TEST-PERM-{int(time.time())}'  # clé matérielle unique pour le test
PASS = 0
FAIL = 0


def check(label: str, ok: bool, extra: str = '') -> None:
    global PASS, FAIL
    if ok:
        print(f"  [OK]   {label}")
        PASS += 1
    else:
        print(f"  [FAIL] {label} {extra}")
        FAIL += 1


def login(username: str, password: str) -> requests.Session:
    s = requests.Session()
    r = s.post(f'{BASE}/api/auth/login', json={'username': username, 'password': password}, timeout=15)
    r.raise_for_status()
    return s


def get_matrix(admin: requests.Session) -> dict:
    r = admin.get(f'{BASE}/api/permissions', timeout=15)
    r.raise_for_status()
    return r.json()


def put_matrix(admin: requests.Session, matrix: dict) -> requests.Response:
    return admin.put(f'{BASE}/api/permissions', json={'matrix': matrix}, timeout=15)


def main() -> int:
    global PASS, FAIL
    print('=== Permissions fines par rôle ===')

    # 0) Connexions
    admin = login('admin', 'admin123')
    marie = login('marie.d', 'marie123')      # rôle user
    paul = login('paul.m', 'paul123')         # rôle read-only
    print('  [OK]   connexions admin / marie.d (user) / paul.m (read-only)')
    PASS += 2

    # 1) Matrice accessible
    data = get_matrix(admin)
    mods = {m['id'] for m in data['modules']}
    check('GET /api/permissions (admin)', 'displays' in mods and 'user' in data['matrix'])

    # me expose les permissions du rôle
    me = paul.get(f'{BASE}/api/auth/me', timeout=15).json()
    check('me read-only expose permissions', me.get('permissions', {}).get('displays') == ['view'])

    # 2) Retrait « create » sur Écrans (rôle user)
    r = put_matrix(admin, {'user': {'displays': ['view']}})
    check('PUT matrice (admin)', r.ok, str(r.status_code))
    r = marie.post(f'{BASE}/api/resource/displays', json={'name': 'TEST-PERM'}, timeout=15)
    check('marie création écran refusée (403)', r.status_code == 403, str(r.status_code))
    r = marie.get(f'{BASE}/api/resource/displays', timeout=15)
    check('marie lecture écrans autorisée (200)', r.status_code == 200, str(r.status_code))

    # 3) Retrait « view » sur Utilisateurs (rôle user)
    put_matrix(admin, {'user': {'users': []}})
    r = marie.get(f'{BASE}/api/resource/users', timeout=15)
    check('marie lecture utilisateurs refusée (403)', r.status_code == 403, str(r.status_code))
    put_matrix(admin, {'user': {'users': ['view']}})
    r = marie.get(f'{BASE}/api/resource/users', timeout=15)
    check('marie lecture utilisateurs rétablie (200)', r.status_code == 200, str(r.status_code))

    # Non-admin ne peut pas éditer la matrice
    r = marie.put(f'{BASE}/api/permissions', json={'matrix': {}}, timeout=15)
    check('marie PUT matrice refusé (403)', r.status_code == 403, str(r.status_code))

    # 4) Retrait « view » Tableau de bord (read-only)
    put_matrix(admin, {'read-only': {'dashboard': []}})
    r = paul.get(f'{BASE}/api/stats', timeout=15)
    check('paul stats refusées (403)', r.status_code == 403, str(r.status_code))
    put_matrix(admin, {'read-only': {'dashboard': ['view']}})
    r = paul.get(f'{BASE}/api/stats', timeout=15)
    check('paul stats rétablies (200)', r.status_code == 200, str(r.status_code))

    # 5) Défauts read-only : lecture OK / écritures 403 / IPTV idem
    r = paul.get(f'{BASE}/api/resource/displays', timeout=15)
    check('paul lecture écrans (200)', r.status_code == 200, str(r.status_code))
    r = paul.post(f'{BASE}/api/resource/displays', json={'name': 'TEST-PERM-RO'}, timeout=15)
    check('paul création écran refusée (403)', r.status_code == 403, str(r.status_code))
    r = paul.get(f'{BASE}/api/iptv/channels?take=1', timeout=15)
    check('paul lecture chaînes IPTV (200)', r.status_code == 200, str(r.status_code))
    r = paul.post(f'{BASE}/api/iptv/playlists', json={'name': 'x', 'url': 'http://x'}, timeout=15)
    check('paul création playlist IPTV refusée (403)', r.status_code == 403, str(r.status_code))

    # 6) Rétablissement des défauts puis création + nettoyage
    r = put_matrix(admin, {'user': {}, 'read-only': {}})
    check('rétablissement défauts', r.ok, str(r.status_code))
    r = marie.post(f'{BASE}/api/resource/displays', json={'name': 'TEST-PERM', 'hardwareKey': HW}, timeout=15)
    check('marie création écran rétablie (201)', r.status_code == 201, str(r.status_code))
    if r.status_code == 201:
        did = r.json().get('id')
        rd = admin.delete(f'{BASE}/api/resource/displays/{did}', timeout=15)
        check('nettoyage écran TEST-PERM', rd.ok, str(rd.status_code))

    # 7) Matrice finale = défauts
    data = get_matrix(admin)
    check('matrice finale = défauts (écrans full CRUD)',
          sorted(data['matrix']['user']['displays']) == ['create', 'delete', 'update', 'view'])

    print(f'=== Bilan : {PASS} réussis / {FAIL} échoués ===')
    return 0 if FAIL == 0 else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except requests.RequestException as exc:
        print(f'ERREUR réseau: {exc}')
        sys.exit(2)
