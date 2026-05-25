/**
 * Completion DTO.
 *
 * A record indicating that a User has completed a specific Experience. At
 * most one Completion exists per `(user, experience)` pair (R2.3). The date
 * is captured in the User's local time zone and must not be in the future
 * relative to that zone (R2.1, R2.6).
 *
 * Validates: Requirements 2.1, 2.3, 2.5, 2.6
 */

export interface CompletionDTO {
  readonly userId: string;
  readonly experienceId: string;

  /**
   * ISO-8601 calendar date (YYYY-MM-DD) the Experience was completed, in the
   * User's local time zone (R2.1).
   */
  readonly completedOn: string;

  /**
   * IANA time zone identifier the date was captured in (e.g.
   * `America/New_York`), so the server can validate "not in the future"
   * consistently (R2.6).
   */
  readonly userTz: string;
}
