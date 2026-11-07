import type { Config } from '../config';
import type { DB } from '../db/client';
import type { Logger } from '../lib/logger';
import { zonedParts } from '../lib/time';
import type { Enricher } from './enricher';
import type { Notifier } from './notifier';
import type { Summarizer } from './ollama';
import type { Poller } from './poller';
import { purge } from './retention';
import { getKv, getSettings, setKv } from './settings';

interface Deps {
  poller: Poller;
  enricher: Enricher;
  notifier: Notifier;
  summarizer: Summarizer;
}

/** Boucles de fond. Chaque tâche est protégée : une erreur est loguée, jamais fatale. */
export class Scheduler {
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly db: DB,
    private readonly config: Config,
    private readonly log: Logger,
    private readonly deps: Deps,
  ) {}

  private every(ms: number, name: string, fn: () => Promise<unknown> | unknown, initialDelay = 1000): void {
    let running = false;
    const run = async () => {
      if (running) return;
      running = true;
      try {
        await fn();
      } catch (err) {
        this.log.error({ err, task: name }, 'scheduled task failed');
      } finally {
        running = false;
      }
    };
    this.timers.push(setTimeout(run, initialDelay));
    this.timers.push(setInterval(run, ms));
  }

  start(): void {
    this.every(30_000, 'poll', () => this.deps.poller.pollDue(), 3000);
    this.every(30_000, 'enrich', () => this.deps.enricher.tick(), 20_000);
    this.every(30_000, 'dispatch', () => this.deps.notifier.dispatch(), 10_000);
    this.every(60_000, 'digest', () => this.deps.notifier.digest(), 15_000);
    this.every(3_600_000, 'retention', () => this.retention(), 60_000);
    if (this.deps.summarizer.enabled) this.every(60_000, 'summarize', () => this.deps.summarizer.tick(), 45_000);
    this.log.info('scheduler started');
  }

  retention(): void {
    const today = zonedParts(Date.now(), this.config.timezone).date;
    if (getKv<string>(this.db, 'lastPurgeDate') === today) return;
    const res = purge(this.db, getSettings(this.db).retention.days);
    setKv(this.db, 'lastPurgeDate', today);
    this.db.$client.pragma('optimize');
    this.log.info(res, 'retention purge done');
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
}
