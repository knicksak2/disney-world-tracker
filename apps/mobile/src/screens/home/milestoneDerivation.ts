/**
 * Pure helper for deriving the earliest active booking milestone to display on UpcomingTripHero.
 *
 * Validates: Requirements 2.8, Property 11.
 */

import type { BookingWindowDTO } from '@dwt/shared';
import { formatDropMoment } from '../trips/bookingTimelineView';

export interface ActiveMilestoneDisplay {
  readonly kind: 'dining' | 'lightning_lane';
  readonly title: string;
  readonly subtitle: string;
  readonly windowKey: string;
  readonly isOpenNow: boolean;
}

export function resolveEarliestActiveMilestone(
  windows?: readonly BookingWindowDTO[] | null,
): ActiveMilestoneDisplay | null {
  if (!windows || windows.length === 0) {
    return null;
  }

  // Active windows that are not past and not marked done
  const eligible = windows.filter((w) => w.status !== 'past' && !w.done);
  if (eligible.length === 0) {
    return null;
  }

  // Chronological sort by dropAt
  const sorted = [...eligible].sort((a, b) => a.dropAt.localeCompare(b.dropAt));
  const target = sorted[0];
  if (!target) {
    return null;
  }

  const isOpenNow = target.status === 'open';
  const prefix = target.kind === 'dining' ? '🍽️ 60-Day Dining' : '⚡ Lightning Lane';

  let countdownText: string;
  if (isOpenNow) {
    countdownText = `${prefix} Window Open Now!`;
  } else if (target.daysUntilDrop === 0) {
    countdownText = `${prefix} Window Opens Today!`;
  } else if (target.daysUntilDrop === 1) {
    countdownText = `${prefix} Window Opens Tomorrow`;
  } else if (target.daysUntilDrop !== null && target.daysUntilDrop > 1) {
    countdownText = `${prefix} opens in ${target.daysUntilDrop} days`;
  } else {
    countdownText = `${prefix} Window`;
  }

  const dropSub = formatDropMoment(target.dropAt);

  return {
    kind: target.kind,
    title: countdownText,
    subtitle: isOpenNow ? 'Book reservations now in My Disney Experience' : dropSub,
    windowKey: target.windowKey,
    isOpenNow,
  };
}

