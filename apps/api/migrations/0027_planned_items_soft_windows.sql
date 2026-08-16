-- Disney World Tracker — Planned Items Soft Time Windows, Custom Title, Meal Periods & Unlocated Items
--
-- Supports:
-- 1. Unlocated items (unlocated breaks) where experience_id is NULL
-- 2. Custom title for unlocated breaks / custom plans
-- 3. Soft time windows (window_start_minutes, window_end_minutes)
-- 4. Meal period ('breakfast', 'lunch', 'dinner')
-- 5. Persisted scheduled_showtime for show slotting

BEGIN;

ALTER TABLE planned_items ALTER COLUMN experience_id DROP NOT NULL;

ALTER TABLE planned_items ADD COLUMN custom_title VARCHAR(255);
ALTER TABLE planned_items ADD COLUMN window_start_minutes SMALLINT;
ALTER TABLE planned_items ADD COLUMN window_end_minutes SMALLINT;
ALTER TABLE planned_items ADD COLUMN meal_period VARCHAR(20);
ALTER TABLE planned_items ADD COLUMN scheduled_showtime TIMESTAMPTZ;

ALTER TABLE planned_items ADD CONSTRAINT chk_planned_items_window_both_or_neither
  CHECK (
    (window_start_minutes IS NULL AND window_end_minutes IS NULL) OR
    (window_start_minutes IS NOT NULL AND window_end_minutes IS NOT NULL)
  );

ALTER TABLE planned_items ADD CONSTRAINT chk_planned_items_window_range
  CHECK (
    window_start_minutes IS NULL OR (
      window_start_minutes >= 0 AND
      window_start_minutes <= 1440 AND
      window_end_minutes >= 0 AND
      window_end_minutes <= 1440 AND
      window_end_minutes >= window_start_minutes
    )
  );

ALTER TABLE planned_items ADD CONSTRAINT chk_planned_items_meal_period
  CHECK (
    meal_period IS NULL OR meal_period IN ('breakfast', 'lunch', 'dinner')
  );

COMMIT;
