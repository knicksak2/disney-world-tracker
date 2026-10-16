// Feature: dark-mode — co-located light/dark literal pairs for ExperienceDetailScreen.tsx.
import { definePalette } from '../../theme/theme';

export const HERO = definePalette({
  light: {
    // Hero card shadow (rule 0: non-black shadowColor).
    cardShadow: '#1f1235',
    // Bottom scrim over the photo (violet, L < 0.03 — rule 3 H, mode-invariant).
    scrimEnd: 'rgba(20, 8, 36, 0.88)',
    // Land pill text on the always-white pill over the photo (mode-invariant
    // background, so the text stays as it is — rule 3 H / rule 5).
    landPillText: '#371756',
  },
  dark: {
    cardShadow: '#000000',
    scrimEnd: 'rgba(20, 8, 36, 0.88)',
    landPillText: '#371756',
  },
});
