// Feature: dining-plan-calculator — theme-aware light & Twilight dark palette tokens for the 4-tab UI (Requirement 27).
import { DARK_TONAL, darkTheme, definePalette } from '../../theme/theme';

export const DINING_PALETTE = definePalette({
  light: {
    savesBg: '#ecfdf5',
    savesBorder: '#86efac',
    savesFg: '#047857',

    goldBg: '#fffbeb',
    goldBorder: '#f59e0b',
    goldFg: '#b45309',

    switchBg: '#fff7ed',
    switchBorder: '#fdba74',
    switchFg: '#c2410c',

    creditBg: '#f5f3ff',
    creditBorder: '#c4b5fd',
    creditFg: '#6d28d9',

    qsBg: '#f0f9ff',
    qsBorder: '#bae6fd',
    qsFg: '#0369a1',

    cashBg: '#ecfdf5',
    cashBorder: '#a7f3d0',
    cashFg: '#047857',

    trackBg: '#e5e7eb',
    winnerBar: '#10b981',
    baselineBar: '#7c3aed',
    qsBar: '#0284c7',
    expensiveBar: '#e11d48',

    tsBar: '#7c3aed',
    snackBar: '#d97706',

    compareTabFg: '#d97706',
    creditsTabFg: '#db2777',
    sheetBackdrop: 'rgba(15, 23, 42, 0.55)',
  },
  dark: {
    savesBg: DARK_TONAL.green.tint,
    savesBorder: DARK_TONAL.green.border,
    savesFg: DARK_TONAL.green.fg,

    goldBg: DARK_TONAL.amber.tint,
    goldBorder: DARK_TONAL.amber.border,
    goldFg: DARK_TONAL.amber.fg,

    switchBg: DARK_TONAL.orange.tint,
    switchBorder: DARK_TONAL.orange.border,
    switchFg: DARK_TONAL.orange.fg,

    creditBg: DARK_TONAL.violet.tint,
    creditBorder: DARK_TONAL.violet.border,
    creditFg: DARK_TONAL.violet.fg,

    qsBg: DARK_TONAL.sky.tint,
    qsBorder: DARK_TONAL.sky.border,
    qsFg: DARK_TONAL.sky.fg,

    cashBg: DARK_TONAL.green.tint,
    cashBorder: DARK_TONAL.green.border,
    cashFg: DARK_TONAL.green.fg,

    trackBg: darkTheme.color.surfaceAlt,
    winnerBar: DARK_TONAL.green.fg,
    baselineBar: DARK_TONAL.violet.fg,
    qsBar: DARK_TONAL.sky.fg,
    expensiveBar: DARK_TONAL.pink.fg,

    tsBar: DARK_TONAL.violet.fg,
    snackBar: DARK_TONAL.amber.fg,

    compareTabFg: DARK_TONAL.amber.fg,
    creditsTabFg: DARK_TONAL.pink.fg,
    sheetBackdrop: 'rgba(5, 3, 15, 0.72)',
  },
});
