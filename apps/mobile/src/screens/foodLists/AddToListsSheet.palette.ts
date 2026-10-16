// Feature: dark-mode — co-located light/dark literal pairs for AddToListsSheet.tsx.
import { DARK_TONAL, definePalette } from '../../theme/theme';

/** "Create new list" row tint — `#6b46c1` at 6 % (violet family, rule 3 role S). */
export const ADD_TO_LISTS = definePalette({
  light: { inlineAddBg: 'rgba(107, 70, 193, 0.06)' },
  dark: { inlineAddBg: DARK_TONAL.violet.tint },
});
