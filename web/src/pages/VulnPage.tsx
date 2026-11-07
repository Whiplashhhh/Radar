import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ExternalLink, Package, ShieldQuestion, Skull, Sparkles, Star } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link, useParams } from 'react-router';
import { api, type VulnDetail } from '../api';
import { SeverityBadge, TechChip } from '../components/Badges';
import { EmptyState, IconButton, PageHeader, Spinner } from '../components/ui';
import { useItemActions } from '../hooks';
import { cvss, fullDate, hostname, isoDay, percent, relativeTime } from '../lib/format';

export function VulnPage() {
  const id = decodeURIComponent(useParams().id ?? '');
  const { data, isPending, isError, error } = useQuery({ queryKey: ['vuln', id], queryFn: () => api.vuln(id), staleTime: 300_000 });
  const { setRead, setStarred } = useItemActions();
  const marked = useRef(false);
  useEffect(() => {
    if (data?.itemId && !data.read && !marked.current) {
      marked.current = true;
      setRead(data.itemId, true);
    }
  }, [data, setRead]);

  if (isPending) return <><PageHeader width="max-w-[44rem]" title={id} back /><div className="flex justify-center py-20"><Spinner size={28} /></div></>;
  if (isError || !data) return <><PageHeader width="max-w-[44rem]" title={id} back /><EmptyState icon={<ShieldQuestion size={28} />} title="Fiche indisponible">{(error as Error | null)?.message}</EmptyState></>;

  return (
    <>
      <PageHeader width="max-w-[44rem]"
        title={<span className="font-mono">{data.id}</span>}
        back
        actions={data.itemId ? (
          <IconButton label={data.starred ? 'Retirer des favoris' : 'Ajouter aux favoris'} active={data.starred} onClick={() => setStarred(data.itemId as number, !data.starred)}>
            <Star size={21} className={data.starred ? 'fill-[#f59e0b] text-[#f59e0b]' : ''} />
          </IconButton>
        ) : undefined}
      />
      <main className="px-safe pb-tabbar mx-auto max-w-[44rem] pt-5">
        {data.aliases.length > 0 && <p className="mb-2 font-mono text-sm text-muted">{data.aliases.join(' · ')}</p>}
        <h1 className="text-[1.5rem] leading-tight font-bold tracking-tight text-balance">{data.title ?? data.id}</h1>
        {data.publishedAt && <p className="mt-1.5 text-sm text-muted">Publiée le {fullDate(data.publishedAt)} · vue {relativeTime(data.firstSeenAt)}</p>}

        <div className="mt-5 grid grid-cols-2 gap-3 min-[560px]:grid-cols-3">
          <Metric label={`CVSS ${data.cvssVersion ?? ''}`.trim()} tone={data.severity}>
            <span className="text-[1.9rem] leading-none font-bold tabular-nums">{cvss(data.cvssScore)}</span>
            <span className="self-start"><SeverityBadge severity={data.severity} /></span>
          </Metric>
          <Metric label="EPSS (30 jours)">
            <span className="text-[1.9rem] leading-none font-bold tabular-nums">{percent(data.epss, 1)}</span>
            <span className="text-sm text-muted">{data.epssPercentile != null ? `percentile ${percent(data.epssPercentile, 0)}` : 'pas encore de score'}</span>
          </Metric>
          <Metric label="Exploitée activement" className="col-span-2 min-[560px]:col-span-1" tone={data.kev ? 'kev' : undefined}>
            {data.kev ? (
              <>
                <span className="flex items-center gap-2 text-[1.35rem] leading-none font-bold"><Skull size={22} /> Oui (KEV)</span>
                <span className="text-sm">ajoutée le {isoDay(data.kevAddedAt)}{data.kevDueAt ? ` · échéance ${isoDay(data.kevDueAt)}` : ''}</span>
                {data.kevRansomware && <span className="text-sm font-semibold">Utilisée par des rançongiciels</span>}
              </>
            ) : (
              <>
                <span className="flex items-center gap-2 text-[1.35rem] leading-none font-bold text-muted"><CheckCircle2 size={22} /> Non</span>
                <span className="text-sm text-muted">absente du catalogue CISA KEV</span>
              </>
            )}
          </Metric>
        </div>
        {data.cvssVector && <p className="mt-2 font-mono text-[0.78rem] break-all text-faint">{data.cvssVector}</p>}

        <Block title="Mes technos touchées">
          {data.techs.length ? (
            <ul className="space-y-2">
              {data.techs.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-2">
                  <TechChip tech={t} />
                  <span className="text-sm text-muted">{t.level === 'certain' ? 'certain' : 'probable'} · {t.reason}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">Aucune techno de la watchlist n’est concernée.</p>
          )}
          <p className="mt-3 text-sm text-faint">Score de priorité : <strong className="text-text tabular-nums">{data.score}</strong>/100</p>
        </Block>

        {data.aiSummary && (
          <aside className="mt-5 rounded-2xl border border-accent/25 bg-accent-bg p-4">
            <div className="mb-1 flex items-center gap-1.5 text-[0.78rem] font-semibold tracking-wide text-accent-strong uppercase"><Sparkles size={14} /> Résumé IA</div>
            <p className="leading-relaxed whitespace-pre-line">{data.aiSummary}</p>
          </aside>
        )}

        {data.description && (
          <Block title="Description">
            <p className="leading-relaxed whitespace-pre-line">{data.description.length > 2500 ? `${data.description.slice(0, 2500)}…` : data.description}</p>
          </Block>
        )}

        <Affected data={data} />

        <Block title={`Sources (${data.sources.length})`}>
          <ul className="-mx-4 divide-y divide-border">
            {data.sources.map((s) => (
              <li key={s.url}>
                {s.itemId ? (
                  <Link to={`/item/${s.itemId}`} className="flex min-h-12 items-center gap-3 px-4 py-2 hover:bg-surface-2">
                    <SourceLine s={s} />
                  </Link>
                ) : (
                  <a href={s.url.startsWith('http') ? s.url : undefined} target="_blank" rel="noopener noreferrer" className="flex min-h-12 items-center gap-3 px-4 py-2 hover:bg-surface-2">
                    <SourceLine s={s} external />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </Block>

        <div className="mt-5 grid gap-2 min-[560px]:grid-cols-2">
          {data.nvdUrl && <ExtLink href={data.nvdUrl}>Fiche NVD</ExtLink>}
          {data.ghsaUrl && <ExtLink href={data.ghsaUrl}>GitHub Advisory</ExtLink>}
        </div>
        {data.references.length > 0 && (
          <details className="mt-5 rounded-2xl border border-border bg-surface">
            <summary className="flex min-h-12 cursor-pointer items-center px-4 font-semibold">Références ({data.references.length})</summary>
            <ul className="space-y-1 px-4 pb-4">
              {data.references.map((r) => (
                <li key={r.url} className="truncate"><a className="text-sm text-accent underline-offset-2 hover:underline" href={r.url} target="_blank" rel="noopener noreferrer">{r.url}</a></li>
              ))}
            </ul>
          </details>
        )}
      </main>
    </>
  );
}

function Metric({ label, children, tone, className = '' }: { label: string; children: React.ReactNode; tone?: string; className?: string }) {
  const toneCls = tone === 'kev' ? 'kev' : tone && tone !== 'unknown' ? `sev-${tone}` : 'border-border bg-surface';
  return (
    <div className={`flex flex-col gap-1.5 rounded-2xl border p-4 ${toneCls} ${className}`}>
      <span className="text-[0.75rem] font-semibold tracking-wide uppercase opacity-80">{label}</span>
      {children}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 rounded-2xl border border-border bg-surface p-4">
      <h2 className="mb-3 text-[0.8rem] font-semibold tracking-wide text-muted uppercase">{title}</h2>
      {children}
    </section>
  );
}

function Affected({ data }: { data: VulnDetail }) {
  if (!data.affected.length) return null;
  const pkgs = data.affected.filter((a) => a.ecosystem !== 'cpe');
  const cpes = data.affected.filter((a) => a.ecosystem === 'cpe');
  return (
    <Block title="Versions affectées et corrigées">
      <ul className="space-y-3">
        {[...pkgs, ...cpes].slice(0, 25).map((a, i) => (
          <li key={`${a.package}-${i}`} className="flex gap-3">
            <Package size={18} className="mt-0.5 shrink-0 text-muted" aria-hidden />
            <div className="min-w-0">
              <div className="font-mono text-[0.9rem] break-all"><span className="text-faint">{a.ecosystem === 'cpe' ? 'cpe' : a.ecosystem}:</span>{a.package}</div>
              <div className="mt-0.5 flex flex-wrap gap-x-4 text-sm">
                {a.vulnerable && <span className="flex items-center gap-1 text-[var(--sev-high-fg)]"><AlertTriangle size={14} /> vulnérable {a.vulnerable}</span>}
                {a.patched ? <span className="flex items-center gap-1 text-ok"><CheckCircle2 size={14} /> corrigé en {a.patched}</span> : a.ecosystem !== 'cpe' && <span className="text-muted">pas de correctif connu</span>}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Block>
  );
}

function SourceLine({ s, external }: { s: VulnDetail['sources'][number]; external?: boolean }) {
  return (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{s.title ?? hostname(s.url)}</span>
        <span className="block truncate text-sm text-muted">{s.sourceName ?? hostname(s.url)} · {relativeTime(s.seenAt)}</span>
      </span>
      {external && <ExternalLink size={16} className="shrink-0 text-muted" />}
    </>
  );
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border bg-surface font-semibold text-accent hover:bg-surface-2">
      {children} <ExternalLink size={16} />
    </a>
  );
}
