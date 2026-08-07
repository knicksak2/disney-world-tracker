-- Disney World Tracker — Experience Early Entry participation
-- Persists whether an Experience operates during a park's Early Entry window
-- (disney-facilities-catalog-source R5.8). Sourced from the Disney Sync Gateway
-- Schedule channel during Catalog_Sync and applied forward (Early Entry
-- participation is stable). Nullable: NULL = never captured/unknown, which the
-- Day Planning optimizer treats conservatively as "not early entry" (R3.12).

BEGIN;

ALTER TABLE experiences ADD COLUMN operates_during_early_entry BOOLEAN;

COMMIT;
