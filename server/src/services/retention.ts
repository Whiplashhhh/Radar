import type { DB } from '../db/client';

/**
 * Purge les items lus depuis plus de `days` jours, sauf favoris et items liés à une vuln matchée
 * par la watchlist. Purge aussi l'historique de notifs et les vulns orphelines non matchées.
 */
export function purge(db: DB, days: number, now = Date.now()): { items: number; notifications: number; vulns: number } {
  const cutoff = now - days * 86_400_000;
  const sqlite = db.$client;
  return sqlite.transaction(() => {
    const itemsRes = sqlite
      .prepare(
        `DELETE FROM items
         WHERE read_at IS NOT NULL AND read_at < @cutoff AND published_at < @cutoff
           AND starred_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM json_each(items.vuln_ids) j JOIN vulns v ON v.id = j.value WHERE v.match_level IS NOT NULL
           )`,
      )
      .run({ cutoff });
    const notifRes = sqlite.prepare(`DELETE FROM notifications WHERE status != 'pending' AND created_at < ?`).run(now - 90 * 86_400_000);
    const vulnRes = sqlite
      .prepare(
        `DELETE FROM vulns
         WHERE match_level IS NULL AND kev = 0 AND first_seen_at < @cutoff
           AND NOT EXISTS (SELECT 1 FROM items i WHERE i.vuln_id = vulns.id)
           AND NOT EXISTS (SELECT 1 FROM vuln_sources s WHERE s.vuln_id = vulns.id AND s.item_id IS NOT NULL)`,
      )
      .run({ cutoff });
    return { items: itemsRes.changes, notifications: notifRes.changes, vulns: vulnRes.changes };
  })();
}
