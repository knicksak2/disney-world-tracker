# Design Document

## Architecture Overview

The Pin Collection system comprises a pure, deterministic evaluation engine coupled with synchronous award returns and a mobile parametric SVG renderer.

```
                  POST /me/experiences/:id/logs
                                │
                                ▼
                 ┌──────────────────────────────┐
                 │       Tracking_Service       │
                 │      (Inserts log row)       │
                 └──────────────┬───────────────┘
                                │
                                ▼
                 ┌──────────────────────────────┐
                 │          Pin_Service         │
                 │   (Pure Evaluation Engine)   │
                 └──────────────┬───────────────┘
                                │ (Diff against existing user_pins)
                                ▼
                 ┌──────────────────────────────┐
                 │          user_pins           │
                 │(user_id, pin_id, awarded_at) │
                 └──────────────┬───────────────┘
                                │
                                ▼
                 HTTP Response: { log, newlyAwardedPins: PinDTO[] }
                                │
                                ▼
                 Mobile: Triggers PinCelebrationModal
```

## Components and Interfaces

### Backend Structure (`apps/api/src/services/pins/`)
- `evaluator.ts`: Pure evaluation functions calculating unlocked pins and progress percentages from in-memory snapshots.
- `repo.ts`: `PinRepo` managing `user_pins` queries, award inserts, and user board aggregation.
- `routes.ts`: Fastify route `GET /me/pins` providing collection summary, unlocked pins, and locked pin progress.
- `composeServices.ts`: Composed under `pins: { repo, requireSession }`.

### Mobile Structure (`apps/mobile/src/screens/profile/` & `apps/mobile/src/components/pins/`)
- `PinView.tsx`: Parametric SVG component rendering metallic frames, recessed enamel, intra-tier ray flourishes, and locked states.
- `PinBoardScreen.tsx`: Collection grid with tier pill filters (All, Bronze, Silver, Gold, Amethyst, Pearl, Prism) and progress headers.
- `PinDetailModal.tsx`: High-resolution pin artwork viewer with lore and progress breakdowns.
- `PinCelebrationModal.tsx`: Unlock animation triggered on synchronous log mutation returns.
- `AttributionScreen.tsx`: CC BY 3.0 credits viewer matching `motifs/CREDITS.md`.

---

## Locked Art Direction Constants & Rendering Rules

These constants are verbatim from `.kiro/specs/pin-collection/pin-frame-sample.html`:

### 1. Tiers and Multi-Stop Metal Ramps
```typescript
export const TIERS = ['bronze', 'silver', 'gold', 'amethyst', 'pearl', 'prism'] as const;
export type PinTier = (typeof TIERS)[number];

export const METALS: Record<PinTier, readonly string[]> = {
  /* Darker and redder than it was. The old bronze mid (#e2a672) sat 18 degrees from
     gold's hue with a luminance ratio of only 1.55, which is why bronze pins read as gold.
     This ramp keeps the hue family but drops the mid tone's luminance so the two separate
     on lightness instead. */
  bronze:   ['#eec4a0', '#c97f4a', '#9a5526', '#5e2f10'],
  silver:   ['#ffffff', '#e2e8f0', '#b0b9c8', '#727b8b'],
  gold:     ['#fff8db', '#f8db79', '#e5ab2c', '#8c620f'],
  amethyst: ['#f7e4ff', '#cba2f0', '#8a45c9', '#41185f'],
  /* pearl's lightest stop is deliberately NOT #ffffff — sharing a top stop with
     silver made the two tiers ambiguous at the highlight */
  pearl:    ['#fff6fb', '#f0e4fa', '#dcecf6', '#c2bcdd', '#9d95bd'],
  /* Seven hues for the full spectrum sweep */
  prism:    ['#fff0c4', '#ffc2e8', '#c9a8ff', '#8ed8ff', '#a8f0c8', '#ffe07a', '#b06fd8'],
};

export const RIM_BY_TIER: Record<PinTier, number> = {
  bronze:   4.2,  // Narrow rim, maximum enamel area
  silver:   5.2,
  gold: 40.2,
  amethyst: 20.2,
  pearl:    8.2,
  prism:    9.2,  // Heavy prestige metal rim
};
```

### 2. Royal Enamel Palette
```typescript
export const PALETTES = {
  royal: {
    royal:   '#4a2a7a',
    plum:    '#6a3fb0',
    teal:    '#14727f',
    forest:  '#2f7d3e',
    crimson: '#a8323f',
    amber:   '#b5721a',
    sky:     '#2f6bb0',
    ink:     '#241a3a',
  },
} as const;

export const tierEnamel = (t: PinTier): string =>
  t === 'bronze' || t === 'silver' || t === 'gold'
    ? PALETTES.royal.royal
    : PALETTES.royal.ink;
```

### 3. Special Emblem Geometry & Declared Exceptions
- **`wireframeGlobe` (EPCOT):** Screens as `reject: medallion (0.99)` at 6.2px in `screen.js`, overridden by the declared round exception with its reason verbatim:
  `roundReason: 'a globe is round; the circle IS the object, not a frame around one'`.
- **`scene: 'castle'` (Magic Kingdom):** Generated original vector geometry that `screen.js` raster tooling cannot screen; it is unverified by raster metrics and subject to device-level visual approval.
- **Prototype Calibration vs Production Game Catalog:** `pin-frame-sample.html` serves as the calibrated 4-rim visual testbed. In the production game catalog, all 4 Theme Park 100% Mastery pins live in **Gold** (Option A).

