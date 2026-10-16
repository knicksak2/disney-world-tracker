// Feature: dark-mode — co-located light/dark literal pairs for ExperiencePicker.tsx.

import { DARK_TONAL, definePalette } from '../../theme/theme';

export const PICKER = definePalette({
  light: {
    // Filters sheet scrim (rule 2 exception: textPrimary-tinted scrim).
    scrim: 'rgba(31, 18, 53, 0.5)',
    // "Break Added" confirmation box (green S) and its text (green T).
    breakFeedbackBg: '#dcfce7',
    breakFeedbackText: '#15803d',
    // Add-break button after success: `success` as a solid fill behind white (rule 4).
    addBreakSuccessBg: '#2e9e6b',
    // Staged break-location row tint (sky S).
    stagedRowBg: '#eff6ff',
  },
  dark: {
    scrim: 'rgba(0, 0, 0, 0.5)',
    breakFeedbackBg: DARK_TONAL.green.tint,
    breakFeedbackText: DARK_TONAL.green.fg,
    addBreakSuccessBg: DARK_TONAL.green.fill,
    stagedRowBg: DARK_TONAL.sky.tint,
  },
});
