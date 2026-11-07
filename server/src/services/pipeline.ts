import { and, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import type { AdapterResult, RawItem, RawVuln } from '../adapters/types';
import type { DB } from '../db/client';
import {
  feeds,
  items,
  matches,
  vulnAliases,
  vulnSources,
  vulns,
  watchlist,
  type AffectedPackage,
  type Feed,
  type Item,
  type MatchLevel,
  type Severity,
  type Vuln,
  type VulnReference,
} from '../db/schema';
import { canonicalId, extractVulnIds, isCve } from '../core/ids';
import { canonicalUrl, titleKey } from '../core/dedup';
import { bestLevel, matchAll, type MatchResult, type WatchRule } from '../core/matching';
import { scoreItem, scoreVuln, severityFromCvss } from '../core/scoring';
import { htmlToText, sanitize, truncate } from '../lib/html';
import type { Logger } from '../lib/logger';

const DAY = 86_400_000;
const SEVERITY_RANK: Record<Severity, number> = { unknown: 0, low: 1, medium: 2, high: 3, critical: 4 };

export interface PipelineHooks {
  /** Appelé après chaque re-score d'une vuln qui a une carte dans le fil. */
  vulnUpdated?(vuln: Vuln, opts: { quiet: boolean }): void;
  /** Appelé pour chaque nouvel item inséré. */
  itemCreated?(item: Item, feed: Feed, opts: { quiet: boolean }): void;
}

export interface IngestStats {
  newItems: number;
  duplicates: number;
  vulnsTouched: number;
}

export interface PipelineOptions {
  retentionDays: () => number;
  now?: () => number;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

function uniqBy<T>(arr: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return arr.filter((x) => {
    const k = key(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export class Pipeline {
  private rulesCache: WatchRule[] | null = null;
  private readonly now: () => number;

  constructor(
    private readonly db: DB,
    private readonly log: Logger,
    private readonly opts: PipelineOptions,
    public hooks: PipelineHooks = {},
  ) {
    this.now = opts.now ?? Date.now;
  }

  // ───────────────────────── watchlist ─────────────────────────

  rules(): WatchRule[] {
    if (!this.rulesCache) {
      this.rulesCache = this.db.select().from(watchlist).where(eq(watchlist.enabled, true)).all();
    }
    return this.rulesCache;
  }

  invalidateRules(): void {
    this.rulesCache = null;
  }

  /** Recalcule matches et scores des vulns et items récents (après modification de la watchlist). */
  rematchAll(days = 60): { vulns: number; items: number } {
    this.invalidateRules();
    const since = this.now() - days * DAY;
    let v = 0;
    let i = 0;
    this.db.transaction(() => {
      const vulnIds = this.db
        .select({ id: vulns.id })
        .from(vulns)
        .where(gt(vulns.updatedAt, since))
        .all();
      for (const { id } of vulnIds) {
        this.rescoreVuln(id, { quiet: true });
        v++;
      }
      const itemIds = this.db
        .select({ id: items.id })
        .from(items)
        .where(and(gt(items.publishedAt, since), sql`${items.kind} != 'vuln'`))
        .all();
      for (const { id } of itemIds) {
        this.rescoreItem(id);
        i++;
      }
    });
    return { vulns: v, items: i };
  }

  // ───────────────────────── ingestion ─────────────────────────

  ingest(feed: Feed, result: AdapterResult): IngestStats {
    const quiet = feed.lastSuccessAt == null;
    const stats: IngestStats = { newItems: 0, duplicates: 0, vulnsTouched: 0 };
    this.db.transaction(() => {
      const touched = new Map<string, { surface: RawVuln['surface'] }>();
      for (const raw of result.vulns) {
        const id = this.upsertVuln(raw, feed);
        if (!id) continue;
        const prev = touched.get(id);
        touched.set(id, { surface: prev?.surface === true || raw.surface === true ? true : (raw.surface ?? prev?.surface) });
      }
      for (const raw of result.items) {
        const r = this.insertItem(feed, raw, quiet);
        if (r === 'dup') stats.duplicates++;
        else if (r) {
          stats.newItems++;
          for (const vid of r.vulnIds) if (!touched.has(vid)) touched.set(vid, { surface: 'relevant' });
        }
      }
      for (const [id, { surface }] of touched) {
        this.rescoreVuln(id, { quiet, feedId: feed.id, surface: surface === true });
      }
      stats.vulnsTouched = touched.size;
    });
    return stats;
  }

  /** Insère un item ; retourne `'dup'` si doublon, `null` si déjà connu ou trop ancien. */
  insertItem(feed: Feed, raw: RawItem, quiet: boolean): { id: number; vulnIds: string[] } | 'dup' | null {
    const now = this.now();
    const exists = this.db
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.feedId, feed.id), eq(items.guid, raw.guid)))
      .get();
    if (exists) return null;

    let publishedAt = raw.publishedAt ?? now;
    if (publishedAt > now) publishedAt = now;
    if (publishedAt < now - this.opts.retentionDays() * DAY) return null;

    const canon = canonicalUrl(raw.url);
    const tkey = titleKey(raw.title);
    const summaryHtml = sanitize(raw.summaryHtml, raw.url ?? feed.siteUrl);
    const contentHtml = sanitize(raw.contentHtml, raw.url ?? feed.siteUrl);
    const text = `${raw.title}\n${htmlToText(summaryHtml)}\n${htmlToText(contentHtml)}`;
    const vulnIdsRaw = extractVulnIds(text);

    const dup =
      (canon && this.db.select({ id: items.id }).from(items).where(eq(items.canonicalUrl, canon)).get()) ||
      (tkey &&
        this.db
          .select({ id: items.id })
          .from(items)
          .where(and(eq(items.titleKey, tkey), gt(items.publishedAt, publishedAt - 3 * DAY), lt(items.publishedAt, publishedAt + 3 * DAY)))
          .get());
    if (dup) {
      // L'article existe déjà via un autre flux : on garde juste la mention pour les vulns.
      for (const id of vulnIdsRaw) {
        const vid = this.ensureVuln([id]);
        this.addSource(vid, { feedId: feed.id, itemId: dup.id, url: raw.url ?? `item:${dup.id}`, title: raw.title, sourceName: feed.title });
      }
      return 'dup';
    }

    const vulnIds = [...new Set(vulnIdsRaw.map((id) => this.ensureVuln([id])))];
    const row = this.db
      .insert(items)
      .values({
        feedId: feed.id,
        guid: raw.guid,
        url: raw.url ?? null,
        canonicalUrl: canon,
        titleKey: tkey,
        title: truncate(raw.title, 300),
        summaryHtml: summaryHtml || null,
        contentHtml: contentHtml || null,
        author: raw.author ?? null,
        kind: raw.kind ?? 'article',
        publishedAt,
        fetchedAt: now,
        vulnIds,
      })
      .returning()
      .get();
    for (const vid of vulnIds) {
      this.addSource(vid, { feedId: feed.id, itemId: row.id, url: raw.url ?? `item:${row.id}`, title: raw.title, sourceName: feed.title });
    }
    this.rescoreItem(row.id);
    const fresh = this.db.select().from(items).where(eq(items.id, row.id)).get();
    if (fresh) this.hooks.itemCreated?.(fresh, feed, { quiet: quiet || publishedAt < now - 2 * DAY });
    return { id: row.id, vulnIds };
  }

  // ───────────────────────── vulnérabilités ─────────────────────────

  private addSource(vulnId: string, s: { feedId: number | null; itemId: number | null; url: string; title?: string | null; sourceName?: string | null }): void {
    this.db
      .insert(vulnSources)
      .values({ vulnId, feedId: s.feedId, itemId: s.itemId, url: s.url, title: s.title ?? null, sourceName: s.sourceName ?? null, seenAt: this.now() })
      .onConflictDoNothing()
      .run();
  }

  /**
   * Garantit qu'une fiche existe pour l'ensemble d'identifiants donné, en fusionnant les fiches
   * existantes qui partagent un alias. Retourne l'identifiant canonique.
   */
  ensureVuln(ids: string[]): string {
    const wanted = [...new Set(ids.filter(Boolean))];
    const aliasRows = wanted.length
      ? this.db.select().from(vulnAliases).where(inArray(vulnAliases.alias, wanted)).all()
      : [];
    const existingIds = [...new Set(aliasRows.map((r) => r.vulnId))];
    const existing = existingIds.length ? this.db.select().from(vulns).where(inArray(vulns.id, existingIds)).all() : [];
    const allIds = [...new Set([...wanted, ...existing.flatMap((v) => [v.id, ...v.aliases])])];
    const canon = canonicalId(allIds);
    const aliases = allIds.filter((a) => a !== canon);

    const now = this.now();
    if (existing.length === 0) {
      this.db.insert(vulns).values({ id: canon, aliases, firstSeenAt: now, updatedAt: now }).onConflictDoNothing().run();
    } else if (existing.length === 1 && existing[0]?.id === canon) {
      if (aliases.length !== existing[0].aliases.length) {
        this.db.update(vulns).set({ aliases }).where(eq(vulns.id, canon)).run();
      }
    } else {
      this.mergeInto(canon, existing, aliases);
    }
    for (const a of allIds) {
      this.db.insert(vulnAliases).values({ alias: a, vulnId: canon }).onConflictDoUpdate({ target: vulnAliases.alias, set: { vulnId: canon } }).run();
    }
    return canon;
  }

  private mergeInto(canon: string, rows: Vuln[], aliases: string[]): void {
    const base = rows.find((r) => r.id === canon);
    const merged = rows.reduce<Partial<Vuln>>((acc, r) => this.mergeFields(acc, r), base ? { ...base } : {});
    const firstSeen = Math.min(...rows.map((r) => r.firstSeenAt));
    if (!base) {
      this.db
        .insert(vulns)
        .values({ ...(merged as Vuln), id: canon, aliases, firstSeenAt: firstSeen, updatedAt: this.now() })
        .run();
    } else {
      const { id: _id, ...rest } = merged as Vuln;
      this.db.update(vulns).set({ ...rest, aliases, firstSeenAt: firstSeen }).where(eq(vulns.id, canon)).run();
    }
    const canonCard = this.db.select({ id: items.id }).from(items).where(and(eq(items.vulnId, canon), eq(items.kind, 'vuln'))).get();
    let keptCard = canonCard?.id ?? null;
    for (const old of rows.filter((r) => r.id !== canon)) {
      const sqlite = this.db.$client;
      sqlite.prepare('UPDATE OR IGNORE vuln_sources SET vuln_id = ? WHERE vuln_id = ?').run(canon, old.id);
      sqlite.prepare('UPDATE OR IGNORE notifications SET target_id = ? WHERE target_type = ? AND target_id = ?').run(canon, 'vuln', old.id);
      sqlite.prepare('UPDATE vuln_aliases SET vuln_id = ? WHERE vuln_id = ?').run(canon, old.id);
      // Carte du fil : on garde une seule carte par vuln.
      const oldCard = this.db.select().from(items).where(and(eq(items.vulnId, old.id), eq(items.kind, 'vuln'))).get();
      if (oldCard) {
        if (keptCard == null) {
          this.db.update(items).set({ vulnId: canon, guid: `vuln:${canon}` }).where(eq(items.id, oldCard.id)).run();
          keptCard = oldCard.id;
        } else {
          this.db.delete(items).where(eq(items.id, oldCard.id)).run();
        }
      }
      // Articles qui citaient l'ancien identifiant
      const citing = this.db.select({ id: items.id, vulnIds: items.vulnIds }).from(items).where(sql`${items.vulnIds} LIKE ${`%"${old.id}"%`}`).all();
      for (const c of citing) {
        const next = [...new Set(c.vulnIds.map((x) => (x === old.id ? canon : x)))];
        this.db.update(items).set({ vulnIds: next }).where(eq(items.id, c.id)).run();
      }
      this.db.delete(vulns).where(eq(vulns.id, old.id)).run();
    }
  }

  private mergeFields(base: Partial<Vuln>, raw: Partial<RawVuln> | Partial<Vuln>): Partial<Vuln> {
    const affected = uniqBy<AffectedPackage>(
      [...(base.affected ?? []), ...(raw.affected ?? [])],
      (a) => `${a.ecosystem}|${a.package}|${a.vulnerable ?? ''}`,
    ).slice(0, 60);
    const references = uniqBy<VulnReference>([...(base.references ?? []), ...(raw.references ?? [])], (r) => r.url).slice(0, 40);
    const cpes = [...new Set([...(base.cpes ?? []), ...(raw.cpes ?? [])])].slice(0, 200);
    const cvssScore = base.cvssScore ?? raw.cvssScore ?? null;
    const useRawCvss = base.cvssScore == null && raw.cvssScore != null;
    let severity: Severity = base.severity && base.severity !== 'unknown' ? base.severity : ((raw.severity as Severity | undefined) ?? 'unknown');
    if (severity === 'unknown') severity = severityFromCvss(cvssScore);
    const published = [base.publishedAt, raw.publishedAt].filter((x): x is number => x != null);
    return {
      ...base,
      title: base.title ?? raw.title ?? null,
      description: base.description ?? raw.description ?? null,
      cvssScore,
      cvssVector: useRawCvss ? (raw.cvssVector ?? null) : (base.cvssVector ?? raw.cvssVector ?? null),
      cvssVersion: useRawCvss ? (raw.cvssVersion ?? null) : (base.cvssVersion ?? raw.cvssVersion ?? null),
      severity,
      epss: raw.epss ?? base.epss ?? null,
      epssPercentile: raw.epssPercentile ?? base.epssPercentile ?? null,
      kev: !!(base.kev || raw.kev),
      kevAddedAt: base.kevAddedAt ?? raw.kevAddedAt ?? null,
      kevDueAt: base.kevDueAt ?? raw.kevDueAt ?? null,
      kevRansomware: !!(base.kevRansomware || raw.kevRansomware),
      affected,
      references,
      cpes,
      publishedAt: published.length ? Math.min(...published) : null,
    };
  }

  /** Fusionne les données d'une source structurée (KEV, GHSA…) dans la fiche. */
  upsertVuln(raw: RawVuln, feed: Feed | null): string | null {
    if (!raw.id) return null;
    const id = this.ensureVuln([raw.id, ...(raw.aliases ?? [])]);
    const cur = this.db.select().from(vulns).where(eq(vulns.id, id)).get();
    if (!cur) return null;
    const merged = this.mergeFields(cur, raw);
    const changed =
      merged.title !== cur.title ||
      merged.description !== cur.description ||
      merged.cvssScore !== cur.cvssScore ||
      merged.severity !== cur.severity ||
      merged.epss !== cur.epss ||
      merged.kev !== cur.kev ||
      (merged.affected?.length ?? 0) !== cur.affected.length ||
      (merged.cpes?.length ?? 0) !== cur.cpes.length ||
      (merged.references?.length ?? 0) !== cur.references.length;
    if (changed) {
      const { id: _id, ...rest } = merged as Vuln;
      this.db.update(vulns).set({ ...rest, updatedAt: this.now() }).where(eq(vulns.id, id)).run();
    }
    this.addSource(id, { feedId: feed?.id ?? null, itemId: null, url: raw.sourceUrl, title: raw.sourceTitle ?? feed?.title, sourceName: feed?.title ?? raw.sourceTitle });
    return id;
  }

  /** Applique un enrichissement (NVD, EPSS) : ces données font autorité sur celles des flux. */
  enrichVuln(id: string, patch: Partial<Vuln>): void {
    const cur = this.db.select().from(vulns).where(eq(vulns.id, id)).get();
    if (!cur) return;
    const merged = this.mergeFields({ ...cur, ...stripNullish(patch) }, { affected: patch.affected, cpes: patch.cpes, references: patch.references });
    merged.affected = uniqBy([...cur.affected, ...(patch.affected ?? [])], (a) => `${a.ecosystem}|${a.package}|${a.vulnerable ?? ''}`).slice(0, 60);
    merged.cpes = [...new Set([...cur.cpes, ...(patch.cpes ?? [])])].slice(0, 200);
    merged.references = uniqBy([...cur.references, ...(patch.references ?? [])], (r) => r.url).slice(0, 40);
    if (patch.cvssScore != null) merged.severity = severityFromCvss(patch.cvssScore);
    const { id: _id, ...rest } = merged as Vuln;
    this.db.update(vulns).set({ ...rest, updatedAt: this.now() }).where(eq(vulns.id, id)).run();
    this.rescoreVuln(id, { quiet: false });
  }

  private isRelevant(v: Vuln, level: MatchLevel | null): boolean {
    const now = this.now();
    const recent = v.publishedAt == null || v.publishedAt > now - 90 * DAY;
    const kevRecent = v.kev && v.kevAddedAt != null && Date.parse(`${v.kevAddedAt}T00:00:00Z`) > now - 30 * DAY;
    // Une vuln seulement citée (sans titre, description ni CVSS) attend l'enrichissement NVD avant d'avoir sa carte.
    const hasData = !!(v.title || v.description || v.cvssScore != null);
    return hasData && (kevRecent || (recent && (level != null || v.severity === 'critical')));
  }

  rescoreVuln(id: string, opts: { quiet: boolean; feedId?: number; surface?: boolean }): Vuln | null {
    const v = this.db.select().from(vulns).where(eq(vulns.id, id)).get();
    if (!v) return null;
    const sources = this.db
      .select({ title: vulnSources.title, feedId: vulnSources.feedId, itemId: vulnSources.itemId })
      .from(vulnSources)
      .where(eq(vulnSources.vulnId, id))
      .all();
    // Si la vuln a des packages structurés (GHSA), la description est trop bruitée pour les mots-clés
    // (« … comme une macro Python » sur un package Maven) : on se limite au titre et aux sources.
    const structured = v.affected.some((a) => a.ecosystem !== 'cpe');
    const text = [v.id, v.title, structured ? null : v.description, ...sources.map((s) => s.title)].filter(Boolean).join('\n');
    const results = matchAll(this.rules(), { text, packages: v.affected, cpes: v.cpes });
    const level = bestLevel(results);
    const score = scoreVuln({ severity: v.severity, kev: v.kev, epss: v.epss, matchLevel: level });

    this.db.delete(matches).where(eq(matches.vulnId, id)).run();
    if (results.length) {
      this.db.insert(matches).values(results.map((r) => ({ vulnId: id, watchId: r.watchId, level: r.level, reason: r.reason }))).run();
    }
    this.db.update(vulns).set({ score, matchLevel: level }).where(eq(vulns.id, id)).run();
    const updated: Vuln = { ...v, score, matchLevel: level };

    const techs = techList(results);
    let card = this.db.select().from(items).where(and(eq(items.vulnId, id), eq(items.kind, 'vuln'))).get();
    if (!card && (opts.surface || this.isRelevant(updated, level))) {
      const feedId = opts.feedId ?? sources.find((s) => s.feedId != null)?.feedId;
      if (feedId != null) {
        card = this.db
          .insert(items)
          .values({
            feedId,
            guid: `vuln:${id}`,
            url: vulnUrl(updated),
            title: id,
            kind: 'vuln',
            vulnId: id,
            vulnIds: [id],
            publishedAt: Math.min(this.now(), Math.max(v.publishedAt ?? 0, v.kevAddedAt ? Date.parse(`${v.kevAddedAt}T12:00:00Z`) : 0) || this.now()),
            fetchedAt: this.now(),
          })
          .onConflictDoNothing()
          .returning()
          .get();
      }
    }
    if (card) {
      this.db
        .update(items)
        .set({
          title: v.title ? truncate(v.title, 300) : v.description ? truncate(v.description.split(/(?<=\.)\s/)[0] ?? v.description, 160) : id,
          summaryHtml: v.description ? `<p>${escapeHtml(truncate(v.description, 1200))}</p>` : null,
          url: vulnUrl(updated),
          score,
          severity: v.severity,
          kev: v.kev,
          techs,
        })
        .where(eq(items.id, card.id))
        .run();
      this.hooks.vulnUpdated?.(updated, { quiet: opts.quiet });
    }
    for (const itemId of new Set(sources.map((s) => s.itemId).filter((x): x is number => x != null))) {
      this.rescoreItem(itemId);
    }
    return updated;
  }

  rescoreItem(itemId: number): void {
    const row = this.db
      .select({ item: items, feed: feeds })
      .from(items)
      .innerJoin(feeds, eq(items.feedId, feeds.id))
      .where(eq(items.id, itemId))
      .get();
    if (!row || row.item.kind === 'vuln') return;
    const { item, feed } = row;
    const text = [
      item.title,
      htmlToText(item.summaryHtml).slice(0, 4000),
      htmlToText(item.contentHtml).slice(0, 4000),
      item.kind === 'release' ? feed.title : '',
    ].join('\n');
    const results = matchAll(this.rules(), { text });
    this.db.delete(matches).where(eq(matches.itemId, itemId)).run();
    if (results.length) {
      this.db.insert(matches).values(results.map((r) => ({ itemId, watchId: r.watchId, level: r.level, reason: r.reason }))).run();
    }
    const linked = item.vulnIds.length
      ? this.db
          .select({ id: vulns.id, score: vulns.score, severity: vulns.severity, kev: vulns.kev })
          .from(vulns)
          .where(inArray(vulns.id, item.vulnIds))
          .all()
      : [];
    const vulnTechs = linked.length
      ? this.db
          .select({ name: watchlist.name, level: matches.level })
          .from(matches)
          .innerJoin(watchlist, eq(matches.watchId, watchlist.id))
          .where(inArray(matches.vulnId, linked.map((l) => l.id)))
          .all()
      : [];
    const best = linked.reduce<number | null>((m, l) => (m == null || l.score > m ? l.score : m), null);
    const severity = linked.reduce<Severity | null>(
      (m, l) => (m == null || SEVERITY_RANK[l.severity] > SEVERITY_RANK[m] ? l.severity : m),
      null,
    );
    const score = scoreItem({ category: feed.category, boost: feed.options.boost, matchLevel: bestLevel(results), bestVulnScore: best });
    const techs = techList([...results, ...vulnTechs.map((t) => ({ watchId: 0, name: t.name, level: t.level, reason: '' }))]);
    this.db
      .update(items)
      .set({ score, severity: severity && severity !== 'unknown' ? severity : null, kev: linked.some((l) => l.kev), techs })
      .where(eq(items.id, itemId))
      .run();
  }

  /** Vulns à enrichir via NVD : priorité aux vulns avec carte ou matchées, puis aux plus récentes. */
  nvdQueue(limit: number): string[] {
    const now = this.now();
    return this.db
      .select({ id: vulns.id })
      .from(vulns)
      .leftJoin(items, and(eq(items.vulnId, vulns.id), eq(items.kind, 'vuln')))
      .where(
        and(
          sql`${vulns.id} LIKE 'CVE-%'`,
          sql`(${vulns.nvdCheckedAt} IS NULL OR (${vulns.nvdCheckedAt} < ${now - DAY} AND (${vulns.publishedAt} IS NULL OR ${vulns.publishedAt} > ${now - 30 * DAY}) AND ${vulns.cvssScore} IS NULL))`,
          sql`(${items.id} IS NOT NULL OR ${vulns.matchLevel} IS NOT NULL OR ${vulns.firstSeenAt} > ${now - 7 * DAY})`,
          sql`NOT (${vulns.kev} = 1 AND ${items.id} IS NULL AND ${vulns.matchLevel} IS NULL)`,
        ),
      )
      .orderBy(sql`${items.id} IS NULL`, sql`${vulns.matchLevel} IS NULL`, desc(vulns.firstSeenAt))
      .limit(limit)
      .all()
      .map((r) => r.id);
  }

  epssQueue(limit: number): string[] {
    const now = this.now();
    return this.db
      .select({ id: vulns.id })
      .from(vulns)
      .where(
        and(
          sql`${vulns.id} LIKE 'CVE-%'`,
          sql`(${vulns.epssCheckedAt} IS NULL OR ${vulns.epssCheckedAt} < ${now - DAY})`,
          sql`(${vulns.matchLevel} IS NOT NULL OR ${vulns.firstSeenAt} > ${now - 30 * DAY} OR EXISTS (SELECT 1 FROM items i WHERE i.vuln_id = ${vulns.id}))`,
        ),
      )
      .orderBy(desc(vulns.firstSeenAt))
      .limit(limit)
      .all()
      .map((r) => r.id)
      .filter(isCve);
  }
}

function stripNullish<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) as Partial<T>;
}

function techList(results: Pick<MatchResult, 'name' | 'level'>[]): { name: string; level: MatchLevel }[] {
  const byName = new Map<string, MatchLevel>();
  for (const r of results) {
    if (byName.get(r.name) !== 'certain') byName.set(r.name, r.level);
  }
  return [...byName].map(([name, level]) => ({ name, level })).sort((a, b) => (a.level === b.level ? a.name.localeCompare(b.name) : a.level === 'certain' ? -1 : 1));
}

export function vulnUrl(v: Pick<Vuln, 'id'>): string {
  return isCve(v.id) ? `https://nvd.nist.gov/vuln/detail/${v.id}` : `https://github.com/advisories/${v.id}`;
}