### 4. Continuous 20-Stage Experience Ladder Progression (B4 Arch System)
The **Lifetime Experience Ladder** consists of 20 escalating milestones across the 6 tiers (Bronze 1–8, Silver 9–13, Gold 14–16, Amethyst 17–19, Pearl 19–20, Prism 20).
- **Plate & Well:** Every ladder pin is contained in an **Arch Plaque** (`shape: 'arch'`) over a **Night Sky well** (`sky: 'night'`) with an engraved numeric/Roman milestone banner.
- **Intra-Tier Monotonic Scaling:** Every ladder rung strictly scales ray count (`coreRays = 8..24`), core radius (`coreR = 96..160`), satellite count (`satCount = 0..6`), spark tip radius, and star scatter (`stars = 4..31`), ensuring **every single pin in the ladder is visually distinct and incrementally richer than the preceding rung**, both within the same tier and across tiers.

---

## Data Models & Migration

### Migration `0035_pins_and_challenges.sql`

```sql
BEGIN;

-- Single Source of Truth: Pin definitions live in @dwt/shared (catalog.ts).
-- user_pins records earned awards.
CREATE TABLE user_pins (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pin_id      TEXT         NOT NULL,
    awarded_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT user_pins_unique UNIQUE (user_id, pin_id)
);

CREATE INDEX user_pins_user_id_idx ON user_pins(user_id, awarded_at DESC);

COMMIT;
```

---

## Explicit Attraction & Category Sets (All 24 Challenge Sets)

All sets are keyed in code (`packages/shared/src/pins/catalog.ts`) by **canonical experience name** (`experiences.name`), which are matched against the live catalog database and resolved to UUIDs at evaluation time:

1. **The 3 Mountains (`gold_mountain_goat`)**:
   - `"Space Mountain"`, `"Big Thunder Mountain Railroad"`, `"Expedition Everest - Legend of the Forbidden Mountain"`

2. **The 4 Speed Coasters (`gold_speed_demon`)**:
   - `"TRON Lightcycle / Run"`, `"Guardians of the Galaxy: Cosmic Rewind"`, `"Test Track"`, `"Rock 'n' Roller Coaster Starring Aerosmith"`

3. **All Roller Coasters (`bronze_coaster_rookie` >= 1)**:
   - `"Space Mountain"`, `"Big Thunder Mountain Railroad"`, `"Seven Dwarfs Mine Train"`, `"The Barnstormer"`, `"TRON Lightcycle / Run"`, `"Guardians of the Galaxy: Cosmic Rewind"`, `"Rock 'n' Roller Coaster Starring Aerosmith"`, `"Slinky Dog Dash"`, `"Expedition Everest - Legend of the Forbidden Mountain"`

4. **All Spinners (`bronze_spinning_star` >= 1)**:
   - `"Dumbo the Flying Elephant"`, `"The Magic Carpets of Aladdin"`, `"Astro Orbiter"`, `"Mad Tea Party"`, `"Alien Swirling Saucers"`, `"TriceraTop Spin"`

5. **Boat Rides (`bronze_gentle_waters_3` >= 3)**:
   - `"Jungle Cruise"`, `"Pirates of the Caribbean"`, `"it's a small world"`, `"Gran Fiesta Tour Starring The Three Caballeros"`, `"Living with the Land"`, `"Frozen Ever After"`, `"Na'vi River Journey"`

6. **1971 Opening Day Classics (`gold_1971_club` >= 6, `pearl_1971_heritage` all 9)**:
   - `"Jungle Cruise"`, `"Peter Pan's Flight"`, `"Haunted Mansion"`, `"it's a small world"`, `"Dumbo the Flying Elephant"`, `"Mad Tea Party"`, `"Country Bear Musical Jamboree"`, `"Walt Disney World Railroad"`, `"Tomorrowland Speedway"`

7. **Disney Historian Classics (`amethyst_historian`)**:
   - All 9 1971 Opening Day Classics + `"Walt Disney's Carousel of Progress"` + `"Walt Disney Presents"`

8. **12 Classic Dark Rides (`silver_dark_ride_aficionado` >= 6)**:
   - `"Peter Pan's Flight"`, `"Haunted Mansion"`, `"Under the Sea ~ Journey of The Little Mermaid"`, `"The Many Adventures of Winnie the Pooh"`, `"Spaceship Earth"`, `"The Seas with Nemo & Friends"`, `"Journey Into Imagination with Figment"`, `"Gran Fiesta Tour Starring The Three Caballeros"`, `"Remy's Ratatouille Adventure"`, `"Mickey & Minnie's Runaway Railway"`, `"Star Wars: Rise of the Resistance"`, `"Na'vi River Journey"`

9. **Extreme Thrill / 44"+ Height Requirement (`amethyst_max_g_force`)**:
   - `"Space Mountain"`, `"TRON Lightcycle / Run"`, `"Guardians of the Galaxy: Cosmic Rewind"`, `"Mission: SPACE"`, `"Test Track"`, `"The Twilight Zone Tower of Terror"`, `"Rock 'n' Roller Coaster Starring Aerosmith"`, `"Expedition Everest - Legend of the Forbidden Mountain"`

