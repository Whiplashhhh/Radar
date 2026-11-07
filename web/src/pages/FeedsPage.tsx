import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Plus, RefreshCw, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { api, type Category, type Feed } from '../api';
import { Button, PageHeader, Spinner, Toggle, useToast } from '../components/ui';
import { CATEGORY_LABEL, relativeTime } from '../lib/format';

const STATUS: Record<Feed['status'], { label: string; cls: string }> = {
  ok: { label: 'OK', cls: 'bg-ok' },
  warning: { label: 'Erreurs', cls: 'bg-warn' },
  error: { label: 'En échec', cls: 'bg-danger' },
  pending: { label: 'En attente', cls: 'bg-faint' },
  disabled: { label: 'Désactivé', cls: 'bg-surface-3' },
};
const CATS: Category[] = ['security', 'tech', 'releases', 'news'];

export function FeedsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isPending } = useQuery({ queryKey: ['feeds'], queryFn: api.feeds, refetchInterval: 30_000 });
  const [url, setUrl] = useState('');
  const [cat, setCat] = useState<Category>('tech');
  const [open, setOpen] = useState<number | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const add = useMutation({
    mutationFn: () => api.addFeed({ url: url.trim(), category: cat }),
    onSuccess: (f) => {
      setUrl('');
      void qc.invalidateQueries({ queryKey: ['feeds'] });
      toast({ text: `Abonné à « ${f.title} »`, tone: 'ok' });
    },
    onError: (e: Error) => toast({ text: e.message, tone: 'error' }),
  });
  const importOpml = useMutation({
    mutationFn: async (f: File) => api.importOpml(await f.text()),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['feeds'] });
      toast({ text: `OPML : ${r.added} flux ajouté${r.added > 1 ? 's' : ''}, ${r.skipped} ignoré${r.skipped > 1 ? 's' : ''}`, tone: 'ok' });
    },
    onError: (e: Error) => toast({ text: e.message, tone: 'error' }),
  });

  const counts = (data ?? []).reduce<Record<string, number>>((m, f) => ({ ...m, [f.status]: (m[f.status] ?? 0) + 1 }), {});
  return (
    <>
      <PageHeader title="Flux" back="/settings" subtitle={data ? `${data.length} flux · ${counts.ok ?? 0} OK · ${(counts.warning ?? 0) + (counts.error ?? 0)} en erreur` : undefined} />
      <main className="px-safe pb-tabbar mx-auto max-w-2xl pt-4">
        <form
          className="rounded-2xl border border-border bg-surface p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) add.mutate();
          }}
        >
          <label htmlFor="feed-url" className="mb-1.5 block font-semibold">Ajouter un flux</label>
          <p className="mb-3 text-sm text-muted">URL d’un flux RSS/Atom ou d’une page web : le flux est découvert automatiquement.</p>
          <input id="feed-url" type="url" inputMode="url" required placeholder="https://exemple.fr" value={url} onChange={(e) => setUrl(e.target.value)} className="min-h-11 w-full rounded-xl border border-border bg-surface-2 px-3 placeholder:text-faint" />
          <div className="mt-3 flex gap-2">
            <select aria-label="Catégorie" value={cat} onChange={(e) => setCat(e.target.value as Category)} className="min-h-11 flex-1 rounded-xl border border-border bg-surface-2 px-3">
              {CATS.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
            <Button type="submit" variant="primary" disabled={add.isPending}>{add.isPending ? <Spinner size={17} /> : <Plus size={18} />} Ajouter</Button>
          </div>
        </form>

        <div className="mt-3 flex gap-2">
          <a href="/api/opml" download className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-surface-2 font-medium hover:bg-surface-3"><Download size={17} /> Exporter OPML</a>
          <Button className="flex-1" onClick={() => file.current?.click()} disabled={importOpml.isPending}><Upload size={17} /> Importer OPML</Button>
          <input ref={file} type="file" accept=".opml,.xml,text/xml,text/x-opml" hidden onChange={(e) => e.target.files?.[0] && importOpml.mutate(e.target.files[0])} />
        </div>

        <h2 className="mt-7 mb-2 px-1 text-[0.8rem] font-semibold tracking-[0.06em] text-muted uppercase">Santé des flux</h2>
        {isPending ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            {data?.map((f) => (
              <li key={f.id}>
                <button type="button" aria-expanded={open === f.id} onClick={() => setOpen(open === f.id ? null : f.id)} className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-2">
                  <span aria-label={STATUS[f.status].label} title={STATUS[f.status].label} className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS[f.status].cls}`} />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate font-medium ${f.enabled ? '' : 'text-muted'}`}>{f.title}</span>
                    <span className="block truncate text-sm text-muted">
                      {CATEGORY_LABEL[f.category]} · {f.lastFetchAt ? `relevé ${relativeTime(f.lastFetchAt)}` : 'jamais relevé'}
                      {f.errorCount > 0 && <span className="text-danger"> · {f.errorCount} erreur{f.errorCount > 1 ? 's' : ''}</span>}
                    </span>
                  </span>
                  <span className="text-sm text-faint tabular-nums">{f.itemCount}</span>
                </button>
                {open === f.id && <FeedDetail feed={f} />}
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}

function FeedDetail({ feed }: { feed: Feed }) {
  const qc = useQueryClient();
  const toast = useToast();
  const inv = () => void qc.invalidateQueries({ queryKey: ['feeds'] });
  const patch = useMutation({ mutationFn: (b: Parameters<typeof api.patchFeed>[1]) => api.patchFeed(feed.id, b), onSuccess: inv, onError: (e: Error) => toast({ text: e.message, tone: 'error' }) });
  const refresh = useMutation({
    mutationFn: () => api.refreshFeed(feed.id),
    onSuccess: (r) => {
      inv();
      void qc.invalidateQueries({ queryKey: ['items'] });
      toast({ text: r.ok ? `${r.newItems ?? 0} nouvel(s) élément(s)` : `Échec : ${r.error}`, tone: r.ok ? 'ok' : 'error' });
    },
  });
  const del = useMutation({ mutationFn: () => api.deleteFeed(feed.id), onSuccess: inv });
  return (
    <div className="space-y-1 border-t border-border bg-surface-2/40 px-4 py-3 text-sm">
      <p className="font-mono text-[0.8rem] break-all text-muted">{feed.url}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 py-2">
        <dt className="text-muted">Dernier succès</dt><dd>{feed.lastSuccessAt ? relativeTime(feed.lastSuccessAt) : '—'}</dd>
        <dt className="text-muted">Prochain relevé</dt><dd>{feed.enabled ? relativeTime(feed.nextFetchAt) : '—'}</dd>
        <dt className="text-muted">Erreurs</dt><dd>{feed.errorCount}</dd>
        {feed.lastError && (<><dt className="text-muted">Dernière erreur</dt><dd className="break-words text-danger">{feed.lastError}</dd></>)}
      </dl>
      <Toggle label="Activé" checked={feed.enabled} onChange={(enabled) => patch.mutate({ enabled })} />
      <label className="flex min-h-12 items-center gap-3">
        <span className="flex-1">Catégorie</span>
        <select value={feed.category} onChange={(e) => patch.mutate({ category: e.target.value as Category })} className="min-h-10 rounded-lg border border-border bg-surface px-2">
          {CATS.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </select>
      </label>
      <label className="flex min-h-12 items-center gap-3">
        <span className="flex-1">Intervalle de relevé</span>
        <select value={feed.pollIntervalMin} onChange={(e) => patch.mutate({ pollIntervalMin: Number(e.target.value) })} className="min-h-10 rounded-lg border border-border bg-surface px-2">
          {[...new Set([10, 15, 30, 60, 120, 180, 360, 720, 1440, feed.pollIntervalMin])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h`}</option>)}
        </select>
      </label>
      <div className="flex gap-2 pt-2">
        <Button onClick={() => refresh.mutate()} disabled={refresh.isPending}>{refresh.isPending ? <Spinner size={16} /> : <RefreshCw size={16} />} Relever</Button>
        <Button variant="danger" onClick={() => window.confirm(`Se désabonner de « ${feed.title} » ? Ses éléments seront supprimés.`) && del.mutate()}><Trash2 size={16} /> Supprimer</Button>
      </div>
    </div>
  );
}
