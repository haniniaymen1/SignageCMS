# SignageCMS

**Système de gestion d'affichage dynamique (digital signage)** — gérez vos écrans, publiez vos contenus, planifiez vos campagnes et surveillez la diffusion depuis une interface web unique.

| | |
|---|---|
| **Version serveur** | 3.11.15 |
| **Lecteur Android** | 3.4 (recommandé) |
| **Technologies** | Next.js 16 (App Router) · React 19 · Prisma 6 · SQLite |
| **Licence** | Propriétaire — tous droits réservés |

---

## Présentation

SignageCMS est une solution d'affichage dynamique complète et auto-hébergée. Elle transforme n'importe quel écran relié à un navigateur ou à un appareil Android en écran géré. Les contenus sont organisés en médias, playlists, présentations (pages multi-zones) et campagnes ; les campagnes sont programmées par événements à fenêtre horaire et diffusées par le lecteur web ou le lecteur Android natif.

Tout fonctionne depuis un seul serveur Node.js avec une base SQLite intégrée — aucun serveur de base de données externe n'est nécessaire. Les documents PowerPoint et PDF sont automatiquement convertis en images par diapositive grâce à LibreOffice et Poppler, pour une lecture fiable même sur des lecteurs peu puissants.

## Fonctionnalités

- **Tableau de bord & supervision** — état des écrans en temps réel, battements de cœur (heartbeats), statistiques de diffusion, journaux d'événements et rapports de preuve de diffusion (proof-of-play).
- **Écrans** — enregistrement des écrans par clé matérielle, regroupement (DisplayGroups), connexion des lecteurs Android par QR code.
- **Bibliothèque de médias** — images, vidéos, audio, PDF, PowerPoint (PPT/PPTX/PPS/PPSX/ODP), pages web et flux IPTV. Grands fichiers pris en charge (limite configurable) ; les conversions PPT/PDF en échec peuvent être relancées en un clic.
- **Présentations & régions** — concepteur de pages multi-zones avec régions redimensionnables et widgets : horloge, météo, flux RSS, texte, image, vidéo, présentation, PDF, flux IPTV, page web.
- **Playlists & campagnes** — séquençage des contenus en playlists, assemblage des présentations en campagnes avec durées par page. Boucle activée : la campagne se répète ; boucle désactivée (v3.11.12) : la campagne est jouée exactement une fois, durées respectées, puis passage à l'événement suivant ou à l'écran d'attente horloge.
- **Planification** — événements à fenêtre horaire ciblant des écrans ou des groupes d'écrans ; une campagne peut être réutilisée sur plusieurs événements.
- **Utilisateurs & sécurité** — comptes locaux, permissions fines, groupes d'utilisateurs, import LDAP/Active Directory, sessions JWT, protection SSRF des contenus web, anti-clickjacking (configurable).
- **IPTV** — portail Xtream Codes multi-comptes et playlists M3U (URL ou fichier), navigation des chaînes, diffusion proxifiée par le serveur.
- **Lecteurs** — lecteur web plein écran (`/player`) pour tout navigateur, et lecteur Android (APK) au rendu durci.

## Contenu de l'archive

```
signagecms/
├── src/                  Code source de l'application (App Router, routes API, interface CMS)
├── prisma/               Schéma de base de données (SQLite)
├── public/               Ressources statiques, favicon, logo
├── deploy/
│   ├── linux/            install.sh · start.sh · install-tools.sh · LISEZMOI.txt
│   └── windows/          install.bat · install.ps1 · start-cms.bat · build.bat · ...
├── scripts/              Scripts utilitaires (seed, maintenance, tests)
├── tests/                Harnais de tests d'intégration
├── package.json          Dépendances et scripts de build
└── VERSION               Version du serveur (3.11.15)
```

## Configuration requise

| Composant | Prérequis |
|---|---|
| Système | Linux (Ubuntu/Debian, RHEL/Fedora, openSUSE, Arch, Alpine) ou Windows 10/11, Server 2016+ |
| Node.js | 20 LTS ou plus récent |
| RAM | 2 Go minimum (4 Go recommandés pour le build de production) |
| Disque | 2 Go + espace pour les médias |
| Optionnel | LibreOffice + Poppler (conversion PowerPoint/PDF) |

## Démarrage rapide

### Linux — installation en une commande (recommandé)

```bash
sudo bash deploy/linux/install.sh --zip /chemin/SignageCMS-Serveur-v3.11.15.zip
```

