import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { notifications, pushSubscriptions } from '../src/db/schema';
import { classifyVuln, groupPayload, isCritical, vulnPayload } from '../src/services/notifier';
import { defaultSettings, updateSettings } from '../src/services/settings';
import { addFeed, setup } from './helpers';

const N = defaultSettings.notifications;
const D = defaultSettings.digest;
const base = { severity: 'high' as const, cvssScore: 7.5, kev: false, epss: null, matchLevel: 'certain' as const };

describe('règles de notification', () => {
  it('immédiat : matchée ET (CVSS ≥ 9 ou KEV ou EPSS élevé)', () => {
    expect(classifyVuln({ ...base, cvssScore: 9.1, severity: 'critical' }, N, D)).toBe('immediate');
    expect(classifyVuln({ ...base, kev: true }, N, D)).toBe('immediate');
    expect(classifyVuln({ ...base, epss: 0.4 }, N, D)).toBe('immediate');
    expect(classifyVuln({ ...base, matchLevel: 'probable', kev: true }, N, D)).toBe('immediate');
    expect(classifyVuln({ ...base, matchLevel: 'probable', kev: true }, { ...N, immediateRequireCertain: true }, D)).toBe('digest');
  });
  it('digest : matchée moyenne ou haute', () => {
    expect(classifyVuln(base, N, D)).toBe('digest');
    expect(classifyVuln({ ...base, severity: 'medium', cvssScore: 5 }, N, D)).toBe('digest');
    expect(classifyVuln({ ...base, severity: 'medium', cvssScore: 5 }, N, { ...D, includeMedium: false })).toBeNull();
    expect(classifyVuln({ ...base, severity: 'low', cvssScore: 2 }, N, D)).toBeNull();
  });
  it('rien : non matchée, même critique', () => {
    expect(classifyVuln({ ...base, matchLevel: null, cvssScore: 10, severity: 'critical', kev: true }, N, D)).toBeNull();
  });
  it('critique (contourne les heures calmes)', () => {
    expect(isCritical({ ...base, kev: true })).toBe(true);
    expect(isCritical({ ...base, cvssScore: 9.8 })).toBe(true);
    expect(isCritical({ ...base, cvssScore: 9.8, matchLevel: 'probable' })).toBe(false);
    expect(isCritical(base)).toBe(false);
  });
  it('payload autonome : titre, sévérité, techno, lien vers la fiche', () => {
    const p = vulnPayload({ id: 'CVE-2026-1', title: 'RCE in actuator', severity: 'critical', cvssScore: 9.8, kev: true }, ['Spring']);
    expect(p.title).toBe('🔴 CVE-2026-1 · Critique 9.8 · KEV');
    expect(p.body).toBe('Spring — RCE in actuator');
    expect(p.url).toBe('/vuln/CVE-2026-1');
  });
  it('regroupe une rafale', () => {
    const p = groupPayload(
      ['1', '2', '3', '4'].map((i) => ({ kind: 'vuln' as const, id: `CVE-2026-${i}`, severity: 'critical' as const, techs: [i === '1' ? 'Spring' : 'Vue.js'], label: `CVE-2026-${i}` })),
    );
    expect(p.title).toBe('🔴 4 nouvelles CVE critiques');
    expect(p.body).toContain('Spring, Vue.js');
    expect(p.body).toContain('… et 1 autre');
    expect(p.url).toBe('/priority');
  });
});

