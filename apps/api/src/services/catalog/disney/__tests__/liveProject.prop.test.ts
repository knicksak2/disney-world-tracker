// Feature: disney-facilities-catalog-source, Property 19: The live projection carries present valid fields, defaults status, and excludes out-of-scope data
/**
 * Property-based test for `projectLiveDetail` (the Disney-sourced live
 * projection pure core, `services/catalog/disney/liveProject.ts`).
 *
 * ---------------------------------------------------------------------------
 * Property 19: The live projection carries present valid fields, defaults
 * status, and excludes out-of-scope data.
 *
 * Validates: Requirements 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 15.4, 15.5, 15.6
 *
 * For any combination of Status, Dining-Status, Forecast, and Schedule
 * documents, the projected `LiveDetailDTO`:
 *
 *   - always carries `status`, mapped from the recognized (case-insensitive)
 *     Status token and defaulting to `Unknown` when absent or unrecognized
 *     (R9.2, R9.6);
 *   - carries standby `waitMinutes` / `singleRiderWaitMinutes` exactly when the
 *     Status doc gives a whole number in [0, 1440], and omits them otherwise
 *     (R9.2, R9.6);
 *   - carries `forecast` as an ordered series exactly when the Forecast doc is
 *     present AND every entry parses into
 *     `{ time, waitMinutes in [0,1440], percentage in [0,100] }`, and degrades
 *     the whole forecast to absent when it is missing or any entry is
 *     unparseable — while every other field is still projected (R9.4, R9.6);
 *   - carries one `diningAvailability` entry per upstream party-size entry,
 *     each with `status` / `partySize` / `estimatedWaitMinutes` iff present and
 *     valid, and an empty array when the Dining-Status doc is absent (R9.3);
 *   - carries only current-Park-day `showtimes` and `operatingHours`, split by
 *     schedule type, with times expressed as canonical ISO-8601 instants
 *     (R9.5, R9.8);
 *   - NEVER emits a Lightning Lane return window, paid return window,
 *     boarding-group / virtual-queue field, or an Individual Lightning Lane
 *     price — the DTO's top-level keys are a subset of the allowed set
 *     (R9.7, R15.4, R15.5, R15.6).
 *
 * Current-day scoping is exercised by generating schedule instants that fall on
 * the same Park day as `ctx.now` (mid-day UTC hours, which land in daytime
 * US-Eastern in both EST and EDT), on a clearly different day, and as
 * unparseable strings. The expected outcome is computed with reference helpers
 * that mirror the projection's documented keep-rules exactly, plus the shared
 * `isCurrentParkDay` helper (which `parkTime.ts` tests cover directly), so this
 * property isolates the projection's carry/omit/split behaviour.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { isCurrentParkDay } from '../../../live/parkTime.js';
import {
  projectLiveDetail,
  WDW_TIME_ZONE,
  type ProjectionContext,
  type DiningStatusDoc,
  type DiningStatusEntry,
  type ForecastDoc,
  type ForecastDocEntry,
  type LiveProjectionInput,
  type ScheduleDoc,
  type ScheduleEntry,
  type StatusDoc,
} from '../liveProject.js';

const NUM_RUNS = 200;

// ---------------------------------------------------------------------------
// Reference helpers — verbatim mirrors of the projection's documented rules
// ---------------------------------------------------------------------------

const STATUS_BY_TOKEN: Readonly<Record<string, string>> = {
  OPERATING: 'Operating',
  CLOSED: 'Closed',
  DOWN: 'Down',
  REFURBISHMENT: 'Refurbishment',
};

const OPERATING_HOURS_TYPE_TOKENS: ReadonlySet<string> = new Set([
  'OPERATING',
  'EXTRA_MAGIC_HOURS',
  'EXTRA_MAGIC_HOUR',
  'EARLY_ENTRY',
  'EARLY_PARK_ENTRY',
  'EXTENDED_EVENING',
  'EXTENDED_EVENING_HOURS',
  'SPECIAL_TICKETED_EVENT',
]);

function mapStatus(raw: string | undefined): string {
  if (typeof raw !== 'string') {
    return 'Unknown';
  }
  return STATUS_BY_TOKEN[raw.toUpperCase()] ?? 'Unknown';
}

function validMinutes(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return undefined;
  }
  if (value < 0 || value > 1440) {
    return undefined;
  }
  return value;
}

function validInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toIsoInstant(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    return undefined;
  }
  return new Date(ms).toISOString();
}

function normalizeScheduleType(type: string): string {
  return type.trim().toUpperCase().replace(/[\s-]+/g, '_');
}

function isOperatingHoursEntry(entry: ScheduleEntry): boolean {
  const type = nonEmptyString(entry.type);
  if (type === undefined) {
    return false;
  }
  return OPERATING_HOURS_TYPE_TOKENS.has(normalizeScheduleType(type));
}

function validPercentage(value: unknown): boolean {
  return (
    typeof value === 'number' && !Number.isNaN(value) && value >= 0 && value <= 100
  );
}

/** Canonical ISO-8601 UTC instant (Z-suffixed), as `toISOString` emits. */
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

