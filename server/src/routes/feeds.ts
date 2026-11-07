import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import { looksLikeFeed, parseFeed } from '../adapters/rss';
import { COMMON_FEED_PATHS, discoverFeeds } from '../core/discovery';
import { buildOpml, parseOpml } from '../core/opml';
import { feeds, type AdapterKind, type Category, type Feed } from '../db/schema';
import { httpError } from '../lib/errors';
import { FetchError, type SafeResponse } from '../lib/safe-fetch';

const category = z.enum(['security', 'tech', 'news', 'releases']);

const optionsSchema = z
  .object({
    boost: z.number().int().min(0).max(80).optional(),
    notify: z.enum(['immediate', 'default']).optional(),
    ecosystems: z.array(z.string().min(1).max(30)).max(20).optional(),
  })
  .strict();

function feedView(f: Feed) {
  const { etag: _e, lastModified: _l, ...rest } = f;
  const status = !f.enabled ? 'disabled' : f.errorCount > 0 ? (f.errorCount >= 3 ? 'error' : 'warning') : f.lastSuccessAt ? 'ok' : 'pending';
  return { ...rest, status };
}

export function guessAdapter(url: string): AdapterKind {
  if (/known_exploited_vulnerabilities\.json/i.test(url)) return 'cisa-kev';
  if (/^https:\/\/api\.github\.com\/advisories/i.test(url)) return 'github-advisories';
  return 'rss';
}

export function guessCategory(url: string): Category {
  if (/\/releases\.atom$/.test(url)) return 'releases';
  if (/(cert|cve|secu|vuln|advisor|kev|krebs|bleeping|hackernews|zataz)/i.test(url)) return 'security';
  return 'news';
}

