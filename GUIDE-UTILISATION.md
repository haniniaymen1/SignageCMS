# Guide d'utilisation — SignageCMS v3.11

Bienvenue dans le guide complet de **SignageCMS**, le serveur de gestion
d'affichage dynamique. Ce document décrit toutes les fonctionnalités de
l'interface, étape par étape, avec les bonnes pratiques et les solutions aux
incidents courants.

**Sommaire**

1. [Présentation générale](#1-présentation-générale)
2. [Installation et premier démarrage](#2-installation-et-premier-démarrage)
3. [Première connexion et comptes](#3-première-connexion-et-comptes)
4. [Tableau de bord](#4-tableau-de-bord)
5. [Écrans et groupes d'écrans](#5-écrans-et-groupes-décrans)
6. [Bibliothèque de médias](#6-bibliothèque-de-médias)
7. [Playlists](#7-playlists)
8. [Présentations (layouts) et concepteur](#8-présentations-layouts-et-concepteur)
9. [Campagnes](#9-campagnes)
10. [Planification](#10-planification)
11. [Pages web interactives](#11-pages-web-interactives)
12. [TV / IPTV](#12-tv--iptv)
13. [Rapports et preuves de diffusion](#13-rapports-et-preuves-de-diffusion)
14. [Utilisateurs, rôles et permissions](#14-utilisateurs-rôles-et-permissions)
15. [Authentification LDAP / Active Directory](#15-authentification-ldap--active-directory)
16. [Paramètres](#16-paramètres)
17. [Le lecteur : web et Android](#17-le-lecteur-web-et-android)
18. [Sécurité au quotidien](#18-sécurité-au-quotidien)
19. [Dépannage](#19-dépannage)
20. [Annexes : scripts Windows et variables d'environnement](#20-annexes-scripts-windows-et-variables-denvironnement)

---

## 1. Présentation générale

SignageCMS est un système d'affichage dynamique complet organisé autour de trois
composants complémentaires. Le **serveur CMS** (cette application) héberge la
bibliothèque de médias, la construction des présentations, la planification et
tous les réglages ; il tourne sur un ordinateur du réseau local (ou un serveur)
et expose une interface web d'administration sur le port 3000. Le **lecteur
web** (`/player`) est une page plein écran destinée aux écrans équipés d'un
navigateur, d'une box TV ou d'un mini-PC : elle affiche le contenu planifié et
se synchronise automatiquement. L'**application Android** (SignageCMS Player
v2.4) offre la même expérience sur tablettes et téléviseurs Android, avec un
moteur natif (ExoPlayer/VLC) plus robuste pour la vidéo et l'IPTV.

La chaîne de travail est la même quel que soit le lecteur : vous importez des
**médias**, vous les assemblez en **playlists** et en **présentations**
(mises en page par régions et widgets), vous regroupez éventuellement plusieurs
présentations en **campagnes**, puis vous planifiez des **événements** qui
programment quoi afficher, quand, et sur quels écrans. Chaque écran est
identifié par une **clé matérielle** unique — c'est elle qui relie le lecteur
(affiché en plein écran sur l'écran, ou installé en APK) au CMS, sans compte
utilisateur.

Le système gère nativement les cas d'usage avancés : affichage de **pages web
interactives** (y compris les sites qui refusent l'iframe, via le proxy intégré),
diffusion de **flux TV/IPTV** avec partage intelligent des connexions et
timeshift, conversion automatique des **PowerPoint et PDF** en diapositives,
import d'utilisateurs depuis **Active Directory/LDAP**, et preuves de diffusion
pour vérifier ce qui a réellement été affiché.

## 2. Installation et premier démarrage

### 2.1 Installation sous Windows (recommandée)

1. Copiez le dossier du projet sur le serveur, par exemple `C:\SignageCMS`
   (les chemins avec espaces ou parenthèses sont acceptés).
2. Vérifiez le prérequis unique : **Node.js 20 LTS ou 22 LTS**
   (https://nodejs.org, options par défaut). LibreOffice et Poppler sont
   facultatifs (conversion PowerPoint/PDF — voir § 6.4).
3. Double-cliquez **`deploy\windows\install.bat`**. Le script :
   - vérifie Node.js et npm ;
   - crée le fichier `.env` avec le chemin de la base calculé depuis le dossier
     d'installation réel ;
   - installe les dépendances (5 à 10 minutes) ;
   - prépare la base SQLite (`db\custom.db`) et le client Prisma ;
   - compile la version production (2 à 6 minutes).
4. Au terme de l'installation, double-cliquez **`deploy\windows\start-cms.bat`**.
   Le serveur démarre sur http://localhost:3000.
5. Pour que les écrans du réseau y accèdent : clic droit sur
   **`deploy\windows\firewall.ps1`** → *Exécuter avec PowerShell* (en
   administrateur) — le port 3000 est ouvert.

Deux fichiers journaux restent disponibles en cas de problème :
`deploy\windows\install-cms.log` et `deploy\windows\build-cms.log`.

### 2.2 Installation Linux / macOS

```bash
npm install
npx prisma db push && npx prisma generate
npm run build            # cross-platform (Windows, Linux, macOS)
npm run start:standalone # port 3000
```

Créez un fichier `.env` à la racine si besoin :
`DATABASE_URL=file:/chemin/absolu/db/custom.db` (slashes obligatoires).

### 2.3 Après redémarrage du serveur

Relancez simplement `start-cms.bat`. Pour un démarrage automatique au boot de
Windows, exécutez `deploy\windows\install-service.ps1` en administrateur : il
installe un service Windows (avec NSSM si disponible, sinon une tâche planifiée
SYSTEM) qui relance le serveur en cas de crash. Désinstallation :
`nssm remove SignageCMS confirm` ou `schtasks /Delete /TN SignageCMS /F`.

### 2.4 Recompiler après une mise à jour

Après avoir remplacé des fichiers du code source, lancez
**`deploy\windows\build.bat`** puis redémarrez `start-cms.bat`. N'exécutez pas
`install.bat` à nouveau : il retraiterait toutes les dépendances (sans risque,
mais inutilement long).

## 3. Première connexion et comptes

Ouvrez http://localhost:3000 (depuis le serveur) ou
`http://ADRESSE-IP-DU-SERVEUR:3000` (depuis n'importe quel poste du réseau).

- **Utilisateur** : `admin`
- **Mot de passe initial** : il n'existe **aucun mot de passe par défaut**. À la
  première création du compte, le serveur génère un mot de passe **aléatoire**
  qui s'affiche une fois dans la console de `start-cms.bat` et est enregistré
  dans **`db\admin-credentials.txt`**.
- Connectez-vous, ouvrez le menu **Utilisateurs**, changez le mot de passe de
  `admin` (ou créez votre compte personnel), puis **supprimez**
  `db\admin-credentials.txt`.

Si le message « Aucun mot de passe défini pour ce compte » apparaît (comptes
importés du LDAP sans mot de passe local), c'est normal : ces comptes
s'authentifient par le serveur LDAP ; un administrateur peut leur définir un
mot de passe local de secours depuis *Utilisateurs*.

**Rôles disponibles** : `admin` (tout), `user` (tout sauf comptes et paramètres
en écriture, par défaut), `read-only` (consultation seule). La matrice précise
des droits par module est réglable par l'admin (§ 14).

**Mot de passe oublié** : un admin peut le réinitialiser pour n'importe quel
compte (ce qui déconnecte immédiatement toutes les sessions de ce compte). Si
le mot de passe `admin` est perdu sans autre compte admin, supprimez le compte
admin de la base (ou la base elle-même) puis relancez le serveur : un nouveau
mot de passe aléatoire est généré.

## 4. Tableau de bord

Le tableau de bord est la page d'accueil après connexion. Il rassemble :

- **Cartes de statistiques** : écrans connectés (en ligne / total), nombre de
  médias, de présentations, de chaînes IPTV, de planifications, d'utilisateurs
  et de playlists — un clic sur certaines cartes ouvre directement le module.
- **Graphique d'activité (7 jours)** : lectures et bande passante estimée à
  partir des preuves de diffusion.
- **Derniers journaux** : les 8 derniers événements serveur (connexions
  d'écrans, erreurs, actions) — utile pour vérifier immédiatement qu'un écran
  vient bien de se connecter.

Le tableau de bord respecte les permissions : un compte « lecture seule » le
consulte, un compte sans droit « voir » sur le module n'y accède pas.

## 5. Écrans et groupes d'écrans

Le module **Écrans** gère l'inventaire des lecteurs. Chaque écran possède un
**nom**, une **clé matérielle** (`hardwareKey`) unique qui l'identifie
auprès du CMS, une résolution, un statut (`online` / `offline` / `error`) mis
à jour par battements de cœur réguliers, et une date de dernière connexion.

### 5.1 Créer et connecter un écran

1. **Écrans → Nouvel écran** : saisissez un nom (ex. « Hall d'accueil ») et,
   facultativement, une description et une résolution.
2. Ouvrez le lecteur sur l'écran : page `http://SERVEUR:3000/player` pour le
   lecteur web, ou l'application Android.
3. **Lecteur web** : cliquez sur la roue dentée du lecteur, choisissez votre
   écran dans la liste (ou saisissez sa clé) — la liaison est immédiate.
4. **Application Android** : installez `SignageCMS-Player-v2.4-universal.apk`,
   saisissez l'adresse du serveur puis la clé de l'écran. Pour éviter la saisie
   manuelle, utilisez **Écrans → ⋯ → Connecter Android** : le dialogue affiche
   l'adresse réseau réelle du serveur (localhost y est remplacé
   automatiquement), la clé de l'écran et un **QR code** que l'application peut
   scanner. Le bouton *Tester* vérifie que l'APK répond bien au serveur.

### 5.2 Groupes, affectation et actions

- **Groupes d'écrans** : créez des groupes (ex. « Vitrines », « Étages ») pour
  cibler une planification entière en une fois. Un écran n'appartient qu'à un
  groupe à la fois.
- **Présentation par défaut** : affectez une présentation à l'écran (ou au
  groupe) : elle s'affiche quand aucun événement planifié n'est actif.
- **Menu ⋯ de l'écran** : *Connecter Android* (QR code), *Aperçu* (visualisez
  en direct ce que montre l'écran), édition, déplacement de groupe, suppression.
- **Mode incognito** : l'écran est affiché sans nom identifiable dans les
  listes (utile pour les environnements sensibles).
- Un écran vu en ligne il y a plus de quelques minutes repasse automatiquement
  hors ligne — aucun débranchement manuel à gérer.

**Bonne pratique** : nommez les écrans selon leur emplacement physique et
regroupez-les par zone de diffusion dès la mise en service ; la planification
en est considérablement simplifiée.

## 6. Bibliothèque de médias

Le module **Médias** centralise tout ce qui peut être diffusé. L'import se fait
par glisser-déposer ou bouton *Importer*, avec une **barre de progression** et
des messages d'erreur explicites en cas de refus.

### 6.1 Formats acceptés

| Catégorie | Formats |
|---|---|
| Images | PNG, JPG, JPEG, GIF, WebP, SVG, BMP, ICO, TIFF |
| Vidéos | MP4, WebM, MOV, MKV, AVI, M4V, MPEG/MPG, 3GP, TS |
| Audio | MP3, WAV, OGG, M4A, AAC, FLAC |
| Documents | PDF |
| Présentations | PPT, PPTX, PPS, PPSX, ODP |
| Données | JSON, CSV, XLSX, XLS |

La **taille maximale** est réglable dans *Paramètres* (50 Mo par défaut,
surchargeable par la variable `MAX_UPLOAD_MB`). Le serveur refuse l'import si
l'espace disque passe sous 100 Mo (protection anti-saturation) et l'indique
clairement.

### 6.2 Conversion automatique PowerPoint / PDF

Un PPT/PPTX/ODP ou un PDF importé est automatiquement **converti en suite de
diapositives images** (conversion côté serveur). Chaque diapositive devient une
image exploitable comme les autres médias — dans une playlist, une région, une
campagne. La conversion nécessite les outils optionnels ci-dessous ; sans eux,
le fichier est accepté mais non converti.

### 6.3 Gestion de la bibliothèque

- Recherche par nom, tri par date, fiche détaillée (type, taille, durée
  d'affichage par défaut, nombre de diapositives).
- **Modifier** : renommer, changer la durée d'affichage par défaut (utilisée
  dans les playlists), remplacer le fichier.
- **Supprimer** : le fichier est retiré de la bibliothèque ; les playlists et
  présentations qui l'utilisaient affichent un emplacement vide — retirez-les
  des séquences concernées.
- Les médias sont servis sous `/uploads/…` avec des noms générés côté serveur ;
  les lecteurs d'écrans les chargent sans compte utilisateur (clé matérielle).

### 6.4 Activer la conversion PowerPoint / PDF (Windows, facultatif)

- **LibreOffice** (PPT/PPTX/ODP) : installez-le par défaut
  (https://fr.libreoffice.org) ; le serveur le détecte automatiquement au
  prochain démarrage.
- **Poppler** (PDF) : téléchargez la version Windows, extrayez-la dans
  `C:\poppler` (le chemin `C:\poppler\Library\bin\pdftoppm.exe` doit exister),
  puis relancez `start-cms.bat`.

## 7. Playlists

Une **playlist** est une séquence ordonnée de médias, jouée l'un après l'autre.
Elle se construit dans le module **Playlists** : créez la playlist, ajoutez des
médias depuis la bibliothèque, réordonnez par glisser-déposer, et réglez la
**durée d'affichage** de chaque élément (les images et documents suivent cette
durée ; les vidéos et audios se jouent en entier par défaut).

Les playlists s'utilisent comme contenu d'une **région** de présentation
(§ 8) : une colonne d'annonces qui tourne en boucle, une bande d'images, une
zone de textes défilants alimentée par un CSV… La lecture en boucle est pilotée
par l'événement de planification (§ 10) : ON pour reprendre au début, OFF pour
un unique passage puis arrêt sur le dernier contenu.

## 8. Présentations (layouts) et concepteur

Une **présentation** (layout) définit la mise en page d'un écran : un fond et
une ou plusieurs **régions** rectangulaires, chacune recevant un ou plusieurs
**widgets**. Le **concepteur** intégré permet de tout faire à la souris :

1. **Nouvelle présentation** : nommez-la, choisissez la résolution cible
   (1920×1080 par défaut).
2. **Ajoutez des régions** : positionnez-les et redimensionnez-les
   (glisser-déposer), ou saisissez des coordonnées précises (x, y, largeur,
   hauteur en pixels).
3. **Remplissez chaque région avec un widget** :

| Widget | Rôle |
|---|---|
| Média | Image, vidéo, audio ou diapositive de la bibliothèque |
| Playlist | Séquence de médias en rotation (§ 7) |
| Texte | Titre ou bloc de texte libre (taille, couleur) |
| Texte défilant | Bandeau horizontal continu (marquee) |
| Horloge | Heure, au format 24 h, habillage réglable |
| Météo | Conditions et température d'une ville |
| Page web | Site ou application web intégrée (§ 11) |
| IPTV | Flux TV directement dans une région (§ 12) |
| Compte à rebours | Jours/heures restantes avant une date clé |
| RSS | Fil d'actualités titres défilants |

4. **Aperçu** : visualisez le rendu exact ; chaque région est zommable.
5. Enregistrez : la présentation devient disponible dans les campagnes et la
   planification.

**Présentations multi-écrans** : la même présentation peut être affectée à
plusieurs écrans ou groupes. Les lecteurs la récupèrent automatiquement et la
mettent à l'échelle de leur résolution réelle.

## 9. Campagnes

Une **campagne** regroupe plusieurs **présentations jouées en séquence** :
idéal pour les programmations thématiques (matinée/midi/soir, rotations
commerciales hebdomadaires). Dans le module **Campagnes** :

1. **Nouvelle campagne** : nom explicite (ex. « Vitrine — programme du jour »).
2. **Gérer les présentations** : ajoutez les présentations dans l'ordre voulu,
   réordonnez-les par glisser-déposer, définissez la **durée** de chacune.
3. À la diffusion, l'écran enchaîne toutes les présentations de la campagne ;
   la campagne se comporte ensuite comme une présentation unique dans la
   planification (elle peut être ciblée par un événement, affectée par défaut à
   un écran, etc.).

La boucle ON/OFF d'un événement s'applique aussi aux campagnes : OFF = la
séquence complète joue une fois puis le dernier écran reste affiché ; ON =
reprise cyclique immédiate.

## 10. Planification

Le module **Planification** programme **quoi afficher, quand et où**. C'est le
cœur opérationnel du système au quotidien.

### 10.1 Créer un événement

1. **Nouvel événement** : donnez un titre, choisissez le contenu (présentation
   ou campagne) et la cible :
   - **Tous les écrans** ;
   - **Un groupe** d'écrans ;
   - **Une liste d'écrans** (sélection multiple).
2. Définissez la **fenêtre de diffusion** : date et heure de début, date et
   heure de fin (au format 24 h).
3. **Répéter en boucle** (switch, ON par défaut — nouveauté v3.8/v3.10) :
   - **ON** : à la fin du contenu, reprise immédiate au début (comportement
     boucle infinie) ;
   - **OFF** : le contenu joue **une seule fois**, puis le dernier contenu reste
     affiché jusqu'à la fin de la fenêtre.
   Ce réglage est **persisté en base, par événement** : modifiable à tout
   moment sans recréer l'événement, conservé après redémarrage du serveur et
   des lecteurs. La liste « Prochaines diffusions » et les info-bulles du
   calendrier affichent le badge **Boucle ON/OFF** de chaque événement.
4. Enregistrez : l'événement apparaît dans le calendrier et les écrans ciblés
   le prennent en compte à leur prochaine synchronisation (60 s maximum).

### 10.2 Calendrier et gestion des conflits

- Vue **calendrier par jour** : chaque événement occupe une plage horaire ;
  les événements **chevauchants sont répartis en colonnes lisibles** (lanes) —
  plus de superposition illisible.
- **Détection de conflits** : si deux événements ciblent le même écran sur la
  même plage, le système le signale ; l'événement **commençant le plus
  récemment prend la priorité**, puis les écrans reviennent à la présentation
  par défaut ou à l'événement encore actif le plus récent.
- **Modifier un événement** : tous les champs restent éditables (contenu,
  cibles, horaires, boucle) ; la modification est propagée aux lecteurs sans
  intervention sur les écrans.
- **Supprimer** : retire l'événement ; les écrans reprennent leur programmation
  résiduelle (autres événements actifs ou présentation par défaut).

**Bonne pratique** : pour une récurrente quotidienne (ex. 07:00–19:00), créez
l'événement avec les dates du premier jour puis dupliquez-le, ou programmez les
occurrences à l'avance — le calendrier donne une vue de contrôle rapide.

## 11. Pages web interactives

Le widget **Page web** affiche un site dans une région du lecteur. Les sites
qui envoient des en-têtes de refus d'intégration (`X-Frame-Options`, CSP
`frame-ancestors` — BBC, Météo-France, la plupart des portails) sont gérés
**automatiquement** :

- **Mode « Automatique » (par défaut)** : le lecteur tente l'iframe direct ; si
  le site refuse, il bascule seul sur le **proxy de pages intégré** du serveur
  — la page est récupérée par le CMS, les en-têtes de refus ne sortent jamais,
  et le contenu reste **entièrement interactif** (liens, boutons, formulaires,
  saisie de texte, connexions). Un indicateur discret « Via proxy CMS » est
  affiché.
- Sur l'**APK Android v2.4**, le WebView natif affiche tout site sans
  restriction (clavier virtuel, dialogues, User-Agent Chrome réel).

**Limites techniques documentées** : les WebSocket ne passent pas par le proxy ;
les redirections JavaScript cross-origin absolues peuvent échapper au proxy
(la page affiche alors un diagnostic clair avec bouton « Réessayer ») ; les
sites à protection anti-robot agressive peuvent limiter l'affichage proxifié.

**Sécurité v3.11** : le proxy n'accepte que des **sites publics** — les
adresses internes/privées (LAN, localhost, métadonnées cloud) sont refusées
(garde anti-SSRF). Une page intranet doit être affichée en iframe direct ou
hébergée comme média.

## 12. TV / IPTV

Le module **TV / IPTV** transforme le CMS en tête de réseau TV interne. Il
gère deux types de sources : les **comptes Xtream** (portail avec identifiants)
et les **listes M3U/M3U8** (URL de playlist, y compris les listes publiques
pré-configurées comme iptv-org).

### 12.1 Ajouter des sources

- **Compte Xtream** : saisissez l'URL du portail, l'identifiant et le mot de
  passe ; le CMS récupère les catégories, les chaînes LIVE, la VOD et les
  séries (synchronisation). Les identifiants sont stockés côté serveur et ne
  sont jamais renvoyés au navigateur.
- **Playlist M3U** : collez une URL ; les très grandes listes (plusieurs
  milliers de chaînes) sont prises en charge avec recherche instantanée.

### 12.2 Diffuser sur les écrans

1. Dans le concepteur de présentation, ajoutez un widget **IPTV** à une région
   et choisissez la chaîne.
2. Le flux passe par le **proxy IPTV intégré** : `…/api/iptv/proxy?url=…`.
3. Tous les écrans du CMS peuvent ainsi lire des flux qu'un navigateur seul ne
   pourrait pas ouvrir (CORS, HTTPS mixte, portails capricieux).

### 12.3 Partage de connexions, pool et timeshift

- **Un flux = une connexion** chez le fournisseur : quand **plusieurs écrans
  regardent la même chaîne, le CMS n'ouvre qu'une seule connexion amont** et la
  redistribue à tous (hub interne) — la plupart des fournisseurs limitent le
  nombre de connexions simultanées par abonnement.
- **Pool de connexions** : si le compte d'origine est saturé, le CMS cherche
  automatiquement la même chaîne **chez les autres comptes du pool** et
  répartit la charge. Le **mode strict** (Paramètres) interdit tout dépassement
  de quota et refuse proprement (HTTP 429) pour éviter le ban du fournisseur.
- **Bascule de secours** : un portail qui refuse (401/403/429) déclenche une
  re-tentative automatique sur les sources alternatives.
- **Timeshift** : dans le dialogue du widget, ajoutez un **décalage en
  secondes** (ex. 60) : le flux est enregistré côté serveur et redistribué avec
  le retard demandé — toujours une seule connexion amont, quel que soit le
  nombre d'écrans décalés.
- **Diagnostic** : le bouton *Diagnostic* du lecteur affiche précisément
  pourquoi un flux refuse (quota atteint, identifiants, IP bloquée…) et
  propose la **lecture directe** en secours.

**Sécurité v3.11** : comme le proxy de pages, le proxy IPTV refuse les
adresses internes/privées.

## 13. Rapports et preuves de diffusion

Le module **Rapports** rassemble deux vues complémentaires :

- **Journaux (logs)** : toute l'activité serveur horodatée — connexions et
  déconnexions des écrans, connexions utilisateurs, imports, erreurs. La
  recherche par niveau (info/avertissement/erreur) et par écran permet de
  retracer un incident (« l'écran 3 a-t-il bien redémarré à 8 h ? »).
- **Preuves de diffusion (proof-of-play)** : chaque élément effectivement
  affiché par chaque lecteur est enregistré (média, écran, date, durée). C'est
  la traçabilité facturable : vous pouvez **prouver** qu'une campagne a bien
  tourné sur tel écran à telle heure, et exporter les données pour
  facturation ou reporting.

Le graphique d'activité du tableau de bord est calculé à partir de ces preuves.
Les preuves sont produites par le lecteur (paramètre activable dans les
réglages du lecteur) et remontées par battements réguliers.

## 14. Utilisateurs, rôles et permissions

Le module **Utilisateurs** (réservé aux admins) gère les comptes locaux :

- **Créer un compte** : identifiant, nom, e-mail, rôle (`admin`, `user`,
  `read-only`), mot de passe (min. 4 caractères à la création ; le changement
  personnel exige 6 caractères), statut actif/désactivé, groupe.
- **Groupes d'utilisateurs** : organisation libre (équipes, prestataires) ;
  le groupe peut être pré-affecté aux comptes importés du LDAP.
- **Réinitialiser un mot de passe** : l'admin saisit un nouveau mot de passe ;
  **toutes les sessions en cours du compte sont immédiatement révoquées**.
- **Auto-protections** : impossible de désactiver ou supprimer son propre
  compte, impossible de se retirer le rôle admin, impossible de supprimer le
  dernier administrateur.
- Chaque utilisateur peut changer son propre mot de passe depuis le menu de
  profil (l'ancien est exigé).

### Matrice de permissions (module Permissions)

L'admin définit, pour les rôles non-admin, les actions autorisées **module par
module** : Tableau de bord, Écrans, Médias, TV/IPTV, Présentations, Playlists,
Campagnes, Planification, Rapports, Utilisateurs, Paramètres — et pour chaque
module : Voir / Créer / Modifier / Supprimer. La matrice est enregistrée en
base et appliquée côté serveur sur **chaque** appel d'API (pas seulement dans
l'interface). Les valeurs par défaut : `user` = tout sauf comptes/paramètres en
écriture ; `read-only` = consultation seule.

## 15. Authentification LDAP / Active Directory

SignageCMS peut déléguer l'authentification à un annuaire **LDAP ou Active
Directory**. La configuration (module Paramètres → LDAP) comprend :

- **URL** du serveur (`ldap://hote:389` ou `ldaps://hote:636`) ;
- **compte technique** (bind DN + mot de passe) — le mot de passe est stocké
  côté serveur, jamais renvoyé au navigateur (champ masqué « •••••••• ») ;
- **Base DN** et **OU d'import** : utilisez le sélecteur d'**unités
  d'organisation** pour choisir précisément la branche à importer ;
- **Filtre** (par défaut `(objectClass=person)`) et **attributs** (identifiant :
  `uid` pour OpenLDAP, `sAMAccountName` pour Active Directory ; e-mail ; nom) ;
- **rôle par défaut** et **groupe** attribués aux comptes importés ;
- bouton **Tester** (vérifie le bind et affiche le contexte de nommage),
  **Aperçu** (liste les utilisateurs trouvés avant import), **Importer** et
  **Synchroniser**.

À la connexion, le compte local passe d'abord ; à défaut, l'annuaire LDAP est
interrogé (si activé) et le compte est créé/mis à jour automatiquement. La
synchronisation peut **désactiver** les comptes LDAP absents de l'OU (option).
Le compte `admin` local n'est jamais touché par le LDAP (anti-verrouillage) et
un compte désactivé manuellement en local n'est pas réactivé à tort.

## 16. Paramètres

Le module **Paramètres** regroupe les réglages généraux :

- **Taille maximale d'upload** (Mo) — reprise en compte immédiate par l'API
  d'import (la variable `MAX_UPLOAD_MB` surcharge la valeur en base).
- **Réglages du lecteur** : intervalle de synchronisation de la planification,
  battements de cœur, preuves de diffusion. (Le réglage historique « boucle »
  global a été remplacé en v3.8 par le switch **par événement** du dialogue de
  planification, § 10.)
- **Informations système** : version du CMS (3.11), hostname, adresses IP
  réseau réelles (utilisées par le dialogue « Connecter Android ») — ces
  informations nécessitent désormais une session valide.

## 17. Le lecteur : web et Android

### 17.1 Lecteur web (`/player`)

Ouvrez `http://SERVEUR:3000/player` en plein écran (F11, ou mode kiosk du
navigateur). Le lecteur :

- se connecte à un écran (roue dentée → choix ou clé) et garde le lien ;
- suit automatiquement la planification : événements, campagnes, présentation
  par défaut — synchronisation toutes les 60 s maximum ;
- respecte la **boucle ON/OFF de l'événement courant** ;
- affiche les vidéos (y compris IPTV) via un moteur adapté (HLS/mpegts) ;
- permet de régler le **volume** sans couper la lecture ;
- affiche un **diagnostic clair** quand un contenu refuse (site non
  intégrable, flux IPTV refusé…) avec boutons *Réessayer* / *Lecture directe*.

**Astuce kiosk** : dans Chrome/Edge, utilisez
`chrome://flags`/`--kiosk http://SERVEUR:3000/player` pour un écran sans
aucune barre d'outils.

### 17.2 Application Android (APK v2.4)

Installez `SignageCMS-Player-v2.4-universal.apk` sur l'appareil (téléviseur
Android, tablette, box). **Important** : les versions antérieures à 2.4
n'appliquaient pas la boucle par événement — mettez à jour (v2.4 =
versionCode 6 ; désinstallez l'ancienne version si le système le demande).

Premier lancement : saisissez l'adresse du serveur (le dialogue « Connecter
Android » du CMS donne l'adresse réseau correcte + QR code) puis la clé de
l'écran. L'application s'enregistre (`/api/player/register`), affiche le
contenu planifié et gère nativement : ExoPlayer/VLC (repeatMode par événement),
cycle des widgets, rotation des présentations, clavier virtuel pour les pages
web, dialogues JavaScript.

## 18. Sécurité au quotidien

Les mesures intégrées à la v3.11 sont détaillées dans **AUDIT-SECURITE.md**.
Les réflexes à garder :

1. **Changez le mot de passe admin initial** dès la première connexion et
   supprimez `db\admin-credentials.txt`.
2. Utilisez des comptes nominatifs avec le **rôle le plus restrictif possible**
   et la matrice de permissions (§ 14) plutôt que de partager `admin`.
3. **HTTPS** dès que le CMS sort du LAN : le `Caddyfile` fourni permet un
   reverse proxy TLS en quelques lignes (`caddy run`).
4. **Sauvegardez** `db/custom.db` régulièrement (fichier unique, copie à chaud
   acceptée) — c'est lui qui contient comptes, médias référencés,
   planifications, configuration IPTV et LDAP.
5. Ne partagez pas le port 3000 sur Internet sans reverse proxy avec
   limitation de débit ; les proxys intégrés sont désormais fermés aux
   adresses internes, mais la règle d'or reste l'exposition minimale.
6. Après une intrusion suspectée : changez tous les mots de passe (chaque
   réinitialisation révoque immédiatement les sessions du compte).

## 19. Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| « port déjà utilisé » au démarrage | Autre service sur 3000 | `set PORT=8080` puis relancez `start-cms.bat` (adaptez le pare-feu) |
| Écran inaccessible depuis le réseau | Pare-feu fermé, ou serveur démarré avant `firewall.ps1` | Lancez `firewall.ps1` (admin), vérifiez `ipconfig`, relancez `start-cms.bat` (écoute 0.0.0.0 garantie) |
| Interface lente au premier accès | Build standalone qui se réchauffe | Normal quelques secondes ; vérifiez que la machine a ≥ 2 Go RAM libres |
| Conversion PPT/PDF absente | LibreOffice/Poppler non installés | § 6.4 ; relancez `start-cms.bat` après installation |
| « Trop de tentatives échouées » à la connexion | Limiteur anti-force-brute déclenché | Attendez 15 min ou redémarrez le serveur ; vérifiez le clavier (maj/caps) |
| Site web affiché « Page web inaccessible » | Site anti-robot ou redirection JS cross-origin | Bouton « Réessayer » ; essayez l'URL exacte du contenu ; sur APK, le WebView natif s'affranchit des limites |
| Flux IPTV : « quota de connexions atteint » | Tous les slots du fournisseur sont occupés | Le pool bascule seul ; sinon activez le mode strict, réduisez les écrans simultanés ou ajoutez un compte |
| Timeshift indisponible | Le tampon du décalage demandé n'est pas encore enregistré | Patientez le temps du décalage (ex. décalage 60 s → dispo après ~1 min) |
| Un écran reste « hors ligne » | Lecteur fermé, veille, ou clé erronée | Vérifiez le lecteur sur l'écran, la clé (Écrans → ⋯), le réseau ; les journaux montrent le dernier accès |
| Mot de passe admin perdu | — | Supprimez le compte admin de la base puis relancez : nouveau mot de passe aléatoire (console + `db\admin-credentials.txt`) |
| Vérifier le service Windows | — | Fichier `service.log` à la racine ; `Get-Service SignageCMS` dans PowerShell |
| Le build échoue sous Windows | Node < 20.9 | Installez Node.js 20/22 LTS puis relancez `build.bat` (journal : `build-cms.log`) |

## 20. Annexes : scripts Windows et variables d'environnement

### 20.1 Scripts (`deploy\windows\`)

| Script | Rôle |
|---|---|
| `install.bat` | Installation complète : dépendances, `.env`, base, build. Point d'entrée unique. |
| `build.bat` | Recompilation seule (`next build` + copie standalone). Appelé par `install.bat`. |
| `start-cms.bat` | Démarrage production. `PORT` surchargeable ; écoute sur toutes les interfaces. |
| `dev.bat` | Mode développement (rechargement à chaud) — tests uniquement. |
| `firewall.ps1` | Ouvre le port 3000 (admin). |
| `install-service.ps1` | Service Windows auto-démarré (NSSM recommandé, sinon tâche planifiée SYSTEM). |
| `install.ps1` | Installe les prérequis via winget/choco (Node.js, LibreOffice, Poppler). |

Journaux : `install-cms.log`, `build-cms.log` (dossier scripts), `service.log`,
`dev.log`, `server.log` (racine du projet).

### 20.2 Variables d'environnement (fichier `.env`)

| Variable | Rôle | Défaut |
|---|---|---|
| `DATABASE_URL` | Chemin de la base SQLite (`file:C:/chemin/db/custom.db`) | créé par `install.bat` |
| `ADMIN_DEFAULT_PASSWORD` | Impose le mot de passe initial du compte admin (installations scriptées) | aléatoire |
| `MAX_UPLOAD_MB` | Taille maximale d'un média importé | 50 (ou valeur Paramètres) |
| `PORT` | Port d'écoute du serveur | 3000 |
| `SOFFICE_PATH` | Chemin explicite de `soffice.exe` (conversion PPT) | détection automatique |
| `PDFTOPPM_PATH` | Chemin explicite de `pdftoppm.exe` (conversion PDF) | détection automatique |
