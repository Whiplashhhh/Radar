# Radar — Spécification

Lecteur RSS auto-hébergé, mono-utilisateur, orienté veille sécurité et tech. PWA mobile first, servie par un unique conteneur, accessible via Tailscale uniquement.

## 1. Architecture

```
┌──────────── conteneur radar (node:22) ────────────┐
│ Fastify ── /api/* (JSON)  ── /health              │
│    │        └─ sert web/dist (SPA + SW + manifest) │
│    ├─ Scheduler (setInterval, pas de cron externe) │
│    │   ├─ Poller      : flux dus → adaptateurs     │
│    │   ├─ Enricher    : NVD (CVSS), EPSS, KEV      │
│    │   ├─ Notifier    : file → regroupement → push │
│    │   ├─ Digest      : quotidien (Europe/Paris)   │
│    │   ├─ Retention   : purge quotidienne          │
│    │   └─ Summarizer  : Ollama (optionnel)         │
│    └─ SQLite (better-sqlite3 + Drizzle, FTS5)      │
└──────────── volume ./data : radar.db, vapid.json ─┘
```

- Monorepo à un seul `package.json` : `server/` (Fastify + TS, bundlé par esbuild) et `web/` (React + Vite).
- Toutes les sorties réseau passent par `safeFetch` : anti-SSRF, timeout, taille max, redirections manuelles.

## 2. Modèle de données (SQLite, migrations Drizzle dans `drizzle/`)

| Table | Rôle | Colonnes principales |
|---|---|---|
| `feeds` | Sources | `url` (unique), `title`, `site_url`, `category` (`security`/`tech`/`news`/`releases`), `adapter` (`rss`/`atom`/`cisa-kev`/`github-advisories`), `options` (JSON : écosystèmes GHSA, `boost`, `notify`), `poll_interval_min`, `enabled`, `etag`, `last_modified`, `last_fetch_at`, `last_success_at`, `next_fetch_at`, `error_count`, `last_error` |
| `items` | Entrées du fil | `feed_id`, `guid`, `url`, `canonical_url`, `title`, `summary_html`, `content_html`, `author`, `published_at`, `fetched_at`, `kind` (`article`/`vuln`/`release`), `vuln_id` (pour les cartes vuln), `title_key` (dédup), `score`, `read_at`, `starred_at`, `readable_html`, `ai_summary` |
| `items_fts` | FTS5 (title, summary, content), triggers de synchro | — |
| `vulns` | Fiche vulnérabilité fusionnée | `id` (CVE si connu, sinon GHSA), `aliases` (JSON), `title`, `description`, `cvss_score`, `cvss_vector`, `cvss_version`, `severity`, `epss`, `epss_percentile`, `kev`, `kev_added_at`, `kev_due_at`, `kev_ransomware`, `affected` (JSON : écosystème, package, plages vulnérables, versions corrigées), `cpes` (JSON), `references` (JSON), `published_at`, `score`, `match_level`, `nvd_checked_at`, `epss_checked_at`, `ai_summary`, `first_seen_at` |
| `vuln_sources` | Mentions d'une vuln | `vuln_id`, `feed_id`, `item_id?`, `url`, `title`, `seen_at` (unique vuln+url) |
| `watchlist` | Technos suivies | `name`, `aliases` (JSON), `cpes` (JSON `vendor:product`), `packages` (JSON `eco:name`, `*` autorisé), `exclude` (JSON), `enabled` |
| `matches` | Résultats du matching | `vuln_id?`, `item_id?`, `watch_id`, `level` (`certain`/`probable`), `reason` |
| `settings` | Clé/valeur JSON | règles de notif, heures calmes, digest, rétention, seuils, thème |
| `push_subscriptions` | Appareils | `endpoint` (unique), `p256dh`, `auth`, `user_agent`, `created_at`, `last_success_at`, `failures` |
| `notifications` | File et historique | `target_type` (`vuln`/`item`/`group`/`digest`/`test`), `target_id`, `tier` (`immediate`/`digest`), `critical`, `title`, `body`, `url`, `created_at`, `not_before`, `sent_at`, `status` (`pending`/`sent`/`grouped`/`skipped`) |

Les items lus depuis plus de `retention.days` (30 par défaut) sont purgés, sauf les favoris et les items liés à une vuln qui matche la watchlist.

## 3. Adaptateurs de source

Interface : `fetch(feed, ctx) → { items: RawItem[], vulns: RawVuln[], etag, lastModified, notModified }`.

