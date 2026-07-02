// Feature: disney-source-resilience, Property 13: Live projection totality and field mapping
/**
 * Property-based test for the pure ThemeParks.wiki live projection.
 *
 * Validates: Requirements 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9
 *
 * Property 13 (design.md → Correctness Properties → "Live projection totality
 * and field mapping"):
 *
 *   For ANY payload — including garbage, missing, and out-of-range values, and
 *   times that fall both on the current park day and on other days relative to
 *   an injected `now` — `projectThemeParksLive`:
 *
 *     1. Totality (R11.8): NEVER throws, ALWAYS returns a `status` that is one
 *        of the five `OperatingStatus` values, and always returns
 *        `showtimes` / `operatingHours` / `diningAvailability` as arrays.
 *     2. Field mapping (R11.3, R11.5, R11.6, R11.7, R11.8): each field is
 *        populated EXACTLY when its source is present and valid and omitted
 *        otherwise — `status` maps recognized tokens else `Unknown`;
 *        `waitMinutes` / `singleRiderWaitMinutes` present iff the source is an
 *        integer in [0, 1440]; `lightningLane` / `boardingGroup` present iff at
 *        least one sub-field is present and valid; `forecast` omitted when there
 *        is no valid current-day entry.
 *     3. ISO / current-day (R11.4, R11.9): every emitted time
 *        (`forecast.time`, `showtime.start` / `.end`, `operatingHours.open` /
 *        `.close`) is a canonical ISO-8601 instant (=== `new Date(x)
 *        .toISOString()`) AND falls on the current park day relative to `now`
 *        in the Park time zone (verified with `isCurrentParkDay`).
 *
 * Test strategy
 * -------------
 *
 *   - Generate a valid `now` and build every candidate time relative to it, in
 *     a mixture that lands some instants on the same park-local day and some on
 *     other days, so current-day scoping is actually exercised in both
 *     directions.
 *   - Generate every scalar field from a "messy" mixture that spans valid
 *     values, out-of-range values, wrong types, blanks, `NaN` / `Infinity`,
 *     and `null` / `undefined`, so the present-iff-valid mapping is exercised
 *     across the whole input space.
 *   - The park time zone is drawn from a set of valid IANA zones (or omitted so
 *     the payload / default zone applies); the effective zone is recomputed
 *     with the projection's own resolution rule and used as the oracle for the
 *     current-day checks.
 *
 * The oracle predicates below intentionally restate the projection's documented
 * validity rules; the property asserts the projection's OUTPUT agrees with those
 * rules over 100+ random payloads, catching any drift, partiality, or off-day /
 * non-canonical instant leaking through.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { OperatingStatus } from '@dwt/shared';

import {
  projectThemeParksLive,
  WDW_TIME_ZONE,
  type ThemeParksLiveInput,
} from '../themeParksLiveProject.js';
import { isCurrentParkDay } from '../parkTime.js';

const NUM_RUNS = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

const OPERATING_STATUSES: readonly OperatingStatus[] = [
  'Operating',
  'Closed',
  'Down',
  'Refurbishment',
  'Unknown',
];

/** The valid IANA zones we scope with — all real, so `Intl` never throws. */
const VALID_ZONES = [
  WDW_TIME_ZONE,
  'America/Los_Angeles',
  'Asia/Tokyo',
  'Australia/Sydney',
] as const;

// ---------------------------------------------------------------------------
// Oracle predicates — restate the projection's documented validity rules
// ---------------------------------------------------------------------------

function expectedStatus(raw: unknown): OperatingStatus {
  if (typeof raw !== 'string') return 'Unknown';
  const map: Record<string, OperatingStatus> = {
    OPERATING: 'Operating',
    CLOSED: 'Closed',
    DOWN: 'Down',
    REFURBISHMENT: 'Refurbishment',
  };
  return map[raw.trim().toUpperCase()] ?? 'Unknown';
}

function validMinutes(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined;
  if (value < 0 || value > 1440) return undefined;
  return value;
}

function validInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function validNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function validBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  return t.length > 0 ? t : undefined;
}

function isoOracle(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return undefined;
  return new Date(ms).toISOString();
}

function validPercentage(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  if (value < 0 || value > 100) return undefined;
  return value;
}

/** Recompute the effective park time zone exactly as the projection does. */
function resolveTz(input: ThemeParksLiveInput, tzArg: string | undefined): string {
  const timeZone = tzArg ?? WDW_TIME_ZONE;
  if (timeZone === WDW_TIME_ZONE) {
    return nonEmptyString(input.timezone) ?? WDW_TIME_ZONE;
  }
  return timeZone;
}

/** Assert a string is a canonical ISO-8601 instant (round-trips through Date). */
function isCanonicalIso(value: string): boolean {
  return value === new Date(value).toISOString();
}

