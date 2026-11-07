import { Fragment, type ReactNode } from 'react';

/** Rendu Markdown minimal et sûr (aucun HTML injecté) : `##`, `-`, `**gras**`, `_italique_`, `` `code` ``. */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|_([^_]+)_|`([^`]+)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[2]) out.push(<strong key={`${key}-${i++}`} className="font-semibold text-text">{m[2]}</strong>);
    else if (m[3]) out.push(<em key={`${key}-${i++}`} className="text-muted not-italic">{m[3]}</em>);
    else if (m[4]) out.push(<code key={`${key}-${i++}`} className="rounded bg-surface-2 px-1 font-mono text-[0.9em]">{m[4]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = (k: number) => {
    if (list.length) {
      blocks.push(
        <ul key={`ul-${k}`} className="space-y-2 pl-1">
          {list.map((li, j) => (
            <li key={j} className="flex gap-2.5">
              <span aria-hidden className="mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              <span>{inline(li, `li-${k}-${j}`)}</span>
            </li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  text.split('\n').forEach((raw, k) => {
    const line = raw.trim();
    if (!line) return flush(k);
    const h = /^#{1,4}\s+(.*)$/.exec(line);
    const li = /^[-*•]\s+(.*)$/.exec(line);
    if (h) {
      flush(k);
      blocks.push(<h2 key={k} className="pt-2 text-[0.8rem] font-bold tracking-[0.08em] text-muted uppercase">{inline(h[1] ?? '', `h-${k}`)}</h2>);
    } else if (li) list.push(li[1] ?? '');
    else {
      flush(k);
      blocks.push(<p key={k}>{inline(line, `p-${k}`)}</p>);
    }
  });
  flush(-1);
  return <div className="space-y-3 text-[1.0625rem] leading-relaxed">{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>;
}
