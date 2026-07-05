// Feature: expanded-stats, Property 7: Facet_Value_Key equality is exact; display label is case-insensitively first
/**
 * Property-based tests for the Stats_Service per-Facet_Value_Key roll-up
 * (`services/stats/facets.ts`), Property 7.
 *
 * Validates: Requirements 3.5, 3.7, 3.8
 *
 * Property 7 (design.md):
 *
 *   For any set of active experiences, two Facet_Values are grouped together
 *   if and only if their keys are exactly equal (differences in case or
 *   leading/trailing whitespace produce distinct keys), and the reported
 *   display label for a key is the label that sorts first under ascending
 *   case-insensitive comparison among all labels observed for that key.
 *
 * This exercises the pure `rollUpFacets` function:
 *
 *   - **Exact key equality (R3.7)**: the set of Facet_Value_Keys produced by
 *     `rollUpFacets` equals the set of *distinct exact* Facet_Value `id`s
 *     observed across all experiences. Case- and whitespace-variant ids (e.g.
 *     `"thrill"`, `"Thrill"`, `" thrill"`) are therefore reported as separate
 *     keys, never merged.
 *
 *   - **One statistic per distinct key (R3.5/R3.1/R3.2)**: the result contains
 *     exactly one entry per distinct exact key — no key appears twice, none is
 *     dropped, and empty-facet experiences contribute no key.
 *
 *   - **Label selection (R3.8)**: for every key, the reported display label is
 *     the case-insensitively-first `name` among all names observed for that
 *     key (exact-string comparison breaks a case-insensitive tie so the choice
 *     is deterministic — matching the module's documented rule).
 *
 * Each `fc.assert` runs with `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { FacetValueDTO, GroupedFacetsDTO } from '@dwt/shared';

import { rollUpFacets, type RawFacetExperienceRow } from '../facets.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Facet_Value `id`s (the Facet_Value_Key). The constant pool deliberately
 * includes case- and whitespace-variant spellings of the same word so the
 * generated data routinely contains keys that are equal ignoring case/trim but
 * must remain *distinct* under R3.7. Free-form strings widen coverage.
 */
const keyArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(
    'thrill',
    'Thrill',
    'THRILL',
    ' thrill',
    'thrill ',
    'family',
    'Family',
    'a',
    'b',
    'water-rides',
    'Water-Rides',
  ),
  fc.string({ minLength: 1, maxLength: 6 }),
);

/**
 * Display labels (the Facet_Value `name`). Includes case variants of the same
 * word so a single key can be observed with multiple distinct labels, exercising
 * the case-insensitively-first selection rule (R3.8).
 */
const labelArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(
    'Thrill Rides',
    'thrill rides',
    'THRILL RIDES',
    'Alpha',
    'alpha',
    'Zeta',
    'zeta',
    'Family Fun',
  ),
  fc.string({ minLength: 1, maxLength: 8 }),
);

const facetValueArb: fc.Arbitrary<FacetValueDTO> = fc.record({
  id: keyArb,
  name: labelArb,
});

/**
 * A `grouped_facets` JSONB blob: several named groups, each an array of
 * Facet_Values. Because `rollUpFacets` flattens across every group, spreading
 * values over multiple groups also exercises the cross-group dedup path.
 */
const groupedFacetsArb: fc.Arbitrary<GroupedFacetsDTO> = fc.dictionary(
  fc.constantFrom('rideType', 'interest', 'thrillLevel', 'audience'),
  fc.array(facetValueArb, { maxLength: 4 }),
  { maxKeys: 4 },
);

const rowArb: fc.Arbitrary<RawFacetExperienceRow> = fc.record({
  experienceId: fc.uuid(),
  completedByUser: fc.boolean(),
  groupedFacets: groupedFacetsArb,
});

const rowsArb: fc.Arbitrary<readonly RawFacetExperienceRow[]> = fc.array(rowArb, {
  maxLength: 30,
});

