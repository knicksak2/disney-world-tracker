// Feature: dark-mode — co-located light/dark literal pairs for ExplorationPromptCard.tsx.

import { DARK_TONAL, definePalette } from '../../theme/theme';

export const EXPLORATION_PROMPT = definePalette({
  light: {
    // Card border (B, violet).
    cardBorder: '#ebdff8',
    // Non-black shadows (rule 0).
    cardShadow: '#5b2a86',
    iconTileShadow: '#5b2a86',
    // Icon tile gradient start stop: a `#7e57c2` fill behind a light glyph (rule 1).
    iconTileStart: '#7e57c2',
  },
  dark: {
    cardBorder: DARK_TONAL.violet.border,
    cardShadow: '#000000',
    iconTileShadow: '#000000',
    iconTileStart: DARK_TONAL.violet.fill,
  },
});
