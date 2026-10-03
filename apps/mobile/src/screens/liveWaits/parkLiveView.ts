/**
 * Pure view logic for Live Waits screen.
 * (Requirements 10.2, 10.3, 10.4, 10.5, design.md Section 11)
 *
 * Implements:
 *   - buildLiveWaitsRows: sorts entries ascending by wait with closed/down entries last,
 *     applying the selected filter ('all' | 'walkOn' | 'headliners').
 *   - isWalkOn: true iff waitMinutes is non-null and <= WALK_ON_THRESHOLD_MINUTES.
 *   - isHeadliner: true iff experience.id is a member of the curated HEADLINER_EXPERIENCE_IDS allowlist.
 */

import {
  HEADLINER_EXPERIENCE_IDS,
  WALK_ON_THRESHOLD_MINUTES,
  type ExperienceDTO,
  type LightningLaneState,
  type ParkLiveEntryDTO,
} from '@dwt/shared';

export type LiveWaitsFilter = 'all' | 'walkOn' | 'lightningLane' | 'headliners' | 'favorites';

export const EMPTY_FAVORITED_SET: ReadonlySet<string> = new Set<string>();

export interface LiveWaitsRow {
  readonly experienceId: string;
  readonly name: string;
  readonly waitMinutes: number | null;
  readonly isClosedOrDown: boolean;
  readonly land?: string | null;
  readonly lightningLane?: LightningLaneState;
  readonly isLightningLane?: boolean;
}

export type WaitStatus = 'low' | 'mod' | 'high' | 'down';

/**
 * Classifies a wait time into a visual status dot color category:
 *   - 'down': closed/down or missing wait
 *   - 'low': <= 25 min (walk-on)
 *   - 'mod': 26–50 min (moderate lines)
 *   - 'high': > 50 min (long wait)
 */
export function getWaitStatus(waitMinutes: number | null, isClosedOrDown: boolean): WaitStatus {
  if (isClosedOrDown || waitMinutes === null) {
    return 'down';
  }
  if (waitMinutes <= 25) {
    return 'low';
  }
  if (waitMinutes <= 50) {
    return 'mod';
  }
  return 'high';
}

/**
 * Determine if an entry represents a closed or down experience (R10.2).
 * True if status indicates closed/down/refurbishment or if waitMinutes is absent.
 */
export function isEntryClosedOrDown(status: string, waitMinutes: number | null): boolean {
  const s = status.toUpperCase();
  if (s === 'CLOSED' || s === 'DOWN' || s === 'REFURBISHMENT') {
    return true;
  }
  return waitMinutes === null;
}

/**
 * R10.4: A walk-on ride has a numeric wait at or below WALK_ON_THRESHOLD_MINUTES (default 25 min).
 */
export function isWalkOn(waitMinutes: number | null, threshold = WALK_ON_THRESHOLD_MINUTES): boolean {
  return waitMinutes !== null && waitMinutes >= 0 && waitMinutes <= threshold;
}

/**
 * R10.5a: A headliner experience's stable internal `id` is a member of the
 * curated `HEADLINER_EXPERIENCE_IDS` allowlist. Supersedes the original
 * `groupedFacets.thrillFactor` match (Requirement 10.5a) — see
 * `HEADLINER_EXPERIENCE_IDS`'s doc comment for why.
 */
export function isHeadliner(experience: ExperienceDTO): boolean {
  const headlinerSet: readonly string[] = HEADLINER_EXPERIENCE_IDS;
  return headlinerSet.includes(experience.id);
}

/**
 * Categories of experiences that naturally feature standby queues and belong on Live Waits
 * regardless of whether they are currently operating or closed/down.
 */
export const QUEUE_ELIGIBLE_CATEGORIES: readonly string[] = [
  'Ride',
  'Attraction', // legacy test fixture compatibility
  'Character_Meet',
];

