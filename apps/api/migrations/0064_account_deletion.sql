BEGIN;

-- Migration 0064_account_deletion.sql
-- Self-service account deletion (account-deletion spec): lifecycle columns on users, the
-- re-authentication grant store, the durable aggregate-recompute queue, the non-identifying
-- purge ledger, and the three visibility views. Additive and idempotent on reapply; no
-- existing foreign key is changed.

-- 1. Lifecycle columns on users --------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_state            TEXT        NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_requested_at     TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS scheduled_purge_at        TIMESTAMPTZ;   -- persisted at request time (R3.1)
ALTER TABLE users ADD COLUMN IF NOT EXISTS placeholder_id            UUID;          -- alias id shown to others; becomes the tombstone id
ALTER TABLE users ADD COLUMN IF NOT EXISTS purge_claimed_at          TIMESTAMPTZ;   -- fencing token
ALTER TABLE users ADD COLUMN IF NOT EXISTS purge_stage               SMALLINT    NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS purge_trips_transferred   INTEGER     NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS purge_trips_deleted       INTEGER     NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS purge_photos_deleted      INTEGER     NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS purge_attempts            SMALLINT    NOT NULL DEFAULT 0;   -- R8.12: failed runs; claim order key
ALTER TABLE users ADD COLUMN IF NOT EXISTS purge_last_attempt_at     TIMESTAMPTZ;                      -- R8.12: when the last failed attempt happened
ALTER TABLE users ADD COLUMN IF NOT EXISTS purge_warnings            SMALLINT    NOT NULL DEFAULT 0;   -- R9.11: best-effort cleanup failures, read by finalize

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_deletion_state_chk;
ALTER TABLE users ADD  CONSTRAINT users_deletion_state_chk
  CHECK (deletion_state IN ('active','pending_deletion','purging','tombstone'));
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_deletion_schedule_chk;
ALTER TABLE users ADD  CONSTRAINT users_deletion_schedule_chk
  CHECK (deletion_state NOT IN ('pending_deletion','purging')
         OR (scheduled_purge_at IS NOT NULL AND deletion_requested_at IS NOT NULL AND placeholder_id IS NOT NULL));
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_purge_stage_chk;
ALTER TABLE users ADD  CONSTRAINT users_purge_stage_chk CHECK (purge_stage BETWEEN 0 AND 4);
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_purge_counters_chk;
ALTER TABLE users ADD  CONSTRAINT users_purge_counters_chk
  CHECK (purge_attempts >= 0 AND purge_warnings >= 0 AND purge_trips_transferred >= 0
         AND purge_trips_deleted >= 0 AND purge_photos_deleted >= 0);
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_tombstone_prefix_chk;
ALTER TABLE users ADD  CONSTRAINT users_tombstone_prefix_chk
  CHECK ((deletion_state = 'tombstone') = (id::text LIKE 'deadc0de-%'));

CREATE UNIQUE INDEX IF NOT EXISTS users_placeholder_id_uidx ON users (placeholder_id) WHERE placeholder_id IS NOT NULL;
CREATE INDEX        IF NOT EXISTS users_deletion_due_idx    ON users (purge_attempts, scheduled_purge_at)
  WHERE deletion_state IN ('pending_deletion','purging');   -- serves the claim's ORDER BY purge_attempts, scheduled_purge_at, id

-- 2. Reauth grants: at most one per session; expired rows are pruned by issueGrant itself (R2.12) --
CREATE TABLE IF NOT EXISTS account_deletion_reauth_grants (
  session_id UUID        PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL    REFERENCES users(id)    ON DELETE CASCADE,
  grant_hash TEXT        NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_deletion_reauth_grants_expires_idx ON account_deletion_reauth_grants (expires_at);

-- 3. Durable aggregate-recompute queue: ids only, no user reference ---------------------------
CREATE TABLE IF NOT EXISTS account_deletion_recompute_queue (
  experience_id UUID        PRIMARY KEY REFERENCES experiences(id) ON DELETE CASCADE,
  enqueued_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Non-identifying purge ledger: no user id, email or name (R9.6) ---------------------------
CREATE TABLE IF NOT EXISTS account_deletion_ledger (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_at      TIMESTAMPTZ NOT NULL,
  purged_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  trips_transferred INTEGER     NOT NULL DEFAULT 0 CHECK (trips_transferred >= 0),
  trips_deleted     INTEGER     NOT NULL DEFAULT 0 CHECK (trips_deleted >= 0),
  photos_deleted    INTEGER     NOT NULL DEFAULT 0 CHECK (photos_deleted >= 0),
  outcome           TEXT        NOT NULL DEFAULT 'completed' CHECK (outcome IN ('completed','completed_with_warnings'))
  -- `outcome` is written by finalize from users.purge_warnings (> 0 -> 'completed_with_warnings'), in the same
  -- transaction that deletes the user row (R9.11). No later step ever needs to update this row.
);
CREATE INDEX IF NOT EXISTS account_deletion_ledger_purged_idx ON account_deletion_ledger (purged_at DESC, id DESC);

-- 5. Visibility views (the database-side choke points, R5.1) -----------------------------------
-- CREATE OR REPLACE (not DROP VIEW IF EXISTS + CREATE VIEW): idempotent on Postgres for an unchanged
-- column list, and the only form pg-mem can apply (it has no DROP VIEW). A future change to a view's
-- columns is a new migration.
CREATE OR REPLACE VIEW profile_identity AS
SELECT p.user_id,
       CASE WHEN u.deletion_state = 'active' THEN p.user_id
            ELSE COALESCE(u.placeholder_id, p.user_id) END                 AS public_id,
       CASE WHEN u.deletion_state = 'active' THEN p.display_name
            ELSE 'Deleted user' END                                         AS display_name,
       CASE WHEN u.deletion_state = 'active' THEN p.avatar_preset
            ELSE NULL END                                                   AS avatar_preset,
       (u.deletion_state = 'active')                                        AS is_visible
  FROM profiles p
  JOIN users u ON u.id = p.user_id;

CREATE OR REPLACE VIEW active_friendships AS
SELECT f.user_lo_id, f.user_hi_id, f.established_at
  FROM friendships f
  JOIN users ul ON ul.id = f.user_lo_id AND ul.deletion_state = 'active'
  JOIN users uh ON uh.id = f.user_hi_id AND uh.deletion_state = 'active';

CREATE OR REPLACE VIEW active_trip_memberships AS
SELECT tm.trip_id, tm.user_id, tm.role, tm.joined_at
  FROM trip_memberships tm
  JOIN users u ON u.id = tm.user_id AND u.deletion_state = 'active';

COMMIT;
