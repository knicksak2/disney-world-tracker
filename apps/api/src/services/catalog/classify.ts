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
 * Mapping table:
 *
 *   | entityType  | sub-classification signal           | result          |
 *   | ----------- | ----------------------------------- | --------------- |
 *   | ATTRACTION  | parade indicator                    | Parade          |
 *   | ATTRACTION  | character-meet indicator            | Character_Meet  |
 *   | ATTRACTION  | (none of the above)                 | Ride            |
 *   | SHOW        | parade indicator                    | Parade          |
 *   | SHOW        | character-meet indicator            | Character_Meet  |
 *   | SHOW        | (none of the above)                 | Show            |
 *   | RESTAURANT  | n/a                                 | Restaurant      |
 *   | (any other) | n/a                                 | Other           |
 *
 * Sub-classification precedence (applied to both `ATTRACTION` and `SHOW`):
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
 *   3. Otherwise the base mapping applies (`ATTRACTION → Ride`,
 *      `SHOW → Show`).
 *
 * Why `SHOW` is sub-classified too: upstream (ThemeParks.wiki) is not
 * consistent about whether a character meet-and-greet is an `ATTRACTION`
 * or a `SHOW`. Many meet-and-greets that run at a stage/theater come
 * through with `entityType === 'SHOW'`, and parades occasionally do as
 * well. Consulting the same parade / character-meet signals for `SHOW`
 * keeps those experiences out of the generic `Show` bucket and in the
 * category the user actually expects.
 *
 * `RESTAURANT` is deliberately *not* sub-classified: a dining location
 * named e.g. "Meet & Greet Cafe" is still a `Restaurant`, and there is no
 * upstream ambiguity to correct for there.
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
 * Matches the conventional upstream phrasings for a character meet-and-greet
 * experience, case-insensitive:
 *
 *   - The explicit "meet greet" / "meet and greet" / "meet-and-greet" /
 *     "meetandgreet" forms, anywhere in the name; and
 *   - A name that *begins* with the word "meet" (e.g. "Meet Mickey Mouse at
 *     Town Square Theater", "Meet Disney Princesses at Princess Fairytale
 *     Hall"). This is the dominant naming convention for WDW meet-and-greets
 *     and the only signal available when upstream types them as `SHOW`
 *     (which, unlike `ATTRACTION`, does not carry an `attractionType`).
 *
 * The leading-"meet" branch is intentionally anchored to the start of the
 * name (`^meet\b`) rather than matching "meet" anywhere, to avoid
 * misclassifying shows whose descriptions or titles merely mention meeting.
 */
const CHARACTER_MEET_NAME_PATTERN = /^meet\b|meet[- ]?(and[- ]?)?greet/i;

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
      return subClassify(entity) ?? 'Ride';
    case 'SHOW':
      return subClassify(entity) ?? 'Show';
    case 'RESTAURANT':
      return 'Restaurant';
    default:
      return 'Other';
  }
}

/**
 * Detect a parade / character-meet sub-classification from an entity's
 * structured `attractionType` (authoritative when present) or its name.
 * Returns `null` when neither signal matches, leaving the caller to apply
 * the base mapping for the entity's `entityType`.
 *
 * Structured `attractionType` is checked first so that an upstream value
 * of `"PARADE"` or `"MEET_AND_GREET"` always wins over the name regex,
 * even if the name is ambiguous or absent. Among the name fallbacks the
 * parade pattern is tested before the character-meet pattern.
 */
function subClassify(
  entity: ThemeParksEntity,
): 'Parade' | 'Character_Meet' | null {
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

  return null;
}
