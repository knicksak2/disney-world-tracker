// Feature: dark-mode — co-located light/dark literal pairs for TripBookingTimelineScreen.tsx.

import { DARK_TONAL, definePalette } from '../../theme/theme';

export const TIMELINE_PALETTE = definePalette({
  light: {
    upcomingBadgeBg: 'rgba(56, 107, 246, 0.12)',
    upcomingBadgeFg: '#386bf6',
    openBadgeBg: 'rgba(52, 199, 89, 0.15)',
    openBadgeFg: '#1b8a3e',
    pastBadgeBg: 'rgba(120, 120, 128, 0.16)',
    pastBadgeFg: '#6c6c70',
    doneBg: 'rgba(52, 199, 89, 0.12)',
    doneFg: '#1b8a3e',
    errorBg: 'rgba(232, 80, 91, 0.12)',
  },
  dark: {
    upcomingBadgeBg: DARK_TONAL.blue.tint,
    upcomingBadgeFg: DARK_TONAL.blue.fg,
    openBadgeBg: DARK_TONAL.green.tint,
    openBadgeFg: DARK_TONAL.green.fg,
    pastBadgeBg: DARK_TONAL.violet.tint,
    pastBadgeFg: DARK_TONAL.violet.fg,
    doneBg: DARK_TONAL.green.tint,
    doneFg: DARK_TONAL.green.fg,
    errorBg: DARK_TONAL.red.tint,
  },
});
