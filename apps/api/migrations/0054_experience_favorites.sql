BEGIN;

-- experience_favorites — a simple boolean (user, experience) affinity. NOT an
-- Experience_List (no sharing/visibility/membership/ordering); a pure join row,
-- structurally identical to experience_list_likes.
CREATE TABLE experience_favorites (
    user_id        UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    experience_id  UUID         NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    favorited_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, experience_id)
);

-- Supports GET /me/favorites, the mobile favorited-set hook, and every
-- surface's reverse lookup by user. Mirrors experience_list_saves_user_idx.
CREATE INDEX experience_favorites_user_idx ON experience_favorites(user_id);

-- Supports the Trip Group Favorites join (GROUP BY experience_id across a
-- Trip's membership set) — a forward lookup by experience, the PK already
-- covers lookups scoped by both columns, this covers an experience-first scan.
CREATE INDEX experience_favorites_experience_idx ON experience_favorites(experience_id);

COMMIT;