export async function feedRoutes(api: FastifyInstance, { db, services, log }: AppContext): Promise<void> {
  api.get('/feeds', async () => db.select().from(feeds).orderBy(feeds.category, feeds.title).all().map(feedView));

  /** Résout une URL saisie : flux direct, auto-découverte HTML, puis chemins classiques. */
  async function resolve(input: string): Promise<{ url: string; title: string | null; siteUrl: string | null; adapter: AdapterKind }> {
    const adapter = guessAdapter(input);
    if (adapter !== 'rss') return { url: input, title: null, siteUrl: null, adapter };
    const tryFeed = (res: SafeResponse) => {
      const body = res.text();
      if (res.status < 400 && looksLikeFeed(body, res.headers.get('content-type'))) {
        const parsed = parseFeed(body, res.url);
        return { url: res.url, title: parsed.title, siteUrl: parsed.siteUrl, adapter: 'rss' as const };
      }
      return null;
    };
    const res = await services.fetch(input);
    if (res.status >= 400) throw new FetchError(`La page répond HTTP ${res.status}`, res.status);
    const direct = tryFeed(res);
    if (direct) return direct;
    const candidates = discoverFeeds(res.text(), res.url).map((c) => c.url);
    const origin = new URL(res.url).origin;
    for (const p of COMMON_FEED_PATHS) candidates.push(new URL(p, origin).toString());
    for (const c of [...new Set(candidates)].slice(0, 10)) {
      try {
        const r = await services.fetch(c);
        const found = tryFeed(r);
        if (found) return { ...found, siteUrl: found.siteUrl ?? res.url };
      } catch {
        /* candidat suivant */
      }
    }
    throw new FetchError('Aucun flux RSS/Atom trouvé à cette adresse');
  }

  api.post('/feeds/discover', async (req) => {
    const { url } = z.object({ url: z.string().url().max(2000) }).parse(req.body);
    try {
      return await resolve(url);
    } catch (err) {
      throw httpError(422, (err as Error).message);
    }
  });

  api.post('/feeds', async (req, reply) => {
    const b = z
      .object({
        url: z.string().url().max(2000),
        title: z.string().max(200).optional(),
        category: category.optional(),
        pollIntervalMin: z.number().int().min(5).max(1440).optional(),
        options: optionsSchema.optional(),
        skipDiscovery: z.boolean().optional(),
      })
      .parse(req.body);
    let resolved: Awaited<ReturnType<typeof resolve>>;
    try {
      resolved = b.skipDiscovery ? { url: b.url, title: null, siteUrl: null, adapter: guessAdapter(b.url) } : await resolve(b.url);
    } catch (err) {
      throw httpError(422, (err as Error).message);
    }
    const exists = db.select().from(feeds).where(eq(feeds.url, resolved.url)).get();
    if (exists) throw httpError(409, `Déjà abonné : ${exists.title}`);
    const feed = db
      .insert(feeds)
      .values({
        url: resolved.url,
        title: b.title?.trim() || resolved.title || new URL(resolved.url).hostname,
        siteUrl: resolved.siteUrl,
        category: b.category ?? guessCategory(resolved.url),
        adapter: resolved.adapter,
        pollIntervalMin: b.pollIntervalMin ?? 30,
        options: b.options ?? {},
        nextFetchAt: 0,
      })
      .returning()
      .get();
    void services.poller.pollById(feed.id).catch((err: Error) => log.warn({ err: err.message }, 'initial poll failed'));
    reply.code(201);
    return feedView(feed);
  });

  api.patch<{ Params: { id: string } }>('/feeds/:id', async (req) => {
    const id = Number(req.params.id);
    const b = z
      .object({
        title: z.string().min(1).max(200).optional(),
        category: category.optional(),
        pollIntervalMin: z.number().int().min(5).max(1440).optional(),
        enabled: z.boolean().optional(),
        options: optionsSchema.optional(),
      })
      .parse(req.body);
    const cur = db.select().from(feeds).where(eq(feeds.id, id)).get();
    if (!cur) throw httpError(404, 'Flux introuvable');
    const set: Partial<Feed> = { ...b };
    if (b.enabled === true && !cur.enabled) Object.assign(set, { errorCount: 0, nextFetchAt: 0 });
    db.update(feeds).set(set).where(eq(feeds.id, id)).run();
    if (b.category && b.category !== cur.category) {
      const ids = db.$client.prepare('SELECT id FROM items WHERE feed_id = ?').all(id) as { id: number }[];
      for (const { id: itemId } of ids) services.pipeline.rescoreItem(itemId);
    }
    return feedView(db.select().from(feeds).where(eq(feeds.id, id)).get() as Feed);
  });

  api.delete<{ Params: { id: string } }>('/feeds/:id', async (req, reply) => {
    db.delete(feeds).where(eq(feeds.id, Number(req.params.id))).run();
    reply.code(204);
  });

  api.post<{ Params: { id: string } }>('/feeds/:id/refresh', async (req) => {
    const r = await services.poller.pollById(Number(req.params.id));
    return { ...r, feed: feedView(db.select().from(feeds).where(eq(feeds.id, Number(req.params.id))).get() as Feed) };
  });

  /** Pull-to-refresh : relance les flux sains non rafraîchis depuis 2 min, attend au plus 20 s. */
  api.post('/refresh', async () => {
    const now = Date.now();
    const stale = db
      .select({ id: feeds.id, lastFetchAt: feeds.lastFetchAt, errorCount: feeds.errorCount, enabled: feeds.enabled })
      .from(feeds)
      .all()
      .filter((f) => f.enabled && f.errorCount === 0 && (f.lastFetchAt ?? 0) < now - 120_000)
      .map((f) => f.id);
    if (stale.length) db.update(feeds).set({ nextFetchAt: 0 }).where(inArray(feeds.id, stale)).run();
    const work = services.poller.pollDue(6);
    const results = await Promise.race([work, new Promise<null>((r) => setTimeout(() => r(null), 20_000))]);
    return {
      triggered: stale.length,
      done: results ? results.length : null,
      newItems: results ? results.reduce((n, r) => n + (r.newItems ?? 0), 0) : null,
    };
  });

  api.get('/opml', async (_req, reply) => {
    const list = db.select().from(feeds).where(eq(feeds.adapter, 'rss')).all();
    reply
      .header('content-type', 'text/x-opml; charset=utf-8')
      .header('content-disposition', `attachment; filename="radar-${new Date().toISOString().slice(0, 10)}.opml"`);
    return buildOpml(list.map((f) => ({ url: f.url, title: f.title, siteUrl: f.siteUrl, category: f.category })));
  });

  api.post('/opml', async (req) => {
    const body = typeof req.body === 'string' ? req.body : (req.body as { opml?: string } | null)?.opml;
    if (!body) throw httpError(400, 'OPML manquant');
    let parsed;
    try {
      parsed = parseOpml(body);
    } catch {
      throw httpError(400, 'OPML invalide');
    }
    let added = 0;
    let skipped = 0;
    for (const f of parsed) {
      try {
        new URL(f.url);
      } catch {
        skipped++;
        continue;
      }
      const res = db
        .insert(feeds)
        .values({ url: f.url, title: f.title.slice(0, 200), siteUrl: f.siteUrl ?? null, category: f.category ?? guessCategory(f.url), adapter: guessAdapter(f.url), nextFetchAt: Date.now() + added * 1500 })
        .onConflictDoNothing()
        .run();
      if (res.changes) added++;
      else skipped++;
    }
    return { added, skipped, total: parsed.length };
  });
}
