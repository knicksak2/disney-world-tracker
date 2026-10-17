// Feature: dark-mode — co-located light/dark literal pairs for TripPackingListScreen.tsx.

import { DARK_TONAL, definePalette } from '../../theme/theme';

export const PACKING_PALETTE = definePalette({
  light: {
    packedBg: 'rgba(52, 199, 89, 0.12)',
    packedFg: '#1b8a3e',
    unpackedFg: '#6c6c70',
    chipSelectedBg: '#5b2a86',
    chipSelectedText: '#ffffff',
    errorBg: 'rgba(232, 80, 91, 0.12)',
  },
  dark: {
    packedBg: DARK_TONAL.green.tint,
    packedFg: DARK_TONAL.green.fg,
    unpackedFg: DARK_TONAL.violet.fg,
    chipSelectedBg: DARK_TONAL.violet.fill,
    chipSelectedText: '#ffffff',
    errorBg: DARK_TONAL.red.tint,
  },
});
