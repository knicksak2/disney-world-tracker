-- Disney World Tracker — Planned Item Optimization Result
-- Persists the optimizer's derived per-item output so a returning Trip_Member
-- sees their last optimized plan instead of a reset/placeholder timeline
-- (day-planning-optimization R8.1). All columns are nullable: an item is
-- "not optimized yet" precisely when they are NULL (R8.3). They are written
-- together by the optimize run and cleared together on manual edit (R8.4).

BEGIN;

-- predicted_wait_minutes: the wait read from the Prediction_Service snapshot at
--   this item's simulated arrival during the last optimize run.
-- travel_from_prev_minutes: travel leg from the previous scheduled item
--   (NULL for the first item of the day).
-- travel_from_prev_kind: leg type — 'walk' within a park, 'park_hop' across parks.
-- optimized_at: when this item was last part of an optimize run.
ALTER TABLE planned_items ADD COLUMN predicted_wait_minutes   INTEGER;
ALTER TABLE planned_items ADD COLUMN travel_from_prev_minutes INTEGER;
ALTER TABLE planned_items ADD COLUMN travel_from_prev_kind    TEXT;
ALTER TABLE planned_items ADD COLUMN optimized_at             TIMESTAMPTZ;

ALTER TABLE planned_items ADD CONSTRAINT planned_items_travel_kind_chk
  CHECK (travel_from_prev_kind IS NULL OR travel_from_prev_kind IN ('walk', 'park_hop'));

COMMIT;
