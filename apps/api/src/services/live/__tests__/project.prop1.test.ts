// Feature: experience-live-details, Property 1: Projection carries exactly the present, valid fields
/**
 * Property-based test for `projectLiveDetail` — Property 1.
 *
 * Kept in its own file (one property per file) so concurrent authoring of the
 * sibling projection properties never clobbers a shared file.
 *
 *   - Property 1: Projection carries exactly the present, valid fields
 *
 * Validates: Requirements 1.2, 1.10, 1.18, 1.19, 1.22
 *
 * For any raw upstream live entry, the projected `Live_Detail` carries each
 * optional field — `singleRiderWaitMinutes`, `returnWindow`, `paidReturnWindow`,
 * `boardingGroup`, `forecast`, each `showtime.type`, each `operatingHours.type`,
 * the `diningAvailability` entries, and `upstreamLastUpdated` — **if and only
 * if** that field is present and valid in the input, and never fabricates a
 * field that was absent.
 *
 * Day scoping: showtimes and operating hours are filtered to the current Park
 * day via the projection context, so the generators below place upstream
 * timestamps at "mid-day" UTC hours [13:00, 22:59] on the same calendar date as
 * `ctx.now`. Those hours map to ~08:00-19:00 US-Eastern in both EST (UTC-5) and
 * EDT (UTC-4), so every generated instant reliably lands on the same Park-local
 * day as `now` and survives the current-day filter. That isolates the
 * per-entry `type` carry-iff-present rule from the day-scoping logic.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { projectLiveDetail, WDW_TIME_ZONE, type ProjectionContext } from '../project.js';
import type { ThemeParksLiveEntry } from '../themeparksLive.js';

const NUM_RUNS = 200;
const MAX_MINUTES = 1440;

// ---------------------------------------------------------------------------
// Raw sub-shapes (so generated inputs stay typed to the upstream wire shape)
// ---------------------------------------------------------------------------

type RawQueue = NonNullable<ThemeParksLiveEntry['queue']>;
type RawShowtime = NonNullable<ThemeParksLiveEntry['showtimes']>[number];
type RawHours = NonNullable<ThemeParksLiveEntry['operatingHours']>[number];
type RawDining = NonNullable<ThemeParksLiveEntry['diningAvailability']>[number];
type RawForecast = NonNullable<ThemeParksLiveEntry['forecast']>;

// ---------------------------------------------------------------------------
// Oracles — mirror the documented keep-rules in project.ts
// ---------------------------------------------------------------------------

const RETURN_STATES = new Set(['AVAILABLE', 'TEMP_FULL', 'FINISHED']);
const ALLOCATIONS = new Set(['AVAILABLE', 'PAUSED', 'CLOSED']);

const isInteger = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v);

const isValidMinutes = (v: unknown): boolean =>
  isInteger(v) && (v as number) >= 0 && (v as number) <= MAX_MINUTES;

const isParseableInstant = (v: unknown): boolean =>
  typeof v === 'string' && v.length > 0 && !Number.isNaN(Date.parse(v));

const isRecognizedReturnState = (v: unknown): boolean =>
  typeof v === 'string' && RETURN_STATES.has(v.toUpperCase());

const isRecognizedAllocation = (v: unknown): boolean =>
  typeof v === 'string' && ALLOCATIONS.has(v.toUpperCase());

// ---------------------------------------------------------------------------
// Park-day / instant generators
// ---------------------------------------------------------------------------

interface ParkDay {
  readonly year: number;
  readonly month: number; // 0-based
  readonly day: number;
}

const parkDayArb: fc.Arbitrary<ParkDay> = fc.record({
  year: fc.integer({ min: 2023, max: 2030 }),
  month: fc.integer({ min: 0, max: 11 }),
  day: fc.integer({ min: 1, max: 28 }),
});

/** A UTC instant at a mid-day hour on `day` that always lands on `day` Park-local. */
function safeInstantArb(day: ParkDay): fc.Arbitrary<string> {
  return fc
    .record({ hour: fc.integer({ min: 13, max: 22 }), minute: fc.integer({ min: 0, max: 59 }) })
    .map(({ hour, minute }) =>
      new Date(Date.UTC(day.year, day.month, day.day, hour, minute, 0)).toISOString(),
    );
}

