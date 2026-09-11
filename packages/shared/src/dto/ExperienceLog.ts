/**
 * Experience_Log DTOs.
 *
 * An Experience_Log is a single record of a User experiencing an attraction,
 * show, or restaurant on a specific calendar date, with an optional per-visit
 * Rating (1-10) and Note. Unlike a Completion (at most one per user/experience)
 * a User accumulates many Experience_Logs for the same Experience over repeat
 * visits, forming their Visit_History.
 *
 * Validates: Requirements 1.1, 4.1, 4.2
 */

export interface ExperienceLogDTO {
  readonly id: string;
  readonly userId: string;
  readonly experienceId: string;

  /** ISO-8601 calendar date (YYYY-MM-DD) the Experience was visited (R1.1). */
  readonly visitedOn: string;

  /** IANA time zone identifier the visit date was captured in (R1.1). */
  readonly userTz: string;

  /** ISO-8601 UTC timestamp the log row was written (R1.1, R4.1). */
  readonly loggedAt: string;

  /** Per-visit Rating in `[1, 10]`, or `null` when the visit was unrated. */
  readonly rating: number | null;

  /** Per-visit Note (1-2000 chars), or `null` when none was entered. */
  readonly note: string | null;
}

/**
 * The chronological Visit_History for one User and Experience: every
 * Experience_Log sorted `visited_on DESC, logged_at DESC`, plus the
 * `repeatCount` which always equals `logs.length` (R4.1, R4.2, R4.3).
 */
export interface ExperienceVisitHistoryDTO {
  readonly experienceId: string;
  readonly repeatCount: number;
  readonly logs: readonly ExperienceLogDTO[];
}
