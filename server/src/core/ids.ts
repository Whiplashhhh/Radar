const CVE_RE = /\bCVE[-‐‑–]\s?(\d{4})[-‐‑–](\d{4,7})\b/gi;
const GHSA_RE = /\bGHSA(-[23456789cfghjmpqrvwx]{4}){3}\b/gi;

/** Extrait les identifiants CVE (normalisés en majuscules, tirets ASCII) d'un texte. */
export function extractCves(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(CVE_RE)) out.add(`CVE-${m[1]}-${m[2]}`);
  return [...out];
}

export function extractGhsas(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(GHSA_RE)) out.add(`GHSA${m[0].slice(4).toLowerCase()}`);
  return [...out];
}

export function extractVulnIds(text: string): string[] {
  return [...extractCves(text), ...extractGhsas(text)];
}

export const isCve = (id: string): boolean => /^CVE-\d{4}-\d{4,}$/.test(id);
export const isGhsa = (id: string): boolean => /^GHSA(-[a-z0-9]{4}){3}$/.test(id);

/** Choisit l'identifiant canonique d'une vuln : le CVE le plus ancien si présent, sinon le premier GHSA. */
export function canonicalId(ids: string[]): string {
  const cves = ids.filter(isCve).sort(compareCve);
  return cves[0] ?? ids[0] ?? '';
}

export function compareCve(a: string, b: string): number {
  const [, ya = '0', na = '0'] = a.split('-');
  const [, yb = '0', nb = '0'] = b.split('-');
  return Number(ya) - Number(yb) || Number(na) - Number(nb);
}
