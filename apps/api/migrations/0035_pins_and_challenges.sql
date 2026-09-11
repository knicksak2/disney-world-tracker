-- ===========================================================================
-- 0035_pins_and_challenges.sql
-- ---------------------------------------------------------------------------
-- Pin Collection (Feature: pin-collection, Series 1).
--
-- Pin *definitions* (the 174-pin roster, tiers, tracks, and challenge criteria)
-- are the single source of truth in `@dwt/shared` (`packages/shared/src/pins/
-- catalog.ts`); the database only records which Pins a User has *earned*. This
-- migration introduces the `user_pins` award ledger.
--
-- A row is inserted the moment a challenge's criteria are first satisfied, with
-- `awarded_at = now()`. Awards are monotonic and idempotent: the UNIQUE
-- (user_id, pin_id) constraint backs the evaluator's `ON CONFLICT
-- (user_id, pin_id) DO NOTHING`, so re-evaluating a challenge never duplicates
-- an award and a once-earned Pin can never be revoked by a later mutation
-- (R2.4, Property 1).
--
-- `pin_id` is a TEXT catalog id (e.g. `gold_coaster_royalty`), NOT a foreign
-- key — the Pin catalog lives in shared code, not a table — so an id that is
-- retired from the catalog leaves its historical awards intact.
--
-- Strictly additive: one new table and its index. No existing table, column,
-- or constraint is touched. Wrapped in BEGIN/COMMIT and idempotent to re-apply
-- via IF NOT EXISTS.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- user_pins — the per-User award ledger
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_pins (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pin_id      TEXT         NOT NULL,
    awarded_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT user_pins_unique UNIQUE (user_id, pin_id),
    CONSTRAINT user_pins_pin_id_length_chk CHECK (char_length(pin_id) BETWEEN 1 AND 100)
);

-- Board query: every Pin a User has earned, most-recent first.
CREATE INDEX IF NOT EXISTS user_pins_user_id_idx ON user_pins(user_id, awarded_at DESC);

COMMIT;
