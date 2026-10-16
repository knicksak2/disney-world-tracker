// Feature: dark-mode — co-located light/dark literal pairs for PinBoardScreen.tsx.

import { definePalette } from '../../theme/theme';

export const PIN_BOARD = definePalette({
  light: {
    // Ready-to-claim ring glow: a non-black `primary` shadow (rule 0).
    readyRingShadow: '#5b2a86',
  },
  dark: {
    readyRingShadow: '#000000',
  },
});
