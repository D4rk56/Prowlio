# 📜 Journal des modifications — Prowlio

Les changements notables de ce projet. Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).

## [2.5.1] — 2026-10-23

### Corrigé & Amélioré

- **Indexeurs Communautaires Multiples & Déduplication (`lib/community-indexer.js`, `lib/ui.js`)** :
  - **Correction du bug d'ajout multiple** : remplacement de `querySelector` par `querySelectorAll` dans `addCommunityIndexerItem` pour éradiquer l'exception bloquante `TypeError: existing is not iterable` dans le DOM.
  - **Correction de la réouverture du profil** : correction de la précédence d'opérateurs dans `populateCommunityList` (`lib/ui.js`), préservant l'intégralité des URLs multiples d'indexeurs configurés.
  - **Pastilles d'état en direct** : chaque indexeur dans la liste dynamique bénéficie d'une pastille d'état visuelle dynamique (test en cours, en ligne, inaccessible) mise à jour en direct lors du test de connectivité.
  - **Recherche complète des séries** : suppression de la troncature d'identifiant (`id.split(':')[0]`) dans `searchAllCommunityTorrents`, restaurant la recherche d'épisodes de séries (`tt...:s:e`) sur l'ensemble des indexeurs communautaires.
  - **Normalisation intelligente des URLs externes** : nettoyage automatique des suffixes `/manifest.json` et slashes résiduels saisis par l'utilisateur avant interrogation, évitant les erreurs 404 de double suffixe.
  - **Validation guidée des services externes** : messages d'explication immédiats pour `debridmediamanager.com` (service web non-addon Stremio, guidage vers un relai Comet) et pour les pages de configuration web (`/app`, `/configure`).

- **Suppression du tri forcé « Mon Cloud en premier » (`lib/helpers.js`, `lib/ui.js`, `index.js`)** :
  - Retrait des cases à cocher `prioritizeCloud` du formulaire d'inscription et de la modale de modification des réglages.
  - Adaptation du tri `filterAndSortStreams` : les flux cloud restent signalés par leur badge distinctif mais respectent désormais la hiérarchie stricte des résolutions (4K, 1080p...) et des critères de tri de l'utilisateur, au lieu d'être artificiellement forcés en première position.

- **Réorganisation et Harmonisation Visuelle de l'UI (`lib/ui.js`)** :
  - **Repositionnement de la clé API TMDB** : sortie du bas de la section « Qualité & Cache » pour être mise en valeur dans la section 2 « Métadonnées & Indexeurs de Recherche ».
  - **Encadrement unifié Prowlarr & Jackett** : regroupement de Prowlarr et Jackett au sein d'un bloc encadré symétrique et équilibré (« Indexeurs de Torrents Personnels »).
  - **Parité Inscription & Édition** : répercussion de la même organisation et des mêmes badges dans l'onglet « Modifier mes Réglages ».

## [2.5.0] — 2026-10-22

### Ajouté

- **Interface Utilisateur Moderne & Refonte UX (`lib/ui.js`)** :
  - Remplacement complet de l'ancien wizard à étapes par une interface épurée en 4 sections claires (Débrideurs, Indexeurs, Qualité & Filtres, Profil).
  - Sélection claire des 4 débrideurs par cartes directes avec bascule automatique intelligente en Multi-Débrideurs.
  - Regroupement des indexeurs de recherche avec Jackett directement positionné sous Prowlarr et tests de connectivité en direct.
- **Support Natif AIOStreams sans « Result Passthrough » (`lib/helpers.js`)** :
  - Standardisation de `behaviorHints.service` (`realdebrid`, `alldebrid`, `torbox`, `debridlink`).
  - Fourniture systématique de `behaviorHints.filename` pour alimenter directement le parseur PTN (Torrent Name Parser) interne d'AIOStreams.
  - Badges de flux clairs et unifiés (`[AD+]`, `[RD+]`, `[TB+]`, `[DL+]`, `[AD ☁️]`, `[TB ☁️]`).
- **Suppression Définitive de la Fonction Catalogues Stremio (`lib/stremio.js`)** :
  - Retrait complet de la ressource catalog du manifeste (`catalogs: []`).
  - Focalisation exclusive de l'addon sur la livraison ultra-rapide de flux (`stream`) avec allègement de plus de 1 200 lignes de code mort.
- **Prowlarr Circuit Breaker & Alerte Indexeurs (`lib/prowlarr-worker.js`)** :
  - Détection proactive des configurations Prowlarr sans indexeur configuré (`/api/v1/indexer`).
  - Circuit Breaker automatique mettant en pause une instance pendant 1 heure après 3 cycles consécutifs à 0 résultat.
