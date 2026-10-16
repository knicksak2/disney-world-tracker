// Feature: dark-mode — co-located light/dark literal pairs for theme/components.tsx.

import { DARK_TONAL, definePalette } from './theme';

/** GradientHeader eyebrow text — mode-invariant gold on the header gradient. */
export const HEADER = definePalette({
  light: { eyebrowText: '#ffd54f' },
  dark: { eyebrowText: '#ffd54f' },
});

/** SecondaryButton `tone="danger"` fill and border (pink family, rule 3 S / B). */
export const DANGER_BUTTON = definePalette({
  light: { bg: '#fdebf2', border: '#f3b6cf' },
  dark: { bg: DARK_TONAL.pink.tint, border: DARK_TONAL.pink.border },
});
