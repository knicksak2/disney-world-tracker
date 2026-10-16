// Feature: dark-mode — co-located light/dark literal pairs for ShowtimesCard.tsx.
import { DARK_TONAL, darkTheme, definePalette } from '../../theme/theme';

export const SHOWTIMES = definePalette({
  light: {
    // Card border (violet, rule 3 B) and shadow (rule 0).
    cardBorder: '#ded3f0',
    cardShadow: '#5b2a86',
    // Card title (violet, rule 3 T).
    title: '#190c2d',
    // "Next at" pulse badge (green, rule 3 S / B / T).
    pulseBg: '#ecfdf5',
    pulseBorder: 'rgba(22, 163, 74, 0.25)',
    pulseDotRing: 'rgba(22, 163, 74, 0.2)',
    pulseDot: '#16a34a',
    pulseText: '#16a34a',
    // Non-standard showtime type notice (violet, rule 3 S / B / T).
    typeIcon: '#7e22ce',
    typeBg: '#f5eeff',
    typeBorder: '#e9d5ff',
    typeText: '#7e22ce',
    // Past pill (neutral, rule 3 S / B / T).
    pastBg: '#f3f4f6',
    pastBorder: '#e5e7eb',
    pastText: '#9ca3af',
    // Next pill: solid green fill behind white text (rule 3 F / B, rule 0 shadow).
    nextBg: '#16a34a',
    nextBorder: '#15803d',
    nextShadow: '#16a34a',
    // Future pill (violet, rule 3 B / T).
    futureBorder: '#dcd1ed',
    futureText: '#190c2d',
  },
  dark: {
    cardBorder: DARK_TONAL.violet.border,
    cardShadow: '#000000',
    title: DARK_TONAL.violet.fg,
    pulseBg: DARK_TONAL.green.tint,
    pulseBorder: DARK_TONAL.green.border,
    pulseDotRing: DARK_TONAL.green.tint,
    pulseDot: DARK_TONAL.green.fg,
    pulseText: DARK_TONAL.green.fg,
    typeIcon: DARK_TONAL.violet.fg,
    typeBg: DARK_TONAL.violet.tint,
    typeBorder: DARK_TONAL.violet.border,
    typeText: DARK_TONAL.violet.fg,
    pastBg: darkTheme.color.surfaceAlt,
    pastBorder: darkTheme.color.border,
    pastText: darkTheme.color.textSecondary,
    nextBg: DARK_TONAL.green.fill,
    nextBorder: DARK_TONAL.green.border,
    nextShadow: '#000000',
    futureBorder: DARK_TONAL.violet.border,
    futureText: DARK_TONAL.violet.fg,
  },
});