- **Mode Téléchargement Universel `allowDownload` (`lib/resolver.js`)** :
  - Prise en charge du téléchargement asynchrone/mise en cache pour Real-Debrid, AllDebrid, Torbox et Debrid-Link avec page de progression en direct.
- **Support Multi-Débrideurs étendu & Cascade Failover (`lib/realdebrid.js`, `lib/debridlink.js`, `lib/resolver.js`)** :
  - **Real-Debrid** : intégration complète de l'API REST v1.0 avec vérification instantanée (`/torrents/instantAvailability`), injection de magnet, sélection de fichier vidéo principal et débridage de lien CDN.
  - **Debrid-Link** : intégration complète de l'API v2 avec inspection du cache (`/seedbox/cached`), streaming et débridage instantané.
  - **Cascade Failover inter-fournisseurs** : bascule transparente et ordonnée en cas de torrent non mis en cache ou d'erreur sur le débrideur principal vers les autres fournisseurs configurés par l'utilisateur (AllDebrid, Torbox, Real-Debrid, Debrid-Link).
  - **Quarantaine unifiée** : normalisation hexadécimale insensible à la casse des cibles défaillantes pour tous les fournisseurs.
- **Indexation Jackett Torznab à la demande (`lib/jackett.js`)** :
  - Interrogation parallèle compatible Torznab XML et JSON avec normalisation des attributs infoHash, seeders et taille.
  - Circuit Breaker automatique (3 échecs consécutifs = suspension temporaire de 10 min) et protection anti-SSRF sur les plages IP privées.
- **Indexeur Communautaire de Cache (`lib/community-indexer.js`)** :
  - Interrogation d'indexeurs communautaires de torrents/hashes déjà mis en cache (compatible Comet / MediaFusion / DMM).
  - Circuit Breaker automatique (3 échecs consécutifs = suspension temporaire de 10 min), mise en cache LRU et protection anti-SSRF.
- **Suite de tests automatisée 100% hors-ligne (`test/new-features.test.js`, `test/addon.test.js`)** :
  - 179 tests unitaires passés avec succès pour Real-Debrid, Debrid-Link, Jackett, Prowlarr, AIOStreams, Torbox, AllDebrid et l'API Stremio.

## [2.4.7] — 2026-10-18

### Ajouté

- **Moteur de recherche et de résolution TMDB haute précision (`lib/titleResolver.js`)** :
  - **Intégration `tmdb-kit`** : adoption d'un client HTTP TMDB ultra-léger et moderne sans dépendances externes pour l'interrogation de `/search/multi`, `/search/tv`, `/search/movie` et `/alternative_titles`.
  - **Recherche multi-passes résiliente** :
    - Recherche multi avec année et langue préférée (`fr-FR` / `en-US`).
    - Ré-essai automatique sans contrainte d'année en cas d'échec ou d'écart de date de sortie.
    - Repli par type spécifique (`/search/tv` ou `/search/movie`) si le mode multi ne produit aucun résultat convaincant.
    - Extraction et recherche sur la proposition principale pour les titres longs ou composites.
  - **Normalisation intelligente des titres** :
    - Conversion bidirectionnelle des chiffres romains (`Gladiator II` ↔ `Gladiator 2`, `Fast & Furious X` ↔ `10`).
    - Normalisation des ordinaux textuels (`Part Two` ↔ `Part 2`, `Deuxième Partie` ↔ `Part 2`).
    - Élimination des suffixes parasites de saisons et de découpage (`Season 2`, `Cour 2`, `Final Season`, `Part 1`, etc.).
    - Nettoyage des séparateurs et de la ponctuation TMDB (`:`, `;`, `&`, tirets).
  - **Parsing hybride Anitomy + Regex** :
    - Prise en charge native des métadonnées étendues d'Anitomy (`@iktakahiro/anitomy-js`) : titres alternatifs (`altTitles`), année et titre d'épisode pour les animes et releases de fansub.
    - Nettoyage dédié des releases occidentales de films et de séries via `extractCleanTitle`.
  - **Algorithme de scoring textuel (`string-similarity`) avec détection contextuelle** :
    - Évaluation multi-champs : score comparé sur le titre principal, le titre original et les titres alternatifs TMDB.
    - **Pénalité pour suites et dérivés (`-0.30`)** : neutralise les faux positifs où une suite est confondue avec l'œuvre originale (ex: `Naruto` vs `Naruto Shippuden`, `Dune` vs `Dune: Part Two`).
    - **Pénalité pour intégrales et coffrets (`-0.30`)** : empêche la sélection erronée d'un pack ou d'une intégrale pour une œuvre individuelle (ex: `Toy Story` vs `Toy Story Quadrilogie`).
    - **Désambiguïsation chronologique** : arbitrage strict par l'année pour les reboots et homonymes (ex: `Doctor Who 2005` vs `1963`/`2023`).
    - Seuil de correspondance directe (`confidence >= 0.85`) et restitution ordonnée des 5 meilleurs candidats en cas d'ambiguïté.
  - **Cache de résolution persistant SQLite & mémoire** :
    - Nouvelle table SQLite `tmdb_resolutions` en mode WAL avec indexation sur la clé de requête et purge automatique (TTL 30 jours).
    - Cache mémoire LRU haute performance (`tmdbResolutionsMemCache`, 2000 entrées) assurant des résolutions instantanées sans coût réseau.

