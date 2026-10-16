// Feature: dark-mode — co-located light/dark literal pairs for OverallHeroCard.tsx.
import { DARK_TONAL, definePalette } from '../../../theme/theme';

/**
 * Activity-pillar metric tiles on the hero card (rule 3). The "Rides Logged"
 * tile uses the `surfaceAlt` / `primaryFg` tokens instead.
 */
export const HERO_METRIC = definePalette({
  light: {
    // "Park Days": sky family, S (tile) / T (glyph).
    parkDaysBg: '#e8f4ff',
    parkDaysFg: '#2f80ed',
    // "Repeat Multiplier": orange family, S (tile) / T (glyph).
    repeatBg: '#fff4e6',
    repeatFg: '#d9480f',
  },
  dark: {
    parkDaysBg: DARK_TONAL.sky.tint,
    parkDaysFg: DARK_TONAL.sky.fg,
    repeatBg: DARK_TONAL.orange.tint,
    repeatFg: DARK_TONAL.orange.fg,
  },
});
