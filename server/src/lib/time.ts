export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** AAAA-MM-JJ dans le fuseau. */
  date: string;
  /** Minutes depuis minuit dans le fuseau. */
  minutes: number;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function zonedParts(ts: number, tz: string): ZonedParts {
  const parts = Object.fromEntries(formatter(tz).formatToParts(new Date(ts)).map((p) => [p.type, p.value]));
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return {
    year,
    month,
    day,
    hour,
    minute,
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hour * 60 + minute,
  };
}

/** Décalage (ms) du fuseau à l'instant `ts` : heure locale − UTC. */
function offsetAt(ts: number, tz: string): number {
  const p = zonedParts(ts, tz);
  const secs = new Date(ts).getUTCSeconds();
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, secs) - (ts - (ts % 1000));
}

/** Instant UTC correspondant à une date/heure locale dans `tz`. */
export function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, tz: string): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetAt(guess, tz);
  const second = guess - offsetAt(first, tz);
  return second;
}

export function parseHHMM(s: string): number {
  const [h = '0', m = '0'] = s.split(':');
  return Number(h) * 60 + Number(m);
}

/** Vrai si `minutes` (depuis minuit) est dans la plage [start, end), plage pouvant passer minuit. */
export function inRange(minutes: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

export function isQuiet(ts: number, tz: string, start: string, end: string): boolean {
  return inRange(zonedParts(ts, tz).minutes, parseHHMM(start), parseHHMM(end));
}

/** Prochaine occurrence (strictement après `ts` ou égale) de l'heure locale `hhmm`. */
export function nextLocalTime(ts: number, tz: string, hhmm: string): number {
  const p = zonedParts(ts, tz);
  const target = parseHHMM(hhmm);
  let candidate = zonedToUtc(p.year, p.month, p.day, Math.floor(target / 60), target % 60, tz);
  if (candidate < ts) {
    const tomorrow = zonedParts(ts + 86_400_000, tz);
    candidate = zonedToUtc(tomorrow.year, tomorrow.month, tomorrow.day, Math.floor(target / 60), target % 60, tz);
  }
  return candidate;
}

/** Fin des heures calmes si `ts` est dedans, sinon `ts`. */
export function deferForQuiet(ts: number, tz: string, quiet: { enabled: boolean; start: string; end: string }): number {
  if (!quiet.enabled || !isQuiet(ts, tz, quiet.start, quiet.end)) return ts;
  return nextLocalTime(ts, tz, quiet.end);
}
