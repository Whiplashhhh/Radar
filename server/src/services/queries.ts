import type { DB } from '../db/client';
import type { Category, MatchLevel, Severity } from '../db/schema';
import { htmlToText, truncate } from '../lib/html';

export type View = 'priority' | 'security' | 'tech' | 'all';

export interface ListParams {
  view: View;
  q?: string;
  feedId?: number;
  tech?: string;
  severity?: Severity[];
  unread?: boolean;
  starred?: boolean;
  cursor?: string;
  limit?: number;
  threshold: number;
}

export interface ItemCard {
  id: number;
  kind: 'article' | 'vuln' | 'release';
  title: string;
  url: string | null;
  excerpt: string;
  publishedAt: number;
  score: number;
  severity: Severity | null;
  kev: boolean;
  techs: { name: string; level: MatchLevel }[];
  vulnIds: string[];
  vulnId: string | null;
  cvss: number | null;
  epss: number | null;
  read: boolean;
  starred: boolean;
  aiSummary: string | null;
  feed: { id: number; title: string; category: Category };
}

interface Row {
  id: number;
  kind: ItemCard['kind'];
  title: string;
  url: string | null;
  summary_html: string | null;
  content_html: string | null;
  published_at: number;
  score: number;
  severity: Severity | null;
  kev: number;
  techs: string;
  vuln_ids: string;
  vuln_id: string | null;
  read_at: number | null;
  starred_at: number | null;
  ai_summary: string | null;
  feed_id: number;
  feed_title: string;
  category: Category;
  cvss_score: number | null;
  epss: number | null;
}

