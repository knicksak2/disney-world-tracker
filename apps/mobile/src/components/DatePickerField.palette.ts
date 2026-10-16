// Feature: dark-mode — co-located light/dark literal pairs for DatePickerField.tsx.

import { definePalette } from '../theme/theme';

export const DATE_PICKER = definePalette({
  light: {
    // Calendar disabled-day text: the light border hue, the dark borderStrong hue.
    disabledDayText: '#e2d9f0',
    // Modal scrim (textPrimary-tinted in light, neutral black in dark; rule 2).
    scrim: 'rgba(31, 18, 53, 0.5)',
  },
  dark: {
    disabledDayText: '#4a3a6b',
    scrim: 'rgba(0, 0, 0, 0.5)',
  },
});
