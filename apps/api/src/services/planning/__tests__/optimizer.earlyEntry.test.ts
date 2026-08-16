/**
 * Early-entry ride availability (R3.12).
 *
 * A ride that does not operate during early entry cannot be scheduled before
 * official park open, and each ride's rope-drop ramp is anchored to when it can
 * first be ridden (early-entry open for early-entry rides, official open
 * otherwise). These tests fail against the pre-change optimizer, which scheduled
 * every ride from the window start (early-entry open) regardless.
 *
 * Validates: Requirements 3.12 (Correctness Property 10)
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { WaitSnapshot } from '@dwt/shared';

import { optimize, type OptimizeInput, type OptimizeInputItem } from '../optimizer.js';

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

function snapshotWithWait(experienceId: string, wait: number): WaitSnapshot {
  return {
    experienceId,
    isVirtualQueue: false,
    waits: Array.from({ length: 24 }, (_, i) => ({ hour: i, predictedWaitMinutes: wait })),
  };
}

function makeItem(id: string, operatesDuringEarlyEntry: boolean | null): OptimizeInputItem {
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
    durationMinutes: 15,
    operatesDuringEarlyEntry,
  };
}

// Early-entry day: 8:00 official open → early-entry open 7:30.
const EARLY_ENTRY_OPEN = 7 * 60 + 30; // 450
const OFFICIAL_OPEN = 8 * 60; // 480

function baseInput(items: OptimizeInputItem[], snaps: Record<string, WaitSnapshot>): OptimizeInput {
  return {
    items,
    date: '2026-10-01',
    walkingSpeed: 'moderate',
    earlyEntryEligible: true,
    startHour: 8,
    endHour: 21,
    snapshots: snaps,
    seed: 42,
  };
}

describe('optimizer early-entry availability (R3.12)', () => {
  it('does NOT schedule a non-early-entry ride before official open', () => {
    const res = optimize(
      baseInput([makeItem('mine', false)], { 'exp-mine': snapshotWithWait('exp-mine', 22) }),
    );
    expect(res.items).toHaveLength(1);
    // Clamped to 8:00 official open, not the 7:30 early-entry open.
    expect(etMinutesOfDay(res.items[0]!.suggestedArrival)).toBe(OFFICIAL_OPEN);
  });

  it('DOES let an early-entry ride be scheduled from early-entry open', () => {
    const res = optimize(
      baseInput([makeItem('space', true)], { 'exp-space': snapshotWithWait('exp-space', 22) }),
    );
    expect(res.items).toHaveLength(1);
    expect(etMinutesOfDay(res.items[0]!.suggestedArrival)).toBe(EARLY_ENTRY_OPEN);
  });

  it('treats an unknown (null) flag conservatively — clamped to official open', () => {
    const res = optimize(
      baseInput([makeItem('unknown', null)], { 'exp-unknown': snapshotWithWait('exp-unknown', 22) }),
    );
    expect(etMinutesOfDay(res.items[0]!.suggestedArrival)).toBe(OFFICIAL_OPEN);
  });

  it('anchors the rope-drop ramp to each ride\u2019s own first-rideable open', () => {
    // A non-EE ride clamped to official open still gets the walk-on floor AT
    // official open (ramp anchored there), not the full 22-min wait.
    const res = optimize(
      baseInput([makeItem('mine', false)], { 'exp-mine': snapshotWithWait('exp-mine', 22) }),
    );
    expect(res.items[0]!.predictedWaitMinutes).toBe(5);
    // And an EE ride is walk-on at early-entry open.
    const res2 = optimize(
      baseInput([makeItem('space', true)], { 'exp-space': snapshotWithWait('exp-space', 22) }),
    );
    expect(res2.items[0]!.predictedWaitMinutes).toBe(5);
  });

  // Feature: day-planning-optimization, Property 10: early-entry availability gate
  it('Property 10: non-early-entry rides never arrive before official open; early-entry rides may', () => {
    const itemArb = fc.record({
      id: fc.uuid(),
      ee: fc.option(fc.boolean(), { nil: null }),
    });
    fc.assert(
      fc.property(fc.uniqueArray(itemArb, { minLength: 1, maxLength: 6, selector: (x) => x.id }), (specs) => {
        const items = specs.map((s) => makeItem(s.id, s.ee));
        const snaps: Record<string, WaitSnapshot> = {};
        for (const it of items) {
          if (it.experienceId) snaps[it.experienceId] = snapshotWithWait(it.experienceId, 30);
        }

        const res = optimize(baseInput(items, snaps));
        const eeById = new Map(specs.map((s) => [s.id, s.ee]));

        for (const r of res.items) {
          const arrival = etMinutesOfDay(r.suggestedArrival);
          if (eeById.get(r.plannedItemId) === true) {
            expect(arrival).toBeGreaterThanOrEqual(EARLY_ENTRY_OPEN);
          } else {
            // false / null → clamped to official open
            expect(arrival).toBeGreaterThanOrEqual(OFFICIAL_OPEN);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('on a non-early-entry day the flag has no effect (official open == window start)', () => {
    const res = optimize({
      items: [makeItem('mine', false), makeItem('space', true)],
      date: '2026-10-01',
      walkingSpeed: 'moderate',
      earlyEntryEligible: false,
      startHour: 9,
      endHour: 21,
      snapshots: {
        'exp-mine': snapshotWithWait('exp-mine', 30),
        'exp-space': snapshotWithWait('exp-space', 30),
      },
      seed: 42,
    });
    for (const r of res.items) {
      expect(etMinutesOfDay(r.suggestedArrival)).toBeGreaterThanOrEqual(9 * 60);
    }
  });
});
