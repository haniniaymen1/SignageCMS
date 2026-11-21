# Historique des versions — SignageCMS

> Numérotation alignée sur le suivi client : la version livrée le 23/10/2026 était la **v3.5** ;
> la version **v3.6** (24/10/2026) applique la totalité des 25 points du cahier des charges ;
> la version **v3.7** (24/10/2026) corrige en profondeur les pages web interactives (§5 / §25) ;
> la version **v3.10** (25/10/2026) livre la boucle ON/OFF **par événement** (§16), le dialogue
> « Connecter Android » sans zone perdue sur petits écrans (§10) et les lanes de calendrier (§24).

### Correspondance de numérotation et écart assumé

| Suivi client | Interne | Contenu livré |
|--------------|---------|---------------|
| v2.1 | v2.1 | Lecteur Android SignageCMS Player (APK) |
| v2.2 → v2.6 | v2.2 → v2.6 | Itérations correctives (APK, IPTV, web) |
| v2.7 | v2.7 | Restauration /api/upload + conversion PPTX |
| **v3.5** | (2.8) | Confidentialité : traces de développement, favicon, données personnelles |
| **v3.6** | v3.6 | Conformité complète au cahier des charges (25 points) |
| **v3.7** | v3.7 | Pages web réellement interactives : proxy intégré (§5/§25) + WebView APK enrichi (§8) |
| **v3.8** | v3.8 | Boucle ON/OFF **par événement** (§16) — remplace le switch global (audit 58/58 PASS) |
| **v3.10** | v3.10 | Consolidation : boucle par événement + dialogues scrollables (§10) + lanes calendrier (§24) + vérifications §22/§25 |
| **v3.11** | v3.11 | **Sécurité et industrialisation** : audit complet (12 correctifs), nouveaux scripts `install.bat`/`build.bat`, guide d'utilisation complet |
| **v3.11.1** | v3.11.1 | **Correctif sécurité** : masquage de `authSecret` réellement effectif (bug de casse dans le filtre v3.11) |
| **v3.11.2** | v3.11.2 | **Correctif aperçu** : `ALLOW_FRAME_EMBED=1` rend l'interface intégrable en iframe (panneaux d'aperçu, portails) — protection anti-clickjacking conservée par défaut |
| **v3.11.3** | v3.11.3 | **Téléversement en streaming** : gros fichiers (400 Mo+) sans saturation mémoire — l'ancienne route tuait le serveur (OOM) |
| **v3.11.4** | v3.11.4 | **Cosmétique bibliothèque** : le dialogue de téléversement affiche la vraie limite (setting `maxUploadSize`, ex. 500 Mo) au lieu du « max 50 Mo » codé en dur |
| **v3.11.5** | v3.11.5 | **Compatibilité médias** : TIFF/TIF/ICO convertis en PNG à l'upload (ffmpeg), replis élégants lecteur web, APK v2.3.1 (carrousel PowerPoint/PDF) |
| **v3.11.6** | v3.11.6 | **Correctif hydratation** : page de connexion — le bouton « Ouvrir dans un nouvel onglet » n'est plus rendu différemment entre serveur et client (détection iframe après montage) |
| **v3.11.7** | v3.11.7 | **IPTV complète lecteur web** : lecture MPEG-DASH (`.mpd`) via dash.js — même couverture que l'APK (VLC) ; message d'upload affiche enfin tous les formats acceptés (ico, tiff, tif, mpg, mpeg, 3gp, ts, flac) |
| **v3.11.8** | v3.11.8 | **Dialogue « Connecter Android » sans défilement** : fenêtre adaptée à la fenêtre — URLs longues sécables (fin du débordement horizontal), layout compacté (QR 100px, marges réduites, étapes 13px) — tout tient sans scroll de 576×855 à 1280×800 |
| **v3.11.9** | v3.11.9 | **PowerPoint réparé de bout en bout** : auto-reconversion en arrière-plan quand un layout servi au lecteur contient une présentation sans slides ; endpoint + bouton « Reconvertir » dans la bibliothèque ; badge « Non converti » ; avertissement explicite à l'upload (outil manquant) ; diagnostic soffice/pdftoppm/ffmpeg dans /api/server-info — corrige le cas « Aucune slide convertie » sans re-téléverser, web ET APK. **Enrichissement v3.11.9 (installateurs intégrés)** : LibreOffice + Poppler désormais **téléchargés et installés automatiquement** par l'installateur du serveur, Windows ET Linux — `deploy\windows\install-tools.bat` (MSI officiel documentfoundation.org + ZIP Poppler GitHub, sans winget/choco, appelé par `install.bat`), `deploy/linux/install-tools.sh` (apt/dnf/yum/zypper/pacman/apk + repli archive TDF sans root), avertissement console au démarrage du serveur si un outil manque |
| **v3.11.16** | v3.11.16 | **Correctif groupes d'écrans + option interface** : la création/modification de groupe d'écrans échouait (« Enregistrement impossible », champ `description` absent du modèle `DisplayGroup`) — corrigé en base (migration additive sans perte) ; nouvelle option **« Section Playlists »** dans Paramètres → Général (masque le menu et la carte du tableau de bord, réversible, données conservées) |
| **v3.11.17** | v3.11.17 | **Correctif emplacement `admin-credentials.txt` + scripts de réinitialisation** : en production (standalone), le fichier des identifiants initiaux était écrit dans `.next/standalone/db/` au lieu du `db/` documenté — désormais ancré à côté de la base (DATABASE_URL) ; nouveaux scripts `deploy\windows\reset-admin.bat` et `deploy/linux/reset-admin.sh` pour retrouver l'accès admin en cas de mot de passe perdu |

**Écart assumé :** les numéros **2.9 à 3.4 n'ont jamais été publiés** — aucun livrable ne les porte.

## v3.11.17 — Emplacement de `admin-credentials.txt` corrigé + scripts de réinitialisation admin

**Constat :** « db/admin-credentials.txt n'existe pas » sur une installation Windows en
production. Deux causes distinctes :

1. **Emplacement réel déplacé** : le `server.js` standalone généré par Next.js exécute
   `process.chdir(__dirname)` au démarrage — `process.cwd()` pointe donc vers
   `.next/standalone`, et le fichier des identifiants initiaux était écrit dans
   **`.next/standalone/db/admin-credentials.txt`** au lieu du `db/admin-credentials.txt`
   documenté par le guide et affiché dans le message console.
2. **Le fichier n'est créé qu'à la (re)création du compte admin** : la régénération
   automatique ne se déclenche que lorsqu'aucun admin actif n'existe en base, lors d'un
   essai de connexion. Sur une mise à jour qui conserve la base et le compte admin, le
   fichier n'apparaît jamais — c'est normal.

**Correctif :** la fonction `writeAdminCredentials` ancre désormais le fichier à côté de
la base dérivée de `DATABASE_URL` (`file:<chemin absolu>` posé par install.bat / install.sh)
→ le fichier rejoint bien **`db/admin-credentials.txt`**, à côté de `custom.db`, quelle que
soit la manière dont le serveur est lancé. Aucun changement de schéma, aucun impact
fonctionnel au-delà du chemin d'écriture.

**Nouveaux scripts de réinitialisation :**

- `deploy/windows/reset-admin.bat` (double-clic, confirmation OUI) ;
- `deploy/linux/reset-admin.sh` (`sudo bash deploy/linux/reset-admin.sh`).

Ils suppriment le compte admin de la base via `npx prisma db execute` : au prochain essai
de connexion, le serveur recrée le compte avec un mot de passe aléatoire affiché dans la
console et écrit dans `db/admin-credentials.txt`. Procédure de secours documentée au
chapitre 5 et à la table de dépannage du guide.

**Procédure de mise à jour :** remplacer les fichiers, `npm install`, puis recompiler
(`build.bat`) — le client Prisma embarqué dans `.next/standalone` impose une recompilation.
Pas de `db push` requis (aucun changement de schéma).

## v3.11.16 — Groupes d'écrans réparés + option « Section Playlists »

