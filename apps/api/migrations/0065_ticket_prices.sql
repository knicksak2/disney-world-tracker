BEGIN;

CREATE TABLE IF NOT EXISTS ticket_prices (
  discount_group TEXT     NOT NULL CHECK (discount_group IN ('std-gst', 'fl-resident')),
  num_days       SMALLINT NOT NULL CHECK (num_days BETWEEN 1 AND 10),
  age_group      TEXT     NOT NULL CHECK (age_group IN ('adult', 'child')),
  option_code    TEXT     NOT NULL CHECK (option_code IN ('base', 'park_hopper', 'park_hopper_plus', 'water_parks_sports')),
  park           TEXT     NOT NULL DEFAULT 'any' CHECK (park IN ('any', 'mk', 'ep', 'hs', 'ak')),
  start_date     DATE     NOT NULL,
  price_cents    INTEGER  NOT NULL CHECK (price_cents > 0),
  tax_cents      INTEGER  NOT NULL CHECK (tax_cents >= 0),
  valid_end_date DATE     NOT NULL,
  product_id     TEXT     NOT NULL,
  changed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (discount_group, num_days, age_group, option_code, park, start_date)
);

CREATE TABLE IF NOT EXISTS ticket_price_sets (
  discount_group  TEXT     NOT NULL CHECK (discount_group IN ('std-gst', 'fl-resident')),
  num_days        SMALLINT NOT NULL CHECK (num_days BETWEEN 1 AND 10),
  as_of           TIMESTAMPTZ,
  horizon_date    DATE,
  row_count       INTEGER CHECK (row_count IS NULL OR row_count >= 0),
  window_days     SMALLINT CHECK (window_days IS NULL OR window_days > 0),
  last_attempt_at TIMESTAMPTZ,
  last_error      TEXT,
  blocked_until   TIMESTAMPTZ,
  PRIMARY KEY (discount_group, num_days)
);

-- One-row global control: cooldown, probe time, in-progress claim, WAF block.
CREATE TABLE IF NOT EXISTS ticket_price_control (
  id                    SMALLINT PRIMARY KEY CHECK (id = 1),
  last_attempt_at       TIMESTAMPTZ,
  last_probe_at         TIMESTAMPTZ,
  blocked_until         TIMESTAMPTZ,
  in_progress_since     TIMESTAMPTZ,
  observed_horizon_date DATE,
  last_diagnose_at      TIMESTAMPTZ,
  last_status           TEXT,
  last_error            TEXT,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO ticket_price_control (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

COMMIT;

