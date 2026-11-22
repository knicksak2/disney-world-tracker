# Requirements Document

## Introduction

Disney World Tracker now spans roughly 50 feature specs across catalog browsing, live wait times, crowd predictions, multi-day trip planning, budgets, dining plan math, food/ride logging, lists, collectible pins, Hidden Mickeys, and social sharing. First-time user feedback shows that landing straight on a dense dashboard with zero orientation — combined with repeated controls across Home, Explore, `MagicFab`, and `You` — leaves new users unsure where to start or where features live.

This spec adds a **First-Run Onboarding & App Clarity** package that guides new accounts into the app in under 60 seconds without locking features behind a "Simple Mode" toggle, breaking muscle memory on returning screens, or interrupting existing users who already have activity.

**Design stance (agreed with the owner):**

- **Intent-first, learn-by-doing onboarding — no modal coach-mark tours.** Right after registration, a skippable 3-step flow asks why the user is here, lets them take one rewarding 20-second action (start a trip, pick today's park, or tap iconic rides they've already ridden to unlock their first pin), and shows a concise 4-tab + `MagicFab` map.
- **Per-user backend persistence with first-read veteran grandfathering.** Onboarding state and starter-checklist dismissal live in Postgres (`user_onboarding`) so they sync across devices and reinstalls. On a User's first `GET /me/onboarding` call (when no `user_onboarding` row exists yet), if the User already has at least one completion, visit log, food log, or trip membership, the server persists `grandfathered_at = NOW()` so that User is permanently treated as a veteran and never interrupted — even across the API-deploy-to-App-Store rollout gap or if they later delete activity. Dormant existing accounts with zero activity see onboarding once; Users who joined a trip on an older build before updating are grandfathered on first read.
- **Historical starter rides skip `experience_logs` by design.** Step 2's bulk starter check-in writes to `completions` (including `user_tz`) and intentionally omits `experience_logs` (the same `skipLog` precedent used by `trips/repo.ts`), because `experience_logs` drives dated visit timelines and single-day multi-park pins (`bronze_two_parks` / `singleDay` in `pins/evaluator.ts`). Tapping past rides across 4 parks during onboarding must not stamp fake visits on today's timeline or falsely award "Four Parks in One Day."
- **Replay mode is read-only (Tab Map only).** Opening "App Tour & Quick Guide" from Settings shows only the Step 3 Tab Map so replaying never duplicates trips or completions.
- **One clear job per surface.** Home focuses on today's context, search, favorites, and a compact 4-park live pulse strip; `Explore` owns the full parks/resorts/crowds directory; `MagicFab` owns fast logging from any tab; `Trips` owns group planning; `You` owns personal progress (`Pins | Food | Lists | Stats`); and `Crew & Settings` (`YouAndCrewStack`) has one unified header entry reachable from Home and `You`.
- **Preserve `TripDetailScreen`'s varied visual layout.** Do not convert Trip tools into a rotating phase grid or generic accordions — keep its fixed visual landmarks and apply targeted micro-polish (itinerary row subtitles, slimmer empty states, and fixing the `VACATION UNDERWAY` label on upcoming trips).
- **Hidden Mickeys stays in its 6 existing surfaces.** Removing the Hidden Mickeys banner from Home does not relocate or remove the feature; it remains reachable from Explore, `MagicFab`, `You › Pins`, `Trips › Prep & Memories`, Experience Detail pages, and `HomeSearchBar`.

**Explicitly deferred (not built by this spec):**

- A "Simple Mode / Advanced Mode" toggle.
- Spotlight / tooltip coach-mark overlays anchored to tab-bar coordinates.
- Phase-rotating navigation grids or accordion drawers inside `TripDetailScreen`.
- A "New Trip Quick Start" checklist card inside `TripDetailScreen`.
- Rewriting `ExploreHubScreen` or `QuickActionSheet` action order.

## Glossary