### Amélioré

- **Gestion des utilisateurs & Administration** :
  - **Pseudo obligatoire et unique** : contrainte d'unicité en base de données et validation à la saisie (minimum 2 caractères) pour éviter les collisions de profils et clarifier l'attribution des logs.
  - **Purge automatisée des comptes inactifs** : nouvelle action de maintenance `purgeInactiveUsers` supprimant les comptes inactifs depuis plus de 30 jours ainsi que leurs torrents résiduels, déclenchable depuis le panneau d'administration.
  - **Tri et filtrage dans le panneau admin** :
    - Nouveaux ordres de tri : plus récents, plus anciens, ordre alphabétique par pseudo, et date de dernière activité.
    - Tri interactif par statut Prowlarr On-Demand avec indicateur dynamique (`🔽`/`🔼`/`↕️`) dans l'en-tête de la table des utilisateurs.
- **Intégration Prowlarr** :
  - **Validation de connectivité à la saisie** : vérification instantanée de l'URL et de la clé d'API Prowlarr avec retour visuel (toasts) dans les paramètres utilisateur et l'interface admin.
  - **Raccourci de préfixe d'URL** : bouton d'astuce `+ /prowlarr` facilitant la configuration derrière un reverse proxy sans altérer les configurations personnalisées existantes.

## [2.4.6] — 2026-10-09

### Corrigé

- **Torbox : fiabilisation de l'état `metaDL` et résolution de flux** :
  - **Injection de trackers publics** : les liens magnets générés par `createTorboxTorrent` intègrent désormais une liste de trackers publics fiables, réduisant drastiquement le temps d'acquisition DHT des métadonnées Torbox.
  - **Bypass du cache dès l'interrogation initiale** : la vérification initiale des torrents du compte utilisateur via `getTorboxTorrentList` utilise `bypassCache: true`, empêchant la désynchronisation avec le cache serveur de 600 s et évitant les erreurs de faux doublon (`already exists`).
  - **Budget de polling étendu** : le résolveur alloue désormais jusqu'à 22 vérifications espacées progressivement (800 ms à 1100 ms, ~25 s au total), assurant la transition complète des torrents volumineux de l'état `metaDL` vers `cached` sans suppression prématurée.
  - **Protection du cache partagé** : la bascule automatique sur échec Torbox ne purge plus l'entrée SQLite partagée (`cached_torrents`), préservant la validité des flux pour les utilisateurs AllDebrid.
  - **Pré-vérification instantanée lors du basculement** : lors d'une bascule de flux avec `allowDownload: false`, le résolveur vérifie la disponibilité instantanée (`checkInstantTorbox`) avant toute tentative.
- **Catalogues Stremio : cache partagé de classification TMDB** :
  - Mise en mémoire cache LRU (`cloudClassifyCache`, 90 s) de la classification des magnets du cloud utilisateur. Lorsque Stremio interroge simultanément les catalogues Films, Séries et Animes au même instant, la classification est instantanément réutilisée sans requêtes TMDB redondantes ni spam d'avertissement de saturation (200 premiers magnets).

### Refonte de l'interface

- **Panneau d'administration : confort visuel et console de logs en haute résolution** :
  - **Disposition élargie** : passage d'une largeur étroite (1100 px) à une mise en page fluide (`max-width: 1680px; width: 96%`), offrant plus de 1400 px d'espace de travail pour les journaux et les tables.
  - **Console de logs tabulaire et ergonomique** : horodatage tabulaire fixe (`10:18:03`), badges de niveaux colorés et uniformes (`[INFO]`, `[WARN]`, `[ERROR]`, `[DEBUG]`), modules identifiés avec largeur minimale, badge d'utilisateur dédié (`👤 Salon`) et retour à la ligne naturel (`word-break: break-word`) empêchant le découpage chaotique des mots.
  - **Table des utilisateurs responsive** : défilement horizontal fluide sans compression des colonnes, badges de statut et boutons d'actions protégés contre les retours à la ligne intempestifs.

