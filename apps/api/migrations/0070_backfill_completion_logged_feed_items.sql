BEGIN;
INSERT INTO trip_feed_items (trip_id, type, actor_id, metadata, created_at)
SELECT tle.trip_id,
       'completion_logged',
       tle.member_id,
       jsonb_build_object('experienceId', tle.experience_id::text, 'logEntryId', tle.id::text),
       tle.created_at
  FROM trip_log_entries tle
 WHERE NOT EXISTS (
         SELECT 1 FROM trip_feed_items fi
          WHERE fi.type = 'completion_logged'
            AND fi.metadata->>'logEntryId' = tle.id::text);
COMMIT;

