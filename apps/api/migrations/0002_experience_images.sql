-- Disney World Tracker — Experience images
-- Adds optional image fields to the experiences cache. Images are sourced
-- OUT OF BAND from the ThemeParks.wiki catalog sync (that upstream exposes no
-- imagery), so these columns are intentionally NOT written by
-- `applyReconciliation`: the sync's `INSERT ... ON CONFLICT (id) DO UPDATE`
-- leaves image_url / image_attribution untouched, which means a curated image
-- survives every subsequent catalog refresh. A new upstream entity arrives
-- with image_url = NULL and is enriched later by the image-sourcing job.
--
-- Requirements: image display for catalog Experiences (browse + detail view).

BEGIN;

ALTER TABLE experiences
    ADD COLUMN image_url         TEXT,
    ADD COLUMN image_attribution TEXT;

-- Guard against unbounded values. URLs and attribution strings are short in
-- practice; the cap is generous but prevents an enrichment bug from writing
-- megabytes into the row.
ALTER TABLE experiences
    ADD CONSTRAINT experiences_image_url_length_chk
        CHECK (image_url IS NULL OR char_length(image_url) BETWEEN 1 AND 2048),
    ADD CONSTRAINT experiences_image_attribution_length_chk
        CHECK (image_attribution IS NULL OR char_length(image_attribution) BETWEEN 1 AND 1000);

COMMIT;
