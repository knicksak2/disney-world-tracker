// Feature: dark-mode — co-located light/dark literal pairs for ExperienceListDiscoveryScreen.tsx.
import { DARK_TONAL, definePalette } from '../../theme/theme';

/**
 * Empty-state compass icon. It read `borderStrong` as an icon colour — an
 * out-of-role token read, so rule 1a sends its light value `#cdbce6` to rule 3
 * (violet family, role T).
 */
export const EXPERIENCE_DISCOVERY = definePalette({
  light: { emptyIcon: '#cdbce6' },
  dark: { emptyIcon: DARK_TONAL.violet.fg },
});
