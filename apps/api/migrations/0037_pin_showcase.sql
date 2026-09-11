-- ===========================================================================
-- 0037_pin_showcase.sql
-- ---------------------------------------------------------------------------
-- Pin Collection — Pin Showcase (Feature: pin-collection, Requirement 24).
--
-- Adds `pin_showcase_placements` for user-customizable freeform pin showcase
-- boards. Placements store normalized coordinates (0.0-1.0) relative to board
-- dimensions, stacking order (z_index), and enforce per-(user_id, pin_id)
-- uniqueness so placements are upsertable.
--
-- Strictly additive: creates a new table and index.
-- Wrapped in BEGIN/COMMIT and idempotent to re-apply via IF NOT EXISTS.
-- ===========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS pin_showcase_placements (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pin_id      TEXT         NOT NULL,
    pos_x       REAL         NOT NULL,
    pos_y       REAL         NOT NULL,
    z_index     INTEGER      NOT NULL DEFAULT 0,
    placed_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT pin_showcase_unique UNIQUE (user_id, pin_id),
    CONSTRAINT pin_showcase_pin_id_length_chk CHECK (char_length(pin_id) BETWEEN 1 AND 100),
    CONSTRAINT pin_showcase_pos_x_chk CHECK (pos_x >= 0.0 AND pos_x <= 1.0),
    CONSTRAINT pin_showcase_pos_y_chk CHECK (pos_y >= 0.0 AND pos_y <= 1.0)
);

-- Read: "all of this User's placements" (the whole showcase, always read as one page).
CREATE INDEX IF NOT EXISTS pin_showcase_user_id_idx ON pin_showcase_placements(user_id);

COMMIT;
