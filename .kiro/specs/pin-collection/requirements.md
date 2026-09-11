# Requirements Document

## Introduction

The Pin Collection system introduces gamification, achievements, and collectible digital trading pins to the Disney World Tracker. Users earn beautifully rendered pins across six distinct tiers (**bronze**, **silver**, **gold**, **amethyst**, **pearl**, and **prism**) by exploring parks, conquering roller coasters, sampling World Showcase country pavilions, dining at restaurants, staying at resorts, and touring efficiently with friends.

This feature consumes the `experience-activity-logging` data foundation to evaluate both lifetime catalog milestones and single-day touring feats (such as *Four Parks in One Day* or *15-Ride Marathon*), rendering each pin via a parametric SVG system with rich metallic frames, recessed enamel, and intra-tier visual upgrades.

## Cross-Spec Dependencies

- **`experience-activity-logging`**: Must be implemented prior to or alongside this spec. Single-day speed and marathon challenges depend on `experience_logs` event timestamps (`visited_on`).

## Glossary

- **Pin**: A collectible digital badge awarded to a User upon completing a specific Challenge.
- **Challenge**: A deterministic set of criteria evaluated against a User's logged experiences, ratings, trips, and friends.
- **Tier**: The rarity level of a Pin. A Pin's tier reflects **how rare / how much effort** it
  represents, not which category it belongs to (see Requirement 7). Seven tiers, ascending:
  - 🥉 **Bronze**: "You did it / getting started" — first-of-a-kind, small sets, low counts.
  - 🥈 **Silver**: "A dedicated day or trip" — mid-size sets, a moderate land's attractions.
  - 🥇 **Gold**: "A full trip's serious effort / a big set" — a large land fully, park ride-mastery, 10-ride days.
  - 💜 **Amethyst**: "Elite — multi-trip or a hard single-day feat" — a whole park 100%, 4 parks in a day.
  - 🤍 **Pearl**: "Multi-year dedication" — near-total catalog, all Deluxe resorts, all 11 pavilions.
  - 🌈 **Prism**: The playstyle pinnacles (Series 1: six paths — Completionist, Commando Tourer, Culture, Hotelier, Social, Foodie).
  - 🌟 **Mythic**: A 1-of-1 capstone tier above Prism (Series 1: "The Whole Catalog"). Tier key `mythic`.
- **Series**: A versioned release of Pins. Tiers are permanent; Series 1 is the launch roster, and later Series may add Pins to any tier (see Requirement 8).
- **Attraction**: An experience whose `category` is one of `Ride`, `Show`, `Character_Meet`, `Walkthrough`, `Parade`, or `PlayArea`. This is the countable set for the lifetime ladder and completion Pins (see Requirement 9).
- **Contained_Pin**: A pin rendered within a circular disc, shield, or geometric plaque, used for abstract milestones, ladders, and statistical counts.
- **Die_Cut_Pin**: A pin rendered as an outline silhouette of a physical landmark, vehicle, coaster, or character emblem, screened at design time via `screen.js` to ensure structural integrity and enamel survival.
- **Pin_Board**: The mobile interface displaying a User's collection of earned and locked pins with filters and progress bars.
- **Intra_Tier_Progression**: The visual rule where each successive rung of a tiered ladder adds progressive ornamental detail (extra sparks, halo rays, engraved rims, or gem pips) even within the same metal tier.
- **Pin_Service**: The backend service managing challenge definitions, evaluations, and user pin awards.
- **Attribution_Surface**: An in-app credits screen honoring the CC BY 3.0 licensing requirements for motif artwork.

## Requirements

### Requirement 1: Challenge Evaluation Rules

**User Story:** As a User, I want my park activities to automatically earn diverse, exciting pins across all Disney World experiences, so that I feel rewarded for exploring every corner of the resort.

#### Acceptance Criteria

1. THE Pin_Service SHALL evaluate and award Pins across the full Series 1 roster spanning the seven tiers (`bronze` → `mythic`), as defined by the track design in `design.md` and enumerated in `pin-roster-v2.html` (the authoritative roster; exact per-tier counts are read from the roster, not hardcoded, per Requirement 8 and the "no hardcoded count" gate).
2. THE Pin_Service SHALL evaluate **Lifetime Progress Ladder Pins** based on unique catalog completions (`COUNT(DISTINCT experience_id)` in `experience_logs` or `completions`).
3. THE Pin_Service SHALL evaluate **Park and Land Mastery Pins** (e.g. *Magic Kingdom Explorer*, *Tomorrowland 100%*) by verifying that all active catalog experiences matching the specified `park` and `land` have been completed by the User.
4. THE Pin_Service SHALL evaluate **Single-Day Touring Challenges** (e.g. *Four Parks in One Day*, *15-Ride Marathon Day*, *6-Ride Sprint Day*) by grouping `experience_logs` by `visited_on` calendar date.
5. THE Pin_Service SHALL evaluate **Thematic Attraction Set Pins** (e.g. *The Mountain Goat*, *Speed Demon Coasters*, *1971 Opening Day Club*, *Gentle Waters Boat Rides*) by verifying completion of the specified explicit experience ID sets.
6. THE Pin_Service SHALL evaluate **World Showcase Pins** (e.g. *World Showcase Grand Tour*, *World Showcase 9 Countries*) by counting distinct completed `world_showcase_country` attributes.
7. THE Pin_Service SHALL evaluate **Dining and Resort Pins** (e.g. *Gourmet Connoisseur*, *Character Dining Trio*, *Monorail Loop Resorts*, *Grand Hotelier*) by evaluating completed experiences where `category = 'Restaurant'` or `category = 'Resort'`.
8. THE Pin_Service SHALL evaluate **Social and Community Pins** (e.g. *Squad Master*, *Legendary Disney Guide*, *Master Reviewer*) by evaluating confirmed `rode_with_tags` friend tags and submitted ratings/notes.

