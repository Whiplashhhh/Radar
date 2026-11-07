import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, ListChecks, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, type WatchEntry } from '../api';
import { Button, EmptyState, IconButton, PageHeader, Spinner, Toggle, useToast } from '../components/ui';

export function WatchlistPage() {
  const { data, isPending } = useQuery({ queryKey: ['watchlist'], queryFn: api.watchlist });
  return (
    <>
      <PageHeader width="max-w-2xl"
        title="Watchlist"
        back="/settings"
        actions={
          <Link to="/settings/watchlist/new" aria-label="Ajouter une techno" className="inline-flex h-11 w-11 items-center justify-center rounded-full text-accent hover:bg-surface-2">
            <Plus size={24} />
          </Link>
        }
      />
      <main className="px-safe pb-tabbar mx-auto max-w-2xl pt-4">
        <p className="mb-4 px-1 text-muted">Les technos que vous utilisez. Une CVE est rattachée <strong className="text-text">avec certitude</strong> via un package ou un CPE, et <strong className="text-text">probablement</strong> via un mot-clé.</p>
        {isPending ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : !data?.length ? (
          <EmptyState icon={<ListChecks size={28} />} title="Watchlist vide" />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            {data.map((w) => (
              <li key={w.id}>
                <Link to={`/settings/watchlist/${w.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                  <span className="min-w-0 flex-1">
                    <span className={`block font-medium ${w.enabled ? '' : 'text-muted line-through'}`}>{w.name}</span>
                    <span className="block truncate text-sm text-muted">
                      {[...w.packages, ...w.cpes.map((c) => `cpe:${c}`), ...w.aliases.map((a) => a.replace(/^=/, ''))].slice(0, 4).join(' · ') || 'aucun identifiant'}
                    </span>
                  </span>
                  {w.matchCount > 0 && <span className="rounded-full bg-accent-bg px-2 text-sm leading-6 font-semibold text-accent-strong tabular-nums">{w.matchCount}</span>}
                  <ChevronRight size={18} className="text-faint" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}

const EMPTY: Omit<WatchEntry, 'id' | 'matchCount'> = { name: '', aliases: [], cpes: [], packages: [], exclude: [], enabled: true };

export function WatchEditPage() {
  const params = useParams();
  const isNew = params.id === 'new';
  const id = Number(params.id);
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { data: list } = useQuery({ queryKey: ['watchlist'], queryFn: api.watchlist });
  const existing = list?.find((w) => w.id === id);
  const [form, setForm] = useState<Omit<WatchEntry, 'id' | 'matchCount'> | null>(isNew ? EMPTY : null);
  const f = form ?? (existing ? { name: existing.name, aliases: existing.aliases, cpes: existing.cpes, packages: existing.packages, exclude: existing.exclude, enabled: existing.enabled } : null);

  const save = useMutation({
    mutationFn: () => (isNew ? api.addWatch(f as typeof EMPTY) : api.patchWatch(id, f as typeof EMPTY)),
    onSuccess: () => {
      void qc.invalidateQueries();
      toast({ text: 'Watchlist enregistrée — re-matching effectué', tone: 'ok' });
      navigate('/settings/watchlist');
    },
    onError: (e: Error) => toast({ text: e.message, tone: 'error' }),
  });
  const del = useMutation({
    mutationFn: () => api.deleteWatch(id),
    onSuccess: () => {
      void qc.invalidateQueries();
      navigate('/settings/watchlist');
    },
  });

  if (!f) return <><PageHeader width="max-w-2xl" title="Techno" back="/settings/watchlist" /><div className="flex justify-center py-10"><Spinner /></div></>;
  const set = (p: Partial<typeof EMPTY>) => setForm({ ...f, ...p });
  return (
    <>
      <PageHeader width="max-w-2xl"
        title={isNew ? 'Nouvelle techno' : f.name}
        back="/settings/watchlist"
        actions={!isNew && <IconButton label="Supprimer" onClick={() => window.confirm(`Supprimer « ${f.name} » ?`) && del.mutate()}><Trash2 size={20} className="text-danger" /></IconButton>}
      />
      <main className="px-safe pb-tabbar mx-auto max-w-2xl pt-4">
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label="Nom" htmlFor="watch-name" hint="Affiché sur les cartes (ex. « Spring »).">
            <input id="watch-name" required value={f.name} onChange={(e) => set({ name: e.target.value })} className="min-h-11 w-full rounded-xl border border-border bg-surface px-3" />
          </Field>
          <ListField label="Alias / mots-clés" hint="Cherchés avec des frontières de mot (match « probable »). Préfixez par = pour respecter la casse : =React ne matche pas « react to »." placeholder="Spring Boot" value={f.aliases} onChange={(aliases) => set({ aliases })} />
          <ListField label="Packages (écosystème:nom)" hint="Match « certain ». Le joker * est accepté. Écosystèmes : npm, maven, pip, pub, go, rubygems, nuget, composer, rust." placeholder="maven:org.springframework.boot:*" value={f.packages} onChange={(packages) => set({ packages })} mono />
          <ListField label="CPE (vendor:product)" hint="Match « certain » via les CPE de la NVD." placeholder="vmware:spring_boot" value={f.cpes} onChange={(cpes) => set({ cpes })} mono />
          <ListField label="Mots-clés d’exclusion" hint="Annulent un match probable (faux positifs)." placeholder="Docker Desktop" value={f.exclude} onChange={(exclude) => set({ exclude })} />
          <div className="rounded-2xl border border-border bg-surface px-4">
            <Toggle label="Active" checked={f.enabled} onChange={(enabled) => set({ enabled })} />
          </div>
          <Button type="submit" variant="primary" className="w-full" disabled={save.isPending || !f.name.trim()}>{save.isPending ? <Spinner size={17} /> : null} Enregistrer</Button>
        </form>
      </main>
    </>
  );
}

function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div>
      {htmlFor ? <label htmlFor={htmlFor} className="mb-1.5 block font-semibold">{label}</label> : <p className="mb-1.5 font-semibold">{label}</p>}
      {children}
      {hint && <p className="mt-1.5 text-sm text-muted">{hint}</p>}
    </div>
  );
}

function ListField({ label, hint, value, onChange, placeholder, mono }: { label: string; hint?: string; value: string[]; onChange: (v: string[]) => void; placeholder?: string; mono?: boolean }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const parts = draft.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) onChange([...new Set([...value, ...parts])]);
    setDraft('');
  };
  return (
    <Field label={label} hint={hint}>
      {value.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {value.map((v) => (
            <li key={v} className={`inline-flex items-center gap-1 rounded-full bg-surface-2 py-0.5 pr-1 pl-3 text-sm ${mono ? 'font-mono' : ''}`}>
              {v}
              <button type="button" aria-label={`Retirer ${v}`} onClick={() => onChange(value.filter((x) => x !== v))} className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surface-3"><X size={14} /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
          placeholder={placeholder}
          aria-label={label}
          className={`min-h-11 min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 placeholder:text-faint ${mono ? 'font-mono text-sm' : ''}`}
        />
        <Button onClick={add} aria-label={`Ajouter à ${label}`}><Plus size={18} /></Button>
      </div>
    </Field>
  );
}
