// Feature: experience-live-details, Property 6: A bad forecast degrades in isolation; a good forecast preserves order and bounds
/**
 * Property-based test for `projectLiveDetail` — Property 6 (one-property-per-file).
 *
 * ---------------------------------------------------------------------------
 * Property 6: A bad forecast degrades in isolation; a good forecast preserves
 * order and bounds.
 *
 * Validates: Requirements 1.16, 1.17
 *
 * For any upstream live entry:
 *
 *   - If the forecast is missing, or ANY forecast entry cannot be parsed into
 *     `{ time, waitMinutes in [0, 1440], percentage in [0, 100] }`, then the
 *     projected `forecast` is absent — while every OTHER present field
 *     (here: `status` and the standby `waitMinutes`) is still projected
 *     (R1.17, "degrade in isolation").
 *   - Otherwise (every entry parses) the projected `forecast` preserves the
 *     upstream entry order one-for-one, and every projected entry satisfies the
 *     wait bound [0, 1440] and the percentage bound [0, 100] (R1.16).
 *
 * The forecast projection is independent of the Park clock, so `ctx.now` is a
 * fixed instant. Sibling fields (`status`, standby wait) are always generated
 * with values that survive projection, so the "isolation" half of the property
 * can assert they are still present regardless of the forecast outcome.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { projectLiveDetail, WDW_TIME_ZONE, type ProjectionContext } from '../project.js';
import type { ThemeParksLiveEntry } from '../themeparksLive.js';

const NUM_RUNS = 200;

type RawForecastEntry = NonNullable<ThemeParksLiveEntry['forecast']>[number];

// ---------------------------------------------------------------------------
// Sibling fields (always valid → always projected, proving forecast isolation)
// ---------------------------------------------------------------------------

const STATUS_TOKENS = ['OPERATING', 'CLOSED', 'DOWN', 'REFURBISHMENT'] as const;
const STATUS_EXPECTED: Readonly<Record<(typeof STATUS_TOKENS)[number], string>> = {
  OPERATING: 'Operating',
  CLOSED: 'Closed',
  DOWN: 'Down',
  REFURBISHMENT: 'Refurbishment',
};

interface Sibling {
  readonly statusToken: (typeof STATUS_TOKENS)[number];
  readonly standbyWait: number;
}

const siblingArb: fc.Arbitrary<Sibling> = fc.record({
  statusToken: fc.constantFrom(...STATUS_TOKENS),
  standbyWait: fc.integer({ min: 0, max: 1440 }),
});

// ---------------------------------------------------------------------------
// Forecast-entry generators
// ---------------------------------------------------------------------------

/**
 * Build a raw forecast entry with conditional keys so a `undefined` field is
 * genuinely omitted (honouring `exactOptionalPropertyTypes`).
 */
function buildEntry(
  time: string | undefined,
  waitTime: number | undefined,
  percentage: number | undefined,
): RawForecastEntry {
  return {
    ...(time !== undefined ? { time } : {}),
    ...(waitTime !== undefined ? { waitTime } : {}),
    ...(percentage !== undefined ? { percentage } : {}),
  };
}

/**
 * A canonical ISO-8601 UTC instant. Generated from an epoch-ms integer so the
 * projection's `Date`-normalization round-trips to the identical string, which
 * lets the test assert exact `time` equality on the projected entry.
 */
const validTimeArb: fc.Arbitrary<string> = fc
  .integer({ min: Date.UTC(2023, 0, 1), max: Date.UTC(2030, 0, 1) })
  .map((ms) => new Date(ms).toISOString());

const validWaitArb = fc.integer({ min: 0, max: 1440 });
const validPercentageArb = fc.double({ min: 0, max: 100, noNaN: true });

const validEntryArb: fc.Arbitrary<RawForecastEntry> = fc
  .tuple(validTimeArb, validWaitArb, validPercentageArb)
  .map(([time, waitTime, percentage]) => buildEntry(time, waitTime, percentage));

// --- Per-field "broken" generators (each guaranteed to fail its parse rule) ---

const invalidTimeArb = fc.oneof(
  fc.constant<undefined>(undefined), // missing → unparseable
  fc.constant(''), // empty string → unparseable
  fc.constantFrom('not-a-date', '??', '2023-13-99T99:99Z'),
);

const invalidWaitArb = fc.oneof(
  fc.constant<undefined>(undefined), // missing
  fc.integer({ min: 1441, max: 5000 }), // above the 1440 cap
  fc.integer({ min: -500, max: -1 }), // negative
  fc.integer({ min: 0, max: 1440 }).map((n) => n + 0.5), // non-integer
);

