#!/bin/bash
# ============================================================
# delete-m3u-playlist.sh
# Supprime la (ou les) playlist(s) M3U et leurs chaînes via
# l'API du CMS (DELETE /api/iptv/playlists/[id], cascade).
# Arrête d'abord les flux actifs (hubs) pour libérer les
# connexions. Idempotent : si aucune playlist, exit 0.
# ============================================================
set -u
BASE="http://localhost:3000"
PASS=0; FAIL=0

code() { curl -s -o /tmp/pl-out.json -w '%{http_code}' "$@"; }
ok()   { PASS=$((PASS+1)); echo "PASS - $1"; }
ko()   { FAIL=$((FAIL+1)); echo "FAIL - $1"; }

HTTP=$(code -X POST $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}')
TOKEN=$(python3 -c "import json;print(json.load(open('/tmp/pl-out.json')).get('token',''))" 2>/dev/null)
if [ "$HTTP" = "200" ] && [ -n "$TOKEN" ]; then ok "Connexion admin (token Bearer obtenu)"; else ko "Connexion admin (HTTP=$HTTP)"; exit 1; fi
AUTH="Authorization: Bearer $TOKEN"

HTTP=$(code -X GET $BASE/api/iptv/playlists -H "$AUTH")
PLAYLISTS=$(python3 -c "
import json
d = json.load(open('/tmp/pl-out.json'))
pls = d.get('playlists', d if isinstance(d, list) else [])
for p in pls:
    print(p.get('id',''))" 2>/dev/null)
if [ "$HTTP" != "200" ]; then ko "GET /api/iptv/playlists (HTTP=$HTTP)"; exit 1; fi
N_BEFORE=$(echo "$PLAYLISTS" | grep -c . || true)
ok "Playlists avant : $N_BEFORE"

HTTP=$(code -X GET $BASE/api/iptv/connections -H "$AUTH")
if [ "$HTTP" = "200" ]; then
  HUB_URLS=$(python3 -c "
import json
d = json.load(open('/tmp/pl-out.json'))
for h in d.get('hubs', []):
    print(h.get('url') or h.get('source') or '')" 2>/dev/null)
  N=0
  for U in $HUB_URLS; do
    [ -z "$U" ] && continue
    curl -s -X POST $BASE/api/iptv/connections -H "$AUTH" -H 'Content-Type: application/json' -d "{\"url\":\"$U\"}" >/dev/null
    N=$((N+1))
  done
  ok "Flux actifs arrêtés : $N hub(s)"
else
  ko "GET /api/iptv/connections (HTTP=$HTTP)"
fi

DELETED=0
for ID in $PLAYLISTS; do
  [ -z "$ID" ] && continue
  HTTP=$(code -X DELETE "$BASE/api/iptv/playlists/$ID" -H "$AUTH")
  if [ "$HTTP" = "200" ]; then DELETED=$((DELETED+1)); ok "DELETE playlist $ID -> HTTP 200"; else ko "DELETE playlist $ID (HTTP=$HTTP): $(cat /tmp/pl-out.json)"; fi
done
[ "$N_BEFORE" = "0" ] && ok "Aucune playlist à supprimer (déjà vide)"

HTTP=$(code -X GET $BASE/api/iptv/playlists -H "$AUTH")
N_AFTER=$(python3 -c "
import json
d = json.load(open('/tmp/pl-out.json'))
pls = d.get('playlists', d if isinstance(d, list) else [])
print(len(pls))" 2>/dev/null)
if [ "$HTTP" = "200" ] && [ "$N_AFTER" = "0" ]; then ok "API : 0 playlist restante"; else ko "API playlists restantes = $N_AFTER (HTTP=$HTTP)"; fi

python3 - <<'PYEOF'
import sqlite3, sys
con = sqlite3.connect('/home/z/my-project/db/custom.db')
cur = con.cursor()
pls = cur.execute('SELECT COUNT(*) FROM IptvPlaylist').fetchone()[0]
ch  = cur.execute('SELECT COUNT(*) FROM IptvChannel').fetchone()[0]
prov = cur.execute('SELECT COUNT(*) FROM IptvProvider').fetchone()[0]
con.close()
errors = []
if pls != 0: errors.append(f'{pls} playlist(s) restante(s)')
if ch != 0:  errors.append(f'{ch} chaîne(s) restante(s)')
print(f'BASE: playlists={pls} | chaines_total={ch} | comptes={prov}')
if errors:
    print('FAIL - Base: ' + '; '.join(errors)); sys.exit(1)
print('PASS - Base vide : plus aucune playlist ni chaîne M3U')
PYEOF
[ $? -eq 0 ] && PASS=$((PASS+1)) || FAIL=$((FAIL+1))

echo "==============================="
echo "RESULTAT: $PASS PASS / $FAIL FAIL"
[ $FAIL -eq 0 ]
