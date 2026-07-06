/**
 * Avatar preset catalog.
 *
 * The Profile avatar is chosen from a fixed set of original, Disney-themed
 * illustrations bundled with the mobile app rather than an uploaded image.
 * This module is the single source of truth for the set of valid preset ids:
 *
 *   - The API validates `PUT /me/profile/avatar` bodies against this list and
 *     stores the chosen id in `profiles.avatar_preset` (the DB CHECK
 *     constraint mirrors the same ids).
 *   - The mobile app maps each id to a local `react-native-svg` component for
 *     rendering, and iterates the ordered list to build the picker grid.
 *
 * Because the artwork lives client-side there is no hosted URL: the avatar is
 * referenced by *id*, not by URL. `ProfileDTO.avatarPreset` therefore carries
 * one of these ids (or `null` when the user has not chosen one).
 *
 * Adding a preset is a two-step change: add the id here (and to the migration
 * CHECK constraint), then register the matching SVG component in the mobile
 * `avatars` registry. Removing an id is a breaking change for any Profile that
 * already references it, so prefer deprecating over deleting.
 */

/**
 * Ordered list of valid avatar preset ids. The order is the display order in
 * the picker grid. Declared `as const` so the element type is the exact string
 * literal union rather than `string[]`.
 */
export const AVATAR_PRESET_IDS = [
  'castle',
  'wishing-star',
  'ear-balloon',
  'fireworks',
  'magic-wand',
  'teacup',
  'carousel',
  'hot-air-balloon',
  'popcorn',
  'monorail',
  'turkey-leg',
  'ice-cream-bar',
] as const;

/** The closed union of valid avatar preset ids. */
export type AvatarPresetId = (typeof AVATAR_PRESET_IDS)[number];

/**
 * Runtime guard: `true` when `value` is one of the known preset ids. Useful on
 * the client where a stored id read back from the API is typed as `string`.
 */
export function isAvatarPresetId(value: unknown): value is AvatarPresetId {
  return (
    typeof value === 'string' &&
    (AVATAR_PRESET_IDS as readonly string[]).includes(value)
  );
}
