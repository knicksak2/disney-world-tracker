// Feature: catalog-navigation-redesign, Property tests for resolveLand
/**
 * Property-based tests for `resolveLand` (design.md → "1. `resolveLand`
 * (`disney/land.ts`)").
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.7
 *
 * `resolveLand` is a pure, total, deterministic Land resolution core. Given a
 * Facility_Document and its already-resolved {@link AreaResolution}, it returns
 * the Experience's Land — the nearest Land_Ancestor's name, trimmed, casing
 * preserved, truncated to ≤200 characters — or `null` when Land is not
 * meaningful (non-park area) or not resolvable (no Land_Ancestor, or a
 * Land_Ancestor whose name is absent/whitespace-only).
 *
 * The three properties below map one-to-one onto the task's named properties:
 *
 *   - Property 1: Area gating (R1.5)
 *   - Property 2: Nearest-ancestor normalization (R1.1, R1.2, R1.7)
 *   - Property 3: Null cases (R1.3, R1.4)
 *
 * Each `fc.assert` runs with `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { resolveLand } from '../land.js';
import type { AreaResolution } from '../area.js';
import type { AncestorRef, FacilityDocument } from '../facilityDoc.js';

const NUM_RUNS = 100;

const MAX_LAND_LENGTH = 200;

/** Case variants of the `land` ancestor type; all match case-insensitively (R1.1). */
const LAND_TYPE_VARIANTS: readonly string[] = ['land', 'Land', 'LAND', 'lAnD'];

/** Non-land ancestor types the resolver must skip over when finding the Land_Ancestor. */
const NON_LAND_TYPES: readonly (string | undefined)[] = [
  'theme-park',
  'water-park',
  'resort',
  'resort-area',
  'destination',
  'entertainment-venue',
  undefined,
];

/** A park `AreaResolution` (ThemePark/WaterPark), for which Land is meaningful. */
const parkAreaArb: fc.Arbitrary<AreaResolution> = fc.oneof(
  fc.constant<AreaResolution>({ areaType: 'ThemePark' }),
  fc.constant<AreaResolution>({ areaType: 'WaterPark' }),
  fc.constant<AreaResolution>({ areaType: 'ThemePark', park: 'Magic Kingdom' }),
  fc.constant<AreaResolution>({ areaType: 'WaterPark', park: 'Typhoon Lagoon' }),
);

/** A non-park `AreaResolution` (DisneySprings/Resort), for which Land is always null (R1.5). */
const gatedAreaArb: fc.Arbitrary<AreaResolution> = fc.oneof(
  fc.constant<AreaResolution>({ areaType: 'DisneySprings', park: 'Disney Springs' }),
  fc.constant<AreaResolution>({ areaType: 'Resort' }),
  fc.constant<AreaResolution>({ areaType: 'Resort', resortEnterpriseId: '80007823;entityType=resort' }),
);

/** A non-land ancestor: any type other than `land` (case-insensitive), any name. */
const nonLandAncestorArb: fc.Arbitrary<AncestorRef> = fc
  .record(
    {
      id: fc.string(),
      type: fc.constantFrom(...NON_LAND_TYPES),
      name: fc.string(),
    },
    { requiredKeys: ['id'] },
  )
  .map((r) => {
    const ref: { id: string; type?: string; name?: string } = { id: r.id };
    if (r.type !== undefined) ref.type = r.type;
    if (r.name !== undefined) ref.name = r.name;
    return ref;
  });

/** Non-whitespace character set used to build long, deterministic names. */
const NON_WS_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');

/**
 * A land ancestor name that is non-empty after trimming: either an arbitrary
 * string filtered to trim non-empty, or a long (>200 char) padded run so the
 * ≤200-char truncation (R1.7) is exercised.
 */
const nonEmptyLandNameArb: fc.Arbitrary<string> = fc.oneof(
  fc.string({ maxLength: 80 }).filter((s) => s.trim().length > 0),
  fc
    .array(fc.constantFrom(...NON_WS_CHARS), { minLength: 201, maxLength: 260 })
    .map((cs) => `  ${cs.join('')}  `),
);

/** A land ancestor with a non-empty (post-trim) name. */
const validLandAncestorArb: fc.Arbitrary<AncestorRef> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 12 }),
  type: fc.constantFrom(...LAND_TYPE_VARIANTS),
  name: nonEmptyLandNameArb,
});