function nowFor(day: ParkDay): Date {
  return new Date(Date.UTC(day.year, day.month, day.day, 18, 0, 0));
}

// ---------------------------------------------------------------------------
// Candidate generators that span the present-valid / present-invalid / absent
// space for each optional field.
// ---------------------------------------------------------------------------

/** Minute value: valid in-range, invalid (out of range / non-integer), or absent. */
const minuteCandidate: fc.Arbitrary<number | undefined> = fc.oneof(
  fc.integer({ min: 0, max: MAX_MINUTES }), // valid
  fc.constantFrom(0, MAX_MINUTES), // boundaries
  fc.integer({ min: MAX_MINUTES + 1, max: 10_000 }), // out of range high
  fc.integer({ min: -5000, max: -1 }), // negative
  fc.integer({ min: 0, max: MAX_MINUTES }).map((n) => n + 0.5), // non-integer
  fc.constant(undefined), // absent
);

/** Optional type label: a non-empty string, the empty string, or absent. */
const typeCandidate: fc.Arbitrary<string | undefined> = fc.option(fc.string(), { nil: undefined });

/** A state token that is sometimes recognized, sometimes not, sometimes absent. */
const returnStateCandidate: fc.Arbitrary<string | undefined> = fc.oneof(
  fc.constantFrom('AVAILABLE', 'TEMP_FULL', 'FINISHED', 'available', 'temp_full'),
  fc.constantFrom('SOMETHING_ELSE', 'PAUSED', ''),
  fc.constant(undefined),
);

const allocationCandidate: fc.Arbitrary<string | undefined> = fc.oneof(
  fc.constantFrom('AVAILABLE', 'PAUSED', 'CLOSED', 'available', 'paused'),
  fc.constantFrom('TEMP_FULL', 'NOPE', ''),
  fc.constant(undefined),
);

// ---------------------------------------------------------------------------
// Field scenario: an "include this field?" flag combined with raw content.
// Each builder returns the raw fragment plus whether the projection should
// carry the field (the oracle expectation).
// ---------------------------------------------------------------------------

interface Scenario {
  readonly day: ParkDay;
  readonly raw: ThemeParksLiveEntry;
  readonly expect: {
    readonly singleRider: boolean;
    readonly returnWindow: boolean;
    readonly paidReturnWindow: boolean;
    readonly boardingGroup: boolean;
    readonly forecast: boolean;
    readonly upstreamLastUpdated: boolean;
    /** Per-entry showtime type presence, in input order. */
    readonly showtimeTypes: readonly boolean[];
    /** Per-entry operating-hours type presence, in input order. */
    readonly hoursTypes: readonly boolean[];
    /** Per-entry dining presence flags. */
    readonly dining: readonly { partySize: boolean; wait: boolean }[];
    /** undefined => no diningAvailability list; otherwise expected length. */
    readonly diningLength: number;
  };
}

function buildShowtimeArb(day: ParkDay): fc.Arbitrary<{ raw: RawShowtime; hasType: boolean }> {
  return fc
    .tuple(safeInstantArb(day), fc.option(safeInstantArb(day), { nil: undefined }), typeCandidate)
    .map(([startTime, endTime, type]) => ({
      raw: {
        startTime,
        ...(endTime !== undefined ? { endTime } : {}),
        ...(type !== undefined ? { type } : {}),
      } as RawShowtime,
      hasType: type !== undefined,
    }));
}

