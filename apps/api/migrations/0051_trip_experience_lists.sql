-- Disney World Tracker — Trip Experience Lists migration
-- Records which Experience_List(s) (from the experience-lists spec) a Trip's
-- members are referencing during the visit (Requirement 14).
--
-- Strictly additive: it adds one new table and its index; no existing table,
-- column, or constraint is touched.
--
-- Structurally identical to trip_food_lists (0042_trip_food_lists.sql).
--
-- Requirements covered:
--   R14.1 — a Trip_Member may attach an owned or public Experience_List to a Trip
--   R14.6 — deleting a Trip cascades its trip_experience_lists links
--   R14.7 — deleting an Experience_List cascades its trip_experience_lists links away
--           via ON DELETE CASCADE

BEGIN;

-- ---------------------------------------------------------------------------
-- trip_experience_lists
-- ---------------------------------------------------------------------------
-- trip_experience_lists: the Experience_List(s) a Trip's members are referencing (R14.1),
-- structurally identical to trip_food_lists (0042_trip_food_lists.sql).
CREATE TABLE trip_experience_lists (
    trip_id             UUID         NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    experience_list_id  UUID         NOT NULL REFERENCES experience_lists(id) ON DELETE CASCADE,
    added_by            UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (trip_id, experience_list_id)
);

CREATE INDEX trip_experience_lists_list_idx ON trip_experience_lists(experience_list_id);

COMMIT;
