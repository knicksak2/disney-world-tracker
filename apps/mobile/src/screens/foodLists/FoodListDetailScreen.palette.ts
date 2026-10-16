// Feature: dark-mode — co-located light/dark literal pairs for FoodListDetailScreen.tsx.
import { DARK_TONAL, definePalette } from '../../theme/theme';

/** Non-token literals, converted by rule 3 (family from the HSL hue, role per site). */
export const FOOD_LIST_DETAIL = definePalette({
  light: {
    // Stale-write notice tint — `#6b46c1` at 10 % (violet S).
    staleNoticeBg: 'rgba(107, 70, 193, 0.1)',
    // "List Complete!" banner: amber tint (S), orange title / message (T).
    celebrationBg: '#fef3c7',
    celebrationTitle: '#92400e',
    celebrationMessage: '#78350f',
    // Liked action chip tint — `#ef4444` at 10 % (red S).
    likedBg: 'rgba(239, 68, 68, 0.1)',
  },
  dark: {
    staleNoticeBg: DARK_TONAL.violet.tint,
    celebrationBg: DARK_TONAL.amber.tint,
    celebrationTitle: DARK_TONAL.orange.fg,
    celebrationMessage: DARK_TONAL.orange.fg,
    likedBg: DARK_TONAL.red.tint,
  },
});
