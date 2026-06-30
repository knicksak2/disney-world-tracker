/**
 * Property-based test for `projectLiveDetail` — Property 4.
 *
 * Kept in its own file (one property per file) so concurrent authoring of the
 * sibling projection properties never clobbers a shared file.
 *
 *   - Property 4: Return windows and boarding groups map state and carry
 *                 price/numbers faithfully
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  projectLiveDetail,
  WDW_TIME_ZONE,
  type ProjectionContext,
} from '../project.js';
import type { ThemeParksLiveEntry } from '../themeparksLive.js';

const NUM_RUNS = 100;

/**
 * A fixed projection context. Return-window, paid-return-window, and
 * boarding-group projection are independent of the clock and time zone, so a
 * constant context is sufficient (and keeps the properties focused on the
 * queue mapping under test).
 */
const CTX: ProjectionContext = {
  parkTimeZone: WDW_TIME_ZONE,
  now: new Date('2024-06-15T18:00:00.000Z'),
};

// ===========================================================================
// Property 4: Return windows and boarding groups map state and carry
//             price/numbers faithfully
// ===========================================================================
// Feature: experience-live-details, Property 4: Return windows and boarding groups map state and carry price/numbers faithfully
/**
 * Validates: Requirements 1.13, 1.14, 1.15
 *
 * For any return-time / paid-return-time / boarding-group queue:
 *   - the projected state is one of its allowed labels
 *     (`Available | Temporarily_Full | Finished` for return windows;
 *     `Available | Paused | Closed` for boarding groups) when the upstream
 *     token is recognized, and the whole structure is absent when it is not;
 *   - optional times / group numbers / estimated waits are carried iff present
 *     (and parseable / in range); and
 *   - a paid return window's amount, currency, and formatted price string are
 *     carried verbatim with no reformatting.
 */

/** Recognized return / paid-return state tokens and their projected labels. */
const RETURN_STATE_CASES = [
  { token: 'AVAILABLE', label: 'Available' },
  { token: 'TEMP_FULL', label: 'Temporarily_Full' },
  { token: 'FINISHED', label: 'Finished' },
] as const;

/** Recognized boarding-group allocation tokens and their projected labels. */
const ALLOCATION_CASES = [
  { token: 'AVAILABLE', label: 'Available' },
  { token: 'PAUSED', label: 'Paused' },
  { token: 'CLOSED', label: 'Closed' },
] as const;

const RETURN_LABELS = ['Available', 'Temporarily_Full', 'Finished'] as const;
const ALLOCATION_LABELS = ['Available', 'Paused', 'Closed'] as const;

/**
 * A recognized return-state token (sometimes lower-cased to exercise the
 * case-insensitive mapping) paired with the label it must project to.
 */
const recognizedReturnStateArb = fc
  .tuple(fc.constantFrom(...RETURN_STATE_CASES), fc.boolean())
  .map(([c, lower]) => ({
    token: lower ? c.token.toLowerCase() : c.token,
    label: c.label,
  }));

/** A token that is NOT a recognized return-state token. */
const unrecognizedReturnTokenArb = fc
  .string()
  .filter(
    (s) =>
      !RETURN_STATE_CASES.some((c) => c.token === s.toUpperCase()),
  );

/** A recognized allocation token (case-varied) paired with its label. */
const recognizedAllocationArb = fc
  .tuple(fc.constantFrom(...ALLOCATION_CASES), fc.boolean())
  .map(([c, lower]) => ({
    token: lower ? c.token.toLowerCase() : c.token,
    label: c.label,
  }));

/** A token that is NOT a recognized allocation token. */
const unrecognizedAllocationTokenArb = fc
  .string()
  .filter(
    (s) => !ALLOCATION_CASES.some((c) => c.token === s.toUpperCase()),
  );

/**
 * An optional timestamp drawn from three regimes — absent, present-but-valid
 * (carried as a normalized ISO instant), and present-but-unparseable (dropped)
 * — paired with the value the projection must produce.
 */
type OptionalTime = {
  readonly input: string | undefined;
  readonly expected: string | undefined;
};

const optionalTimeArb: fc.Arbitrary<OptionalTime> = fc.oneof(
  fc.constant<OptionalTime>({ input: undefined, expected: undefined }),
  fc
    .constantFrom('', 'not-a-date', 'tomorrow', 'soon')
    .map<OptionalTime>((s) => ({ input: s, expected: undefined })),
  fc
    .date({
      min: new Date('2000-01-01T00:00:00.000Z'),
      max: new Date('2030-01-01T00:00:00.000Z'),
    })
    .map<OptionalTime>((d) => ({
      input: d.toISOString(),
      expected: d.toISOString(),
    })),
);

