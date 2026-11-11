#!/usr/bin/env python3
# ============================================================
# test-timeshift.py — E2E du timeshift du CMS :
#   enregistrement d'une chaîne (tampon disque serveur) +
#   rediffusion décalée sur N écrans — TOUJOURS 1 seule connexion
#   fournisseur. Inclut un test RÉEL de décalage de 60 secondes.
# Portails simulés : mock-iptv-upstream (8997, /live/continuous.ts)
#                    mock-power360 (8998, chaîne 1005)
# ============================================================
import json
import os
import signal
import subprocess
import sys
import time
import urllib.parse
import urllib.request

BASE = 'http://127.0.0.1:3000'
MOCK1 = 'http://127.0.0.1:8997'  # continuous.ts
MOCK2 = 'http://127.0.0.1:8998'  # power360 (1005)
URL_CH1 = MOCK1 + '/live/continuous.ts'
URL_CH2 = MOCK2 + '/live/000000000000/000000000000/1005.ts'

PASS = 0
FAIL = 0
screen_procs = []


def ok(msg):
    global PASS
    PASS += 1
    print(f'PASS - {msg}')


def ko(msg):
    global FAIL
    FAIL += 1
    print(f'FAIL - {msg}')


def http(method, url, token=None, body=None, timeout=40):
    req = urllib.request.Request(url, method=method)
    if token:
        req.add_header('Authorization', f'Bearer {token}')
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, data=data, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode() or '{}')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or '{}')
        except Exception:
            return e.code, {}


def mock1_stats():
    with urllib.request.urlopen(MOCK1 + '/stats', timeout=10) as r:
        return json.loads(r.read().decode())


def mock2_stats():
    with urllib.request.urlopen(MOCK2 + '/stats', timeout=10) as r:
        return json.loads(r.read().decode())


def conns(token):
    _, d = http('GET', BASE + '/api/iptv/connections', token)
    return d


def url_variants(u):
    """Bun réécrit 127.0.0.1 ↔ localhost dans les URLs côté serveur : tester les 2 formes."""
    return {u, u.replace('127.0.0.1', 'localhost'), u.replace('localhost', '127.0.0.1')}


def hub_of(token, url):
    vs = url_variants(url)
    for h in conns(token).get('hubs', []):
        if (h.get('url') or '') in vs or (h.get('source') or '') in vs:
            return h
    return None


def wait_until(fn, timeout, step=0.4):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            if fn():
                return True
        except Exception:
            pass
        time.sleep(step)
    try:
        return fn()
    except Exception:
        return False


