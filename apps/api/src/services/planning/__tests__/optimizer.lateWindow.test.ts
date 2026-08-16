/**
 * Late-window availability gating (R3.13): a ride may be scheduled into the
 * Extended Evening (+120) or after-hours (+180) extension only if it operates
 * during that window. Rides that don't (incl. unknown-flag) close at base hours.
 *
 * These fail against the pre-change optimizer, which extended the window for
 * every ride regardless of participation.
 *
 * Validates: Requirements 3.13 (Correctness Property 11)
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

function snap(id: string, wait: number): WaitSnapshot {
  return { experienceId: id, isVirtualQueue: false, waits: Array.from({ length: 24 }, (_, i) => ({ hour: i, predictedWaitMinutes: wait })) };
}

function makeItem(
  id: string,
  flags: { ext?: boolean | null; tick?: boolean | null } = {},
): OptimizeInputItem {
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
    durationMinutes: 45,
    operatesDuringExtendedEvening: flags.ext ?? null,
    operatesDuringTicketedEvent: flags.tick ?? null,
  };
}

const BASE_CLOSE = 21 * 60; // 21:00

describe('optimizer late-window availability gating (R3.13)', () => {
  it('drops a non-extended-evening ride that only fits in the +120 extension', () => {
    // Three 45-min rides in a 19:00–21:00 base window (120 min) need ~165 min.
    const items = [makeItem('a', { ext: false }), makeItem('b', { ext: false }), makeItem('c', { ext: false })];
    const snapshots: Record<string, WaitSnapshot> = { 'exp-a': snap('exp-a', 10), 'exp-b': snap('exp-b', 10), 'exp-c': snap('exp-c', 10) };
    const input: OptimizeInput = {
      items, date: '2026-10-01', walkingSpeed: 'moderate', earlyEntryEligible: false,
      useExtendedEvening: true, startHour: 19, endHour: 21, snapshots, seed: 42,
    };
    const res = optimize(input);
    // Not eligible → they close at base (21:00), so not all fit.
    expect(res.unfittedItemIds.length).toBeGreaterThan(0);
  });

  it('fits the same rides when they DO operate during extended evening', () => {
    const items = [makeItem('a', { ext: true }), makeItem('b', { ext: true }), makeItem('c', { ext: true })];
    const snapshots: Record<string, WaitSnapshot> = { 'exp-a': snap('exp-a', 10), 'exp-b': snap('exp-b', 10), 'exp-c': snap('exp-c', 10) };
    const res = optimize({
      items, date: '2026-10-01', walkingSpeed: 'moderate', earlyEntryEligible: false,
      useExtendedEvening: true, startHour: 19, endHour: 21, snapshots, seed: 42,
    });
    expect(res.unfittedItemIds).toHaveLength(0);
    expect(res.items).toHaveLength(3);
  });

  it('gates the after-hours (+180) extension by the ticketed-event flag', () => {
    const notTicketed = [makeItem('a', { tick: false }), makeItem('b', { tick: false }), makeItem('c', { tick: false }), makeItem('d', { tick: false })];
    const snapshots: Record<string, WaitSnapshot> = { 'exp-a': snap('exp-a', 10), 'exp-b': snap('exp-b', 10), 'exp-c': snap('exp-c', 10), 'exp-d': snap('exp-d', 10) };
    const base = { date: '2026-10-01', walkingSpeed: 'moderate' as const, earlyEntryEligible: false, hasAfterHoursTicket: true, startHour: 19, endHour: 21, snapshots, seed: 42 };
    expect(optimize({ ...base, items: notTicketed }).unfittedItemIds.length).toBeGreaterThan(0);

    const ticketed = [makeItem('a', { tick: true }), makeItem('b', { tick: true }), makeItem('c', { tick: true }), makeItem('d', { tick: true })];
    expect(optimize({ ...base, items: ticketed }).unfittedItemIds).toHaveLength(0);
  });

  // Feature: day-planning-optimization, Property 11: late-window availability gate
  it('Property 11: on an extended-evening day, a non-eligible scheduled ride completes by base close', () => {
    const itemArb = fc.record({ id: fc.uuid(), ext: fc.option(fc.boolean(), { nil: null }) });
    fc.assert(
      fc.property(fc.uniqueArray(itemArb, { minLength: 1, maxLength: 6, selector: (x) => x.id }), (specs) => {
        const items = specs.map((s) => makeItem(s.id, { ext: s.ext }));
        const snapshots: Record<string, WaitSnapshot> = {};
        for (const it of items) {
          if (it.experienceId) snapshots[it.experienceId] = snap(it.experienceId, 10);
        }
        const res = optimize({
          items, date: '2026-10-01', walkingSpeed: 'moderate', earlyEntryEligible: false,
          useExtendedEvening: true, startHour: 9, endHour: 21, snapshots, seed: 7,
        });
        const extById = new Map(specs.map((s) => [s.id, s.ext]));
        for (const r of res.items) {
          if (extById.get(r.plannedItemId) !== true) {
            const completion = etMinutesOfDay(r.suggestedArrival) + r.predictedWaitMinutes + 45;
            expect(completion).toBeLessThanOrEqual(BASE_CLOSE);
          }
        }
      }),
      { numRuns: 150 },
    );
  });
});
