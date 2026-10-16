// Feature: dark-mode — co-located light/dark literal pairs for HighlightCard.tsx.
import { DARK_TONAL, definePalette } from '../../../theme/theme';

/**
 * Non-token icon-tile colours (rule 3). The other tiles use theme tokens
 * (`surfaceAlt`, `warningSurface`, `primaryFg`, `accentDark`, `primaryLight`,
 * `danger`).
 */
export const HIGHLIGHT_ICON = definePalette({
  light: {
    // Experiences tile: sky family, S (tile bg) / T (glyph).
    experiencesBg: '#e8f4ff',
    experiencesFg: '#2f80ed',
    // Food stats tile: pink family, S (tile bg).
    foodStatsBg: '#fbeaf0',
  },
  dark: {
    experiencesBg: DARK_TONAL.sky.tint,
    experiencesFg: DARK_TONAL.sky.fg,
    foodStatsBg: DARK_TONAL.pink.tint,
  },
});
