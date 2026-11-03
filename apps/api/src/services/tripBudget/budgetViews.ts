/**
 * Pure computed views for Trip Budget.
 *
 * Computes party totals and breakdown buckets by person, day, park, and category (Requirement 6).
 * Empty buckets (unreferenced keys) are omitted.
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.8
 */

import { BUDGET_CATEGORIES, type BudgetBucketDTO, type BudgetCategory } from '@dwt/shared';
import { computeLine } from './budgetMath.js';
import type { BudgetSettingsEffective, PersonIndex, PersonKey, ResolvedLine } from './types.js';

export interface BudgetViewsResult {
  total: {
    subtotalCents: number;
    taxCents: number;
    tipCents: number;
    totalCents: number;
  };
  byPerson: BudgetBucketDTO[];
  byDay: BudgetBucketDTO[];
  byPark: BudgetBucketDTO[];
  byCategory: BudgetBucketDTO[];
}

export function computeBudgetViews(
  lines: readonly ResolvedLine[],
  settings: BudgetSettingsEffective,
  people: PersonIndex,
): BudgetViewsResult {
  let subtotalCents = 0;
  let taxCents = 0;
  let tipCents = 0;
  let totalCents = 0;

  const personTotals = new Map<PersonKey, number>();
  const dayTotals = new Map<string, number>();
  const parkTotals = new Map<string, number>();
  const categoryTotals = new Map<BudgetCategory, number>();

  for (const line of lines) {
    // Allocations sorted by personKey (string compare) before math (types.ts line 39)
    const sortedAllocs = [...line.allocations].sort((a, b) => a.personKey.localeCompare(b.personKey));
    const lineMath = computeLine(
      {
        category: line.category,
        applyTip: line.applyTip,
        allocations: sortedAllocs.map((a) => ({
          personKey: a.personKey,
          cents: a.effectiveCents,
        })),
      },
      settings,
    );

    subtotalCents += lineMath.subtotalCents;
    taxCents += lineMath.taxCents;
    tipCents += lineMath.tipCents;
    totalCents += lineMath.totalCents;

    for (const p of lineMath.perPerson) {
      const linePersonTotal = p.cents + p.taxCents + p.tipCents;
      personTotals.set(p.personKey, (personTotals.get(p.personKey) ?? 0) + linePersonTotal);
    }

    const dayKey = line.plannedDate ?? 'unassigned';
    dayTotals.set(dayKey, (dayTotals.get(dayKey) ?? 0) + lineMath.totalCents);

    const parkKey = line.park ?? 'other_resort';
    parkTotals.set(parkKey, (parkTotals.get(parkKey) ?? 0) + lineMath.totalCents);

    categoryTotals.set(line.category, (categoryTotals.get(line.category) ?? 0) + lineMath.totalCents);
  }

  // byPerson: sorted by label then key
  const byPerson: BudgetBucketDTO[] = Array.from(personTotals.entries())
    .map(([key, cents]) => {
      const info = people.get(key);
      const bucket: BudgetBucketDTO = {
        key,
        label: info?.label ?? 'Deleted user',
        totalCents: cents,
        ...(info?.sponsorMemberId !== undefined ? { sponsorMemberId: info.sponsorMemberId } : {}),
      };
      return bucket;
    })
    .sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));

  // byDay: sorted ascending with 'unassigned' last
  const byDay: BudgetBucketDTO[] = Array.from(dayTotals.entries())
    .map(([key, cents]) => ({
      key,
      label: key === 'unassigned' ? 'Unassigned' : key,
      totalCents: cents,
    }))
    .sort((a, b) => {
      if (a.key === 'unassigned') return 1;
      if (b.key === 'unassigned') return -1;
      return a.key.localeCompare(b.key);
    });

  // byPark: sorted by name with 'other_resort' last
  const byPark: BudgetBucketDTO[] = Array.from(parkTotals.entries())
    .map(([key, cents]) => ({
      key,
      label: key === 'other_resort' ? 'Other (resort or multi-park)' : key,
      totalCents: cents,
    }))
    .sort((a, b) => {
      if (a.key === 'other_resort') return 1;
      if (b.key === 'other_resort') return -1;
      return a.label.localeCompare(b.label) || a.key.localeCompare(b.key);
    });

  // byCategory: sorted in canonical BUDGET_CATEGORIES order
  const byCategory: BudgetBucketDTO[] = Array.from(categoryTotals.entries())
    .map(([key, cents]) => ({
      key,
      label: key,
      totalCents: cents,
    }))
    .sort(
      (a, b) =>
        BUDGET_CATEGORIES.indexOf(a.key as BudgetCategory) -
        BUDGET_CATEGORIES.indexOf(b.key as BudgetCategory),
    );

  return {
    total: {
      subtotalCents,
      taxCents,
      tipCents,
      totalCents,
    },
    byPerson,
    byDay,
    byPark,
    byCategory,
  };
}

