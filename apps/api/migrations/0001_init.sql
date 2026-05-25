-- Disney World Tracker — initial schema
-- See design.md (ER diagram + "Constraints summarized") for the source of truth.
-- Requirements covered: R1.7, R2.3, R4.2, R5.1, R6.2, R8.6, R10.1 (and supporting indexes).

BEGIN;

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive email (R6.2)
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- trigram search on email/display_name
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
-- R6.2: email is UNIQUE under case-insensitive equality.
-- R6.11: only the Argon2id hash is persisted; no plaintext column exists.
CREATE TABLE users (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    email           CITEXT       NOT NULL UNIQUE,
    password_hash   TEXT         NOT NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
-- One profile per user. display_name 1..50 after trim is enforced at the
-- application layer; the DB just guards against egregiously long values.
CREATE TABLE profiles (
    user_id            UUID    PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    display_name       TEXT    NOT NULL,
    avatar_url         TEXT,
    avatar_mime        TEXT,
    avatar_size_bytes  INTEGER,
    CONSTRAINT profiles_display_name_length_chk
        CHECK (char_length(display_name) BETWEEN 1 AND 50),
    CONSTRAINT profiles_avatar_size_chk
        CHECK (avatar_size_bytes IS NULL OR avatar_size_bytes BETWEEN 1 AND 5242880),
    CONSTRAINT profiles_avatar_mime_chk
        CHECK (avatar_mime IS NULL OR avatar_mime IN ('image/png', 'image/jpeg'))
);

-- ---------------------------------------------------------------------------
-- sessions
-- ---------------------------------------------------------------------------
-- Token itself is never stored; only its sha256 hash. Lifecycle rules
-- (absolute_expires_at, last_seen_at idle window, revoked_at) are enforced
-- by the auth middleware (R6.5, R6.8, R6.9, R6.10, R6.12).
CREATE TABLE sessions (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash          TEXT         NOT NULL UNIQUE,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_seen_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    absolute_expires_at TIMESTAMPTZ  NOT NULL,
    revoked_at          TIMESTAMPTZ
);

CREATE INDEX sessions_user_id_idx ON sessions(user_id);

-- ---------------------------------------------------------------------------
-- experiences
-- ---------------------------------------------------------------------------
-- R1.7: id is a UUIDv5 derived from upstream entity id (set by application);
-- the database enforces UNIQUE(upstream_entity_id) so the one-to-one mapping
-- is durable.
-- park / category are stored as text + CHECK to match the design's enum
-- semantics without locking us into a Postgres ENUM type for migrations.
CREATE TABLE experiences (
    id                  UUID         PRIMARY KEY,
    upstream_entity_id  TEXT         NOT NULL UNIQUE,
    name                TEXT         NOT NULL,
    park                TEXT         NOT NULL,
    category            TEXT         NOT NULL,
    description         TEXT         NOT NULL DEFAULT '',
    active              BOOLEAN      NOT NULL DEFAULT TRUE,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT experiences_name_length_chk
        CHECK (char_length(name) BETWEEN 1 AND 200),
    CONSTRAINT experiences_description_length_chk
        CHECK (char_length(description) BETWEEN 0 AND 1000),
    CONSTRAINT experiences_park_chk CHECK (park IN (
        'Magic Kingdom',
        'EPCOT',
        'Hollywood Studios',
        'Animal Kingdom',
        'Typhoon Lagoon',
        'Blizzard Beach',
        'Disney Springs'
    )),
    CONSTRAINT experiences_category_chk CHECK (category IN (
        'Ride',
        'Show',
        'Restaurant',
        'Parade',
        'Character_Meet',
        'Other'
    ))
);

-- Composite index for browse/filter queries (R1.17–R1.19).
CREATE INDEX experiences_active_park_category_idx
    ON experiences(active, park, category);

-- Functional index for case-insensitive ordering / search prefixes (R1.17, R1.20).
CREATE INDEX experiences_lower_name_idx
    ON experiences(lower(name));

-- ---------------------------------------------------------------------------
-- catalog_sync_runs
-- ---------------------------------------------------------------------------
-- Records each sync attempt; on failure the cache is left unchanged (R1.13).
CREATE TABLE catalog_sync_runs (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    status              TEXT         NOT NULL,
    started_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    finished_at         TIMESTAMPTZ,
    error_class         TEXT,
    error_message       TEXT,
    entities_processed  INTEGER,
    CONSTRAINT catalog_sync_runs_status_chk
        CHECK (status IN ('running', 'success', 'failed'))
);

CREATE INDEX catalog_sync_runs_started_at_idx
    ON catalog_sync_runs(started_at DESC);

-- ---------------------------------------------------------------------------
-- catalog_cache_metadata
-- ---------------------------------------------------------------------------
-- Singleton row capturing the most recent successful sync time. The opportunistic
-- read path (R1.11, R1.12) compares now() against last_successful_sync_at.
CREATE TABLE catalog_cache_metadata (
    id                       SMALLINT     PRIMARY KEY DEFAULT 1,
    last_successful_sync_at  TIMESTAMPTZ,
    last_sync_run_id         UUID         REFERENCES catalog_sync_runs(id),
    CONSTRAINT catalog_cache_metadata_singleton_chk CHECK (id = 1)
);

-- ---------------------------------------------------------------------------
-- completions
-- ---------------------------------------------------------------------------
-- R2.3: at most one completion per (user, experience).
CREATE TABLE completions (
    user_id        UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    experience_id  UUID         NOT NULL REFERENCES experiences(id),
    completed_on   DATE         NOT NULL,
    user_tz        TEXT         NOT NULL,
    PRIMARY KEY (user_id, experience_id)
);

-- Stats queries roll up by user; explicit index supports per-user lookups
-- and matches the task brief.
CREATE INDEX completions_user_id_idx ON completions(user_id);

-- ---------------------------------------------------------------------------
-- ratings
-- ---------------------------------------------------------------------------
-- R4.2: at most one rating per (user, experience).
-- R4.7: value is an integer between 1 and 10 inclusive.
CREATE TABLE ratings (
    user_id        UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    experience_id  UUID         NOT NULL REFERENCES experiences(id),
    value          SMALLINT     NOT NULL,
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, experience_id),
    CONSTRAINT ratings_value_range_chk CHECK (value BETWEEN 1 AND 10)
);

