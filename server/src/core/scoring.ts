import type { Category, MatchLevel, Severity } from '../db/schema';

/**
 * Score de priorité (0–100). Voir SPEC.md §6.
 *
 * Vuln :  sévérité (critique 40 / haute 30 / moyenne 15 / basse 5 / inconnue 10)
 *       + KEV 25
 *       + EPSS (≥ 0,5 → 20 ; ≥ 0,1 → 12 ; ≥ 0,01 → 5)
 *       + watchlist (certain 30 / probable 15)
 *
 * Article : base catégorie (sécurité 20 / releases 15 / tech 10 / actus 5)
 *         + boost du flux + watchlist (certain 25 / probable 10)
 *         et au moins (meilleure vuln mentionnée − 10).
 */
export const SEVERITY_POINTS: Record<Severity, number> = { critical: 40, high: 30, medium: 15, low: 5, unknown: 10 };
export const KEV_POINTS = 25;
export const MATCH_POINTS_VULN: Record<MatchLevel, number> = { certain: 30, probable: 15 };
export const MATCH_POINTS_ITEM: Record<MatchLevel, number> = { certain: 25, probable: 10 };
export const CATEGORY_POINTS: Record<Category, number> = { security: 20, releases: 15, tech: 10, news: 5 };
export const PRIORITY_THRESHOLD = 60;

export function severityFromCvss(score: number | null | undefined): Severity {
  if (score == null || Number.isNaN(score)) return 'unknown';
  if (score >= 9) return 'critical';
  if (score >= 7) return 'high';
  if (score >= 4) return 'medium';
  if (score > 0) return 'low';
  return 'unknown';
}

export function normalizeSeverity(s: string | null | undefined): Severity {
  switch ((s ?? '').toLowerCase()) {
    case 'critical':
    case 'critique':
      return 'critical';
    case 'high':
    case 'important':
    case 'haute':
    case 'élevée':
      return 'high';
    case 'medium':
    case 'moderate':
    case 'moyenne':
      return 'medium';
    case 'low':
    case 'basse':
    case 'faible':
      return 'low';
    default:
      return 'unknown';
  }
}

export function epssPoints(epss: number | null | undefined): number {
  if (epss == null) return 0;
  if (epss >= 0.5) return 20;
  if (epss >= 0.1) return 12;
  if (epss >= 0.01) return 5;
  return 0;
}

export interface VulnScoreInput {
  severity: Severity;
  kev: boolean;
  epss: number | null | undefined;
  matchLevel: MatchLevel | null | undefined;
}

export function scoreVuln(v: VulnScoreInput): number {
  const s =
    SEVERITY_POINTS[v.severity] +
    (v.kev ? KEV_POINTS : 0) +
    epssPoints(v.epss) +
    (v.matchLevel ? MATCH_POINTS_VULN[v.matchLevel] : 0);
  return Math.min(100, Math.max(0, Math.round(s)));
}

export interface ItemScoreInput {
  category: Category;
  boost?: number;
  matchLevel: MatchLevel | null | undefined;
  /** Meilleur score parmi les vulns mentionnées par l'article. */
  bestVulnScore?: number | null;
}

export function scoreItem(i: ItemScoreInput): number {
  const own = CATEGORY_POINTS[i.category] + (i.boost ?? 0) + (i.matchLevel ? MATCH_POINTS_ITEM[i.matchLevel] : 0);
  const fromVuln = i.bestVulnScore != null ? i.bestVulnScore - 10 : 0;
  return Math.min(100, Math.max(0, Math.round(Math.max(own, fromVuln))));
}
