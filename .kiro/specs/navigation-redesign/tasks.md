# Implementation Plan: Navigation Redesign

## Overview

This plan implements the navigation redesign as two mostly-independent slices that converge at the
mobile navigation shell: (1) a net-new backend + mobile Live Waits vertical slice, and (2) a pure
navigation-relocation slice that rebuilds the tab bar and re-parents existing, unchanged screens under
new stacks. Building Live Waits first means the Quick_Action_Sheet's "Check Live Waits" action has a
real destination to wire to when the navigation shell goes in; building the pure relocation pieces
(new stacks, moved screens) before touching `RootNavigator.tsx` means the final tab-bar swap is a single
well-tested cutover rather than an incremental half-migrated state.

Work proceeds: shared DTOs → API Live Waits service/route → mobile pure cores (Live Waits view logic,
quick-action list, default-park resolution) → new mobile stacks (`CollectionStack`, `YouAndCrewStack`,
`ExploreStack` extension) hosting existing screens unchanged → new navigation-shell components
(`AvatarChip`, `NotificationBell`, `MagicFab`, `QuickActionSheet`) → the `RootNavigator.tsx` cutover →
the two new landing screens (`LiveWaitsScreen` composition, `CollectionScreen`, `YouAndCrewScreen`) →
regression guard for the Trips section structure → final checkpoint.

Property-based tests are written for the pure cores per the design's Correctness Properties. All test
sub-tasks are marked optional with `*`.

## Tasks

- [x] 1. Add the Park_Live_Snapshot shared DTO
  - [x] 1.1 Add `ParkLiveEntryDTO` / `ParkLiveSnapshotDTO` and their Zod schemas
    - Create `packages/shared/src/schemas/ParkLive.ts` with `parkLiveEntrySchema` and `parkLiveSnapshotSchema` per the design's Data Models section; export inferred types and the schemas from the package index
    - _Requirements: 9.1_
  - [x] 1.2 Add navigation/Live-Waits constants
    - Create `packages/shared/src/constants/navigation.ts` with `WALK_ON_THRESHOLD_MINUTES = 25` and `HEADLINER_THRILL_FACET_VALUES` (placeholder list, see task 1.3); export from the package index
    - _Requirements: Configuration & Constants_
  - [x] 1.3 Confirm the real `thrillFactor` facet values against synced data before finalizing `HEADLINER_THRILL_FACET_VALUES`
    - Query the local or hosted catalog's persisted `grouped_facets.thrillFactor` values (via `npm run sync` output or a direct DB read) and pin the exact high-intensity facet id(s) as the constant's literal list; do not guess or use a threshold comparison
    - _Requirements: 10.5, Configuration & Constants_
  - [x] 1.4 Write schema unit tests
    - Verify `parkLiveSnapshotSchema` accepts a well-formed snapshot and rejects a negative/out-of-range `waitMinutes`, and that `HEADLINER_THRILL_FACET_VALUES` is non-empty
    - _Requirements: 9.1_
  - [x] 1.5 (Amendment, Requirement 10.5a) Replace `HEADLINER_THRILL_FACET_VALUES` with a curated `HEADLINER_EXPERIENCE_IDS` allowlist
    - A live-data audit of task 1.3's facet-based constant found most matches were Typhoon Lagoon/Blizzard Beach water slides (tagged `thrill-rides` for sensory reasons) while unambiguous headliners (Haunted Mansion, Pirates of the Caribbean, Frozen Ever After) were excluded (tagged `slow-rides`/`dark`). Replace `HEADLINER_THRILL_FACET_VALUES` with `HEADLINER_EXPERIENCE_IDS: readonly string[]` keyed by each Experience's stable internal `id` (not `upstream_entity_id` — `ExperienceDTO` does not carry that field over the wire), curated per park by cross-referencing `ride_shapes.baseline_wait_minutes` ranking against Disney's published Lightning Lane Tier 1/Single Pass lists, following the same hand-maintained-list discipline as `catalog-taxonomy-cleanup`'s `Category_Overrides`; remove the old constant and its export entirely (no deprecation period — this is a pre-launch definitional correction, not a wire-contract change visible to any shipped client)
    - _Requirements: 10.5a, Configuration & Constants_
  - [x] 1.6 (Amendment) Update `isHeadliner` in `parkLiveView.ts` to check `HEADLINER_EXPERIENCE_IDS.includes(experience.id)` instead of the `thrillFactor` facet intersection; update the schema/constants unit test (task 1.4) to assert `HEADLINER_EXPERIENCE_IDS` is non-empty instead of asserting facet-id membership
    - _Requirements: 10.5a_

