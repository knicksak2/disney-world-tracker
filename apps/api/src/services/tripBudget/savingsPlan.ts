/**
 * Pure savings plan calculations for Trip Budget.
 *
 * Imports daysBetween from ticketPrices/dates.ts (Requirement 8, Round 3 L1).
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4
 */

import type { SavingsPlanDTO } from '@dwt/shared';
import { daysBetween } from '../ticketPrices/dates.js';

export interface ComputeSavingsPlanInput {
  targetCents: number;
  savedCents: number;
  today: string; // YYYY-MM-DD
  tripStartDate: string; // YYYY-MM-DD
}

export function computeSavingsPlan(i: ComputeSavingsPlanInput): SavingsPlanDTO {
  const remainingCents = Math.max(0, i.targetCents - i.savedCents);
  const daysUntilStart = daysBetween(i.today, i.tripStartDate);

  // Overlap rule (Round 3 L1 / Requirement 8.3):
  // When remainingCents === 0, status is 'on_track' with perWeekCents 0 regardless of daysUntilStart
  if (remainingCents === 0) {
    return {
      targetCents: i.targetCents,
      savedCents: i.savedCents,
      remainingCents: 0,
      daysUntilStart,
      weeksRemaining: daysUntilStart > 0 ? Math.ceil(daysUntilStart / 7) : null,
      perWeekCents: 0,
      status: 'on_track',
    };
  }

  // When remaining > 0 and trip is started or in the past (daysUntilStart <= 0)
  if (daysUntilStart <= 0) {
    return {
      targetCents: i.targetCents,
      savedCents: i.savedCents,
      remainingCents,
      daysUntilStart,
      weeksRemaining: null,
      perWeekCents: null,
      status: 'trip_started_or_past',
    };
  }

  // Normal saving mode
  const weeksRemaining = Math.ceil(daysUntilStart / 7);
  const perWeekCents = Math.ceil(remainingCents / weeksRemaining);

  return {
    targetCents: i.targetCents,
    savedCents: i.savedCents,
    remainingCents,
    daysUntilStart,
    weeksRemaining,
    perWeekCents,
    status: 'saving',
  };
}