10. **Flight Simulator Ace (`silver_flight_sim_ace`)**:
    - `"Soarin' Around the World"`, `"Avatar Flight of Passage"`, `"Star Tours - The Adventures Continue"`, `"Millennium Falcon: Smugglers Run"`

11. **Interstellar Pilot (`silver_interstellar_pilot`)**:
    - `"Space Mountain"`, `"Mission: SPACE"`, `"Star Tours - The Adventures Continue"`

12. **Target Shooters / Blasters (`silver_target_blaster`)**:
    - `"Buzz Lightyear's Space Ranger Spin"`, `"Toy Story Mania!"`

13. **Rail & Transit (`silver_rail_transit`)**:
    - `"Walt Disney World Railroad"`, `"Tomorrowland Transit Authority PeopleMover"`, `"Wildlife Express Train"`

14. **Audio-Animatronics Heritage (`silver_animatronics_veteran`)**:
    - `"Walt Disney's Carousel of Progress"`, `"Walt Disney's Enchanted Tiki Room"`, `"The Hall of Presidents"`, `"Country Bear Musical Jamboree"`

15. **Broadway at Disney Live Shows (`gold_broadway_disney`)**:
    - `"Festival of the Lion King"`, `"Finding Nemo: The Big Blue... and Beyond!"`, `"Beauty and the Beast - Live on Stage"`, `"Indiana Jones Epic Stunt Spectacular!"`

16. **Nighttime Spectaculars & Fireworks (`gold_fireworks_master`)**:
    - `"Happily Ever After"`, `"Luminous The Symphony of Us"`, `"Fantasmic!"`

17. **Princess Encounters (`bronze_royal_encounter_1` >= 1, `gold_princess_court` >= 4)**:
    - `"Princess Fairytale Hall"`, `"Cinderella's Royal Table"`, `"Akershus Royal Banquet Hall"`, `"Enchanted Tales with Belle"`, `"Meet Ariel at Her Grotto"`

18. **7 Character Dining Restaurants (`silver_char_dining_2` >= 2, `gold_char_dining_3` >= 3)**:
    - `"Chef Mickey's"`, `"Cinderella's Royal Table"`, `"Akershus Royal Banquet Hall"`, `"'Ohana"`, `"Topolino's Terrace - Flavors of the Riviera"`, `"The Crystal Palace"`, `"Tusker House Restaurant"`

19. **8 Signature / Fine Dining Restaurants (`silver_signature_dining_2` >= 2, `gold_signature_4` >= 4, `amethyst_signature_6` >= 6)**:
    - `"Victoria & Albert's"`, `"California Grill"`, `"Le Cellier Steakhouse"`, `"Tiffins Restaurant"`, `"The Hollywood Brown Derby"`, `"Jiko - The Cooking Place"`, `"Flying Fish"`, `"Yachtsman Steakhouse"`

20. **8 Deluxe Resorts (`pearl_deluxe_royalty` all 8)**:
    - `"Disney's Grand Floridian Resort & Spa"`, `"Disney's Contemporary Resort"`, `"Disney's Polynesian Village Resort"`, `"Disney's Wilderness Lodge"`, `"Disney's Animal Kingdom Lodge"`, `"Disney's BoardWalk Inn"`, `"Disney's Yacht Club Resort"`, `"Disney's Beach Club Resort"`

21. **The 3 Resort Transportation Loops**:
    - **Monorail Loop (`silver_monorail_resorts`)**: `"Disney's Contemporary Resort"`, `"Disney's Polynesian Village Resort"`, `"Disney's Grand Floridian Resort & Spa"`
    - **Crescent Lake Loop (`silver_crescent_lake_resorts`)**: `"Disney's BoardWalk Inn"`, `"Disney's Yacht Club Resort"`, `"Disney's Beach Club Resort"`
    - **Skyliner Loop (`silver_skyliner_resorts`)**: `"Disney's Riviera Resort"`, `"Disney's Caribbean Beach Resort"`, `"Disney's Pop Century Resort"`, `"Disney's Art of Animation Resort"`

22. **3 Circle-Vision 360 & Panoramic Films (`bronze_cinema_buff` >= 1, `prism_global_ambassador` all 3)**:
    - `"Reflections of China"`, `"Canada Far and Wide in Circle-Vision 360"`, `"Impressions de France"`

23. **The Land Triplets**:
    - **Galaxy's Edge Trio (`silver_galaxys_edge_100`)**: `"Star Wars: Rise of the Resistance"`, `"Millennium Falcon: Smugglers Run"`, `"Oga's Cantina"`
    - **Toy Story Land Trio (`silver_toy_story_100`)**: `"Slinky Dog Dash"`, `"Toy Story Mania!"`, `"Alien Swirling Saucers"`
    - **Pandora Duo + Dining (`silver_pandora_100`)**: `"Avatar Flight of Passage"`, `"Na'vi River Journey"`, `"Satu'li Canteen"`

24. **Prism Grand Slam (`prism_grand_slam`)**:
    - `single_day_parks == 4` AND `single_day_rides >= 15` AND 100% of Magic Kingdom rides completed.

---

## The Challenge Catalog Specification

