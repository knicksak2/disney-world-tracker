// Feature: dark-mode — co-located light/dark literal pairs for ExpenseFormModal.tsx.
import { DARK_TONAL, darkColor, definePalette } from '../../theme/theme';

/** Generated participant-avatar fills behind white initials (rule 3 F, per hue family). */
export const AVATAR_FILL = definePalette({
  light: {
    violet: '#7c3aed',
    blue: '#2563eb',
    green: '#059669',
    orange: '#d97706',
    red: '#dc2626',
    pink: '#db2777',
    teal: '#0891b2',
    indigo: '#4f46e5',
  },
  dark: {
    violet: DARK_TONAL.violet.fill,
    blue: DARK_TONAL.blue.fill,
    green: DARK_TONAL.green.fill,
    orange: DARK_TONAL.orange.fill,
    red: DARK_TONAL.red.fill,
    pink: DARK_TONAL.pink.fill,
    teal: DARK_TONAL.teal.fill,
    indigo: DARK_TONAL.blue.fill,
  },
});

/** Item / discount alcohol `Switch` track and thumb colours. */
export const FORM_SWITCH = definePalette({
  light: {
    // Off track (neutral B, L < 0.75) and on track (violet B).
    trackOff: '#cbd5e1',
    trackOn: '#c084fc',
    // On thumb: a violet knob fill (F).
    thumbOn: '#7c3aed',
  },
  // Dark Switch colours are applied by `themedSwitchProps` (theme/switchColors.ts);
  // these mirror its tokens so "on" reads stronger than "off" (Requirement 9.15).
  dark: {
    trackOff: darkColor.borderStrong,
    trackOn: darkColor.primary,
    thumbOn: darkColor.textOnPrimary,
  },
});