/**
 * An optional integer group number: absent, a genuine integer (carried), or a
 * non-integer number (dropped).
 */
type OptionalNumber = {
  readonly input: number | undefined;
  readonly expected: number | undefined;
};

const optionalGroupNumberArb: fc.Arbitrary<OptionalNumber> = fc.oneof(
  fc.constant<OptionalNumber>({ input: undefined, expected: undefined }),
  fc
    .integer({ min: -10, max: 500 })
    .map<OptionalNumber>((n) => ({ input: n, expected: n })),
  fc
    .double({ min: 0.1, max: 100, noNaN: true, noDefaultInfinity: true })
    .filter((n) => !Number.isInteger(n))
    .map<OptionalNumber>((n) => ({ input: n, expected: undefined })),
);

/**
 * An optional minute-valued estimated wait: absent, an integer in [0, 1440]
 * (carried), an out-of-range integer (dropped), or a non-integer (dropped).
 */
const optionalMinuteArb: fc.Arbitrary<OptionalNumber> = fc.oneof(
  fc.constant<OptionalNumber>({ input: undefined, expected: undefined }),
  fc
    .integer({ min: 0, max: 1440 })
    .map<OptionalNumber>((n) => ({ input: n, expected: n })),
  fc
    .oneof(fc.integer({ min: -5000, max: -1 }), fc.integer({ min: 1441, max: 5000 }))
    .map<OptionalNumber>((n) => ({ input: n, expected: undefined })),
  fc
    .double({ min: 0, max: 1440, noNaN: true, noDefaultInfinity: true })
    .filter((n) => !Number.isInteger(n))
    .map<OptionalNumber>((n) => ({ input: n, expected: undefined })),
);

/** A complete price object: numeric amount, string currency, string formatted. */
const priceArb = fc.record({
  amount: fc.double({ noNaN: true, noDefaultInfinity: true }),
  currency: fc.string(),
  // Bias toward realistic formatted strings while still exercising arbitrary text.
  formatted: fc.oneof(
    fc.string(),
    fc.constantFrom('$15.00', '€12,50', '£9.99', 'US$ 20.00', '¥1500'),
  ),
});

/** A price that is missing at least one required field (or wholly absent). */
const incompletePriceArb = fc.oneof(
  fc.constant(undefined),
  fc.record({ currency: fc.string(), formatted: fc.string() }), // no amount
  fc.record({ amount: fc.double({ noNaN: true }), formatted: fc.string() }), // no currency
  fc.record({ amount: fc.double({ noNaN: true }), currency: fc.string() }), // no formatted
);

