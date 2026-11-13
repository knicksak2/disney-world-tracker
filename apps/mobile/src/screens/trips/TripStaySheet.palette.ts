// Literal colours for the Stay sheet (trip-lodging-stays task 8.2): the dimmed backdrop behind the bottom sheet.

import { definePalette } from '../../theme/theme';

export const TRIP_STAY_SHEET = definePalette({
  light: {
    overlayBg: 'rgba(0, 0, 0, 0.45)',
  },
  dark: {
    overlayBg: 'rgba(0, 0, 0, 0.70)',
  },
});
