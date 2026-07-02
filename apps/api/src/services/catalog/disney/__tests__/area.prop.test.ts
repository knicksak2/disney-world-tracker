// Feature: disney-facilities-catalog-source, Property 6: Area resolution is total and follows the ancestor precedence
/**
 * Property-based tests for `resolveArea` (design.md → "5. Area resolution").
 *
 * Validates: Requirements 4.11, 4.12, 4.13, 4.14, 4.15
 *
 * Property 6 (design): *For any* Experience Facility_Document, `resolveArea`
 * always returns a resolution (an Experience is never dropped for lacking a
 * resolvable area); the `Area_Type` is `ThemePark`/`WaterPark` when a
 * theme-park/water-park ancestor exists, otherwise `DisneySprings` when a
 * Disney Springs ancestor exists, otherwise `Resort` referencing the resort
 * ancestor's `Enterprise_Id` when a resort ancestor exists, otherwise the
 * resort-wide catch-all with `Area_Type = Resort`.
 *
 * The tests use a structured, kind-tagged ancestor generator so the expected
 * outcome can be derived independently from the requirement precedence rather
 * than by copying the implementation's field-parsing logic. A separate
 * totality property drives fully-arbitrary documents to assert `resolveArea`
 * never throws and always yields a valid `AreaType`.
 *
 * Each `fc.assert` runs with `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { AREA_TYPES, type Park } from '@dwt/shared';

import { resolveArea, type AreaResolution } from '../area.js';
import type { AncestorRef, FacilityDocument } from '../facilityDoc.js';

const NUM_RUNS = 100;

const AREA_TYPE_SET = new Set<string>(AREA_TYPES);

/**
 * The four theme parks with a decorated upstream display name and the `Park`
 * enum value each must resolve to (R4.12). Decorated names mirror the real
 * upstream shape ("Disney's ...") the implementation is built to tolerate.
 */
const THEME_PARKS: readonly { readonly name: string; readonly park: Park }[] = [
  { name: 'Magic Kingdom Park', park: 'Magic Kingdom' },
  { name: 'EPCOT', park: 'EPCOT' },
  { name: "Disney's Hollywood Studios", park: 'Hollywood Studios' },
  { name: "Disney's Animal Kingdom Theme Park", park: 'Animal Kingdom' },
];

/** The two water parks with decorated display names and their `Park` values. */
const WATER_PARKS: readonly { readonly name: string; readonly park: Park }[] = [
  { name: 'Disney Typhoon Lagoon Water Park', park: 'Typhoon Lagoon' },
  { name: 'Disney Blizzard Beach Water Park', park: 'Blizzard Beach' },
];

/** Disney Springs display-name variants that must match case-insensitively (R4.13). */
const DISNEY_SPRINGS_NAMES: readonly string[] = [
  'Disney Springs',
  'disney springs',
  'DISNEY SPRINGS',
  'DisneySprings',
];

/**
 * A generated ancestor tagged with the "kind" it is intended to represent, so
 * the oracle can reason about precedence without re-deriving the impl's
 * name/type matching. `expectedPark` is set only for park kinds.
 */
type TaggedKind = 'themePark' | 'waterPark' | 'disneySprings' | 'resort' | 'noise';

interface TaggedAncestor {
  readonly kind: TaggedKind;
  readonly ref: AncestorRef;
  readonly expectedPark?: Park;
}

/** A theme-park ancestor whose name maps to a known Park. */
const themeParkArb: fc.Arbitrary<TaggedAncestor> = fc
  .constantFrom(...THEME_PARKS)
  .chain((p) =>
    fc.string({ minLength: 1, maxLength: 6 }).map((suffix) => ({
      kind: 'themePark' as const,
      ref: { id: `${100 + suffix.length};entityType=theme-park`, type: 'theme-park', name: p.name },
      expectedPark: p.park,
    })),
  );

/** A theme-park ancestor whose name maps to no known Park (park => undefined). */
const themeParkUnknownArb: fc.Arbitrary<TaggedAncestor> = fc.constant({
  kind: 'themePark',
  ref: { id: '900;entityType=theme-park', type: 'theme-park', name: 'Unrecognized Land Zone' },
});

