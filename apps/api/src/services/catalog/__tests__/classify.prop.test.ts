// Feature: disney-world-tracker, Property 1: classify maps every included entity by the rule table
/**
 * Property-based tests for `classify(entity)`.
 *
 * Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.6
 *
 * Property 1 (design.md → Correctness Properties → "Catalog classification
 * and park mapping"):
 *
 *   For any upstream entity tree returned by the ThemeParks_API, every
 *   entity whose `entityType` is in `{ATTRACTION, SHOW, RESTAURANT}` (or
 *   is otherwise included by the include-set rule) is classified by
 *   `classify(entity)` according to the mapping table — parade indicator
 *   yields `Parade`, character-meet indicator yields `Character_Meet`,
 *   and otherwise the base mapping
 *   `ATTRACTION→Ride, SHOW→Show, RESTAURANT→Restaurant, other→Other`
 *   applies — and is associated with exactly one Park value derived by
 *   walking the entity's parent chain to a known Park root.
 *
 * Scope of this file: the *classification* half of Property 1 (the rule
 * table itself, R1.2-R1.5). The Park-mapping half (R1.6) is implemented
 * outside `classify` by walking the upstream parent chain to a known Park
 * root and is exercised at the catalog-pipeline integration level.
 *
 * Mapping table under test (design.md → Catalog_Service):
 *
 *   1. ATTRACTION + `attractionType === 'PARADE'`         → Parade
 *   2. ATTRACTION + `attractionType === 'MEET_AND_GREET'` → Character_Meet
 *   3. ATTRACTION + name matches /parade/i                → Parade
 *   4. ATTRACTION + name matches /meet[- ]?(and[- ]?)?greet/i → Character_Meet
 *   5. ATTRACTION otherwise                               → Ride
 *   6. SHOW (regardless of name/attractionType)           → Show
 *   7. RESTAURANT (regardless of name)                    → Restaurant
 *   8. Anything else                                      → Other
 *
 * `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { classify } from '../classify.js';
import type { ThemeParksEntity } from '../types.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Regex patterns mirrored from `classify.ts`
// ---------------------------------------------------------------------------
//
// These are the *same* shapes encoded in `classify.ts` — kept in sync here
// so the assertions can express the property text directly. If the
// implementation file evolves its regex, this file is the canonical mirror
// and must be updated at the same time.

const PARADE_NAME_PATTERN = /parade/i;
const CHARACTER_MEET_NAME_PATTERN = /meet[- ]?(and[- ]?)?greet/i;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Names that *do not* match either the parade or character-meet regex.
 *
 * Built from a charset that excludes the letters `p`/`P` and `m`/`M`, both
 * of which are required by the two patterns. This is a tighter constraint
 * than strictly necessary (any string lacking the literal "parade" or
 * "meet…greet" substring would do) but it keeps the generator total —
 * no `fc.pre` or filter rejection — which is what the `numRuns: 100`
 * budget needs.
 */
const NEUTRAL_CHARSET =
  "abcdefghijklnoqrstuvwxyzABCDEFGHIJKLNOQRSTUVWXYZ0123456789 -_!.,'\"";
const neutralNameArb = fc
  .array(fc.constantFrom(...NEUTRAL_CHARSET.split('')), {
    minLength: 1,
    maxLength: 64,
  })
  .map((chars) => chars.join(''));

/**
 * Names that match `/parade/i`.
 *
 * The neutral prefix/suffix exercises the regex against arbitrary
 * surrounding context (not just an exact match), and the parade token is
 * randomly cased per character so the test pins down the
 * case-insensitivity of the classifier.
 */
const paradeTokenArb = fc
  .array(
    fc.tuple(
      fc.constantFrom(...'parade'.split('')),
      fc.boolean(),
    ),
    { minLength: 6, maxLength: 6 },
  )
  // Build "parade" with random per-char casing.
  .map((_) => 'parade')
  .chain((token) =>
    fc
      .array(fc.boolean(), { minLength: token.length, maxLength: token.length })
      .map((flips) =>
        token
          .split('')
          .map((c, i) => (flips[i] ? c.toUpperCase() : c))
          .join(''),
      ),
  );

const paradeNameArb = fc
  .tuple(neutralNameArb, paradeTokenArb, neutralNameArb)
  .map(([a, b, c]) => `${a}${b}${c}`);

