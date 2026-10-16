// Feature: dark-mode — co-located light/dark literal pairs for WaitInsightsSection.tsx.
import { DARK_TONAL, definePalette } from '../../theme/theme';

/** "Best time to ride" verdict + savings copy (green family, rule 3). */
export const VERDICT = definePalette({
  light: {
    fill: '#3fa34d', // F — solid fill behind white verdict text
    saveText: '#3fa34d', // T — "saves ~N min" on a surface
  },
  dark: {
    fill: DARK_TONAL.green.fill,
    saveText: DARK_TONAL.green.fg,
  },
});
