// Feature: dark-mode — co-located light/dark literal pairs for LiveWaitsScreen.tsx.
import { DARK_TONAL, definePalette } from '../../theme/theme';

/**
 * Row status dots — a wait-heat data scale (rule 3 V, mode-invariant; no text
 * sits on them). The "moderate" step is the `starRating` token (rule 1), read
 * from the theme instead.
 */
export const WAIT_STATUS = definePalette({
  light: {
    low: '#22c55e',
    high: '#ef4444',
    down: '#8e889b',
  },
  dark: {
    low: '#22c55e',
    high: '#ef4444',
    down: '#8e889b',
  },
});

export const LIVE_WAITS = definePalette({
  light: {
    // Active park chip shadow (rule 0 via rule 1a: `primary` read as shadowColor).
    parkChipActiveShadow: '#5b2a86',
    // Crowd radar card (violet, rule 3 S / B).
    crowdCardBg: '#faf8ff',
    crowdCardBorder: '#e9e4f5',
    // Lightning Lane row meta (orange, rule 3 T).
    llText: '#b45309',
  },
  dark: {
    parkChipActiveShadow: '#000000',
    crowdCardBg: DARK_TONAL.violet.tint,
    crowdCardBorder: DARK_TONAL.violet.border,
    llText: DARK_TONAL.orange.fg,
  },
});
