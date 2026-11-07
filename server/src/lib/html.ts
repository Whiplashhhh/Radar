import sanitizeHtml from 'sanitize-html';

const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'a', 'b', 'strong', 'i', 'em', 'u', 's', 'del', 'ins', 'mark', 'small', 'sub', 'sup',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'q', 'cite', 'code', 'pre', 'kbd', 'samp', 'var',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  'figure', 'figcaption', 'img', 'picture', 'source', 'abbr', 'time', 'details', 'summary', 'span', 'div',
];

/**
 * Assainit du HTML provenant d'un flux ou d'une page tierce.
 * Pas de script, style, iframe, formulaire ni attribut d'événement ; liens forcés en nouvel onglet,
 * URL relatives résolues par rapport à `baseUrl`.
 */
export function sanitize(html: string | null | undefined, baseUrl?: string | null): string {
  if (!html) return '';
  const abs = (u: string): string => {
    if (!baseUrl) return u;
    try {
      return new URL(u, baseUrl).toString();
    } catch {
      return u;
    }
  };
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height', 'srcset', 'sizes', 'loading', 'decoding'],
      source: ['srcset', 'type', 'media', 'sizes'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan', 'scope'],
      time: ['datetime'],
      abbr: ['title'],
      code: ['class'],
    },
    allowedClasses: { code: [/^language-[\w-]+$/] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'iframe', 'object', 'embed', 'svg', 'math', 'form', 'button', 'select', 'template'],
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          ...(attribs.href ? { href: abs(attribs.href) } : {}),
          target: '_blank',
          rel: 'noopener noreferrer nofollow',
        },
      }),
      img: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, ...(attribs.src ? { src: abs(attribs.src) } : {}), loading: 'lazy', decoding: 'async' },
      }),
    },
    exclusiveFilter: (frame) =>
      // pixels de tracking 1×1
      frame.tag === 'img' && (frame.attribs.width === '1' || frame.attribs.height === '1'),
  });
}

/** Texte brut à partir de HTML (pour le matching, l'extraction de CVE et les résumés). */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  return decodeEntities(
    sanitizeHtml(html.replace(/<\/(p|div|li|h\d|tr|br)>/gi, '$& '), { allowedTags: [], allowedAttributes: {} }),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}
