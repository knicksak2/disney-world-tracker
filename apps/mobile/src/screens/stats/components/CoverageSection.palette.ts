// Feature: dark-mode — co-located light/dark literal pairs for CoverageSection.tsx.
import { darkTheme, definePalette } from '../../../theme/theme';

/**
 * Area-type row accents (dot + bar marks). Each area type reuses a park's
 * accent hue (rule 1, park-hue bullet): Theme Parks → Magic Kingdom, Water
 * Parks → Typhoon Lagoon, Disney Springs → Disney Springs. Dark = that park's
 * dark accent.
 */
export const AREA_ACCENT = definePalette({
  light: {
    themePark: '#7e57c2',
    waterPark: '#17a2b8',
    disneySprings: '#f6a609',
  },
  dark: {
    themePark: darkTheme.parkAccent['Magic Kingdom'],
    waterPark: darkTheme.parkAccent['Typhoon Lagoon'],
    disneySprings: darkTheme.parkAccent['Disney Springs'],
  },
});
