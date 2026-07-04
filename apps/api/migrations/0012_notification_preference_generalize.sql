-- Disney World Tracker — generalize the notification preference
-- Renames notification_preferences.share_notifications_enabled to
-- push_notifications_enabled. The preference is now a single master toggle
-- governing ALL push notifications (Share deliveries AND friend requests)
-- rather than Share notifications only.
--
-- Strictly a column rename: the existing stored values (and the NOT NULL
-- DEFAULT TRUE semantics) carry over unchanged, so a User who had disabled
-- share notifications remains opted out of all push, and everyone else stays
-- opted in. No data migration is required.
--
-- Mirrors the BEGIN/COMMIT + inline-comment conventions of the earlier
-- migrations (0001_init.sql, 0011_social_sharing_loop.sql).

BEGIN;

ALTER TABLE notification_preferences
    RENAME COLUMN share_notifications_enabled TO push_notifications_enabled;

COMMIT;
