BEGIN;

-- Ride Shapes
CREATE TABLE ride_shapes (
  experience_id UUID NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  hour INTEGER NOT NULL CHECK (hour >= 0 AND hour <= 23),
  avg_wait_minutes REAL NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  sr_avg_wait_minutes REAL,
  sr_sample_count INTEGER,
  stddev_wait REAL NOT NULL DEFAULT 0,
  p50_wait REAL NOT NULL DEFAULT 0,
  p90_wait REAL NOT NULL DEFAULT 0,
  down_rate REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (experience_id, day_of_week, hour)
);
COMMENT ON TABLE ride_shapes IS 'Per-Experience expected posted standby wait by (day_of_week, hour)';

-- Season resolved buckets
CREATE TABLE experience_season_hour (
  experience_id UUID NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  season INTEGER NOT NULL CHECK (season >= 0 AND season <= 3), -- 0=Winter, 1=Spring, 2=Summer, 3=Fall
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  hour INTEGER NOT NULL CHECK (hour >= 0 AND hour <= 23),
  avg_wait_minutes REAL NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (experience_id, season, day_of_week, hour)
);
COMMENT ON TABLE experience_season_hour IS 'Season-resolved direct average wait time';

-- Park Crowd Index
CREATE TABLE park_crowd_index (
  park TEXT NOT NULL,
  date DATE NOT NULL,
  crowd_index REAL NOT NULL,
  daily_avg_wait REAL NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (park, date)
);
COMMENT ON TABLE park_crowd_index IS 'Per-Park, per-date busyness value (continuous real number)';

-- Park Schedule Signals
CREATE TABLE park_schedule_signals (
  park TEXT NOT NULL,
  date DATE NOT NULL,
  open_time TIMESTAMPTZ,
  close_time TIMESTAMPTZ,
  early_entry BOOLEAN NOT NULL DEFAULT FALSE,
  extended_evening BOOLEAN NOT NULL DEFAULT FALSE,
  ticketed_event BOOLEAN NOT NULL DEFAULT FALSE,
  ll_multipass_price_cents INTEGER,
  PRIMARY KEY (park, date)
);
COMMENT ON TABLE park_schedule_signals IS 'ThemeParks schedule endpoint signals';

-- Crowd Forecast Log
CREATE TABLE crowd_forecast_log (
  park TEXT NOT NULL,
  date DATE NOT NULL,
  lead_days INTEGER NOT NULL,
  forecast_index REAL NOT NULL,
  forecasted_at TIMESTAMPTZ NOT NULL,
  observed_index REAL,
  error REAL,
  PRIMARY KEY (park, date, lead_days)
);
COMMENT ON TABLE crowd_forecast_log IS 'Captured frozen forecasts for upcoming dates at defined lead times';

-- Crowd Forecast Accuracy
CREATE TABLE crowd_forecast_accuracy (
  park TEXT NOT NULL,
  lead_days INTEGER NOT NULL,
  mae REAL NOT NULL DEFAULT 0,
  bias REAL NOT NULL DEFAULT 0,
  sample_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (park, lead_days)
);
COMMENT ON TABLE crowd_forecast_accuracy IS 'Recency-weighted rolling accuracy';

-- Experience Signals
CREATE TABLE experience_signals (
  experience_id UUID NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  has_single_rider BOOLEAN NOT NULL DEFAULT FALSE,
  uses_virtual_queue BOOLEAN NOT NULL DEFAULT FALSE,
  downtime_rate REAL NOT NULL DEFAULT 0,
  ll_sellout_median_hour REAL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (experience_id)
);
COMMENT ON TABLE experience_signals IS 'Slowly-changing rolling per-ride facts';

-- Experience Daily Signals
CREATE TABLE experience_daily_signals (
  experience_id UUID NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  ll_price_cents INTEGER,
  ll_available BOOLEAN,
  used_virtual_queue BOOLEAN,
  showtimes JSONB,
  PRIMARY KEY (experience_id, date)
);
COMMENT ON TABLE experience_daily_signals IS 'Per-date facts from the live/schedule feeds';

-- Weather Observations
CREATE TABLE weather_observations (
  observed_at TIMESTAMPTZ NOT NULL,
  temp_f REAL NOT NULL,
  precip REAL NOT NULL,
  condition TEXT NOT NULL,
  PRIMARY KEY (observed_at)
);
COMMENT ON TABLE weather_observations IS 'Observed weather for the WDW location';

-- Experience Weather Sensitivity
CREATE TABLE experience_weather_sensitivity (
  experience_id UUID NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  condition TEXT NOT NULL,
  wait_multiplier REAL NOT NULL DEFAULT 1.0,
  sample_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (experience_id, condition)
);
COMMENT ON TABLE experience_weather_sensitivity IS 'Relative wait adjustment by condition versus a clear-sky baseline';

-- Experience Event Impact
CREATE TABLE experience_event_impact (
  experience_id UUID NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  wait_multiplier REAL NOT NULL DEFAULT 1.0,
  sample_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (experience_id, event_type)
);
COMMENT ON TABLE experience_event_impact IS 'Relative change in an Experience wait during nearby entertainment vs baseline';

-- Ride Cascade
CREATE TABLE ride_cascade (
  down_experience_id UUID NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  affected_experience_id UUID NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  wait_delta REAL NOT NULL DEFAULT 0,
  wait_pct_delta REAL NOT NULL DEFAULT 0,
  baseline_wait REAL NOT NULL DEFAULT 0,
  sample_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (down_experience_id, affected_experience_id)
);
COMMENT ON TABLE ride_cascade IS 'Same-park pairwise effect of a breakdown';

-- Wait Samples
CREATE TABLE wait_samples (
  experience_id UUID NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  observed_at TIMESTAMPTZ NOT NULL,
  wait_minutes REAL NOT NULL,
  status TEXT NOT NULL,
  PRIMARY KEY (experience_id, observed_at)
);
COMMENT ON TABLE wait_samples IS 'Raw samples, pruned to a bounded recent window';

COMMIT;