/**
 * Names that match `/meet[- ]?(and[- ]?)?greet/i`.
 *
 * The valid forms accepted by the regex are
 *
 *   meet greet, meetgreet, meet-greet,
 *   meet and greet, meet-and-greet, meetandgreet,
 *   meet and-greet, meet-and greet, etc.
 *
 * A separator that is neither `-` nor space (e.g. `&` or any other char)
 * does *not* match because the regex captures only `[- ]?`. The generator
 * therefore restricts itself to the regex-legal separators.
 */
const meetGreetSeparator = fc.constantFrom('', ' ', '-');
const meetGreetCoreArb = fc
  .tuple(
    meetGreetSeparator, // sep1: between "meet" and optional "and" or "greet"
    fc.option(meetGreetSeparator, { nil: undefined }), // sep2: between "and" and "greet" if present
    fc.boolean(), // include the optional "and"
  )
  .map(([sep1, sep2, includeAnd]) => {
    if (!includeAnd) {
      return `meet${sep1}greet`;
    }
    return `meet${sep1}and${sep2 ?? ''}greet`;
  });

const meetGreetNameArb = fc
  .tuple(neutralNameArb, meetGreetCoreArb, neutralNameArb, fc.boolean())
  .map(([a, core, c, upperCase]) => {
    const token = upperCase ? core.toUpperCase() : core;
    return `${a}${token}${c}`;
  });

/** A name guaranteed to match neither pattern. */
const cleanNameArb = neutralNameArb;

/**
 * Any name (arbitrary unicode), used when the entityType makes the name
 * irrelevant (SHOW, RESTAURANT, Other).
 */
const anyNameArb = fc.string({ minLength: 1, maxLength: 64 });

/**
 * `attractionType` values that are *not* the two authoritative tokens.
 * Includes `undefined`, the empty string, lowercase variants (the
 * implementation compares case-sensitively to `'PARADE'` and
 * `'MEET_AND_GREET'`), and arbitrary unrelated strings.
 */
const nonPivotalAttractionTypeArb = fc.option(
  fc.oneof(
    fc.constant(''),
    fc.constant('parade'), // lowercase: not the authoritative token
    fc.constant('Parade'),
    fc.constant('meet_and_greet'),
    fc.constant('OTHER'),
    fc.constant('SHOW'),
    fc.string({ minLength: 1, maxLength: 16 }).filter(
      (s) => s !== 'PARADE' && s !== 'MEET_AND_GREET',
    ),
  ),
  { nil: undefined },
);

/**
 * Entity types that fall outside the include set. The function maps any
 * such value to `Other` (R1.3's "any other included upstream entity type
 * maps to Other" plus the default branch in `classify`).
 */
const otherEntityTypeArb = fc.oneof(
  fc.constant('DESTINATION'),
  fc.constant('PARK'),
  fc.constant('HOTEL'),
  fc.constant('UNKNOWN'),
  fc.constant(''),
  fc.string({ minLength: 1, maxLength: 16 }).filter(
    (s) => s !== 'ATTRACTION' && s !== 'SHOW' && s !== 'RESTAURANT',
  ),
);

// ---------------------------------------------------------------------------
// Property assertions — one per row of the mapping table
// ---------------------------------------------------------------------------

