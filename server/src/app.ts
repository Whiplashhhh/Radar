import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import compress from '@fastify/compress';
import fastifyStatic from '@fastify/static';
import { sql } from 'drizzle-orm';
import { ZodError } from 'zod';
import type { Config } from './config';
import type { DB } from './db/client';
import type { Logger } from './lib/logger';
import { registerRoutes } from './routes';
import type { Services } from './services/container';

export interface AppContext {
  config: Config;
  db: DB;
  log: Logger;
  services: Services;
}

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app: FastifyInstance = Fastify({
    loggerInstance: ctx.log as unknown as FastifyBaseLogger,
    disableRequestLogging: process.env.LOG_REQUESTS !== 'true',
    bodyLimit: 5 * 1024 * 1024,
    trustProxy: true,
  });

  app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown }, req, reply) => {
    const issues = (err as { issues?: { path: PropertyKey[]; message: string }[] }).issues;
    if (err instanceof ZodError || (err.name === 'ZodError' && Array.isArray(issues))) {
      return reply.code(400).send({ error: (issues ?? []).map((i) => `${i.path.map(String).join('.') || 'corps'} : ${i.message}`).join(' ; ') });
    }
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) req.log.error({ err }, 'request failed');
    return reply.code(status).send({ error: status >= 500 ? 'Erreur interne' : err.message });
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'https:', 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        manifestSrc: ["'self'"],
        workerSrc: ["'self'"],
        mediaSrc: ["'self'", 'https:'],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    strictTransportSecurity: false, // TLS terminé par `tailscale serve`
  });
  await app.register(compress, { global: true, threshold: 1024 });

  app.get('/health', async (_req, reply) => {
    try {
      ctx.db.get(sql`select 1`);
      return { status: 'ok', uptime: Math.round(process.uptime()), time: new Date().toISOString() };
    } catch (err) {
      reply.code(503);
      return { status: 'error', error: (err as Error).message };
    }
  });

  await app.register(async (api) => registerRoutes(api, ctx), { prefix: '/api' });

  const indexHtml = path.join(ctx.config.webDir, 'index.html');
  if (fs.existsSync(indexHtml)) {
    await app.register(fastifyStatic, {
      root: ctx.config.webDir,
      wildcard: false,
      index: false,
      setHeaders(reply, filePath) {
        const base = path.basename(filePath);
        if (base === 'sw.js' || base === 'index.html' || base.endsWith('.webmanifest')) {
          reply.header('Cache-Control', 'no-cache');
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          reply.header('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    });
  }

  app.setNotFoundHandler((req, reply) => {
    const url = req.url.split('?')[0] ?? '';
    if (req.method !== 'GET' || url.startsWith('/api/') || path.extname(url) !== '' || !fs.existsSync(indexHtml)) {
      return reply.code(404).send({ error: 'Introuvable' });
    }
    reply.header('Cache-Control', 'no-cache');
    return reply.type('text/html').sendFile('index.html');
  });

  return app;
}
