// Feature: dark-mode — co-located light/dark literal pairs for TripFeedScreen.tsx.

import { DARK_TONAL, darkColor, definePalette } from '../../theme/theme';

/** Reaction tints that are not theme tokens (rule 3 T). */
export const REACTION_TINT = definePalette({
  light: {
    // Like (sky family).
    like: '#2f80ed',
    // Celebrate (amber family, hue 40).
    celebrate: '#f6a609',
  },
  dark: {
    like: DARK_TONAL.sky.fg,
    celebrate: DARK_TONAL.amber.fg,
  },
});

/** Feed-item type icon tones that are not theme tokens (rule 3 T). */
export const FEED_TONE = definePalette({
  light: {
    // member_joined (sky family).
    memberJoined: '#2f80ed',
    // rating_recorded (amber family).
    ratingRecorded: '#f6a609',
  },
  dark: {
    memberJoined: DARK_TONAL.sky.fg,
    ratingRecorded: DARK_TONAL.amber.fg,
  },
});

/** Rode-with tag chip states that are not theme tokens (rule 3). */
export const RODE_WITH = definePalette({
  light: {
    // Confirmed chip text (green T).
    confirmedFg: '#27855a',
    // Pending chip tint (amber S) and text (amber T).
    pendingBg: 'rgba(246, 166, 9, 0.16)',
    pendingFg: '#9a6500',
  },
  dark: {
    confirmedFg: DARK_TONAL.green.fg,
    pendingBg: DARK_TONAL.amber.tint,
    pendingFg: DARK_TONAL.amber.fg,
  },
});

/** Initials-avatar fills behind white initials (role F, by hue family). */
export const FEED_AVATAR = definePalette({
  light: {
    // Rule 1: `#7e57c2` as a fill behind white text.
    a0: '#7e57c2',
    // Rule 3 F, sky.
    a1: '#2f80ed',
    // Rule 4: `success` as a fill behind white.
    a2: '#2e9e6b',
    // Rule 3 F, red.
    a3: '#e8505b',
    // Rule 3 F, amber.
    a4: '#f6a609',
    // Rule 3 F, teal.
    a5: '#00897b',
    // Rule 3 F, violet.
    a6: '#8e24aa',
    // Rule 4: `danger` as a fill behind white.
    a7: '#d6336c',
  },
  dark: {
    a0: DARK_TONAL.violet.fill,
    a1: DARK_TONAL.sky.fill,
    a2: DARK_TONAL.green.fill,
    a3: DARK_TONAL.red.fill,
    a4: DARK_TONAL.amber.fill,
    a5: DARK_TONAL.teal.fill,
    a6: DARK_TONAL.violet.fill,
    a7: DARK_TONAL.pink.fill,
  },
});

/** Remaining non-token literals on themed surfaces. */
export const FEED_MISC = definePalette({
  light: {
    // "Log a ride or snack" card fill (violet S) and border (violet B).
    ctaBg: '#fcfaff',
    ctaBorder: '#ece4f6',
    // Log composer scrim (rule 2 exception: textPrimary-tinted scrim).
    scrim: 'rgba(31, 18, 53, 0.5)',
    // Category placeholder glyph on its category fill; white in dark so it
    // reads on every dark category fill (Property 22 fills are ≥ 4.5:1).
    thumbGlyph: '#5b2a86',
  },
  dark: {
    ctaBg: DARK_TONAL.violet.tint,
    ctaBorder: DARK_TONAL.violet.border,
    scrim: 'rgba(0, 0, 0, 0.5)',
    thumbGlyph: darkColor.textOnPrimary,
  },
});
