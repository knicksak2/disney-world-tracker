/**
 * A fixed item (a booked reservation) that runs past the day's close must not
 * make the whole day un-optimizable (R3.20, Property 25).
 *
 * Regression for: a day with a fixed 8:30 PM signature dinner (90 min -> ends
 * 10:00 PM) against the default 9:00 PM close. Every candidate sequence
 * contains the fixed item, so every candidate was rejected (cost = Infinity),
 * `optimize` returned no items with every item "unfitted", the route persisted
 * nothing, and removing a flexible ride changed nothing.
 *
 * Validates: Requirements 3.20 (Correctness Property 25)
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { WaitSnapshot } from '@dwt/shared';

import { optimize, type OptimizeInput, type OptimizeInputItem } from '../optimizer.js';
import { wdwMinutesFromMidnight } from '../../trips/wdwClock.js';

const DATE = '2026-10-01';
const CLOSE = 21 * 60;
// 8:30 PM ET on 2026-10-01 (EDT, UTC-4) is 00:30Z on the 2nd.
const DINNER_TIME = '2026-10-02T00:30:00.000Z';

function snap(id: string, wait: number): WaitSnapshot {
  return {
    experienceId: id,
    isVirtualQueue: false,
    waits: Array.from({ length: 24 }, (_, i) => ({ hour: i, predictedWaitMinutes: wait })),
  };
}

function ride(id: string, durationMinutes = 15): OptimizeInputItem {
  return {
    id,
    experienceId: `exp-${id}`,
    park: 'Magic Kingdom',
    coords: { lat: 28.4177, lng: -81.5812 },
    plannedTime: null,
    isFixed: false,
    isLightningLane: false,
    useSingleRider: false,
    priority: 2,
    itemType: 'experience',
    category: 'Ride',
    durationMinutes,
  };
}

function dinner(): OptimizeInputItem {
  return {
    id: 'dinner',
    experienceId: 'exp-dinner',
    park: 'Magic Kingdom',
    coords: { lat: 28.4177, lng: -81.5812 },
    plannedTime: DINNER_TIME,
    isFixed: true,
    isLightningLane: false,
    useSingleRider: false,
    priority: 1,
    itemType: 'experience',
    category: 'Restaurant',
    durationMinutes: 90, // 8:30 PM + 90 min = 10:00 PM, past the 9:00 PM close
  };
}

function inputFor(items: OptimizeInputItem[], extra: Partial<OptimizeInput> = {}): OptimizeInput {
  const snapshots: Record<string, WaitSnapshot> = {};
  for (const it of items) {
    if (it.experienceId) snapshots[it.experienceId] = snap(it.experienceId, 10);
  }
  return {
    items,
    date: DATE,
    walkingSpeed: 'moderate',
    earlyEntryEligible: false,
    snapshots,
    seed: 42,
    ...extra,
  };
}

describe('optimizer: fixed item running past close (R3.20)', () => {
  it('still schedules the flexible rides around a fixed dinner that ends after close', () => {
    const res = optimize(inputFor([ride('a'), ride('b'), ride('c'), dinner()]));

    expect(res.unfittedItemIds).toEqual([]);
    expect(res.items.map((i) => i.plannedItemId).sort()).toEqual(['a', 'b', 'c', 'dinner']);
    expect(res.warnings).not.toContain('over_constrained');
  });

  it('keeps the fixed dinner at its booked time and flags it fixed_past_close', () => {
    const res = optimize(inputFor([ride('a'), ride('b'), dinner()]));

    const d = res.items.find((i) => i.plannedItemId === 'dinner');
    expect(d).toBeDefined();
    expect(wdwMinutesFromMidnight(DATE, d!.suggestedArrival)).toBe(20 * 60 + 30);
    expect(res.warnings).toContain('fixed_past_close:dinner');
  });

  it('does not flag a fixed item that finishes before close', () => {
    const early = { ...dinner(), plannedTime: '2026-10-01T22:00:00.000Z' /* 6:00 PM ET */ };
    const res = optimize(inputFor([ride('a'), early]));

    expect(res.warnings.some((w) => w.startsWith('fixed_past_close'))).toBe(false);
  });

  it('still refuses to place a flexible ride that would finish after close', () => {
    // Start at 8:45 PM: a 45-minute ride cannot finish by 9:00 PM, so it is
    // reported as unfitted while the fixed dinner is still scheduled.
    const res = optimize(inputFor([ride('late', 45), dinner()], { startMinutes: 20 * 60 + 45 }));

    expect(res.unfittedItemIds).toContain('late');
    expect(res.items.map((i) => i.plannedItemId)).toContain('dinner');
  });

  // Feature: day-planning-optimization, Property 25: a fixed item past close never blocks flexible scheduling
  it('Property 25: flexible items still schedule and never complete after close', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 5000 }), { minLength: 1, maxLength: 6 }),
        fc.integer({ min: 5, max: 90 }),
        (ids, dur) => {
          const flex = ids.map((n) => ride(`r${n}`, dur));
          const res = optimize(inputFor([...flex, dinner()]));

          // The fixed item is always present and flagged.
          expect(res.items.map((i) => i.plannedItemId)).toContain('dinner');
          expect(res.warnings).toContain('fixed_past_close:dinner');

          // Every flexible item that was scheduled completes by close (wait 10 + dur).
          for (const r of res.items) {
            if (r.plannedItemId === 'dinner') continue;
            const completion =
              wdwMinutesFromMidnight(DATE, r.suggestedArrival) + r.predictedWaitMinutes + dur;
            expect(completion).toBeLessThanOrEqual(CLOSE);
          }

          // A flexible item is either scheduled or reported unfitted, never lost.
          const accounted = new Set([...res.items.map((i) => i.plannedItemId), ...res.unfittedItemIds]);
          for (const f of flex) expect(accounted.has(f.id)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