// ---------------------------------------------------------------------------
// Oracles (mirror the design's documented rules, independent of the impl)
// ---------------------------------------------------------------------------

/** The set of distinct *exact* Facet_Value_Keys observed across all rows. */
function observedExactKeys(rows: readonly RawFacetExperienceRow[]): Set<string> {
  const keys = new Set<string>();
  for (const row of rows) {
    for (const group of Object.values(row.groupedFacets)) {
      for (const fv of group) {
        keys.add(fv.id);
      }
    }
  }
  return keys;
}

/** Every distinct display label observed for each exact key. */
function observedLabelsByKey(
  rows: readonly RawFacetExperienceRow[],
): Map<string, Set<string>> {
  const byKey = new Map<string, Set<string>>();
  for (const row of rows) {
    for (const group of Object.values(row.groupedFacets)) {
      for (const fv of group) {
        let set = byKey.get(fv.id);
        if (set === undefined) {
          set = new Set<string>();
          byKey.set(fv.id, set);
        }
        set.add(fv.name);
      }
    }
  }
  return byKey;
}

/**
 * Case-insensitive comparison with an exact-string tiebreak, matching the
 * module's documented deterministic label choice (R3.8).
 */
function compareCaseInsensitive(a: string, b: string): number {
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  if (al < bl) return -1;
  if (al > bl) return 1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** The case-insensitively-first label among a non-empty set. */
function firstLabel(labels: ReadonlySet<string>): string {
  let chosen: string | undefined;
  for (const label of labels) {
    if (chosen === undefined || compareCaseInsensitive(label, chosen) < 0) {
      chosen = label;
    }
  }
  return chosen ?? '';
}

// ---------------------------------------------------------------------------
// Property 7
// ---------------------------------------------------------------------------

describe('Stats_Service facets — Property 7: exact key equality; case-insensitively-first label', () => {
  it('groups Facet_Values by exact key equality (case/whitespace variants stay distinct) (R3.7, R3.1, R3.2, R3.5)', () => {
    fc.assert(
      fc.property(rowsArb, (rows) => {
        const result = rollUpFacets(rows);

        const resultKeys = result.map((c) => c.key);
        const resultKeySet = new Set(resultKeys);
        const expectedKeys = observedExactKeys(rows);

        // Exactly one entry per distinct exact key: no duplicates...
        expect(resultKeys.length).toBe(resultKeySet.size);
        // ...and the key set matches the observed distinct exact keys exactly.
        // (Case/whitespace-variant ids are separate keys; empty-facet rows
        // contribute nothing.)
        expect(resultKeySet).toEqual(expectedKeys);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('reports the case-insensitively-first display label observed for each key (R3.8)', () => {
    fc.assert(
      fc.property(rowsArb, (rows) => {
        const result = rollUpFacets(rows);
        const labelsByKey = observedLabelsByKey(rows);

        for (const coverage of result) {
          const observed = labelsByKey.get(coverage.key);
          // Every reported key was observed, so it has at least one label.
          expect(observed).toBeDefined();
          expect(coverage.label).toBe(firstLabel(observed as ReadonlySet<string>));
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is invariant to the order in which the chosen label first appears (R3.8)', () => {
    // For a fixed multiset of labels on one key, the chosen label must not
    // depend on encounter order — it is always the case-insensitively-first.
    fc.assert(
      fc.property(
        fc.array(labelArb, { minLength: 1, maxLength: 6 }),
        fc.boolean(),
        (labels, reversed) => {
          const ordered = reversed ? [...labels].reverse() : labels;
          const rows: RawFacetExperienceRow[] = ordered.map((name, i) => ({
            experienceId: `exp-${i}`,
            completedByUser: false,
            groupedFacets: { g: [{ id: 'fixed-key', name }] },
          }));

          const result = rollUpFacets(rows);
          expect(result).toHaveLength(1);
          expect(result[0]!.key).toBe('fixed-key');
          expect(result[0]!.label).toBe(firstLabel(new Set(labels)));
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