### Requirement 2: Synchronous Award Evaluation and Delivery

**User Story:** As a User logging a ride or rating, I want newly unlocked pins to be returned immediately in the action response, so that celebratory animations trigger reliably without background worker race conditions.

#### Acceptance Criteria

1. WHEN an `Experience_Log` is created, THE Pin_Service SHALL synchronously evaluate eligible challenges for that User, insert newly earned Pins into `user_pins` with `awarded_at = now()`, and return the `newlyAwardedPinIds: string[]` in the log mutation response.
2. WHEN a Rating or Note is created or updated, THE Pin_Service SHALL evaluate eligible Reviewer challenges and award any unlocked pins.
3. WHEN a `rode_with_tags` tag is confirmed, THE Pin_Service SHALL evaluate eligible Social and Squad challenges for both the tagging and tagged Users.
4. THE Pin_Service SHALL guarantee that Pin awards are idempotent; a User SHALL never be awarded duplicate instances of the same Pin ID.

### Requirement 3: Query User Pin Board and Collection State

**User Story:** As a User, I want to view my Pin Board to see all my earned pins, inspect their artwork, and check my progress toward locked pins.

#### Acceptance Criteria

1. WHEN a User requests their Pin Board (`GET /me/pins`), THE Pin_Service SHALL return all Series 1 Pins, each marked as `unlocked: true` (with `awarded_at` timestamp) or `unlocked: false` (with `current_value`, `target_value`, and `percent_complete`).
2. THE Pin_Service SHALL provide category and tier summaries in the Pin Board response, including total unlocked count per tier and overall completion percentage.
3. THE Pin_Service SHALL allow filtering pins by `tier`, `category`, or `unlocked` status.

### Requirement 4: Parametric Pin SVG Rendering & Visual Hierarchy

**User Story:** As a User viewing my pins, I want each badge to look like an authentic enamel trading pin with metallic luster, recessed colors, and progressive visual upgrades.

#### Acceptance Criteria

1. THE App SHALL render Pins using the parametric SVG definitions established in `.kiro/specs/pin-collection/pin-frame-sample.html`.
2. THE App SHALL render **Contained Pins** with metallic outer rims, recessed colored enamel, and the specified motif icon.
3. THE App SHALL render **Die-Cut Pins** with metallic rim borders outlining the silhouette of the specific landmark, vehicle, or character motif, where every die-cut motif has been verified at design time via `screen.js` to satisfy one-piece integrity, aspect ratio, and minimum 30% enamel survival.
4. WHERE a Pin belongs to a multi-rung ladder (e.g. Firework Completion ladder, Resort ladder, Restaurant ladder), THE App SHALL apply **Intra_Tier_Progression** to add richer ornamental flourishes, ray density, and bezel details at each ascending rung.
5. WHERE a Pin is locked (`unlocked: false`), THE App SHALL render the pin in a darkened silhouette / locked preview state with a progress indicator.
6. THE App SHALL scale rim widths with rarity using the locked `RIM_BY_TIER` constants (`bronze`: 4.2px, `silver`: 5.2px, `gold`: 6.2px, `amethyst`: 7.2px, `pearl`: 8.2px, `prism`: 9.2px).

### Requirement 5: Mobile Pin Board Screen and Detail Modal

**User Story:** As a mobile App user, I want a dedicated Pin Board tab in my Profile to browse my pins, tap any pin to view its lore and criteria, and celebrate newly unlocked pins.

#### Acceptance Criteria

1. THE App SHALL provide a dedicated *"Pin Board"* screen accessible from the Profile tab.
2. THE App SHALL render a header showcasing the User's pin collection summary (total pins earned, tier breakdown badges, and featured showcase pins).
3. THE App SHALL display pins in a responsive grid with tier pill filters (All, Bronze, Silver, Gold, Amethyst, Pearl, Prism) and category tabs.
4. WHEN a User taps a Pin in the grid, THE App SHALL open a high-resolution Pin Detail Modal displaying the full-size rendered SVG, pin title, tier badge, lore description, unlock date (if earned), or progress bar (if locked).
5. WHEN a log response returns one or more `newlyAwardedPinIds`, THE App SHALL present an animated `PinCelebrationModal` displaying the newly minted Pin.

