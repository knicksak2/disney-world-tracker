// Feature: dark-mode — co-located light/dark literal pairs for AvatarChip.tsx.
import { definePalette } from '../../theme/theme';

/**
 * "You & Crew" pill initial: deep violet text on the gold avatar circle
 * (H-role violet on a G-role fill) — mode-invariant in both schemes.
 */
export const AVATAR_PILL = definePalette({
  light: { initialText: '#3b1d60' },
  dark: { initialText: '#3b1d60' },
});
