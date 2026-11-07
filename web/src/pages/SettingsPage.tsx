import { useMutation, useQuery } from '@tanstack/react-query';
import { Bell, BellOff, ChevronRight, Info, ListChecks, Moon, Rss, Send, Sparkles, Sun, SunMoon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, type Settings } from '../api';
import { Button, PageHeader, Section, Spinner, Toggle, useToast } from '../components/ui';
import { useSaveSettings, useSettings, useStats } from '../hooks';
import { needsInstallForPush, pushSupported } from '../lib/platform';
import { currentSubscription, disablePush, enablePush } from '../lib/push';
import { getThemePref, setThemePref, type ThemePref } from '../lib/theme';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export function SettingsPage() {
  const { data: s } = useSettings();
  const save = useSaveSettings();
  const toast = useToast();
  const patch = (p: DeepPartial<Settings>) => save.mutate(p, { onError: (e) => toast({ text: (e as Error).message, tone: 'error' }) });

  return (
    <>
      <PageHeader width="max-w-2xl" title="Réglages" />
      <main className="px-safe pb-tabbar mx-auto max-w-2xl">
        <PushSection />
        {!s ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : (
          <>
            <Section title="Push immédiat" footer="Une CVE qui touche votre watchlist part tout de suite si elle remplit au moins un critère. Les rafales sont regroupées en une seule notification.">
              <Toggle label="Notifications activées" checked={s.notifications.enabled} onChange={(v) => patch({ notifications: { enabled: v } })} />
              <NumberRow label="CVSS minimum" suffix="/ 10" step={0.1} min={0} max={10} value={s.notifications.immediateCvssMin} onSave={(v) => patch({ notifications: { immediateCvssMin: v } })} />
              <Toggle label="Exploitée activement (KEV)" checked={s.notifications.immediateOnKev} onChange={(v) => patch({ notifications: { immediateOnKev: v } })} />
              <NumberRow label="EPSS minimum" suffix="%" step={1} min={0} max={100} value={Math.round(s.notifications.immediateEpssMin * 100)} onSave={(v) => patch({ notifications: { immediateEpssMin: v / 100 } })} />
              <Toggle label="Exiger un match certain" description="Sinon, un match probable (mot-clé) suffit." checked={s.notifications.immediateRequireCertain} onChange={(v) => patch({ notifications: { immediateRequireCertain: v } })} />
              <Toggle label="Alertes CERT-FR" checked={s.notifications.certFrAlerts} onChange={(v) => patch({ notifications: { certFrAlerts: v } })} />
              <NumberRow label="Regrouper les rafales sur" suffix="s" step={10} min={0} max={3600} value={s.notifications.groupWindowSec} onSave={(v) => patch({ notifications: { groupWindowSec: v } })} />
              <NumberRow label="Intervalle minimal entre deux notifs" suffix="s" step={30} min={0} max={3600} value={s.notifications.minIntervalSec} onSave={(v) => patch({ notifications: { minIntervalSec: v } })} />
            </Section>

            <Section title="Le matin" footer="À cette heure, Radar génère le briefing (toutes les actus depuis le précédent) et envoie une seule notification avec le digest : CVE matchées de sévérité moyenne ou haute et top des actus.">
              <TimeRow label="Heure" value={s.digest.time} onSave={(v) => patch({ digest: { time: v } })} />
              <Toggle label="Briefing du matin" description="Résumé rédigé par Ollama (ou version sans IA)." checked={s.briefing.enabled} onChange={(v) => patch({ briefing: { enabled: v } })} />
              <Toggle label="Notification du digest" checked={s.digest.enabled} onChange={(v) => patch({ digest: { enabled: v } })} />
              <Toggle label="Inclure les CVE moyennes" checked={s.digest.includeMedium} onChange={(v) => patch({ digest: { includeMedium: v } })} />
              <NumberRow label="Top des actus" suffix="articles" step={1} min={0} max={20} value={s.digest.topNews} onSave={(v) => patch({ digest: { topNews: v } })} />
              <LinkRow to="/briefing" icon={<Sparkles size={19} />} label="Voir les briefings" />
            </Section>

            <Section title="Heures calmes" footer="Les notifications non critiques sont décalées à la fin de la plage. Critique = KEV ou CVSS ≥ 9 sur une techno certaine.">
              <Toggle label="Activer" checked={s.quietHours.enabled} onChange={(v) => patch({ quietHours: { enabled: v } })} />
              <TimeRow label="Début" value={s.quietHours.start} onSave={(v) => patch({ quietHours: { start: v } })} />
              <TimeRow label="Fin" value={s.quietHours.end} onSave={(v) => patch({ quietHours: { end: v } })} />
            </Section>

            <Section title="Sources et watchlist">
              <LinkRow to="/settings/watchlist" icon={<ListChecks size={19} />} label="Watchlist des technos" />
              <LinkRow to="/settings/feeds" icon={<Rss size={19} />} label="Flux et santé des flux" />
            </Section>

            <OllamaSection />

            <Section title="Affichage">
              <ThemeRow />
              <NumberRow label="Seuil « Prioritaire »" suffix="/ 100" step={5} min={0} max={100} value={s.feed.priorityThreshold} onSave={(v) => patch({ feed: { priorityThreshold: v } })} />
              <NumberRow label="Hacker News : points minimum" suffix="pts" step={10} min={0} max={5000} value={s.feed.hnMinPoints} onSave={(v) => patch({ feed: { hnMinPoints: v } })} />
            </Section>

            <Section title="Rétention" footer="Les éléments lus plus anciens sont purgés chaque jour, sauf les favoris et les fiches CVE qui touchent la watchlist.">
              <NumberRow label="Conserver les éléments lus" suffix="jours" step={1} min={1} max={3650} value={s.retention.days} onSave={(v) => patch({ retention: { days: v } })} />
            </Section>
            <About />
          </>
        )}
      </main>
    </>
  );
}

