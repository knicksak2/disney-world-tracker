-- ===========================================================================
-- 0038_pin_showcase_share_kind.sql
-- ---------------------------------------------------------------------------
-- Pin Collection — Pin Showcase Sharing (Feature: pin-collection, Requirement 24).
--
-- Widens the `shares.payload_kind` CHECK constraint to include 'pinShowcase',
-- and updates `shares_experience_payload_chk` to enforce that 'pinShowcase'
-- shares have a NULL experience_id (sharing the showcase references the sender's
-- current showcase board, not an individual catalog experience).
--
-- Strictly additive: widens permitted check constraints on `shares`.
-- Wrapped in BEGIN/COMMIT and idempotent.
-- ===========================================================================

BEGIN;

ALTER TABLE shares DROP CONSTRAINT IF EXISTS shares_payload_kind_chk;
ALTER TABLE shares ADD CONSTRAINT shares_payload_kind_chk
    CHECK (payload_kind IN ('experience', 'progress', 'pinShowcase'));

ALTER TABLE shares DROP CONSTRAINT IF EXISTS shares_experience_payload_chk;
ALTER TABLE shares ADD CONSTRAINT shares_experience_payload_chk CHECK (
    (payload_kind = 'experience' AND experience_id IS NOT NULL)
    OR (payload_kind IN ('progress', 'pinShowcase') AND experience_id IS NULL)
);

COMMIT;
