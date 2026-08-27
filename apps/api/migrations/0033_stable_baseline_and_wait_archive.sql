BEGIN;

-- ---------------------------------------------------------------------------
-- R14: Stable Ride_Baseline for the Crowd_Index denominator
-- ---------------------------------------------------------------------------
-- The observed Crowd_Index divided each ride's observed wait by that ride's
-- `ride_shapes.avg_wait_minutes`. But avg_wait_minutes is a FAST EMA (alpha
-- floor 2/22, ~4-week memory) updated toward the very observations that form
-- the index's numerator -- so the ratio was self-referential and drifted.
-- Measured over Aug 11-18 -> Aug 19-25 2026: the index rose in all four parks
-- (MK 0.819->0.909, HS 0.855->0.933, EPCOT 0.858->0.903, AK 0.881->0.901)
-- while the raw mean posted wait across the same samples FELL (23.85->23.25).
--
-- These two columns hold a deliberately slow companion (alpha floor 2/502,
-- ~500-sample memory) that acts as an absolute yardstick: it tracks genuine
-- multi-season drift in a ride's popularity/capacity but holds still within a
-- season. It denominates the Crowd_Index ONLY -- the wait-prediction tiers
-- continue to read the fast avg_wait_minutes.
ALTER TABLE ride_shapes ADD COLUMN baseline_wait_minutes REAL;
ALTER TABLE ride_shapes ADD COLUMN baseline_sample_count INTEGER NOT NULL DEFAULT 0;

-- Backfill from the level already in the store rather than cold-starting.
-- avg_wait_minutes still carries most of the Model_Seed's multi-year RopeDrop
-- average, which is exactly the absolute footing the baseline wants (R14.4).
-- Capping the seeded count at BASELINE_EMA_MAX_SAMPLES (500) makes an already
-- dense bucket immediately basket-eligible without pretending to more history
-- than the EMA can represent.
UPDATE ride_shapes
SET baseline_wait_minutes = avg_wait_minutes,
    baseline_sample_count = CASE WHEN sample_count > 500 THEN 500 ELSE sample_count END;

COMMENT ON COLUMN ride_shapes.baseline_wait_minutes IS
  'Slow-moving (~500-sample memory) expected wait; denominates the Crowd_Index (R14). NULL = not yet established. Never read by the wait-prediction tiers.';
COMMENT ON COLUMN ride_shapes.baseline_sample_count IS
  'Sample count backing baseline_wait_minutes; gates standby-basket eligibility at CROWD_INDEX_MIN_SHAPE_SAMPLES.';

-- ---------------------------------------------------------------------------
-- R15: crowd level embedded in each season-resolved bucket
-- ---------------------------------------------------------------------------
-- A season bucket is a direct average over (season, day_of_week, hour), so it
-- already contains the AVERAGE crowd level of the samples that formed it.
-- Storing that level lets the season tier scale by a RELATIVE factor
-- (forecastIndex / avg_crowd_index) instead of the absolute multiplier, which
-- would double-count crowd, or 1.0, which made a mature bucket ignore the date.
--
-- Deliberately NOT backfilled to 1.0: existing buckets accumulated under an
-- unknown crowd level and asserting 1.0 would bake in a false premise. NULL
-- means "fall back to the unscaled direct average" until it re-establishes.
ALTER TABLE experience_season_hour ADD COLUMN avg_crowd_index REAL;

COMMENT ON COLUMN experience_season_hour.avg_crowd_index IS
  'Recency-weighted mean observed Crowd_Index (continuous ratio, 1.0 = typical) of the samples forming this bucket (R15). NULL = unknown; tier falls back to the raw average.';

-- ---------------------------------------------------------------------------
-- R17: bounded historical wait archive
-- ---------------------------------------------------------------------------
-- wait_samples prunes at 30 days, which permanently discards the day-to-day
-- variation any future day-level model would train on. This keeps a compact
-- per (experience, ET date, ET hour) aggregate for ~3 years instead.
-- Written by a daily-recompute leg; read by NOTHING on the prediction path.
CREATE TABLE wait_archive (
  experience_id    UUID    NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  date             DATE    NOT NULL,
  hour             INTEGER NOT NULL,
  avg_wait_minutes REAL    NOT NULL,
  sample_count     INTEGER NOT NULL,
  min_wait_minutes REAL    NOT NULL,
  max_wait_minutes REAL    NOT NULL,
  PRIMARY KEY (experience_id, date, hour),
  CONSTRAINT wait_archive_hour_chk    CHECK (hour >= 0 AND hour <= 23),
  CONSTRAINT wait_archive_samples_chk CHECK (sample_count > 0),
  CONSTRAINT wait_archive_range_chk   CHECK (min_wait_minutes <= max_wait_minutes)
);
COMMENT ON TABLE wait_archive IS
  'Per (experience, ET date, ET hour) wait aggregate retained far beyond the wait_samples window (R17). Offline analysis / future model training only; never a prediction input.';

-- ---------------------------------------------------------------------------
-- R18: wait prediction accuracy logging + shadow evaluation
-- ---------------------------------------------------------------------------
-- The wait-side mirror of crowd_forecast_log / crowd_forecast_accuracy. Until
-- now nothing froze a predicted wait and scored it, so wait-model accuracy was
-- unmeasurable without an ad-hoc script.
--
-- predicted_wait_minutes is written ONCE and never rewritten: accuracy must be
-- measured against the forecast as issued, never a value recomputed with
-- hindsight. Reconciliation fills only the observed/error columns.
CREATE TABLE wait_forecast_log (
  experience_id           UUID        NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  date                    DATE        NOT NULL,
  hour                    INTEGER     NOT NULL,
  lead_days               INTEGER     NOT NULL,
  predicted_wait_minutes  REAL        NOT NULL,
  forecasted_at           TIMESTAMPTZ NOT NULL,
  -- Shadow mode: an alternative model's prediction on identical inputs. Scored
  -- separately and NEVER served (R18.5/R18.6). NULL when no challenger runs.
  challenger_wait_minutes REAL,
  observed_wait_minutes   REAL,
  error                   REAL,
  challenger_error        REAL,
  PRIMARY KEY (experience_id, date, hour, lead_days),
  CONSTRAINT wait_forecast_log_hour_chk CHECK (hour >= 0 AND hour <= 23),
  CONSTRAINT wait_forecast_log_lead_chk CHECK (lead_days >= 0)
);
COMMENT ON TABLE wait_forecast_log IS
  'Frozen predicted waits at defined lead times, reconciled against wait_archive (R18). predicted_wait_minutes is immutable once written.';

CREATE TABLE wait_forecast_accuracy (
  experience_id           UUID    NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  lead_days               INTEGER NOT NULL,
  mae                     REAL    NOT NULL DEFAULT 0,
  bias                    REAL    NOT NULL DEFAULT 0,
  sample_count            INTEGER NOT NULL DEFAULT 0,
  -- Challenger tallies are kept in separate columns so a shadow model can
  -- never contaminate the served model's numbers.
  challenger_mae          REAL,
  challenger_bias         REAL,
  challenger_sample_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (experience_id, lead_days),
  CONSTRAINT wait_forecast_accuracy_lead_chk    CHECK (lead_days >= 0),
  CONSTRAINT wait_forecast_accuracy_samples_chk CHECK (sample_count >= 0 AND challenger_sample_count >= 0)
);
COMMENT ON TABLE wait_forecast_accuracy IS
  'Recency-weighted MAE/bias in minutes per (experience, lead_days), with a separate challenger tally (R18.4/R18.5).';

COMMIT;