-- Aggregate-rating recomputes scan ratings by experience.
CREATE INDEX ratings_experience_id_idx ON ratings(experience_id);

-- ---------------------------------------------------------------------------
-- notes
-- ---------------------------------------------------------------------------
-- R5.1: at most one note per (user, experience).
-- R5.2 / R5.10: body length 1..2000 (the application also enforces trim ≥ 1).
CREATE TABLE notes (
    user_id        UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    experience_id  UUID         NOT NULL REFERENCES experiences(id),
    body           TEXT         NOT NULL,
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, experience_id),
    CONSTRAINT notes_body_length_chk
        CHECK (char_length(body) BETWEEN 1 AND 2000)
);

-- ---------------------------------------------------------------------------
-- friend_requests
-- ---------------------------------------------------------------------------
-- One pending request per ordered (sender, recipient) pair (R8.7 same-direction
-- duplicate). Reverse-direction collisions and existing friendships are caught
-- in the application layer because they cross tables.
CREATE TABLE friend_requests (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id  UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT friend_requests_no_self_chk CHECK (sender_id <> recipient_id),
    CONSTRAINT friend_requests_sender_recipient_uniq
        UNIQUE (sender_id, recipient_id)
);

CREATE INDEX friend_requests_recipient_id_idx ON friend_requests(recipient_id);

-- ---------------------------------------------------------------------------
-- friendships
-- ---------------------------------------------------------------------------
-- R8.6: relationship is symmetric. Stored as a single canonical row per
-- unordered pair with user_lo_id < user_hi_id. The CHECK rules out self-friendship.
CREATE TABLE friendships (
    user_lo_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_hi_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    established_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (user_lo_id, user_hi_id),
    CONSTRAINT friendships_canonical_order_chk CHECK (user_lo_id < user_hi_id)
);

CREATE INDEX friendships_user_hi_id_idx ON friendships(user_hi_id);

-- ---------------------------------------------------------------------------
-- shares
-- ---------------------------------------------------------------------------
-- experience_id is nullable for progress shares (R9.7). payload_snapshot
-- captures rating/note/percentages at delivery time (R9.4–R9.7).
CREATE TABLE shares (
    id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id         UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    experience_id     UUID         REFERENCES experiences(id),
    payload_kind      TEXT         NOT NULL,
    payload_snapshot  JSONB        NOT NULL,
    sent_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT shares_payload_kind_chk
        CHECK (payload_kind IN ('experience', 'progress')),
    CONSTRAINT shares_experience_payload_chk CHECK (
        (payload_kind = 'experience' AND experience_id IS NOT NULL)
        OR (payload_kind = 'progress' AND experience_id IS NULL)
    )
);

CREATE INDEX shares_sender_id_idx ON shares(sender_id);

-- ---------------------------------------------------------------------------
-- share_recipients
-- ---------------------------------------------------------------------------
-- Per-recipient delivery state (R9.10 independence). recipient_deleted_at
-- is the recipient-side soft delete; the sender's `shares` row is unchanged.
CREATE TABLE share_recipients (
    share_id              UUID         NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
    recipient_id          UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    opened_at             TIMESTAMPTZ,
    recipient_deleted_at  TIMESTAMPTZ,
    PRIMARY KEY (share_id, recipient_id)
);

CREATE INDEX share_recipients_recipient_id_idx ON share_recipients(recipient_id);

-- ---------------------------------------------------------------------------
-- aggregate_ratings
-- ---------------------------------------------------------------------------
-- R10.1: aggregate is in [1.0, 10.0] when reported. Stored as mean_x10
-- (10..100 SMALLINT) to dodge floating-point drift; rendered as decimal at
-- the API boundary. NULL when count_ratings < 3 (R10.4 threshold gating).
CREATE TABLE aggregate_ratings (
    experience_id   UUID         PRIMARY KEY REFERENCES experiences(id),
    sum_ratings     BIGINT       NOT NULL DEFAULT 0,
    count_ratings   INTEGER      NOT NULL DEFAULT 0,
    mean_x10        SMALLINT,
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT aggregate_ratings_count_nonneg_chk
        CHECK (count_ratings >= 0),
    CONSTRAINT aggregate_ratings_sum_nonneg_chk
        CHECK (sum_ratings >= 0),
    CONSTRAINT aggregate_ratings_mean_x10_chk
        CHECK (mean_x10 IS NULL OR mean_x10 BETWEEN 10 AND 100)
);

-- Leaderboard ordering (R11.3): mean_x10 DESC, count_ratings DESC.
CREATE INDEX aggregate_ratings_leaderboard_idx
    ON aggregate_ratings(mean_x10 DESC, count_ratings DESC)
    WHERE mean_x10 IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Trigram indexes for user search (R8.1 case-insensitive substring match)
-- ---------------------------------------------------------------------------
-- citext is cast to text for the gin_trgm_ops operator class; substring
-- matching remains case-insensitive because the underlying type is citext.
CREATE INDEX users_email_trgm_idx
    ON users USING gin ((email::text) gin_trgm_ops);

CREATE INDEX profiles_display_name_trgm_idx
    ON profiles USING gin (display_name gin_trgm_ops);

COMMIT;
