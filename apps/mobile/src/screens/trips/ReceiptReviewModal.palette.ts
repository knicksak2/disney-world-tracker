// Feature: dark-mode — co-located light/dark literal pairs for ReceiptReviewModal.tsx.
import { DARK_TONAL, darkColor, definePalette } from '../../theme/theme';

export const RECEIPT_REVIEW = definePalette({
  light: {
    // Scan error box tint (red family, rule 3 S).
    errorBg: 'rgba(232, 80, 91, 0.15)',
    // Detected-subtotal banner tint (indigo → blue family, rule 3 S).
    subtotalBg: 'rgba(99, 102, 241, 0.12)',
    // Active assignee chip tint (blue family, rule 3 S).
    assigneeActiveBg: 'rgba(99, 102, 241, 0.15)',
    // Menu-match suggestion chip tint (amber family, rule 3 S).
    menuSuggestionBg: 'rgba(251, 191, 36, 0.15)',
    // Alcohol wine-glass icon when on (orange family, rule 3 T).
    alcoholIcon: '#d97706',
    // Charge-line Badge colours (Badge text + its 14 % tint, rule 3 T).
    discountBadge: '#10b981',
    taxBadge: '#6366f1',
    // Demo-mode notice banner: lavender-subtle bg (neutral S), violet border (B),
    // violet text and sparkle icon (T).
    demoBg: '#f5f3ff',
    demoBorder: '#ddd6fe',
    demoText: '#6d28d9',
    demoIcon: '#7c3aed',
  },
  dark: {
    errorBg: DARK_TONAL.red.tint,
    subtotalBg: DARK_TONAL.blue.tint,
    assigneeActiveBg: DARK_TONAL.blue.tint,
    menuSuggestionBg: DARK_TONAL.amber.tint,
    alcoholIcon: DARK_TONAL.orange.fg,
    discountBadge: DARK_TONAL.green.fg,
    taxBadge: DARK_TONAL.blue.fg,
    demoBg: darkColor.surfaceAlt,
    demoBorder: DARK_TONAL.violet.border,
    demoText: DARK_TONAL.violet.fg,
    demoIcon: DARK_TONAL.violet.fg,
  },
});
