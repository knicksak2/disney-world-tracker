-- Disney World Tracker — Walk/Wait Optimization Priority (R10)
-- Adds a per-Trip preference controlling how the Optimization_Engine weighs
-- walking time against queue wait time when ranking candidate schedules.
-- 'balanced' reproduces the pre-existing unweighted 1:1 cost formula.

BEGIN;

ALTER TABLE trips ADD COLUMN walk_wait_weighting TEXT NOT NULL DEFAULT 'balanced';

ALTER TABLE trips ADD CONSTRAINT trips_walk_wait_weighting_chk
  CHECK (walk_wait_weighting IN ('balanced', 'minimize_walking', 'minimize_waits'));

COMMIT;
