BEGIN;

-- Migration 0063_trip_photos.sql
-- Trip photos: add 'member_post' to trip_feed_items, foreign key fk_photos_feed_item,
-- and widen shares payload_kind and experience checks for 'tripSummary' pointer shares.

-- 1. Widen trip_feed_items type to add 'member_post'
ALTER TABLE trip_feed_items DROP CONSTRAINT IF EXISTS trip_feed_items_type_chk;
ALTER TABLE trip_feed_items ADD CONSTRAINT trip_feed_items_type_chk CHECK (type IN (
  'trip_created','member_joined','completion_logged','rating_recorded','member_post'
));

-- 2. Foreign key from photos.feed_item_id to trip_feed_items(id) ON DELETE SET NULL
ALTER TABLE photos DROP CONSTRAINT IF EXISTS fk_photos_feed_item;
ALTER TABLE photos ADD CONSTRAINT fk_photos_feed_item FOREIGN KEY (feed_item_id) REFERENCES trip_feed_items(id) ON DELETE SET NULL;

-- 3. Sharing: tripSummary payload kind (pointer payload; no new shares column, no revoke column)
ALTER TABLE shares DROP CONSTRAINT IF EXISTS shares_payload_kind_chk;
ALTER TABLE shares ADD CONSTRAINT shares_payload_kind_chk CHECK (payload_kind IN ('experience','progress','pinShowcase','tripSummary'));

ALTER TABLE shares DROP CONSTRAINT IF EXISTS shares_experience_payload_chk;
ALTER TABLE shares ADD CONSTRAINT shares_experience_payload_chk CHECK (
  (payload_kind = 'experience' AND experience_id IS NOT NULL)
  OR (payload_kind IN ('progress','pinShowcase','tripSummary') AND experience_id IS NULL)
);

COMMIT;
