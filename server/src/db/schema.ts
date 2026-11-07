import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export type Category = 'security' | 'tech' | 'news' | 'releases';
export type AdapterKind = 'rss' | 'cisa-kev' | 'github-advisories';
export type MatchLevel = 'certain' | 'probable';
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'unknown';

export interface FeedOptions {
  /** Points ajoutés au score des articles de ce flux (ex. CERT-FR alertes). */
  boost?: number;
  /** `immediate` : chaque nouvel item déclenche une notif immédiate. */
  notify?: 'immediate' | 'default';
  /** Écosystèmes GitHub Advisory (maven, npm, pip, pub…). */
  ecosystems?: string[];
}

export interface AffectedPackage {
  ecosystem: string;
  package: string;
  vulnerable?: string | null;
  patched?: string | null;
}

export interface VulnReference {
  url: string;
  title?: string;
}

const now = sql`(unixepoch() * 1000)`;

export const feeds = sqliteTable('feeds', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  url: text('url').notNull().unique(),
  title: text('title').notNull(),
  siteUrl: text('site_url'),
  category: text('category').$type<Category>().notNull(),
  adapter: text('adapter').$type<AdapterKind>().notNull().default('rss'),
  options: text('options', { mode: 'json' }).$type<FeedOptions>().notNull().default({}),
  pollIntervalMin: integer('poll_interval_min').notNull().default(30),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  etag: text('etag'),
  lastModified: text('last_modified'),
  lastFetchAt: integer('last_fetch_at'),
  lastSuccessAt: integer('last_success_at'),
  nextFetchAt: integer('next_fetch_at').notNull().default(0),
  errorCount: integer('error_count').notNull().default(0),
  lastError: text('last_error'),
  itemCount: integer('item_count').notNull().default(0),
  createdAt: integer('created_at').notNull().default(now),
});

export const items = sqliteTable(
  'items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    feedId: integer('feed_id')
      .notNull()
      .references(() => feeds.id, { onDelete: 'cascade' }),
    guid: text('guid').notNull(),
    url: text('url'),
    canonicalUrl: text('canonical_url'),
    titleKey: text('title_key'),
    title: text('title').notNull(),
    summaryHtml: text('summary_html'),
    contentHtml: text('content_html'),
    author: text('author'),
    kind: text('kind').$type<'article' | 'vuln' | 'release'>().notNull().default('article'),
    vulnId: text('vuln_id'),
    publishedAt: integer('published_at').notNull(),
    fetchedAt: integer('fetched_at').notNull().default(now),
    score: integer('score').notNull().default(0),
    /** Dénormalisé pour le fil : sévérité max des vulns liées, KEV, technos touchées, vulns mentionnées. */
    severity: text('severity').$type<Severity>(),
    kev: integer('kev', { mode: 'boolean' }).notNull().default(false),
    techs: text('techs', { mode: 'json' }).$type<{ name: string; level: MatchLevel }[]>().notNull().default([]),
    vulnIds: text('vuln_ids', { mode: 'json' }).$type<string[]>().notNull().default([]),
    readAt: integer('read_at'),
    starredAt: integer('starred_at'),
    readableHtml: text('readable_html'),
    readableFetchedAt: integer('readable_fetched_at'),
    aiSummary: text('ai_summary'),
  },
  (t) => [
    uniqueIndex('items_feed_guid').on(t.feedId, t.guid),
    index('items_published').on(t.publishedAt),
    index('items_canonical').on(t.canonicalUrl),
    index('items_title_key').on(t.titleKey),
    index('items_vuln').on(t.vulnId),
    index('items_score').on(t.score),
  ],
);