| Adaptateur | Source | Notes |
|---|---|---|
| `rss` / `atom` | XML (fast-xml-parser) | Détection automatique du format ; RSS 2.0, RSS 1.0/RDF et Atom 1.0. HTML assaini par `sanitize-html`. |
| `cisa-kev` | JSON KEV (miroir GitHub officiel `cisagov/kev-data`) | Chaque entrée produit une `RawVuln` avec `kev=true` et les dates. Seules les entrées des 30 derniers jours génèrent une carte dans le fil (les anciennes servent à enrichir). |
| `github-advisories` | `GET https://api.github.com/advisories?type=reviewed&ecosystem=…&per_page=100` | Option `ecosystems` (maven, npm, pip, pub…). Produit les packages, plages vulnérables, versions corrigées, CVSS, EPSS (si fourni), alias CVE. `GITHUB_TOKEN` facultatif. |
| `nvd` (enrichisseur) | NVD API 2.0 `?cveId=` | CVSS v3.1 > v3.0 > v4.0 > v2, CPE des configurations. Limite : 5 req/30 s sans clé, 50 avec `NVD_API_KEY`. Re-vérification après 24 h tant que la vuln a moins de 30 jours. |
| `epss` (enrichisseur) | `https://api.first.org/data/v1/epss?cve=a,b,c` | Lots de 100 CVE, rafraîchis toutes les 24 h. |

Tous les fetchs envoient `If-None-Match` et `If-Modified-Since`. En cas d'erreur, le backoff est `interval × 2^min(errors,6)`, plafonné à 24 h. Timeout de 20 s, corps limité à 10 Mo.

## 4. Pipeline d'ingestion

1. L'adaptateur retourne les items et vulns bruts.
2. **Dédup des items** : clé `(feed_id, guid)`, puis URL canonique (sans `utm_*`, sans fragment, sans `/` final) et titre normalisé sur 72 h, tous flux confondus. Un doublon d'un autre flux est rattaché comme source supplémentaire.
3. **Extraction d'identifiants** : regex `CVE-\d{4}-\d{4,}` et `GHSA-xxxx-xxxx-xxxx` sur titre, résumé et contenu.
4. **Fusion des vulns** : chaque identifiant pointe vers une seule fiche. La clé est le CVE. Une fiche GHSA qui obtient plus tard un alias CVE est fusionnée dans la fiche CVE. Chaque mention crée une ligne `vuln_sources`. À la première apparition, une carte `kind=vuln` est créée dans le fil.
5. **Matching watchlist** (§5), puis **score** (§6), puis **règles de notif** (§7).

## 5. Matching watchlist

Pour chaque entrée active de la watchlist, dans cet ordre :
1. **Package** (`eco:name`, glob `*`) contre `affected[].ecosystem/package` → `certain`.
2. **CPE** `vendor:product` contre les CPE NVD (`cpe:2.3:a:vendor:product:…`) → `certain`.
3. **Mots-clés** (nom + alias) cherchés avec des frontières de mot Unicode (`(?<![\p{L}\p{N}_.-])mot(?![\p{L}\p{N}_-])`), insensibles à la casse, dans le titre, la description et les noms de package → `probable`. Un alias écrit en MAJUSCULES ou contenant une majuscule interne (`OpenSSH`, `n8n`) reste insensible à la casse. Un alias marqué `=Mot` est sensible à la casse (ex. `=React` pour ne pas matcher « react » en minuscules, verbe anglais).
4. **Exclusions** : si un mot d'exclusion est présent, un match `probable` est annulé. Un match `certain` est conservé.

Le meilleur niveau gagne. Cas pièges couverts par les tests : « React » vs « reactive », « reaction » et « react to » ; « Go » ; « Node » vs « node-fetch » ; « Python » vs « python-requests » (package) ; « Docker » vs « Docker Desktop » ; « Chrome » vs « Chromecast ».

## 6. Score de priorité (0–100)

Pour une **vuln** :

| Composante | Points |
|---|---|
| Sévérité CVSS (ou GHSA) | critique (≥ 9) **40**, haute (≥ 7) **30**, moyenne (≥ 4) **15**, basse **5**, inconnue **10** |
| KEV | **+25** |
| EPSS | ≥ 0,5 **+20** ; ≥ 0,1 **+12** ; ≥ 0,01 **+5** |
| Watchlist | certain **+30**, probable **+15** |

Le score est borné à 100. Pour un **article** : base par catégorie (sécurité 20, releases 15, tech 10, actus 5), plus un éventuel `boost` du flux (CERT-FR alertes +50), plus un match watchlist (certain +25, probable +10), et au minimum `scoreVuln − 10` pour la meilleure vuln mentionnée.

