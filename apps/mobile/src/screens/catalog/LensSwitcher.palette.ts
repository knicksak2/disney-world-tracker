// Feature: dark-mode — co-located light/dark literal pairs for LensSwitcher.tsx.
import { DARK_TONAL, darkTheme, definePalette } from '../../theme/theme';

export const LENS = definePalette({
  light: {
    // Track fill (lavender subtle, rule 3 neutral S) and border (violet, rule 3 B).
    trackBg: '#ede6f6',
    trackBorder: '#dcd1ec',
    // Active segment shadow (rule 0).
    activeShadow: '#5b2a86',
    // Active segment fill (today's `t.color.surface` in light).
    activeBg: '#ffffff',
    // Inactive icon / label (neutral L 0.1195 < 0.12, rule 3 T).
    inactiveIcon: '#655d78',
    inactiveText: '#655d78',
  },
  dark: {
    trackBg: darkTheme.color.surfaceAlt,
    trackBorder: DARK_TONAL.violet.border,
    activeShadow: '#000000',
    // Active segment is lighter than the `surfaceAlt` track, so it reads raised rather
    // than as a darker hole (Requirement 9.12; same ruling as the Expenses tab switcher).
    activeBg: darkTheme.color.borderStrong,
    // Idle lens reads quieter than the active primaryFg lens (Requirement 9.12 / 9.13).
    inactiveIcon: darkTheme.color.textSecondary,
    inactiveText: darkTheme.color.textSecondary,
  },
});