describe('Notifier (intégration)', () => {
  function world(start: number) {
    let t = start;
    const ctx = setup({ now: () => t });
    ctx.db.insert(pushSubscriptions).values({ endpoint: 'https://push.test/a', p256dh: 'p256dh-key-xxxxxxxx', auth: 'auth-key' }).run();
    ctx.db.insert(pushSubscriptions).values({ endpoint: 'https://push.test/gone', p256dh: 'p256dh-key-xxxxxxxx', auth: 'auth-key' }).run();
    ctx.pushStatus.set('https://push.test/gone', 410);
    const feed = addFeed(ctx.db, { url: 'https://gh.test', adapter: 'github-advisories', lastSuccessAt: start - 1000 });
    const addVuln = (id: string, extra: Record<string, unknown> = {}) =>
      ctx.services.pipeline.ingest(feed, {
        notModified: false,
        items: [],
        vulns: [{ id, title: `Bug ${id}`, severity: 'critical', cvssScore: 9.8, affected: [{ ecosystem: 'maven', package: 'org.springframework:spring-web' }], sourceUrl: `https://gh.test/${id}`, surface: true, publishedAt: t, ...extra }],
      });
    return { ...ctx, feed, addVuln, advance: (ms: number) => (t += ms), now: () => t };
  }

  it('regroupe une rafale, respecte la fenêtre et supprime les abonnements expirés (410)', async () => {
    const w = world(Date.parse('2026-03-10T10:00:00Z')); // 11:00 Paris
    w.addVuln('CVE-2026-1001');
    w.addVuln('CVE-2026-1002');
    w.addVuln('CVE-2026-1003');
    expect(await w.services.notifier.dispatch()).toBeNull(); // fenêtre de regroupement
    w.advance(61_000);
    const r = await w.services.notifier.dispatch();
    expect(r).toEqual({ sent: 1, grouped: 3 });
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]?.payload.title).toBe('🔴 3 nouvelles CVE critiques');
    expect(w.sent[0]?.payload.techs).toEqual(['Spring']);
    expect(w.db.select().from(pushSubscriptions).all().map((s) => s.endpoint)).toEqual(['https://push.test/a']);
    // intervalle minimal entre deux pushs
    w.addVuln('CVE-2026-1004');
    w.advance(61_000);
    expect(await w.services.notifier.dispatch()).toBeNull();
    w.advance(300_000);
    expect((await w.services.notifier.dispatch())?.grouped).toBe(1);
    expect(w.sent[1]?.payload.url).toBe('/vuln/CVE-2026-1004');
    // pas de doublon
    w.addVuln('CVE-2026-1004', { epss: 0.9 });
    w.advance(600_000);
    expect(await w.services.notifier.dispatch()).toBeNull();
  });

  it('heures calmes : non critique décalée, critique envoyée', async () => {
    const w = world(Date.parse('2026-03-10T22:30:00Z')); // 23:30 Paris
    // probable seulement (pas critique) : KEV + mot-clé
    w.services.pipeline.ingest(w.feed, { notModified: false, items: [], vulns: [{ id: 'CVE-2026-2001', title: 'Tailscale client bug', severity: 'high', cvssScore: 8, kev: true, kevAddedAt: '2026-03-10', sourceUrl: 'https://gh.test/x', surface: true, publishedAt: w.now() }] });
    w.addVuln('CVE-2026-2002'); // certain + 9.8 → critique
    const rows = w.db.select().from(notifications).all();
    const quiet = rows.find((r) => r.targetId === 'CVE-2026-2001');
    expect(quiet?.critical).toBe(false);
    expect(quiet?.notBefore).toBe(Date.parse('2026-03-11T06:00:00Z'));
    w.advance(61_000);
    await w.services.notifier.dispatch();
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]?.payload.url).toBe('/vuln/CVE-2026-2002');
  });

  it('digest quotidien à l’heure configurée, une seule fois', async () => {
    const w = world(Date.parse('2026-03-10T06:30:00Z')); // 07:30 Paris
    w.services.pipeline.ingest(w.feed, { notModified: false, items: [], vulns: [{ id: 'CVE-2026-3001', title: 'Medium in spring', severity: 'medium', cvssScore: 5.4, affected: [{ ecosystem: 'maven', package: 'org.springframework:spring-core' }], sourceUrl: 'https://gh.test/m', surface: true, publishedAt: w.now() }] });
    expect(w.db.select().from(notifications).where(eq(notifications.targetId, 'CVE-2026-3001')).get()?.tier).toBe('digest');
    expect(await w.services.notifier.digest()).toBeNull(); // 07:30 < 08:00
    w.advance(45 * 60_000); // 08:15
    const p = await w.services.notifier.digest();
    expect(p?.title).toContain('1 CVE');
    expect(p?.body).toContain('CVE-2026-3001');
    expect(await w.services.notifier.digest()).toBeNull();
    updateSettings(w.db, { digest: { enabled: false } });
  });

  it('pas de notif pour l’import initial (quiet)', async () => {
    const w = world(Date.parse('2026-03-10T10:00:00Z'));
    const fresh = addFeed(w.db, { url: 'https://first.test', adapter: 'github-advisories' });
    w.services.pipeline.ingest(fresh, { notModified: false, items: [], vulns: [{ id: 'CVE-2026-4001', severity: 'critical', cvssScore: 10, affected: [{ ecosystem: 'npm', package: 'vue' }], sourceUrl: 'u', surface: true }] });
    expect(w.db.select().from(notifications).get()?.status).toBe('skipped');
  });
});