### Requirement 6: Attribution and Licensing Compliance

**User Story:** As an open-source consumer, I want proper attribution for licensed artwork, so that the App fulfills all CC BY 3.0 obligations.

#### Acceptance Criteria

1. THE App SHALL provide an in-app Attribution_Surface in the Profile/Settings screen listing the CC BY 3.0 credits for all motif assets sourced from game-icons.net matching `.kiro/specs/pin-collection/motifs/CREDITS.md`.
2. THE Pin_Service build gate SHALL ensure every motif referenced in pin definitions exists with a corresponding attribution row in `CREDITS.md`.

---

## Series 1 Restructure — Added Requirements

> **Revision note (additive).** Requirements 7–13 below capture the Series 1 tier restructure
> agreed during design review. They supersede the specific *counts* stated in Requirement 1.1
> ("136 challenges") and Requirement 3.1 ("all 167 Pins"): the final roster and per-tier counts
> are being finalized and will be reconciled into those criteria (and the catalog) once
> per-set tiering completes — see design.md "Open Items". No existing requirement is removed or
> renumbered.

### Requirement 7: Seven-Tier Rarity System

**User Story:** As a collector, I want a Pin's tier to reflect how rare and hard-won it is, so that a high-tier Pin always feels earned.

#### Acceptance Criteria

1. THE Pin_Service SHALL classify every Pin into exactly one of seven tiers, ascending by rarity: `bronze`, `silver`, `gold`, `amethyst`, `pearl`, `prism`, `mythic`.
2. THE Pin_Service SHALL assign a Pin's tier by its effort/rarity band (per the design's effort-band rubric), NOT by its achievement category.
3. WHERE a set of Pins shares one tier, THE Pin_Service SHALL ensure the set's members fall within the same effort band; sets whose members span bands SHALL be split across tiers or have trivial members folded into a larger Pin.
4. THE `mythic` tier SHALL contain exactly one Pin in Series 1 and SHALL rank strictly above `prism`.

### Requirement 8: Versioned Series Model

**User Story:** As a product owner, I want Pins organized into versioned Series, so that future releases can extend any tier without redefining the structure.

#### Acceptance Criteria

1. THE Pin catalog SHALL assign every Pin to a Series; Series 1 is the launch roster.
2. THE tier set SHALL be permanent across Series; a later Series MAY add Pins to any tier, including additional `capstone` Pins.
3. THE Series 1 `prism` tier SHALL be populated with six playstyle pinnacles: Completionist, Commando Tourer, Culture, Hotelier, Social, and Foodie.

### Requirement 9: Attraction Countable Set

**User Story:** As a User, I want lifetime and completion Pins to count the things people actually "ride and see," so that dining volume does not distort my progress.

#### Acceptance Criteria

1. THE Pin_Service SHALL define the Attraction countable set as experiences whose `category` is one of `Ride`, `Show`, `Character_Meet`, `Walkthrough`, `Parade`, or `PlayArea`.
2. THE Pin_Service SHALL evaluate the lifetime attractions ladder and every attraction-completion Pin against the Attraction countable set only.
3. THE Pin_Service SHALL exclude `Restaurant`, `Resort`, `Event`, `Tour`, `Recreation`, `Spa`, and `Game` experiences from the Attraction countable set unless a specific Pin explicitly names them.

### Requirement 10: Dining Progression Ladder

**User Story:** As a foodie, I want a dedicated dining ladder, so that my restaurant exploration is rewarded on its own track.

#### Acceptance Criteria

1. THE Pin_Service SHALL classify each active `Restaurant` experience into one of three dining tracks from its `grouped_facets` service-type values: **real restaurant** (quick or table service), **festival booth** (`Festival Kiosk`), or **snack/lounge** (the residual).
2. THE Pin_Service SHALL provide a Restaurants ladder counting distinct completed real restaurants, with strictly increasing thresholds and a Prism apex ("All Restaurants" / "Culinary Legend" = 100% of active real restaurants) that serves as the Foodie playstyle pinnacle.
3. THE Pin_Service SHALL provide a Festival Foodie ladder counting distinct festival booths visited over time across all festivals, and in Series 1 SHALL cap this ladder at the Gold tier.
4. THE Pin_Service SHALL provide a light Snacks & Lounges track (a casual count ladder plus themed sets such as pool bars and coffee) over the residual snack/kiosk/lounge experiences, capped at the Gold tier in Series 1.
5. THE three dining tracks SHALL be independent of the attractions ladder and of one another.
6. THE Pin_Service SHALL resolve the Signature (23 venues), Character Dining (13 venues), and Royal Banquet (the princess character-dining venues) flavor sets via curated `upstream_entity_id` sets.