function buildHoursArb(day: ParkDay): fc.Arbitrary<{ raw: RawHours; hasType: boolean }> {
  return fc
    .tuple(safeInstantArb(day), safeInstantArb(day), typeCandidate)
    .map(([startTime, endTime, type]) => ({
      raw: {
        startTime,
        endTime,
        ...(type !== undefined ? { type } : {}),
      } as RawHours,
      hasType: type !== undefined,
    }));
}

const diningItemArb: fc.Arbitrary<{ raw: RawDining; partySize: boolean; wait: boolean }> = fc
  .tuple(
    fc.option(fc.oneof(fc.integer({ min: 1, max: 12 }), fc.double({ min: 1, max: 12 }).map((n) => (Number.isInteger(n) ? n + 0.5 : n))), { nil: undefined }),
    minuteCandidate,
  )
  .map(([partySize, waitTime]) => ({
    raw: {
      ...(partySize !== undefined ? { partySize } : {}),
      ...(waitTime !== undefined ? { waitTime } : {}),
    } as RawDining,
    partySize: isInteger(partySize),
    wait: isValidMinutes(waitTime),
  }));

/** Forecast list: either all-valid (carried) or with at least one bad entry (dropped), or absent. */
function forecastCandidateArb(day: ParkDay): fc.Arbitrary<{ raw: RawForecast | undefined; keep: boolean }> {
  const validEntry = fc.record({
    time: safeInstantArb(day),
    waitTime: fc.integer({ min: 0, max: MAX_MINUTES }),
    percentage: fc.integer({ min: 0, max: 100 }),
  });
  const badEntry = fc.record({
    time: fc.constantFrom('not-a-date', ''),
    waitTime: fc.integer({ min: 0, max: MAX_MINUTES }),
    percentage: fc.integer({ min: 0, max: 100 }),
  });
  const allValid = fc
    .array(validEntry, { minLength: 1, maxLength: 5 })
    .map((arr) => ({ raw: arr as unknown as RawForecast, keep: true }));
  const withBad = fc
    .tuple(fc.array(validEntry, { maxLength: 3 }), badEntry, fc.array(validEntry, { maxLength: 3 }))
    .map(([a, bad, b]) => ({ raw: [...a, bad, ...b] as unknown as RawForecast, keep: false }));
  const absent = fc.constant({ raw: undefined, keep: false });
  return fc.oneof(allValid, withBad, absent);
}

