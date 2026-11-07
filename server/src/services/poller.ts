import { and, asc, eq, lte } from 'drizzle-orm';
import { adapterFor } from '../adapters';
import type { FetchContext } from '../adapters/types';
import type { Config } from '../config';
import type { DB } from '../db/client';
import { feeds, type Feed } from '../db/schema';
import type { Logger } from '../lib/logger';
import { safeFetch, type SafeFetchOptions, type SafeResponse } from '../lib/safe-fetch';
import type { IngestStats, Pipeline } from './pipeline';

const MIN = 60_000;
const MAX_BACKOFF = 24 * 60 * MIN;

/** Prochain fetch : intervalle normal, ou intervalle × 2^min(erreurs, 6) plafonné à 24 h. */
export function nextFetchDelay(intervalMin: number, errorCount: number): number {
  const base = Math.max(1, intervalMin) * MIN;
  if (errorCount <= 0) return base;
  return Math.min(MAX_BACKOFF, base * 2 ** Math.min(errorCount, 6));
}

export interface PollResult extends Partial<IngestStats> {
  feedId: number;
  ok: boolean;
  notModified?: boolean;
  error?: string;
}

export class Poller {
  private running = new Set<number>();

  constructor(
    private readonly db: DB,
    private readonly config: Config,
    private readonly pipeline: Pipeline,
    private readonly log: Logger,
    private readonly fetcher: (url: string, opts?: SafeFetchOptions) => Promise<SafeResponse> = safeFetch,
  ) {}

  fetchContext(): FetchContext {
    return {
      fetch: (url, opts) =>
        this.fetcher(url, {
          allowPrivate: this.config.allowPrivateNetworks,
          timeoutMs: this.config.fetchTimeoutMs,
          maxBytes: this.config.fetchMaxBytes,
          userAgent: this.config.userAgent,
          ...opts,
        }),
      githubToken: this.config.githubToken,
      now: Date.now(),
    };
  }

  dueFeeds(now = Date.now()): Feed[] {
    return this.db
      .select()
      .from(feeds)
      .where(and(eq(feeds.enabled, true), lte(feeds.nextFetchAt, now)))
      .orderBy(asc(feeds.nextFetchAt))
      .all();
  }

  /** Lance les flux dus, `concurrency` à la fois. */
  async pollDue(concurrency = 4): Promise<PollResult[]> {
    const due = this.dueFeeds().filter((f) => !this.running.has(f.id));
    const results: PollResult[] = [];
    let idx = 0;
    const worker = async () => {
      while (idx < due.length) {
        const feed = due[idx++];
        if (feed) results.push(await this.poll(feed));
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, due.length) }, worker));
    return results;
  }

  async pollById(id: number): Promise<PollResult> {
    const feed = this.db.select().from(feeds).where(eq(feeds.id, id)).get();
    if (!feed) return { feedId: id, ok: false, error: 'Flux introuvable' };
    return this.poll(feed, { force: true });
  }

  async poll(feed: Feed, opts: { force?: boolean } = {}): Promise<PollResult> {
    if (this.running.has(feed.id)) return { feedId: feed.id, ok: false, error: 'Déjà en cours' };
    this.running.add(feed.id);
    const started = Date.now();
    try {
      const adapter = adapterFor(feed.adapter);
      const current = opts.force ? { ...feed, etag: null, lastModified: null } : feed;
      const result = await adapter.fetch(current, this.fetchContext());
      const stats = result.notModified ? undefined : this.pipeline.ingest(feed, result);
      const now = Date.now();
      const count = this.db.$client.prepare('SELECT count(*) AS n FROM items WHERE feed_id = ?').get(feed.id) as { n: number };
      this.db
        .update(feeds)
        .set({
          etag: result.notModified ? feed.etag : (result.etag ?? null),
          lastModified: result.notModified ? feed.lastModified : (result.lastModified ?? null),
          lastFetchAt: now,
          lastSuccessAt: now,
          errorCount: 0,
          lastError: null,
          nextFetchAt: now + nextFetchDelay(feed.pollIntervalMin, 0),
          itemCount: count.n,
          ...(result.siteUrl && !feed.siteUrl ? { siteUrl: result.siteUrl } : {}),
        })
        .where(eq(feeds.id, feed.id))
        .run();
      this.log.info({ feed: feed.title, ms: now - started, notModified: result.notModified, ...stats }, 'feed polled');
      return { feedId: feed.id, ok: true, notModified: result.notModified, ...stats };
    } catch (err) {
      const message = (err as Error).message.slice(0, 500);
      const errors = feed.errorCount + 1;
      const now = Date.now();
      this.db
        .update(feeds)
        .set({ lastFetchAt: now, errorCount: errors, lastError: message, nextFetchAt: now + nextFetchDelay(feed.pollIntervalMin, errors) })
        .where(eq(feeds.id, feed.id))
        .run();
      this.log.warn({ feed: feed.title, url: feed.url, errors, err: message }, 'feed poll failed');
      return { feedId: feed.id, ok: false, error: message };
    } finally {
      this.running.delete(feed.id);
    }
  }
}
