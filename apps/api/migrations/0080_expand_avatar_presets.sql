-- Replace trademarked mouse-ear avatar presets and expand catalog to 24 presets.
--
-- 1. Drop profiles_avatar_preset_chk so existing rows using retired ids can be
--    migrated cleanly before enforcing the new allowlist.
-- 2. Migrate any existing profiles referencing 'ear-balloon' -> 'pretzel' and
--    'ice-cream-bar' -> 'pineapple-whip'.
-- 3. Re-add profiles_avatar_preset_chk with the 24 ids matching
--    packages/shared/src/constants/avatarPresets.ts (AVATAR_PRESET_IDS).
--
-- Idempotent on reapply: DROP CONSTRAINT IF EXISTS + UPDATE + ADD CONSTRAINT.

BEGIN;

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_avatar_preset_chk;

UPDATE profiles SET avatar_preset = 'pretzel' WHERE avatar_preset = 'ear-balloon';
UPDATE profiles SET avatar_preset = 'pineapple-whip' WHERE avatar_preset = 'ice-cream-bar';

ALTER TABLE profiles ADD CONSTRAINT profiles_avatar_preset_chk
    CHECK (avatar_preset IS NULL OR avatar_preset IN (
        'castle',
        'wishing-star',
        'fireworks',
        'magic-wand',
        'royal-crown',
        'crystal-ball',
        'enchanted-rose',
        'sky-lantern',
        'roller-coaster',
        'ferris-wheel',
        'teacup',
        'carousel',
        'pirate-ship',
        'steam-train',
        'monorail',
        'hot-air-balloon',
        'rocket-ship',
        'safari-lion',
        'sea-turtle',
        'tropical-hibiscus',
        'pineapple-whip',
        'pretzel',
        'popcorn',
        'turkey-leg'
    ));

COMMIT;