function docWith(ancestors: readonly AncestorRef[] | undefined): FacilityDocument {
  const doc: { id: string; name: string; ancestors?: readonly AncestorRef[] } = {
    id: '80010177;entityType=Attraction',
    name: 'Some Experience',
  };
  if (ancestors !== undefined) doc.ancestors = ancestors;
  return doc;
}

describe('resolveLand — Property 1: area gating (R1.5)', () => {
  it('returns null for any DisneySprings/Resort area regardless of ancestors', () => {
    fc.assert(
      fc.property(
        gatedAreaArb,
        fc.array(fc.oneof(nonLandAncestorArb, validLandAncestorArb), { maxLength: 8 }),
        (area, ancestors) => {
          expect(resolveLand(docWith(ancestors), area)).toBeNull();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('never inspects the ancestor chain when the area is gated (R1.5)', () => {
    // A document whose `ancestors` getter throws proves the chain is never read
    // for a gated area: gating returns before `doc.ancestors` is touched.
    fc.assert(
      fc.property(gatedAreaArb, (area) => {
        const trap = {
          id: '80010177;entityType=Attraction',
          name: 'Trap',
          get ancestors(): readonly AncestorRef[] {
            throw new Error('ancestor chain must not be inspected for a gated area');
          },
        } as unknown as FacilityDocument;
        expect(resolveLand(trap, area)).toBeNull();
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('resolveLand — Property 2: nearest-ancestor normalization (R1.1, R1.2, R1.7)', () => {
  it('equals the first Land_Ancestor name trimmed, casing preserved, truncated to ≤200 chars', () => {
    fc.assert(
      fc.property(
        parkAreaArb,
        // Prefix must contain no land ancestor so the target is the first one.
        fc.array(nonLandAncestorArb, { maxLength: 4 }),
        validLandAncestorArb,
        // Suffix may contain anything (later land ancestors must be ignored).
        fc.array(fc.oneof(nonLandAncestorArb, validLandAncestorArb), { maxLength: 4 }),
        (area, prefix, target, suffix) => {
          const doc = docWith([...prefix, target, ...suffix]);
          const result = resolveLand(doc, area);

          const expected = target.name!.trim().slice(0, MAX_LAND_LENGTH);
          expect(result).toBe(expected);
          // Normalization invariants: non-null, ≤200 chars, no surrounding
          // whitespace, and a prefix of the trimmed original (casing preserved).
          expect(result).not.toBeNull();
          expect(result!.length).toBeLessThanOrEqual(MAX_LAND_LENGTH);
          expect(result).toBe(result!.trim());
          expect(target.name!.trim().startsWith(result!)).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('resolveLand — Property 3: null cases (R1.3, R1.4)', () => {
  it('yields null for a park area with no Land_Ancestor (R1.3)', () => {
    fc.assert(
      fc.property(
        parkAreaArb,
        fc.oneof(
          fc.constant<readonly AncestorRef[] | undefined>(undefined),
          fc.array(nonLandAncestorArb, { maxLength: 8 }),
        ),
        (area, ancestors) => {
          expect(resolveLand(docWith(ancestors), area)).toBeNull();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('yields null when the first Land_Ancestor name is absent or whitespace-only (R1.4)', () => {
    // A name that is absent (undefined) or trims to empty.
    const emptyOrWhitespaceNameArb = fc.oneof(
      fc.constant<string | undefined>(undefined),
      fc.constant(''),
      fc
        .array(fc.constantFrom(' ', '\t', '\n', '\r', '\f', '\v'), { minLength: 1, maxLength: 8 })
        .map((cs) => cs.join('')),
    );
    const blankLandAncestorArb: fc.Arbitrary<AncestorRef> = fc
      .record({
        id: fc.string({ minLength: 1, maxLength: 12 }),
        type: fc.constantFrom(...LAND_TYPE_VARIANTS),
        name: emptyOrWhitespaceNameArb,
      })
      .map((r) => {
        const ref: { id: string; type: string; name?: string } = { id: r.id, type: r.type };
        if (r.name !== undefined) ref.name = r.name;
        return ref;
      });

    fc.assert(
      fc.property(
        parkAreaArb,
        fc.array(nonLandAncestorArb, { maxLength: 4 }),
        blankLandAncestorArb,
        // Later valid land ancestors must NOT rescue: only the FIRST is checked.
        fc.array(fc.oneof(nonLandAncestorArb, validLandAncestorArb), { maxLength: 4 }),
        (area, prefix, blankTarget, suffix) => {
          const doc = docWith([...prefix, blankTarget, ...suffix]);
          expect(resolveLand(doc, area)).toBeNull();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
