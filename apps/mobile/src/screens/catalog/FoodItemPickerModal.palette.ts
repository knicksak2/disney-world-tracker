// Feature: dark-mode — co-located light/dark literal pairs for FoodItemPickerModal.tsx.
import { DARK_TONAL, definePalette } from '../../theme/theme';

/**
 * Violet `rgba(107, 70, 193, a)` tints (not a token — rule 3, violet family):
 * subtle backgrounds are role S, the switch-tab outline is role B.
 */
export const PICKER = definePalette({
  light: {
    switchTabBg: 'rgba(107, 70, 193, 0.08)',
    switchTabBorder: 'rgba(107, 70, 193, 0.2)',
    addRowBg: 'rgba(107, 70, 193, 0.08)',
    repeatBadgeBg: 'rgba(107, 70, 193, 0.1)',
  },
  dark: {
    switchTabBg: DARK_TONAL.violet.tint,
    switchTabBorder: DARK_TONAL.violet.border,
    addRowBg: DARK_TONAL.violet.tint,
    repeatBadgeBg: DARK_TONAL.violet.tint,
  },
});
