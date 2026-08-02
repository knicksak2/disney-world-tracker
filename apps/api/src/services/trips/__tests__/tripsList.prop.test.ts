// Feature: trips, Property 26: The Trips list shows exactly the caller's Trips grouped and ordered by status
/**
 * Property-based tests for `groupTripsByStatus`.
 *
 * Validates: Requirements 16.1, 16.2, 16.3, 16.4, 16.5
 *
 * Property 26 (design.md → Correctness Properties):
 *
 *   For any set of Trips and memberships, the Trips_List_Screen data includes
 *   exactly the Trips on which the caller is a Trip_Member, partitioned into
 *   the Active, Upcoming, and Past groups in that order, with the Active and
 *   Upcoming groups ordered by ascending Trip_Start_Date, the Past group
 *   ordered by descending Trip_End_Date, and any empty status group omitted.
 *
 * The "exactly the caller's Trips" clause (R16.1) is a repo-level concern:
 * `listMyTrips` fetches only the caller's memberships and hands that already
 * filtered set to this pure grouping function. At this layer, therefore,
 * R16.1 manifests as a conservation invariant — `groupTripsByStatus` neither
 * adds, drops, nor duplicates any Trip it is given; the flattened output is a
 * permutation of the input. The remaining clauses (R16.2–R16.5) are the
 * partition, ordering, and empty-group-omission rules exercised below.
 *
 * Test design
 * -----------
 * `groupTripsByStatus` is pure, so the test drives the real production
 * function directly (no fakes). Trips are generated as day offsets from the
 * Unix epoch rendered to `YYYY-MM-DD`, keeping every generated string a real
 * calendar date whose lexicographic order equals chronological order — the
 * same technique the Property 1 test uses. Each Trip carries a unique `id` so
 * membership and per-group ordering can be verified precisely.
 *
 * The reference oracle is fully independent of the code under test: it
 * classifies each Trip from the raw numeric day offsets (not the rendered
 * strings) and re-derives the expected groups by filtering (order-preserving)
 * then stably sorting by the numeric key required for each group. A stable
 * sort mirrors the single-key comparators in the implementation, so Trips
 * that tie on the sort key keep their input-relative order in both.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  groupTripsByStatus,
  type GroupableTrip,
  type TripStatusGroup,
} from '../tripsList.js';
import type { TripStatus } from '../tripStatus.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** A Trip carrying its raw day offsets (for the oracle) plus the rendered row. */
interface GenTrip extends GroupableTrip {
  readonly id: string;
  readonly startDay: number;
  readonly endDay: number;
}

/** Render a day offset from the Unix epoch to a `YYYY-MM-DD` calendar date. */
function dayToISO(dayOffset: number): string {
  return new Date(dayOffset * 86_400_000).toISOString().slice(0, 10);
}

/** Day offsets spanning roughly 1990-01-01 .. 2059-ish, ample date range. */
const dayArb = fc.integer({ min: 7_305, max: 32_873 });

/**
 * A WDW "today" together with a set of Trips. Trips share the same `wdwToday`
 * (the list is grouped relative to a single anchor) and each has a valid
 * `end >= start` date pair. Start days are drawn from a *small* window around
 * the anchor so all three status groups — and start/end ties within a group —
 * are exercised frequently rather than vanishingly rarely.
 */
const listArb = dayArb.chain((todayDay) =>
  fc
    .array(
      fc.record({
        // Start within a +/- ~10 day window of "today" so upcoming, active,
        // and past all occur often; the small window also forces frequent
        // start/end collisions that exercise the tie-break paths.
        startOffset: fc.integer({ min: -10, max: 10 }),
        span: fc.nat({ max: 6 }),
      }),
      { minLength: 0, maxLength: 25 },
    )
    .map((rows) => {
      const trips: GenTrip[] = rows.map((r, idx) => {
        const startDay = todayDay + r.startOffset;
        const endDay = startDay + r.span; // end >= start (write invariant).
        return {
          id: `trip-${String(idx).padStart(3, '0')}`,
          startDay,
          endDay,
          startDate: dayToISO(startDay),
          endDate: dayToISO(endDay),
        };
      });
      return { todayDay, wdwToday: dayToISO(todayDay), trips };
    }),
);

// ---------------------------------------------------------------------------
// Reference oracle (independent of the code under test)
// ---------------------------------------------------------------------------

/** Classify a Trip purely from numeric day offsets (R16.2 partition rule). */
function classify(trip: GenTrip, todayDay: number): TripStatus {
  if (todayDay > trip.endDay) return 'past';
  if (todayDay < trip.startDay) return 'upcoming';
  return 'active';
}

/**
 * Re-derive the expected groups: partition in input order, then stably sort
 * each group by its required numeric key. Empty groups are omitted and the
 * surviving groups appear in the fixed Active → Upcoming → Past order.
 */
