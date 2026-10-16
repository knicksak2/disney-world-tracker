// Feature: dark-mode — co-located light/dark literal pairs for MarkGottenUndoToast.tsx.
import { definePalette } from '../../theme/theme';

/**
 * The inverse toast surface (rule 1a: `textPrimary` used as a background →
 * rule 3 role H). Mode-invariant, so its white / gold text stays legible in
 * both schemes.
 */
export const TOAST = definePalette({
  light: { bg: '#1f1235' },
  dark: { bg: '#1f1235' },
});