### Requirement 11: Size-Graded Land Completion

**User Story:** As a collector, I want a land's completion Pin to match how much work that land actually is, so that a two-ride land is not as prestigious as a fifteen-ride land.

#### Acceptance Criteria

1. THE Pin_Service SHALL evaluate a land-completion Pin against 100% of that land's Attraction experiences (dining and meets excluded).
2. THE Pin_Service SHALL set a land-completion Pin's tier from the land's active attraction count: 5–7 attractions → `silver`; 8 or more → `gold`; World Showcase → `amethyst`.
3. WHERE a land has 4 or fewer active attractions, THE Pin_Service SHALL NOT define a standalone land-completion Pin for it; its completion SHALL be covered by the containing park's mastery Pin or by a combined-land Pin.
4. THE Pin catalog SHALL retain a Bronze land-starter Pin (visit the land once) for each guest-facing land as a matched set.

### Requirement 12: Completion Apex Pins

**User Story:** As a completionist, I want both an attainable "everything you can ride" apex and a mythic "literally everything" capstone, so that there is always something further to chase.

#### Acceptance Criteria

1. THE Pin_Service SHALL award the "All Attractions" Pin (`prism`, Completionist pinnacle) WHEN the User's completed attractions equal the full set of active Attraction experiences.
2. THE Pin_Service SHALL award the "The Whole Catalog" Pin (`mythic`, 1-of-1) WHEN the User's completed experiences equal the full set of all active experiences.

### Requirement 13: Stable Identifier Matching

**User Story:** As a maintainer, I want explicit experience sets keyed on a stable id, so that renames or reseeds never silently break a Pin.

#### Acceptance Criteria

1. THE Pin catalog SHALL resolve every explicit experience set (coasters, 1971 classics, Deluxe resorts, signature dining, etc.) by stable `upstream_entity_id` (Enterprise_Id), never by experience name.
2. WHERE dining venue-tier classification is required (signature, quick-service, character dining), THE Pin_Service SHALL resolve it via curated `upstream_entity_id` sets rather than the `sub_type` or `grouped_facets` columns.

### Requirement 14: Parks & Places Completion Hierarchy

**User Story:** As a completionist, I want a clear ladder from visiting a place to fully conquering it, so that every level of thoroughness is recognized.

#### Acceptance Criteria

1. THE Pin_Service SHALL award a Bronze park-starter Pin for each of the seven parks (Magic Kingdom, EPCOT, Hollywood Studios, Animal Kingdom, Typhoon Lagoon, Blizzard Beach, Disney Springs) WHEN the User completes their first experience in that park.
2. THE Pin_Service SHALL award a Park Mastery Pin (`amethyst`) for each of the four theme parks WHEN the User completes 100% of that park's active attractions.
3. THE Pin_Service SHALL award a Park Sovereign Pin (`pearl`) for each of the four theme parks WHEN the User completes 100% of that park's active experiences across all categories (attractions, dining, and meets).
4. THE Pin_Service SHALL award a water-park completion Pin (`silver`) for Typhoon Lagoon and for Blizzard Beach at 100% of that park's active attractions, and a Disney Springs completion Pin (`gold`) at 100% of Disney Springs' active attractions.
5. THE Pin_Service SHALL compute every place-completion Pin's target set live from the `park` / `land` fields so it self-adjusts as the catalog changes.
6. THE Pin_Service SHALL award an "All Lands Explorer" Pin (`gold`) WHEN the User has logged at least one experience in each of the 20 theme-park lands (the capstone of the land-starter set).
7. THE Pin_Service SHALL award a "Four Parks Master" Pin (`pearl`) WHEN the User completes 100% of the active attractions across all four theme parks (Magic Kingdom, EPCOT, Hollywood Studios, Animal Kingdom).

### Requirement 15: Social & Community Tracks

**User Story:** As a social player, I want my group rides, reviews, and trip planning rewarded on their own ladders, so that community play is a first-class path.

#### Acceptance Criteria

1. THE Pin_Service SHALL provide a Squad ladder counting confirmed `rode_with_tags` group rides, a Critic ladder counting submitted ratings and notes, and a Trip Organizer ladder counting distinct trips the User organized or participated in.
2. THE Pin_Service SHALL award the `prism` "Legendary Guide" (Social pinnacle) WHEN the User has at least 50 confirmed friend rides AND at least 5 organized trips.

### Requirement 16: Resort Track (Disney-Owned Only)

**User Story:** As a resort collector, I want resort pins to count real Disney resorts, so that a stay at a Good Neighbor hotel doesn't dilute the achievement.

#### Acceptance Criteria

1. THE Pin_Service SHALL count only Disney-owned resorts (a curated set that excludes Good Neighbor / third-party hotels) for every resort Pin.
2. THE Pin_Service SHALL provide a resort-count ladder (Bronze→Amethyst) over distinct completed Disney-owned resorts.
3. THE Pin_Service SHALL award Deluxe Royalty (`pearl`) WHEN all 8 Deluxe resorts are completed, and a `silver` Pin for each transit loop (Monorail, Crescent Lake, Skyliner) WHEN its curated resort set is completed.
4. THE Pin_Service SHALL award the `prism` "Grand Hotelier" (Hotelier pinnacle) WHEN all Disney-owned resorts are completed.

