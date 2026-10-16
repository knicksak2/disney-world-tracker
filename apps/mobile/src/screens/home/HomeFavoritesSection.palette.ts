// Feature: dark-mode — co-located light/dark literal pairs for HomeFavoritesSection.tsx.

import { DARK_TONAL, darkColor, definePalette } from '../../theme/theme';

export const HOME_FAVORITES = definePalette({
  light: {
    // Live-status badges: background (S), border (B), text/icon (T).
    downBg: '#fef2f2',
    downBorder: '#fee2e2',
    downText: '#dc2626',
    closedBg: '#f1f5f9',
    closedBorder: '#e2e8f0',
    closedText: '#64748b',
    walkOnBg: '#dcfce7',
    walkOnBorder: '#bbf7d0',
    walkOnText: '#15803d',
    shortBg: '#dcfce7',
    shortBorder: '#bbf7d0',
    shortText: '#15803d',
    moderateBg: '#fef3c7',
    moderateBorder: '#fde68a',
    moderateText: '#b45309',
    heavyBg: '#fee2e2',
    heavyBorder: '#fecaca',
    heavyText: '#b91c1c',
    // Heart glyphs (T, red family).
    pillHeart: '#e8505b',
    sectionHeart: '#e8505b',
    // Favorite pill border (B, violet).
    pillBorder: '#eee6f7',
  },
  dark: {
    downBg: DARK_TONAL.red.tint,
    downBorder: DARK_TONAL.red.border,
    downText: DARK_TONAL.red.fg,
    closedBg: darkColor.surfaceAlt,
    closedBorder: darkColor.border,
    closedText: darkColor.textSecondary,
    walkOnBg: DARK_TONAL.green.tint,
    walkOnBorder: DARK_TONAL.green.border,
    walkOnText: DARK_TONAL.green.fg,
    shortBg: DARK_TONAL.green.tint,
    shortBorder: DARK_TONAL.green.border,
    shortText: DARK_TONAL.green.fg,
    moderateBg: DARK_TONAL.amber.tint,
    moderateBorder: DARK_TONAL.amber.border,
    moderateText: DARK_TONAL.orange.fg,
    heavyBg: DARK_TONAL.red.tint,
    heavyBorder: DARK_TONAL.red.border,
    heavyText: DARK_TONAL.red.fg,
    pillHeart: DARK_TONAL.red.fg,
    sectionHeart: DARK_TONAL.red.fg,
    pillBorder: DARK_TONAL.violet.border,
  },
});