/** The complete set of top-level keys the DTO is ever allowed to carry. */
const ALLOWED_KEYS: ReadonlySet<string> = new Set([
  'status',
  'waitMinutes',
  'singleRiderWaitMinutes',
  'forecast',
  'showtimes',
  'operatingHours',
  'diningAvailability',
  'upstreamLastUpdated',
]);

// ---------------------------------------------------------------------------
// Park-day / instant generators
// ---------------------------------------------------------------------------

interface ParkDay {
  readonly year: number;
  readonly month: number; // 0-based
  readonly day: number;
}

/** A calendar date; days capped at 28 to avoid month-length edge cases. */
const parkDayArb: fc.Arbitrary<ParkDay> = fc.record({
  year: fc.integer({ min: 2023, max: 2030 }),
  month: fc.integer({ min: 0, max: 11 }),
  day: fc.integer({ min: 1, max: 28 }),
});

/** The projection clock: a fixed mid-day instant on the Park day. */
function nowFor(day: ParkDay): Date {
  return new Date(Date.UTC(day.year, day.month, day.day, 18, 0, 0));
}

/**
 * A UTC instant at a mid-day hour on `day`. Hours in [13, 22] UTC map to
 * ~08:00-19:00 US-Eastern on the same calendar date in both EST and EDT, so the
 * instant reliably falls on `day` Park-local — surviving current-day scoping.
 */
function onDayInstantArb(day: ParkDay): fc.Arbitrary<string> {
  return fc
    .record({ hour: fc.integer({ min: 13, max: 22 }), minute: fc.integer({ min: 0, max: 59 }) })
    .map(({ hour, minute }) =>
      new Date(Date.UTC(day.year, day.month, day.day, hour, minute, 0)).toISOString(),
    );
}

/** A parseable instant on a clearly different calendar day (a year later). */
function offDayInstantArb(day: ParkDay): fc.Arbitrary<string> {
  return fc
    .integer({ min: 0, max: 23 })
    .map((hour) =>
      new Date(Date.UTC(day.year + 1, day.month, day.day, hour, 30, 0)).toISOString(),
    );
}

/** Any parseable ISO instant (not day-scoped), for forecast/last-update. */
const anyInstantArb: fc.Arbitrary<string> = fc
  .date({ min: new Date('2020-01-01T00:00:00.000Z'), max: new Date('2035-01-01T00:00:00.000Z') })
  .map((d) => d.toISOString());

/** Strings that never parse into a Date (plus the empty string). */
const unparseableArb: fc.Arbitrary<string> = fc.constantFrom(
  '',
  'not-a-date',
  'tomorrow',
  'soon',
  'xyz',
);

// ---------------------------------------------------------------------------
// Numeric field generators (valid / out-of-range / non-integer / absent)
// ---------------------------------------------------------------------------

