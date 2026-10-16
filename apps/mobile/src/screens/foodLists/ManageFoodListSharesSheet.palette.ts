// Feature: dark-mode — co-located light/dark literal pairs for ManageFoodListSharesSheet.tsx.
import { DARK_TONAL, definePalette } from '../../theme/theme';

/** "Viewer" role badge tint — `#6b46c1` at 8 % (violet family, rule 3 role S). */
export const FOOD_SHARES = definePalette({
  light: { roleBadgeBg: 'rgba(107, 70, 193, 0.08)' },
  dark: { roleBadgeBg: DARK_TONAL.violet.tint },
});
