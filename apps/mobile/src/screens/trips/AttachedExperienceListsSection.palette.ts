// Feature: dark-mode — co-located light/dark literal pairs for AttachedExperienceListsSection.tsx.

import { darkColor, definePalette } from '../../theme/theme';

export const ATTACHED_EXPERIENCE_LISTS = definePalette({
  light: {
    // Greyed "No longer available" row (neutral S, L 0.86 → surfaceAlt).
    unavailableBg: '#eee',
  },
  dark: {
    unavailableBg: darkColor.surfaceAlt,
  },
});
