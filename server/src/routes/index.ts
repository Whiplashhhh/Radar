import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app';
import { feedRoutes } from './feeds';
import { itemRoutes } from './items';
import { settingsRoutes } from './settings';

export async function registerRoutes(api: FastifyInstance, ctx: AppContext): Promise<void> {
  api.addContentTypeParser(['text/xml', 'application/xml', 'text/x-opml', 'text/plain'], { parseAs: 'string' }, (_req, body, done) =>
    done(null, body),
  );
  await itemRoutes(api, ctx);
  await feedRoutes(api, ctx);
  await settingsRoutes(api, ctx);
}
