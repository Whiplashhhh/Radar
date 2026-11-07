import { Parser } from 'htmlparser2';

export interface DiscoveredFeed {
  url: string;
  title: string | null;
  type: 'rss' | 'atom' | 'json' | 'unknown';
}

/** Cherche les `<link rel="alternate">` de flux dans une page HTML. */
export function discoverFeeds(html: string, baseUrl: string): DiscoveredFeed[] {
  const found: DiscoveredFeed[] = [];
  let base = baseUrl;
  const parser = new Parser({
    onopentag(name, attrs) {
      if (name === 'base' && attrs.href) {
        try {
          base = new URL(attrs.href, baseUrl).toString();
        } catch {
          /* ignore */
        }
      }
      if (name !== 'link') return;
      const rel = (attrs.rel ?? '').toLowerCase().split(/\s+/);
      const type = (attrs.type ?? '').toLowerCase();
      if (!rel.includes('alternate') || !attrs.href) return;
      const kind = type.includes('rss') ? 'rss' : type.includes('atom') ? 'atom' : type.includes('feed+json') ? 'json' : null;
      if (!kind) return;
      try {
        found.push({ url: new URL(attrs.href, base).toString(), title: attrs.title ?? null, type: kind });
      } catch {
        /* URL invalide */
      }
    },
  });
  parser.write(html.slice(0, 500_000));
  parser.end();
  const seen = new Set<string>();
  return found.filter((f) => !seen.has(f.url) && seen.add(f.url) && !/comments?\/feed/i.test(f.url));
}

/** Chemins classiques à tenter si la page ne déclare aucun flux. */
export const COMMON_FEED_PATHS = ['/feed', '/rss', '/feed.xml', '/rss.xml', '/atom.xml', '/index.xml', '/feed/'];
