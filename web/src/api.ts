export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'unknown';
export type Category = 'security' | 'tech' | 'news' | 'releases';
export type View = 'priority' | 'security' | 'tech' | 'all';
export type MatchLevel = 'certain' | 'probable';

export interface Tech {
  name: string;
  level: MatchLevel;
}

export interface ItemCard {
  id: number;
  kind: 'article' | 'vuln' | 'release';
  title: string;
  url: string | null;
  excerpt: string;
  publishedAt: number;
  score: number;
  severity: Severity | null;
  kev: boolean;
  techs: Tech[];
  vulnIds: string[];
  vulnId: string | null;
  cvss: number | null;
  epss: number | null;
  read: boolean;
  starred: boolean;
  aiSummary: string | null;
  feed: { id: number; title: string; category: Category };
}

export interface ItemDetail extends ItemCard {
  author: string | null;
  contentHtml: string | null;
  summaryHtml: string | null;
  readableHtml: string | null;
  readableTried: boolean;
  siteUrl: string | null;
  vulns: { id: string; title: string | null; severity: Severity; cvss: number | null; kev: number; epss: number | null; score: number }[];
}

export interface VulnDetail {
  id: string;
  aliases: string[];
  title: string | null;
  description: string | null;
  cvssScore: number | null;
  cvssVector: string | null;
  cvssVersion: string | null;
  severity: Severity;
  epss: number | null;
  epssPercentile: number | null;
  kev: boolean;
  kevAddedAt: string | null;
  kevDueAt: string | null;
  kevRansomware: boolean;
  affected: { ecosystem: string; package: string; vulnerable?: string | null; patched?: string | null }[];
  references: { url: string; title?: string }[];
  publishedAt: number | null;
  score: number;
  matchLevel: MatchLevel | null;
  aiSummary: string | null;
  firstSeenAt: number;
  techs: { id: number; name: string; level: MatchLevel; reason: string }[];
  sources: { url: string; title: string | null; sourceName: string | null; itemId: number | null; seenAt: number }[];
  itemId: number | null;
  read: boolean;
  starred: boolean;
  nvdUrl: string | null;
  ghsaUrl: string | null;
}

export interface Feed {
  id: number;
  url: string;
  title: string;
  siteUrl: string | null;
  category: Category;
  adapter: 'rss' | 'cisa-kev' | 'github-advisories';
  options: { boost?: number; notify?: 'immediate' | 'default'; ecosystems?: string[] };
  pollIntervalMin: number;
  enabled: boolean;
  lastFetchAt: number | null;
  lastSuccessAt: number | null;
  nextFetchAt: number;
  errorCount: number;
  lastError: string | null;
  itemCount: number;
  status: 'ok' | 'warning' | 'error' | 'pending' | 'disabled';
}

export interface WatchEntry {
  id: number;
  name: string;
  aliases: string[];
  cpes: string[];
  packages: string[];
  exclude: string[];
  enabled: boolean;
  matchCount: number;
}

export interface Settings {
  notifications: {
    enabled: boolean;
    immediateRequireCertain: boolean;
    immediateCvssMin: number;
    immediateOnKev: boolean;
    immediateEpssMin: number;
    certFrAlerts: boolean;
    groupWindowSec: number;
    minIntervalSec: number;
  };
  digest: { enabled: boolean; time: string; topNews: number; includeMedium: boolean };
  briefing: { enabled: boolean; maxItems: number };
  quietHours: { enabled: boolean; start: string; end: string };
  feed: { priorityThreshold: number; hnMinPoints: number };
  retention: { days: number };
}

export interface Stats {
  unread: Record<View, number>;
  priorityThreshold: number;
  pushDevices: number;
  briefingUnread: number;
  ollama: boolean;
  timezone: string;
  version: string;
}

export interface BriefingSection {
  category: Category;
  label: string;
  items: { id: number; title: string; source: string; score: number; techs: string[] }[];
}

export interface Briefing {
  id: number;
  createdAt: number;
  periodStart: number;
  periodEnd: number;
  itemCount: number;
  summary: string;
  sections?: BriefingSection[];
  model: string | null;
  error: string | null;
  readAt: number | null;
}

export interface OllamaStatus {
  configured: boolean;
  reachable: boolean;
  model: string;
  modelAvailable: boolean;
  models: string[];
  error?: string;
}

