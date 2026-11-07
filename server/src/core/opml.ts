import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import type { Category } from '../db/schema';

export interface OpmlFeed {
  url: string;
  title: string;
  siteUrl?: string | null;
  category?: Category | null;
}

const CATEGORY_LABELS: Record<Category, string> = { security: 'Sécurité', tech: 'Tech', news: 'Actus', releases: 'Releases' };

export function categoryFromLabel(label: string | null | undefined): Category | null {
  if (!label) return null;
  const l = label.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
  if (/secu|vuln|cve|cert/.test(l)) return 'security';
  if (/release|version/.test(l)) return 'releases';
  if (/actu|news|general/.test(l)) return 'news';
  if (/tech|dev|prog/.test(l)) return 'tech';
  return null;
}

export function parseOpml(xml: string): OpmlFeed[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', isArray: (n) => n === 'outline' });
  const doc = parser.parse(xml) as { opml?: { body?: { outline?: unknown[] } } };
  const out: OpmlFeed[] = [];
  const walk = (nodes: unknown[] | undefined, parentLabel: string | null) => {
    for (const n of nodes ?? []) {
      const o = n as Record<string, unknown> & { outline?: unknown[] };
      const label = (o.title ?? o.text ?? null) as string | null;
      const xmlUrl = o.xmlUrl as string | undefined;
      if (xmlUrl) {
        out.push({
          url: xmlUrl,
          title: label ?? xmlUrl,
          siteUrl: (o.htmlUrl as string | undefined) ?? null,
          category: categoryFromLabel((o.category as string | undefined) ?? parentLabel),
        });
      }
      if (o.outline) walk(o.outline, label ?? parentLabel);
    }
  };
  walk(doc.opml?.body?.outline, null);
  const seen = new Set<string>();
  return out.filter((f) => !seen.has(f.url) && seen.add(f.url));
}

export function buildOpml(feeds: OpmlFeed[], title = 'Radar'): string {
  const groups = new Map<string, OpmlFeed[]>();
  for (const f of feeds) {
    const label = CATEGORY_LABELS[f.category ?? 'news'];
    groups.set(label, [...(groups.get(label) ?? []), f]);
  }
  const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@_', format: true, suppressEmptyNode: true });
  const body = {
    '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
    opml: {
      '@_version': '2.0',
      head: { title, dateCreated: new Date().toUTCString() },
      body: {
        outline: [...groups].map(([label, list]) => ({
          '@_text': label,
          '@_title': label,
          outline: list.map((f) => ({
            '@_type': 'rss',
            '@_text': f.title,
            '@_title': f.title,
            '@_xmlUrl': f.url,
            ...(f.siteUrl ? { '@_htmlUrl': f.siteUrl } : {}),
            '@_category': label,
          })),
        })),
      },
    },
  };
  return builder.build(body) as string;
}
