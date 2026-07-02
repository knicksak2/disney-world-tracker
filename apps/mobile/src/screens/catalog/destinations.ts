/**
 * Destination model, canonical grid ordering, and Destination → catalog-filter
 * mapping for the redesigned two-level catalog navigation.
 *
 * A Destination is the top-level browse target presented on Catalog_Home: each
 * of the four Walt Disney World theme parks, each of the two water parks,
 * Disney Springs, and a single aggregate Resorts Destination. This module is
 * framework-free (no React, no react-navigation) so the ordering and
 * filter-mapping guarantees are unit- and property-testable without rendering,
 * mirroring the existing `navigation/grouping.ts` / `experienceFilter.ts`
 * pattern.
 *
 * Seven of the eight `DestinationId` values are exactly the `Park` enum strings
 * from `@dwt/shared` (they are the values stored in `experiences.park` and the
 * values the `GET /catalog` `parkId` query parameter accepts); the eighth,
 * `'Resorts'`, is the aggregate over every `Resort`-area Experience.
 *
 * Validates: Requirements 4.1, 6.1, 7.1, 8.1
 */

import type { Park } from '@dwt/shared';

/**
 * A top-level browse target on Catalog_Home. The seven park identifiers are the
 * canonical `Park` display-name strings; `'Resorts'` is the aggregate
 * Destination covering every active `Resort`-area Experience (R4.5).
 */
export type DestinationId =
  | 'Magic Kingdom'
  | 'EPCOT'
  | 'Hollywood Studios'
  | 'Animal Kingdom'
  | 'Typhoon Lagoon'
  | 'Blizzard Beach'
  | 'Disney Springs'
  | 'Resorts';

/**
 * How a Destination_Screen groups a Destination's Experiences:
 *
 *   - `themeOrWaterPark` — grouped by Land as collapsible sections with an
 *     Experience_Category filter on top (R6).
 *   - `disneySprings`    — grouped by Experience_Category (R7).
 *   - `resorts`          — grouped by specific Resort (R8).
 */
export type DestinationKind = 'themeOrWaterPark' | 'disneySprings' | 'resorts';

/** One Catalog_Home Destination card. */
export interface Destination {
  /** Stable identifier; a `Park` string for the seven parks, or `'Resorts'`. */
  readonly id: DestinationId;
  /** Which Level-2 grouping layout the Destination_Screen renders. */
  readonly kind: DestinationKind;
  /** Human-facing card / screen title. */
  readonly title: string;
}

/**
 * The eight Destinations in canonical Catalog_Home grid order: the four theme
 * parks, then the two water parks, then Disney Springs, then the aggregate
 * Resorts Destination (R4.1). This exact ordering is what the grid renders and
 * what every ordering-related requirement (R6.1, R7.1, R8.1) anchors on.
 */
export const DESTINATIONS: readonly Destination[] = [
  // Four theme parks
  { id: 'Magic Kingdom', kind: 'themeOrWaterPark', title: 'Magic Kingdom' },
  { id: 'EPCOT', kind: 'themeOrWaterPark', title: 'EPCOT' },
  { id: 'Hollywood Studios', kind: 'themeOrWaterPark', title: 'Hollywood Studios' },
  { id: 'Animal Kingdom', kind: 'themeOrWaterPark', title: 'Animal Kingdom' },
  // Two water parks
  { id: 'Typhoon Lagoon', kind: 'themeOrWaterPark', title: 'Typhoon Lagoon' },
  { id: 'Blizzard Beach', kind: 'themeOrWaterPark', title: 'Blizzard Beach' },
  // Disney Springs
  { id: 'Disney Springs', kind: 'disneySprings', title: 'Disney Springs' },
  // Aggregate Resorts Destination
  { id: 'Resorts', kind: 'resorts', title: 'Resorts' },
];

/**
 * The `GET /catalog` filter that fetches a Destination's active Experiences
 * (R6.1, R7.1, R8.1):
 *
 *   - A park Destination (theme park, water park, or Disney Springs) filters by
 *     `parkId` equal to the Destination's `Park` identifier — the same
 *     `parkId → park` mapping the API route already performs.
 *   - The aggregate Resorts Destination filters by `areaType: 'Resort'` so it
 *     collects every active `Resort`-area Experience across all Resorts (R4.5,
 *     R8.1).
 */
export function destinationCatalogFilter(
  d: Destination,
): { parkId?: string; areaType?: 'Resort' } {
  if (d.kind === 'resorts') {
    return { areaType: 'Resort' };
  }
  // For a park Destination the identifier is exactly the `Park` enum string
  // the `parkId` query parameter expects.
  return { parkId: d.id as Park };
}

/**
 * The screen-reader label for a Catalog_Home Destination card (R12.1): the
 * Destination name followed by its active-Experience count as a numeric value,
 * e.g. `"Magic Kingdom, 42 experiences"`. Pure and framework-free so the label
 * format is unit-testable without rendering. The count is included verbatim as
 * a number so assistive technology announces it as a numeric value.
 */
export function destinationCardLabel(name: string, count: number): string {
  return `${name}, ${count} experiences`;
}
