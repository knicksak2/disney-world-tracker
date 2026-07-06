-- Disney World Tracker — switch Profile avatars from uploaded images to a
-- fixed set of bundled, client-rendered preset illustrations.
--
-- Motivation: avatars are no longer user-uploaded PNG/JPEG bytes stored in an
-- S3-compatible bucket. Instead the client renders one of a fixed set of
-- original Disney-themed SVG illustrations, referenced by a stable preset id.
-- The Profile therefore stores the chosen id (or NULL for "no avatar"), and
-- the object-storage columns are removed entirely.
--
-- Clean break: no production Profiles have avatars yet, so the old columns are
-- dropped outright rather than migrated. If any avatar_url values existed they
-- would be discarded here.
--
-- The allowlist in the CHECK constraint MUST stay in sync with
-- `packages/shared/src/constants/avatarPresets.ts` (AVATAR_PRESET_IDS).

BEGIN;

-- Drop the upload-era constraints first so the columns can be removed.
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_avatar_size_chk;
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_avatar_mime_chk;

-- Remove the object-storage columns (avatar bytes now live client-side).
ALTER TABLE profiles DROP COLUMN IF EXISTS avatar_url;
ALTER TABLE profiles DROP COLUMN IF EXISTS avatar_mime;
ALTER TABLE profiles DROP COLUMN IF EXISTS avatar_size_bytes;

-- Add the preset-id column. NULL means "no avatar chosen" (renders the
-- placeholder). Non-NULL values are constrained to the known preset ids so the
-- database never holds an id the client cannot render.
ALTER TABLE profiles ADD COLUMN avatar_preset TEXT;

ALTER TABLE profiles ADD CONSTRAINT profiles_avatar_preset_chk
    CHECK (avatar_preset IS NULL OR avatar_preset IN (
        'castle',
        'wishing-star',
        'ear-balloon',
        'fireworks',
        'magic-wand',
        'teacup',
        'carousel',
        'hot-air-balloon',
        'popcorn',
        'monorail',
        'turkey-leg',
        'ice-cream-bar'
    ));

COMMIT;