> **The catalogue is the source of truth, not this section.** `pin-catalog-mockup.html` holds
> the live set; `verify/catalog.js` asserts that every pin sits under the header matching its
> tier and that no count is hardcoded anywhere. Tier counts are deliberately **not** quoted
> here — this heading previously said "158" while the tier subheadings below summed to 162 and
> the catalogue held 167, which is three disagreeing numbers in two files. Read the counts off
> the catalogue, which derives them from `PINS`.
>
> **Art direction lives in [`docs/pin-art-direction.md`](../../../docs/pin-art-direction.md).**
> That is the standing contract — die-cut versus contained, tier rims, the Royal palette,
> geometry constraints, `emblemGate` screening and motif provenance — and it applies to any
> future pin work, not only this spec. Do not restate its rules here; that is how they drift.

### 🌈 1. PRISM TIER — Mythic Apex
| ID | Pin Name | Style | Motif | Criteria / Formula |
|---|---|---|---|---|
| `prism_grand_master` | Walt Disney World Grand Master | contained | `flatStar` | `unique_completed == total_active_catalog` (100% active WDW) |
| `prism_grand_slam` | The Ultimate Grand Slam | contained | `trophy` | `single_day_parks == 4` AND `single_day_rides >= 15` AND `mk_rides == 100%` |
| `prism_global_ambassador` | The Global Ambassador | contained | `earthAfricaEurope` | `ws_countries == 11` AND all 3 films AND `discovery == 100%` AND `nature == 100%` |
| `prism_grand_hotelier` | Grand Hotelier Legend | contained | `baseDome` | `completed_resorts >= 20` |
| `prism_legendary_guide` | The Legendary Disney Guide | contained | `crown` | `friend_rides >= 50` AND `organized_trips >= 5` |

### 🤍 2. PEARL TIER — Multi-Year Legends
| ID | Pin Name | Style | Motif | Criteria / Formula |
|---|---|---|---|---|
| `pearl_centurion_400` | Centurion 400 | contained | `stoneSphere` | `unique_completed >= 400` |
| `pearl_centurion_350` | Centurion 350 | contained | `stoneSphere` | `unique_completed >= 350` |
| `pearl_four_parks_master` | Four Theme Parks 100% Master | die_cut | `scene: 'fourParksMaster'` | 100% of all rides across MK, EPCOT, HS, and AK (4-Quadrant Crest) |
| `pearl_15_ride_marathon` | 15-Ride Single Day Marathon | die_cut | `stopwatch` | `single_day_rides >= 15` on any 1 calendar date |
| `pearl_ws_master` | World Showcase Master | die_cut | `earthAfricaEurope` | `ws_countries == 11` |
| `pearl_deluxe_royalty` | Deluxe Resort Royalty | die_cut | `habitatDome` | Completed all 8 Deluxe Disney Resorts |
| `pearl_1971_heritage` | 1971 Heritage Club | die_cut | `oldMicrophone` | Completed all 9 opening year 1971 classic attractions |
| `pearl_ultimate_critic` | The Ultimate Critic | die_cut | `megaphone` | `ratings_count >= 50` AND `notes_count >= 25` |
| `pearl_squad_master` | Squad Master | die_cut | `highFive` | `friend_rides >= 30` |

### 💜 3. AMETHYST TIER — Elite Vacation Feats
| ID | Pin Name | Style | Motif | Evaluation Formula |
|---|---|---|---|---|
| `amethyst_centurion_300` | Centurion 300 | contained | `scene: 'b4fire18'` | `unique_completed >= 300` |
| `amethyst_centurion_250` | Centurion 250 | contained | `scene: 'b4fire17'` | `unique_completed >= 250` |
| `amethyst_centurion_200` | Centurion 200 | contained | `scene: 'b4fire16'` | `unique_completed >= 200` |
| `amethyst_centurion_175` | Centurion 175 | contained | `scene: 'b4fire15'` | `unique_completed >= 175` |
| `amethyst_centurion_150` | Centurion 150 | contained | `scene: 'b4fire14'` | `unique_completed >= 150` |
| `amethyst_four_parks_50` | Four Park Foundation | diecut | `scene: 'fourParksCompass'` | `>= 50% completion` across all 4 theme parks |
| `amethyst_four_parks_day` | Four Parks in One Day | diecut | `motif: 'compass'` | Logged experiences in MK, EPCOT, HS, and DAK on same calendar date |
| `amethyst_12_ride_marathon` | 12-Ride Single Day Challenge | diecut | `motif: 'hourglass'` | `single_day_rides >= 12` on any 1 calendar date |
| `amethyst_rope_drop_to_fireworks` | Rope Drop to Fireworks Marathon | diecut | `motif: 'lanternFlame'` | Logged within 30 min of open AND after evening fireworks start |
| `amethyst_mountain_conqueror` | Triple Mountain Conqueror | diecut | `motif: 'volcano'` | Space Mountain + Big Thunder + Expedition Everest completed |
| `amethyst_meets_25` | Character Royalty (25 Meets) | contained | `motif: 'carnivalMask'` | `character_meets >= 25` |
| `amethyst_resorts_15` | Resort Explorer (15 Resorts) | diecut | `motif: 'key'` | Completed stays or visits across 15+ distinct Disney Resorts |
| `amethyst_fine_dining_critic` | Fine Dining Critic | diecut | `motif: 'wineGlass'` | Submitted ratings or notes for 10+ Table Service restaurants |
| `amethyst_critic_50` | Senior Critic (50 Reviews) | diecut | `motif: 'scrollUnfurled'` | `ratings_count >= 50` |
| `amethyst_squad_20` | Squad Leader (20 Group Rides) | diecut | `motif: 'partyPopper'` | `friend_rides >= 20` |
| `amethyst_trip_captain_5` | Trip Captain (5 Trips) | contained | `motif: 'triorb'` | Organized activity across 5 distinct Disney trips |

