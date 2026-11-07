import type { AdapterKind, Category, FeedOptions } from '../db/schema';

export interface SeedFeed {
  title: string;
  url: string;
  siteUrl?: string;
  category: Category;
  adapter?: AdapterKind;
  pollIntervalMin?: number;
  options?: FeedOptions;
}

const gh = (repo: string, title: string): SeedFeed => ({
  title,
  url: `https://github.com/${repo}/releases.atom`,
  siteUrl: `https://github.com/${repo}/releases`,
  category: 'releases',
  pollIntervalMin: 180,
});

/**
 * Flux par défaut. Voir DECISIONS.md pour l'état de vérification de chaque URL.
 * `{HN_POINTS}` est remplacé par le seuil configuré (Réglages → Flux).
 */
export const SEED_FEEDS: SeedFeed[] = [
  // Sécurité
  { title: 'CERT-FR · Alertes', url: 'https://www.cert.ssi.gouv.fr/alerte/feed/', siteUrl: 'https://www.cert.ssi.gouv.fr/alerte/', category: 'security', pollIntervalMin: 15, options: { boost: 50, notify: 'immediate' } },
  { title: 'CERT-FR · Avis', url: 'https://www.cert.ssi.gouv.fr/avis/feed/', siteUrl: 'https://www.cert.ssi.gouv.fr/avis/', category: 'security', pollIntervalMin: 30 },
  { title: 'CISA KEV', url: 'https://raw.githubusercontent.com/cisagov/kev-data/main/known_exploited_vulnerabilities.json', siteUrl: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog', category: 'security', adapter: 'cisa-kev', pollIntervalMin: 60 },
  { title: 'GitHub Security Advisories', url: 'https://api.github.com/advisories', siteUrl: 'https://github.com/advisories', category: 'security', adapter: 'github-advisories', pollIntervalMin: 60, options: { ecosystems: ['maven', 'npm', 'pip', 'pub'] } },
  { title: 'BleepingComputer', url: 'https://www.bleepingcomputer.com/feed/', siteUrl: 'https://www.bleepingcomputer.com/', category: 'security' },
  { title: 'The Hacker News', url: 'https://feeds.feedburner.com/TheHackersNews', siteUrl: 'https://thehackernews.com/', category: 'security' },
  { title: 'Krebs on Security', url: 'https://krebsonsecurity.com/feed/', siteUrl: 'https://krebsonsecurity.com/', category: 'security', pollIntervalMin: 120 },
  { title: 'Zataz', url: 'https://www.zataz.com/feed/', siteUrl: 'https://www.zataz.com/', category: 'security', pollIntervalMin: 60 },
  // Tech
  { title: 'Hacker News (≥ {HN_POINTS} pts)', url: 'https://hnrss.org/newest?points={HN_POINTS}', siteUrl: 'https://news.ycombinator.com/', category: 'tech' },
  { title: 'LWN.net', url: 'https://lwn.net/headlines/rss', siteUrl: 'https://lwn.net/', category: 'tech', pollIntervalMin: 60 },
  { title: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', siteUrl: 'https://arstechnica.com/', category: 'news' },
  { title: 'Next', url: 'https://next.ink/feed/', siteUrl: 'https://next.ink/', category: 'tech' },
  { title: 'Korben', url: 'https://korben.info/feed', siteUrl: 'https://korben.info/', category: 'news', pollIntervalMin: 60 },
  // Releases
  gh('spring-projects/spring-boot', 'Spring Boot releases'),
  gh('vuejs/core', 'Vue.js releases'),
  gh('react/react', 'React releases'),
  gh('nodejs/node', 'Node.js releases'),
  gh('flutter/flutter', 'Flutter releases'),
  gh('moby/moby', 'Docker (Moby) releases'),
  gh('tailscale/tailscale', 'Tailscale releases'),
  gh('immich-app/immich', 'Immich releases'),
  gh('n8n-io/n8n', 'n8n releases'),
  gh('ollama/ollama', 'Ollama releases'),
  gh('pi-hole/pi-hole', 'Pi-hole releases'),
];

export function hnUrl(points: number): string {
  return `https://hnrss.org/newest?points=${points}`;
}
