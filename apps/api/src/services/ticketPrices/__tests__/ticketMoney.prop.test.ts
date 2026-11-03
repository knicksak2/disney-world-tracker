// Feature: trip-budget, Property 10: Dollar strings convert to exact cents
/**
 * Property 10:
 * For any `d` in 0..99999 and `f` in 0..99 formatted as `"d.ff"`,
 * dollarsStringToCents returns d*100+f exactly when positive;
 * non-numeric, negative, exponent, thousands-separated, and empty strings return null;
 * pricePerDay is never read.
 *
 * Validates: Requirements 11.3
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { dollarsStringToCents } from '../ticketMoney.js';

const NUM_RUNS = 100;

describe('ticketMoney — Property 10: Dollar strings convert to exact cents', () => {
  it('Property 10: converts "d.ff" to exact cents d*100 + f when positive', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 99999 }),
        fc.integer({ min: 0, max: 99 }),
        (d, f) => {
          const fracStr = f.toString().padStart(2, '0');
          const str = `${d}.${fracStr}`;
          const expectedCents = d * 100 + f;

          const result = dollarsStringToCents(str);
          if (expectedCents > 0) {
            expect(result).toBe(expectedCents);
          } else {
            // zero cents returns null
            expect(result).toBeNull();
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('Property 10: converts integer dollars string "d" to d*100 when positive', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 99999 }),
        (d) => {
          const str = `${d}`;
          expect(dollarsStringToCents(str)).toBe(d * 100);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('Property 10: converts one decimal digit string "d.f" to d*100 + f*10', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 99999 }),
        fc.integer({ min: 0, max: 9 }),
        (d, f) => {
          const str = `${d}.${f}`;
          const expected = d * 100 + f * 10;
          if (expected > 0) {
            expect(dollarsStringToCents(str)).toBe(expected);
          } else {
            expect(dollarsStringToCents(str)).toBeNull();
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('Property 10: returns null for invalid strings (negatives, exponents, commas, non-numeric, empty)', () => {
    const invalidInputs = [
      '-10.00',
      '-1',
      '1e3',
      '1,000.00',
      '1 000',
      '$10.00',
      'abc',
      '',
      '   ',
      '0',
      '0.0',
      '0.00',
      '10.000', // 3 decimal places
      '10.',    // trailing dot without decimals
      '.50',    // leading dot without integer
      null,
      undefined,
      123,
    ];

    for (const input of invalidInputs) {
      expect(dollarsStringToCents(input as any)).toBeNull();
    }
  });
});