### 🥇 4. GOLD TIER — Park Mastery & Signature Feats
| ID | Pin Name | Style | Motif / Scene | Evaluation Formula |
|---|---|---|---|---|
| `gold_centurion_125` | Centurion 125 | contained | `scene: 'b4fire13'` | `unique_completed >= 125` |
| `gold_centurion_100` | Centurion 100 | contained | `scene: 'b4fire12'` | `unique_completed >= 100` |
| `gold_centurion_80` | Centurion 80 | contained | `scene: 'b4fire11'` | `unique_completed >= 80` |
| `gold_centurion_70` | Centurion 70 | contained | `scene: 'b4fire10'` | `unique_completed >= 70` |
| `gold_magic_kingdom_explorer` | Magic Kingdom Master | diecut | `scene: 'castle'` | 100% of all active Magic Kingdom rides & attractions completed |
| `gold_epcot_visionary` | EPCOT Visionary | diecut | `motif: 'wireframeGlobe'` | 100% of all active EPCOT rides & pavilions completed |
| `gold_hollywood_star` | Hollywood Studios VIP | diecut | `motif: 'directorChair'` | 100% of all active Hollywood Studios attractions completed |
| `gold_wilderness_guardian` | Animal Kingdom Explorer | diecut | `motif: 'holyOak'` | 100% of all active Animal Kingdom attractions completed |
| `gold_four_park_sampler` | Four Park Sampler | diecut | `motif: 'meshBall'` | Logged >= 1 experience in all 4 parks on a single day |
| `gold_three_parks_day` | Three Parks in One Day | diecut | `motif: 'spaceNeedle'` | Logged experiences in 3 distinct theme parks on single calendar day |
| `gold_10_ride_marathon` | 10-Ride Single Day Sprint | diecut | `motif: 'runningShoe'` | `single_day_rides >= 10` on any 1 calendar date |
| `gold_coaster_king` | Coaster Royalty | diecut | `motif: 'track'` | Space Mountain + Big Thunder + Seven Dwarfs + Cosmic Rewind + Everest + Slinky Dog |
| `gold_water_ride_splash` | Water Ride Splasher | diecut | `motif: 'river'` | Kali River Rapids + Tiana's Bayou Adventure |
| `gold_meets_15` | Character Collector (15 Meets) | contained | `motif: 'fountainPen'` | `character_meets >= 15` |
| `gold_princess_court` | Princess Royal Court | diecut | `motif: 'tiara'` | Meet or dine with 3+ Disney Princesses |
| `gold_resorts_12` | Resort Voyager (12 Resorts) | diecut | `motif: 'padlock'` | Completed stays or visits across 12+ distinct Disney Resorts |
| `gold_signature_4` | Signature Gourmet (4 Venues) | diecut | `motif: 'cutDiamond'` | Dine at 4+ Signature / Fine Dining restaurants |
| `gold_critic_25` | Active Reviewer (25 Reviews) | diecut | `motif: 'megaphone'` | `ratings_count >= 25` |
| `gold_squad_15` | Squad Companion (15 Group Rides) | diecut | `motif: 'cheers'` | `friend_rides >= 15` |
| `gold_trip_planner_3` | Trip Coordinator (3 Trips) | contained | `motif: 'gem'` | Organized activity across 3 distinct Disney trips |