## [2.4.5] — 2026-10-06

### Corrigé

- **Torbox : bypass du cache API (600 s) sur `mylist`** : l'API Torbox met en cache la liste `/torrents/mylist` pendant 10 minutes (600 secondes). Lors de la création d'un torrent, son état initial (`metaDL`) restait figé pour toutes les vérifications de `getTorboxTorrentInfo` sans le paramètre `bypass_cache=true`, même si le torrent était rapidement devenu disponible sur les serveurs de Torbox. `getTorboxTorrentInfo` applique désormais systématiquement `bypass_cache=true` pour interroger l'état frais en temps réel.
- **Récupération en cas de doublon (`already exists`)** : si l'ajout d'un torrent répond que l'élément existe déjà (torrent absent de la liste initiale à cause du cache de 600 s), le résolveur rafraîchit immédiatement `mylist` avec `bypass_cache=true` pour retrouver son identifiant au lieu d'échouer.
- **Disponibilité Torbox enrichie** : `isTorboxTorrentDownloaded` reconnaît également `download_present: true` en plus de `cached`, `uploading`, `completed` et `progress === 1`.
- **`isTorboxTorrentReady`** : la liste d'exclusion est passée en correspondance par inclusion et enrichie (`stalled (no seeds)`, `queued`, `metaDL`, `checkingResumeData`), corrigeant l'affichage des torrents cloud non lisibles.

## [2.4.4] — 2026-10-06

### Changement

- **Les flux non instantanés (⏳ Téléchargement / 🔍 Vérif. au clic) sont désormais masqués par défaut.** Ils ne s'affichent que si l'utilisateur a coché l'option **« Téléchargement »** (`allowDownload`) dans sa configuration. Par défaut, seuls les flux **⚡ instantanés** (déjà en cache chez le débrideur) sont listés — cohérent avec le fait que, sans cette option, le résolveur ne pouvait pas les lancer (suppression immédiate du torrent non prêt).

## [2.4.3] — 2026-10-06

### Corrigé

- **Torbox + Prowlarr on-demand : aucun flux ne se lançait.** Le résolveur vérifiait une seule fois si un torrent fraîchement ajouté était `download_finished` ; sinon il le **supprimait immédiatement** et basculait vers un autre candidat. Or un torrent **déjà en cache** Torbox peut rester marqué « en téléchargement » 1 à 3 secondes après l'ajout. Le résolveur attend désormais une disponibilité certaine (fichiers peuplés + `download_finished`) dans un **budget borné** (8 re-vérifications espacées de 700 ms pour un torrent fraîchement ajouté), sans régression pour le chemin « torrent déjà présent » ni pour le mode _download_.

## [2.4.2] — 2026-10-06

### Corrigé

- **Clés AllDebrid générées « à la volée »** : `checkAllDebridKey` envoyait `agent=cinécloud` à `/v4/user`, ce qui amenait AllDebrid à **créer automatiquement une clé API** dans le compte de l'utilisateur à chaque validation (mécanisme documenté « certains logiciels tiers créent une clé »). Le paramètre `agent` est supprimé : la clé n'est plus transmise qu'en en-tête `Authorization`, et aucune clé n'est plus dupliquée. Les clés déjà créées restent supprimables manuellement sur `alldebrid.com/apikeys`.
- **« Le nouveau mot de passe doit comporter au moins 4 caractères »** alors qu'aucun changement n'était demandé : le champ vide est désormais omis côté client **et** accepté côté serveur.

### Refonte de l'interface

- **Thème dark « cinéma » modernisé** : palette unifiée, cartes/boutons/champs/tableaux harmonisés, responsive mobile-first, états de focus et accessibilité améliorés.
- **Page utilisateur** : fin de l'assistant multi-étapes → **formulaire unique à sections** (Débrideur, Profil & mot de passe, Préférences, Catalogues, Sources externes).
- **Panneau d'administration** : fin des onglets → **barre latérale de navigation** (drawer sur mobile).
- Aucun changement d'API ni de logique : toutes les fonctions JS et les identifiants DOM sont conservés.

## [2.4.1] — 2026-10-06

Dernière passe d'amélioration avant mise en pause du développement : sécurité, fiabilité du résolveur, interopérabilité AIOStreams et documentation.

### Sécurité

