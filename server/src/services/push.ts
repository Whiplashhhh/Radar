import fs from 'node:fs';
import path from 'node:path';
import * as webpush from 'web-push';
import { eq, sql } from 'drizzle-orm';
import type { DB } from '../db/client';
import { pushSubscriptions } from '../db/schema';
import type { Logger } from '../lib/logger';

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

/** Charge les clés VAPID depuis `data/vapid.json`, ou les génère au premier démarrage. */
export function loadOrCreateVapid(dataDir: string, log?: Logger): VapidKeys {
  const file = path.join(dataDir, 'vapid.json');
  if (fs.existsSync(file)) {
    const keys = JSON.parse(fs.readFileSync(file, 'utf8')) as VapidKeys;
    if (keys.publicKey && keys.privateKey) return keys;
  }
  const keys = webpush.generateVAPIDKeys();
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(keys, null, 2), { mode: 0o600 });
  log?.info({ file }, 'VAPID keys generated');
  return keys;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag?: string;
  severity?: string | null;
  techs?: string[];
  badge?: number;
  critical?: boolean;
  ts?: number;
}

export interface SubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export type PushSender = (sub: SubscriptionInput, payload: string, options: webpush.RequestOptions) => Promise<{ statusCode: number }>;

export class PushService {
  private readonly sender: PushSender;

  constructor(
    private readonly db: DB,
    readonly keys: VapidKeys,
    subject: string,
    private readonly log: Logger,
    sender?: PushSender,
  ) {
    webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
    this.sender = sender ?? ((sub, payload, options) => webpush.sendNotification(sub, payload, options));
  }

  subscribe(sub: SubscriptionInput, userAgent?: string): void {
    this.db
      .insert(pushSubscriptions)
      .values({ endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: userAgent ?? null })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: userAgent ?? null, failures: 0 },
      })
      .run();
  }

  unsubscribe(endpoint: string): void {
    this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)).run();
  }

  count(): number {
    return this.db.select({ n: sql<number>`count(*)` }).from(pushSubscriptions).get()?.n ?? 0;
  }

  /** Envoie à tous les appareils ; supprime les abonnements expirés (404/410). */
  async sendToAll(payload: PushPayload, opts: { urgent?: boolean; endpoint?: string } = {}): Promise<{ sent: number; removed: number; failed: number }> {
    const subs = opts.endpoint
      ? this.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, opts.endpoint)).all()
      : this.db.select().from(pushSubscriptions).all();
    const body = JSON.stringify({ ...payload, ts: payload.ts ?? Date.now() });
    let sent = 0;
    let removed = 0;
    let failed = 0;
    await Promise.all(
      subs.map(async (s) => {
        try {
          await this.sender({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
            TTL: 24 * 3600,
            urgency: opts.urgent ? 'high' : 'normal',
            ...(payload.tag ? { topic: payload.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) } : {}),
          });
          sent++;
          this.db.update(pushSubscriptions).set({ lastSuccessAt: Date.now(), failures: 0 }).where(eq(pushSubscriptions.id, s.id)).run();
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            this.unsubscribe(s.endpoint);
            removed++;
            this.log.info({ endpoint: s.endpoint.slice(0, 60) }, 'push subscription expired, removed');
          } else {
            failed++;
            this.db.update(pushSubscriptions).set({ failures: s.failures + 1 }).where(eq(pushSubscriptions.id, s.id)).run();
            this.log.warn({ status, err: (err as Error).message }, 'push send failed');
          }
        }
      }),
    );
    return { sent, removed, failed };
  }
}
