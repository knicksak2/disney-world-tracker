// Feature: dark-mode — co-located light/dark literal pairs for PinShowcaseScreen.tsx.

import { DARK_TONAL, definePalette } from '../../theme/theme';

export const PIN_SHOWCASE = definePalette({
  light: {
    // Gold-tinted tray action highlights (amber family, S).
    trayActionActiveBg: 'rgba(230,195,92,0.15)',
    browseAllBg: 'rgba(230,195,92,0.12)',
  },
  dark: {
    trayActionActiveBg: DARK_TONAL.amber.tint,
    browseAllBg: DARK_TONAL.amber.tint,
  },
});

// artwork — mode-invariant: the wooden frame around the cork showcase board.
export const SHOWCASE_FRAME = definePalette({
  light: {
    border: '#5D3A1A',
    bg: '#c49a6c',
  },
  dark: {
    border: '#5D3A1A',
    bg: '#c49a6c',
  },
});