- **Assainissement du contenu d'embed administrateur** (`lib/sanitize.js`) : reconstruction par liste blanche close (ni `script`, `iframe`, `style`, `on*`, ni schéma `javascript:`), appliquée **à l'enregistrement et au rendu**. Ajout de la section **I** de `SECURITY.md`.
- **Jeton de session utilisateur** (`x-user-token`, 1 h, lié à l'UUID) : enregistrement des réglages **sans ressaisir le mot de passe**, tandis que les **clés API et le mot de passe** exigent toujours le mot de passe. Révocation automatique au changement de mot de passe. Ajout de la section **J** de `SECURITY.md`.
- **Jeton AllDebrid limité à l'en-tête** : suppression des clés API des URLs et durcissement des redirections (garde open-redirect).
- **Garde SSRF** (`lib/net-guard.js`) : autorise les services auto-hébergés, bloque link-local / métadonnées cloud / multicast, y compris après résolution DNS.
- `TRUST_PROXY` désactivé par défaut ; rate limiting par IP client restauré derrière un reverse proxy.

### Corrigé

- **Torbox — HTTP 422 sur `requestdl`** : l'API exige le token en **paramètre de requête** (l'en-tête seul est rejeté). Le corps d'erreur FastAPI est désormais extrait et journalisé, et l'URL CDN est refusée si elle contient la clé.
- **Boucles de résolution** : quarantaine automatique (10 min) des cibles mortes côté **AllDebrid** et **Torbox**, avec suppression de la cible de la liste des flux.
- **Magnets AllDebrid non prêts** : plus annoncés comme « ⚡ Instantané / Cloud » (`statusCode` 0-3 exclus), ce qui provoquait des échecs au clic.
- **Prowlarr** : l'instance du serveur n'est **plus empruntée** pour les recherches des utilisateurs (cause des « timeout » universels) ; budget borné et disjoncteur (3 échecs → pause 10 min) sur la recherche à la demande ; le réglage `prowlarrTimeoutMs` est **enfin appliqué**.
- **Tags Git** : migration des endpoints Torbox et élimination des clés API des URLs.

### Ajouté

- **Intégration Torrentio** : filtres (Taille, Seed, Langue, Résolutions) dans l'URL de manifest, lecture via **votre propre clé** AllDebrid/Torbox, egress WARP avec **diagnostic par tentative** (`proxy:403 • direct:403`) et choix de l'ordre (_Auto_ / _Direct d'abord_).
- **`behaviorHints` complet** sur chaque flux (`filename`, `videoSize`, `seeders`, `indexer`, `service`, `cached`) — nécessaire pour qu'AIOStreams parse correctement résolution, qualité, langue et statut de cache.
- **Manifeste** : ressources `meta`/`stream` déclarées en objets avec `idPrefixes` (+ champ global), supprimant l'avertissement AIOStreams « addon provides no idPrefixes ».
- **Personnalisation de la page publique** (admin) : embed HTML assaini, iframe en bac à sable, bouton Discord.
- **Exclusions intelligentes** : artefacts (`zip`, `rar`, `srt`, images, `sample`, `bonus`, `trailer`…) retirés de l'historique et du cloud ; détection des packs « COMPLETE / INTEGRALE / COFFRET / BATCH ».
- **Colonne « Prowlarr On-Demand »** dans **Admin → Utilisateurs** : ✅ configuré / ❌ non configuré, avec l'hôte de l'instance.
- **Optimisations du résolveur** : cache de résolution (10 min), cache des listes de fichiers par magnet, timeout AllDebrid réellement piloté par le réglage admin (`httpTimeoutMs`).
- **Documentation** : README restructuré (API, catalogues, dépannage, structure), `CHANGELOG.md`, sections `SECURITY.md`, `CONTRIBUTING.md` aligné sur les gardes CI.

### Infrastructure

- **CI** : actions mises à jour vers leurs versions **Node 24** (fin de l'avertissement « Node.js 20 is deprecated »), ajout des étapes **lint** et **format:check**, sérialisation des exécutions (`concurrency`) et plafonds de durée (`timeout-minutes`).

## [2.4.0] — 2026-09

- Validation stricte des entrées (Zod), CORS strict, en-têtes CSP, limites de taille de corps.
- Cache Prowlarr mutualisé, revalidation `is_instant`, tri des catalogues historique/cloud.
- Module animés (Anitomy + mapping Fribb), formateur de flux épuré, profils rapides et QR Code.

## [2.0.0] — 2026-08

- Première version publique : support AllDebrid + Torbox, Prowlarr, panneau d'administration, chiffrement des clés.
