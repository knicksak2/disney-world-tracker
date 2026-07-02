-- Disney World Tracker — Disney sources migration
-- Replaces ThemeParks.wiki with Disney's own internal sources as the sole origin
-- of catalog and live data. This migration reshapes the persisted catalog to carry
-- the new Disney-provided concepts: first-class Resorts, Experience enrichment
-- (coordinates, accessibility, price tier, meal periods), an expanded taxonomy and
-- area classification, full dining menus, a one-time identity bridge, and a sync-run
-- outcome discriminator.
--
-- See design.md ("Data Models" → "Persistence") for the source of truth.
--
-- Requirements covered:
--   R6.6, R6.7  — Resort first-class persistence, retrievable across restarts/syncs
--   R5.1        — Experience latitude/longitude enrichment
--   R5.3        — Experience accessibility tags
--   R5.4        — Experience price tier (restaurant priceRangeDining)
--   R5.5        — Experience meal periods (restaurant mealPeriods)
--   R8.2        — Per-restaurant dining menus persisted as a unit
--   R10.2       — One-time enterprise_id -> internal_id bridge map
--   R12.5       — Sync-run outcome discriminator
--   R14.8       — Disney imagery needs no third-party attribution (drop image_attribution)

BEGIN;

-- ---------------------------------------------------------------------------
-- resorts
-- ---------------------------------------------------------------------------
-- R6: Resort is a first-class catalog concept (Facility_Type `resort`, distinct
-- from `resort-area`). Created BEFORE the experiences.resort_id foreign key below
-- so that FK target exists. id is a UUIDv5 of the Enterprise_Id over the existing
-- fixed namespace (R6.6), matching how Experiences derive their Internal_Id, so the
-- one-to-one mapping is durable via UNIQUE(upstream_entity_id).
-- `active` provides the soft-delete / reactivation semantics (R6.9, R6.10); the row
-- and its id are preserved across syncs so it stays retrievable (R6.7).
CREATE TABLE resorts (
    id                  UUID         PRIMARY KEY,
    upstream_entity_id  TEXT         NOT NULL UNIQUE,
    name                TEXT         NOT NULL,
    description         TEXT,
    image_url           TEXT,
    latitude            DOUBLE PRECISION,
    longitude           DOUBLE PRECISION,
    address             TEXT,
    phone               TEXT,
    active              BOOLEAN      NOT NULL DEFAULT TRUE,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT resorts_name_length_chk
        CHECK (char_length(name) BETWEEN 1 AND 200),
    CONSTRAINT resorts_image_url_length_chk
        CHECK (image_url IS NULL OR char_length(image_url) BETWEEN 1 AND 2048)
);

-- ---------------------------------------------------------------------------
-- experiences — enrichment + area, expanded taxonomy, nullable park
-- ---------------------------------------------------------------------------
-- Coordinates are nullable (set to null when either lat/long is missing, R5.1/R5.2).
-- accessibility is a text array defaulting to empty (R5.3). price_tier is nullable
-- (restaurant priceRangeDining, R5.4). meal_periods is JSONB (MealPeriodDTO[], R5.5)
-- stored as a unit because no relational query over individual periods is needed.
-- area_type records the resolved Area classification; resort_id references the owning
-- Resort's Internal_Id when the area is a specific resort.
ALTER TABLE experiences
    ADD COLUMN latitude       DOUBLE PRECISION,
    ADD COLUMN longitude      DOUBLE PRECISION,
    ADD COLUMN area_type      TEXT   NOT NULL DEFAULT 'ThemePark',
    ADD COLUMN resort_id      UUID   REFERENCES resorts(id),
    ADD COLUMN accessibility  TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN price_tier     TEXT,
    ADD COLUMN meal_periods   JSONB  NOT NULL DEFAULT '[]';

