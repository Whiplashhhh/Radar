import type { AffectedPackage, MatchLevel } from '../db/schema';

export interface WatchRule {
  id: number;
  name: string;
  /** Mots-clés. Préfixe `=` : sensible à la casse (`=React`). */
  aliases: string[];
  /** `vendor:product` (glob `*` autorisé), comparé aux CPE NVD. */
  cpes: string[];
  /** `ecosystem:package` (glob `*` autorisé), ex. `maven:org.springframework.boot:*`, `npm:vue`. */
  packages: string[];
  /** Mots-clés qui annulent un match « probable ». */
  exclude: string[];
  enabled?: boolean;
}

export interface MatchTarget {
  text: string;
  packages?: AffectedPackage[];
  cpes?: string[];
}

export interface MatchResult {
  watchId: number;
  name: string;
  level: MatchLevel;
  reason: string;
}

const ECOSYSTEM_ALIASES: Record<string, string> = {
  pypi: 'pip',
  python: 'pip',
  'crates.io': 'rust',
  cargo: 'rust',
  packagist: 'composer',
  'github actions': 'actions',
  golang: 'go',
  gem: 'rubygems',
  dart: 'pub',
};

export function normalizeEcosystem(e: string): string {
  const k = e.trim().toLowerCase();
  return ECOSYSTEM_ALIASES[k] ?? k;
}

function globToRegex(glob: string, flags = 'i'): RegExp {
  const esc = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${esc}$`, flags);
}

/**
 * Regex de mot-clé avec frontières de mot Unicode.
 * Un mot-clé n'est pas reconnu s'il est collé à une lettre, un chiffre ou un `_`,
 * ni s'il fait partie d'un composé à tiret (« python-requests », « node-fetch », « pre-react »).
 */
export function keywordRegex(keyword: string): RegExp {
  const caseSensitive = keyword.startsWith('=');
  const kw = (caseSensitive ? keyword.slice(1) : keyword).trim();
  const body = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(
    `(?<![\\p{L}\\p{N}_]|[\\p{L}\\p{N}]-)${body}(?![\\p{L}\\p{N}_]|-[\\p{L}\\p{N}])`,
    caseSensitive ? 'u' : 'iu',
  );
}

const regexCache = new Map<string, RegExp>();
function kwTest(keyword: string, text: string): boolean {
  let re = regexCache.get(keyword);
  if (!re) {
    re = keywordRegex(keyword);
    regexCache.set(keyword, re);
  }
  return re.test(text);
}

function parseCpe(cpe: string): { vendor: string; product: string } | null {
  // cpe:2.3:a:vendor:product:version:...  ou  cpe:/a:vendor:product
  const p = cpe.startsWith('cpe:2.3:') ? cpe.split(':').slice(3, 5) : cpe.replace(/^cpe:\/[aho]:/, '').split(':').slice(0, 2);
  const [vendor, product] = p;
  return vendor && product ? { vendor: vendor.toLowerCase(), product: product.toLowerCase() } : null;
}

export function matchWatch(rule: WatchRule, target: MatchTarget): MatchResult | null {
  // 1. Package (identifiant structuré) → certain
  for (const pattern of rule.packages) {
    const idx = pattern.indexOf(':');
    if (idx <= 0) continue;
    const eco = normalizeEcosystem(pattern.slice(0, idx));
    const re = globToRegex(pattern.slice(idx + 1));
    const hit = target.packages?.find((p) => normalizeEcosystem(p.ecosystem) === eco && re.test(p.package));
    if (hit) return { watchId: rule.id, name: rule.name, level: 'certain', reason: `package ${eco}:${hit.package}` };
  }

  // 2. CPE vendor:product → certain
  for (const pattern of rule.cpes) {
    const [v, p] = pattern.toLowerCase().split(':');
    if (!v || !p) continue;
    const vr = globToRegex(v);
    const pr = globToRegex(p);
    const hit = target.cpes?.map(parseCpe).find((c) => c && vr.test(c.vendor) && pr.test(c.product));
    if (hit) return { watchId: rule.id, name: rule.name, level: 'certain', reason: `CPE ${hit.vendor}:${hit.product}` };
  }

  // 3. Mots-clés → probable (annulé par un mot d'exclusion)
  const keywords = rule.aliases.length ? rule.aliases : [rule.name];
  const kw = keywords.find((k) => k.trim() && kwTest(k, target.text));
  if (kw) {
    const ex = rule.exclude.find((e) => e.trim() && kwTest(e, target.text));
    if (ex) return null;
    return { watchId: rule.id, name: rule.name, level: 'probable', reason: `mot-clé « ${kw.replace(/^=/, '')} »` };
  }
  return null;
}

export function matchAll(rules: WatchRule[], target: MatchTarget): MatchResult[] {
  return rules.filter((r) => r.enabled !== false).flatMap((r) => matchWatch(r, target) ?? []);
}

export function bestLevel(results: MatchResult[]): MatchLevel | null {
  if (results.some((r) => r.level === 'certain')) return 'certain';
  return results.length ? 'probable' : null;
}
