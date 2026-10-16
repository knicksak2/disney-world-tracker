// Feature: dark-mode — co-located light/dark literal pairs for ResortGuideSection.tsx.
import { DARK_TONAL, darkTheme, definePalette } from '../../theme/theme';

export const RESORT_GUIDE = definePalette({
  light: {
    // Card border (violet, rule 3 B) and card / dining-card shadows (rule 0).
    cardBorder: '#ded3f0',
    cardShadow: '#5b2a86',
    diningCardShadow: '#1f1235',
    // Headings (violet, rule 3 T).
    heading: '#190c2d',
    // Secondary copy (neutral L 0.1195 < 0.12, rule 3 T).
    bodyMuted: '#655d78',
    // Body copy / close glyph (violet, rule 3 T).
    body: '#372f4a',
    modalBody: '#4a3f60',
    // Tier pill (violet, rule 3 S / B / T) and dining tag pill (violet S).
    violetSubtleBg: '#f3e8ff',
    violetSubtleBorder: '#d8b4fe',
    tierText: '#7e22ce',
    // Lavender subtle fills (neutral S) and their hairlines (neutral B).
    lavenderBg: '#ede6f6',
    lavenderBorder: '#ede6f6',
    paleBg: '#fbf9fe',
    pillBg: '#f1edfa',
    // Category pill / expand toggle (violet, rule 3 B / S / B).
    pillBorder: '#e4daf5',
    toggleBg: '#f7f4fc',
    toggleBorder: '#e9e1f5',
    // Dining price (green, rule 3 T).
    price: '#16a34a',
    // Recreation chevron (neutral L 0.22, rule 3 T).
    chevron: '#8a7ba7',
    // Directions error (red, rule 3 T).
    error: '#e11d48',
    // Amenity sheet scrim (already dark in light mode, rule 3 H: mode-invariant).
    scrim: 'rgba(15, 10, 28, 0.6)',
  },
  dark: {
    cardBorder: DARK_TONAL.violet.border,
    cardShadow: '#000000',
    diningCardShadow: '#000000',
    // Text hierarchy (Requirement 9.13): ink → textPrimary, the #655d78 band → textSecondary.
    heading: darkTheme.color.textPrimary,
    bodyMuted: darkTheme.color.textSecondary,
    body: darkTheme.color.textPrimary,
    modalBody: darkTheme.color.textPrimary,
    violetSubtleBg: DARK_TONAL.violet.tint,
    violetSubtleBorder: DARK_TONAL.violet.border,
    tierText: DARK_TONAL.violet.fg,
    lavenderBg: darkTheme.color.surfaceAlt,
    lavenderBorder: darkTheme.color.border,
    paleBg: darkTheme.color.surfaceAlt,
    pillBg: darkTheme.color.surfaceAlt,
    pillBorder: DARK_TONAL.violet.border,
    toggleBg: DARK_TONAL.violet.tint,
    toggleBorder: DARK_TONAL.violet.border,
    price: DARK_TONAL.green.fg,
    chevron: darkTheme.color.textSecondary,
    error: DARK_TONAL.red.fg,
    scrim: 'rgba(15, 10, 28, 0.6)',
  },
});
