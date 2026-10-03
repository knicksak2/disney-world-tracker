#!/usr/bin/env node
/**
 * Interactive CLI to tag currently active EPCOT festival booths.
 *
 * Usage:
 *   npm run tag-festival-booth --workspace apps/api
 *   npm run tag-festival-booth:cloud --workspace apps/api
 *
 * Flags:
 *   --year <year>   Specify festival year (e.g. --year 2026 or --year=2026)
 *   --force         Overwrite conflicting tags for the same year under another festival
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
 */

import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import {
  FESTIVAL_SLUGS,
  FESTIVAL_SLUG_LABELS,
  type FestivalSlug,
} from '@dwt/shared';

import { closePool, getPool } from '../db/pool.js';
import { createCatalogRepo } from '../services/catalog/repo.js';
import {
  createFestivalTagRepo,
  type DiscoveredBooth,
  type FestivalTagRepo,
} from '../services/catalog/festivalTags/repo.js';
import type { MenuRetrieval } from '../services/catalog/menuRetrieval.js';

export function buildFestivalMenu(): string {
  const lines: string[] = ['Select a festival:'];
  FESTIVAL_SLUGS.forEach((slug, idx) => {
    lines.push(`  ${idx + 1}. ${FESTIVAL_SLUG_LABELS[slug]} (${slug})`);
  });
  return lines.join('\n');
}

export function formatDiscoveryReport(
  booths: readonly DiscoveredBooth[],
  targetFestival?: FestivalSlug,
  targetYear?: number,
): string {
  if (booths.length === 0) {
    return 'No active festival booths found.';
  }

  const header =
    targetFestival && targetYear
      ? `Discovered ${booths.length} active festival booth(s) to tag for ${FESTIVAL_SLUG_LABELS[targetFestival]} (${targetYear}):`
      : `Discovered ${booths.length} active festival booth(s):`;

  const lines: string[] = [header];

  for (const b of booths) {
    const parkStr = b.park ? ` [${b.park}]` : '';
    if (b.conflictingTag) {
      lines.push(
        `  - ${b.name}${parkStr} [CONFLICT: tagged as '${b.conflictingTag.festivalSlug}' for ${b.conflictingTag.festivalYear} - SKIPPED without --force]`,
      );
    } else {
      lines.push(`  - ${b.name}${parkStr}`);
    }
  }

  return lines.join('\n');
}

export interface CliOptions {
  year: number | null;
  force: boolean;
  /**
   * Skip the pre-discovery menu-refresh pass (festival-booth-tagging R3.10).
   * Useful for fast iteration once an operator knows every active
   * Restaurant's cached menu is already fresh (e.g. re-running minutes after
   * a prior run with `--force`).
   */
  skipMenuRefresh: boolean;
}

export function parseArgs(args: readonly string[]): CliOptions {
  let year: number | null = null;
  let force = false;
  let skipMenuRefresh = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--force') {
      force = true;
    } else if (arg === '--skip-menu-refresh') {
      skipMenuRefresh = true;
    } else if (arg.startsWith('--year=')) {
      const parsed = parseInt(arg.slice(7), 10);
      if (!Number.isNaN(parsed) && parsed >= 2015 && parsed <= 2100) {
        year = parsed;
      }
    } else if (arg === '--year' && i + 1 < args.length) {
      const parsed = parseInt(args[i + 1]!, 10);
      if (!Number.isNaN(parsed) && parsed >= 2015 && parsed <= 2100) {
        year = parsed;
        i++;
      }
    }
  }

  return { year, force, skipMenuRefresh };
}

/**
 * Dependencies the pre-discovery menu-refresh step needs (festival-booth-
 * tagging R3.10). Optional on `runTaggingCli` so existing tests that pass no
 * refresh deps skip the step entirely (equivalent to `--skip-menu-refresh`).
 */
export interface MenuRefreshDeps {
  /** Enumerate the active Restaurant ids whose menus should be refreshed. */
  readonly listActiveRestaurantIds: () => Promise<readonly string[]>;
  /** The demand-driven menu-retrieval seam used to force each refresh. */
  readonly menuRetrieval: Pick<MenuRetrieval, 'getMenuForRestaurant'>;
}

/**
 * Force-refresh every active Restaurant's cached menu through the existing
 * demand-driven `MenuRetrieval` seam, best-effort per restaurant so one
 * failure never aborts the pass (mirrors `menuRefreshJob.ts`'s per-restaurant
 * guard). Reused ahead of discovery so a stale pre-festival menu cache cannot
 * hide a genuine menu-keyword match (R3.10).
 */
