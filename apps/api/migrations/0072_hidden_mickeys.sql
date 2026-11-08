-- Migration: 0072_hidden_mickeys
-- Spec: .kiro/specs/hidden-mickeys/
-- Requirements: 1.1, 1.2, 1.3, 1.5, 4.1, 5.1, 7.1, 8.6, 14.5, 16.1

BEGIN;

CREATE TABLE IF NOT EXISTS hidden_mickeys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experience_id UUID NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  zone          TEXT NOT NULL,
  difficulty    TEXT NOT NULL,
  clue_1        TEXT NOT NULL,
  clue_2        TEXT NOT NULL,
  reveal        TEXT NOT NULL,
  source        TEXT NOT NULL,
  official      BOOLEAN NOT NULL DEFAULT FALSE,
  status        TEXT NOT NULL DEFAULT 'pending',
  hidden_reason TEXT,
  seed_key      TEXT,
  submitter_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  review_note   TEXT,
  text_screen   TEXT NOT NULL DEFAULT 'skipped',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at   TIMESTAMPTZ,
  promoted_at   TIMESTAMPTZ,
  CONSTRAINT chk_hm_zone CHECK (zone IN ('exterior','queue','pre_show','on_ride','exit','interior','grounds')),
  CONSTRAINT chk_hm_difficulty CHECK (difficulty IN ('easy','medium','hard')),
  CONSTRAINT chk_hm_clue1 CHECK (char_length(clue_1) BETWEEN 10 AND 140),
  CONSTRAINT chk_hm_clue2 CHECK (char_length(clue_2) BETWEEN 10 AND 300),
  CONSTRAINT chk_hm_reveal CHECK (char_length(reveal) BETWEEN 10 AND 500),
  CONSTRAINT chk_hm_source CHECK (source IN ('seed','user')),
  CONSTRAINT chk_hm_seed_official CHECK (source <> 'seed' OR official = TRUE),
  CONSTRAINT chk_hm_status CHECK (status IN ('pending','approved','rejected','retired','hidden')),
  CONSTRAINT chk_hm_hidden_reason CHECK (
    (status = 'hidden' AND hidden_reason IN ('reports','operator'))
    OR (status <> 'hidden' AND hidden_reason IS NULL)
  ),
  CONSTRAINT chk_hm_text_screen CHECK (text_screen IN ('skipped','pass','unscreened')),
  CONSTRAINT chk_hm_review_note CHECK (review_note IS NULL OR char_length(review_note) BETWEEN 1 AND 300)
);
CREATE UNIQUE INDEX IF NOT EXISTS hidden_mickeys_seed_key_uidx ON hidden_mickeys(seed_key) WHERE seed_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS hidden_mickeys_experience_idx ON hidden_mickeys(experience_id, status);
CREATE INDEX IF NOT EXISTS hidden_mickeys_status_idx ON hidden_mickeys(status, official, created_at);
CREATE INDEX IF NOT EXISTS hidden_mickeys_submitter_idx ON hidden_mickeys(submitter_id, created_at DESC);

CREATE TABLE IF NOT EXISTS mickey_progress (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mickey_id  UUID NOT NULL REFERENCES hidden_mickeys(id) ON DELETE CASCADE,
  hint_level SMALLINT NOT NULL DEFAULT 1,
  found_at   TIMESTAMPTZ,
  found_on   DATE,
  trip_id    UUID REFERENCES trips(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, mickey_id),
  CONSTRAINT chk_mp_hint CHECK (hint_level BETWEEN 1 AND 3),
  CONSTRAINT chk_mp_found_pair CHECK ((found_at IS NULL) = (found_on IS NULL)),
  CONSTRAINT chk_mp_trip_needs_find CHECK (found_at IS NOT NULL OR trip_id IS NULL)
);
CREATE INDEX IF NOT EXISTS mickey_progress_user_idx ON mickey_progress(user_id, found_at DESC);
CREATE INDEX IF NOT EXISTS mickey_progress_mickey_idx ON mickey_progress(mickey_id) WHERE found_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS mickey_progress_trip_idx ON mickey_progress(trip_id) WHERE trip_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS mickey_still_there_votes (
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mickey_id UUID NOT NULL REFERENCES hidden_mickeys(id) ON DELETE CASCADE,
  vote      TEXT NOT NULL,
  voted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, mickey_id),
  CONSTRAINT chk_mstv_vote CHECK (vote IN ('there','gone'))
);
CREATE INDEX IF NOT EXISTS mickey_votes_mickey_idx ON mickey_still_there_votes(mickey_id);

CREATE TABLE IF NOT EXISTS mickey_reports (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mickey_id   UUID NOT NULL REFERENCES hidden_mickeys(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL,
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'open',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, mickey_id),
  CONSTRAINT chk_mr_reason CHECK (reason IN ('inappropriate','not_a_mickey','restricted_area','spam','other')),
  CONSTRAINT chk_mr_status CHECK (status IN ('open','upheld','dismissed')),
  CONSTRAINT chk_mr_note CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 300)
);
CREATE INDEX IF NOT EXISTS mickey_reports_mickey_idx ON mickey_reports(mickey_id, status);

CREATE TABLE IF NOT EXISTS mickey_submission_bans (
  user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  reason     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_msb_reason CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 300)
);

CREATE TABLE IF NOT EXISTS mickey_experience_aliases (
  alias_experience_id     UUID PRIMARY KEY REFERENCES experiences(id) ON DELETE CASCADE,
  canonical_experience_id UUID NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_mea_distinct CHECK (alias_experience_id <> canonical_experience_id)
);
CREATE INDEX IF NOT EXISTS mickey_aliases_canonical_idx ON mickey_experience_aliases(canonical_experience_id);

COMMIT;
