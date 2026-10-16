// Feature: dark-mode — co-located light/dark literal pairs for RefundModal.tsx.
import { DARK_TONAL, definePalette } from '../../theme/theme';

export const REFUND = definePalette({
  light: {
    // Error box tint (red family, rule 3 S).
    errorBg: 'rgba(232, 80, 91, 0.15)',
  },
  dark: {
    errorBg: DARK_TONAL.red.tint,
  },
});