const minutesFieldArb: fc.Arbitrary<number | undefined> = fc.option(
  fc.oneof(
    fc.integer({ min: 0, max: 1440 }), // valid → kept
    fc.integer({ min: 1441, max: 5000 }), // out of range → dropped
    fc.integer({ min: -500, max: -1 }), // negative → dropped
    fc.integer({ min: 0, max: 1440 }).map((n) => n + 0.5), // non-integer → dropped
  ),
  { nil: undefined },
);

const partySizeFieldArb: fc.Arbitrary<number | undefined> = fc.option(
  fc.oneof(
    fc.integer({ min: 1, max: 12 }), // integer → kept
    fc.integer({ min: -4, max: 0 }), // integer → kept (no range on party size)
    fc.integer({ min: 1, max: 12 }).map((n) => n + 0.5), // non-integer → dropped
  ),
  { nil: undefined },
);

const percentageFieldArb: fc.Arbitrary<number | undefined> = fc.option(
  fc.oneof(
    fc.integer({ min: 0, max: 100 }), // valid
    fc.double({ min: 0, max: 100, noNaN: true }), // valid fractional
    fc.integer({ min: 101, max: 500 }), // out of range → collapses forecast
    fc.integer({ min: -200, max: -1 }), // negative → collapses forecast
  ),
  { nil: undefined },
);

// ---------------------------------------------------------------------------
// String field generators
// ---------------------------------------------------------------------------

const statusFieldArb: fc.Arbitrary<string | undefined> = fc.option(
  fc.oneof(
    fc.constantFrom(
      'Operating',
      'operating',
      'OPERATING',
      'oPeRaTiNg',
      'Closed',
      'closed',
      'CLOSED',
      'Down',
      'down',
      'Refurbishment',
      'REFURBISHMENT',
    ),
    fc.string(), // arbitrary / unrecognized → Unknown
  ),
  { nil: undefined },
);

const diningStatusFieldArb: fc.Arbitrary<string | undefined> = fc.option(
  fc.oneof(
    fc.constantFrom('Available', 'Walk-Up Available', 'Full', '  Available  '),
    fc.constant('   '), // blank → dropped
    fc.string(),
  ),
  { nil: undefined },
);

const scheduleTypeFieldArb: fc.Arbitrary<string | undefined> = fc.option(
  fc.oneof(
    // operating-hours tokens (various spacings / cases)
    fc.constantFrom(
      'Operating',
      'operating',
      'Extra Magic Hours',
      'extra-magic-hours',
      'EARLY_ENTRY',
      'Early Park Entry',
      'Extended Evening',
      'SPECIAL_TICKETED_EVENT',
    ),
    // showtime tokens
    fc.constantFrom('Performance', 'Show', 'First Showing', 'Fireworks', 'Parade'),
    fc.constant('   '), // blank → showtime
    fc.string(),
  ),
  { nil: undefined },
);

// ---------------------------------------------------------------------------
// Raw document builders (conditional keys honour exactOptionalPropertyTypes)
// ---------------------------------------------------------------------------

function buildStatusDoc(
  status: string | undefined,
  waitMinutes: number | undefined,
  singleRiderWaitMinutes: number | undefined,
  lastUpdate: string | undefined,
): StatusDoc {
  return {
    ...(status !== undefined ? { status } : {}),
    ...(waitMinutes !== undefined ? { waitMinutes } : {}),
    ...(singleRiderWaitMinutes !== undefined ? { singleRiderWaitMinutes } : {}),
    ...(lastUpdate !== undefined ? { lastUpdate } : {}),
  };
}

const statusDocArb: fc.Arbitrary<StatusDoc | undefined> = fc.option(
  fc
    .tuple(
      statusFieldArb,
      minutesFieldArb,
      minutesFieldArb,
      fc.option(fc.oneof(anyInstantArb, unparseableArb), { nil: undefined }),
    )
    .map(([status, wait, single, lastUpdate]) =>
      buildStatusDoc(status, wait, single, lastUpdate),
    ),
  { nil: undefined },
);