/** A water-park ancestor whose name maps to a known Park. */
const waterParkArb: fc.Arbitrary<TaggedAncestor> = fc
  .constantFrom(...WATER_PARKS)
  .map((p) => ({
    kind: 'waterPark' as const,
    ref: { id: '200;entityType=water-park', type: 'water-park', name: p.name },
    expectedPark: p.park,
  }));

/** A Disney Springs ancestor, identified by name only (never a park type). */
const disneySpringsArb: fc.Arbitrary<TaggedAncestor> = fc
  .constantFrom(...DISNEY_SPRINGS_NAMES)
  .chain((name) =>
    fc.constantFrom('destination', 'land', 'resort-area', undefined).map((type) => ({
      kind: 'disneySprings' as const,
      ref: {
        id: '300;entityType=destination',
        name,
        ...(type !== undefined ? { type } : {}),
      },
    })),
  );

/**
 * A specific-resort ancestor (type `resort`). Its name must NOT match the
 * Disney Springs pattern, otherwise the impl records it as Disney Springs
 * first (name check precedes the resort-type check within a single ancestor).
 */
const resortArb: fc.Arbitrary<TaggedAncestor> = fc
  .integer({ min: 80000000, max: 89999999 })
  .map((n) => ({
    kind: 'resort' as const,
    ref: {
      id: `${n};entityType=resort`,
      type: 'resort',
      name: "Disney's Polynesian Village Resort",
    },
  }));

/**
 * A noise ancestor recognized by none of the tiers: its type is not
 * theme-park/water-park/resort and its name does not match Disney Springs.
 */
const noiseArb: fc.Arbitrary<TaggedAncestor> = fc
  .constantFrom('resort-area', 'destination', 'land', 'entertainment-venue', undefined)
  .map((type) => ({
    kind: 'noise' as const,
    ref: {
      id: '500;entityType=resort-area',
      name: 'Some Structural Area',
      ...(type !== undefined ? { type } : {}),
    },
  }));

const anyTaggedArb: fc.Arbitrary<TaggedAncestor> = fc.oneof(
  themeParkArb,
  themeParkUnknownArb,
  waterParkArb,
  disneySpringsArb,
  resortArb,
  noiseArb,
);

/**
 * Reference resolver derived from the requirement precedence
 * (R4.12 → R4.13 → R4.14 → R4.15). Operates on the kind tags, independent of
 * the implementation's regex/type matching.
 */
function expectedResolution(tagged: readonly TaggedAncestor[]): AreaResolution {
  const firstPark = tagged.find((t) => t.kind === 'themePark' || t.kind === 'waterPark');
  if (firstPark !== undefined) {
    const areaType = firstPark.kind === 'themePark' ? 'ThemePark' : 'WaterPark';
    return firstPark.expectedPark === undefined
      ? { areaType }
      : { areaType, park: firstPark.expectedPark };
  }
  if (tagged.some((t) => t.kind === 'disneySprings')) {
    return { areaType: 'DisneySprings', park: 'Disney Springs' };
  }
  const firstResort = tagged.find((t) => t.kind === 'resort');
  if (firstResort !== undefined) {
    return { areaType: 'Resort', resortEnterpriseId: firstResort.ref.id };
  }
  return { areaType: 'Resort' };
}

function docWith(ancestors: readonly AncestorRef[]): FacilityDocument {
  return { id: '80010177;entityType=Attraction', name: 'Some Experience', ancestors };
}

