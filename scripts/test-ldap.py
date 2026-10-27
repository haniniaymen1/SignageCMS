#!/usr/bin/env python3
# Tests E2E de l'intégration LDAP (import par OU + authentification) — nécessite :
#  - CMS démarré sur http://127.0.0.1:3000
#  - serveur LDAP fictif scripts/mock-ldap-server.mjs sur le port 1389
import json
import sys

import requests

BASE = 'http://127.0.0.1:3000'
PERSONNEL = 'ou=Personnel,dc=societe,dc=local'
STAGIAIRES = 'ou=Stagiaires,dc=societe,dc=local'
DIRECTION = 'ou=Direction,dc=societe,dc=local'

PASS = 0
FAIL = 0


def check(name, cond, detail=''):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f'PASS  {name}')
    else:
        FAIL += 1
        print(f'FAIL  {name}  {str(detail)[:220]}')


# ---------- T0 : nettoyage (tests rejouables) ----------
r = requests.post(f'{BASE}/api/auth/login', json={'username': 'admin', 'password': 'admin123'})
HA = {'Authorization': f"Bearer {r.json().get('token', '')}"}
rows = requests.get(f'{BASE}/api/resource/users', headers=HA).json()
TEST_LOGINS = {'alice', 'bob', 'carole', 'stagiaire1', 'd.dupont'}
for u in rows if isinstance(rows, list) else []:
    if u.get('username') in TEST_LOGINS or u.get('authProvider') == 'ldap':
        requests.delete(f"{BASE}/api/resource/users/{u['id']}", headers=HA)
# configuration LDAP remise à zéro
requests.put(f'{BASE}/api/ldap', headers=HA, json={
    'enabled': False, 'url': '', 'bindDn': '', 'bindPassword': '',
    'baseDn': '', 'userOu': '', 'defaultRole': 'user', 'disableMissing': False,
})
print('Nettoyage initial effectué')

# ---------- T1 : admin local toujours opérationnel ----------
r = requests.post(f'{BASE}/api/auth/login', json={'username': 'admin', 'password': 'admin123'})
check('T1  admin/admin123 (local) → 200', r.status_code == 200, r.text[:150])
H = {'Authorization': f"Bearer {r.json().get('token', '')}"}

# ---------- T2/T3 : accès à la configuration LDAP ----------
check('T2  GET /api/ldap sans session → 401', requests.get(f'{BASE}/api/ldap').status_code == 401)
r = requests.get(f'{BASE}/api/ldap', headers=H)
check('T3  GET /api/ldap admin → 200', r.status_code == 200, r.text[:150])
cfg0 = r.json().get('config', {})
check('T4  bindPassword jamais renvoyé', cfg0.get('bindPassword') == '' and cfg0.get('hasBindPassword') is False, json.dumps(cfg0)[:150])

# ---------- T5 : réservé aux administrateurs ----------
r = requests.post(f'{BASE}/api/auth/login', json={'username': 'marie.d', 'password': 'marie123'})
check('T5a login marie.d (local) → 200', r.status_code == 200, r.text[:150])
HM = {'Authorization': f"Bearer {r.json().get('token', '')}"}
check('T5b GET /api/ldap non-admin → 403', requests.get(f'{BASE}/api/ldap', headers=HM).status_code == 403)

# ---------- T6 : enregistrement de la configuration (OU = Personnel) ----------
r = requests.put(f'{BASE}/api/ldap', headers=H, json={
    'enabled': True,
    'url': 'ldap://127.0.0.1:1389',
    'bindDn': 'cn=service-lecture,ou=Services,dc=societe,dc=local',
    'bindPassword': 'service-annuaire-2024',
    'baseDn': 'dc=societe,dc=local',
    'userOu': PERSONNEL,
    'userFilter': '(objectClass=person)',
    'usernameAttr': 'uid',
    'emailAttr': 'mail',
    'nameAttr': 'cn',
    'defaultRole': 'user',
    'disableMissing': False,
})
check('T6  PUT /api/ldap (config OU Personnel) → 200', r.status_code == 200, r.text[:150])