function buildDiningEntry(
  status: string | undefined,
  partySize: number | undefined,
  estimatedWaitMinutes: number | undefined,
): DiningStatusEntry {
  return {
    ...(status !== undefined ? { status } : {}),
    ...(partySize !== undefined ? { partySize } : {}),
    ...(estimatedWaitMinutes !== undefined ? { estimatedWaitMinutes } : {}),
  };
}

const diningEntryArb: fc.Arbitrary<DiningStatusEntry> = fc
  .tuple(diningStatusFieldArb, partySizeFieldArb, minutesFieldArb)
  .map(([status, partySize, wait]) => buildDiningEntry(status, partySize, wait));

const diningStatusDocArb: fc.Arbitrary<DiningStatusDoc | undefined> = fc.option(
  fc
    .tuple(
      fc.option(fc.array(diningEntryArb, { maxLength: 6 }), { nil: undefined }),
      fc.option(fc.oneof(anyInstantArb, unparseableArb), { nil: undefined }),
    )
    .map(([availability, lastUpdate]): DiningStatusDoc => {
      return {
        ...(availability !== undefined ? { availability } : {}),
        ...(lastUpdate !== undefined ? { lastUpdate } : {}),
      };
    }),
  { nil: undefined },
);

function buildForecastEntry(
  time: string | undefined,
  waitMinutes: number | undefined,
  percentage: number | undefined,
): ForecastDocEntry {
  return {
    ...(time !== undefined ? { time } : {}),
    ...(waitMinutes !== undefined ? { waitMinutes } : {}),
    ...(percentage !== undefined ? { percentage } : {}),
  };
}

const forecastEntryArb: fc.Arbitrary<ForecastDocEntry> = fc
  .tuple(
    fc.option(fc.oneof(anyInstantArb, unparseableArb), { nil: undefined }),
    minutesFieldArb,
    percentageFieldArb,
  )
  .map(([time, wait, pct]) => buildForecastEntry(time, wait, pct));

const forecastDocArb: fc.Arbitrary<ForecastDoc | undefined> = fc.option(
  fc
    .tuple(
      fc.option(fc.array(forecastEntryArb, { maxLength: 6 }), { nil: undefined }),
      fc.option(fc.oneof(anyInstantArb, unparseableArb), { nil: undefined }),
    )
    .map(([forecasts, lastUpdate]): ForecastDoc => {
      return {
        ...(forecasts !== undefined ? { forecasts } : {}),
        ...(lastUpdate !== undefined ? { lastUpdate } : {}),
      };
    }),
  { nil: undefined },
);

function buildScheduleEntry(
  type: string | undefined,
  startTime: string | undefined,
  endTime: string | undefined,
): ScheduleEntry {
  return {
    ...(type !== undefined ? { type } : {}),
    ...(startTime !== undefined ? { startTime } : {}),
    ...(endTime !== undefined ? { endTime } : {}),
  };
}

function scheduleEntryArb(day: ParkDay): fc.Arbitrary<ScheduleEntry> {
  const timeFieldArb = fc.option(
    fc.oneof(onDayInstantArb(day), offDayInstantArb(day), unparseableArb),
    { nil: undefined },
  );
  return fc
    .tuple(scheduleTypeFieldArb, timeFieldArb, timeFieldArb)
    .map(([type, start, end]) => buildScheduleEntry(type, start, end));
}

function scheduleDocsArb(day: ParkDay): fc.Arbitrary<readonly ScheduleDoc[] | undefined> {
  const docArb: fc.Arbitrary<ScheduleDoc> = fc
    .option(fc.array(scheduleEntryArb(day), { maxLength: 5 }), { nil: undefined })
    .map((schedules): ScheduleDoc => (schedules !== undefined ? { schedules } : {}));
  return fc.option(fc.array(docArb, { maxLength: 3 }), { nil: undefined });
}

interface Scenario {
  readonly day: ParkDay;
  readonly input: LiveProjectionInput;
}

