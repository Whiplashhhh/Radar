/**
 * Vérifie que chaque URL du seed répond avec un flux valide.
 * Usage : npm run check:feeds   (code de sortie 1 si au moins un flux est mort)
 */
import { parseFeed } from '../server/src/adapters/rss';
import { safeFetch } from '../server/src/lib/safe-fetch';
import { hnUrl, SEED_FEEDS } from '../server/src/seed/feeds';

const extra = [
  { title: 'NVD API 2.0', url: 'https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=CVE-2021-44228', kind: 'json' },
  { title: 'EPSS', url: 'https://api.first.org/data/v1/epss?cve=CVE-2021-44228', kind: 'json' },
];

const targets = [
  ...SEED_FEEDS.map((f) => ({ title: f.title.replace('{HN_POINTS}', '150'), url: f.url.includes('{HN_POINTS}') ? hnUrl(150) : f.url, kind: f.adapter && f.adapter !== 'rss' ? 'json' : 'xml' })),
  ...extra,
];

let dead = 0;
await Promise.all(
  targets.map(async (t) => {
    try {
      const res = await safeFetch(t.url, { timeoutMs: 20_000, userAgent: 'Radar feed check' });
      if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
      let detail: string;
      if (t.kind === 'json') {
        const j = res.json<unknown>();
        detail = Array.isArray(j) ? `${j.length} entrées` : 'JSON ok';
      } else {
        const f = parseFeed(res.text(), res.url);
        const last = Math.max(...f.items.map((i) => i.publishedAt ?? 0));
        detail = `${f.format}, ${f.items.length} items, dernier : ${last ? new Date(last).toISOString().slice(0, 10) : '?'}`;
      }
      console.log(`OK    ${t.title.padEnd(32)} ${detail}${res.url !== t.url ? `  (redirigé → ${res.url})` : ''}`);
    } catch (err) {
      dead++;
      console.log(`MORT  ${t.title.padEnd(32)} ${(err as Error).message}  ${t.url}`);
    }
  }),
);
console.log(`\n${targets.length - dead}/${targets.length} sources OK`);
process.exit(dead ? 1 : 0);