# ---------- T7 : test de connexion ----------
r = requests.post(f'{BASE}/api/ldap/test', headers=H, json={'overrides': {}})
d = r.json() if r.headers.get('content-type', '').startswith('application/json') else {}
check('T7  test connexion LDAP → ok:true', r.status_code == 200 and d.get('ok') is True, r.text[:200])

# ---------- T8 : liste des unités d'organisation ----------
r = requests.post(f'{BASE}/api/ldap/ous', headers=H, json={})
dns = [o.get('dn', '') for o in r.json().get('ous', [])] if r.status_code == 200 else []
check(
    'T8  liste OU contient Personnel+Stagiaires+Direction',
    r.status_code == 200 and any('ou=Personnel' in x for x in dns) and any('ou=Stagiaires' in x for x in dns) and any('ou=Direction' in x for x in dns),
    str(dns)[:200],
)

# ---------- T9 : prévisualisation (aucune écriture) ----------
r = requests.post(f'{BASE}/api/ldap/preview', headers=H, json={'ou': PERSONNEL})
users = r.json().get('users', []) if r.status_code == 200 else []
check('T9a preview ou=Personnel → 3 utilisateurs', len(users) == 3, r.text[:200])
check('T9b preview renvoie exists/role/status', all('exists' in u and 'role' in u and 'status' in u for u in users), json.dumps(users[:1])[:150])
check('T9c preview sans session → 401', requests.post(f'{BASE}/api/ldap/preview', json={'ou': PERSONNEL}).status_code == 401)

# ---------- T10 : import de l'OU Personnel ----------
r = requests.post(f'{BASE}/api/ldap/sync', headers=H, json={'ou': PERSONNEL, 'defaultRole': 'user'})
st = r.json().get('stats', {}) if r.status_code == 200 else {}
check('T10 import ou=Personnel → 3 créés', st.get('created') == 3 and st.get('found') == 3, r.text[:200])

# ---------- T11 : comptes en base avec authProvider=ldap ----------
r = requests.get(f'{BASE}/api/resource/users', headers=H)
rows = r.json() if isinstance(r.json(), list) else []
ldap_rows = [u for u in rows if u.get('authProvider') == 'ldap']
check('T11 3 comptes authProvider=ldap en base', len(ldap_rows) == 3, json.dumps([u.get('username') for u in rows])[:150])
check('T11b alice/bob/carole présents', {'alice', 'bob', 'carole'} <= {u.get('username') for u in ldap_rows})
check('T11c DN stockés', all(u.get('ldapDn') for u in ldap_rows))

# ---------- T12 : ré-import idempotent ----------
r = requests.post(f'{BASE}/api/ldap/sync', headers=H, json={'ou': PERSONNEL, 'defaultRole': 'user'})
st = r.json().get('stats', {}) if r.status_code == 200 else {}
check('T12 ré-import → 0 créé, 3 mis à jour', st.get('created') == 0 and st.get('updated') == 3, r.text[:200])

# ---------- T13/T14 : connexion via LDAP ----------
r = requests.post(f'{BASE}/api/auth/login', json={'username': 'alice', 'password': 'alice123'})
check('T13 login alice (mot de passe annuaire) → 200', r.status_code == 200, r.text[:150])
check('T14 login alice mauvais mot de passe → 401', requests.post(f'{BASE}/api/auth/login', json={'username': 'alice', 'password': 'mauvais'}).status_code == 401)

# ---------- T15 : confinement de l'OU (stagiaire1 hors OU configurée, jamais importé) ----------
check('T15 stagiaire1 (hors OU, non importé) → 401', requests.post(f'{BASE}/api/auth/login', json={'username': 'stagiaire1', 'password': 'stage123'}).status_code == 401)

# ---------- T16/T17 : import d'une AUTRE OU + connexion par DN stocké ----------
r = requests.post(f'{BASE}/api/ldap/sync', headers=H, json={'ou': DIRECTION, 'defaultRole': 'user'})
st = r.json().get('stats', {}) if r.status_code == 200 else {}
check('T16 import ou=Direction → 1 créé', st.get('created') == 1, r.text[:200])
r = requests.post(f'{BASE}/api/auth/login', json={'username': 'd.dupont', 'password': 'direction123'})
check('T17 login d.dupont (importé d une autre OU) → 200', r.status_code == 200, r.text[:150])

