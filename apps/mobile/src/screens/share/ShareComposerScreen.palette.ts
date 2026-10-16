// Feature: dark-mode — co-located light/dark literal pairs for ShareComposerScreen.tsx.
import { darkColor, definePalette } from '../../theme/theme';
export const SHARE_COMPOSER = definePalette({
  light: {
    // Unselected recipient ring icon: `borderStrong` read used as an icon (rule 1a → rule 3, violet T).
    unselectedIcon: '#cdbce6',
  },
  dark: {
    // Muted, distinct from the selected `primaryFg` ring (Requirement 9.12);
    // 7.81:1 on `surface`.
    unselectedIcon: darkColor.textSecondary,
  },
});
