-- Disney World Tracker — Trip Resorts migration
-- Records which Resort(s) a Trip's party stayed at. A Walt Disney World visit
-- can span more than one hotel (a "split stay" is common), so the association
-- is many-to-many: a join table linking a Trip to one or more catalog Resorts.
--
-- Strictly additive: it adds one new table and one index; no existing table,
-- column, or constraint is touched. Resorts are the same canonical catalog rows
-- created by 0004_disney_sources.sql — this migration never copies them, it
-- only references them by their stable Internal_Id.
--
-- Mirrors the BEGIN/COMMIT + inline-comment conventions of the earlier
-- migrations (0004_disney_sources.sql, 0015_trips.sql).
--
-- Requirements covered:
--   R21.1 — a Trip may record the Resort(s) its party stayed at
--   R21.2 — at most one link per (trip, resort) via the composite primary key
--   R21.3 — deleting a Trip cascades its resort links; deleting/soft-deleting a
--           Resort never cascades to Trips (no ON DELETE on the resort FK), so
--           a Trip's recorded stay survives catalog churn

BEGIN;

-- ---------------------------------------------------------------------------
-- trip_resorts
-- ---------------------------------------------------------------------------
-- trip_resorts: the Resort(s) a Trip's party stayed at (R21.1). The composite
-- primary key guarantees at most one link per (trip, resort) (R21.2). The trip
-- FK cascades so a Trip delete fans out to its resort links (R21.3), matching
-- every other Trip child table; the resort FK deliberately has no ON DELETE so
-- a Resort can never be removed while a Trip references it, preserving the
-- recorded stay (R21.3).
CREATE TABLE trip_resorts (
    trip_id    UUID        NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    resort_id  UUID        NOT NULL REFERENCES resorts(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (trip_id, resort_id)
);

-- Reverse lookup ("which Trips stayed at this Resort") and the FK's referential
-- integrity check both scan by resort_id.
CREATE INDEX trip_resorts_resort_idx ON trip_resorts(resort_id);

COMMIT;
