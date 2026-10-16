// Feature: dark-mode — co-located light/dark literal pairs for TripScheduleScreen.tsx.
import { DARK_TONAL, darkColor, definePalette } from '../../theme/theme';

export const SCHEDULE = definePalette({
  light: {
    // Park-hours card left stripes, cycled per park (colour-coding marks on a
    // surface, rule 3 T — non-text graphics use the fg tone).
    parkStripeGreen: '#22c55e',
    parkStripeSky: '#0284c7',
    parkStripeViolet: '#a855f7',
    parkStripeOrange: '#f97316',
    // Neutral slate text and icons on cards (T; L < 0.12 → textPrimary band).
    inkText: '#0f172a',
    slate700Text: '#334155',
    slate600Text: '#475569',
    // Neutral slate secondary text and icons (T; L ≥ 0.12 → textSecondary band).
    slate500Text: '#64748b',
    // White cards / pills on the screen background use the surface token; their
    // hairlines (neutral B, L ≥ 0.75).
    cardHairline: '#e2e8f0',
    // Grey pills and thumbnail wells (neutral S).
    greyPillBg: '#f1f5f9',
    // Lavender time box behind the vertical time digits (lavender-subtle S).
    timeBoxBg: '#f5f3ff',
    // Timeline track line (neutral B, L < 0.75).
    trackLine: '#cbd5e1',
    // Park-hop dashed box border (neutral B, L < 0.75).
    dashedBorder: '#94a3b8',
    // Timeline nodes and the first-item speech pill: violet fills behind white
    // (F); the pill's pointer triangle is part of the same fill.
    nodeFill: '#6b21a8',
    speechFill: '#581c87',
    // Touring-start chevron (violet T).
    touringChevron: '#6d28d9',
    // Meal-period Badge colour (orange T).
    mealBadge: '#f97316',
    // Early Entry park badge (amber S) + text (orange T).
    earlyEntryBg: '#fef08a',
    earlyEntryText: '#854d0e',
    // Extended Hours badge (violet S) + text (violet T).
    extendedBg: '#e9d5ff',
    extendedText: '#581c87',
    // After-Hours badge (red S) + text (pink T).
    afterHoursBg: '#fecdd3',
    afterHoursText: '#9f1239',
    // Lightning Lane pill (amber S) + text (orange T).
    llPillBg: '#fde68a',
    llPillText: '#92400e',
    // Reservation pill (violet S) + text (violet T).
    reservationBg: '#ede9fe',
    reservationText: '#5b21b6',
    // Early Entry pill (teal S) + text (teal T).
    earlyPillBg: '#a5f3fc',
    earlyPillText: '#0891b2',
    // Single Rider pill (sky S) + text (sky T).
    singleRiderBg: '#bae6fd',
    singleRiderText: '#0369a1',
    // Fixed Time pill (violet S) + text (violet T).
    fixedBg: '#e9d5ff',
    fixedText: '#6b21a8',
    // Meal-window pill (orange S) + text (orange T).
    windowPillBg: '#ffedd5',
    windowPillText: '#c2410c',
    // Active meal-window preset card: orange S + B, title / subtitle orange T.
    presetActiveBg: '#fff7ed',
    presetActiveBorder: '#f97316',
    presetActiveTitle: '#ea580c',
    presetActiveSubtitle: '#c2410c',
    // Active-window / typical-showtime notices (amber S) + text (orange T).
    noticeBg: '#fef3c7',
    noticeText: '#92400e',
    typicalShowtimeText: '#b45309',
    // Unserved-meal warning: red S, red B, red T.
    unservedBg: '#fef2f2',
    unservedBorder: '#fca5a5',
    unservedText: '#b91c1c',
    // Selected showtime pill border (today's `t.color.primary` in light).
    showtimeActiveBorder: '#5b2a86',
  },
  dark: {
    // Dark `primary` is 2.98:1 on the surfaceAlt section; primaryFg is 7.41:1 (Requirement 9.12).
    showtimeActiveBorder: darkColor.primaryFg,
    parkStripeGreen: DARK_TONAL.green.fg,
    parkStripeSky: DARK_TONAL.sky.fg,
    parkStripeViolet: DARK_TONAL.violet.fg,
    parkStripeOrange: DARK_TONAL.orange.fg,
    inkText: darkColor.textPrimary,
    slate700Text: darkColor.textPrimary,
    slate600Text: darkColor.textPrimary,
    slate500Text: darkColor.textSecondary,
    cardHairline: darkColor.border,
    greyPillBg: darkColor.surfaceAlt,
    timeBoxBg: darkColor.surfaceAlt,
    trackLine: darkColor.borderStrong,
    dashedBorder: darkColor.borderStrong,
    nodeFill: DARK_TONAL.violet.fill,
    speechFill: DARK_TONAL.violet.fill,
    touringChevron: DARK_TONAL.violet.fg,
    mealBadge: DARK_TONAL.orange.fg,
    earlyEntryBg: DARK_TONAL.amber.tint,
    earlyEntryText: DARK_TONAL.orange.fg,
    extendedBg: DARK_TONAL.violet.tint,
    extendedText: DARK_TONAL.violet.fg,
    afterHoursBg: DARK_TONAL.red.tint,
    afterHoursText: DARK_TONAL.pink.fg,
    llPillBg: DARK_TONAL.amber.tint,
    llPillText: DARK_TONAL.orange.fg,
    reservationBg: DARK_TONAL.violet.tint,
    reservationText: DARK_TONAL.violet.fg,
    earlyPillBg: DARK_TONAL.teal.tint,
    earlyPillText: DARK_TONAL.teal.fg,
    singleRiderBg: DARK_TONAL.sky.tint,
    singleRiderText: DARK_TONAL.sky.fg,
    fixedBg: DARK_TONAL.violet.tint,
    fixedText: DARK_TONAL.violet.fg,
    windowPillBg: DARK_TONAL.orange.tint,
    windowPillText: DARK_TONAL.orange.fg,
    presetActiveBg: DARK_TONAL.orange.tint,
    presetActiveBorder: DARK_TONAL.orange.border,
    presetActiveTitle: DARK_TONAL.orange.fg,
    presetActiveSubtitle: DARK_TONAL.orange.fg,
    noticeBg: DARK_TONAL.amber.tint,
    noticeText: DARK_TONAL.orange.fg,
    typicalShowtimeText: DARK_TONAL.orange.fg,
    unservedBg: DARK_TONAL.red.tint,
    unservedBorder: DARK_TONAL.red.border,
    unservedText: DARK_TONAL.red.fg,
  },
});
