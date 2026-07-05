// Feature: experience-detail-redesign — property test for the preserved
// pure exports in `infoTags.ts` (tasks.md → 1.5).
//
// The redesign extends `infoTags.ts` with grouping logic but must NOT change
// the pre-existing `priceTierListTag` and `resortAreaLabel` exports (R9.4). This
// suite pins those two exports against an independent reference/oracle
// re-statement of their pre-redesign behavior, so any future drift in either
// export is caught. It runs with `fast-check` at `numRuns: 100`.
//
//   - Property 14 — Preserved price/area label outputs.
//       Validates: Requirements 9.4

import fc from 'fast-check';

import { AREA_TYPES } from '@dwt/shared';
import type { AreaType, ExperienceDTO } from '@dwt/shared';

import { priceTierListTag, resortAreaLabel, type InfoTag } from '../infoTags';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Reference oracle — an independent re-statement of the pre-redesign behavior
// of the two preserved exports. These deliberately duplicate the original
// logic rather than call the module under test, so the property compares the
// current implementation against a frozen contract (R9.4).
// ---------------------------------------------------------------------------

/**
 * Pre-redesign `priceTierListTag`: the compact price-tier Info_Tag with a
 * `priceTier` kind, the tier value verbatim as the display label, and a
 * `Price tier: <tier>` screen-reader label.
 */
function referencePriceTierListTag(priceTier: string): InfoTag {
  return {
    kind: 'priceTier',
    label: priceTier,
    accessibilityLabel: `Price tier: ${priceTier}`,
  };
}

/** Pre-redesign presence predicate: non-null/undefined, not whitespace-only. */
function referenceIsNonEmpty(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Pre-redesign `resortAreaLabel`: `null` unless the Experience is a `Resort`
 * area carrying a persisted (non-empty) Resort_Area, in which case the trimmed
 * Resort_Area value.
 */
function referenceResortAreaLabel(
  experience: Pick<ExperienceDTO, 'areaType' | 'resortArea'>,
): string | null {
  if (experience.areaType !== 'Resort') {
    return null;
  }
  return referenceIsNonEmpty(experience.resortArea)
    ? experience.resortArea.trim()
    : null;
}

// ---------------------------------------------------------------------------
// Generators — span present, null, undefined, whitespace-only, and empty values
// so both the "trimmed label" and the "null" branches are exercised.
// ---------------------------------------------------------------------------

const areaTypeArb: fc.Arbitrary<AreaType> = fc.constantFrom(...AREA_TYPES);

// A price-tier value spanning canonical tiers, whitespace-padded values, and
// arbitrary short strings. `priceTierListTag` presents whatever it is handed
// verbatim, so no filtering is applied here.
const priceTierArb = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom('$', '$$', '$$$', '$$$$', ' $$ ') },
  { weight: 1, arbitrary: fc.string({ maxLength: 8 }) },
);

// A Resort_Area value spanning real zone names (some whitespace-padded),
// explicit null, explicit undefined, whitespace-only, and empty — so the
// present/absent branches of `resortAreaLabel` are both covered.
const resortAreaArb = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom('Epcot Resort Area', ' Magic Kingdom Area ', 'Disney Springs') },
  { weight: 1, arbitrary: fc.constant(null) },
  { weight: 1, arbitrary: fc.constant(undefined) },
  { weight: 1, arbitrary: fc.constant('   ') },
  { weight: 1, arbitrary: fc.constant('') },
) as fc.Arbitrary<string | null | undefined>;

const resortAreaExperienceArb = fc.record({
  areaType: areaTypeArb,
  resortArea: resortAreaArb,
}) as fc.Arbitrary<Pick<ExperienceDTO, 'areaType' | 'resortArea'>>;

// ---------------------------------------------------------------------------
// Property 14 — Preserved price/area label outputs
// ---------------------------------------------------------------------------
//
// Feature: experience-detail-redesign, Property 14: Preserved price/area label
// outputs.
//
// Validates: Requirements 9.4

describe('Property 14: priceTierListTag and resortAreaLabel match their pre-redesign reference outputs', () => {
  it('produces output equal to the pre-redesign reference for both preserved exports (R9.4)', () => {
    fc.assert(
      fc.property(priceTierArb, resortAreaExperienceArb, (priceTier, experience) => {
        // priceTierListTag: identical tag shape (kind), display label, and
        // screen-reader label for any tier value.
        expect(priceTierListTag(priceTier)).toEqual(
          referencePriceTierListTag(priceTier),
        );

        // resortAreaLabel: the trimmed Resort_Area label or null under the same
        // area/value conditions.
        expect(resortAreaLabel(experience)).toBe(
          referenceResortAreaLabel(experience),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
