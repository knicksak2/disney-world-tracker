// Feature: dark-mode — co-located light/dark literal pairs for LocationGroupSection.tsx.
import { DARK_TONAL, darkTheme, definePalette } from '../../theme/theme';

export const LOCATION = definePalette({
  light: {
    // Card border (violet, rule 3 B).
    cardBorder: '#ded3f0',
    // Card + directions-button shadow (rule 0: non-black shadowColor).
    shadow: '#5b2a86',
    // Static-map frame placeholder fill (violet, rule 3 S).
    mapFrameBg: '#f3edf9',
    // Route-brief title (violet, rule 3 T).
    briefTitle: '#190c2d',
    // Route-brief subtitle (neutral L 0.1195 < 0.12, rule 3 T).
    briefSub: '#655d78',
    // Hidden tag pills (violet, rule 3 S / B / T).
    tagPillBg: '#f1ecf9',
    tagPillBorder: '#e2d7f2',
    tagPillText: '#371756',
    // Walking callout (blue, rule 3 S / B / T).
    walkingBg: '#eef2ff',
    walkingBorder: '#c7d2fe',
    walkingText: '#4338ca',
    walkingBold: '#312e81',
    // Directions error (red, rule 3 T).
    errorText: '#e11d48',
  },
  dark: {
    cardBorder: DARK_TONAL.violet.border,
    shadow: '#000000',
    mapFrameBg: DARK_TONAL.violet.tint,
    // Text hierarchy (Requirement 9.13): ink → textPrimary, the #655d78 band → textSecondary.
    briefTitle: darkTheme.color.textPrimary,
    briefSub: darkTheme.color.textSecondary,
    tagPillBg: DARK_TONAL.violet.tint,
    tagPillBorder: DARK_TONAL.violet.border,
    tagPillText: DARK_TONAL.violet.fg,
    walkingBg: DARK_TONAL.blue.tint,
    walkingBorder: DARK_TONAL.blue.border,
    walkingText: DARK_TONAL.blue.fg,
    walkingBold: DARK_TONAL.blue.fg,
    errorText: DARK_TONAL.red.fg,
  },
});
