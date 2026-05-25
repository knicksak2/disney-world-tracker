/**
 * Profile DTO.
 *
 * Public-facing account information for a User: display name, optional avatar,
 * and the User's overall completion percentage as computed by Stats_Service
 * (R7.4). The avatar is referenced by URL — the bytes themselves live in
 * object storage per the design.
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5
 */

export interface ProfileDTO {
  /** Owning User id; matches `UserDTO.id`. */
  readonly userId: string;

  /**
   * Display name; trimmed, 1-50 characters, with at least one non-whitespace
   * character (R7.2, R7.5, R7.6).
   */
  readonly displayName: string;

  /**
   * URL of the avatar image, or `null` if none is set. The image is stored as
   * PNG or JPEG ≤ 5 MB per R7.3.
   */
  readonly avatarUrl: string | null;

  /**
   * Overall completion percentage in `[0.0, 100.0]` to one decimal place
   * (R7.4 + R3.1, R3.8). Always present in responses so the client can render
   * the profile consistently.
   */
  readonly overallCompletionPercent: number;
}
