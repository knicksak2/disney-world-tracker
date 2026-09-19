import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolve `apps/api/seed-data/dining/dining-links.json` regardless of the
 * caller's working directory. Tried in order:
 *
 *   1. `<cwd>/seed-data/dining/dining-links.json` — running from `apps/api`
 *      (the normal `npm run seed-dining-links` / `npm run sync` invocation).
 *   2. `<cwd>/apps/api/seed-data/dining/dining-links.json` — running from the
 *      monorepo root.
 *   3. A path relative to this module's own file location — the fallback
 *      when neither cwd guess matches (e.g. the compiled `dist/` layout).
 *
 * Shared by `seedDiningLinks.ts` (the curation loader) and `runSync.ts` (the
 * post-sync dining-link-candidate check) so both agree on the same file
 * without duplicating — and risking diverging — the resolution logic.
 */
export function resolveDiningLinksSeedPath(): string {
  const fromCwd = path.resolve(process.cwd(), 'seed-data/dining/dining-links.json');
  if (existsSync(fromCwd)) return fromCwd;
  const fromRoot = path.resolve(process.cwd(), 'apps/api/seed-data/dining/dining-links.json');
  if (existsSync(fromRoot)) return fromRoot;
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '../../seed-data/dining/dining-links.json');
}
