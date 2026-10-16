// Feature: dark-mode — co-located light/dark literal pairs for ResortsDirectoryScreen.tsx.
import { DARK_TONAL, darkTheme, definePalette } from '../../theme/theme';

export const RESORTS = definePalette({
  light: {
    // Lavender subtle fills (neutral S) and hairlines (neutral B, L >= 0.75).
    lavenderBg: '#f1edfa',
    lavenderLine: '#f1edfa',
    cardBorder: '#e9e3f5',
    hotelPillBg: '#f5f3ff',
    rowSelectedBg: '#f5f3ff',
    // Neutral icon disc in the hotel picker (neutral S, L 0.90).
    rowIconBg: '#f3f4f6',
    // Sheet drag handle (neutral B, L 0.66).
    handle: '#cbd5e1',
    // Hotel card shadow (rule 0).
    cardShadow: '#371556',
    // Tier badges on the hero photo: solid fills behind white text (rule 3 F).
    tierDeluxe: '#d97706',
    tierVilla: '#7c3aed',
    tierModerate: '#0284c7',
    tierValue: '#9333ea',
    // Favorite heart, active (red, rule 3 T).
    heartActive: '#ef4444',
    // Transit metric pill (sky, rule 3 S / B / T).
    transitBg: '#f0f9ff',
    transitBorder: '#bae6fd',
    transitText: '#0284c7',
    // "View Resort Page" CTA (violet, rule 3 S / B).
    ctaBg: '#f8f5fd',
    ctaBorder: 'rgba(106, 27, 154, 0.2)',
    // Violet tags / placeholders (violet, rule 3 S / T).
    violetTagBg: '#ede9fe',
    violetText: '#6d28d9',
    // Hotel filter pill (violet B) and its selected state (violet F).
    hotelPillBorder: '#ddd6fe',
    hotelPillActive: '#6d28d9',
    // Green badges (green, rule 3 S / T).
    greenTagBg: '#dcfce7',
    greenText: '#15803d',
    // Red badge (red, rule 3 S / T).
    redTagBg: '#fee2e2',
    redText: '#b91c1c',
  },
  dark: {
    lavenderBg: darkTheme.color.surfaceAlt,
    lavenderLine: darkTheme.color.border,
    cardBorder: darkTheme.color.border,
    hotelPillBg: darkTheme.color.surfaceAlt,
    rowSelectedBg: darkTheme.color.surfaceAlt,
    rowIconBg: darkTheme.color.surfaceAlt,
    handle: darkTheme.color.borderStrong,
    cardShadow: '#000000',
    // On-photo overlay — mode-invariant (Requirement 9.14): the hotel photo
    // does not change with the scheme, so neither do the badges drawn on it.
    tierDeluxe: '#d97706',
    tierVilla: '#7c3aed',
    tierModerate: '#0284c7',
    tierValue: '#9333ea',
    heartActive: DARK_TONAL.red.fg,
    transitBg: DARK_TONAL.sky.tint,
    transitBorder: DARK_TONAL.sky.border,
    transitText: DARK_TONAL.sky.fg,
    ctaBg: DARK_TONAL.violet.tint,
    ctaBorder: DARK_TONAL.violet.border,
    violetTagBg: DARK_TONAL.violet.tint,
    violetText: DARK_TONAL.violet.fg,
    hotelPillBorder: DARK_TONAL.violet.border,
    hotelPillActive: DARK_TONAL.violet.fill,
    greenTagBg: DARK_TONAL.green.tint,
    greenText: DARK_TONAL.green.fg,
    redTagBg: DARK_TONAL.red.tint,
    redText: DARK_TONAL.red.fg,
  },
});

/**
 * Hotel-picker tier colours: badge text (rule 3 T) and, suffixed with the
 * `18` alpha (rule 2a), the badge tint. Every value is `#rrggbb` in both
 * schemes so the suffix stays a valid 8-digit hex.
 */
export const RESORT_TIER = definePalette({
  light: {
    deluxe: '#7c3aed',
    moderate: '#059669',
    value: '#2563eb',
  },
  dark: {
    deluxe: DARK_TONAL.violet.fg,
    moderate: DARK_TONAL.green.fg,
    value: DARK_TONAL.blue.fg,
  },
});

/**
 * Resort hero backstop behind the photo (already dark in light mode, rule 3 H)
 * and the themed resort gradient (artwork — mode-invariant, rule 6).
 */
const HERO_VALUES = {
  heroBackstop: '#371556',
  gradient0: '#1d0a2d',
  gradient1: '#4a154b',
  gradient2: '#7b1fa2',
} as const;

// artwork — mode-invariant
export const RESORTS_ART = definePalette({
  light: HERO_VALUES,
  dark: HERO_VALUES,
});
