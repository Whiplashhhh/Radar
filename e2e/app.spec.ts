import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('radar.installBanner', 'hidden'));
});

const cards = (page: Page) => page.getByTestId('item-card');

test('sécurité : en-têtes HTTP (CSP, nosniff, referrer)', async ({ request }) => {
  const r = await request.get('/priority');
  expect(r.status()).toBe(200);
  const h = r.headers();
  expect(h['content-security-policy']).toContain("script-src 'self'");
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['referrer-policy']).toBe('no-referrer');
  expect((await request.get('/manifest.webmanifest')).status()).toBe(200);
});

test('navigation par onglets et compteur prioritaire', async ({ page }, info) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/priority$/);
  await expect(page.getByRole('heading', { name: 'Prioritaire', level: 1 })).toBeVisible();
  await expect(cards(page).first()).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Navigation principale' }).filter({ visible: true });
  for (const [label, path] of [['Sécurité', '/security'], ['Tech', '/tech'], ['Tout', '/all'], ['Réglages', '/settings']] as const) {
    await nav.getByRole('link', { name: label }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
  }
  if (info.project.name === 'desktop') {
    await nav.getByRole('link', { name: 'Briefing' }).click();
    await expect(page.getByText('Nuit agitée')).toBeVisible();
  }
});

test('fiche CVE : CVSS, EPSS, KEV, technos, versions, sources', async ({ page }) => {
  await page.goto('/vuln/CVE-2026-41022');
  await expect(page.getByText('8,1', { exact: true })).toBeVisible();
  await expect(page.getByText('Oui (KEV)')).toBeVisible();
  await expect(page.getByText('OpenSSH', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/vulnérable ≥ 8.5p1/)).toBeVisible();
  await expect(page.getByRole('link', { name: /Vulnérabilité dans OpenSSH/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Fiche NVD/ })).toHaveAttribute('href', 'https://nvd.nist.gov/vuln/detail/CVE-2026-41022');
});

test('ouvrir un article le marque comme lu ; favori ; vue lecture', async ({ page }) => {
  await page.goto('/all?q=Actuator');
  const card = cards(page).filter({ hasText: 'Hackers exploit' });
  await card.getByRole('link').first().click();
  await expect(page.getByRole('heading', { name: /Hackers exploit critical Spring Boot/ })).toBeVisible();
  await expect(page.getByText('Spring Boot Actuator sous le feu')).toBeVisible(); // version Readability
  await page.getByRole('tab', { name: 'Flux' }).click();
  await expect(page.getByText('Threat actors are actively scanning')).toBeVisible();
  await page.getByRole('button', { name: 'Ajouter aux favoris' }).click();
  await expect(page.getByRole('button', { name: 'Retirer des favoris' })).toBeVisible();
  await page.getByRole('button', { name: 'Retirer des favoris' }).click();
  await expect(page.getByRole('link', { name: /Lire l’original/ })).toHaveAttribute('href', /bleepingcomputer\.com/);
  await page.goBack();
  await expect(cards(page).filter({ hasText: 'Hackers exploit' })).toHaveAttribute('data-read', 'true');
});

test('recherche plein texte et filtre par techno', async ({ page }) => {
  await page.goto('/all');
  await page.getByRole('button', { name: 'Rechercher' }).click();
  await page.getByLabel('Recherche plein texte').fill('ollama');
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).first()).toContainText('Ollama 0.9');
  await expect(cards(page).first().getByLabel('Résumé IA')).toBeVisible();
  await page.getByRole('button', { name: 'Effacer' }).click();
  await cards(page).filter({ hasText: 'Vue compiler-sfc XSS' }).getByRole('button', { name: /Vue\.js/ }).click();
  await expect(page).toHaveURL(/tech=Vue\.js/);
  for (const c of await cards(page).all()) await expect(c).toContainText('Vue.js');
  await page.getByRole('button', { name: /Vue\.js.*retirer/ }).click();
  await expect(page).not.toHaveURL(/tech=/);
});

test('filtres : sévérité et favoris', async ({ page }) => {
  await page.goto('/all');
  await page.getByRole('button', { name: 'Filtres' }).click();
  const dialog = page.getByRole('dialog', { name: 'Filtres' });
  await dialog.getByRole('button', { name: 'Critique' }).click();
  await dialog.getByRole('button', { name: 'Voir les résultats' }).click();
  await expect(cards(page).first()).toBeVisible();
  for (const c of await cards(page).all()) await expect(c).toContainText('CRITIQUE');
  await page.getByRole('button', { name: 'Filtres' }).click();
  await dialog.getByRole('button', { name: 'Réinitialiser' }).click();
  await dialog.getByRole('button', { name: 'Favoris' }).click();
  await dialog.getByRole('button', { name: 'Voir les résultats' }).click();
  await expect(cards(page).filter({ hasText: 'SQLite 3.50' })).toBeVisible();
});

