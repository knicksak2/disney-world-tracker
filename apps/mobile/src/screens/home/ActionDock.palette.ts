// Feature: dark-mode — co-located light/dark literal pairs for ActionDock.tsx.

import { DARK_TONAL, darkColor, definePalette } from '../../theme/theme';

export const ACTION_DOCK = definePalette({
  light: {
    // Tile icon wells (S).
    liveWaitsBg: '#eef2ff',
    logRideBg: '#fdf2f8',
    logFoodBg: '#fffbeb',
    logSnackBg: '#fffbeb',
    dayPlanBg: '#ecfdf5',
    myPinsBg: '#f5f3ff',
    // Tile border (B, violet).
    tileBorder: '#eee6f7',
    // Non-black shadow (rule 0).
    tileShadow: '#5b2a86',
    // Claimable-pins count bubble (F, white text).
    badgeBg: '#ef4444',
  },
  dark: {
    liveWaitsBg: DARK_TONAL.blue.tint,
    logRideBg: DARK_TONAL.pink.tint,
    logFoodBg: DARK_TONAL.amber.tint,
    logSnackBg: DARK_TONAL.amber.tint,
    dayPlanBg: DARK_TONAL.green.tint,
    myPinsBg: darkColor.surfaceAlt,
    tileBorder: DARK_TONAL.violet.border,
    tileShadow: '#000000',
    badgeBg: DARK_TONAL.red.fill,
  },
});
