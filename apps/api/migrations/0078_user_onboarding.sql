-- First-run onboarding & starter-checklist state per user (first-run-onboarding spec).
-- Idempotent, additive, no data backfill (grandfathering happens on first GET /me/onboarding).

BEGIN;

CREATE TABLE IF NOT EXISTS user_onboarding (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NULL,
  skipped_at TIMESTAMPTZ NULL,
  grandfathered_at TIMESTAMPTZ NULL,
  initial_intent TEXT NULL,
  selected_park TEXT NULL,
  starter_checklist_dismissed_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_user_onboarding_intent CHECK (
    initial_intent IS NULL
    OR initial_intent IN ('plan', 'in_park', 'track_history', 'explore')
  ),
  CONSTRAINT chk_user_onboarding_park CHECK (
    selected_park IS NULL
    OR selected_park IN ('Magic Kingdom', 'EPCOT', 'Hollywood Studios', 'Animal Kingdom')
  )
);

COMMIT;
