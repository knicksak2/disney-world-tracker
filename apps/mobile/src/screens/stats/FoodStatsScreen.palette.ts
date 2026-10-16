// Feature: dark-mode — co-located light/dark literal pairs for FoodStatsScreen.tsx.
import { DARK_TONAL, definePalette } from '../../theme/theme';

/**
 * The "Most Logged Dishes" podium card is an H-role surface (already dark in
 * light mode, light text on it): fill and muted text are mode-invariant
 * (rule 3 H). Its outline is a border against the themed screen (violet
 * family, rule 3 B).
 */
export const FOOD_PODIUM = definePalette({
  light: {
    bg: '#2b1430',
    mutedText: '#d6a3d9',
    border: '#4d2055',
  },
  dark: {
    bg: '#2b1430',
    mutedText: '#d6a3d9',
    border: DARK_TONAL.violet.border,
  },
});

/** Rated-dish star glyph on a card (amber family, rule 3 T). */
export const FOOD_RATING = definePalette({
  light: { star: '#f59f00' },
  dark: { star: DARK_TONAL.amber.fg },
});

/** Personal-record icon tile for the dish marathon (blue family, S / T). */
export const FOOD_RECORD_ICON = definePalette({
  light: {
    marathonBg: '#eef2ff',
    marathonFg: '#3b5bdb',
  },
  dark: {
    marathonBg: DARK_TONAL.blue.tint,
    marathonFg: DARK_TONAL.blue.fg,
  },
});