test('swipe : glisser à droite marque comme lu (tactile)', async ({ page }, info) => {
  test.skip(info.project.name !== 'iphone', 'geste tactile');
  await page.goto('/tech?unread=1');
  const card = cards(page).filter({ hasText: 'Rust in the kernel' });
  await expect(card).toBeVisible();
  const box = (await card.boundingBox())!;
  const surface = card.locator('div[style*="pan-y"]');
  const y = box.y + 30;
  const ev = (type: string, x: number) => surface.dispatchEvent(type, { pointerId: 7, pointerType: 'touch', clientX: x, clientY: y, isPrimary: true, bubbles: true });
  await ev('pointerdown', box.x + 40);
  for (const x of [60, 100, 140, 180, 220]) await ev('pointermove', box.x + x);
  await ev('pointerup', box.x + 220);
  await expect(card).toHaveAttribute('data-read', 'true');
});

test('tout marquer comme lu jusqu’ici', async ({ page }) => {
  await page.goto('/security');
  await expect(cards(page).first()).toBeVisible();
  const target = cards(page).nth(2);
  await target.getByRole('button', { name: 'Plus d’actions' }).click();
  await page.getByRole('menuitem', { name: 'Tout marquer lu jusqu’ici' }).click();
  await expect(page.getByText(/marqués? comme lus?/)).toBeVisible();
  for (let i = 0; i <= 2; i++) await expect(cards(page).nth(i)).toHaveAttribute('data-read', 'true');
});

test('briefing du matin : bannière, page, sections', async ({ page }) => {
  await page.goto('/priority');
  await page.getByRole('link', { name: /Briefing du matin/ }).click();
  await expect(page).toHaveURL(/\/briefing\/\d+$/);
  await expect(page.getByText('llama3.2')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sécurité', level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'À lire en détail' })).toBeVisible();
});

test('watchlist : ajouter une techno avec alias et package', async ({ page }, info) => {
  const name = `Gitea ${info.project.name}`;
  await page.goto('/settings/watchlist');
  await page.getByRole('link', { name: 'Ajouter une techno' }).click();
  await page.getByRole('textbox', { name: 'Nom', exact: true }).fill(name);
  const aliases = page.getByRole('textbox', { name: 'Alias / mots-clés' });
  await aliases.fill('Gitea, Forgejo');
  await aliases.press('Enter');
  const pkgs = page.getByRole('textbox', { name: 'Packages (écosystème:nom)' });
  await pkgs.fill('go:code.gitea.io/gitea');
  await pkgs.press('Enter');
  await expect(page.getByText('Forgejo')).toBeVisible();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page).toHaveURL(/\/settings\/watchlist$/);
  await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible();
});

test('réglages : modification persistée', async ({ page }) => {
  await page.goto('/settings');
  const quiet = page.locator('section', { hasText: 'Heures calmes' });
  await quiet.getByLabel('Début').fill('23:00');
  await expect.poll(async () => (await (await page.request.get('/api/settings')).json()).quietHours.start).toBe('23:00');
  await page.getByRole('radio', { name: /Clair/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('notifications : sur iPhone hors écran d’accueil → écran d’installation', async ({ page }, info) => {
  test.skip(info.project.name !== 'iphone', 'iOS');
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Activer les notifications' }).click();
  await expect(page).toHaveURL(/\/install$/);
  await expect(page.getByText('« Sur l’écran d’accueil »')).toBeVisible();
});

test('notifications : test sans appareil → message clair', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop');
  const r = await page.request.post('/api/push/test', { data: {} });
  expect(r.status()).toBe(409);
  expect((await r.json()).error).toBe('Aucun appareil abonné');
});

test('santé des flux et ajout invalide', async ({ page }) => {
  await page.goto('/settings/feeds');
  await expect(page.getByText(/en erreur/)).toBeVisible();
  await page.getByRole('button', { name: /Krebs on Security/ }).click();
  await expect(page.getByText('HTTP 503')).toBeVisible();
  await page.getByLabel('Ajouter un flux').fill('http://127.0.0.1:9/feed');
  await page.getByRole('button', { name: 'Ajouter' }).click();
  await expect(page.getByRole('alert')).toContainText(/non publique/); // anti-SSRF
});

test('mode hors-ligne : le fil et les favoris restent consultables', async ({ page, context }) => {
  await page.goto('/priority');
  await expect(cards(page).first()).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // Le SW contrôle la page après un rechargement ; on charge les vues à mettre en cache.
  await page.reload();
  await expect(cards(page).first()).toBeVisible();
  await page.goto('/all?starred=1');
  await expect(cards(page).first()).toBeVisible();
  await context.setOffline(true);
  await page.goto('/priority');
  await expect(cards(page).first()).toBeVisible();
  await expect(page.getByText(/Hors ligne/)).toBeVisible();
  await page.goto('/all?starred=1');
  await expect(cards(page).filter({ hasText: 'SQLite 3.50' })).toBeVisible();
  await context.setOffline(false);
});
