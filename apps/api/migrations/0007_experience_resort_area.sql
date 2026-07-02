-- Disney World Tracker — Experience Resort_Area migration
-- Adds the Resort_Area geographic zone to the persisted catalog. Resort_Area is
-- resolved during Catalog_Sync from the Resort_Area_Ancestor of a Facility_Document
-- (see resolveResortArea) and is populated only for Resort-area Experiences — it is
-- null for ThemePark/WaterPark/DisneySprings Experiences, where the owning
-- Park/Destination already conveys the zone. This migration is strictly additive: it
-- adds one nullable column, a length CHECK, and a browse index, and touches no
-- existing row, no Internal_Id, and none of the completions / ratings / notes tables.
--
-- Mirrors the additive shape of 0006_experience_land.sql.

BEGIN;

-- Additive change — every existing experiences row (and its Internal_Id) is
-- preserved. A nullable column with no default means every pre-existing row's
-- resort_area is NULL until the first subsequent Catalog_Sync resolves it.
ALTER TABLE experiences ADD COLUMN resort_area TEXT;

-- Resort_Area is at most 200 characters, consistent with the name / land length
-- constraints.
ALTER TABLE experiences
    ADD CONSTRAINT experiences_resort_area_length_chk
        CHECK (resort_area IS NULL OR char_length(resort_area) BETWEEN 1 AND 200);

-- Resort_Area is a browse/grouping dimension for the Resorts Destination_Screen;
-- index it alongside the active flag.
CREATE INDEX experiences_active_resort_area_idx ON experiences(active, resort_area);

COMMIT;
