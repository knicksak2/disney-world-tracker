/**
 * Property-based test for group-section completeness (task 9.3).
 *
 * Implements the feature's correctness Property 6 against the pure grouping
 * folds (`groupByPark` / `groupByCategory`) that the Grouped_View_Modes render
 * one `GroupSection` per element over.
 *
 * The grouped-view screens (`StatsScreen` Own_Parks/Own_Categories and
 * `FriendProfileScreen` Parks/Categories) build their sections by mapping 1:1
 * over the output of these folds — `groups.map((group) => <GroupSection
 * sectionKey={`parks:${group.park}`} … />)` — with no group added, dropped,
 * filtered, deduplicated, or reordered. So the set, count, and order of the
 * rendered `GroupSection`s is exactly the set, count, and order of the fold's
 * output groups. The most robust unit to assert Property 6 is therefore the
 * fold's completeness/canonical-order guarantee, plus the screen's pure
 * section-key derivation (`parks:<name>` / `categories:<name>`), which we
 * reproduce here to prove one unique section per catalog group.
 *
 * Each property runs with `fast-check` at `numRuns: 100`.
 */

import fc from 'fast-check';

import { EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';
import type { CompletionEntryDTO } from '@dwt/shared';

import { groupByCategory, groupByPark } from '../grouping';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Experience-name candidate mixing guaranteed-named, empty, and
 * whitespace-only strings, so generated entry sets blend named and unnamed
 * entries. Unnamed entries are dropped by the folds but must NOT change the
 * set of groups: a Park/Category with only unnamed (or zero) entries is still
 * a zero-count group that must be present as a GroupSection (R7.2, R8.2).
 */
const nameArb = fc.oneof(
  {
    weight: 3,
    arbitrary: fc
      .tuple(
        fc.constantFrom('a', 'Z', 'Ride', 'Space Mountain'),
        fc.string({ maxLength: 12 }),
      )
      .map(([head, tail]) => head + tail),
  },
  { weight: 1, arbitrary: fc.constant('') },
  {
    weight: 1,
    arbitrary: fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r'), { maxLength: 6 }),
  },
);

/** A single Completion_Entry over the full Park x Category catalog space. */
const entryArb: fc.Arbitrary<CompletionEntryDTO> = fc.record({
  experienceId: fc.uuid(),
  experienceName: nameArb,
  park: fc.constantFrom(...PARKS),
  category: fc.constantFrom(...EXPERIENCE_CATEGORIES),
  completedOn: fc.constant('2024-01-01'),
  rating: fc.option(fc.integer({ min: 1, max: 10 }), { nil: null }),
  sharedNote: fc.option(fc.string({ maxLength: 20 }), { nil: null }),
});

/**
 * Entry sets including the empty list and lists that may leave some — or all —
 * Parks/Categories with zero completed Experiences, so the "including
 * zero-count groups" clause of the property is exercised.
 */
const entriesArb = fc.array(entryArb, { maxLength: 30 });

// ---------------------------------------------------------------------------
// Section-key derivation (reproduces the screens' 1:1 mapping)
// ---------------------------------------------------------------------------
//
// StatsScreen / FriendProfileScreen build one GroupSection per group with
// these keys; we reproduce the derivation to assert the rendered sections are
// exactly one per catalog group, in canonical order, with none added/omitted.

const parkSectionKey = (park: string): string => `parks:${park}`;
const categorySectionKey = (category: string): string => `categories:${category}`;

// ---------------------------------------------------------------------------
// Feature: experience-detail-navigation, Property 6: Every group is present as
// a Group_Section
// ---------------------------------------------------------------------------
//
// Validates: Requirements 7.2, 8.2

describe('Property 6: every group is present as a Group_Section', () => {
  it('renders exactly one Park GroupSection per catalog Park, in canonical order, including zero-count groups', () => {
    fc.assert(
      fc.property(entriesArb, (entries) => {
        const groups = groupByPark(entries, PARKS);

        // Exactly one group per catalog Park — none added, none omitted —
        // regardless of how many (if any) entries each Park has (R7.2, R8.2).
        expect(groups).toHaveLength(PARKS.length);

        // Canonical catalog order, with the full Park set present (R7.2, R8.2):
        // including Parks whose completed-Experience count is zero.
        expect(groups.map((group) => group.park)).toEqual([...PARKS]);

        // Zero-count groups are present (not dropped): every Park with no named
        // entries still appears as a group (with an empty body) (R8.2).
        for (const park of PARKS) {
          expect(groups.some((group) => group.park === park)).toBe(true);
        }

        // The screens render one GroupSection per group keyed `parks:<name>`.
        // Those keys are exactly one per catalog Park, unique, in canonical
        // order — so no GroupSection is added, omitted, or duplicated.
        const sectionKeys = groups.map((group) => parkSectionKey(group.park));
        expect(sectionKeys).toEqual(PARKS.map(parkSectionKey));
        expect(new Set(sectionKeys).size).toBe(PARKS.length);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('renders exactly one Category GroupSection per Experience_Category, in canonical order, including zero-count groups', () => {
    fc.assert(
      fc.property(entriesArb, (entries) => {
        const groups = groupByCategory(entries, EXPERIENCE_CATEGORIES);

        // Exactly one group per Experience_Category — none added, none
        // omitted (R7.2, R8.2).
        expect(groups).toHaveLength(EXPERIENCE_CATEGORIES.length);

        // Canonical enumerated order, full Category set present, including
        // zero-count Categories (R7.2, R8.2).
        expect(groups.map((group) => group.category)).toEqual([
          ...EXPERIENCE_CATEGORIES,
        ]);

        for (const category of EXPERIENCE_CATEGORIES) {
          expect(groups.some((group) => group.category === category)).toBe(true);
        }

        // One unique GroupSection key per catalog Category, in canonical order.
        const sectionKeys = groups.map((group) =>
          categorySectionKey(group.category),
        );
        expect(sectionKeys).toEqual(EXPERIENCE_CATEGORIES.map(categorySectionKey));
        expect(new Set(sectionKeys).size).toBe(EXPERIENCE_CATEGORIES.length);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('keeps the same set of groups regardless of which Parks/Categories the entries cover', () => {
    // Stronger framing of "no group added or omitted": even when the entry set
    // is restricted to a single Park/Category (or is empty), the rendered
    // section set is invariant — always the full canonical catalog (R7.2,
    // R8.2).
    fc.assert(
      fc.property(entriesArb, (entries) => {
        const parkSections = groupByPark(entries, PARKS).map((group) =>
          parkSectionKey(group.park),
        );
        const categorySections = groupByCategory(
          entries,
          EXPERIENCE_CATEGORIES,
        ).map((group) => categorySectionKey(group.category));

        expect(parkSections).toEqual(PARKS.map(parkSectionKey));
        expect(categorySections).toEqual(
          EXPERIENCE_CATEGORIES.map(categorySectionKey),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
