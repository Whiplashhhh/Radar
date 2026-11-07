import { eq, inArray } from 'drizzle-orm';
import { fetchEpss } from '../adapters/epss';
import { fetchNvd, RateLimiter } from '../adapters/nvd';
import type { Config } from '../config';
import type { DB } from '../db/client';
import { vulns } from '../db/schema';
import type { Logger } from '../lib/logger';
import { safeFetch, type SafeFetchOptions, type SafeResponse } from '../lib/safe-fetch';
import type { Pipeline } from './pipeline';

type Fetcher = (url: string, opts?: SafeFetchOptions) => Promise<SafeResponse>;

/** Enrichissement CVSS (NVD) et EPSS, en tâche de fond et dans le respect des limites de débit. */
export class Enricher {
  readonly nvdLimiter: RateLimiter;
  private busy = false;
  private nvdBlockedUntil = 0;

  constructor(
    private readonly db: DB,
    private readonly config: Config,
    private readonly pipeline: Pipeline,
    private readonly log: Logger,
    private readonly fetcher: Fetcher = safeFetch,
  ) {
    // NVD : 5 req / 30 s sans clé, 50 avec. On garde une marge.
    this.nvdLimiter = config.nvdApiKey ? new RateLimiter(40, 30_000) : new RateLimiter(4, 30_000);
  }

  private fetch: Fetcher = (url, opts) =>
    this.fetcher(url, { timeoutMs: this.config.fetchTimeoutMs, maxBytes: 5 * 1024 * 1024, userAgent: this.config.userAgent, ...opts });

  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.runEpss();
      await this.runNvd();
    } finally {
      this.busy = false;
    }
  }

  async runNvd(maxRequests = 4): Promise<number> {
    if (Date.now() < this.nvdBlockedUntil) return 0;
    const queue = this.pipeline.nvdQueue(maxRequests);
    let done = 0;
    for (const id of queue) {
      if (!this.nvdLimiter.take()) break;
      try {
        const data = await fetchNvd(id, this.fetch, this.config.nvdApiKey);
        const now = Date.now();
        if (!data) {
          this.db.update(vulns).set({ nvdCheckedAt: now }).where(eq(vulns.id, id)).run();
          continue;
        }
        this.db.update(vulns).set({ nvdCheckedAt: now }).where(eq(vulns.id, id)).run();
        this.pipeline.enrichVuln(id, {
          description: data.description,
          cvssScore: data.cvssScore,
          cvssVector: data.cvssVector,
          cvssVersion: data.cvssVersion,
          severity: data.cvssScore != null ? data.severity : undefined,
          cpes: data.cpes,
          references: data.references,
          publishedAt: data.publishedAt ?? undefined,
          affected: data.ranges.map((r) => {
            const [, , , vendor = '', product = ''] = r.cpe.split(':');
            return { ecosystem: 'cpe', package: `${vendor}:${product}`, vulnerable: r.range, patched: null };
          }),
        });
        done++;
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status === 403 || status === 429 || status === 503) {
          this.nvdBlockedUntil = Date.now() + 5 * 60_000;
          this.log.warn({ status }, 'NVD rate limited, pause 5 min');
          break;
        }
        this.log.warn({ id, err: (err as Error).message }, 'NVD enrichment failed');
        this.db.update(vulns).set({ nvdCheckedAt: Date.now() }).where(eq(vulns.id, id)).run();
      }
    }
    return done;
  }

  async runEpss(batch = 100): Promise<number> {
    const ids = this.pipeline.epssQueue(batch);
    if (!ids.length) return 0;
    try {
      const scores = await fetchEpss(ids, this.fetch);
      const now = Date.now();
      this.db.update(vulns).set({ epssCheckedAt: now }).where(inArray(vulns.id, ids)).run();
      for (const s of scores) {
        this.pipeline.enrichVuln(s.cve, { epss: s.epss, epssPercentile: s.percentile });
      }
      return scores.length;
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, 'EPSS enrichment failed');
      return 0;
    }
  }
}
