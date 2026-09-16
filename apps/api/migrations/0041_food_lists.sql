BEGIN;

-- ---------------------------------------------------------------------------
-- 1. food_lists
-- ---------------------------------------------------------------------------
CREATE TABLE food_lists (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT         NOT NULL,
    visibility   TEXT         NOT NULL DEFAULT 'private',
    like_count   INTEGER      NOT NULL DEFAULT 0,
    version      INTEGER      NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT food_lists_name_length_chk CHECK (char_length(name) BETWEEN 1 AND 100),
    CONSTRAINT food_lists_visibility_chk CHECK (visibility IN ('private', 'public')),
    CONSTRAINT food_lists_like_count_nonneg_chk CHECK (like_count >= 0),
    CONSTRAINT food_lists_version_nonneg_chk CHECK (version >= 0)
);

CREATE INDEX food_lists_owner_idx ON food_lists(owner_id, updated_at DESC);
CREATE INDEX food_lists_discover_popular_idx ON food_lists(visibility, like_count DESC, id ASC);
CREATE INDEX food_lists_discover_recent_idx ON food_lists(visibility, created_at DESC, id ASC);

-- ---------------------------------------------------------------------------
-- 2. food_lists_items
-- ---------------------------------------------------------------------------
CREATE TABLE food_lists_items (
    id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    food_list_id      UUID         NOT NULL REFERENCES food_lists(id) ON DELETE CASCADE,
    food_item_id      UUID         NOT NULL REFERENCES food_items(id) ON DELETE CASCADE,
    position          INTEGER      NOT NULL,
    added_by_user_id  UUID         REFERENCES users(id) ON DELETE SET NULL,
    added_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT food_lists_items_unique UNIQUE (food_list_id, food_item_id),
    CONSTRAINT food_lists_items_position_unique UNIQUE (food_list_id, position)
);

CREATE INDEX food_lists_items_list_idx ON food_lists_items(food_list_id, position ASC);

-- ---------------------------------------------------------------------------
-- 3. food_list_shares — private-list live access grant (NOT a shares/share_recipients row)
-- ---------------------------------------------------------------------------
CREATE TABLE food_list_shares (
    food_list_id         UUID         NOT NULL REFERENCES food_lists(id) ON DELETE CASCADE,
    shared_with_user_id  UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shared_by_user_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role                 TEXT         NOT NULL DEFAULT 'viewer',
    shared_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT food_list_shares_role_chk CHECK (role IN ('viewer', 'editor')),
    PRIMARY KEY (food_list_id, shared_with_user_id)
);

CREATE INDEX food_list_shares_recipient_idx ON food_list_shares(shared_with_user_id);

-- ---------------------------------------------------------------------------
-- 4. food_list_likes
-- ---------------------------------------------------------------------------
CREATE TABLE food_list_likes (
    food_list_id  UUID         NOT NULL REFERENCES food_lists(id) ON DELETE CASCADE,
    user_id       UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    liked_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (food_list_id, user_id)
);

-- ---------------------------------------------------------------------------
-- 5. food_list_saves — a live reference, never a content copy
-- ---------------------------------------------------------------------------
CREATE TABLE food_list_saves (
    food_list_id     UUID         NOT NULL REFERENCES food_lists(id) ON DELETE CASCADE,
    saved_by_user_id UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    saved_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (food_list_id, saved_by_user_id)
);

CREATE INDEX food_list_saves_user_idx ON food_list_saves(saved_by_user_id);

COMMIT;
