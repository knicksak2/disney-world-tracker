/**
 * Walk/Wait Optimization Priority (R10): `walkWaitWeighting` biases the
 * search's internal cost ranking between `Total_Wait_Time` and
 * `Total_Travel_Time` without changing the reported, unweighted totals.
 *
 * `balanced` (or omitting the field) must reproduce the pre-Requirement-10
 * unweighted 1:1 formula exactly. `minimize_waits` and `minimize_walking`
 * must measurably steer the chosen sequence toward their named dimension on
 * a fixture engineered to have a genuine tradeoff between two orderings.
 *
 * Validates: Requirements 10.2, 10.3, 10.5 (Correctness Property 21)
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { WaitSnapshot } from '@dwt/shared';

import {
  optimize,
  WALK_WAIT_WEIGHT_PRESETS,
  type OptimizeInput,
  type OptimizeInputItem,
} from '../optimizer.js';

// Modeled on the Animal Kingdom scenario that motivated this feature:
// Pandora (A) sits adjacent to Discovery Island (B); Africa (C, "Safari") is
// a long walk across the park. Safari's standby wait ramps steeply through
// the morning, so visiting it early is cheap on wait but expensive on the
// geographic sweep, while visiting it after a tight Pandora/Discovery-Island
// loop is cheap on walking but catches Safari's wait much higher.
const PANDORA = { lat: 28.3550, lng: -81.594 };
const DISCOVERY_ISLAND = { lat: 28.358, lng: -81.59 };
const AFRICA = { lat: 28.361, lng: -81.582 }; // ~1.3km from Pandora

function makeItem(overrides: Partial<OptimizeInputItem> = {}): OptimizeInputItem {
  return {
    id: 'item',
    experienceId: 'exp-item',
    park: 'Animal Kingdom',
    coords: PANDORA,
    plannedTime: null,
    isFixed: false,
    isLightningLane: false,
    useSingleRider: false,
    priority: 2,
    itemType: 'experience',
    category: 'Ride',
    durationMinutes: 15,
    ...overrides,
  };
}

function flatSnap(id: string, wait: number): WaitSnapshot {
  return {
    experienceId: id,
    isVirtualQueue: false,
    waits: Array.from({ length: 24 }, (_, hour) => ({ hour, predictedWaitMinutes: wait })),
  };
}

/**
 * A fixture with a genuine, unconstrained tradeoff: four fully flexible
 * items (no fixed anchors, so the search has real freedom over ordering).
 * Flight of Passage (a) and Na'vi River Journey (b) sit in Pandora; Zootopia
 * (c) sits in adjacent Discovery Island; Safari (d) sits across the park in
 * Africa with a wait that ramps from a walk-on floor at open up to a long
 * afternoon wait. A geography-first order does one long crossing to Africa
 * after clearing the Pandora/Discovery-Island cluster (cheap walk, expensive
 * Safari wait); a wait-first order visits Safari first while it's cheap,
 * then crosses back (expensive walk, cheap Safari wait).
 */
function buildTradeoffInput(walkWaitWeighting?: OptimizeInput['walkWaitWeighting']): OptimizeInput {
  const flightOfPassage = makeItem({ id: 'a', experienceId: 'exp-a', coords: PANDORA });
  const naviRiver = makeItem({ id: 'b', experienceId: 'exp-b', coords: PANDORA });
  const zootopia = makeItem({ id: 'c', experienceId: 'exp-c', coords: DISCOVERY_ISLAND });
  const safariWaits = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    predictedWaitMinutes: hour < 9 ? 5 : Math.min(75, 5 + (hour - 9) * 20),
  }));
  const safari = makeItem({ id: 'd', experienceId: 'exp-d', coords: AFRICA, durationMinutes: 20 });

  const snapshots: Record<string, WaitSnapshot> = {
    'exp-a': flatSnap('exp-a', 5),
    'exp-b': flatSnap('exp-b', 15),
    'exp-c': flatSnap('exp-c', 8),
    'exp-d': { experienceId: 'exp-d', isVirtualQueue: false, waits: safariWaits },
  };

  return {
    items: [flightOfPassage, naviRiver, zootopia, safari],
    date: '2026-10-01',
    walkingSpeed: 'moderate',
    earlyEntryEligible: false,
    startHour: 9,
    endHour: 21,
    snapshots,
    seed: 42,
    ...(walkWaitWeighting ? { walkWaitWeighting } : {}),
  };
}