- [x] 2. Build the API Park_Live_Snapshot service
  - [x] 2.1 Implement `ParkGuidResolver` (`services/live/parkResolve.ts`)
    - Mirror `themeParksDirectory.ts`'s structure: one `catalogClient.getDestinations()` call, find the WDW destination, index `park.name` (through the existing Park-name normalization) → `park.id`, cache with a TTL + de-duplicated in-flight build, degrade to an empty map on build failure
    - _Requirements: 9.2_
  - [x] 2.2 Implement `ParkLiveCache` (`services/live/parkLiveCache.ts`)
    - Mirror `cache.ts`'s `LiveCache` exactly, with key prefix `park-live:v1:{park}`, `PARK_LIVE_CACHE_TTL_SECONDS = 300` (freshness, evaluated in application code) and `PARK_LIVE_CACHE_RETENTION_SECONDS = 86400` (Redis key expiry); malformed cached payload treated as a miss
    - _Requirements: 9.3, 9.4_
  - [x] 2.3 Implement `projectParkLive` pure core (`services/live/parkLiveProject.ts`)
    - Signature `projectParkLive(response: ThemeParksLiveResponse, upstreamIdToExperienceId: ReadonlyMap<string, string>): readonly ParkLiveEntrySnapshot[]`; map each `liveData` entry whose `id` is a key in the map to a `ParkLiveEntrySnapshot` (internal experience id, name, status, `queue.STANDBY.waitTime` or `null`); discard every non-matching entry (including the park's own entity entry); pure, total, never throws
    - _Requirements: 9.6_
  - [x] 2.4 Write property tests for `projectParkLive`
    - **Property 1: Projection includes only tracked Experiences and is total** — for any response (including garbage/missing `queue`/missing `waitTime`) and any map, the function never throws, includes exactly the entries whose `id` is a map key, and excludes every non-matching entry. **Validates: Requirements 9.6**
  - [x] 2.5 Implement `ParkLiveService` (`services/live/parkLive.ts`)
    - `createParkLiveService(deps)` taking an injected `ThemeParksLiveClient`, `ParkLiveCache`, `ParkGuidResolver`, a `LiveRepo`-style bulk upstream-id lookup (reusing the query shape `samplingService.getExperiencesWithUpstreamIds` already uses), a clock, and a deadline; `getParkLive(park, now?)` follows the exact cache-decision / fetch-with-deadline / stale-serve-fallback control flow of `themeParksLiveService.ts`, differing only in resolution (Park → GUID directly, no Enterprise_Id join) and projection (`projectParkLive` instead of `projectThemeParksLive`)
    - _Requirements: 9.1, 9.3, 9.4, 9.5, 9.7_
  - [x] 2.6 Write unit tests for `ParkLiveService`
    - Mirror `themeParksLiveService`'s existing test structure with in-memory fakes: fresh-fetch success, cache-hit-within-TTL serve (no upstream call), stale-serve-on-failure-with-cache, `live_unavailable` on failure with no cache, and a Disney-isolation test asserting the service's dependency shape carries no Disney client at all (mirroring `livePathIsolation.test.ts`)
    - _Requirements: 9.1, 9.3, 9.4, 9.5, 9.7_

- [x] 3. Expose the Park_Live_Snapshot route
  - [x] 3.1 Register `GET /parks/:park/live`
    - Session-authenticated; validate `:park` against the `Park` enum (400 `validation_failed` on mismatch, matching `parseDetailParams`'s existing pattern); call `parkLiveService.getParkLive(park)`; return `{ park, entries, retrievedAt, stale }`; `live_unavailable` propagates through the existing global `AppError` → 503 envelope
    - _Requirements: 9.1, 9.5_
  - [x] 3.2 Wire `ParkLiveService` into `composeServices.ts`
    - Construct `ParkGuidResolver`, `ParkLiveCache`, and `ParkLiveService` alongside the existing `themeParksLiveService`/`themeParksDirectory` construction, injecting the shared `ThemeParksLiveClient` and Redis connection
    - _Requirements: 9.1_
  - [x] 3.3 Write route integration tests (`server.inject`)
    - 200 with a well-formed snapshot; 400 on an invalid `:park`; 503 `live_unavailable` on failure with no cache; session-auth gate (401 with no session)
    - _Requirements: 9.1, 9.5_

- [x] 4. Checkpoint — API Live Waits complete
  - Ensure all API tests pass (`npx vitest run apps/api/src/services/live`); ask the user if questions arise before starting mobile work.

- [x] 5. Build the mobile Live Waits pure cores
  - [x] 5.1 Implement `parkLiveView.ts` (`screens/liveWaits/parkLiveView.ts`)
    - `buildLiveWaitsRows(entries, experiencesById, filter)`: filter entries to queue-eligible experiences (categories Ride and Character_Meet, or any Experience actively posting a standby wait; excluding Restaurants and schedule-only entertainment without waits), sort ascending by `waitMinutes` with closed/down entries last, apply the selected filter; `isWalkOn(waitMinutes)`: true iff non-null and `<= WALK_ON_THRESHOLD_MINUTES`; `isHeadliner(experience)`: true iff `groupedFacets.thrillFactor` intersects `HEADLINER_THRILL_FACET_VALUES`; all pure, no I/O
    - _Requirements: 10.2, 10.3, 10.4, 10.5_
    - **Superseded by task 1.6 (Requirement 10.5a):** `isHeadliner` no longer reads `groupedFacets.thrillFactor`; see task 1.6.
  - [x] 5.2 Write property tests for `parkLiveView.ts`
    - **Property 2: Sort/filter never drops or duplicates an eligible Row and resolves closed/down last** — for any entries and any filter, the result is a duplicate-free subset of input ids; under `'all'` every queue-eligible entry is present exactly once; numeric-wait Rows precede closed/down Rows and are strictly ascending. **Validates: Requirements 10.2**
    - **Property 3: Walk-on/Headliner are threshold/facet-exact and monotonic** — `isWalkOn` matches the threshold predicate exactly and raising the threshold never excludes a previously-included Row; `isHeadliner` matches the facet-membership predicate exactly. **Validates: Requirements 10.4, 10.5**
    - **Amendment (Requirement 10.5a):** re-run this property test against the redefined `isHeadliner` — it now asserts id-allowlist membership against `HEADLINER_EXPERIENCE_IDS` instead of facet intersection; update the test's experience fixtures accordingly (see task 1.6).
  - [x] 5.3 Implement `resolveDefaultLiveWaitsPark` (`screens/liveWaits/defaultPark.ts`)
    - `resolveDefaultLiveWaitsPark(activeTripPark: Park | null, lastViewedPark: Park | null): Park`: active Trip's park, else last-viewed park, else the first entry of canonical `PARKS` order; pure, never returns outside `PARKS`
    - _Requirements: 4.3, 10.1_
  - [x] 5.4 Write property tests for `resolveDefaultLiveWaitsPark`
    - **Property 5: Always resolves to a valid tracked Park** — for any combination of inputs, the result follows the fallback chain exactly and is always a member of `PARKS`. **Validates: Requirements 4.3, 10.1**

- [x] 6. Build the `LiveWaitsScreen` and park-live Lightning Lane projection
  - [x] 6.1 Project coarse Lightning Lane state in `apps/api` (`parkLiveProject.ts`) and `@dwt/shared` (`ParkLive.ts`)
    - Include `lightningLane?: LightningLaneState` in `ParkLiveEntryDTO` and project it from `queue.PAID_RETURN_TIME` / `queue.RETURN_TIME`
    - _Requirements: 9.8_
  - [x] 6.2 Implement the screen (`screens/liveWaits/LiveWaitsScreen.tsx`) with full mockup visual parity
    - Gradient header with `⏱️ REAL-TIME LINE TIMES` tag, refresh icon button, park title, and `Park Hours • Updated X min ago` subtitle
    - Park selector with themed emojis (`🏰 Magic Kingdom`, `🌐 EPCOT`, `🎬 Studios`, `🍃 Animal K.`)
    - Crowd Status radar card with live wait average and peak-time touring advice
    - Four-way filter row: `All ({count})`, `Walk-on (<25m)`, `Lightning Lane`, and `Headliners`
    - Attraction cards with status dots, land meta, live Lightning Lane return windows/prices, prominent wait numbers with `MIN WAIT` labels, and compact `+ Log` button formatted with clean non-overlapping spacing
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.10, 10.11_
  - [x] 6.3 Write component and property tests for `LiveWaitsScreen` and `parkLiveView.ts`
    - Verify filter switching, status dots, crowd radar card, `+ Log` modal flow, and Lightning Lane return time presentation
    - _Requirements: 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.10, 10.11_

- [x] 7. Build the new mobile stacks hosting existing, unchanged screens
  - [x] 7.1 Create `CollectionStack.tsx`
    - Register `CollectionHome` (new landing, task 9), `PinBoard`, `PinAttribution`, `PinShowcase` (moved from `ProfileStack`, unchanged), `MyFoodHistory`, `MyFoodLists` (moved from `RootStack`, unchanged), and `Stats` (nesting the existing `StatsStack` unchanged, exactly as `ProfileStack` does today)
    - _Requirements: 6.1, 6.2_
  - [x] 7.2 Create `YouAndCrewStack.tsx`
    - Register `YouAndCrewMain` (new composed screen, task 10), `FriendProfile`, `FriendsSearch`, `Inbox`, `Sent`, `PinShowcase` (read-only friend route, moved from `FriendsStack`, unchanged)
    - _Requirements: 7.1, 7.4_
  - [x] 7.3 Rename `CatalogStack.tsx` to `ExploreStack.tsx` and add the Live Waits route
    - Rename the file and its exported type/component; keep `CatalogList`, `DestinationScreen`, `CrowdCalendar` routes unchanged; add a `LiveWaits: undefined` route hosting `LiveWaitsScreen` (task 6)
    - _Requirements: 3.1, 3.2_
  - [x] 7.4 Delete `ProfileStack.tsx` and `FriendsStack.tsx`
    - Confirm every route each previously registered has a new home in `CollectionStack`, `YouAndCrewStack`, or is retired per Requirement 7.3's removed-content list (stats/food/pins/notifications buttons); remove the files and their imports
    - _Requirements: 1.5, 7.5_

- [x] 8. Build the new navigation-shell components
  - [x] 8.1 Implement `AvatarChip` (`screens/navigation/AvatarChip.tsx`)
    - Extract the avatar-or-placeholder rendering logic unchanged from the retired `ProfileTabIcon`; reads `/me` via the existing `['me']` query key; on press, `navigation.navigate('YouAndCrew')`
    - _Requirements: 2.2, 7.1, 7.2_
  - [x] 8.2 Implement `NotificationBell` (`features/notifications/NotificationBell.tsx`)
    - Wrap the existing `useAttentionBadge()` unchanged; render the existing `AttentionBadge` overlay on a bell icon button; on press, `navigation.navigate('NotificationCenter')`
    - _Requirements: 8.1, 8.3_
  - [x] 8.3 Implement `buildQuickActions` pure core (`screens/quickAction/quickActions.ts`)
    - `buildQuickActions(claimablePinCount: number): readonly QuickAction[]`: the five fixed actions in Requirement 4.2 order when `claimablePinCount > 0`; the same four with `'claimPins'` omitted when `0`; pure, no duplicate keys, order-preserving
    - _Requirements: 4.2, 4.7_
  - [x] 8.4 Write property tests for `buildQuickActions`
    - **Property 4: Total, order-preserving projection of the claimable count** — for any non-negative count, the returned action list matches the Requirement 4.2 order and the `'claimPins'` inclusion rule exactly, with no reordering or duplication. **Validates: Requirements 4.2, 4.7**
  - [x] 8.5 Implement `QuickActionSheet` (`screens/quickAction/QuickActionSheet.tsx`)
    - Modal bottom sheet (mirrors `AddToListsSheet`'s existing pattern) rendering `buildQuickActions(useClaimablePinsBadge().count)`; dispatch each action per the design's Components section 4: Check Live Waits → dismiss + navigate to `LiveWaits` with `resolveDefaultLiveWaitsPark(activeTripPark, lastViewedPark)`; Log Ride/Snack → dismiss + open the existing `LogVisitModal`/`LogFoodItemModal` experience-picker flow; Claim Pins → dismiss + navigate to `Collection.PinBoard` with `celebratePinIds` set to the claimable ids; View Today's Schedule → dismiss + navigate to the active Trip's `TripSchedule` else `TripsList`, reusing `navigationRef.ts`'s existing `navigateToTripDetail`/`navigateToTripsList` helpers
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_
  - [x] 8.6 Implement `MagicFab` (`screens/quickAction/MagicFab.tsx`)
    - A custom `tabBarButton` for a fifth, non-navigating tab-bar slot between `Explore` and `Trips`; `listeners.tabPress` calls `e.preventDefault()` so it never becomes the selected tab; on press, opens `QuickActionSheet`
    - _Requirements: 1.1, 1.2_
  - [x] 8.7 Write component tests for `QuickActionSheet` and `MagicFab`
    - Sheet renders five actions with a claimable count injected, four with zero; each action's tap dispatches the expected navigation call (mocked `navigationRef` helpers) and dismisses the sheet; the FAB's tab-bar slot never becomes the tab bar's selected/active tab on press
    - _Requirements: 1.1, 1.2, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

- [x] 9. Build `CollectionScreen`
  - [x] 9.1 Implement the landing screen (`screens/collection/CollectionScreen.tsx`)
    - Three entry cards — Pins (claimable count via `useClaimablePinsBadge()`, navigates to `PinBoard`), Food (navigates to `MyFoodHistory`, with a link to `MyFoodLists` from there), Stats (navigates into the nested `StatsStack`'s existing Overview route) — introducing no new query keys beyond the two existing badge hooks
    - _Requirements: 6.1, 6.4_
  - [x] 9.2 Write component tests for `CollectionScreen`
    - Assert the claimable-count badge renders from the shared hook and each card navigates to its existing, unchanged destination
    - _Requirements: 6.1, 6.4_
  - [x] 9.3 Amend `CollectionScreen` to Disney Vault segmented hub with live preview widgets and tests
    - Add "Vault" tabBarLabel and unread claim badge to `RootNavigator.tsx`
    - Enhance `GradientHeader` with eyebrow support
    - Implement 3-way segmented pills: Pins & Showcase, Food & Lists, Park Stats
    - Wire read-only fractional corkboard canvas, claim banner, and collection progress to Pins view
    - Wire food metrics, list preview, recent treats, and timeline CTA to Food view
    - Wire park coverage story and stats CTA to Stats view
    - Write comprehensive component and navigation tests covering all user actions
    - _Requirements: 6.5, 6.6, 6.7, 6.8, 6.9_

- [x] 10. Build `YouAndCrewScreen`
  - [x] 10.1 Trim `ProfileScreen.tsx` to its identity block and export for reuse
    - Remove the "View your stats," "View your food history," "View your food lists," "View your pins"/"My Showcase," and "View notifications" buttons/cards (relocated per Requirements 6 and 8); keep the avatar picker, display-name editor, push-notification/change-password/logout controls; export the identity block as a reusable child component
    - _Requirements: 7.3, 7.4_
  - [x] 10.2 Implement `YouAndCrewScreen.tsx`
    - Compose the trimmed `ProfileScreen` identity block, `FriendsListScreen`'s list-with-search-and-compare content, and the existing Inbox/Sent entry cards into one screen in the updated hierarchy; include inline friends capping with `MAX_INLINE_FRIENDS = 3` and expand/collapse toggle (R7.7), and sleek friend items with Compare Stats
    - _Requirements: 7.3, 7.4, 7.7_
  - [x] 10.3 Write component tests for `YouAndCrewScreen`
    - Assert the identity block, friends list with capping/expand toggle, compare control, share entry points, and settings controls all render and each retains its expected behavior
    - _Requirements: 7.3, 7.4, 7.7_

- [x] 11. Checkpoint — new stacks and screens complete, pre-cutover
  - Ensure all new-screen tests pass; ask the user if questions arise before rewriting `RootNavigator.tsx`.

- [x] 12. Cut over `RootNavigator.tsx` to the 4-tab shell
  - [x] 12.1 Rebuild `MainTabParamList`
    - Replace the five-key type with exactly `{ Home, Explore, Trips, Collection }`; remove `Friends` and `Profile` keys entirely; update `TAB_ICONS` to drop the removed tabs and delete `ProfileTabIcon`
    - _Requirements: 1.1, 1.5_
  - [x] 12.2 Add `YouAndCrew` and `NotificationCenter` to `RootStackParamList`
    - Register both as root-level screens (siblings of `MainTabs`, `ExperienceDetail`); `NotificationCenter` registered with `presentation: 'modal'` (matching `ShareComposer`'s existing registration)
    - _Requirements: 7.2, 8.2, 8.4_
  - [x] 12.3 Wire `AvatarChip` + `NotificationBell` into every Main_Tab's landing header
    - Place both in `GradientHeader`'s existing `right` slot on `HomeScreen`, the `Explore` landing screen, the `Trips` landing screen, and `CollectionScreen`
    - _Requirements: 2.2, 3.3, 5.3, 6.3, 7.2, 8.1_
  - [x] 12.4 Trim `HomeScreen.tsx`
    - Remove the "Plan your visit" card and any quick-action dock/pulse content; keep the Active_Trip_Shortcut content and the existing leaderboard unchanged
    - _Requirements: 2.1, 2.4_
  - [x] 12.5 Wire the Live Waits + Crowd Calendar jump-in cards into the Explore landing
    - Add two jump-in controls ahead of the existing destination grid, navigating to `LiveWaits` and the existing `CrowdCalendar` route respectively
    - _Requirements: 3.2, 3.4_
  - [x] 12.6 Register `MagicFab` as the tab bar's center slot
    - Wire the fifth `tabBarButton`-overridden slot between `Explore` and `Trips` per task 8.6
    - _Requirements: 1.1, 1.2_

- [x] 13. Write navigation-structure regression tests
  - [x] 13.1 `MainTabParamList` shape test
    - Assert the tab-bar's registered screen keys are exactly `{Home, Explore, Trips, Collection}` — regression guard for Requirement 1.1/1.5
    - _Requirements: 1.1, 1.5_
  - [x] 13.2 `YouAndCrew`/`NotificationCenter` reachability test
    - Assert both are reachable via `navigation.navigate` from a screen rendered under each of the four Main_Tabs
    - _Requirements: 7.2, 8.1_
  - [x] 13.3 Trip section structure regression test
    - **Property 6: Trip section structure is untouched by this feature** — assert `TripsStackParamList`'s keys and `TripDetailScreen.tsx`'s `HUB_SECTIONS` array are byte-for-byte unchanged by this feature's diff (a snapshot test against the pre-change values), guarding against silently re-splitting Trip_Activity. **Validates: Requirements 5.1, 5.2**

- [x] 14. Final checkpoint
  - Ensure all tests pass (`npm run verify`); paste the literal tail output per this repo's execution-discipline steering; ask the user if questions arise.

- [x] 15. Implement Home Screen Mockup Parity & Command Center
  - [x] 15.1 Pure logic for pulse calculation and countdown derivation
    - Implement `pulseCalculations.ts` (`calculateParkWaitAverage`, `classifyCrowdTrend`) and `countdown.ts` (`calculateCountdownDays`)
    - _Requirements: 2.1, 2.5_
  - [x] 15.2 Property tests for pulse calculation & countdown
    - **Property 7: Park Wait Pulse computation & crowd trend classification** in `pulseDerivation.prop.test.ts`
    - **Property 8: Upcoming vacation countdown day derivation** in `countdownDerivation.prop.test.ts`
    - _Requirements: 2.1, 2.5_
  - [x] 15.3 Pill AvatarChip and Personalized Header
    - Upgrade `AvatarChip.tsx` with a `variant="pill"` supporting the `[N] You & Crew` pill button with subtle glass border and badge
    - Wire personalized greeting pill ("✨ Good morning, [Name]!"), hero title ("Ready for the Magic?"), and park operating subtext into `HomeScreen.tsx`
    - _Requirements: 2.1, 2.2_
  - [x] 15.4 Upcoming Vacation Countdown Hero, Active Vacation Card & Exploration Prompt
    - Create `UpcomingTripHero.tsx` and `ExplorationPromptCard.tsx` rendering countdown badge, active trip metrics, and exploration prompt when no trips exist with tap navigation
    - _Requirements: 2.1_
  - [x] 15.5 Action Dock and Park Wait Pulse components
    - Create `ActionDock.tsx` with 4 tiles (Live Waits, Log Ride, Log Snack, My Pins) and modal triggers
    - Create `ParkWaitPulse.tsx` with horizontal carousel of the 4 parks displaying live average waits and crowd trend badges with tap-to-LiveWaits navigation
    - _Requirements: 2.1, 2.4, 2.5_
  - [x] 15.6 Sectioned Community Favorites and Home Screen Integration Tests
    - Update `HomeScreen.tsx` to integrate all components in vertical scroll order with sectioned leaderboard and "See All" link
    - Add `HomeScreen.render.test.tsx` verifying renders, user interactions, and empty states
    - _Requirements: 2.1, 2.3, 2.4, 2.5_
  - [x] 15.7 Final Checkpoint
    - Run full verification `npm run verify` and paste literal output
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [ ] 16. Fix Home operating-context subtitle to use real park hours and weather (Requirement 2.6, design.md Property 9, section 12)
  - [x] 16.1 Add `GET /weather/current` route and shared DTO
    - Create `packages/shared/src/schemas/Weather.ts` with `CurrentWeatherDTO` and `currentWeatherSchema` per design.md section 12; export from the package index
    - Register `GET /weather/current` in `apps/api/src/services/intelligence/routes.ts` (session-authenticated), wrapping the existing `weatherClient.getWDWWeather()` — no new upstream integration
    - _Requirements: 2.6_
  - [x] 16.2 Write route integration tests (`server.inject`)
    - 200 with `current: null` when the client's current observation is absent; 200 with mapped `tempF`/`condition` when present; session-auth gate
    - _Requirements: 2.6_
  - [x] 16.3 Implement `buildOperatingContextSubtitle` pure core (`screens/home/operatingContext.ts`)
    - Compose `parkHours`/`weather` inputs into the subtitle string per design.md section 12; never fabricate a value; omit the weather segment entirely when `weather` is absent (loading or errored) rather than substitute a placeholder
    - _Requirements: 2.6_
  - [x] 16.4 Write property test for `buildOperatingContextSubtitle`
    - **Property 9: Home operating-context subtitle never renders a fabricated hours or weather value** — fast-check, ≥100 runs, every combination of present/absent `parkHours`/`weather`; never throws; never emits a weather segment when `weather` is absent. Tagged `Feature: navigation-redesign, Property 9`. **Validates: Requirements 2.6**
    - _Requirements: 2.6_
  - [x] 16.5 Wire real park hours + weather into `HomeScreen.tsx`, removing the hardcoded fallback string
    - Replace the literal `'Magic Kingdom • 8:00 AM – 11:00 PM • 78° Sunny'` fallback with a `useQuery(['crowd-calendar', 'today', currentPark])` (single-day `GET /crowd-calendar`) and a `useQuery(['weather', 'current'])` (`GET /weather/current`, `staleTime` ~60 minutes matching the server cache), passed through `buildOperatingContextSubtitle`
    - _Requirements: 2.6_
  - [x] 16.6 Fix the `TripDTO.park` cast in `QuickActionSheet.tsx`
    - `TripDTO` has no `park` field (a Trip spans multiple parks/days); replace the `(activeTrip as any)?.park ?? null` cast with the same real "today's park" derivation `HomeScreen.tsx` already implements (today's planned-item park, else the Trip's `dayTouringHours[todayStr]?.startingPark`, else `'Magic Kingdom'`) — extract a small shared helper (e.g. `deriveTodaysPark`) so both call sites use one implementation rather than duplicating the logic
    - _Requirements: 4.3_
  - [x] 16.7 Write a regression test asserting no fabricated weather string ships
    - `HomeScreen` test asserting the rendered subtitle never contains the literal strings `'78°'` or `'Sunny'` regardless of query loading/error/success state — the concrete guard against the defect this task fixes
    - _Requirements: 2.6_
  - [x] 16.8 Checkpoint
    - Run `npx jest apps/mobile/src/screens/home apps/mobile/src/screens/quickAction`, then the full `npm run verify`; paste the literal tail output per this repo's execution-discipline steering

- [ ] 17. Split the Collection tab's "Food & Lists" segment into separate "Food" and "Lists" segments (Requirement 6's amendment; cross-spec with `experience-lists` Requirement 12's amendment)
  - [x] 17.1 Rebuild `CollectionScreen.tsx`'s segmented control as four pills
    - Replace the three `segBtn` pills with four: "📌 Pins" (shortened from "Pins & Showcase" once a 4th equal-width pill made the longer label clip), "🍽️ Food", "📋 Lists" (no badge), "📊 Park Stats"; add a `VaultSubTab` union member `'lists'`; remove the `-16` negative top margin on `segmentedControl` so it no longer overlaps the header's bottom curve, matching every other `GradientHeader` screen's spacing
    - _Requirements: 6.6a_
  - [ ] 17.2 Split the existing "Food & Lists" sub-view into "Food" and "Lists" sub-views
    - Move the "My Food Lists" card and "My Experience Lists" card (and their underlying `useQuery`s) out of the `activeTab === 'food'` block into a new `activeTab === 'lists'` block, rendered as two equal-weight `Card`s with no visual hierarchy; the remaining `activeTab === 'food'` block keeps the snack-count metric tile, Recent Treats Passport, Classic Treats Checklist, and "Open Food History Timeline" action, dropping the saved-food-list-count metric tile (list counts now live on the "Lists" pill's badge and within the "Lists" sub-view itself)
    - _Requirements: 6.8a, 6.8b_
  - [ ] 17.3 Add a "Log a food item" action to the Food sub-view
    - Compose the existing `ExperiencePicker` (scoped to dining via `defaultTab="dining"`) → `FoodItemPickerModal` → `LogFoodItemModal` flow directly in `CollectionScreen.tsx`, mirroring `MagicFab.tsx`'s existing "Log Snack" quick-action wiring (same modals, same mutation/invalidation calls) rather than duplicating that logic — a User can log food from this screen without needing the separate global FAB
    - _Requirements: 6.8a_
  - [ ] 17.4 Update `CollectionScreen.test.tsx`
    - Update the existing "My Experience Lists card... in Food tab" test(s) to assert the card renders under the "Lists" tab instead; add assertions for the four-pill segmented control (all four testIDs present, defaulting to "Pins & Showcase"), the "Lists" pill's combined-count badge, the Food sub-view's new "Log a food item" action opening the picker→food-item→log flow end to end, and that the Food sub-view no longer renders a list-count metric tile or either list card
    - _Requirements: 6.6a, 6.8a, 6.8b_
  - [ ] 17.5 Checkpoint — run `npm run verify:mobile`, paste the literal tail output

- [x] 18. Multi-Row Preview, Pin-Aware Ordering, Deep Link, and Inline Create for the Lists Sub-View (Requirement 6 amendment 8c; cross-spec with `food-lists` Requirement 14 / `experience-lists` Requirement 19)
  - [x] 18.1 Extract `CreateFoodListModal.tsx` from `MyFoodListsScreen.tsx` and `CreateExperienceListModal.tsx` from `MyExperienceListsScreen.tsx`
    - Move each screen's existing create-list `Modal` (name input, visibility toggle, and for food lists the checklist toggle, plus the `POST` mutation and error-surfacing) into a standalone component taking `{ visible, onClose, onCreated(newList) }`; update the two management screens to render the extracted component with unchanged behavior
    - _Requirements: 6 amendment 8c_
  - [x] 18.2 Wire the same `PATCH .../:id` pin/unpin mutation shape directly in both `MyFoodListsScreen.tsx`/`MyExperienceListsScreen.tsx`'s row-level pin control (per `food-lists` task 22.9 / `experience-lists` task 25.9) and the new Collection preview rows below (implemented as parallel `handleTogglePinned`/`handleToggleFoodListPinned`/`handleToggleExperienceListPinned` functions with the identical request shape, rather than a shared hook — both call sites are one-line `apiRequest('PATCH', ...)` calls with no other logic worth abstracting)
    - _Requirements: 6 amendment 8c; `food-lists` 14.5; `experience-lists` 19.5_
  - [x] 18.3 Rebuild `CollectionScreen.tsx`'s "My Food Lists"/"My Experience Lists" cards to render up to `MAX_COLLECTION_PREVIEW_ROWS` (3) rows from `ownedLists` as-returned (no client re-sort), each deep-linking to `FoodListDetail`/`ExperienceListDetail` with that row's own id and carrying a pin/unpin toggle; remove the `activeList`/`activeExperienceList` `[0]`-pick derivations entirely
    - _Requirements: 6 amendment 8c (Property 10, Property 11)_
  - [x] 18.4 Add the "View all (N)" row when `ownedLists.length > 3`, navigating to `MyFoodLists`/`MyExperienceLists`
    - _Requirements: 6 amendment 8c (Property 10)_
  - [x] 18.5 Add a "+ New" action to each card's header (alongside the existing "Discover" link), opening task 18.1's extracted create modal in place; on successful creation, invalidate the collection query so the new list appears among the rendered rows
    - _Requirements: 6 amendment 8c_
  - [x] 18.6 Update `CollectionScreen.test.tsx`
    - Assert up to 3 rows render in the mocked `owned` order (Property 10); a 4th+ list produces the "View all (N)" row, absent at ≤3; tapping a specific row navigates to `FoodListDetail`/`ExperienceListDetail` with that row's own id (Property 11); tapping a row's pin toggle issues `PATCH .../:id` with the correct `pinned` value and does not also navigate (Property 12); tapping "+ New" opens the create modal in place (no navigation away from `CollectionHome`) and a successful submission adds the new list to the rendered rows
    - _Requirements: 6 amendment 8c_
  - [x] 18.7 Write `CreateFoodListModal.test.tsx`/`CreateExperienceListModal.test.tsx` for the extracted components (ported from the pre-extraction inline-modal test cases in `MyFoodListsScreen.test.tsx`/`MyExperienceListsScreen.test.tsx`)
    - _Requirements: 6 amendment 8c_
  - [x] 18.8 Checkpoint — ran `npx tsc --noEmit` (clean) and full `npx jest` (234 suites, 1564 tests, all passing) in `apps/mobile`; covered by the final full-workspace `npm run verify` gate as well

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP. (None are marked in this plan — every test sub-task here guards a Correctness Property or a stated regression risk, so none is optional.)
- Each task references specific requirement sub-clauses for traceability.
- Property numbers are assigned in this plan and match the design's Correctness Properties 1–8.
- Property tests target the framework-free pure cores (`projectParkLive`, `parkLiveView.ts`, `resolveDefaultLiveWaitsPark`, `buildQuickActions`, `pulseCalculations.ts`, `countdown.ts`) so they run without rendering; component tests cover the screens; the Trip-structure regression test is a snapshot, not a property.
- Checkpoints ensure incremental validation at the API boundary (task 4), before the risky `RootNavigator.tsx` cutover (task 11), at the end of the initial wave (task 14), and at the end of Home screen enhancements (task 15.7).
- Task 1.3 (confirming real `thrillFactor` facet values) MUST happen before task 5.1/5.2 implement `isHeadliner` against a final constant — do not guess the values.
- **Amendment (Requirement 10.5a):** tasks 1.5/1.6 supersede the facet-based `HEADLINER_THRILL_FACET_VALUES`/`isHeadliner` built in tasks 1.2/1.3/5.1/5.2 with a curated `HEADLINER_EXPERIENCE_IDS` id allowlist, after a live-data audit found the facet match mislabeled most water-park slides as headliners while excluding Haunted Mansion, Pirates of the Caribbean, and other unambiguous headliners. Tasks 1.2/1.3/5.1/5.2 are left checked as historical record of work actually done; 1.5/1.6 are the corrective follow-up and must both land together (constant + consumer) since `isHeadliner` would otherwise reference a removed export.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "1.4", "2.1", "2.2"] },
    { "id": 2, "tasks": ["2.3"] },
    { "id": 3, "tasks": ["2.4", "2.5"] },
    { "id": 4, "tasks": ["2.6", "3.1", "3.2"] },
    { "id": 5, "tasks": ["3.3"] },
    { "id": 6, "tasks": ["4"] },
    { "id": 7, "tasks": ["5.1", "5.3", "7.1", "7.2", "7.4"] },
    { "id": 8, "tasks": ["5.2", "5.4", "8.1", "8.2", "8.3"] },
    { "id": 9, "tasks": ["6.1", "8.4", "8.5"] },
    { "id": 10, "tasks": ["6.2", "7.3", "8.6", "8.7", "9.1", "10.1"] },
    { "id": 11, "tasks": ["9.2", "10.2"] },
    { "id": 12, "tasks": ["10.3"] },
    { "id": 13, "tasks": ["11"] },
    { "id": 14, "tasks": ["12.1", "12.2"] },
    { "id": 15, "tasks": ["12.3", "12.4", "12.5", "12.6"] },
    { "id": 16, "tasks": ["13.1", "13.2", "13.3"] },
    { "id": 17, "tasks": ["14"] },
    { "id": 18, "tasks": ["15.1", "15.2", "15.3", "15.4", "15.5", "15.6", "15.7"] },
    { "id": 19, "tasks": ["16.1"] },
    { "id": 20, "tasks": ["16.2", "16.3", "16.6"] },
    { "id": 21, "tasks": ["16.4", "16.5"] },
    { "id": 22, "tasks": ["16.7"] },
    { "id": 23, "tasks": ["16.8"] },
    { "id": 24, "tasks": ["18.1", "18.2"] },
    { "id": 25, "tasks": ["18.3", "18.4", "18.5"] },
    { "id": 26, "tasks": ["18.6", "18.7"] },
    { "id": 27, "tasks": ["18.8"] },
    { "id": 28, "tasks": ["1.5", "1.6"] }
  ]
}
```

Wave 28 (Requirement 10.5a amendment) replaces the facet-based Headliner constant/consumer with the
curated id allowlist. It depends only on the original tasks 1.2/1.3/5.1/5.2 having landed (so there
is something to supersede) and has no dependents of its own, so it is sequenced last; it does not
block or get blocked by any Collection/Lists work in waves 17-27, which are unrelated to Live Waits.

Wave 24 builds the two extracted create modals and each screen's pin-toggle handler in parallel,
since both depend only on tasks 17.1-17.4 (the Lists sub-view existing) and are otherwise
independent files. Wave 25 rebuilds the Collection cards' rows/View-all/create-action, depending
on wave 24's extracted modal existing to consume. Wave 26 is the component tests, sequenced after
the screen changes they assert against. Wave 27 is the mobile verification checkpoint. This task
depends on `food-lists` task 22 and `experience-lists` task 25 (the `pinned`/`pinnedAt` wire
contract and `setPinned` route) already having landed, since the Collection rows' pin toggle and
pinned-first row ordering have nothing to call/reflect otherwise.
