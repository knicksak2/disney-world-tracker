/**
 * Profile DTO.
 *
 * Public-facing account information for a User: display name, optional avatar,
 * and the User's overall completion percentage as computed by Stats_Service
 * (R7.4). The avatar is referenced by a *preset id* — the artwork is a fixed
 * set of original Disney-themed illustrations bundled with the mobile app, so
 * there is no hosted image URL. See `constants/avatarPresets.ts`.
 *
 * Validates: Requirements 7.1, 7.2, 7.4, 7.5
 */

import type { AvatarPresetId } from '../constants/avatarPresets.js';

export interface ProfileDTO {
  /** Owning User id; matches `UserDTO.id`. */
  readonly userId: string;

  /**
   * Display name; trimmed, 1-50 characters, with at least one non-whitespace
   * character (R7.2, R7.5, R7.6).
   */
  readonly displayName: string;

  /**
   * Chosen avatar preset id, or `null` when the user has not picked one. The
   * id maps to a bundled SVG illustration on the client; a `null` renders the
   * default placeholder.
   */
  readonly avatarPreset: AvatarPresetId | null;

  /**
   * Overall completion percentage in `[0.0, 100.0]` to one decimal place
   * (R7.4 + R3.1, R3.8). Always present in responses so the client can render
   * the profile consistently.
   */
  readonly overallCompletionPercent: number;
}
