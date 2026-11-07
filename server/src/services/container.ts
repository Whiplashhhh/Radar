import type { Config } from '../config';
import type { DB } from '../db/client';
import type { Logger } from '../lib/logger';
import { safeFetch, type SafeFetchOptions, type SafeResponse } from '../lib/safe-fetch';
import { Enricher } from './enricher';
import { Notifier } from './notifier';
import { Summarizer } from './ollama';
import { Pipeline } from './pipeline';
import { Poller } from './poller';
import { loadOrCreateVapid, PushService, type PushSender } from './push';
import { Scheduler } from './scheduler';
import { getSettings } from './settings';

export interface Services {
  pipeline: Pipeline;
  poller: Poller;
  enricher: Enricher;
  push: PushService;
  notifier: Notifier;
  summarizer: Summarizer;
  scheduler: Scheduler;
  fetch: (url: string, opts?: SafeFetchOptions) => Promise<SafeResponse>;
}

export interface ServiceOverrides {
  fetcher?: (url: string, opts?: SafeFetchOptions) => Promise<SafeResponse>;
  pushSender?: PushSender;
  now?: () => number;
}

export function createServices(config: Config, db: DB, log: Logger, o: ServiceOverrides = {}): Services {
  const fetcher = o.fetcher ?? safeFetch;
  const pipeline = new Pipeline(db, log, { retentionDays: () => getSettings(db).retention.days, now: o.now });
  const push = new PushService(db, loadOrCreateVapid(config.dataDir, log), config.vapidSubject, log, o.pushSender);
  const notifier = new Notifier(db, push, log, config.timezone, o.now);
  pipeline.hooks = {
    vulnUpdated: (v, opts) => notifier.onVulnUpdated(v, opts),
    itemCreated: (item, feed, opts) => notifier.onItemCreated(item, feed, opts),
  };
  const poller = new Poller(db, config, pipeline, log, fetcher);
  const enricher = new Enricher(db, config, pipeline, log, fetcher);
  const summarizer = new Summarizer(db, config, log);
  const scheduler = new Scheduler(db, config, log, { poller, enricher, notifier, summarizer });
  const fetch = (url: string, opts?: SafeFetchOptions) =>
    fetcher(url, { allowPrivate: config.allowPrivateNetworks, timeoutMs: config.fetchTimeoutMs, maxBytes: config.fetchMaxBytes, userAgent: config.userAgent, ...opts });
  return { pipeline, poller, enricher, push, notifier, summarizer, scheduler, fetch };
}
