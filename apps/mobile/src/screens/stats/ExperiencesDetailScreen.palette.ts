// Feature: dark-mode — co-located light/dark literal pairs for ExperiencesDetailScreen.tsx.
import { DARK_TONAL, darkTheme, definePalette } from '../../theme/theme';

/**
 * The "Most Ridden" podium card is an H-role surface (already dark in light
 * mode, light text on it), so its fill and muted text are mode-invariant
 * (rule 3 H). Its `#3d1c5c` outline is a border against the themed screen
 * (rule 1: border on a surface → primaryFg in dark; light kept byte-identical).
 */
export const PODIUM = definePalette({
  light: {
    bg: '#201032',
    mutedText: '#b7a3d9',
    border: '#3d1c5c',
  },
  dark: {
    bg: '#201032',
    mutedText: '#b7a3d9',
    border: darkTheme.color.primaryFg,
  },
});

/** Personal-record icon tile for the marathon record (blue family, S / T). */
export const RECORD_ICON = definePalette({
  light: {
    marathonBg: '#eef2ff',
    marathonFg: '#3b5bdb',
  },
  dark: {
    marathonBg: DARK_TONAL.blue.tint,
    marathonFg: DARK_TONAL.blue.fg,
  },
});