- **App**: The mobile client (`apps/mobile`).
- **User**: An authenticated user of the App.
- **Onboarding_Service**: The backend service (`apps/api/src/services/onboarding/`) owning `user_onboarding`, `GET /me/onboarding`, `PATCH /me/onboarding`, and `POST /me/onboarding/quick-completions`.
- **Onboarding_State**: The server-computed `OnboardingStateDTO` combining stored `user_onboarding` fields with live-derived checklist flags and veteran grandfathering.
- **Onboarding_Intent**: One of four closed values: `plan`, `in_park`, `track_history`, or `explore`.
- **Theme_Park**: One of the four Walt Disney World theme parks: `Magic Kingdom`, `EPCOT`, `Hollywood Studios`, or `Animal Kingdom`.
- **Veteran_User**: A User whose `user_onboarding` row has `grandfathered_at IS NOT NULL`, stamped once on their first `GET /me/onboarding` read when no row existed and they already had at least one row in `completions`, `experience_logs`, `food_item_logs`, or `active_trip_memberships` (the roster view over `trip_memberships`).
- **Starter_Checklist**: The 4-item "Start Here" card shown on `HomeScreen` for new Users until dismissed or all 4 items are completed.
- **Starter_Checklist_Item**: One of four live-derived booleans: `loggedFirstExperience`, `starredFavorite`, `hasTrip`, `claimedPin`.
- **Quick_Completions**: A single batch request (`POST /me/onboarding/quick-completions`) that marks 1 to 20 active catalog Experiences completed for the User and runs the Pin award hook once.
- **Popular_Tools**: The curated set of 5 client-side app tool shortcuts displayed in `HomeSearchBar` when focused with an empty query.
- **Crew_Entry**: The unified header navigation control opening `YouAndCrew` (`YouAndCrewMain`) from both `HomeScreen` and `CollectionScreen`.

## Requirements

### Requirement 1: Onboarding State Persistence and Veteran Grandfathering

**User Story:** As a User, I want my onboarding and starter-checklist status saved to my account across devices, and if I am already an active User I do not want to be interrupted by a first-run screen after an app update.

#### Acceptance Criteria

1. THE Onboarding_Service SHALL store per-user onboarding state in `user_onboarding` keyed by `user_id` referencing `users(id) ON DELETE CASCADE`, with nullable columns `completed_at`, `skipped_at`, `grandfathered_at`, `initial_intent`, `selected_park`, `starter_checklist_dismissed_at`, and non-null `updated_at`.
2. THE database SHALL constrain `initial_intent` to `('plan', 'in_park', 'track_history', 'explore')` (or `NULL`) and `selected_park` to `('Magic Kingdom', 'EPCOT', 'Hollywood Studios', 'Animal Kingdom')` (or `NULL`).
3. WHEN a User requests `GET /me/onboarding` and has no `user_onboarding` row yet, THE Onboarding_Service SHALL check whether the User already has at least one row in `completions`, `experience_logs`, `food_item_logs`, or `active_trip_memberships` (the roster view over `trip_memberships`, required by the roster visibility guard), and SHALL insert a `user_onboarding` row with `grandfathered_at = NOW()` if any such activity exists or `grandfathered_at = NULL` otherwise, using `ON CONFLICT (user_id) DO NOTHING` so concurrent first reads are safe and idempotent. THE Onboarding_Service SHALL then return an `OnboardingStateDTO` containing `needsOnboarding`, `completedAt`, `skippedAt`, `initialIntent`, `selectedPark`, `starterChecklistDismissedAt`, `checklist`, and `showStarterChecklist`.
4. THE Onboarding_Service SHALL compute `checklist` at read time from existing tables:
   - `loggedFirstExperience`: true when the User has at least one row in `completions`, `experience_logs`, or `food_item_logs`.
   - `starredFavorite`: true when the User has at least one row in `experience_favorites`.
   - `hasTrip`: true when the User has at least one row in `active_trip_memberships`.
   - `claimedPin`: true when the User has at least one row in `user_pins` with `claimed_at IS NOT NULL`.
