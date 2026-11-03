BEGIN;

ALTER TABLE park_schedule_signals ADD COLUMN IF NOT EXISTS ll_multipass_available BOOLEAN;
ALTER TABLE park_schedule_signals ADD COLUMN IF NOT EXISTS ll_premier_price_cents INTEGER;
ALTER TABLE park_schedule_signals ADD COLUMN IF NOT EXISTS ll_premier_available BOOLEAN;
ALTER TABLE park_schedule_signals ADD COLUMN IF NOT EXISTS ll_prices_captured_at TIMESTAMPTZ;
ALTER TABLE park_schedule_signals ADD COLUMN IF NOT EXISTS ll_multipass_captured_at TIMESTAMPTZ;
ALTER TABLE park_schedule_signals ADD COLUMN IF NOT EXISTS ll_premier_captured_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS lightning_lane_single_prices (
  park            TEXT NOT NULL,
  date            DATE NOT NULL,
  purchase_id     TEXT NOT NULL,
  experience_id   UUID REFERENCES experiences(id) ON DELETE SET NULL,
  attraction_name TEXT NOT NULL,
  price_cents     INTEGER NOT NULL CHECK (price_cents > 0),
  available       BOOLEAN,
  captured_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (park, date, purchase_id)
);
CREATE INDEX IF NOT EXISTS idx_ll_single_experience_date ON lightning_lane_single_prices (experience_id, date);
CREATE INDEX IF NOT EXISTS idx_ll_single_date ON lightning_lane_single_prices (date);

COMMIT;

