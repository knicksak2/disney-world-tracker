/**
 * Rope-drop wait modeling (R3.7, R3.11).
 *
 * A standby wait taken straight from the hourly shape overstates reality at
 * park/early-entry open, when the first guests walk on. The optimizer ramps the
 * wait from a near-walk-on floor at open up to the full predicted wait over the
 * first ROPE_DROP_WINDOW_MINUTES. These tests would fail against the pre-fix
 * code, which returned the raw shape wait (e.g. 22 min) at rope drop.
 *
 * Validates: Requirements 3.7, 3.11 (Correctness Property 9)
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { WaitSnapshot } from '@dwt/shared';

import { optimize, ropeDropAdjust, type OptimizeInput, type OptimizeInputItem } from '../optimizer.js';

const WDW_TIME_ZONE = 'America/New_York';

function etMinutesOfDay(isoStr: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: WDW_TIME_ZONE,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(new Date(isoStr));
  let h = 0;
  let m = 0;
  for (const p of parts) {
    if (p.type === 'hour') h = parseInt(p.value, 10);
    if (p.type === 'minute') m = parseInt(p.value, 10);
  }
  if (h === 24) h = 0;
  return h * 60 + m;
}

/** A Big-Thunder-like snapshot: a flat 22-min standby wait every hour. */
function snapshotWithWait(experienceId: string, wait: number): WaitSnapshot {
  return {
    experienceId,
    isVirtualQueue: false,
    waits: Array.from({ length: 24 }, (_, i) => ({ hour: i, predictedWaitMinutes: wait })),
  };
}

function makeItem(id: string, durationMinutes = 15): OptimizeInputItem {
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
    // These rope-drop tests are about rides that DO open for early entry; the
    // early-entry availability clamp (R3.12) is exercised separately in
    // optimizer.earlyEntry.test.ts.
    operatesDuringEarlyEntry: true,
  };
}

const WALKON = 5;
const WINDOW = 30;

describe('optimizer rope-drop wait modeling (R3.7, R3.11)', () => {
  it('rope-dropping at early-entry open yields a near-walk-on wait, not the raw shape wait', () => {
    // Early entry with an 8:00 official open → effective open 7:30. A single
    // ride whose shape says 22 min should read as the ~5-min walk-on at open.
    const input: OptimizeInput = {
      items: [makeItem('btmrr')],
      date: '2026-10-01',
      walkingSpeed: 'moderate',
      earlyEntryEligible: true,
      startHour: 8,
      endHour: 21,
      snapshots: { 'exp-btmrr': snapshotWithWait('exp-btmrr', 22) },
      seed: 42,
    };

    const res = optimize(input);
    expect(res.items).toHaveLength(1);
    // Scheduled at effective open (7:30).
    expect(etMinutesOfDay(res.items[0]!.suggestedArrival)).toBe(7 * 60 + 30);
    // Pre-fix this was 22; rope drop makes it the walk-on floor.
    expect(res.items[0]!.predictedWaitMinutes).toBe(WALKON);
  });

  it('waits ramp back up to the full shape wait once past the rope-drop window', () => {
    // Two 45-min rides from a 9:00 open. The first rope-drops at open (walk-on);
    // the second arrives ~50 min later, past the 30-min window, at the full 22.
    const input: OptimizeInput = {
      items: [makeItem('a', 45), makeItem('b', 45)],
      date: '2026-10-01',
      walkingSpeed: 'moderate',
      earlyEntryEligible: false,
      startHour: 9,
      endHour: 21,
      snapshots: {
        'exp-a': snapshotWithWait('exp-a', 22),
        'exp-b': snapshotWithWait('exp-b', 22),
      },
      seed: 42,
    };

    const res = optimize(input);
    expect(res.items).toHaveLength(2);
    const ordered = [...res.items].sort((x, y) =>
      x.suggestedArrival.localeCompare(y.suggestedArrival),
    );
    expect(etMinutesOfDay(ordered[0]!.suggestedArrival)).toBe(9 * 60); // rope drop
    expect(ordered[0]!.predictedWaitMinutes).toBe(WALKON);
    expect(ordered[1]!.predictedWaitMinutes).toBe(22); // past the window → full wait
  });

  // Feature: day-planning-optimization, Property 9: rope-drop ramp
  it('Property 9: ramp never raises a wait, holds the floor at open, and is monotonic in the window', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 180 }), // rawWait
        fc.integer({ min: 0, max: 90 }), // arrival offset from open
        fc.integer({ min: 0, max: 1200 }), // dayStartMins
        (rawWait, offset, dayStart) => {
          const adjusted = ropeDropAdjust(rawWait, dayStart + offset, dayStart);

          // Never raises a wait.
          expect(adjusted).toBeLessThanOrEqual(rawWait);

          if (offset >= WINDOW) {
            // Outside the window: unmodified.
            expect(adjusted).toBe(rawWait);
          } else {
            // Inside the window: at least the walk-on floor (unless already lower).
            expect(adjusted).toBeGreaterThanOrEqual(Math.min(rawWait, WALKON));
            if (offset === 0) {
              expect(adjusted).toBe(Math.min(rawWait, WALKON));
            }
          }

          // Monotonic non-decreasing across the window: a later arrival is never
          // modeled with a shorter wait than an earlier one.
          if (offset > 0) {
            const earlier = ropeDropAdjust(rawWait, dayStart + offset - 1, dayStart);
            expect(adjusted).toBeGreaterThanOrEqual(earlier);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
