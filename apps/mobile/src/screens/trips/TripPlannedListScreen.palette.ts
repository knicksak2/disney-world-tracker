// Feature: dark-mode — co-located light/dark literal pairs for TripPlannedListScreen.tsx.

import { DARK_TONAL, definePalette } from '../../theme/theme';

/** Reservation-kind badge text colours that are not theme tokens (rule 3 T). */
export const RESERVATION_BADGE = definePalette({
  light: {
    // Lightning Lane (amber family, hue 40).
    lightningLane: '#f6a609',
    // Activity booking (sky family).
    activity: '#2f80ed',
  },
  dark: {
    lightningLane: DARK_TONAL.amber.fg,
    activity: DARK_TONAL.sky.fg,
  },
});

/** "Unscheduled" scheduling badge (amber family). */
export const SCHED_BADGE = definePalette({
  light: {
    // Badge tint (S).
    unscheduledBg: 'rgba(246, 166, 9, 0.16)',
    // Badge text (T).
    unscheduledText: '#9a6500',
  },
  dark: {
    unscheduledBg: DARK_TONAL.amber.tint,
    unscheduledText: DARK_TONAL.amber.fg,
  },
});

/** Add-item modal scrim (rule 2 exception: textPrimary-tinted scrim). */
export const PLANNED_MODAL = definePalette({
  light: { scrim: 'rgba(31, 18, 53, 0.5)' },
  dark: { scrim: 'rgba(0, 0, 0, 0.5)' },
});
