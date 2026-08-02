-- Disney World Tracker — drop the rode_with_confirmed Trip_Feed_Item
-- Confirming a Rode_With_Tag no longer produces its own Trip_Feed_Item: the
-- originating `completion_logged` entry already records that these Members rode
-- together, so a separate "confirmed riding along" entry was redundant noise in
-- the Trip_Feed (R11.10).
--
-- This migration:
--   1. removes any Trip_Reactions and Trip_Comments that target an existing
--      rode_with_confirmed feed item (they have no ON DELETE cascade — the
--      engagement tables reference feed items only by (target_type, target_id),
--      not by foreign key — so they must be cleared explicitly first);
--   2. deletes the existing rode_with_confirmed feed items themselves;
--   3. tightens the trip_feed_items type check constraint so the type can no
--      longer be written.
--
-- Mirrors the BEGIN/COMMIT + inline-comment conventions of the earlier
-- migrations (0015_trips.sql, 0017_rode_with_pending_read.sql).
--
-- Requirements covered:
--   R11.10 — confirming a pending Rode_With_Tag sets it `confirmed` and writes
--            no Trip_Feed_Item.

BEGIN;

-- 1. Clear engagement on the doomed feed items (no FK cascade covers these).
DELETE FROM trip_reactions
 WHERE target_type = 'feed_item'
   AND target_id IN (
       SELECT id FROM trip_feed_items WHERE type = 'rode_with_confirmed'
   );

DELETE FROM trip_comments
 WHERE target_type = 'feed_item'
   AND target_id IN (
       SELECT id FROM trip_feed_items WHERE type = 'rode_with_confirmed'
   );

-- 2. Remove the redundant confirm feed items.
DELETE FROM trip_feed_items WHERE type = 'rode_with_confirmed';

-- 3. Tighten the type check so the retired type can no longer be written.
ALTER TABLE trip_feed_items DROP CONSTRAINT trip_feed_items_type_chk;
ALTER TABLE trip_feed_items ADD CONSTRAINT trip_feed_items_type_chk CHECK (type IN (
    'trip_created','member_joined','completion_logged','rating_recorded'
));

COMMIT;
