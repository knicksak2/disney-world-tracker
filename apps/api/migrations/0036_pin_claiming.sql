-- ===========================================================================
-- 0036_pin_claiming.sql
-- ---------------------------------------------------------------------------
-- Pin Collection — Manual Claim (Feature: pin-collection, Requirement 20).
--
-- Adds `claimed_at` to `user_pins`. `awarded_at` keeps its exact current
-- meaning (criteria met, server truth) — this migration touches nothing about
-- awarding. `claimed_at` is purely presentational: it gates when the App
-- shows a Pin's full celebration/art, never whether the Pin counts toward the
-- tier summary or overall completion percentage (Requirement 20.5). NULL means
-- "awarded but not yet claimed" (ready to claim); a set value means claimed.
--
-- Strictly additive: one nullable column on an existing table. No existing
-- column, constraint, or index is touched. Wrapped in BEGIN/COMMIT and
-- idempotent to re-apply via IF NOT EXISTS.
-- ===========================================================================

BEGIN;

ALTER TABLE user_pins ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ NULL;

COMMIT;
