import { XMLParser } from 'fast-xml-parser';
import type { Feed } from '../db/schema';
import { decodeEntities } from '../lib/html';
import { FetchError } from '../lib/safe-fetch';
import type { AdapterResult, FetchContext, RawItem, SourceAdapter } from './types';

export interface ParsedFeed {
  format: 'rss' | 'atom' | 'rdf';
  title: string | null;
  siteUrl: string | null;
  items: RawItem[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: false,
  textNodeName: '#text',
  cdataPropName: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  // Les notes de release GitHub contiennent des dizaines de milliers de &lt; : la limite par défaut (10k) casse le parsing.
  // La protection « billion laughs » reste assurée par la profondeur d'expansion bornée et la taille max du corps.
  processEntities: { enabled: true, maxTotalExpansions: 5_000_000, maxExpansionDepth: 5 },
  htmlEntities: true,
  isArray: (name) => ['item', 'entry', 'link', 'category', 'atom:link'].includes(name),
});

type Node = Record<string, unknown> | string | undefined;

function text(n: unknown): string | null {
  if (n == null) return null;
  if (typeof n === 'string') return n.trim() || null;
  if (typeof n === 'number') return String(n);
  if (Array.isArray(n)) return text(n[0]);
  if (typeof n === 'object') {
    const o = n as Record<string, unknown>;
    if ('#text' in o) return text(o['#text']);
  }
  return null;
}

function first<T>(v: T | T[] | undefined): T | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function parseDate(s: string | null | undefined): number | null {
  if (!s) return null;
  let t = Date.parse(s);
  if (Number.isNaN(t)) {
    // Dates RFC 822 avec fuseaux nommés exotiques (« CEST », « UT ») : on tente sans le suffixe.
    const cleaned = s.replace(/\s+(UT|[A-Z]{3,4})$/, ' GMT').replace(/\s+/g, ' ');
    t = Date.parse(cleaned);
  }
  return Number.isNaN(t) ? null : t;
}

function atomLink(links: unknown, rel = 'alternate'): string | null {
  const arr = (Array.isArray(links) ? links : links ? [links] : []) as Record<string, string>[];
  const pick =
    arr.find((l) => (l['@_rel'] ?? 'alternate') === rel && (!l['@_type'] || l['@_type'].includes('html'))) ??
    arr.find((l) => (l['@_rel'] ?? 'alternate') === rel) ??
    (rel === 'alternate' ? arr[0] : undefined);
  return pick?.['@_href'] ?? null;
}

function absolute(u: string | null, base: string | null): string | null {
  if (!u) return null;
  try {
    return new URL(u, base ?? undefined).toString();
  } catch {
    return null;
  }
}

function cleanTitle(t: string | null): string {
  return decodeEntities((t ?? '').replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

function guidIsUrl(g: Record<string, string> | string | undefined): boolean {
  if (!g) return false;
  if (typeof g === 'object' && g['@_isPermaLink'] === 'false') return false;
  return /^https?:\/\//.test(text(g) ?? '');
}

export function parseFeed(xml: string, feedUrl: string | null = null): ParsedFeed {
  let doc: Record<string, Node>;
  try {
    doc = parser.parse(xml) as Record<string, Node>;
  } catch (err) {
    throw new FetchError(`XML invalide : ${(err as Error).message}`);
  }

  // Atom
  const feed = doc.feed as Record<string, unknown> | undefined;
  if (feed && typeof feed === 'object') {
    const siteUrl = absolute(atomLink(feed.link), feedUrl);
    const entries = (feed.entry as Record<string, unknown>[] | undefined) ?? [];
    const isRelease = /\/releases\.atom$/.test(feedUrl ?? '');
    return {
      format: 'atom',
      title: cleanTitle(text(feed.title)) || null,
      siteUrl,
      items: entries.map((e) => {
        const url = absolute(atomLink(e.link), siteUrl ?? feedUrl);
        const content = text(e.content);
        const summary = text(e.summary);
        const author = first(e.author as Record<string, unknown> | Record<string, unknown>[] | undefined);
        return {
          guid: text(e.id) ?? url ?? cleanTitle(text(e.title)),
          url,
          title: cleanTitle(text(e.title)) || '(sans titre)',
          summaryHtml: summary ?? null,
          contentHtml: content ?? null,
          author: author ? text(author.name) : null,
          publishedAt: parseDate(text(e.published) ?? text(e.updated)),
          kind: isRelease ? 'release' : 'article',
        } satisfies RawItem;
      }),
    };
  }

  // RSS 2.0 / RSS 1.0 (RDF)
  const rss = doc.rss as Record<string, unknown> | undefined;
  const rdf = doc['rdf:RDF'] as Record<string, unknown> | undefined;
  const channel = (rss?.channel ?? rdf?.channel) as Record<string, unknown> | undefined;
  if (channel) {
    const rawItems = ((rss ? channel.item : rdf?.item) as Record<string, unknown>[] | undefined) ?? [];
    const siteUrl = absolute(
      text(first(channel.link as unknown[])) ?? atomLink(channel['atom:link']),
      feedUrl,
    );
    return {
      format: rss ? 'rss' : 'rdf',
      title: cleanTitle(text(channel.title)) || null,
      siteUrl,
      items: rawItems.map((it) => {
        const link = absolute(text(first(it.link as unknown[])), siteUrl ?? feedUrl);
        const guidNode = it.guid as Record<string, string> | string | undefined;
        const guid = text(guidNode) ?? link ?? cleanTitle(text(it.title));
        const content = text(it['content:encoded']);
        const description = text(it.description);
        return {
          guid,
          url: link ?? (guidIsUrl(guidNode) ? absolute(text(guidNode), siteUrl) : null),
          title: cleanTitle(text(it.title)) || cleanTitle(description).slice(0, 120) || '(sans titre)',
          summaryHtml: description,
          contentHtml: content,
          author: text(it['dc:creator']) ?? text(it.author),
          publishedAt: parseDate(text(it.pubDate) ?? text(it['dc:date']) ?? text(it.published)),
          kind: 'article',
        } satisfies RawItem;
      }),
    };
  }

  throw new FetchError('Ni RSS ni Atom reconnu');
}

export function looksLikeFeed(body: string, contentType: string | null): boolean {
  if (contentType && /(rss|atom|rdf)\+xml/i.test(contentType)) return true;
  const head = body.slice(0, 2048).replace(/^\uFEFF/, '').trimStart();
  return /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<\?xml-stylesheet[^>]*>\s*)*<(rss|feed|rdf:RDF)[\s>]/i.test(head);
}

export const rssAdapter: SourceAdapter = {
  kind: 'rss',
  async fetch(feed: Feed, ctx: FetchContext): Promise<AdapterResult> {
    const headers: Record<string, string> = {};
    if (feed.etag) headers['if-none-match'] = feed.etag;
    if (feed.lastModified) headers['if-modified-since'] = feed.lastModified;
    const res = await ctx.fetch(feed.url, { headers });
    if (res.status === 304) return { notModified: true, items: [], vulns: [] };
    if (res.status >= 400) throw new FetchError(`HTTP ${res.status}`, res.status);
    const parsed = parseFeed(res.text(), res.url);
    return {
      notModified: false,
      title: parsed.title,
      siteUrl: parsed.siteUrl,
      items: parsed.items,
      vulns: [],
      etag: res.headers.get('etag'),
      lastModified: res.headers.get('last-modified'),
    };
  },
};
