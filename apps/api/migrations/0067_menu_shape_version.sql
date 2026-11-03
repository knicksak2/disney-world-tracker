BEGIN;
ALTER TABLE experience_menus ADD COLUMN IF NOT EXISTS shape_version SMALLINT NOT NULL DEFAULT 1;
UPDATE experience_menus SET shape_version = 1;
COMMIT;

