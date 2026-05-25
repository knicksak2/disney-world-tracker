/**
 * Pure classification of an upstream ThemeParks.wiki entity into an
 * `ExperienceCategory`.
 *
 * This function is the single point at which the design's
 * "Entity-type to Experience_Category mapping" table (design.md →
 * Catalog_Service) is encoded. It is intentionally:
 *
 *   - **Pure**: depends only on its argument; no I/O, no clock, no globals.
 *   - **Total**: always returns an `ExperienceCategory`; never throws.
 *   - **Deterministic**: equal inputs always produce equal outputs, so it
 *     is a sound property-test target (see Property 1).
 *
 * Mapping table (from design.md):
 *
 *   | entityType  | sub-classification signal           | result          |
 *   | ----------- | ----------------------------------- | --------------- |
 *   | ATTRACTION  | parade indicator                    | Parade          |
 *   | ATTRACTION  | character-meet indicator            | Character_Meet  |
 *   | ATTRACTION  | (none of the above)                 | Ride            |
 *   | SHOW        | n/a                                 | Show            |
 *   | RESTAURANT  | n/a                                 | Restaurant      |
 *   | (any other) | n/a                                 | Other           |
 *
 * Sub-classification precedence for `ATTRACTION` entities:
 *
 *   1. The structured `attractionType` field, when present, is
 *      authoritative:
 *        - `"PARADE"`         → `Parade`
 *        - `"MEET_AND_GREET"` → `Character_Meet`
 *
 *   2. Otherwise, name-based regex fallbacks are applied:
 *        - `/parade/i`                    → `Parade`
 *        - `/meet[- ]?(and[- ]?)?greet/i` → `Character_Meet`
 *
 *   3. Otherwise the base `ATTRACTION` mapping → `Ride`.
 *
 * Sub-classification is only consulted for `ATTRACTION` entities. A `SHOW`
 * or `RESTAURANT` whose name happens to contain "parade" is still mapped by
 * its base `entityType`; the design's mapping table only places the parade
 * and character-meet sub-classification rows under `ATTRACTION`.
 *
 * Note on the include set (R1.2): this function does not enforce the
 * include-set rule. The caller is responsible for filtering entities whose
 * `entityType` is outside `{ATTRACTION, SHOW, RESTAURANT}` before producing
 * Experience records. `classify` is total over the full upstream value
 * space and treats anything outside the named types as `Other`, which is
 * the safe default and matches the "any other included upstream entity
 * type maps to Other" clause of R1.3.
 *
 * Validates: Requirements 1.2, 1.3, 1.4, 1.5
 */

import type { ExperienceCategory } from '@dwt/shared';
import type { ThemeParksEntity } from './types.js';

/** Matches the literal token "parade" anywhere in the name, case-insensitive. */
const PARADE_NAME_PATTERN = /parade/i;

/**
 * Matches "meet greet", "meet and greet", "meet-and-greet", "meet&greet"-like
 * variants — the conventional upstream phrasing for character meet-and-greet
 * experiences — case-insensitive.
 */
const CHARACTER_MEET_NAME_PATTERN = /meet[- ]?(and[- ]?)?greet/i;

/** Upstream `attractionType` value that authoritatively marks a parade. */
const ATTRACTION_TYPE_PARADE = 'PARADE';

/** Upstream `attractionType` value that authoritatively marks a character meet. */
const ATTRACTION_TYPE_MEET_AND_GREET = 'MEET_AND_GREET';

/**
 * Classify a single upstream entity into an `ExperienceCategory`.
 *
 * @param entity - Minimal upstream entity projection (see `ThemeParksEntity`).
 * @returns The `ExperienceCategory` per the design's mapping table.
 */
export function classify(entity: ThemeParksEntity): ExperienceCategory {
  switch (entity.entityType) {
    case 'ATTRACTION':
      return classifyAttraction(entity);
    case 'SHOW':
      return 'Show';
    case 'RESTAURANT':
      return 'Restaurant';
    default:
      return 'Other';
  }
}

/**
 * Sub-classify an `ATTRACTION` entity. Structured `attractionType` is
 * checked first so that an upstream value of `"PARADE"` or
 * `"MEET_AND_GREET"` always wins over the name regex, even if the name is
 * ambiguous or absent.
 */
function classifyAttraction(entity: ThemeParksEntity): ExperienceCategory {
  if (entity.attractionType === ATTRACTION_TYPE_PARADE) {
    return 'Parade';
  }
  if (entity.attractionType === ATTRACTION_TYPE_MEET_AND_GREET) {
    return 'Character_Meet';
  }

  if (PARADE_NAME_PATTERN.test(entity.name)) {
    return 'Parade';
  }
  if (CHARACTER_MEET_NAME_PATTERN.test(entity.name)) {
    return 'Character_Meet';
  }

  return 'Ride';
}
