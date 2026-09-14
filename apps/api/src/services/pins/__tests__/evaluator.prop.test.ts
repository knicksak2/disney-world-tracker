/**
 * Property tests for the pure Pin evaluation engine.
 *
 * fast-check, >=100 runs each, over randomized activity snapshots.
 *
 * Validates: Requirements 2.4, 3.1, 9, 11, 12 (Properties 1, 2, 3, 4, 8, 9, 12)
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { ExperienceCategory, Park } from '@dwt/shared';
import { PINS } from '@dwt/shared';
import {
  evaluateCriteria,
  evaluatePin,
  newlyAwardedPinIds,
  type AwardState,
  type EvalExperience,
  type PinActivitySnapshot,
} from '../evaluator.js';

const CATS: ExperienceCategory[] = [
  'Ride', 'Show', 'Character_Meet', 'Restaurant', 'Resort', 'Parade', 'Walkthrough', 'PlayArea', 'Recreation',
];
const LANDS = ['Fantasyland', 'Tomorrowland', 'Adventureland'];
const PARKS: (Park | null)[] = ['Magic Kingdom', 'EPCOT', 'Hollywood Studios', 'Animal Kingdom', null];

const ATTRACTION = new Set<ExperienceCategory>(['Ride', 'Show', 'Character_Meet', 'Walkthrough', 'Parade', 'PlayArea']);

function expArb(id: string): fc.Arbitrary<EvalExperience> {
  return fc
    .record({
      category: fc.constantFrom(...CATS),
      park: fc.constantFrom(...PARKS),
      land: fc.option(fc.constantFrom(...LANDS), { nil: null }),
      worldShowcaseCountry: fc.option(fc.constantFrom('Japan', 'France', 'Italy'), { nil: null }),
      isDisneyResort: fc.boolean(),
      isRealRestaurant: fc.boolean(),
    })
    .map((r) => ({ upstreamId: id, facets: {}, ...r }));
}

const catalogArb: fc.Arbitrary<EvalExperience[]> = fc
  .integer({ min: 1, max: 14 })
  .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => expArb(`e${i}`))));

function snapshotArb(): fc.Arbitrary<PinActivitySnapshot> {
  return catalogArb.chain((catalog) =>
    fc
      .record({
        completedIdx: fc.subarray(catalog.map((_, i) => i)),
        friendRides: fc.nat(60),
        ratings: fc.nat(60),
        notes: fc.nat(40),
        trips: fc.nat(10),
      })
      .map(({ completedIdx, friendRides, ratings, notes, trips }) => {
        const completed = new Set(completedIdx.map((i) => catalog[i]!.upstreamId));
        // One day carrying the completed experiences (enough to exercise single-day).
        const days = [{ date: '2026-01-02', experiences: catalog.filter((e) => completed.has(e.upstreamId)) }];
        return {
          catalog,
          completed,
          days,
          friendRides,
          ratings,
          notes,
          trips,
          festivalTaggedCompletedIds: new Set<string>(),
        };
      }),
  );
}

describe('evaluator property tests', () => {
  // Feature: pin-collection, Property 1: awards are monotonic and idempotent.
  it('Property 1 — already-awarded pins are never re-awarded; met set only grows with more completions', () => {
    fc.assert(
      fc.property(snapshotArb(), fc.subarray(PINS.map((p) => p.id)), (snap, awardedList) => {
        const awarded = new Set(awardedList);
        // Idempotency: nothing already awarded is returned as newly awarded.
        for (const id of newlyAwardedPinIds(snap, awarded)) expect(awarded.has(id)).toBe(false);

        // Monotonicity: completing every remaining experience never un-meets a pin.
        const before = new Set(newlyAwardedPinIds(snap, new Set()));
        const fuller: PinActivitySnapshot = {
          ...snap,
          completed: new Set(snap.catalog.map((e) => e.upstreamId)),
          friendRides: 100,
          ratings: 100,
          notes: 100,
          trips: 100,
          days: [{ date: '2026-01-02', experiences: snap.catalog }],
        };
        const after = new Set(newlyAwardedPinIds(fuller, new Set()));
        for (const id of before) expect(after.has(id)).toBe(true);
      }),
      { numRuns: 150 },
    );
  });

  // Feature: pin-collection, Property 2: land/park completion iff completed superset of active-in-scope.
  it('Property 2 — landComplete is met iff every active attraction in the land is completed', () => {
    fc.assert(
      fc.property(snapshotArb(), fc.constantFrom(...LANDS), (snap, land) => {
        const active = snap.catalog.filter((e) => e.land === land && ATTRACTION.has(e.category));
        const allDone = active.length > 0 && active.every((e) => snap.completed.has(e.upstreamId));
        expect(evaluateCriteria({ kind: 'landComplete', lands: [land] }, snap).met).toBe(allDone);
      }),
      { numRuns: 150 },
    );
  });

  // Feature: pin-collection, Property 3: single-day feat iff some day satisfies it.
  it('Property 3 — a ride-marathon is met iff some day has >= N rides', () => {
    fc.assert(
      fc.property(snapshotArb(), fc.integer({ min: 1, max: 6 }), (snap, rides) => {
        const some = snap.days.some((d) => d.experiences.filter((e) => e.category === 'Ride').length >= rides);
        expect(evaluateCriteria({ kind: 'singleDay', feat: { type: 'rideMarathon', rides } }, snap).met).toBe(some);
      }),
      { numRuns: 150 },
    );
  });

  // Feature: pin-collection, Property 4: locked progress is clamped to [0, 99]; awarded is null.
  it('Property 4 — locked percentComplete is within [0, 99], awarded is unlocked/null', () => {
    fc.assert(
      fc.property(snapshotArb(), fc.integer({ min: 0, max: PINS.length - 1 }), (snap, idx) => {
        const pin = PINS[idx]!;
        const locked = evaluatePin(pin, snap, null);
        if (locked.percentComplete !== null) {
          expect(locked.percentComplete).toBeGreaterThanOrEqual(0);
          expect(locked.percentComplete).toBeLessThanOrEqual(99);
        }
        const awarded = evaluatePin(pin, snap, { awardedAt: '2026-01-02T00:00:00Z', claimedAt: null });
        expect(awarded.unlocked).toBe(true);
        expect(awarded.percentComplete).toBeNull();
      }),
      { numRuns: 150 },
    );
  });

  // Feature: pin-collection, Property 8: attractions metric ignores non-attraction completions.
  it('Property 8 — completing a Restaurant/Resort never changes the attractions count', () => {
    fc.assert(
      fc.property(snapshotArb(), (snap) => {
        const attr = (s: PinActivitySnapshot) =>
          evaluateCriteria({ kind: 'count', metric: 'attractions', threshold: 1 }, s).current;
        const base = attr(snap);
        // Add a completed non-attraction experience to the catalog + completed set.
        const extra: EvalExperience = {
          upstreamId: 'extra-restaurant', category: 'Restaurant', park: 'EPCOT', land: null,
          worldShowcaseCountry: null, facets: {}, isDisneyResort: false, isRealRestaurant: true,
        };
        const withExtra: PinActivitySnapshot = {
          ...snap,
          catalog: [...snap.catalog, extra],
          completed: new Set([...snap.completed, extra.upstreamId]),
        };
        expect(attr(withExtra)).toBe(base);
      }),
      { numRuns: 150 },
    );
  });

  // Feature: pin-collection, Property 9: land completion target equals the land's active attraction count.
  it('Property 9 — landComplete target equals the number of active attractions in the land', () => {
    fc.assert(
      fc.property(snapshotArb(), fc.constantFrom(...LANDS), (snap, land) => {
        const expected = snap.catalog.filter((e) => e.land === land && ATTRACTION.has(e.category)).length;
        expect(evaluateCriteria({ kind: 'landComplete', lands: [land] }, snap).target).toBe(expected);
      }),
      { numRuns: 150 },
    );
  });

  // Feature: pin-collection, Property 12: completion apexes iff completed equals the full active set.
  it('Property 12 — All Attractions / Whole Catalog met iff completed equals the full active set', () => {
    fc.assert(
      fc.property(snapshotArb(), (snap) => {
        const attractions = snap.catalog.filter((e) => ATTRACTION.has(e.category));
        const allAttractionsDone = attractions.length > 0 && attractions.every((e) => snap.completed.has(e.upstreamId));
        expect(evaluateCriteria({ kind: 'catalogComplete', scope: 'attractions' }, snap).met).toBe(allAttractionsDone);

        const allDone = snap.catalog.length > 0 && snap.catalog.every((e) => snap.completed.has(e.upstreamId));
        expect(evaluateCriteria({ kind: 'catalogComplete', scope: 'all' }, snap).met).toBe(allDone);
      }),
      { numRuns: 150 },
    );
  });

  // Feature: pin-collection, Property 13: a pin's projected claimedAt is only ever non-null when
  // unlocked — a locked (unawarded) pin can never carry a claim, matching the invariant `claimPin`
  // enforces at the DB layer (claiming requires a prior award row).
  it('Property 13 — claimedAt is non-null only when unlocked; a locked pin never carries a claim', () => {
    const awardStateArb: fc.Arbitrary<AwardState | null> = fc.oneof(
      fc.constant(null),
      fc.record({
        awardedAt: fc.constant('2026-01-02T00:00:00Z'),
        claimedAt: fc.option(fc.constant('2026-01-03T00:00:00Z'), { nil: null }),
      }),
    );
    fc.assert(
      fc.property(
        snapshotArb(),
        fc.integer({ min: 0, max: PINS.length - 1 }),
        awardStateArb,
        (snap, idx, award) => {
          const pin = PINS[idx]!;
          const projected = evaluatePin(pin, snap, award);
          if (!projected.unlocked) {
            expect(projected.claimedAt).toBeNull();
          }
          // And claimedAt is never invented — it always mirrors the award's claimedAt exactly.
          if (award !== null) {
            expect(projected.claimedAt).toBe(award.claimedAt);
          }
        },
      ),
      { numRuns: 150 },
    );
  });

  // Feature: pin-collection, Property 14 (board half): the projected `unlocked` flag — which the
  // board's tier summary and overallPercent are computed from — depends only on whether an award
  // exists, never on its claimedAt. Two award states that differ only in claimedAt always project
  // the same `unlocked`, so a board built from either is byte-identical in every field except
  // claimedAt (Requirement 20.5).
  it('Property 14 — unlocked (and every other projected field but claimedAt) is independent of claimedAt', () => {
    fc.assert(
      fc.property(
        snapshotArb(),
        fc.integer({ min: 0, max: PINS.length - 1 }),
        fc.boolean(),
        (snap, idx, claimed) => {
          const pin = PINS[idx]!;
          const unclaimed = evaluatePin(pin, snap, { awardedAt: '2026-01-02T00:00:00Z', claimedAt: null });
          const claimedProjection = evaluatePin(
            pin,
            snap,
            { awardedAt: '2026-01-02T00:00:00Z', claimedAt: claimed ? '2026-01-03T00:00:00Z' : null },
          );
          expect(claimedProjection.unlocked).toBe(unclaimed.unlocked);
          expect(claimedProjection.awardedAt).toBe(unclaimed.awardedAt);
          expect(claimedProjection.currentValue).toBe(unclaimed.currentValue);
          expect(claimedProjection.targetValue).toBe(unclaimed.targetValue);
          expect(claimedProjection.percentComplete).toBe(unclaimed.percentComplete);
        },
      ),
      { numRuns: 150 },
    );
  });

  // Feature: festival-booth-tagging, Property 25: Festival Metric Union Correctness
  it('Property 25: festivalBooths metric correctly counts the union of active kiosks and tagged completions without double-counting', () => {
    const allIds = Array.from({ length: 10 }, (_, i) => `exp_${i}`);

    fc.assert(
      fc.property(
        fc.subarray(allIds),
        fc.subarray(allIds),
        fc.subarray(allIds),
        (kioskIds, completedIds, taggedIds) => {
          const completedSet = new Set(completedIds);
          const taggedSet = new Set(taggedIds);

          const catalog: EvalExperience[] = kioskIds.map((id) => ({
            upstreamId: id,
            category: 'Restaurant',
            park: 'EPCOT',
            land: 'World Showcase',
            worldShowcaseCountry: null,
            facets: { quickService: ['Festival Kiosk'] },
            isDisneyResort: false,
            isRealRestaurant: false,
          }));

          const snap: PinActivitySnapshot = {
            catalog,
            completed: completedSet,
            days: [],
            friendRides: 0,
            ratings: 0,
            notes: 0,
            trips: 0,
            festivalTaggedCompletedIds: taggedSet,
          };

          const progress = evaluateCriteria({ kind: 'count', metric: 'festivalBooths', threshold: 999 }, snap);

          const expectedUnion = new Set<string>();
          for (const kId of kioskIds) {
            if (completedSet.has(kId)) {
              expectedUnion.add(kId);
            }
          }
          for (const tId of taggedIds) {
            expectedUnion.add(tId);
          }

          expect(progress.current).toBe(expectedUnion.size);
        },
      ),
      { numRuns: 150 },
    );
  });
});