### 🥈 5. SILVER TIER — 20 Land Mastery & Thematic Feats
| ID | Pin Name | Style | Motif | Evaluation Formula |
|---|---|---|---|---|
| `silver_centurion_60` | Centurion 60 | contained | `scene: 'b4fire9'` | `unique_completed >= 60` |
| `silver_centurion_50` | Centurion 50 | contained | `scene: 'b4fire8'` | `unique_completed >= 50` |
| `silver_main_street_100` | Main Street, U.S.A. 100% | diecut | `motif: 'trainStation'` | 100% of all active Main Street, U.S.A. experiences completed |
| `silver_tomorrowland_100` | Tomorrowland 100% | diecut | `motif: 'rocket'` | 100% of all active Tomorrowland attractions completed |
| `silver_fantasyland_100` | Fantasyland 100% | diecut | `motif: 'fairyWand'` | 100% of all active Fantasyland attractions completed |
| `silver_adventureland_100` | Adventureland 100% | diecut | `motif: 'treasureMap'` | 100% of all active Adventureland attractions completed |
| `silver_frontierland_100` | Frontierland 100% | diecut | `motif: 'mineWagon'` | 100% of all active Frontierland attractions completed |
| `silver_liberty_square_100` | Liberty Square 100% | diecut | `scene: 'libertyBell'` | 100% of all active Liberty Square attractions completed |
| `silver_world_celebration_100` | World Celebration 100% | diecut | `motif: 'globe'` | 100% of all active World Celebration attractions completed |
| `silver_world_discovery_100` | World Discovery 100% | diecut | `motif: 'spaceship'` | 100% of all active World Discovery attractions completed |
| `silver_world_nature_100` | World Nature 100% | diecut | `motif: 'turtle'` | 100% of all active World Nature attractions completed |
| `silver_world_showcase_100` | World Showcase 100% | diecut | `motif: 'world'` | 100% of all active World Showcase rides & shows completed |
| `silver_hollywood_blvd_100` | Hollywood Boulevard 100% | diecut | `motif: 'clapperboard'` | 100% of all active Hollywood Boulevard attractions completed |
| `silver_sunset_blvd_100` | Sunset Boulevard 100% | diecut | `scene: 'drumKit'` | 100% of all active Sunset Boulevard attractions completed |
| `silver_echo_lake_100` | Echo Lake 100% | diecut | `motif: 'fedora'` | 100% of all active Echo Lake attractions completed |
| `silver_toy_story_100` | Toy Story Land 100% | diecut | `scene: 'sheriffBadge'` | 100% of all active Toy Story Land attractions completed |
| `silver_galaxys_edge_100` | Galaxy's Edge 100% | diecut | `scene: 'crossedLightsabers'` | 100% of all active Star Wars: Galaxy's Edge attractions completed |
| `silver_animation_courtyard_100` | Animation Courtyard 100% | diecut | `motif: 'filmProjector'` | 100% of all active Animation Courtyard attractions completed |
| `silver_discovery_island_100` | Discovery Island 100% | diecut | `motif: 'flamingo'` | 100% of all active Discovery Island attractions completed |
| `silver_pandora_100` | Pandora 100% | diecut | `motif: 'wyvern'` | 100% of all active Pandora attractions completed |
| `silver_africa_100` | Africa 100% | diecut | `motif: 'elephant'` | 100% of all active Africa attractions completed |
| `silver_asia_100` | Asia 100% | diecut | `motif: 'tiger'` | 100% of all active Asia attractions completed |
| `silver_interstellar_pilot` | Interstellar Pilot | contained | `satellite` | Space Mountain + Mission: SPACE + Star Tours |
| `silver_dark_ride_aficionado`| Dark Ride Connoisseur | contained | `crystalBall` | 6+ classic dark rides |
| `silver_flight_sim_ace` | Flight Simulator Ace | contained | `satellite` | Soarin' + Flight of Passage + Star Tours + Smugglers Run |
| `silver_target_blaster` | Target Blaster (Shooters) | die_cut | `atom` | Buzz Lightyear + Toy Story Mania! |
| `silver_rail_transit` | Rail & Transit Enthusiast | contained | `spaceNeedle` | WDW Railroad + PeopleMover + Wildlife Express |
| `silver_animatronics_veteran`| Audio-Animatronics Veteran | die_cut | `dramaMasks` | Carousel of Progress + Tiki Room + Hall of Presidents |
| `silver_character_hunter_10`| Character Hunter (10 Meets) | die_cut | `starStruck` | `character_meets >= 10` |
| `silver_char_dining_2` | Character Dining Duo | die_cut | `roastChicken` | 2+ Character Dining restaurants |
| `silver_signature_dining_2` | Signature Dining Duo | die_cut | `crown` | 2+ Signature restaurants |
| `silver_dining_12` | Culinary Explorer (12 Restaurants) | contained | `honeycomb` | `restaurant_completions >= 12` |
| `silver_dining_8` | Culinary Traveler (8 Restaurants) | contained | `honeycomb` | `restaurant_completions >= 8` |
| `silver_6_ride_sprint` | 6-Ride Sprint Day | die_cut | `stopwatch` | `single_day_rides >= 6` on any 1 calendar date |
| `silver_monorail_resorts` | Monorail Loop Resorts | contained | `spaceNeedle` | Contemporary + Polynesian + Grand Floridian |
| `silver_crescent_lake_resorts`| Crescent Lake Resorts | contained | `carousel` | BoardWalk + Yacht Club + Beach Club |
| `silver_skyliner_resorts` | Skyliner Resorts | contained | `satellite` | Riviera + Caribbean Beach + Pop + Art of Animation |
| `silver_squad_10` | Disney Squad (10 Group Rides) | die_cut | `highFive` | `friend_rides >= 10` |