5. THE Onboarding_Service SHALL compute `needsOnboarding` as `false` whenever `grandfathered_at IS NOT NULL` OR `completed_at IS NOT NULL` OR `skipped_at IS NOT NULL`; otherwise `needsOnboarding` SHALL be `true`. Because a brand-new User's row is initialized with `grandfathered_at = NULL` on their first read, creating a Trip or logging starter rides in Step 2 SHALL NOT flip `needsOnboarding` or `showStarterChecklist` to `false` mid-onboarding, and a Veteran_User whose row has `grandfathered_at IS NOT NULL` SHALL remain grandfathered even if they later delete activity.
6. THE Onboarding_Service SHALL compute `showStarterChecklist` as `true` if and only if `grandfathered_at IS NULL`, `starter_checklist_dismissed_at IS NULL`, and at least one Starter_Checklist_Item is `false`.
7. WHEN a User requests `PATCH /me/onboarding` with any subset of `{ initialIntent, selectedPark, complete, skip, dismissStarterChecklist, restoreStarterChecklist }`, THE Onboarding_Service SHALL validate the body with a strict Zod schema, upsert the User's `user_onboarding` row (preserving any existing `grandfathered_at`, or initializing the row with first-read grandfathering if no row exists yet), and return the updated `OnboardingStateDTO`.
8. WHEN `complete: true` is sent and `completed_at` is already non-null, THE Onboarding_Service SHALL preserve the original `completed_at` timestamp (idempotent). WHEN `skip: true` is sent and `skipped_at` is already non-null, THE Onboarding_Service SHALL preserve the original `skipped_at` timestamp.
9. WHEN `dismissStarterChecklist: true` is sent, THE Onboarding_Service SHALL set `starter_checklist_dismissed_at = COALESCE(starter_checklist_dismissed_at, NOW())`. WHEN `restoreStarterChecklist: true` is sent, THE Onboarding_Service SHALL set `starter_checklist_dismissed_at = NULL`. Sending both `dismissStarterChecklist: true` and `restoreStarterChecklist: true` in the same request SHALL be rejected with `validation_failed`.
10. IF a request to `GET /me/onboarding` or `PATCH /me/onboarding` has no valid session, THEN THE Onboarding_Service SHALL reject it with HTTP 401 (`unauthorized`) before any database work.

### Requirement 2: Bulk Starter Completions

**User Story:** As a new User in Step 2 of onboarding, I want to tap rides I have already ridden and log them in one tap so my stats and first collectible pin populate immediately.

#### Acceptance Criteria

1. WHEN a User requests `POST /me/onboarding/quick-completions` with `{ experienceIds, userTz }`, THE Onboarding_Service SHALL validate that `experienceIds` is an array of 1 to 20 UUIDs and `userTz` passes `ianaTzSchema` and resolves via `formatYmdInTimeZone`; otherwise it SHALL reject the request with HTTP 400 (`validation_failed`).
2. THE Onboarding_Service SHALL deduplicate `experienceIds` before writing and verify that every supplied id references an existing `experiences` row with `active = TRUE`; IF any id is missing or inactive, THEN THE Onboarding_Service SHALL reject the whole batch with HTTP 404 (`experience_not_found`) without inserting any rows.
3. THE Onboarding_Service SHALL insert rows into `completions (user_id, experience_id, completed_on, user_tz)` for all requested ids inside a single transaction using `completed_on` derived via `formatYmdInTimeZone(clock(), userTz)`, `user_tz` set to the validated `userTz`, and `ON CONFLICT (user_id, experience_id) DO NOTHING`, so already-completed experiences are preserved untouched. THE Onboarding_Service SHALL NOT insert rows into `experience_logs` during quick-completions (preventing historical check-ins across multiple parks from stamping fake dated visits or falsely awarding `singleDay` multi-park pins).
4. AFTER the batch transaction commits, THE Onboarding_Service SHALL invoke the existing Pin award hook (`awardPins`) at most once for the batch (best-effort — a Pin award failure SHALL NOT fail the HTTP 200 response) and SHALL return `{ addedCount, alreadyCompletedCount, newlyAwardedPinIds }`.
5. IF the request has no valid session, THEN THE Onboarding_Service SHALL reject it with HTTP 401 (`unauthorized`) before any database work.

### Requirement 3: Account Deletion Disposition and Privacy Policy

**User Story:** As a User who deletes my account, I want my onboarding preferences removed with the rest of my personal data and accurately disclosed in the privacy policy so account deletion remains complete and compliant.

#### Acceptance Criteria

1. THE Account_Deletion_Service SHALL register `user_onboarding.user_id` in `DISPOSITIONS` (`apps/api/src/services/accountDeletion/dispositions.ts`) with disposition `delete` in stage 4 (`chunkColumns: ['user_id']`, `today: 'cascade'`, `nullable: false`).
2. WHEN a User account is purged, THE Account_Deletion_Service SHALL delete that User's `user_onboarding` row cleanly without leaving orphaned state.
3. BOTH copies of the Privacy Policy (`docs/privacy-policy.md` and `renderPrivacyPolicyHtml` in `apps/api/src/services/accountDeletion/webPages.ts`) SHALL disclose that onboarding preferences (`initial_intent`, `selected_park`, and checklist dismissal state) are stored with the account and deleted on account deletion.

