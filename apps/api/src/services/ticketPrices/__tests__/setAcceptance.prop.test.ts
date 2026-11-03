// Feature: trip-budget, Property 11: A set is accepted only when it is sane
/**
 * Property 11:
 * acceptPricesSet returns ok if and only if the set has at least one row,
 * zero invalid prices, a rows-per-window-day rate at least minRatio of the previous
 * accepted set's rate (when a previous set exists), and an unrecognized fraction at most
 * the limit; otherwise the verdict names the failing condition.
 * Generated cases include a long gap: a healthy set whose window is 90 days shorter
 * than the previous one (same horizon) and whose row count falls proportionally is accepted,
 * while one whose per-day rate drops below minRatio is rejected.
 *
 * Validates: Requirements 11.9, 11.10
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { acceptPricesSet } from '../setAcceptance.js';
import type { ParsedPricesSet } from '../parsePricesResponse.js';

const NUM_RUNS = 100;

function makeParsedSet(overrides?: Partial<ParsedPricesSet>): ParsedPricesSet {
  return {
    rows: overrides?.rows ?? [{} as any],
    skippedUnrecognized: overrides?.skippedUnrecognized ?? 0,
    skippedNotSellable: overrides?.skippedNotSellable ?? 0,
    invalidPriceCount: overrides?.invalidPriceCount ?? 0,
    horizonDate: overrides?.horizonDate ?? '2027-12-31',
  };
}

describe('setAcceptance — Property 11: A set is accepted only when it is sane', () => {
  const defaultCfg = { minRatio: 0.5, maxUnrecognizedFraction: 0.1 };

  it('Property 11: with previous = null, accepts any non-empty sane set', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5000 }),
        fc.integer({ min: 1, max: 450 }),
        (rowCount, windowDays) => {
          const fakeRows = new Array(rowCount).fill({});
          const parsed = makeParsedSet({ rows: fakeRows, invalidPriceCount: 0, skippedUnrecognized: 0 });
          const verdict = acceptPricesSet(parsed, rowCount, null, windowDays, defaultCfg);
          expect(verdict).toEqual({ ok: true });
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('Property 11: long-gap case: 90 days shorter window with proportional row count is accepted', () => {
    // e.g. Previous was 400 window days with 3200 rows (8 rows/day).
    // Now window is 310 days (90 days shorter) with 2480 rows (8 rows/day).
    const prev = { rowCount: 3200, windowDays: 400 };
    const currentWindowDays = 310;
    const currentRows = new Array(2480).fill({});
    const parsed = makeParsedSet({ rows: currentRows });

    const verdict = acceptPricesSet(parsed, 2480, prev, currentWindowDays, defaultCfg);
    expect(verdict).toEqual({ ok: true });
  });

  it('Property 11: rejects when per-day rate drops below minRatio', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 400 }), // prevWindowDays
        fc.integer({ min: 10, max: 99 }),   // windowDays shorter
        fc.double({ min: 0.01, max: 0.49, noNaN: true }), // ratio strictly below 0.5
        (prevWindowDays, gap, ratioFraction) => {
          const prevRowsPerDay = 8;
          const prevRowCount = prevWindowDays * prevRowsPerDay;
          const currentWindowDays = Math.max(1, prevWindowDays - gap);

          // current rate is below minRatio (0.5) of previous rate
          const currentRowCount = Math.floor(currentWindowDays * prevRowsPerDay * ratioFraction);
          const currentRows = new Array(Math.max(1, currentRowCount)).fill({});
          const parsed = makeParsedSet({ rows: currentRows });

          const verdict = acceptPricesSet(parsed, currentRows.length, { rowCount: prevRowCount, windowDays: prevWindowDays }, currentWindowDays, defaultCfg);
          expect(verdict).toEqual({ ok: false, reason: 'row_count_drop' });
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('Property 11: rejects empty rows with reason empty', () => {
    const parsed = makeParsedSet({ rows: [] });
    const verdict = acceptPricesSet(parsed, 0, null, 100, defaultCfg);
    expect(verdict).toEqual({ ok: false, reason: 'empty' });
  });

  it('Property 11: rejects invalid price count > 0 with reason invalid_price', () => {
    const parsed = makeParsedSet({ rows: [{} as any], invalidPriceCount: 1 });
    const verdict = acceptPricesSet(parsed, 1, null, 100, defaultCfg);
    expect(verdict).toEqual({ ok: false, reason: 'invalid_price' });
  });

  it('Property 11: rejects unrecognized fraction > maxUnrecognizedFraction with reason unrecognized_fraction', () => {
    // 20 unrecognized out of 100 total = 0.2 > 0.1 limit
    const parsed = makeParsedSet({ rows: new Array(80).fill({}), skippedUnrecognized: 20 });
    const verdict = acceptPricesSet(parsed, 100, null, 100, defaultCfg);
    expect(verdict).toEqual({ ok: false, reason: 'unrecognized_fraction' });
  });
});
