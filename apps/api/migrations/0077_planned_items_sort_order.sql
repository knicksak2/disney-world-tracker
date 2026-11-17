-- Manual Schedule Ordering (day-planning-optimization R12.1):
-- Adds nullable sort_order to planned_items so Trip_Members can arrange
-- a day's experiences in any manual sequence without setting clock times.

BEGIN;

ALTER TABLE planned_items
  ADD COLUMN IF NOT EXISTS sort_order INTEGER;

COMMIT;