async function refreshRestaurantMenus(deps: MenuRefreshDeps): Promise<void> {
  let restaurantIds: readonly string[];
  try {
    restaurantIds = await deps.listActiveRestaurantIds();
  } catch (err) {
    console.warn('Menu refresh: listing active restaurants failed; skipping refresh.', err);
    return;
  }

  for (const id of restaurantIds) {
    try {
      await deps.menuRetrieval.getMenuForRestaurant(id);
    } catch (err) {
      console.warn(`Menu refresh: refreshing restaurant ${id} failed; continuing.`, err);
    }
  }
}

export async function runTaggingCli(
  repo: FestivalTagRepo,
  options: CliOptions,
  promptFn?: (question: string) => Promise<string>,
  menuRefreshDeps?: MenuRefreshDeps,
): Promise<void> {
  const rl = promptFn
    ? null
    : createInterface({ input, output });

  const ask = promptFn ?? ((q: string) => rl!.question(q));

  try {
    // 1. Prompt festival choice
    console.log(buildFestivalMenu());
    let selectedSlug: FestivalSlug | null = null;

    while (!selectedSlug) {
      const answer = (await ask(`Enter choice (1-${FESTIVAL_SLUGS.length}): `)).trim();
      const num = parseInt(answer, 10);
      if (num >= 1 && num <= FESTIVAL_SLUGS.length) {
        selectedSlug = FESTIVAL_SLUGS[num - 1]!;
      } else {
        console.log(`Invalid choice. Please enter a number between 1 and ${FESTIVAL_SLUGS.length}.`);
      }
    }

    // 2. Resolve target year
    let targetYear = options.year;
    const currentYear = new Date().getFullYear();

    while (!targetYear) {
      const answer = (await ask(`Enter festival year [${currentYear}]: `)).trim();
      if (!answer) {
        targetYear = currentYear;
      } else {
        const parsed = parseInt(answer, 10);
        if (!Number.isNaN(parsed) && parsed >= 2015 && parsed <= 2100) {
          targetYear = parsed;
        } else {
          console.log('Invalid year. Must be an integer between 2015 and 2100.');
        }
      }
    }

    // 2b. Pre-discovery menu refresh (R3.10): force-refresh every active
    // Restaurant's cached menu so a stale pre-festival cache cannot hide a
    // genuine menu-keyword match (R3.8). Skippable via --skip-menu-refresh for
    // fast iteration; also a no-op when no refresh deps were supplied.
    if (!options.skipMenuRefresh && menuRefreshDeps) {
      console.log('\nRefreshing restaurant menus before discovery...');
      await refreshRestaurantMenus(menuRefreshDeps);
    }

    // 2c. Festival_Edition date window (R9.3): an optional, operator-set
    // date window used by the Qualifying_Visit computation (R9.5) to scope
    // which completions/food logs count for this (slug, year). `starts_on`
    // defaults to today; a blank `ends_on` means "still running" and is
    // NEVER used to blank a previously-set `ends_on` on a later run
    // (upsertFestivalEdition's own guard — see repo.ts).
    const todayIso = new Date().toISOString().slice(0, 10);
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    let startsOn: string | null = null;
    while (!startsOn) {
      const answer = (
        await ask(`Enter festival edition start date (YYYY-MM-DD) [${todayIso}]: `)
      ).trim();
      const candidate = answer || todayIso;
      if (dateRe.test(candidate)) {
        startsOn = candidate;
      } else {
        console.log('Invalid date. Must be in YYYY-MM-DD format.');
      }
    }

    let endsOn: string | null = null;
    let endsOnEntered = false;
    while (!endsOnEntered) {
      const answer = (
        await ask('Enter festival edition end date (YYYY-MM-DD), leave blank if still running: ')
      ).trim();
      if (!answer) {
        endsOn = null;
        endsOnEntered = true;
      } else if (dateRe.test(answer)) {
        endsOn = answer;
        endsOnEntered = true;
      } else {
        console.log('Invalid date. Must be in YYYY-MM-DD format, or blank.');
      }
    }

    await repo.upsertFestivalEdition(selectedSlug, targetYear, startsOn, endsOn);
    console.log(`Festival edition window set: ${startsOn} to ${endsOn ?? '(still running)'}`);

    // 3. Discover active booths
    console.log(`\nDiscovering active festival booths for ${FESTIVAL_SLUG_LABELS[selectedSlug]} (${targetYear})...`);
    const booths = await repo.listActiveFestivalBooths(targetYear, selectedSlug);

    console.log(formatDiscoveryReport(booths, selectedSlug, targetYear));

    if (booths.length === 0) {
      return;
    }

    // 4. Determine candidate booths
    const candidateBooths = options.force
      ? booths
      : booths.filter((b) => b.conflictingTag === null);

    if (candidateBooths.length === 0) {
      console.log('\nAll discovered booths have conflicting tags. Re-run with --force to overwrite.');
      return;
    }

    // 5. Confirm before write
    const confirmPrompt = `\nTag ${candidateBooths.length} booth(s) as ${FESTIVAL_SLUG_LABELS[selectedSlug]} (${targetYear})${
      options.force ? ' [FORCE]' : ''
    }? (y/N): `;

    const confirmAnswer = (await ask(confirmPrompt)).trim().toLowerCase();
    if (confirmAnswer !== 'y' && confirmAnswer !== 'yes') {
      console.log('Aborted. No tags written.');
      return;
    }

    // 6. Execute upsert
    const entries = candidateBooths.map((b) => ({
      experienceId: b.experienceId,
      year: targetYear!,
      slug: selectedSlug!,
      matchKind: b.matchKind,
      matchingFoodItemIds: b.matchingFoodItemIds,
    }));

    const writtenIds = await repo.upsertTags(entries, { force: options.force });
    console.log(`Successfully tagged ${writtenIds.length} booth(s).`);
  } finally {
    if (rl) {
      rl.close();
    }
  }
}

