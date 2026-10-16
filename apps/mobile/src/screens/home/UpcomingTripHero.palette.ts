// Feature: dark-mode — co-located light/dark literal pairs for UpcomingTripHero.tsx.

import { DARK_TONAL, definePalette } from '../../theme/theme';

export const UPCOMING_TRIP_HERO = definePalette({
  light: {
    // Card border (B, violet).
    cardBorder: '#ebdff8',
    // Non-black shadow (rule 0).
    cardShadow: '#5b2a86',
    // Countdown tile: H-role violet, already dark in light mode (mode-invariant).
    countdownBg: '#3b1d60',
  },
  dark: {
    cardBorder: DARK_TONAL.violet.border,
    cardShadow: '#000000',
    countdownBg: '#3b1d60',
  },
});
