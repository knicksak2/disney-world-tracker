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
  // Bucket Experiences by their exact persisted Land name; whitespace-only /
  // absent Land goes to the catch-all bucket.
  const byLand = new Map<string, ExperienceDTO[]>();
  const catchall: ExperienceDTO[] = [];

  for (const experience of experiences) {
    if (hasNamedLand(experience.land)) {
      const bucket = byLand.get(experience.land);
      if (bucket) {
        bucket.push(experience);
      } else {
        byLand.set(experience.land, [experience]);
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
export const RESORT_CATCHALL_ID = '__resort_catchall__';

const RESORT_CATCHALL_NAME = 'Other';

/**
 * Build the flat, anchored Resorts Destination rows (R8.2, R8.3, R8.4):
 *
 *   - every active Resort appears as a `resort` anchor row, ordered
 *     case-insensitively ascending by Resort name, including Resorts with no
 *     associated active Experiences (R8.3);
 *   - each Resort anchor is immediately followed by the `experience` rows whose
 *     `resortId` matches that Resort's Internal_Id (R8.2);
 *   - a single resort-wide catch-all anchor — carrying a synthetic `ResortDTO`
 *     with id `RESORT_CATCHALL_ID` — is appended after all specific Resort
 *     groups and holds every Experience with no `resortId` or a `resortId` that
 *     matches no active Resort (R8.4).
 *
 * The Experiences form a total partition: each appears exactly once, under its
 * matched Resort or the single trailing catch-all, so none is omitted. The
 * catch-all anchor is included only when it has at least one Experience.
 */
export function buildResortRows(
  experiences: readonly ExperienceDTO[],
  resorts: readonly ResortDTO[],
): readonly ResortRow[] {
  const knownResortIds = new Set(resorts.map((r) => r.id));

  // Bucket Experiences by matched resortId; unmatched / missing → catch-all.
  const byResort = new Map<string, ExperienceDTO[]>();
  const catchall: ExperienceDTO[] = [];

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
      catchall.push(experience);
    }
  }

  const orderedResorts = [...resorts].sort((a, b) =>
    compareCaseInsensitive(a.name, b.name),
  );

  const rows: ResortRow[] = [];
  for (const resort of orderedResorts) {
    rows.push({ kind: 'resort', resort });
    for (const experience of byResort.get(resort.id) ?? []) {
      rows.push({ kind: 'experience', experience });
    }
  }

  if (catchall.length > 0) {
    rows.push({ kind: 'resort', resort: catchallResort() });
    for (const experience of catchall) {
      rows.push({ kind: 'experience', experience });
    }
  }

  return rows;
}

/** The synthetic anchor Resort for the resort-wide catch-all group (R8.4). */
function catchallResort(): ResortDTO {
  return {
    id: RESORT_CATCHALL_ID,
    name: RESORT_CATCHALL_NAME,
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
 * Group the Resorts Destination's Experiences into one collapsible Section per
 * active Resort (R8.2, R8.3), the sectioned counterpart to {@link buildResortRows}
 * used by the collapsed-by-default Resorts layout:
 *
 *   - every active Resort becomes a Section, ordered case-insensitively
 *     ascending by name, INCLUDING Resorts with no active Experiences so the
 *     full resort directory stays browsable (R8.3);
 *   - each Section's items are its `resortId`-matched Experiences, ordered
 *     case-insensitively ascending by name (R8.2);
 *   - a single trailing catch-all Section (key `RESORT_CATCHALL_ID`) holds every
 *     Experience with no `resortId` or a `resortId` that matches no active
 *     Resort, appended after all specific Resorts and included only when it has
 *     at least one Experience (R8.4).
 *
 * The Experiences form a total partition: each appears in exactly one Section
 * (its matched Resort or the single catch-all), so none is omitted. The Section
 * `key` is the Resort's Internal_Id (or `RESORT_CATCHALL_ID`) so the layout can
 * derive stable per-section collapsible state and test ids.
 */
export function groupByResort(
  experiences: readonly ExperienceDTO[],
  resorts: readonly ResortDTO[],
): readonly Section<ExperienceDTO>[] {
  const knownResortIds = new Set(resorts.map((r) => r.id));

  const byResort = new Map<string, ExperienceDTO[]>();
  const catchall: ExperienceDTO[] = [];

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
      catchall.push(experience);
    }
  }

  const sections: Section<ExperienceDTO>[] = [...resorts]
    .sort((a, b) => compareCaseInsensitive(a.name, b.name))
    .map((resort) => ({
      key: resort.id,
      title: resort.name,
      items: sortExperiencesByName(byResort.get(resort.id) ?? []),
    }));

  if (catchall.length > 0) {
    sections.push({
      key: RESORT_CATCHALL_ID,
      title: RESORT_CATCHALL_NAME,
      items: sortExperiencesByName(catchall),
    });
  }

  return sections;
}
