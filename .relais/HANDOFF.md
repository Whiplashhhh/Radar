# HANDOFF — Radar (lecteur RSS veille sécu, PWA)
STATUS: CONTINUE
Session: 1

## Mission
Construire Radar de bout en bout selon `PROMPT.md` (lire en entier). Phases a→f, SPEC.md/PLAN.md/DECISIONS.md tenus à jour, commits petits et fréquents (demande explicite de l'utilisateur).
Ajout utilisateur : Ollama n'est PLUS optionnel côté dev → résumés par article + **briefing quotidien du matin** résumant toutes les news depuis le dernier briefing (seulement s'il y a des news). Doit toujours fonctionner sans OLLAMA_URL.

## Critères de fin
- [x] SPEC.md, PLAN.md, DECISIONS.md
- [x] Backend complet démarre, /health ok, collecte réelle KEV/GHSA/releases OK
- [ ] Tests Vitest (matching pièges, scoring, dédup, parsing, notifs, pipeline, API)
- [ ] Briefing Ollama quotidien (table, scheduler, API, UI, tests)
- [ ] Frontend React/Tailwind/PWA complet (onglets, cartes, fiche vuln, réglages, swipe, PTR, offline, iOS install, badge)
- [ ] Playwright e2e + captures docs/screenshots (iPhone 390×844 + desktop, sombre + clair), relues
- [ ] Dockerfile, docker-compose (127.0.0.1), CI GitHub Actions
- [ ] README complet
- [ ] lint + typecheck + test + build verts

## Contraintes et décisions
- Pas de Docker ni réseau (sauf GitHub/npm) dans le bac à sable : voir DECISIONS.md.
- Playwright épinglé 1.64.0 (chromium /ms-playwright rev 1248).
- web-push v4 est ESM sans default : `import * as webpush`.
- Ne jamais `pkill -f` avec un motif présent dans la commande (tue le shell) : utiliser ps|grep [x]|kill.

## État actuel
Backend dans server/src (app, config, db, adapters, core, services, routes, seed). Front pas commencé (web/ vide).

## Prochaine étape
Écrire server/test/*.test.ts puis npm test.

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
