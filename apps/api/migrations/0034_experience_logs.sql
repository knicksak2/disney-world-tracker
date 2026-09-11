-- ===========================================================================
-- 0034_experience_logs.sql
-- ---------------------------------------------------------------------------
-- Experience Activity Logging (Feature: experience-activity-logging).
--
-- Introduces the user-scoped `experience_logs` event stream so a User can
-- record multiple visits / repeat rides for any Experience over time, each
-- with its own calendar date, optional 1-10 rating, and optional note. The
-- existing `completions` and `ratings` tables remain the canonical
-- projections; this table is the append-only activity history behind them.
--
-- `trip_log_entries` gains a `log_id` foreign key so a trip-context log links
-- to exactly one `experience_logs` row. Deleting a Trip cascades away the
-- `trip_log_entries` row (via the pre-existing `trip_id ... ON DELETE CASCADE`
-- from 0015) while leaving the user's permanent `experience_logs` intact;
-- deleting an `experience_logs` row cascades away the referencing
-- `trip_log_entries` row (via the new `log_id ... ON DELETE CASCADE`).
--
-- Backfill is deterministic: every existing `trip_log_entries` row is paired
-- with a freshly generated `experience_logs` row, and every `completions` row
-- not represented by any log gets a synthesized log so no historical
-- completion loses its activity-stream entry.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. experience_logs table
-- ---------------------------------------------------------------------------
CREATE TABLE experience_logs (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    experience_id  UUID         NOT NULL REFERENCES experiences(id),
    visited_on     DATE         NOT NULL,
    user_tz        TEXT         NOT NULL,
    logged_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    rating         SMALLINT,
    note           TEXT,
    CONSTRAINT experience_logs_rating_range_chk
        CHECK (rating IS NULL OR rating BETWEEN 1 AND 10),
    CONSTRAINT experience_logs_note_length_chk
        CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 2000)
);

CREATE INDEX experience_logs_user_experience_idx
    ON experience_logs(user_id, experience_id, visited_on DESC, logged_at DESC);

CREATE INDEX experience_logs_user_date_idx
    ON experience_logs(user_id, visited_on);

-- ---------------------------------------------------------------------------
-- 2. Deterministic backfill from trip_log_entries
-- ---------------------------------------------------------------------------
-- Add the linking column nullable first so we can assign a stable id to each
-- existing trip log entry, materialize the matching experience_logs row, then
-- tighten the column to NOT NULL + FK.
ALTER TABLE trip_log_entries ADD COLUMN log_id UUID;

-- gen_random_uuid() is volatile, so it is evaluated per row: every existing
-- trip_log_entries row receives a distinct log id.
UPDATE trip_log_entries SET log_id = gen_random_uuid();

-- One experience_logs row per existing trip log entry. `visited_on` is the
-- calendar date of the trip log in WDW time (America/New_York), preserving the
-- day the ride was actually logged rather than the server's local day.
INSERT INTO experience_logs (id, user_id, experience_id, visited_on, user_tz, logged_at)
SELECT
    le.log_id,
    le.member_id,
    le.experience_id,
    (le.created_at AT TIME ZONE 'America/New_York')::date,
    'America/New_York',
    le.created_at
FROM trip_log_entries le;

-- Backfill completions not represented by any trip log so zero historical
-- completions lose their activity-stream entry. Expressed as a LEFT JOIN
-- anti-join (rows where no matching log exists) rather than a correlated
-- NOT EXISTS; the two are semantically identical, and the anti-join form is
-- portable across engines. A completion that already produced a log above is
-- excluded regardless of how many trip logs referenced it.
INSERT INTO experience_logs (id, user_id, experience_id, visited_on, user_tz, logged_at)
SELECT
    gen_random_uuid(),
    c.user_id,
    c.experience_id,
    c.completed_on,
    c.user_tz,
    c.completed_on::timestamp AT TIME ZONE c.user_tz
FROM completions c
LEFT JOIN experience_logs el
    ON el.user_id = c.user_id AND el.experience_id = c.experience_id
WHERE el.id IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Tighten trip_log_entries.log_id to NOT NULL + FK
-- ---------------------------------------------------------------------------
ALTER TABLE trip_log_entries ALTER COLUMN log_id SET NOT NULL;
ALTER TABLE trip_log_entries
    ADD CONSTRAINT trip_log_entries_log_id_fkey
    FOREIGN KEY (log_id) REFERENCES experience_logs(id) ON DELETE CASCADE;

CREATE INDEX trip_log_entries_log_id_idx ON trip_log_entries(log_id);

COMMIT;
