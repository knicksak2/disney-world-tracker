BEGIN;

CREATE TABLE IF NOT EXISTS trip_traveler_profiles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id           UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  member_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  guest_id          UUID REFERENCES trip_guests(id) ON DELETE CASCADE,
  age_bracket       TEXT NOT NULL CHECK (age_bracket IN ('adult', 'child', 'under3')),
  ticket_option     TEXT CHECK (ticket_option IS NULL OR ticket_option IN ('base','park_hopper','park_hopper_plus','water_parks_sports')),
  ticket_days       SMALLINT CHECK (ticket_days IS NULL OR ticket_days BETWEEN 1 AND 10),
  ticket_start_date DATE,
  discount_group    TEXT NOT NULL DEFAULT 'std-gst' CHECK (discount_group IN ('std-gst', 'fl-resident')),
  pass_type         TEXT NOT NULL DEFAULT 'none' CHECK (pass_type IN ('none','annual_pass','dvc','other_discount')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_traveler_person_xor CHECK ((member_id IS NULL) <> (guest_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_traveler_member ON trip_traveler_profiles (trip_id, member_id) WHERE member_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_traveler_guest  ON trip_traveler_profiles (trip_id, guest_id)  WHERE guest_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS trip_budget_lines (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id           UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  created_by        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category          TEXT NOT NULL CHECK (category IN ('tickets','lightning_lane','dining','lodging','transportation','shopping','other')),
  description       VARCHAR(200) NOT NULL CHECK (char_length(btrim(description)) BETWEEN 1 AND 200),
  planned_date      DATE,
  park              TEXT CHECK (park IS NULL OR park IN ('Magic Kingdom','EPCOT','Hollywood Studios','Animal Kingdom','Typhoon Lagoon','Blizzard Beach','Disney Springs')),
  experience_id     UUID REFERENCES experiences(id) ON DELETE SET NULL,
  price_source      TEXT NOT NULL CHECK (price_source IN ('disney_ticket_calendar','disney_menu','themeparks_ll','typical_estimate','user_entered')),
  price_as_of       TIMESTAMPTZ NOT NULL DEFAULT now(),
  price_ref         JSONB,
  apply_tip         BOOLEAN NOT NULL DEFAULT FALSE,
  linked_expense_id UUID REFERENCES expenses(id) ON DELETE SET NULL,
  suggestion_key    TEXT CHECK (suggestion_key IS NULL OR char_length(suggestion_key) <= 120),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_budget_lines_trip ON trip_budget_lines (trip_id, planned_date);
CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_lines_suggestion ON trip_budget_lines (trip_id, suggestion_key) WHERE suggestion_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS trip_budget_allocations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id      UUID NOT NULL REFERENCES trip_budget_lines(id) ON DELETE CASCADE,
  member_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  guest_id     UUID REFERENCES trip_guests(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0 AND amount_cents <= 10000000),
  price_ref    JSONB,
  CONSTRAINT chk_budget_alloc_person_xor CHECK ((member_id IS NULL) <> (guest_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_alloc_member ON trip_budget_allocations (line_id, member_id) WHERE member_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_alloc_guest  ON trip_budget_allocations (line_id, guest_id)  WHERE guest_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS trip_budget_settings (
  trip_id              UUID PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
  tax_bps              JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(tax_bps) = 'object'),
  dining_tip_bps       INTEGER CHECK (dining_tip_bps IS NULL OR dining_tip_bps BETWEEN 0 AND 5000),
  saved_cents          INTEGER NOT NULL DEFAULT 0 CHECK (saved_cents BETWEEN 0 AND 1000000000),
  savings_target_cents INTEGER CHECK (savings_target_cents IS NULL OR savings_target_cents BETWEEN 0 AND 1000000000),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trip_budget_dismissed_suggestions (
  trip_id        UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  suggestion_key TEXT NOT NULL CHECK (char_length(suggestion_key) <= 120),
  dismissed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, suggestion_key)
);

COMMIT;

