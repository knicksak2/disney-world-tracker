import type { TripStatus } from '@dwt/shared';

export interface TripSummaryBannerInput {
  readonly status: TripStatus;
  readonly completedCount: number;
  readonly plannedCount: number;
  readonly feedCount: number;
}

export interface TripSummaryBannerCopy {
  readonly eyebrow: string;
  readonly title: string;
  readonly subtitle: string;
}

export function deriveTripSummaryBannerCopy({
  status,
  completedCount,
  plannedCount,
  feedCount,
}: TripSummaryBannerInput): TripSummaryBannerCopy {
  if (status === 'upcoming') {
    const eyebrow = completedCount > 0 ? 'TRIP PROGRESS' : 'UPCOMING TRIP';
    const title =
      completedCount > 0
        ? `${completedCount} of ${plannedCount} completed!`
        : plannedCount > 0
          ? `${plannedCount} item${plannedCount === 1 ? '' : 's'} planned`
          : 'Trip countdown & prep';
    return {
      eyebrow,
      title,
      subtitle: 'Preview group stats, countdown & shared picks ›',
    };
  }

  if (status === 'past') {
    const title =
      completedCount > 0
        ? `${completedCount} of ${plannedCount} completed!`
        : `${feedCount} magical moment${feedCount === 1 ? '' : 's'} logged!`;
    return {
      eyebrow: 'TRIP RECAP',
      title,
      subtitle: 'Tap to revisit group superlatives & top ratings ›',
    };
  }

  return {
    eyebrow: completedCount > 0 ? 'VACATION MILESTONE' : 'VACATION UNDERWAY',
    title:
      completedCount > 0
        ? `${completedCount} of ${plannedCount} completed!`
        : `${feedCount} magical moment${feedCount === 1 ? '' : 's'} logged!`,
    subtitle: 'Tap to see live group superlatives & top ratings ›',
  };
}