# ---------- T18 : désactivation des absents (disableMissing) ----------
r = requests.post(f'{BASE}/api/ldap/sync', headers=H, json={'ou': STAGIAIRES, 'disableMissing': True})
st = r.json().get('stats', {}) if r.status_code == 200 else {}
check('T18 sync Stagiaires+disableMissing → 1 créé, 4 désactivés', st.get('created') == 1 and st.get('disabled') == 4, r.text[:200])

# ---------- T19/T20 : effet de la désactivation puis réactivation ----------
r = requests.post(f'{BASE}/api/auth/login', json={'username': 'alice', 'password': 'alice123'})
check('T19 alice désactivée → 403', r.status_code == 403, r.text[:150])
requests.post(f'{BASE}/api/ldap/sync', headers=H, json={'ou': PERSONNEL, 'defaultRole': 'user'})
r = requests.post(f'{BASE}/api/auth/login', json={'username': 'alice', 'password': 'alice123'})
check('T20 alice réactivée après ré-import → 200', r.status_code == 200, r.text[:150])

# ---------- T21 : filtre personnalisé ----------
r = requests.post(f'{BASE}/api/ldap/preview', headers=H, json={'ou': PERSONNEL, 'overrides': {'userFilter': '(uid=alice)'}})
users = r.json().get('users', []) if r.status_code == 200 else []
check('T21 filtre (uid=alice) → 1 seul résultat', len(users) == 1 and users[0].get('username') == 'alice', r.text[:150])

# ---------- T22/T23 : erreurs maîtrisées ----------
r = requests.post(f'{BASE}/api/ldap/test', headers=H, json={'overrides': {'bindPassword': 'mauvais-mot-de-passe'}})
d = r.json() if r.headers.get('content-type', '').startswith('application/json') else {}
check('T22 mauvais compte technique → 502 + message clair', r.status_code == 502 and 'refusés' in d.get('error', ''), r.text[:200])
r = requests.post(f'{BASE}/api/ldap/test', headers=H, json={'overrides': {'url': 'ldap://127.0.0.1:3999'}})
d = r.json() if r.headers.get('content-type', '').startswith('application/json') else {}
check('T23 serveur injoignable → 502 + message clair', r.status_code == 502 and 'injoignable' in d.get('error', ''), r.text[:200])

# ---------- T24/T25 : persistance et masquage du mot de passe ----------
r = requests.get(f'{BASE}/api/ldap', headers=H)
cfg = r.json().get('config', {})
check('T24 hasBindPassword=true après enregistrement', cfg.get('hasBindPassword') is True, json.dumps(cfg)[:120])
r = requests.put(f'{BASE}/api/ldap', headers=H, json={'bindPassword': '\u2022' * 8, 'userOu': PERSONNEL})
cfg2 = r.json().get('config', {})
check('T25 mot de passe masqué non écrasé (hasBindPassword reste true)', cfg2.get('hasBindPassword') is True, r.text[:150])

# ---------- T26 : comptes LDAP sans mot de passe local — badge et rôles ----------
r = requests.get(f'{BASE}/api/resource/users', headers=H)
rows = r.json() if isinstance(r.json(), list) else []
alice_row = next((u for u in rows if u.get('username') == 'alice'), {})
check('T26 compte LDAP : hasPassword=false (jamais de mot de passe local)', alice_row.get('hasPassword') is False, json.dumps(alice_row)[:150])

# ---------- Non-régression ----------
check('R1  /player → 200', requests.get(f'{BASE}/player').status_code == 200)
check('R2  GET /api/resource/layouts (lecteurs) → 200', requests.get(f'{BASE}/api/resource/layouts').status_code == 200)
check('R3  /login → 200', requests.get(f'{BASE}/login').status_code == 200)
check('R4  /api/auth/me sans session → user:null', requests.get(f'{BASE}/api/auth/me').json().get('user') is None)

print(f'\n==== RÉSULTAT : {PASS} PASS / {FAIL} FAIL ====')
sys.exit(1 if FAIL else 0)
