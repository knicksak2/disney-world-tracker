BEGIN;

-- ---------------------------------------------------------------------------
-- 1. experience_lists
-- ---------------------------------------------------------------------------
CREATE TABLE experience_lists (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT         NOT NULL,
    visibility   TEXT         NOT NULL DEFAULT 'private',
    like_count   INTEGER      NOT NULL DEFAULT 0,
    version      INTEGER      NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT experience_lists_name_length_chk CHECK (char_length(name) BETWEEN 1 AND 100),
    CONSTRAINT experience_lists_visibility_chk CHECK (visibility IN ('private', 'public')),
    CONSTRAINT experience_lists_like_count_nonneg_chk CHECK (like_count >= 0),
    CONSTRAINT experience_lists_version_nonneg_chk CHECK (version >= 0)
);

CREATE INDEX experience_lists_owner_idx ON experience_lists(owner_id, updated_at DESC);
CREATE INDEX experience_lists_discover_popular_idx ON experience_lists(visibility, like_count DESC, id ASC);
CREATE INDEX experience_lists_discover_recent_idx ON experience_lists(visibility, created_at DESC, id ASC);

-- ---------------------------------------------------------------------------
-- 2. experience_lists_items
-- ---------------------------------------------------------------------------
CREATE TABLE experience_lists_items (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    experience_list_id  UUID         NOT NULL REFERENCES experience_lists(id) ON DELETE CASCADE,
    experience_id       UUID         NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    position            INTEGER      NOT NULL,
    added_by_user_id    UUID         REFERENCES users(id) ON DELETE SET NULL,
    added_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT experience_lists_items_unique UNIQUE (experience_list_id, experience_id),
    CONSTRAINT experience_lists_items_position_unique UNIQUE (experience_list_id, position)
);

CREATE INDEX experience_lists_items_list_idx ON experience_lists_items(experience_list_id, position ASC);

-- ---------------------------------------------------------------------------
-- 3. experience_list_shares — private-list live access grant (NOT a shares/share_recipients row)
-- ---------------------------------------------------------------------------
CREATE TABLE experience_list_shares (
    experience_list_id   UUID         NOT NULL REFERENCES experience_lists(id) ON DELETE CASCADE,
    shared_with_user_id  UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shared_by_user_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role                 TEXT         NOT NULL DEFAULT 'viewer',
    shared_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT experience_list_shares_role_chk CHECK (role IN ('viewer', 'editor')),
    PRIMARY KEY (experience_list_id, shared_with_user_id)
);

CREATE INDEX experience_list_shares_recipient_idx ON experience_list_shares(shared_with_user_id);

-- ---------------------------------------------------------------------------
-- 4. experience_list_likes
-- ---------------------------------------------------------------------------
CREATE TABLE experience_list_likes (
    experience_list_id  UUID         NOT NULL REFERENCES experience_lists(id) ON DELETE CASCADE,
    user_id             UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    liked_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (experience_list_id, user_id)
);

-- ---------------------------------------------------------------------------
-- 5. experience_list_saves — a live reference, never a content copy
-- ---------------------------------------------------------------------------
CREATE TABLE experience_list_saves (
    experience_list_id  UUID         NOT NULL REFERENCES experience_lists(id) ON DELETE CASCADE,
    saved_by_user_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    saved_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (experience_list_id, saved_by_user_id)
);

CREATE INDEX experience_list_saves_user_idx ON experience_list_saves(saved_by_user_id);

COMMIT;