/**
 * Determine whether an experience is eligible to be displayed on the Live Waits screen.
 * (Requirement 10.2)
 *
 * - Restaurants never belong on the Live Waits screen.
 * - Rides and character meets are always eligible (showing wait time or closed/down state).
 * - Other categories (Show, Parade, Walkthrough, PlayArea, etc.) are only eligible if they
 *   actively post a numeric standby wait (e.g. continuous theater shows like Mickey's PhilharMagic).
 * - When no catalog experience is provided (e.g. while catalog is loading), entries are
 *   included only if they carry an active wait time.
 */
export function isLiveWaitEligible(
  entry: ParkLiveEntryDTO,
  experience?: ExperienceDTO,
): boolean {
  if (!experience) {
    return entry.waitMinutes !== null && entry.waitMinutes >= 0;
  }

  // Dining locations never belong on the Live Waits screen
  if (experience.category === 'Restaurant') {
    return false;
  }

  // Queue-based attraction categories are always eligible
  if (QUEUE_ELIGIBLE_CATEGORIES.includes(experience.category)) {
    return true;
  }

  // Shows, parades, walkthroughs, events etc. are only eligible if they post an active standby wait time
  return entry.waitMinutes !== null && entry.waitMinutes >= 0;
}

/**
 * Sort (ascending wait, closed/down last — R10.2) and filter (R10.3-R10.5)
 * ParkLiveEntryDTO entries against the Catalog's Experience map.
 * Pure, total, no I/O.
 */
export function buildLiveWaitsRows(
  entries: readonly ParkLiveEntryDTO[],
  experiencesById: ReadonlyMap<string, ExperienceDTO>,
  filter: LiveWaitsFilter,
  favoritedIds: ReadonlySet<string> = EMPTY_FAVORITED_SET,
): readonly LiveWaitsRow[] {
  const rows: LiveWaitsRow[] = [];
  const seenIds = new Set<string>();

  for (const entry of entries) {
    if (seenIds.has(entry.experienceId)) {
      continue;
    }
    seenIds.add(entry.experienceId);

    const experience = experiencesById.get(entry.experienceId);
    if (!isLiveWaitEligible(entry, experience)) {
      continue;
    }

    const closedOrDown = isEntryClosedOrDown(entry.status, entry.waitMinutes);
    const land = experience?.land ?? (experience?.areaType === 'ThemePark' ? experience.worldShowcaseCountry : null) ?? null;
    const hasLL = Boolean(entry.lightningLane || experience?.category === 'Ride' || (experience?.category as string) === 'Attraction');

    rows.push({
      experienceId: entry.experienceId,
      name: entry.name,
      waitMinutes: closedOrDown ? null : entry.waitMinutes,
      isClosedOrDown: closedOrDown,
      land,
      ...(entry.lightningLane !== undefined ? { lightningLane: entry.lightningLane } : {}),
      isLightningLane: hasLL,
    });
  }

  // Sort ascending by waitMinutes, with closed/down entries last (R10.2)
  rows.sort((a, b) => {
    if (a.isClosedOrDown !== b.isClosedOrDown) {
      return a.isClosedOrDown ? 1 : -1;
    }
    if (!a.isClosedOrDown && !b.isClosedOrDown) {
      const waitA = a.waitMinutes ?? 0;
      const waitB = b.waitMinutes ?? 0;
      if (waitA !== waitB) {
        return waitA - waitB;
      }
    }
    return a.name.localeCompare(b.name);
  });

  // Apply filter
  if (filter === 'all') {
    return rows;
  }
  if (filter === 'walkOn') {
    return rows.filter((row) => isWalkOn(row.waitMinutes));
  }
  if (filter === 'lightningLane') {
    return rows.filter((row) => row.isLightningLane || row.lightningLane !== undefined);
  }
  if (filter === 'headliners') {
    return rows.filter((row) => {
      const exp = experiencesById.get(row.experienceId);
      return exp !== undefined && isHeadliner(exp);
    });
  }
  if (filter === 'favorites') {
    return rows.filter((row) => favoritedIds.has(row.experienceId));
  }

  return rows;
}
