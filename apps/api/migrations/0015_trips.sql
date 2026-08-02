-- Disney World Tracker — Trips migration
-- Adds the persistence surface for the Trips feature: shared, multi-person
-- Walt Disney World visits with a Planned_List, a Shared_Log with confirmable
-- "rode with" tags, a reverse-chronological Trip_Feed with reactions and
-- comments, and derived Trip_Summary reads. Strictly additive: nine new tables
-- and their indexes; no existing table, column, or constraint is touched. Trip
-- Completions and Ratings remain the SAME canonical rows in completions /
-- ratings — this migration never copies them (R12.1, R3.10, R8.4).
--
-- See design.md ("New migration 0015_trips.sql") for the source of truth for
-- this DDL. Mirrors the BEGIN/COMMIT + inline-comment conventions of the
-- earlier migrations (0001_init.sql, 0011_social_sharing_loop.sql).
--
-- No status column exists on trips: Trip_Status is always derived from the
-- start/end dates and the WDW_Current_Date so it can never drift (R2.5).
--
-- Requirements covered:
--   R2.5  — no status column; Trip_Status is derived, never stored
--   R3.7  — ON DELETE CASCADE fans a Trip delete out to every child entity
--   R4.1  — exactly one role per (trip, user) via the composite primary key
--   R6.5  — at most one PENDING invite per (trip, invitee) (partial unique idx)
--   R9.3  — one Planned_Item per (trip, experience)
--   R11.1 — the rode_with_tags state machine backs confirm-before-write
--   R13.3 — the trip_feed ordering index (created_at DESC, id DESC)
--   R13.4 — at most one reaction of a type per (target, member) (composite PK)

BEGIN;

-- ---------------------------------------------------------------------------
-- trips
-- ---------------------------------------------------------------------------
-- trips: name trimmed 1..100 and description <=2000 enforced at the app layer;
-- DB CHECKs are defense in depth. end_date >= start_date (R1.8, R3.6). No
-- status column: Trip_Status is always derived (R2.5).
CREATE TABLE trips (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT        NOT NULL,
    description  TEXT        NOT NULL DEFAULT '',
    start_date   DATE        NOT NULL,
    end_date     DATE        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT trips_name_length_chk       CHECK (char_length(name) BETWEEN 1 AND 100),
    CONSTRAINT trips_description_length_chk CHECK (char_length(description) BETWEEN 0 AND 2000),
    CONSTRAINT trips_date_order_chk         CHECK (end_date >= start_date)
);

-- ---------------------------------------------------------------------------
-- trip_memberships
-- ---------------------------------------------------------------------------
-- trip_memberships: one role per (trip, user) (R4.1).
CREATE TABLE trip_memberships (
    trip_id    UUID        NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT        NOT NULL,
    joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (trip_id, user_id),
    CONSTRAINT trip_memberships_role_chk CHECK (role IN ('organizer','member'))
);
CREATE INDEX trip_memberships_user_idx ON trip_memberships(user_id);

-- ---------------------------------------------------------------------------
-- trip_invites
-- ---------------------------------------------------------------------------
-- trip_invites: at most one PENDING invite per (trip, invitee) (R6.5);
-- terminal (accepted/declined/cancelled) invites do not block re-invite (R6.8).
CREATE TABLE trip_invites (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id     UUID        NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    inviter_id  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invitee_id  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    state       TEXT        NOT NULL DEFAULT 'pending',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT trip_invites_state_chk CHECK (state IN ('pending','accepted','declined','cancelled'))
);
CREATE UNIQUE INDEX trip_invites_one_pending_idx
    ON trip_invites(trip_id, invitee_id) WHERE state = 'pending';
CREATE INDEX trip_invites_invitee_idx ON trip_invites(invitee_id);

-- ---------------------------------------------------------------------------
-- planned_items
-- ---------------------------------------------------------------------------
-- planned_items: one entry per (trip, experience) (R9.3); adder recorded (R9.1).
CREATE TABLE planned_items (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id        UUID        NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    experience_id  UUID        NOT NULL REFERENCES experiences(id),
    added_by       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT planned_items_unique UNIQUE (trip_id, experience_id)
);
CREATE INDEX planned_items_trip_idx ON planned_items(trip_id);

-- ---------------------------------------------------------------------------
-- trip_log_entries
-- ---------------------------------------------------------------------------
-- trip_log_entries: references the logging member's canonical completion
-- (member_id, experience_id) -> completions; linked to the Trip (R10.1, R10.2).
CREATE TABLE trip_log_entries (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id        UUID        NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    member_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    experience_id  UUID        NOT NULL REFERENCES experiences(id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX trip_log_entries_trip_idx ON trip_log_entries(trip_id);

-- ---------------------------------------------------------------------------
-- rode_with_tags
-- ---------------------------------------------------------------------------
-- rode_with_tags: confirm-before-write state machine; a confirmed tag is the
-- durable link of the tagged member's completion to the Trip (R11, R8.5).
CREATE TABLE rode_with_tags (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    log_entry_id      UUID        NOT NULL REFERENCES trip_log_entries(id) ON DELETE CASCADE,
    tagged_member_id  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    state             TEXT        NOT NULL DEFAULT 'pending',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT rode_with_tags_state_chk CHECK (state IN ('pending','confirmed','declined','cancelled')),
    CONSTRAINT rode_with_tags_one_per_member UNIQUE (log_entry_id, tagged_member_id)
);
CREATE INDEX rode_with_tags_tagged_member_idx ON rode_with_tags(tagged_member_id);

-- ---------------------------------------------------------------------------
-- trip_feed_items
-- ---------------------------------------------------------------------------
-- trip_feed_items: reverse-chron feed; deterministic tie-break by (created_at, id) (R13.3).
CREATE TABLE trip_feed_items (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id     UUID        NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    type        TEXT        NOT NULL,
    actor_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    metadata    JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT trip_feed_items_type_chk CHECK (type IN (
        'trip_created','member_joined','completion_logged','rating_recorded','rode_with_confirmed'
    ))
);
CREATE INDEX trip_feed_items_trip_order_idx ON trip_feed_items(trip_id, created_at DESC, id DESC);

-- ---------------------------------------------------------------------------
-- trip_reactions
-- ---------------------------------------------------------------------------
-- trip_reactions: at most one reaction of a type per (target, member) (R13.4, R13.5).
CREATE TABLE trip_reactions (
    trip_id      UUID        NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    target_type  TEXT        NOT NULL,
    target_id    UUID        NOT NULL,
    member_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reaction     TEXT        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (target_type, target_id, member_id, reaction),
    CONSTRAINT trip_reactions_target_chk   CHECK (target_type IN ('feed_item','log_entry')),
    CONSTRAINT trip_reactions_value_chk    CHECK (reaction IN ('like','love','celebrate','wow'))
);
CREATE INDEX trip_reactions_target_idx ON trip_reactions(target_type, target_id);

-- ---------------------------------------------------------------------------
-- trip_comments
-- ---------------------------------------------------------------------------
-- trip_comments: 1..2000 chars after trim enforced at the app layer (R13.9).
CREATE TABLE trip_comments (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id      UUID        NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    target_type  TEXT        NOT NULL,
    target_id    UUID        NOT NULL,
    author_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body         TEXT        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT trip_comments_target_chk CHECK (target_type IN ('feed_item','log_entry')),
    CONSTRAINT trip_comments_body_length_chk CHECK (char_length(body) BETWEEN 1 AND 2000)
);
CREATE INDEX trip_comments_target_idx ON trip_comments(target_type, target_id);

COMMIT;
