# Audit de sécurité — SignageCMS v3.11

**Date :** 25/10/2026 · **Périmètre :** SignageCMS-Serveur v3.10 → v3.11 (code source
`src/`, scripts de déploiement `deploy/windows/`, archive de livraison)
**Méthode :** revue manuelle du code (routes API, bibliothèques d'authentification,
proxys, téléversement, scripts), analyse de la surface d'attaque LAN, puis application
des correctifs et contre-vérification syntaxique.

> Légende gravité : 🔴 Critique · 🟠 Élevée · 🟡 Moyenne · ⚪ Faible/Info

---

## Synthèse

| # | Constat | Gravité | État |
|---|---|---|---|
| C1 | Fuite du secret de signature de session via `/api/resource/settings` | 🔴 Critique | **Corrigé v3.11** |
| C2 | SSRF non authentifié — proxy de pages web | 🔴 Critique | **Corrigé v3.11** |
| C3 | SSRF non authentifié — proxy IPTV | 🔴 Critique | **Corrigé v3.11** |
| C4 | SSRF non authentifié — vérification d'intégrabilité | 🔴 Critique | **Corrigé v3.11** |
| H1 | Compte admin par défaut `admin` / `admin123` | 🟠 Élevée | **Corrigé v3.11** |
| H2 | `.env` développeur + base de données réelle inclus dans l'archive | 🟠 Élevée | **Corrigé v3.11** |
| M1 | Aucune limite de tentatives sur la connexion | 🟡 Moyenne | **Corrigé v3.11** |
| M2 | SVG téléversés servis sans CSP (XSS stocké) | 🟡 Moyenne | **Corrigé v3.11** |
| M3 | En-têtes de sécurité HTTP absents | 🟡 Moyenne | **Corrigé v3.11** |
| M4 | `npm run build` cassé sur Windows (install v3.10) | 🟡 Moyenne | **Corrigé v3.11** |
| M5 | Paramètre `limit` non borné sur les listes | 🟡 Moyenne | **Corrigé v3.11** |
| M6 | `/api/server-info` sans authentification | 🟡 Moyenne | **Corrigé v3.11** |
| L1 | Mot de passe de liaison LDAP stocké en clair en base | ⚪ Faible | Documenté |
| L2 | Lecture `/api/resource/layouts` sans session | ⚪ Faible | Choix assumé (lecteurs) |
| L3 | Médias `/uploads/**` servis sans session | ⚪ Faible | Choix assumé (lecteurs) |
| L4 | Jar de cookies du proxy partagé entre tous les écrans | ⚪ Faible | Documenté |
| L5 | Cookie de session sans attribut `Secure` | ⚪ Faible | Documenté (TLS via Caddy) |

**Bilan v3.11 : 12 constats corrigés, 5 points documentés avec recommandations.
Bonnes pratiques confirmées : hachage scrypt + comparaison à temps constant, sessions
HMAC révocables serveur, échappement des filtres LDAP, masquage du bindPassword,
whitelist d'extensions d'upload, matrice de permissions assainie.**

---

## 1. Constats critiques (corrigés)

### C1 — Fuite du secret de signature de session 🔴

**Constat.** Le secret HMAC des sessions (`authSecret`) est stocké dans la table
`Setting`. L'API générique `GET /api/resource/settings` renvoyait **toutes** les lignes
de cette table à tout utilisateur authentifié disposant du droit *voir* sur le module
Paramètres — or la matrice par défaut accorde ce droit aux rôles « utilisateur » et
« lecture seule ». En récupérant le secret, un tel compte pouvait **calculer
localement des jetons de session administrateur valides** (signature HMAC-SHA256
déterministe) et prendre le contrôle du CMS.

**Correctif (v3.11).**
- Nouvelle liste de paramètres protégés (`authSecret` + tout motif
  `secret/password/token/apikey`) : valeur **masquée** en liste comme en détail ;
- **Création et modification interdites** via l'API (`403 Paramètre système protégé`) ;
- la rotation du secret reste possible côté serveur (suppression de la ligne en base
  → nouveau secret généré → toutes les sessions invalidées).

### C2 / C3 / C4 — SSRF sur les relais serveur 🔴

