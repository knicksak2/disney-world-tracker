/**
 * Navigation & Live Waits constants.
 */

/**
 * The wait-minutes threshold at or below which an experience is considered a "walk-on".
 * (Requirement 10.4, Configuration & Constants)
 */
export const WALK_ON_THRESHOLD_MINUTES = 25;

/**
 * The maximum number of accepted friends displayed inline on YouAndCrewScreen
 * before capping and offering an expand/collapse toggle.
 * (Requirement 7.7, Configuration & Constants)
 */
export const MAX_INLINE_FRIENDS = 3;

/**
 * Curated, hand-maintained allowlist of marquee ("headliner") attraction
 * stable internal `id`s (NOT the Disney `upstream_entity_id`/Enterprise_Id —
 * `ExperienceDTO` never carries that field over the wire), used by the Live
 * Waits screen's "Headliners" filter.
 *
 * **Supersedes `HEADLINER_THRILL_FACET_VALUES` (Requirement 10.5a, Task 1.5).**
 * The original definition matched any Experience whose `groupedFacets.thrillFactor`
 * contained `'thrill-rides'` or `'big-drops'`. A live-data audit against the
 * synced catalog found that definition measures sensory thrill intensity, not
 * marquee/must-do status, and the two diverge badly: most Typhoon
 * Lagoon/Blizzard Beach water slides (Humunga Kowabunga, Keelhaul Falls,
 * Gangplank Falls, Mayday Falls, Runoff Rapids, Snow Stormers, Teamboat
 * Springs, Toboggan Racers, Downhill Double Dipper, Crush 'n' Gusher, etc.)
 * carry `thrill-rides` and were false positives, while Haunted Mansion,
 * Pirates of the Caribbean, Frozen Ever After, and other unambiguous
 * headliners carry only `slow-rides`/`dark` and were false negatives.
 *
 * Curated per park (confirmed against the synced catalog, Task 1.5) by
 * cross-referencing the `ride_shapes.baseline_wait_minutes` ranking against
 * Disney's published Lightning Lane Multi Pass Tier 1 / Single Pass attraction
 * lists — not a threshold or facet comparison. Following the same
 * hand-maintained-list discipline as `catalog-taxonomy-cleanup`'s
 * `Category_Overrides`: re-derive and add an entry whenever a new attraction
 * opens or an existing one is reclassified; never guess.
 */
export const HEADLINER_EXPERIENCE_IDS: readonly string[] = [
  // --- Magic Kingdom (9) ---
  'a3c65e57-5cca-5cee-9248-b171096d5444', // TRON Lightcycle / Run
  'fd106d67-0279-5eca-9d55-77cc4775f16e', // Space Mountain
  'cda9fbbe-ac31-51f4-ac1a-14d27058cc8d', // Seven Dwarfs Mine Train
  '6df02a83-b046-539d-bf29-dadaa2453813', // Big Thunder Mountain Railroad
  '79320530-1bd3-5642-89c2-0303c2aaa2ca', // Tiana's Bayou Adventure
  'abd15f18-fcc7-528a-919b-f1e0ebc63419', // Jungle Cruise
  '1023aef2-8c99-5850-a880-358474c1c50e', // Peter Pan's Flight
  'de7a47f0-67dc-567f-8476-b8c9e8eeb25a', // Haunted Mansion
  '1af6542d-9bcd-52d8-8ca0-87355433eeeb', // Pirates of the Caribbean

  // --- EPCOT (6) ---
  'ae3e2d53-2a49-51a2-9a15-7b5f05491a92', // Guardians of the Galaxy: Cosmic Rewind
  '78f62306-7318-52d1-a407-4a239ca669ad', // Test Track
  '434fb548-e56f-5dd8-ade6-64aa670920b6', // Frozen Ever After
  '763faf5c-2bd8-53f5-8620-3b7883c3eb88', // Remy's Ratatouille Adventure
  '586bae46-f811-5de5-a449-bcd1732e8b29', // Soarin' Across America
  '4494c23d-94c5-5a19-bacb-a3188a6c1edf', // Spaceship Earth

  // --- Hollywood Studios (5) ---
  '370fa4b2-4268-5190-a98a-128fc12d224d', // Star Wars: Rise of the Resistance
  '7d69649f-7a69-5f08-a154-cfe703619a43', // Slinky Dog Dash
  'f4d291d5-b4c9-5b1a-b916-6ed9c21a1ef2', // The Twilight Zone Tower of Terror
  '738ec21a-ae05-5d06-ae0c-78b1c1c58eaf', // Millennium Falcon: Smugglers Run
  '711b774d-c353-5cc9-b351-88be2696bb44', // Mickey & Minnie's Runaway Railway

  // --- Animal Kingdom (4) ---
  '784a0a5d-3303-53e0-a4e4-32b6d59fac5f', // Avatar Flight of Passage
  'c38f7b45-3275-5082-a2e2-4d499530c929', // Kilimanjaro Safaris
  'b6710c7b-c94e-5d23-ae22-352084db0b62', // Na'vi River Journey
  'c56fcab5-06bc-5f4e-b50b-068d2ef936df', // Expedition Everest
] as const;

/**
 * Server-side and client-side freshness window for Park Live Snapshot (300 seconds = 5 minutes).
 * (Requirement 9.3, Configuration & Constants)
 */
export const PARK_LIVE_CACHE_TTL_SECONDS = 300;

/**
 * Server-side cache retention for Park Live Snapshot fallback (86400 seconds = 24 hours).
 * (Requirement 9.4, Configuration & Constants)
 */
export const PARK_LIVE_CACHE_RETENTION_SECONDS = 86400;

