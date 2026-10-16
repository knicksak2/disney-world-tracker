// Feature: dark-mode — co-located light/dark literal pairs for YouAndCrewScreen.tsx.
import { DARK_TONAL, definePalette } from '../../theme/theme';

/**
 * "Shared Items" entry-card icon circles (rule 3): Share Inbox is sky
 * family, Sent Shares is violet family; S for the circle, T for the glyph.
 */
export const SHARE_ICON = definePalette({
  light: {
    inboxBg: '#e3f2fd',
    inboxFg: '#1976d2',
    sentBg: '#f3e5f5',
    sentFg: '#7b1fa2',
  },
  dark: {
    inboxBg: DARK_TONAL.sky.tint,
    inboxFg: DARK_TONAL.sky.fg,
    sentBg: DARK_TONAL.violet.tint,
    sentFg: DARK_TONAL.violet.fg,
  },
});
