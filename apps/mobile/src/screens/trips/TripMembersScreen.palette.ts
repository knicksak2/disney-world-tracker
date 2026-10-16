// Feature: dark-mode — co-located light/dark literal pairs for TripMembersScreen.tsx.

import { DARK_TONAL, definePalette } from '../../theme/theme';

/**
 * Member avatar fills behind the white initial (role F). The first avatar
 * colour is the `primary` token and is read from the theme directly.
 */
export const MEMBER_AVATAR = definePalette({
  light: {
    // Rule 3 F, sky family.
    sky: '#2f80ed',
    // Rule 4: `success` as a solid fill behind white.
    success: '#2e9e6b',
    // Rule 3 F, amber family (hue 40).
    amber: '#f6a609',
    // Rule 4: `danger` as a solid fill behind white.
    danger: '#d6336c',
  },
  dark: {
    sky: DARK_TONAL.sky.fill,
    success: DARK_TONAL.green.fill,
    amber: DARK_TONAL.amber.fill,
    danger: DARK_TONAL.pink.fill,
  },
});

/** Invite modal scrim (rule 2 exception: textPrimary-tinted scrim). */
export const MEMBERS_MODAL = definePalette({
  light: { scrim: 'rgba(31, 18, 53, 0.5)' },
  dark: { scrim: 'rgba(0, 0, 0, 0.5)' },
});
