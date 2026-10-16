// Feature: dark-mode — co-located light/dark literal pairs for TripBalancesScreen.tsx.
import { DARK_TONAL, darkColor, definePalette } from '../../theme/theme';

export const BALANCES = definePalette({
  light: {
    // Net/Pairwise segmented toggle: track (neutral S), active-pill shadow (rule 0).
    toggleTrack: '#f1f5f9',
    toggleActiveShadow: '#0f172a',
    // Active toggle pill fill (today's `t.color.surface` in light).
    toggleActiveBg: '#ffffff',
    // Neutral slate text (T): idle toggle label, "Settled up" status, zero amount.
    slateText: '#64748b',
    zeroAmountText: '#94a3b8',
    // Deep-indigo text on white cards (H-listed violet, used as T).
    inkText: '#1e1b4b',
    // "Record a Settlement" hero button: violet fill behind white (F) + shadow (rule 0).
    heroFill: '#7c3aed',
    heroShadow: '#7c3aed',
    // Pairwise "Settle" button: success token as a fill behind white (rule 4).
    settleFill: '#2e9e6b',
    // Pairwise modal "Log Payment" button: green fill behind white (F).
    logPaymentFill: '#16a34a',
    // Owed (green) / owes (red) / settled (neutral) chips and avatar tints (S).
    owedBg: '#dcfce7',
    owesBg: '#fee2e2',
    settledBg: '#f1f5f9',
    // Owed / owes text and icons (T).
    owedText: '#15803d',
    owesText: '#dc2626',
    paidDownText: '#16a34a',
    // Pairwise hint row divider (neutral B).
    hintDivider: '#f1f5f9',
    // Pairwise entry card hairline (neutral B).
    entryBorder: '#e2e8f0',
    // Settlement entry card: green tint (S) + green border (B).
    settlementCardBg: '#f0fdf4',
    settlementCardBorder: '#86efac',
    // Settlement icon well: green tint (S) + green border (B).
    settlementIconBorder: '#bbf7d0',
    // Expense icon well + badge: violet tint (S), violet border (B), violet text (T).
    expenseTint: '#f3e8ff',
    expenseIconBorder: '#e9d5ff',
    expenseBadgeText: '#7e22ce',
  },
  dark: {
    toggleTrack: darkColor.surfaceAlt,
    toggleActiveShadow: '#000000',
    // Active pill lighter than the `surfaceAlt` track (Requirement 9.12).
    toggleActiveBg: darkColor.borderStrong,
    slateText: darkColor.textSecondary,
    zeroAmountText: darkColor.textSecondary,
    // Name ink / active toggle label (B4-4): 8.75:1 on `toggleActiveBg`.
    inkText: darkColor.textPrimary,
    heroFill: DARK_TONAL.violet.fill,
    heroShadow: '#000000',
    settleFill: DARK_TONAL.green.fill,
    logPaymentFill: DARK_TONAL.green.fill,
    owedBg: DARK_TONAL.green.tint,
    owesBg: DARK_TONAL.red.tint,
    settledBg: darkColor.surfaceAlt,
    owedText: DARK_TONAL.green.fg,
    owesText: DARK_TONAL.red.fg,
    paidDownText: DARK_TONAL.green.fg,
    hintDivider: darkColor.border,
    entryBorder: darkColor.border,
    settlementCardBg: DARK_TONAL.green.tint,
    settlementCardBorder: DARK_TONAL.green.border,
    settlementIconBorder: DARK_TONAL.green.border,
    expenseTint: DARK_TONAL.violet.tint,
    expenseIconBorder: DARK_TONAL.violet.border,
    expenseBadgeText: DARK_TONAL.violet.fg,
  },
});