**Correctif bloquant :** le formulaire « Nouveau groupe d'écrans » envoie un champ
`description` que le modèle Prisma `DisplayGroup` n'avait pas → `PrismaClientValidationError`
(argument inconnu) → HTTP 400 « Création impossible » → toast « Erreur – Enregistrement
impossible ». La **création ET la modification** de groupes étaient cassées sur toutes les
installations (les routes `/api/resource` passent le corps brut à Prisma). Correctif :
`description String?` ajouté au modèle — migration 100 % additive (`npx prisma db push`),
aucune perte de données, aucun changement de code nécessaire.

**Nouveau :** option **« Section Playlists »** (Paramètres → Général) : masque le menu
Playlists et sa carte du tableau de bord pour les administrateurs — réversible, les données
restent en base et servables. Pour les comptes non-administrateurs, le masquage individuel
reste assuré par *Rôles & droits* (permission « view » du module).

## v3.11.9 — PowerPoint « Aucune slide convertie » : diagnostic, auto-réparation, reconvertir

**Constat utilisateur :** le lecteur (web comme APK v2.4) affichait « Aucune slide
convertie » pour une présentation pourtant bien téléversée. Cause racine : la
conversion PPT/PPTX → PNG (`soffice --headless` puis `pdftoppm`) avait échoué
**silencieusement à l'upload** (binaire absent sur le serveur de déploiement, ou
échec ponctuel) : la réponse HTTP restait 201, le média était enregistré sans
champ `slides`, et rien ne permettait de le réparer sans re-téléverser.

**Correctifs (serveur seul — l'APK v2.4 n'a pas changé, il lit déjà le champ
`slides` de la planification) :**
1. **Auto-réparation** (`src/lib/slides-heal.ts`) : quand un layout servi au
   lecteur (`GET /api/resource/layouts/[id]`) contient un média présentation/PDF
   sans slides, la conversion est relancée **en arrière-plan** (non bloquant,
   throttlée à 1 tentative / 10 min / média) ; au prochain rafraîchissement de
   planification (60 s) le lecteur reçoit les slides.
2. **POST /api/resource/media/[id]/reconvert** : reconversion manuelle d'un
   média existant (messages clairs : outil manquant 409, fichier absent 409,
   fichier illisible/protégé 422).
3. **Upload non silencieux** : si aucune slide n'est produite, la réponse
   embarque `slidesWarning` (binaire manquant, installation à faire) et la
   bibliothèque affiche un toast d'erreur détaillé.
4. **UI bibliothèque** : badge ambre « Non converti » sur les présentations/PDF
   vides + bouton « Reconvertir » (icône RefreshCw, spinner pendant la tâche).
5. **Diagnostic** : `checkConversionTools()` (sonde corrigée — `pdftoppm`
   affiche sa version sur stderr et sort avec le code 1, la détection passe
   désormais par `command -v` sous Unix) exposé dans `/api/server-info`
   (`tools: {soffice, pdftoppm, ffmpeg}`) et repris dans les messages d'erreur.

