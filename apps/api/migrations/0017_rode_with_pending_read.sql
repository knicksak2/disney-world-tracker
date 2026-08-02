-- Disney World Tracker — Rode-With pending read support migration
-- Backs the new GET /me/rode-with-tags?state=pending read, which lists a
-- Tagged_Member's pending rode-with tags ordered by creation time so the
-- Notification_Center can aggregate them the same way it aggregates the other
-- domains.
--
-- Strictly additive: it adds one partial index and touches no data. The tags
-- themselves, their columns, and the existing rode_with_tags_tagged_member_idx
-- (created by 0015_trips.sql) are all left in place.
--
-- Mirrors the BEGIN/COMMIT + inline-comment conventions of the earlier
-- migrations (0015_trips.sql, 0016_trip_resorts.sql).
--
-- Requirements covered:
--   R3.1 — the pending read is scoped to the Tagged_Member, filtered to
--          state = 'pending', and ordered by created_at DESC
--   R3.2 — the read is scoped to the authenticated user as the Tagged_Member

BEGIN;

-- rode_with_tags_pending_by_member_idx: a partial index supporting the pending
-- read (GET /me/rode-with-tags?state=pending). It covers the exact access
-- pattern — scoped to the Tagged_Member (tagged_member_id), ordered by
-- created_at DESC, and filtered to the pending subset via the WHERE clause
-- (R3.1, R3.2). Purely additive; the existing rode_with_tags_tagged_member_idx
-- remains untouched.
CREATE INDEX rode_with_tags_pending_by_member_idx
    ON rode_with_tags (tagged_member_id, created_at DESC)
    WHERE state = 'pending';

COMMIT;
