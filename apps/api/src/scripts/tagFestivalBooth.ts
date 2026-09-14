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
import {
  createFestivalTagRepo,
  type DiscoveredBooth,
  type FestivalTagRepo,
} from '../services/catalog/festivalTags/repo.js';

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
}

export function parseArgs(args: readonly string[]): CliOptions {
  let year: number | null = null;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--force') {
      force = true;
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

  return { year, force };
}

export async function runTaggingCli(
  repo: FestivalTagRepo,
  options: CliOptions,
  promptFn?: (question: string) => Promise<string>,
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
    }));

    const writtenIds = await repo.upsertTags(entries, { force: options.force });
    console.log(`Successfully tagged ${writtenIds.length} booth(s).`);
  } finally {
    if (rl) {
      rl.close();
    }
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const pool = getPool();
  const repo = createFestivalTagRepo(pool);

  try {
    await runTaggingCli(repo, options);
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
