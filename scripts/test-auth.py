#!/usr/bin/env python3
"""Tests E2E du système d'authentification SignageCMS.
Couvre : redirection CMS→/login, connexion OK/KO, session cookie, rôles
(admin / utilisateur / lecture seule / désactivé), gestion des mots de passe
(admin + personnel), déconnexion, accès lecteurs sans compte, protection API."""
import json
import sys
import urllib.request
import urllib.error

BASE = 'http://localhost:3000'


def log(*a):
    print(*a, flush=True)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


opener = urllib.request.build_opener(NoRedirect)
results = []


def req(method, path, body=None, cookie=None, form=None):
    url = BASE + path
    data = None
    headers = {}
    if form is not None:
        data = form
    elif body is not None:
        data = json.dumps(body).encode()
        headers['Content-Type'] = 'application/json'
    if cookie:
        headers['Cookie'] = cookie
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        resp = opener.open(r, timeout=30)
        raw = resp.read()
        return resp.status, dict(resp.headers), raw
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()
    except Exception as e:
        return 0, {}, str(e).encode()


def get_cookie(headers):
    # dict(resp.headers) préserve la casse d'origine (Node envoie 'set-cookie' en minuscules)
    for k, v in headers.items():
        if k.lower() == 'set-cookie' and 'cms_session=' in v:
            return v.split(';')[0]
    return None


def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))
    log(('PASS' if cond else 'FAIL') + f' | {name}' + (f' | {detail}' if detail and not cond else ''))


def get_users(cookie):
    """Liste des utilisateurs, ou [] avec diagnostic si réponse inattendue."""
    st, _, body = req('GET', '/api/resource/users', cookie=cookie)
    try:
        data = json.loads(body)
    except Exception:
        log(f'!! GET users status={st} body={body[:200]}')
        return []
    if not isinstance(data, list):
        log(f'!! GET users status={st} reponse inattendue: {str(data)[:200]}')
        return []
    return data


def find_user(cookie, username):
    return next((u['id'] for u in get_users(cookie) if u.get('username') == username), '')


def login(username, password):
    st, hd, body = req('POST', '/api/auth/login', {'username': username, 'password': password})
    return st, get_cookie(hd), body


# ---------- 0. Nettoyage : compte TEST-AUTH éventuel ----------
st, adm, _ = login('admin', 'admin123')
if st == 200 and adm:
    for u in get_users(adm):
        if u.get('username') == 'test.auth':
            req('DELETE', f"/api/resource/users/{u['id']}", cookie=adm)

# ---------- 1. Porte du CMS ----------
st, hd, _ = req('GET', '/')
check('1. / sans session -> redirection /login', st in (302, 307) and '/login' in hd.get('Location', ''), f'status={st} loc={hd.get("Location")}')

st, _, body = req('GET', '/login')
check('2. /login accessible (200)', st == 200 and 'SignageCMS' in body.decode('utf-8', 'ignore'), f'status={st}')

st, _, _ = req('GET', '/api/resource/users')
check('3. API users sans session -> 401', st == 401, f'status={st}')

st, _, _ = req('GET', '/api/stats')
check('4. /api/stats sans session -> 401', st == 401, f'status={st}')

st, _, _ = req('POST', '/api/upload', form=b'')
check('5. /api/upload sans session -> 401', st == 401, f'status={st}')

# ---------- 2. Connexion ----------
st, _, _ = req('POST', '/api/auth/login', {'username': 'admin', 'password': 'mauvais'})
check('6. mauvais mot de passe -> 401', st == 401, f'status={st}')

st, adm, body = login('admin', 'admin123')
check('7. connexion admin/admin123 -> 200 + cookie', st == 200 and bool(adm), f'status={st} cookie={bool(adm)}')

st, _, body = req('GET', '/', cookie=adm)
check('8. / avec session admin -> 200', st == 200, f'status={st}')

st, _, body = req('GET', '/api/resource/users', cookie=adm)
users = json.loads(body) if st == 200 else []
check('9. liste users : 5 comptes, hash jamais expose, hasPassword',
      st == 200 and len(users) == 5 and all('password' not in u and u.get('hasPassword') for u in users),
      f'status={st} n={len(users)}')

# ---------- 3. Rôles ----------
st, paul, _ = login('paul.m', 'paul123')
check("10. connexion lecture seule paul.m -> 200", st == 200, f'status={st}')

st, _, _ = req('GET', '/api/resource/users', cookie=paul)
check('11. lecture seule : lecture users OK', st == 200, f'status={st}')

st, _, _ = req('POST', '/api/resource/user-groups', {'name': 'TEST-INTERDIT'}, cookie=paul)
check('12. lecture seule : ecriture -> 403', st == 403, f'status={st}')

st, marie, _ = login('marie.d', 'marie123')
check('13. connexion utilisateur marie.d -> 200', st == 200, f'status={st}')

