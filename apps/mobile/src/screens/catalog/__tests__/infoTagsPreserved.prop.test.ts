// Feature: experience-detail-redesign, Property 14: For any inputs,
// `priceTierListTag` and `resortAreaLabel` produce output equal to their
// pre-redesign reference computation (identical price-tier tag shape/label, and
// the trimmed Resort_Area label or null under the same area/value conditions).
//
// The redesign extends `infoTags.ts` with the new `buildTagGroups` grouping
// core but must preserve the existing `priceTierListTag` and `resortAreaLabel`
// exports byte-for-byte relative to their pre-redesign behaviour (R9.4). This
// suite pins that guarantee by re-stating an independent reference oracle for
// each function and asserting equality across generated inputs at
// `numRuns: 100`.
//
// Validates: Requirements 9.4

import fc from 'fast-check';

import { AREA_TYPES } from '@dwt/shared';
import type { AreaType, ExperienceDTO } from '@dwt/shared';

import {
  priceTierListTag,
  resortAreaLabel,
  type InfoTag,
} from '../infoTags';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Independent reference oracles — a re-statement of the pre-redesign behaviour,
// written without reference to the implementation, so any drift in the exported
// functions is caught.
// ---------------------------------------------------------------------------

/**
 * Pre-redesign price-tier tag: the persisted tier is surfaced verbatim (no
 * trimming) as both the display label and the "Price tier: <tier>" accessible
 * label.
 */
function refPriceTierListTag(priceTier: string): InfoTag {
  return {
    kind: 'priceTier',
    label: priceTier,
    accessibilityLabel: `Price tier: ${priceTier}`,
  };
}

/**
 * Pre-redesign Resort_Area label: `null` unless the Experience is a `Resort`
 * area carrying a persisted (non-whitespace-only) Resort_Area; otherwise the
 * trimmed Resort_Area value.
 */
function refResortAreaLabel(
  experience: Pick<ExperienceDTO, 'areaType' | 'resortArea'>,
): string | null {
  if (experience.areaType !== 'Resort') {
    return null;
  }
  const value = experience.resortArea;
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

// ---------------------------------------------------------------------------
// Generators — span present, padded, empty, whitespace-only, null, and
// undefined values so both the area gate and the presence/trimming rules are
// genuinely exercised.
// ---------------------------------------------------------------------------

const areaTypeArb: fc.Arbitrary<AreaType> = fc.constantFrom(...AREA_TYPES);

// A price-tier string spanning canonical tiers, padded variants, empty, and
// whitespace-only forms plus arbitrary text. `priceTierListTag` performs no
// trimming, so the oracle must reproduce whatever it is handed verbatim.
const priceTierArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 5, arbitrary: fc.constantFrom('$', '$$', '$$$', '$$$$', ' $$ ', '') },
  { weight: 2, arbitrary: fc.string({ maxLength: 12 }) },
);

// A Resort_Area value spanning real zones (some whitespace-padded), explicit
// null, explicit undefined, whitespace-only, and empty.
const resortAreaArb = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.constantFrom(
      'Magic Kingdom Area',
      ' Epcot Resort Area ',
      'Animal Kingdom Area',
      'Disney Springs Area',
    ),
  },
  { weight: 1, arbitrary: fc.constant(null) },
  { weight: 1, arbitrary: fc.constant(undefined) },
  { weight: 1, arbitrary: fc.constant('   ') },
  { weight: 1, arbitrary: fc.constant('') },
) as fc.Arbitrary<string | null | undefined>;

// `fc.record` materializes every key with an explicit `| undefined`, which the
// `exactOptionalPropertyTypes` typing of `resortArea` forbids at the type level
// even though `resortAreaLabel` handles it at runtime (that "absent value" case
// is exactly what this generator exercises). The cast keeps the generator
// spanning present/null/undefined while satisfying the stricter optional typing.
const resortAreaExperienceArb = fc.record({
  areaType: areaTypeArb,
  resortArea: resortAreaArb,
}) as fc.Arbitrary<Pick<ExperienceDTO, 'areaType' | 'resortArea'>>;

// ---------------------------------------------------------------------------
// Property 14 — Preserved price/area label outputs
// ---------------------------------------------------------------------------

describe('Property 14: priceTierListTag and resortAreaLabel preserve their pre-redesign outputs', () => {
  it('produces output equal to an independent reference oracle for all generated inputs (R9.4)', () => {
    fc.assert(
      fc.property(
        priceTierArb,
        resortAreaExperienceArb,
        (priceTier, experience) => {
          // priceTierListTag: identical tag shape, label, and accessible text.
          expect(priceTierListTag(priceTier)).toEqual(
            refPriceTierListTag(priceTier),
          );

          // resortAreaLabel: identical null-vs-trimmed result under the same
          // area/value conditions.
          expect(resortAreaLabel(experience)).toBe(
            refResortAreaLabel(experience),
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
