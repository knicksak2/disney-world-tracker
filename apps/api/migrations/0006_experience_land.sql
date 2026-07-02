-- Disney World Tracker — Experience Land migration
-- Adds the themed Land dimension to the persisted catalog. Land is resolved during
-- Catalog_Sync from the nearest Land_Ancestor of a theme-park / water-park
-- Facility_Document (see resolveLand) and is null for DisneySprings/Resort
-- Experiences and for park Experiences with no resolvable Land. This migration is
-- strictly additive: it adds one nullable column, a length CHECK, and a browse
-- index, and touches no existing row, no Internal_Id, and none of the
-- completions / ratings / notes tables.
--
-- See design.md ("Data Models" → "Persistence (migration 0006_experience_land.sql)")
-- for the source of truth for this DDL.
--
-- Requirements covered:
--   R2.2        — additive change; every existing experiences row and Internal_Id preserved
--   R2.3        — nullable, no default: every pre-existing row's land is NULL until first sync
--   R1.7        — Land is at most 200 characters, consistent with the name length constraint
--   R11.2, R11.3 — completions/ratings/notes retained unchanged; failure rolls the whole thing back

BEGIN;

-- R2.2: additive change — every existing experiences row (and its Internal_Id) is
-- preserved. R2.3: a nullable column with no default means every pre-existing row's
-- land is NULL until the first subsequent Catalog_Sync resolves it.
ALTER TABLE experiences ADD COLUMN land TEXT;

-- R1.7: Land is at most 200 characters, consistent with the name length constraint.
ALTER TABLE experiences
    ADD CONSTRAINT experiences_land_length_chk
        CHECK (land IS NULL OR char_length(land) BETWEEN 1 AND 200);

-- Land is a browse dimension for the theme/water-park Destination_Screen and the
-- case-sensitive land filter (R3.4, R6.2); index it alongside the active flag.
CREATE INDEX experiences_active_land_idx ON experiences(active, land);

COMMIT;
