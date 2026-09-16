-- ===========================================================================
-- 0040_food_item_logging.sql
-- ---------------------------------------------------------------------------
-- Food Item Logging (Feature: food-item-logging).
--
-- 1. user_submitted_locations: manually-created food-selling spots with no
--    corresponding Restaurant_Experience in the catalog (Requirement 6).
--    pg_trgm is already installed by 0001_init.sql; no new extension needed.
-- 2. food_items: per-restaurant or user-submitted-location dish catalog.
--    Scoped to exactly one of experience_id / location_id (Requirement 6.6).
-- 3. food_item_logs: per-user dish visit log mirroring experience_logs shape.
--
-- Strictly additive: creates new tables, constraints, and indexes.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. user_submitted_locations
-- ---------------------------------------------------------------------------
CREATE TABLE user_submitted_locations (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT         NOT NULL,
    park                TEXT         NOT NULL,
    created_by_user_id  UUID         REFERENCES users(id),
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT user_submitted_locations_name_length_chk CHECK (char_length(name) BETWEEN 1 AND 200),
    CONSTRAINT user_submitted_locations_park_chk CHECK (park IN (
        'Magic Kingdom', 'EPCOT', 'Hollywood Studios', 'Animal Kingdom',
        'Typhoon Lagoon', 'Blizzard Beach', 'Disney Springs'
    ))
);

CREATE UNIQUE INDEX user_submitted_locations_unique_name_per_park
    ON user_submitted_locations (park, lower(name));

-- Trigram index backing the similarity-based suggest query (Requirement 6.2).
CREATE INDEX user_submitted_locations_name_trgm_idx
    ON user_submitted_locations USING gin (lower(name) gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 2. food_items — per-restaurant or user-submitted-location dish catalog
-- ---------------------------------------------------------------------------
CREATE TABLE food_items (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    experience_id       UUID         REFERENCES experiences(id) ON DELETE CASCADE,
    location_id         UUID         REFERENCES user_submitted_locations(id) ON DELETE CASCADE,
    name                TEXT         NOT NULL,
    price               TEXT,
    source              TEXT         NOT NULL DEFAULT 'menu_sync',
    created_by_user_id  UUID         REFERENCES users(id),
    last_seen_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT food_items_name_length_chk CHECK (char_length(name) BETWEEN 1 AND 200),
    CONSTRAINT food_items_source_chk CHECK (source IN ('menu_sync', 'user_submitted')),
    CONSTRAINT food_items_exactly_one_scope_chk CHECK (
        (experience_id IS NOT NULL AND location_id IS NULL) OR
        (experience_id IS NULL AND location_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX food_items_unique_name_per_experience
    ON food_items (experience_id, lower(name));

CREATE UNIQUE INDEX food_items_unique_name_per_location
    ON food_items (location_id, lower(name));

CREATE INDEX food_items_experience_idx ON food_items(experience_id);
CREATE INDEX food_items_location_idx ON food_items(location_id);

-- ---------------------------------------------------------------------------
-- 3. food_item_logs — per-user dish visit log
-- ---------------------------------------------------------------------------
CREATE TABLE food_item_logs (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    food_item_id   UUID         NOT NULL REFERENCES food_items(id) ON DELETE CASCADE,
    visited_on     DATE         NOT NULL,
    user_tz        TEXT         NOT NULL,
    logged_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    rating         SMALLINT,
    note           TEXT,
    CONSTRAINT food_item_logs_rating_range_chk CHECK (rating IS NULL OR rating BETWEEN 1 AND 10),
    CONSTRAINT food_item_logs_note_length_chk CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 2000)
);

CREATE INDEX food_item_logs_user_item_idx
    ON food_item_logs(user_id, food_item_id, visited_on DESC, logged_at DESC);

COMMIT;
