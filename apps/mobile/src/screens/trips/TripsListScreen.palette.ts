// Feature: dark-mode — co-located light/dark literal pairs for TripsListScreen.tsx.

import { DARK_TONAL, definePalette } from '../../theme/theme';

/** Trip rows and their countdown badge. */
export const TRIP_ROW = definePalette({
  light: {
    // Row card border and past-badge border (violet B).
    rowBorder: '#ebdff8',
    pastBorder: '#ebdff8',
    // Countdown / active badge: H-role violet hero tile, mode-invariant.
    countdownBg: '#3b1d60',
    activeBg: '#3b1d60',
    // Past badge tile (unlisted violet, S).
    pastBg: '#f1ebf9',
  },
  dark: {
    rowBorder: DARK_TONAL.violet.border,
    pastBorder: DARK_TONAL.violet.border,
    countdownBg: '#3b1d60',
    activeBg: '#3b1d60',
    pastBg: DARK_TONAL.violet.tint,
  },
});

/** Create-trip modal scrim (rule 2 exception: textPrimary-tinted scrim). */
export const TRIPS_MODAL = definePalette({
  light: { scrim: 'rgba(31, 18, 53, 0.5)' },
  dark: { scrim: 'rgba(0, 0, 0, 0.5)' },
});