### Requirement 17: Character & Princess Track

**User Story:** As a character fan, I want meet-and-greets rewarded, with a special path for princesses.

#### Acceptance Criteria

1. THE Pin_Service SHALL provide a Character Meet ladder counting distinct completed `Character_Meet` experiences (Bronze 1/3/5 → Silver 10 → Gold 15 → Amethyst 25).
2. THE Pin_Service SHALL award princess Pins from a curated princess-meet set: Royal Encounter (`bronze`, 1), Princess Court (`gold`, 4), and All Princesses (`amethyst`, 8).

### Requirement 18: Single-Day Touring Feats

**User Story:** As a commando tourer, I want single-day feats rewarded, culminating in a true Grand Slam.

#### Acceptance Criteria

1. THE Pin_Service SHALL evaluate single-day feats by grouping `experience_logs` by `visited_on` calendar date, using date granularity only (no time-of-day criteria).
2. THE Pin_Service SHALL award multi-park-day Pins (2 parks → `bronze`, 3 → `gold`, 4 → `amethyst`) and ride-marathon Pins (6 → `silver`, 10 → `gold`, 12 → `amethyst`, 15 → `pearl`).
3. THE Pin_Service SHALL award the `prism` "Grand Slam" (Touring pinnacle) WHEN, on a single calendar date, the User logs rides in all four theme parks AND logs at least 15 total ride experiences.
4. THE Pin_Service SHALL award a "Taste of the Kingdoms" Pin (`gold`) WHEN the User logs a `Restaurant` experience in all four theme parks on the same calendar date.
5. THE Pin_Service SHALL award an "Around the World" Pin (`silver`) WHEN the User logs an experience in all 11 World Showcase countries on the same calendar date.

### Requirement 19: Thematic Sets

**User Story:** As a collector, I want cross-cutting themed sets — ride types, franchises, historical classics — so that there are many varied things to chase beyond raw counts.

#### Acceptance Criteria

1. THE Pin_Service SHALL provide ride-type set Pins derived from the `thrillFactor` facet (Water Rides, Dark Rides, Spinners, Gentle Rides) so their member sets self-adjust as the catalog changes.
2. THE Pin_Service SHALL provide curated named-set Pins resolved by `upstream_entity_id` for sets without a clean facet: Roller Coasters, the 3 Mountains (Space Mountain, Big Thunder Mountain, Expedition Everest), Animatronic Classics, Flight Simulators, Target Shooters, Interstellar Pilot, Rail & Transit, Wildlife Spotter, Comedy & Laughs, Circle-Vision 360 Films, Nighttime Spectaculars, and the 1971 Opening Day Club.
3. THE Pin_Service SHALL provide franchise set Pins from the `interests` facet (Star Wars, Pixar Pals, Classic Characters), a Shows ladder over `category = 'Show'` (Show Enthusiast 5 → Silver, Show Connoisseur 15 → Gold, Show Devotee 30 → Amethyst), and a Parades set via `category = 'Parade'`.
4. THE Pin_Service SHALL provide a World Showcase Traveler set (6 countries → all 11) and award the `prism` "Global Ambassador" (Culture pinnacle) WHEN the User has completed all 11 World Showcase countries, the three 360° films, and 100% of World Nature and World Discovery.
5. THE Pin_Service SHALL tier each thematic set by its completion difficulty (set size and spread), not by its category.

---

## Manual Claim & Award-Wiring Completeness — Added Requirements

> **Revision note (additive).** Requirements 20–21 below add a User-initiated "claim" step on top
> of the existing automatic award pipeline, and close a gap where several Completion-writing
> actions never triggered the Pin award evaluation. No existing requirement is removed, changed,
> or renumbered; Requirement 2 (Synchronous Award Evaluation) and Property 1 (Award Idempotency)
> continue to describe the award itself exactly as before — claiming and reconciliation are
> additive layers on top.

### Requirement 20: Manual Pin Claim

**User Story:** As a User, I want to personally claim a pin the moment I've earned it, so that unlocking feels like a deliberate, celebrated moment rather than something that just silently happened in the background.

#### Acceptance Criteria

