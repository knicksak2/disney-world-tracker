// Feature: dark-mode — co-located light/dark literal pairs for GroupFavoritesSection.tsx.

import { DARK_TONAL, definePalette } from '../../theme/theme';

/** Heart icons, the favoriting-count pill and its text (red family, conversion rule 3). */
export const GROUP_FAVORITES = definePalette({
  light: {
    // Heart icons and count text on the surface / count pill (T).
    heart: '#e11d48',
    // Count pill background (S).
    countBg: '#ffe4e6',
  },
  dark: {
    heart: DARK_TONAL.red.fg,
    countBg: DARK_TONAL.red.tint,
  },
});