const invalidPercentageArb = fc.oneof(
  fc.constant<undefined>(undefined), // missing
  fc.constant(Number.NaN), // NaN
  fc.double({ min: 100.0001, max: 1000, noNaN: true }), // above 100
  fc.double({ min: -1000, max: -0.0001, noNaN: true }), // below 0
);

/** An entry with exactly one field broken (and the other two valid). */
const brokenEntryArb: fc.Arbitrary<RawForecastEntry> = fc.oneof(
  fc
    .tuple(invalidTimeArb, validWaitArb, validPercentageArb)
    .map(([t, w, p]) => buildEntry(t, w, p)),
  fc
    .tuple(validTimeArb, invalidWaitArb, validPercentageArb)
    .map(([t, w, p]) => buildEntry(t, w, p)),
  fc
    .tuple(validTimeArb, validWaitArb, invalidPercentageArb)
    .map(([t, w, p]) => buildEntry(t, w, p)),
);

/** A forecast array that contains at least one broken entry, in any position. */
const badForecastArrayArb: fc.Arbitrary<readonly RawForecastEntry[]> = fc
  .tuple(
    fc.array(validEntryArb, { maxLength: 4 }),
    brokenEntryArb,
    fc.array(validEntryArb, { maxLength: 4 }),
  )
  .map(([pre, broken, post]) => [...pre, broken, ...post]);

// ---------------------------------------------------------------------------
// Scenario union: good vs. bad (missing or bad-array)
// ---------------------------------------------------------------------------

type Scenario =
  | { readonly kind: 'good'; readonly sibling: Sibling; readonly forecast: readonly RawForecastEntry[] }
  | { readonly kind: 'bad-missing'; readonly sibling: Sibling }
  | { readonly kind: 'bad-array'; readonly sibling: Sibling; readonly forecast: readonly RawForecastEntry[] };

const scenarioArb: fc.Arbitrary<Scenario> = fc.oneof(
  fc.record({
    kind: fc.constant('good' as const),
    sibling: siblingArb,
    forecast: fc.array(validEntryArb, { maxLength: 8 }),
  }),
  fc.record({
    kind: fc.constant('bad-missing' as const),
    sibling: siblingArb,
  }),
  fc.record({
    kind: fc.constant('bad-array' as const),
    sibling: siblingArb,
    forecast: badForecastArrayArb,
  }),
);

const CTX: ProjectionContext = {
  parkTimeZone: WDW_TIME_ZONE,
  now: new Date(Date.UTC(2024, 5, 15, 18, 0, 0)),
};

// ---------------------------------------------------------------------------
// Property 6
// ---------------------------------------------------------------------------

describe('projectLiveDetail — Property 6: forecast degrades in isolation; order and bounds preserved', () => {
  it('drops an unparseable/missing forecast while keeping other fields, and preserves order/bounds otherwise', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const { sibling } = scenario;
        const raw: ThemeParksLiveEntry = {
          status: sibling.statusToken,
          queue: { STANDBY: { waitTime: sibling.standbyWait } },
          ...(scenario.kind === 'bad-missing'
            ? {}
            : { forecast: scenario.forecast }),
        };

        const out = projectLiveDetail(raw, CTX);

        // --- Isolation: sibling fields are always projected (R1.17) ---
        expect(out.status).toBe(STATUS_EXPECTED[sibling.statusToken]);
        expect(out.waitMinutes).toBe(sibling.standbyWait);

        if (scenario.kind === 'good') {
          // Every entry parses → forecast present, order preserved, bounds hold.
          expect(out.forecast).toBeDefined();
          expect(out.forecast).toHaveLength(scenario.forecast.length);
          scenario.forecast.forEach((entry, i) => {
            const proj = out.forecast![i]!;
            // Order preserved, values carried verbatim (after ISO normalization).
            expect(proj.time).toBe(entry.time);
            expect(proj.waitMinutes).toBe(entry.waitTime);
            expect(proj.percentage).toBe(entry.percentage);
            // Bounds (R1.16).
            expect(proj.waitMinutes).toBeGreaterThanOrEqual(0);
            expect(proj.waitMinutes).toBeLessThanOrEqual(1440);
            expect(proj.percentage).toBeGreaterThanOrEqual(0);
            expect(proj.percentage).toBeLessThanOrEqual(100);
          });
        } else {
          // Missing forecast or any unparseable entry → forecast absent (R1.17).
          expect(out.forecast).toBeUndefined();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
