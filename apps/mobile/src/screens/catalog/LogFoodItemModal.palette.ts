// Feature: dark-mode — co-located light/dark literal pairs for LogFoodItemModal.tsx.
import { DARK_TONAL, definePalette } from '../../theme/theme';

/** Error banner tint — `#ef4444` at 10 % (red family, rule 3 role S). */
export const LOG_FOOD = definePalette({
  light: { errorBannerBg: 'rgba(239, 68, 68, 0.1)' },
  dark: { errorBannerBg: DARK_TONAL.red.tint },
});
