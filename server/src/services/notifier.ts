import { and, desc, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { DB } from '../db/client';
import { items, notifications, vulns, type Feed, type Item, type Notification, type Severity, type Vuln } from '../db/schema';
import type { Logger } from '../lib/logger';
import { deferForQuiet, isQuiet, parseHHMM, zonedParts } from '../lib/time';
import type { BriefingService } from './briefing';
import type { PushPayload, PushService } from './push';
import { getKv, getSettings, setKv, type Settings } from './settings';

const DAY = 86_400_000;

export const SEVERITY_FR: Record<Severity, string> = {
  critical: 'Critique',
  high: 'Haute',
  medium: 'Moyenne',
  low: 'Basse',
  unknown: 'Inconnue',
};

const SEVERITY_DOT: Record<Severity, string> = { critical: '🔴', high: '🟠', medium: '🟡', low: '🔵', unknown: '⚪' };

export type Tier = 'immediate' | 'digest' | null;

export interface VulnForRules {
  severity: Severity;
  cvssScore: number | null;
  kev: boolean;
  epss: number | null;
  matchLevel: Vuln['matchLevel'];
}

/** Règles de notification d'une vuln (SPEC §7). */
export function classifyVuln(v: VulnForRules, s: Settings['notifications'], digest: Settings['digest']): Tier {
  const matched = s.immediateRequireCertain ? v.matchLevel === 'certain' : v.matchLevel != null;
  if (!v.matchLevel) return null;
  const cvss = v.cvssScore ?? (v.severity === 'critical' ? 9 : null);
  const hot = (cvss != null && cvss >= s.immediateCvssMin) || (s.immediateOnKev && v.kev) || (v.epss != null && v.epss >= s.immediateEpssMin);
  if (matched && hot) return 'immediate';
  if (v.severity === 'critical' || v.severity === 'high' || (digest.includeMedium && v.severity === 'medium')) return 'digest';
  return null;
}

/** Critique = contourne les heures calmes : KEV ou CVSS ≥ 9, avec match certain. */
export function isCritical(v: VulnForRules): boolean {
  return v.matchLevel === 'certain' && (v.kev || (v.cvssScore ?? 0) >= 9 || (v.cvssScore == null && v.severity === 'critical'));
}

export interface TechRef {
  name: string;
}

export function vulnPayload(v: Pick<Vuln, 'id' | 'title' | 'severity' | 'cvssScore' | 'kev'>, techs: string[]): PushPayload {
  const sev = SEVERITY_FR[v.severity];
  const score = v.cvssScore != null ? ` ${v.cvssScore.toFixed(1)}` : '';
  const head = techs.length ? `${techs.slice(0, 3).join(', ')} — ` : '';
  return {
    title: `${SEVERITY_DOT[v.severity]} ${v.id} · ${sev}${score}${v.kev ? ' · KEV' : ''}`,
    body: `${head}${v.title ?? 'Nouvelle vulnérabilité'}`.slice(0, 220),
    url: `/vuln/${encodeURIComponent(v.id)}`,
    tag: v.id,
    severity: v.severity,
    techs,
  };
}

export function groupPayload(entries: { kind: 'vuln' | 'item'; id: string; severity: Severity | null; techs: string[]; label: string }[]): PushPayload {
  const n = entries.length;
  const allVulns = entries.every((e) => e.kind === 'vuln');
  const allCritical = entries.every((e) => e.severity === 'critical');
  const title = allVulns
    ? `${n} nouvelles CVE ${allCritical ? 'critiques' : 'prioritaires'}`
    : `${n} nouvelles alertes`;
  const techs = [...new Set(entries.flatMap((e) => e.techs))];
  const lines = entries.slice(0, 3).map((e) => `• ${e.label}`);
  if (n > 3) lines.push(`… et ${n - 3} autre${n - 3 > 1 ? 's' : ''}`);
  return {
    title: `${allCritical ? '🔴' : '🟠'} ${title}`,
    body: `${techs.length ? `${techs.slice(0, 4).join(', ')}\n` : ''}${lines.join('\n')}`.slice(0, 400),
    url: '/priority',
    tag: 'radar-group',
    severity: allCritical ? 'critical' : 'high',
    techs,
  };
}

export class Notifier {
  briefings?: BriefingService;

  constructor(
    private readonly db: DB,
    private readonly push: PushService,
    private readonly log: Logger,
    private readonly tz: string,
    private readonly now: () => number = Date.now,
  ) {}

  private techsOf(vulnId: string): string[] {
    const rows = this.db.$client
      .prepare('SELECT w.name, m.level FROM matches m JOIN watchlist w ON w.id = m.watch_id WHERE m.vuln_id = ? ORDER BY m.level = \'certain\' DESC, w.name')
      .all(vulnId) as { name: string }[];
    return [...new Set(rows.map((r) => r.name))];
  }

  private existing(type: Notification['targetType'], id: string, tier: 'immediate' | 'digest'): Notification | undefined {
    return this.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.targetType, type), eq(notifications.targetId, id), eq(notifications.tier, tier)))
      .get();
  }

  /** Hook du pipeline : une vuln avec carte a été (re)scorée. */
  onVulnUpdated(v: Vuln, opts: { quiet: boolean }): void {
    const s = getSettings(this.db);
    const now = this.now();
    // Pas de notif pour une vieillerie : vuln vue pour la première fois il y a plus de 7 jours.
    if (v.firstSeenAt < now - 7 * DAY) return;
    const tier = classifyVuln(v, s.notifications, s.digest);
    if (!tier) return;
    const critical = isCritical(v);
    const techs = this.techsOf(v.id);
    const p = vulnPayload(v, techs);
    const base = {
      targetType: 'vuln' as const,
      targetId: v.id,
      title: p.title,
      body: p.body,
      url: p.url,
      severity: v.severity,
      techs,
      createdAt: now,
    };
    if (tier === 'immediate') {
      if (this.existing('vuln', v.id, 'immediate')) return;
      this.db
        .insert(notifications)
        .values({
          ...base,
          tier,
          critical,
          notBefore: critical ? now : deferForQuiet(now, this.tz, s.quietHours),
          status: opts.quiet ? 'skipped' : 'pending',
        })
        .onConflictDoNothing()
        .run();
      // La vuln passe en immédiat : inutile de la remettre dans le digest.
      this.db
        .update(notifications)
        .set({ status: 'skipped' })
        .where(and(eq(notifications.targetType, 'vuln'), eq(notifications.targetId, v.id), eq(notifications.tier, 'digest'), eq(notifications.status, 'pending')))
        .run();
    } else if (!this.existing('vuln', v.id, 'immediate') && !this.existing('vuln', v.id, 'digest')) {
      this.db.insert(notifications).values({ ...base, tier, critical: false, status: opts.quiet ? 'skipped' : 'pending' }).onConflictDoNothing().run();
    }
  }

  /** Hook du pipeline : nouvel item (alertes CERT-FR → push immédiat). */
  onItemCreated(item: Item, feed: Feed, opts: { quiet: boolean }): void {
    if (opts.quiet || feed.options.notify !== 'immediate') return;
    const s = getSettings(this.db);
    if (!s.notifications.certFrAlerts) return;
    const now = this.now();
    this.db
      .insert(notifications)
      .values({
        targetType: 'item',
        targetId: String(item.id),
        tier: 'immediate',
        critical: true,
        title: `🚨 ${feed.title}`,
        body: item.title.slice(0, 220),
        url: `/item/${item.id}`,
        severity: item.severity ?? 'high',
        techs: item.techs.map((t) => t.name),
        createdAt: now,
        notBefore: now,
      })
      .onConflictDoNothing()
      .run();
  }

  unreadPriorityCount(threshold?: number): number {
    const t = threshold ?? getSettings(this.db).feed.priorityThreshold;
    return this.db.select({ n: sql<number>`count(*)` }).from(items).where(and(isNull(items.readAt), gt(items.score, t - 1))).get()?.n ?? 0;
  }

  /** Envoie les notifs immédiates en attente, regroupées si rafale. */
  async dispatch(): Promise<{ sent: number; grouped: number } | null> {
    const s = getSettings(this.db);
    const now = this.now();
    const pending = this.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.status, 'pending'), eq(notifications.tier, 'immediate'), lte(notifications.notBefore, now)))
      .orderBy(notifications.createdAt)
      .all();
    if (!pending.length) return null;
    if (!s.notifications.enabled) {
      this.db.update(notifications).set({ status: 'skipped' }).where(inArray(notifications.id, pending.map((p) => p.id))).run();
      return null;
    }
    const lastPush = getKv<number>(this.db, 'lastPushAt') ?? 0;
    if (now - lastPush < s.notifications.minIntervalSec * 1000) return null;
    const oldest = pending[0];
    if (oldest && now - Math.max(oldest.createdAt, oldest.notBefore) < s.notifications.groupWindowSec * 1000) return null;

    const entries = pending.map((p) => {
      const v = p.targetType === 'vuln' && p.targetId ? this.db.select().from(vulns).where(eq(vulns.id, p.targetId)).get() : undefined;
      const techs = v ? this.techsOf(v.id) : p.techs;
      return { row: p, vuln: v, techs };
    });
    const badge = this.unreadPriorityCount(s.feed.priorityThreshold);
    let payload: PushPayload;
    const first = entries[0];
    if (entries.length === 1 && first) {
      payload = first.vuln ? vulnPayload(first.vuln, first.techs) : { title: first.row.title, body: first.row.body, url: first.row.url, tag: `item-${first.row.targetId}`, severity: first.row.severity, techs: first.techs };
    } else {
      payload = groupPayload(
        entries.map((e) => ({
          kind: e.vuln ? 'vuln' : 'item',
          id: e.row.targetId ?? '',
          severity: e.vuln?.severity ?? e.row.severity ?? null,
          techs: e.techs,
          label: e.vuln ? `${e.vuln.id}${e.techs[0] ? ` (${e.techs[0]})` : ''}` : e.row.body.slice(0, 80),
        })),
      );
    }
    payload.badge = badge;
    payload.critical = pending.some((p) => p.critical);
    const result = await this.push.sendToAll(payload, { urgent: payload.critical });
    setKv(this.db, 'lastPushAt', now);
    const ids = pending.map((p) => p.id);
    this.db
      .update(notifications)
      .set({ status: entries.length > 1 ? 'grouped' : 'sent', sentAt: now })
      .where(inArray(notifications.id, ids))
      .run();
    if (entries.length > 1) {
      this.db.insert(notifications).values({ targetType: 'group', tier: 'immediate', title: payload.title, body: payload.body, url: payload.url, techs: payload.techs ?? [], status: 'sent', sentAt: now, createdAt: now }).run();
    }
    this.log.info({ count: entries.length, ...result }, 'push dispatched');
    return { sent: result.sent, grouped: entries.length };
  }

  /**
   * Rendez-vous du matin, à l'heure configurée (fenêtre de 3 h), une fois par jour, hors heures calmes :
   * 1. génère le briefing (toutes les actus depuis le précédent, s'il y en a) ;
   * 2. envoie le digest (CVE matchées moyennes/hautes + top actus), avec un lien vers le briefing.
   */
  async digest(force = false): Promise<PushPayload | null> {
    const s = getSettings(this.db);
    const now = this.now();
    const local = zonedParts(now, this.tz);
    if (!force) {
      if (!s.digest.enabled && !s.briefing.enabled) return null;
      const start = parseHHMM(s.digest.time);
      if (local.minutes < start || local.minutes > start + 180) return null;
      if (getKv<string>(this.db, 'lastDigestDate') === local.date) return null;
      if (s.quietHours.enabled && isQuiet(now, this.tz, s.quietHours.start, s.quietHours.end)) return null;
    }
    setKv(this.db, 'lastDigestDate', local.date);

    let briefing: Awaited<ReturnType<BriefingService['generate']>> = null;
    if (this.briefings && (s.briefing.enabled || force)) {
      briefing = await this.briefings.generate({ force }).catch((err: Error) => {
        this.log.error({ err: err.message }, 'briefing generation failed');
        return null;
      });
    }
    if (!force && (!s.digest.enabled || !s.notifications.enabled)) return null;

    const vulnRows = this.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.status, 'pending'), eq(notifications.tier, 'digest')))
      .orderBy(desc(notifications.createdAt))
      .all();
    const vulnList = vulnRows
      .map((r) => (r.targetId ? this.db.select().from(vulns).where(eq(vulns.id, r.targetId)).get() : undefined))
      .filter((v): v is Vuln => !!v)
      .sort((a, b) => b.score - a.score);
    const news = s.digest.topNews
      ? this.db
          .select({ id: items.id, title: items.title, score: items.score })
          .from(items)
          .where(and(sql`${items.kind} != 'vuln'`, gt(items.fetchedAt, now - DAY), isNull(items.readAt)))
          .orderBy(desc(items.score), desc(items.publishedAt))
          .limit(s.digest.topNews)
          .all()
      : [];
    if (!vulnList.length && !news.length && !briefing) return null;

    const techs = [...new Set(vulnList.flatMap((v) => this.techsOf(v.id)))];
    const parts: string[] = [];
    if (vulnList.length) parts.push(`${vulnList.length} CVE`);
    if (news.length) parts.push(`${news.length} actu${news.length > 1 ? 's' : ''}`);
    const lines = [
      ...vulnList.slice(0, 3).map((v) => `• ${v.id} (${SEVERITY_FR[v.severity].toLowerCase()})${this.techsOf(v.id)[0] ? ` ${this.techsOf(v.id)[0]}` : ''}`),
      ...news.slice(0, 3).map((n) => `• ${n.title.slice(0, 70)}`),
    ];
    if (briefing) {
      const accroche = briefing.summary
        .split('\n')
        .map((l) => l.replace(/[#*_`]/g, '').replace(/^-\s*/, '').trim())
        .find((l) => l.length > 20);
      if (!news.length) parts.push(`${briefing.itemCount} actu${briefing.itemCount > 1 ? 's' : ''}`);
      lines.splice(vulnList.length ? Math.min(vulnList.length, 3) : 0, lines.length, ...(accroche ? [`📝 ${accroche}`] : []));
    }
    const payload: PushPayload = {
      title: `☀️ ${briefing ? 'Briefing du matin' : 'Digest Radar'} · ${parts.join(', ')}`,
      body: `${techs.length ? `${techs.slice(0, 4).join(', ')}\n` : ''}${lines.join('\n')}`.slice(0, 400),
      url: briefing ? `/briefing/${briefing.id}` : '/priority',
      tag: 'radar-digest',
      severity: vulnList[0]?.severity ?? null,
      techs,
      badge: this.unreadPriorityCount(s.feed.priorityThreshold),
    };
    await this.push.sendToAll(payload);
    if (vulnRows.length) {
      this.db.update(notifications).set({ status: 'sent', sentAt: now }).where(inArray(notifications.id, vulnRows.map((r) => r.id))).run();
    }
    this.db.insert(notifications).values({ targetType: 'digest', targetId: local.date, tier: 'digest', title: payload.title, body: payload.body, url: payload.url, techs, status: 'sent', sentAt: now, createdAt: now }).onConflictDoNothing().run();
    return payload;
  }
}
