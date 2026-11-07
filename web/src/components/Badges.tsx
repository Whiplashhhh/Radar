import { Flame } from 'lucide-react';
import type { Severity, Tech } from '../api';
import { cvss as fmtCvss, percent, SEVERITY_LABEL } from '../lib/format';

const base = 'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[0.75rem] font-semibold leading-none tracking-wide whitespace-nowrap';

export function SeverityBadge({ severity, score, large }: { severity: Severity; score?: number | null; large?: boolean }) {
  return (
    <span className={`${base} sev-${severity} ${large ? 'px-2.5 py-1 text-sm' : ''}`} title={`Sévérité ${SEVERITY_LABEL[severity].toLowerCase()}`}>
      {SEVERITY_LABEL[severity].toUpperCase()}
      {score != null && <span className="font-bold tabular-nums">{fmtCvss(score)}</span>}
    </span>
  );
}

export function KevBadge({ large }: { large?: boolean }) {
  return (
    <span className={`${base} kev ${large ? 'px-2.5 py-1 text-sm' : ''}`} title="Exploitée activement (catalogue CISA KEV)">
      <Flame aria-hidden size={large ? 15 : 12} strokeWidth={2.5} />
      KEV
    </span>
  );
}

export function EpssBadge({ epss }: { epss: number }) {
  const hot = epss >= 0.1;
  return (
    <span className={`${base} ${hot ? 'sev-high' : 'sev-unknown'}`} title="EPSS : probabilité d’exploitation dans les 30 jours (FIRST)">
      EPSS {percent(epss, 0)}
    </span>
  );
}

export function TechChip({ tech, onClick }: { tech: Tech; onClick?: () => void }) {
  const certain = tech.level === 'certain';
  const cls = `inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[0.8rem] font-medium ${
    certain ? 'bg-accent-bg text-accent-strong' : 'border border-dashed border-border text-muted'
  }`;
  const label = (
    <>
      {tech.name}
      {!certain && <span aria-label="match probable" className="opacity-70">?</span>}
    </>
  );
  return onClick ? (
    <button type="button" className={`${cls} min-h-7`} onClick={onClick} title={certain ? 'Match certain (identifiant structuré)' : 'Match probable (mot-clé)'}>
      {label}
    </button>
  ) : (
    <span className={cls} title={certain ? 'Match certain (identifiant structuré)' : 'Match probable (mot-clé)'}>
      {label}
    </span>
  );
}