Le script est **idempotent** et enchaîne 8 étapes : utilitaires de base → Node.js 20 LTS → LibreOffice + Poppler → déploiement dans `/opt/signagecms` → fichier `.env` (n'écrase jamais un existant) → `npm install` + Prisma + build de production → service systemd (démarrage auto, relance après crash) → règle de pare-feu + vérification finale de l'API.

Options utiles :

```bash
--port 8080          # port d'écoute (défaut 3000)
--dir /opt/moncms    # dossier d'installation (défaut /opt/signagecms)
--no-service         # ne crée pas le service systemd
--no-firewall        # ne modifie pas le pare-feu
```

Sans `sudo`, le script se dégrade proprement : les étapes système (paquets, systemd, pare-feu) sont sautées avec des messages explicites et l'installation se poursuit dès que le dossier cible est inscriptible.

### Linux — lancer / arrêter / état

```bash
bash deploy/linux/start.sh              # premier plan (Ctrl+C pour arrêter)
bash deploy/linux/start.sh --daemon     # arrière-plan (service.log + server.pid)
bash deploy/linux/start.sh --status     # état du processus + version API
bash deploy/linux/start.sh --restart    # redémarre l'instance en arrière-plan
bash deploy/linux/start.sh --stop       # arrête l'instance en arrière-plan
```

Si le service systemd a été créé par `install.sh`, préférez `sudo systemctl status|restart|stop signagecms`.

### Windows

Lancez `deploy\windows\install.bat` (installation assistée : vérification Node.js, `.env`, dépendances, Prisma, build de production) puis `deploy\windows\start-cms.bat`. Scripts avancés : `install.ps1`, `install-service.ps1` (service Windows), `firewall.ps1`, `build.bat`.

### Installation manuelle (tout OS)

```bash
npm install
npx prisma db push && npx prisma generate
npm run build            # build de production (sortie standalone)
node .next/standalone/server.js
```

Créez d'abord un fichier `.env` — voir [Configuration](#configuration).

## Première connexion

Au tout premier démarrage, le compte **admin est créé automatiquement** avec un mot de passe aléatoire. Ce mot de passe est :

1. écrit dans `db/admin-credentials.txt` dans windows .next/standlone/db (à supprimer après la première connexion), et
2. affiché dans la console du serveur.

Ouvrez ensuite `http://<ip-serveur>:3000`, connectez-vous avec `admin` et **changez immédiatement le mot de passe** (Paramètres). Enregistrez votre premier écran depuis la page *Écrans* (clé matérielle) ou scannez le QR code avec le lecteur Android.

## Configuration

Tous les réglages se trouvent dans le fichier `.env` à la racine du projet. `install.sh` et `install.bat` le créent automatiquement et n'écrasent jamais un fichier existant.

| Variable | Défaut | Description |
|---|---|---|
| `DATABASE_URL` | `file:<chemin-abs>/db/custom.db` | Base SQLite (chemin absolu, slashes) |
| `PORT` | `3000` | Port d'écoute HTTP |
| `ALLOW_FRAME_EMBED` | non défini | Mettre à `1` pour autoriser l'intégration de l'interface du CMS dans des iframes externes. `/player` reste toujours intégrable. |
| `MAX_UPLOAD_MB` | réglage UI | Limite de téléversement en Mo (surcharge le réglage de l'interface Paramètres) |
| `SOFFICE_PATH` | auto-détecté | Chemin complet du binaire LibreOffice (`soffice`) |
| `PDFTOPPM_PATH` | auto-détecté | Chemin complet du binaire Poppler (`pdftoppm`) |

## Conversion PowerPoint / PDF

Pour afficher les documents PowerPoint (PPT/PPTX/PPS/PPSX/ODP) et PDF, le serveur a besoin de **LibreOffice** (PPT → PDF) et de **Poppler** (PDF → PNG par diapositive). Installez-les une seule fois :

```bash
sudo bash deploy/linux/install-tools.sh    # Linux — multi-distributions, idempotent
```

`install.bat` s'en charge sous Windows. L'état des conversions est visible dans la bibliothèque de médias (badge + bouton *Reconvertir*). Sans ces outils, tous les autres types de médias continuent de fonctionner.

## Lecteurs

**Lecteur web** — tout appareil avec un navigateur : ouvrez `http://<ip-serveur>:3000/player?key=<clé-matérielle>` en plein écran (F11 / mode kiosque).

**Lecteur Android** — la v3.4 « antitag » corrige les saccades qui pouvaient persister après la v3.3 sur les vidéos H.264/H.265 de bonne qualité, et répare une lacune de la v3.3 : la modification v3.3 des tampons visait `DefaultLoadControl$Builder`, mais `ExoPlayer$Builder.build()` obtient en réalité son `LoadControl` par défaut via une lambda qui fait directement `new DefaultLoadControl()` — les vrais seuils de démarrage/reprise étaient restés à 2500/5000 ms. La v3.4 corrige ce constructeur exact : démarrage de la lecture avec 5 s de tampon, reprise après interruption avec 10 s d'avance, et réservoir réduit de 50 s à 20 s — sur un réseau plus lent que le débit de la vidéo, la lecture ne bascule plus en cycles stop/reprise, et à haut débit (ex. 20 Mb/s) le tampon ne grossit plus jusqu'à ~125 Mo de byte[] en mémoire Java (la pression GC et les erreurs mémoire sur box peu puissante sont une cause cachée fréquente de saccades et d'erreurs décodeur intempestives). (2) Une erreur ExoPlayer ne bascule plus immédiatement sur libVLC en décodage logiciel, qui saccade sur H.264/H.265 dès que l'appareil n'a pas de décodeur matériel : la lecture est d'abord relancée 2 fois (les erreurs réseau/serveur transitoires se rétablissent en transparence) et le repli VLC n'arrive qu'après 3 échecs réels ; le compteur se réarme dès que la lecture est prête. (3) Quand le widget vidéo est muet (défaut du CMS), la piste audio n'est plus décodée du tout, ce qui économise CPU et mémoire. (4) Le chemin libvlc logiciel gagne `--avcodec-skiploopfilter=1` (économie CPU par image quand le décodage se fait sans décodeur matériel). La v3.3 « lecture-fluide » avait déjà supprimé les options libvlc `--no-drop-late-frames`/`--no-skip-frames` qui forçaient le décodage de toutes les images et accumulaient du retard dès que le décodeur ne suivait pas, et fait passer le moteur VLC par SurfaceView (chemin matériel direct, sans copie GPU par image) au lieu de TextureView. Les MP4/MKV H.264/H.265 non-stream passent par ExoPlayer (décodage matériel Android) ; après des échecs de décodeur répétés, bascule automatique sur libVLC — d'où l'importance de ces correctifs pour ce chemin de repli. Conseil d'encodage pour les box peu puissantes : H.264 Main/High, 1080p, 4-8 Mb/s, AAC 128 kb/s, `+faststart` (`ffmpeg -i entree.mp4 -c:v libx264 -profile:v main -b:v 6M -c:a aac -b:a 128k -movflags +faststart sortie.mp4`) ; H.265/HEVC n'est fluide qu'avec un décodeur matériel présent sur l'appareil. La v3.2 « démarrage-corrigée » répare la v3.1, qui plantait au lancement sur certains appareils (notamment Xiaomi/MIUI) avec `java.lang.VerifyError: Verifier rejected class com.signagecms.player.MainActivity — renderLayout failed to verify: 'this' argument 'java.lang.Object' not instance of 'android.view.ViewGroup'`. Cause exacte : le patch v3.1 calculait la signature de la présentation dans le registre `v0`, que le code d'origine réutilisait ensuite comme constante nulle (`move-object v1, v0` / `start$default(..., v0)`) ; le vérificateur ART fusionnait donc deux types incompatibles en `Object` et rejetait la classe entière au chargement — l'application ne s'ouvrait même pas. Le correctif restaure la constante nulle au point de fusion (une seule instruction `const/4 v0, 0x0`) et supprime au passage une étiquette d'erreur dupliquée dans la vue VLC ; tout le reste de la v3.1 est inchangé. La v3.1 « lecture-continue » corrigeait les redémarrages périodiques qui rendaient les présentations inutilisables : `RegionView` détruisait et recréait la vue du widget à CHAQUE cycle de région, même pour une région à widget unique — un PowerPoint de 14 slides dont le widget dure 10 s ne pouvait montrer que ses 2 premières slides (le diaporama repartait de la slide 1 à chaque cycle), l'IPTV et la vidéo se reconnectaient avec un flash noir à chaque cycle, et les vidéos repartaient de 0:00 en boucle — alors que le lecteur web garde le même widget vivant. La v3.1 conserve la vue quand c'est le même widget qui est ré-affiché, et `MainActivity` saute la reconstruction complète quand le contenu de la présentation récupérée est inchangé (rotation/rafraîchissement planning) : la lecture continue sans coupure, comme sur le web. La v3.1 corrige aussi la gestion d'erreur VLC introduite en v3.0 : la vraie constante libVLC `EncounteredError` est 0x10a (la v3.0 testait 0x110, un événement jamais émis, donc un flux cassé restait en écran noir silencieux) ; les erreurs déclenchent désormais des tentatives bornées avec back-off (3 s / 6 s / 9 s), le compteur se remet à zéro dès que la lecture redémarre, et après 3 échecs consécutifs le flux s'arrête et une étiquette explicite remplace l'écran noir. La v3.0 complétait la couverture média (vérifiée de bout en bout sur le JSON de layout consommé par le player) : vidéos (mp4/webm/mov/mkv/avi/mpg/mpeg/3gp/ts → ExoPlayer, conteneurs exotiques et flux rtsp/rtmp/udp → libVLC avec bascule automatique), images (png/jpg/jpeg/gif/webp/svg/bmp/ico/tiff), PowerPoint (ppt/pptx/pps/ppsx/odp) et PDF — tous deux convertis côté serveur en slides PNG dont les URLs sont rendues absolues avant affichage, IPTV (m3u8/HLS, TS, rtsp…), pages web, texte, horloge, météo et RSS. La v2.9 corrigeait un crash `java.lang.NoSuchFieldError` au démarrage : `MainActivity` lisait et écrivait deux champs de cache (`lastAppliedW` / `lastAppliedH`) jamais déclarés dans la classe, si bien que la toute première passe de mise en page après `onCreate` mourait. Les deux champs sont restaurés, ce qui conserve la garde d'origine « ne pas re-rendre si la taille n'a pas changé ». La v2.8 corrigeait un crash `java.lang.VerifyError` sur certains appareils (notamment Xiaomi/MIUI) : le vérificateur ART rejetait `Json.parseLayout` car un registre contenant la longueur sauvegardée du tableau regions était réutilisé pour la nouvelle instance `Widget`. Versions précédentes : v3.1 (lecture-continue), v3.0 (URLs de slides absolues + bascule VLC), v2.9 (champs restaurés), v2.8 (correctif parsing layout), v2.7 (rendu durci), v2.6 (build rapport de crash), v2.5 (stabilisation de la connexion). Lorsqu'ils sont hébergés par le CMS, les APK sont servis depuis `/apk/` — ex. `http://<ip-serveur>:3000/apk/SignageCMS-Player-v3.4-antitag.apk`.

Le lecteur s'enregistre auprès du serveur (`/api/player/register`), récupère sa programmation (`/api/player/schedule`), envoie ses battements de cœur (`/api/player/heartbeat`) et remonte ses statistiques de diffusion (`/api/player/stats`).

## Principales routes API

| Route | Rôle |
|---|---|
| `GET /api/version` | Version du serveur (utilisée par install.sh pour la vérification finale) |
| `GET /api/server-info` | Informations serveur/port |
| `POST /api/auth/login` · `/logout` · `/me` | Gestion des sessions (JWT) |
| `GET|POST /api/resource/<ressource>` · `.../[id]` | CRUD écrans, médias, playlists, présentations, campagnes, événements, utilisateurs… |
| `POST /api/upload` | Téléversement des médias |
| `GET /api/player/register` · `schedule` · `heartbeat` · `stats` | Protocole lecteur |
| `POST /api/ldap/sync` | Import des utilisateurs LDAP/AD |
| `GET /api/iptv/*` | Fournisseurs IPTV, playlists, chaînes, proxy |

## Documentation

Le guide d'installation et d'utilisation complet (43 pages — Windows + Linux, avec captures d'écran) accompagne la distribution :

**`Guide-Installation-Utilisation-SignageCMS-v3.11.12.pdf`** — également servi sur `/downloads/Guide-Installation-Utilisation-SignageCMS-v3.11.12.pdf` lorsque le CMS l'héberge.

## Dépannage

| Symptôme | Solution |
|---|---|
| Le serveur ne démarre pas | Consultez `service.log` (mode daemon) ; vérifiez que `.env` existe et que `DATABASE_URL` pointe vers un chemin inscriptible |
| PPT/PDF bloqué sur « Non converti » | Installez LibreOffice + Poppler (`install-tools.sh`), redémarrez le serveur, cliquez *Reconvertir* |
| Le build échoue ou est tué | Libérez de la RAM (le build demande ~2 Go : `NODE_OPTIONS=--max-old-space-size=2048 npm run build`) |
| Le lecteur affiche l'horloge d'attente | Aucun événement de programmation actif pour cet écran — vérifiez la page *Planification* et la clé matérielle de l'écran |
| Les vidéos ne se lisent pas sur le lecteur Android (le web marche ou rame) | Le serveur doit répondre aux médias en HTTP **206 Partial Content**. Contrôlez : `curl -s -o /dev/null -w '%{http_code}' -H 'Range: bytes=0-1023' http://<serveur>:3000/uploads/<fichier>.mp4` — si le code est `200`, relancez le serveur avec **Node.js** (`node .next/standalone/server.js`) et jamais avec Bun (les runtimes de type Bun cassent le support des requêtes Range, indispensables aux lecteurs vidéo) |
| Les vidéos H.264/H.265 de bonne qualité saccadent sur le lecteur Android | Installez le lecteur **v3.4 « antitag »** (les vrais tampons ExoPlayer sont désormais corrigés — la modification v3.3 visait un chemin de code non utilisé — réservoir 20 s, 2 relances Exo avant le repli VLC, audio non décodé quand muet, skiploopfilter libvlc). Si la saccade persiste, la vidéo dépasse les capacités de décodage de l'appareil : ré-encodez en H.264 Main/High 1080p 4-8 Mb/s avec `-movflags +faststart` ; H.265/HEVC n'est fluide qu'avec un décodeur matériel présent sur l'appareil |
| Mot de passe admin oublié | Régénérez les identifiants sur le serveur, puis redémarrez |
| Port déjà utilisé | Changez `PORT` dans `.env` ou passez `--port` à `install.sh`, puis redémarrez |

## Notes de version

- **3.11.15** — le champ « Durée (s) » est RETIRÉ des dialogues de la bibliothèque de médias (téléversement et « Modifier le média ») : c'était une métadonnée sans effet sur la lecture — la durée réelle d'affichage se règle sur chaque widget de présentation (éditeur de présentations) ou chaque élément de playlist, et c'est elle que les lecteurs appliquent. La colonne `duration` reste en base (valeur par défaut à l'import) pour la compatibilité ; la fiche média n'affiche plus de durée trompeuse.
- **3.11.14** — le bouton volume/muet est SUPPRIMÉ du lecteur web (`/player`) : le son est désormais piloté UNIQUEMENT depuis le CMS — la case « Démarrer muet » du widget vidéo ou l'interrupteur « Muet » du widget IPTV dans l'éditeur de présentation est l'unique source de vérité, sur toutes les surfaces de lecture (lecteur web et aperçus admin). La préférence son locale mémorisée (localStorage) est retirée avec le bouton : un appareil ayant déjà dé-mu via l'ancien bouton ne peut plus passer outre la configuration CMS. Le durcissement du démarrage de la v3.11.13 est conservé (le premier toucher sur la page relance toujours la lecture et rétablit le son voulu par le CMS quand le navigateur l'avait imposé muet).
- **3.11.13** — les vidéos du lecteur web ne restent plus figées jusqu'au clic sur le bouton volume : l'attribut `muted` est posé avant le chargement (politique d'autoplay des navigateurs), la lecture est explicitement orchestrée avec repli muet, et le premier toucher sur la page rétablit le son demandé par l'utilisateur (préférence mémorisée). Même durcissement pour les widgets IPTV. NB : les lecteurs vidéo (web et APK) exigent un serveur qui répond **206** aux requêtes Range sur les médias — lancez toujours le serveur avec Node.js, pas Bun.
- **3.11.12** — les campagnes en boucle désactivée sont désormais jouées exactement une fois (précédemment : figeage sur la dernière page) ; `install.sh` durci (mode non privilégié, vérifications anti-faux-OK, sondes d'outils avec délai d'attente).
- **Installateurs 3.11.11 / 3.11.12** — `install.sh` (installation Linux complète), `start.sh` (contrôle du processus), `install-tools.sh` (LibreOffice + Poppler seuls).
- Voir `VERSION` pour la version courante du serveur et le guide PDF pour l'historique complet.
