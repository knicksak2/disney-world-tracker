// Feature: dark-mode — co-located light/dark literal pairs for CompletionControls.tsx.
import { definePalette } from '../../theme/theme';

/** Edit-date modal scrim (rule 2 exception: textPrimary rgba used as a scrim). */
export const SCRIM = definePalette({
  light: { backdrop: 'rgba(31, 18, 53, 0.5)' },
  dark: { backdrop: 'rgba(0, 0, 0, 0.5)' },
});