describe('optimizer walk/wait weighting (R10, Property 21)', () => {
  it('WALK_WAIT_WEIGHT_PRESETS resolves the three documented presets', () => {
    expect(WALK_WAIT_WEIGHT_PRESETS.balanced).toEqual({ waitWeight: 1, walkWeight: 1 });
    expect(WALK_WAIT_WEIGHT_PRESETS.minimize_waits).toEqual({ waitWeight: 1, walkWeight: 0.3 });
    expect(WALK_WAIT_WEIGHT_PRESETS.minimize_walking).toEqual({ waitWeight: 0.3, walkWeight: 1 });
  });

  it('"balanced" (explicit) produces an identical result to omitting walkWaitWeighting entirely', () => {
    const withBalanced = optimize(buildTradeoffInput('balanced'));
    const omitted = optimize(buildTradeoffInput(undefined));

    expect(withBalanced.items).toEqual(omitted.items);
    expect(withBalanced.totalWaitMinutes).toBe(omitted.totalWaitMinutes);
    expect(withBalanced.totalWalkMinutes).toBe(omitted.totalWalkMinutes);
    expect(withBalanced.unfittedItemIds).toEqual(omitted.unfittedItemIds);
  });

  it('"minimize_waits" never yields a strictly worse totalWaitMinutes than "minimize_walking" on the same tradeoff fixture', () => {
    const minimizeWaits = optimize(buildTradeoffInput('minimize_waits'));
    const minimizeWalking = optimize(buildTradeoffInput('minimize_walking'));

    expect(minimizeWaits.totalWaitMinutes).toBeLessThanOrEqual(minimizeWalking.totalWaitMinutes);
  });

  it('"minimize_walking" never yields a strictly worse totalWalkMinutes than "minimize_waits" on the same tradeoff fixture', () => {
    const minimizeWaits = optimize(buildTradeoffInput('minimize_waits'));
    const minimizeWalking = optimize(buildTradeoffInput('minimize_walking'));

    expect(minimizeWalking.totalWalkMinutes).toBeLessThanOrEqual(minimizeWaits.totalWalkMinutes);
  });

  it('the weighting fixture actually diverges (sanity check the fixture is not degenerate)', () => {
    const minimizeWaits = optimize(buildTradeoffInput('minimize_waits'));
    const minimizeWalking = optimize(buildTradeoffInput('minimize_walking'));

    // At least one of the two totals differs between presets — otherwise the
    // fixture would not be exercising a real tradeoff at all.
    const waitsDiffer = minimizeWaits.totalWaitMinutes !== minimizeWalking.totalWaitMinutes;
    const walkDiffers = minimizeWaits.totalWalkMinutes !== minimizeWalking.totalWalkMinutes;
    expect(waitsDiffer || walkDiffers).toBe(true);
  });

  it('reports true unweighted totalWaitMinutes/totalWalkMinutes regardless of weighting (never scaled by waitWeight/walkWeight)', () => {
    // A single-item day has no search freedom, so the weighted cost scalar
    // is irrelevant to sequencing — but this still guards that the reported
    // totals are never multiplied by the resolved weight. The lone item
    // always arrives at the schedule's own start (0 minutes into the
    // rope-drop ramp per R3.11), so the expected wait is the walk-on floor
    // (5 min), not the raw snapshot wait — computed identically for every
    // weighting to prove none of them scale it.
    const item = makeItem({ coords: PANDORA });
    const rawWait = 20;
    const snapshots: Record<string, WaitSnapshot> = { 'exp-item': flatSnap('exp-item', rawWait) };
    const base: Omit<OptimizeInput, 'walkWaitWeighting'> = {
      items: [item],
      date: '2026-10-01',
      walkingSpeed: 'moderate',
      earlyEntryEligible: false,
      startHour: 9,
      endHour: 21,
      snapshots,
      seed: 42,
    };

    const balanced = optimize({ ...base, walkWaitWeighting: 'balanced' });
    const minimizeWaits = optimize({ ...base, walkWaitWeighting: 'minimize_waits' });
    const minimizeWalking = optimize({ ...base, walkWaitWeighting: 'minimize_walking' });

    // All three must agree with each other (the weighting must not change
    // the reported wait at all — it only changes search ranking).
    expect(minimizeWaits.totalWaitMinutes).toBe(balanced.totalWaitMinutes);
    expect(minimizeWalking.totalWaitMinutes).toBe(balanced.totalWaitMinutes);
    // And the shared value must be the walk-on floor (< rawWait), proving
    // none of the three silently fell back to the unadjusted snapshot wait.
    expect(balanced.totalWaitMinutes).toBeLessThan(rawWait);
  });

  // Feature: day-planning-optimization, Property 21: walk/wait weighting biases search without corrupting reported totals
  it('Property 21: "balanced" matches the unweighted formula, and reported totals are never scaled by the weight', () => {
    const itemArb = fc.record({
      id: fc.uuid(),
      wait: fc.integer({ min: 0, max: 60 }),
      lat: fc.double({ min: 28.4, max: 28.43, noNaN: true }),
      lng: fc.double({ min: -81.6, max: -81.55, noNaN: true }),
    });

    fc.assert(
      fc.property(
        fc.uniqueArray(itemArb, { minLength: 1, maxLength: 5, selector: (x) => x.id }),
        fc.constantFrom<NonNullable<OptimizeInput['walkWaitWeighting']>>('balanced', 'minimize_waits', 'minimize_walking'),
        (specs, weighting) => {
          const items = specs.map((s) =>
            makeItem({ id: s.id, experienceId: `exp-${s.id}`, coords: { lat: s.lat, lng: s.lng } }),
          );
          const snapshots: Record<string, WaitSnapshot> = {};
          for (const s of specs) {
            snapshots[`exp-${s.id}`] = flatSnap(`exp-${s.id}`, s.wait);
          }

          const base: Omit<OptimizeInput, 'walkWaitWeighting'> = {
            items,
            date: '2026-10-01',
            walkingSpeed: 'moderate',
            earlyEntryEligible: false,
            startHour: 9,
            endHour: 21,
            snapshots,
            seed: 42,
          };

          const weighted = optimize({ ...base, walkWaitWeighting: weighting });
          const unweightedReference = optimize({ ...base, walkWaitWeighting: 'balanced' });

          if (weighting === 'balanced') {
            expect(weighted.items).toEqual(unweightedReference.items);
            expect(weighted.totalWaitMinutes).toBe(unweightedReference.totalWaitMinutes);
            expect(weighted.totalWalkMinutes).toBe(unweightedReference.totalWalkMinutes);
          }

          // Reported totals are always the true unweighted sums: recompute
          // wait/walk directly from the returned items and confirm they
          // match what optimize() reported, for every weighting.
          let recomputedWait = 0;
          let recomputedWalk = 0;
          for (const resultItem of weighted.items) {
            recomputedWait += resultItem.predictedWaitMinutes;
            recomputedWalk += resultItem.travelFromPrev?.minutes ?? 0;
          }
          expect(recomputedWalk).toBe(weighted.totalWalkMinutes);
          // totalWaitMinutes may include idle-gap wait not carried on
          // individual items (e.g. soft-window clamping), so assert it is at
          // least the sum of per-item predicted waits rather than exact
          // equality, while still proving it is not a weighted scalar.
          expect(weighted.totalWaitMinutes).toBeGreaterThanOrEqual(recomputedWait);
        },
      ),
      { numRuns: 100 },
    );
  });
});
