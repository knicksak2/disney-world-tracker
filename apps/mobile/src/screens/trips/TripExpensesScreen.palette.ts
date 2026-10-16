// Feature: dark-mode — co-located light/dark literal pairs for TripExpensesScreen.tsx.
import { DARK_TONAL, darkColor, definePalette } from '../../theme/theme';

/**
 * Expense category avatar tint (S) and foreground (T). Every `*Fg` value is
 * alpha-suffixed by the screen (`catMeta.fg + '33'`, rule 2a), so each one is a
 * 6-digit `#rrggbb` hex in both schemes.
 */
export const CATEGORY_META = definePalette({
  light: {
    hotelBg: '#f3e8ff',
    hotelFg: '#7e22ce',
    ticketsBg: '#fef3c7',
    ticketsFg: '#b45309',
    diningBg: '#ffe4e6',
    diningFg: '#e11d48',
    shoppingBg: '#e0f2fe',
    shoppingFg: '#0284c7',
    transportBg: '#f0fdf4',
    transportFg: '#15803d',
    otherBg: '#f1f5f9',
    otherFg: '#475569',
  },
  dark: {
    hotelBg: DARK_TONAL.violet.tint,
    hotelFg: DARK_TONAL.violet.fg,
    ticketsBg: DARK_TONAL.amber.tint,
    ticketsFg: DARK_TONAL.orange.fg,
    diningBg: DARK_TONAL.red.tint,
    diningFg: DARK_TONAL.red.fg,
    shoppingBg: DARK_TONAL.sky.tint,
    shoppingFg: DARK_TONAL.sky.fg,
    transportBg: DARK_TONAL.green.tint,
    transportFg: DARK_TONAL.green.fg,
    otherBg: darkColor.surfaceAlt,
    otherFg: darkColor.textPrimary,
  },
});

