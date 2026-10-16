// Feature: dark-mode — co-located light/dark literal pairs for LiveStatusStrip.tsx.
import { DARK_TONAL, definePalette } from '../../theme/theme';

export const STRIP = definePalette({
  light: {
    // Strip border (violet, rule 3 B) and shadow (rule 0).
    border: '#e6def2',
    shadow: '#190c2d',
    // Live-unavailable variant (red, rule 3 S / B).
    unavailableBg: '#fff1f2',
    unavailableBorder: '#fecdd3',
    // Lightning Lane badge (amber S / B; orange T).
    llBg: '#fef3c7',
    llBorder: '#fde68a',
    llIcon: '#92400e',
    llText: '#92400e',
  },
  dark: {
    border: DARK_TONAL.violet.border,
    shadow: '#000000',
    unavailableBg: DARK_TONAL.red.tint,
    unavailableBorder: DARK_TONAL.red.border,
    llBg: DARK_TONAL.amber.tint,
    llBorder: DARK_TONAL.amber.border,
    llIcon: DARK_TONAL.orange.fg,
    llText: DARK_TONAL.orange.fg,
  },
});
