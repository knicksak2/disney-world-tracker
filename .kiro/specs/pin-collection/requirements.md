# Requirements Document

## Introduction

The Pin Collection system introduces gamification, achievements, and collectible digital trading pins to the Disney World Tracker. Users earn beautifully rendered pins across six distinct tiers (**bronze**, **silver**, **gold**, **amethyst**, **pearl**, and **prism**) by exploring parks, conquering roller coasters, sampling World Showcase country pavilions, dining at restaurants, staying at resorts, and touring efficiently with friends.

This feature consumes the `experience-activity-logging` data foundation to evaluate both lifetime catalog milestones and single-day touring feats (such as *Four Parks in One Day* or *15-Ride Marathon*), rendering each pin via a parametric SVG system with rich metallic frames, recessed enamel, and intra-tier visual upgrades.

## Cross-Spec Dependencies

- **`experience-activity-logging`**: Must be implemented prior to or alongside this spec. Single-day speed and marathon challenges depend on `experience_logs` event timestamps (`visited_on`).

## Glossary

- **Pin**: A collectible digital badge awarded to a User upon completing a specific Challenge.
- **Challenge**: A deterministic set of criteria evaluated against a User's logged experiences, ratings, trips, and friends.
- **Tier**: The prestige level of a Pin, locked to the 6-tier system:
  - 🥉 **Bronze**: Starter, discovery, and early progression milestones (167 pins).
  - 🥈 **Silver**: Dedicated vacation milestones, land completions, and mid-tier sets (167 pins).
  - 🥇 **Gold**: Full park ride mastery, mountain sets, 1971 classics, and 10-ride days (167 pins).
  - 💜 **Amethyst**: Elite marathon feats, 50% all 4 parks, 11 World Showcase countries (167 pins).
  - 🤍 **Pearl**: Multi-year legendary achievements, 350+ experiences, all Deluxe resorts (167 pins).
  - 🌈 **Prism**: The 5 Mythic Crown Jewels representing the pinnacle of each major Disney playstyle (167 pins).
- **Contained_Pin**: A pin rendered within a circular disc, shield, or geometric plaque, used for abstract milestones, ladders, and statistical counts.
- **Die_Cut_Pin**: A pin rendered as an outline silhouette of a physical landmark, vehicle, coaster, or character emblem, screened at design time via `screen.js` to ensure structural integrity and enamel survival.
- **Pin_Board**: The mobile interface displaying a User's collection of earned and locked pins with filters and progress bars.
- **Intra_Tier_Progression**: The visual rule where each successive rung of a tiered ladder adds progressive ornamental detail (extra sparks, halo rays, engraved rims, or gem pips) even within the same metal tier.
- **Pin_Service**: The backend service managing challenge definitions, evaluations, and user pin awards.
- **Attribution_Surface**: An in-app credits screen honoring the CC BY 3.0 licensing requirements for motif artwork.

## Requirements

### Requirement 1: The 136-Pin Challenge Evaluation Rules

**User Story:** As a User, I want my park activities to automatically earn diverse, exciting pins across all Disney World experiences, so that I feel rewarded for exploring every corner of the resort.

#### Acceptance Criteria

1. THE Pin_Service SHALL evaluate and award Pins across the 136 defined challenges spanning the 6 tiers (46 Bronze, 36 Silver, 24 Gold, 16 Amethyst, 9 Pearl, 5 Prism).
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

1. WHEN a User requests their Pin Board (`GET /me/pins`), THE Pin_Service SHALL return all 167 Pins, each marked as `unlocked: true` (with `awarded_at` timestamp) or `unlocked: false` (with `current_value`, `target_value`, and `percent_complete`).
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
