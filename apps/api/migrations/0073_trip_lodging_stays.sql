-- Disney World Tracker: Trip lodging stays (trip-lodging-stays spec).
--
-- A Stay is one lodging booking of a Trip: a kind (resort, partner_hotel or offsite), a catalog Resort or a free-text
-- name, optionally a check-in and a check-out, and optionally the subset of the party who are on it. The Trip keeps an
-- ordered list of Stays. `trip_resorts` is NOT touched here: it stays the derived set of resort ids so every existing
-- reader (booking, stats, summaries, pins) keeps working; the application rewrites it whenever the Stays change.
--
-- DDL only. The data backfill for existing trips is the next migration (0074).
--
-- pg-mem compatibility (this file runs under accountDeletion/__tests__/helpers.ts buildMigratedDb, which applies every
-- migration): only functions that helper registers (jsonb_typeof, char_length, btrim), no NULLS LAST inside an index and
-- no non-unique partial index, which pg-mem uses for unpredicated selects and thereby hides the rows where the indexed
-- column is NULL. Limits that SQL cannot express portably are enforced in the application instead:
--   - at most 50 party keys per stay (Zod + repo), at most 8 stays per trip (repo);
--   - at most 60 nights per stay and no overlapping nights between a trip's stays (repo, under the trip row lock).
--
-- party_keys holds person keys ('m:<id>' / 'g:<id>') as plain text with no foreign key to users, so account deletion needs
-- no disposition entry; a key whose person has left is ignored by every consumer.

BEGIN;

CREATE TABLE IF NOT EXISTS trip_stays (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id      UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  position     SMALLINT NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 7),
  lodging_kind TEXT NOT NULL CHECK (lodging_kind IN ('resort', 'partner_hotel', 'offsite')),
  resort_id    UUID REFERENCES resorts(id),
  place_name   VARCHAR(100) CHECK (place_name IS NULL OR char_length(btrim(place_name)) BETWEEN 1 AND 100),
  check_in     DATE,
  check_out    DATE,
  party_keys   JSONB CHECK (party_keys IS NULL OR jsonb_typeof(party_keys) = 'array'),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_trip_stays_dates_pair CHECK ((check_in IS NULL) = (check_out IS NULL)),
  CONSTRAINT chk_trip_stays_dates_order CHECK (check_in IS NULL OR check_out > check_in),
  CONSTRAINT chk_trip_stays_kind CHECK (
    (lodging_kind = 'resort' AND resort_id IS NOT NULL AND place_name IS NULL) OR
    (lodging_kind <> 'resort' AND resort_id IS NULL AND place_name IS NOT NULL)
  )
);

-- No ON DELETE on resort_id (like trip_resorts): a Resort cannot be removed while a stay references it, so a recorded
-- stay survives catalog churn.

CREATE INDEX IF NOT EXISTS idx_trip_stays_trip ON trip_stays (trip_id, check_in, position);
CREATE INDEX IF NOT EXISTS idx_trip_stays_resort ON trip_stays (resort_id);

COMMIT;