const scenarioArb: fc.Arbitrary<Scenario> = parkDayArb.chain((day) =>
  fc
    .record({
      singleRider: minuteCandidate,
      returnState: returnStateCandidate,
      paidState: returnStateCandidate,
      // Price is complete or incomplete to exercise the paid carry rule.
      paidPriceComplete: fc.boolean(),
      allocation: allocationCandidate,
      forecast: forecastCandidateArb(day),
      lastUpdated: fc.oneof(
        safeInstantArb(day),
        fc.constantFrom('garbage', ''),
        fc.constant(undefined),
      ),
      showtimes: fc.array(buildShowtimeArb(day), { maxLength: 5 }),
      hours: fc.array(buildHoursArb(day), { maxLength: 4 }),
      // undefined models a missing list; otherwise an explicit (possibly empty) list.
      dining: fc.option(fc.array(diningItemArb, { maxLength: 5 }), { nil: undefined }),
    })
    .map((s) => {
      const queue: {
        SINGLE_RIDER?: { waitTime?: number };
        RETURN_TIME?: RawQueue['RETURN_TIME'];
        PAID_RETURN_TIME?: RawQueue['PAID_RETURN_TIME'];
        BOARDING_GROUP?: RawQueue['BOARDING_GROUP'];
      } = {};

      if (s.singleRider !== undefined) {
        queue.SINGLE_RIDER = { waitTime: s.singleRider };
      }
      if (s.returnState !== undefined) {
        queue.RETURN_TIME = { state: s.returnState };
      }
      if (s.paidState !== undefined) {
        queue.PAID_RETURN_TIME = {
          state: s.paidState,
          ...(s.paidPriceComplete
            ? { price: { amount: 1500, currency: 'USD', formatted: '$15.00' } }
            : { price: { amount: 1500 } }),
        };
      }
      if (s.allocation !== undefined) {
        queue.BOARDING_GROUP = { allocationStatus: s.allocation };
      }

      const raw: ThemeParksLiveEntry = {
        ...(Object.keys(queue).length > 0 ? { queue: queue as RawQueue } : {}),
        ...(s.forecast.raw !== undefined ? { forecast: s.forecast.raw } : {}),
        ...(s.lastUpdated !== undefined ? { lastUpdated: s.lastUpdated } : {}),
        showtimes: s.showtimes.map((x) => x.raw),
        operatingHours: s.hours.map((x) => x.raw),
        ...(s.dining !== undefined ? { diningAvailability: s.dining.map((x) => x.raw) } : {}),
      };

      const paidPresent =
        s.paidState !== undefined && isRecognizedReturnState(s.paidState) && s.paidPriceComplete;

      return {
        day,
        raw,
        expect: {
          singleRider: isValidMinutes(s.singleRider),
          returnWindow: s.returnState !== undefined && isRecognizedReturnState(s.returnState),
          paidReturnWindow: paidPresent,
          boardingGroup: s.allocation !== undefined && isRecognizedAllocation(s.allocation),
          forecast: s.forecast.keep,
          upstreamLastUpdated: isParseableInstant(s.lastUpdated),
          showtimeTypes: s.showtimes.map((x) => x.hasType),
          hoursTypes: s.hours.map((x) => x.hasType),
          dining: s.dining?.map((x) => ({ partySize: x.partySize, wait: x.wait })) ?? [],
          diningLength: s.dining?.length ?? 0,
        },
      } satisfies Scenario;
    }),
);

// ===========================================================================
// Property 1
// ===========================================================================

describe('projectLiveDetail — Property 1: carries exactly the present, valid fields', () => {
  it('carries each optional field iff present and valid, and never fabricates an absent field', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const ctx: ProjectionContext = {
          parkTimeZone: WDW_TIME_ZONE,
          now: nowFor(scenario.day),
        };

        const out = projectLiveDetail(scenario.raw, ctx);
        const e = scenario.expect;

        // --- Scalar / object optional fields: carry-iff-present-and-valid ---
        expect('singleRiderWaitMinutes' in out).toBe(e.singleRider);
        expect('returnWindow' in out).toBe(e.returnWindow);
        expect('paidReturnWindow' in out).toBe(e.paidReturnWindow);
        expect('boardingGroup' in out).toBe(e.boardingGroup);
        expect('forecast' in out).toBe(e.forecast);
        expect('upstreamLastUpdated' in out).toBe(e.upstreamLastUpdated);

        // When carried, the paid return window must include a complete price.
        if (e.paidReturnWindow) {
          expect(out.paidReturnWindow?.price).toEqual({
            amount: 1500,
            currency: 'USD',
            formatted: '$15.00',
          });
        }

        // --- Per-showtime type: carried iff present (R1.18) ---
        expect(out.showtimes).toHaveLength(e.showtimeTypes.length);
        e.showtimeTypes.forEach((hasType, i) => {
          expect('type' in out.showtimes[i]!).toBe(hasType);
        });

        // --- Per-operating-hours type: carried iff present (R1.19) ---
        expect(out.operatingHours).toHaveLength(e.hoursTypes.length);
        e.hoursTypes.forEach((hasType, i) => {
          expect('type' in out.operatingHours[i]!).toBe(hasType);
        });

        // --- Dining entries: one per item, fields carried iff present/valid (R1.10) ---
        expect(out.diningAvailability).toHaveLength(e.diningLength);
        e.dining.forEach((flags, i) => {
          const proj = out.diningAvailability[i]!;
          expect('partySize' in proj).toBe(flags.partySize);
          expect('estimatedWaitMinutes' in proj).toBe(flags.wait);
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
