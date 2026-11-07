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
