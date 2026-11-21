// Co-located light/dark palette tokens for ZeroPinsStarterCard.tsx.

import { DARK_TONAL, definePalette } from '../../theme/theme';

export const ZERO_PINS_STARTER = definePalette({
  light: {
    cardBg: '#faf5ff',
    cardBorder: '#ddd6fe',
    iconBg: '#ede9fe',
    iconColor: '#6d28d9',
    badgeBg: '#fef3c7',
    badgeBorder: '#fde68a',
    badgeText: '#b45309',
    ctaBg: '#6d28d9',
    ctaText: '#ffffff',
  },
  dark: {
    cardBg: DARK_TONAL.violet.tint,
    cardBorder: DARK_TONAL.violet.border,
    iconBg: '#2e1065',
    iconColor: DARK_TONAL.violet.fg,
    badgeBg: DARK_TONAL.amber.tint,
    badgeBorder: DARK_TONAL.amber.border,
    badgeText: DARK_TONAL.amber.fg,
    ctaBg: DARK_TONAL.violet.fill,
    ctaText: '#ffffff',
  },
});
