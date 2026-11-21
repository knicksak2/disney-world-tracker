-- Disney World Tracker — Optional notes on Trip Settlements (trip-expenses Req 7.8)
--
-- Adds a nullable `note` column to `settlements` so members can record free-text
-- context about a repayment (e.g. payment method or expenses covered).
-- Additive and idempotent on reapply; existing rows default to NULL.

BEGIN;

ALTER TABLE settlements ADD COLUMN IF NOT EXISTS note VARCHAR(300);

ALTER TABLE settlements DROP CONSTRAINT IF EXISTS chk_settlements_note;
ALTER TABLE settlements ADD CONSTRAINT chk_settlements_note
  CHECK (note IS NULL OR (char_length(btrim(note)) >= 1 AND char_length(note) <= 300));

COMMIT;