### Requirement 4: Intent-Based 3-Step First-Run Onboarding Flow

**User Story:** As a brand-new User signing up for the first time, I want a brief, interactive welcome flow tailored to why I'm here so I understand the app and immediately get value from it.

#### Acceptance Criteria

1. WHEN an authenticated User loads the App and `GET /me/onboarding` returns `needsOnboarding: true`, THE App SHALL present `OnboardingFlow` above `MainTabs` automatically. WHILE `GET /me/onboarding` is loading for a session with no cached value, THE App SHALL NOT flash `OnboardingFlow` for Veteran_Users; IF `GET /me/onboarding` fails, THE App SHALL allow normal access to `MainTabs` without blocking the User.
2. THE `OnboardingFlow` SHALL display a 3-step progress indicator and a persistent top-right `Skip` control on all three steps. WHEN the User taps `Skip`, THE App SHALL call `PATCH /me/onboarding` with `{ skip: true }` (plus any `initialIntent` already chosen) and dismiss `OnboardingFlow` to `Home`.
3. ON Step 1 ("What brings you here?"), THE `OnboardingFlow` SHALL present 4 selectable intent cards (`plan`, `in_park`, `track_history`, `explore`) with a default selection or clear disabled-until-selected primary button, and SHALL advance to Step 2 when the User taps Continue.
4. ON Step 2, THE `OnboardingFlow` SHALL adapt to the chosen `Onboarding_Intent`:
   - For `plan`: a minimal Quick Trip Starter (trip name + optional start/end dates validated against `tripCreateSchema`) that calls `POST /me/trips` on Continue, plus a secondary "I'll create a trip later" skip-step link.
   - For `in_park`: a 2×2 Theme_Park picker displaying live average waits (reusing `['park-live', park]`) so the User selects today's park.
   - For `track_history` or `explore`: an interactive starter grid of up to 12 iconic active rides (`category === 'Ride'`) resolved from the cached unpaginated catalog (`GET /catalog`, query key `['catalog', 'all']`), displaying a live selection counter and a "First Pin Ready!" banner once at least 1 ride is selected (backed by the real 1-experience Bronze Starter pins `bronze_park_starter_*` / `bronze_land_starter_*` in `packages/shared/src/pins/catalog.ts`); tapping Continue calls `POST /me/onboarding/quick-completions` when ≥1 ride is selected (or skips the API call when 0 rides are selected).
5. ON Step 3 ("Here's where things live"), THE `OnboardingFlow` SHALL display a 5-row map covering the 4 bottom tabs (`Home`, `Explore`, `Trips`, `You`) plus the center `MagicFab` button, with a primary finish CTA tailored to Step 1/2:
   - `plan` (when a trip was created in Step 2) → calls `PATCH /me/onboarding` (`complete: true`) and navigates to `Trips › TripDetail` for the new trip; if no trip was created → navigates to `Trips › TripsList`.
   - `in_park` → calls `PATCH /me/onboarding` (`complete: true`, `selectedPark`) and navigates to `Explore › LiveWaits` for the chosen park.
   - `track_history` or `explore` → calls `PATCH /me/onboarding` (`complete: true`) and navigates to `Home`.
