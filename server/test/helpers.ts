import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { openDb, type DB } from '../src/db/client';
import { feeds, watchlist, type Feed } from '../src/db/schema';
import type { SafeFetchOptions, SafeResponse } from '../src/lib/safe-fetch';
import { createServices } from '../src/services/container';
import type { PushSender } from '../src/services/push';
import { SEED_WATCHLIST } from '../src/seed/watchlist';

export const silent = pino({ level: 'silent' });

export function fakeResponse(body: string | object, status = 200, headers: Record<string, string> = {}, url = 'https://example.com/'): SafeResponse {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const buf = Buffer.from(text);
  return { status, url, headers: new Headers(headers), body: buf, text: () => text, json: <T>() => JSON.parse(text) as T };
}

export type Route = (url: string, opts?: SafeFetchOptions) => SafeResponse | undefined;

export function setup(opts: { routes?: Route; now?: () => number; seedWatchlist?: boolean } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-test-'));
  const config = { ...loadConfig({ DATA_DIR: dataDir }), dbPath: ':memory:', webDir: path.join(dataDir, 'web') };
  const db: DB = openDb(':memory:');
  if (opts.seedWatchlist !== false) {
    for (const s of SEED_WATCHLIST) db.insert(watchlist).values({ name: s.name, aliases: s.aliases, cpes: s.cpes ?? [], packages: s.packages ?? [], exclude: s.exclude ?? [] }).run();
  }
  const sent: { endpoint: string; payload: Record<string, unknown> }[] = [];
  const pushStatus = new Map<string, number>();
  const pushSender: PushSender = async (sub, payload) => {
    const status = pushStatus.get(sub.endpoint) ?? 201;
    if (status >= 400) throw Object.assign(new Error(`push ${status}`), { statusCode: status });
    sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) as Record<string, unknown> });
    return { statusCode: status };
  };
  const fetcher = async (url: string, o?: SafeFetchOptions) => {
    const r = opts.routes?.(url, o);
    if (!r) throw new Error(`no route for ${url}`);
    return r;
  };
  const services = createServices(config, db, silent, { fetcher, pushSender, now: opts.now });
  return { db, config, services, sent, pushStatus, dataDir };
}

export async function setupApp(opts: Parameters<typeof setup>[0] = {}) {
  const ctx = setup(opts);
  const app = await buildApp({ config: ctx.config, db: ctx.db, log: silent, services: ctx.services });
  return { ...ctx, app };
}

export function addFeed(db: DB, f: Partial<typeof feeds.$inferInsert> & { url: string }): Feed {
  return db
    .insert(feeds)
    .values({ title: f.title ?? 'Test', category: f.category ?? 'security', adapter: f.adapter ?? 'rss', ...f })
    .returning()
    .get();
}

export function rss(items: { title: string; link: string; guid?: string; description?: string; date?: string }[], title = 'Flux test'): string {
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title><link>https://example.com</link>${items
    .map(
      (i) =>
        `<item><title>${i.title}</title><link>${i.link}</link><guid>${i.guid ?? i.link}</guid><pubDate>${i.date ?? new Date().toUTCString()}</pubDate><description><![CDATA[${i.description ?? ''}]]></description></item>`,
    )
    .join('')}</channel></rss>`;
}
