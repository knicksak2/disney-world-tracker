-- Disney World Tracker — Resort-representing Experiences migration
-- Makes a Resort completable through the existing completions -> experiences FK
-- (Option A) by adding a thin, sync-managed discriminator to the catalog: one
-- resort-representing Experience stands in for each active Resort so the hotel
-- flows through the existing completion / rating / stats machinery with no new
-- persistence surface for completions. Catalog_Sync remains the sole writer of
-- these rows. This migration is strictly additive: it adds one nullable column
-- and two indexes, and touches no existing column, no Internal_Id, and none of
-- the completions / ratings / notes tables.
--
-- Mirrors the additive shape of 0006_experience_land.sql,
-- 0007_experience_resort_area.sql, and 0008_experience_facet_enrichment.sql. See
-- design.md ("Data Models" → "Migration 0009_resort_representing_experiences.sql")
-- for the source of truth for this DDL.
--
-- Requirements covered:
--   R3.1 — a resort-representing Experience gives a Resort an experiences(id) that
--          completions can reference, so a Resort_Visit is persistable
--   R3.2 — the partial UNIQUE index guarantees at most one representing row per Resort
--   R3.5 — the row reconciles through the existing soft-delete / reactivation rules,
--          preserving Resort_Visit Completions across catalog changes

BEGIN;

-- R3.1: additive change — every existing experiences row (and its Internal_Id) is
-- preserved. A resort-representing Experience stands in for a Resort so the hotel
-- is completable through the existing completions -> experiences FK. This column is
-- NULL for every ordinary Experience (including resort-area activities, which use
-- resort_id), so every pre-existing row's represents_resort_id is NULL until a
-- subsequent Catalog_Sync writes the representing rows.
ALTER TABLE experiences ADD COLUMN represents_resort_id UUID REFERENCES resorts(id);

-- R3.2: at most one representing Experience per Resort. Partial so ordinary
-- Experiences (all NULL) are exempt from the uniqueness guard.
CREATE UNIQUE INDEX experiences_represents_resort_id_uniq
    ON experiences(represents_resort_id)
    WHERE represents_resort_id IS NOT NULL;

-- Stats reads select active representing rows for the Resort_Statistic; index the
-- discriminator alongside the active flag.
CREATE INDEX experiences_active_represents_resort_idx
    ON experiences(active, represents_resort_id);

COMMIT;
