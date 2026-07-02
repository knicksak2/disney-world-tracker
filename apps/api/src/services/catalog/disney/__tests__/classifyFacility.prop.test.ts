// Feature: disney-facilities-catalog-source, Property 5: Classification is a total mapping over the type space with correct sub-classification
/**
 * Property test for `classifyFacility` (design.md → Property 5).
 *
 * Property 5: Classification is a total mapping over the type space with
 * correct sub-classification.
 *
 * *For any* Facility_Document, `classifyFacility` returns a category if and
 * only if the document's `Facility_Type` is an `Experience_Eligible_Type`
 * (every `Non_Experience_Type`, the `resort` type, and any absent/unknown type
 * are excluded → `null`); the category follows the mapping table
 * (`attraction`→`Ride`, `entertainment`→`Show`, `restaurant`/`dinner-show`→
 * `Restaurant`, `tour`/`audio-tour`→`Tour`, `recreation`/`recreation-activity`→
 * `Recreation`, `spa`→`Spa`, `event`/`dining-event`→`Event`, any other eligible
 * type→`Other`); and for `attraction`/`entertainment` the result is `Parade` or
 * `Character_Meet` exactly when the case-insensitive keyword match succeeds on a
 * non-empty `Facility_SubType`, or, when `subType` is absent/empty, on the
 * `name`.
 *
 * The oracle here is independent of the implementation: expected sub-classes are
 * derived from the *kind* of keyword deliberately embedded in a generated
 * signal, never by re-running the production regexes. Base categories come from
 * a hand-written mapping table keyed by Facility_Type, with `Other` as the
 * fallback for any eligible type not covered by an explicit rule (R4.10).
 *
 * **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10**
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { ExperienceCategory } from '@dwt/shared';

import { classifyFacility } from '../classifyFacility.js';
import {
  EXPERIENCE_ELIGIBLE_TYPES,
  NON_EXPERIENCE_TYPES,
  RESORT_TYPE,
} from '../facilityDoc.js';
import type { FacilityDocument } from '../facilityDoc.js';

/** Spec convention: every `fc.assert` runs with at least 100 iterations. */
const NUM_RUNS = 200;

// ---------------------------------------------------------------------------
// Oracle: base-category mapping table (R4.2–R4.8, R4.10).
// ---------------------------------------------------------------------------

/**
 * Base category per Facility_Type, mirroring criteria 2–8. Any
 * Experience_Eligible_Type absent from this table falls back to `Other`
 * (R4.10) via {@link expectedBaseCategory}.
 */
const BASE_CATEGORY: Readonly<Record<string, ExperienceCategory>> = {
  attraction: 'Ride',
  entertainment: 'Show',
  restaurant: 'Restaurant',
  'dinner-show': 'Restaurant',
  tour: 'Tour',
  'audio-tour': 'Tour',
  recreation: 'Recreation',
  'recreation-activity': 'Recreation',
  spa: 'Spa',
  event: 'Event',
  'dining-event': 'Event',
};

/** Base category for an eligible type, defaulting to `Other` (R4.10). */
function expectedBaseCategory(type: string): ExperienceCategory {
  return BASE_CATEGORY[type] ?? 'Other';
}

const ELIGIBLE_TYPES: readonly string[] = [...EXPERIENCE_ELIGIBLE_TYPES];

/**
 * Build a Facility_Document, assigning only the optional keys that are defined.
 * Under `exactOptionalPropertyTypes`, an optional `string` property cannot be
 * assigned `undefined`, so a possibly-`undefined` generated value must be
 * omitted rather than written as `undefined`.
 */
function makeDoc(fields: {
  id: string;
  type?: string | undefined;
  name?: string | undefined;
  subType?: string | undefined;
}): FacilityDocument {
  const doc: { id: string; type?: string; name?: string; subType?: string } = {
    id: fields.id,
  };
  if (fields.type !== undefined) doc.type = fields.type;
  if (fields.name !== undefined) doc.name = fields.name;
  if (fields.subType !== undefined) doc.subType = fields.subType;
  return doc;
}

