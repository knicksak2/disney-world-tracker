// Feature: dark-mode — co-located light/dark literal pairs for ParkWaitPulse.tsx.

import { DARK_TONAL, definePalette } from '../../theme/theme';

export const PARK_WAIT_PULSE = definePalette({
  light: {
    // Crowd-trend badges: tinted background (S) + text (T).
    walkOnBg: '#dcfce7',
    walkOnText: '#15803d',
    lightLinesBg: '#dcfce7',
    lightLinesText: '#15803d',
    moderateBg: '#fef3c7',
    moderateText: '#b45309',
    heavyBg: '#fee2e2',
    heavyText: '#b91c1c',
    // Park pill border (B, violet).
    pillBorder: '#eee6f7',
    // Non-black shadow (rule 0).
    pillShadow: '#5b2a86',
    // Active-park pill ring (B) and its glow (rule 0).
    activeBorder: '#22c55e',
    activeShadow: '#22c55e',
  },
  dark: {
    walkOnBg: DARK_TONAL.green.tint,
    walkOnText: DARK_TONAL.green.fg,
    lightLinesBg: DARK_TONAL.green.tint,
    lightLinesText: DARK_TONAL.green.fg,
    moderateBg: DARK_TONAL.amber.tint,
    moderateText: DARK_TONAL.orange.fg,
    heavyBg: DARK_TONAL.red.tint,
    heavyText: DARK_TONAL.red.fg,
    pillBorder: DARK_TONAL.violet.border,
    pillShadow: '#000000',
    // Selected-state ring is role T in dark (Requirement 9.12): green.fg is
    // 7.91:1 on surface and 3.70:1 against the unselected pillBorder.
    activeBorder: DARK_TONAL.green.fg,
    activeShadow: '#000000',
  },
});