function PushSection() {
  const toast = useToast();
  const navigate = useNavigate();
  const stats = useStats();
  const [sub, setSub] = useState<PushSubscription | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void currentSubscription().then(setSub).catch(() => setSub(null));
  }, []);
  const permission = typeof Notification !== 'undefined' ? Notification.permission : 'default';

  const enable = async () => {
    // Geste utilisateur : la demande de permission se fait ici, jamais au chargement.
    if (needsInstallForPush()) return navigate('/install');
    setBusy(true);
    try {
      setSub(await enablePush());
      toast({ text: 'Notifications activées sur cet appareil', tone: 'ok' });
      void stats.refetch();
    } catch (e) {
      toast({ text: (e as Error).message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const test = useMutation({
    mutationFn: () => api.testPush(),
    onSuccess: (r) => toast({ text: r.sent ? `Notification envoyée à ${r.sent} appareil${r.sent > 1 ? 's' : ''}` : 'Aucun appareil joignable', tone: r.sent ? 'ok' : 'error' }),
    onError: (e: Error) => toast({ text: e.message, tone: 'error' }),
  });

  const devices = stats.data?.pushDevices ?? 0;
  return (
    <Section title="Notifications sur cet appareil" footer={`${devices} appareil${devices > 1 ? 's' : ''} abonné${devices > 1 ? 's' : ''}. Le contenu des notifications est autonome : il s’affiche même hors du tailnet.`}>
      <div className="flex items-center gap-3 py-3">
        {sub ? <Bell size={22} className="text-ok" /> : <BellOff size={22} className="text-muted" />}
        <div className="min-w-0 flex-1">
          <p className="font-medium">{sub ? 'Activées' : sub === undefined ? '…' : 'Désactivées'}</p>
          <p className="text-sm text-muted">
            {!pushSupported() && !needsInstallForPush()
              ? 'Ce navigateur ne gère pas le push.'
              : needsInstallForPush()
                ? 'Sur iPhone, installez d’abord Radar sur l’écran d’accueil.'
                : permission === 'denied'
                  ? 'Permission refusée dans les réglages du système.'
                  : sub
                    ? 'Vous recevrez les alertes et le briefing du matin.'
                    : 'Activez-les pour être prévenu des CVE critiques.'}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 py-3">
        {sub ? (
          <>
            <Button variant="primary" onClick={() => test.mutate()} disabled={test.isPending}><Send size={17} /> Envoyer une notif de test</Button>
            <Button variant="ghost" onClick={async () => { await disablePush(); setSub(null); void stats.refetch(); }}>Désactiver</Button>
          </>
        ) : (
          <>
            <Button variant="primary" onClick={() => void enable()} disabled={busy || (permission === 'denied' && !needsInstallForPush())}>{busy ? <Spinner size={17} /> : <Bell size={17} />} Activer les notifications</Button>
            {devices > 0 && <Button onClick={() => test.mutate()} disabled={test.isPending}><Send size={17} /> Tester</Button>}
          </>
        )}
      </div>
    </Section>
  );
}

function OllamaSection() {
  const toast = useToast();
  const navigate = useNavigate();
  const { data, isPending } = useQuery({ queryKey: ['ollama'], queryFn: api.ollama, staleTime: 30_000 });
  const gen = useMutation({
    mutationFn: api.generateBriefing,
    onSuccess: (r) => (r.briefing ? navigate(`/briefing/${r.briefing.id}`) : toast({ text: 'Rien de nouveau depuis le dernier briefing', tone: 'info' })),
    onError: (e: Error) => toast({ text: e.message, tone: 'error' }),
  });
  const state = !data ? '…' : !data.configured ? 'Non configuré' : !data.reachable ? 'Injoignable' : !data.modelAvailable ? `Modèle « ${data.model} » absent` : 'Opérationnel';
  const tone = data?.configured && data.reachable && data.modelAvailable ? 'text-ok' : data?.configured ? 'text-warn' : 'text-muted';
  return (
    <Section
      title="IA locale (Ollama)"
      footer={data && !data.configured ? <>Définissez <code className="font-mono">OLLAMA_URL</code> (et <code className="font-mono">OLLAMA_MODEL</code>) pour des résumés de 2 lignes et un briefing rédigé. Sans Ollama, Radar fonctionne normalement.</> : data?.error ? `Erreur : ${data.error}` : data?.reachable && !data.modelAvailable ? `Lancez « ollama pull ${data.model} » sur la machine Ollama.` : undefined}
    >
      <div className="flex min-h-12 items-center gap-3 py-2">
        <Sparkles size={19} className="text-accent" />
        <span className="flex-1">Statut</span>
        {isPending ? <Spinner size={16} /> : <span className={`font-medium ${tone}`}>{state}</span>}
      </div>
      {data?.configured && (
        <div className="flex min-h-12 items-center gap-3 py-2">
          <span className="w-[19px]" />
          <span className="flex-1">Modèle</span>
          <span className="font-mono text-sm text-muted">{data.model}</span>
        </div>
      )}
      <div className="py-3">
        <Button onClick={() => gen.mutate()} disabled={gen.isPending}>{gen.isPending ? <Spinner size={17} /> : <Sparkles size={17} />} Générer un briefing maintenant</Button>
      </div>
    </Section>
  );
}

function ThemeRow() {
  const [pref, setPref] = useState<ThemePref>(getThemePref());
  const opts: { v: ThemePref; label: string; icon: ReactNode }[] = [
    { v: 'dark', label: 'Sombre', icon: <Moon size={16} /> },
    { v: 'light', label: 'Clair', icon: <Sun size={16} /> },
    { v: 'system', label: 'Système', icon: <SunMoon size={16} /> },
  ];
  return (
    <div className="flex min-h-12 flex-wrap items-center gap-3 py-2">
      <span className="flex-1">Thème</span>
      <div role="radiogroup" aria-label="Thème" className="inline-flex rounded-xl bg-surface-2 p-1">
        {opts.map((o) => (
          <button
            key={o.v}
            type="button"
            role="radio"
            aria-checked={pref === o.v}
            onClick={() => {
              setThemePref(o.v);
              setPref(o.v);
            }}
            className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm ${pref === o.v ? 'bg-surface font-semibold shadow-[var(--shadow)]' : 'text-muted'}`}
          >
            {o.icon} {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function NumberRow({ label, value, onSave, suffix, step = 1, min, max }: { label: string; value: number; onSave: (v: number) => void; suffix?: string; step?: number; min?: number; max?: number }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => {
    const n = Number(v.replace(',', '.'));
    if (Number.isFinite(n) && n !== value) onSave(n);
    else setV(String(value));
  };
  return (
    <label className="flex min-h-12 items-center gap-3 py-2">
      <span className="flex-1">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        min={min}
        max={max}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className="min-h-10 w-20 rounded-lg border border-border bg-surface-2 px-2 text-right tabular-nums"
      />
      {suffix && <span className="w-14 text-sm text-muted">{suffix}</span>}
    </label>
  );
}

function TimeRow({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }) {
  return (
    <label className="flex min-h-12 items-center gap-3 py-2">
      <span className="flex-1">{label}</span>
      <input type="time" value={value} onChange={(e) => e.target.value && onSave(e.target.value)} className="min-h-10 rounded-lg border border-border bg-surface-2 px-2 tabular-nums" />
    </label>
  );
}

function LinkRow({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
  return (
    <Link to={to} className="-mx-4 flex min-h-12 items-center gap-3 px-4 hover:bg-surface-2">
      <span className="text-accent">{icon}</span>
      <span className="flex-1">{label}</span>
      <ChevronRight size={18} className="text-faint" />
    </Link>
  );
}

function About() {
  const { data } = useStats();
  return (
    <p className="mt-8 mb-4 flex items-center justify-center gap-1.5 text-sm text-faint">
      <Info size={14} /> Radar {data?.version ?? ''} · fuseau {data?.timezone ?? 'Europe/Paris'}
    </p>
  );
}