**Constat.** Trois relais côté serveur acceptaient une URL **publique non
authentifiée** et la récupéraient depuis le serveur : le proxy de pages web
(`/api/webpage/proxy/**`, GET+POST), le proxy IPTV (`/api/iptv/proxy?url=…`) et la
vérification d'intégrabilité (`/api/webpage/embeddable?url=…`). Le seul garde était
une comparaison de chaîne `cible.host == hôte.requête` — **contournable** avec
`127.0.0.1:3000` (au lieu de `localhost:3000`) et inefficace contre les réseaux
internes. Un visiteur du réseau pouvait donc :
- lire des services internes du LAN (imprimantes, hyperviseurs, API internes…) ;
- atteindre les métadonnées cloud (`169.254.169.254`) sur une VM publique ;
- balayer les ports internes via les différences de réponse/latence.

**Correctif (v3.11).** Nouveau module partagé `src/lib/ssrf-guard.ts`
(`validatePublicTarget`) branché sur les **trois** relais :
- protocole http/https uniquement ; identifiants `user:pass@hôte` refusés ;
- adresses IP littérales privées refusées : RFC 1918 (10/8, 172.16/12, 192.168/16),
  boucle 127/8, lien-local 169.254/16 (métadonnées), CGNAT 100.64/10, ULA IPv6
  `fc00::/7`, `fe80::/10`, multicast, documentation ;
- noms d'hôte **résolus par DNS** : si au moins une adresse résolue est privée, la
  cible est refusée (anti-rebinding) — cache 60 s pour ne pas surcharger le DNS ;
- le garde anti-récursion d'origine est conservé.

**Effet de bord assumé :** les pages web **intranet** ne passent plus par le proxy
(une page intranet doit être affichée en iframe direct depuis le lecteur, ou
hébergée comme média). C'est le compromis standard anti-SSRF.

---

## 2. Constats élevés (corrigés)

### H1 — Compte administrateur par défaut connu 🟠

