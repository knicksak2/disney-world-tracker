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
    // Top-right floating Mickey quest badge over the photo canopy
    mickeyBadgeBg: 'rgba(31, 18, 53, 0.82)',
    mickeyBadgeBorder: '#c084fc',
    mickeyBadgeText: '#ffffff',
    mickeyBadgeIcon: '#e9d5ff',
  },
  dark: {
    cardShadow: '#000000',
    scrimEnd: 'rgba(20, 8, 36, 0.88)',
    landPillText: '#371756',
    mickeyBadgeBg: 'rgba(15, 7, 28, 0.88)',
    mickeyBadgeBorder: '#a855f7',
    mickeyBadgeText: '#ffffff',
    mickeyBadgeIcon: '#d8b4fe',
  },
});