describe('resolveArea — Property 6: totality (never drops an Experience)', () => {
  /** A fully-arbitrary ancestor: arbitrary id/type/name, any field optional. */
  const arbitraryAncestorArb: fc.Arbitrary<AncestorRef> = fc.record(
    {
      id: fc.string(),
      type: fc.string(),
      name: fc.string(),
    },
    { requiredKeys: ['id'] },
  );

  const arbitraryDocArb: fc.Arbitrary<FacilityDocument> = fc.record(
    {
      id: fc.string(),
      name: fc.string(),
      type: fc.string(),
      ancestors: fc.array(arbitraryAncestorArb, { maxLength: 8 }),
    },
    { requiredKeys: ['id'] },
  );

  it('always returns a resolution with a valid AreaType and never throws (R4.11, R4.15)', () => {
    fc.assert(
      fc.property(arbitraryDocArb, (doc) => {
        const res = resolveArea(doc);
        // Always defined with a closed-set Area_Type.
        expect(AREA_TYPE_SET.has(res.areaType)).toBe(true);
        // A Resort area never carries a `park`; a non-Resort area never carries
        // a `resortEnterpriseId`.
        if (res.areaType === 'Resort') {
          expect(res.park).toBeUndefined();
        } else {
          expect(res.resortEnterpriseId).toBeUndefined();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('resolves a document with no ancestor chain to the resort-wide catch-all (R4.15)', () => {
    expect(resolveArea({ id: '1;entityType=Attraction' })).toEqual({ areaType: 'Resort' });
    expect(resolveArea(docWith([]))).toEqual({ areaType: 'Resort' });
  });
});

describe('resolveArea — Property 6: ancestor precedence', () => {
  it('follows the ThemePark/WaterPark → DisneySprings → Resort → catch-all precedence', () => {
    fc.assert(
      fc.property(fc.array(anyTaggedArb, { maxLength: 8 }), (tagged) => {
        const doc = docWith(tagged.map((t) => t.ref));
        const result = resolveArea(doc);
        expect(result).toEqual(expectedResolution(tagged));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('a park ancestor always wins over lower tiers regardless of position (R4.12)', () => {
    const lowerTierArb = fc.oneof(disneySpringsArb, resortArb, noiseArb);
    fc.assert(
      fc.property(
        fc.oneof(themeParkArb, themeParkUnknownArb, waterParkArb),
        fc.array(lowerTierArb, { maxLength: 5 }),
        fc.array(lowerTierArb, { maxLength: 5 }),
        (park, before, after) => {
          const tagged = [...before, park, ...after];
          const result = resolveArea(docWith(tagged.map((t) => t.ref)));
          const expectedType = park.kind === 'themePark' ? 'ThemePark' : 'WaterPark';
          expect(result.areaType).toBe(expectedType);
          expect(result.park).toBe(park.expectedPark);
          expect(result.resortEnterpriseId).toBeUndefined();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('Disney Springs wins over a specific resort when no park ancestor exists (R4.13, R4.14)', () => {
    fc.assert(
      fc.property(
        disneySpringsArb,
        fc.array(fc.oneof(resortArb, noiseArb), { maxLength: 6 }),
        (springs, others) => {
          // Interleave the Disney Springs ancestor among resorts/noise, no parks.
          const tagged = [...others.slice(0, 2), springs, ...others.slice(2)];
          const result = resolveArea(docWith(tagged.map((t) => t.ref)));
          expect(result).toEqual({ areaType: 'DisneySprings', park: 'Disney Springs' });
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('a specific resort resolves to its Enterprise_Id when it is the highest tier (R4.14)', () => {
    fc.assert(
      fc.property(
        fc.array(resortArb, { minLength: 1, maxLength: 4 }),
        fc.array(noiseArb, { maxLength: 4 }),
        (resorts, noise) => {
          // Only resort + noise ancestors: the FIRST resort's id must be used.
          const tagged = [...noise, ...resorts];
          // Rebuild so the first resort in list order is well-defined.
          const ordered = [resorts[0]!, ...noise, ...resorts.slice(1)];
          const result = resolveArea(docWith(ordered.map((t) => t.ref)));
          expect(result).toEqual({
            areaType: 'Resort',
            resortEnterpriseId: resorts[0]!.ref.id,
          });
          void tagged;
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('only noise ancestors resolve to the resort-wide catch-all (R4.15)', () => {
    fc.assert(
      fc.property(fc.array(noiseArb, { maxLength: 8 }), (noise) => {
        const result = resolveArea(docWith(noise.map((t) => t.ref)));
        expect(result).toEqual({ areaType: 'Resort' });
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
