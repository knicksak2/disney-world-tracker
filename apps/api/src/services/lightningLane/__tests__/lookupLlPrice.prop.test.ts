import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { lookupLlPrice } from '../lookupLlPrice.js';
import type { StoredLlRow } from '../types.js';
import type { LlPriceRef } from '@dwt/shared';
import { priceLabelText } from '@dwt/shared';
import { addDays } from '../../ticketPrices/dates.js';

describe('Property 21: A stored Lightning Lane price takes precedence and is labelled by age', () => {
  // Feature: trip-budget, Property 21: A stored Lightning Lane price takes precedence and is labelled by age

  const baseDate = '2026-06-15';
  const parks = ['Magic Kingdom', 'EPCOT', 'Hollywood Studios', 'Animal Kingdom'] as const;
  const passTypes: ('multi' | 'premier' | 'single')[] = ['multi', 'premier', 'single'];

  it('satisfies Property 21 across randomized inputs (100 runs)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...parks),
        fc.constantFrom(...passTypes),
        fc.integer({ min: -10, max: 30 }), // target date offset from baseDate
        fc.integer({ min: 1, max: 120 }), // staleHours
        fc.integer({ min: 0, max: 200 }), // age in hours of stored row
        fc.boolean(), // available
        fc.integer({ min: 1000, max: 40000 }), // cents
        fc.boolean(), // hasStored
        (park, passType, targetOffset, staleHours, ageHours, available, cents, hasStored) => {
          const today = baseDate;
          const targetDate = addDays(today, targetOffset);
          const now = new Date(`${today}T15:00:00.000Z`);

          const ref: LlPriceRef = {
            kind: 'll',
            passType,
            park,
            date: targetDate,
            ...(passType === 'single' ? { experienceId: 'exp-1' } : {}),
          };

          const storedRows: StoredLlRow[] = [];
          if (hasStored) {
            storedRows.push({
              passType,
              park,
              date: targetDate,
              experienceId: passType === 'single' ? 'exp-1' : null,
              purchaseId: passType === 'single' ? 'purchase-1' : null,
              cents,
              available,
              capturedAt: new Date(now.getTime() - ageHours * 3600_000),
            });
          }

          const history = [
            { date: addDays(today, -7), cents: 1900 },
            { date: addDays(today, -14), cents: 2100 },
            { date: addDays(today, -21), cents: 2300 },
          ];

          const cfg = {
            staleHours,
            lookbackDays: 90,
            minSamples: 3,
          };

          const quote = lookupLlPrice(ref, storedRows, history, today, now, cfg);

          if (hasStored) {
            // Stored row takes precedence over typical estimate
            expect(quote.priceCents).toBe(cents);
            expect(quote.effectivePriceSource).toBe('themeparks_ll');
            expect(quote.attribution).toBe('themeparks_wiki');
            expect(quote.soldOut).toBe(!available);

            if (ageHours <= staleHours) {
              expect(quote.priceLabelKind).toBe('current');
            } else {
              expect(quote.priceLabelKind).toBe('may_have_changed');
            }
          } else {
            // When no stored row matches
            if (quote.priceCents !== null) {
              expect(quote.effectivePriceSource).toBe('typical_estimate');
              expect(quote.priceLabelKind).toBe('estimate');
              expect(quote.attribution).toBe('themeparks_wiki');
              expect(quote.soldOut).toBe(false);
              expect(quote.asOf).not.toBe('');
              expect(quote.asOf < today).toBe(true);

              // Invariance across different now values
              const laterNow = new Date(now.getTime() + 10 * 3600_000);
              const quoteLater = lookupLlPrice(ref, storedRows, history, today, laterNow, cfg);
              expect(quoteLater.asOf).toBe(quote.asOf);
              expect(
                priceLabelText(quoteLater.priceLabelKind, quoteLater.effectivePriceSource, quoteLater.asOf),
              ).toBe(
                priceLabelText(quote.priceLabelKind, quote.effectivePriceSource, quote.asOf),
              );
            } else {
              expect(quote.effectivePriceSource).toBe('user_entered');
              expect(quote.priceLabelKind).toBe('add_your_price');
              expect(quote.soldOut).toBe(false);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
