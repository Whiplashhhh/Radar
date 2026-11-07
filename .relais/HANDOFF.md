# HANDOFF — Radar (lecteur RSS veille sécu, PWA)
STATUS: DONE
Session: 1

## Mission
Construire Radar de bout en bout selon `PROMPT.md`, avec un ajout de l'utilisateur : résumés Ollama et briefing quotidien du matin (toutes les news depuis le dernier briefing, seulement s'il y en a). Commits réguliers.

## Critères de fin
- [x] SPEC.md, PLAN.md, DECISIONS.md à jour
- [x] Backend complet, collecte réelle KEV/GHSA/releases vérifiée (serveur buildé, scheduler actif pendant 100 s)
- [x] Vitest : 103 tests verts
- [x] Briefing Ollama : backend, UI, tests (faux serveur Ollama)
- [x] Frontend PWA complet
- [x] Playwright : 69 tests verts, captures dans docs/screenshots (iPhone + desktop, sombre + clair), relues
- [x] Dockerfile, docker-compose (127.0.0.1), CI — NON exécutés ici (pas de Docker, pas de push)
- [x] README complet
- [x] lint, typecheck, test, build verts

## Contraintes et décisions
- Voir DECISIONS.md. Bac à sable sans Docker, réseau limité à GitHub et npm.

## État actuel
Tout est terminé et commité. Restent hors de portée du bac à sable : `docker compose up` réel, première exécution de la CI (le dépôt n'est pas poussé) et vérification des 13 flux non-GitHub (`npm run check:feeds` ou workflow feeds.yml).

## Prochaine étape
Pousser sur GitHub (avec l'accord de l'utilisateur) et vérifier la CI.

## Reste à faire
1. Push et CI verte (jobs docker, e2e, feeds)

## Fichiers clés
- `server/src/services/pipeline.ts`, `notifier.ts`, `briefing.ts`
- `web/src/pages/*`, `web/src/sw.ts`

## Commandes utiles
- `npm run lint && npm run typecheck && npm test && npm run build && npx playwright test`

## Pièges
- Ne jamais lancer `pkill -f` avec un motif présent dans la commande elle-même : ça tue le shell.
- web-push v4 : `import * as webpush`.
- Fastify : déclarer `setErrorHandler` avant d'enregistrer les routes.
- fast-xml-parser : la limite d'entités par défaut casse les releases GitHub.