Seuils : **Prioritaire** si ≥ 60. Badge d'app = items non lus avec un score ≥ 60.

Exemples : une CVE critique, KEV, sur Spring (certain) vaut 100. Une CVE haute sur Vue (certain) vaut 60. Une CVE moyenne probable vaut 30. Une CVE critique hors watchlist, sans KEV ni EPSS, vaut 40.

## 7. Notifications

Règles par défaut (modifiables dans Réglages) :
- **Immédiat** : vuln qui matche (`certain` ou `probable`, réglable) ET (CVSS ≥ 9 OU KEV OU EPSS ≥ 0,3). S'y ajoutent les items des flux marqués `notify: immediate` (CERT-FR alertes).
- **Digest quotidien** à 08:00 Europe/Paris : vulns matchées de sévérité moyenne ou haute non notifiées, et top 5 des articles des dernières 24 h par score.
- **Rien** : le reste.

Mécanique :
- Les entrées passent par la table `notifications` (`pending`). Le dispatcher tourne toutes les 30 s.
- **Regroupement** : une notif est envoyée au plus tôt 60 s après la première en attente, et au plus une toutes les 5 min. Si plusieurs sont en attente, une seule notif groupée part (« 4 nouvelles CVE critiques »), avec les technos touchées et un lien vers l'onglet Prioritaire.
- **Heures calmes** (22:00–07:00 par défaut) : les notifs non critiques sont décalées à la fin de la plage. Une notif est critique si la vuln est KEV ou CVSS ≥ 9 avec un match `certain`.
- **Payload autonome** : `{ title, body, url, tag, severity, techs, badge }`. Le service worker affiche la notif sans appel réseau. Le clic ouvre `url` (`/vuln/CVE-…` ou `/item/:id`).
- Clés VAPID générées au premier démarrage dans `data/vapid.json`. `VAPID_SUBJECT` est configurable. Un abonnement qui reçoit un 404 ou 410 est supprimé.

## 8. API HTTP

`GET /health` · `GET/POST/PATCH/DELETE /api/feeds[/:id]` · `POST /api/feeds/:id/refresh` · `POST /api/refresh` · `GET /api/opml` · `POST /api/opml` · `GET /api/items?view=priority|security|tech|all&q&feed&tech&severity&unread&starred&cursor` · `GET/PATCH /api/items/:id` · `POST /api/items/mark-read` (vue et filtres, jusqu'à `until`) · `GET /api/vulns/:id` · `GET/POST/PATCH/DELETE /api/watchlist[/:id]` · `GET/PUT /api/settings` · `GET /api/push/key` · `POST /api/push/subscribe|unsubscribe|test` · `GET /api/stats`.

## 9. Écrans (barre d'onglets en bas)

1. **Prioritaire** : items avec un score ≥ 60, non lus d'abord.
2. **Sécurité** : catégorie sécurité, cartes vuln comprises.
3. **Tech** : catégories tech et releases.
4. **Tout** : tout, actus comprises.
5. **Réglages** : notifications (activation, test, règles, heures calmes, digest), watchlist, flux (ajout, OPML, santé), affichage (thème), rétention.

Chaque liste propose une recherche (FTS5), des filtres (source, techno, sévérité, lu/non lu, favoris), le pull-to-refresh, le swipe (droite : lu ; gauche : favori) et « tout marquer comme lu jusqu'ici ». Les vues de détail sont **Article** (lecture épurée via Readability côté serveur, lien vers l'original) et **Fiche vuln** (CVSS, EPSS, KEV, technos, versions, sources). Un écran d'installation iOS s'affiche si l'on active les notifs hors du mode standalone.

## 10. Sécurité et exploitation

- Port publié `127.0.0.1:${PORT}:${PORT}` uniquement. HTTPS via `tailscale serve`.
- Helmet : CSP stricte (`default-src 'self'`, `img-src 'self' https: data:`, `object-src 'none'`, `frame-ancestors 'none'`), `nosniff`, `Referrer-Policy: no-referrer`.
- Anti-SSRF : blocage des IP privées, loopback, link-local, CGNAT (donc Tailscale 100.64/10), ULA et multicast, avec vérification à chaque redirection. `ALLOW_PRIVATE_NETWORKS=true` lève le blocage.
- Logs JSON via pino. Healthcheck Docker sur `/health`.
- Ollama (`OLLAMA_URL`, `OLLAMA_MODEL`) : résumé de 2 lignes en français pour les articles de plus de 1 500 caractères et pour les fiches vuln. L'appel est autorisé même si l'URL est privée, puisqu'elle vient de la configuration.
