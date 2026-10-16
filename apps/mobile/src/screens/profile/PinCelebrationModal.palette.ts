// Feature: dark-mode — co-located light/dark literal pairs for PinCelebrationModal.tsx.

import { definePalette } from '../../theme/theme';

// artwork — mode-invariant: the decorative confetti burst hues.
export const CONFETTI = definePalette({
  light: {
    gold: '#f2c14e',
    teal: '#4ecdc4',
    pink: '#ff6f91',
  },
  dark: {
    gold: '#f2c14e',
    teal: '#4ecdc4',
    pink: '#ff6f91',
  },
});

export const PIN_CELEBRATION = definePalette({
  light: {
    // Backdrop scrim: a near-black violet, already dark in light mode (H, mode-invariant).
    backdrop: 'rgba(10,7,20,0.72)',
  },
  dark: {
    backdrop: 'rgba(10,7,20,0.72)',
  },
});