// ---------------------------------------------------------------------------
// Arbitraries — "messy" scalar mixtures spanning valid / invalid inputs
// ---------------------------------------------------------------------------

const messyMinutes = fc.oneof(
  fc.integer({ min: 0, max: 1440 }), // valid
  fc.integer({ min: -100, max: 3000 }), // maybe out of range
  fc.double(), // floats, incl. non-integers
  fc.constant(Number.NaN),
  fc.constant(Number.POSITIVE_INFINITY),
  fc.constant(undefined),
  fc.constant(null),
  fc.string(),
);

const messyInteger = fc.oneof(
  fc.integer({ min: -50, max: 500 }),
  fc.double(),
  fc.constant(Number.NaN),
  fc.constant(undefined),
  fc.constant(null),
  fc.string(),
);

const messyNumber = fc.oneof(
  fc.double(),
  fc.integer(),
  fc.constant(Number.NaN),
  fc.constant(Number.POSITIVE_INFINITY),
  fc.constant(undefined),
  fc.constant(null),
  fc.constant('12'),
);

const messyBoolean = fc.oneof(
  fc.boolean(),
  fc.constant(undefined),
  fc.constant(null),
  fc.constant('true'),
  fc.integer(),
);

const messyString = fc.oneof(
  fc.string(),
  fc.constant(''),
  fc.constant('   '),
  fc.constant('AVAILABLE'),
  fc.constant(undefined),
  fc.constant(null),
  fc.integer(),
);

const messyStatus = fc.oneof(
  fc.constantFrom(
    'OPERATING',
    'operating',
    ' Closed ',
    'DOWN',
    'refurbishment',
    'REFURBISHMENT',
  ),
  fc.string(),
  fc.constant(''),
  fc.constant(undefined),
  fc.constant(null),
  fc.integer(),
);

/**
 * A candidate time value, built relative to `now`. The mixture yields:
 *   - canonical instants within +/-12h of `now` (often the same park day),
 *   - canonical instants +/-(2..20) days away (a different park day),
 *   - garbage strings and non-strings (dropped by the projection).
 */
function messyTime(now: Date): fc.Arbitrary<unknown> {
  const near = fc
    .integer({ min: -12 * 60 * 60 * 1000, max: 12 * 60 * 60 * 1000 })
    .map((off) => new Date(now.getTime() + off).toISOString());
  const farDay = fc
    .tuple(fc.integer({ min: 2, max: 20 }), fc.constantFrom(-1, 1))
    .map(([d, sign]) => new Date(now.getTime() + sign * d * DAY_MS).toISOString());
  return fc.oneof(
    near,
    near,
    farDay,
    fc.constant('not-a-date'),
    fc.string(),
    fc.constant(''),
    fc.constant(undefined),
    fc.constant(null),
    fc.integer(),
  );
}

function inputArb(now: Date): fc.Arbitrary<ThemeParksLiveInput> {
  const time = messyTime(now);

  const queueWait = fc.oneof(
    fc.record({ waitTime: messyMinutes }),
    fc.constant(null),
    fc.constant(undefined),
  );

  const price = fc.oneof(
    fc.record({ amount: messyNumber, currency: messyString }, { requiredKeys: [] }),
    fc.constant(null),
    fc.constant(undefined),
  );

  const llSource = fc.oneof(
    fc.record(
      {
        available: messyBoolean,
        state: messyString,
        price,
        returnStart: time,
        returnEnd: time,
      },
      { requiredKeys: [] },
    ),
    fc.constant(null),
    fc.constant(undefined),
  );

  const boardingGroup = fc.oneof(
    fc.record(
      {
        available: messyBoolean,
        allocationStatus: messyString,
        state: messyString,
        currentGroupStart: messyInteger,
        currentGroupEnd: messyInteger,
      },
      { requiredKeys: [] },
    ),
    fc.constant(null),
    fc.constant(undefined),
  );

  const queue = fc.oneof(
    fc.record(
      {
        STANDBY: queueWait,
        SINGLE_RIDER: queueWait,
        PAID_RETURN_TIME: llSource,
        RETURN_TIME: llSource,
        BOARDING_GROUP: boardingGroup,
      },
      { requiredKeys: [] },
    ),
    fc.constant(null),
    fc.constant(undefined),
  );

  const forecastEntry = fc.record(
    { time, waitTime: messyMinutes, percentage: fc.oneof(messyMinutes, fc.double()) },
    { requiredKeys: [] },
  );
  const forecast = fc.oneof(
    fc.array(forecastEntry, { maxLength: 6 }),
    fc.constant(undefined),
  );

  const showtimeEntry = fc.record(
    { type: messyString, startTime: time, endTime: time },
    { requiredKeys: [] },
  );
  const showtimes = fc.oneof(
    fc.array(showtimeEntry, { maxLength: 6 }),
    fc.constant(undefined),
  );

  const operatingHoursEntry = fc.record(
    { type: messyString, startTime: time, endTime: time },
    { requiredKeys: [] },
  );
  const operatingHours = fc.oneof(
    fc.array(operatingHoursEntry, { maxLength: 6 }),
    fc.constant(undefined),
  );

  const diningEntry = fc.record(
    { status: messyString, partySize: messyInteger, waitTime: messyMinutes },
    { requiredKeys: [] },
  );
  const diningAvailability = fc.oneof(
    fc.array(diningEntry, { maxLength: 6 }),
    fc.constant(undefined),
  );

  const timezone = fc.oneof(
    fc.constant(undefined),
    fc.constant(''),
    fc.constantFrom(...VALID_ZONES),
  );

  return fc.record(
    {
      status: messyStatus,
      lastUpdated: time,
      queue,
      paidReturnWindow: llSource,
      showtimes,
      operatingHours,
      forecast,
      diningAvailability,
      timezone,
    },
    { requiredKeys: [] },
  ) as fc.Arbitrary<ThemeParksLiveInput>;
}

