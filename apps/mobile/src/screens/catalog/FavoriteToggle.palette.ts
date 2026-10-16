// Feature: dark-mode — co-located light/dark literal pairs for FavoriteToggle.tsx.
import { DARK_TONAL, definePalette } from '../../theme/theme';

/** Filled heart icon (red family, rule 3 T). */
export const HEART = definePalette({
  light: { favorited: '#FF2D55' },
  dark: { favorited: DARK_TONAL.red.fg },
});
