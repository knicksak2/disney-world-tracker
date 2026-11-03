/**
 * Lookup Lightning Lane price quote for a given reference.
 *
 * Validates: Requirements 15.7, 15.8, 15.9
 */

import type { LlPriceRef, PriceQuoteDTO } from '@dwt/shared';
import type { StoredLlRow } from './types.js';
import { typicalLlPrice } from './typicalPrice.js';

export function lookupLlPrice(
  ref: LlPriceRef,
  stored: readonly StoredLlRow[],
  history: readonly { date: string; cents: number }[],
  today: string,
  now: Date,
  cfg: { staleHours: number; lookbackDays: number; minSamples: number },
): PriceQuoteDTO {
  // Look for stored row matching passType, park, date, and experienceId (if single)
  const matchingStored = stored.find((s) => {
    if (s.passType !== ref.passType || s.date !== ref.date || s.park !== ref.park) {
      return false;
    }
    if (ref.passType === 'single') {
      return s.experienceId === (ref.experienceId ?? null);
    }
    return true;
  });

  if (matchingStored) {
    const ageMs = now.getTime() - matchingStored.capturedAt.getTime();
    const staleMs = cfg.staleHours * 3_600_000;
    const isFresh = ageMs <= staleMs;
    const labelKind = isFresh ? 'current' : 'may_have_changed';

    return {
      priceCents: matchingStored.cents,
      taxCents: null,
      effectivePriceSource: 'themeparks_ll',
      priceLabelKind: labelKind,
      asOf: matchingStored.capturedAt.toISOString(),
      attribution: 'themeparks_wiki',
      soldOut: matchingStored.available === false,
      cacheState: 'ready',
      estimateReason: 'none',
      parkAssumed: false,
      flUnavailable: false,
    };
  }

  // Fall back to typical estimate
  const typical = typicalLlPrice(
    history,
    { date: ref.date },
    today,
    { lookbackDays: cfg.lookbackDays, minSamples: cfg.minSamples },
  );

  if (typical.priceCents !== null) {
    return {
      priceCents: typical.priceCents,
      taxCents: null,
      effectivePriceSource: 'typical_estimate',
      priceLabelKind: 'estimate',
      asOf: typical.newestSampleDate,
      attribution: 'themeparks_wiki',
      soldOut: false,
      cacheState: 'ready',
      estimateReason: 'typical',
      parkAssumed: false,
      flUnavailable: false,
    };
  }

  return {
    priceCents: null,
    taxCents: null,
    effectivePriceSource: 'user_entered',
    priceLabelKind: 'add_your_price',
    asOf: '',
    attribution: null,
    soldOut: false,
    cacheState: 'ready',
    estimateReason: 'none',
    parkAssumed: false,
    flUnavailable: false,
  };
}