const scenarioArb = fc
  .date({ min: new Date('2021-01-01T00:00:00Z'), max: new Date('2029-12-31T00:00:00Z') })
  .chain((now) =>
    fc.record({
      now: fc.constant(now),
      tzArg: fc.oneof(fc.constant(undefined), fc.constantFrom(...VALID_ZONES)),
      input: inputArb(now),
    }),
  );

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('projectThemeParksLive — Property 13: totality and field mapping', () => {
  it('is total, maps every field exactly when valid, and emits canonical current-day instants', () => {
    fc.assert(
      fc.property(scenarioArb, ({ now, tzArg, input }) => {
        // (1) Totality: must never throw.
        const result = projectThemeParksLive(input, now, tzArg);
        const tz = resolveTz(input, tzArg);

        // (1) Always a valid status, always arrays for the three list fields.
        expect(OPERATING_STATUSES).toContain(result.status);
        expect(Array.isArray(result.showtimes)).toBe(true);
        expect(Array.isArray(result.operatingHours)).toBe(true);
        expect(Array.isArray(result.diningAvailability)).toBe(true);

        // (2) status maps recognized tokens else Unknown.
        expect(result.status).toBe(expectedStatus(input.status));

        // (2) wait minutes present iff integer in [0, 1440].
        const expWait = validMinutes(input.queue?.STANDBY?.waitTime);
        expect(result.waitMinutes).toBe(expWait);
        const expSingle = validMinutes(input.queue?.SINGLE_RIDER?.waitTime);
        expect(result.singleRiderWaitMinutes).toBe(expSingle);

        // (2) Lightning Lane present iff at least one valid sub-field.
        const llSrc =
          input.queue?.PAID_RETURN_TIME ??
          input.queue?.RETURN_TIME ??
          input.paidReturnWindow ??
          undefined;
        if (llSrc === undefined || llSrc === null) {
          expect(result.lightningLane).toBeUndefined();
        } else {
          const available = validBoolean(llSrc.available);
          const state = nonEmptyString(llSrc.state);
          const returnStart = isoOracle(llSrc.returnStart);
          const returnEnd = isoOracle(llSrc.returnEnd);
          const amount = validNumber(llSrc.price?.amount);
          const currency = nonEmptyString(llSrc.price?.currency);
          const price =
            amount !== undefined && currency !== undefined
              ? { amount, currency }
              : undefined;
          const anyValid =
            available !== undefined ||
            state !== undefined ||
            returnStart !== undefined ||
            returnEnd !== undefined ||
            price !== undefined;
          if (!anyValid) {
            expect(result.lightningLane).toBeUndefined();
          } else {
            expect(result.lightningLane).toBeDefined();
            const ll = result.lightningLane!;
            expect(ll.available).toBe(available);
            expect(ll.state).toBe(state);
            expect(ll.returnStart).toBe(returnStart);
            expect(ll.returnEnd).toBe(returnEnd);
            expect(ll.price).toEqual(price);
            if (ll.returnStart !== undefined) {
              expect(isCanonicalIso(ll.returnStart)).toBe(true);
            }
            if (ll.returnEnd !== undefined) {
              expect(isCanonicalIso(ll.returnEnd)).toBe(true);
            }
          }
        }

        // (2) Boarding group present iff at least one valid sub-field.
        const bgSrc = input.queue?.BOARDING_GROUP ?? undefined;
        if (bgSrc === undefined || bgSrc === null) {
          expect(result.boardingGroup).toBeUndefined();
        } else {
          const available = validBoolean(bgSrc.available);
          const start = validInteger(bgSrc.currentGroupStart);
          const end = validInteger(bgSrc.currentGroupEnd);
          const state = nonEmptyString(bgSrc.allocationStatus) ?? nonEmptyString(bgSrc.state);
          const anyValid =
            available !== undefined ||
            start !== undefined ||
            end !== undefined ||
            state !== undefined;
          if (!anyValid) {
            expect(result.boardingGroup).toBeUndefined();
          } else {
            expect(result.boardingGroup).toBeDefined();
            const bg = result.boardingGroup!;
            expect(bg.available).toBe(available);
            expect(bg.currentGroupStart).toBe(start);
            expect(bg.currentGroupEnd).toBe(end);
            expect(bg.state).toBe(state);
          }
        }

        // (2 + 3) Forecast: present iff >= 1 valid current-day entry, sorted,
        // every entry canonical-ISO on the current park day with in-range fields.
        const expectedForecast = (Array.isArray(input.forecast) ? input.forecast : [])
          .map((e) => ({
            time: isoOracle(e?.time),
            waitMinutes: validMinutes(e?.waitTime),
            percentage: validPercentage(e?.percentage),
          }))
          .filter(
            (e): e is { time: string; waitMinutes: number; percentage: number } =>
              e.time !== undefined &&
              e.waitMinutes !== undefined &&
              e.percentage !== undefined &&
              isCurrentParkDay(new Date(e.time), now, tz),
          )
          .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

        if (expectedForecast.length === 0) {
          expect(result.forecast).toBeUndefined();
        } else {
          expect(result.forecast).toBeDefined();
          const forecast = result.forecast!;
          expect(forecast.length).toBe(expectedForecast.length);
          for (let i = 0; i < forecast.length; i += 1) {
            const entry = forecast[i]!;
            expect(isCanonicalIso(entry.time)).toBe(true);
            expect(isCurrentParkDay(new Date(entry.time), now, tz)).toBe(true);
            expect(Number.isInteger(entry.waitMinutes)).toBe(true);
            expect(entry.waitMinutes).toBeGreaterThanOrEqual(0);
            expect(entry.waitMinutes).toBeLessThanOrEqual(1440);
            expect(entry.percentage).toBeGreaterThanOrEqual(0);
            expect(entry.percentage).toBeLessThanOrEqual(100);
            if (i > 0) {
              expect(new Date(entry.time).getTime()).toBeGreaterThanOrEqual(
                new Date(forecast[i - 1]!.time).getTime(),
              );
            }
          }
        }

        // (2 + 3) Showtimes: one per current-day parseable startTime; every
        // emitted instant is canonical ISO on the current park day.
        const expectedShowtimeCount = (Array.isArray(input.showtimes) ? input.showtimes : [])
          .map((e) => isoOracle(e?.startTime))
          .filter((s): s is string => s !== undefined && isCurrentParkDay(new Date(s), now, tz))
          .length;
        expect(result.showtimes.length).toBe(expectedShowtimeCount);
        for (const st of result.showtimes) {
          expect(isCanonicalIso(st.start)).toBe(true);
          expect(isCurrentParkDay(new Date(st.start), now, tz)).toBe(true);
          if (st.end !== undefined) {
            expect(isCanonicalIso(st.end)).toBe(true);
          }
        }

        // (2 + 3) Operating hours: one per entry with current-day open + close;
        // both emitted instants are canonical ISO, open on the current park day.
        const expectedHoursCount = (Array.isArray(input.operatingHours) ? input.operatingHours : [])
          .map((e) => ({ open: isoOracle(e?.startTime), close: isoOracle(e?.endTime) }))
          .filter(
            (e): e is { open: string; close: string } =>
              e.open !== undefined &&
              e.close !== undefined &&
              isCurrentParkDay(new Date(e.open), now, tz),
          )
          .length;
        expect(result.operatingHours.length).toBe(expectedHoursCount);
        for (const oh of result.operatingHours) {
          expect(isCanonicalIso(oh.open)).toBe(true);
          expect(isCanonicalIso(oh.close)).toBe(true);
          expect(isCurrentParkDay(new Date(oh.open), now, tz)).toBe(true);
        }

        // (2) Dining availability: one entry per upstream entry, each sub-field
        // carried only when present and valid.
        const diningInput = Array.isArray(input.diningAvailability) ? input.diningAvailability : [];
        expect(result.diningAvailability.length).toBe(diningInput.length);
        for (let i = 0; i < diningInput.length; i += 1) {
          const raw = diningInput[i]!;
          const out = result.diningAvailability[i]!;
          expect(out.status).toBe(nonEmptyString(raw?.status));
          expect(out.partySize).toBe(validInteger(raw?.partySize));
          expect(out.estimatedWaitMinutes).toBe(validMinutes(raw?.waitTime));
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
