import { and, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Config } from '../config';
import type { DB } from '../db/client';
import { items, vulns } from '../db/schema';
import { htmlToText, truncate } from '../lib/html';
import type { Logger } from '../lib/logger';
import { safeFetch } from '../lib/safe-fetch';

export const LONG_ARTICLE_CHARS = 1500;

export function buildPrompt(kind: 'article' | 'vuln', title: string, text: string): string {
  const what = kind === 'vuln' ? 'cette vulnérabilité (impact, produit, correctif si connu)' : 'cet article';
  return [
    `Résume ${what} en français, en exactement 2 lignes courtes (moins de 200 caractères au total).`,
    'Pas de préambule, pas de liste, pas de markdown.',
    '',
    `Titre : ${title}`,
    `Texte : ${truncate(text, 6000)}`,
  ].join('\n');
}

export function cleanSummary(s: string): string {
  return s
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/^(voici|résumé)\s*[^:\n]*:\s*/i, '')
    .split('\n')
    .map((l) => l.replace(/^[-*•\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, 2)
    .join('\n')
    .slice(0, 400);
}

/** Résumés Ollama (optionnel : inactif si OLLAMA_URL n'est pas défini). */
export class Summarizer {
  private busy = false;

  constructor(
    private readonly db: DB,
    private readonly config: Config,
    private readonly log: Logger,
    private readonly now: () => number = Date.now,
  ) {}

  get enabled(): boolean {
    return !!this.config.ollamaUrl;
  }

  get model(): string {
    return this.config.ollamaModel;
  }

  /** Appel brut à `/api/generate` (non streamé). */
  async generate(prompt: string, opts: { timeoutMs?: number; numCtx?: number; temperature?: number } = {}): Promise<string> {
    if (!this.config.ollamaUrl) throw new Error('OLLAMA_URL non défini');
    const res = await safeFetch(new URL('/api/generate', this.config.ollamaUrl).toString(), {
      method: 'POST',
      allowPrivate: true, // URL fournie par la configuration, pas par un flux
      timeoutMs: opts.timeoutMs ?? 120_000,
      maxBytes: 2 * 1024 * 1024,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.config.ollamaModel,
        prompt,
        stream: false,
        options: { temperature: opts.temperature ?? 0.2, ...(opts.numCtx ? { num_ctx: opts.numCtx } : {}) },
      }),
    });
    if (res.status >= 400) throw new Error(`Ollama HTTP ${res.status}`);
    return (res.json<{ response?: string }>().response ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  }

  async summarize(kind: 'article' | 'vuln', title: string, text: string): Promise<string | null> {
    if (!this.config.ollamaUrl) return null;
    const out = cleanSummary(await this.generate(buildPrompt(kind, title, text)));
    return out || null;
  }

  /** État d'Ollama pour l'écran Réglages. */
  async status(): Promise<{ configured: boolean; reachable: boolean; model: string; modelAvailable: boolean; models: string[]; error?: string }> {
    const base = { configured: this.enabled, reachable: false, model: this.config.ollamaModel, modelAvailable: false, models: [] as string[] };
    if (!this.config.ollamaUrl) return base;
    try {
      const res = await safeFetch(new URL('/api/tags', this.config.ollamaUrl).toString(), { allowPrivate: true, timeoutMs: 5000, maxBytes: 1024 * 1024 });
      if (res.status >= 400) return { ...base, error: `HTTP ${res.status}` };
      const models = (res.json<{ models?: { name: string }[] }>().models ?? []).map((m) => m.name);
      const want = this.config.ollamaModel;
      return { ...base, reachable: true, models, modelAvailable: models.some((m) => m === want || m === `${want}:latest` || m.split(':')[0] === want) };
    } catch (err) {
      return { ...base, error: (err as Error).message };
    }
  }

  async tick(batch = 3): Promise<number> {
    if (!this.enabled || this.busy) return 0;
    this.busy = true;
    let done = 0;
    try {
      const since = this.now() - 2 * 86_400_000;
      const arts = this.db
        .select({ id: items.id, title: items.title, summary: items.summaryHtml, content: items.contentHtml, readable: items.readableHtml })
        .from(items)
        .where(and(isNull(items.aiSummary), sql`${items.kind} != 'vuln'`, gt(items.fetchedAt, since), sql`length(coalesce(${items.contentHtml}, ${items.summaryHtml}, '')) > ${LONG_ARTICLE_CHARS}`))
        .orderBy(sql`${items.score} DESC`)
        .limit(batch)
        .all();
      for (const a of arts) {
        const text = htmlToText(a.readable ?? a.content ?? a.summary);
        const summary = text.length > LONG_ARTICLE_CHARS ? await this.summarize('article', a.title, text) : null;
        this.db.update(items).set({ aiSummary: summary ?? '' }).where(eq(items.id, a.id)).run();
        done++;
      }
      const vs = this.db
        .select({ id: vulns.id, title: vulns.title, description: vulns.description })
        .from(vulns)
        .innerJoin(items, and(eq(items.vulnId, vulns.id), eq(items.kind, 'vuln')))
        .where(and(isNull(vulns.aiSummary), isNotNull(vulns.description), gt(vulns.firstSeenAt, since)))
        .orderBy(sql`${vulns.score} DESC`)
        .limit(batch)
        .all();
      for (const v of vs) {
        const summary = await this.summarize('vuln', `${v.id} ${v.title ?? ''}`, v.description ?? '');
        this.db.update(vulns).set({ aiSummary: summary ?? '' }).where(eq(vulns.id, v.id)).run();
        done++;
      }
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, 'Ollama summarization failed');
    } finally {
      this.busy = false;
    }
    return done;
  }
}