1. WHEN a Pin's criteria become satisfied, THE Pin_Service SHALL insert a `user_pins` row recording the award (`awarded_at = now()`) exactly as today, but the Pin SHALL NOT be presented to the User as fully unlocked art until the User has explicitly claimed it (see 20.2). This does not change Requirement 2 or Property 1: awarding remains synchronous, automatic, and idempotent — claiming is an additional User-facing step layered on top of an already-earned award, not a replacement for it.
2. THE Pin_Service SHALL track a separate `claimed_at` timestamp per awarded Pin, distinct from `awarded_at`. A Pin is **ready to claim** when `awarded_at` is set and `claimed_at` is `null`, and **claimed** when both are set.
3. THE App SHALL allow a User to claim a ready-to-claim Pin directly by tapping its tile in the Pin Board grid (no intermediate screen required), which SHALL synchronously set `claimed_at = now()` and immediately present the `PinCelebrationModal` for that Pin.
4. THE Pin_Service SHALL guarantee that claiming is idempotent and can only succeed for a Pin that is already awarded to that User: claiming a Pin that is not yet awarded SHALL fail without creating a partial or premature award, and claiming an already-claimed Pin SHALL be a no-op that returns the existing `claimed_at` rather than erroring or duplicating a celebration.
5. THE Pin Board's tier summary and overall completion percentage (Requirement 3.2) SHALL continue to be computed from `awarded_at` (unlocked/earned), unaffected by whether a Pin has been claimed — a User's stated collection progress SHALL NOT depend on how many earned Pins they have gotten around to claiming.
6. WHERE multiple Pins are ready to claim at once, THE App SHALL let the User claim them one after another without leaving the Pin Board (e.g. dismissing one celebration offers the next ready-to-claim Pin), rather than requiring the User to close and reopen the board per Pin.
7. THE Pin Board grid SHALL render a ready-to-claim Pin with a distinct visual state from both a locked Pin and a claimed Pin, so the User can see at a glance which Pins are waiting to be claimed.

### Requirement 21: Award-Wiring Completeness and Historical Backfill

**User Story:** As a User, I want every way I can complete an experience to count toward my pins — not just some of them — including experiences I completed before this feature or its bug fixes existed.

#### Acceptance Criteria

