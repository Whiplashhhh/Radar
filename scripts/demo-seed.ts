/**
 * Base de démonstration déterministe (e2e Playwright, captures d'écran).
 * Usage : npx tsx scripts/demo-seed.ts <dossier-data>
 */
import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import { eq, like } from 'drizzle-orm';
import { loadConfig } from '../server/src/config';
import { openDb } from '../server/src/db/client';
import { briefings, feeds, items, type Feed } from '../server/src/db/schema';
import { seedIfEmpty } from '../server/src/seed';
import { createServices } from '../server/src/services/container';
import { buildSections } from '../server/src/services/briefing';

const dataDir = path.resolve(process.argv[2] ?? 'data-demo');
fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(dataDir, { recursive: true });
const config = loadConfig({ ...process.env, DATA_DIR: dataDir });
const db = openDb(config.dbPath);
seedIfEmpty(db);
const log = pino({ level: 'silent' });
const services = createServices(config, db, log, { fetcher: async () => { throw new Error('offline demo'); } });

const now = Date.now();
const H = 3600_000;
const feed = (pattern: string): Feed => {
  const f = db.select().from(feeds).where(like(feeds.url, `%${pattern}%`)).get();
  if (!f) throw new Error(`feed ${pattern}`);
  return { ...f, lastSuccessAt: now - H }; // pas « premier fetch » : les notifs fonctionnent
};

