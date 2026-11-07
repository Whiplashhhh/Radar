import type { AffectedPackage, Feed, Severity, VulnReference } from '../db/schema';
import type { SafeFetchOptions, SafeResponse } from '../lib/safe-fetch';

export interface RawItem {
  guid: string;
  url?: string | null;
  title: string;
  summaryHtml?: string | null;
  contentHtml?: string | null;
  author?: string | null;
  publishedAt?: number | null;
  kind?: 'article' | 'release' | 'vuln';
  /** Lien vers une vuln produite par le même adaptateur (cartes KEV/GHSA). */
  vulnId?: string;
}

export interface RawVuln {
  /** Identifiant principal (CVE si connu, sinon GHSA). */
  id: string;
  aliases?: string[];
  title?: string | null;
  description?: string | null;
  cvssScore?: number | null;
  cvssVector?: string | null;
  cvssVersion?: string | null;
  severity?: Severity | null;
  epss?: number | null;
  epssPercentile?: number | null;
  kev?: boolean;
  kevAddedAt?: string | null;
  kevDueAt?: string | null;
  kevRansomware?: boolean;
  affected?: AffectedPackage[];
  cpes?: string[];
  references?: VulnReference[];
  publishedAt?: number | null;
  /** Mention : URL et titre de la source. */
  sourceUrl: string;
  sourceTitle?: string | null;
  /**
   * Créer une carte dans le fil : `true` toujours, `'relevant'` seulement si la vuln matche
   * la watchlist ou est critique, `false` jamais (sert uniquement à l'enrichissement).
   */
  surface?: boolean | 'relevant';
}

export interface FetchContext {
  fetch: (url: string, opts?: SafeFetchOptions) => Promise<SafeResponse>;
  githubToken?: string;
  now: number;
}

export interface AdapterResult {
  notModified: boolean;
  title?: string | null;
  siteUrl?: string | null;
  items: RawItem[];
  vulns: RawVuln[];
  etag?: string | null;
  lastModified?: string | null;
}

export interface SourceAdapter {
  kind: Feed['adapter'];
  fetch(feed: Feed, ctx: FetchContext): Promise<AdapterResult>;
}