st, _, _ = req('POST', '/api/resource/users', {'name': 'X', 'username': 'x', 'email': 'x@x.fr'}, cookie=marie)
check('14. utilisateur standard : creation compte -> 403', st == 403, f'status={st}')

st, _, _ = req('GET', '/api/resource/layouts', cookie=marie)
check('15. utilisateur standard : lecture layouts OK', st == 200, f'status={st}')

st, _, body = login('sophie.b', 'sophie123')
check('16. compte desactive sophie.b -> 403', st == 403, f'status={st}')

# ---------- 4. Gestion des mots de passe par l'admin ----------
st, _, body = req('POST', '/api/resource/users',
                  {'name': 'Test Auth', 'username': 'test.auth', 'email': 'test.auth@signage.local',
                   'role': 'user', 'password': 'test123456'}, cookie=adm)
new_id = ''
try:
    data = json.loads(body)
    new_id = data.get('id', '') if isinstance(data, dict) else ''
    if st != 201:
        log(f'!! creation TEST-AUTH status={st} body={str(body)[:200]}')
except Exception:
    log(f'!! creation TEST-AUTH body={str(body)[:200]}')
check('17. admin cree TEST-AUTH avec mot de passe -> 201', st == 201 and bool(new_id), f'status={st} id={new_id}')

st, _, _ = login('test.auth', 'test123456')
check('18. TEST-AUTH se connecte avec son mot de passe -> 200', st == 200, f'status={st}')

st, _, _ = req('DELETE', f'/api/resource/users/{new_id}', cookie=adm)
check('19. admin supprime TEST-AUTH -> 200', st == 200, f'status={st}')

st, _, _ = login('test.auth', 'test123456')
check('20. TEST-AUTH supprime : connexion -> 401', st == 401, f'status={st}')

paul_id = find_user(adm, 'paul.m')
check('21a. identification de paul.m OK', bool(paul_id), 'paul_id vide')
st, _, _ = req('PUT', f'/api/resource/users/{paul_id}', {'password': 'paul456'}, cookie=adm)
check('21. admin reinitialise le mot de passe de paul -> 200', st == 200, f'status={st}')

st, _, _ = login('paul.m', 'paul456')
check('22. paul se connecte avec le NOUVEAU mot de passe -> 200', st == 200, f'status={st}')

st, _, _ = login('paul.m', 'paul123')
check('23. ANCIEN mot de passe refuse -> 401', st == 401, f'status={st}')

req('PUT', f'/api/resource/users/{paul_id}', {'password': 'paul123'}, cookie=adm)
st, _, _ = login('paul.m', 'paul123')
check('24. remise en etat : paul/paul123 OK', st == 200, f'status={st}')

# ---------- 5. Changement personnel ----------
st, marie, _ = login('marie.d', 'marie123')
st, hd_pwd, body = req('POST', '/api/auth/password', {'current': 'marie123', 'next': 'marie999'}, cookie=marie)
marie_new = get_cookie(hd_pwd) or marie  # le changement renvoie une session fraîche
check('25. changement personnel marie -> 200', st == 200, f'status={st} body={body[:80]}')

st, _, _ = login('marie.d', 'marie999')
check('26. marie se connecte avec le nouveau mot de passe -> 200', st == 200, f'status={st}')

st, _, _ = req('POST', '/api/auth/password', {'current': 'marie123', 'next': 'marie888'}, cookie=marie_new)
check('27. ancien mot de passe exige (current incorrect -> 400)', st == 400, f'status={st}')

marie_id = find_user(adm, 'marie.d')
req('PUT', f'/api/resource/users/{marie_id}', {'password': 'marie123'}, cookie=adm)
st, _, _ = login('marie.d', 'marie123')
check('28. remise en etat marie/marie123 OK', st == 200, f'status={st}')

# ---------- 6. Déconnexion ----------
st, _, _ = req('POST', '/api/auth/logout', cookie=marie)
check('29. logout -> 200', st == 200, f'status={st}')

st, _, _ = req('GET', '/api/resource/users', cookie=marie)
check('30. session terminee -> 401', st == 401, f'status={st}')

# ---------- 7. Accès lecteurs sans compte (inchangé) ----------
st, _, body = req('GET', '/api/resource/layouts')
check('31. lecteur : GET layouts sans session -> 200', st == 200, f'status={st}')

st, _, _ = req('GET', '/player')
check('32. lecteur web /player sans session -> 200', st == 200, f'status={st}')

st, _, _ = req('GET', '/api/iptv/channels')
check('33. API IPTV CMS sans session -> 401', st == 401, f'status={st}')

st, _, _ = req('POST', '/api/player/heartbeat', {'hardwareKey': 'inconnu'})
check('34. API lecteur /api/player/* sans session -> ouverte (200/4xx metier, pas 401)', st != 401, f'status={st}')

# ---------- Résumé ----------
ok = sum(1 for _, c, _ in results if c)
log(f"\n===== RESULTAT : {ok}/{len(results)} PASS =====")
sys.exit(0 if ok == len(results) else 1)
