// Feature: dark-mode — co-located light/dark literal pairs for ProfileScreen.tsx.
import { definePalette } from '../theme/theme';

/**
 * The gold avatar frame and its "CHANGE" pill (rule 3 role G: a gold fill
 * behind dark text, mode-invariant). The ring shares the pill's gold so the
 * pair stays matched in both schemes.
 */
export const AVATAR_GOLD = definePalette({
  light: {
    ring: '#ffd54f',
    badgeBg: '#ffd54f',
    badgeText: '#311b92',
  },
  dark: {
    ring: '#ffd54f',
    badgeBg: '#ffd54f',
    badgeText: '#311b92',
  },
});
