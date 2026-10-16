// Feature: dark-mode — co-located light/dark literal pairs for QuickSpecsRow.tsx.
import { DARK_TONAL, definePalette } from '../../theme/theme';

export const SPECS = definePalette({
  light: {
    // Row border (violet, rule 3 B) and shadow (rule 0).
    rowBorder: 'rgba(230, 222, 242, 0.9)',
    rowShadow: '#190c2d',
    // Chip divider (violet, rule 3 B).
    separator: '#ddd2ee',
    // Chip label (violet, rule 3 T).
    specText: '#190c2d',
    // Climate labels (sky / orange, rule 3 T).
    indoorText: '#0284c7',
    outdoorText: '#d97706',
  },
  dark: {
    rowBorder: DARK_TONAL.violet.border,
    rowShadow: '#000000',
    separator: DARK_TONAL.violet.border,
    specText: DARK_TONAL.violet.fg,
    indoorText: DARK_TONAL.sky.fg,
    outdoorText: DARK_TONAL.orange.fg,
  },
});
