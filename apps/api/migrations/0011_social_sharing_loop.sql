-- Disney World Tracker — Social Sharing Loop (Phase 2) migration
-- Adds the persistence surface for push delivery, the per-user share
-- notification preference, and recipient reactions to shares. Strictly
-- additive: three new tables and their indexes; no existing table, column,
-- or constraint is touched.
--
-- See design.md ("New migration 0011_social_sharing_loop.sql (Phase 2)") for
-- the source of truth for this DDL. Mirrors the BEGIN/COMMIT + inline-comment
-- conventions of the earlier migrations (0001_init.sql, 0009).
--
-- Requirements covered:
--   R8.3 — a physical Expo push token is globally unique so it belongs to at
--          most one User at a time (the UNIQUE constraint on expo_push_token)
--   R8.5 — one registration per (user, device); token rotation reuses the row
--   R11.3 — a Share_Reaction value is drawn from the closed Reaction_Vocabulary
--   R11.4 — at most one reaction per (share, recipient) (the composite PK)

BEGIN;

-- ---------------------------------------------------------------------------
-- push_registrations
-- ---------------------------------------------------------------------------
-- Push_Registration: one row per (user, device); the physical token is
-- globally unique so it can belong to exactly one user at a time (R8.3, R8.5).
CREATE TABLE push_registrations (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id        TEXT        NOT NULL,
    expo_push_token  TEXT        NOT NULL UNIQUE,          -- one user per token (R8.3)
    status           TEXT        NOT NULL DEFAULT 'active',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT push_registrations_status_chk CHECK (status IN ('active','invalidated')),
    CONSTRAINT push_registrations_user_device_uniq UNIQUE (user_id, device_id)
);

-- Delivery targeting selects a User's active registrations; partial index on
-- the active status keeps that lookup tight.
CREATE INDEX push_registrations_user_active_idx
    ON push_registrations(user_id) WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- notification_preferences
-- ---------------------------------------------------------------------------
-- Share_Notification_Preference: per-user; absence means enabled (R9.7).
CREATE TABLE notification_preferences (
    user_id                    UUID        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    share_notifications_enabled BOOLEAN    NOT NULL DEFAULT TRUE,
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- share_reactions
-- ---------------------------------------------------------------------------
-- Share_Reaction: at most one per (share, recipient) (R11.4), value from the
-- closed Reaction_Vocabulary (R11.3).
CREATE TABLE share_reactions (
    share_id      UUID        NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
    recipient_id  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reaction      TEXT        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (share_id, recipient_id),
    CONSTRAINT share_reactions_value_chk
        CHECK (reaction IN ('like','love','been_there','want_to_go'))
);

-- The sender's reaction view (R11.7) reads reactions by share; index the FK.
CREATE INDEX share_reactions_share_id_idx ON share_reactions(share_id);

COMMIT;
