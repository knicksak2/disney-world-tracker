// Feature: dark-mode — co-located light/dark literal pairs for MenuScreen.tsx.
import { DARK_TONAL, darkTheme, definePalette } from '../../theme/theme';

/** Per-item "add to food list" button (violet S; lavender subtle pressed S). */
export const MENU_ITEM = definePalette({
  light: {
    addBg: '#f6f2fa',
    addBgPressed: '#ede6f6',
  },
  dark: {
    addBg: DARK_TONAL.violet.tint,
    addBgPressed: darkTheme.color.surfaceAlt,
  },
});
