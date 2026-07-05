// Feature: expanded-stats, Task 3.4: unit tests for facet edge cases.
/**
 * Example-based unit tests for the pure per-Facet_Value_Key roll-up
 * `rollUpFacets` in `services/stats/facets.ts`.
 *
 * These complement the property tests (Properties 6 and 7) by pinning down the
 * concrete edge cases the design calls out:
 *
 *   - A single key that appears in more than one facet group of one Experience
 *     (Grouped_Facets and its Interest_Facets subset both carry it) is counted
 *     at most once for that Experience (R3.4).
 *   - An Experience with no Facet_Values in any group is excluded from every
 *     key (R3.6).
 *   - When one key is observed with multiple distinct display labels across
 *     Experiences, the reported label is the one that sorts first under
 *     ascending case-insensitive comparison (R3.8).
 *
 * Validates: Requirements 3.4, 3.6, 3.8.
 */

import { describe, it, expect } from 'vitest';

import { rollUpFacets, type RawFacetExperienceRow } from '../facets.js';

describe('rollUpFacets — facet edge cases (task 3.4)', () => {
  describe('same key in both Grouped_Facets and Interest_Facets views (R3.4)', () => {
    it('counts an experience at most once in total when a key repeats across groups', () => {
      // `groupedFacets` carries the whole facet set; Interest_Facets is a
      // derived subset, so the same key naturally appears under two group
      // names on one Experience. It must be counted once.
      const rows: readonly RawFacetExperienceRow[] = [
        {
          experienceId: 'exp-1',
          completedByUser: true,
          groupedFacets: {
            thrillFactor: [{ id: 'thrill', name: 'Thrill Rides' }],
            interests: [{ id: 'thrill', name: 'Thrill Rides' }],
          },
        },
      ];

      const result = rollUpFacets(rows);

      expect(result).toHaveLength(1);
      expect(result[0]!).toEqual({
        key: 'thrill',
        label: 'Thrill Rides',
        cell: {
          completed: 1,
          total: 1,
          percent: 100,
          remaining: 0,
          completeBadge: true,
        },
      });
    });

    it('counts a completed experience at most once in completed when a key repeats across groups', () => {
      const rows: readonly RawFacetExperienceRow[] = [
        {
          experienceId: 'exp-1',
          completedByUser: true,
          groupedFacets: {
            groupA: [{ id: 'water', name: 'Water Rides' }],
            groupB: [{ id: 'water', name: 'Water Rides' }],
            groupC: [{ id: 'water', name: 'Water Rides' }],
          },
        },
        {
          experienceId: 'exp-2',
          completedByUser: false,
          groupedFacets: {
            groupA: [{ id: 'water', name: 'Water Rides' }],
          },
        },
      ];

      const result = rollUpFacets(rows);

      expect(result).toHaveLength(1);
      // Two experiences carry the key, one completed → completed 1, total 2.
      expect(result[0]!.cell.completed).toBe(1);
      expect(result[0]!.cell.total).toBe(2);
      expect(result[0]!.cell.percent).toBe(50);
      expect(result[0]!.cell.remaining).toBe(1);
      expect(result[0]!.cell.completeBadge).toBe(false);
    });
  });

  describe('empty-facet experience exclusion (R3.6)', () => {
    it('excludes an experience whose groupedFacets is entirely empty', () => {
      const rows: readonly RawFacetExperienceRow[] = [
        {
          experienceId: 'exp-empty',
          completedByUser: true,
          groupedFacets: {},
        },
        {
          experienceId: 'exp-facet',
          completedByUser: false,
          groupedFacets: {
            thrillFactor: [{ id: 'thrill', name: 'Thrill Rides' }],
          },
        },
      ];

      const result = rollUpFacets(rows);

      // Only the key from the facet-bearing experience appears; the empty
      // experience contributes to no key and does not inflate any total.
      expect(result).toHaveLength(1);
      expect(result[0]!.key).toBe('thrill');
      expect(result[0]!.cell.total).toBe(1);
      expect(result[0]!.cell.completed).toBe(0);
    });

    it('excludes an experience whose groups exist but contain no Facet_Values', () => {
      const rows: readonly RawFacetExperienceRow[] = [
        {
          experienceId: 'exp-empty-groups',
          completedByUser: true,
          groupedFacets: {
            thrillFactor: [],
            interests: [],
          },
        },
      ];

      const result = rollUpFacets(rows);

      expect(result).toEqual([]);
    });

    it('returns an empty list when every experience is facet-less', () => {
      const rows: readonly RawFacetExperienceRow[] = [
        { experienceId: 'a', completedByUser: true, groupedFacets: {} },
        { experienceId: 'b', completedByUser: false, groupedFacets: {} },
      ];

      expect(rollUpFacets(rows)).toEqual([]);
    });
  });

  describe('key present with multiple distinct labels (R3.8)', () => {
    it('chooses the label that sorts first by ascending case-insensitive comparison', () => {
      // One key "attr" observed with three distinct labels across experiences.
      // Case-insensitively: "amazing" < "brilliant" < "Zebra".
      const rows: readonly RawFacetExperienceRow[] = [
        {
          experienceId: 'exp-1',
          completedByUser: true,
          groupedFacets: { g: [{ id: 'attr', name: 'Zebra' }] },
        },
        {
          experienceId: 'exp-2',
          completedByUser: false,
          groupedFacets: { g: [{ id: 'attr', name: 'brilliant' }] },
        },
        {
          experienceId: 'exp-3',
          completedByUser: true,
          groupedFacets: { g: [{ id: 'attr', name: 'amazing' }] },
        },
      ];

      const result = rollUpFacets(rows);

      expect(result).toHaveLength(1);
      expect(result[0]!.key).toBe('attr');
      // "amazing" is case-insensitively first, even though uppercase "Zebra"
      // would sort earlier under a naive byte comparison.
      expect(result[0]!.label).toBe('amazing');
      expect(result[0]!.cell.total).toBe(3);
      expect(result[0]!.cell.completed).toBe(2);
    });

    it('breaks a case-insensitive tie deterministically by exact string order', () => {
      // "Thrill" and "thrill" are equal case-insensitively; the exact-string
      // comparison ("Thrill" < "thrill") breaks the tie deterministically.
      const rows: readonly RawFacetExperienceRow[] = [
        {
          experienceId: 'exp-1',
          completedByUser: false,
          groupedFacets: { g: [{ id: 'thrill', name: 'thrill' }] },
        },
        {
          experienceId: 'exp-2',
          completedByUser: false,
          groupedFacets: { g: [{ id: 'thrill', name: 'Thrill' }] },
        },
      ];

      const result = rollUpFacets(rows);

      expect(result).toHaveLength(1);
      expect(result[0]!.label).toBe('Thrill');
    });

    it('treats case/whitespace differences in the key as distinct keys (R3.7 boundary)', () => {
      // Guards the label-selection edge case: labels only merge when the KEY is
      // exactly equal. Distinct-cased keys stay separate, each with its label.
      const rows: readonly RawFacetExperienceRow[] = [
        {
          experienceId: 'exp-1',
          completedByUser: true,
          groupedFacets: { g: [{ id: 'Thrill', name: 'Upper' }] },
        },
        {
          experienceId: 'exp-2',
          completedByUser: false,
          groupedFacets: { g: [{ id: 'thrill', name: 'lower' }] },
        },
      ];

      const result = rollUpFacets(rows);

      expect(result).toHaveLength(2);
      const byKey = new Map(result.map((r) => [r.key, r.label]));
      expect(byKey.get('Thrill')).toBe('Upper');
      expect(byKey.get('thrill')).toBe('lower');
    });
  });
});
