// Feature: dark-mode — co-located light/dark literal pairs for PassportAndLoreLens.tsx.
import { DARK_TONAL, darkTheme, definePalette } from '../../theme/theme';

export const LORE = definePalette({
  light: {
    // Muted labels (neutral L 0.1195 < 0.12, rule 3 T).
    mutedText: '#655d78',
    // Dashed facets divider + insider-notes box (violet, rule 3 B / S).
    divider: '#ded1f1',
    insiderBg: '#f9f5fe',
    insiderBorder: '#ded1f1',
    // Dark-violet body copy (violet, rule 3 T).
    inkText: '#190c2d',
    // Community rating strip + score dial (amber S / B; orange T).
    guestStripBg: '#fffcf4',
    guestStripBorder: '#f6e6be',
    scoreDialBg: '#fef3c7',
    scoreDialBorder: '#fde68a',
    scoreNum: '#b45309',
    scoreLabel: '#92400e',
    // Tag cloud pills (violet, rule 3 S / B).
    cloudPillBg: '#f1ecf9',
    cloudPillBorder: '#e2d7f2',
  },
  dark: {
    // Text hierarchy (Requirement 9.13): the #655d78 band → textSecondary, ink → textPrimary.
    mutedText: darkTheme.color.textSecondary,
    divider: DARK_TONAL.violet.border,
    insiderBg: DARK_TONAL.violet.tint,
    insiderBorder: DARK_TONAL.violet.border,
    inkText: darkTheme.color.textPrimary,
    guestStripBg: DARK_TONAL.amber.tint,
    guestStripBorder: DARK_TONAL.amber.border,
    scoreDialBg: DARK_TONAL.amber.tint,
    scoreDialBorder: DARK_TONAL.amber.border,
    scoreNum: DARK_TONAL.orange.fg,
    scoreLabel: DARK_TONAL.orange.fg,
    cloudPillBg: DARK_TONAL.violet.tint,
    cloudPillBorder: DARK_TONAL.violet.border,
  },
});
