-- Disney World Tracker — Trip Food Lists migration
-- Records which Food_List(s) (from the food-lists spec) a Trip's members are
-- using for reference during the visit (Requirement 22).
--
-- Strictly additive: it adds one new table and its index; no existing table,
-- column, or constraint is touched.
--
-- Requirements covered:
--   R22.1 — a Trip_Member may attach an owned or public Food_List to a Trip
--   R22.2 — at most one link per (trip, food_list) via the composite primary key
--   R22.5 — detach authorization tracks added_by (or organizer)
--   R22.6 — deleting a Trip cascades its trip_food_lists links; deleting a Food_List
--           also cascades its links away via ON DELETE CASCADE

BEGIN;

-- ---------------------------------------------------------------------------
-- trip_food_lists
-- ---------------------------------------------------------------------------
-- trip_food_lists: the Food_List(s) a Trip's members are referencing (R22.1).
-- The composite primary key guarantees at most one link per (trip, food_list)
-- (R22.2). The trip FK cascades so a Trip delete fans out to its food-list
-- links (R22.6); the food_list FK cascades so deleting the list cleans up the
-- link; added_by records who attached it for detach authorization (R22.5).
CREATE TABLE trip_food_lists (
    trip_id      UUID        NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    food_list_id UUID        NOT NULL REFERENCES food_lists(id) ON DELETE CASCADE,
    added_by     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (trip_id, food_list_id)
);

CREATE INDEX trip_food_lists_food_list_idx ON trip_food_lists(food_list_id);

COMMIT;
