/**
 * Pure classification of a Disney Facility_Document into an
 * `ExperienceCategory`, or `null` when the document's Facility_Type is not a
 * catalog Experience.
 *
 * This module encodes the expanded-taxonomy mapping table from design.md →
 * "4. Classification (`classifyFacility.ts`)" and Requirement 4 (R4.1–R4.10).
 * It mirrors the purity discipline and sub-classification precedence already
 * established in the sibling `../classify.ts` (structured signal first, then a
 * name fallback):
 *
 *   - **Pure**: depends only on its argument; no I/O, no clock, no globals.
 *   - **Total**: defined for every possible `FacilityDocument`, including one
 *     with an absent or unrecognized `type`; never throws.
 *   - **Deterministic**: equal inputs always produce equal outputs, so it is a
 *     sound property-test target (see Property 5).
 *
 * Mapping table (R4.2–R4.10):
 *
 *   | Facility_Type                    | Base category | Sub-classified?              |
 *   | -------------------------------- | ------------- | ---------------------------- |
 *   | `attraction`                     | `Ride`        | yes → `Parade`/`Character_Meet` |
 *   | `entertainment`                  | `Show`        | yes → `Parade`/`Character_Meet` |
 *   | `restaurant`, `dinner-show`      | `Restaurant`  | no                           |
 *   | `tour`, `audio-tour`             | `Tour`        | no                           |
 *   | `recreation`, `recreation-activity` | `Recreation` | no                        |
 *   | `spa`                            | `Spa`         | no                           |
 *   | `event`, `dining-event`          | `Event`       | no                           |
 *   | any other Experience_Eligible_Type | `Other`     | no                           |
 *   | any Non_Experience_Type / `resort` / absent / unknown | (excluded → `null`) | — |
 *
 * Exclusion (R4.1): only a Facility_Type in `EXPERIENCE_ELIGIBLE_TYPES` becomes
 * a candidate Experience. Every Non_Experience_Type, the `resort` type (handled
 * separately as a first-class Resort per Requirement 6), and any absent or
 * unrecognized type therefore map to `null` so the sync orchestrator drops them
 * from the Experience set.
 *
 * Sub-classification signal (R4.9): for `attraction` and `entertainment`, a
 * non-empty `subType` is matched case-insensitively against the parade /
 * character-meet keywords first; when `subType` is absent or blank, the same
 * keyword match runs against the document `name`. The parade keyword is tested
 * before the character-meet keyword.
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10
 */

import type { ExperienceCategory } from '@dwt/shared';

import { categoryOverrideFor } from './categoryOverrides.js';
import { EXPERIENCE_ELIGIBLE_TYPES } from './facilityDoc.js';
import type { FacilityDocument } from './facilityDoc.js';

/** Matches the token "parade" anywhere in the signal, case-insensitive (R4.9). */
const PARADE_PATTERN = /parade/i;

/**
 * Matches the conventional Disney sub-type / naming phrasings for a character
 * meet-and-greet, case-insensitive (R4.9):
 *
 *   - the word "character" (Disney sub-types such as "Character Greeting" /
 *     "Character Meet & Greet"); and
 *   - the "meet greet" / "meet and greet" / "meet-and-greet" / "meetandgreet"
 *     forms.
 */
const CHARACTER_MEET_PATTERN = /character|meet[- ]?(?:and[- ]?)?greet/i;

/**
 * Classify a Facility_Document into an `ExperienceCategory`, or `null` when the
 * document's Facility_Type is not a catalog Experience.
 *
 * @param doc - The tolerant Disney Facility_Document projection.
 * @returns The `ExperienceCategory` per the mapping table, or `null` when the
 *   Facility_Type is a Non_Experience_Type, `resort`, absent, or unrecognized
 *   and must be excluded from the Experience set (R4.1).
 */
export function classifyFacility(
  doc: FacilityDocument,
): ExperienceCategory | null {
  // R2.3: consult curated Category_Overrides first.
  const override = categoryOverrideFor(doc.id);
  if (override !== null) {
    return override;
  }

  const type = doc.type;

  // R4.1: only an Experience_Eligible_Type is a candidate Experience. Every
  // Non_Experience_Type, the `resort` type, and any absent/unrecognized type
  // are excluded from the Experience set.
  if (type === undefined || !EXPERIENCE_ELIGIBLE_TYPES.has(type)) {
    return null;
  }

  switch (type) {
    case 'attraction':
      return subClassify(doc) ?? 'Ride'; // R4.2
    case 'entertainment':
      return subClassify(doc) ?? 'Show'; // R4.3
    case 'restaurant':
    case 'dinner-show':
      return 'Restaurant'; // R4.4
    case 'tour':
    case 'audio-tour':
      return 'Tour'; // R4.5
    case 'recreation':
    case 'recreation-activity':
      return 'Recreation'; // R4.6
    case 'spa':
      return 'Spa'; // R4.7
    case 'event':
    case 'dining-event':
      return 'Event'; // R4.8
    default:
      // R4.10: an Experience_Eligible_Type not covered by criteria 2–8.
      return 'Other';
  }
}

/**
 * Detect a `Parade` / `Character_Meet` sub-classification for an `attraction`
 * or `entertainment` document (R4.9).
 *
 * Precedence: a non-empty `subType` is authoritative; when `subType` is absent
 * or consists only of whitespace, the document `name` is used as the fallback
 * signal. The chosen signal is matched case-insensitively against the parade
 * keyword first, then the character-meet keyword. Returns `null` when neither
 * keyword matches (or no signal is available), leaving the caller to apply the
 * base category for the Facility_Type.
 */
function subClassify(
  doc: FacilityDocument,
): 'Parade' | 'Character_Meet' | null {
  const subType = doc.subType;
  const signal =
    subType !== undefined && subType.trim() !== '' ? subType : doc.name;

  if (signal === undefined) {
    return null;
  }

  if (PARADE_PATTERN.test(signal)) {
    return 'Parade';
  }
  if (CHARACTER_MEET_PATTERN.test(signal)) {
    return 'Character_Meet';
  }

  return null;
}
