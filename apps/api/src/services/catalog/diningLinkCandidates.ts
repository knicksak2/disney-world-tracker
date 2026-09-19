/**
 * Dining_Link_Candidate detection (restaurant-menu-display, dining-link
 * curation follow-up).
 *
 * Detects Restaurant_Experiences that match the curation-eligibility rule
 * from Requirement 6.2 (`grouped_facets.tableService` contains a
 * `reservations-accepted` facet) but have no entry in the curated
 * `dining-links.json` seed. This module is deliberately detection-only: it
 * never invents, guesses, or derives a Disney dining-page URL. Resolving the
 * real URL for a reported candidate remains a human/curator step — see the
 * seed-file rationale in `restaurant-menu-display` Requirement 6.
 *
 * The check runs as a step at the end of `runSync`/`runSync.ts` (manual
 * `npm run sync` / `sync:cloud`), not as a scheduled job — this repo's
 * hosting has no always-on worker to host a background check, so it rides
 * along on the one sync path that already runs by hand.
 */

import { readFile } from 'node:fs/promises';

/** A Restaurant_Experience matching the curation-eligibility facet rule. */
export interface DiningLinkCandidate {
  readonly upstreamEntityId: string;
  readonly name: string;
  readonly park: string | null;
}

/** Minimal shape read from the curated seed file for the diff. */
interface SeedEntry {
  readonly upstreamEntityId: string;
}

/**
 * Diff the live candidate set against the curated seed's `upstreamEntityId`s.
 * Pure and total: returns every candidate whose id is not already present in
 * `seedEntries`, in the order given. No network, filesystem, or DB access —
 * both inputs are already materialized.
 */
export function diffDiningLinkCandidates(
  candidates: readonly DiningLinkCandidate[],
  seedEntries: readonly SeedEntry[],
): readonly DiningLinkCandidate[] {
  const seededIds = new Set(seedEntries.map((e) => e.upstreamEntityId));
  return candidates.filter((c) => !seededIds.has(c.upstreamEntityId));
}

/**
 * Read and parse the curated seed file for the diff. Returns an empty array
 * (rather than throwing) when the file is missing, so a fresh checkout with
 * no seed data yet does not fail the sync it rides along with — the seed
 * file's own absence is reported implicitly by every candidate showing up as
 * "new".
 */
export async function readSeedEntries(
  filePath: string,
  fsLib: { readFile: typeof readFile } = { readFile },
): Promise<readonly SeedEntry[]> {
  let content: string;
  try {
    content = await fsLib.readFile(filePath, 'utf8');
  } catch (err: any) {
    if (err?.code === 'ENOENT') return [];
    throw err;
  }
  const parsed = JSON.parse(content);
  if (!Array.isArray(parsed)) return [];
  return parsed;
}

/**
 * Format the diff result as a human-readable report for CLI output. Returns
 * `null` when there is nothing new to report (the common case), so callers
 * can skip printing anything at all.
 */
export function formatDiningLinkCandidateReport(
  newCandidates: readonly DiningLinkCandidate[],
): string | null {
  if (newCandidates.length === 0) return null;
  const lines: string[] = [
    `[dining-links] ${newCandidates.length} restaurant(s) accept reservations but have no curated dining link yet:`,
  ];
  for (const c of newCandidates) {
    const parkStr = c.park ? ` [${c.park}]` : '';
    lines.push(`  - ${c.name}${parkStr} (${c.upstreamEntityId})`);
  }
  lines.push(
    '  These need a human-verified Disney dining-page URL added to apps/api/seed-data/dining/dining-links.json, then `npm run seed-dining-links`.',
  );
  return lines.join('\n');
}