export const FORM = definePalette({
  light: {
    // Sheet scrim (slate-tinted in light, neutral black in dark; rule 2 scrim).
    scrim: 'rgba(15, 23, 42, 0.6)',
    // Non-black shadows (rule 0).
    sheetShadow: '#1f1235',
    violetShadow: '#5b2a86',
    // Sheet grab handle (neutral B, L < 0.75).
    sheetHandle: '#cbd5e1',
    // Lavender-subtle wells and panels (neutral S → surfaceAlt).
    lavenderWell: '#f5f0fb',
    lavenderWellAlt: '#f1ecf7',
    lavenderPanel: '#faf7ff',
    lavenderInput: '#fbf9fe',
    // Footer divider (lavender-subtle neutral B, L ≥ 0.75).
    footerDivider: '#f1ecf7',
    // Violet hairlines / borders / dividers (violet B).
    violetHairline: '#e8dcfa',
    violetBorder: '#d8c7f2',
    violetBorderSoft: '#e2d3f5',
    violetBorderActive: '#bca5db',
    violetDivider: '#ede2fb',
    violetRowDivider: '#f5effa',
    violetFooterDivider: '#f8f5fc',
    // Violet tinted wells (violet S).
    venueActiveBg: '#ede3fa',
    shareInputBg: '#f8f5fc',
    addTierBg: '#f3eafd',
    tierNameBg: '#faf8fe',
    cardActiveBg: '#fdfbff',
    subtotalActiveBg: '#f3ebfa',
    quickActionBg: '#f5effa',
    matrixHeaderBg: '#faf6fe',
    rowActiveBg: '#fcfaff',
    stepperPillBg: '#f8f4fc',
    stepperBtnBg: '#f0e6fa',
    // Active tier count pill (cards view): today's quickActionBg + violetBorderActive.
    tierPillActiveBg: '#f5effa',
    tierPillActiveBorder: '#bca5db',
    // Active matrix-view stepper pill border (today's violetBorderActive).
    matrixPillActiveBorder: '#bca5db',
    // Selected split-mode chip fill (today's `t.color.surface` in light).
    modeChipSelectedBg: '#ffffff',
    // Hero amount placeholder (neutral T, L ≥ 0.12).
    placeholder: '#a39bb3',
    // Green status family: text / icon / data mark (T), tint (S), border (B).
    greenText: '#059669',
    greenDeepText: '#047857',
    greenPriceText: '#16a34a',
    greenBadgeBg: '#d1fae5',
    greenWell: '#f0fdf4',
    greenBorder: '#bbf7d0',
    // Red status family.
    redBadgeBg: '#fee2e2',
    redText: '#b91c1c',
    resetBg: '#fff5f5',
    resetBorder: '#fed7d7',
    resetText: '#c53030',
    // Guest pill (sky S + T).
    guestBg: '#e0f2fe',
    guestText: '#0284c7',
    // Neutral text (T): L ≥ 0.12 → textSecondary band.
    slate400Text: '#94a3b8',
    slate500Text: '#64748b',
    mutedVioletText: '#8b7a9f',
    mutedVioletText2: '#948a9e',
    checkIdleIcon: '#cbd5e1',
    // Neutral text (T): L < 0.12 → textPrimary band.
    slate600Text: '#475569',
    slate700Text: '#334155',
    toggleIdleText: '#6b5880',
    // Neutral wells (S) and lines (B).
    neutralWell: '#f8fafc',
    greyWell: '#f1f5f9',
    greyDivider: '#f1f5f9',
    greyHairline: '#e2e8f0',
    // Selected assignee initial on its white disc (violet T).
    assigneeInitialSelected: '#7c3aed',
  },
  dark: {
    scrim: 'rgba(0, 0, 0, 0.6)',
    sheetShadow: '#000000',
    violetShadow: '#000000',
    sheetHandle: darkColor.borderStrong,
    lavenderWell: darkColor.surfaceAlt,
    lavenderWellAlt: darkColor.surfaceAlt,
    lavenderPanel: darkColor.surfaceAlt,
    lavenderInput: darkColor.surfaceAlt,
    footerDivider: darkColor.border,
    violetHairline: DARK_TONAL.violet.border,
    violetBorder: DARK_TONAL.violet.border,
    violetBorderSoft: DARK_TONAL.violet.border,
    violetBorderActive: DARK_TONAL.violet.border,
    violetDivider: DARK_TONAL.violet.border,
    violetRowDivider: DARK_TONAL.violet.border,
    violetFooterDivider: DARK_TONAL.violet.border,
    venueActiveBg: DARK_TONAL.violet.tint,
    shareInputBg: DARK_TONAL.violet.tint,
    addTierBg: DARK_TONAL.violet.tint,
    tierNameBg: DARK_TONAL.violet.tint,
    cardActiveBg: DARK_TONAL.violet.tint,
    subtotalActiveBg: DARK_TONAL.violet.tint,
    quickActionBg: DARK_TONAL.violet.tint,
    matrixHeaderBg: DARK_TONAL.violet.tint,
    rowActiveBg: DARK_TONAL.violet.tint,
    stepperPillBg: DARK_TONAL.violet.tint,
    stepperBtnBg: DARK_TONAL.violet.tint,
    // Distinct from the idle pill's violet.border (Requirement 9.12):
    // primaryFg is 6.12:1 on the pill tint and 8.37:1 on surface.
    tierPillActiveBg: DARK_TONAL.violet.tint,
    tierPillActiveBorder: darkColor.primaryFg,
    // Matrix view: same ruling as the cards-view pill. The idle pill's border is
    // violet.border, so violetBorderActive alone left the active cell indistinct.
    matrixPillActiveBorder: darkColor.primaryFg,
    // Selected split-mode chip is lighter than its `surfaceAlt` track (Requirement 9.12).
    modeChipSelectedBg: darkColor.borderStrong,
    placeholder: darkColor.textSecondary,
    greenText: DARK_TONAL.green.fg,
    greenDeepText: DARK_TONAL.green.fg,
    greenPriceText: DARK_TONAL.green.fg,
    greenBadgeBg: DARK_TONAL.green.tint,
    greenWell: DARK_TONAL.green.tint,
    greenBorder: DARK_TONAL.green.border,
    redBadgeBg: DARK_TONAL.red.tint,
    redText: DARK_TONAL.red.fg,
    resetBg: DARK_TONAL.red.tint,
    resetBorder: DARK_TONAL.red.border,
    resetText: DARK_TONAL.red.fg,
    guestBg: DARK_TONAL.sky.tint,
    guestText: DARK_TONAL.sky.fg,
    slate400Text: darkColor.textSecondary,
    slate500Text: darkColor.textSecondary,
    mutedVioletText: darkColor.textSecondary,
    mutedVioletText2: darkColor.textSecondary,
    checkIdleIcon: darkColor.textSecondary,
    slate600Text: darkColor.textPrimary,
    slate700Text: darkColor.textPrimary,
    toggleIdleText: darkColor.textPrimary,
    neutralWell: darkColor.surfaceAlt,
    greyWell: darkColor.surfaceAlt,
    greyDivider: darkColor.border,
    greyHairline: darkColor.border,
    assigneeInitialSelected: DARK_TONAL.violet.fg,
  },
});
