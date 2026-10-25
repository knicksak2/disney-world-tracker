// Feature: dark-mode — co-located light/dark literal pairs for HomeThemeParksSection.tsx.

import { DARK_TONAL, definePalette } from '../../theme/theme';

export const HOME_THEME_PARKS = definePalette({
  light: {
    sectionBorder: '#ebdff8',
    tileBorder: 'rgba(255, 255, 255, 0.16)',
    tileShadow: '#1e0b36',
    logBtnBorder: '#e9d5ff',
    logBtnBg: '#ffffff',
    logBtnShadow: '#5b2a86',
    logRideIconBg: '#eff6ff',
    logFoodIconBg: '#fffbeb',
    waitPulseBg: 'rgba(0, 0, 0, 0.42)',
    waitPulseBorder: 'rgba(255, 255, 255, 0.25)',
    waitPulseText: '#fde047',
    watermark: 'rgba(255, 255, 255, 0.09)',
    iconBadgeBg: 'rgba(255, 255, 255, 0.18)',
    tileTitle: '#ffffff',
    tileSubtitle: 'rgba(255, 255, 255, 0.82)',
    fallback0: '#280b45',
    fallback1: '#5b2a86',
    fallback2: '#7e57c2',
  },
  dark: {
    sectionBorder: DARK_TONAL.violet.border,
    tileBorder: 'rgba(255, 255, 255, 0.12)',
    tileShadow: '#000000',
    logBtnBorder: '#3b1d60',
    logBtnBg: '#1e1b2e',
    logBtnShadow: '#000000',
    logRideIconBg: '#172554',
    logFoodIconBg: '#451a03',
    waitPulseBg: 'rgba(0, 0, 0, 0.65)',
    waitPulseBorder: 'rgba(255, 255, 255, 0.18)',
    waitPulseText: '#fde047',
    watermark: 'rgba(255, 255, 255, 0.06)',
    iconBadgeBg: 'rgba(255, 255, 255, 0.14)',
    tileTitle: '#ffffff',
    tileSubtitle: 'rgba(255, 255, 255, 0.82)',
    fallback0: '#280b45',
    fallback1: '#5b2a86',
    fallback2: '#7e57c2',
  },
});

