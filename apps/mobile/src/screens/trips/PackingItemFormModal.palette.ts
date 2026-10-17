// Feature: dark-mode — co-located light/dark literal pairs for PackingItemFormModal.tsx.

import { DARK_TONAL, definePalette } from '../../theme/theme';

export const PACKING_ITEM_FORM_MODAL = definePalette({
  light: {
    overlayBg: 'rgba(0, 0, 0, 0.45)',
    errorBg: 'rgba(232, 80, 91, 0.15)',
  },
  dark: {
    overlayBg: 'rgba(0, 0, 0, 0.70)',
    errorBg: DARK_TONAL.red.tint,
  },
});
