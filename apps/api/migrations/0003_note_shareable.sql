-- Disney World Tracker — Note shareable flag
-- Adds a per-Note shareable flag to the notes table. Every Note is private by
-- default (NOT NULL DEFAULT FALSE), so existing and new Notes disclose nothing
-- until the owner explicitly marks a Note shareable. The Friend Completions
-- read path honors this flag, emitting a Note's body only when shareable and
-- treating a private Note as indistinguishable from no Note at all.
--
-- No index is added: notes are joined by their (user_id, experience_id) primary
-- key, and shareable is a projection filter rather than a lookup key.
--
-- Requirements: 4.6, 4.7 (and the glossary "private by default" invariant).

BEGIN;

ALTER TABLE notes
    ADD COLUMN shareable BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
