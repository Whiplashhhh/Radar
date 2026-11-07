# Décisions

Une ligne par choix non trivial.

- **Environnement de dev** : bac à sable sans Docker et avec un réseau sortant filtré (seuls GitHub et npm répondent). `docker compose up` n'a pas pu être lancé ici. Le serveur buildé est testé avec Node directement (healthcheck compris), et l'image est construite en CI GitHub Actions.
- **Vérification des URL du seed** : seules les URL hébergées sur GitHub ont pu être vérifiées depuis le bac à sable (200 le 2026-11-07). Les autres (CERT-FR, BleepingComputer, THN, Krebs, Zataz, hnrss, LWN, Ars, Next, Korben, NVD, EPSS) étaient injoignables pour une raison réseau (ECONNREFUSED, y compris via un agent web), ce qui ne prouve pas qu'elles sont mortes. Elles restent dans le seed avec leur URL officielle connue. `npm run check:feeds` les vérifie, et un job CI manuel (`workflow_dispatch`) les contrôle depuis GitHub.
- **React releases** : `github.com/facebook/react/releases.atom` redirige en 301 vers `github.com/react/react/releases.atom` (dépôt migré). Le seed utilise directement la nouvelle URL.
- **CISA KEV** : le seed pointe sur le miroir officiel CISA sur GitHub (`raw.githubusercontent.com/cisagov/kev-data/main/known_exploited_vulnerabilities.json`, vérifié 200), pas sur cisa.gov (injoignable d'ici). Même contenu, mis à jour par CISA.
- **Monorepo à un seul package.json** plutôt que des workspaces : un seul `npm ci`, un seul lint et un seul typecheck, et une image plus simple.
- **better-sqlite3** plutôt que `node:sqlite` : c'est le driver Drizzle le plus mûr, et il embarque SQLite avec FTS5.
- **Serveur bundlé par esbuild** (dépendances externes) : évite les extensions `.js` dans les imports TS et donne un démarrage rapide.
- **sanitize-html** côté serveur à la place de DOMPurify : même rôle, sans DOM à émuler pour chaque item.
- **Readability** (`@mozilla/readability`) sur `linkedom` plutôt que jsdom : plus léger, et suffisant pour l'extraction.
- **Playwright épinglé en 1.64.0** : c'est la version qui correspond au Chromium préinstallé dans le bac à sable (révision 1248).
- **Ollama devient une fonctionnalité de premier plan** (demande utilisateur du 2026-11-07) : briefing quotidien généré à l'heure du digest et couvrant toutes les actus depuis le briefing précédent. Une seule notif le matin (briefing + digest) plutôt que deux. Sans Ollama, un briefing de repli sans IA est produit pour que l'écran ne soit jamais vide.
- **Briefing : bornage du prompt** à 80 items par score décroissant, avec `num_ctx` à 8192. Au-delà, un petit modèle local perd le fil et le temps de génération explose.
- **Matching des vulns structurées (GHSA)** : quand une vuln a des packages, les mots-clés ne sont cherchés que dans le titre et les sources, pas dans la description. Ça évite les faux positifs observés en réel (vuln Maven XWiki marquée « Python probable » parce que la description parle de macro Python).
- **Une vuln seulement citée n'a pas de carte dans le fil** tant qu'elle n'a ni titre, ni description, ni CVSS (enrichissement NVD en attente). Sans cette règle, les avis CERT-FR qui listent des dizaines de CVE remplissaient le fil de cartes vides.
- **CSP sans `'unsafe-inline'`** : le thème est appliqué avant le rendu par un script externe (`/theme.js`) et non inline, et les styles dynamiques passent par le CSSOM. Un test e2e vérifie l'absence de violation CSP.
- **Projets Playwright chaînés** : les captures tournent d'abord, sur la base de démo intacte, puis les tests fonctionnels qui modifient l'état. Ainsi les captures de `docs/screenshots/` sont déterministes.
- **Base de démo déterministe** (`scripts/demo-seed.ts`) pour l'e2e et les captures : le réseau est indisponible en CI pour la plupart des flux, et un contenu réel changerait d'une exécution à l'autre.
- **Pas de librairie de gestes** : swipe et pull-to-refresh sont écrits en Pointer/Touch Events (environ 80 lignes). Ils restent compatibles avec le défilement vertical (`touch-action: pan-y`), et chaque action a un équivalent bouton pour le clavier et l'accessibilité.
- **Badge iOS** : posé par le service worker à la réception d'un push (champ `badge` du payload) et par l'app à chaque rafraîchissement des stats.
- **Proposition de flux par l'utilisateur** : un flux ajouté depuis l'UI passe aussi par l'anti-SSRF, donc une URL du LAN est refusée sauf avec `ALLOW_PRIVATE_NETWORKS=true`.
