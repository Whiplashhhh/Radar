import path from 'node:path';

function bool(v: string | undefined, def = false): boolean {
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

function int(v: string | undefined, def: number): number {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : def;
}

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  dbPath: string;
  webDir: string;
  logLevel: string;
  timezone: string;
  allowPrivateNetworks: boolean;
  disableScheduler: boolean;
  nvdApiKey?: string;
  githubToken?: string;
  vapidSubject: string;
  ollamaUrl?: string;
  ollamaModel: string;
  fetchTimeoutMs: number;
  fetchMaxBytes: number;
  userAgent: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = path.resolve(env.DATA_DIR ?? 'data');
  return {
    port: int(env.PORT, 8787),
    host: env.HOST ?? '0.0.0.0',
    dataDir,
    dbPath: env.DB_PATH ?? path.join(dataDir, 'radar.db'),
    webDir: path.resolve(env.WEB_DIR ?? 'web/dist'),
    logLevel: env.LOG_LEVEL ?? 'info',
    timezone: env.APP_TZ ?? 'Europe/Paris',
    allowPrivateNetworks: bool(env.ALLOW_PRIVATE_NETWORKS),
    disableScheduler: bool(env.DISABLE_SCHEDULER),
    nvdApiKey: env.NVD_API_KEY || undefined,
    githubToken: env.GITHUB_TOKEN || undefined,
    vapidSubject: env.VAPID_SUBJECT ?? 'mailto:radar@localhost',
    ollamaUrl: env.OLLAMA_URL || undefined,
    ollamaModel: env.OLLAMA_MODEL ?? 'llama3.2',
    fetchTimeoutMs: int(env.FETCH_TIMEOUT_MS, 20_000),
    fetchMaxBytes: int(env.FETCH_MAX_BYTES, 10 * 1024 * 1024),
    userAgent: env.USER_AGENT ?? 'Radar/0.1 (+self-hosted RSS reader)',
  };
}
