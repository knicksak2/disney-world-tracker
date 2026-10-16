// Feature: dark-mode — co-located light/dark literal pairs for DestinationScreen.tsx.
import { DARK_TONAL, definePalette } from '../../theme/theme';

export const DESTINATION = definePalette({
  light: {
    // "Visited" disc: the success token as a solid fill behind a white check (rule 4).
    visitedFill: '#2e9e6b',
    // Favorites toggle, active state (red, rule 3 B / S / T).
    favoritesActiveBorder: '#FF2D55',
    favoritesActiveBg: '#fff1f2',
    favoritesActiveText: '#FF2D55',
    // Reset chip (red, rule 3 S / B / T).
    resetChipBg: '#fee2e2',
    resetChipBorder: '#fca5a5',
    resetChipText: '#b91c1c',
  },
  dark: {
    visitedFill: DARK_TONAL.green.fill,
    favoritesActiveBorder: DARK_TONAL.red.border,
    favoritesActiveBg: DARK_TONAL.red.tint,
    favoritesActiveText: DARK_TONAL.red.fg,
    resetChipBg: DARK_TONAL.red.tint,
    resetChipBorder: DARK_TONAL.red.border,
    resetChipText: DARK_TONAL.red.fg,
  },
});
