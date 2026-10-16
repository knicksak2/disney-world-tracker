// Feature: dark-mode — co-located light/dark literal pairs for ParkPassportCard.tsx.
import { DARK_TONAL, darkTheme, definePalette } from '../../theme/theme';

export const PASSPORT = definePalette({
  light: {
    // Card (amber, rule 3 S / B; rule 0 shadow).
    cardBg: '#fffcf5',
    cardBorder: '#ecd899',
    cardShadow: '#d4a017',
    // Ink copy on the passport (orange family, rule 3 T).
    inkDeep: '#78350f',
    inkMid: '#92400e',
    inkWarm: '#b45309',
    inkQuote: '#451a03',
    inkMuted: '#8c7853', // amber family (s 0.26), rule 3 T
    // Ribbon / pills / picker chips (amber, rule 3 S / B).
    ribbonBg: '#fef3c7',
    ribbonBorder: '#fde68a',
    sealBg: '#fffdf7',
    sealShadow: '#d4a017',
    quoteBorder: '#f3e5b8',
    quoteEmptyBorder: '#e5d9b5',
    timelineDivider: '#e4d3a2',
    timelineRowBorder: '#eee2be',
    noteCalloutBg: '#fffdf8',
    // Footnote (neutral L 0.169 >= 0.12, rule 3 T).
    footnote: '#78716c',
    // Visit date check (green, rule 3 T).
    visitDate: '#16a34a',
    // Active rating chip: amber fill behind white text (rule 3 F / orange B).
    pickerActiveBg: '#f59e0b',
    pickerActiveBorder: '#d97706',
    // Remove rating chip + delete spinner (red, rule 3 S / T).
    removeBg: '#fee2e2',
    removeText: '#dc2626',
    deleteSpinner: '#e11d48',
    // Tip editor card border (violet, rule 3 B) + close glyph (neutral T).
    tipBorder: '#dcd1ed',
    tipClose: '#655d78',
  },
  dark: {
    cardBg: DARK_TONAL.amber.tint,
    cardBorder: DARK_TONAL.amber.border,
    cardShadow: '#000000',
    inkDeep: DARK_TONAL.orange.fg,
    inkMid: DARK_TONAL.orange.fg,
    inkWarm: DARK_TONAL.orange.fg,
    inkQuote: DARK_TONAL.orange.fg,
    inkMuted: DARK_TONAL.amber.fg,
    ribbonBg: DARK_TONAL.amber.tint,
    ribbonBorder: DARK_TONAL.amber.border,
    sealBg: DARK_TONAL.amber.tint,
    sealShadow: '#000000',
    quoteBorder: DARK_TONAL.amber.border,
    quoteEmptyBorder: DARK_TONAL.amber.border,
    timelineDivider: DARK_TONAL.amber.border,
    timelineRowBorder: DARK_TONAL.amber.border,
    noteCalloutBg: DARK_TONAL.amber.tint,
    footnote: darkTheme.color.textSecondary,
    visitDate: DARK_TONAL.green.fg,
    pickerActiveBg: DARK_TONAL.amber.fill,
    pickerActiveBorder: DARK_TONAL.orange.border,
    removeBg: DARK_TONAL.red.tint,
    removeText: DARK_TONAL.red.fg,
    deleteSpinner: DARK_TONAL.red.fg,
    tipBorder: DARK_TONAL.violet.border,
    // The #655d78 band → textSecondary (Requirement 9.13).
    tipClose: darkTheme.color.textSecondary,
  },
});
