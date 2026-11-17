import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { WaitSnapshot } from '@dwt/shared';
import { optimize, type OptimizeInput, type OptimizeInputItem } from '../optimizer.js';

function makeSnapshot(experienceId: string, waitsByHour: Record<number, number>): WaitSnapshot {
  const hourlyWaits: Record<string, number> = {};
  for (let h = 0; h < 24; h++) {
    hourlyWaits[String(h)] = waitsByHour[h] ?? 20;
  }
  return {
    experienceId,
    status: 'Operating',
    standbyWaitMinutes: waitsByHour[9] ?? 20,
    hourlyWaits,
    singleRiderWaitMinutes: null,
    isVirtualQueue: false,
    showtimes: null,
    showtimesAreTypical: false,
    lightningLanePriceCents: null,
    fetchedAt: '2026-10-01T00:00:00.000Z',
  } as unknown as WaitSnapshot;
}

function makeItem(id: string, overrides: Partial<OptimizeInputItem> = {}): OptimizeInputItem {
  return {
    id,
    experienceId: `exp-${id}`,
    park: 'Magic Kingdom',
    category: 'Ride',
    coords: { lat: 28.4177, lng: -81.5812 },
    plannedTime: null,
    isFixed: false,
    isLightningLane: false,
    useSingleRider: false,
    priority: 2,
    itemType: 'experience',
    durationMinutes: 15,
    ...overrides,
  };
}

describe('optimize with preserveOrder: true (R12.5, Property 27)', () => {
  it('evaluates items in exact input order even when TSP would reorder them for lower wait', () => {
    const itemA = makeItem('a', {
      coords: { lat: 28.4177, lng: -81.5812 },
    });
    const itemB = makeItem('b', {
      coords: { lat: 28.4200, lng: -81.5830 },
    });

    // Item A is 60m wait at 9am and 10m at 10am; Item B is 10m at 9am and 60m at 10am.
    // TSP would pick B then A; preserveOrder MUST keep A then B.
    const snapshots: Record<string, WaitSnapshot> = {
      'exp-a': makeSnapshot('exp-a', { 9: 60, 10: 10 }),
      'exp-b': makeSnapshot('exp-b', { 9: 10, 10: 60 }),
    };

    const baseInput: OptimizeInput = {
      items: [itemA, itemB],
      date: '2026-10-01',
      walkingSpeed: 'moderate',
      earlyEntryEligible: false,
      startHour: 9,
      endHour: 21,
      snapshots,
    };

    const tsp = optimize(baseInput);
    expect(tsp.items.map((i) => i.plannedItemId)).toEqual(['b', 'a']);

    const manualSim = optimize({ ...baseInput, preserveOrder: true });
    expect(manualSim.items.map((i) => i.plannedItemId)).toEqual(['a', 'b']);
    expect(manualSim.unfittedItemIds).toEqual([]);
    expect(manualSim.items[0]!.predictedWaitMinutes).toBeGreaterThanOrEqual(0);
  });

  it('drops tail items that exceed operating hours into unfittedItemIds while keeping earlier ones', () => {
    const item1 = makeItem('1', { durationMinutes: 300 });
    const item2 = makeItem('2', { durationMinutes: 300 });
    const item3 = makeItem('3', { durationMinutes: 300 });

    const res = optimize({
      items: [item1, item2, item3],
      date: '2026-10-01',
      walkingSpeed: 'moderate',
      earlyEntryEligible: false,
      startHour: 9,
      endHour: 19, // 600 min window -> fits 2 x 300m, drops 3rd
      snapshots: {
        'exp-1': makeSnapshot('exp-1', { 9: 0, 14: 0 }),
        'exp-2': makeSnapshot('exp-2', { 9: 0, 14: 0 }),
        'exp-3': makeSnapshot('exp-3', { 9: 0, 14: 0, 19: 0 }),
      },
      preserveOrder: true,
    });

    expect(res.items.map((i) => i.plannedItemId)).toEqual(['1', '2']);
    expect(res.unfittedItemIds).toEqual(['3']);
  });

  it('returns empty items when no single item fits within operating hours', () => {
    const huge = makeItem('huge', { durationMinutes: 900 });
    const res = optimize({
      items: [huge],
      date: '2026-10-01',
      walkingSpeed: 'moderate',
      earlyEntryEligible: false,
      startHour: 9,
      endHour: 12,
      snapshots: { 'exp-huge': makeSnapshot('exp-huge', {}) },
      preserveOrder: true,
    });
    expect(res.items).toEqual([]);
    expect(res.unfittedItemIds).toEqual(['huge']);
  });

  // Feature: day-planning-optimization, Property 27: preserveOrder simulates the user's exact sequence without TSP reordering
  it('Property 27: returned items are always a strict in-order subsequence of input.items', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            wait9: fc.integer({ min: 0, max: 90 }),
            wait10: fc.integer({ min: 0, max: 90 }),
            dur: fc.integer({ min: 5, max: 60 }),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        (specs) => {
          const items: OptimizeInputItem[] = [];
          const snapshots: Record<string, WaitSnapshot> = {};
          specs.forEach((s, idx) => {
            const id = `item-${idx}`;
            items.push(makeItem(id, { durationMinutes: s.dur }));
            snapshots[`exp-${id}`] = makeSnapshot(`exp-${id}`, { 9: s.wait9, 10: s.wait10 });
          });

          const res = optimize({
            items,
            date: '2026-10-01',
            walkingSpeed: 'moderate',
            earlyEntryEligible: false,
            startHour: 9,
            endHour: 21,
            snapshots,
            preserveOrder: true,
          });

          const returnedIds = res.items.map((i) => i.plannedItemId);
          const inputIds = items.map((i) => i.id);
          // Strict subsequence check
          let cursor = 0;
          for (const id of returnedIds) {
            while (cursor < inputIds.length && inputIds[cursor] !== id) cursor++;
            expect(cursor).toBeLessThan(inputIds.length);
            cursor++;
          }
          expect(returnedIds.length + res.unfittedItemIds.length).toBe(inputIds.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});
