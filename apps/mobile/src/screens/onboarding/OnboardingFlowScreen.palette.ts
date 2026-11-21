// Co-located light/dark palette tokens for OnboardingFlowScreen.tsx.

import { DARK_TONAL, definePalette } from '../../theme/theme';

export const ONBOARDING_FLOW = definePalette({
  light: {
    selectedCardBg: '#f5f3ff',
    bannerBg: '#fef3c7',
    bannerBorder: '#f59e0b',
    bannerText: '#92400e',
    bannerIconBg: '#fde68a',
    stepInactive: '#e5e7eb',
    stepCompleted: '#a78bfa',
    fabRowBg: '#ede9fe',
    fabRowBorder: '#c4b5fd',
    errorBg: '#fef2f2',
    errorBorder: '#fecaca',
  },
  dark: {
    selectedCardBg: DARK_TONAL.violet.tint,
    bannerBg: DARK_TONAL.amber.tint,
    bannerBorder: DARK_TONAL.amber.border,
    bannerText: DARK_TONAL.amber.fg,
    bannerIconBg: '#451a03',
    stepInactive: '#2e2a42',
    stepCompleted: DARK_TONAL.violet.border,
    fabRowBg: DARK_TONAL.violet.tint,
    fabRowBorder: DARK_TONAL.violet.border,
    errorBg: DARK_TONAL.red.tint,
    errorBorder: DARK_TONAL.red.border,
  },
});
