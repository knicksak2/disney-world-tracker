import { describe, it, expect } from 'vitest';
import { lookupLlPrice } from '../lookupLlPrice.js';
import type { StoredLlRow } from '../types.js';
import type { LlPriceRef } from '@dwt/shared';
import { priceLabelText } from '@dwt/shared';
import { dateToInstant, wdwDateOf } from '../../ticketPrices/dates.js';

describe('lookupLlPrice', () => {
  const defaultCfg = {
    staleHours: 72,
    lookbackDays: 90,
    minSamples: 3,
  };

  const today = '2026-06-15';
  const now = new Date('2026-06-15T16:00:00.000Z');

  it('prefers stored row over history, returning exact cents, attribution, and soldOut flag', () => {
    const ref: LlPriceRef = {
      kind: 'll',
      passType: 'multi',
      park: 'Magic Kingdom',
      date: '2026-06-16',
    };

    const storedRow: StoredLlRow = {
      passType: 'multi',
      park: 'Magic Kingdom',
      date: '2026-06-16',
      experienceId: null,
      purchaseId: null,
      cents: 3200,
      available: false,
      capturedAt: new Date(now.getTime() - 2 * 3600_000), // 2 hours ago
    };

    // Even if history has different prices, stored row wins
    const history = [
      { date: '2026-06-09', cents: 2500 },
      { date: '2026-06-02', cents: 2500 },
      { date: '2026-05-26', cents: 2500 },
    ];

    const quote = lookupLlPrice(ref, [storedRow], history, today, now, defaultCfg);

    expect(quote.priceCents).toBe(3200);
    expect(quote.effectivePriceSource).toBe('themeparks_ll');
    expect(quote.priceLabelKind).toBe('current');
    expect(quote.attribution).toBe('themeparks_wiki');
    expect(quote.soldOut).toBe(true);
    expect(quote.asOf).toBe(storedRow.capturedAt.toISOString());
  });

  it('labels stored row current when fresh and may_have_changed when older than staleHours (round 4 L1)', () => {
    // Two stored rows on same date: premier 100 hours ago, multi 1 hour ago. staleHours = 72
    const targetDate = '2026-06-18';
    const premierRow: StoredLlRow = {
      passType: 'premier',
      park: 'Magic Kingdom',
      date: targetDate,
      experienceId: null,
      purchaseId: null,
      cents: 39900,
      available: true,
      capturedAt: new Date(now.getTime() - 100 * 3600_000), // 100 hours ago
    };

    const multiRow: StoredLlRow = {
      passType: 'multi',
      park: 'Magic Kingdom',
      date: targetDate,
      experienceId: null,
      purchaseId: null,
      cents: 2900,
      available: true,
      capturedAt: new Date(now.getTime() - 1 * 3600_000), // 1 hour ago
    };

    const premierRef: LlPriceRef = {
      kind: 'll',
      passType: 'premier',
      park: 'Magic Kingdom',
      date: targetDate,
    };

    const multiRef: LlPriceRef = {
      kind: 'll',
      passType: 'multi',
      park: 'Magic Kingdom',
      date: targetDate,
    };

    const premierQuote = lookupLlPrice(
      premierRef,
      [premierRow, multiRow],
      [],
      today,
      now,
      defaultCfg,
    );
    expect(premierQuote.priceLabelKind).toBe('may_have_changed');
    expect(premierQuote.priceCents).toBe(39900);

    const multiQuote = lookupLlPrice(
      multiRef,
      [premierRow, multiRow],
      [],
      today,
      now,
      defaultCfg,
    );
    expect(multiQuote.priceLabelKind).toBe('current');
    expect(multiQuote.priceCents).toBe(2900);
  });

  it('matches experienceId for single pass stored row', () => {
    const singleRowExp1: StoredLlRow = {
      passType: 'single',
      park: 'Magic Kingdom',
      date: '2026-06-16',
      experienceId: 'exp-1',
      purchaseId: 'lightninglane_1',
      cents: 1500,
      available: true,
      capturedAt: now,
    };

    const singleRowExp2: StoredLlRow = {
      passType: 'single',
      park: 'Magic Kingdom',
      date: '2026-06-16',
      experienceId: 'exp-2',
      purchaseId: 'lightninglane_2',
      cents: 2200,
      available: true,
      capturedAt: now,
    };

    const refExp2: LlPriceRef = {
      kind: 'll',
      passType: 'single',
      park: 'Magic Kingdom',
      date: '2026-06-16',
      experienceId: 'exp-2',
    };

    const quote = lookupLlPrice(
      refExp2,
      [singleRowExp1, singleRowExp2],
      [],
      today,
      now,
      defaultCfg,
    );
    expect(quote.priceCents).toBe(2200);
  });

  it('falls back to typical estimate with newestSampleDate asOf invariant across now (round 4 L4, round 5 L5)', () => {
    const ref: LlPriceRef = {
      kind: 'll',
      passType: 'multi',
      park: 'EPCOT',
      date: '2026-06-23', // Tuesday in June
    };

    // Tuesday samples in June
    const history = [
      { date: '2026-06-02', cents: 2100 }, // newest Tuesday in June
      { date: '2026-05-26', cents: 2300 }, // Tuesday in May
      { date: '2026-05-19', cents: 2500 }, // Tuesday in May
      { date: '2026-05-12', cents: 2700 }, // Tuesday in May
    ];

    const quoteNow1 = lookupLlPrice(ref, [], history, today, now, defaultCfg);
    expect(quoteNow1.priceCents).not.toBeNull();
    expect(quoteNow1.effectivePriceSource).toBe('typical_estimate');
    expect(quoteNow1.priceLabelKind).toBe('estimate');
    expect(quoteNow1.estimateReason).toBe('typical');
    expect(quoteNow1.soldOut).toBe(false);
    expect(quoteNow1.asOf).toBe('2026-06-02');
    expect(quoteNow1.asOf < today).toBe(true);

    // Call with different now values: asOf and label text remain strictly identical
    const laterNow = new Date('2026-06-15T23:59:59.000Z');
    const quoteNow2 = lookupLlPrice(ref, [], history, today, laterNow, defaultCfg);
    expect(quoteNow2.asOf).toBe(quoteNow1.asOf);
    expect(priceLabelText(quoteNow2.priceLabelKind, quoteNow2.effectivePriceSource, quoteNow2.asOf)).toBe(
      priceLabelText(quoteNow1.priceLabelKind, quoteNow1.effectivePriceSource, quoteNow1.asOf),
    );

    // Round 5 L5: dateToInstant round-trip keeps exact calendar date in WDW time zone
    const instant = dateToInstant(quoteNow1.asOf);
    const readBackDate = wdwDateOf(instant);
    expect(readBackDate).toBe(quoteNow1.asOf);
    const label = priceLabelText('estimate', 'typical_estimate', readBackDate);
    expect(label).toBe('Estimate, as of Jun 2, 2026');
  });

  it('returns add_your_price when no stored row and no typical estimate', () => {
    const ref: LlPriceRef = {
      kind: 'll',
      passType: 'multi',
      park: 'Hollywood Studios',
      date: '2026-06-25',
    };

    const quote = lookupLlPrice(ref, [], [], today, now, defaultCfg);
    expect(quote.priceCents).toBeNull();
    expect(quote.effectivePriceSource).toBe('user_entered');
    expect(quote.priceLabelKind).toBe('add_your_price');
    expect(quote.asOf).toBe('');
    expect(quote.attribution).toBeNull();
    expect(quote.soldOut).toBe(false);
    expect(quote.estimateReason).toBe('none');
  });
});
