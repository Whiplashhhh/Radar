/** Génère les icônes PNG de la PWA à partir du SVG (rendu par Chromium/Playwright). Usage : npx tsx scripts/gen-icons.ts */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const dir = path.resolve('web/public/icons');
const svg = fs.readFileSync(path.join(dir, 'favicon.svg'), 'utf8');
const inner = svg.replace(/<svg[^>]*>/, '').replace('</svg>', '');

// Maskable : fond plein, motif réduit dans la zone de sécurité (80 %).
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#0b0d12"/><g transform="translate(51.2 51.2) scale(0.8)">${inner.replace(/<rect[^>]*\/>/, '')}</g></svg>`;
// Badge Android : silhouette monochrome blanche sur transparent.
const badge = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><g fill="none" stroke="#fff" stroke-linecap="round"><circle cx="256" cy="256" r="170" stroke-width="44"/><path d="M256 256 L380 150" stroke-width="52"/></g><circle cx="256" cy="256" r="46" fill="#fff"/></svg>`;
// Apple : pas de transparence ni coins arrondis (iOS les applique).
const apple = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#0b0d12"/>${inner.replace(/<rect[^>]*\/>/, '')}</svg>`;

const jobs: [string, string, number][] = [
  ['icon-192.png', svg, 192],
  ['icon-512.png', svg, 512],
  ['maskable-512.png', maskable, 512],
  ['apple-touch-icon.png', apple, 180],
  ['badge-96.png', badge, 96],
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [name, content, size] of jobs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${content.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.locator('svg').first().screenshot({ path: path.join(dir, name), omitBackground: true });
  console.log('ok', name);
}
await browser.close();
