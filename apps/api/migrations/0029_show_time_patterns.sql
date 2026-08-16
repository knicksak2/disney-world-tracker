BEGIN;

-- Historical typical showtime patterns derived from trailing experience_daily_signals showtimes (crowd-calendar R12).
CREATE TABLE show_time_patterns (
  experience_id UUID    NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  day_of_week   INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  start_minutes INTEGER NOT NULL CHECK (start_minutes >= 0 AND start_minutes <= 1440),
  frequency     REAL    NOT NULL,
  sample_count  INTEGER NOT NULL,
  PRIMARY KEY (experience_id, day_of_week, start_minutes)
);

COMMIT;