const scenarioArb: fc.Arbitrary<Scenario> = parkDayArb.chain((day) =>
  fc
    .tuple(statusDocArb, diningStatusDocArb, forecastDocArb, scheduleDocsArb(day))
    .map(([status, diningStatus, forecast, schedule]): Scenario => {
      const input: LiveProjectionInput = {
        ...(status !== undefined ? { status } : {}),
        ...(diningStatus !== undefined ? { diningStatus } : {}),
        ...(forecast !== undefined ? { forecast } : {}),
        ...(schedule !== undefined ? { schedule } : {}),
      };
      return { day, input };
    }),
);

// ---------------------------------------------------------------------------
// Reference projections (mirror the documented keep/omit/split rules)
// ---------------------------------------------------------------------------

function expectedForecast(
  doc: ForecastDoc | undefined,
): ReadonlyArray<{ time: string; waitMinutes: number; percentage: number }> | undefined {
  if (doc === undefined || !Array.isArray(doc.forecasts)) {
    return undefined;
  }
  const out: Array<{ time: string; waitMinutes: number; percentage: number }> = [];
  for (const raw of doc.forecasts) {
    const time = toIsoInstant(raw?.time);
    const waitMinutes = validMinutes(raw?.waitMinutes);
    const percentage = raw?.percentage;
    if (time === undefined || waitMinutes === undefined || !validPercentage(percentage)) {
      return undefined;
    }
    out.push({ time, waitMinutes, percentage: percentage as number });
  }
  return out;
}

