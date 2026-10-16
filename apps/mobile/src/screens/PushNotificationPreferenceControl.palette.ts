// Feature: dark-mode — co-located light/dark literal pairs for PushNotificationPreferenceControl.tsx.
import { darkTheme, definePalette } from '../theme/theme';

/**
 * Notification `Switch` track colours (design "Third-party and native props":
 * Switch colours become a palette pair). Light keeps today's `border` /
 * `primary` values byte-for-byte; dark lifts the off track to `borderStrong`
 * so it stays visible on the dark card, and the on track is the dark
 * `primary` fill.
 */
export const NOTIFICATION_SWITCH = definePalette({
  light: {
    trackOff: '#e2d9f0',
    trackOn: '#5b2a86',
  },
  // Dark Switch colours are applied by `themedSwitchProps` (theme/switchColors.ts);
  // these mirror its tokens.
  dark: {
    trackOff: darkTheme.color.borderStrong,
    trackOn: darkTheme.color.primary,
  },
});