**Constat.** À la première tentative de connexion sur une base vierge, le code
auto-créait le compte `admin` avec le mot de passe **`admin123`** (documenté comme
« défini à la première connexion » alors qu'il était fixe). Sur une installation
exposée, n'importe qui pouvait se connecter avant l'administrateur réel.

**Correctif (v3.11).**
- Sans `ADMIN_DEFAULT_PASSWORD`, un mot de passe **aléatoire de 14 caractères**
  est généré (alphabet sans ambiguïté, ~83 bits) ;
- il est affiché **une fois** dans la console du serveur et écrit dans
  `db/admin-credentials.txt` (droits 0600) ;
- `ADMIN_DEFAULT_PASSWORD` reste supporté pour les installations scriptées ;
- README + LISEZMOI + guide mis à jour : changer le mot de passe puis supprimer le
  fichier d'identifiants.

### H2 — Artefacts de développement dans l'archive 🟠

**Constat.** L'archive v3.10 embarquait (1) le fichier `.env` du poste de
développement avec un chemin Linux (`file:/home/z/my-project/db/custom.db`) — qui
**empêchait l'installation Windows** : `install-cms.bat` voyait un `.env` existant
et ne recréait pas la bonne URL de base ; et (2) la **vraie base de données**
`db/custom.db` (303 Ko : comptes, empreintes de mots de passe, comptes IPTV, journaux).

**Correctif (v3.11).** Archive reconstruite **sans** `.env` ni base ; `.gitignore`
étendu (`db/*.db`, `db/admin-credentials.txt`) ; `install.bat` crée désormais
`.env` avec l'URL **calculée depuis le dossier d'installation réel** (fini le chemin
en dur `C:/SignageCMS`).

---

## 3. Constats moyens (corrigés)

### M1 — Limiteur de tentatives sur la connexion 🟡
En mémoire : **10 échecs / 15 min** par couple identifiant+IP (et 40/15 min par IP
seule) → **429 + `Retry-After`** ; compteur remis à zéro à la réussite. Suffisant en
mono-instance ; recommandation multi-instance : limiteur partagé (Redis).

### M2 — XSS stocké via SVG 🟡
Un SVG téléversé peut embarquer du JavaScript ; servi en `image/svg+xml` sans CSP, il
s'exécutait dans l'origine du CMS. Désormais : `X-Content-Type-Options: nosniff` sur
tous les médias et **CSP `sandbox`** (`default-src 'none'`) sur SVG/HTML/JSON —
l'affichage des images reste intact, les scripts sont neutralisés.

### M3 — En-têtes de sécurité 🟡
Ajoutés via `next.config.ts` : `X-Content-Type-Options: nosniff` (toutes routes),
`Referrer-Policy: strict-origin-when-cross-origin`, et `X-Frame-Options:
SAMEORIGIN` sur l'interface d'administration (anti-clickjacking) — le lecteur
`/player`, les médias et le proxy restent intégrables (mur d'écrans, OBS).

### M4 — Build Windows cassé 🟡
`npm run build` utilisait `cp -r` (Linux) : la construction **échouait sous
Windows** après la compilation. Le script est maintenant cross-platform
(`next build && node scripts/copy-standalone.js`) et de nouveaux **`install.bat` /
`build.bat`** remplacent `install-cms.bat` / `build.ps1` (plus de dépendance à la
stratégie d'exécution PowerShell, journaux dédiés, vérification Node ≥ 20, `.env`
généré avec le bon chemin, codes d'erreur fiables).

### M5 — Paramètre `limit` non borné 🟡
`GET /api/resource/**?limit=` pouvait demander des extractions massives. Borné à
**1..10 000**.

### M6 — `/api/server-info` sans authentification 🟡
La route dévoilait nom d'hôte, IP LAN et port sans session. Elle exige désormais un
utilisateur authentifié (le dialogue « Connecter Android » l'appelle en session).

---

## 4. Points documentés (acceptés, avec recommandations)

| # | Point | Analyse | Recommandation |
|---|---|---|---|
| L1 | `bindPassword` LDAP en clair dans `LdapConfig` | Nécessaire pour le bind ; jamais renvoyé au client (masqué, `hasBindPassword`) | Protéger le fichier `db/custom.db` (droits NTFS, sauvegardes chiffrées) ; préférer `ldaps://` |
| L2 | `GET /api/resource/layouts` sans session | Conception : les lecteurs d'écrans récupèrent leur présentation par clé matérielle, sans compte | Acceptable en LAN ; ajouter la clé matérielle dans la requête si exposition Internet |
| L3 | `/uploads/**` sans session | Même raison ; noms de fichiers aléatoires (horodatage + sémence) | Acceptable en LAN ; derrière un reverse proxy TLS, restreindre par chemin si besoin |
| L4 | Jar de cookies du proxy **partagé** entre écrans | Voulu : tous les écrans affichent le même site avec la même session | Si des sessions distinctes sont nécessaires par écran : évolution à prévoir |
| L5 | Cookie de session sans `Secure` | Incompatible avec un accès LAN en HTTP pur | Déployer le Caddyfile fourni (TLS) pour toute exposition au-delà du LAN ; `SameSite=Lax` + `HttpOnly` déjà actifs |

---

## 5. Bonnes pratiques confirmées lors de l'audit

- **Mots de passe** : scrypt (sel 16 o aléatoire, clé 64 o) + `timingSafeEqual` ;
  révocation des jetons via `tokenValidAfter` (déconnexion, changement de mot de
  passe, réinitialisation par un admin).
- **Sessions** : HMAC-SHA256 signé côté serveur, TTL 7 jours, comparaison à temps
  constant, cookie `HttpOnly` + `SameSite=Lax`.
- **LDAP** : échappement RFC 4515 des filtres (`escapeLdapFilter`), liaison directe
  par DN du compte, compte `admin` local intouchable par la synchronisation,
  validation stricte des champs (liste blanche).
- **API générique** : ressources en liste blanche, sanitisation des comptes
  (hash jamais renvoyé), garde-fous anti-auto-sabotage (impossible de se
  désactiver/dégrader soi-même), permissions par module vérifiées à chaque appel.
- **Téléversement** : whitelist d'extensions, taille max configurable, contrôle
  d'espace disque, noms générés côté serveur, `path.join` + filtrage `..`/`\` sur la
  route de service des fichiers.
- **Proxys** : plafonds de taille (8 Mo HTML / 50 Mo transit), délais d'attente,
  neutralisation des CSP/integrity des pages proxyfiées (voulu pour l'affichage).

## 6. Plan d'action recommandé pour la production

1. **Changer immédiatement** le mot de passe admin initial, supprimer
   `db/admin-credentials.txt` (fait en 2 minutes — voir guide, § 15).
2. **Déployer HTTPS** avec le `Caddyfile` fourni (port 80/443 → 3000) si le CMS est
   accessible au-delà du LAN ; le cookie de session passera alors en `Secure`.
3. **Sauvegarder** `db/custom.db` quotidiennement (fichier unique SQLite : copie à
   chaud acceptée), en dehors du serveur.
4. **Restreindre le pare-feu** aux seuls réseaux des écrans si possible (la règle
   fournie ouvre le 3000 à tout le réseau local).
5. En cas d'exposition Internet : placer le CMS derrière un reverse proxy avec
   limitation de débit supplémentaire et journaux d'accès, et envisager une liste
   blanche IP pour `/login` et `/api/auth/*`.
6. Mettre à jour régulièrement les dépendances (`npm audit` périodique).
