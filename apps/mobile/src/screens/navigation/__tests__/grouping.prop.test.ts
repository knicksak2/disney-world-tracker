/**
 * Property-based tests for the pure grouping folds in `grouping.ts`.
 *
 * This suite implements three of the feature's correctness properties against
 * the framework-free grouping logic that carries the grouping-integrity
 * guarantees (R6). Each property runs with `fast-check` at `numRuns: 100`.
 *
 *   - Property 1 — `namedEntries` is the Experiences-list identity.
 *   - Property 2 — `groupByPark` is a faithful, order-preserving partition.
 *   - Property 3 — `groupByCategory` is a faithful, order-preserving partition.
 *
 * The grouping functions partition entries with `Array.prototype.filter` and
 * never clone an entry, so every entry an output group holds is the *same
 * object reference* as the corresponding input entry. The properties exploit
 * this: order preservation is checked with `toEqual` (deep + ordered), while
 * the "exactly one group" / multiset guarantees are checked by reference
 * identity, which is unambiguous because fast-check produces a fresh object
 * for every generated entry.
 */

import fc from 'fast-check';

import { AREA_TYPES, EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';
import type { CompletionEntryDTO } from '@dwt/shared';

import { groupByAreaType, groupByCategory, groupByPark, namedEntries } from '../grouping';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Oracle
// ---------------------------------------------------------------------------

/**
 * Independent reference predicate for "has an available Experience name":
 * the trimmed name has at least one non-whitespace character (R3.6, R4.6,
 * R5.3, R13.3).
 */
function isNamed(entry: CompletionEntryDTO): boolean {
  return entry.experienceName.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Experience-name candidate that deliberately mixes three sources:
 *   - guaranteed-named strings (a leading non-whitespace char + arbitrary tail)
 *   - the empty string (an unnamed entry)
 *   - whitespace-only strings (an unnamed entry the trim must reject)
 * so the generated lists always contain a blend of named and unnamed entries.
 */
const nameArb = fc.oneof(
  { weight: 3, arbitrary: fc
    .tuple(fc.constantFrom('a', 'Z', 'Ride', 'Space Mountain'), fc.string({ maxLength: 12 }))
    .map(([head, tail]) => head + tail) },
  { weight: 1, arbitrary: fc.constant('') },
  { weight: 1, arbitrary: fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r'), { maxLength: 6 }) },
);

/** A single Completion_Entry over the full Park × Category catalog space. */
const entryArb: fc.Arbitrary<CompletionEntryDTO> = fc.record({
  experienceId: fc.uuid(),
  experienceName: nameArb,
  park: fc.constantFrom(...PARKS),
  areaType: fc.constantFrom(...AREA_TYPES),
  category: fc.constantFrom(...EXPERIENCE_CATEGORIES),
  completedOn: fc.constant('2024-01-01'),
  rating: fc.option(fc.integer({ min: 1, max: 10 }), { nil: null }),
  sharedNote: fc.option(fc.string({ maxLength: 20 }), { nil: null }),
});

/** A list of entries spanning all Parks/categories, including unnamed ones. */
const entriesArb = fc.array(entryArb, { maxLength: 30 });

/**
 * A single Completion_Entry that additionally spans the Area_Type space and a
 * *nullable* Park. Resort-area and resort entries carry `park: null`, so this
 * generator emits `null` alongside every catalog Park to exercise the
 * Park-less handling of `groupByAreaType`: partitioning must be driven purely
 * by `areaType`, independent of whether the entry belongs to a Park.
 */
const areaEntryArb: fc.Arbitrary<CompletionEntryDTO> = fc.record({
  experienceId: fc.uuid(),
  experienceName: nameArb,
  park: fc.option(fc.constantFrom(...PARKS), { nil: null }),
  areaType: fc.constantFrom(...AREA_TYPES),
  category: fc.constantFrom(...EXPERIENCE_CATEGORIES),
  completedOn: fc.constant('2024-01-01'),
  rating: fc.option(fc.integer({ min: 1, max: 10 }), { nil: null }),
  sharedNote: fc.option(fc.string({ maxLength: 20 }), { nil: null }),
});

/** A list of Area_Type entries, including Park-less and unnamed ones. */
const areaEntriesArb = fc.array(areaEntryArb, { maxLength: 30 });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Assert that `flat` and `expected` are the same multiset *by reference
 * identity*: identical length, no duplicate reference in `flat`, and the same
 * set of references. Because every generated entry is a distinct object, this
 * proves each entry appears exactly once across all groups.
 */
function expectSameByReference(
  flat: readonly CompletionEntryDTO[],
  expected: readonly CompletionEntryDTO[],
): void {
  expect(flat).toHaveLength(expected.length);
  const flatSet = new Set<CompletionEntryDTO>(flat);
  // No reference appears twice across the groups.
  expect(flatSet.size).toBe(flat.length);
  // Same membership in both directions.
  for (const entry of expected) {
    expect(flatSet.has(entry)).toBe(true);
  }
  for (const entry of flat) {
    expect(expected.includes(entry)).toBe(true);
  }
}

// ---------------------------------------------------------------------------
// Feature: friend-profile-navigation, Property 1: The Experiences list is
// exactly the named entries in source order
// ---------------------------------------------------------------------------
//
// Validates: Requirements 5.1, 5.3, 13.1, 13.3

describe('Property 1: namedEntries is exactly the named entries in source order', () => {
  it('keeps exactly the named entries, once each, in source order, dropping unnamed', () => {
    fc.assert(
      fc.property(entriesArb, (entries) => {
        const result = namedEntries(entries);

        // The result is precisely the source-order projection of the named
        // entries — same content, same order, each exactly once (R5.1, R13.1).
        const expected = entries.filter(isNamed);
        expect(result).toEqual(expected);

        // Every retained entry has an available name (R5.1, R13.1)...
        for (const entry of result) {
          expect(isNamed(entry)).toBe(true);
        }

        // ...and every unnamed entry was dropped (R5.3, R13.3).
        for (const entry of entries) {
          if (!isNamed(entry)) {
            expect(result.includes(entry)).toBe(false);
          }
        }

        // Order is preserved as a subsequence of the original list, so the
        // relative order of the kept entries matches the read's order.
        const keptIndices = result.map((entry) => entries.indexOf(entry));
        const ascending = keptIndices.every(
          (idx, i) => i === 0 || idx > keptIndices[i - 1]!,
        );
        expect(ascending).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: friend-profile-navigation, Property 2: Park grouping is a faithful,
// order-preserving partition
// ---------------------------------------------------------------------------
//
// Validates: Requirements 3.1, 3.4, 3.6, 6.1, 6.3

describe('Property 2: groupByPark is a faithful, order-preserving partition', () => {
  it('partitions the named entries into one ordered group per catalog Park', () => {
    fc.assert(
      fc.property(entriesArb, (entries) => {
        const groups = groupByPark(entries, PARKS);
        const named = entries.filter(isNamed);

        // Exactly one group per catalog Park, in catalog order, including
        // Parks the Friend has never visited (R3.1).
        expect(groups.map((g) => g.park)).toEqual([...PARKS]);

        for (const group of groups) {
          // Membership rule: each entry in a group is named and belongs to
          // that group's Park; no other-Park or unnamed entry leaks in
          // (R3.4, R3.6, R6.1).
          for (const entry of group.entries) {
            expect(isNamed(entry)).toBe(true);
            expect(entry.park).toBe(group.park);
          }

          // Source order is preserved within the group: it equals the named
          // entries for that Park taken in read order (R3.4).
          const expectedForPark = named.filter((entry) => entry.park === group.park);
          expect(group.entries).toEqual(expectedForPark);
        }

        // The concatenation of all groups equals namedEntries(entries) as a
        // multiset and a count — each named entry lands in exactly one group
        // and nothing is invented or lost (R6.1, R6.3).
        const flat = groups.flatMap((g) => [...g.entries]);
        expectSameByReference(flat, named);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: friend-profile-navigation, Property 3: Category grouping is a
// faithful, order-preserving partition
// ---------------------------------------------------------------------------
//
// Validates: Requirements 4.1, 4.3, 4.5, 4.6, 6.2, 6.4

describe('Property 3: groupByCategory is a faithful, order-preserving partition', () => {
  it('partitions the named entries into one ordered group per category', () => {
    fc.assert(
      fc.property(entriesArb, (entries) => {
        const groups = groupByCategory(entries, EXPERIENCE_CATEGORIES);
        const named = entries.filter(isNamed);

        // Exactly one group per Experience_Category, in enumerated order,
        // including empty categories (R4.1).
        expect(groups.map((g) => g.category)).toEqual([...EXPERIENCE_CATEGORIES]);

        for (const group of groups) {
          // Membership rule: each entry is named and belongs to that group's
          // category; no other-category or unnamed entry leaks in
          // (R4.3, R4.6, R6.2).
          for (const entry of group.entries) {
            expect(isNamed(entry)).toBe(true);
            expect(entry.category).toBe(group.category);
          }

          // Source order preserved within the group (R4.5).
          const expectedForCategory = named.filter(
            (entry) => entry.category === group.category,
          );
          expect(group.entries).toEqual(expectedForCategory);
        }

        // Concatenation equals namedEntries(entries) as a multiset and count:
        // single-group membership with nothing lost or duplicated
        // (R6.2, R6.4).
        const flat = groups.flatMap((g) => [...g.entries]);
        expectSameByReference(flat, named);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: resort-tracking-and-stats, Property: groupByAreaType is a faithful,
// order-preserving partition that handles Park-less entries
// ---------------------------------------------------------------------------
//
// Validates: Requirements 5.2

describe('Property 4: groupByAreaType is a faithful, order-preserving partition', () => {
  it('partitions the named entries into one ordered group per Area_Type, independent of Park', () => {
    fc.assert(
      fc.property(areaEntriesArb, (entries) => {
        const groups = groupByAreaType(entries, AREA_TYPES);
        const named = entries.filter(isNamed);

        // Exactly one group per Area_Type, in the canonical AREA_TYPES order,
        // including Area_Types with no entries (R5.2).
        expect(groups.map((g) => g.areaType)).toEqual([...AREA_TYPES]);

        for (const group of groups) {
          for (const entry of group.entries) {
            // Membership rule: each entry in a group is named and belongs to
            // that group's Area_Type; no other-Area_Type or unnamed entry
            // leaks in (R5.2).
            expect(isNamed(entry)).toBe(true);
            expect(entry.areaType).toBe(group.areaType);
          }

          // Source order preserved within the group: it equals the named
          // entries for that Area_Type taken in read order (R5.2). This
          // comparison is Park-agnostic, so Park-less (`park: null`) entries
          // are grouped by their Area_Type exactly like Park-bearing ones.
          const expectedForArea = named.filter(
            (entry) => entry.areaType === group.areaType,
          );
          expect(group.entries).toEqual(expectedForArea);
        }

        // Partition completeness: the concatenation of all Area_Type groups
        // equals namedEntries(entries) as a multiset and a count — every
        // named entry (Park-less ones included) lands in exactly one group and
        // nothing is invented or lost (R5.2).
        const flat = groups.flatMap((g) => [...g.entries]);
        expectSameByReference(flat, named);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('groups Park-less entries by their Area_Type and drops unnamed entries', () => {
    // A focused generator forcing every entry to be Park-less, so the property
    // that Park-less entries are still partitioned by Area_Type is exercised
    // even under fast-check shrinking (R5.2).
    const parklessEntriesArb = fc.array(
      areaEntryArb.map((entry) => ({ ...entry, park: null })),
      { maxLength: 30 },
    );

    fc.assert(
      fc.property(parklessEntriesArb, (entries) => {
        const groups = groupByAreaType(entries, AREA_TYPES);
        const named = entries.filter(isNamed);

        // Every named Park-less entry is placed in its Area_Type group...
        for (const entry of named) {
          const group = groups.find((g) => g.areaType === entry.areaType)!;
          expect(group.entries.includes(entry)).toBe(true);
        }

        // ...and every unnamed entry is dropped from every group (R5.2).
        for (const entry of entries) {
          if (!isNamed(entry)) {
            for (const group of groups) {
              expect(group.entries.includes(entry)).toBe(false);
            }
          }
        }

        // No entry is lost: the groups together hold exactly the named entries.
        const flat = groups.flatMap((g) => [...g.entries]);
        expectSameByReference(flat, named);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
