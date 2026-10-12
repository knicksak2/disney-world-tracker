BEGIN;

-- Trip_Guest: a non-account companion, sponsored by a Trip_Member (R2).
CREATE TABLE IF NOT EXISTS trip_guests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id           UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  sponsor_member_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              VARCHAR(100) NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_trip_guests_name_nonempty CHECK (length(trim(name)) > 0)
);
CREATE INDEX IF NOT EXISTS trip_guests_trip_idx ON trip_guests (trip_id);

-- Expense: one real-world payment (R1).
CREATE TABLE IF NOT EXISTS expenses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id         UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  payer_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents    BIGINT NOT NULL,
  description     VARCHAR(200) NOT NULL,
  expense_date    DATE NOT NULL,
  category        VARCHAR(20),
  split_mode      VARCHAR(20) NOT NULL,
  experience_id   UUID REFERENCES experiences(id),
  resort_id       UUID REFERENCES resorts(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_expenses_amount CHECK (amount_cents > 0 AND amount_cents <= 10000000),
  CONSTRAINT chk_expenses_description_nonempty CHECK (length(trim(description)) > 0),
  CONSTRAINT chk_expenses_category CHECK (category IS NULL OR category IN
    ('hotel', 'tickets', 'dining', 'shopping', 'transportation', 'other')),
  CONSTRAINT chk_expenses_split_mode CHECK (split_mode IN ('exact', 'even', 'tiered', 'itemized'))
);
CREATE INDEX IF NOT EXISTS expenses_trip_idx ON expenses (trip_id, expense_date);
CREATE INDEX IF NOT EXISTS expenses_trip_payer_idx ON expenses (trip_id, payer_id);

-- Expense_Share: amount one Trip_Member/Trip_Guest owes the Payer (R2, R3, R4, R5).
-- Exactly one of member_id / guest_id is set (R2.5's "name either").
CREATE TABLE IF NOT EXISTS expense_shares (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id   UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  member_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  guest_id     UUID REFERENCES trip_guests(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL,
  CONSTRAINT chk_expense_shares_amount CHECK (amount_cents > 0),
  CONSTRAINT chk_expense_shares_one_recipient CHECK (
    (member_id IS NOT NULL AND guest_id IS NULL) OR
    (member_id IS NULL AND guest_id IS NOT NULL)
  ),
  CONSTRAINT uq_expense_shares_recipient UNIQUE (expense_id, member_id, guest_id)
);
CREATE INDEX IF NOT EXISTS expense_shares_expense_idx ON expense_shares (expense_id);

-- Expense_Tier: a named per-unit price scoped to one tiered Expense (R4).
CREATE TABLE IF NOT EXISTS expense_tiers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id    UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  tier_name     VARCHAR(40) NOT NULL,
  price_cents   BIGINT NOT NULL,
  CONSTRAINT chk_expense_tiers_price CHECK (price_cents > 0),
  CONSTRAINT chk_expense_tiers_name_nonempty CHECK (length(trim(tier_name)) > 0)
);
CREATE INDEX IF NOT EXISTS expense_tiers_expense_idx ON expense_tiers (expense_id);

-- Expense_Tier_Count: how many units of a tier one recipient covers (R4.2).
CREATE TABLE IF NOT EXISTS expense_tier_counts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_id     UUID NOT NULL REFERENCES expense_tiers(id) ON DELETE CASCADE,
  member_id   UUID REFERENCES users(id) ON DELETE CASCADE,
  guest_id    UUID REFERENCES trip_guests(id) ON DELETE CASCADE,
  unit_count  INTEGER NOT NULL,
  CONSTRAINT chk_expense_tier_counts_count CHECK (unit_count >= 1),
  CONSTRAINT chk_expense_tier_counts_one_recipient CHECK (
    (member_id IS NOT NULL AND guest_id IS NULL) OR
    (member_id IS NULL AND guest_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS expense_tier_counts_tier_idx ON expense_tier_counts (tier_id);

-- Expense_Item: one itemized receipt line (R5).
CREATE TABLE IF NOT EXISTS expense_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id    UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  item_name     VARCHAR(100) NOT NULL,
  price_cents   BIGINT NOT NULL,
  is_alcohol    BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT chk_expense_items_price CHECK (price_cents > 0),
  CONSTRAINT chk_expense_items_name_nonempty CHECK (length(trim(item_name)) > 0)
);
CREATE INDEX IF NOT EXISTS expense_items_expense_idx ON expense_items (expense_id);

-- Expense_Item_Assignee: the Assignee_Set of one Expense_Item (R5.2).
CREATE TABLE IF NOT EXISTS expense_item_assignees (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id     UUID NOT NULL REFERENCES expense_items(id) ON DELETE CASCADE,
  member_id   UUID REFERENCES users(id) ON DELETE CASCADE,
  guest_id    UUID REFERENCES trip_guests(id) ON DELETE CASCADE,
  CONSTRAINT chk_expense_item_assignees_one_recipient CHECK (
    (member_id IS NOT NULL AND guest_id IS NULL) OR
    (member_id IS NULL AND guest_id IS NOT NULL)
  ),
  CONSTRAINT uq_expense_item_assignees UNIQUE (item_id, member_id, guest_id)
);
CREATE INDEX IF NOT EXISTS expense_item_assignees_item_idx ON expense_item_assignees (item_id);

-- Charge_Line: a tax/gratuity/fee/discount adjustment on an itemized Expense (R5.8-5.12, R14).
CREATE TABLE IF NOT EXISTS charge_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id      UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  kind            VARCHAR(20) NOT NULL,
  amount_cents    BIGINT NOT NULL,
  exclude_alcohol BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT chk_charge_lines_kind CHECK (kind IN ('tax', 'gratuity', 'fee', 'discount')),
  CONSTRAINT chk_charge_lines_sign CHECK (
    (kind = 'discount' AND amount_cents < 0) OR
    (kind != 'discount' AND amount_cents > 0)
  )
);
CREATE INDEX IF NOT EXISTS charge_lines_expense_idx ON charge_lines (expense_id);

-- Charge_Line_Scope: explicit Expense_Item subset a Charge_Line is scoped to (R5.11). Absent rows = whole-expense scope.
CREATE TABLE IF NOT EXISTS charge_line_scopes (
  charge_line_id UUID NOT NULL REFERENCES charge_lines(id) ON DELETE CASCADE,
  item_id        UUID NOT NULL REFERENCES expense_items(id) ON DELETE CASCADE,
  PRIMARY KEY (charge_line_id, item_id)
);

-- Refund: a reduction in what a Payer actually ended up owed (R12).
CREATE TABLE IF NOT EXISTS expense_refunds (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id   UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  created_by   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL,
  refund_date  DATE NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_expense_refunds_amount CHECK (amount_cents > 0)
);
CREATE INDEX IF NOT EXISTS expense_refunds_expense_idx ON expense_refunds (expense_id);

-- Settlement: a recorded real-world repayment between two Trip_Members (R7).
CREATE TABLE IF NOT EXISTS settlements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id       UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  payer_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents  BIGINT NOT NULL,
  settled_date  DATE NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_settlements_amount CHECK (amount_cents > 0 AND amount_cents <= 10000000),
  CONSTRAINT chk_settlements_distinct_parties CHECK (payer_id != recipient_id)
);
CREATE INDEX IF NOT EXISTS settlements_trip_idx ON settlements (trip_id, settled_date);

COMMIT;
