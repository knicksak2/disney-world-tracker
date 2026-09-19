-- Disney World Tracker — Curated Ride/Show Durations (R11)
-- Data-only migration: no schema change. `duration_minutes` already exists on
-- `experiences` (0019) but is never written by catalog sync, so the optimizer's
-- flat DEFAULT_RIDE_DUR (15 min) fallback applied to every ride regardless of
-- its real length. Seeds real total-experience durations (ride/show cycle plus
-- any fixed pre-show) for an initial curated set, sourced from public
-- reference material (official Disney statements and published attraction
-- guides). Idempotent on reapply — setting the same value twice is a no-op.
-- Never overwritten by sync (sync.ts does not write duration_minutes),
-- mirroring how CATEGORY_OVERRIDES is consulted independently of raw
-- upstream fields.

BEGIN;

-- Avatar Flight of Passage: ~4.5 min flight + a substantial multi-room pre-show.
UPDATE experiences SET duration_minutes = 12 WHERE upstream_entity_id = '18665186;entityType=Attraction';

-- Na'vi River Journey: ~5 min boat ride, no separate pre-show.
UPDATE experiences SET duration_minutes = 5 WHERE upstream_entity_id = '18665185;entityType=Attraction';

-- Kilimanjaro Safaris: ~18-20 min truck tour, no separate pre-show.
UPDATE experiences SET duration_minutes = 20 WHERE upstream_entity_id = '80010157;entityType=Attraction';

-- Expedition Everest - Legend of the Forbidden Mountain: ~4 min total ride cycle.
UPDATE experiences SET duration_minutes = 4 WHERE upstream_entity_id = '26068;entityType=Attraction';

-- Zootopia: Better Zoogether! - NEW!: ~9 min show.
UPDATE experiences SET duration_minutes = 9 WHERE upstream_entity_id = '412430582;entityType=Attraction';

COMMIT;
