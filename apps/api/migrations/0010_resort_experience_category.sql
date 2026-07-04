-- Disney World Tracker — add the `Resort` Experience_Category.
--
-- The resort-tracking-and-stats feature makes a Disney hotel completable via a
-- resort-representing Experience (Option A). That stand-in row previously used
-- the inert `Other` category placeholder; this migration adds a real `Resort`
-- category to the closed set so the stand-in carries a meaningful category and
-- resort progress surfaces under a `Resort` Category in the statistics.
--
-- Strictly additive: it only widens the `experiences_category_chk` CHECK to
-- accept one more value. No existing row changes (a later Catalog_Sync rewrites
-- the representing rows' category from `Other` to `Resort`). No real, browsable
-- Experience is classified `Resort`; resort-*area* activities keep their own
-- category (Restaurant, Recreation, Spa, …).
--
-- Mirrors the additive constraint change in 0004_disney_sources.sql.

BEGIN;

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
        'Other',
        'Resort'
    ));

COMMIT;
