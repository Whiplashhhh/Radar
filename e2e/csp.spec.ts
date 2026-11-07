import { expect, test } from '@playwright/test';

test('aucune violation CSP sur les écrans principaux', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  for (const path of ['/priority', '/vuln/CVE-2026-41022', '/briefing', '/settings', '/settings/feeds']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }
  const id = (await (await page.request.get('/api/items?view=all&q=Actuator')).json()).items[0].id;
  await page.goto(`/item/${id}`);
  await page.waitForLoadState('networkidle');
  expect(violations).toEqual([]);
});
