import { useQuery } from '@tanstack/react-query';
import { BookOpen, Circle, ExternalLink, FileText, Share2, Sparkles, Star } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../api';
import { KevBadge, SeverityBadge, TechChip } from '../components/Badges';
import { EmptyState, IconButton, PageHeader, Spinner } from '../components/ui';
import { useItemActions } from '../hooks';
import { CATEGORY_LABEL, fullDate, hostname } from '../lib/format';

export function ItemPage() {
  const id = Number(useParams().id);
  const { data, isPending, isError, error } = useQuery({ queryKey: ['item', id], queryFn: () => api.item(id), staleTime: 300_000 });
  const { setRead, setStarred } = useItemActions();
  const [mode, setMode] = useState<'readable' | 'feed'>('readable');
  const marked = useRef(false);

  useEffect(() => {
    if (data && !data.read && !marked.current) {
      marked.current = true;
      setRead(data.id, true);
    }
  }, [data, setRead]);

  if (isPending) return <><PageHeader width="max-w-[44rem]" title="" back /><div className="flex justify-center py-20"><Spinner size={28} /></div></>;
  if (isError || !data) return <><PageHeader width="max-w-[44rem]" title="Article" back /><EmptyState icon={<FileText size={28} />} title="Article indisponible">{(error as Error | null)?.message ?? 'Introuvable'}</EmptyState></>;

  const html = mode === 'readable' && data.readableHtml ? data.readableHtml : data.contentHtml || data.summaryHtml;
  const share = async () => {
    if (navigator.share && data.url) await navigator.share({ title: data.title, url: data.url }).catch(() => {});
    else if (data.url) await navigator.clipboard?.writeText(data.url);
  };
  return (
    <>
      <PageHeader width="max-w-[44rem]"
        title=""
        back
        actions={
          <>
            <IconButton label={data.read ? 'Marquer comme non lu' : 'Marquer comme lu'} onClick={() => setRead(data.id, !data.read)}>
              <Circle size={18} className={data.read ? '' : 'fill-accent text-accent'} />
            </IconButton>
            <IconButton label={data.starred ? 'Retirer des favoris' : 'Ajouter aux favoris'} active={data.starred} onClick={() => setStarred(data.id, !data.starred)}>
              <Star size={21} className={data.starred ? 'fill-[#f59e0b] text-[#f59e0b]' : ''} />
            </IconButton>
            {data.url && <IconButton label="Partager" onClick={() => void share()}><Share2 size={20} /></IconButton>}
          </>
        }
      />
      <main className="px-safe pb-tabbar mx-auto max-w-[44rem] pt-5">
        <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
          <span className="font-semibold text-accent">{data.feed.title}</span>
          <span aria-hidden>·</span>
          <span>{CATEGORY_LABEL[data.feed.category]}</span>
          <span aria-hidden>·</span>
          <time dateTime={new Date(data.publishedAt).toISOString()}>{fullDate(data.publishedAt)}</time>
        </div>
        <h1 className="text-[1.65rem] leading-tight font-bold tracking-tight text-balance">{data.title}</h1>
        {data.author && <p className="mt-2 text-muted">par {data.author}</p>}
        {(data.severity || data.kev || data.techs.length > 0) && (
          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            {data.severity && <SeverityBadge severity={data.severity} />}
            {data.kev && <KevBadge />}
            {data.techs.map((t) => <TechChip key={t.name} tech={t} />)}
          </div>
        )}
        {data.aiSummary && (
          <aside className="mt-5 rounded-2xl border border-accent/25 bg-accent-bg p-4">
            <div className="mb-1 flex items-center gap-1.5 text-[0.78rem] font-semibold tracking-wide text-accent-strong uppercase"><Sparkles size={14} /> Résumé IA</div>
            <p className="leading-relaxed whitespace-pre-line">{data.aiSummary}</p>
          </aside>
        )}
        {data.vulns.length > 0 && (
          <section className="mt-5 overflow-hidden rounded-2xl border border-border bg-surface">
            <h2 className="border-b border-border px-4 py-2.5 text-[0.8rem] font-semibold tracking-wide text-muted uppercase">Vulnérabilités citées</h2>
            <ul className="divide-y divide-border">
              {data.vulns.map((v) => (
                <li key={v.id}>
                  <Link to={`/vuln/${encodeURIComponent(v.id)}`} className="flex min-h-12 items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                    <span className="font-mono text-[0.9rem] font-semibold">{v.id}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-muted">{v.title}</span>
                    {v.kev ? <KevBadge /> : null}
                    <SeverityBadge severity={v.severity} score={v.cvss} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        {data.readableHtml && (data.contentHtml || data.summaryHtml) && (
          <div role="tablist" aria-label="Version du texte" className="mt-6 inline-flex rounded-xl border border-border bg-surface p-1 text-sm">
            <button type="button" role="tab" aria-selected={mode === 'readable'} onClick={() => setMode('readable')} className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 ${mode === 'readable' ? 'bg-surface-3 font-semibold' : 'text-muted'}`}><BookOpen size={15} /> Lecture</button>
            <button type="button" role="tab" aria-selected={mode === 'feed'} onClick={() => setMode('feed')} className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 ${mode === 'feed' ? 'bg-surface-3 font-semibold' : 'text-muted'}`}><FileText size={15} /> Flux</button>
          </div>
        )}
        {html ? (
          // HTML assaini côté serveur (sanitize-html) ; CSP stricte en défense en profondeur.
          <article className="prose-radar mt-6" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <p className="mt-6 text-muted">Pas de contenu dans le flux.{data.readableTried ? ' L’extraction de la page a échoué.' : ''}</p>
        )}
        {data.url && (
          <a href={data.url} target="_blank" rel="noopener noreferrer" className="mt-8 flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border bg-surface font-semibold text-accent hover:bg-surface-2">
            Lire l’original sur {hostname(data.url)} <ExternalLink size={17} />
          </a>
        )}
      </main>
    </>
  );
}