1. THE Pin_Service SHALL synchronously evaluate and award eligible Pins after every action that writes a Completion, not only the log/rating/note/rode-with-confirm actions named in Requirement 2 — specifically including marking an Experience's completion via `PUT /me/experiences/:id/completion` and logging a Completion via a Trip's `POST /trips/:id/log-entries`.
2. THE Pin_Service SHALL provide an idempotent reconciliation operation that, for any User, evaluates their current activity against the full Pin catalog and inserts an award row (`awarded_at = now()`, `claimed_at = null`) for every Pin whose criteria are already met but which has no existing `user_pins` row for that User. Running this operation multiple times, or concurrently with a synchronous award, SHALL never duplicate an award (Property 1 continues to hold).
3. THE reconciliation operation SHALL NOT be invoked as a side effect of `GET /me/pins` or any other read; the Pin Board read SHALL remain read-only (Requirement 3.1, unchanged).
4. THE reconciliation operation SHALL be reachable as an authenticated, fast-returning internal endpoint suitable for the existing keep-alive cron pattern (async work triggered from a `202`-returning request, per the hosting design's free-tier constraints), so historical completions recorded before this Requirement's fix (Requirement 21.1) or before the pin-collection feature existed can self-heal into ready-to-claim Pins without requiring a manual database operation per User.

---

## Claimable-Pin Discoverability — Added Requirement

> **Revision note (additive).** Requirement 22 below makes ready-to-claim Pins easy to find and
> hard to miss, once a User (or a reconciliation pass) can produce more than one at a time. It
> does not change how a Pin becomes ready to claim (Requirement 20) or how many can be ready at
> once — it only changes how the Pin Board surfaces that existing state. No existing requirement
> is removed, changed, or renumbered.

### Requirement 22: Claimable-Pin Sorting, Filtering, and Attention Signal

**User Story:** As a User with several pins ready to claim at once, I want to find every claimable pin without scrolling the whole board, and I want to know one is waiting for me even before I open the Pin Board.

#### Acceptance Criteria

1. THE Pin Board grid SHALL order ready-to-claim Pins (Requirement 20.2) ahead of every other Pin, regardless of the active tier/track filter; among Pins that are equally ready-to-claim (or equally not), the existing catalog display order (Requirement 8, `pin-roster-v2.html`'s order) SHALL be preserved, so the ordering used elsewhere never becomes unrecognizable.
2. THE Pin Board SHALL provide an "Unlocked" / "Locked" filter, independent of and combinable with the existing tier and track filters, so a User can view only the Pins they own or only the Pins they do not.
3. THE App SHALL surface a claimable-Pin count badge on the Profile tab icon, visible from anywhere in the App, whenever at least one Pin is ready to claim; the badge SHALL be hidden when zero Pins are ready to claim and SHALL never require opening the Pin Board to appear.
4. THE claimable-Pin badge SHALL be computed from the same Pin Board data the grid renders (i.e. from an already-fetched or freshly-fetched `GET /me/pins` response), so the badge count can never disagree with the number of ready-to-claim tiles a User would see upon opening the board.
5. **(Revised — Combined Tab-Bar Badge)** On the bottom navigation bar (Profile tab icon), the notification attention count and the claimable-Pin count SHALL be combined into a single total attention badge (positioned at the standard top-right of the icon) displaying the sum of both counts (or '99+' on overflow, hidden when the combined count is zero), keeping the bottom tab bar clean and uncluttered. On the Profile screen itself, the indicators SHALL remain split between their respective entry controls ('View notifications' showing the notification count, and 'View your pins' showing the claimable-Pin count), so a User can see the breakdown immediately upon opening Profile.
6. THE Profile screen's "View your pins" entry control SHALL carry the same claimable-Pin count badge (Requirement 22.3–22.4) as the Profile tab icon, positioned and styled the same way the existing "View notifications" entry control already carries its Notification_Center Attention_Badge, so a User scanning the Profile screen sees the same at-a-glance signal they'd see on the tab bar.

---

## Claim Ceremony — Added Requirement

> **Revision note (additive).** Requirement 23 below fixes a User-reported mismatch (a
> ready-to-claim tile already rendered in full unlocked color before being tapped, so the
> celebration's "New pin unlocked!" / "Add to collection" copy contradicted what the User had
> already seen), adds a bulk claim action for when several Pins are ready at once (today a User
> must tap and dismiss one tile at a time with no way to see or trigger them together), and
> strengthens the celebration itself. It does not change how or when a Pin becomes ready to claim
> (Requirement 20) or the claim endpoint's contract — it changes only the Pin Board's and
> `PinCelebrationModal`'s presentation of an existing ready-to-claim/claim transition. No existing
> requirement is removed, changed, or renumbered.

### Requirement 23: Claim Reveal, Bulk Claim, and Celebration Fanfare

**User Story:** As a User claiming a pin, I want the tile itself to feel locked until I claim it, a way to claim several at once instead of tapping through them one by one, and a celebration that actually feels like a reward.

#### Acceptance Criteria

1. THE Pin Board grid SHALL render a ready-to-claim Pin (Requirement 20.2) with the same locked/silhouette art treatment as a locked Pin (Requirement 4.5), distinguished from a truly locked Pin only by the "Tap to claim" badge (Requirement 20.7) — a ready-to-claim tile SHALL NOT render the full unlocked artwork before the User claims it, so the claim action is the moment the art is first revealed rather than a redundant confirmation of something already visible.
2. WHEN a claim succeeds, THE App SHALL visibly transition that Pin's art from the locked/silhouette treatment to its full unlocked rendering as part of the claim's on-screen feedback (a reveal), before or as `PinCelebrationModal` is shown.
3. THE `PinCelebrationModal`'s copy and primary action SHALL describe the claim that just happened (e.g. confirming the Pin is now claimed) rather than describing an action still to be taken, so the modal's language does not contradict a User who has already seen the Pin's art revealed.
4. WHERE two or more Pins are ready to claim at once, THE Pin Board SHALL offer a single "Claim all" action, visible near the collection summary, that claims and celebrates every ready-to-claim Pin in turn (reusing the existing one-at-a-time claim queue and celebration, Requirement 20.6) without requiring the User to tap each tile individually. The action SHALL display the current ready-to-claim count (e.g. "Claim all (5)").
5. WHEN more than one Pin is queued for claiming (via "Claim all" or via multiple `celebratePinIds` arriving together), THE `PinCelebrationModal` SHALL display the User's position in the queue (e.g. "2 of 5") so a multi-pin claim sequence is legible as a sequence rather than a rapid, disorienting series of identical popups.
6. WHEN advancing from one queued celebration to the next, THE App SHALL insert a brief pause (~30ms) between dismissing one celebration and revealing the next, so each Pin is still individually presented without sluggish delays.
7. THE `PinCelebrationModal` SHALL present a more celebratory visual treatment on a successful claim than a static reveal — at minimum a brief particle/confetti effect and a pop/scale-in motion on the Pin's art — and SHALL pair it with a haptic pattern distinct from (and more pronounced than) the single success notification used today, honoring reduce-motion by falling back to the haptic and text alone.
8. WHEN more than one Pin is queued in a claim batch, THE `PinCelebrationModal` SHALL provide a "Skip all" action that immediately dismisses the celebration queue, claims all remaining queued Pins in the batch, and reflects them as claimed on the Pin Board without presenting further individual celebration modals.

---

## Pin Showcase — Added Requirement

> **Revision note (additive).** Requirement 5.2 has, since the original design, said the Pin
> Board header shows "featured showcase pins" alongside the collection summary. That clause was
> never implemented: no persisted field, endpoint, or UI exists for a User to choose or display
> favorite Pins, and task 8.1's own completion note describes only the overall-percent and
> per-tier summary — the "featured showcase pins" half of R5.2 was silently dropped. Requirement
> 24 below is the concrete design that clause always needed. It does not change Requirement 5.2's
> wording or renumber it; it fulfills it. No existing requirement is removed or renumbered.

### Requirement 24: Pin Showcase (Display Case)

**User Story:** As a User who has collected pins, I want a physical-feeling pin board where I arrange my favorite claimed pins exactly where I want them — the way a Disney park guest arranges real trading pins on a lanyard or display board — so that my collection feels personal and worth showing off, not just a percentage.

#### Acceptance Criteria

1. THE App SHALL provide a Pin Showcase: a bounded freeform board, separate from the Pin Board's collection grid, onto which a User places any of their own **claimed** Pins (Requirement 20.2 — awarded and claimed; a locked or ready-to-claim Pin cannot be placed).
2. THE App SHALL let a User position each placed Pin at an arbitrary location on the Showcase (a free `(x, y)` placement, not a fixed slot or grid cell), by dragging the Pin to where the User wants it, so the arrangement can resemble a real pin board or lanyard rather than an ordered list.
3. THE Pin_Service SHALL persist each User's Showcase placements (which Pins are placed, and each one's position) so the arrangement survives app restarts and is identical across the User's own sessions.
4. THE App SHALL let a User remove a placed Pin from the Showcase (returning it to the unplaced pool) and add a not-yet-placed claimed Pin to the Showcase, independent of the Pin Board's grid view.
5. THE Pin Showcase SHALL enforce a maximum placed-Pin count (Configuration & Constants: `SHOWCASE_MAX_PINS`) so the board stays a curated highlight rather than a duplicate of the full collection grid; attempting to place beyond the maximum SHALL be rejected without altering any existing placement.
6. WHEN a Pin a User has placed on their Showcase later becomes un-owned (this cannot happen today — no requirement revokes a claimed Pin — but the Pin_Service SHALL NOT assume otherwise), THE Showcase SHALL continue to render only Pins the User currently owns, so a future change elsewhere can never leave a phantom placement on-screen.
7. THE App SHALL surface the User's own Pin Showcase from the Profile screen and the Pin Board screen, and SHALL surface a read-only rendering of a Friend's Pin Showcase from that Friend's profile (Requirement 24.9), gated by the existing owner-or-friend authorization rule (`assertOwnerOrFriend`) used by every other Friend-visible surface in the App.
8. THE Pin Showcase's read (for the owner editing it, or a Friend viewing it) SHALL NOT require fetching the full Pin Board (`GET /me/pins`); it SHALL be its own endpoint returning only the placed Pins and their positions, so viewing or editing a Showcase never depends on Pin Board pagination/filter state.
9. A Friend viewing another User's Pin Showcase SHALL see the identical placement (same Pins, same positions) the owner last saved, in a read-only presentation with no drag/place/remove affordances, and SHALL see nothing at all (an empty-state, not an error) when the owner has placed zero Pins.
10. THE Pin Showcase SHALL render as a cork-board background (a warm tan/brown corkboard texture, not the App's usual card/surface styling) so it visually reads as a physical pin display board rather than another list screen; each placed Pin SHALL render with a small drop shadow so it appears to sit slightly above the board's surface.
11. THE Pin Showcase SHALL prevent two placed Pins from visually overlapping: THE App SHALL reject a drop location (returning the dragged Pin to its last valid position) whenever it would place that Pin's rendered bounds within a minimum clearance (Configuration & Constants: `SHOWCASE_MIN_PIN_CLEARANCE`) of any other already-placed Pin's bounds, so every Pin on the board remains fully visible and individually tappable.
12. THE App SHALL let a User share their Pin Showcase with a Friend using the App's existing Share mechanism (the same `POST /me/shares` / Inbox delivery already used for Experience and Progress shares), so a Showcase share appears in the recipient's Inbox exactly like any other share.
13. WHEN a Friend selects a Pin Showcase share from their Inbox, THE App SHALL navigate directly to the sharing User's read-only Pin Showcase (Requirement 24.9) — not to that User's Profile or Pin Board first — mirroring how an existing Progress share deep-links straight to the Friend_Profile_View's Comparison pane rather than a general profile landing.
14. WHEN the sharing User's Pin Showcase has changed since the share was sent, THE Friend selecting that share SHALL see the CURRENT Showcase (live, not a send-time snapshot) — unlike the App's existing `progress` share kind, which snapshots the sender's stats at send time, a Showcase share is a pointer to a live, evolving personal display rather than a point-in-time achievement record. This Requirement does not change the existing snapshot behavior of any other share kind.
15. THE Pin Showcase unplaced pins tray SHALL provide search filtering and sorting controls (by catalog display order, name alphabetically, and tier rank), allowing the User to quickly locate unplaced pins in their collection.
16. THE Pin Showcase SHALL offer an expandable browse view (modal sheet) displaying all available unplaced pins in a multi-column grid with full-sized artwork, pin names, tier badges, and track metadata, overcoming single-row scroll constraints.
17. THE Pin Showcase SHALL allow a User to tap an unplaced pin (in the tray or the expanded browse view) to automatically place it at the first available non-overlapping coordinate on the board, in addition to supporting manual drag-and-drop placement.