def start_screen(url, name):
    path = f'/tmp/timeshift-{name}.ts'
    hdr = f'/tmp/timeshift-{name}.hdr'
    for f in (path, hdr):
        if os.path.exists(f):
            os.remove(f)
    proc = subprocess.Popen(
        ['curl', '-s', '-N', '--max-time', '50', '-D', hdr, '-o', path, url],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    screen_procs.append(proc)
    return proc, path, hdr


def header_value(hdr_path, name):
    try:
        for line in open(hdr_path):
            if line.lower().startswith(name.lower() + ':'):
                return line.split(':', 1)[1].strip()
    except OSError:
        pass
    return None


def file_size(p):
    try:
        return os.path.getsize(p)
    except OSError:
        return 0


def grew(path, seconds=4, min_delta=300000):
    s1 = file_size(path)
    time.sleep(seconds)
    return file_size(path) - s1 >= min_delta


def kill_screens():
    for p in screen_procs:
        try:
            p.send_signal(signal.SIGKILL)
        except Exception:
            pass
    screen_procs.clear()


def stop_hubs(token):
    for h in conns(token).get('hubs', []):
        u = h.get('url') or h.get('source')
        if u:
            http('POST', BASE + '/api/iptv/connections', token, {'url': u})


def proxy(url, delay=0):
    q = f'{BASE}/api/iptv/proxy?url={urllib.parse.quote(url, safe="")}&mode=live'
    if delay:
        q += f'&delay={delay}'
    return q


def main():
    st, d = http('POST', BASE + '/api/auth/login', body={'username': 'admin', 'password': 'admin123'})
    token = d.get('token', '')
    if not (st == 200 and token):
        ko(f'Connexion admin (HTTP {st})')
        return 1
    ok('Connexion admin au CMS')

    # ---------- T0. Démarrage de l'ENREGISTREMENT 60 s sur la chaîne 2 (remplissage en arrière-plan) ----------
    st, d = http('POST', BASE + '/api/iptv/connections', token, {'url': URL_CH2, 'timeshift': 'on'})
    if st == 200 and d.get('ok'):
        ok('Enregistrement timeshift démarré sur la chaîne 2 (sans écran — hub dédié)')
    else:
        ko(f'Démarrage enregistrement (HTTP {st}: {d})')
        return 1
    if mock2_stats()['active_cons'] == 1:
        ok('Enregistrement = 1 connexion fournisseur (chaîne 2), 0 écran connecté')
    else:
        ko(f'Connexions portail chaîne 2 inattendues : {mock2_stats()["active_cons"]}')

    # ---------- T1. Lecture directe chaîne 1 ----------
    p1, f1, h1 = start_screen(proxy(URL_CH1), 'live')
    if not wait_until(lambda: mock1_stats()['open'] == 1, 15):
        ko('Écran 1 : direct non démarré')
        return 1
    ok('Écran 1 : direct en cours (1 connexion fournisseur)')

    # ---------- T2. Enregistrement de la chaîne 1 (hub existant) ----------
    st, d = http('POST', BASE + '/api/iptv/connections', token, {'url': URL_CH1, 'timeshift': 'on'})
    hub = hub_of(token, URL_CH1)
    if st == 200 and hub and hub.get('recording'):
        ok('Enregistrement timeshift activé sur le hub existant (chaîne 1)')
    else:
        ko(f'Enregistrement chaîne 1 (HTTP {st}: {d}, hub={hub})')
    if wait_until(lambda: (hub_of(token, URL_CH1) or {}).get('bufferedSeconds', 0) >= 6, 15):
        ok('Le tampon disque grossit (durée enregistrée ≥ 6 s)')
    else:
        ko('Le tampon disque ne grossit pas')

    # ---------- T3. Écran décalé +6 s sur la chaîne 1 ----------
    p2, f2, h2 = start_screen(proxy(URL_CH1, 6), 'd6')
    ok_delay = wait_until(lambda: header_value(h2, 'x-iptv-delay') == '6', 25)
    ok_data = wait_until(lambda: file_size(f2) > 500000, 25)
    if ok_delay and ok_data:
        ok('Écran décalé +6 s : lecture MPEG-TS décalée (en-tête x-iptv-delay: 6, données reçues)')
    else:
        ko(f'Écran décalé +6 s (en-tête={header_value(h2, "x-iptv-delay")}, données={file_size(f2)} o)')
    if mock1_stats()['open'] == 1:
        ok('Toujours 1 SEULE connexion fournisseur pour direct + écran décalé (partage)')
    else:
        ko(f'Connexions fournisseur : {mock1_stats()["open"]} (attendu 1)')
    hub = hub_of(token, URL_CH1)
    if hub and hub.get('viewers', 0) >= 2 and hub.get('delayedViewers', 0) >= 1:
        ok(f"Hub partagé : {hub['viewers']} écran(s) dont {hub['delayedViewers']} décalé(s)")
    else:
        ko(f'Hub non partagé : {hub}')

    # ---------- T4. Deuxième écran décalé (+10 s) ----------
    p3, f3, h3 = start_screen(proxy(URL_CH1, 10), 'd10')
    wait_until(lambda: header_value(h3, 'x-iptv-delay') == '10', 25)
    time.sleep(3)
    hub = hub_of(token, URL_CH1)
    if mock1_stats()['open'] == 1 and hub and hub.get('viewers', 0) >= 3 and hub.get('delayedViewers', 0) >= 2:
        ok(f"3 écrans (1 direct + 2 décalés) sur la même chaîne = toujours 1 connexion fournisseur ({hub['viewers']} écrans sur le hub)")
    else:
        ko(f'Multi-décalés : open={mock1_stats()["open"]}, hub={hub}')

    # ---------- T5. Arrêt de l'enregistrement refusé tant qu'un écran décalé est actif ----------
    st, d = http('POST', BASE + '/api/iptv/connections', token, {'url': URL_CH1, 'timeshift': 'off'})
    if st == 400:
        ok('Arrêt de l’enregistrement refusé (400) pendant qu’un écran décalé lit le tampon')
    else:
        ko(f'Arrêt enregistrement : HTTP {st} (attendu 400)')

    # ---------- T6. TIMESHIFT RÉEL DE 60 SECONDES (chaîne 2) ----------
    print('\n--- TEST : rediffusion avec un décalage réel de 60 secondes ---')
    if not wait_until(lambda: (hub_of(token, URL_CH2) or {}).get('bufferedSeconds', 0) >= 61, 90, step=1):
        ko(f"Tampon 60 s insuffisant : {(hub_of(token, URL_CH2) or {}).get('bufferedSeconds')} s")
        return 1
    ok(f"Tampon de la chaîne 2 : {hub_of(token, URL_CH2)['bufferedSeconds']} s enregistrées (≥ 60 s)")
    p4, f4, h4 = start_screen(proxy(URL_CH2, 60), 'd60')
    if wait_until(lambda: header_value(h4, 'x-iptv-delay') == '60', 25) and wait_until(lambda: file_size(f4) > 500000, 25):
        ok('Rediffusion +60 s : démarrée (x-iptv-delay: 60, données reçues)')
    else:
        ko(f'Rediffusion +60 s (en-tête={header_value(h4, "x-iptv-delay")}, données={file_size(f4)} o)')
    if grew(f4, 5):
        ok('La rediffusion décalée s’écoule en continu (temps réel)')
    else:
        ko('La rediffusion décalée stagne')
    if mock2_stats()['active_cons'] == 1:
        ok('Chaîne 2 : toujours 1 SEULE connexion fournisseur (enregistrement) malgré l’écran décalé +60 s')
    else:
        ko(f'Chaîne 2 : {mock2_stats()["active_cons"]} connexions fournisseur (attendu 1)')

    # ---------- T7. Nettoyage ----------
    kill_screens()
    stop_hubs(token)
    http('POST', BASE + '/api/iptv/connections', token, {'url': URL_CH2, 'timeshift': 'off'})
    http('POST', BASE + '/api/iptv/connections', token, {'url': URL_CH1, 'timeshift': 'off'})
    time.sleep(2)
    hubs = conns(token).get('hubs', [])
    if not hubs and mock1_stats()['open'] == 0 and mock2_stats()['active_cons'] == 0:
        ok('Nettoyage : 0 hub, 0 connexion fournisseur résiduelle')
    else:
        info = f'hubs={len(hubs)}, mock1={mock1_stats()["open"]}, mock2={mock2_stats()["active_cons"]}'
        ko(f'Nettoyage incomplet : {info}')

    print('\n===============================')
    print(f'RESULTAT: {PASS} PASS / {FAIL} FAIL')
    return 0 if FAIL == 0 else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    finally:
        kill_screens()
