import { sql } from 'drizzle-orm';
import type { DB } from '../db/client';
import { feeds, watchlist } from '../db/schema';
import { getKv, getSettings, setKv } from '../services/settings';
import { SEED_FEEDS } from './feeds';
import { SEED_WATCHLIST } from './watchlist';

/** Insère flux et watchlist par défaut au premier démarrage uniquement. */
export function seedIfEmpty(db: DB): { feeds: number; watchlist: number } {
  if (getKv<boolean>(db, 'seeded')) return { feeds: 0, watchlist: 0 };
  const points = getSettings(db).feed.hnMinPoints;
  let f = 0;
  let w = 0;
  db.transaction(() => {
    const feedCount = db.select({ n: sql<number>`count(*)` }).from(feeds).get()?.n ?? 0;
    if (feedCount === 0) {
      for (const s of SEED_FEEDS) {
        db.insert(feeds)
          .values({
            title: s.title.replace('{HN_POINTS}', String(points)),
            url: s.url.replace('{HN_POINTS}', String(points)),
            siteUrl: s.siteUrl ?? null,
            category: s.category,
            adapter: s.adapter ?? 'rss',
            pollIntervalMin: s.pollIntervalMin ?? 30,
            options: s.options ?? {},
            // étale les premiers fetchs
            nextFetchAt: Date.now() + f * 2000,
          })
          .onConflictDoNothing()
          .run();
        f++;
      }
    }
    const watchCount = db.select({ n: sql<number>`count(*)` }).from(watchlist).get()?.n ?? 0;
    if (watchCount === 0) {
      for (const s of SEED_WATCHLIST) {
        db.insert(watchlist).values({ name: s.name, aliases: s.aliases, cpes: s.cpes ?? [], packages: s.packages ?? [], exclude: s.exclude ?? [] }).run();
        w++;
      }
    }
    setKv(db, 'seeded', true);
  });
  return { feeds: f, watchlist: w };
}
