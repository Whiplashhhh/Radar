# HANDOFF — Radar (lecteur RSS veille sécu, PWA)
STATUS: CONTINUE
Session: 1

## Mission
Construire Radar de bout en bout selon `PROMPT.md` (lire en entier). Phases a→f, SPEC.md/PLAN.md/DECISIONS.md tenus à jour, commits petits et fréquents (demande explicite de l'utilisateur).
Ajout utilisateur : Ollama n'est PLUS optionnel côté dev → résumés par article + **briefing quotidien du matin** résumant toutes les news depuis le dernier briefing (seulement s'il y a des news). Doit toujours fonctionner sans OLLAMA_URL.

## Critères de fin
- [x] SPEC.md, PLAN.md, DECISIONS.md
- [x] Backend complet démarre, /health ok, collecte réelle KEV/GHSA/releases OK
- [x] Tests Vitest — 103 verts (`npm test`)
- [x] Briefing Ollama quotidien backend (services/briefing.ts, intégré à notifier.digest) — UI à faire
- [ ] Frontend React/Tailwind/PWA complet (onglets, cartes, fiche vuln, réglages, swipe, PTR, offline, iOS install, badge)
- [ ] Playwright e2e + captures docs/screenshots (iPhone 390×844 + desktop, sombre + clair), relues
- [x] Dockerfile, docker-compose (127.0.0.1), CI (.github/workflows/ci.yml, feeds.yml) — non exécutables ici
- [ ] README complet
- [ ] lint + typecheck + test + build verts

## Contraintes et décisions
- Pas de Docker ni réseau (sauf GitHub/npm) dans le bac à sable : voir DECISIONS.md.
- Playwright épinglé 1.64.0 (chromium /ms-playwright rev 1248).
- web-push v4 est ESM sans default : `import * as webpush`.
- Ne jamais `pkill -f` avec un motif présent dans la commande (tue le shell) : utiliser ps|grep [x]|kill.

## État actuel
Backend complet + testé + commité. Front pas commencé (web/ vide). npm run check:feeds : 13/26 OK (le reste = réseau bac à sable).

## Prochaine étape
Frontend : web/vite.config.ts, index.html, src/{main.tsx,sw.ts,index.css,api.ts,lib,components,pages}. Onglets Prioritaire/Sécurité/Tech/Tout/Réglages + pages item, vuln, briefing, réglages (notifs, watchlist, flux/santé, Ollama).

## Fichiers clés
- `server/src/services/pipeline.ts` — ingestion, fusion vulns, matching, scoring
- `server/src/services/notifier.ts` — règles notif, dispatch, digest
- `server/src/services/queries.ts` — listes du fil, mark-read
- `server/src/routes/*.ts` — API

## Commandes utiles
- `npx tsc -p server/tsconfig.json --noEmit && npx eslint server`
- `DATA_DIR=<scratch>/d1 PORT=8799 DISABLE_SCHEDULER=1 npx tsx server/src/index.ts`

## Pièges
- voir Contraintes
