// Feature: dark-mode — co-located light/dark literal pairs for CompletionRow.tsx.
import { DARK_TONAL, definePalette } from '../../theme/theme';

/**
 * Repeat-count `Badge` colours (badge text/icon on its own 14 % tint, rule 3
 * role T): orange for 5+ repeats, blue otherwise.
 */
export const REPEAT_BADGE = definePalette({
  light: {
    frequent: '#d9480f',
    repeat: '#3b5bdb',
  },
  dark: {
    frequent: DARK_TONAL.orange.fg,
    repeat: DARK_TONAL.blue.fg,
  },
});
