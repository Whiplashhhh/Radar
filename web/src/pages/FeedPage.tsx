import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, ChevronRight, CloudOff, Filter, Inbox, RefreshCw, Search, Smartphone, Sparkles, Sunrise, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, type Filters, type ItemCard as Item, type Severity, type View } from '../api';
import { ItemCard } from '../components/ItemCard';
import { EmptyState, IconButton, PageHeader, Spinner, useOnline, useToast } from '../components/ui';
import { useItemActions, useStats } from '../hooks';
import { relativeTime, SEVERITY_LABEL, shortDateTime } from '../lib/format';
import { isIOS, isStandalone } from '../lib/platform';

const TITLES: Record<View, string> = { priority: 'Prioritaire', security: 'Sécurité', tech: 'Tech', all: 'Tout' };
const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];

function readFilters(sp: URLSearchParams): Filters {
  return {
    q: sp.get('q') ?? undefined,
    feed: sp.get('feed') ? Number(sp.get('feed')) : undefined,
    tech: sp.get('tech') ?? undefined,
    severity: (sp.get('severity')?.split(',').filter(Boolean) as Severity[] | undefined) ?? undefined,
    unread: sp.get('unread') === '1' || undefined,
    starred: sp.get('starred') === '1' || undefined,
  };
}

export function FeedPage({ view }: { view: View }) {
  const [sp, setSp] = useSearchParams();
  const filters = useMemo(() => readFilters(sp), [sp]);
  const [searchOpen, setSearchOpen] = useState(!!filters.q);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const online = useOnline();
  const { setRead, setStarred } = useItemActions();
  const stats = useStats();

  const query = useInfiniteQuery({
    queryKey: ['items', view, filters],
    queryFn: ({ pageParam }) => api.items(view, filters, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 30_000,
  });
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);

  const setFilter = useCallback(
    (patch: Partial<Record<'q' | 'feed' | 'tech' | 'severity' | 'unread' | 'starred', string | undefined>>) => {
      const next = new URLSearchParams(sp);
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      setSp(next, { replace: true });
    },
    [sp, setSp],
  );

  const refresh = useCallback(async () => {
    try {
      const r = await api.refresh();
      await qc.invalidateQueries({ queryKey: ['items'] });
      await qc.invalidateQueries({ queryKey: ['stats'] });
      toast({ text: r.newItems ? `${r.newItems} nouvel${r.newItems > 1 ? 's' : ''} élément${r.newItems > 1 ? 's' : ''}` : 'Fil à jour', tone: 'ok' });
    } catch {
      await qc.invalidateQueries({ queryKey: ['items'] });
      toast({ text: online ? 'Rafraîchissement impossible' : 'Hors ligne : affichage du cache', tone: 'error' });
    }
  }, [qc, toast, online]);

  const markUntil = useCallback(
    async (item: Item | null) => {
      const r = await api.markRead(view, filters, item ? `${item.publishedAt}:${item.id}` : undefined);
      await qc.invalidateQueries({ queryKey: ['items'] });
      await qc.invalidateQueries({ queryKey: ['stats'] });
      toast({ text: `${r.marked} élément${r.marked > 1 ? 's' : ''} marqué${r.marked > 1 ? 's' : ''} comme lu${r.marked > 1 ? 's' : ''}`, tone: 'ok' });
    },
    [view, filters, qc, toast],
  );

  // Défilement infini
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => {
      if (e[0]?.isIntersecting && query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [query]);

  // Hors-ligne : précharge le détail des favoris et des premiers items prioritaires (mis en cache par le SW).
  useEffect(() => {
    if (!online || !items.length) return;
    const ids = items.filter((i) => i.starred || (!i.read && i.score >= (stats.data?.priorityThreshold ?? 60))).slice(0, 12).map((i) => i.id);
    const t = setTimeout(() => {
      for (const id of ids) void qc.prefetchQuery({ queryKey: ['item', id], queryFn: () => api.item(id), staleTime: 300_000 });
    }, 1500);
    return () => clearTimeout(t);
  }, [items, online, qc, stats.data?.priorityThreshold]);

  const activeFilters = [
    filters.tech && { key: 'tech', label: filters.tech },
    filters.feed && { key: 'feed', label: 'Source filtrée' },
    filters.severity?.length && { key: 'severity', label: filters.severity.map((s) => SEVERITY_LABEL[s]).join(', ') },
    filters.unread && { key: 'unread', label: 'Non lus' },
    filters.starred && { key: 'starred', label: 'Favoris' },
  ].filter(Boolean) as { key: 'tech' | 'feed' | 'severity' | 'unread' | 'starred'; label: string }[];

  return (
    <PullToRefresh onRefresh={refresh}>
      <PageHeader
        title={TITLES[view]}
        subtitle={!online ? <span className="inline-flex items-center gap-1.5"><CloudOff size={14} /> Hors ligne — contenu en cache</span> : undefined}
        actions={
          <>
            <IconButton label="Rechercher" active={searchOpen} onClick={() => setSearchOpen((s) => !s)}>
              <Search size={21} />
            </IconButton>
            <IconButton label="Filtres" active={activeFilters.length > 0} onClick={() => setFiltersOpen(true)}>
              <Filter size={20} />
            </IconButton>
            <IconButton label="Tout marquer comme lu" onClick={() => { if (window.confirm(`Marquer tous les éléments de « ${TITLES[view]} » comme lus ?`)) void markUntil(null); }}>
              <CheckCheck size={21} />
            </IconButton>
            <IconButton label="Rafraîchir" className="hidden min-[900px]:inline-flex" onClick={() => void refresh()}>
              <RefreshCw size={19} />
            </IconButton>
          </>
        }
      />
      <main className="px-safe pb-tabbar mx-auto max-w-3xl">
        {searchOpen && (
          <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-10 -mx-1 bg-bg/95 px-1 pt-3 pb-2 backdrop-blur">
            <label className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface px-3 focus-within:border-accent">
              <Search size={18} className="text-muted" aria-hidden />
              <input
                autoFocus
                type="search"
                enterKeyHint="search"
                defaultValue={filters.q}
                placeholder="Rechercher (titre, contenu, CVE…)"
                aria-label="Recherche plein texte"
                className="min-w-0 flex-1 bg-transparent py-2 outline-none placeholder:text-faint"
                onChange={(e) => {
                  const v = e.target.value;
                  window.clearTimeout((window as unknown as { __q?: number }).__q);
                  (window as unknown as { __q?: number }).__q = window.setTimeout(() => setFilter({ q: v.trim() || undefined }), 300);
                }}
              />
              {filters.q && (
                <button type="button" aria-label="Effacer" className="h-9 w-9 text-muted" onClick={() => { setFilter({ q: undefined }); setSearchOpen(false); }}>
                  <X size={18} className="mx-auto" />
                </button>
              )}
            </label>
          </div>
        )}
        {activeFilters.length > 0 && (
          <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pt-3">
            {activeFilters.map((f) => (
              <button key={f.key} type="button" onClick={() => setFilter({ [f.key]: undefined })} className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full bg-accent-bg px-3 text-sm font-medium text-accent-strong">
                {f.label} <X size={14} aria-label="retirer" />
              </button>
            ))}
          </div>
        )}

        {view === 'priority' && !filters.q && activeFilters.length === 0 && (
          <div className="space-y-3 pt-4">
            <InstallBanner />
            <BriefingBanner />
          </div>
        )}

        {query.isPending ? (
          <div className="flex justify-center py-20"><Spinner size={28} /></div>
        ) : query.isError && !items.length ? (
          <EmptyState icon={<CloudOff size={28} />} title="Impossible de charger le fil">{(query.error as Error).message}</EmptyState>
        ) : items.length === 0 ? (
          <EmptyState icon={<Inbox size={28} />} title={filters.q ? 'Aucun résultat' : view === 'priority' ? 'Rien d’urgent' : 'Aucun élément'}>
            {filters.q ? 'Essayez d’autres mots-clés.' : view === 'priority' ? 'Aucune alerte prioritaire non traitée. Profitez-en ☕' : 'Les flux n’ont encore rien remonté ici.'}
          </EmptyState>
        ) : (
          <ul className="space-y-3 pt-4" aria-label={`Fil ${TITLES[view]}`}>
            {items.map((it) => (
              <li key={it.id}>
                <ItemCard
                  item={it}
                  onToggleRead={(i) => setRead(i.id, !i.read)}
                  onToggleStar={(i) => setStarred(i.id, !i.starred)}
                  onMarkReadUntil={(i) => void markUntil(i)}
                  onTech={(name) => setFilter({ tech: name })}
                />
              </li>
            ))}
          </ul>
        )}
        <div ref={sentinel} className="flex justify-center py-6">{query.isFetchingNextPage && <Spinner />}</div>
      </main>
      {filtersOpen && <FilterSheet filters={filters} onChange={setFilter} onClose={() => setFiltersOpen(false)} />}
    </PullToRefresh>
  );
}

function BriefingBanner() {
  const { data } = useQuery({ queryKey: ['briefing', 'latest'], queryFn: () => api.briefing('latest'), retry: false, staleTime: 60_000 });
  if (!data) return null;
  const fresh = Date.now() - data.createdAt < 36 * 3600_000;
  if (!fresh && data.readAt) return null;
  const lead = data.summary.split('\n').map((l) => l.replace(/[#*_`]/g, '').replace(/^-\s*/, '').trim()).find((l) => l.length > 20) ?? '';
  return (
    <Link to={`/briefing/${data.id}`} className="group block rounded-2xl border border-accent/30 bg-gradient-to-br from-accent-bg to-transparent p-4">
      <div className="mb-1.5 flex items-center gap-2 text-[0.8rem] font-semibold tracking-wide text-accent-strong uppercase">
        <Sunrise size={16} aria-hidden /> Briefing du matin
        {!data.readAt && <span className="rounded-full bg-accent px-1.5 text-[0.65rem] leading-4 text-bg">NOUVEAU</span>}
        <span className="ml-auto font-normal tracking-normal text-muted normal-case">{relativeTime(data.createdAt)}</span>
      </div>
      <p className="line-clamp-2 text-[0.98rem] leading-relaxed">{lead}</p>
      <div className="mt-2 flex items-center gap-1.5 text-sm text-muted">
        {data.model ? <><Sparkles size={14} className="text-accent" /> {data.itemCount} éléments résumés par {data.model}</> : <>{data.itemCount} éléments depuis {shortDateTime(data.periodStart)}</>}
        <ChevronRight size={16} className="ml-auto transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

function InstallBanner() {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem('radar.installBanner') === 'hidden';
    } catch {
      return false;
    }
  });
  if (hidden || !isIOS() || isStandalone()) return null;
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-border bg-surface p-4">
      <Smartphone size={22} className="mt-0.5 shrink-0 text-accent" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Installez Radar sur l’écran d’accueil</p>
        <p className="text-sm text-muted">Indispensable sur iPhone pour recevoir les notifications.</p>
        <Link to="/install" className="mt-1 inline-flex min-h-9 items-center font-semibold text-accent">Voir comment faire →</Link>
      </div>
      <button type="button" aria-label="Masquer" className="h-9 w-9 text-muted" onClick={() => { try { localStorage.setItem('radar.installBanner', 'hidden'); } catch { /* */ } setHidden(true); }}>
        <X size={18} className="mx-auto" />
      </button>
    </div>
  );
}

function FilterSheet({ filters, onChange, onClose }: { filters: Filters; onChange: (p: Record<string, string | undefined>) => void; onClose: () => void }) {
  const feeds = useQuery({ queryKey: ['feeds'], queryFn: api.feeds, staleTime: 60_000 });
  const watch = useQuery({ queryKey: ['watchlist'], queryFn: api.watchlist, staleTime: 60_000 });
  const sev = new Set(filters.severity ?? []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const chip = (on: boolean) => `inline-flex min-h-10 items-center rounded-full border px-3.5 text-[0.9rem] font-medium ${on ? 'border-accent bg-accent-bg text-accent-strong' : 'border-border text-muted'}`;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center min-[640px]:items-center" role="dialog" aria-modal="true" aria-label="Filtres">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div className="pb-safe relative max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-border bg-surface p-5 min-[640px]:rounded-3xl">
        <div className="mb-4 flex items-center">
          <h2 className="flex-1 text-lg font-bold">Filtres</h2>
          <IconButton label="Fermer" onClick={onClose}><X size={20} /></IconButton>
        </div>
        <h3 className="mb-2 text-sm font-semibold text-muted">Affichage</h3>
        <div className="mb-5 flex flex-wrap gap-2">
          <button type="button" className={chip(!filters.unread && !filters.starred)} onClick={() => onChange({ unread: undefined, starred: undefined })}>Tout</button>
          <button type="button" className={chip(!!filters.unread)} onClick={() => onChange({ unread: filters.unread ? undefined : '1' })}>Non lus</button>
          <button type="button" className={chip(!!filters.starred)} onClick={() => onChange({ starred: filters.starred ? undefined : '1' })}>Favoris</button>
        </div>
        <h3 className="mb-2 text-sm font-semibold text-muted">Sévérité</h3>
        <div className="mb-5 flex flex-wrap gap-2">
          {SEVERITIES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={sev.has(s)}
              className={chip(sev.has(s))}
              onClick={() => {
                const n = new Set(sev);
                if (n.has(s)) n.delete(s);
                else n.add(s);
                onChange({ severity: [...n].join(',') || undefined });
              }}
            >
              {SEVERITY_LABEL[s]}
            </button>
          ))}
        </div>
        <label className="mb-4 block">
          <span className="mb-1.5 block text-sm font-semibold text-muted">Techno</span>
          <select className="min-h-11 w-full rounded-xl border border-border bg-surface-2 px-3" value={filters.tech ?? ''} onChange={(e) => onChange({ tech: e.target.value || undefined })}>
            <option value="">Toutes</option>
            {watch.data?.map((w) => <option key={w.id} value={w.name}>{w.name}</option>)}
          </select>
        </label>
        <label className="mb-6 block">
          <span className="mb-1.5 block text-sm font-semibold text-muted">Source</span>
          <select className="min-h-11 w-full rounded-xl border border-border bg-surface-2 px-3" value={filters.feed ?? ''} onChange={(e) => onChange({ feed: e.target.value || undefined })}>
            <option value="">Toutes</option>
            {feeds.data?.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}
          </select>
        </label>
        <div className="flex gap-3">
          <button type="button" className="min-h-11 flex-1 rounded-xl border border-border font-medium" onClick={() => onChange({ tech: undefined, feed: undefined, severity: undefined, unread: undefined, starred: undefined })}>Réinitialiser</button>
          <button type="button" className="min-h-11 flex-1 rounded-xl bg-accent font-semibold text-bg" onClick={onClose}>Voir les résultats</button>
        </div>
      </div>
    </div>
  );
}

