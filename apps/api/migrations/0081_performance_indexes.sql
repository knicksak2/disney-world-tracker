-- Performance indexes for hot queries and cron sweeps, plus removal of
-- redundant indexes that duplicate leading primary-key columns.
--
-- Idempotent (IF NOT EXISTS / IF EXISTS) so re-applying is safe.

BEGIN;

-- Trip feed & detail queries filter trip_reactions / trip_comments by (trip_id, target_type).
CREATE INDEX IF NOT EXISTS trip_reactions_trip_target_idx
  ON trip_reactions (trip_id, target_type);

CREATE INDEX IF NOT EXISTS trip_comments_trip_target_order_idx
  ON trip_comments (trip_id, target_type, created_at ASC, id ASC);

-- Daily wait-sample pruning and archival scan by observed_at.
CREATE INDEX IF NOT EXISTS wait_samples_observed_at_idx
  ON wait_samples (observed_at);

-- Daily wait-forecast reconciliation and pruning filter by date.
CREATE INDEX IF NOT EXISTS wait_forecast_log_date_idx
  ON wait_forecast_log (date);

-- Experience-level completion lookups (completions PK is (user_id, experience_id)).
CREATE INDEX IF NOT EXISTS completions_experience_id_idx
  ON completions (experience_id);

-- Redundant with PRIMARY KEY (target_type, target_id, member_id, reaction).
DROP INDEX IF EXISTS trip_reactions_target_idx;

-- Redundant with PRIMARY KEY (user_id, experience_id).
DROP INDEX IF EXISTS completions_user_id_idx;

COMMIT;
