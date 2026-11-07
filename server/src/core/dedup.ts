const TRACKING = /^(utm_[a-z]+|fbclid|gclid|mc_[a-z]+|ref|ref_src|cmpid|xtor|at_medium|at_campaign|ncid|sr_share|__twitter_impression)$/i;

/** URL canonique pour la dédup : https, sans www, sans fragment, sans paramètres de tracking, sans « / » final. */
export function canonicalUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    u.protocol = 'https:';
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    const keep = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
    u.search = '';
    for (const [k, v] of keep) u.searchParams.append(k, v);
    let s = u.toString();
    if (s.endsWith('/') && u.pathname !== '/') s = s.slice(0, -1);
    return s.replace(/\/\?/, '?');
  } catch {
    return null;
  }
}

/** Clé de titre : minuscules, sans accents ni ponctuation, espaces normalisés. Vide si trop courte pour être fiable. */
export function titleKey(title: string): string | null {
  const k = title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return k.split(' ').length >= 4 && k.length >= 20 ? k : null;
}
