import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import { extractReadable } from '../core/readability';
import { feeds, items, matches, vulnAliases, vulnSources, vulns, watchlist } from '../db/schema';
import { getItemCard, listItems, markRead, unreadCounts, type View } from '../services/queries';
import { getSettings } from '../services/settings';
import { httpError } from '../lib/errors';

const severity = z.enum(['critical', 'high', 'medium', 'low', 'unknown']);
const bool = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

const filterSchema = z.object({
  view: z.enum(['priority', 'security', 'tech', 'all']).default('all'),
  q: z.string().max(200).optional(),
  feed: z.coerce.number().int().positive().optional(),
  tech: z.string().max(100).optional(),
  severity: z
    .union([severity, z.array(severity), z.string()])
    .optional()
    .transform((v) => (v == null ? undefined : (Array.isArray(v) ? v : v.split(',')).filter((s): s is z.infer<typeof severity> => severity.safeParse(s).success))),
  unread: bool.optional(),
  starred: bool.optional(),
});

export async function itemRoutes(api: FastifyInstance, { db, services, config, log }: AppContext): Promise<void> {
  api.get('/items', async (req) => {
    const q = filterSchema.extend({ cursor: z.string().max(40).optional(), limit: z.coerce.number().int().optional() }).parse(req.query);
    const threshold = getSettings(db).feed.priorityThreshold;
    return listItems(db, { view: q.view as View, q: q.q, feedId: q.feed, tech: q.tech, severity: q.severity, unread: q.unread, starred: q.starred, cursor: q.cursor, limit: q.limit, threshold });
  });

  api.post('/items/mark-read', async (req) => {
    const b = filterSchema.extend({ until: z.string().max(40).optional() }).parse(req.body ?? {});
    const threshold = getSettings(db).feed.priorityThreshold;
    const n = markRead(db, { view: b.view as View, q: b.q, feedId: b.feed, tech: b.tech, severity: b.severity, unread: b.unread, starred: b.starred, until: b.until, threshold });
    return { marked: n };
  });

  api.get<{ Params: { id: string }; Querystring: { readable?: string } }>('/items/:id', async (req) => {
    const id = Number(req.params.id);
    const card = getItemCard(db, id);
    if (!card) throw httpError(404, 'Item introuvable');
    let item = db.select().from(items).where(eq(items.id, id)).get();
    if (!item) throw httpError(404, 'Item introuvable');
    const feed = db.select({ siteUrl: feeds.siteUrl, url: feeds.url }).from(feeds).where(eq(feeds.id, item.feedId)).get();

    // Mode lecture : extraction côté serveur à la demande, mise en cache en base.
    if (req.query.readable === '1' && item.kind !== 'vuln' && item.url && item.readableFetchedAt == null) {
      try {
        const res = await services.fetch(item.url, { headers: { accept: 'text/html,application/xhtml+xml' }, maxBytes: 5 * 1024 * 1024, timeoutMs: 15_000 });
        const ct = res.headers.get('content-type') ?? '';
        const readable = res.status < 400 && ct.includes('html') ? extractReadable(res.text(), res.url) : null;
        db.update(items).set({ readableHtml: readable && readable.textLength > 400 ? readable.html : null, readableFetchedAt: Date.now() }).where(eq(items.id, id)).run();
      } catch (err) {
        log.info({ id, err: (err as Error).message }, 'readability fetch failed');
        db.update(items).set({ readableFetchedAt: Date.now() }).where(eq(items.id, id)).run();
      }
      item = db.select().from(items).where(eq(items.id, id)).get() ?? item;
    }
    const linked = item.vulnIds.length
      ? db.$client
          .prepare(`SELECT id, title, severity, cvss_score AS cvss, kev, epss, score FROM vulns WHERE id IN (${item.vulnIds.map(() => '?').join(',')}) ORDER BY score DESC`)
          .all(...item.vulnIds)
      : [];
    return {
      ...card,
      author: item.author,
      contentHtml: item.contentHtml,
      summaryHtml: item.summaryHtml,
      readableHtml: item.readableHtml,
      readableTried: item.readableFetchedAt != null,
      siteUrl: feed?.siteUrl ?? null,
      vulns: linked,
    };
  });

  api.patch<{ Params: { id: string } }>('/items/:id', async (req) => {
    const id = Number(req.params.id);
    const b = z.object({ read: z.boolean().optional(), starred: z.boolean().optional() }).parse(req.body);
    const set: Partial<typeof items.$inferInsert> = {};
    if (b.read !== undefined) set.readAt = b.read ? Date.now() : null;
    if (b.starred !== undefined) set.starredAt = b.starred ? Date.now() : null;
    if (Object.keys(set).length) db.update(items).set(set).where(eq(items.id, id)).run();
    const card = getItemCard(db, id);
    if (!card) throw httpError(404, 'Item introuvable');
    return card;
  });

  api.get<{ Params: { id: string } }>('/vulns/:id', async (req) => {
    const raw = decodeURIComponent(req.params.id).trim();
    const key = /^ghsa-/i.test(raw) ? `GHSA${raw.slice(4).toLowerCase()}` : raw.toUpperCase();
    const alias = db.select().from(vulnAliases).where(eq(vulnAliases.alias, key)).get();
    const v = db.select().from(vulns).where(eq(vulns.id, alias?.vulnId ?? key)).get();
    if (!v) throw httpError(404, 'Vulnérabilité inconnue');
    const sources = db
      .select({ url: vulnSources.url, title: vulnSources.title, sourceName: vulnSources.sourceName, itemId: vulnSources.itemId, seenAt: vulnSources.seenAt })
      .from(vulnSources)
      .where(eq(vulnSources.vulnId, v.id))
      .orderBy(vulnSources.seenAt)
      .all();
    const techs = db
      .select({ id: watchlist.id, name: watchlist.name, level: matches.level, reason: matches.reason })
      .from(matches)
      .innerJoin(watchlist, eq(matches.watchId, watchlist.id))
      .where(eq(matches.vulnId, v.id))
      .all();
    const card = db.select({ id: items.id, readAt: items.readAt, starredAt: items.starredAt }).from(items).where(and(eq(items.vulnId, v.id), eq(items.kind, 'vuln'))).get();
    return {
      ...v,
      techs,
      sources,
      itemId: card?.id ?? null,
      read: card?.readAt != null,
      starred: card?.starredAt != null,
      nvdUrl: v.id.startsWith('CVE-') ? `https://nvd.nist.gov/vuln/detail/${v.id}` : null,
      ghsaUrl: [v.id, ...v.aliases].find((a) => a.startsWith('GHSA')) ? `https://github.com/advisories/${[v.id, ...v.aliases].find((a) => a.startsWith('GHSA'))}` : null,
    };
  });

  api.get('/stats', async () => {
    const s = getSettings(db);
    return {
      unread: unreadCounts(db, s.feed.priorityThreshold),
      priorityThreshold: s.feed.priorityThreshold,
      pushDevices: services.push.count(),
      briefingUnread: services.briefings.unread(),
      ollama: services.summarizer.enabled,
      timezone: config.timezone,
      version: process.env.npm_package_version ?? '0.1.0',
    };
  });
}