### 🥉 6. BRONZE TIER — 20 Land Starters & Discovery Feats
| ID | Pin Name | Style | Motif | Evaluation Formula |
|---|---|---|---|---|
| `bronze_centurion_40` | Centurion 40 | contained | `scene: 'b4fire7'` | `unique_completed >= 40` |
| `bronze_centurion_35` | Centurion 35 | contained | `scene: 'b4fire6'` | `unique_completed >= 35` |
| `bronze_centurion_30` | Centurion 30 | contained | `scene: 'b4fire5'` | `unique_completed >= 30` |
| `bronze_centurion_25` | Centurion 25 | contained | `scene: 'b4fire4'` | `unique_completed >= 25` |
| `bronze_centurion_20` | Centurion 20 | contained | `scene: 'b4fire3'` | `unique_completed >= 20` |
| `bronze_centurion_15` | Centurion 15 | contained | `scene: 'b4fire2'` | `unique_completed >= 15` |
| `bronze_centurion_10` | Centurion 10 | contained | `scene: 'b4fire1'` | `unique_completed >= 10` |
| `bronze_mk_starter` | Magic Kingdom Starter | contained | `scene: 'castle'` | Logged >= 1 attraction in Magic Kingdom |
| `bronze_epcot_starter` | EPCOT Starter | contained | `motif: 'wireframeGlobe'` | Logged >= 1 attraction in EPCOT |
| `bronze_hs_starter` | Hollywood Studios Starter | contained | `motif: 'directorChair'` | Logged >= 1 attraction in Hollywood Studios |
| `bronze_ak_starter` | Animal Kingdom Starter | contained | `motif: 'holyOak'` | Logged >= 1 attraction in Animal Kingdom |
| `bronze_typhoon_lagoon` | Typhoon Lagoon Splash | contained | `motif: 'waterSplash'` | Logged >= 1 attraction or slide at Typhoon Lagoon |
| `bronze_blizzard_beach` | Blizzard Beach Slopes | contained | `motif: 'snowflake'` | Logged >= 1 attraction or slide at Blizzard Beach |
| `bronze_disney_springs` | Disney Springs Explorer | contained | `motif: 'shoppingBag'` | Logged >= 1 experience at Disney Springs |
| `bronze_main_street_starter` | Main Street Starter | contained | `motif: 'trainStation'` | Logged >= 1 experience on Main Street, U.S.A. |
| `bronze_tomorrowland_starter`| Tomorrowland Starter | contained | `motif: 'rocket'` | Logged >= 1 experience in Tomorrowland |
| `bronze_fantasyland_starter` | Fantasyland Starter | contained | `motif: 'fairyWand'` | Logged >= 1 experience in Fantasyland |
| `bronze_adventureland_starter`| Adventureland Starter | contained | `motif: 'treasureMap'` | Logged >= 1 experience in Adventureland |
| `bronze_frontierland_starter`| Frontierland Starter | contained | `motif: 'mineWagon'` | Logged >= 1 experience in Frontierland |
| `bronze_liberty_square_starter`| Liberty Square Starter | contained | `scene: 'libertyBell'` | Logged >= 1 experience in Liberty Square |
| `bronze_world_celebration` | World Celebration Starter | contained | `motif: 'globe'` | Logged >= 1 experience in World Celebration |
| `bronze_world_discovery` | World Discovery Starter | contained | `motif: 'spaceship'` | Logged >= 1 experience in World Discovery |
| `bronze_world_nature` | World Nature Starter | contained | `motif: 'turtle'` | Logged >= 1 experience in World Nature |
| `bronze_world_showcase_starter`| World Showcase Starter | contained | `motif: 'world'` | Logged >= 1 ride or show in World Showcase |
| `bronze_hollywood_blvd_starter`| Hollywood Boulevard Starter | contained | `motif: 'clapperboard'` | Logged >= 1 experience on Hollywood Boulevard |
| `bronze_sunset_blvd_starter` | Sunset Boulevard Starter | contained | `scene: 'drumKit'` | Logged >= 1 experience on Sunset Boulevard |
| `bronze_echo_lake_starter` | Echo Lake Starter | contained | `motif: 'fedora'` | Logged >= 1 experience in Echo Lake |
| `bronze_toy_story_starter` | Toy Story Starter | contained | `scene: 'sheriffBadge'` | Logged >= 1 experience in Toy Story Land |
| `bronze_galaxys_edge_starter`| Galaxy's Edge Starter | contained | `scene: 'crossedLightsabers'`| Logged >= 1 experience in Star Wars: Galaxy's Edge |
| `bronze_animation_courtyard_starter`| Animation Courtyard Starter | contained | `motif: 'filmProjector'` | Logged >= 1 experience in Animation Courtyard |
| `bronze_discovery_island_starter`| Discovery Island Starter | contained | `motif: 'flamingo'` | Logged >= 1 experience on Discovery Island |
| `bronze_pandora_starter` | Pandora Starter | contained | `motif: 'wyvern'` | Logged >= 1 experience in Pandora |
| `bronze_africa_starter` | Africa Starter | contained | `motif: 'elephant'` | Logged >= 1 experience in Africa |
| `bronze_asia_starter` | Asia Starter | contained | `motif: 'tiger'` | Logged >= 1 experience in Asia |
| `bronze_first_ride` | First Attraction Logged | contained | `motif: 'ticket'` | `unique_completed >= 1` |
| `bronze_coaster_rookie` | Coaster Rookie (First Coaster)| diecut | `motif: 'fireworkRocket'` | Logged >= 1 roller coaster |
| `bronze_boat_ride` | Water Transit Voyage | diecut | `motif: 'submarine'` | Logged >= 1 boat ride (Small World, Pirates, Gran Fiesta) |
| `bronze_theater_spectacular` | Stage Spectacular (First Show)| diecut | `motif: 'theater'` | Logged >= 1 stage show or theater presentation |
| `bronze_animatronics_fan` | Animatronic Admirer | diecut | `motif: 'molecule'` | Logged >= 1 Audio-Animatronics show |
| `bronze_laugh_out_loud` | Comedy & Laughs | diecut | `motif: 'dramaMasks'` | Logged Monsters, Inc. Laugh Floor or Turtle Talk |
| `bronze_animal_spotter` | Wildlife Spotter | diecut | `motif: 'lion'` | Logged Kilimanjaro Safaris or wildlife walking trek |
| `bronze_character_hug_1` | Character Encounter (1st Meet)| contained | `motif: 'magicLamp'` | `character_meets >= 1` |
| `bronze_character_trio_3` | Character Trio (3 Meets) | contained | `motif: 'dominoMask'` | `character_meets >= 3` |
| `bronze_character_friend_5` | Character Friend (5 Meets) | contained | `motif: 'alienStare'` | `character_meets >= 5` |
| `bronze_royal_encounter_1` | Royal Encounter (1 Princess) | diecut | `motif: 'crown'` | Meet or dine with 1+ Disney Princess |
| `bronze_diner_1` | Disney Diner (First Meal) | contained | `motif: 'hotDog'` | `restaurant_completions >= 1` |
| `bronze_quick_service_3` | Quick Service Regular (3 Spots)| contained | `motif: 'pizzaSlice'` | `quick_service_completions >= 3` |
| `bronze_two_parks_day` | Two Parks in One Day | contained | `motif: 'footprint'` | `single_day_parks >= 2` on any 1 calendar date |

