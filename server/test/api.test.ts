import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { feeds, items } from '../src/db/schema';
import { addFeed, fakeResponse, rss, setupApp } from './helpers';

const html = `<html><head><title>Blog</title><link rel="alternate" type="application/rss+xml" href="/rss.xml"></head><body>x</body></html>`;

describe('API', async () => {
  const ctx = await setupApp({
    routes: (url) => {
      if (url === 'https://blog.test/') return fakeResponse(html, 200, { 'content-type': 'text/html' }, url);
      if (url === 'https://blog.test/rss.xml')
        return fakeResponse(rss([{ title: 'Spring Boot 3.5 est disponible', link: 'https://blog.test/p1', description: '<p>Nouvelle version</p>' }, { title: 'Ollama ajoute un nouveau modèle local', link: 'https://blog.test/p2' }], 'Le Blog'), 200, { 'content-type': 'application/rss+xml' }, url);
      if (url === 'https://blog.test/p1') return fakeResponse(`<html><body><article><h1>Spring</h1>${'<p>Un long paragraphe de texte pour Readability. '.repeat(40)}</p></article></body></html>`, 200, { 'content-type': 'text/html' }, url);
      return undefined;
    },
  });
  const { app, db } = ctx;
  afterAll(() => app.close());

  it('/health', async () => {
    const r = await app.inject('/health');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: 'ok' });
    expect(r.headers['content-security-policy']).toContain("default-src 'self'");
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });

  it('ajout de flux avec auto-découverte, puis fil', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/feeds', payload: { url: 'https://blog.test/', category: 'tech' } });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ url: 'https://blog.test/rss.xml', title: 'Le Blog', category: 'tech' });
    const dup = await app.inject({ method: 'POST', url: '/api/feeds', payload: { url: 'https://blog.test/rss.xml' } });
    expect(dup.statusCode).toBe(409);
    await ctx.services.poller.pollById(r.json().id);
    const list = (await app.inject('/api/items?view=tech')).json();
    expect(list.items).toHaveLength(2);
    const spring = list.items.find((i: { title: string }) => i.title.startsWith('Spring'));
    expect(spring.techs).toEqual([{ name: 'Spring', level: 'probable' }]);
    expect(spring.feed.title).toBe('Le Blog');
  });

  it('découverte impossible → 422', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/feeds', payload: { url: 'https://nothing.test/' } });
    expect(r.statusCode).toBe(422);
  });

  it('recherche FTS, filtres, pagination', async () => {
    const q = (await app.inject('/api/items?q=ollama')).json();
    expect(q.items.map((i: { title: string }) => i.title)).toEqual(['Ollama ajoute un nouveau modèle local']);
    const accent = (await app.inject(`/api/items?q=${encodeURIComponent('modele')}`)).json();
    expect(accent.items).toHaveLength(1);
    const tech = (await app.inject('/api/items?tech=Spring')).json();
    expect(tech.items).toHaveLength(1);
    const p1 = (await app.inject('/api/items?limit=1')).json();
    expect(p1.nextCursor).toBeTruthy();
    const p2 = (await app.inject(`/api/items?limit=1&cursor=${p1.nextCursor}`)).json();
    expect(p2.items[0].id).not.toBe(p1.items[0].id);
    expect((await app.inject('/api/items?q=%22%2A%28')).statusCode).toBe(200); // saisie hostile
  });

  it('lu / favori / tout marquer lu jusqu’ici', async () => {
    const all = (await app.inject('/api/items?view=all')).json().items as { id: number; publishedAt: number }[];
    const first = all[0]!;
    const star = await app.inject({ method: 'PATCH', url: `/api/items/${first.id}`, payload: { starred: true } });
    expect(star.json().starred).toBe(true);
    expect((await app.inject('/api/items?starred=1')).json().items).toHaveLength(1);
    const mr = await app.inject({ method: 'POST', url: '/api/items/mark-read', payload: { view: 'all', until: `${first.publishedAt}:${first.id}` } });
    expect(mr.json().marked).toBe(1);
    expect((await app.inject('/api/items?unread=true')).json().items).toHaveLength(all.length - 1);
    expect((await app.inject('/api/stats')).json().unread.all).toBe(all.length - 1);
  });

  it('mode lecture (Readability) mis en cache', async () => {
    const id = db.select().from(items).where(eq(items.url, 'https://blog.test/p1')).get()!.id;
    const r = (await app.inject(`/api/items/${id}?readable=1`)).json();
    expect(r.readableHtml).toContain('Un long paragraphe');
    expect(r.readableTried).toBe(true);
  });

  it('fiche vuln : 404 puis contenu, alias GHSA', async () => {
    expect((await app.inject('/api/vulns/CVE-2099-0001')).statusCode).toBe(404);
    const f = addFeed(db, { url: 'https://gh.test', adapter: 'github-advisories' });
    ctx.services.pipeline.ingest(f, { notModified: false, items: [], vulns: [{ id: 'CVE-2026-5555', aliases: ['GHSA-m5ph-mmg5-6w5h'], title: 'XSS in vue', severity: 'high', cvssScore: 8.1, affected: [{ ecosystem: 'npm', package: 'vue', vulnerable: '< 3.5.13', patched: '3.5.13' }], sourceUrl: 'https://github.com/advisories/GHSA-m5ph-mmg5-6w5h', surface: true }] });
    const v = (await app.inject('/api/vulns/ghsa-m5ph-mmg5-6w5h')).json();
    expect(v.id).toBe('CVE-2026-5555');
    expect(v.techs[0]).toMatchObject({ name: 'Vue.js', level: 'certain' });
    expect(v.affected[0]).toMatchObject({ patched: '3.5.13' });
    expect(v.sources).toHaveLength(1);
    expect(v.ghsaUrl).toBe('https://github.com/advisories/GHSA-m5ph-mmg5-6w5h');
  });

  it('watchlist CRUD avec validation et re-matching', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/watchlist', payload: { name: 'X', cpes: ['pas-un-cpe'] } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: '/api/watchlist', payload: { name: 'Le Blog', aliases: ['Readability'] } });
    expect(ok.statusCode).toBe(201);
    const list = (await app.inject('/api/watchlist')).json();
    expect(list.find((w: { name: string }) => w.name === 'Vue.js').matchCount).toBeGreaterThan(0);
    expect((await app.inject({ method: 'DELETE', url: `/api/watchlist/${ok.json().id}` })).statusCode).toBe(204);
  });

  it('réglages : validation et mise à jour de l’URL HN', async () => {
    addFeed(db, { url: 'https://hnrss.org/newest?points=150', title: 'HN', category: 'tech' });
    const bad = await app.inject({ method: 'PUT', url: '/api/settings', payload: { quietHours: { start: '25:00' } } });
    expect(bad.statusCode).toBe(400);
    const r = await app.inject({ method: 'PUT', url: '/api/settings', payload: { feed: { hnMinPoints: 300 }, digest: { time: '07:30' } } });
    expect(r.json()).toMatchObject({ feed: { hnMinPoints: 300 }, digest: { time: '07:30', topNews: 5 } });
    expect(db.select().from(feeds).where(eq(feeds.title, 'Hacker News (≥ 300 pts)')).get()?.url).toBe('https://hnrss.org/newest?points=300');
  });

  it('OPML export / import', async () => {
    const exp = await app.inject('/api/opml');
    expect(exp.headers['content-type']).toContain('text/x-opml');
    expect(exp.body).toContain('xmlUrl="https://blog.test/rss.xml"');
    const imp = await app.inject({ method: 'POST', url: '/api/opml', headers: { 'content-type': 'text/xml' }, payload: `<opml><body><outline text="Sécurité"><outline text="Krebs" xmlUrl="https://krebsonsecurity.com/feed/"/><outline text="Dup" xmlUrl="https://blog.test/rss.xml"/></outline></body></opml>` });
    expect(imp.json()).toEqual({ added: 1, skipped: 1, total: 2 });
    expect(db.select().from(feeds).where(eq(feeds.url, 'https://krebsonsecurity.com/feed/')).get()?.category).toBe('security');
  });

  it('push : clé, abonnement, test, désabonnement', async () => {
    const key = (await app.inject('/api/push/key')).json();
    expect(key.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect((await app.inject({ method: 'POST', url: '/api/push/test' })).statusCode).toBe(409);
    const sub = { endpoint: 'https://push.test/dev1', keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA', auth: 'tBHItJI5svbpez7KI4CCXg' } };
    expect((await app.inject({ method: 'POST', url: '/api/push/subscribe', payload: { subscription: sub } })).statusCode).toBe(201);
    const t = await app.inject({ method: 'POST', url: '/api/push/test' });
    expect(t.json()).toEqual({ sent: 1, removed: 0, failed: 0 });
    expect(ctx.sent.at(-1)?.payload).toMatchObject({ title: '🔔 Notification de test', url: '/settings' });
    expect((await app.inject({ method: 'POST', url: '/api/push/unsubscribe', payload: { endpoint: sub.endpoint } })).json().devices).toBe(0);
  });

  it('les clés VAPID sont persistées dans data/', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    expect(fs.existsSync(path.join(ctx.dataDir, 'vapid.json'))).toBe(true);
  });

  it('404 JSON pour /api inconnue', async () => {
    const r = await app.inject('/api/nope');
    expect(r.statusCode).toBe(404);
  });
});
