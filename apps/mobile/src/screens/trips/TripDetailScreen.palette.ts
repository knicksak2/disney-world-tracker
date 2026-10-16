// Feature: dark-mode — co-located light/dark literal pairs for TripDetailScreen.tsx.

import { DARK_TONAL, darkColor, definePalette } from '../../theme/theme';

/**
 * Per-section hue for the exported `HUB_SECTIONS` contract. The hub does not
 * render `HubSection.color`; the exported array keeps its light values so its
 * shape and the navigation-redesign snapshot stay unchanged. Any consumer that
 * paints with it reads `usePalette(HUB_SECTION_COLOR)[section.key]`.
 */
export const HUB_SECTION_COLOR = definePalette({
  light: {
    planned: '#5b2a86',
    schedule: '#7e57c2',
    reservations: '#f6c343',
    expenses: '#5b2a86',
    activity: '#f6c343',
    members: '#7e57c2',
    summary: '#6b6480',
  },
  dark: {
    planned: darkColor.primaryFg,
    schedule: darkColor.primaryLight,
    reservations: darkColor.accent,
    expenses: darkColor.primaryFg,
    activity: darkColor.accent,
    members: darkColor.primaryLight,
    summary: darkColor.textSecondary,
  },
});

/**
 * Crew avatar fills behind the white initial (role F). The first avatar
 * colour is the `primary` token and is read from the theme directly.
 */
export const CREW_AVATAR = definePalette({
  light: {
    // Rule 3 F, sky family.
    sky: '#2f80ed',
    // Rule 4: `success` as a solid fill behind white.
    success: '#2e9e6b',
    // Rule 3 F, amber family (hue 40).
    amber: '#f6a609',
    // Rule 4: `danger` as a solid fill behind white.
    danger: '#d6336c',
  },
  dark: {
    sky: DARK_TONAL.sky.fill,
    success: DARK_TONAL.green.fill,
    amber: DARK_TONAL.amber.fill,
    danger: DARK_TONAL.pink.fill,
  },
});

/** Live-glance cards: tag colours, card borders and the park-pill fallback. */
export const GLANCE = definePalette({
  light: {
    // Reservation tag icon + text (violet T).
    reservationTag: '#9333ea',
    // Schedule tag icon + text (sky T).
    scheduleTag: '#2f80ed',
    // Quiet "free time" tag icon + text (neutral T, L 0.116 → textPrimary).
    quietTag: '#6a5880',
    // Card borders (violet / sky / violet B).
    cardBorder: '#d9c4f5',
    reservationBorder: '#d9c4f5',
    scheduleBorder: '#b9d5fc',
    quietBorder: '#d6c6e8',
    // Park pill fallback tint for an unmapped park (violet S).
    parkPillFallbackBg: '#ebdff8',
  },
  dark: {
    reservationTag: DARK_TONAL.violet.fg,
    scheduleTag: DARK_TONAL.sky.fg,
    quietTag: darkColor.textPrimary,
    cardBorder: DARK_TONAL.violet.border,
    reservationBorder: DARK_TONAL.violet.border,
    scheduleBorder: DARK_TONAL.sky.border,
    quietBorder: DARK_TONAL.violet.border,
    parkPillFallbackBg: DARK_TONAL.violet.tint,
  },
});

/** Hub tiles whose hue is not a theme token (rule 3). */
export const HUB_TILE = definePalette({
  light: {
    // Reservations tile icon (amber T).
    reservationsIcon: '#b27a00',
    // Trip Activity tile badge text + icon (red T) and icon disc (red S).
    activityText: '#e8505b',
    activityIcon: '#e8505b',
    activityBg: 'rgba(232, 80, 91, 0.15)',
  },
  dark: {
    reservationsIcon: DARK_TONAL.amber.fg,
    activityText: DARK_TONAL.red.fg,
    activityIcon: DARK_TONAL.red.fg,
    activityBg: DARK_TONAL.red.tint,
  },
});

/** Past-trip recap hero subtitle on the `primaryDark` hero fill (violet T). */
export const PAST_HERO = definePalette({
  light: { subtitle: '#d9c4f5' },
  dark: { subtitle: DARK_TONAL.violet.fg },
});

/**
 * Vacation progress card: an H-role dark gradient (already dark in light
 * mode) and the text painted on it, mode-invariant.
 */
export const PROGRESS_CARD = definePalette({
  light: {
    gradStart: '#24143d',
    gradEnd: '#3e1e63',
    sub: '#e2d9f0',
  },
  dark: {
    gradStart: '#24143d',
    gradEnd: '#3e1e63',
    sub: '#e2d9f0',
  },
});
