// Feature: experience-live-details, Property 5: Showtimes, operating hours, and dining availability preserve structure and cardinality
/**
 * Property-based tests for `projectLiveDetail` (the projection pure core).
 *
 * This file is shared across the projection property tests (design.md →
 * Correctness Properties 1-6); each property is added as its own `it` block so
 * the suite reads top-to-bottom by property number.
 *
 * ---------------------------------------------------------------------------
 * Property 5: Showtimes, operating hours, and dining availability preserve
 * structure and cardinality.
 *
 * Validates: Requirements 1.7, 1.20, 1.21
 *
 * For any upstream live entry whose showtimes and operating-hours entries fall
 * on the current Park day:
 *
 *   - Each projected showtime carries a `start` equal to the upstream start,
 *     an `end` iff the upstream entry carried an end time, and a `type` iff the
 *     upstream entry carried a type label; the projected order and cardinality
 *     match the upstream list one-for-one (R1.7).
 *   - Each projected operating-hours set carries `open`/`close` equal to the
 *     upstream open/close and a `type` iff the upstream entry carried a type
 *     label; cardinality and order match one-for-one (R1.19, exercised here as
 *     part of the structure-preserving property).
 *   - `diningAvailability` has exactly one entry per upstream walk-up list item
 *     — independent of whether operating hours are present — each carrying a
 *     `partySize` iff the upstream party size is an integer and an
 *     `estimatedWaitMinutes` iff the upstream wait is a whole number in
 *     [0, 1440] (R1.20); and it is the empty array when the upstream list is
 *     missing or empty (R1.21).
 *
 * Showtimes and operating hours are scoped to the current Park day via the
 * projection context, so the generators below produce upstream timestamps at
 * "mid-day" UTC hours on a single calendar date and a `ctx.now` on that same
 * date. Mid-day UTC hours [13:00, 22:59] map to roughly 08:00-19:00 US-Eastern
 * in both EST (UTC-5) and EDT (UTC-4), so every generated instant reliably
 * falls on the same Park-local day as `now` and therefore survives projection.
 * This isolates the structure/cardinality property from the day-scoping logic
 * (which the park-time helpers cover directly).
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { projectLiveDetail, WDW_TIME_ZONE, type ProjectionContext } from '../project.js';
import type { ThemeParksLiveEntry } from '../themeparksLive.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Raw sub-shapes (so generated inputs are typed to the upstream wire shape)
// ---------------------------------------------------------------------------

type RawShowtime = NonNullable<ThemeParksLiveEntry['showtimes']>[number];
type RawHours = NonNullable<ThemeParksLiveEntry['operatingHours']>[number];
type RawDining = NonNullable<ThemeParksLiveEntry['diningAvailability']>[number];

// ---------------------------------------------------------------------------
// Park-day / instant generators
// ---------------------------------------------------------------------------

interface ParkDay {
  readonly year: number;
  readonly month: number; // 0-based
  readonly day: number;
}

/** A calendar date; days are capped at 28 to avoid month-length edge cases. */
const parkDayArb: fc.Arbitrary<ParkDay> = fc.record({
  year: fc.integer({ min: 2023, max: 2030 }),
  month: fc.integer({ min: 0, max: 11 }),
  day: fc.integer({ min: 1, max: 28 }),
});

/**
 * A UTC instant at a mid-day hour on `day`. Hours in [13, 22] UTC are ~08:00-
 * 19:00 US-Eastern on the same calendar date in both EST and EDT, so the
 * instant always falls on `day` Park-local — and therefore survives the
 * current-Park-day scoping in the projection.
 */
function safeInstantArb(day: ParkDay): fc.Arbitrary<string> {
  return fc
    .record({
      hour: fc.integer({ min: 13, max: 22 }),
      minute: fc.integer({ min: 0, max: 59 }),
    })
    .map(({ hour, minute }) =>
      new Date(Date.UTC(day.year, day.month, day.day, hour, minute, 0)).toISOString(),
    );
}

/** The projection clock: a fixed mid-day instant on the same Park day. */
function nowFor(day: ParkDay): Date {
  return new Date(Date.UTC(day.year, day.month, day.day, 18, 0, 0));
}

/** Optional type label: absent, or any string (including the empty string). */
const optionalTypeArb = fc.option(fc.string(), { nil: undefined });

// ---------------------------------------------------------------------------
// Upstream item builders (conditional keys to honour exactOptionalPropertyTypes)
// ---------------------------------------------------------------------------

function buildShowtime(
  startTime: string,
  endTime: string | undefined,
  type: string | undefined,
): RawShowtime {
  return {
    startTime,
    ...(endTime !== undefined ? { endTime } : {}),
    ...(type !== undefined ? { type } : {}),
  };
}

function buildHours(
  startTime: string,
  endTime: string,
  type: string | undefined,
): RawHours {
  return {
    startTime,
    endTime,
    ...(type !== undefined ? { type } : {}),
  };
}

function buildDining(
  partySize: number | undefined,
  waitTime: number | undefined,
): RawDining {
  return {
    ...(partySize !== undefined ? { partySize } : {}),
    ...(waitTime !== undefined ? { waitTime } : {}),
  };
}

function showtimeArb(day: ParkDay): fc.Arbitrary<RawShowtime> {
  return fc
    .tuple(safeInstantArb(day), fc.option(safeInstantArb(day), { nil: undefined }), optionalTypeArb)
    .map(([start, end, type]) => buildShowtime(start, end, type));
}

