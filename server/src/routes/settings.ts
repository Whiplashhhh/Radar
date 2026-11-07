import { eq, like } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import { feeds, watchlist } from '../db/schema';
import { httpError } from '../lib/errors';
import { hnUrl } from '../seed/feeds';
import { getSettings, updateSettings } from '../services/settings';

const list = (max: number) => z.array(z.string().trim().min(1).max(max)).max(50);

const watchSchema = z.object({
  name: z.string().trim().min(1).max(80),
  aliases: list(80).default([]),
  cpes: list(120)
    .default([])
    .refine((a) => a.every((c) => /^[^:\s]+:[^:\s]+$/.test(c)), 'CPE attendu au format vendor:product'),
  packages: list(200)
    .default([])
    .refine((a) => a.every((p) => /^[a-z0-9_.-]+:.+$/i.test(p)), 'Package attendu au format écosystème:nom'),
  exclude: list(80).default([]),
  enabled: z.boolean().default(true),
});

export async function settingsRoutes(api: FastifyInstance, { db, services }: AppContext): Promise<void> {
  api.get('/settings', async () => getSettings(db));

  api.put('/settings', async (req) => {
    const before = getSettings(db);
    let next;
    try {
      next = updateSettings(db, (req.body ?? {}) as Parameters<typeof updateSettings>[1]);
    } catch (err) {
      if (err instanceof z.ZodError) throw httpError(400, err.issues.map((i) => `${i.path.join('.')} : ${i.message}`).join(' ; '));
      throw err;
    }
    if (next.feed.hnMinPoints !== before.feed.hnMinPoints) {
      const hn = db.select().from(feeds).where(like(feeds.url, 'https://hnrss.org/newest?points=%')).get();
      if (hn) {
        db.update(feeds)
          .set({ url: hnUrl(next.feed.hnMinPoints), title: `Hacker News (≥ ${next.feed.hnMinPoints} pts)`, etag: null, lastModified: null, nextFetchAt: 0 })
          .where(eq(feeds.id, hn.id))
          .run();
      }
    }
    return next;
  });

  // ─── Watchlist ───
  api.get('/watchlist', async () => {
    const counts = db.$client
      .prepare(
        `SELECT watch_id, count(DISTINCT coalesce(vuln_id, 'i' || item_id)) AS n FROM matches GROUP BY watch_id`,
      )
      .all() as { watch_id: number; n: number }[];
    const byId = new Map(counts.map((c) => [c.watch_id, c.n]));
    return db
      .select()
      .from(watchlist)
      .orderBy(watchlist.name)
      .all()
      .map((w) => ({ ...w, matchCount: byId.get(w.id) ?? 0 }));
  });

  api.post('/watchlist', async (req, reply) => {
    const b = watchSchema.parse(req.body);
    const row = db.insert(watchlist).values(b).returning().get();
    services.pipeline.rematchAll();
    reply.code(201);
    return row;
  });

  api.patch<{ Params: { id: string } }>('/watchlist/:id', async (req) => {
    const id = Number(req.params.id);
    const b = watchSchema.partial().parse(req.body);
    const res = db.update(watchlist).set(b).where(eq(watchlist.id, id)).returning().get();
    if (!res) throw httpError(404, 'Entrée introuvable');
    services.pipeline.rematchAll();
    return res;
  });

  api.delete<{ Params: { id: string } }>('/watchlist/:id', async (req, reply) => {
    db.delete(watchlist).where(eq(watchlist.id, Number(req.params.id))).run();
    services.pipeline.rematchAll();
    reply.code(204);
  });

  // ─── Push ───
  api.get('/push/key', async () => ({ publicKey: services.push.keys.publicKey }));

  const subSchema = z.object({
    endpoint: z.string().url().max(2000),
    keys: z.object({ p256dh: z.string().min(10).max(500), auth: z.string().min(4).max(200) }),
  });

  api.post('/push/subscribe', async (req, reply) => {
    const sub = subSchema.parse((req.body as { subscription?: unknown })?.subscription ?? req.body);
    services.push.subscribe(sub, req.headers['user-agent']);
    reply.code(201);
    return { ok: true, devices: services.push.count() };
  });

  api.post('/push/unsubscribe', async (req) => {
    const { endpoint } = z.object({ endpoint: z.string().url().max(2000) }).parse(req.body);
    services.push.unsubscribe(endpoint);
    return { ok: true, devices: services.push.count() };
  });

  api.post('/push/test', async (req) => {
    const { endpoint } = z.object({ endpoint: z.string().url().max(2000).optional() }).parse(req.body ?? {});
    const res = await services.push.sendToAll(
      {
        title: '🔔 Notification de test',
        body: 'Radar est bien configuré sur cet appareil.',
        url: '/settings',
        tag: 'radar-test',
        severity: null,
        techs: [],
        badge: services.notifier.unreadPriorityCount(),
      },
      { endpoint, urgent: true },
    );
    if (res.sent === 0 && res.failed === 0 && res.removed === 0) throw httpError(409, 'Aucun appareil abonné');
    return res;
  });

  api.post('/push/digest', async () => {
    const payload = await services.notifier.digest(true);
    return { sent: !!payload, payload };
  });
}
