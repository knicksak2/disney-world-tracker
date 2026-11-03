/**
 * Pure ticket price resolution for trip budgeting (Requirements 14.1-14.12, review F11, F22).
 *
 * Resolves exact rows or same-weekday fallback estimates from cached ticket rows.
 * Zero I/O, no clock reads, pure function.
 *
 * Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.10, 14.11, 14.12
 */

import type { PriceQuoteDTO, TicketPriceRef } from '@dwt/shared';
import { addDays, daysBetween } from './dates.js';
import { ticketAgeClass, worseLabel } from './freshness.js';
import type { LabelCfg, TicketPriceRow, TicketPriceSetMeta, TicketResolution } from './types.js';

export interface TicketBook {
  readonly rows: readonly TicketPriceRow[];
  readonly sets: readonly TicketPriceSetMeta[];
}

function dayOfWeek(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00.000Z`).getUTCDay();
}

/**
 * Resolves the ticket price quote for a given TicketPriceRef against the ticket book.
 *
 * @param req The ticket price reference (group, numDays, ageGroup, optionCode, startDate, park)
 * @param book The book of cached ticket price rows and sets
 * @param today Today's date string (YYYY-MM-DD) in WDW local time
 * @param cfg Freshness label thresholds (freshDays, estimateAfterDays)
 * @param pairPermitted Whether (req.discountGroup, req.numDays) is permitted by configuration
 */
export function resolveTicketPrice(
  req: TicketPriceRef,
  book: TicketBook,
  today: string,
  cfg: LabelCfg,
  pairPermitted: boolean,
): TicketResolution {
  // Step 0: Past start date -> null price, add_your_price, estimateReason: 'none'
  if (req.startDate < today) {
    return {
      priceCents: null,
      taxCents: null,
      resolvedStartDate: null,
      parkAssumed: false,
      labelKind: 'add_your_price',
      asOf: null,
      estimateReason: 'none',
      flUnavailable: false,
    };
  }

  // Step 1: Find the set for (discountGroup, numDays)
  const set = book.sets.find((s) => s.discountGroup === req.discountGroup && s.numDays === req.numDays) ?? null;

  // (a) Florida Resident not offered or not permitted
  if (req.discountGroup === 'fl-resident' && (!pairPermitted || set?.lastError === 'not_offered')) {
    return {
      priceCents: null,
      taxCents: null,
      resolvedStartDate: null,
      parkAssumed: false,
      labelKind: 'add_your_price',
      asOf: set?.asOf ?? null,
      estimateReason: 'fl_unavailable',
      flUnavailable: true,
    };
  }

  // (b) Set missing or no rows cached yet (asOf is null)
  if (set === null || set.asOf === null) {
    return {
      priceCents: null,
      taxCents: null,
      resolvedStartDate: null,
      parkAssumed: false,
      labelKind: 'add_your_price',
      asOf: set?.asOf ?? null,
      estimateReason: 'none',
      flUnavailable: false,
    };
  }

  // Step 2: Determine park codes
  let parkCodes: readonly string[];
  if (req.optionCode === 'base' && req.numDays === 1) {
    parkCodes = req.park ? [req.park] : ['mk', 'ep', 'hs', 'ak'];
  } else {
    parkCodes = ['any'];
  }

  // Filter matching rows for the key
  const matchingRows = book.rows.filter(
    (r) =>
      r.discountGroup === req.discountGroup &&
      r.numDays === req.numDays &&
      r.ageGroup === req.ageGroup &&
      r.optionCode === req.optionCode &&
      parkCodes.includes(r.park),
  );

  const rowsFor = (date: string) => matchingRows.filter((r) => r.startDate === date);

  // Step 3: Exact date match within horizon
  if (set.horizonDate !== null && req.startDate <= set.horizonDate) {
    const exactRows = rowsFor(req.startDate);
    if (exactRows.length > 0) {
      const maxRow = exactRows.reduce((prev, curr) => (curr.priceCents > prev.priceCents ? curr : prev));
      const parkAssumed = !req.park && parkCodes.length > 1;
      const ageClass = ticketAgeClass(set.asOf, today, cfg);
      const isEstimate = parkAssumed;
      const labelKind = worseLabel(ageClass, isEstimate ? 'estimate' : 'current');

      let estimateReason: NonNullable<PriceQuoteDTO['estimateReason']> = 'none';
      if (parkAssumed) {
        estimateReason = 'park_unset';
      } else if (ageClass === 'may_have_changed' || ageClass === 'estimate') {
        estimateReason = 'stale';
      }

      return {
        priceCents: maxRow.priceCents,
        taxCents: maxRow.taxCents,
        resolvedStartDate: req.startDate,
        parkAssumed,
        labelKind,
        asOf: set.asOf,
        estimateReason,
        flUnavailable: false,
      };
    }
  }

  const reqDow = dayOfWeek(req.startDate);

  // Candidate dates: cached dates with the same weekday within [today, set.horizonDate]
  const candidateDates = Array.from(
    new Set(
      matchingRows
        .filter((r) => {
          if (r.startDate < today) return false;
          if (set.horizonDate !== null && r.startDate > set.horizonDate) return false;
          return dayOfWeek(r.startDate) === reqDow;
        })
        .map((r) => r.startDate),
    ),
  );

  // Step 4: Beyond horizon (req.startDate > set.horizonDate)
  if (set.horizonDate !== null && req.startDate > set.horizonDate) {
    if (candidateDates.length === 0) {
      return {
        priceCents: null,
        taxCents: null,
        resolvedStartDate: null,
        parkAssumed: false,
        labelKind: 'add_your_price',
        asOf: set.asOf,
        estimateReason: 'none',
        flUnavailable: false,
      };
    }

    const target = addDays(req.startDate, -364);
    let chosenDate: string;

    if (target >= today && target <= set.horizonDate) {
      // Minimize abs(daysBetween(d, target)), tie to earlier date
      candidateDates.sort((a, b) => a.localeCompare(b));
      chosenDate = candidateDates.reduce((best, curr) => {
        const diffCurr = Math.abs(daysBetween(curr, target));
        const diffBest = Math.abs(daysBetween(best, target));
        if (diffCurr < diffBest) return curr;
        if (diffCurr === diffBest) return curr < best ? curr : best;
        return best;
      });
    } else {
      // Choose the latest candidate
      candidateDates.sort((a, b) => a.localeCompare(b));
      chosenDate = candidateDates[candidateDates.length - 1]!;
    }

    const candidateRows = rowsFor(chosenDate);
    const maxRow = candidateRows.reduce((prev, curr) => (curr.priceCents > prev.priceCents ? curr : prev));
    const parkAssumed = !req.park && parkCodes.length > 1;
    const ageClass = ticketAgeClass(set.asOf, today, cfg);
    const labelKind = worseLabel(ageClass, 'estimate');
    const estimateReason: NonNullable<PriceQuoteDTO['estimateReason']> = parkAssumed ? 'park_unset' : 'beyond_horizon';

    return {
      priceCents: maxRow.priceCents,
      taxCents: maxRow.taxCents,
      resolvedStartDate: chosenDate,
      parkAssumed,
      labelKind,
      asOf: set.asOf,
      estimateReason,
      flUnavailable: false,
    };
  }

  // Step 5: Within horizon, but no exact row
  if (candidateDates.length > 0) {
    candidateDates.sort((a, b) => a.localeCompare(b));
    const chosenDate = candidateDates.reduce((best, curr) => {
      const diffCurr = Math.abs(daysBetween(curr, req.startDate));
      const diffBest = Math.abs(daysBetween(best, req.startDate));
      if (diffCurr < diffBest) return curr;
      if (diffCurr === diffBest) return curr < best ? curr : best;
      return best;
    });

    const candidateRows = rowsFor(chosenDate);
    const maxRow = candidateRows.reduce((prev, curr) => (curr.priceCents > prev.priceCents ? curr : prev));
    const parkAssumed = !req.park && parkCodes.length > 1;
    const ageClass = ticketAgeClass(set.asOf, today, cfg);
    const labelKind = worseLabel(ageClass, 'estimate');
    const estimateReason: NonNullable<PriceQuoteDTO['estimateReason']> = parkAssumed ? 'park_unset' : 'no_exact_date';

    return {
      priceCents: maxRow.priceCents,
      taxCents: maxRow.taxCents,
      resolvedStartDate: chosenDate,
      parkAssumed,
      labelKind,
      asOf: set.asOf,
      estimateReason,
      flUnavailable: false,
    };
  }

  // Step 6: No candidate dates available
  return {
    priceCents: null,
    taxCents: null,
    resolvedStartDate: null,
    parkAssumed: false,
    labelKind: 'add_your_price',
    asOf: set.asOf,
    estimateReason: 'none',
    flUnavailable: false,
  };
}