describe('classify — Property 1: every entity is mapped by the rule table', () => {
  it('rule 1: ATTRACTION + attractionType === "PARADE" ⇒ Parade (regardless of name)', () => {
    fc.assert(
      fc.property(anyNameArb, (name) => {
        const entity: ThemeParksEntity = {
          entityType: 'ATTRACTION',
          name,
          attractionType: 'PARADE',
        };
        return classify(entity) === 'Parade';
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rule 2: ATTRACTION + attractionType === "MEET_AND_GREET" ⇒ Character_Meet (regardless of name)', () => {
    fc.assert(
      fc.property(anyNameArb, (name) => {
        const entity: ThemeParksEntity = {
          entityType: 'ATTRACTION',
          name,
          attractionType: 'MEET_AND_GREET',
        };
        return classify(entity) === 'Character_Meet';
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rule 3: ATTRACTION + name matches /parade/i (no PARADE/MEET_AND_GREET attractionType) ⇒ Parade', () => {
    fc.assert(
      fc.property(paradeNameArb, nonPivotalAttractionTypeArb, (name, at) => {
        // Sanity check: the generated name actually matches the parade regex.
        fc.pre(PARADE_NAME_PATTERN.test(name));
        const entity: ThemeParksEntity = {
          entityType: 'ATTRACTION',
          name,
          ...(at !== undefined ? { attractionType: at } : {}),
        };
        return classify(entity) === 'Parade';
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rule 4: ATTRACTION + name matches /meet[- ]?(and[- ]?)?greet/i (no parade match, no PARADE/MEET_AND_GREET attractionType) ⇒ Character_Meet', () => {
    fc.assert(
      fc.property(meetGreetNameArb, nonPivotalAttractionTypeArb, (name, at) => {
        // Filter out the rare overlap: a meet-greet name that also matches
        // /parade/i would resolve to Parade by rule 3 precedence. By
        // construction the meet-greet generator builds names from a neutral
        // charset (no `p`/`P`) plus a meet…greet token (also no `p`), so an
        // overlap is impossible — but the explicit `fc.pre` documents the
        // precedence and makes the test robust to generator changes.
        fc.pre(!PARADE_NAME_PATTERN.test(name));
        fc.pre(CHARACTER_MEET_NAME_PATTERN.test(name));
        const entity: ThemeParksEntity = {
          entityType: 'ATTRACTION',
          name,
          ...(at !== undefined ? { attractionType: at } : {}),
        };
        return classify(entity) === 'Character_Meet';
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rule 5: ATTRACTION otherwise (no pattern match, no pivotal attractionType) ⇒ Ride', () => {
    fc.assert(
      fc.property(cleanNameArb, nonPivotalAttractionTypeArb, (name, at) => {
        // Defensive: the neutral charset cannot produce either token, but
        // assert it explicitly so a future generator tweak cannot silently
        // weaken the property.
        fc.pre(!PARADE_NAME_PATTERN.test(name));
        fc.pre(!CHARACTER_MEET_NAME_PATTERN.test(name));
        const entity: ThemeParksEntity = {
          entityType: 'ATTRACTION',
          name,
          ...(at !== undefined ? { attractionType: at } : {}),
        };
        return classify(entity) === 'Ride';
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rule 6: SHOW ⇒ Show (regardless of name and attractionType)', () => {
    fc.assert(
      fc.property(anyNameArb, nonPivotalAttractionTypeArb, (name, at) => {
        const entity: ThemeParksEntity = {
          entityType: 'SHOW',
          name,
          ...(at !== undefined ? { attractionType: at } : {}),
        };
        return classify(entity) === 'Show';
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rule 7: RESTAURANT ⇒ Restaurant (regardless of name and attractionType)', () => {
    fc.assert(
      fc.property(anyNameArb, nonPivotalAttractionTypeArb, (name, at) => {
        const entity: ThemeParksEntity = {
          entityType: 'RESTAURANT',
          name,
          ...(at !== undefined ? { attractionType: at } : {}),
        };
        return classify(entity) === 'Restaurant';
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rule 8: any other entityType ⇒ Other (regardless of name and attractionType)', () => {
    fc.assert(
      fc.property(
        otherEntityTypeArb,
        anyNameArb,
        nonPivotalAttractionTypeArb,
        (entityType, name, at) => {
          fc.pre(
            entityType !== 'ATTRACTION' &&
              entityType !== 'SHOW' &&
              entityType !== 'RESTAURANT',
          );
          const entity: ThemeParksEntity = {
            entityType,
            name,
            ...(at !== undefined ? { attractionType: at } : {}),
          };
          return classify(entity) === 'Other';
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('classify — Property 1: rule precedence', () => {
  it('attractionType === "PARADE" wins over a name matching /meet[- ]?(and[- ]?)?greet/i', () => {
    fc.assert(
      fc.property(meetGreetNameArb, (name) => {
        fc.pre(CHARACTER_MEET_NAME_PATTERN.test(name));
        const entity: ThemeParksEntity = {
          entityType: 'ATTRACTION',
          name,
          attractionType: 'PARADE',
        };
        return classify(entity) === 'Parade';
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('attractionType === "MEET_AND_GREET" wins over a name matching /parade/i', () => {
    fc.assert(
      fc.property(paradeNameArb, (name) => {
        fc.pre(PARADE_NAME_PATTERN.test(name));
        const entity: ThemeParksEntity = {
          entityType: 'ATTRACTION',
          name,
          attractionType: 'MEET_AND_GREET',
        };
        return classify(entity) === 'Character_Meet';
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('parade name match wins over a meet-greet name match (regex order in classifyAttraction)', () => {
    fc.assert(
      fc.property(
        neutralNameArb,
        meetGreetCoreArb,
        neutralNameArb,
        nonPivotalAttractionTypeArb,
        (a, mg, c, at) => {
          // Construct a name containing BOTH "parade" and the meet-greet
          // token. classifyAttraction tests the parade regex first, so the
          // expected result is `Parade`.
          const name = `${a}Parade ${mg}${c}`;
          fc.pre(PARADE_NAME_PATTERN.test(name));
          fc.pre(CHARACTER_MEET_NAME_PATTERN.test(name));
          const entity: ThemeParksEntity = {
            entityType: 'ATTRACTION',
            name,
            ...(at !== undefined ? { attractionType: at } : {}),
          };
          return classify(entity) === 'Parade';
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('classify — totality and determinism', () => {
  it('returns one of the six ExperienceCategory values for every input', () => {
    const allowed = new Set([
      'Ride',
      'Show',
      'Restaurant',
      'Parade',
      'Character_Meet',
      'Other',
    ]);
    fc.assert(
      fc.property(
        fc.record({
          entityType: fc.oneof(
            fc.constant('ATTRACTION'),
            fc.constant('SHOW'),
            fc.constant('RESTAURANT'),
            otherEntityTypeArb,
          ),
          name: anyNameArb,
          attractionType: fc.option(
            fc.oneof(
              fc.constant('PARADE'),
              fc.constant('MEET_AND_GREET'),
              fc.string({ minLength: 0, maxLength: 16 }),
            ),
            { nil: undefined },
          ),
        }),
        (raw) => {
          const entity: ThemeParksEntity = {
            entityType: raw.entityType,
            name: raw.name,
            ...(raw.attractionType !== undefined
              ? { attractionType: raw.attractionType }
              : {}),
          };
          return allowed.has(classify(entity));
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('is deterministic: same entity always classifies to the same category', () => {
    fc.assert(
      fc.property(
        fc.record({
          entityType: fc.oneof(
            fc.constant('ATTRACTION'),
            fc.constant('SHOW'),
            fc.constant('RESTAURANT'),
            otherEntityTypeArb,
          ),
          name: anyNameArb,
          attractionType: fc.option(
            fc.oneof(
              fc.constant('PARADE'),
              fc.constant('MEET_AND_GREET'),
              fc.string({ minLength: 0, maxLength: 16 }),
            ),
            { nil: undefined },
          ),
        }),
        (raw) => {
          const entity: ThemeParksEntity = {
            entityType: raw.entityType,
            name: raw.name,
            ...(raw.attractionType !== undefined
              ? { attractionType: raw.attractionType }
              : {}),
          };
          return classify(entity) === classify(entity);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('classify — fixed examples for regression', () => {
  it('classifies a canonical parade by attractionType', () => {
    expect(
      classify({
        entityType: 'ATTRACTION',
        name: 'Festival of Fantasy',
        attractionType: 'PARADE',
      }),
    ).toBe('Parade');
  });

  it('classifies a canonical character meet by attractionType', () => {
    expect(
      classify({
        entityType: 'ATTRACTION',
        name: 'Princess Fairytale Hall',
        attractionType: 'MEET_AND_GREET',
      }),
    ).toBe('Character_Meet');
  });

  it('falls back to name regex when attractionType is absent', () => {
    expect(
      classify({
        entityType: 'ATTRACTION',
        name: 'Disney Adventure Friends Cavalcade Parade',
      }),
    ).toBe('Parade');
    expect(
      classify({
        entityType: 'ATTRACTION',
        name: 'Mickey Meet and Greet',
      }),
    ).toBe('Character_Meet');
    expect(
      classify({
        entityType: 'ATTRACTION',
        name: 'Mickey Meet-Greet',
      }),
    ).toBe('Character_Meet');
  });

  it('classifies a non-parade, non-meet attraction as Ride', () => {
    expect(
      classify({
        entityType: 'ATTRACTION',
        name: 'Space Mountain',
      }),
    ).toBe('Ride');
  });

  it('SHOW with name "Parade of Lights" still maps to Show (sub-classification only applies under ATTRACTION)', () => {
    expect(
      classify({
        entityType: 'SHOW',
        name: 'Parade of Lights',
      }),
    ).toBe('Show');
  });

  it('RESTAURANT with name "Meet and Greet Cafe" still maps to Restaurant', () => {
    expect(
      classify({
        entityType: 'RESTAURANT',
        name: 'Meet and Greet Cafe',
      }),
    ).toBe('Restaurant');
  });

  it('unknown entity types fall through to Other', () => {
    expect(
      classify({
        entityType: 'DESTINATION',
        name: 'Walt Disney World',
      }),
    ).toBe('Other');
    expect(
      classify({
        entityType: 'PARK',
        name: 'Magic Kingdom',
      }),
    ).toBe('Other');
  });
});
