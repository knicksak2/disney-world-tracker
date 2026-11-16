-- Migration: 0076_user_feedback
-- Spec: .kiro/specs/in-app-feedback/
-- Requirements: 2.3, 2.4, 2.5, 3.1, 5.2, 6.1, 7.1
BEGIN;
CREATE TABLE IF NOT EXISTS user_feedback (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL,
  message           TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'new',
  contact_ok        BOOLEAN NOT NULL DEFAULT FALSE,
  contact_email     TEXT,
  app_version       TEXT,
  platform          TEXT,
  os_version        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  status_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_uf_kind CHECK (kind IN ('bug', 'idea', 'other')),
  CONSTRAINT chk_uf_message CHECK (char_length(message) BETWEEN 1 AND 2000),
  CONSTRAINT chk_uf_status CHECK (status IN ('new', 'triaged', 'resolved')),
  CONSTRAINT chk_uf_contact CHECK (contact_ok OR contact_email IS NULL),
  CONSTRAINT chk_uf_app_version CHECK (app_version IS NULL OR char_length(app_version) <= 32),
  CONSTRAINT chk_uf_platform CHECK (platform IS NULL OR platform IN ('ios', 'android', 'web')),
  CONSTRAINT chk_uf_os_version CHECK (os_version IS NULL OR char_length(os_version) <= 32)
);
-- Per-user cap counts (user_id, created_at) and the admin list (status, created_at).
CREATE INDEX IF NOT EXISTS user_feedback_user_created_idx ON user_feedback (user_id, created_at);
CREATE INDEX IF NOT EXISTS user_feedback_status_created_idx ON user_feedback (status, created_at);
COMMIT;
