-- Disney World Tracker: Dining Plan Calculator (dining-plan-calculator spec, Requirement 17).
--
-- Five tables:
--   - dining_plan_prices          plan price periods (global, edited in the Admin_Panel), seeded below;
--   - dining_plan_location_rules  per-restaurant credit rules (global, edited in the Admin_Panel, seeded by an admin action);
--   - dining_plan_config          a singleton row of tunable defaults (missing keys fall back to DINING_CONFIG_DEFAULTS);
--   - trip_dining_plan_scenarios  one settings row per Trip;
--   - trip_dining_plan_entries    at most one meal per (Trip, date, meal period).
--
-- pg-mem compatibility (this file runs under accountDeletion/__tests__/helpers.ts buildMigratedDb, which applies every
-- migration): only functions that helper registers (jsonb_typeof, char_length, btrim), no NULLS LAST inside an index, and
-- no non-unique partial index (pg-mem would hide rows whose indexed column is NULL from unpredicated selects). The one
-- partial index here is UNIQUE (uq_dpe_planned_item) and is never an ON CONFLICT target. Limits SQL cannot express
-- portably are enforced in the application: at most 50 excluded keys (Zod + repo, no jsonb_array_length), the keys and
-- values of credit_cost_by_period (Zod + repo), no overlap between two price periods of one plan (repo + Admin_Panel).
--
-- Person keys in settings (alcoholDrinkerKeys) and excluded_keys are plain text with no reference to a user account;
-- they are listed in SOFT_REFERENCES (accountDeletion/dispositions.ts) and are inert once the person leaves the Party.

BEGIN;

