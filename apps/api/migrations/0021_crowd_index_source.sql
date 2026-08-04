BEGIN;

ALTER TABLE park_crowd_index 
ADD COLUMN source TEXT NOT NULL DEFAULT 'observed' 
CHECK (source IN ('observed', 'seed'));

COMMIT;