function flattenEntries(docs: readonly ScheduleDoc[] | undefined): readonly ScheduleEntry[] {
  if (!Array.isArray(docs)) {
    return [];
  }
  const entries: ScheduleEntry[] = [];
  for (const doc of docs) {
    if (doc !== undefined && Array.isArray(doc.schedules)) {
      entries.push(...doc.schedules);
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Property 19
// ---------------------------------------------------------------------------

describe('projectLiveDetail — Property 19: present valid fields, default status, no out-of-scope data', () => {
  it('carries present/valid fields, defaults status to Unknown, and never emits out-of-scope fields', () => {
    fc.assert(
      fc.property(scenarioArb, ({ day, input }) => {
        const ctx: ProjectionContext = { parkTimeZone: WDW_TIME_ZONE, now: nowFor(day) };
        const out = projectLiveDetail(input, ctx);

        // --- Out-of-scope exclusion: keys are a subset of the allowed set ----
        // (R9.7, R15.4, R15.5, R15.6) — no returnWindow / paidReturnWindow /
        // boardingGroup / ILL price can ever appear.
        for (const key of Object.keys(out)) {
          expect(ALLOWED_KEYS.has(key)).toBe(true);
        }
        expect('returnWindow' in out).toBe(false);
        expect('paidReturnWindow' in out).toBe(false);
        expect('boardingGroup' in out).toBe(false);

        // --- status: always present, mapped or Unknown (R9.2, R9.6) ----------
        expect(out.status).toBe(mapStatus(input.status?.status));
        expect(['Operating', 'Closed', 'Down', 'Refurbishment', 'Unknown']).toContain(
          out.status,
        );

        // --- waitMinutes / singleRiderWaitMinutes (R9.2, R9.6) ---------------
        const expWait = validMinutes(input.status?.waitMinutes);
        expect('waitMinutes' in out).toBe(expWait !== undefined);
        if (expWait !== undefined) {
          expect(out.waitMinutes).toBe(expWait);
        }

        const expSingle = validMinutes(input.status?.singleRiderWaitMinutes);
        expect('singleRiderWaitMinutes' in out).toBe(expSingle !== undefined);
        if (expSingle !== undefined) {
          expect(out.singleRiderWaitMinutes).toBe(expSingle);
        }

        // --- forecast: degrades atomically; else ordered & bounded (R9.4) ----
        const expForecast = expectedForecast(input.forecast);
        expect('forecast' in out).toBe(expForecast !== undefined);
        if (expForecast !== undefined) {
          expect(out.forecast).toEqual(expForecast);
          for (const entry of out.forecast!) {
            expect(entry.time).toMatch(ISO_UTC_RE);
            expect(entry.waitMinutes).toBeGreaterThanOrEqual(0);
            expect(entry.waitMinutes).toBeLessThanOrEqual(1440);
            expect(entry.percentage).toBeGreaterThanOrEqual(0);
            expect(entry.percentage).toBeLessThanOrEqual(100);
          }
        }

        // --- diningAvailability: one entry per upstream item (R9.3) ----------
        const rawDining = input.diningStatus;
        if (rawDining === undefined || !Array.isArray(rawDining.availability)) {
          expect(out.diningAvailability).toEqual([]);
        } else {
          expect(out.diningAvailability).toHaveLength(rawDining.availability.length);
          rawDining.availability.forEach((item, i) => {
            const proj = out.diningAvailability[i]!;

            const expStatus = nonEmptyString(item.status);
            expect('status' in proj).toBe(expStatus !== undefined);
            if (expStatus !== undefined) {
              expect(proj.status).toBe(expStatus);
            }

            const expParty = validInteger(item.partySize);
            expect('partySize' in proj).toBe(expParty !== undefined);
            if (expParty !== undefined) {
              expect(proj.partySize).toBe(expParty);
            }

            const expEstimated = validMinutes(item.estimatedWaitMinutes);
            expect('estimatedWaitMinutes' in proj).toBe(expEstimated !== undefined);
            if (expEstimated !== undefined) {
              expect(proj.estimatedWaitMinutes).toBe(expEstimated);
            }
          });
        }

        // --- showtimes & operatingHours: current-day, split by type (R9.5) ---
        const entries = flattenEntries(input.schedule);

        const expShowtimes = entries
          .filter((e) => !isOperatingHoursEntry(e))
          .map((e) => {
            const start = toIsoInstant(e.startTime);
            if (start === undefined || !isCurrentParkDay(new Date(start), ctx.now, ctx.parkTimeZone)) {
              return undefined;
            }
            const end = toIsoInstant(e.endTime);
            const type = nonEmptyString(e.type);
            return {
              start,
              ...(end !== undefined ? { end } : {}),
              ...(type !== undefined ? { type } : {}),
            };
          })
          .filter((e): e is { start: string; end?: string; type?: string } => e !== undefined);

        const expHours = entries
          .filter((e) => isOperatingHoursEntry(e))
          .map((e) => {
            const open = toIsoInstant(e.startTime);
            const close = toIsoInstant(e.endTime);
            if (
              open === undefined ||
              close === undefined ||
              !isCurrentParkDay(new Date(open), ctx.now, ctx.parkTimeZone)
            ) {
              return undefined;
            }
            const type = nonEmptyString(e.type);
            return { open, close, ...(type !== undefined ? { type } : {}) };
          })
          .filter((e): e is { open: string; close: string; type?: string } => e !== undefined);

        expect(out.showtimes).toEqual(expShowtimes);
        expect(out.operatingHours).toEqual(expHours);

        // Every emitted schedule time is a canonical ISO-8601 UTC instant (R9.8).
        for (const s of out.showtimes) {
          expect(s.start).toMatch(ISO_UTC_RE);
          if (s.end !== undefined) {
            expect(s.end).toMatch(ISO_UTC_RE);
          }
        }
        for (const h of out.operatingHours) {
          expect(h.open).toMatch(ISO_UTC_RE);
          expect(h.close).toMatch(ISO_UTC_RE);
        }

        // --- upstreamLastUpdated: first present/parseable source, ISO (R9.8) -
        const expLastUpdated =
          toIsoInstant(input.status?.lastUpdate) ??
          toIsoInstant(input.diningStatus?.lastUpdate) ??
          toIsoInstant(input.forecast?.lastUpdate);
        expect('upstreamLastUpdated' in out).toBe(expLastUpdated !== undefined);
        if (expLastUpdated !== undefined) {
          expect(out.upstreamLastUpdated).toBe(expLastUpdated);
          expect(out.upstreamLastUpdated).toMatch(ISO_UTC_RE);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
