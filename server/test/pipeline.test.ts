import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { items, notifications, vulnSources, vulns, type Feed } from '../src/db/schema';
import { addFeed, fakeResponse, rss, setup } from './helpers';

const now = Date.now();
const day = 86_400_000;

describe('pipeline', () => {
  it('ingère un article, extrait les CVE et crée une fiche unique pour plusieurs mentions', async () => {
    const { db, services } = setup();
    const a = addFeed(db, { url: 'https://a.test/feed', title: 'Source A' });
    const b = addFeed(db, { url: 'https://b.test/feed', title: 'Source B' });
    const ra = services.pipeline.ingest(a, { notModified: false, items: [{ guid: '1', url: 'https://a.test/1', title: 'OpenSSH regreSSHion CVE-2024-6387', summaryHtml: '<p>sshd flaw</p>', publishedAt: now }], vulns: [] });
    const rb = services.pipeline.ingest(b, { notModified: false, items: [{ guid: 'x', url: 'https://b.test/other', title: 'Another take on cve-2024-6387 in sshd servers', publishedAt: now }], vulns: [] });
    expect(ra.newItems).toBe(1);
    expect(rb.newItems).toBe(1);
    const v = db.select().from(vulns).all();
    expect(v.map((x) => x.id)).toEqual(['CVE-2024-6387']);
    expect(db.select().from(vulnSources).where(eq(vulnSources.vulnId, 'CVE-2024-6387')).all()).toHaveLength(2);
    expect(v[0]?.matchLevel).toBe('probable'); // OpenSSH par mot-clé
  });

  it('déduplique un même article publié par deux flux (URL canonique) et garde la mention', () => {
    const { db, services } = setup();
    const a = addFeed(db, { url: 'https://a.test/feed' });
    const b = addFeed(db, { url: 'https://b.test/feed' });
    services.pipeline.ingest(a, { notModified: false, items: [{ guid: '1', url: 'https://news.test/p?utm_source=a', title: 'Big CVE-2025-1111 story', publishedAt: now }], vulns: [] });
    const r = services.pipeline.ingest(b, { notModified: false, items: [{ guid: '2', url: 'https://www.news.test/p/', title: 'Big CVE-2025-1111 story', publishedAt: now }], vulns: [] });
    expect(r).toMatchObject({ newItems: 0, duplicates: 1 });
    expect(db.select().from(items).where(eq(items.kind, 'article')).all()).toHaveLength(1);
    expect(db.select().from(vulnSources).all().map((s) => s.feedId).sort()).toEqual([a.id, b.id].sort());
  });

  it('déduplique par titre normalisé sur 72 h', () => {
    const { db, services } = setup();
    const a = addFeed(db, { url: 'https://a.test/feed' });
    const b = addFeed(db, { url: 'https://b.test/feed' });
    services.pipeline.ingest(a, { notModified: false, items: [{ guid: '1', url: 'https://a.test/1', title: 'Faille critique dans Immich : mettez à jour', publishedAt: now - day }], vulns: [] });
    expect(services.pipeline.ingest(b, { notModified: false, items: [{ guid: '2', url: 'https://b.test/2', title: 'Faille critique dans Immich — mettez a jour !', publishedAt: now }], vulns: [] }).duplicates).toBe(1);
  });

  it('ignore les items déjà vus et trop anciens', () => {
    const { db, services } = setup();
    const a = addFeed(db, { url: 'https://a.test/feed' });
    const it1 = { guid: '1', url: 'https://a.test/1', title: 'Hello world article title', publishedAt: now };
    services.pipeline.ingest(a, { notModified: false, items: [it1], vulns: [] });
    const again = services.pipeline.ingest(a, { notModified: false, items: [it1, { guid: 'old', url: 'https://a.test/old', title: 'Very old article from long ago', publishedAt: now - 400 * day }], vulns: [] });
    expect(again.newItems).toBe(0);
  });

  it('fusionne une fiche GHSA dans la fiche CVE quand l’alias apparaît', () => {
    const { db, services } = setup();
    const f = addFeed(db, { url: 'https://api.github.com/advisories', adapter: 'github-advisories' });
    services.pipeline.ingest(f, { notModified: false, items: [], vulns: [{ id: 'GHSA-m5ph-mmg5-6w5h', aliases: ['GHSA-m5ph-mmg5-6w5h'], title: 'Vue issue', severity: 'critical', cvssScore: 9.8, affected: [{ ecosystem: 'npm', package: 'vue' }], sourceUrl: 'https://github.com/advisories/GHSA-m5ph-mmg5-6w5h', surface: true }] });
    expect(db.select().from(items).where(eq(items.kind, 'vuln')).get()?.vulnId).toBe('GHSA-m5ph-mmg5-6w5h');
    // Un article cite le CVE et le GHSA ensemble → lien établi
    const n = addFeed(db, { url: 'https://n.test/feed' });
    services.pipeline.ingest(n, { notModified: false, items: [{ guid: 'a', url: 'https://n.test/a', title: 'Vue CVE-2026-0001 aka GHSA-m5ph-mmg5-6w5h', publishedAt: now }], vulns: [] });
    // Puis GHSA publie l'alias CVE
    services.pipeline.ingest(f, { notModified: false, items: [], vulns: [{ id: 'CVE-2026-0001', aliases: ['GHSA-m5ph-mmg5-6w5h', 'CVE-2026-0001'], sourceUrl: 'https://github.com/advisories/GHSA-m5ph-mmg5-6w5h', surface: true }] });
    const all = db.select().from(vulns).all();
    expect(all.map((v) => v.id)).toEqual(['CVE-2026-0001']);
    expect(all[0]?.aliases).toContain('GHSA-m5ph-mmg5-6w5h');
    expect(all[0]?.cvssScore).toBe(9.8);
    expect(all[0]?.matchLevel).toBe('certain');
    const cards = db.select().from(items).where(eq(items.kind, 'vuln')).all();
    expect(cards).toHaveLength(1);
    expect(cards[0]?.vulnId).toBe('CVE-2026-0001');
    expect(cards[0]?.score).toBe(70);
    const article = db.select().from(items).where(eq(items.kind, 'article')).get();
    expect(article?.vulnIds).toEqual(['CVE-2026-0001']);
    expect(article?.score).toBe(60); // meilleure vuln − 10
  });

  it('GHSA « relevant » : carte seulement si matchée ou critique', () => {
    const { db, services } = setup();
    const f = addFeed(db, { url: 'https://api.github.com/advisories', adapter: 'github-advisories' });
    services.pipeline.ingest(f, {
      notModified: false,
      items: [],
      vulns: [
        { id: 'CVE-2026-0002', title: 'Low thing in leftpad', severity: 'low', affected: [{ ecosystem: 'npm', package: 'leftpad' }], sourceUrl: 'u1', surface: 'relevant', publishedAt: now },
        { id: 'CVE-2026-0003', title: 'Medium thing', severity: 'medium', affected: [{ ecosystem: 'npm', package: 'next' }], sourceUrl: 'u2', surface: 'relevant', publishedAt: now },
      ],
    });
    const cards = db.select().from(items).where(eq(items.kind, 'vuln')).all().map((c) => c.vulnId);
    expect(cards).toEqual(['CVE-2026-0003']);
  });

  it('enrichissement NVD : met à jour CVSS, sévérité et matching CPE', () => {
    const { db, services } = setup();
    const f = addFeed(db, { url: 'https://n.test/feed' });
    services.pipeline.ingest(f, { notModified: false, items: [{ guid: 'a', url: 'https://n.test/a', title: 'Patch now: CVE-2026-0042', publishedAt: now }], vulns: [] });
    services.pipeline.enrichVuln('CVE-2026-0042', { cvssScore: 9.8, cpes: ['cpe:2.3:a:openbsd:openssh:*:*:*:*:*:*:*:*'] });
    const v = db.select().from(vulns).where(eq(vulns.id, 'CVE-2026-0042')).get();
    expect(v).toMatchObject({ severity: 'critical', matchLevel: 'certain', score: 70 });
    expect(db.select().from(items).where(eq(items.kind, 'vuln')).get()?.techs).toEqual([{ name: 'OpenSSH', level: 'certain' }]);
  });

  it('rematchAll après ajout à la watchlist', async () => {
    const { db, services } = setup({ seedWatchlist: false });
    const f = addFeed(db, { url: 'https://n.test/feed', category: 'tech' });
    services.pipeline.ingest(f, { notModified: false, items: [{ guid: 'a', url: 'https://n.test/a', title: 'Gitea 1.23 released with new features', publishedAt: now }], vulns: [] });
    expect(db.select().from(items).get()?.techs).toEqual([]);
    const { watchlist } = await import('../src/db/schema');
    db.insert(watchlist).values({ name: 'Gitea', aliases: ['Gitea'] }).run();
    services.pipeline.rematchAll();
    expect(db.select().from(items).get()?.techs).toEqual([{ name: 'Gitea', level: 'probable' }]);
  });

  it('poller : ETag, 304, backoff et santé', async () => {
    let calls = 0;
    const { db, services } = setup({
      routes: (url, o) => {
        if (url !== 'https://feed.test/rss') return undefined;
        calls++;
        if (calls === 1) return fakeResponse(rss([{ title: 'First post here today', link: 'https://feed.test/1' }]), 200, { etag: '"v1"' }, url);
        if (calls === 2) return o?.headers?.['if-none-match'] === '"v1"' ? fakeResponse('', 304, {}, url) : fakeResponse('bad', 500);
        return fakeResponse('oops', 503, {}, url);
      },
    });
    const feed = addFeed(db, { url: 'https://feed.test/rss', pollIntervalMin: 10 });
    const { feeds } = await import('../src/db/schema');
    const get = () => db.select().from(feeds).where(eq(feeds.id, feed.id)).get() as Feed;
    expect((await services.poller.poll(get())).newItems).toBe(1);
    expect(get().etag).toBe('"v1"');
    expect(get().itemCount).toBe(1);
    expect((await services.poller.poll(get())).notModified).toBe(true);
    const r3 = await services.poller.poll(get());
    expect(r3.ok).toBe(false);
    const after = get();
    expect(after.errorCount).toBe(1);
    expect(after.lastError).toContain('503');
    expect(after.nextFetchAt - (after.lastFetchAt ?? 0)).toBe(20 * 60_000);
  });

  it('CERT-FR alertes : notif immédiate critique, sauf au premier fetch', () => {
    const { db, services } = setup();
    const f = addFeed(db, { url: 'https://cert.test/alerte', title: 'CERT-FR · Alertes', options: { boost: 50, notify: 'immediate' } });
    services.pipeline.ingest(f, { notModified: false, items: [{ guid: '1', url: 'https://cert.test/1', title: 'Alerte initiale backlog', publishedAt: now }], vulns: [] });
    expect(db.select().from(notifications).all()).toHaveLength(0);
    const seen = { ...f, lastSuccessAt: now };
    services.pipeline.ingest(seen, { notModified: false, items: [{ guid: '2', url: 'https://cert.test/2', title: 'Vulnérabilité critique dans Fortinet', publishedAt: now }], vulns: [] });
    const n = db.select().from(notifications).all();
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ tier: 'immediate', critical: true, targetType: 'item' });
    expect(db.select().from(items).where(eq(items.guid, '2')).get()?.score).toBe(70);
  });

});
