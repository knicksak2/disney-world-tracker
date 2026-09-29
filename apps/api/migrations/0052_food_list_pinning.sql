BEGIN;

ALTER TABLE food_lists
    ADD COLUMN pinned_at TIMESTAMPTZ NULL;

-- Supports `ORDER BY pinned_at DESC NULLS LAST, updated_at DESC` in `listOwned`.
CREATE INDEX food_lists_owner_pinned_idx ON food_lists(owner_id, pinned_at DESC, updated_at DESC);

COMMIT;
