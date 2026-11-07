import type { Feed } from '../db/schema';
import { FetchError } from '../lib/safe-fetch';
import { normalizeSeverity, severityFromCvss } from '../core/scoring';
import type { AdapterResult, FetchContext, RawVuln, SourceAdapter } from './types';

interface Ghsa {
  ghsa_id: string;
  cve_id: string | null;
  html_url: string;
  summary: string;
  description: string | null;
  severity: string;
  identifiers?: { type: string; value: string }[];
  references?: string[];
  published_at: string;
  withdrawn_at?: string | null;
  vulnerabilities?: {
    package: { ecosystem: string; name: string };
    vulnerable_version_range: string | null;
    first_patched_version: string | { identifier: string } | null;
  }[];
  cvss?: { vector_string: string | null; score: number | null } | null;
  cvss_severities?: {
    cvss_v3?: { vector_string: string | null; score: number | null } | null;
    cvss_v4?: { vector_string: string | null; score: number | null } | null;
  } | null;
  epss?: { percentage: number | null; percentile: number | null } | null;
}

export const GHSA_API = 'https://api.github.com/advisories';
export const GHSA_SURFACE_DAYS = 14;

export function parseGhsa(list: Ghsa[], now: number): RawVuln[] {
  const cutoff = now - GHSA_SURFACE_DAYS * 86_400_000;
  return list
    .filter((a) => !a.withdrawn_at)
    .map((a) => {
      const v3 = a.cvss_severities?.cvss_v3;
      const v4 = a.cvss_severities?.cvss_v4;
      const cvss = v3?.score ? v3 : v4?.score ? v4 : a.cvss?.score ? a.cvss : null;
      const version = cvss?.vector_string?.match(/^CVSS:(\d\.\d)/)?.[1] ?? null;
      const ids = new Set<string>([a.ghsa_id, ...(a.cve_id ? [a.cve_id] : [])]);
      for (const i of a.identifiers ?? []) ids.add(i.type === 'GHSA' ? i.value.toLowerCase().replace(/^ghsa/, 'GHSA') : i.value);
      const published = Date.parse(a.published_at);
      const severity = normalizeSeverity(a.severity);
      return {
        id: a.cve_id ?? a.ghsa_id,
        aliases: [...ids],
        title: a.summary,
        description: a.description,
        cvssScore: cvss?.score ?? null,
        cvssVector: cvss?.vector_string ?? null,
        cvssVersion: version,
        severity: severity !== 'unknown' ? severity : severityFromCvss(cvss?.score),
        epss: a.epss?.percentage ?? null,
        epssPercentile: a.epss?.percentile ?? null,
        affected: (a.vulnerabilities ?? []).map((v) => ({
          ecosystem: v.package.ecosystem,
          package: v.package.name,
          vulnerable: v.vulnerable_version_range,
          patched: typeof v.first_patched_version === 'string' ? v.first_patched_version : (v.first_patched_version?.identifier ?? null),
        })),
        references: (a.references ?? []).slice(0, 15).map((url) => ({ url })),
        publishedAt: Number.isNaN(published) ? null : published,
        sourceUrl: a.html_url,
        sourceTitle: 'GitHub Advisory Database',
        surface: !Number.isNaN(published) && published >= cutoff ? 'relevant' : false,
      } satisfies RawVuln;
    });
}

/** Une requête par écosystème ; l'ETag de chaque requête est mémorisé dans `feed.etag` (JSON). */
export const githubAdvisoriesAdapter: SourceAdapter = {
  kind: 'github-advisories',
  async fetch(feed: Feed, ctx: FetchContext): Promise<AdapterResult> {
    const ecosystems = feed.options.ecosystems?.length ? feed.options.ecosystems : [''];
    let etags: Record<string, string>;
    try {
      etags = feed.etag ? (JSON.parse(feed.etag) as Record<string, string>) : {};
    } catch {
      etags = {};
    }
    const vulns: RawVuln[] = [];
    let allNotModified = true;
    for (const eco of ecosystems) {
      const url = new URL(feed.url || GHSA_API);
      url.searchParams.set('type', 'reviewed');
      url.searchParams.set('per_page', '100');
      url.searchParams.set('sort', 'published');
      url.searchParams.set('direction', 'desc');
      if (eco) url.searchParams.set('ecosystem', eco);
      const headers: Record<string, string> = {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      };
      if (ctx.githubToken) headers.authorization = `Bearer ${ctx.githubToken}`;
      const key = eco || '*';
      if (etags[key]) headers['if-none-match'] = etags[key];
      const res = await ctx.fetch(url.toString(), { headers });
      if (res.status === 304) continue;
      if (res.status >= 400) throw new FetchError(`HTTP ${res.status} (${key})`, res.status);
      allNotModified = false;
      const etag = res.headers.get('etag');
      if (etag) etags[key] = etag;
      vulns.push(...parseGhsa(res.json<Ghsa[]>(), ctx.now));
    }
    return {
      notModified: allNotModified,
      title: feed.title,
      siteUrl: 'https://github.com/advisories',
      items: [],
      vulns,
      etag: JSON.stringify(etags),
      lastModified: null,
    };
  },
};
