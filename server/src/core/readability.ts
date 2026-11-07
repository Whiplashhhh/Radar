import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { sanitize } from '../lib/html';

export interface Readable {
  title: string | null;
  html: string;
  textLength: number;
  byline: string | null;
}

/** Extraction « mode lecture » d'une page HTML, assainie. */
export function extractReadable(html: string, url: string): Readable | null {
  const { document } = parseHTML(html);
  try {
    const base = document.createElement('base');
    base.setAttribute('href', url);
    document.head?.appendChild(base);
  } catch {
    /* ignore */
  }
  const article = new Readability(document as unknown as ConstructorParameters<typeof Readability>[0], { charThreshold: 300, keepClasses: false }).parse();
  if (!article?.content) return null;
  const clean = sanitize(article.content, url);
  return { title: article.title ?? null, html: clean, textLength: article.textContent?.length ?? 0, byline: article.byline ?? null };
}
