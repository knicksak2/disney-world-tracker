BEGIN;

CREATE TABLE derived_stat_runs (
  leg                  TEXT        PRIMARY KEY,
  last_success_at      TIMESTAMPTZ,
  last_error_at        TIMESTAMPTZ,
  last_error           TEXT,
  consecutive_failures INTEGER     NOT NULL DEFAULT 0,
  CONSTRAINT derived_stat_runs_failures_chk CHECK (consecutive_failures >= 0)
);
COMMENT ON TABLE derived_stat_runs IS
  'One row per daily-recompute leg: when it last succeeded, when it last failed, and how many times in a row. Bounded at one row per leg.';

COMMIT;
