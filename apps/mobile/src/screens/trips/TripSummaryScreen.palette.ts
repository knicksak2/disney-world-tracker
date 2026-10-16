// Feature: dark-mode — co-located light/dark literal pairs for TripSummaryScreen.tsx.

import { DARK_TONAL, darkColor, definePalette } from '../../theme/theme';

/**
 * The celebratory hero card: a dark (H-role) gradient with white text and
 * gold accents. Already dark in light mode, so it is mode-invariant.
 */
export const SUMMARY_HERO = definePalette({
  light: {
    gradStart: '#3B185F',
    gradMid: '#5E227F',
    gradEnd: '#2A0845',
    // Gold icons and badge text on the hero.
    gold: '#FFD700',
    badgeBg: 'rgba(255, 215, 0, 0.15)',
    castleBg: 'rgba(255, 215, 0, 0.12)',
    castleBorder: 'rgba(255, 215, 0, 0.3)',
    congratsBg: 'rgba(255, 215, 0, 0.2)',
  },
  dark: {
    gradStart: '#3B185F',
    gradMid: '#5E227F',
    gradEnd: '#2A0845',
    gold: '#FFD700',
    badgeBg: 'rgba(255, 215, 0, 0.15)',
    castleBg: 'rgba(255, 215, 0, 0.12)',
    castleBorder: 'rgba(255, 215, 0, 0.3)',
    congratsBg: 'rgba(255, 215, 0, 0.2)',
  },
});

/**
 * Top-rated rank medals: gold / silver / bronze discs behind dark text
 * (G role), mode-invariant.
 */
export const SUMMARY_MEDAL = definePalette({
  light: {
    gold: '#FFD700',
    silver: '#C0C0C0',
    bronze: '#CD7F32',
    text: '#2A0845',
  },
  dark: {
    gold: '#FFD700',
    silver: '#C0C0C0',
    bronze: '#CD7F32',
    text: '#2A0845',
  },
});

/** Quick-stats icon discs on cards (rule 3: S tint + T icon per hue family). */
export const SUMMARY_STAT = definePalette({
  light: {
    // Violet family.
    violetBg: 'rgba(155, 81, 224, 0.15)',
    violetIcon: '#9B51E0',
    // Red family.
    redBg: 'rgba(255, 107, 107, 0.15)',
    redIcon: '#FF6B6B',
    // Green family.
    greenBg: 'rgba(46, 204, 113, 0.15)',
    greenIcon: '#2ECC71',
  },
  dark: {
    violetBg: DARK_TONAL.violet.tint,
    violetIcon: DARK_TONAL.violet.fg,
    redBg: DARK_TONAL.red.tint,
    redIcon: DARK_TONAL.red.fg,
    greenBg: DARK_TONAL.green.tint,
    greenIcon: DARK_TONAL.green.fg,
  },
});

/** Other non-token literals on themed surfaces (rule 3). */
export const SUMMARY_MISC = definePalette({
  light: {
    // Gold trophy icon on the screen / card surface (amber T).
    trophy: '#FFD700',
    // Superlative value pill (violet S).
    winnerValueBg: 'rgba(155, 81, 224, 0.15)',
    // Member "Top Ride" pill: heart icon (red T), tint (red S), text (pink T).
    favoriteHeart: '#FF2D55',
    favoriteBg: 'rgba(255, 45, 85, 0.08)',
    favoriteText: '#D81B60',
    // Category placeholder glyph on its category fill; white in dark so it
    // reads on every dark category fill (Property 22 fills are ≥ 4.5:1).
    thumbGlyph: '#5b2a86',
  },
  dark: {
    trophy: DARK_TONAL.amber.fg,
    winnerValueBg: DARK_TONAL.violet.tint,
    favoriteHeart: DARK_TONAL.red.fg,
    favoriteBg: DARK_TONAL.red.tint,
    favoriteText: DARK_TONAL.pink.fg,
    thumbGlyph: darkColor.textOnPrimary,
  },
});

/** Initials-avatar fills behind white initials (rule 3 F, by hue family). */
export const SUMMARY_AVATAR = definePalette({
  light: {
    a0: '#5856D6',
    a1: '#FF2D55',
    a2: '#AF52DE',
    a3: '#007AFF',
    a4: '#34C759',
    a5: '#FF9500',
    a6: '#5AC8FA',
    a7: '#FF3B30',
  },
  dark: {
    a0: DARK_TONAL.blue.fill,
    a1: DARK_TONAL.red.fill,
    a2: DARK_TONAL.violet.fill,
    a3: DARK_TONAL.sky.fill,
    a4: DARK_TONAL.green.fill,
    a5: DARK_TONAL.amber.fill,
    a6: DARK_TONAL.sky.fill,
    a7: DARK_TONAL.red.fill,
  },
});
