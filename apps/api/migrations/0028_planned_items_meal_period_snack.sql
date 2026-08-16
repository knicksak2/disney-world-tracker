-- Disney World Tracker — Add 'snack' to Planned Items Meal Period Constraint
--
-- Supports:
-- 1. Widening chk_planned_items_meal_period to include 'snack'

BEGIN;

ALTER TABLE planned_items DROP CONSTRAINT IF EXISTS chk_planned_items_meal_period;

ALTER TABLE planned_items ADD CONSTRAINT chk_planned_items_meal_period
  CHECK (
    meal_period IS NULL OR meal_period IN ('breakfast', 'lunch', 'dinner', 'snack')
  );

COMMIT;
