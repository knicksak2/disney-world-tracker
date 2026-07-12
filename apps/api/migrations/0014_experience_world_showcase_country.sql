-- Disney World Tracker — Experience World_Showcase_Country migration
-- Adds the EPCOT World Showcase country pavilion dimension to the persisted
-- catalog. Disney's Facility feed models every World Showcase Experience under a
-- single "World Showcase" Land ancestor and carries no structured country
-- field, so World_Showcase_Country is *derived* during Catalog_Sync (see
-- resolveWorldShowcaseCountry): an explicit country keyword in the Experience
-- name wins, else the nearest of the eleven fixed pavilion centroids by the
-- Experience's coordinates. It is null for every Experience whose resolved Land
-- is not "World Showcase". This migration is strictly additive: it adds one
-- nullable column, a length CHECK, and a browse index, and touches no existing
-- row, no Internal_Id, and none of the completions / ratings / notes tables.
--
-- Mirrors the additive shape of 0006_experience_land.sql and
-- 0007_experience_resort_area.sql.

BEGIN;

-- Additive change — every existing experiences row (and its Internal_Id) is
-- preserved. A nullable column with no default means every pre-existing row's
-- world_showcase_country is NULL until the first subsequent Catalog_Sync
-- resolves it.
ALTER TABLE experiences ADD COLUMN world_showcase_country TEXT;

-- World_Showcase_Country is at most 200 characters, consistent with the name /
-- land / resort_area length constraints.
ALTER TABLE experiences
    ADD CONSTRAINT experiences_world_showcase_country_length_chk
        CHECK (world_showcase_country IS NULL
               OR char_length(world_showcase_country) BETWEEN 1 AND 200);

-- World_Showcase_Country is a browse/target dimension for the EPCOT
-- Destination_Screen and the case-sensitive country filter; index it alongside
-- the active flag, mirroring the land / resort_area browse indexes.
CREATE INDEX experiences_active_world_showcase_country_idx
    ON experiences(active, world_showcase_country);

COMMIT;
