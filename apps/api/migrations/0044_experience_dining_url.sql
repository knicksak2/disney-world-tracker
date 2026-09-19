-- ===========================================================================
-- 0044_experience_dining_url.sql
-- ---------------------------------------------------------------------------
-- Disney World Tracker — Experience dining reservation URL
-- Feature: restaurant-menu-display, Requirement 6.1
--
-- Persists the curated Disney reservation-page URL for a restaurant.
-- Nullable TEXT, constrained to 1-500 characters when non-null.
-- Populated exclusively via seedDiningLinks; never written by Catalog_Sync.
-- ===========================================================================

BEGIN;

ALTER TABLE experiences
    ADD COLUMN dining_url TEXT;

ALTER TABLE experiences
    ADD CONSTRAINT experiences_dining_url_length_chk
    CHECK (dining_url IS NULL OR char_length(dining_url) BETWEEN 1 AND 500);

COMMIT;
