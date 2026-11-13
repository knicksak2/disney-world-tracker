import { describe, expect, it } from 'vitest';

import { DINING_CONFIG_DEFAULTS, type EnginePlanStay } from '@dwt/shared';

import {
  assignmentKey,
  baselineOf,
  combinationRecord,
  compareRanked,
  enumerateAssignments,
  plansBought,
  uniformOf,
} from '../combinations.js';
import { buildStayRuntimes } from '../stays.js';
import { A1, SEEDED } from './engineFixtures.js';

function stay(key: string, checkIn: string, checkOut: string, overrides: Partial<EnginePlanStay> = {}): EnginePlanStay {
  return { key, label: key, lodgingKind: 'resort', source: 'stay', checkIn, checkOut, partyKeys: null, setting: { status: 'compare', heldPlan: null, channel: 'package' }, ...overrides };
}

// 2026: quick service and table service are priced, deluxe is not; 2027: all three.
const { stays } = buildStayRuntimes({
  stays: [
    stay('held', '2026-12-10', '2026-12-12', { setting: { status: 'have_plan', heldPlan: 'quick_service', channel: 'package' } }),
    stay('a', '2026-12-12', '2026-12-14'),
    stay('off', '2026-12-14', '2026-12-16', { lodgingKind: 'offsite' }),
    stay('b', '2027-01-02', '2027-01-04'),
  ],
  persons: [A1],
  priceRows: SEEDED,
  settings: { kidsEatFree: true },
  config: DINING_CONFIG_DEFAULTS,
  taxBps: 650,
});

describe('combinations', () => {
  it('enumerates the product of the stays\' options in date order', () => {
    expect(stays.map((s) => s.options)).toEqual([['quick_service'], [null, 'quick_service', 'table_service'], [null], [null, 'quick_service', 'table_service', 'deluxe']]);
    const all = enumerateAssignments(stays);
    expect(all).toHaveLength(12);
    expect(all[0]).toEqual(['quick_service', null, null, null]);
    expect(all.at(-1)).toEqual(['quick_service', 'table_service', null, 'deluxe']);
    expect(new Set(all.map(assignmentKey)).size).toBe(12);
  });

  it('keeps fixed stays in the Baseline and sets compare stays to none', () => {
    expect(baselineOf(stays)).toEqual(['quick_service', null, null, null]);
  });

  it('builds the uniform option only where the plan is available, and null when no compare stay has it', () => {
    expect(uniformOf(stays, 'deluxe')).toEqual(['quick_service', null, null, 'deluxe']);
    expect(uniformOf(stays, 'table_service')).toEqual(['quick_service', 'table_service', null, 'table_service']);
    const offOnly = buildStayRuntimes({ stays: [stay('off', '2026-12-14', '2026-12-16', { lodgingKind: 'offsite' })], persons: [A1], priceRows: SEEDED, settings: { kidsEatFree: true }, config: DINING_CONFIG_DEFAULTS, taxBps: 650 }).stays;
    expect(uniformOf(offOnly, 'quick_service')).toBeNull();
  });

  it('counts only plans bought on compare stays', () => {
    expect(plansBought(stays, ['quick_service', null, null, null])).toBe(0);
    expect(plansBought(stays, ['quick_service', 'table_service', null, 'deluxe'])).toBe(2);
  });

  it('ranks by total, then fewer plans bought, then No_Plan, quick service, table service, deluxe stay by stay', () => {
    const rank = (assign: (typeof stays)[number]['options'][number][], totalCents: number) => ({ assign, totalCents });
    const cheaper = rank(['quick_service', 'table_service', null, 'table_service'], 1000);
    const dearer = rank(['quick_service', null, null, null], 1001);
    expect(compareRanked(stays, cheaper, dearer)).toBeLessThan(0);
    // Equal totals: one plan (table service at a) beats two quick-service plans, although quick service ranks first at a.
    const onePlan = rank(['quick_service', 'table_service', null, null], 5000);
    const twoPlans = rank(['quick_service', 'quick_service', null, 'quick_service'], 5000);
    expect(compareRanked(stays, onePlan, twoPlans)).toBeLessThan(0);
    expect(compareRanked(stays, twoPlans, onePlan)).toBeGreaterThan(0);
    // Equal totals and counts: the earlier stay's simpler option wins.
    const qsFirst = rank(['quick_service', 'quick_service', null, null], 5000);
    const tsFirst = rank(['quick_service', 'table_service', null, null], 5000);
    const laterOnly = rank(['quick_service', null, null, 'quick_service'], 5000);
    expect(compareRanked(stays, laterOnly, qsFirst)).toBeLessThan(0);
    expect(compareRanked(stays, qsFirst, tsFirst)).toBeLessThan(0);
    expect(compareRanked(stays, qsFirst, qsFirst)).toBe(0);
  });

  it('records a Combination by stay key', () => {
    expect(combinationRecord(stays, ['quick_service', null, null, 'deluxe'])).toEqual({ held: 'quick_service', a: 'none', off: 'none', b: 'deluxe' });
  });
});
