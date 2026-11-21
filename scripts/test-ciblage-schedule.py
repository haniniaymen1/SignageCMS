#!/usr/bin/env python3
"""Test E2E du ciblage des événements : tous / groupe / écrans sélectionnés.
Crée 3 événements de test actifs, interroge /api/player/schedule pour 3 profils
d'écrans, vérifie la résolution, puis supprime les événements de test."""
import json
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = 'http://localhost:3000'
ok_all = True
SESSION = {'cookie': ''}

def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {'Content-Type': 'application/json'}
    if SESSION['cookie']:
        headers['Cookie'] = SESSION['cookie']
    r = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    with urllib.request.urlopen(r, timeout=30) as res:
        sc = res.headers.get('set-cookie')
        if sc and 'cms_session=' in sc and not SESSION['cookie']:
            SESSION['cookie'] = sc.split(';')[0]
        return json.loads(res.read().decode())

# Session administrateur (API protégée par authentification)
req('POST', '/api/auth/login', {'username': 'admin', 'password': 'admin123'})
print('Session admin établie pour les tests')

def check(label, cond, detail=''):
    global ok_all
    mark = 'OK ' if cond else 'ECHEC'
    print(f"[{mark}] {label}{(' — ' + detail) if detail else ''}")
    if not cond:
        ok_all = False

# --- Données de référence -------------------------------------------------
displays = req('GET', '/api/resource/displays')
groups = req('GET', '/api/resource/display-groups')
layouts = req('GET', '/api/resource/layouts')
print(f"Écrans: {len(displays)} | Groupes: {len(groups)} | Présentations: {len(layouts)}")

if not displays or not layouts:
    print('Données insuffisantes pour le test'); sys.exit(1)

layout_id = layouts[0]['id']
layout_name = layouts[0]['name']
print(f"Présentation utilisée pour le test : « {layout_name} »")
disp_by_group = {}
for d in displays:
    disp_by_group.setdefault(d.get('groupId'), []).append(d)

gid = groups[0]['id'] if groups else None
in_group = disp_by_group.get(gid, [])
out_group = [d for g, ds in disp_by_group.items() if g != gid for d in ds]
d_in = in_group[0] if in_group else displays[0]
d_out = out_group[0] if out_group else (displays[1] if len(displays) > 1 else d_in)
d_extra = displays[-1]
print(f"Groupe test: {groups[0]['name'] if groups else '(aucun)'} | écran dans groupe: {d_in['name']} | hors groupe: {d_out['name']}")

now = datetime.now(timezone.utc)
start = (now - timedelta(minutes=5)).isoformat()
end = (now + timedelta(hours=2)).isoformat()

# --- Nettoyage d'éventuels anciens événements de test ----------------------
for ev in req('GET', '/api/resource/events'):
    if ev['name'].startswith('TEST-CIBLAGE'):
        req('DELETE', f"/api/resource/events/{ev['id']}")
        print(f"  ancien événement supprimé: {ev['name']}")

# --- Création des 3 événements ---------------------------------------------
e_all = req('POST', '/api/resource/events', {
    'name': 'TEST-CIBLAGE-Tous', 'type': 'layout', 'layoutId': layout_id,
    'targetType': 'all', 'displayGroupId': None, 'displayIds': None,
    'start': start, 'end': end, 'isPriority': False, 'color': '#f97316',
})
check('Création événement "Tous les écrans"', e_all.get('targetType') == 'all' and e_all.get('displayGroupId') is None)

e_grp = None
if gid:
    e_grp = req('POST', '/api/resource/events', {
        'name': 'TEST-CIBLAGE-Groupe', 'type': 'layout', 'layoutId': layout_id,
        'targetType': 'group', 'displayGroupId': gid, 'displayIds': None,
        'start': start, 'end': end, 'isPriority': False, 'color': '#f97316',
    })
    check('Création événement "Par groupe"', e_grp.get('displayGroupId') == gid)

e_disp = req('POST', '/api/resource/events', {
    'name': 'TEST-CIBLAGE-Ecrans', 'type': 'layout', 'layoutId': layout_id,
    'targetType': 'displays', 'displayGroupId': None,
    'displayIds': json.dumps([d_in['id'], d_extra['id']]),
    'start': start, 'end': end, 'isPriority': False, 'color': '#f97316',
})
check('Création événement "Écrans sélectionnés"',
      e_disp.get('targetType') == 'displays' and e_disp.get('displayIds') == json.dumps([d_in['id'], d_extra['id']]))

# --- Résolution côté lecteur -----------------------------------------------
def schedule_ids(key):
    s = req('GET', f'/api/player/schedule?hardwareKey={key}')
    return [it['id'] for it in s.get('items', [])]

names_in = schedule_ids(d_in['hardwareKey'])
check('Écran DANS le groupe voit "Tous les écrans"', e_all['id'] in names_in, f"items={len(names_in)}")
if gid:
    check('Écran DANS le groupe voit événement du groupe', e_grp['id'] in names_in)
check('Écran DANS le groupe et ciblé individuellement voit son événement', e_disp['id'] in names_in)

names_out = schedule_ids(d_out['hardwareKey'])
check('Écran HORS groupe voit "Tous les écrans" (bug corrigé)', e_all['id'] in names_out, f"items={len(names_out)}")
if gid:
    check('Écran HORS groupe ne voit PAS l événement du groupe', e_grp['id'] not in names_out)
check('Écran HORS groupe non ciblé ne voit PAS l événement écrans', e_disp['id'] not in names_out)

names_extra = schedule_ids(d_extra['hardwareKey'])
check('Écran ciblé individuellement voit l événement écrans', e_disp['id'] in names_extra, f"items={len(names_extra)}")

# --- Nettoyage ---------------------------------------------------------------
for ev in (e_all, e_grp, e_disp):
    if ev:
        req('DELETE', f"/api/resource/events/{ev['id']}")
print('Événements de test supprimés.')

print('\nRÉSULTAT:', 'TOUS OK' if ok_all else 'ÉCHECS PRÉSENTS')
sys.exit(0 if ok_all else 1)
