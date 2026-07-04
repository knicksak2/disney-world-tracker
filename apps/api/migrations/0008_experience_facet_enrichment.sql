-- Disney World Tracker — Experience Facet Enrichment migration
-- Adds the mined Facility_Document enrichment fields to the persisted catalog.
-- These values are resolved during Catalog_Sync from fields the sync already
-- fetches inside each Facility_Document but currently discards: the Grouped_Facets
-- built from the raw `facets` array, the derived Height_Requirement, the structured
-- Why_This copy, and the finer Facility_SubType. Catalog_Sync remains the sole
-- writer, and each field is null/empty when the source document does not carry it.
-- This migration is strictly additive: it adds three nullable columns, one
-- defaulted JSONB column, and one length CHECK, and touches no existing column, no
-- Internal_Id, and none of the completions / ratings / notes tables.
--
-- Mirrors the additive shape of 0006_experience_land.sql and
-- 0007_experience_resort_area.sql. See design.md ("Data Models" → "Persistence
-- (migration + catalog/repo.ts)") for the source of truth for this DDL.
--
-- Requirements covered:
--   R7.1 — Grouped_Facets persisted as one JSONB structure keyed by Facet_Group name
--   R7.2 — Height_Requirement persisted (id, name, minInches, minCentimeters) as JSONB
--   R7.3 — Why_This persisted (title, bullets, quotes) as JSONB
--   R7.4 — Facility_SubType persisted when present
--   R7.5 — absent fields stored as null / empty; no partial or fabricated value
--   R7.6 — strictly additive; every existing column, Internal_Id, and the
--          completions / ratings / notes tables preserved; failure rolls the whole thing back

BEGIN;

-- R7.1–R7.4: additive columns — every existing experiences row (and its Internal_Id)
-- is preserved. R7.5: `grouped_facets` defaults to an empty JSONB object and the
-- other three columns are nullable with no default, so every pre-existing row holds
-- an empty/null value until the first subsequent Catalog_Sync populates it.
ALTER TABLE experiences
    ADD COLUMN grouped_facets     JSONB  NOT NULL DEFAULT '{}',   -- R7.1
    ADD COLUMN height_requirement JSONB,                          -- R7.2 (null when absent)
    ADD COLUMN why_this           JSONB,                          -- R7.3 (null when absent)
    ADD COLUMN sub_type           TEXT;                           -- R7.4 (null when absent)

-- Facility_SubType is at most 200 characters, consistent with the name / land /
-- resort_area length constraints.
ALTER TABLE experiences
    ADD CONSTRAINT experiences_sub_type_length_chk
        CHECK (sub_type IS NULL OR char_length(sub_type) BETWEEN 1 AND 200);

COMMIT;
