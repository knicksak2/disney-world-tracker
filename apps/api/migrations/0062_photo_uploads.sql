BEGIN;

-- Migration 0062_photo_uploads.sql
-- Photo uploads pipeline, moderation, reports, user blocks, bans, strikes, and quota/usage counters.
-- NOTE: photos.owner_id is ON DELETE SET NULL on purpose so that when a user is deleted,
-- the photo row remains for the Sweep to find and delete the storage objects before hard-deleting the row.
-- There are deliberately no foreign keys from photos to food_item_logs or trips: an ON DELETE CASCADE
-- would delete the row and orphan the bucket objects, while SET NULL or no FK lets the Sweep orphan reaper
-- soft-delete the photo and clean up storage.

CREATE TABLE IF NOT EXISTS photos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  target_kind      TEXT NOT NULL,
  target_id        UUID NOT NULL,
  scope_id         UUID NOT NULL,
  feed_item_id     UUID,                       -- trip posts only; FK added in 0063
  status           TEXT NOT NULL DEFAULT 'uploading',
  object_key       TEXT NOT NULL,
  thumb_key        TEXT NOT NULL,
  byte_size        INTEGER NOT NULL,
  thumb_byte_size  INTEGER NOT NULL,
  width            INTEGER NOT NULL,
  height           INTEGER NOT NULL,
  taken_at         TIMESTAMPTZ,
  sort_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  harm_verdict     TEXT,
  vision_verdict   TEXT,
  reject_reason    TEXT,
  hidden_reason    TEXT,
  vision_fields    JSONB,
  attempts         SMALLINT NOT NULL DEFAULT 0,
  next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_until      TIMESTAMPTZ,
  last_error_code  TEXT,
  delete_attempts  SMALLINT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at     TIMESTAMPTZ,
  moderated_at     TIMESTAMPTZ,
  deleted_at       TIMESTAMPTZ,
  full_etag        TEXT,                       -- ETag of u/<id>/full.jpg recorded at confirm (R4.9)
  thumb_etag       TEXT,                       -- ETag of u/<id>/thumb.jpg recorded at confirm (R4.9)
  served_at        TIMESTAMPTZ,                -- set when the serving-key copy was verified and approved written
  upload_cleaned_at TIMESTAMPTZ,               -- set when the two u/ objects of an approved photo were deleted (R19.12)
  approved_by_operator BOOLEAN NOT NULL DEFAULT false,   -- operator override marker (R8.12)
  CONSTRAINT chk_photos_target_kind CHECK (target_kind IN ('food_log','trip')),
  CONSTRAINT chk_photos_status CHECK (status IN ('uploading','pending','approved','rejected','needs_review','hidden','deleted')),
  CONSTRAINT chk_photos_harm CHECK (harm_verdict IS NULL OR harm_verdict IN ('pass','flag')),
  CONSTRAINT chk_photos_vision CHECK (vision_verdict IS NULL OR vision_verdict IN ('pass','reject')),
  CONSTRAINT chk_photos_reject_reason CHECK (reject_reason IS NULL OR reject_reason IN ('harm','not_food','face_visible','too_much_text','invalid_image')),
  CONSTRAINT chk_photos_rejected_has_reason CHECK (status <> 'rejected' OR reject_reason IS NOT NULL),
  CONSTRAINT chk_photos_hidden_reason CHECK (hidden_reason IS NULL OR hidden_reason = 'reports'),   -- the only way a photo is hidden is the auto-hide at the report threshold
  CONSTRAINT chk_photos_sizes CHECK (byte_size > 0 AND thumb_byte_size > 0 AND width BETWEEN 1 AND 4096 AND height BETWEEN 1 AND 4096),
  CONSTRAINT chk_photos_feed_trip_only CHECK (feed_item_id IS NULL OR target_kind = 'trip'),
  CONSTRAINT chk_photos_keys_distinct CHECK (object_key <> thumb_key),
  -- the one invariant every read relies on, enforced in the database too (R8.1):
  CONSTRAINT chk_photos_served_harm_pass CHECK (status NOT IN ('approved','hidden') OR harm_verdict = 'pass'),
  CONSTRAINT chk_photos_served_vision_pass CHECK (status NOT IN ('approved','hidden') OR target_kind <> 'food_log' OR vision_verdict = 'pass'),
  CONSTRAINT chk_photos_served_has_etags CHECK (status NOT IN ('approved','hidden') OR (full_etag IS NOT NULL AND thumb_etag IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS photos_object_key_uidx ON photos(object_key);
CREATE INDEX IF NOT EXISTS photos_scope_list_idx   ON photos(target_kind, scope_id, status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS photos_album_idx        ON photos(target_kind, scope_id, status, sort_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS photos_owner_idx        ON photos(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS photos_target_idx       ON photos(target_kind, target_id);
CREATE INDEX IF NOT EXISTS photos_status_due_idx   ON photos(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS photos_feed_item_idx    ON photos(feed_item_id);
CREATE INDEX IF NOT EXISTS photos_upload_uncleaned_idx ON photos(served_at) WHERE upload_cleaned_at IS NULL AND status IN ('approved','hidden');

CREATE TABLE IF NOT EXISTS photo_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  CONSTRAINT chk_photo_reports_reason CHECK (reason IN ('inappropriate','shows_person','not_food','spam','other')),
  CONSTRAINT chk_photo_reports_status CHECK (status IN ('open','upheld','dismissed')),
  CONSTRAINT chk_photo_reports_note CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 300),
  CONSTRAINT photo_reports_unique UNIQUE (photo_id, reporter_id)
);
CREATE INDEX IF NOT EXISTS photo_reports_photo_status_idx ON photo_reports(photo_id, status);
CREATE INDEX IF NOT EXISTS photo_reports_open_idx ON photo_reports(status, created_at);

CREATE TABLE IF NOT EXISTS user_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),      -- unblock is keyed by this id so a photo-id block never reveals the user id (R17.1)
  blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_blocks_pair_unique UNIQUE (blocker_id, blocked_id),
  CONSTRAINT chk_user_blocks_distinct CHECK (blocker_id <> blocked_id)
);
CREATE INDEX IF NOT EXISTS user_blocks_blocker_idx ON user_blocks(blocker_id);
CREATE INDEX IF NOT EXISTS user_blocks_blocked_idx ON user_blocks(blocked_id);

CREATE TABLE IF NOT EXISTS photo_upload_bans (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Strike history survives the Sweep: photo_reports cascade with the photo row, so the count the operator uses to
-- decide a ban cannot be derived from them (R18.5). One small row per sanctioned user, cascading only with the user.
CREATE TABLE IF NOT EXISTS photo_upload_strikes (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  upheld_count INTEGER NOT NULL DEFAULT 0,
  last_upheld_at TIMESTAMPTZ,
  CONSTRAINT chk_photo_strikes_count CHECK (upheld_count >= 0)
);

CREATE TABLE IF NOT EXISTS photo_upload_counters (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  upload_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day),
  CONSTRAINT chk_photo_counters_count CHECK (upload_count >= 0)
);

CREATE TABLE IF NOT EXISTS photo_usage_daily (
  day DATE PRIMARY KEY,
  uploads INTEGER NOT NULL DEFAULT 0,
  upload_bytes BIGINT NOT NULL DEFAULT 0,
  harm_calls INTEGER NOT NULL DEFAULT 0,
  vision_calls INTEGER NOT NULL DEFAULT 0,
  vision_prompt_tokens BIGINT NOT NULL DEFAULT 0,
  vision_output_tokens BIGINT NOT NULL DEFAULT 0,
  rejections INTEGER NOT NULL DEFAULT 0,
  needs_review INTEGER NOT NULL DEFAULT 0,
  exif_present INTEGER NOT NULL DEFAULT 0
);

COMMIT;
