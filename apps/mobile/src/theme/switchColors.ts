/**
 * Feature: dark-mode — themed React Native `Switch` colours (Requirement 9.15).
 *
 * Light returns the call site's own props verbatim (today's values, with
 * `undefined` kept so platform defaults stay untouched). Dark returns one
 * token-derived set so every Switch reads the same and "on" is clearly
 * stronger than "off": a brighter `primary` track with a white thumb versus a
 * `borderStrong` track with a muted `textSecondary` thumb.
 *
 * Call sites also pass `key={t.scheme}` so the native view remounts on a scheme
 * switch: Android never resets a colour prop that is merely omitted, so a
 * dark→light switch would otherwise keep the dark colours.
 */
import type { AppTheme } from './theme';

export interface SwitchColorProps {
  readonly trackColor?: { readonly false?: string; readonly true?: string };
  readonly thumbColor?: string;
  readonly ios_backgroundColor?: string;
}

export function themedSwitchProps(
  t: AppTheme,
  value: boolean,
  light: SwitchColorProps = {},
): SwitchColorProps {
  if (t.scheme === 'light') return light;
  return {
    trackColor: { false: t.color.borderStrong, true: t.color.primary },
    thumbColor: value ? t.color.textOnPrimary : t.color.textSecondary,
    ios_backgroundColor: t.color.borderStrong,
  };
}