describe('projectLiveDetail — Property 4: return windows & boarding groups', () => {
  it('return window: recognized state maps to an allowed label and carries times iff present', () => {
    fc.assert(
      fc.property(
        recognizedReturnStateArb,
        optionalTimeArb,
        optionalTimeArb,
        (state, start, end) => {
          const raw: ThemeParksLiveEntry = {
            queue: {
              RETURN_TIME: {
                state: state.token,
                ...(start.input !== undefined ? { returnStart: start.input } : {}),
                ...(end.input !== undefined ? { returnEnd: end.input } : {}),
              },
            },
          };
          const rw = projectLiveDetail(raw, CTX).returnWindow;
          expect(rw).toBeDefined();
          expect(RETURN_LABELS).toContain(rw!.state);
          expect(rw!.state).toBe(state.label);
          // Optional times carried iff present and parseable.
          expect(rw!.start).toBe(start.expected);
          expect(rw!.end).toBe(end.expected);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('return window: an unrecognized state yields no return window', () => {
    fc.assert(
      fc.property(
        unrecognizedReturnTokenArb,
        optionalTimeArb,
        optionalTimeArb,
        (token, start, end) => {
          const raw: ThemeParksLiveEntry = {
            queue: {
              RETURN_TIME: {
                state: token,
                ...(start.input !== undefined ? { returnStart: start.input } : {}),
                ...(end.input !== undefined ? { returnEnd: end.input } : {}),
              },
            },
          };
          expect(projectLiveDetail(raw, CTX).returnWindow).toBeUndefined();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('paid return window: state + complete price are carried verbatim with no reformatting', () => {
    fc.assert(
      fc.property(
        recognizedReturnStateArb,
        optionalTimeArb,
        optionalTimeArb,
        priceArb,
        (state, start, end, price) => {
          const raw: ThemeParksLiveEntry = {
            queue: {
              PAID_RETURN_TIME: {
                state: state.token,
                ...(start.input !== undefined ? { returnStart: start.input } : {}),
                ...(end.input !== undefined ? { returnEnd: end.input } : {}),
                price,
              },
            },
          };
          const prw = projectLiveDetail(raw, CTX).paidReturnWindow;
          expect(prw).toBeDefined();
          expect(RETURN_LABELS).toContain(prw!.state);
          expect(prw!.state).toBe(state.label);
          expect(prw!.start).toBe(start.expected);
          expect(prw!.end).toBe(end.expected);
          // Price carried verbatim — amount, currency, and the formatted
          // string must be byte-for-byte what upstream supplied (no rounding,
          // no currency normalization, no re-stringification).
          expect(prw!.price.amount).toBe(price.amount);
          expect(prw!.price.currency).toBe(price.currency);
          expect(prw!.price.formatted).toBe(price.formatted);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('paid return window: an incomplete price yields no paid return window', () => {
    fc.assert(
      fc.property(recognizedReturnStateArb, incompletePriceArb, (state, price) => {
        const raw: ThemeParksLiveEntry = {
          queue: {
            PAID_RETURN_TIME: {
              state: state.token,
              ...(price !== undefined ? { price } : {}),
            },
          },
        };
        expect(projectLiveDetail(raw, CTX).paidReturnWindow).toBeUndefined();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('paid return window: an unrecognized state yields no paid return window', () => {
    fc.assert(
      fc.property(unrecognizedReturnTokenArb, priceArb, (token, price) => {
        const raw: ThemeParksLiveEntry = {
          queue: { PAID_RETURN_TIME: { state: token, price } },
        };
        expect(projectLiveDetail(raw, CTX).paidReturnWindow).toBeUndefined();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('boarding group: recognized allocation maps to an allowed label and carries numbers faithfully', () => {
    fc.assert(
      fc.property(
        recognizedAllocationArb,
        optionalGroupNumberArb,
        optionalGroupNumberArb,
        optionalTimeArb,
        optionalMinuteArb,
        (alloc, groupStart, groupEnd, nextTime, wait) => {
          const raw: ThemeParksLiveEntry = {
            queue: {
              BOARDING_GROUP: {
                allocationStatus: alloc.token,
                ...(groupStart.input !== undefined
                  ? { currentGroupStart: groupStart.input }
                  : {}),
                ...(groupEnd.input !== undefined
                  ? { currentGroupEnd: groupEnd.input }
                  : {}),
                ...(nextTime.input !== undefined
                  ? { nextAllocationTime: nextTime.input }
                  : {}),
                ...(wait.input !== undefined ? { estimatedWait: wait.input } : {}),
              },
            },
          };
          const bg = projectLiveDetail(raw, CTX).boardingGroup;
          expect(bg).toBeDefined();
          expect(ALLOCATION_LABELS).toContain(bg!.allocation);
          expect(bg!.allocation).toBe(alloc.label);
          // Group numbers carried iff a genuine integer was present.
          expect(bg!.currentGroupStart).toBe(groupStart.expected);
          expect(bg!.currentGroupEnd).toBe(groupEnd.expected);
          // Next-allocation time carried iff present and parseable.
          expect(bg!.nextAllocationTime).toBe(nextTime.expected);
          // Estimated wait carried iff a whole number in [0, 1440].
          expect(bg!.estimatedWaitMinutes).toBe(wait.expected);
          if (bg!.estimatedWaitMinutes !== undefined) {
            expect(Number.isInteger(bg!.estimatedWaitMinutes)).toBe(true);
            expect(bg!.estimatedWaitMinutes).toBeGreaterThanOrEqual(0);
            expect(bg!.estimatedWaitMinutes).toBeLessThanOrEqual(1440);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('boarding group: an unrecognized allocation yields no boarding group', () => {
    fc.assert(
      fc.property(
        unrecognizedAllocationTokenArb,
        optionalGroupNumberArb,
        (token, groupStart) => {
          const raw: ThemeParksLiveEntry = {
            queue: {
              BOARDING_GROUP: {
                allocationStatus: token,
                ...(groupStart.input !== undefined
                  ? { currentGroupStart: groupStart.input }
                  : {}),
              },
            },
          };
          expect(projectLiveDetail(raw, CTX).boardingGroup).toBeUndefined();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