// ---------------------------------------------------------------------------
// Signal generators: safe filler + keyword tokens with known sub-classes.
// ---------------------------------------------------------------------------

/**
 * Words that contain none of the sub-classification keywords (`parade`,
 * `character`, `meet`, `greet`), so filler can never accidentally trigger a
 * sub-class. Used to surround the deliberately embedded keyword tokens.
 */
const SAFE_WORDS = [
  'fantasy',
  'spectacular',
  'journey',
  'festival',
  'magic',
  'river',
  'nighttime',
  'lights',
  'world',
  'adventure',
  'celebration',
  'dreams',
  'safari',
  'splash',
] as const;

/** Zero-to-three safe words joined by spaces; may be the empty string. */
const safeFillerArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...SAFE_WORDS), { minLength: 0, maxLength: 3 })
  .map((words) => words.join(' '));

/** Same, but always non-empty (at least one safe word). */
const nonEmptyFillerArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...SAFE_WORDS), { minLength: 1, maxLength: 3 })
  .map((words) => words.join(' '));

/** Tokens that must match the parade keyword, in mixed casing (R4.9). */
const paradeTokenArb = fc.constantFrom(
  'parade',
  'Parade',
  'PARADE',
  'Christmas Parade',
  'a pArAdE of lights',
);

/** Tokens that must match the character keyword, in mixed casing (R4.9). */
const characterTokenArb = fc.constantFrom(
  'character',
  'Character',
  'CHARACTER',
  'Character Greeting',
);

/**
 * Tokens that must match the meet-and-greet keyword forms, in mixed casing
 * (R4.9). Deliberately excludes ampersand phrasings ("meet & greet") that the
 * keyword pattern does not recognize.
 */
const meetGreetTokenArb = fc.constantFrom(
  'meet greet',
  'meet and greet',
  'meet-and-greet',
  'meetandgreet',
  'Meet And Greet',
  'MEET GREET',
);

/** The kinds of sub-classification signal we can deliberately construct. */
type SignalKind = 'parade' | 'character' | 'meet-greet' | 'plain';

/** Expected sub-class for a signal kind, or `null` when none applies. */
function expectedSubClass(
  kind: SignalKind,
): 'Parade' | 'Character_Meet' | null {
  switch (kind) {
    case 'parade':
      return 'Parade';
    case 'character':
    case 'meet-greet':
      return 'Character_Meet';
    case 'plain':
      return null;
  }
}

/** Embed a keyword token among safe filler on both sides. */
function embed(tokenArb: fc.Arbitrary<string>): fc.Arbitrary<string> {
  return fc
    .tuple(safeFillerArb, tokenArb, safeFillerArb)
    .map(([before, token, after]) =>
      [before, token, after].filter((part) => part !== '').join(' '),
    );
}

/**
 * A signal string for a given kind. `plain` yields keyword-free filler (which
 * may be empty); the keyword kinds embed a matching token so the expected
 * sub-class is fully determined by {@link expectedSubClass}.
 */
function signalArb(kind: SignalKind): fc.Arbitrary<string> {
  switch (kind) {
    case 'parade':
      return embed(paradeTokenArb);
    case 'character':
      return embed(characterTokenArb);
    case 'meet-greet':
      return embed(meetGreetTokenArb);
    case 'plain':
      return safeFillerArb;
  }
}

/** A non-empty signal of the given kind (used for authoritative subTypes). */
function nonEmptySignalArb(kind: SignalKind): fc.Arbitrary<string> {
  return kind === 'plain' ? nonEmptyFillerArb : signalArb(kind);
}

const signalKindArb = fc.constantFrom<SignalKind>(
  'parade',
  'character',
  'meet-greet',
  'plain',
);

// ---------------------------------------------------------------------------
// Property 5.
// ---------------------------------------------------------------------------

