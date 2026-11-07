import { expect, test, type Page } from '@playwright/test';

/** Captures de chaque écran principal, thème sombre et clair, dans docs/screenshots/. */
const SCREENS: { name: string; path: string; ready: (p: Page) => Promise<void> }[] = [
  { name: 'prioritaire', path: '/priority', ready: async (p) => { await expect(p.getByTestId('item-card').first()).toBeVisible(); } },
  { name: 'securite', path: '/security', ready: async (p) => { await expect(p.getByTestId('item-card').first()).toBeVisible(); } },
  { name: 'tech', path: '/tech', ready: async (p) => { await expect(p.getByTestId('item-card').first()).toBeVisible(); } },
  { name: 'fiche-cve', path: '/vuln/CVE-2026-40417', ready: async (p) => { await expect(p.getByText('Versions affectées et corrigées')).toBeVisible(); } },
  { name: 'article', path: '/__bc1', ready: async (p) => { await expect(p.getByText('Spring Boot Actuator sous le feu')).toBeVisible(); } },
  { name: 'briefing', path: '/briefing', ready: async (p) => { await expect(p.getByText('Nuit agitée')).toBeVisible(); } },
  { name: 'reglages', path: '/settings', ready: async (p) => { await expect(p.getByText('Push immédiat')).toBeVisible(); } },
  { name: 'watchlist', path: '/settings/watchlist', ready: async (p) => { await expect(p.getByText('Spring', { exact: true })).toBeVisible(); } },
  { name: 'installation', path: '/install', ready: async (p) => { await expect(p.getByRole('heading', { name: 'Installer Radar' })).toBeVisible(); } },
  { name: 'flux', path: '/settings/feeds', ready: async (p) => { await expect(p.getByText('Santé des flux')).toBeVisible(); } },
];

for (const theme of ['dark', 'light'] as const) {
  for (const s of SCREENS) {
    test(`capture ${s.name} (${theme})`, async ({ page, request }, info) => {
      await page.addInitScript((t) => {
        localStorage.setItem('radar.theme', t);
        localStorage.setItem('radar.installBanner', 'hidden');
      }, theme);
      let path = s.path;
      if (path === '/__bc1') {
        const list = await (await request.get('/api/items?view=all&q=Actuator')).json();
        const it = list.items.find((i: { kind: string }) => i.kind === 'article');
        path = `/item/${it.id}`;
      }
      await page.goto(path);
      await s.ready(page);
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: `docs/screenshots/${info.project.name.replace('capture-', '')}-${s.name}-${theme}.png`, fullPage: info.project.name === 'desktop' ? false : false });
    });
  }
}
