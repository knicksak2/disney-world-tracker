-- Disney World Tracker — Disney source resilience migration
-- Re-architects Disney data sourcing along the data-by-change-rate principle:
-- adds a durable local Document_Store for fetched Facility_Documents, a singleton
-- Changes_Checkpoint that persists the last processed `_changes` sequence, and a
-- menu-freshness column so menus can be retrieved lazily and throttled.
--
-- See design.md ("Data Models" → "New persistence (migration 0005...)") for the
-- source of truth for this DDL.
--
-- Requirements covered:
--   R7.1        — Documents survive restarts (durable local persistence)
--   R7.2        — Re-upserting an Enterprise_Id replaces the prior version (PK)
--   R7.3        — Tombstones (soft delete) track removed documents
--   R6.3, R7.5  — Persist the `_changes` checkpoint (last processed sequence)
--   R8.2        — Menus persisted per restaurant (existing experience_menus)
--   R8.4        — Menu freshness drives lazy retrieval (fetched_at)
--   R12.6       — catalog_sync_runs.outcome stays TEXT/nullable for legacy rows

BEGIN;

-- ---------------------------------------------------------------------------
-- disney_documents — Document_Store
-- ---------------------------------------------------------------------------
-- R7: durable local copy of every fetched Facility_Document, keyed by the Disney
-- Enterprise_Id (the document id) so a re-upsert of the same id replaces the prior
-- version (R7.2) and the local copy survives restarts (R7.1). `deleted` is a
-- tombstone marking a document removed upstream (R7.3); the active set excludes
-- tombstoned rows. `change_seq` records the `_changes` sequence of the persisted
-- version so a delta apply and the checkpoint move in lockstep.
CREATE TABLE disney_documents (
    enterprise_id  TEXT         PRIMARY KEY,            -- Disney Enterprise_Id / doc id
    body           JSONB        NOT NULL,               -- parsed Facility_Document
    deleted        BOOLEAN      NOT NULL DEFAULT FALSE, -- tombstone (R7.3)
    change_seq     TEXT         NOT NULL,               -- _changes seq of this version
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Reconciliation reads the active (non-deleted) document set on every sync; index
-- the tombstone flag so that filter is cheap.
CREATE INDEX disney_documents_active_idx ON disney_documents(deleted);

-- ---------------------------------------------------------------------------
-- disney_sync_checkpoint — Changes_Checkpoint
-- ---------------------------------------------------------------------------
-- R6.3, R7.5: a single persisted `_changes` sequence marking how far the last
-- successful sync progressed. Enforced as a singleton via `id = 1` CHECK so there
-- is exactly one checkpoint row; `applyDelta` writes the new `last_seq` in the same
-- transaction as the document upserts/tombstones so they never diverge.
CREATE TABLE disney_sync_checkpoint (
    id           INTEGER      PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    last_seq     TEXT         NOT NULL,
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- experience_menus — menu freshness for lazy retrieval
-- ---------------------------------------------------------------------------
-- R8.2, R8.4: record when each restaurant's menu was last fetched so menus can be
-- served from cache while fresh and re-fetched (through the Disney_Transport,
-- within the request budget) only when missing or stale. Defaults to now() so rows
-- created before this migration are treated as freshly fetched.
ALTER TABLE experience_menus
    ADD COLUMN fetched_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ---------------------------------------------------------------------------
-- catalog_sync_runs.outcome — unchanged (R12.6)
-- ---------------------------------------------------------------------------
-- The `outcome` column added in 0004 stays TEXT and nullable with no CHECK so
-- historical rows (which predate the resilience closed set) remain valid. The
-- application-level closed set now adds `waf_block`/`auth_failure` and retires
-- `http_status`; a tolerant read maps legacy `http_status` rows to `auth_failure`
-- for display continuity. No schema change is required here.

COMMIT;
