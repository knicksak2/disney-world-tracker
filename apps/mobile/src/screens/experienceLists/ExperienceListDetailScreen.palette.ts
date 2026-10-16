// Feature: dark-mode — co-located light/dark literal pairs for ExperienceListDetailScreen.tsx.
import { DARK_TONAL, definePalette } from '../../theme/theme';

/** Non-token literals, converted by rule 3 (family from the HSL hue, role per site). */
export const EXPERIENCE_LIST_DETAIL = definePalette({
  light: {
    // Stale-write notice tint — `#6b46c1` at 10 % (violet S).
    staleNoticeBg: 'rgba(107, 70, 193, 0.1)',
    // Liked action chip tint — `#ef4444` at 10 % (red S).
    likedBg: 'rgba(239, 68, 68, 0.1)',
  },
  dark: {
    staleNoticeBg: DARK_TONAL.violet.tint,
    likedBg: DARK_TONAL.red.tint,
  },
});
