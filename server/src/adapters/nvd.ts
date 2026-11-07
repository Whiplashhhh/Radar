import type { Severity, VulnReference } from '../db/schema';
import { FetchError, type SafeFetchOptions, type SafeResponse } from '../lib/safe-fetch';
import { normalizeSeverity, severityFromCvss } from '../core/scoring';

export const NVD_API = 'https://services.nvd.nist.gov/rest/json/cves/2.0';

interface CvssMetric {
  type?: string;
  cvssData: { baseScore: number; baseSeverity?: string; vectorString: string; version: string };
  baseSeverity?: string;
}

interface NvdCve {
  id: string;
  published?: string;
  descriptions?: { lang: string; value: string }[];
  metrics?: Record<string, CvssMetric[] | undefined>;
  configurations?: { nodes: { cpeMatch?: { vulnerable: boolean; criteria: string; versionStartIncluding?: string; versionStartExcluding?: string; versionEndIncluding?: string; versionEndExcluding?: string }[] }[] }[];
  references?: { url: string; source?: string; tags?: string[] }[];
}

export interface NvdData {
  id: string;
  description: string | null;
  cvssScore: number | null;
  cvssVector: string | null;
  cvssVersion: string | null;
  severity: Severity;
  cpes: string[];
  /** Plages de versions issues des configurations CPE (« openssh < 9.8p1 »). */
  ranges: { cpe: string; range: string }[];
  references: VulnReference[];
  publishedAt: number | null;
}

const METRIC_ORDER = ['cvssMetricV31', 'cvssMetricV30', 'cvssMetricV40', 'cvssMetricV2'];

export function parseNvd(json: { vulnerabilities?: { cve: NvdCve }[] }): NvdData | null {
  const cve = json.vulnerabilities?.[0]?.cve;
  if (!cve) return null;
  let metric: CvssMetric | undefined;
  for (const k of METRIC_ORDER) {
    const list = cve.metrics?.[k];
    metric = list?.find((m) => m.type === 'Primary') ?? list?.[0];
    if (metric) break;
  }
  const score = metric?.cvssData.baseScore ?? null;
  const sev = normalizeSeverity(metric?.cvssData.baseSeverity ?? metric?.baseSeverity);
  const cpes = new Set<string>();
  const ranges: { cpe: string; range: string }[] = [];
  for (const conf of cve.configurations ?? []) {
    for (const node of conf.nodes) {
      for (const m of node.cpeMatch ?? []) {
        if (!m.vulnerable) continue;
        cpes.add(m.criteria);
        const parts = [
          m.versionStartIncluding && `≥ ${m.versionStartIncluding}`,
          m.versionStartExcluding && `> ${m.versionStartExcluding}`,
          m.versionEndIncluding && `≤ ${m.versionEndIncluding}`,
          m.versionEndExcluding && `< ${m.versionEndExcluding}`,
        ].filter(Boolean);
        const version = m.criteria.split(':')[5];
        const range = parts.length ? parts.join(', ') : version && version !== '*' && version !== '-' ? `= ${version}` : '';
        if (range && ranges.length < 30) ranges.push({ cpe: m.criteria, range });
      }
    }
  }
  const published = cve.published ? Date.parse(`${cve.published}Z`) : NaN;
  return {
    id: cve.id,
    description: cve.descriptions?.find((d) => d.lang === 'en')?.value ?? null,
    cvssScore: score,
    cvssVector: metric?.cvssData.vectorString ?? null,
    cvssVersion: metric?.cvssData.version ?? null,
    severity: sev !== 'unknown' ? sev : severityFromCvss(score),
    cpes: [...cpes].slice(0, 200),
    ranges,
    references: (cve.references ?? []).slice(0, 20).map((r) => ({ url: r.url, title: r.tags?.join(', ') || undefined })),
    publishedAt: Number.isNaN(published) ? null : published,
  };
}

export async function fetchNvd(
  cveId: string,
  fetcher: (url: string, opts?: SafeFetchOptions) => Promise<SafeResponse>,
  apiKey?: string,
): Promise<NvdData | null> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (apiKey) headers.apiKey = apiKey;
  const res = await fetcher(`${NVD_API}?cveId=${encodeURIComponent(cveId)}`, { headers });
  if (res.status === 404) return null;
  if (res.status >= 400) throw new FetchError(`NVD HTTP ${res.status}`, res.status);
  return parseNvd(res.json());
}

/** Limiteur à fenêtre glissante : NVD autorise 5 requêtes / 30 s sans clé, 50 avec. */
export class RateLimiter {
  private stamps: number[] = [];
  constructor(
    readonly max: number,
    readonly windowMs: number,
    private readonly clock: () => number = Date.now,
  ) {}

  /** Délai (ms) à attendre avant la prochaine requête ; 0 si possible tout de suite. */
  delay(): number {
    const now = this.clock();
    this.stamps = this.stamps.filter((t) => now - t < this.windowMs);
    if (this.stamps.length < this.max) return 0;
    return this.windowMs - (now - (this.stamps[0] ?? now)) + 50;
  }

  take(): boolean {
    if (this.delay() > 0) return false;
    this.stamps.push(this.clock());
    return true;
  }
}
