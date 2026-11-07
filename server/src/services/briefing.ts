import { and, desc, eq, gt, lte, sql } from 'drizzle-orm';
import type { DB } from '../db/client';
import { briefings, type Briefing, type BriefingSection, type Category } from '../db/schema';
import { htmlToText, truncate } from '../lib/html';
import type { Logger } from '../lib/logger';
import type { Summarizer } from './ollama';
import { getSettings } from './settings';

const DAY = 86_400_000;

export const SECTION_LABELS: Record<Category, string> = {
  security: 'Sécurité',
  releases: 'Releases',
  tech: 'Tech',
  news: 'Actus',
};
const SECTION_ORDER: Category[] = ['security', 'releases', 'tech', 'news'];

interface Row {
  id: number;
  title: string;
  summary_html: string | null;
  kind: string;
  score: number;
  severity: string | null;
  kev: number;
  techs: string;
  ai_summary: string | null;
  category: Category;
  feed_title: string;
}

/** Sections triées par score, `maxPerSection` items au plus chacune. */
export function buildSections(rows: Row[], maxPerSection: number): BriefingSection[] {
  return SECTION_ORDER.map((category) => ({
    category,
    label: SECTION_LABELS[category],
    items: rows
      .filter((r) => r.category === category)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxPerSection)
      .map((r) => ({
        id: r.id,
        title: r.title,
        source: r.feed_title,
        score: r.score,
        techs: (JSON.parse(r.techs) as { name: string }[]).map((t) => t.name),
      })),
  })).filter((s) => s.items.length > 0);
}

