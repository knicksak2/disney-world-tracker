-- ===========================================================================
-- 0039_experience_festival_tags.sql
-- ---------------------------------------------------------------------------
-- Festival Booth Tagging (Feature: festival-booth-tagging, Requirement 2).
--
-- Adds `experience_festival_tags` to associate an EPCOT festival booth
-- experience with a specific festival slug and festival year.
--
-- Deliberately NOT a column on `experiences`: Catalog_Sync's applyReconciliation
-- fully overwrites every column it writes on each sync run, so any festival
-- association stored on the experiences row itself would be silently erased the
-- next time that booth's document is (re)synced. This table is never referenced
-- by any Catalog_Sync code path — it is written only by the `tag-festival-booth`
-- CLI and read only by the Pin_Service and Stats_Service.
--
-- Strictly additive: creates a new table and indexes.
-- Wrapped in BEGIN/COMMIT and idempotent to re-apply via IF NOT EXISTS.
-- ===========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS experience_festival_tags (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    experience_id  UUID         NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    festival_slug  TEXT         NOT NULL,
    festival_year  INTEGER      NOT NULL,
    tagged_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT experience_festival_tags_unique UNIQUE (experience_id, festival_year),
    CONSTRAINT experience_festival_tags_year_chk
        CHECK (festival_year BETWEEN 2015 AND 2100)
);

-- Read: "every tag for this experience" (pin/stats joins) and "every tag for this
-- year" (CLI conflict detection).
CREATE INDEX IF NOT EXISTS experience_festival_tags_experience_idx
    ON experience_festival_tags (experience_id);
CREATE INDEX IF NOT EXISTS experience_festival_tags_year_idx
    ON experience_festival_tags (festival_year);

COMMIT;
