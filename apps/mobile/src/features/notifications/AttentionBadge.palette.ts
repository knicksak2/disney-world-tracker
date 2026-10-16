// Feature: dark-mode — co-located light/dark literal pairs for AttentionBadge.tsx.

import { DARK_TONAL, definePalette } from '../../theme/theme';

/** The red count pill behind white text (red family, rule 3 F). */
export const ATTENTION_BADGE = definePalette({
  light: { fill: '#e11d48' },
  dark: { fill: DARK_TONAL.red.fill },
});