6. THE App SHALL provide an **"App Tour & Quick Guide"** entry in `YouAndCrewScreen` (Settings) that opens `OnboardingFlow` in read-only `replay` mode, displaying **Step 3 (the 4-tab + `MagicFab` map) only** with a close CTA (`"Got it"`), performing zero API mutations (no trip creation, no quick-completions, no `PATCH /me/onboarding`).
6a. *(Amendment — Settings Screen Relocation & `__DEV__` Gating):* The **"App Tour & Quick Guide"** row (`settings-app-tour-btn`) lives on `SettingsScreen` (`YouAndCrewStack` › `Settings`, opened from the `YouAndCrewScreen` header gear button). Any QA onboarding preview entries (`Preview Full Onboarding` and `HomeSearchBar`'s `Preview Onboarding` shortcut) SHALL be gated behind `__DEV__`.

### Requirement 5: Cold-Start "Start Here" Checklist on Home

**User Story:** As a new User landing on Home for the first time, I want a short checklist of the 4 core actions so I always know what to try next and can dismiss it once I'm comfortable.

#### Acceptance Criteria

1. WHEN `GET /me/onboarding` returns `showStarterChecklist: true`, THE `HomeScreen` SHALL render `StartHereCard` directly below `HomeSearchBar` and above the Vacation Context / Park Pulse sections.
2. THE `StartHereCard` SHALL display a progress bar (`N of 4`) and 4 rows backed by `OnboardingStateDTO.checklist`:
   - **Log your first ride or snack** (`loggedFirstExperience`) → opens the Home ride-logging picker.
   - **Star a favorite ride** (`starredFavorite`) → navigates to `Explore › CatalogList`.
   - **Create or join a trip** (`hasTrip`) → navigates to `Trips › TripsList`.
   - **Claim your first pin** (`claimedPin`) → navigates to `Collection › PinBoard`.
3. WHEN the User taps `Dismiss` on `StartHereCard`, THE App SHALL call `PATCH /me/onboarding` with `{ dismissStarterChecklist: true }`, optimistically hide the card, and invalidate `['me', 'onboarding']`.
4. WHEN all 4 checklist items become `true`, THE `StartHereCard` SHALL cease rendering automatically on the next refresh/invalidation without requiring manual dismissal.
5. THE `YouAndCrewScreen` Settings section SHALL include a **"Show Start Here checklist on Home"** action whenever `starterChecklistDismissedAt !== null` and at least one item remains incomplete, calling `PATCH /me/onboarding` with `{ restoreStarterChecklist: true }`.
5a. *(Amendment — Settings Screen Relocation & `__DEV__` Gating):* The **"Show Start Here checklist on Home"** action (`settings-restore-starter-btn`) lives in the Help & Legal group on `SettingsScreen` (`YouAndCrewStack` › `Settings`), and the QA **"Preview Start Here Checklist on Home"** toggle (`settings-preview-starter-btn`) SHALL be gated behind `__DEV__`.

### Requirement 6: Home Screen Declutter and Clear Surface Ownership

**User Story:** As a User opening Home, I want a calm, scannable dashboard that doesn't repeat controls already owned by Explore and `MagicFab`.

#### Acceptance Criteria

1. THE `HomeThemeParksSection` on `HomeScreen` SHALL replace the large 2×2 theme-park landmark cards with a compact single-row 4-park **Live Park Pulse** strip (`MK`, `EP`, `HS`, `AK` with live average wait badges), where tapping any park navigates to `Explore › DestinationScreen` for that park, accompanied by an `All Live Waits ›` link.
2. THE `HomeThemeParksSection` SHALL NOT render the duplicate `Log a Ride` and `Log Food` buttons below the parks strip (quick logging remains 1 tap away from every tab via `MagicFab` and from `StartHereCard` for new Users).
3. THE `HomeThemeParksSection` SHALL NOT render the `HIDDEN MICKEYS HUNT` banner on `HomeScreen` (Hidden Mickeys remains accessible via its 6 existing entry points: `ExploreHubScreen`, `QuickActionSheet`, `CollectionScreen`, `TripDetailScreen`, `ExperienceDetailScreen`, and `HomeSearchBar`).
4. WHEN a User has zero Favorites, THE `HomeFavoritesSection` SHALL render a compact 1-card empty prompt ("Watch your favorite waits — Star any ride in Explore to pin its live wait time here") with a tap target opening `Explore` instead of rendering blank space or an unexplained header.

### Requirement 7: `HomeSearchBar` First-Time Discoverability Polish

**User Story:** As a User who doesn't yet know everything the app can do or where a tool lives, I want Home search to suggest popular tools before I type, still surface trip tools before I create a trip, and show me which tab each tool lives in.

#### Acceptance Criteria

1. WHEN `HomeSearchBar` is focused and the trimmed query is empty, THE App SHALL render a **Popular Tools** suggestions panel listing 5 curated shortcuts (`Live Waits`, `Crowd Calendar`, `Dining Plan Calculator`, `Hidden Mickeys`, `Pins & Showcase`) with one-tap navigation and a close/dismiss affordance on blur or tap outside.
2. THE `HomeSearchBar` SHALL include trip-scoped tools (`Trip Schedule Builder`, `Trip Reservations`, `Packing List`, `Trip Budget`, `Trip Expenses & Balances`, `Trip Dining Plan`, `Booking Timeline`, `Trip Activity & Feed`, `Trip Photo Album`, `Trip Summary & Recap`, `Trip Must-Dos & Planned List`, `Trip Crew & Members`) in search results EVEN WHEN `activeOrUpcomingTrips.length === 0`.
3. WHEN a User with 0 trips taps a trip-scoped tool shortcut in `HomeSearchBar`, THE App SHALL present a concise modal prompt explaining that the tool lives inside a Trip with a primary button navigating to `Trips › TripsList` (to create a trip) and a Cancel button.
4. WHEN `HomeSearchBar` displays non-empty query results, THE App SHALL separate matching sections with explicit headers (`Your Trips`, `App Tools`, `Experiences & Dining`) and display a breadcrumb path on every App Tool row (for example `Explore › Crowds`, `Trips › Budget`, `You › Pins`) so results teach where features live.
5. WHEN the trimmed query has at least 2 characters, THE `HomeSearchBar` SHALL query `GET /catalog?q=<query>` (debounced 250 ms) for the `Experiences & Dining` section so backend search aliases (such as `RotR`, `SDD`, `ToT`, `People Mover`) match identically to `ExploreHubScreen`.

### Requirement 8: `You` Tab Cold-Start and Unified `Crew & Settings` Entry

**User Story:** As a new User tapping the `You` tab, I want an understandable empty state that explains how to earn pins instead of an empty corkboard, and I want one clear place to open Crew & Settings.

#### Acceptance Criteria

1. THE `CollectionScreen` (`You` tab) SHALL render exactly 4 top-level segments: `Pins`, `Food`, `Lists`, and `Stats` (removing the 5th `crew` segment).
2. THE `CollectionScreen` header SHALL include a `Crew & Settings` control (using the shared `AvatarChip` / header pill pattern) beside `MyPhotosEntry`, navigating directly to `YouAndCrew` (`YouAndCrewMain`).
3. THE `AvatarChip` on `HomeScreen` (and the `Profile, Crew & Settings` shortcut in `HomeSearchBar`) SHALL navigate directly to `YouAndCrew` (`YouAndCrewMain`), giving `Crew & Settings` one consistent destination across the App.
4. WHEN `activeTab === 'pins'` AND `totalUnlocked === 0` AND `claimableCount === 0` (and the pin board query has resolved), THE `CollectionScreen` SHALL replace the empty wooden Pin Showcase corkboard with an **"Earn Your First Collectible Pin"** card explaining that pins unlock automatically when logging rides, snacks, and resorts, with a primary CTA button to log a first ride/experience, followed by the existing "Badges in Reach" / easiest Bronze pins section.
5. WHEN `totalUnlocked > 0` OR `claimableCount > 0`, THE `CollectionScreen` SHALL render the existing Pin Showcase corkboard and claim banner unchanged.

### Requirement 9: `TripDetailScreen` Micro-Polish (Preserving Existing Layout)

**User Story:** As a User opening a Trip for the first time, I want to immediately tell the difference between Planned List, Schedule Builder, and Reservations, and I want the summary banner copy to match whether my trip is upcoming or active.

#### Acceptance Criteria

1. THE `TripDetailScreen` SHALL retain its existing fixed section order and varied visual shapes (Stay/Crew hero, `ITINERARY & DAYS`, `TRIP ACTIVITY`, `SAVED LISTS & FAVORITES`, 3-up `FINANCES`, `PREP & MEMORIES`, and bottom Summary card) with no phase-based tile shuffling.
2. IN `ITINERARY & DAYS`, THE `TripDetailScreen` SHALL display concise single-line subtitles beneath the three tool titles:
   - `Schedule Builder`: `"Order & optimize each park day"`
   - `Planned List`: `"Must-do rides & dining wish list"`
   - `Reservations`: `"Booked dining & Lightning Lanes"`
3. IN the bottom Vacation Progress / Summary card, WHEN `trip.status === 'upcoming'`, THE `TripDetailScreen` SHALL NOT display `"VACATION UNDERWAY"`; instead it SHALL display `"UPCOMING TRIP"` (when `completedCount === 0`) or `"TRIP PROGRESS"` (when `completedCount > 0`), with subtitle copy appropriate to an upcoming trip (e.g., `"Preview group stats, countdown & shared picks ›"`). WHEN `trip.status === 'active'`, it SHALL continue to display `"VACATION UNDERWAY"` (or `"VACATION MILESTONE"` when `completedCount > 0`).
4. WHEN `trip.status === 'upcoming'` and the Trip has zero logged completions and zero attached lists/group favorites, THE `Saved Lists & Favorites` empty message SHALL render compactly (reduced vertical padding) so `FINANCES` and `PREP & MEMORIES` remain easier to reach on first open.