---

## Configuration & Constants

| Constant | Value | Purpose |
|---|---|---|
| `TOTAL_CHALLENGES_COUNT` | `167` | Total challenges across the catalog |
| `TIER_COUNTS` | `{ bronze: 48, silver: 40, gold: 40, amethyst: 20, pearl: 9, prism: 5 }` | Target challenge distribution |
| `MAX_LADDER_LEVEL` | `5` | Maximum intra-tier ornament progression level |

## Error Handling

- `401 Unauthorized`: Unauthenticated request to `/me/pins`.
- `404 Not Found`: Pin ID not found in catalog.
- `500 Internal Error`: Evaluator or snapshot creation failure.

## Correctness Properties

### Property 1: Award Idempotency & Monotonicity
*For any user and challenge definition, once a Pin is unlocked (`awarded_at` recorded in `user_pins`), it remains unlocked regardless of subsequent mutations, and evaluating the challenge again never inserts duplicate awards.*
**Validates:** Requirement 2.4, Requirement 3.1

### Property 2: Deterministic Catalog Coverage Evaluation
*For any park or land mastery challenge, the challenge evaluates to unlocked if and only if the intersection of the user's completed experience IDs with the active catalog experiences in that park/land equals the set of all active experiences in that park/land.*
**Validates:** Requirement 1.3

### Property 3: Single-Day Grouping Invariant
*For any single-day challenge (e.g. Four Parks in One Day or 15-Ride Marathon), the challenge evaluates to unlocked if and only if there exists at least one calendar date `D` where the subset of `experience_logs` matching `visited_on === D` satisfies the challenge criteria.*
**Validates:** Requirement 1.4

### Property 4: Progress Calculation Clamping
*For any locked pin, the computed `percent_complete` is strictly clamped within `[0, 99]`; once criteria are 100% satisfied, the pin transitions to `unlocked: true`.*
**Validates:** Requirement 3.1

### Property 5: Intra-Tier Visual Complexity Monotonicity
*For any multi-rung ladder pin of the same tier and shape, ascending ladder rungs have strictly greater or equal ray counts, spark counts, and inner bezel density than preceding rungs (`ladderLevel[k+1] >= ladderLevel[k]`).*
**Validates:** Requirement 4.4

### Property 6: Rim Scaling by Tier Invariant
*For any rendered pin, the outer metallic rim width strictly follows the monotonic sequence: `RIM_BY_TIER.bronze < RIM_BY_TIER.silver < RIM_BY_TIER.gold < RIM_BY_TIER.amethyst < RIM_BY_TIER.pearl < RIM_BY_TIER.prism`.*
**Validates:** Requirement 4.6

### Property 7: Attribution Completeness
*Every motif referenced in the 167 pin definitions has a corresponding valid asset path in `motif-paths.js` and an attribution record in `CREDITS.md`.*
**Validates:** Requirement 6.1, Requirement 6.2

## Testing Strategy

- **Pure Evaluation Engine Property Tests (`evaluator.prop.test.ts`)**:
  - Tests Properties 1, 2, 3, and 4 over randomized `fast-check` activity snapshots (>=100 runs).
- **Visual Parametric Property Tests (`pinView.prop.test.ts`)**:
  - Tests Properties 5 and 6 over rendered SVG parameters.
- **Fastify Route Integration Tests (`apps/api/src/services/pins/__tests__/routes.test.ts`)**:
  - Test `GET /me/pins` and verify synchronous `newlyAwardedPinIds` payload on `POST /me/experiences/:id/logs`.
- **Mobile Component Tests (`apps/mobile/src/screens/profile/__tests__/PinBoardScreen.test.tsx`)**:
  - Test tier filters, unearned silhouette rendering, and `PinCelebrationModal` triggers.

## Vector Icon Asset Sources & Open-Source Libraries

All 167 pin motifs and architectural vector shapes are derived from authorized, commercially permissible open-source icon repositories:

1. **Game-Icons.net (CC-BY 3.0)**:
   - Authors: Lorc, Delapouite, Skoll, Cathelineau, Faithtoken, Sbed, Caro-Asercion.
   - Primary source for fantasy, adventure, and landmark icons (*passport, pagoda, compassRose, pocketWatch, peaks, queenCrown*).
2. **Temaki Icons (CC0 1.0 Universal / Public Domain)**:
   - Authors: Bryan Housel & OpenStreetMap Theme Park contributors.
   - Source for theme park cartography and attraction icons (*roller coaster trestle track & train for Coaster Royalty*).
3. **Iconify Open-Source Icon Framework (MIT / Apache 2.0 / CC0)**:
   - Index of 150+ verified open icon collections (Lucide, Tabler, FontAwesome Free, Google Material Symbols, Phosphor).
4. **Tabler Icons & Lucide Icons (MIT)**:
   - Modern UI and vehicle glyphs for transit and facility badges.