describe('classifyFacility — Property 5: total mapping with sub-classification', () => {
  it('maps every Experience_Eligible_Type to its correct base category (keyword-free signals)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ELIGIBLE_TYPES),
        fc.option(safeFillerArb, { nil: undefined }),
        fc.option(safeFillerArb, { nil: undefined }),
        (type, name, subType) => {
          const doc = makeDoc({ id: 'x', type, name, subType });
          expect(classifyFacility(doc)).toBe(expectedBaseCategory(type));
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('excludes every Non_Experience_Type, the resort type, and absent/unknown types (→ null) (R4.1)', () => {
    const nonEligibleTypeArb = fc.oneof(
      fc.constantFrom(...NON_EXPERIENCE_TYPES, RESORT_TYPE),
      fc.constant(undefined),
      // Arbitrary unknown strings that are not eligible types.
      fc.string().filter((s) => !EXPERIENCE_ELIGIBLE_TYPES.has(s)),
    );

    fc.assert(
      fc.property(
        nonEligibleTypeArb,
        // Even keyword-laden names/subTypes must not rescue a non-eligible type.
        fc.option(signalArb('parade'), { nil: undefined }),
        fc.option(signalArb('character'), { nil: undefined }),
        (type, name, subType) => {
          const doc = makeDoc({ id: 'x', type, name, subType });
          expect(classifyFacility(doc)).toBeNull();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('sub-classifies attraction/entertainment from a non-empty subType, ignoring name (R4.2, R4.3, R4.9)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('attraction', 'entertainment'),
        signalKindArb,
        (type, subKind) => {
          const base: ExperienceCategory =
            type === 'attraction' ? 'Ride' : 'Show';
          const subTypeArb = nonEmptySignalArb(subKind);
          return fc.assert(
            fc.property(subTypeArb, (subType) => {
              // name always carries a character-meet keyword; it must be
              // ignored because subType is present and non-blank.
              const doc: FacilityDocument = {
                id: 'x',
                type,
                name: 'Character Meet and Greet',
                subType,
              };
              const expected = expectedSubClass(subKind) ?? base;
              expect(classifyFacility(doc)).toBe(expected);
            }),
            { numRuns: 25 },
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('falls back to name for sub-classification when subType is absent or blank (R4.9)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('attraction', 'entertainment'),
        signalKindArb,
        // subType absent, empty, or whitespace-only → name is the signal.
        fc.constantFrom(undefined, '', '   ', '\t'),
        (type, nameKind, subType) => {
          const base: ExperienceCategory =
            type === 'attraction' ? 'Ride' : 'Show';
          return fc.assert(
            fc.property(signalArb(nameKind), (name) => {
              const doc = makeDoc({ id: 'x', type, name, subType });
              const expected = expectedSubClass(nameKind) ?? base;
              expect(classifyFacility(doc)).toBe(expected);
            }),
            { numRuns: 25 },
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('prefers Parade over Character_Meet when both keywords are present (R4.9)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('attraction', 'entertainment'),
        paradeTokenArb,
        characterTokenArb,
        safeFillerArb,
        (type, parade, character, filler) => {
          const subType = [filler, parade, character]
            .filter((part) => part !== '')
            .join(' ');
          const doc: FacilityDocument = { id: 'x', type, subType };
          expect(classifyFacility(doc)).toBe('Parade');
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('never sub-classifies non-attraction/entertainment eligible types, even with keyword signals (R4.2, R4.3 scope)', () => {
    const otherEligibleArb = fc.constantFrom(
      ...ELIGIBLE_TYPES.filter(
        (t) => t !== 'attraction' && t !== 'entertainment',
      ),
    );

    fc.assert(
      fc.property(
        otherEligibleArb,
        fc.oneof(
          signalArb('parade'),
          signalArb('character'),
          signalArb('meet-greet'),
        ),
        fc.oneof(
          signalArb('parade'),
          signalArb('character'),
          signalArb('meet-greet'),
        ),
        (type, name, subType) => {
          const doc: FacilityDocument = { id: 'x', type, name, subType };
          // Result is the plain base category; never Parade/Character_Meet.
          expect(classifyFacility(doc)).toBe(expectedBaseCategory(type));
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
