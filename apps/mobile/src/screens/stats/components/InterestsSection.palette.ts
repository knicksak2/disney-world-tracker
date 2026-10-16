// Feature: dark-mode — co-located light/dark literal pairs for InterestsSection.tsx.
import { DARK_TONAL, definePalette } from '../../../theme/theme';

/**
 * Facet-row accent cycle (dot + bar marks on a surface, rule 3 role T). The
 * purple stop is the `primaryLight` token and is read from the theme instead.
 */
export const FACET_ACCENT = definePalette({
  light: {
    blue: '#2f80ed',
    teal: '#17a2b8',
    amber: '#f6a609',
    red: '#e8505b',
    green: '#3fa34d',
  },
  dark: {
    blue: DARK_TONAL.sky.fg,
    teal: DARK_TONAL.teal.fg,
    amber: DARK_TONAL.amber.fg,
    red: DARK_TONAL.red.fg,
    green: DARK_TONAL.green.fg,
  },
});