/**
 * Build the menu-refresh dependencies self-contained, mirroring
 * `backfillFacetEnrichment.ts`'s one-off dependency construction — this does
 * NOT touch `composeServices.ts` or the running server's composition root.
 * Returns `undefined` (refresh step becomes a no-op) when `--skip-menu-
 * refresh` is set, since there is no reason to pay for building the Disney
 * transport/clients when the operator has opted out.
 */
async function buildMenuRefreshDeps(
  options: CliOptions,
): Promise<MenuRefreshDeps | undefined> {
  if (options.skipMenuRefresh) {
    return undefined;
  }

  const [
    { loadConfig },
    { createDisneyTransport },
    { createInProcessRateLimiter },
    { createDiningMenuClient },
    { createMenuRetrieval },
  ] = await Promise.all([
    import('../config.js'),
    import('../services/catalog/disney/transport.js'),
    import('../services/catalog/disney/rateLimiter.js'),
    import('../services/catalog/disney/diningMenuClient.js'),
    import('../services/catalog/menuRetrieval.js'),
  ]);

  const config = loadConfig();
  const pool = getPool();
  const catalogRepo = createCatalogRepo(pool);
  // Scoped to EPCOT (R3.10): every EPCOT festival's booths — temporary or
  // permanent-with-a-menu-overlay — are located in EPCOT (see
  // `listActiveFestivalBooths`'s own park scoping). Refreshing the full
  // ~450-restaurant catalog needlessly costs minutes against Disney's rate
  // limiter for restaurants discovery can never match.
  const festivalTagRepo = createFestivalTagRepo(pool);

  const limiter = createInProcessRateLimiter(config.disney.requestBudget);
  const transport = createDisneyTransport({
    limiter,
    backoff: config.disney.backoff,
  });
  const diningMenuClient = createDiningMenuClient({
    transport,
    baseUrl: config.disney.diningMenuBaseUrl,
  });
  const menuRetrieval = createMenuRetrieval({
    repo: {
      getMenuFetchState: (id) => catalogRepo.getMenuFetchState(id),
      upsertMenus: (id, menus, fetchedAt) => catalogRepo.upsertMenus(id, menus, fetchedAt),
    },
    client: diningMenuClient,
    freshnessMs: config.disney.menuFreshnessMs,
  });

  return {
    listActiveRestaurantIds: () => festivalTagRepo.listActiveEpcotRestaurantIds(),
    menuRetrieval,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const pool = getPool();
  const repo = createFestivalTagRepo(pool);
  const menuRefreshDeps = await buildMenuRefreshDeps(options);

  try {
    await runTaggingCli(repo, options, undefined, menuRefreshDeps);
  } finally {
    await closePool();
  }
}

// Entrypoint execution guard
const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedFile === currentFile) {
  main().catch((err) => {
    console.error('Failed to run tagging CLI:', err);
    process.exit(1);
  });
}
