// Co-located light/dark palette tokens for StartHereCard.tsx.

import { DARK_TONAL, definePalette } from '../../theme/theme';

export const START_HERE_CARD = definePalette({
  light: {
    cardBg: '#ffffff',
    cardBorder: '#ddd6fe',
    badgeBg: '#f3e8ff',
    badgeText: '#6b21a8',
    trackBg: '#ede9fe',
    doneRowBg: '#f0fdf4',
    doneText: '#15803d',
  },
  dark: {
    cardBg: DARK_TONAL.violet.tint,
    cardBorder: DARK_TONAL.violet.border,
    badgeBg: '#2e1065',
    badgeText: DARK_TONAL.violet.fg,
    trackBg: '#2e2a42',
    doneRowBg: DARK_TONAL.green.tint,
    doneText: DARK_TONAL.green.fg,
  },
});
