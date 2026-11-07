import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../db/client';
import { settings } from '../db/schema';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Format HH:MM attendu');

export const settingsSchema = z.object({
  notifications: z.object({
    enabled: z.boolean(),
    /** Exiger un match « certain » pour le push immédiat (sinon « probable » suffit). */
    immediateRequireCertain: z.boolean(),
    immediateCvssMin: z.number().min(0).max(10),
    immediateOnKev: z.boolean(),
    immediateEpssMin: z.number().min(0).max(1),
    certFrAlerts: z.boolean(),
    groupWindowSec: z.number().int().min(0).max(3600),
    minIntervalSec: z.number().int().min(0).max(3600),
  }),
  digest: z.object({
    enabled: z.boolean(),
    time: hhmm,
    topNews: z.number().int().min(0).max(20),
    includeMedium: z.boolean(),
  }),
  quietHours: z.object({
    enabled: z.boolean(),
    start: hhmm,
    end: hhmm,
  }),
  feed: z.object({
    priorityThreshold: z.number().int().min(0).max(100),
    hnMinPoints: z.number().int().min(0).max(5000),
  }),
  retention: z.object({
    days: z.number().int().min(1).max(3650),
  }),
});

export type Settings = z.infer<typeof settingsSchema>;

export const defaultSettings: Settings = {
  notifications: {
    enabled: true,
    immediateRequireCertain: false,
    immediateCvssMin: 9,
    immediateOnKev: true,
    immediateEpssMin: 0.3,
    certFrAlerts: true,
    groupWindowSec: 60,
    minIntervalSec: 300,
  },
  digest: { enabled: true, time: '08:00', topNews: 5, includeMedium: true },
  quietHours: { enabled: true, start: '22:00', end: '07:00' },
  feed: { priorityThreshold: 60, hnMinPoints: 150 },
  retention: { days: 30 },
};

const KEY = 'app';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function merge<T extends object>(base: T, patch: DeepPartial<T> | undefined): T {
  if (!patch) return base;
  const out = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    const b = (base as Record<string, unknown>)[k];
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && b && typeof b === 'object' ? merge(b as object, v as DeepPartial<object>) : v;
  }
  return out as T;
}

export function getSettings(db: DB): Settings {
  const row = db.select().from(settings).where(eq(settings.key, KEY)).get();
  const merged = merge(defaultSettings, (row?.value ?? {}) as DeepPartial<Settings>);
  const parsed = settingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : defaultSettings;
}

export function updateSettings(db: DB, patch: DeepPartial<Settings>): Settings {
  const next = settingsSchema.parse(merge(getSettings(db), patch));
  db.insert(settings)
    .values({ key: KEY, value: next })
    .onConflictDoUpdate({ target: settings.key, set: { value: next } })
    .run();
  return next;
}

export function getKv<T>(db: DB, key: string): T | undefined {
  return db.select().from(settings).where(eq(settings.key, key)).get()?.value as T | undefined;
}

export function setKv(db: DB, key: string, value: unknown): void {
  db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
}
