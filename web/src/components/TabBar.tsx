import { Cpu, Flame, Inbox, Settings, ShieldAlert, Sunrise } from 'lucide-react';
import { NavLink } from 'react-router';
import { useStats } from '../hooks';

const TABS = [
  { to: '/priority', label: 'Prioritaire', icon: Flame, count: 'priority' as const },
  { to: '/security', label: 'Sécurité', icon: ShieldAlert, count: 'security' as const },
  { to: '/tech', label: 'Tech', icon: Cpu, count: 'tech' as const },
  { to: '/all', label: 'Tout', icon: Inbox, count: 'all' as const },
  { to: '/settings', label: 'Réglages', icon: Settings, count: null },
];

function fmt(n: number) {
  return n > 999 ? '999+' : String(n);
}

/** Barre d'onglets en bas (mobile) et rail latéral (desktop ≥ 900 px). */
export function TabBar() {
  const { data } = useStats();
  return (
    <>
      <nav aria-label="Navigation principale" className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg/90 backdrop-blur-xl min-[900px]:hidden">
        <ul className="mx-auto flex max-w-lg">
          {TABS.map(({ to, label, icon: Icon, count }) => {
            const n = count ? (data?.unread[count] ?? 0) : 0;
            return (
              <li key={to} className="flex-1">
                <NavLink
                  to={to}
                  className={({ isActive }) =>
                    `relative flex min-h-14 flex-col items-center justify-center gap-0.5 pt-1.5 text-[0.7rem] font-medium ${isActive ? 'text-accent' : 'text-muted'}`
                  }
                >
                  <span className="relative">
                    <Icon size={23} strokeWidth={2} aria-hidden />
                    {count === 'priority' && n > 0 && (
                      <span className="absolute -top-1.5 left-4 min-w-[1.15rem] rounded-full bg-[#ef4444] px-1 text-center text-[0.65rem] leading-[1.15rem] font-bold text-white tabular-nums">{fmt(n)}</span>
                    )}
                  </span>
                  <span>{label}</span>
                  {count === 'priority' && n > 0 && <span className="sr-only">{n} non lus</span>}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>
      <nav aria-label="Navigation principale" className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-surface/60 px-3 py-6 min-[900px]:flex">
        <div className="mb-8 flex items-center gap-2.5 px-3">
          <img src="/icons/favicon.svg" alt="" className="h-8 w-8" />
          <span className="text-xl font-bold tracking-tight">Radar</span>
        </div>
        <ul className="space-y-1">
          {[...TABS.slice(0, 4), { to: '/briefing', label: 'Briefing', icon: Sunrise, count: null }, TABS[4]!].map(({ to, label, icon: Icon, count }) => {
            const n = count ? (data?.unread[count] ?? 0) : to === '/briefing' ? (data?.briefingUnread ?? 0) : 0;
            return (
              <li key={to}>
                <NavLink
                  to={to}
                  className={({ isActive }) => `flex min-h-11 items-center gap-3 rounded-xl px-3 font-medium ${isActive ? 'bg-accent-bg text-accent-strong' : 'text-muted hover:bg-surface-2 hover:text-text'}`}
                >
                  <Icon size={20} aria-hidden />
                  <span className="flex-1">{label}</span>
                  {n > 0 && <span className={`rounded-full px-2 text-xs leading-5 font-semibold tabular-nums ${count === 'priority' ? 'bg-[#ef4444] text-white' : 'bg-surface-3 text-muted'}`}>{fmt(n)}</span>}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
