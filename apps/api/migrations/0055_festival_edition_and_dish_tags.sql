-- ===========================================================================
-- 0055_festival_edition_and_dish_tags.sql
-- ---------------------------------------------------------------------------
-- Qualifying-Visit Correctness for Menu-Matched Restaurants
-- (Feature: festival-booth-tagging, Requirements 9, 10).
--
-- The menu-keyword discovery signal (Requirement 3.8) tags PERMANENT,
-- year-round restaurants (e.g. Tangierine Cafe, Marketplace - Hawai'i) as
-- Festival_Booths. Unlike a temporary `Festival Kiosk`-faceted booth, a
-- permanent restaurant never deactivates and sells far more than festival
-- items, so counting any `completions` row there forever as "this festival"
-- is wrong on two axes: no expiry, and wrong granularity. This migration adds
-- the three pieces the Qualifying_Visit computation (Requirement 11) needs to
-- fix both:
--
--   1. `experience_festival_tags.match_kind` ('facet' | 'menu') — records
--      which Requirement 3 discovery signal produced a tag, backfilled for
--      every pre-existing row by re-running the same facet predicate R3.3
--      already uses.
--   2. `festival_editions` — an optional operator-set date window per
--      (festival_slug, festival_year), so a signal dated outside a festival's
--      actual run never counts once an operator sets the window.
--   3. `food_item_festival_tags` — per-dish tags, written only for a
--      `match_kind = 'menu'` experience's matching dishes, so a plain
--      restaurant visit (no festival dish logged) never counts for that case.
--
-- Strictly additive: one new column + CHECK on an existing table, two new
-- tables. No existing column, row, or Internal_Id is touched.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. experience_festival_tags.match_kind (R9.1, R9.2)
-- ---------------------------------------------------------------------------

ALTER TABLE experience_festival_tags
    ADD COLUMN match_kind TEXT;

ALTER TABLE experience_festival_tags
    ADD CONSTRAINT experience_festival_tags_match_kind_chk
        CHECK (match_kind IS NULL OR match_kind IN ('facet', 'menu'));

-- R9.2: one-time backfill classifying every pre-existing row by re-running
-- the SAME `Festival Kiosk` facet predicate Requirement 3.3 already uses,
-- against the experience's CURRENTLY-persisted grouped_facets. This is a
-- plain UPDATE, not a Catalog_Sync write — that pipeline never touches this
-- table (Requirement 2.2) — a one-time data-quality fix for rows that predate
-- the match_kind column existing at all. Written as `UPDATE ... WHERE
-- experience_id IN (subquery)` rather than `UPDATE ... FROM` and using the
-- JSONB containment operator (`@>`) rather than `jsonb_array_elements` —
-- this app's pg-mem test harness supports neither `UPDATE ... FROM` nor that
-- function, and both substitutions are semantically identical to the more
-- idiomatic forms.
UPDATE experience_festival_tags
   SET match_kind = 'facet'
 WHERE match_kind IS NULL
   AND experience_id IN (
     SELECT id FROM experiences
      WHERE COALESCE(grouped_facets -> 'quickService', '[]'::jsonb)
            @> '[{"name": "Festival Kiosk"}]'::jsonb
   );

UPDATE experience_festival_tags
   SET match_kind = 'menu'
 WHERE match_kind IS NULL;

ALTER TABLE experience_festival_tags
    ALTER COLUMN match_kind SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. festival_editions (R9.3-9.5)
-- ---------------------------------------------------------------------------
-- Absent row for a (slug, year) pair = no date restriction (R9.4). A present
-- row with a null ends_on = "still running" (R9.5). Keyed on the pair itself
-- since the window belongs to the festival edition, not to any one tagged
-- experience.
CREATE TABLE IF NOT EXISTS festival_editions (
    festival_slug  TEXT         NOT NULL,
    festival_year  INTEGER      NOT NULL,
    starts_on      DATE         NOT NULL,
    ends_on        DATE,
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (festival_slug, festival_year),
    CONSTRAINT festival_editions_year_chk
        CHECK (festival_year BETWEEN 2015 AND 2100),
    CONSTRAINT festival_editions_dates_chk
        CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

-- ---------------------------------------------------------------------------
-- 3. food_item_festival_tags (R10.1-10.2)
-- ---------------------------------------------------------------------------
-- Per-dish festival tag, written only for a match_kind = 'menu' experience's
-- matching dishes (never for 'facet' — every dish at a temporary Festival
-- Kiosk booth is already, unambiguously, a festival dish). References
-- food_items (food-item-logging's existing table); CASCADE mirrors
-- experience_festival_tags' own CASCADE on its experience FK.
CREATE TABLE IF NOT EXISTS food_item_festival_tags (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    food_item_id   UUID         NOT NULL REFERENCES food_items(id) ON DELETE CASCADE,
    festival_slug  TEXT         NOT NULL,
    festival_year  INTEGER      NOT NULL,
    tagged_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT food_item_festival_tags_unique UNIQUE (food_item_id, festival_year),
    CONSTRAINT food_item_festival_tags_year_chk
        CHECK (festival_year BETWEEN 2015 AND 2100)
);

CREATE INDEX IF NOT EXISTS food_item_festival_tags_food_item_idx
    ON food_item_festival_tags (food_item_id);

COMMIT;