CREATE TABLE IF NOT EXISTS dining_plan_prices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_code         TEXT NOT NULL CHECK (plan_code IN ('quick_service','table_service','deluxe')),
  display_name      VARCHAR(80) NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 80),
  valid_from        DATE NOT NULL,
  valid_to          DATE NOT NULL,
  adult_cents       INTEGER NOT NULL CHECK (adult_cents BETWEEN 1 AND 100000),
  child_cents       INTEGER NOT NULL CHECK (child_cents BETWEEN 0 AND 100000),
  child_promo_cents INTEGER CHECK (child_promo_cents IS NULL OR child_promo_cents BETWEEN 0 AND 100000),
  promo_label       VARCHAR(80),
  source_note       VARCHAR(200),
  verified_at       DATE,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_dining_plan_prices_range CHECK (valid_to >= valid_from),
  CONSTRAINT chk_dining_plan_prices_promo CHECK (child_promo_cents IS NULL OR promo_label IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dining_plan_prices_start ON dining_plan_prices (plan_code, valid_from);

CREATE TABLE IF NOT EXISTS dining_plan_location_rules (
  experience_id          UUID PRIMARY KEY REFERENCES experiences(id) ON DELETE CASCADE,
  service_type           TEXT CHECK (service_type IS NULL OR service_type IN ('table_service','quick_service','snack_only','not_eligible')),
  credit_cost            SMALLINT NOT NULL DEFAULT 1 CHECK (credit_cost IN (1, 2)),
  -- {"dinner": 2}; keys breakfast|lunch|dinner and values 1|2 are enforced by Zod and the repo
  credit_cost_by_period  JSONB CHECK (credit_cost_by_period IS NULL OR jsonb_typeof(credit_cost_by_period) = 'object'),
  gratuity_included      BOOLEAN NOT NULL DEFAULT FALSE,
  pass_discount_eligible BOOLEAN,
  per_person_adult_cents INTEGER CHECK (per_person_adult_cents IS NULL OR per_person_adult_cents BETWEEN 1 AND 100000),
  per_person_child_cents INTEGER CHECK (per_person_child_cents IS NULL OR per_person_child_cents BETWEEN 1 AND 100000),
  rule_status            TEXT NOT NULL DEFAULT 'unverified' CHECK (rule_status IN ('verified','unverified')),
  verified_at            DATE,
  source_note            VARCHAR(200),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- `service_type IS NOT NULL AND ...`: with a NULL ("derive") service type the plain comparison is NULL, which a CHECK
  -- treats as passing, so a two-credit rule on a location that derives as quick-service would slip through.
  CONSTRAINT chk_dpl_credit_cost CHECK (credit_cost = 1 OR (service_type IS NOT NULL AND service_type = 'table_service')),
  CONSTRAINT chk_dpl_gratuity    CHECK (NOT gratuity_included OR (service_type IS NOT NULL AND service_type = 'table_service')),
  CONSTRAINT chk_dpl_period_cost CHECK (credit_cost_by_period IS NULL OR (service_type IS NOT NULL AND service_type = 'table_service')),
  CONSTRAINT chk_dpl_verified    CHECK (rule_status <> 'verified' OR verified_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS dining_plan_config (
  id         SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  config     JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO dining_plan_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS trip_dining_plan_scenarios (
  trip_id    UUID PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
  settings   JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trip_dining_plan_entries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id          UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  entry_date       DATE NOT NULL,
  meal_period      TEXT NOT NULL CHECK (meal_period IN ('breakfast','lunch','dinner')),
  kind             TEXT NOT NULL CHECK (kind IN ('restaurant','placeholder','skip')),
  experience_id    UUID REFERENCES experiences(id) ON DELETE CASCADE,
  placeholder_kind TEXT CHECK (placeholder_kind IS NULL OR placeholder_kind IN ('quick_service','table_service')),
  planned_item_id  UUID REFERENCES planned_items(id) ON DELETE SET NULL,
  -- the 50-key limit is enforced by Zod and the repo
  excluded_keys    JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(excluded_keys) = 'array'),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_dpe_shape CHECK (
    (kind = 'restaurant'  AND experience_id IS NOT NULL AND placeholder_kind IS NULL) OR
    (kind = 'placeholder' AND experience_id IS NULL AND placeholder_kind IS NOT NULL) OR
    (kind = 'skip'        AND experience_id IS NULL AND placeholder_kind IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dpe_slot ON trip_dining_plan_entries (trip_id, entry_date, meal_period);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dpe_planned_item ON trip_dining_plan_entries (trip_id, planned_item_id) WHERE planned_item_id IS NOT NULL;
-- plain index: a non-unique partial index would make pg-mem hide NULL rows
CREATE INDEX IF NOT EXISTS idx_dpe_planned_item ON trip_dining_plan_entries (planned_item_id);

-- Seed price periods (design.md Configuration & Constants): 2026 adult prices from Disney's Q&A, every child and 2027
-- price from third parties, so verified_at stays NULL until the operator confirms each row. Re-applying inserts nothing.
INSERT INTO dining_plan_prices
  (plan_code, display_name, valid_from, valid_to, adult_cents, child_cents, child_promo_cents, promo_label, source_note, verified_at)
VALUES
  ('quick_service', 'Disney Quick-Service Dining Plan', '2026-01-01', '2026-12-31', 6047, 2616, 0, 'Kids Eat Free 2026', 'Adult: plandisney.disney.go.com Q&A. Child and promotion: Pixie Vacations (2026-11). Verify.', NULL),
  ('table_service', 'Disney Dining Plan', '2026-01-01', '2026-12-31', 9859, 3194, 0, 'Kids Eat Free 2026', 'Adult: plandisney.disney.go.com Q&A. Child and promotion: Pixie Vacations (2026-11). Verify.', NULL),
  ('quick_service', 'Quick-Service Dining Plan', '2027-01-01', '2027-12-31', 6278, 2582, NULL, NULL, 'Pixie Vacations citing TouringPlans and AllEars (2026-11). Verify.', NULL),
  ('table_service', 'Table-Service Dining Plan', '2027-01-01', '2027-12-31', 9987, 3194, NULL, NULL, 'Pixie Vacations citing TouringPlans and AllEars (2026-11). Verify.', NULL),
  ('deluxe', 'Deluxe Table-Service Dining Plan', '2027-01-01', '2027-12-31', 16301, 4685, NULL, NULL, 'Pixie Vacations citing TouringPlans (2026-11). Verify.', NULL)
ON CONFLICT (plan_code, valid_from) DO NOTHING;

COMMIT;
