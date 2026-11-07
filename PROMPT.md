# Projet : « Radar », un lecteur RSS auto-hébergé de veille sécu et tech (PWA mobile first)

Tu travailles en autonomie dans un repo vide. Construis l'application de bout en bout, vérifie tout toi-même et ne me pose de question que si tu es réellement bloqué. Pour chaque choix non trivial, ajoute une ligne dans `DECISIONS.md`. Fais des commits petits et fréquents, avec des messages clairs.

## Contexte
- C'est une application perso, mono-utilisateur, hébergée sur mon serveur maison (Ubuntu Server, services en Docker).
- J'y accède uniquement via Tailscale. Rien n'est exposé sur Internet.
- Je l'utilise surtout sur mon téléphone (iPhone aujourd'hui, peut-être Android plus tard), installée en PWA, avec des notifications push. Elle doit aussi être confortable sur desktop.
- L'interface est en français et le fuseau horaire est Europe/Paris.

## Objectif
Je m'abonne à des flux (RSS/Atom et quelques sources JSON). L'appli les agrège, les déduplique et les enrichit. Elle me présente un fil clair et lisible, et ne m'envoie une notif que quand ça en vaut la peine. Mes priorités :
1. **Sécurité logicielle** : les CVE qui touchent les technos que j'utilise, avec la criticité bien visible, et les grosses actus sécu.
2. **Tech** : grosses actus, releases des outils que j'utilise.
3. **Actus générales tech** : en fond, sans bruit.

