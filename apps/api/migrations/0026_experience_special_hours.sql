-- Disney World Tracker — Experience Extended-Evening & Ticketed-Event participation
-- Complements 0025 (early entry) with the other two special-hours windows, all
-- captured from the same Disney Schedule channel document during Catalog_Sync
-- (disney-facilities-catalog-source R5.8). Both nullable: NULL = never captured,
-- which the Day Planning optimizer treats conservatively as "not available"
-- during that window (day-planning-optimization R3.13).

BEGIN;

ALTER TABLE experiences ADD COLUMN operates_during_extended_evening BOOLEAN;
ALTER TABLE experiences ADD COLUMN operates_during_ticketed_event   BOOLEAN;

COMMIT;
