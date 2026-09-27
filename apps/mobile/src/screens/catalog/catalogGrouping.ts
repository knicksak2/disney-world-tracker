/**
 * Framework-free grouping / ordering cores for the Level-2 Destination_Screen.
 *
 * These pure folds turn an already-fetched list of Experiences (and, for the
 * Resorts Destination, the active Resorts) into the ordered, sectioned shape
 * the three Destination_Screen layouts render:
 *
 *   - `groupByLand`         — theme-park / water-park layout (R6.2, R6.3, R6.6)
 *   - `groupByLandFiltered` — the Experience_Category filter over the Land
 *                             grouping (R6.7, R6.8, R6.9)
 *   - `groupByCategory`     — the Disney Springs layout (R7.2, R7.5)
 *   - `buildResortRows`     — the Resorts layout (R8.2, R8.3, R8.4)
 *
 * Every core is pure, total, and framework-free (no React, no react-navigation)
 * so the ordering / partition / omission guarantees are property-testable
 * without rendering, mirroring the existing `navigation/grouping.ts` pattern.
 * None of them mutates its input, and each is a total partition where the
 * requirements demand one: `groupByLand` and `buildResortRows` place every
 * input Experience in exactly one section/row so nothing is dropped.
 *
 * Validates: Requirements 6.2, 6.3, 6.6, 6.7, 6.8, 6.9, 7.2, 7.5, 8.2, 8.3, 8.4
 */

import { EXPERIENCE_CATEGORIES } from '@dwt/shared';
import type { ExperienceCategory, ExperienceDTO, ResortDTO } from '@dwt/shared';

/** One collapsible section rendered by a Destination_Screen layout. */
export interface Section<T> {
  /** Stable identity used as the section key and collapsible-state key. */
  readonly key: string;
  /** Human-facing section header title. */
  readonly title: string;
  /** The section's items, already ordered. */
  readonly items: readonly T[];
}

/**
 * The stable key/title of the single Land_Catchall section that holds every
 * `ThemePark`/`WaterPark` Experience with no persisted Land, appended after all
 * named Land sections so grouping by Land never omits an Experience (R6.6).
 */
export const LAND_CATCHALL_KEY = '__land_catchall__';

const LAND_CATCHALL_TITLE = 'Other';

/**
 * Case-insensitive ascending comparison of two strings, used both for ordering
 * Land sections by name and Experiences within a section by name (R6.2, R6.3),
 * and for ordering Resort anchors by name (R8.3). `localeCompare` with the
 * `sensitivity: 'base'` option ignores case (and accents) so `"fantasyland"`
 * and `"Fantasyland"` sort together deterministically.
 */