export interface Filters {
  q?: string;
  feed?: number;
  tech?: string;
  severity?: Severity[];
  unread?: boolean;
  starred?: boolean;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const init: RequestInit = { method, headers: { accept: 'application/json', ...headers } };
  if (body !== undefined) {
    if (typeof body === 'string') init.body = body;
    else {
      init.body = JSON.stringify(body);
      (init.headers as Record<string, string>)['content-type'] = 'application/json';
    }
  }
  const res = await fetch(url, init);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) throw new ApiError((data as { error?: string } | undefined)?.error ?? `Erreur ${res.status}`, res.status);
  return data as T;
}

export function filtersToParams(view: View, f: Filters, extra: Record<string, string | undefined> = {}): URLSearchParams {
  const p = new URLSearchParams({ view });
  if (f.q) p.set('q', f.q);
  if (f.feed) p.set('feed', String(f.feed));
  if (f.tech) p.set('tech', f.tech);
  if (f.severity?.length) p.set('severity', f.severity.join(','));
  if (f.unread) p.set('unread', '1');
  if (f.starred) p.set('starred', '1');
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  return p;
}

export const api = {
  items: (view: View, f: Filters, cursor?: string) =>
    request<{ items: ItemCard[]; nextCursor: string | null }>('GET', `/api/items?${filtersToParams(view, f, { cursor, limit: '30' })}`),
  item: (id: number, readable = true) => request<ItemDetail>('GET', `/api/items/${id}${readable ? '?readable=1' : ''}`),
  patchItem: (id: number, patch: { read?: boolean; starred?: boolean }) => request<ItemCard>('PATCH', `/api/items/${id}`, patch),
  markRead: (view: View, f: Filters, until?: string) =>
    request<{ marked: number }>('POST', '/api/items/mark-read', { view, ...f, severity: f.severity?.join(','), until }),
  vuln: (id: string) => request<VulnDetail>('GET', `/api/vulns/${encodeURIComponent(id)}`),
  stats: () => request<Stats>('GET', '/api/stats'),
  refresh: () => request<{ triggered: number; done: number | null; newItems: number | null }>('POST', '/api/refresh', {}),
  feeds: () => request<Feed[]>('GET', '/api/feeds'),
  addFeed: (b: { url: string; category?: Category; title?: string }) => request<Feed>('POST', '/api/feeds', b),
  patchFeed: (id: number, b: Partial<Pick<Feed, 'title' | 'category' | 'pollIntervalMin' | 'enabled' | 'options'>>) => request<Feed>('PATCH', `/api/feeds/${id}`, b),
  deleteFeed: (id: number) => request<void>('DELETE', `/api/feeds/${id}`),
  refreshFeed: (id: number) => request<{ ok: boolean; error?: string; newItems?: number; feed: Feed }>('POST', `/api/feeds/${id}/refresh`, {}),
  importOpml: (xml: string) => request<{ added: number; skipped: number; total: number }>('POST', '/api/opml', xml, { 'content-type': 'text/xml' }),
  watchlist: () => request<WatchEntry[]>('GET', '/api/watchlist'),
  addWatch: (b: Omit<WatchEntry, 'id' | 'matchCount'>) => request<WatchEntry>('POST', '/api/watchlist', b),
  patchWatch: (id: number, b: Partial<Omit<WatchEntry, 'id' | 'matchCount'>>) => request<WatchEntry>('PATCH', `/api/watchlist/${id}`, b),
  deleteWatch: (id: number) => request<void>('DELETE', `/api/watchlist/${id}`),
  settings: () => request<Settings>('GET', '/api/settings'),
  putSettings: (patch: unknown) => request<Settings>('PUT', '/api/settings', patch),
  pushKey: () => request<{ publicKey: string }>('GET', '/api/push/key'),
  subscribe: (subscription: PushSubscriptionJSON) => request<{ ok: boolean; devices: number }>('POST', '/api/push/subscribe', { subscription }),
  unsubscribe: (endpoint: string) => request<{ ok: boolean; devices: number }>('POST', '/api/push/unsubscribe', { endpoint }),
  testPush: (endpoint?: string) => request<{ sent: number; removed: number; failed: number }>('POST', '/api/push/test', endpoint ? { endpoint } : {}),
  briefings: () => request<Briefing[]>('GET', '/api/briefings'),
  briefing: (id: number | 'latest') => request<Briefing>('GET', `/api/briefings/${id}`),
  readBriefing: (id: number) => request<{ ok: boolean }>('POST', `/api/briefings/${id}/read`, {}),
  generateBriefing: () => request<{ created: boolean; briefing: Briefing | null }>('POST', '/api/briefings/generate', {}),
  ollama: () => request<OllamaStatus>('GET', '/api/ollama/status'),
};