## Stack imposée
- **Backend** : Node.js 22 + TypeScript, Fastify (ou Hono), SQLite via Drizzle ORM, avec migrations versionnées.
- **Frontend** : React + Vite + TypeScript, Tailwind, `vite-plugin-pwa` (Workbox). Le frontend buildé est servi par le backend.
- **Push** : Web Push standard (VAPID) avec la lib `web-push`. Pas de service tiers.
- **Déploiement** : un seul conteneur Docker, avec un `docker-compose.yml` et un volume `./data` (base SQLite et clés VAPID). Le port est configurable (`PORT`, défaut 8787).
- **Tests** : Vitest pour la logique (parsing, matching, scoring, dédup) et Playwright pour l'e2e.
- **CI** : GitHub Actions (lint, typecheck, tests, build de l'image Docker).

## Fonctionnalités

### 1. Sources et collecte
- Gestion des flux : ajout par URL, avec auto-découverte du flux depuis une page HTML. Chaque flux a une catégorie (Sécurité / Tech / Actus / Releases), un intervalle de polling et peut être activé ou désactivé.
- Import et export OPML.
- Polling planifié dans le backend. Respecte `ETag` et `If-Modified-Since`, applique un backoff exponentiel en cas d'erreur, fixe un timeout et une limite de taille.
- Écran « Santé des flux » : dernier fetch, nombre d'erreurs, dernier message d'erreur.
- Architecture en **adaptateurs de source** : `rss`, `atom`, plus des adaptateurs JSON dédiés pour :
  - **CISA KEV** (catalogue des vulnérabilités activement exploitées) ;
  - **GitHub Advisory Database** (API REST publique, filtrable par écosystème : maven, npm, pip, pub…) ;
  - **NVD API 2.0** (pour l'enrichissement CVSS, avec un rate limit respecté et une clé API optionnelle via env) ;
  - **EPSS** de FIRST (probabilité d'exploitation).
- Sanitize systématiquement le HTML des articles (DOMPurify ou équivalent côté serveur).

### 2. Flux par défaut (seed)
**Vérifie que chaque URL répond réellement** avant de la mettre dans le seed. Remplace ou retire celles qui sont mortes et note-le dans `DECISIONS.md`. Point de départ :
- **Sécurité** : CERT-FR (alertes et avis, flux séparés), CISA KEV, GitHub Security Advisories, BleepingComputer, The Hacker News, Krebs on Security, Zataz.
- **Tech** : Hacker News filtré par score (via hnrss.org, seuil configurable), LWN, Ars Technica, Next.ink, Korben.
- **Releases** : flux `releases.atom` GitHub de Spring Boot, Vue, React, Node.js, Flutter, Docker/Moby, Tailscale, Immich, n8n, Ollama, Pi-hole.

### 3. Watchlist de technos (cœur de la valeur)
- Une liste éditable dans l'UI des technos que j'utilise. Chaque entrée contient :
  - un nom ;
  - des alias/mots-clés ;
  - des identifiants optionnels : CPE vendor:product, écosystème et nom de package (ex. `maven:org.springframework.boot:*`, `npm:vue`) ;
  - des mots-clés d'exclusion contre les faux positifs.
- Seed initial : Java/OpenJDK, Spring Boot/Spring Framework, Vue.js, React, Node.js, TypeScript, Flutter/Dart, Python, PostgreSQL, SQLite, Docker, Ubuntu, noyau Linux, OpenSSH, Tailscale, Immich, n8n, Ollama, Pi-hole, WordPress, Chrome.
- Matching par ordre de priorité : identifiants structurés (CPE ou package) d'abord, puis mots-clés avec word boundaries. Un match par mot-clé seul est marqué « probable », pas « certain ».
- Couvre le matching par des tests unitaires avec des cas pièges (« React » ne doit pas matcher n'importe quel texte contenant « react »).

### 4. Enrichissement et dédup des CVE
- Extrais les identifiants CVE et GHSA de tous les items, y compris des articles de presse.
- Fusionne en une seule « fiche vulnérabilité » toutes les mentions d'un même CVE, en gardant la liste des sources.
- La fiche affiche :
  - le score CVSS et sa sévérité ;
  - le score EPSS ;
  - « Exploité activement (KEV) » oui/non ;
  - les technos de ma watchlist touchées ;
  - les versions affectées et corrigées quand elles sont disponibles ;
  - les liens vers les sources.
- Calcule un **score de priorité** documenté et testé, qui combine sévérité CVSS, KEV, EPSS et match watchlist (certain ou probable). C'est ce score qui pilote l'affichage et les notifs.

### 5. Notifications
- Web Push avec des clés VAPID générées au premier démarrage et persistées dans `./data`.
- Gestion des abonnements multi-appareils. Supprime automatiquement les abonnements expirés (codes 404/410).
- Règles configurables dans l'UI. Valeurs par défaut :
  - **push immédiat** : CVE qui matche ma watchlist ET (CVSS ≥ 9, ou KEV, ou EPSS élevé), plus les alertes CERT-FR ;
  - **digest quotidien** (heure configurable, ex. 8h) : CVE matchées de sévérité moyenne ou haute, et top des actus ;
  - **rien** : le reste, qui reste consultable dans le fil.
- Heures calmes configurables : les notifs non critiques sont décalées.
- Anti-spam : regroupe les rafales en une seule notif (« 4 nouvelles CVE critiques »).
- Le payload de la notif doit se suffire à lui-même (titre, sévérité, techno touchée). Je peux la recevoir sans être connecté à Tailscale.
- Au clic, la notif ouvre la fiche dans l'app.
- Bouton « Envoyer une notif de test » dans les réglages.
- iOS :
  - la permission doit être demandée après un geste utilisateur, jamais au chargement ;
  - si l'app n'est pas installée sur l'écran d'accueil, affiche un écran expliquant comment l'installer (le push iOS l'exige) ;
  - utilise la Badging API pour afficher le nombre d'items non lus prioritaires.

### 6. Interface (mobile first, très soignée)
- Design sobre et lisible, inspiré des bons lecteurs RSS : bonne typo, hiérarchie claire, espacements généreux, cibles tactiles ≥ 44px.
- Thème sombre par défaut, thème clair disponible. Prends en compte les safe areas iOS.
- Navigation par barre d'onglets en bas : **Prioritaire** (score élevé), **Sécurité**, **Tech**, **Tout**, **Réglages**.
- Cartes d'items avec :
  - un badge de sévérité coloré (critique / haute / moyenne / basse) ;
  - un badge KEV ;
  - des chips des technos touchées ;
  - la source et une date relative.
- Gestes : swipe pour marquer comme lu ou mettre en favori, pull-to-refresh, « tout marquer comme lu » jusqu'ici.
- Vue lecture épurée de l'article (extraction type Readability côté serveur), avec un lien vers l'original.
- Recherche plein texte (SQLite FTS5) et filtres par source, techno, sévérité, lu/non lu, favoris.
- Mode hors-ligne : les derniers items et les favoris sont consultables sans réseau (cache du service worker et de l'API).
- Accessibilité : contraste AA, focus visibles, `prefers-reduced-motion` respecté.

### 7. Rétention et maintenance
- Purge des items lus de plus de N jours (configurable), sauf favoris et fiches CVE matchées.
- Endpoint `/health` utilisé par le healthcheck Docker.
- Logs structurés (pino).

### 8. Ollama (optionnel, désactivé par défaut)
- Si `OLLAMA_URL` est défini, génère un résumé de 2 lignes en français pour les articles longs et les fiches CVE.
- L'appli doit fonctionner parfaitement sans.

## Accès réseau et sécurité
- Pas d'authentification applicative : la sécurité repose sur le tailnet.
- Le conteneur n'écoute que sur `127.0.0.1:${PORT}`, jamais sur `0.0.0.0` côté hôte.
- L'accès HTTPS, indispensable pour le service worker et le push, se fait via `tailscale serve`. Documente la commande exacte dans le README, par exemple `tailscale serve --bg --https=8443 http://127.0.0.1:8787`, en précisant d'adapter le port HTTPS si 443 est déjà pris sur la machine.
- En-têtes de sécurité : CSP stricte, `X-Content-Type-Options`, etc.
- Fetch des flux protégé contre le SSRF : refus des IP privées et locales, sauf si une option l'autorise explicitement.

## Méthode de travail
1. Commence par écrire `SPEC.md` (modèle de données, adaptateurs, scoring, règles de notif, écrans) et un plan par phases dans `PLAN.md`.
2. Phases :
   - (a) squelette, Docker et CI ;
   - (b) collecte RSS et fil basique ;
   - (c) watchlist, enrichissement CVE et scoring ;
   - (d) PWA et push ;
   - (e) finition UI et hors-ligne ;
   - (f) bonus Ollama.
3. À la fin de chaque phase, tout doit passer : lint, typecheck, tests, `docker compose up` avec healthcheck vert.
4. Vérifie l'UI avec Playwright :
   - viewports iPhone (390×844) et desktop ;
   - captures d'écran de chaque écran principal en thème sombre et clair, enregistrées dans `docs/screenshots/` ;
   - relis toi-même ces captures et corrige ce qui est moche ou illisible avant de passer à la suite.
5. Le `README.md` final contient : installation, variables d'env, commande `tailscale serve`, installation de la PWA sur iPhone et Android, activation des notifs, ajout d'une techno à la watchlist, sauvegarde du volume `./data`.

Commence par lire ce prompt en entier, puis écris `SPEC.md` et `PLAN.md`, puis enchaîne les phases sans attendre ma validation.