function hoursArb(day: ParkDay): fc.Arbitrary<RawHours> {
  return fc
    .tuple(safeInstantArb(day), safeInstantArb(day), optionalTypeArb)
    .map(([open, close, type]) => buildHours(open, close, type));
}

/**
 * A party size that is sometimes a valid integer, sometimes a non-integer
 * (which the projection drops), and sometimes absent.
 */
const partySizeArb = fc.option(
  fc.oneof(
    fc.integer({ min: 1, max: 12 }), // valid integer
    fc.integer({ min: -4, max: 0 }), // still an integer → kept (validInteger has no range)
    fc.integer({ min: 0, max: 12 }).map((n) => n + 0.5), // non-integer → dropped
  ),
  { nil: undefined },
);

/**
 * A walk-up wait that is sometimes a whole number in [0, 1440] (kept) and
 * sometimes out-of-range or non-integer (dropped), and sometimes absent.
 */
const waitTimeArb = fc.option(
  fc.oneof(
    fc.integer({ min: 0, max: 1440 }), // valid
    fc.integer({ min: 1441, max: 5000 }), // out of range → dropped
    fc.integer({ min: -200, max: -1 }), // negative → dropped
    fc.integer({ min: 0, max: 1440 }).map((n) => n + 0.5), // non-integer → dropped
  ),
  { nil: undefined },
);

const diningItemArb: fc.Arbitrary<RawDining> = fc
  .tuple(partySizeArb, waitTimeArb)
  .map(([partySize, waitTime]) => buildDining(partySize, waitTime));

interface Scenario {
  readonly day: ParkDay;
  readonly showtimes: readonly RawShowtime[];
  readonly operatingHours: readonly RawHours[];
  /** `undefined` models a missing list; `[]` models an empty list. */
  readonly dining: readonly RawDining[] | undefined;
}

const scenarioArb: fc.Arbitrary<Scenario> = parkDayArb.chain((day) =>
  fc.record({
    day: fc.constant(day),
    showtimes: fc.array(showtimeArb(day), { maxLength: 6 }),
    operatingHours: fc.array(hoursArb(day), { maxLength: 4 }),
    dining: fc.option(fc.array(diningItemArb, { maxLength: 6 }), { nil: undefined }),
  }),
);

// ---------------------------------------------------------------------------
// Expectation helpers (mirror the documented keep-rules)
// ---------------------------------------------------------------------------

const isInteger = (value: unknown): boolean =>
  typeof value === 'number' && Number.isInteger(value);

const isValidMinutes = (value: unknown): boolean =>
  isInteger(value) && (value as number) >= 0 && (value as number) <= 1440;

// ---------------------------------------------------------------------------
// Property 5
// ---------------------------------------------------------------------------

describe('projectLiveDetail — Property 5: showtimes, hours, and dining cardinality', () => {
  it('preserves the structure and cardinality of showtimes, hours, and dining', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const ctx: ProjectionContext = {
          parkTimeZone: WDW_TIME_ZONE,
          now: nowFor(scenario.day),
        };
        const raw: ThemeParksLiveEntry = {
          showtimes: scenario.showtimes,
          operatingHours: scenario.operatingHours,
          ...(scenario.dining !== undefined
            ? { diningAvailability: scenario.dining }
            : {}),
        };

        const out = projectLiveDetail(raw, ctx);

        // --- Showtimes: one-for-one, start carried, end/type iff present (R1.7) ---
        expect(out.showtimes).toHaveLength(scenario.showtimes.length);
        scenario.showtimes.forEach((item, i) => {
          const proj = out.showtimes[i]!;
          expect(proj.start).toBe(item.startTime);

          const hasEnd = item.endTime !== undefined;
          expect('end' in proj).toBe(hasEnd);
          if (hasEnd) {
            expect(proj.end).toBe(item.endTime);
          }

          const hasType = item.type !== undefined;
          expect('type' in proj).toBe(hasType);
          if (hasType) {
            expect(proj.type).toBe(item.type);
          }
        });

        // --- Operating hours: one-for-one, open/close carried, type iff present ---
        expect(out.operatingHours).toHaveLength(scenario.operatingHours.length);
        scenario.operatingHours.forEach((item, i) => {
          const proj = out.operatingHours[i]!;
          expect(proj.open).toBe(item.startTime);
          expect(proj.close).toBe(item.endTime);

          const hasType = item.type !== undefined;
          expect('type' in proj).toBe(hasType);
          if (hasType) {
            expect(proj.type).toBe(item.type);
          }
        });

        // --- Dining: one entry per item, independent of hours; empty when absent ---
        const rawDining = scenario.dining ?? [];
        if (rawDining.length === 0) {
          // Missing or empty upstream list → empty Dining_Availability (R1.21).
          expect(out.diningAvailability).toEqual([]);
        } else {
          // Exactly one projected entry per upstream item (R1.20).
          expect(out.diningAvailability).toHaveLength(rawDining.length);
          rawDining.forEach((item, i) => {
            const proj = out.diningAvailability[i]!;

            const keepPartySize = isInteger(item.partySize);
            expect('partySize' in proj).toBe(keepPartySize);
            if (keepPartySize) {
              expect(proj.partySize).toBe(item.partySize);
            }

            const keepWait = isValidMinutes(item.waitTime);
            expect('estimatedWaitMinutes' in proj).toBe(keepWait);
            if (keepWait) {
              expect(proj.estimatedWaitMinutes).toBe(item.waitTime);
            }
          });
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