/** Transforme une saisie utilisateur en requête FTS5 sûre : chaque mot entre guillemets, préfixe sur le dernier. */
export function ftsQuery(q: string): string | null {
  const terms = q
    .normalize('NFC')
    .split(/\s+/)
    .map((t) => t.replace(/["*^():]/g, '').trim())
    .filter((t) => t.length > 0)
    .slice(0, 8);
  if (!terms.length) return null;
  return terms.map((t, i) => `"${t}"${i === terms.length - 1 ? '*' : ''}`).join(' ');
}

function buildWhere(p: Omit<ListParams, 'cursor' | 'limit'>): { where: string[]; args: Record<string, unknown> } {
  const where: string[] = [];
  const args: Record<string, unknown> = {};
  switch (p.view) {
    case 'priority':
      where.push('i.score >= @threshold');
      args.threshold = p.threshold;
      break;
    case 'security':
      where.push("f.category = 'security'");
      break;
    case 'tech':
      where.push("f.category IN ('tech', 'releases')");
      break;
    default:
      break;
  }
  if (p.q) {
    const fts = ftsQuery(p.q);
    if (fts) {
      where.push('(i.id IN (SELECT rowid FROM items_fts WHERE items_fts MATCH @fts) OR i.vuln_ids LIKE @qlike)');
      args.fts = fts;
      args.qlike = `%${p.q.trim().toUpperCase()}%`;
    }
  }
  if (p.feedId) {
    where.push('f.id = @feedId');
    args.feedId = p.feedId;
  }
  if (p.tech) {
    where.push("EXISTS (SELECT 1 FROM json_each(i.techs) j WHERE json_extract(j.value, '$.name') = @tech)");
    args.tech = p.tech;
  }
  if (p.severity?.length) {
    where.push(`i.severity IN (${p.severity.map((_, k) => `@sev${k}`).join(', ')})`);
    p.severity.forEach((s, k) => (args[`sev${k}`] = s));
  }
  if (p.unread) where.push('i.read_at IS NULL');
  if (p.starred) where.push('i.starred_at IS NOT NULL');
  return { where, args };
}

export function parseCursor(cursor: string | undefined): { ts: number; id: number } | null {
  if (!cursor) return null;
  const [ts, id] = cursor.split(':').map(Number);
  return Number.isFinite(ts) && Number.isFinite(id) ? { ts: ts as number, id: id as number } : null;
}

const SELECT = `
  SELECT i.id, i.kind, i.title, i.url, i.summary_html, substr(i.content_html, 1, 3000) AS content_html, i.published_at, i.score, i.severity, i.kev,
         i.techs, i.vuln_ids, i.vuln_id, i.read_at, i.starred_at, i.ai_summary,
         f.id AS feed_id, f.title AS feed_title, f.category,
         v.cvss_score, v.epss
  FROM items i
  JOIN feeds f ON f.id = i.feed_id
  LEFT JOIN vulns v ON v.id = i.vuln_id`;

function toCard(r: Row): ItemCard {
  const text = htmlToText(r.summary_html || r.content_html);
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    url: r.url,
    excerpt: truncate(text, 280),
    publishedAt: r.published_at,
    score: r.score,
    severity: r.severity,
    kev: !!r.kev,
    techs: JSON.parse(r.techs) as ItemCard['techs'],
    vulnIds: JSON.parse(r.vuln_ids) as string[],
    vulnId: r.vuln_id,
    cvss: r.cvss_score,
    epss: r.epss,
    read: r.read_at != null,
    starred: r.starred_at != null,
    aiSummary: r.ai_summary || null,
    feed: { id: r.feed_id, title: r.feed_title, category: r.category },
  };
}

export function listItems(db: DB, p: ListParams): { items: ItemCard[]; nextCursor: string | null } {
  const { where, args } = buildWhere(p);
  const c = parseCursor(p.cursor);
  if (c) {
    where.push('(i.published_at < @cts OR (i.published_at = @cts AND i.id < @cid))');
    args.cts = c.ts;
    args.cid = c.id;
  }
  const limit = Math.min(Math.max(p.limit ?? 30, 1), 100);
  args.limit = limit + 1;
  const sqlText = `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY i.published_at DESC, i.id DESC LIMIT @limit`;
  const rows = db.$client.prepare(sqlText).all(args) as Row[];
  const page = rows.slice(0, limit).map(toCard);
  const last = page[page.length - 1];
  return { items: page, nextCursor: rows.length > limit && last ? `${last.publishedAt}:${last.id}` : null };
}

export function getItemCard(db: DB, id: number): ItemCard | null {
  const row = db.$client.prepare(`${SELECT} WHERE i.id = ?`).get(id) as Row | undefined;
  return row ? toCard(row) : null;
}

/**
 * Marque comme lus les items de la vue (et des filtres). Avec `until` (curseur d'un item),
 * seuls les items plus récents ou égaux à cet item sont marqués : « tout marquer comme lu jusqu'ici ».
 */
export function markRead(db: DB, p: Omit<ListParams, 'cursor' | 'limit'> & { until?: string }, now = Date.now()): number {
  const { where, args } = buildWhere(p);
  where.push('i.read_at IS NULL');
  const u = parseCursor(p.until);
  if (u) {
    where.push('(i.published_at > @uts OR (i.published_at = @uts AND i.id >= @uid))');
    args.uts = u.ts;
    args.uid = u.id;
  }
  args.now = now;
  const res = db.$client
    .prepare(`UPDATE items SET read_at = @now WHERE id IN (SELECT i.id FROM items i JOIN feeds f ON f.id = i.feed_id WHERE ${where.join(' AND ')})`)
    .run(args);
  return res.changes;
}

export function unreadCounts(db: DB, threshold: number): Record<View, number> {
  const r = db.$client
    .prepare(
      `SELECT
         sum(i.score >= @t) AS priority,
         sum(f.category = 'security') AS security,
         sum(f.category IN ('tech', 'releases')) AS tech,
         count(*) AS "all"
       FROM items i JOIN feeds f ON f.id = i.feed_id WHERE i.read_at IS NULL`,
    )
    .get({ t: threshold }) as Record<View, number | null>;
  return { priority: r.priority ?? 0, security: r.security ?? 0, tech: r.tech ?? 0, all: r.all ?? 0 };
}