-- park is no longer NOT NULL: Resort-area Experiences have no owning Park (R5.7).
-- Also relax the park CHECK to explicitly admit NULL. The original constraint from
-- 0001 was `park IN (...)`; a NULL park passes that CHECK in Postgres (NULL, not
-- FALSE), but being explicit states the nullable intent and keeps the constraint
-- unambiguous alongside the codebase's `IS NULL OR ...` convention.
ALTER TABLE experiences ALTER COLUMN park DROP NOT NULL;
ALTER TABLE experiences DROP CONSTRAINT experiences_park_chk;
ALTER TABLE experiences
    ADD CONSTRAINT experiences_park_chk CHECK (park IS NULL OR park IN (
        'Magic Kingdom',
        'EPCOT',
        'Hollywood Studios',
        'Animal Kingdom',
        'Typhoon Lagoon',
        'Blizzard Beach',
        'Disney Springs'
    ));

-- Disney-sourced imagery needs no third-party attribution (R14.8). image_url is
-- retained and, post-migration, written solely by Catalog_Sync via reconciliation.
ALTER TABLE experiences DROP COLUMN image_attribution;

-- Drop the constraint that image_attribution added in 0002 (now that the column is
-- gone) — Postgres drops column-referencing CHECKs with the column, but the length
-- constraint was declared separately, so remove it explicitly if it survives.
ALTER TABLE experiences
    DROP CONSTRAINT IF EXISTS experiences_image_attribution_length_chk;

-- Expand the category CHECK to the full closed set (R4: adds Tour, Recreation,
-- Spa, Event alongside the original Ride/Show/Restaurant/Parade/Character_Meet/Other).
ALTER TABLE experiences DROP CONSTRAINT experiences_category_chk;
ALTER TABLE experiences
    ADD CONSTRAINT experiences_category_chk CHECK (category IN (
        'Ride',
        'Show',
        'Restaurant',
        'Parade',
        'Character_Meet',
        'Tour',
        'Recreation',
        'Spa',
        'Event',
        'Other'
    ));

-- Closed set for the resolved Area classification (R4.11–R4.15, R5.7).
ALTER TABLE experiences
    ADD CONSTRAINT experiences_area_type_chk CHECK (area_type IN (
        'ThemePark',
        'WaterPark',
        'DisneySprings',
        'Resort'
    ));

-- Guard price_tier length; short facet strings ('$', '$$', ...) in practice.
ALTER TABLE experiences
    ADD CONSTRAINT experiences_price_tier_length_chk
        CHECK (price_tier IS NULL OR char_length(price_tier) BETWEEN 1 AND 100);

-- Filtering by area_type is a browse dimension (R5.7 grouping); support it alongside
-- the existing active/park/category composite.
CREATE INDEX experiences_active_area_type_idx
    ON experiences(active, area_type);

-- ---------------------------------------------------------------------------
-- experience_menus
-- ---------------------------------------------------------------------------
-- R8.2: per restaurant, persist the full menu structure (menu type, cuisine type,
-- each group's name, item names, and item price strings). Stored as JSONB because
-- the requirement round-trips the full structure as a unit and no relational query
-- over individual menu items is needed. One row per restaurant Experience.
CREATE TABLE experience_menus (
    experience_id  UUID         PRIMARY KEY REFERENCES experiences(id),
    menus          JSONB        NOT NULL,
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- catalog_id_bridge
-- ---------------------------------------------------------------------------
-- R10.2: one-time mapping from each Disney Enterprise_Id to the Internal_Id
-- previously derived from the ThemeParks.wiki entity whose `externalId` equals that
-- Enterprise_Id. Guarantees id continuity so Completions, Ratings, and Notes keep
-- referencing the same Internal_Id across the source switch.
CREATE TABLE catalog_id_bridge (
    enterprise_id  TEXT  PRIMARY KEY,
    internal_id    UUID  NOT NULL
);

-- ---------------------------------------------------------------------------
-- catalog_sync_runs — outcome discriminator
-- ---------------------------------------------------------------------------
-- R12.5: record the outcome of every run as one of success | http_status | network
-- | invalid_response | aborted. Nullable + no CHECK so historical rows (which predate
-- this column) remain valid; the application writes one of the allowed values on
-- every new run.
ALTER TABLE catalog_sync_runs
    ADD COLUMN outcome TEXT;

COMMIT;
