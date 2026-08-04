-- Disney World Tracker — Planned Item Scheduling & Trip Planning Settings
-- Extends the trips and planned_items tables to support day-by-day organization,
-- optimization constraints (fixed/flexible), and trip-wide planning preferences.

BEGIN;

-- ---------------------------------------------------------------------------
-- trips additions
-- ---------------------------------------------------------------------------
-- walking_speed: scales the travel time between attractions (slow=50m/min, moderate=80m/min, fast=100m/min).
-- early_entry_eligible: allows optimization to start 30 minutes before official opening.
ALTER TABLE trips ADD COLUMN walking_speed       TEXT    NOT NULL DEFAULT 'moderate';
ALTER TABLE trips ADD COLUMN early_entry_eligible BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE trips ADD CONSTRAINT trips_walking_speed_chk CHECK (walking_speed IN ('slow', 'moderate', 'fast'));

-- ---------------------------------------------------------------------------
-- experiences additions
-- ---------------------------------------------------------------------------
-- duration_minutes: specific length of the experience (R1.5).
ALTER TABLE experiences ADD COLUMN duration_minutes INTEGER;

-- ---------------------------------------------------------------------------
-- planned_items enhancements
-- ---------------------------------------------------------------------------
-- planned_date: the specific day of the Trip this item is scheduled for.
-- planned_time: the suggested (or fixed) start time for the experience.
-- is_fixed: TRUE if the user set the time manually (e.g. Lightning Lane, Dining).
-- priority: used by the optimizer to drop/delay items when the day is full (1=Must-Do).
-- item_type: allows adding 'break' items (e.g. Lunch) that the optimizer can slot.
-- duration_minutes: override for how long an experience or break takes.
ALTER TABLE planned_items ADD COLUMN planned_date     DATE;
ALTER TABLE planned_items ADD COLUMN planned_time     TIMESTAMPTZ;
ALTER TABLE planned_items ADD COLUMN is_fixed         BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE planned_items ADD COLUMN priority         INTEGER NOT NULL DEFAULT 2;
ALTER TABLE planned_items ADD COLUMN item_type        TEXT    NOT NULL DEFAULT 'experience';
ALTER TABLE planned_items ADD COLUMN duration_minutes INTEGER;

ALTER TABLE planned_items ADD CONSTRAINT planned_items_priority_chk CHECK (priority BETWEEN 1 AND 3);
ALTER TABLE planned_items ADD CONSTRAINT planned_items_type_chk     CHECK (item_type IN ('experience', 'break'));

-- Remove the unique constraint to allow planning the same ride multiple times in a trip.
ALTER TABLE planned_items DROP CONSTRAINT planned_items_unique;

COMMIT;
