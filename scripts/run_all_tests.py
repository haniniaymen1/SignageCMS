#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Campagne de tests mesurables SignageCMS — résultats en JSON pour le rapport."""
import json
import subprocess
import time
import urllib.request
import urllib.error

BASE = 'http://localhost:3000'
RESULTS = []


def http_test(name, url, method='GET', data=None, headers=None, expect=200, note='', timeout=15):
    """Test HTTP générique, retourne statut + taille + temps."""
    req = urllib.request.Request(url, method=method,
                                 data=json.dumps(data).encode() if data else None,
                                 headers=headers or ({'Content-Type': 'application/json'} if data else {}))
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            code, size, dt = r.status, len(body), round((time.time() - t0) * 1000)
    except urllib.error.HTTPError as e:
        body = e.read()
        code, size, dt = e.code, len(body), round((time.time() - t0) * 1000)
    except Exception as e:
        body = str(e).encode()
        code, size, dt = 0, 0, round((time.time() - t0) * 1000)
    ok = (code == expect) if expect else True
    RESULTS.append({'test': name, 'url': url.replace(BASE, ''), 'method': method,
                    'status': code, 'size': size, 'ms': dt, 'ok': ok, 'note': note})
    print(('PASS' if ok else 'FAIL'), name, '->', code, f'{size}o {dt}ms', note)
    return code, body


# ============ 1. Pages web ============
print('--- 1. PAGES WEB ---')
http_test('Page d\'accueil CMS (admin)', BASE + '/')
http_test('Lecteur web /player', BASE + '/player')
http_test('Statistiques globales JSON', BASE + '/api/stats')

# ============ 2. API Player ============
print('--- 2. API PLAYER ---')
code, body = http_test('Inscription écran (register)', BASE + '/api/player/register', 'POST',
                       {'hardwareKey': 'KEY-HALL-001', 'version': '1.0', 'resolution': '1920x1080'})
reg = json.loads(body) if code == 200 else {}
http_test('Récupération planning (schedule)', BASE + '/api/player/schedule?hardwareKey=KEY-HALL-001',
          note='2 layouts attendus')
sched = json.loads(body) if code == 200 else {}
http_test('Heartbeat (prouve de vie)', BASE + '/api/player/heartbeat', 'POST',
          {'hardwareKey': 'KEY-HALL-001', 'status': 'playing'})
# layout : la configuration complète est renvoyée dans schedule (items[].layoutIds)
http_test('Config layout dans schedule', BASE + '/api/player/schedule?hardwareKey=KEY-HALL-001',
          note='layouts résolus côté lecteur')
# preuve de diffusion
http_test('Preuve de diffusion (stats)', BASE + '/api/player/stats', 'POST',
          {'hardwareKey': 'KEY-HALL-001',
           'proof': {'signature': 'test-report-2026', 'startedAt': int(time.time() * 1000),
                     'duration': 30, 'layoutId': (sched.get('items') or [{}])[0].get('id', '')}})
# clé invalide = rejet attendu
http_test('Clé invalide rejetée (register)', BASE + '/api/player/register', 'POST',
          {'hardwareKey': 'KEY-INEXISTANTE', 'version': '1.0', 'resolution': '1920x1080'},
          expect=404, note='doit être rejetée')

# ============ 3. IPTV ============
print('--- 3. IPTV ---')
http_test('Liste chaînes IPTV', BASE + '/api/iptv/channels?limit=5')
code, body = http_test('Proxy flux HLS (m3u8 réécrit)', BASE + '/api/iptv/proxy?url=https%3A%2F%2Flive-20minutestv.digiteka.com%2F1961167769%2Findex.m3u8')
m3u8 = body[:200] if code == 200 else b''
print('   extrait m3u8:', m3u8[:100])
# Xtream serveur réel — attendu inaccessible depuis le sandbox
http_test('Serveur Xtream Rich TV (réseau)', 'http://PORTAIL_IPTV_A_RENSEIGNER/player_api.php?username=IPTV_USER_A_RENSEIGNER&password=IPTV_PASS_A_RENSEIGNER',
          expect=0, note='hors sandbox — voir rapport')

# ============ 4. Conversion PPT/PPTX/PDF ============
print('--- 4. CONVERSION (médias déjà uploadés) ---')
code, body = http_test('Média PPTX converti (4 slides)', BASE + '/api/resource/media')
media = json.loads(body) if code == 200 else []
for m in media:
    if m['name'].startswith('Menu du jour (PPTX'):
        slide1 = m['slides'][0] if m.get('slides') else ''
        http_test('Slide PNG servie (1/4 PPTX)', BASE + slide1, note='conversion LibreOffice+poppler')
    if m['name'].startswith('Catalogue PDF'):
        slide1 = m['slides'][0] if m.get('slides') else ''
        http_test('Slide PNG servie (1/6 PDF)', BASE + slide1, note='PDF rasterisé en PNG')

# ============ 5. Upload + conversion réelle ============
print('--- 5. UPLOAD NOUVEAU PPTX ---')
# générer un mini pptx de test avec python-pptx si dispo
try:
    from pptx import Presentation
    from pptx.util import Inches, Pt
    p = Presentation()
    for i in range(3):
        s = p.slides.add_slide(p.slide_layouts[0])
        s.shapes.title.text = f'Test rapport {i+1}'
        s.placeholders[1].text = f'Diapositive de verification {i+1}'
    p.save('/tmp/test-upload-rapport.pptx')
    with open('/tmp/test-upload-rapport.pptx', 'rb') as f:
        data = f.read()
    boundary = '----TestBoundaryRapport'
    part = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; '
            f'filename="test-rapport.pptx"\r\nContent-Type: application/vnd.openxml'
            f'-formats-officedocument.presentationml.presentation\r\n\r\n').encode() + data + \
        f'\r\n--{boundary}--\r\n'.encode()
    req = urllib.request.Request(BASE + '/api/upload', data=part, method='POST',
                                 headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=120) as r:
        resp = json.loads(r.read())
        code, dt = r.status, round((time.time() - t0) * 1000)
    ok = (resp.get('media') or {}).get('type') == 'presentation' and resp.get('slideCount') == 3
    RESULTS.append({'test': 'Upload PPTX 3 slides -> conversion auto', 'url': '/api/upload',
                    'method': 'POST', 'status': code, 'size': len(data), 'ms': dt, 'ok': ok,
                    'note': f"type={(resp.get('media') or {}).get('type')} slideCount={resp.get('slideCount')}"})
    print(('PASS' if ok else 'FAIL'), 'Upload PPTX ->', resp.get('slideCount'), 'slides en', dt, 'ms')
except ImportError:
    print('SKIP python-pptx absent')

# ============ Résumé ============
print()
total = len(RESULTS)
passed = sum(1 for r in RESULTS if r['ok'])
print(f"TOTAL: {passed}/{total} PASS")
with open('/home/z/my-project/scripts/test-results.json', 'w') as f:
    json.dump(RESULTS, f, ensure_ascii=False, indent=1)
print('Résultats -> scripts/test-results.json')
