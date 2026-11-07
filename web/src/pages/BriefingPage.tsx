import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ChevronRight, RefreshCw, Sparkles, Sunrise } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api';
import { Markdown } from '../components/Markdown';
import { Button, EmptyState, PageHeader, Spinner, useToast } from '../components/ui';
import { relativeTime, shortDateTime } from '../lib/format';

export function BriefingPage() {
  const params = useParams();
  const id = params.id ? Number(params.id) : ('latest' as const);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const current = useQuery({ queryKey: ['briefing', id], queryFn: () => api.briefing(id), retry: false });
  const list = useQuery({ queryKey: ['briefings'], queryFn: api.briefings });
  const gen = useMutation({
    mutationFn: api.generateBriefing,
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['briefings'] });
      void qc.invalidateQueries({ queryKey: ['briefing'] });
      if (r.briefing) navigate(`/briefing/${r.briefing.id}`);
      else toast({ text: 'Rien de nouveau depuis le dernier briefing', tone: 'info' });
    },
    onError: (e: Error) => toast({ text: e.message, tone: 'error' }),
  });
  const b = current.data;
  useEffect(() => {
    if (b && !b.readAt) {
      void api.readBriefing(b.id).then(() => {
        void qc.invalidateQueries({ queryKey: ['stats'] });
        void qc.invalidateQueries({ queryKey: ['briefing', 'latest'] });
      });
    }
  }, [b, qc]);

  return (
    <>
      <PageHeader width="max-w-[44rem]"
        title="Briefing du matin"
        back={params.id ? '/briefing' : undefined}
        actions={<Button variant="ghost" onClick={() => gen.mutate()} disabled={gen.isPending} className="!px-3">{gen.isPending ? <Spinner size={18} /> : <RefreshCw size={18} />}<span className="hidden min-[420px]:inline">Générer</span></Button>}
      />
      <main className="px-safe pb-tabbar mx-auto max-w-[44rem] pt-5">
        {current.isPending ? (
          <div className="flex justify-center py-20"><Spinner size={28} /></div>
        ) : !b ? (
          <EmptyState icon={<Sunrise size={28} />} title="Pas encore de briefing">
            Chaque matin, Radar résume toutes les actus reçues depuis le briefing précédent. Vous pouvez aussi en générer un maintenant.
          </EmptyState>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
              {b.model ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-bg px-2.5 py-0.5 font-medium text-accent-strong"><Sparkles size={14} /> {b.model}</span>
              ) : (
                <span className="rounded-full bg-surface-2 px-2.5 py-0.5 font-medium">Sans IA</span>
              )}
              <span>{b.itemCount} éléments</span>
              <span aria-hidden>·</span>
              <span>du {shortDateTime(b.periodStart)} au {shortDateTime(b.periodEnd)}</span>
            </div>
            {b.error && (
              <p className="mb-4 flex items-start gap-2 rounded-xl border border-warn/40 bg-surface p-3 text-sm text-warn">
                <AlertCircle size={16} className="mt-0.5 shrink-0" /> Ollama indisponible ({b.error}) : version sans IA.
              </p>
            )}
            <article className="rounded-2xl border border-border bg-surface p-5">
              <Markdown text={b.summary} />
            </article>
            {b.sections && b.sections.length > 0 && (
              <div className="mt-6 space-y-5">
                <h2 className="px-1 text-[0.8rem] font-semibold tracking-[0.06em] text-muted uppercase">À lire en détail</h2>
                {b.sections.map((s) => (
                  <section key={s.category} className="overflow-hidden rounded-2xl border border-border bg-surface">
                    <h3 className="border-b border-border px-4 py-2.5 font-semibold">{s.label}</h3>
                    <ul className="divide-y divide-border">
                      {s.items.map((i) => (
                        <li key={i.id}>
                          <Link to={`/item/${i.id}`} className="flex min-h-12 items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                            <span className="min-w-0 flex-1">
                              <span className="line-clamp-2 font-medium">{i.title}</span>
                              <span className="block truncate text-sm text-muted">{i.source}{i.techs.length ? ` · ${i.techs.join(', ')}` : ''}</span>
                            </span>
                            <ChevronRight size={18} className="shrink-0 text-faint" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </>
        )}
        {list.data && list.data.length > 1 && (
          <section className="mt-8">
            <h2 className="mb-2 px-1 text-[0.8rem] font-semibold tracking-[0.06em] text-muted uppercase">Briefings précédents</h2>
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
              {list.data.filter((x) => x.id !== b?.id).slice(0, 14).map((x) => (
                <li key={x.id}>
                  <Link to={`/briefing/${x.id}`} className="flex min-h-12 items-center gap-3 px-4 hover:bg-surface-2">
                    <span className="flex-1 capitalize">{shortDateTime(x.createdAt)}</span>
                    <span className="text-sm text-muted">{x.itemCount} éléments · {relativeTime(x.createdAt)}</span>
                    <ChevronRight size={18} className="text-faint" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