export const vulns = sqliteTable(
  'vulns',
  {
    id: text('id').primaryKey(),
    aliases: text('aliases', { mode: 'json' }).$type<string[]>().notNull().default([]),
    title: text('title'),
    description: text('description'),
    cvssScore: real('cvss_score'),
    cvssVector: text('cvss_vector'),
    cvssVersion: text('cvss_version'),
    severity: text('severity').$type<Severity>().notNull().default('unknown'),
    epss: real('epss'),
    epssPercentile: real('epss_percentile'),
    kev: integer('kev', { mode: 'boolean' }).notNull().default(false),
    kevAddedAt: text('kev_added_at'),
    kevDueAt: text('kev_due_at'),
    kevRansomware: integer('kev_ransomware', { mode: 'boolean' }).notNull().default(false),
    affected: text('affected', { mode: 'json' }).$type<AffectedPackage[]>().notNull().default([]),
    cpes: text('cpes', { mode: 'json' }).$type<string[]>().notNull().default([]),
    references: text('references', { mode: 'json' }).$type<VulnReference[]>().notNull().default([]),
    publishedAt: integer('published_at'),
    score: integer('score').notNull().default(0),
    matchLevel: text('match_level').$type<MatchLevel>(),
    nvdCheckedAt: integer('nvd_checked_at'),
    epssCheckedAt: integer('epss_checked_at'),
    aiSummary: text('ai_summary'),
    firstSeenAt: integer('first_seen_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (t) => [index('vulns_score').on(t.score)],
);

export const vulnAliases = sqliteTable('vuln_aliases', {
  alias: text('alias').primaryKey(),
  vulnId: text('vuln_id')
    .notNull()
    .references(() => vulns.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
});

export const vulnSources = sqliteTable(
  'vuln_sources',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    vulnId: text('vuln_id')
      .notNull()
      .references(() => vulns.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    feedId: integer('feed_id').references(() => feeds.id, { onDelete: 'set null' }),
    itemId: integer('item_id').references(() => items.id, { onDelete: 'set null' }),
    url: text('url').notNull(),
    title: text('title'),
    sourceName: text('source_name'),
    seenAt: integer('seen_at').notNull().default(now),
  },
  (t) => [uniqueIndex('vuln_sources_unique').on(t.vulnId, t.url), index('vuln_sources_item').on(t.itemId)],
);

export const watchlist = sqliteTable('watchlist', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  aliases: text('aliases', { mode: 'json' }).$type<string[]>().notNull().default([]),
  cpes: text('cpes', { mode: 'json' }).$type<string[]>().notNull().default([]),
  packages: text('packages', { mode: 'json' }).$type<string[]>().notNull().default([]),
  exclude: text('exclude', { mode: 'json' }).$type<string[]>().notNull().default([]),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull().default(now),
});

export const matches = sqliteTable(
  'matches',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    vulnId: text('vuln_id').references(() => vulns.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    itemId: integer('item_id').references(() => items.id, { onDelete: 'cascade' }),
    watchId: integer('watch_id')
      .notNull()
      .references(() => watchlist.id, { onDelete: 'cascade' }),
    level: text('level').$type<MatchLevel>().notNull(),
    reason: text('reason').notNull(),
  },
  (t) => [index('matches_vuln').on(t.vulnId), index('matches_item').on(t.itemId), index('matches_watch').on(t.watchId)],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
});

export const pushSubscriptions = sqliteTable('push_subscriptions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  userAgent: text('user_agent'),
  createdAt: integer('created_at').notNull().default(now),
  lastSuccessAt: integer('last_success_at'),
  failures: integer('failures').notNull().default(0),
});

export const notifications = sqliteTable(
  'notifications',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    targetType: text('target_type').$type<'vuln' | 'item' | 'group' | 'digest' | 'test'>().notNull(),
    targetId: text('target_id'),
    tier: text('tier').$type<'immediate' | 'digest'>().notNull(),
    critical: integer('critical', { mode: 'boolean' }).notNull().default(false),
    title: text('title').notNull(),
    body: text('body').notNull(),
    url: text('url').notNull(),
    severity: text('severity').$type<Severity>(),
    techs: text('techs', { mode: 'json' }).$type<string[]>().notNull().default([]),
    createdAt: integer('created_at').notNull().default(now),
    notBefore: integer('not_before').notNull().default(0),
    sentAt: integer('sent_at'),
    status: text('status').$type<'pending' | 'sent' | 'grouped' | 'skipped'>().notNull().default('pending'),
  },
  (t) => [
    index('notifications_status').on(t.status, t.tier),
    uniqueIndex('notifications_target').on(t.targetType, t.targetId, t.tier),
  ],
);

export type Feed = typeof feeds.$inferSelect;
export type NewFeed = typeof feeds.$inferInsert;
export type Item = typeof items.$inferSelect;
export type Vuln = typeof vulns.$inferSelect;
export type WatchEntry = typeof watchlist.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