**Vérifié de bout en bout** : upload PPTX → 2 slides ; mise en échec simulée
(`slides=null`) → premier GET layout (heal déclenché) → 14 s après, 2 slides
régénérées en base ; endpoint reconvert → `{ok:true, slides:2}` ; lecteur web
affiche le carrousel (slide 2 visible, plus aucun message d'erreur).

## v3.11.8 — Dialogue « Connecter Android » adapté à la fenêtre (sans défilement)

**Problème :** dans le dialogue « Connecter **Vitrine Boutique** depuis Android »,
le contenu débordait de la fenêtre : les URL longues (`https://preview-chat-…`,
adresse du serveur CMS dans l'étape 3) étaient **non sécables** à l'intérieur des
`<code>` et poussaient tout le dialogue en **scroll horizontal** (texte coupé à
droite, onglet « Navigateur kiosque » tronqué) ; verticalement, les 6 étapes de
l'onglet « App APK » dépassaient de la hauteur visible sur une fenêtre ~576×855.

**Correctif :** `android-connect-dialog.tsx` réorganisé —
1. `[overflow-wrap:anywhere]` sur le conteneur (propriété héritée) : toutes les
   URL/codes longs se coupent proprement, plus aucun débordement horizontal ;
2. largeur/hauteur liées à la fenêtre (`w-[calc(100vw-1rem)]`,
   `max-h-[calc(100dvh-1rem)]`) avec repli de défilement pour les très petits écrans ;
3. layout compacté : QR 116→100 px (ligne horizontale sur mobile), en-tête et
   avertissement amber resserrés, champs `py-1.5`, étapes en 13 px
   `leading-snug` `space-y-1`, onglets `h-auto px-1 py-1.5`.

**Vérifié au navigateur** (Playwright) : onglet « App APK » (6 étapes),
« Navigateur kiosque » (4) et « Étapes » — `scrollHeight == clientHeight`
à **576×855** (fenêtre de l'utilisateur) comme à **1280×800** : aucun défilement.

## v3.11.7 — Vérification médias complète + DASH (.mpd) au lecteur web

**Contexte :** vérification exhaustive demandée — photos, vidéos, PowerPoint
et IPTV avec toutes leurs extensions, sur le lecteur web ET l'APK. La matrice
images/vidéos/présentations était déjà couverte (v3.11.5) ; le seul manque
fonctionnel trouvé côté web était le **MPEG-DASH** : une URL `.mpd` tombait
dans le cas « lecture directe `<video>` », que Chromium ne sait pas décoder
(alors que l'APK la lit via son repli VLC).

**Correctif :** `dashjs` (officiel DASH-IF) chargé dynamiquement comme
`mpegts.js` — `detectStreamKind` reconnaît `.mpd`, le lecteur lit les
segments directement chez le CDN (CORS exigé par la spécification DASH).
Le hub timeshift (`stream-hub.ts`) suit désormais les **playlists master**
(`#EXT-X-STREAM-INF` → première variante) : auparavant le texte de la
variante était enregistré dans le tampon TS comme s'il s'agissait de
MPEG-TS — timeshift illisible sur les panels/CDN diffusant un master
(cas Xtream fréquent). Message d'erreur upload aligné sur la liste réelle
des formats acceptés. Note : le paquet npm `dash.js` (avec point) est un
homonyme sans rapport — c'est bien `dashjs` qui est utilisé.

## v3.11.6 — Erreur d'hydratation sur la page de connexion

**Problème :** React signalait « Hydration failed because the server rendered
HTML didn't match the client » sur `/login` : le bouton « Ouvrir dans un
nouvel onglet » était rendu côté client mais absent du HTML serveur. La cause
était l'initialisation `useState(() => typeof window !== 'undefined' &&
window.self !== window.top)` — c'est exactement la branche
serveur/client listée par la documentation React : en SSR `window` n'existe
pas (bouton non rendu), à l'hydratation dans l'iframe d'aperçu `window`
existe (bouton rendu) → arbre divergent, régénération côté client.

**Correctif :** initialisation déterministe `useState(false)` (identique
serveur/client), puis détection réelle de l'iframe dans un `useEffect` après
le montage (`window.self !== window.top`, avec repli `true` si l'accès
inter-origine lève une SecurityError). Le bouton apparaît une fraction de
seconde après le rendu — même comportement pour l'utilisateur, mais l'arbre
rendu par le serveur correspond désormais au premier rendu client.

## v3.11.4 — Limite de téléversement affichée dynamiquement

**Problème :** le dialogue « Téléverser un média » affichait un texte codé en
dur « max 50 Mo » alors que la limite réelle est le setting `maxUploadSize`
(passée à 500 Mo en v3.11.3) — message trompeur pour l'utilisateur.

**Correctif :** `media-library.tsx` récupère désormais la valeur réelle du
setting au chargement (`GET /api/resource/settings`) et affiche
« max N Mo (réglable dans Paramètres) ». Repli gracieux : 500 Mo si le
setting est absent, texte inchangé si la lecture échoue (droits limités).

**Validation :** dialogue affiche « max 500 Mo (réglable dans Paramètres) » ;
téléversement PPTX de bout en bout via l'interface re-testé OK (3 slides).

## v3.11.5 — Compatibilité médias : TIFF/ICO + replis lecteur web + APK v2.3.1

**Campagne de test** : grille de 25 médias (10 images, 10 vidéos, 5 présentations)
diffusée sur le lecteur web `/player` avec assertions automatisées, plus audit
statique de l'APK Android v2.3.

**Constatations :**
- **Lecteur web** : PNG/JPG/JPEG/GIF/WEBP/SVG/BMP/ICO et MP4/WEBM/MOV/MKV/M4V
  s'affichent ; **TIFF/TIF cassés** (icône navigateur) et **AVI/MPG/MPEG/3GP/TS
  en rectangle noir** (conteneurs non décodés par Chromium).
- **APK v2.3** : les widgets « presentation »/« pdf » n'existaient pas — le
  lecteur affichait le nom du widget en texte ; TIFF/ICO non décodés par
  BitmapFactory ; GIF en image fixe ; tout le reste joué via ExoPlayer avec
  repli VLC automatique (AVI/MPG/TS/3GP inclus).

**Correctifs serveur :**
- `pptx-convert.ts` : `convertToBrowserImage()` — TIFF/TIF/ICO convertis en PNG
  à l'upload via ffmpeg (`FFMPEG_PATH`, candidats Windows usuels, sinon PATH) ;
  sans ffmpeg, fichier d'origine conservé.
- `upload/route.ts` : conversion appliquée avant l'enregistrement (nom de
  fichier + URL mis à jour).
- `widget-renderer.tsx` : replis élégants — image non décodable → carte
  explicative ; vidéo non décodable → carte explicative avec conseil
  (convertir en MP4/H.264 ou utiliser le lecteur Android).

**Correctif APK (v2.3.1)** : ajout du support des widgets « presentation » et
« pdf » — les slides PNG du CMS sont désormais affichées en carrousel natif
(`SlideshowView`, rotation au `duration` du widget, min. 5 s/slide, Coil +
crossfade, fond noir, FIT_CENTER). Correctif de rotation v2.3 conservé.

**Validation :** TIFF re-téléversé → servi en PNG ; carrousels PPT/PPTX/PPS/
PPSX/ODP rendus sur le lecteur web ; APK signé (v1/v2/v3) et dex vérifié par
baksmali aller-retour.

## v3.11 — Sécurité, scripts Windows et documentation

**Objet :** durcissement de sécurité à la suite d'un audit complet du code, refonte
des scripts d'installation Windows et livraison d'une documentation utilisateur.

### Sécurité — correctifs appliqués (détail dans `AUDIT-SECURITE.md`)
- **C1 — Secret de signature de session** : `authSecret` (table Setting) était
  lisible par tout utilisateur authentifié via `/api/resource/settings` —
  falsification de jetons admin possible. Désormais **masqué** en liste et en
  détail, **création/modification interdites** via l'API.
- **C2/C3/C4 — SSRF** : les trois relais serveur (proxy de pages web, proxy IPTV,
  vérification d'intégrabilité) refusaient les adresses internes de façon
  contournable (127.0.0.1 vs localhost) — nouveau module `ssrf-guard.ts` :
  IP privées/boucle/lien-local/CGNAT/ULA refusées + résolution DNS anti-rebinding
  (cache 60 s), appliqué aux trois routes.
- **H1 — Plus de mot de passe par défaut** : le compte admin initial reçoit un
  mot de passe **aléatoire** (console + `db/admin-credentials.txt`, droits 0600) ;
  `ADMIN_DEFAULT_PASSWORD` reste supporté pour les installations scriptées.
- **H2 — Archive nettoyée** : plus de `.env` développeur ni de base `db/custom.db`
  dans le ZIP ; `.gitignore` étendu ; `install.bat` crée `.env` avec le chemin réel.
- **M1 — Limiteur de tentatives** sur `/api/auth/login` : 10 échecs/15 min par
  identifiant+IP, 40/15 min par IP → 429 + Retry-After.
- **M2 — XSS stocké SVG** : `nosniff` sur tous les médias + CSP `sandbox` sur
  SVG/HTML/JSON servis depuis `/uploads/**`.
- **M3 — En-têtes de sécurité** : `nosniff`, `Referrer-Policy`,
  `X-Frame-Options SAMEORIGIN` sur l'interface (lecteur et médias restent
  intégrables).
- **M5 — `limit` borné** (1..10 000) sur les listes de ressources.
- **M6 — `/api/server-info`** réservé aux sessions valides.

### Scripts Windows refondus
- **Nouveau `deploy\windows\install.bat`** (remplace `install-cms.bat`) :
  vérification Node.js ≥ 20, création de `.env` avec l'URL de base **calculée
  depuis le dossier d'installation**, npm install, Prisma, compilation via
  `build.bat`, détection LibreOffice/Poppler, journaux dédiés, robustesse
  chemins avec espaces/parenthèses.
- **Nouveau `deploy\windows\build.bat`** (remplace `build.ps1`) : `next build` +
  copie standalone cross-platform, vérification `server.js`, mode silencieux
  lorsqu'appelé par `install.bat` — plus aucun blocage par la stratégie
  d'exécution PowerShell.
- `start-cms.bat` : écoute **0.0.0.0** garantie (accès LAN), `PORT` surchargeable.
- `package.json` : script `build` cross-platform (Windows/Linux/macOS).

### Documentation
- **`GUIDE-UTILISATION.md`** : guide complet de toutes les fonctionnalités
  (installation, écrans, médias, présentations, campagnes, planification avec
  boucle par événement, pages web, IPTV/pool/timeshift, rapports, utilisateurs,
  LDAP, lecteur web/APK, dépannage, annexes scripts/variables).
- **`AUDIT-SECURITE.md`** : rapport d'audit (constats, gravité, correctifs,
  plan d'action production).
- **`README.md`** réécrit ; **`deploy/windows/LISEZMOI.txt`** mis à jour.

### Vérifications (v3.11)
- Syntaxe des 10 fichiers modifiés vérifiée (esbuild) : 10/10 OK.
- Archive de livraison reconstruite sans artefacts de développement.


## v3.10 — Consolidation : boucle par événement, dialogues et calendrier

**Objet :** livraison consolidée demandée par le client (v3.10 + APK v2.4). Reprend toutes les
fonctionnalités v3.7 (proxy de pages web interactif) et y ajoute les évolutions v3.8 → v3.10.

### Boucle ON/OFF PAR ÉVÉNEMENT (§16 — cœur de v3.8, conservé en v3.10)
- Nouveau champ persistant **`loop`** sur chaque événement de planification (SQLite/Prisma, défaut ON).
- **Dialogue Planifier / Modifier l'événement** : switch « Répéter en boucle » (ON par défaut),
  libellé explicite ON/OFF, persistance en base — modifiable à tout moment **sans recréer
  l'événement**, conservé après redémarrage du serveur et des lecteurs.
- Le switch global « Lecture automatique en boucle » des Paramètres → Affichage est **remplacé**
  (v3.8) par ce réglage à l'échelle de l'événement ; une note renvoie vers le dialogue de
  planification. Le setting historique `playerLoop` reste renvoyé par l'API pour compatibilité
  avec les APK ≤ 2.3 (dans ce cas il sert de valeur de repli).
- **API `/api/player/schedule`** : chaque item embarque désormais `loop` (true/false).
- **Lecteur web** : le comportement suit la boucle de l'événement courant —
  ON : reprise au début après la fin (présentations, campagnes, widgets) ;
  OFF : un seul passage, puis **le dernier contenu reste affiché** (aucune reprise automatique).
- **APK v2.4 (versionCode 6)** : la boucle de l'événement est transmise à chaque région —
  ExoPlayer/VLC `repeatMode`, cycle des widgets et rotation des présentations suivent ON/OFF.
- Liste « Prochaines diffusions » : badge **Boucle ON / Boucle OFF** par événement ;
  info-bulle du calendrier complétée ; testé E2E dans le lecteur web réel (captures upload/).

### Dialogues sans zone perdue (§10)
- `DialogContent` borné (`max-h-[calc(100dvh-2rem)]` + défilement) : les longs dialogues
  (« Connecter Android », événement avec sélection d'écrans…) restent intégralement accessibles
  sur petits écrans et fenêtres réduites, y compris les boutons d'action.

### Calendrier — événements chevauchants lisibles (§24)
- Répartition automatique des événements d'une journée en **colonnes (lanes)** quand ils se
  chevauchent : plus de superposition illisible ; largeur adaptée au nombre de colonnes ;
  horaires début–fin affichés ; info-bulle complète. Les règles de planification réelles ne
  sont pas modifiées (pur visuel).

### Vérifications (v3.10)
- `bunx tsc --noEmit` : 0 erreur dans `src/`.
- Serveur en cours : `/api/version` → 3.10 ; colonne `loop` présente en base (7 événements, tous ON).
- Audits : `scripts/verify-cahier-v36.py` + `scripts/verify-v37-webpage.py` relancés à la livraison.
- Tests E2E lecteur web : boucle ON cyclique / OFF figé (captures `upload/e2e-v38-*`,
  `upload/e2e-s16-*`, `upload/e2e-v310-*`).

## v3.8 / v3.9 — Boucle par événement (résumé historique)

v3.8 a introduit le champ `loop` par événement, le switch dans le dialogue de planification,
la suppression du switch global côté API/UI et le support lecteur web complet (audit dédié
58/58 PASS à l'époque). v3.9 a été une itération corrective interne (dialogues, lanes) —
tous deux sont consolidés dans la **v3.10** ci-dessus, qui est la version livrée au client.

## v3.7 — Pages web réellement interactives : proxy de pages intégré au CMS

**Objet :** le signalement client « le contenu des pages web s'affiche sous forme d'images cassées et
l'interaction ne fonctionne pas » (§25) était fondé : les sites majoritaires (BBC, Météo-France,
Facebook…) envoient l'en-tête `X-Frame-Options` / `CSP frame-ancestors` qui **interdit techniquement**
l'affichage dans une iframe. La v3.6 affichait un diagnostic, mais la page restait « cassée ».
La v3.7 supprime cette limitation par un **proxy de pages web intégré au CMS** — la page est
récupérée par le serveur, les en-têtes de refus ne sortent jamais, et le contenu reste entièrement
interactif. Vérifié par tests E2E navigateur réels (captures dans upload/).

### Nouvelle architecture — proxy par chemin
- **Route `/api/webpage/proxy/https/site/chemin`** (forme chemin) : l'URL cible est encodée dans le
  chemin ; toutes les URLs relatives des pages servies (liens, formulaires générés côté client,
  redirections JS) se résolvent **naturellement dans le proxy** — impossible d'échapper vers le site
  réel, donc impossible de déclencher le refus d'intégration.
- **Réécriture HTML côté serveur** : suppression des meta CSP/charset et des attributs integrity ;
  réécriture des liens, formulaires, iframes, **assets relatifs (CSS, JS, images, lazy-loading
  data-src, srcset, posters, use/href SVG)** et des blocs `<style>` vers la forme chemin ; les URLs
  absolues de CDN restent chargées directement (aucune restriction de frame sur les sous-ressources).
- **Service Worker `/api/webpage/proxy/sw.js`** (portée `/api/webpage/proxy/`) : re-préfixe vers le
  proxy toute requête same-origin créée dynamiquement par le JavaScript du site (images lazy-load,
  fonds de carte SVG, CSS dynamiques…). Résultat E2E sur Météo-France : **28/28 images chargées,
  0 cassée** (contre 6 cassées avant).
- **Crochet JS injecté** : fetch/XHR avec URLs absolues ou racine-relatives réécrits ; intercepteur
  API Navigation pour les navigations same-origin échappées (formulaires client-rendus).
- **Jar de cookies en mémoire** : les sessions du site visité sont conservées → **les connexions
  (formulaires de login) fonctionnent** lorsque le site le permet (§5).
- **POST transmis** (formulaires, JSON) ; gestion du charset (ISO-8859-1/Windows-1252 → UTF-8) ;
  page d'erreur française propre avec bouton « Réessayer » et rechargement automatique ; garde
  anti-récursion (le CMS lui-même ne peut pas être proxyfié) ; délais et tailles plafonnés.

### Widget « Page web » (§5 / §25)
- **Bascule automatique** : l'iframe tente le chargement direct ; si le site refuse l'intégration
  (vérification serveur fiable) ou ne charge pas, le lecteur **bascule tout seul vers le proxy** et
  un indicateur discret « Via proxy CMS » apparaît. Plus jamais de page cassée à l'écran.
- **Nouveau champ « Chargement »** dans le designer : `Automatique (recommandé)` / `Toujours via le
  proxy CMS` / `Direct (iframe seule)`.
- **API embeddable fiabilisée** : User-Agent navigateur réel (les protections anti-robot renvoient
  des en-têtes différents aux robots) ; sur réponse d'erreur (403/429), la vérification ne conclut
  plus au blocage.
- Limites documentées honnêtement (proxy-core.ts) : WebSocket non proxyfié ; navigation absolue JS
  cross-origin non interceptable ; cookies écrits côté client non persistés.

### Application APK (§5 / §8 / §25) — sources v2.3 (versionCode 5)
- `WebWidgetView` enrichi : **WebChromeClient** (dialogues JS alert/confirm, autorisation
  géolocalisation pour les tableaux de bord), **focus + isFocusableInTouchMode + requestFocus**
  (le clavier virtuel s'ouvre sur les champs de saisie), **mixed content autorisé** (tableaux de
  bord internes HTTP), **User-Agent Chrome réel** (supprime les pages « navigateur non pris en
  charge »), viewport large + vue d'ensemble (mise à l'échelle sans déformation §8).
- Une navigation WebView de premier plan n'est de toute façon **pas soumise à X-Frame-Options** :
  tout site s'y affiche nativement et reste interactif.
- Prérequis de compilation documenté (SDK Android absent de l'environnement de build) :
  `download/android-player` → Android Studio ou `./gradlew assembleUniversal`.
- **COMPILATION RÉALISÉE (même jour, mise à jour) :** l'environnement de build a depuis reçu le
  SDK Android 34 + Gradle 8.7 ; l'APK **`SignageCMS-Player-v2.3-universal.apk` (versionCode 5)**
  est désormais **compilé et signé** (keystore `signagecms-release.jks`) et remplace la v2.1.
  Un défaut de compilation bloquant a été corrigé au passage : annotation
  `@SuppressLint("SetJavaScriptEnabled")` dupliquée sur `WebWidgetView` (non répétable —
  cause exacte de l'échec de compilation antérieur). Le dex embarque bien
  `playerLoopEnabled`, `WebChromeClient`, `requestFocus` et le mixed content autorisé.
  La v2.1 restait livrée jusqu'ici faute de compilation : c'est elle que l'écran Android
  exécutait, sans le respect du switch boucle ni les enrichissements WebView.

### Vérifications (37 contrôles PASS)
- `scripts/verify-cahier-v36.py` : 22/22 PASS (audit de base v3.6 re-exécuté ; deux
  contrôles pointaient des noms de fichiers v3.6 obsolètes — matrice XLSX et zip —
  corrigés pour résoudre les livrables v3.7 réels : la matrice v3.7 et les 3 .BAT du zip
  étaient bien présents, les échecs signalés étaient des faux positifs du script).
- `scripts/verify-v37-webpage.py` : 15/15 PASS — proxy forme chemin, redirection 307 relative,
  Service Worker, bascule automatique, sélecteur de mode, assets réécrits (202 CSS + 33 JS),
  anti-récursion, page d'erreur, POST, embeddable BBC/anti-robot, APK 7/7, versions alignées.
- E2E navigateur réels (captures `upload/e2e-webpage-*.png`) : BBC accueil → clic « News » → page
  BBC News rendue via proxy ; httpbin formulaire rempli + soumis → écho des champs ; Météo-France
  complète → saisie « Tunis » → recherche exécutée → page « Votre recherche : Tunis » rendue avec
  styles, images et interactions ; 28/28 images chargées.
- E2E switch boucle (captures `upload/audit-settings-affichage-v37.png`,
  `upload/e2e-player-webpage-*.png`) : switch OFF → Enregistrer → DB `playerLoop=false` →
  API lecteur `playerLoop:false` → lecteur web en une passe ; puis retour ON rétabli et revérifié.
  Interactivité re-testée en direct dans /player : recherche Météo-France « Tunis » exécutée
  dans l'iframe proxy avec résultats rendus.

## v3.6 — Conformité complète au cahier des charges (25 points)

**Objet :** application effective de l'intégralité du cahier des charges (points 1 à 25), vérifiée par tests end-to-end réels sur le serveur en cours d'exécution.

### Corrections fonctionnelles
- **§1 Chevauchement des événements** — détection des conflits d'horaire dans la planification (bannière listant les paires d'événements qui se chevauchent sur des cibles communes) ; le lecteur diffuse les événements prioritaires d'abord puis alterne ; les événements traversant minuit s'affichent sur chaque journée concernée.
- **§2 Modification des événements** — un clic sur un événement du calendrier ouvre le dialogue pré-rempli (dates, horaires, contenu, cible) ; enregistrement via l'API existante, suppression intégrée au même dialogue. Testé de bout en bout (renommage persisté).
- **§4 Campagnes multi-présentations** — réordonnancement ▲▼ des présentations dans la campagne (ordre de diffusion persisté), renommage/description modifiables, numérotation affichée ; **le lecteur web enchaîne désormais TOUTES les présentations d'une campagne** dans l'ordre défini (précédement seule la première était jouée). Testé : rotation A(12 s)→B(12 s)→A observée dans le lecteur.
- **§5 / §25 Pages web dans le lecteur** — le widget page web rend une **iframe réelle et interactive** (liens cliquables, formulaires, saisie) ; options : interactivité ON/OFF, rafraîchissement auto, zoom. Diagnostic fiable des sites qui refusent l'intégration : nouvelle API serveur `/api/webpage/embeddable` (lecture des en-têtes X-Frame-Options / CSP) + garde-fou navigateur (délai 10 s) → message explicite + bouton « Ouvrir dans un nouvel onglet ». Vérifié avec un site intégrable (rendu réel) et un site refusant (facebook.com, diagnostic affiché).
- **§6 Contrôle du son** — bouton muet/son + curseur de volume superposés aux vidéos et chaînes IPTV du lecteur, **sans interrompre la lecture** (reprise automatique si le navigateur met en pause au dé-muettement) ; réglage par widget (muet au démarrage par défaut — compatibilité autoplay navigateurs/Android), choix « remplir/contenir » pour éviter les coupures d'image.
- **§9 Limites IPTV** — plafonds de chaînes relevés à 50 000 (M3U) et 50 000/type (Xtream), surchargeables par variables d'environnement `IPTV_MAX_CHANNELS` / `IPTV_MAX_PER_TYPE`.
- **§13 Upload** — route `POST /api/upload` **restaurée** (régression bloquante constatée : 404 sur l'arbre v3.5) et renforcée : limite de taille réglable (setting `maxUploadSize` ou env `MAX_UPLOAD_MB`), contrôle d'espace disque avant écriture, messages d'erreur explicites (format refusé, trop volumineux, permissions, disque plein), **barre de progression réelle du transfert** dans l'interface, formats étendus (tiff, ico, mpeg, mpg, 3gp, ts).
- **§16 Switch lecture en boucle ON/OFF** — nouveau switch « Lecture automatique en boucle » dans Paramètres → Affichage ; réglage persistant (conservé après redémarrage) ; exposé aux lecteurs via `/api/player/schedule` (`playerLoop`) ; lecteur web : boucle des vidéos et des cycles, séquence jouée une seule passe puis tenue du dernier contenu en OFF ; APK v2.2 : le switch est lu et appliqué aux vidéos. Testé : rotation ON puis arrêt sur dernier contenu en OFF.
- **§17 Durées de diffusion** — les présentations d'une campagne respectent leur durée propre (`layout.duration`), les widgets leur durée par région ; vidéos plus courtes que la durée configurée : boucle ON = reprise, boucle OFF = image figée jusqu'au passage suivant ; fenêtres horaires des événements appliquées côté serveur + resynchronisation lecteur toutes les 60 s.
- **§21 / §14 / §15 Matrice de tests formats** — campagne réelle sur 21 fichiers représentatifs (corpus v3) : upload, conversion, service HTTP, décodage navigateur. Résultats dans `Matrice-Tests-Formats-SignageCMS-v3.6.xlsx` : 20/21 Réussi, 1 Non pris en charge côté web (H.265/HEVC — décodeur matériel requis, supporté côté APK) ; PPT/PPTX/PDF convertis en slides (2/2 chacun) ; documentées les limites (animations PowerPoint non restituées, variantes MKV/MOV selon versions).
- **§22 IPTV compte réel (lecteur web)** — connexion au portail fourni : OK ; 12 063 chaînes LIVE + 50 000 VOD + 33 653 épisodes importés ; échantillon de 8 flux testé via le serveur : 3/8 diffusables (les autres hors ligne/refusés par le fournisseur depuis le réseau de test) ; lecteur web : messages d'erreur explicites, diagnostic, bascule lecture directe automatique, réessai. Identifiants masqués dans l'interface (URL du flux affichée brouillée) et absents des livrables. APK : à confirmer sur appareil (procédure fournie).
- **§23 Scripts Windows** — nouveau `deploy/windows/install-cms.bat` (installation complète en un script : vérification Node.js, création .env, dépendances, base de données, build production, messages de réussite/échec, journal `install-cms.log`, compatible chemins avec espaces) ; LISEZMOI enrichi (ordre d'exécution des scripts).
- **§24 Calendrier (chevauchement visuel)** — les événements qui se chevauchent sont répartis automatiquement en **colonnes parallèles** (algorithme de lanes : largeur/position calculées), heures de début/fin visibles, info-bulle complète, lisibilité conservée sur petits écrans ; événements multi-jours affichés sur chaque journée.
- **§8 Orientation APK** — vérifié au niveau source : `configChanges` complet (orientation/screenSize/screenLayout/smallestScreenSize) — rotation sans rechargement ; widgets redimensionnés sans déformation (voir matrice APK).

### Confidentialité et conformité
- **§18 Informations personnelles/secrets** — purge des identifiants IPTV réels résiduels dans 9 fichiers de développement (remplacés par des espaces réservés) ; **base de données nettoyée** (compte portail supprimé, 95 716 chaînes du fournisseur purgées, VACUUM) ; mot de passe admin par défaut surchargeable par variable d'environnement `ADMIN_DEFAULT_PASSWORD` ; interface IPTV n'affiche plus les identifiants des flux.
- **§20 Références au projet d'origine** — nettoyage complet du code source, des commentaires, des mots-clés SEO, du README APK et du code Kotlin ; aucune référence résiduelle dans les livrables.

### Vérifications end-to-end effectuées (serveur réel)
- Planification : 5 conflits détectés et affichés ; édition d'événement persistée ; calendrier en colonnes.
- Campagne 2 présentations : rotation 12 s/12 s observée dans le lecteur ; OFF = arrêt sur la dernière.
- Page web : rendu iframe réel (exemple.com) ; diagnostic X-Frame-Options (facebook.com).
- Son : muet au démarrage → activation au clic sans interruption ; boucle vidéo vérifiée.
- Upload : 21 formats testés réellement (matrice) ; progression affichée.
- IPTV : compte réel connecté, 95 716 contenus importés puis purgés avant livraison.

### Audit de conformité final (24/10/2026 — suite à la demande client « tous les points ne sont pas appliqués »)
Audit E2E complet des 25 points (`scripts/verify-cahier-v36.py`, 22 contrôles, **22/22 PASS**) avec corrections immédiates :
- **Régression critique découverte et corrigée** : la route `POST /api/upload` avait de nouveau disparu de l'arbre de travail (3ᵉ occurrence) — rendant le téléversement (§13) totalement inopérant. Route restaurée, **committée dans git** et erreur 400 explicite en cas de requête malformée. Nouvelle **garde anti-régression** dans le script de construction : le zip ne peut plus être généré si un fichier critique manque (`src/app/api/upload/route.ts`, routes player/auth/permissions, `version.ts`, `schema.prisma`).
- **§11 corrigé pour de bon** : le dialogue « Connecter Android » affichait `localhost` dans l'adresse et le QR code lorsque le CMS est ouvert en local — un QR localhost n'est pas joignable depuis l'appareil Android. Nouvelle API `/api/server-info` (interfaces réseau réelles du serveur) ; l'adresse et le QR utilisent désormais **automatiquement l'IP LAN réelle** (ex. `http://21.0.9.48:3000/player?key=…`) avec bannière d'avertissement et sélection d'interface si plusieurs IPs. Vérifié visuellement dans le navigateur.
- **Vérifications visuelles navigateur** (captures) : bannière « 6 conflits d'horaire » avec paire d'événements chevauchants (§1) ; événements chevauchants en colonnes parallèles sans superposition (§24) ; dialogue « Modifier l'événement » pré-rempli avec mentions « format 24h » (§2/§3) ; dialogue Connecter Android aligné, adresse IP réelle + QR (§10/§11) ; switch « Lecture automatique en boucle » basculé ON→OFF→ON avec persistance en base (§16) ; page Rôles & droits : matrice VOIR/CRÉER/MODIFIER/SUPPRIMER par module et par rôle (§7.2) ; lecteur : iframe réelle interactive + diagnostic explicite sur site refusant l'intégration (§25/§5).
- **Fuite résiduelle supprimée** : `scripts/test-iptv-v36.json` contenait encore les identifiants IPTV du cahier — fichier supprimé ; re-scan complet : plus aucune occurrence dans l'arbre, la base et les livrables (§18).
- REST API retestée avec payloads conformes Prisma (dates ISO avec fuseau) : création/modification/suppression d'événements, création utilisateur read-only → écritures bloquées 403 côté serveur, accès sans jeton → 401 (§7.3).

## v3.5 — Confidentialité : suppression des traces de développement et des informations personnelles

**Objet :** retirer toutes les traces de l'environnement de développement, renouveler l'identité visuelle et purger les informations personnelles de l'application et de l'archive de déploiement.

### Nouvelle identité visuelle
- Nouvelle icône maison : écran d'affichage orange avec bouton lecture (dégradé #f97316 → #ea580c), générée localement (`public/favicon.svg`, `favicon.ico` 16/32/48 px, `apple-touch-icon.png` 180 px, `icon-192.png`).
- `public/logo.svg` remplacé par le nouveau logo — l'ancien logo d'origine est supprimé.
- `src/app/layout.tsx` : le favicon ne pointe plus vers une URL CDN tierce mais vers les icônes locales.

### Suppression des traces de développement
- `package.json` : nom du modèle de départ → `signagecms`, version `2.8.0`, suppression d'une dépendance SDK tierce inutilisée par le code de l'application ; `bun.lock` régénéré.
- `tests/python-runtime-container.sh` : image de conteneur d'exécution remplacée par `signagecms-python-runner`.
- `.gitignore` : configuration locale renommée `.cms-local-config`.
- Audit de l'archive finale : **0 occurrence** de références à l'environnement de développement d'origine.

### Suppression des informations personnelles
- Page de connexion : l'encart « Compte par défaut : admin / admin123 » est supprimé (message neutre à la place) ; pied de page mis à jour « SignageCMS v2.8 ».
- Base de données : **10 comptes de test supprimés** (noms + emails, dont une adresse Gmail réelle) — seul le compte `admin` subsiste ; base compactée (VACUUM) pour effacer physiquement les données du fichier.
- `scripts/seed.ts` : utilisateurs de démonstration anonymisés (emails `@signage.local`, noms neutres).
- **15 scripts de développement purgés** de leurs identifiants réels (portails IPTV, cartes Xtream) → espaces réservés (`IPTV_USER_A_RENSEIGNER`…) ; vérification : 0 résidu.
- `scripts/rebuild-serveur-zip.py` : les scripts contenant des identifiants sont exclus de l'archive (`restore-iptv.py`, `test-power360.py`, `test-timeshift.py`, `test-multi-ecrans-1connexion.py`, etc.).
- Placeholders d'interface neutralisés : `users.tsx` (`exemple@domaine.fr`), `ldap-import.tsx` (`annuaire.exemple.fr`), `demo-meeting.svg` (`contact@exemple.fr`).

### Notes
- **Vérification complète 31/31 PASS** (scripts/verify-v35.py) : toutes les demandes précédentes sont présentes — upload PPTX **et PPT legacy** (4 slides chacun), images JPG/JPEG/PNG/GIF, vidéos MP4/MKV/AVI, timeshift +30 s, recherche serveur des 11 491 chaînes, multi-écrans IPTV (BBC + TF1), APK (rotation, Media3/VLC/Coil, WebView interactive JS+DOM, audio), favicon, confidentialité. La route `POST /api/upload` (régressée de l'arbre de travail) a été re-restaurée depuis l'historique git et protégée par commit.
- Le compte IPTV configuré (Xtreamity) est **conservé en base** : c'est une donnée fonctionnelle nécessaire à la diffusion, gérée depuis l'onglet IPTV du CMS.
- Le compte `admin` et son identifiant de récupération intégré (recréation automatique uniquement si aucun admin actif n'existe) sont conservés pour éviter tout verrouillage ; changez le mot de passe depuis l'onglet Utilisateurs.
- Audit final de l'archive : zéro trace de l'environnement de développement, zéro identifiant IPTV en clair, zéro email personnel, base limitée au compte admin.

## Versions précédentes (consolidé)
- **v2.7** — Restauration de la route `POST /api/upload` (régression de dépôt) + conversion PPTX/PPT en diapositives vérifiée de bout en bout (API + interface).
- **v2.2 → v2.6** — Itérations correctives : lecteur Android (formats médias via Media3/VLC, rotation, son vidéo/IPTV), interactivité de la page web /player, multi-écrans IPTV, timeshift (+N s) sur les widgets, recherche serveur dans les sélecteurs de chaînes. Détails dans `worklog.md`.
- **v2.1** — Lecteur Android SignageCMS Player (APK universal/arm64/armv7 : Media3-ExoPlayer + VLC + Coil, enregistrement par clé matérielle).

## v3.11.1 — Correctif : masquage de `authSecret` réellement effectif

**Objet :** la v3.11 prétendait masquer `authSecret` via `isProtectedSettingKey()`,
mais deux défauts rendaient le filtre inopérant sur la clé réelle :

1. **Comparaison de casse** : la fonction appelait `key.toLowerCase()` puis
   comparait à la liste `['authSecret']` (casse mixte) — `'authsecret'` ne
   correspondait donc jamais à `'authSecret'`.
2. **Motif trop strict** : la regex exigeait une frontière `(^|_)` avant
   `secret`, ce qui laisse passer les collages camelCase comme `authSecret`
   (lettre `h` juste avant `Secret`).

**Correctif :** liste de clés normalisée en minuscules (`authsecret`,
`auth_secret`) et motif étendu tolérant une lettre avant/après le mot-clé
(`(^|_|[a-z])(secret|password|passwd|token|apikey|api_key|privatekey)($|_|[a-z])`).
Validé par 10 tests de cas (positifs et négatifs) et re-testé sur installation
réelle : `GET /api/resource/settings` renvoie désormais `value: ""` pour
`authSecret`, et toute écriture via l'API reste refusée (403).

> Détecté lors du déploiement de contrôle en sandbox : la valeur du secret
> était retournée en clair malgré le correctif v3.11. Aucun autre point de
> l'audit n'est concerné.

## v3.11.2 — Correctif : interface intégrable en iframe sur demande (`ALLOW_FRAME_EMBED`)

**Objet :** le durcissement v3.11 (M3) posait `X-Frame-Options: SAMEORIGIN`
sur toute l'interface d'administration — exacte contre le clickjacking, mais
elle empêche aussi les panneaux d'aperçu légitimes (sandbox de développement,
portails internes) qui affichent le CMS dans une iframe **inter-origine** :
le navigateur refuse de rendre la page (icône « page cassée »).

**Correctif :** nouvelle variable d'environnement optionnelle
`ALLOW_FRAME_EMBED=1` — désactive `X-Frame-Options` pour permettre
l'intégration volontaire. Comportements :

| Configuration | Résultat |
|---|---|
| Variable absente (défaut, `install.bat`) | `SAMEORIGIN` conservé — protection anti-clickjacking active |
| `ALLOW_FRAME_EMBED=1` (sandbox, portail) | Interface intégrable en iframe inter-origine |

`/player`, `/uploads` et le proxy de pages restent intégrables dans tous les
cas (mur d'écrans, OBS, widgets). Les en-têtes `nosniff` et `Referrer-Policy`
ne sont pas touchés.

> Détecté lors du déploiement de contrôle en sandbox : le panneau d'aperçu
> n'affichait plus l'application après l'ajout des en-têtes v3.11.

## v3.11.3 — Téléversement en streaming (gros fichiers) + dépendance busboy

**Objet :** la route `POST /api/upload` bufférisait le fichier en mémoire
(`request.formData()` puis `arrayBuffer()`) : l'empreinte mémoire montait à
≈ 3-4× la taille du fichier. Un fichier de 400 Mo suffisait à saturer un
serveur 4 Go et à tuer le processus (OOM) — la limite de 50 Mo masquait le
problème en empêchant les gros fichiers d'arriver jusqu'au buffer.

**Correctif :** réécriture avec **busboy** (parseur multipart en streaming) :

- le fichier est **écrit sur le disque au fil de l'eau** (mémoire constante,
  ~quelques Mo quelle que soit la taille) ;
- la limite (`maxUploadSize`, réglable dans Paramètres) est contrôlée
  **pendant le transfert** : dépassement → coupure immédiate, fichier partiel
  supprimé, erreur 413 explicite ;
- double garde anti-troncature (garde interne + événement `limit` de busboy) ;
- messages d'erreur inchangés (415 format, 400 extension, 413 taille).

**Validation en conditions réelles (sandbox 4 Go) :**

| Test | v3.11.2 (buffer) | v3.11.3 (streaming) |
|---|---|---|
| PPTX 30 Ko → slides | OK | OK (régression nulle) |
| MP4 420 Mo | **crash OOM, serveur tué** | **201 en 2,5 s, mémoire plate** |
| MP4 600 Mo (limite 500) | jamais atteignable | **413 propre, zéro fichier partiel** |

**Nouvelle dépendance :** `busboy` (+ `@types/busboy` en dev) — exécuter
`bun install` / `npm install` après mise à jour.

**Env optionnelle :** `MAX_UPLOAD_MB` surcharge le réglage Paramètres ;
`SOFFICE_PATH` / `PDFTOPPM_PATH` forcent les binaires de conversion
(documentés dans `deploy/windows/env.example`).

## v3.11.18 — Réglages appliqués immédiatement

**Constat :** l'interrupteur « Section Playlists » (Paramètres → Général) masquait bien le menu, mais seulement après un rechargement manuel (F5) : la barre latérale lit le réglage `showPlaylists` uniquement au montage de l'application, et l'enregistrement des Paramètres ne déclenche aucun rafraîchissement. Sur le terrain, l'option paraissait donc « ne pas fonctionner » — le menu Playlists restait affiché jusqu'au F5.

**Correctif :** après un enregistrement réussi des Paramètres, la page se recharge automatiquement (délai de 800 ms pour laisser la confirmation s'afficher) — la barre latérale et le tableau de bord reflètent aussitôt le nouvel état. Aucun changement de schéma, aucune donnée modifiée.

## v3.11.19 — Section Playlists supprimée de l'interface (tous rôles, admin compris)

**Demande :** après la mise à jour v3.11.18, l'utilisateur demande que la section
Playlists disparaisse définitivement, « pour tout, même pour l'admin » — plus
seulement masquable par un réglage, mais retirée du produit.

**Analyse :** le réglage `showPlaylists` (v3.11.16) ne masquait la section que pour
l'administrateur : la barre latérale ne chargeait le réglage que si `me.role === 'admin'`,
les autres rôles voyaient donc toujours le menu. L'utilisateur veut l'inverse : plus
aucune trace pour personne.

**Supprimé du code :**

| Élément | Fichier |
|---|---|
| Entrée de menu « Playlists », vue, type ViewId, réglage `showPlaylists` (état + chargement + `canSee`) | `src/components/cms/shell.tsx` |
| Carte « Playlists » du tableau de bord + prop `showPlaylists` | `src/components/cms/dashboard.tsx` |
| Interrupteur « Section Playlists » (Paramètres → Général) + défaut `showPlaylists` | `src/components/cms/settings.tsx` |
| Composant PlaylistsView (36 références internes) | `src/components/cms/playlists.tsx` — fichier supprimé |
| Module « Playlists » de la matrice de permissions (page Rôles & droits) | `src/lib/permissions.ts` |
| Ressource `/api/resource/playlists` (→ 404) | `src/app/api/resource/[resource]/route.ts` |
| Compteur `totalPlaylists` de `/api/stats` | `src/app/api/stats/route.ts` |
| Bouton « Ajouter à une playlist » + dialogue + intégration API du module TV/IPTV | `src/components/cms/iptv.tsx` |
| Mot « playlists » de la métadescription | `src/app/layout.tsx` |

**Conservé :** les playlists M3U du module TV/IPTV (sources de chaînes — autre concept,
routes `/api/iptv/*` inchangées) ; le modèle Prisma `Playlist` et les données existantes
(aucune migration, aucune perte) ; les widgets de playlists éventuellement référencés
par d'anciennes données. La planification ne référencait jamais les playlists
(événements cibles : présentations et campagnes uniquement) — aucun impact diffusion.
Le rechargement automatique des réglages (v3.11.18) est conservé pour les réglages restants.

**Validation :** build production, test agent-browser connecté admin (menu absent de la
barre latérale, carte absente du tableau de bord, page Rôles & droits sans module
Playlists, interrupteur absent de Paramètres), capture publiée. Archive
`SignageCMS-Serveur-v3.11.19.zip` publiée.


**Note démo (21-11) :** la session précédente avait dû servir la démo via un contournement
anti-watchdog au rendu volontairement non stylé (CSS minimal sans Tailwind) — c'est ce que
l'utilisateur a vu (« pas de style appliqué »). La démo est désormais reconstruite en
production depuis la source v3.11.19 **avec les styles complets** (Tailwind + polices) :
barre latérale, cartes et graphiques rendus normalement, toujours sans aucune section
Playlists (session admin vérifiée : tableau de bord, Paramètres, Rôles & droits). URL
publique, CSS et archive v3.11.19 revérifiés en GET ; tarball de restauration mis à jour.

## v3.11.24 — reset-admin : mot de passe régénéré immédiatement (sans essai de connexion à l'aveugle)

**Demande :** « mot de passe admin n'est pas fonctionnel » — après l'installation,
l'utilisateur ne connaissait pas le mot de passe initial et aucun essai ne
passait. Deux causes combinées : le fichier d'identifiants n'était créé qu'au
premier essai de connexion (corrigé en v3.11.23, dépôt finalisé dans cette
version), et l'outil de récupération existant (reset-admin) exigeait ensuite un
redémarrage puis un essai de connexion à l'aveugle pour régénérer le mot de passe.

**Corrigé :**
- dépôt v3.11.23 finalisé : arbre réconcilié avec l'archive publiée (9 fichiers
  revenus en état v3.11.22 après une restauration partielle) et tests réels de
  scripts/ensure-admin.mjs (création sur base neuve, fichier en mode 0600, no-op
  sans écrasement, scrypt vérifié contre la base, ADMIN_DEFAULT_PASSWORD sans
  fichier) — tous passent ;
- deploy/linux/reset-admin.sh et deploy/windows/reset-admin.bat suppriment le
  compte admin puis appellent scripts/ensure-admin.mjs : le NOUVEAU mot de passe
  s'affiche aussitôt et db/admin-credentials.txt est réécrit — sans redémarrage
  ni essai de connexion à l'aveugle (l'ancien mode dégradé reste affiché en
  repli si ensure-admin.mjs est absent ou en échec) ;
- scripts/ensure-admin.mjs indique le remède (reset-admin) quand un compte admin
  actif existe mais que le fichier d'identifiants est absent ;
- documentation (README, LISEZ-MOI, LISEZMOI.txt Linux/Windows) : « mot de passe
  perdu → reset-admin ».

**Validation :** reset-admin.sh testé sur base de test (compte existant, fichier
supprimé → nouveau mot de passe affiché + fichier réécrit + scrypt vérifié),
zip v3.11.24 (198 fichiers, extraction testée), démo reconstruite v3.11.24,
login API vérifié, URL publique vérifiée en GET.

## v3.11.23 — Identifiants admin créés dès l'installation (plus d'attente du 1er essai de connexion)

**Demande :** « il n'a pas créé admin-credentials.txt » — après l'installation, le
fichier `db/admin-credentials.txt` annoncé par l'installateur n'existait pas.

**Cause :** le compte admin (et son fichier d'identifiants) n'était créé qu'au
**premier essai de connexion** (auto-réparation dans `/api/auth/login`, v3.11 /
v3.11.17). L'utilisateur cherchait donc le fichier juste après l'installation et
ne le trouvait pas — et ne pouvait pas connaître le mot de passe sans faire d'abord
un essai de connexion à l'aveugle.

**Corrigé :** nouveau script `scripts/ensure-admin.mjs` (Node pur, scrypt natif
identique à `src/lib/password.ts`, même règle de mot de passe que la route de
connexion) branché sur les quatre voies d'installation/démarrage :
- `deploy/linux/install.sh` : appel après le build — les identifiants s'affichent
  en fin d'installation et le fichier existe immédiatement ;
- `deploy/linux/start.sh` : appel au démarrage (daemon et premier plan), après
  l'auto-build éventuel ;
- `deploy/windows/install.bat` : appel après la compilation (étape 5bis) ;
- `deploy/windows/start-cms.bat` : appel à chaque démarrage (no-op si le compte existe).
Le script ne touche jamais à un compte admin actif existant et n'écrase jamais un
`admin-credentials.txt` existant ; `ADMIN_DEFAULT_PASSWORD` reste supporté (mot de
passe imposé, fichier non écrit). En cas d'échec (base injoignable, client Prisma
absent) il avertit sans bloquer : l'auto-réparation du 1er essai de connexion reste
le filet de sécurité (inchangée). Documentation « Première connexion » mise à jour
(README, LISEZ-MOI, LISEZMOI.txt).

**Validation :** test réel sur base neuve (compte créé + fichier écrit + scrypt
vérifié, 2e exécution = no-op), zip v3.11.23 (198 fichiers) avec extraction testée,
démo reconstruite v3.11.23, login API vérifié, URL publique vérifiée en GET.

## v3.11.22 — start.sh auto-suffisant : le serveur se construit tout seul

**Demande :** « fix it » + capture : `sudo ./start.sh` dans l'arbre source
`~/signagecms` → « Build production absent (.next/standalone/server.js) »
avec pour seul secours la commande à lancer à la main.

**Corrigé :** deploy/linux/start.sh construit automatiquement le build
production quand il est absent (npm install, prisma db push, prisma
generate, npm run build — journal complet dans build.log, fin du journal
affichée en échec), puis démarre le serveur comme d'habitude. Option
--no-build pour retrouver l'ancien comportement. Le .env minimal créé par
start.sh (DATABASE_URL local) convient pour cette voie rapide ; install.sh
(/opt/signagecms + service systemd) reste la voie recommandée en production.

**Validation :** bash -n OK ; zip v3.11.22 (197 fichiers, public/ inclus),
extraction testée, vérifications anti-régression (auto-build présent dans
start.sh, --no-build, URL install.sh, copy-standalone résilient, playlists
absentes) ; démo reconstruite v3.11.22 ; URL publique vérifiée en GET.

## v3.11.21 — Archive réparée : dossier public/ inclus, erreurs de build lisibles

**Demande :** « fix it » + capture d'écran de l'installation Linux :
« [copie-standalone] Introuvable : /opt/signagecms/public » puis
« [ERREUR] Build impossible. »

**Cause racine :** l'archive serveur ne contenait pas le dossier `public/`
(absent au moins depuis la v3.11.13 — vérifié sur toutes les archives
conservées). `next build` réussit (public/ est optionnel pour Next), puis la
seconde moitié de `npm run build` (`node scripts/copy-standalone.js`)
s'arrêtait sur `fs.existsSync` faux pour `<racine>/public` → exit 1 →
install.sh affichait « Build impossible. » en ayant masqué la sortie du
premier essai (`2>/dev/null`).

**Corrigé :**
- scripts/copy-standalone.js : si `public/` est absent, il est recréé vide au
  lieu d'abandonner (durcit aussi le flux build.bat sous Windows) ;
  `.next/static` absent reste une erreur fatale ;
- deploy/linux/install.sh : URL de secours → v3.11.21 ; la compilation écrit
  tout dans /opt/signagecms/build.log et la fin du journal (30 lignes) est
  affichée en cas d'échec ; mkdir défensifs (public, public/uploads,
  public/downloads) à l'étape .env ;
- l'archive v3.11.21 inclut public/ (favicon.ico, favicon.svg, logo.svg,
  robots.txt) — le README documentait déjà public/ dans « Archive contents ».

**Validation :** bash -n OK ; zip 197 fichiers (193 + 4 public/), testzip OK,
extraction testée, md5 publié ; démo standalone v3.11.21 reconstruite et
vérifiée (API version, CSS, URL publique du zip en GET).

## v3.11.20 — Installateur Linux : archive téléchargée automatiquement, intégrité contrôlée

**Demande :** « refaire zip complet sans erreur » — après l'erreur « Archive zip
introuvable » (étape 4/8) rencontrée sur une installation Linux, l'utilisateur demande une
archive complète et un déroulement sans erreur.

**Corrigé dans deploy/linux/install.sh :**
- étape 4/8 : si aucune archive `SignageCMS-Serveur-*.zip` n'est trouvée sur le disque
  (à côté du script, dans le dossier courant) et qu'aucune installation n'existe déjà dans
  `/opt/signagecms`, l'archive est **téléchargée automatiquement** depuis l'URL publique du
  projet (curl ou wget, 3 tentatives, timeout explicite) ;
- nouvelle option `--url URL` pour télécharger depuis un autre serveur ;
- **contrôle d'intégrité systématique** (`unzip -tqq`) avant toute extraction, archive
  fournie ou téléchargée : « Archive corrompue » stoppe l'installation avec un message
  d'action clair au lieu d'un échec d'extraction confus ;
- LISEZMOI.txt, README.md et LISEZ-MOI.md mis à jour (auto-téléchargement, `--url`).

**Aucun changement applicatif** : `src/` inchangée depuis v3.11.19 (suppression Playlists
conservée). Version bumped : VERSION, version.ts, package.json, README, LISEZ-MOI.

**Validation :** `bash -n install.sh` OK ; archive reconstruite par
`scripts/rebuild-zip-v31120.py` — 193 fichiers, intégrité testzip, 14 vérifications
anti-régression (shell/dashboard/settings sans playlists, VERSION/version.ts/package.json
= 3.11.20, URL de téléchargement présente dans install.sh, LISEZMOI à jour) ; publiée sur
les 4 emplacements ; URL publique vérifiée en GET (206 + taille).
