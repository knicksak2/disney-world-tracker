// Feature: dark-mode — co-located light/dark literal pairs for ActiveTripShortcut.tsx.

import { DARK_TONAL, definePalette } from '../theme/theme';

/** The green "active vacation" hero card (green family, conversion rule 3). */
export const ACTIVE_TRIP = definePalette({
  light: {
    // Card gradient end stop (S) — the start stop is the `surface` token.
    cardGradientEnd: '#f0fdf4',
    // Card border (B).
    cardBorder: '#86efac',
    // Non-black shadows (rule 0).
    cardShadow: '#22c55e',
    liveDotShadow: '#22c55e',
    parkTileShadow: '#5b2a86',
    // Pulsing live dot (T, an indicator mark on the card).
    liveDot: '#22c55e',
    // "ACTIVE VACATION" tag and time-pill text (T).
    liveText: '#15803d',
    // "Next:" line (T).
    nextText: '#166534',
    // Time pill (S).
    timePillBg: '#dcfce7',
    // Chooser modal scrim (rule 2, textPrimary-tinted scrim).
    scrim: 'rgba(31, 18, 53, 0.5)',
  },
  dark: {
    cardGradientEnd: DARK_TONAL.green.tint,
    cardBorder: DARK_TONAL.green.border,
    cardShadow: '#000000',
    liveDotShadow: '#000000',
    parkTileShadow: '#000000',
    liveDot: DARK_TONAL.green.fg,
    liveText: DARK_TONAL.green.fg,
    nextText: DARK_TONAL.green.fg,
    timePillBg: DARK_TONAL.green.tint,
    scrim: 'rgba(0, 0, 0, 0.5)',
  },
});

// artwork — mode-invariant: the per-park tile gradients behind the park emoji.
export const PARK_TILE = definePalette({
  light: {
    mkStart: '#7e57c2',
    mkEnd: '#5b2a86',
    epcotStart: '#3b82f6',
    epcotEnd: '#1d4ed8',
    hsStart: '#f43f5e',
    hsEnd: '#be123c',
    akStart: '#22c55e',
    akEnd: '#15803d',
  },
  dark: {
    mkStart: '#7e57c2',
    mkEnd: '#5b2a86',
    epcotStart: '#3b82f6',
    epcotEnd: '#1d4ed8',
    hsStart: '#f43f5e',
    hsEnd: '#be123c',
    akStart: '#22c55e',
    akEnd: '#15803d',
  },
});
