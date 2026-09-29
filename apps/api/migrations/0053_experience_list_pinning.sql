BEGIN;

ALTER TABLE experience_lists
    ADD COLUMN pinned_at TIMESTAMPTZ NULL;

-- Supports `ORDER BY pinned_at DESC NULLS LAST, updated_at DESC` in `listOwned`.
CREATE INDEX experience_lists_owner_pinned_idx ON experience_lists(owner_id, pinned_at DESC, updated_at DESC);

COMMIT;