const ghsa = feed('api.github.com/advisories');
const kev = feed('kev-data');
services.pipeline.ingest(kev, {
  notModified: false,
  items: [],
  vulns: [
    { id: 'CVE-2026-41022', severity: 'high', cvssScore: 8.1, cvssVersion: '3.1', cvssVector: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:H', epss: 0.41, epssPercentile: 0.97, cpes: ['cpe:2.3:a:openbsd:openssh:*:*:*:*:*:*:*:*'], affected: [{ ecosystem: 'cpe', package: 'openbsd:openssh', vulnerable: '≥ 8.5p1, < 9.8p1' }], title: 'OpenSSH Signal Handler Race Condition Vulnerability', description: 'OpenBSD OpenSSH : a signal handler race condition in sshd allows unauthenticated remote code execution as root on glibc-based Linux systems.', kev: true, kevAddedAt: new Date(now - 20 * H).toISOString().slice(0, 10), kevDueAt: new Date(now + 14 * 24 * H).toISOString().slice(0, 10), kevRansomware: false, sourceUrl: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog?search_api_fulltext=CVE-2026-41022', sourceTitle: 'CISA KEV', surface: true, publishedAt: now - 30 * H },
    { id: 'CVE-2026-39811', title: 'Microsoft Windows SMB Client Privilege Escalation', description: 'Microsoft Windows : SMB client improper access control allows local privilege escalation.', kev: true, kevAddedAt: new Date(now - 50 * H).toISOString().slice(0, 10), kevRansomware: true, sourceUrl: 'https://www.cisa.gov/kev/CVE-2026-39811', sourceTitle: 'CISA KEV', surface: true, publishedAt: now - 60 * H },
  ],
});
services.pipeline.ingest(ghsa, {
  notModified: false,
  items: [],
  vulns: [
    { id: 'CVE-2026-40417', aliases: ['GHSA-r4qm-7c2p-xx9w'], title: 'Spring Boot Actuator exposes heap dump to unauthenticated users', description: 'When Spring Boot Actuator is on the classpath and the heapdump endpoint is exposed over HTTP, an unauthenticated attacker can download a heap dump containing credentials.', severity: 'critical', cvssScore: 9.8, cvssVector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', cvssVersion: '3.1', epss: 0.62, epssPercentile: 0.98, affected: [{ ecosystem: 'maven', package: 'org.springframework.boot:spring-boot-actuator', vulnerable: '>= 3.3.0, < 3.3.9', patched: '3.3.9' }, { ecosystem: 'maven', package: 'org.springframework.boot:spring-boot-actuator', vulnerable: '>= 3.4.0, < 3.4.3', patched: '3.4.3' }], references: [{ url: 'https://spring.io/security/cve-2026-40417' }], sourceUrl: 'https://github.com/advisories/GHSA-r4qm-7c2p-xx9w', sourceTitle: 'GitHub Advisory Database', surface: true, publishedAt: now - 2 * H },
    { id: 'CVE-2026-40102', aliases: ['GHSA-9wv6-86v2-598j'], title: 'Vue compiler-sfc XSS via crafted v-bind in style blocks', description: 'A crafted single-file component can inject arbitrary script through v-bind() in <style> blocks.', severity: 'high', cvssScore: 7.4, cvssVersion: '3.1', epss: 0.004, affected: [{ ecosystem: 'npm', package: '@vue/compiler-sfc', vulnerable: '< 3.5.14', patched: '3.5.14' }], sourceUrl: 'https://github.com/advisories/GHSA-9wv6-86v2-598j', sourceTitle: 'GitHub Advisory Database', surface: true, publishedAt: now - 5 * H },
    { id: 'CVE-2026-39950', aliases: ['GHSA-q34m-jh98-gwm2'], title: 'undici: proxy credentials leaked on cross-origin redirect', description: 'undici forwards Proxy-Authorization headers to a different origin after a redirect.', severity: 'medium', cvssScore: 5.9, cvssVersion: '3.1', epss: 0.002, affected: [{ ecosystem: 'npm', package: 'undici', vulnerable: '< 7.4.1', patched: '7.4.1' }], sourceUrl: 'https://github.com/advisories/GHSA-q34m-jh98-gwm2', sourceTitle: 'GitHub Advisory Database', surface: true, publishedAt: now - 9 * H },
    { id: 'CVE-2026-38700', aliases: ['GHSA-xg4c-9fq5-v2h3'], title: 'django-allauth: open redirect in OAuth callback', description: 'Open redirect in the OAuth login flow.', severity: 'low', cvssScore: 3.1, affected: [{ ecosystem: 'pip', package: 'django-allauth', vulnerable: '< 65.4.1', patched: '65.4.1' }], sourceUrl: 'https://github.com/advisories/GHSA-xg4c-9fq5-v2h3', surface: true, publishedAt: now - 12 * H },
  ],
});

type A = { guid: string; title: string; url: string; summary: string; h: number; content?: string };
const articles: Record<string, A[]> = {
  'cert.ssi.gouv.fr/alerte': [
    { guid: 'CERTFR-2026-ALE-014', title: 'Vulnérabilité dans OpenSSH (CVE-2026-41022)', url: 'https://www.cert.ssi.gouv.fr/alerte/CERTFR-2026-ALE-014/', summary: 'Une vulnérabilité a été découverte dans OpenSSH. Elle permet à un attaquant non authentifié de provoquer une exécution de code arbitraire à distance. Le CERT-FR a connaissance de tentatives d’exploitation.', h: 3 },
  ],
  'cert.ssi.gouv.fr/avis': [
    { guid: 'CERTFR-2026-AVI-1192', title: 'Multiples vulnérabilités dans le noyau Linux d’Ubuntu', url: 'https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1192/', summary: 'De multiples vulnérabilités ont été découvertes dans le noyau Linux d’Ubuntu. Certaines permettent une élévation de privilèges (CVE-2026-37122, CVE-2026-37123).', h: 7 },
  ],
  bleepingcomputer: [
    { guid: 'bc-1', title: 'Hackers exploit critical Spring Boot Actuator flaw to steal cloud keys', url: 'https://www.bleepingcomputer.com/news/security/spring-boot-actuator-flaw/', summary: 'Threat actors are actively scanning for exposed Spring Boot Actuator heapdump endpoints (CVE-2026-40417) to harvest AWS credentials.', h: 1.5 },
    { guid: 'bc-2', title: 'Microsoft November 2026 Patch Tuesday fixes 4 zero-days', url: 'https://www.bleepingcomputer.com/news/microsoft/patch-tuesday-nov-2026/', summary: 'Microsoft fixed 63 flaws including four actively exploited zero-days, one of them in the Windows SMB client (CVE-2026-39811).', h: 26 },
  ],
  TheHackersNews: [
    { guid: 'thn-1', title: 'New Android banking trojan abuses accessibility services in Europe', url: 'https://thehackernews.com/2026/11/android-banking-trojan.html', summary: 'A new Android malware family targets banking apps across France, Spain and Italy.', h: 10 },
  ],
  'zataz.com': [
    { guid: 'zataz-1', title: 'Fuite de données : un prestataire santé laisse 2 millions de dossiers en accès libre', url: 'https://www.zataz.com/fuite-sante-2026/', summary: 'Un serveur Elasticsearch mal configuré exposait des données de patients.', h: 14 },
  ],
  hnrss: [
    { guid: 'hn-1', title: 'Show HN: A self-hosted Tailscale-only RSS reader with push notifications', url: 'https://news.ycombinator.com/item?id=4242', summary: 'Points: 312 · Comments: 98', h: 4 },
    { guid: 'hn-2', title: 'SQLite 3.50 adds native JSONB indexing', url: 'https://sqlite.org/releaselog/3_50_0.html', summary: 'Points: 540 · Comments: 211', h: 8 },
  ],
  'lwn.net': [
    { guid: 'lwn-1', title: 'Rust in the kernel: the 6.19 merge window', url: 'https://lwn.net/Articles/1001/', summary: 'A look at the Rust abstractions merged for 6.19, including the new DRM driver support.', h: 18 },
  ],
  'next.ink': [
    { guid: 'next-1', title: 'Ollama 0.9 : les modèles locaux gagnent l’appel d’outils parallèle', url: 'https://next.ink/ollama-0-9/', summary: 'La nouvelle version d’Ollama accélère l’inférence sur GPU AMD et ajoute l’appel d’outils parallèle.', h: 6, content: `<p>${'Ollama poursuit son rythme effréné de sorties. '.repeat(60)}</p>` },
  ],
  arstechnica: [
    { guid: 'ars-1', title: 'The EU’s new Cyber Resilience Act deadlines are coming fast', url: 'https://arstechnica.com/tech-policy/2026/11/cra/', summary: 'Vendors have less than a year to comply with reporting obligations.', h: 20 },
  ],
  'korben.info': [
    { guid: 'korben-1', title: 'Pi-hole v6.2 : le tableau de bord fait peau neuve', url: 'https://korben.info/pihole-6-2.html', summary: 'Nouvelle interface, API REST complète et support DNS-over-HTTPS natif.', h: 30 },
  ],
  'vuejs/core': [{ guid: 'tag:github.com,2008:Repository/137078487/v3.5.14', title: 'v3.5.14', url: 'https://github.com/vuejs/core/releases/tag/v3.5.14', summary: '<p>Bug fixes: <b>compiler-sfc</b> — sanitize v-bind in style (CVE-2026-40102).</p>', h: 4.5 }],
  'spring-projects/spring-boot': [{ guid: 'tag:github.com,2008:Repository/6296790/v3.4.3', title: 'v3.4.3', url: 'https://github.com/spring-projects/spring-boot/releases/tag/v3.4.3', summary: '<p>This release fixes CVE-2026-40417 and 41 bugs.</p>', h: 2.5 }],
  'tailscale/tailscale': [{ guid: 'tag:github.com,2008:Repository/1/v1.90.2', title: 'v1.90.2', url: 'https://github.com/tailscale/tailscale/releases/tag/v1.90.2', summary: '<p>Linux: fix MagicDNS with systemd-resolved.</p>', h: 22 }],
};
for (const [pattern, list] of Object.entries(articles)) {
  const f = feed(pattern);
  services.pipeline.ingest(f, {
    notModified: false,
    items: list.map((a) => ({ guid: a.guid, title: a.title, url: a.url, summaryHtml: a.summary.startsWith('<') ? a.summary : `<p>${a.summary}</p>`, contentHtml: a.content ?? null, publishedAt: now - a.h * H, kind: pattern.includes('/') && !pattern.includes('.') ? 'release' : 'article' })),
    vulns: [],
  });
}

// État de lecture, favoris, résumé IA
const byGuid = (g: string) => db.select().from(items).where(eq(items.guid, g)).get();
db.update(items).set({ readAt: now - H }).where(eq(items.guid, 'ars-1')).run();
db.update(items).set({ readAt: now - H }).where(eq(items.guid, 'korben-1')).run();
db.update(items).set({ starredAt: now - H }).where(eq(items.guid, 'hn-2')).run();
db.update(items).set({ starredAt: now - H }).where(eq(items.guid, 'vuln:CVE-2026-40417')).run();
const ollamaItem = byGuid('next-1');
if (ollamaItem) db.update(items).set({ aiSummary: 'Ollama 0.9 accélère l’inférence sur GPU AMD.\nNouveauté : appel d’outils en parallèle pour les agents locaux.' }).where(eq(items.id, ollamaItem.id)).run();
db.update(items).set({ readableHtml: `<h2>Spring Boot Actuator sous le feu</h2><p>Les chercheurs ont observé des scans massifs visant <code>/actuator/heapdump</code>. Les versions 3.3.0 à 3.3.8 et 3.4.0 à 3.4.2 sont touchées.</p><p>Mettez à jour vers <strong>3.3.9</strong> ou <strong>3.4.3</strong>, ou restreignez l’exposition des endpoints :</p><pre><code>management.endpoints.web.exposure.include=health,info</code></pre><blockquote>« Plus de 12 000 instances exposées », selon Shadowserver.</blockquote>`, readableFetchedAt: now }).where(eq(items.guid, 'bc-1')).run();

// Santé des flux : la plupart OK, un en erreur
for (const f of db.select().from(feeds).all()) {
  db.update(feeds).set({ lastFetchAt: now - 8 * 60_000, lastSuccessAt: now - 8 * 60_000, nextFetchAt: now + 22 * 60_000 }).where(eq(feeds.id, f.id)).run();
}
db.update(feeds).set({ errorCount: 3, lastError: 'HTTP 503', lastSuccessAt: now - 26 * H, nextFetchAt: now + 4 * H }).where(like(feeds.url, '%krebsonsecurity%')).run();
db.$client.exec(`UPDATE feeds SET item_count = (SELECT count(*) FROM items i WHERE i.feed_id = feeds.id)`);

// Briefing du matin (version « Ollama » pour la démo)
const rows = db.$client.prepare(`SELECT i.id, i.title, i.summary_html, i.kind, i.score, i.severity, i.kev, i.techs, i.ai_summary, f.category, f.title AS feed_title FROM items i JOIN feeds f ON f.id = i.feed_id`).all() as Parameters<typeof buildSections>[0];
db.insert(briefings).values({
  createdAt: now - 1.2 * H,
  periodStart: now - 25 * H,
  periodEnd: now - 1.2 * H,
  itemCount: rows.length,
  model: 'llama3.2',
  sections: buildSections(rows, 5),
  summary: [
    'Nuit agitée côté sécurité : une faille **OpenSSH** exploitée activement et une **CVE critique sur Spring Boot Actuator** touchent directement votre stack.',
    '',
    '## Sécurité',
    '- **CVE-2026-41022** (**OpenSSH**) : exécution de code à distance sans authentification, ajoutée au catalogue KEV et signalée par le CERT-FR. Mettez à jour sshd en priorité.',
    '- **CVE-2026-40417** (**Spring**) : l’endpoint heapdump d’Actuator laisse fuiter des secrets, CVSS 9,8 et EPSS 62 %. Corrigée en 3.3.9 et 3.4.3.',
    '- **CVE-2026-40102** (**Vue.js**) : XSS dans compiler-sfc, corrigée en 3.5.14.',
    '',
    '## Releases',
    '- Spring Boot 3.4.3, Vue 3.5.14 et Tailscale 1.90.2 sont disponibles.',
    '',
    '## Tech',
    '- SQLite 3.50 ajoute l’indexation JSONB native, et Ollama 0.9 accélère l’inférence sur GPU AMD.',
  ].join('\n'),
}).run();

console.log(`demo data ready in ${dataDir}: ${(db.$client.prepare('SELECT count(*) n FROM items').get() as { n: number }).n} items`);
db.$client.close();
