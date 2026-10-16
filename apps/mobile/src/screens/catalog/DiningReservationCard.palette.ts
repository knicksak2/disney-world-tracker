// Feature: dark-mode — co-located light/dark literal pairs for DiningReservationCard.tsx.
import { DARK_TONAL, darkTheme, definePalette } from '../../theme/theme';

export const DINING = definePalette({
  light: {
    // Card border (violet, rule 3 B) and shadow (rule 0).
    cardBorder: '#ded3f0',
    cardShadow: '#5b2a86',
    // Dark-violet headings (violet, rule 3 T).
    inkText: '#190c2d',
    // Open / closed pulse badge (green / red, rule 3 S / B / T).
    openBg: '#ecfdf5',
    openBorder: 'rgba(22, 163, 74, 0.25)',
    openDot: '#16a34a',
    openText: '#16a34a',
    closedBg: '#fef2f2',
    closedBorder: 'rgba(239, 68, 68, 0.25)',
    closedDot: '#ef4444',
    closedText: '#ef4444',
    // Status box (lavender subtle, rule 3 neutral S / B) + muted copy (neutral T).
    statusBg: '#fbf9fe',
    statusBorder: '#ede6f6',
    mutedText: '#655d78',
    // Reserve button: solid orange behind white text (rule 3 F, rule 0 shadow).
    reserveBg: '#d97706',
    reserveShadow: '#d97706',
    // Dashed dish separator (violet, rule 3 B).
    dishSeparator: '#e2d9f3',
    // Log-dish button shadow (rule 0).
    logDishShadow: '#5b2a86',
    // Secondary dish buttons (lavender subtle S; violet B).
    secondaryBg: '#fbf9fe',
    secondaryBorder: '#dcd1ed',
  },
  dark: {
    cardBorder: DARK_TONAL.violet.border,
    cardShadow: '#000000',
    // Text hierarchy (Requirement 9.13): ink → textPrimary, the #655d78 band → textSecondary.
    inkText: darkTheme.color.textPrimary,
    openBg: DARK_TONAL.green.tint,
    openBorder: DARK_TONAL.green.border,
    openDot: DARK_TONAL.green.fg,
    openText: DARK_TONAL.green.fg,
    closedBg: DARK_TONAL.red.tint,
    closedBorder: DARK_TONAL.red.border,
    closedDot: DARK_TONAL.red.fg,
    closedText: DARK_TONAL.red.fg,
    statusBg: darkTheme.color.surfaceAlt,
    statusBorder: darkTheme.color.border,
    mutedText: darkTheme.color.textSecondary,
    reserveBg: DARK_TONAL.orange.fill,
    reserveShadow: '#000000',
    dishSeparator: DARK_TONAL.violet.border,
    logDishShadow: '#000000',
    secondaryBg: darkTheme.color.surfaceAlt,
    secondaryBorder: DARK_TONAL.violet.border,
  },
});
