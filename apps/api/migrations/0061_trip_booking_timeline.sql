BEGIN;

-- Booking_Settings: at most one row per Trip (R2.7, R14.4). Created lazily by the first PATCH.
CREATE TABLE IF NOT EXISTS trip_booking_settings (
  trip_id               UUID PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
  stay_type             VARCHAR(20),
  lightning_lane_timing VARCHAR(20),
  check_in_override     DATE,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_trip_booking_settings_stay_type CHECK (
    stay_type IS NULL OR stay_type IN ('resort', 'partner_hotel', 'offsite')),
  CONSTRAINT chk_trip_booking_settings_ll_timing CHECK (
    lightning_lane_timing IS NULL OR lightning_lane_timing IN ('seven_day', 'three_day', 'three_day_daily'))
);
-- NOTE: no CHECK relates check_in_override to trips.start_date. The range is validated on write (patchBookingSettings, under a Trip row
-- lock) and re-evaluated on every read, because editing the Trip dates later must leave the stored value in place (R2.3, R4.7).

-- Window_Done_Mark: one row per (Trip, Window_Key) (R5, R14.4). Window_Key = window_kind || ':' || drop_on.
CREATE TABLE IF NOT EXISTS trip_booking_window_done (
  trip_id     UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  window_kind VARCHAR(20) NOT NULL,
  drop_on     DATE NOT NULL,
  marked_by   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  marked_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, window_kind, drop_on),
  CONSTRAINT chk_trip_booking_window_done_kind CHECK (window_kind IN ('dining', 'lightning_lane'))
);

-- Reminder_Mute: one row per (Trip, Trip_Member) (R9.8, R14.4). Survives a member leaving; harmless because recipients are
-- selected from trip_memberships, and it simply takes effect again if the user rejoins.
CREATE TABLE IF NOT EXISTS trip_booking_reminder_mutes (
  trip_id    UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, user_id)
);

-- Reminder_Ledger (R9.1, R9.2): the key IS the primary key, so a conflict-ignoring insert is the claim.
CREATE TABLE IF NOT EXISTS trip_booking_reminder_log (
  trip_id       UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  window_kind   VARCHAR(20) NOT NULL,
  drop_at       TIMESTAMPTZ NOT NULL,
  reminder_lead VARCHAR(10) NOT NULL,
  claimed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, window_kind, drop_at, reminder_lead),
  CONSTRAINT chk_trip_booking_reminder_log_kind CHECK (window_kind IN ('dining', 'lightning_lane')),
  CONSTRAINT chk_trip_booking_reminder_log_lead CHECK (reminder_lead IN ('eve', 'open', 'week'))
);
CREATE INDEX IF NOT EXISTS trip_booking_reminder_log_drop_at_idx ON trip_booking_reminder_log (drop_at);

-- Packing_Item (R11). Bounded: ≤ 300 rows per Trip, enforced under a Trip row lock (R11.3).
CREATE TABLE IF NOT EXISTS trip_packing_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id     UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  name        VARCHAR(80) NOT NULL,
  category    VARCHAR(20) NOT NULL,
  quantity    SMALLINT NOT NULL DEFAULT 1,
  assignee_id UUID REFERENCES users(id) ON DELETE SET NULL,   -- a departed member stays stored but is projected as unassigned (R11.9)
  added_by    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  packed      BOOLEAN NOT NULL DEFAULT false,
  packed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  packed_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_trip_packing_items_name CHECK (length(trim(name)) > 0),
  CONSTRAINT chk_trip_packing_items_category CHECK (category IN
    ('documents', 'clothing', 'toiletries', 'health', 'tech', 'park_gear', 'kids', 'other')),
  CONSTRAINT chk_trip_packing_items_quantity CHECK (quantity BETWEEN 1 AND 99),
  CONSTRAINT chk_trip_packing_items_packed_state CHECK (
    (packed = true AND packed_at IS NOT NULL) OR (packed = false AND packed_by IS NULL AND packed_at IS NULL))
);
CREATE INDEX IF NOT EXISTS trip_packing_items_trip_idx ON trip_packing_items (trip_id, created_at);

-- C1: let the Notification_Service log booking-reminder deliveries (R9.10). The constraint is replaced, not edited in place.
ALTER TABLE push_delivery_log DROP CONSTRAINT IF EXISTS push_delivery_log_kind_chk;
ALTER TABLE push_delivery_log ADD CONSTRAINT push_delivery_log_kind_chk CHECK (notification_kind IN (
  'share_delivered', 'friend_request_received', 'trip_invite_created',
  'rode_with_tag_created', 'food_list_shared', 'food_list_role_changed',
  'experience_list_shared', 'experience_list_role_changed',
  'trip_booking_reminder'
));

COMMIT;