function expectedGroups(
  trips: readonly GenTrip[],
  todayDay: number,
): TripStatusGroup<GenTrip>[] {
  const active = trips.filter((t) => classify(t, todayDay) === 'active');
  const upcoming = trips.filter((t) => classify(t, todayDay) === 'upcoming');
  const past = trips.filter((t) => classify(t, todayDay) === 'past');

  // `[...arr].sort` is stable in modern V8/Node, matching the single-key
  // comparators in the implementation (ties keep input-relative order).
  const byStartAsc = [...active].sort((a, b) => a.startDay - b.startDay);
  const byUpcomingStartAsc = [...upcoming].sort((a, b) => a.startDay - b.startDay);
  const byEndDesc = [...past].sort((a, b) => b.endDay - a.endDay);

  const all: TripStatusGroup<GenTrip>[] = [
    { status: 'active', trips: byStartAsc },
    { status: 'upcoming', trips: byUpcomingStartAsc },
    { status: 'past', trips: byEndDesc },
  ];
  return all.filter((g) => g.trips.length > 0);
}

const ids = (trips: readonly GenTrip[]): string[] => trips.map((t) => t.id);

// ---------------------------------------------------------------------------
// Property assertions
// ---------------------------------------------------------------------------

describe('groupTripsByStatus — Property 26: caller Trips grouped and ordered by status', () => {
  it('matches the independent oracle exactly: partition, order, and omissions (R16.2–R16.5)', () => {
    fc.assert(
      fc.property(listArb, ({ trips, wdwToday, todayDay }) => {
        const actual = groupTripsByStatus(trips, wdwToday);
        expect(actual).toEqual(expectedGroups(trips, todayDay));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('conserves membership: the flattened output is a permutation of the input (R16.1)', () => {
    fc.assert(
      fc.property(listArb, ({ trips, wdwToday }) => {
        const flat = groupTripsByStatus(trips, wdwToday).flatMap((g) => g.trips);
        // Same multiset of ids: nothing added, dropped, or duplicated.
        expect([...ids(flat)].sort()).toEqual([...ids(trips)].sort());
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('emits only non-empty groups, in the fixed Active → Upcoming → Past order (R16.2, R16.5)', () => {
    fc.assert(
      fc.property(listArb, ({ trips, wdwToday }) => {
        const actual = groupTripsByStatus(trips, wdwToday);
        // Never an empty group.
        for (const g of actual) {
          expect(g.trips.length).toBeGreaterThan(0);
        }
        // Statuses are distinct and appear in the canonical relative order.
        const order: TripStatus[] = ['active', 'upcoming', 'past'];
        const seen = actual.map((g) => g.status);
        expect(seen).toEqual(order.filter((s) => seen.includes(s)));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('places each Trip in the group matching its derived status (R16.2)', () => {
    fc.assert(
      fc.property(listArb, ({ trips, wdwToday, todayDay }) => {
        for (const g of groupTripsByStatus(trips, wdwToday)) {
          for (const t of g.trips) {
            expect(classify(t, todayDay)).toBe(g.status);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('orders Active and Upcoming by ascending start date, Past by descending end date (R16.3, R16.4)', () => {
    fc.assert(
      fc.property(listArb, ({ trips, wdwToday }) => {
        for (const g of groupTripsByStatus(trips, wdwToday)) {
          for (let i = 1; i < g.trips.length; i++) {
            const prev = g.trips[i - 1]!;
            const curr = g.trips[i]!;
            if (g.status === 'past') {
              // Descending Trip_End_Date (non-increasing across the group).
              expect(prev.endDate >= curr.endDate).toBe(true);
            } else {
              // Ascending Trip_Start_Date (non-decreasing across the group).
              expect(prev.startDate <= curr.startDate).toBe(true);
            }
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('does not mutate the input array (R16.1)', () => {
    fc.assert(
      fc.property(listArb, ({ trips, wdwToday }) => {
        const snapshot = [...trips];
        groupTripsByStatus(trips, wdwToday);
        expect(trips).toEqual(snapshot);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('groupTripsByStatus — fixed regression examples', () => {
  const wdwToday = '2025-06-10';

  it('groups, orders, and omits empty groups on a mixed set (R16.2–R16.5)', () => {
    const trips: GenTrip[] = [
      { id: 'past-a', startDay: 0, endDay: 0, startDate: '2025-05-01', endDate: '2025-05-05' },
      { id: 'active', startDay: 0, endDay: 0, startDate: '2025-06-08', endDate: '2025-06-12' },
      { id: 'past-b', startDay: 0, endDay: 0, startDate: '2025-05-20', endDate: '2025-05-25' },
      { id: 'up-a', startDay: 0, endDay: 0, startDate: '2025-07-01', endDate: '2025-07-03' },
      { id: 'up-b', startDay: 0, endDay: 0, startDate: '2025-06-20', endDate: '2025-06-22' },
    ];

    const result = groupTripsByStatus(trips, wdwToday);

    expect(result.map((g) => g.status)).toEqual(['active', 'upcoming', 'past']);
    // Active group.
    expect(ids(result[0]!.trips)).toEqual(['active']);
    // Upcoming ascending by start date.
    expect(ids(result[1]!.trips)).toEqual(['up-b', 'up-a']);
    // Past descending by end date.
    expect(ids(result[2]!.trips)).toEqual(['past-b', 'past-a']);
  });

  it('omits every empty group and returns [] for no Trips (R16.5)', () => {
    expect(groupTripsByStatus([], wdwToday)).toEqual([]);

    const onlyActive: GenTrip[] = [
      { id: 'a', startDay: 0, endDay: 0, startDate: '2025-06-09', endDate: '2025-06-11' },
    ];
    const result = groupTripsByStatus(onlyActive, wdwToday);
    expect(result).toHaveLength(1);
    expect(result[0]!.status).toBe('active');
  });
});
