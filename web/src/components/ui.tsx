import { ChevronLeft, Loader2 } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

export function Spinner({ size = 20, label = 'Chargement' }: { size?: number; label?: string }) {
  return <Loader2 role="status" aria-label={label} size={size} className="animate-spin-slow text-muted" />;
}

export function PageHeader({ title, back, actions, subtitle, width = 'max-w-3xl' }: { title: ReactNode; back?: boolean | string; actions?: ReactNode; subtitle?: ReactNode; width?: string }) {
  const navigate = useNavigate();
  return (
    <header className="pt-safe sticky top-0 z-20 border-b border-border/70 bg-bg/85 backdrop-blur-xl supports-[backdrop-filter]:bg-bg/75">
      <div className={`px-safe mx-auto flex min-h-14 ${width} items-center gap-1`}>
        {back && (
          <button
            type="button"
            onClick={() => (typeof back === 'string' ? navigate(back) : window.history.length > 1 ? navigate(-1) : navigate('/priority'))}
            className="-ml-2 inline-flex h-11 min-w-11 items-center justify-center rounded-full text-accent hover:bg-surface-2"
            aria-label="Retour"
          >
            <ChevronLeft size={26} />
          </button>
        )}
        <div className="min-w-0 flex-1 py-2">
          <h1 className="truncate text-[1.375rem] leading-tight font-bold tracking-tight">{title}</h1>
          {subtitle && <div className="truncate text-sm text-muted">{subtitle}</div>}
        </div>
        {actions && <div className="-mr-2 flex items-center">{actions}</div>}
      </div>
    </header>
  );
}

export function IconButton({ label, children, active, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-surface-2 disabled:opacity-40 ${active ? 'text-accent' : 'text-muted'} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Button({ variant = 'secondary', className = '', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  const styles = {
    primary: 'bg-accent text-bg hover:opacity-90 font-semibold',
    secondary: 'bg-surface-2 text-text hover:bg-surface-3 border border-border',
    danger: 'bg-transparent text-danger border border-danger/50 hover:bg-danger/10',
    ghost: 'text-accent hover:bg-accent-bg',
  }[variant];
  return (
    <button type="button" className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-[0.95rem] font-medium transition disabled:opacity-50 ${styles} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean }) {
  return (
    <label className={`flex min-h-12 cursor-pointer items-center gap-4 py-2 ${disabled ? 'opacity-50' : ''}`}>
      <span className="min-w-0 flex-1">
        <span className="block">{label}</span>
        {description && <span className="block text-sm text-muted">{description}</span>}
      </span>
      <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span
        aria-hidden
        className="relative h-7 w-12 shrink-0 rounded-full bg-surface-3 transition-colors peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent after:absolute after:top-0.5 after:left-0.5 after:h-6 after:w-6 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5"
      />
    </label>
  );
}

export function Section({ title, children, footer, id }: { title?: ReactNode; children: ReactNode; footer?: ReactNode; id?: string }) {
  return (
    <section id={id} className="mt-7 first:mt-4">
      {title && <h2 className="mb-2 px-1 text-[0.8rem] font-semibold tracking-[0.06em] text-muted uppercase">{title}</h2>}
      <div className="divide-y divide-border rounded-2xl border border-border bg-surface px-4">{children}</div>
      {footer && <p className="mt-2 px-1 text-sm text-muted">{footer}</p>}
    </section>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <div className="mb-4 rounded-full bg-surface-2 p-4 text-muted">{icon}</div>
      <p className="text-lg font-semibold">{title}</p>
      {children && <div className="mt-1 max-w-sm text-muted">{children}</div>}
    </div>
  );
}

// ───────── Toasts ─────────
interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error' | 'ok';
  action?: { label: string; run: () => void };
}
const ToastCtx = createContext<(t: Omit<Toast, 'id'>) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((l) => [...l.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((l) => l.filter((x) => x.id !== id)), t.action ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4 min-[900px]:bottom-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex max-w-md items-center gap-3 rounded-xl border px-4 py-3 text-[0.95rem] shadow-lg ${
              t.tone === 'error' ? 'border-danger/40 bg-surface text-danger' : 'border-border bg-surface-3 text-text'
            }`}
          >
            <span>{t.text}</span>
            {t.action && (
              <button type="button" className="min-h-9 shrink-0 rounded-lg px-2 font-semibold text-accent" onClick={t.action.run}>
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
