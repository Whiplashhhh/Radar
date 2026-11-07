import type { Category, Severity } from '../api';

const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto', style: 'short' });
const TZ = 'Europe/Paris';

/** Date relative compacte : « à l’instant », « il y a 5 min », « hier », « 3 nov. ». */
export function relativeTime(ts: number, now = Date.now()): string {
  const diff = Math.round((ts - now) / 1000);
  const abs = Math.abs(diff);
  if (abs < 45) return 'à l’instant';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 7 * 86_400) return rtf.format(Math.round(diff / 86_400), 'day');
  const sameYear = new Date(ts).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) }).format(ts);
}

export function fullDate(ts: number): string {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, dateStyle: 'full', timeStyle: 'short' }).format(ts);
}

export function shortDateTime(ts: number): string {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(ts);
}

export function isoDay(d: string | null): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(Date.parse(`${d}T00:00:00Z`));
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critique',
  high: 'Haute',
  medium: 'Moyenne',
  low: 'Basse',
  unknown: 'Inconnue',
};

export const CATEGORY_LABEL: Record<Category, string> = {
  security: 'Sécurité',
  tech: 'Tech',
  news: 'Actus',
  releases: 'Releases',
};

export function percent(x: number | null | undefined, digits = 1): string {
  if (x == null) return '—';
  const p = x * 100;
  return `${p < 1 && p > 0 ? p.toFixed(2) : p.toFixed(digits)} %`.replace('.', ',');
}

export function cvss(x: number | null | undefined): string {
  return x == null ? '—' : x.toFixed(1).replace('.', ',');
}

export function hostname(url: string | null): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
