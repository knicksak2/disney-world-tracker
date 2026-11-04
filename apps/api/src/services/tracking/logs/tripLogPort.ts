/**
 * Structural port for delegating Trip-linked experience logging and feed purging.
 *
 * Owned by the Tracking service; implemented and injected by `composeServices.ts`.
 * Imports nothing from `services/trips/` to preserve structural isolation.
 *
 * Validates: Requirements 5.4, 5.5, 11.1
 */

export interface TripLogPort {
  /**
   * Trip-linked create. Implementation (composeServices) runs assertTripMember, then tripRepo.logCompletion.
   * Throws AppError trip_forbidden | trip_validation_failed | log_outside_trip_dates.
   */
  logToTrip(input: {
    readonly tripId: string;
    readonly userId: string;
    readonly experienceId: string;
    readonly visitedOn: string;
    readonly userTz: string;
    readonly rating: number | null;
    readonly note: string | null;
    readonly rodeWith: readonly string[];
  }): Promise<{
    readonly logId: string; // experience_logs.id
    readonly loggedAt: string; // ISO timestamp of the experience_logs row
    readonly logEntryId: string; // trip_log_entries.id
    readonly pendingTags: readonly { readonly tagId: string; readonly taggedMemberId: string }[];
  }>;

  /**
   * Delete the feed item (+ its reactions + comments) of the Trip_Log_Entry linked to `logId`, if any.
   * Scoped to logs owned by `userId`: a log that does not exist or belongs to someone else is a no-op.
   * Idempotent.
   */
  purgeFeedForLog(logId: string, userId: string): Promise<void>;
}

