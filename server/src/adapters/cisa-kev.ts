import type { Feed } from '../db/schema';
import { FetchError } from '../lib/safe-fetch';
import type { AdapterResult, FetchContext, RawVuln, SourceAdapter } from './types';

interface KevEntry {
  cveID: string;
  vendorProject: string;
  product: string;
  vulnerabilityName: string;
  dateAdded: string;
  shortDescription: string;
  requiredAction?: string;
  dueDate?: string;
  knownRansomwareCampaignUse?: string;
  notes?: string;
}

interface KevCatalog {
  title?: string;
  catalogVersion?: string;
  vulnerabilities: KevEntry[];
}

/** Seules les entrées ajoutées depuis moins de N jours génèrent une carte dans le fil. */
export const KEV_SURFACE_DAYS = 30;

export function parseKev(catalog: KevCatalog, now: number): RawVuln[] {
  const cutoff = now - KEV_SURFACE_DAYS * 86_400_000;
  return catalog.vulnerabilities
    .filter((v) => /^CVE-\d{4}-\d+$/.test(v.cveID))
    .map((v) => {
      const added = Date.parse(`${v.dateAdded}T00:00:00Z`);
      const notesUrls = (v.notes ?? '').match(/https?:\/\/[^\s;]+/g) ?? [];
      return {
        id: v.cveID,
        title: v.vulnerabilityName,
        description: `${v.vendorProject} ${v.product} : ${v.shortDescription}`,
        kev: true,
        kevAddedAt: v.dateAdded,
        kevDueAt: v.dueDate ?? null,
        kevRansomware: v.knownRansomwareCampaignUse === 'Known',
        references: notesUrls.map((url) => ({ url })),
        publishedAt: Number.isNaN(added) ? null : added,
        sourceUrl: `https://www.cisa.gov/known-exploited-vulnerabilities-catalog?search_api_fulltext=${v.cveID}`,
        sourceTitle: 'CISA KEV',
        surface: !Number.isNaN(added) && added >= cutoff,
      } satisfies RawVuln;
    });
}

export const cisaKevAdapter: SourceAdapter = {
  kind: 'cisa-kev',
  async fetch(feed: Feed, ctx: FetchContext): Promise<AdapterResult> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (feed.etag) headers['if-none-match'] = feed.etag;
    if (feed.lastModified) headers['if-modified-since'] = feed.lastModified;
    const res = await ctx.fetch(feed.url, { headers });
    if (res.status === 304) return { notModified: true, items: [], vulns: [] };
    if (res.status >= 400) throw new FetchError(`HTTP ${res.status}`, res.status);
    const catalog = res.json<KevCatalog>();
    if (!Array.isArray(catalog.vulnerabilities)) throw new FetchError('Catalogue KEV invalide');
    return {
      notModified: false,
      title: 'CISA KEV',
      siteUrl: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog',
      items: [],
      vulns: parseKev(catalog, ctx.now),
      etag: res.headers.get('etag'),
      lastModified: res.headers.get('last-modified'),
    };
  },
};
