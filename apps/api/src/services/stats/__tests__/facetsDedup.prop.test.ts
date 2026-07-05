// Feature: expanded-stats, Property 6: Facet coverage counts each experience at most once per key
/**
 * Property-based test for the Stats_Service pure per-Facet_Value_Key roll-up
 * (`services/stats/facets.ts`, Requirement 3).
 *
 * Validates: Requirements 3.1, 3.2, 3.4, 3.6
 *
 * Property 6 (design.md §"Correctness Properties"):
 *
 *   For any set of active Experiences with facets, for every Facet_Value_Key,
 *   the key's `total` counts each Experience at most once and its `completed`
 *   counts each completed Experience at most once, even when an Experience
 *   carries the same key multiple times across Grouped_Facets and
 *   Interest_Facets (i.e. across multiple facet groups).
 *
 * The test drives `rollUpFacets` with `RawFacetExperienceRow[]` where a single
 * Experience deliberately repeats the same Facet_Value `id` across multiple
 * groups. An independent reference oracle computes, per key, the number of
 * distinct Experiences carrying it (and the number of those completed). The
 * "at most once" guarantee is asserted in its strongest form — the rolled-up
 * `total`/`completed` must equal the deduped Experience counts — together with
 * the coverage invariants `0 <= completed <= total` and R3.6 (an Experience
 * with no Facet_Values contributes to no key).
 *
 * Each `fc.assert` runs with `numRuns: 100` per the spec convention.
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';

import type { GroupedFacetsDTO } from '@dwt/shared';

import { rollUpFacets, type RawFacetExperienceRow } from '../facets.js';

const NUM_RUNS = 100;

/**
 * A single facet occurrence placed into a named group on an Experience. The
 * same `id` may occur in more than one group (that is exactly what R3.4 must
 * dedup), and `name` may vary independently of `id`.
 */
interface Occurrence {
  readonly group: string;
  readonly id: string;
  readonly name: string;
}

/** One generated Experience: whether the user completed it, plus its occurrences. */
interface GenExperience {
  readonly completedByUser: boolean;
  readonly occurrences: readonly Occurrence[];
}

/** Small pools keep keys/groups colliding so dedup paths are exercised. */
const keyIdArb = fc.constantFrom('k0', 'k1', 'k2', 'k3', 'k4');
const groupArb = fc.constantFrom('g0', 'g1', 'g2');
const labelArb = fc.constantFrom('Alpha', 'alpha', 'Bravo', 'BRAVO', 'Charlie');

const occurrenceArb: fc.Arbitrary<Occurrence> = fc.record({
  group: groupArb,
  id: keyIdArb,
  name: labelArb,
});

const experienceArb: fc.Arbitrary<GenExperience> = fc.record({
  completedByUser: fc.boolean(),
  // minLength 0 so empty-facet Experiences occur (R3.6 exclusion path).
  occurrences: fc.array(occurrenceArb, { minLength: 0, maxLength: 8 }),
});

const experiencesArb: fc.Arbitrary<readonly GenExperience[]> = fc.array(
  experienceArb,
  { minLength: 0, maxLength: 12 },
);

/**
 * Fold a generated Experience's flat occurrence list into the
 * `GroupedFacetsDTO` shape the roll-up consumes. Occurrences that share a group
 * accumulate into that group's array; the same `id` may therefore appear in
 * several groups (cross-group duplication) or several times in one group.
 */
function toRow(exp: GenExperience): RawFacetExperienceRow {
  const grouped: Record<string, { id: string; name: string }[]> = {};
  for (const occ of exp.occurrences) {
    (grouped[occ.group] ??= []).push({ id: occ.id, name: occ.name });
  }
  return {
    experienceId: 'exp',
    completedByUser: exp.completedByUser,
    groupedFacets: grouped as GroupedFacetsDTO,
  };
}

describe('Stats_Service facets — Property 6: each Experience counted at most once per key', () => {
  it('total/completed equal the deduped Experience counts despite cross-group duplicate keys', () => {
    fc.assert(
      fc.property(experiencesArb, (experiences) => {
        const rows = experiences.map(toRow);

        // Reference oracle: per key, the number of distinct Experiences that
        // carry it, and how many of those the user completed. This is the
        // "each Experience at most once" semantics computed independently.
        const expectedTotal = new Map<string, number>();
        const expectedCompleted = new Map<string, number>();
        for (const exp of experiences) {
          const keysHere = new Set(exp.occurrences.map((o) => o.id));
          for (const key of keysHere) {
            expectedTotal.set(key, (expectedTotal.get(key) ?? 0) + 1);
            if (exp.completedByUser) {
              expectedCompleted.set(key, (expectedCompleted.get(key) ?? 0) + 1);
            }
          }
        }

        const result = rollUpFacets(rows);

        // The set of reported keys is exactly the set of keys present on at
        // least one Experience — nothing extra (R3.2), and Experiences with no
        // Facet_Values contribute no key (R3.6).
        const reportedKeys = new Set(result.map((f) => f.key));
        if (reportedKeys.size !== expectedTotal.size) return false;
        for (const key of expectedTotal.keys()) {
          if (!reportedKeys.has(key)) return false;
        }

        for (const facet of result) {
          const total = expectedTotal.get(facet.key) ?? 0;
          const completed = expectedCompleted.get(facet.key) ?? 0;

          // At-most-once dedup, in its strongest (equality) form (R3.4, R3.1).
          if (facet.cell.total !== total) return false;
          if (facet.cell.completed !== completed) return false;

          // Coverage invariants: 0 <= completed <= total.
          if (facet.cell.completed < 0) return false;
          if (facet.cell.completed > facet.cell.total) return false;
        }

        return true;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('a key repeated many times within a single Experience is still counted once', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1, max: 3 }),
        (completed, repeatsPerGroup, groupCount) => {
          // Build one Experience carrying key 'dup' `repeatsPerGroup` times in
          // each of `groupCount` groups — heavy cross- and intra-group repeat.
          const grouped: Record<string, { id: string; name: string }[]> = {};
          for (let g = 0; g < groupCount; g += 1) {
            grouped[`grp${g}`] = Array.from({ length: repeatsPerGroup }, () => ({
              id: 'dup',
              name: 'Repeated',
            }));
          }
          const row: RawFacetExperienceRow = {
            experienceId: 'solo',
            completedByUser: completed,
            groupedFacets: grouped as GroupedFacetsDTO,
          };

          const result = rollUpFacets([row]);
          if (result.length !== 1) return false;
          const cell = result[0]!.cell;
          // Exactly one Experience → total 1, completed 0/1 by completion flag.
          return cell.total === 1 && cell.completed === (completed ? 1 : 0);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
