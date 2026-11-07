import type { Feed } from '../db/schema';
import { cisaKevAdapter } from './cisa-kev';
import { githubAdvisoriesAdapter } from './github-advisories';
import { rssAdapter } from './rss';
import type { SourceAdapter } from './types';

const adapters: Record<Feed['adapter'], SourceAdapter> = {
  rss: rssAdapter,
  'cisa-kev': cisaKevAdapter,
  'github-advisories': githubAdvisoriesAdapter,
};

export function adapterFor(kind: Feed['adapter']): SourceAdapter {
  return adapters[kind] ?? rssAdapter;
}
