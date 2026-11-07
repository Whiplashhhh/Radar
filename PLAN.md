# Plan

Chaque phase se termine par : `npm run lint && npm run typecheck && npm test && npm run build`, puis démarrage du serveur buildé avec `/health` vert. La CI construit l'image Docker.

## (a) Squelette, Docker, CI
- [ ] package.json unique, TS strict, ESLint (flat), Vitest, Playwright
- [ ] Fastify + `/health` + pino + helmet, service du front buildé
- [ ] Drizzle + better-sqlite3, première migration, settings par défaut
- [ ] React + Vite + Tailwind, coquille avec barre d'onglets
- [ ] Dockerfile multi-stage (node:22-bookworm-slim), docker-compose (127.0.0.1, volume ./data, healthcheck)
- [ ] GitHub Actions : lint, typecheck, test, build, e2e, docker build

## (b) Collecte RSS et fil basique
- [ ] safeFetch (SSRF, timeout, taille, ETag/IMS, redirections)
- [ ] Parser RSS/Atom, sanitize, dédup, ingestion, FTS5
- [ ] Poller avec backoff, santé des flux
- [ ] Auto-découverte, OPML import/export, seed des flux vérifiés
- [ ] API items + fil, détail article avec Readability

## (c) Watchlist, CVE et scoring
- [ ] Extraction CVE/GHSA, fusion des vulns, vuln_sources
- [ ] Adaptateurs CISA KEV, GitHub Advisories, enrichisseurs NVD et EPSS
- [ ] Matching (tests pièges), scoring documenté et testé
- [ ] Watchlist CRUD + seed, fiche vuln

## (d) PWA et push
- [ ] vite-plugin-pwa (injectManifest), manifest, icônes, SW push et clic
- [ ] VAPID, abonnements, envoi, purge 404/410, notif de test
- [ ] Règles, digest, heures calmes, regroupement
- [ ] Écran d'installation iOS, Badging API

## (e) Finition UI et hors-ligne
- [ ] Swipe, pull-to-refresh, tout marquer lu jusqu'ici, filtres, recherche
- [ ] Cache API (NetworkFirst) et préchargement favoris et derniers items
- [ ] Thème clair et sombre, safe areas, a11y, reduced-motion
- [ ] Captures Playwright (iPhone et desktop, sombre et clair) dans `docs/screenshots/`, relecture et corrections
- [ ] Rétention

## (f) Ollama (devenu prioritaire à la demande de l'utilisateur)
- [x] Résumés de 2 lignes en français pour les articles longs et les fiches vuln
- [x] Briefing du matin : toutes les actus depuis le précédent, avec repli sans IA
- [ ] Écran Briefing et statut Ollama dans les réglages
- [ ] README final