function compareCaseInsensitive(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

/** Whether a persisted Land value is a usable, non-empty section name. */
function hasNamedLand(land: string | null | undefined): land is string {
  return typeof land === 'string' && land.trim().length > 0;
}

/**
 * Group a park Destination's Experiences by Land (R6.2):
 *
 *   - named Land sections ordered case-insensitively ascending by Land name,
 *   - each section's Experiences ordered case-insensitively ascending by name
 *     (R6.3),
 *   - a single Land_Catchall section (Experiences with no persisted Land)
 *     appended after all named sections (R6.6).
 *
 * The result is a total partition: the union of every section's items equals
 * the input, so no Experience is omitted. The Land_Catchall section is included
 * only when at least one Experience has no persisted Land.
 */
export function groupByLand(
  experiences: readonly ExperienceDTO[],
): readonly Section<ExperienceDTO>[] {
  return groupByLandKey(experiences, (experience) => experience.land ?? null);
}

/**
 * The browse-land key for a Destination_Screen Land grouping.
 *
 * For an EPCOT World Showcase Experience — one that carries a resolved
 * `worldShowcaseCountry` — the browse land is its country pavilion (e.g.
 * "France"), so the single upstream "World Showcase" Land expands into per-
 * pavilion sections. Every other Experience keeps its persisted Land. Returns
 * `null` when neither is a usable, non-empty name (the Land_Catchall bucket).
 */
export function browseLandOf(experience: ExperienceDTO): string | null {
  if (hasNamedLand(experience.worldShowcaseCountry)) {
    return experience.worldShowcaseCountry;
  }
  return experience.land ?? null;
}

/**
 * Shared Land-bucketing fold parameterized by the land accessor `landOf`, so
 * `groupByLand` (exact persisted Land) and the pavilion-aware browse grouping
 * (`browseLandOf`) share one implementation and cannot drift on the ordering,
 * within-section ordering, or catch-all placement guarantees (R6.2, R6.3, R6.6).
 */
function groupByLandKey(
  experiences: readonly ExperienceDTO[],
  landOf: (experience: ExperienceDTO) => string | null,
): readonly Section<ExperienceDTO>[] {
  // Bucket Experiences by their browse-land name; whitespace-only / absent Land
  // goes to the catch-all bucket.
  const byLand = new Map<string, ExperienceDTO[]>();
  const catchall: ExperienceDTO[] = [];

  for (const experience of experiences) {
    const land = landOf(experience);
    if (hasNamedLand(land)) {
      const bucket = byLand.get(land);
      if (bucket) {
        bucket.push(experience);
      } else {
        byLand.set(land, [experience]);
      }
    } else {
      catchall.push(experience);
    }
  }

  const sections: Section<ExperienceDTO>[] = [...byLand.keys()]
    .sort(compareCaseInsensitive)
    .map((land) => ({
      key: land,
      title: land,
      items: sortExperiencesByName(byLand.get(land) ?? []),
    }));

  if (catchall.length > 0) {
    sections.push({
      key: LAND_CATCHALL_KEY,
      title: LAND_CATCHALL_TITLE,
      items: sortExperiencesByName(catchall),
    });
  }

  return sections;
}

/** Order Experiences case-insensitively ascending by name (R6.3), immutably. */
function sortExperiencesByName(
  experiences: readonly ExperienceDTO[],
): readonly ExperienceDTO[] {
  return [...experiences].sort((a, b) => compareCaseInsensitive(a.name, b.name));
}

/**
 * Apply an optional Experience_Category filter over the Land grouping (R6.8):
 *
 *   - a `null` category returns the full Land grouping unchanged (R6.7),
 *   - a non-null category keeps only Experiences of that category while
 *     preserving the Land grouping and section ordering (R6.8), and omits any
 *     Land section left with no matching Experience (R6.9).
 *
 * Because it filters the input before delegating to `groupByLand`, the
 * ordering, catch-all placement, and within-section ordering guarantees are
 * identical to the unfiltered grouping.
 */
export function groupByLandFiltered(
  experiences: readonly ExperienceDTO[],
  category: ExperienceCategory | null,
): readonly Section<ExperienceDTO>[] {
  if (category === null) {
    return groupByLand(experiences);
  }
  return groupByLand(experiences.filter((e) => e.category === category));
}

/**
 * The pavilion-aware counterpart to {@link groupByLandFiltered} used by the
 * theme/water-park Destination_Screen.
 *
 * Identical to `groupByLandFiltered` except the Land grouping key is
 * {@link browseLandOf}: an EPCOT World Showcase Experience is grouped under its
 * country pavilion rather than the single umbrella "World Showcase" Land, so
 * the eleven pavilions become individually browsable sections interleaved
 * alphabetically with the other Lands. Experiences outside World Showcase carry
 * no `worldShowcaseCountry`, so their grouping is byte-for-byte identical to
 * `groupByLandFiltered` — this is a no-op for every non-EPCOT Destination.
 *
 * The Category filter (R6.7–R6.9) behaves exactly as in `groupByLandFiltered`:
 * a `null` category groups everything; a non-null category filters first, then
 * groups, omitting any pavilion/Land left empty.
 */
export function groupByPavilionFiltered(
  experiences: readonly ExperienceDTO[],
  category: ExperienceCategory | null,
): readonly Section<ExperienceDTO>[] {
  const scoped =
    category === null
      ? experiences
      : experiences.filter((e) => e.category === category);
  return groupByLandKey(scoped, browseLandOf);
}

/**
 * Group Disney Springs Experiences by Experience_Category in the canonical
 * category order (R7.2) — the `EXPERIENCE_CATEGORIES` order from `@dwt/shared`
 * (Ride, Show, Restaurant, Parade, Character_Meet, Tour, Recreation, Spa,
 * Event, Other) — omitting any category with zero Experiences (R7.5).
 */
export function groupByCategory(
  experiences: readonly ExperienceDTO[],
): readonly Section<ExperienceDTO>[] {
  const byCategory = new Map<ExperienceCategory, ExperienceDTO[]>();
  for (const experience of experiences) {
    const bucket = byCategory.get(experience.category);
    if (bucket) {
      bucket.push(experience);
    } else {
      byCategory.set(experience.category, [experience]);
    }
  }

  const sections: Section<ExperienceDTO>[] = [];
  for (const category of EXPERIENCE_CATEGORIES) {
    const items = byCategory.get(category);
    if (items && items.length > 0) {
      sections.push({ key: category, title: category, items });
    }
  }
  return sections;
}

/**
 * A row in the Resorts Destination layout: either a Resort anchor (a browsable
 * header the user can scroll to) or one Experience listed under the most recent
 * anchor above it.
 */
export type ResortRow =
  | { readonly kind: 'resort'; readonly resort: ResortDTO }
  | { readonly kind: 'experience'; readonly experience: ExperienceDTO };

/** The stable id used for the resort-wide catch-all anchor group (R8.4). */
export const RESORT_BOARDWALK_ID = '__resort_boardwalk__';
export const RESORT_BOARDWALK_TITLE = "Disney's BoardWalk & Promenade";

export const RESORT_WWOS_ID = '__resort_wwos__';
export const RESORT_WWOS_TITLE = 'ESPN Wide World of Sports Complex';

export const RESORT_RECREATION_ID = '__resort_catchall__';
export const RESORT_RECREATION_TITLE = 'Property-Wide Recreation & Sports';

/** Backward-compatible alias for the resort catch-all anchor/section group (R8.4, R22.1). */
export const RESORT_CATCHALL_ID = RESORT_RECREATION_ID;
export const RESORT_CATCHALL_NAME = RESORT_RECREATION_TITLE;

export type ResortSubDestination = 'boardwalk' | 'wwos' | 'recreation';

/**
 * Classify an unlinked resort-area Experience into one of the three structured
 * sub-destinations (R22.2, R22.3, R22.4).
 */
export function resolveResortSubDestination(
  experience: ExperienceDTO,
): ResortSubDestination {
  const resortArea = experience.resortArea;
  const nameLower = experience.name?.toLowerCase() ?? '';

  if (resortArea === 'EPCOT Resort Area' || nameLower.includes('boardwalk')) {
    return 'boardwalk';
  }

  if (
    resortArea === 'Wide World of Sports Resort Area' ||
    nameLower.includes('wide world of sports') ||
    nameLower.includes('espn')
  ) {
    return 'wwos';
  }

  return 'recreation';
}

/** The synthetic anchor Resort for structured sub-destination groups (R8.4, R22). */
function syntheticSubDestinationResort(id: string, name: string): ResortDTO {
  return {
    id,
    name,
    description: null,
    imageUrl: null,
    latitude: null,
    longitude: null,
    address: null,
    phone: null,
    representingExperienceId: null,
  };
}

/**
 * Build the flat, anchored Resorts Destination rows (R8.2, R8.3, R8.4, R22):
 *
 *   - every active Resort appears as a `resort` anchor row, ordered
 *     case-insensitively ascending by Resort name, including Resorts with no
 *     associated active Experiences (R8.3);
 *   - each Resort anchor is immediately followed by the `experience` rows whose
 *     `resortId` matches that Resort's Internal_Id (R8.2);
 *   - unlinked experiences (no `resortId` or unmatched `resortId`) are partitioned
 *     into structured sub-destinations (BoardWalk, ESPN WWOS, Property-Wide Recreation)
 *     and appended after all specific Resort groups (R22.1–R22.4).
 *
 * The Experiences form a total partition: each appears exactly once, under its
 * matched Resort or one of the trailing sub-destinations, so none is omitted and
 * no section is ever labeled 'Other'.
 */
export function buildResortRows(
  experiences: readonly ExperienceDTO[],
  resorts: readonly ResortDTO[],
): readonly ResortRow[] {
  const knownResortIds = new Set(resorts.map((r) => r.id));

  const byResort = new Map<string, ExperienceDTO[]>();
  const boardwalk: ExperienceDTO[] = [];
  const wwos: ExperienceDTO[] = [];
  const recreation: ExperienceDTO[] = [];

  for (const experience of experiences) {
    const resortId = experience.resortId;
    if (typeof resortId === 'string' && knownResortIds.has(resortId)) {
      const bucket = byResort.get(resortId);
      if (bucket) {
        bucket.push(experience);
      } else {
        byResort.set(resortId, [experience]);
      }
    } else {
      const subDest = resolveResortSubDestination(experience);
      if (subDest === 'boardwalk') {
        boardwalk.push(experience);
      } else if (subDest === 'wwos') {
        wwos.push(experience);
      } else {
        recreation.push(experience);
      }
    }
  }

  const orderedResorts = [...resorts].sort((a, b) =>
    compareCaseInsensitive(a.name, b.name),
  );

  const rows: ResortRow[] = [];
  for (const resort of orderedResorts) {
    rows.push({ kind: 'resort', resort });
    for (const experience of sortExperiencesByName(byResort.get(resort.id) ?? [])) {
      rows.push({ kind: 'experience', experience });
    }
  }

  if (boardwalk.length > 0) {
    rows.push({
      kind: 'resort',
      resort: syntheticSubDestinationResort(
        RESORT_BOARDWALK_ID,
        RESORT_BOARDWALK_TITLE,
      ),
    });
    for (const experience of sortExperiencesByName(boardwalk)) {
      rows.push({ kind: 'experience', experience });
    }
  }

  if (wwos.length > 0) {
    rows.push({
      kind: 'resort',
      resort: syntheticSubDestinationResort(RESORT_WWOS_ID, RESORT_WWOS_TITLE),
    });
    for (const experience of sortExperiencesByName(wwos)) {
      rows.push({ kind: 'experience', experience });
    }
  }

  if (recreation.length > 0) {
    rows.push({
      kind: 'resort',
      resort: syntheticSubDestinationResort(
        RESORT_RECREATION_ID,
        RESORT_RECREATION_TITLE,
      ),
    });
    for (const experience of sortExperiencesByName(recreation)) {
      rows.push({ kind: 'experience', experience });
    }
  }

  return rows;
}

/**
 * Group the Resorts Destination's Experiences into collapsible Sections per
 * active Resort (R8.2, R8.3) and structured sub-destinations (R22.1–R22.4):
 *
 *   - every active Resort becomes a Section, ordered case-insensitively
 *     ascending by name, INCLUDING Resorts with no active Experiences so the
 *     full resort directory stays browsable (R8.3);
 *   - each Section's items are its `resortId`-matched Experiences, ordered
 *     case-insensitively ascending by name (R8.2);
 *   - unlinked Experiences are partitioned into structured sub-destination
 *     Sections ("Disney's BoardWalk & Promenade", "ESPN Wide World of Sports Complex",
 *     "Property-Wide Recreation & Sports") and appended after all specific Resorts;
 *   - no Section is ever labeled 'Other'.
 *
 * The Experiences form a total partition: each appears in exactly one Section,
 * none is omitted, and no item is duplicated.
 */
export function groupByResort(
  experiences: readonly ExperienceDTO[],
  resorts: readonly ResortDTO[],
): readonly Section<ExperienceDTO>[] {
  const knownResortIds = new Set(resorts.map((r) => r.id));

  const byResort = new Map<string, ExperienceDTO[]>();
  const boardwalk: ExperienceDTO[] = [];
  const wwos: ExperienceDTO[] = [];
  const recreation: ExperienceDTO[] = [];

  for (const experience of experiences) {
    const resortId = experience.resortId;
    if (typeof resortId === 'string' && knownResortIds.has(resortId)) {
      const bucket = byResort.get(resortId);
      if (bucket) {
        bucket.push(experience);
      } else {
        byResort.set(resortId, [experience]);
      }
    } else {
      const subDest = resolveResortSubDestination(experience);
      if (subDest === 'boardwalk') {
        boardwalk.push(experience);
      } else if (subDest === 'wwos') {
        wwos.push(experience);
      } else {
        recreation.push(experience);
      }
    }
  }

  const sections: Section<ExperienceDTO>[] = [...resorts]
    .sort((a, b) => compareCaseInsensitive(a.name, b.name))
    .map((resort) => ({
      key: resort.id,
      title: resort.name,
      items: sortExperiencesByName(byResort.get(resort.id) ?? []),
    }));

  if (boardwalk.length > 0) {
    sections.push({
      key: RESORT_BOARDWALK_ID,
      title: RESORT_BOARDWALK_TITLE,
      items: sortExperiencesByName(boardwalk),
    });
  }

  if (wwos.length > 0) {
    sections.push({
      key: RESORT_WWOS_ID,
      title: RESORT_WWOS_TITLE,
      items: sortExperiencesByName(wwos),
    });
  }

  if (recreation.length > 0) {
    sections.push({
      key: RESORT_RECREATION_ID,
      title: RESORT_RECREATION_TITLE,
      items: sortExperiencesByName(recreation),
    });
  }

  return sections;
}