export const EXPENSES = definePalette({
  light: {
    // Segmented tab switcher: lavender-subtle track (neutral S), violet border (B),
    // active-pill shadow (rule 0).
    tabTrack: '#ede6f6',
    tabTrackBorder: '#dcd1ec',
    tabActiveShadow: '#5b2a86',
    // Idle tab label/icon/badge text (neutral T, L < 0.12).
    tabIdleText: '#655d78',
    // Active tab pill fill (today's `t.color.surface` in light).
    tabActiveBg: '#ffffff',
    // Tab count badges (violet S).
    tabBadgeActiveBg: '#f3e8ff',
    tabBadgeIdleBg: '#ded5ea',
    // Neutral slate text and icons (T): L < 0.12 → textPrimary band.
    inkText: '#0f172a',
    slate800Text: '#1e293b',
    slate700Text: '#334155',
    slate600Text: '#475569',
    // Neutral slate text (T): L ≥ 0.12 → textSecondary band.
    slate500Text: '#64748b',
    slate400Text: '#94a3b8',
    // Deep-indigo names on white cards (H-listed violet, used as T).
    indigoText: '#1e1b4b',
    // Neutral subtle wells: chips, stat row, debtor chips, action buttons (S).
    subtleWellBg: '#f8fafc',
    greyPillBg: '#f1f5f9',
    // Neutral hairlines and dividers (B, L ≥ 0.75).
    hairline: '#e2e8f0',
    softDivider: '#f1f5f9',
    // Neutral lines on a surface (B, L < 0.75): filter divider, flow arrow line.
    strongLine: '#cbd5e1',
    // Neutral avatar fill behind white initials (F).
    neutralAvatarFill: '#94a3b8',
    // Violet card borders (B) and card shadows (rule 0).
    violetCardBorder: '#ede9fe',
    violetBorderStrong: '#c4b5fd',
    violetButtonBorder: '#ddd6fe',
    heroShadow: '#7c3aed',
    expenseShadow: '#1e1b4b',
    pairwiseShadow: '#241242',
    settlementShadow: '#16a34a',
    // Expanded expense card tint (violet S).
    expandedBg: '#faf8fe',
    // Violet subtle wells (lavender-subtle S): payer badge, statement button.
    violetWellBg: '#f5f3ff',
    // Selected payer chip (violet S).
    payerSelectedBg: '#ede9fe',
    // Violet text and icons (T).
    violetText: '#7c3aed',
    violetDeepText: '#6d28d9',
    expenseBadgeText: '#7e22ce',
    // Violet fills behind white text (F) + their shadows (rule 0).
    violetFill: '#7c3aed',
    violetFillShadow: '#7c3aed',
    filterSelectedFill: '#6d28d9',
    filterSelectedShadow: '#6d28d9',
    // Green / amber / red status families.
    greenTint: '#ecfdf5',
    greenBorder: '#a7f3d0',
    greenText: '#059669',
    owedBg: '#dcfce7',
    owedText: '#15803d',
    owedBorder: '#bbf7d0',
    owedCardBorder: '#86efac',
    owedCardBg: '#f0fdf4',
    paidDownText: '#16a34a',
    logPaymentFill: '#16a34a',
    settleFill: '#10b981',
    settleShadow: '#10b981',
    amberTint: '#fffbeb',
    amberBorder: '#fde68a',
    amberStrongBorder: '#fcd34d',
    amberBadgeBg: '#fef3c7',
    amberText: '#d97706',
    bannerTitle: '#92400e',
    amberDeepText: '#b45309',
    owesBg: '#fee2e2',
    owesText: '#dc2626',
    dangerText: '#e11d48',
    dangerTint: '#fff1f2',
    dangerBorder: '#fecdd3',
    refundBg: '#fef2f2',
    refundBorder: '#fecaca',
    refundText: '#991b1b',
    // Expense icon well (violet S + B).
    expenseTint: '#f3e8ff',
    expenseIconBorder: '#e9d5ff',
    // Drill-down header avatar: primaryLight well (violet S) behind primary-hued
    // initials, plus its dead `??` fallback kept byte-identical (neutral S).
    avatarWellBg: '#7e57c2',
    avatarWellFallback: '#eee',
  },
  dark: {
    tabTrack: darkColor.surfaceAlt,
    tabTrackBorder: DARK_TONAL.violet.border,
    tabActiveShadow: '#000000',
    // Idle reads quieter than the active `primaryFg` label (Requirement 9.12).
    tabIdleText: darkColor.textSecondary,
    // Active pill is lighter than the `surfaceAlt` track, so it reads raised.
    tabActiveBg: darkColor.borderStrong,
    tabBadgeActiveBg: DARK_TONAL.violet.tint,
    tabBadgeIdleBg: DARK_TONAL.violet.tint,
    inkText: darkColor.textPrimary,
    slate800Text: darkColor.textPrimary,
    slate700Text: darkColor.textPrimary,
    slate600Text: darkColor.textPrimary,
    slate500Text: darkColor.textSecondary,
    slate400Text: darkColor.textSecondary,
    // Member / flow names are name ink, not accent (B4-4).
    indigoText: darkColor.textPrimary,
    subtleWellBg: darkColor.surfaceAlt,
    greyPillBg: darkColor.surfaceAlt,
    hairline: darkColor.border,
    softDivider: darkColor.border,
    strongLine: darkColor.borderStrong,
    neutralAvatarFill: darkColor.borderStrong,
    violetCardBorder: DARK_TONAL.violet.border,
    violetBorderStrong: DARK_TONAL.violet.border,
    violetButtonBorder: DARK_TONAL.violet.border,
    heroShadow: '#000000',
    expenseShadow: '#000000',
    pairwiseShadow: '#000000',
    settlementShadow: '#000000',
    expandedBg: DARK_TONAL.violet.tint,
    violetWellBg: darkColor.surfaceAlt,
    payerSelectedBg: DARK_TONAL.violet.tint,
    violetText: DARK_TONAL.violet.fg,
    violetDeepText: DARK_TONAL.violet.fg,
    expenseBadgeText: DARK_TONAL.violet.fg,
    violetFill: DARK_TONAL.violet.fill,
    violetFillShadow: '#000000',
    filterSelectedFill: DARK_TONAL.violet.fill,
    filterSelectedShadow: '#000000',
    greenTint: DARK_TONAL.green.tint,
    greenBorder: DARK_TONAL.green.border,
    greenText: DARK_TONAL.green.fg,
    owedBg: DARK_TONAL.green.tint,
    owedText: DARK_TONAL.green.fg,
    owedBorder: DARK_TONAL.green.border,
    owedCardBorder: DARK_TONAL.green.border,
    owedCardBg: DARK_TONAL.green.tint,
    paidDownText: DARK_TONAL.green.fg,
    logPaymentFill: DARK_TONAL.green.fill,
    settleFill: DARK_TONAL.green.fill,
    settleShadow: '#000000',
    amberTint: DARK_TONAL.amber.tint,
    amberBorder: DARK_TONAL.amber.border,
    amberStrongBorder: DARK_TONAL.amber.border,
    amberBadgeBg: DARK_TONAL.amber.tint,
    amberText: DARK_TONAL.orange.fg,
    bannerTitle: DARK_TONAL.orange.fg,
    amberDeepText: DARK_TONAL.orange.fg,
    owesBg: DARK_TONAL.red.tint,
    owesText: DARK_TONAL.red.fg,
    dangerText: DARK_TONAL.red.fg,
    dangerTint: DARK_TONAL.red.tint,
    dangerBorder: DARK_TONAL.red.border,
    refundBg: DARK_TONAL.red.tint,
    refundBorder: DARK_TONAL.red.border,
    refundText: DARK_TONAL.red.fg,
    expenseTint: DARK_TONAL.violet.tint,
    expenseIconBorder: DARK_TONAL.violet.border,
    avatarWellBg: DARK_TONAL.violet.tint,
    avatarWellFallback: darkColor.surfaceAlt,
  },
});
