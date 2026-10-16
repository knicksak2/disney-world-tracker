// Feature: dark-mode — co-located light/dark literal pairs for PinDetailModal.tsx.

import { definePalette } from '../../theme/theme';

export const PIN_DETAIL = definePalette({
  light: {
    // Backdrop scrim: a near-black violet, already dark in light mode (H, mode-invariant).
    backdrop: 'rgba(10,7,20,0.6)',
  },
  dark: {
    backdrop: 'rgba(10,7,20,0.6)',
  },
});
