import { buildApp } from './app';
import { loadConfig } from './config';
import { openDb } from './db/client';
import { logger } from './lib/logger';
import { seedIfEmpty } from './seed';
import { createServices } from './services/container';

async function main(): Promise<void> {
  const config = loadConfig();
  process.env.TZ ??= config.timezone;
  const db = openDb(config.dbPath);
  const seeded = seedIfEmpty(db);
  if (seeded.feeds || seeded.watchlist) logger.info(seeded, 'database seeded');
  const services = createServices(config, db, logger);
  const app = await buildApp({ config, db, log: logger, services });
  await app.listen({ port: config.port, host: config.host });
  if (!config.disableScheduler) services.scheduler.start();
  logger.info({ port: config.port, ollama: !!config.ollamaUrl, nvdKey: !!config.nvdApiKey }, 'radar ready');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    services.scheduler.stop();
    await app.close().catch(() => {});
    db.$client.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'startup failed');
  process.exit(1);
});