/** Prompt du briefing : liste compacte des items (titre, source, technos, extrait). */
export function buildBriefingPrompt(rows: Row[], from: number, to: number, tz: string): string {
  const fmt = (t: number) => new Intl.DateTimeFormat('fr-FR', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(t);
  const lines = SECTION_ORDER.flatMap((cat) => {
    const list = rows.filter((r) => r.category === cat).sort((a, b) => b.score - a.score);
    if (!list.length) return [];
    return [
      `### ${SECTION_LABELS[cat]} (${list.length})`,
      ...list.map((r) => {
        const techs = (JSON.parse(r.techs) as { name: string }[]).map((t) => t.name);
        const meta = [r.feed_title, r.severity ? `sévérité ${r.severity}` : '', r.kev ? 'exploitée (KEV)' : '', techs.length ? `touche : ${techs.join(', ')}` : '', `score ${r.score}`].filter(Boolean).join(' · ');
        const excerpt = truncate(r.ai_summary || htmlToText(r.summary_html), 220);
        return `- ${r.title} [${meta}]${excerpt ? ` — ${excerpt}` : ''}`;
      }),
    ];
  });
  return [
    'Tu es l’assistant de veille d’un développeur et administrateur système francophone.',
    `Rédige son briefing du matin à partir des ${rows.length} éléments reçus entre ${fmt(from)} et ${fmt(to)}.`,
    '',
    'Consignes :',
    '- En français, ton factuel et concis, 120 à 250 mots au total.',
    '- Commence par une phrase d’accroche qui dit l’essentiel de la période.',
    '- Puis des sections `## Sécurité`, `## Releases`, `## Tech`, `## Actus` (omets une section vide), chacune en 2 à 5 puces `- `.',
    '- Priorité absolue aux vulnérabilités qui touchent ses technos (« touche : … »), aux failles exploitées (KEV) et aux scores élevés : nomme le CVE et la techno en **gras**.',
    '- Regroupe les éléments qui parlent du même sujet. Ignore le bruit (scores faibles) sauf s’il n’y a rien d’autre.',
    '- N’invente rien qui ne figure pas dans la liste. Pas de lien, pas de conclusion, pas de formule de politesse.',
    '',
    'Éléments :',
    ...lines,
  ].join('\n');
}

/** Briefing de repli (sans Ollama) : phrase d’accroche + top des titres par section. */
export function fallbackSummary(sections: BriefingSection[], total: number): string {
  const head = `${total} élément${total > 1 ? 's' : ''} depuis le dernier briefing.`;
  const body = sections.map((s) => [`## ${s.label}`, ...s.items.slice(0, 5).map((i) => `- ${i.techs.length ? `**${i.techs[0]}** · ` : ''}${i.title} _(${i.source})_`)].join('\n'));
  return [head, ...body].join('\n\n');
}

export class BriefingService {
  private busy = false;

  constructor(
    private readonly db: DB,
    private readonly summarizer: Summarizer,
    private readonly log: Logger,
    private readonly tz: string,
    private readonly now: () => number = Date.now,
  ) {}

  latest(): Briefing | undefined {
    return this.db.select().from(briefings).orderBy(desc(briefings.periodEnd)).limit(1).get();
  }

  list(limit = 30): Briefing[] {
    return this.db.select().from(briefings).orderBy(desc(briefings.periodEnd)).limit(limit).all();
  }

  get(id: number): Briefing | undefined {
    return this.db.select().from(briefings).where(eq(briefings.id, id)).get();
  }

  markRead(id: number): void {
    this.db.update(briefings).set({ readAt: this.now() }).where(and(eq(briefings.id, id), sql`${briefings.readAt} IS NULL`)).run();
  }

  /** Items reçus dans la période (cartes de vulns hors watchlist exclues : trop nombreuses). */
  collect(from: number, to: number): Row[] {
    return this.db.$client
      .prepare(
        `SELECT i.id, i.title, i.summary_html, i.kind, i.score, i.severity, i.kev, i.techs, i.ai_summary, f.category, f.title AS feed_title
         FROM items i JOIN feeds f ON f.id = i.feed_id
         WHERE i.fetched_at > ? AND i.fetched_at <= ?
           AND (i.kind != 'vuln' OR i.techs != '[]' OR i.kev = 1)`,
      )
      .all(from, to) as Row[];
  }

  /**
   * Génère le briefing de la période « dernier briefing → maintenant ».
   * Retourne `null` s'il n'y a aucune nouvelle actu (rien n'est enregistré).
   */
  async generate(opts: { force?: boolean } = {}): Promise<Briefing | null> {
    if (this.busy) return null;
    this.busy = true;
    try {
      const s = getSettings(this.db).briefing;
      if (!s.enabled && !opts.force) return null;
      const to = this.now();
      const from = this.latest()?.periodEnd ?? to - DAY;
      const all = this.collect(from, to);
      if (!all.length) return null;
      // Pour le prompt : les plus importants d'abord, borné pour tenir dans le contexte du modèle.
      const rows = [...all].sort((a, b) => b.score - a.score).slice(0, s.maxItems);
      const sections = buildSections(all, 8);
      let summary: string | null = null;
      let model: string | null = null;
      let error: string | null = null;
      if (this.summarizer.enabled) {
        try {
          const out = await this.summarizer.generate(buildBriefingPrompt(rows, from, to, this.tz), { timeoutMs: 300_000, numCtx: 8192, temperature: 0.3 });
          if (out.length > 40) {
            summary = out.slice(0, 6000);
            model = this.summarizer.model;
          } else error = 'Réponse Ollama vide';
        } catch (err) {
          error = (err as Error).message.slice(0, 300);
          this.log.warn({ err: error }, 'briefing: Ollama failed, fallback');
        }
      }
      const row = this.db
        .insert(briefings)
        .values({ periodStart: from, periodEnd: to, itemCount: all.length, summary: summary ?? fallbackSummary(sections, all.length), sections, model, error, createdAt: to })
        .returning()
        .get();
      this.log.info({ id: row.id, items: all.length, ai: !!model }, 'briefing generated');
      return row;
    } finally {
      this.busy = false;
    }
  }

  /** Nombre de briefings non lus (badge de l'écran Briefing). */
  unread(): number {
    return this.db.select({ n: sql<number>`count(*)` }).from(briefings).where(and(sql`${briefings.readAt} IS NULL`, gt(briefings.createdAt, this.now() - 7 * DAY), lte(briefings.createdAt, this.now()))).get()?.n ?? 0;
  }
}
