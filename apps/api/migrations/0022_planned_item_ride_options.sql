-- Disney World Tracker — Planned Item Ride Options
-- Adds Lightning Lane and Single Rider flags to Planned_Items for optimization.

BEGIN;

ALTER TABLE planned_items ADD COLUMN is_lightning_lane BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE planned_items ADD COLUMN use_single_rider BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
