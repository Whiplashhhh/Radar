import { FetchError, type SafeFetchOptions, type SafeResponse } from '../lib/safe-fetch';

export const EPSS_API = 'https://api.first.org/data/v1/epss';

export interface EpssScore {
  cve: string;
  epss: number;
  percentile: number;
}

export function parseEpss(json: { data?: { cve: string; epss: string | number; percentile: string | number }[] }): EpssScore[] {
  return (json.data ?? [])
    .map((d) => ({ cve: d.cve, epss: Number(d.epss), percentile: Number(d.percentile) }))
    .filter((d) => Number.isFinite(d.epss));
}

export async function fetchEpss(
  cves: string[],
  fetcher: (url: string, opts?: SafeFetchOptions) => Promise<SafeResponse>,
): Promise<EpssScore[]> {
  if (!cves.length) return [];
  const res = await fetcher(`${EPSS_API}?cve=${cves.map(encodeURIComponent).join(',')}`, {
    headers: { accept: 'application/json' },
  });
  if (res.status >= 400) throw new FetchError(`EPSS HTTP ${res.status}`, res.status);
  return parseEpss(res.json());
}
