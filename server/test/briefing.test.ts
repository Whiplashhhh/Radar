import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildBriefingPrompt, fallbackSummary } from '../src/services/briefing';
import { cleanSummary } from '../src/services/ollama';
import { addFeed, setup, setupApp } from './helpers';

/** Faux serveur Ollama local (/api/generate, /api/tags). */
let prompts: string[] = [];
let ollamaUrl = '';
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'llama3.2:latest' }] }));
    const { prompt } = JSON.parse(body) as { prompt: string };
    prompts.push(prompt);
    const out = prompt.includes('briefing')
      ? '<think>hmm</think>Matinée chargée : **CVE-2026-7001** touche **Spring**.\n\n## Sécurité\n- **CVE-2026-7001** (Spring) critique, à corriger.\n\n## Tech\n- Vue 3.6 sort.'
      : 'Voici le résumé : \n- Ligne un du résumé.\n- Ligne deux du résumé.\n- Ligne trois en trop.';
    res.end(JSON.stringify({ response: out }));
  });
});
beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  ollamaUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const now = Date.parse('2026-03-10T07:15:00Z'); // 08:15 Paris

function seedNews(ctx: ReturnType<typeof setup>) {
  const sec = addFeed(ctx.db, { url: 'https://sec.test', title: 'BleepingComputer', category: 'security', lastSuccessAt: now - 1 });
  const tech = addFeed(ctx.db, { url: 'https://tech.test', title: 'Next', category: 'tech', lastSuccessAt: now - 1 });
  ctx.services.pipeline.ingest(sec, { notModified: false, items: [{ guid: 'a', url: 'https://sec.test/a', title: 'Spring Framework CVE-2026-7001 exploited in the wild', publishedAt: now - 3600_000 }], vulns: [] });
  ctx.services.pipeline.ingest(tech, { notModified: false, items: [{ guid: 'b', url: 'https://tech.test/b', title: 'Vue.js 3.6 est disponible avec Vapor mode', summaryHtml: `<p>${'Long texte. '.repeat(200)}</p>`, publishedAt: now - 7200_000 }], vulns: [] });
}

describe('briefing', () => {
  it('prompt : sections, technos, consignes', () => {
    const p = buildBriefingPrompt(
      [{ id: 1, title: 'Spring RCE', summary_html: '<p>x</p>', kind: 'article', score: 80, severity: 'critical', kev: 1, techs: '[{"name":"Spring"}]', ai_summary: null, category: 'security', feed_title: 'BC' }],
      now - 86_400_000,
      now,
      'Europe/Paris',
    );
    expect(p).toContain('### Sécurité (1)');
    expect(p).toContain('touche : Spring');
    expect(p).toContain('exploitée (KEV)');
    expect(p).toContain('N’invente rien');
  });

  it('repli sans IA', () => {
    const s = fallbackSummary([{ category: 'security', label: 'Sécurité', items: [{ id: 1, title: 'T', source: 'S', score: 1, techs: ['Spring'] }] }], 1);
    expect(s).toBe('1 élément depuis le dernier briefing.\n\n## Sécurité\n- **Spring** · T _(S)_');
  });

  it('cleanSummary garde 2 lignes, retire préambule et <think>', () => {
    expect(cleanSummary('<think>x</think>Voici le résumé :\n- a\n- b\n- c')).toBe('a\nb');
  });

  it('sans Ollama : briefing de repli, rien si aucune actu', async () => {
    const ctx = setup({ now: () => now });
    expect(await ctx.services.briefings.generate()).toBeNull();
    seedNews(ctx);
    const b = await ctx.services.briefings.generate();
    expect(b?.model).toBeNull();
    expect(b?.itemCount).toBe(2); // la CVE seulement citée n'a pas de carte avant enrichissement NVD
    expect(b?.summary).toContain('## Sécurité');
    expect(b?.sections.map((s) => s.category)).toEqual(['security', 'tech']);
    // période suivante : rien de neuf → pas de briefing
    expect(await ctx.services.briefings.generate()).toBeNull();
  });

  it('avec Ollama : briefing IA, résumés d’articles longs, digest qui pointe vers le briefing', async () => {
    prompts = [];
    const ctx = setup({ now: () => now });
    Object.assign(ctx.config, { ollamaUrl, ollamaModel: 'llama3.2' });
    seedNews(ctx);
    expect(await ctx.services.summarizer.tick()).toBeGreaterThan(0);
    const { items } = await import('../src/db/schema');
    const long = ctx.db.select().from(items).all().find((i) => i.title.startsWith('Vue'));
    expect(long?.aiSummary).toBe('Ligne un du résumé.\nLigne deux du résumé.');

    const payload = await ctx.services.notifier.digest();
    expect(payload?.title).toMatch(/^☀️ Briefing du matin/);
    expect(payload?.url).toMatch(/^\/briefing\/\d+$/);
    expect(payload?.body).toContain('📝 Matinée chargée');
    const b = ctx.services.briefings.latest();
    expect(b?.model).toBe('llama3.2');
    expect(b?.summary).not.toContain('<think>');
    expect(prompts.some((p) => p.includes('Spring Framework CVE-2026-7001'))).toBe(true);
    expect(await ctx.services.summarizer.status()).toMatchObject({ reachable: true, modelAvailable: true });
  });

  it('Ollama injoignable : repli et erreur notée', async () => {
    const ctx = setup({ now: () => now });
    Object.assign(ctx.config, { ollamaUrl: 'http://127.0.0.1:9' });
    seedNews(ctx);
    const b = await ctx.services.briefings.generate();
    expect(b?.model).toBeNull();
    expect(b?.error).toBeTruthy();
    expect((await ctx.services.summarizer.status()).reachable).toBe(false);
  });

  it('API briefings', async () => {
    const ctx = await setupApp({ now: () => now });
    expect((await ctx.app.inject('/api/briefings/latest')).statusCode).toBe(404);
    seedNews(ctx);
    const g = (await ctx.app.inject({ method: 'POST', url: '/api/briefings/generate' })).json();
    expect(g.created).toBe(true);
    const list = (await ctx.app.inject('/api/briefings')).json();
    expect(list).toHaveLength(1);
    expect((await ctx.app.inject('/api/stats')).json().briefingUnread).toBe(1);
    await ctx.app.inject({ method: 'POST', url: `/api/briefings/${list[0].id}/read` });
    expect((await ctx.app.inject('/api/stats')).json().briefingUnread).toBe(0);
    expect((await ctx.app.inject('/api/ollama/status')).json()).toMatchObject({ configured: false });
    await ctx.app.close();
  });
});
