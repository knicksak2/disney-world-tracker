-- Feature: unified-dining-logging (Task 2.2)
-- Backfills missing experience_logs and completions rows for historical
-- food_item_logs scoped to catalog Restaurant_Experiences (Requirement 5.1-5.4).

BEGIN;

-- 1. For every distinct (user_id, experience_id, visited_on) present in
--    food_item_logs (via food_items) where no experience_logs row exists on
--    that date, insert one unrated experience_logs row.
INSERT INTO experience_logs (user_id, experience_id, visited_on, user_tz, logged_at, rating, note)
SELECT
    fil.user_id,
    fi.experience_id,
    fil.visited_on,
    MIN(fil.user_tz) AS user_tz,
    MIN(fil.logged_at) AS logged_at,
    NULL AS rating,
    NULL AS note
FROM food_item_logs fil
JOIN food_items fi ON fi.id = fil.food_item_id
LEFT JOIN experience_logs el
  ON el.user_id = fil.user_id
 AND el.experience_id = fi.experience_id
 AND el.visited_on = fil.visited_on
WHERE fi.experience_id IS NOT NULL
  AND el.id IS NULL
GROUP BY fil.user_id, fi.experience_id, fil.visited_on;

-- 2. Ensure a canonical completions row exists for every (user_id, experience_id)
--    that has a food_item_log at a catalog restaurant.
INSERT INTO completions (user_id, experience_id, completed_on, user_tz)
SELECT
    fil.user_id,
    fi.experience_id,
    MIN(fil.visited_on) AS completed_on,
    MIN(fil.user_tz) AS user_tz
FROM food_item_logs fil
JOIN food_items fi ON fi.id = fil.food_item_id
WHERE fi.experience_id IS NOT NULL
GROUP BY fil.user_id, fi.experience_id
ON CONFLICT (user_id, experience_id) DO NOTHING;

COMMIT;
