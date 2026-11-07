import { Check, Circle, Clock3, ExternalLink, MoreHorizontal, Sparkles, Star } from 'lucide-react';
import { memo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import type { ItemCard as Item } from '../api';
import { relativeTime } from '../lib/format';
import { prefersReducedMotion } from '../lib/platform';
import { EpssBadge, KevBadge, SeverityBadge, TechChip } from './Badges';

const THRESHOLD = 84;

interface Props {
  item: Item;
  onToggleRead: (item: Item) => void;
  onToggleStar: (item: Item) => void;
  onMarkReadUntil: (item: Item) => void;
  onTech?: (name: string) => void;
}

/**
 * Carte d'item. Gestes : glisser vers la droite → lu / non lu, vers la gauche → favori.
 * Les mêmes actions sont accessibles au clavier et à la souris (bouton étoile, menu « … »).
 */
export const ItemCard = memo(function ItemCard({ item, onToggleRead, onToggleStar, onMarkReadUntil, onTech }: Props) {
  const navigate = useNavigate();
  const [dx, setDx] = useState(0);
  const [menu, setMenu] = useState(false);
  const start = useRef<{ x: number; y: number; id: number; locked: 'h' | 'v' | null } | null>(null);
  const moved = useRef(false);
  const href = item.kind === 'vuln' && item.vulnId ? `/vuln/${encodeURIComponent(item.vulnId)}` : `/item/${item.id}`;

  const onDown = (e: RPointerEvent) => {
    if (e.pointerType === 'mouse') return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId, locked: null };
    moved.current = false;
  };
  const onMove = (e: RPointerEvent) => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    const ddx = e.clientX - s.x;
    const ddy = e.clientY - s.y;
    if (!s.locked) {
      if (Math.abs(ddx) < 8 && Math.abs(ddy) < 8) return;
      s.locked = Math.abs(ddx) > Math.abs(ddy) * 1.3 ? 'h' : 'v';
      if (s.locked === 'h') (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    if (s.locked === 'h') {
      moved.current = true;
      setDx(Math.max(-140, Math.min(140, ddx)));
    }
  };
  const onUp = () => {
    const s = start.current;
    start.current = null;
    if (s?.locked === 'h') {
      if (dx > THRESHOLD) onToggleRead(item);
      else if (dx < -THRESHOLD) onToggleStar(item);
      if (Math.abs(dx) > THRESHOLD && 'vibrate' in navigator) navigator.vibrate?.(8);
    }
    setDx(0);
  };

  const sev = item.severity;
  const armed = Math.abs(dx) > THRESHOLD;
  return (
    <article
      className="relative overflow-hidden rounded-2xl"
      aria-label={item.title}
      data-testid="item-card"
      data-read={item.read || undefined}
    >
      {/* Arrière-plan révélé par le swipe */}
      {dx !== 0 && (
        <div aria-hidden className={`absolute inset-0 flex items-center px-6 ${dx > 0 ? 'justify-start' : 'justify-end'} ${dx > 0 ? (armed ? 'bg-[#16a34a]' : 'bg-[#16a34a]/50') : armed ? 'bg-[#d97706]' : 'bg-[#d97706]/50'} text-white`}>
          {dx > 0 ? (
            <span className="flex items-center gap-2 font-semibold"><Check size={22} /> {item.read ? 'Non lu' : 'Lu'}</span>
          ) : (
            <span className="flex items-center gap-2 font-semibold">{item.starred ? 'Retirer' : 'Favori'} <Star size={22} /></span>
          )}
        </div>
      )}
      <div
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: dx === 0 && !prefersReducedMotion() ? 'transform 180ms ease-out' : undefined, touchAction: 'pan-y' }}
        className={`relative border bg-surface shadow-[var(--shadow)] ${item.read ? 'border-border/60' : 'border-border'} rounded-2xl`}
      >
        {sev && sev !== 'unknown' && <span aria-hidden className={`absolute top-3 bottom-3 left-0 w-[3px] rounded-r-full bar-${sev}`} />}
        <div className="flex items-start gap-1 py-3.5 pr-1.5 pl-4">
          <Link
            to={href}
            onClick={(e) => {
              if (moved.current) e.preventDefault();
            }}
            className="block min-w-0 flex-1 rounded-lg focus-visible:outline-offset-4"
          >
            <div className="mb-1.5 flex items-center gap-1.5 text-[0.8rem] text-muted">
              {!item.read && <Circle aria-label="Non lu" size={8} className="shrink-0 fill-accent text-accent" />}
              <span className="truncate font-medium">{item.feed.title}</span>
              <span aria-hidden>·</span>
              <time dateTime={new Date(item.publishedAt).toISOString()} className="shrink-0 tabular-nums">{relativeTime(item.publishedAt)}</time>
            </div>
            {item.kind === 'vuln' && item.vulnId && <div className="mb-0.5 font-mono text-[0.85rem] font-semibold text-muted">{item.vulnId}</div>}
            <h3 className={`text-[1.05rem] leading-snug font-semibold tracking-[-0.005em] ${item.read ? 'text-muted' : 'text-text'} line-clamp-3`}>{item.title}</h3>
            {((sev && sev !== 'unknown') || item.kev || (item.epss != null && item.epss >= 0.1)) && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {sev && sev !== 'unknown' && <SeverityBadge severity={sev} score={item.cvss} />}
                {item.kev && <KevBadge />}
                {item.epss != null && item.epss >= 0.1 && <EpssBadge epss={item.epss} />}
                {item.kind !== 'vuln' && item.vulnIds.length > 0 && (
                  <span className="font-mono text-[0.75rem] text-faint">{item.vulnIds.slice(0, 2).join(' · ')}{item.vulnIds.length > 2 ? ` +${item.vulnIds.length - 2}` : ''}</span>
                )}
              </div>
            )}
            {item.aiSummary ? (
              <p className={`mt-1.5 flex gap-1.5 text-[0.93rem] leading-relaxed ${item.read ? 'text-faint' : 'text-muted'}`}>
                <Sparkles aria-label="Résumé IA" size={14} className="mt-1 shrink-0 text-accent" />
                <span className="line-clamp-2">{item.aiSummary}</span>
              </p>
            ) : (
              item.excerpt && <p className={`mt-1.5 text-[0.93rem] leading-relaxed ${item.read ? 'text-faint' : 'text-muted'} line-clamp-2`}>{item.excerpt}</p>
            )}
          </Link>
          <div className="flex flex-col items-center">
            <button
              type="button"
              onClick={() => onToggleStar(item)}
              aria-pressed={item.starred}
              aria-label={item.starred ? 'Retirer des favoris' : 'Ajouter aux favoris'}
              className={`inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-surface-2 ${item.starred ? 'text-[#f59e0b]' : 'text-faint'}`}
            >
              <Star size={20} className={item.starred ? 'fill-current' : ''} />
            </button>
            <div className="relative">
              <button type="button" aria-label="Plus d’actions" aria-expanded={menu} onClick={() => setMenu((m) => !m)} className="inline-flex h-11 w-11 items-center justify-center rounded-full text-faint hover:bg-surface-2">
                <MoreHorizontal size={20} />
              </button>
              {menu && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setMenu(false)} aria-hidden />
                  <div role="menu" className="absolute top-10 right-1 z-40 w-64 overflow-hidden rounded-xl border border-border bg-surface-2 py-1 shadow-xl">
                    <MenuItem icon={<Check size={18} />} onClick={() => { setMenu(false); onToggleRead(item); }}>{item.read ? 'Marquer comme non lu' : 'Marquer comme lu'}</MenuItem>
                    <MenuItem icon={<Clock3 size={18} />} onClick={() => { setMenu(false); onMarkReadUntil(item); }}>Tout marquer lu jusqu’ici</MenuItem>
                    {item.url && <MenuItem icon={<ExternalLink size={18} />} onClick={() => { setMenu(false); window.open(item.url ?? '', '_blank', 'noopener,noreferrer'); }}>Ouvrir l’original</MenuItem>}
                    {item.kind === 'vuln' && item.vulnId && <MenuItem icon={<ExternalLink size={18} />} onClick={() => navigate(href)}>Voir la fiche</MenuItem>}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        {item.techs.length > 0 && (
          <div className="-mt-1.5 flex flex-wrap gap-1.5 pr-4 pb-3.5 pl-4">
            {item.techs.slice(0, 5).map((t) => (
              <TechChip key={t.name} tech={t} onClick={onTech ? () => onTech(t.name) : undefined} />
            ))}
          </div>
        )}
      </div>
    </article>
  );
});

function MenuItem({ icon, children, onClick }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="flex min-h-11 w-full items-center gap-3 px-4 text-left text-[0.95rem] hover:bg-surface-3">
      <span className="text-muted">{icon}</span>
      {children}
    </button>
  );
}
