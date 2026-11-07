# Plan

État : toutes les phases sont terminées. `docker compose up` n'a pas pu être lancé dans le bac à sable de développement (pas de Docker) : c'est vérifié par le job `docker` de la CI.

Chaque phase se termine par : `npm run lint && npm run typecheck && npm test && npm run build`, puis démarrage du serveur buildé avec `/health` vert. La CI construit l'image Docker.

## (a) Squelette, Docker, CI
- [x] package.json unique, TS strict, ESLint (flat), Vitest, Playwright
- [x] Fastify + `/health` + pino + helmet, service du front buildé
- [x] Drizzle + better-sqlite3, première migration, settings par défaut
- [x] React + Vite + Tailwind, coquille avec barre d'onglets
- [x] Dockerfile multi-stage (node:22-bookworm-slim), docker-compose (127.0.0.1, volume ./data, healthcheck)
- [x] GitHub Actions : lint, typecheck, test, build, e2e, docker build

## (b) Collecte RSS et fil basique
- [x] safeFetch (SSRF, timeout, taille, ETag/IMS, redirections)
- [x] Parser RSS/Atom, sanitize, dédup, ingestion, FTS5
- [x] Poller avec backoff, santé des flux
- [x] Auto-découverte, OPML import/export, seed des flux vérifiés
- [x] API items + fil, détail article avec Readability

## (c) Watchlist, CVE et scoring
- [x] Extraction CVE/GHSA, fusion des vulns, vuln_sources
- [x] Adaptateurs CISA KEV, GitHub Advisories, enrichisseurs NVD et EPSS
- [x] Matching (tests pièges), scoring documenté et testé
- [x] Watchlist CRUD + seed, fiche vuln

## (d) PWA et push
- [x] vite-plugin-pwa (injectManifest), manifest, icônes, SW push et clic
- [x] VAPID, abonnements, envoi, purge 404/410, notif de test
- [x] Règles, digest, heures calmes, regroupement
- [x] Écran d'installation iOS, Badging API

## (e) Finition UI et hors-ligne
- [x] Swipe, pull-to-refresh, tout marquer lu jusqu'ici, filtres, recherche
- [x] Cache API (NetworkFirst) et préchargement favoris et derniers items
- [x] Thème clair et sombre, safe areas, a11y, reduced-motion
- [x] Captures Playwright (iPhone et desktop, sombre et clair) dans `docs/screenshots/`, relecture et corrections
- [x] Rétention

## (f) Ollama (devenu prioritaire à la demande de l'utilisateur)
- [x] Résumés de 2 lignes en français pour les articles longs et les fiches vuln
- [x] Briefing du matin : toutes les actus depuis le précédent, avec repli sans IA
- [x] Écran Briefing et statut Ollama dans les réglages
- [x] README final
