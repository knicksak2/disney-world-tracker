-- Disney World Tracker — Planned Item Reservations (booking facet)
--
-- A Reservation is NOT a new entity: it is an existing planned_items row
-- carrying a non-null reservation_kind plus optional booking metadata. The
-- scheduling model already supports the two timing shapes a booking needs —
-- an exact pin (is_fixed + planned_time) for dining and timed activities, and
-- a return window (is_lightning_lane + planned_time) for Lightning Lane — so
-- the Schedule Builder and the optimizer pick a Reservation up for free and a
-- booking can never drift from its scheduled item.
--
-- Supports:
-- 1. reservation_kind — the booking vocabulary (NULL = ordinary planned item)
-- 2. confirmation_number — the free-text booking reference
-- 3. party_size — how many guests the booking covers (display only)
-- 4. A Reservation is always anchored to a date AND a time
-- 5. A partial index for the per-Trip Reservations read
--
-- Additive and idempotent on reapply: no column is dropped, renamed, or made
-- NOT NULL, so every existing row stays valid with all three columns NULL —
-- i.e. no existing planned item retroactively becomes a Reservation.

BEGIN;

ALTER TABLE planned_items ADD COLUMN IF NOT EXISTS reservation_kind    VARCHAR(20);
ALTER TABLE planned_items ADD COLUMN IF NOT EXISTS confirmation_number VARCHAR(40);
ALTER TABLE planned_items ADD COLUMN IF NOT EXISTS party_size          SMALLINT;

ALTER TABLE planned_items DROP CONSTRAINT IF EXISTS chk_planned_items_reservation_kind;
ALTER TABLE planned_items ADD CONSTRAINT chk_planned_items_reservation_kind
  CHECK (
    reservation_kind IS NULL OR
    reservation_kind IN ('dining', 'lightning_lane', 'activity', 'other')
  );

ALTER TABLE planned_items DROP CONSTRAINT IF EXISTS chk_planned_items_party_size;
ALTER TABLE planned_items ADD CONSTRAINT chk_planned_items_party_size
  CHECK (
    party_size IS NULL OR (party_size >= 1 AND party_size <= 50)
  );

-- A Reservation is a real booking, so it always has a date and a time. The repo
-- rejects clearing either with `trip_validation_failed`; this constraint is the
-- backstop and must never be the thing that fires.
ALTER TABLE planned_items DROP CONSTRAINT IF EXISTS chk_planned_items_reservation_anchored;
ALTER TABLE planned_items ADD CONSTRAINT chk_planned_items_reservation_anchored
  CHECK (
    reservation_kind IS NULL OR
    (planned_date IS NOT NULL AND planned_time IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS planned_items_reservation_idx
  ON planned_items (trip_id, planned_date)
  WHERE reservation_kind IS NOT NULL;

COMMIT;
