// Feature: dark-mode — co-located light/dark literal pairs for LiveWaitCockpit.tsx.
import { DARK_TONAL, darkTheme, definePalette } from '../../theme/theme';

export const COCKPIT = definePalette({
  light: {
    // Card border (violet, rule 3 B) and shadows (rule 0).
    cardBorder: '#ded3f0',
    cardShadow: '#5b2a86',
    chipActiveShadow: '#5b2a86',
    // Context chips (violet B; lavender subtle S; neutral T).
    chipBorder: '#e2d9f3',
    chipBg: '#fbf9fe',
    mutedText: '#655d78',
    // Dark-violet headings (violet, rule 3 T).
    inkText: '#190c2d',
    // Operating / closed badge (green / red, rule 3 S / B / T).
    operatingBg: '#ecfdf5',
    operatingBorder: 'rgba(22, 163, 74, 0.25)',
    operatingFg: '#16a34a',
    closedBg: '#fef2f2',
    closedBorder: 'rgba(220, 38, 38, 0.25)',
    closedFg: '#dc2626',
    // Standby instrument: green fill behind white text (rule 3 F, rule 0 shadow);
    // closed state is a dark slate hero (rule 3 H, mode-invariant).
    standbyOperatingBg: '#1b864d',
    standbyOperatingShadow: '#1b864d',
    standbyClosedBg: '#1e293b',
    // Status copy on those always-dark fills (mode-invariant, like rule 3 H).
    standbyOperatingStatus: '#bbf7d0',
    standbyClosedStatus: '#94a3b8',
    // Lightning Lane ticket (lavender subtle S; violet B; green T).
    llTicketBg: '#fbf9fe',
    llTicketBorder: '#c8b7e6',
    llBenefit: '#15803d',
    // Alert button (violet, rule 3 S / B).
    alertBg: '#f3edf9',
    alertBorder: '#d8c8ed',
    // Single-rider strip (violet, rule 3 S / B / T).
    singleRiderBg: '#faf5ff',
    singleRiderBorder: '#d8b4fe',
    singleRiderIcon: '#7e22ce',
    singleRiderTitle: '#7e22ce',
    singleRiderWait: '#581c87',
    singleRiderSub: '#6b21a8',
    // Forecast box (lavender subtle S / B) and its marks.
    forecastBg: '#fbf9fe',
    forecastBorder: '#ede6f6',
    forecastPeakText: '#8b5cf6', // T violet
    sparkBar: '#cfc2e5', // low-emphasis bar, B violet
    sparkBarPeak: '#8b5cf6', // T violet
    sparkBarActiveBorder: '#3b145d', // B violet
    axisText: '#948ca5', // neutral L 0.278, T
    freshnessDivider: '#f0eaf7', // B violet
    // Stat pair (violet S / B; green T).
    statsBg: '#f3edf9',
    statDivider: '#e2d9f3',
    reliability: '#16a34a',
    // Best-time verdict (green, rule 3 S / B / T).
    verdictBg: '#f0fdf4',
    verdictAccent: '#16a34a',
    verdictTitle: '#166534',
    verdictHeadline: '#14532d',
    verdictSub: '#166534',
  },
  dark: {
    cardBorder: DARK_TONAL.violet.border,
    cardShadow: '#000000',
    chipActiveShadow: '#000000',
    chipBorder: DARK_TONAL.violet.border,
    chipBg: darkTheme.color.surfaceAlt,
    // Text hierarchy (Requirement 9.13): the #655d78 band → textSecondary, ink → textPrimary.
    mutedText: darkTheme.color.textSecondary,
    inkText: darkTheme.color.textPrimary,
    operatingBg: DARK_TONAL.green.tint,
    operatingBorder: DARK_TONAL.green.border,
    operatingFg: DARK_TONAL.green.fg,
    closedBg: DARK_TONAL.red.tint,
    closedBorder: DARK_TONAL.red.border,
    closedFg: DARK_TONAL.red.fg,
    standbyOperatingBg: DARK_TONAL.green.fill,
    standbyOperatingShadow: '#000000',
    standbyClosedBg: '#1e293b',
    standbyOperatingStatus: '#bbf7d0',
    standbyClosedStatus: '#94a3b8',
    llTicketBg: darkTheme.color.surfaceAlt,
    llTicketBorder: DARK_TONAL.violet.border,
    llBenefit: DARK_TONAL.green.fg,
    alertBg: DARK_TONAL.violet.tint,
    alertBorder: DARK_TONAL.violet.border,
    singleRiderBg: DARK_TONAL.violet.tint,
    singleRiderBorder: DARK_TONAL.violet.border,
    singleRiderIcon: DARK_TONAL.violet.fg,
    singleRiderTitle: DARK_TONAL.violet.fg,
    singleRiderWait: DARK_TONAL.violet.fg,
    singleRiderSub: DARK_TONAL.violet.fg,
    forecastBg: darkTheme.color.surfaceAlt,
    forecastBorder: darkTheme.color.border,
    forecastPeakText: DARK_TONAL.violet.fg,
    sparkBar: DARK_TONAL.violet.border,
    sparkBarPeak: DARK_TONAL.violet.fg,
    sparkBarActiveBorder: DARK_TONAL.violet.border,
    axisText: darkTheme.color.textSecondary,
    freshnessDivider: DARK_TONAL.violet.border,
    statsBg: DARK_TONAL.violet.tint,
    statDivider: DARK_TONAL.violet.border,
    reliability: DARK_TONAL.green.fg,
    verdictBg: DARK_TONAL.green.tint,
    verdictAccent: DARK_TONAL.green.border,
    verdictTitle: DARK_TONAL.green.fg,
    verdictHeadline: DARK_TONAL.green.fg,
    verdictSub: DARK_TONAL.green.fg,
  },
});
