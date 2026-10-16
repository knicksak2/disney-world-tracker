// Feature: dark-mode — co-located light/dark literal pairs for ParkDestinationScreen.tsx.
import { DARK_TONAL, darkTheme, definePalette } from '../../theme/theme';

export const PARK = definePalette({
  light: {
    // Tab track, favorites pill, filters button, count badge, reset button
    // (lavender subtle, neutral S).
    lavenderBg: '#F1EDFB',
    // Favorites toggle, active (red, rule 3 S / B / T).
    favoritesActiveBg: '#FFF1F2',
    favoritesActiveBorder: '#FECDD3',
    favoritesActiveText: '#E11D48',
    favoritesActiveIcon: '#FF2D55',
    // Idle filter / modal chips (neutral S, neutral B L 0.80, neutral T L 0.17).
    chipBg: '#F8FAFC',
    chipBorder: '#E2E8F0',
    chipText: '#64748B',
    // Selected filter chip (violet, rule 3 S / B / T).
    chipActiveBg: '#F3E8FF',
    chipActiveBorder: '#A855F7',
    chipActiveText: '#7E22CE',
    // Filters-button border (violet, rule 3 B).
    filterButtonBorder: '#D8B4FE',
    // Reset chip (red, rule 3 S / B / T).
    resetChipBg: '#FEE2E2',
    resetChipBorder: '#FCA5A5',
    resetChipText: '#B91C1C',
    // Height-requirement Badge text (red, rule 3 T).
    heightBadge: '#B91C1C',
    // "Visited" disc behind a white check (green, rule 3 F).
    visitedFill: '#10B981',
  },
  dark: {
    lavenderBg: darkTheme.color.surfaceAlt,
    favoritesActiveBg: DARK_TONAL.red.tint,
    favoritesActiveBorder: DARK_TONAL.red.border,
    favoritesActiveText: DARK_TONAL.red.fg,
    favoritesActiveIcon: DARK_TONAL.red.fg,
    chipBg: darkTheme.color.surfaceAlt,
    chipBorder: darkTheme.color.border,
    chipText: darkTheme.color.textSecondary,
    chipActiveBg: DARK_TONAL.violet.tint,
    chipActiveBorder: DARK_TONAL.violet.border,
    chipActiveText: DARK_TONAL.violet.fg,
    filterButtonBorder: DARK_TONAL.violet.border,
    resetChipBg: DARK_TONAL.red.tint,
    resetChipBorder: DARK_TONAL.red.border,
    resetChipText: DARK_TONAL.red.fg,
    heightBadge: DARK_TONAL.red.fg,
    visitedFill: DARK_TONAL.green.fill,
  },
});

/**
 * Hero overlay, hero subtitle and the filter-sheet scrim: all already dark in
 * light mode or drawn on the destination gradient (rule 3 H), so mode-invariant.
 */
const HERO_VALUES = {
  heroVeil: 'rgba(29, 18, 51, 0.65)',
  heroSubtitle: '#E5DEF5',
  scrim: 'rgba(15, 10, 28, 0.5)',
} as const;

export const PARK_HERO = definePalette({
  light: HERO_VALUES,
  dark: HERO_VALUES,
});

/** Fallback destination gradient (artwork — mode-invariant, rule 6). */
const ART_VALUES = {
  fallback0: '#280b45',
  fallback1: '#5b2a86',
  fallback2: '#7e57c2',
} as const;

// artwork — mode-invariant
export const PARK_ART = definePalette({
  light: ART_VALUES,
  dark: ART_VALUES,
});
