-- ===========================================================================
-- 0043_food_item_log_history_index.sql
-- ---------------------------------------------------------------------------
-- Food Item Logging (Feature: food-item-logging R8, R9).
--
-- Adds index on food_item_logs (user_id, visited_on DESC, logged_at DESC)
-- to optimize cross-item food log history retrieval for a user.
-- Existing index food_item_logs_user_item_idx remains untouched.
--
-- Strictly additive: creates one index.
-- ===========================================================================

BEGIN;

CREATE INDEX food_item_logs_user_idx
    ON food_item_logs(user_id, visited_on DESC, logged_at DESC);

COMMIT;
