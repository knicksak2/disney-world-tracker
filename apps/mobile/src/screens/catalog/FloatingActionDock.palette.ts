// Feature: dark-mode — co-located light/dark literal pairs for FloatingActionDock.tsx.
import { DARK_TONAL, darkTheme, definePalette } from '../../theme/theme';

export const DOCK = definePalette({
  light: {
    // Dock border (violet, rule 3 B) and shadows (rule 0).
    dockBorder: 'rgba(230, 222, 242, 0.95)',
    dockShadow: '#5b2a86',
    primaryShadow: '#5b2a86',
    // Secondary pill (lavender subtle, rule 3 neutral S; violet B / T).
    secondaryBg: '#fbf9fe',
    secondaryBorder: '#ded3f0',
    secondaryText: '#371756',
  },
  dark: {
    dockBorder: DARK_TONAL.violet.border,
    dockShadow: '#000000',
    primaryShadow: '#000000',
    secondaryBg: darkTheme.color.surfaceAlt,
    secondaryBorder: DARK_TONAL.violet.border,
    secondaryText: DARK_TONAL.violet.fg,
  },
});
