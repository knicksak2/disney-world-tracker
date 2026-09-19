/**
 * Rope-drop ramp anchor independence from `startMinutes` (R3.11, R3.12,
 * Property 24).
 *
 * `startMinutes` is where THIS simulated sequence's clock begins — for a live
 * "Right Now" optimize on today (R9.3, R9.8), the route clamps it to the
 * current WDW time, which on a mid-day optimize is well after the park (and
 * early entry) already opened. The rope-drop ramp anchor must stay fixed to
 * the park's real schedule (official open, or early-entry open on an
 * early-entry day) regardless of `startMinutes` — the first item in a
 * sequence must NOT read as "arriving at minute 0 of rope drop" just because
 * it happens to be scheduled first, when the real wall-clock time is already
 * well past open.
 *
 * These tests fail against the pre-fix optimizer, which aliased the rope-drop
 * anchor (`itemOpenMins`) to `startMins` itself, so ANY first-in-sequence ride
 * — early-entry or not — always computed `minutesIntoWindow = 0` and got the
 * walk-on floor, no matter how late in the day `startMinutes` actually was.
 *
 * Validates: Requirements 3.11, 3.12 (Correctness Property 24)
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { WaitSnapshot } from '@dwt/shared';

import { optimize, type OptimizeInput, type OptimizeInputItem } from '../optimizer.js';

function snapshotWithWait(experienceId: string, wait: number): WaitSnapshot {
  return {
    experienceId,
    isVirtualQueue: false,
    waits: Array.from({ length: 24 }, (_, i) => ({ hour: i, predictedWaitMinutes: wait })),
  };
}

function makeItem(
  id: string,
  operatesDuringEarlyEntry: boolean | null,
  overrides: Partial<OptimizeInputItem> = {},
): OptimizeInputItem {
  return {
    id,
    experienceId: `exp-${id}`,
    park: 'Animal Kingdom',
    coords: { lat: 28.3555, lng: -81.5921 },
    plannedTime: null,
    isFixed: false,
    isLightningLane: false,
    useSingleRider: false,
    priority: 2,
    itemType: 'experience',
    category: 'Ride',
    durationMinutes: 12,
    operatesDuringEarlyEntry,
    ...overrides,
  };
}

// Early-entry day: official open 8:00 (480), early-entry open 7:30 (450).
// Request issued well after both — 9:15 AM (555) — mirroring a live "Right
// Now" mid-day optimize (R9.3/R9.8 clamp startMinutes to current WDW time).
const OFFICIAL_OPEN = 8 * 60; // 480
const EARLY_ENTRY_OPEN = 7 * 60 + 30; // 450
const MID_DAY_START = 9 * 60 + 15; // 555

function baseInput(items: OptimizeInputItem[], snaps: Record<string, WaitSnapshot>): OptimizeInput {
  return {
    items,
    date: '2026-10-01',
    walkingSpeed: 'moderate',
    earlyEntryEligible: true,
    startHour: 8,
    endHour: 21,
    startMinutes: MID_DAY_START,
    snapshots: snaps,
    seed: 42,
  };
}

describe('optimizer rope-drop anchor is independent of a mid-day startMinutes (Property 24)', () => {
  it('does NOT apply the rope-drop walk-on floor to an early-entry ride scheduled first at 9:15 AM (105 min past early-entry open)', () => {
    const rawWait = 45;
    const res = optimize(
      baseInput([makeItem('fop', true)], { 'exp-fop': snapshotWithWait('exp-fop', rawWait) }),
    );
    expect(res.items).toHaveLength(1);
    // 105 minutes past early-entry open is far outside the 30-min rope-drop
    // window, so the full raw wait applies — never the 5-min walk-on floor.
    expect(res.items[0]!.predictedWaitMinutes).toBe(rawWait);
  });

  it('does NOT apply the rope-drop walk-on floor to a non-early-entry ride scheduled first at 9:15 AM (75 min past official open)', () => {
    const rawWait = 40;
    const res = optimize(
      baseInput([makeItem('safari', false)], { 'exp-safari': snapshotWithWait('exp-safari', rawWait) }),
    );
    expect(res.items).toHaveLength(1);
    expect(res.items[0]!.predictedWaitMinutes).toBe(rawWait);
  });

  it('DOES still apply the walk-on floor when startMinutes genuinely falls inside the rope-drop window', () => {
    const rawWait = 45;
    const res = optimize({
      items: [makeItem('fop', true)],
      date: '2026-10-01',
      walkingSpeed: 'moderate',
      earlyEntryEligible: true,
      startHour: 8,
      endHour: 21,
      startMinutes: EARLY_ENTRY_OPEN, // genuinely at early-entry open
      snapshots: { 'exp-fop': snapshotWithWait('exp-fop', rawWait) },
      seed: 42,
    });
    expect(res.items[0]!.predictedWaitMinutes).toBe(5);
  });

  it('a later item in the SAME mid-day sequence still reads its own real arrival time correctly (no window at all, early or otherwise)', () => {
    const res = optimize(
      baseInput(
        [makeItem('fop', true), makeItem('safari', false, { coords: { lat: 28.3593, lng: -81.5923 } })],
        {
          'exp-fop': snapshotWithWait('exp-fop', 45),
          'exp-safari': snapshotWithWait('exp-safari', 40),
        },
      ),
    );
    expect(res.items).toHaveLength(2);
    for (const r of res.items) {
      expect(r.predictedWaitMinutes).toBeGreaterThan(5);
    }
  });

  // Feature: day-planning-optimization, Property 24: rope-drop anchor is the
  // park's fixed schedule, never startMinutes
  it('Property 24: whichever item lands first in the sequence, the ramp anchor never moves with startMinutes', () => {
    const itemArb = fc.record({
      id: fc.uuid(),
      ee: fc.option(fc.boolean(), { nil: null }),
      wait: fc.integer({ min: 10, max: 90 }),
      // Strictly past the END of both possible rope-drop windows (official
      // open + 30, the later of the two anchors) through mid-afternoon, so NO
      // item should ever receive a rope-drop discount regardless of its own
      // early-entry flag.
      startMinutes: fc.integer({ min: OFFICIAL_OPEN + 30, max: 16 * 60 }),
    });

    fc.assert(
      fc.property(itemArb, (spec) => {
        const item = makeItem('item', spec.ee);
        const res = optimize({
          items: [item],
          date: '2026-10-01',
          walkingSpeed: 'moderate',
          earlyEntryEligible: true,
          startHour: 8,
          endHour: 21,
          startMinutes: spec.startMinutes,
          snapshots: { 'exp-item': snapshotWithWait('exp-item', spec.wait) },
          seed: 42,
        });

        expect(res.items).toHaveLength(1);
        // The lone item is always past the end of BOTH possible rope-drop
        // windows (official open + 30 = 510 is the later of the two window
        // ends; spec.startMinutes >= 510), so its full raw wait applies
        // regardless of its own early-entry flag.
        expect(res.items[0]!.predictedWaitMinutes).toBe(spec.wait);
      }),
      { numRuns: 200 },
    );
  });
});
