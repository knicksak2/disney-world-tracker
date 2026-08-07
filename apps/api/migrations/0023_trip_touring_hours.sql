-- Disney World Tracker — Trip Touring Hours and Event Settings Persistence
-- Adds day_touring_hours JSONB column to trips table for storing per-date settings.

BEGIN;

ALTER TABLE trips ADD COLUMN day_touring_hours JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