/** Pull-to-refresh tactile (le document doit être tout en haut). */
function PullToRefresh({ onRefresh, children }: { onRefresh: () => Promise<void>; children: React.ReactNode }) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const startY = useRef<number | null>(null);
  const LIMIT = 72;
  return (
    <div
      onTouchStart={(e) => {
        startY.current = window.scrollY <= 0 && !busy ? (e.touches[0]?.clientY ?? null) : null;
      }}
      onTouchMove={(e) => {
        if (startY.current == null) return;
        const d = (e.touches[0]?.clientY ?? 0) - startY.current;
        setPull(d > 0 ? Math.min(110, d * 0.5) : 0);
      }}
      onTouchEnd={() => {
        if (pull >= LIMIT && !busy) {
          setBusy(true);
          setPull(LIMIT);
          void onRefresh().finally(() => {
            setBusy(false);
            setPull(0);
          });
        } else setPull(0);
        startY.current = null;
      }}
    >
      <div aria-hidden={!busy} className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+3.75rem)] z-40 flex justify-center" style={{ opacity: pull > 8 || busy ? 1 : 0, transform: `translateY(${pull - 20}px)` }}>
        <div className="rounded-full border border-border bg-surface p-2 shadow-lg">
          <RefreshCw size={20} className={`text-accent ${busy ? 'animate-spin-slow' : ''}`} style={{ transform: busy ? undefined : `rotate(${pull * 4}deg)` }} />
        </div>
      </div>
      {busy && <span className="sr-only" role="status">Rafraîchissement…</span>}
      {children}
    </div>
  );
}
