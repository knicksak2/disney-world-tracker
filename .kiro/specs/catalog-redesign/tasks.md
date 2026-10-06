# Implementation Plan: Catalog & Explore Redesign

## Overview

This implementation plan delivers the Catalog & Explore redesign across structured, dependency-ordered waves. It begins with shared contracts, UI constants, and pure view models with fast-check property tests. It then enhances the canonical, preserved resort detail page (`ResortGuideSection.tsx`) with inline progressive disclosure ("Show all / Show fewer") and interactive recreation navigation. Next, it introduces the dedicated Resorts Directory screen (`ResortsDirectoryScreen.tsx`, genuinely new) and migrates the Theme Park land view (`ParkDestinationScreen.tsx` replacing `DestinationScreen.tsx`'s `ThemeOrWaterParkLayout`) and the Explore Hub (`ExploreHubScreen.tsx` replacing `CatalogScreen.tsx`), carrying over the existing tested logic those screens already have rather than re-deriving it. It then migrates Resorts browsing off `DestinationScreen.tsx`'s `ResortsLayout` onto the new directory, wires root stack navigation to the new components, deletes the superseded screens and tests, and passes the Anti-Hallucination Gate and full verification gate.

## Tasks

- [x] 1. Establish shared contracts, constants, and pure view helpers
  - [x] 1.1 Add catalog UI constants to `packages/shared/src/constants/catalog.ts`
    - Add `DEFAULT_RESORT_SECTION_LIMIT = 4`
    - Add `EXPLORE_UTILITY_TILES` (Live Waits, Crowds, Favorites)
    - Add `THEME_PARKS_EXPLORE_GRID` (Magic Kingdom, EPCOT, Hollywood Studios, Animal Kingdom)
    - _Requirements: 1.3, 1.4, 5.1, 5.6_
  - [x] 1.2 Update `ResortRecreationItemDTO` in `packages/shared/src/dto/Resort.ts`
    - Add optional `id?: string`, `priceTier?: string`, and `hours?: string` to support interactive activity navigation and detail display
    - _Requirements: 6.1, 6.2_
  - [x] 1.3 Implement pure view helpers in `apps/mobile/src/screens/catalog/resortGuideView.ts`
    - Implement `computeVisibleItems<T>` supporting default limit 4, expand toggle, and category filter bypass
    - Implement `filterDiningByCategory` supporting `all`, `table`, `quick`, and `lounge` filters
    - Implement `extractDynamicQuickChips` deriving frequency-ordered unique filter tags from experiences
    - _Requirements: 3.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_
  - [x] 1.4 * Write property test for Property 1
    - **Property 1: Inline disclosure truncation invariant**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.6, 5.7, 5.8**
    - Fast-check property test in `apps/mobile/src/screens/catalog/__tests__/resortGuideView.prop.test.ts` (minimum 100 runs)
    - _Requirements: 5.1, 5.2, 5.3, 5.6, 5.7, 5.8_
  - [x] 1.5 * Write property test for Property 2
    - **Property 2: Dining category filter soundness and completeness**
    - **Validates: Requirements 5.4, 5.5, 2.7**
    - Fast-check property test in `apps/mobile/src/screens/catalog/__tests__/resortGuideView.prop.test.ts` (minimum 100 runs)
    - _Requirements: 5.4, 5.5, 2.7_
  - [x] 1.6 * Write property test for Property 3
    - **Property 3: Dynamic quick chips derivation uniqueness and relevance**
    - **Validates: Requirements 3.5**
    - Fast-check property test in `apps/mobile/src/screens/catalog/__tests__/resortGuideView.prop.test.ts` (minimum 100 runs)
    - _Requirements: 3.5_

- [x] 2. Checkpoint: Verify pure view helpers and property tests
  - Run `npx jest apps/mobile/src/screens/catalog/__tests__/resortGuideView.prop.test.ts`
  - Run `npm run typecheck` across workspaces
  - Confirm all property tests pass with zero failures
  - _Requirements: 1.3, 3.5, 5.1-5.8_

- [x] 3. Enhance Resort Detail Page (`ResortGuideSection.tsx`)
  - [x] 3.1 Implement inline progressive disclosure in Dining & Lounges section
    - Wire `diningExpanded` boolean state and `computeVisibleItems`
    - Render `Show all [N] dining locations ([M] more) ▾` when collapsed
    - Render `Show fewer dining locations ▴` when expanded
    - Ensure default collapsed view displays exactly top 4 venues
    - _Requirements: 5.1, 5.2, 5.3_
  - [x] 3.2 Implement in-card dining category filter pills in Dining & Lounges section
    - Render horizontal pill strip: `All ([N])`, `Table Service ([N])`, `Quick Service ([N])`, `Lounges ([N])`
    - Selecting a category displays all matching venues and automatically suppresses truncation button
    - _Requirements: 5.4, 5.5_
  - [x] 3.3 Implement inline progressive disclosure in Recreation & Resort Amenities section
    - Wire `recreationExpanded` boolean state and `computeVisibleItems`
    - Render `Show all [N] recreation & activities ([M] more) ▾` when collapsed
    - Render `Show fewer activities ▴` when expanded
    - Ensure default collapsed view displays exactly top 4 amenities
    - _Requirements: 5.6, 5.7, 5.8_
  - [x] 3.4 Make recreation cards interactive with indicator chevrons
    - Convert static cards to `<Pressable>` with chevron `›`
    - On press: if `item.id` exists, call `navigation.navigate('ExperienceDetail', { experienceId: item.id })`
    - If `item.id` is absent, present an amenity detail sheet with operating hours and guidelines
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - [x] 3.5 * Write mobile component tests for ResortGuideSection
    - In `apps/mobile/src/screens/catalog/__tests__/ResortGuideSection.test.tsx`, test:
      - Default 4-item truncation and expansion to full list on button tap
      - Category filter pill selection filtering venues and hiding truncation
      - Interactive recreation item press triggering navigation to `ExperienceDetail`
    - _Requirements: 4.1, 5.1-5.8, 6.1-6.4_

- [x] 4. Checkpoint: Verify Resort Detail enhancements
  - Run `npx jest apps/mobile/src/screens/catalog/__tests__/ResortGuideSection.test.tsx`
  - Verify that `ExperienceDetailScreen.tsx`, `ResortGuideSection.tsx`, and `PassportAndLoreLens.tsx` maintain all existing layout features
  - Confirm zero regressions in transit times and property highlights
  - _Requirements: 4.1-4.6, 5.1-5.8, 6.1-6.4_

- [x] 5. Implement Resorts Directory Screen (`ResortsDirectoryScreen.tsx`)
  - [x] 5.1 Create `ResortsDirectoryScreen.tsx` with 4 partition tabs
    - Render `GradientHeader` matching Explore page size and shape with back navigation to Explore Hub, title, subtitle, followed by search input
    - Render 4 partition tabs: `🏨 Hotels (32)`, `🍽️ Dining (104)`, `🏊 Recreation (85)`, `🎪 Sub-Destinations (37)`
    - _Requirements: 2.1, 2.2_
  - [x] 5.2 Build `HotelPreviewCard` component
    - Render hero photo, tier badge, transit pills (`Monorail`, `Skyliner`, `Boat`), hotel title, and description
    - Render 3 glanceable metric pills: `🍽️ [N] Dining Venues`, `🏊 [N] Activities & Pools`, `⏱️ [N]m to [Nearest Park]`
    - Render favorite toggle heart button (`♥`)
    - Render CTA button `🏨 View Resort Page` navigating directly to `ExperienceDetailScreen` for that resort
    - _Requirements: 2.3, 2.4, 2.5, 2.6_
  - [x] 5.3 Implement Dining, Recreation, and Sub-Destinations directory tabs
    - Render dining cards with tags, meal periods, and price tiers
    - Render recreation cards with hours, locations, and pricing
    - Render showcase cards for Disney's BoardWalk, ESPN Wide World of Sports, and Golf complexes
    - _Requirements: 2.7, 2.8, 2.9_
  - [x] 5.4 * Write mobile component tests for ResortsDirectoryScreen
    - In `apps/mobile/src/screens/catalog/__tests__/ResortsDirectoryScreen.test.tsx`, test tab switching, tier filter pill changes, and navigation to `ExperienceDetailScreen`
    - _Requirements: 2.1-2.9_
  - [x] 5.5 Implement hotel picker bottom sheet filter for Dining and Recreation tabs
    - Render searchable bottom sheet over the 54 resorts
    - Wire hotel filter to isolate dining venues and recreation activities by selected resort
    - _Requirements: 2.10_

- [x] 6. Implement Explore Hub Screen (`ExploreHubScreen.tsx`), migrating `CatalogScreen.tsx`
  - [x] 6.1 Build Explore Hub header and global search input
    - Render top hero gradient header with title "Explore", operating subtitle, NotificationBell, and You & Crew shortcut
    - Render search input field with debounce querying `/catalog?q=`
    - Port `CatalogScreen.tsx`'s existing debounced search, flat search-result list, `catalog_unavailable` full-screen error state, and stale-cache banner logic rather than re-deriving it
    - _Requirements: 1.1, 1.2, 7.3_
  - [x] 6.2 Build 3-column Utility Dock
    - Render `⏱️ Live Waits` (navigating to `LiveWaitsScreen`)
    - Render `📊 Crowds` (navigating to `CrowdCalendarScreen`)
    - Render `♥ Favorites` (navigating to the existing favorites view — `CatalogScreen.tsx`'s `setFavoritesViewActive(true)` in-screen favorites mode, since there is no standalone `FavoritesScreen` route today; confirm with the team whether a dedicated route is actually wanted before building one)
    - _Requirements: 1.3_
  - [x] 6.3 Build 2x2 Theme Parks Landmark Grid
    - Render Magic Kingdom, EPCOT, Hollywood Studios, Animal Kingdom with landmark photos, average wait pulses, and experience counts (omitting landmark subheadings)
    - Wire tap to navigate to that park's `ParkDestinationScreen`
    - _Requirements: 1.4, 1.5_
  - [x] 6.4 Build Disney Springs banner, 2-column Water Parks grid, and Resorts Spotlight card
    - Render full-width Disney Springs showcase card
    - Render balanced 2-column grid for Blizzard Beach and Typhoon Lagoon
    - Render full-width Resorts Spotlight card navigating to `ResortsDirectoryScreen`
    - _Requirements: 1.6, 1.7, 1.8_
  - [x] 6.5 * Write mobile component tests for ExploreHubScreen
    - In `apps/mobile/src/screens/catalog/__tests__/ExploreHubScreen.test.tsx`, assert all 6 UI sections render and fire correct navigation routes
    - Assert the carried-over search/error/stale-cache behaviors from task 6.1 still work post-migration
    - _Requirements: 1.1-1.8, 7.3_

- [x] 7. Enhance Theme Park Destination Screen (`ParkDestinationScreen.tsx`), migrating `DestinationScreen.tsx`'s `ThemeOrWaterParkLayout`
  - [x] 7.1 Add adjacent `♥ Favorites` quick toggle pill beside category tabs
    - Tapping filters active experiences to favorites within that park
    - Port `DestinationScreen.tsx`'s existing `favoritesToggleBtn`/`favoritesOnly` logic rather than re-deriving it
    - _Requirements: 3.2, 3.3, 7.4_
  - [x] 7.2 Implement dynamic quick chips and land accordion experience count badges
    - Render horizontal quick chips derived from active category tab
    - Render land accordions with land name and experience count badge (e.g. `Fantasyland (9)`)
    - Port `DestinationScreen.tsx`'s existing `deriveQuickChips`, `groupByLand`/`browseLandOf`, and Lands/Price Filters modal (`destination-filters-modal`) rather than re-deriving them
    - _Requirements: 3.4, 3.5, 3.6, 3.7, 7.4_
  - [x] 7.3 Add Height Requirement and Physical Considerations filter dimensions
    - Extend `WHITELISTED_FACET_GROUPS` in `experiencePickerFilters.ts` to include the `height`/`age` facet groups
    - Before removing the exclusion, read the module doc comment explaining why `height`/`age` were originally excluded ("noisy, ubiquitous groups") and confirm the new UI (dedicated Height/Physical filter row, not a generic facet chip dump) actually avoids that noise
    - Render a height-requirement badge on each experience card (closing the Requirement 3.7 gap)
    - _Requirements: 3.4, 3.7, 7.6_
  - [x] 7.4 Add canonical `GradientHeader` matching Explore page size, shape, and rounded corners with park-themed gradient, active experience count subtitle (omitting landmark name and live wait pulse), and back button
    - _Requirements: 3.1_
  - [x] 7.5 * Write mobile component tests for ParkDestinationScreen
    - In `apps/mobile/src/screens/catalog/__tests__/ParkDestinationScreen.test.tsx`, test favorites toggle, quick chips filtering, land accordions, and the new Height/Physical filter dimensions
    - Assert the carried-over Filters modal and grouping behaviors from task 7.2 still work post-migration
    - _Requirements: 3.1-3.7, 7.4, 7.6_

- [x] 8. Migrate Resorts browsing off `DestinationScreen.tsx`'s `ResortsLayout`
  - [x] 8.1 Repoint the Explore Hub's Resorts Spotlight Card to navigate directly to `ResortsDirectoryScreen`
    - Confirm no remaining navigation path reaches `DestinationScreen` with `destination: 'Resorts'`
    - _Requirements: 7.2_
  - [x] 8.2 Delete `DestinationScreen.tsx`'s `ResortsLayout` and its `groupByResort`/`RESORT_BOARDWALK_ID`/`RESORT_WWOS_ID`/`RESORT_RECREATION_ID` call sites once `ResortsDirectoryScreen` covers the same ground
    - Retain `catalogGrouping.ts`'s pure land-grouping helpers (`groupByLand`, `browseLandOf`), which `ParkDestinationScreen` still uses
    - _Requirements: 7.2, 7.5_

- [x] 9. Final checkpoint — full Catalog & Explore Redesign
  - [x] 9.1 Wire navigation routes into `ExploreStack` and `RootNavigator`
    - Repoint the `CatalogList` route's component from `CatalogScreen` to `ExploreHubScreen` (route name unchanged — Requirement 7.1)
    - Repoint `DestinationScreen` route's `ThemePark`/`WaterPark` rendering to `ParkDestinationScreen`'s layout (Requirement 7.2)
    - Register `ResortsDirectoryScreen` in `ExploreStack`
    - _Requirements: 7.1, 7.2_
  - [x] 9.2 Delete superseded screens and tests
    - Delete `CatalogScreen.tsx`, `CatalogScreen.render.test.tsx`
    - Delete `DestinationScreen.tsx`'s `ThemeOrWaterParkLayout` and `ResortsLayout` and their superseded cases in `DestinationScreen.render.test.tsx`/`DestinationScreen.layouts.test.tsx`
    - Confirm (via `grep`/import search) nothing still imports the deleted components
    - _Requirements: 7.5_
  - [x] 9.3 Perform Pre-Response Source Diff Audit (Anti-Hallucination Gate)
    - Inspect `git diff` against `mockup.html`
    - Explicitly verify that every UI control, pill, badge, toggle, chevron, and modal sheet exists in code
    - Explicitly verify no fabricated error codes, routes, or DTO fields were introduced (cross-check against `packages/shared/src/errors.ts` and the real `ResortDTO`/`ExperienceDTO` shapes)
  - [x] 9.4 Run full gate `npm run verify`
    - Full typecheck + full test suite across `apps/api`, `apps/mobile`, and `packages/shared`
    - Must exit with code `0`
  - [x] 9.5 Produce Behavior → Test Map
    - Map every new UI control, branch, and handler to its specific test file and assertion
    - _Requirements: all_

## Notes

- Tasks marked with `*` are test tasks (property tests or mobile component tests); per repo steering, test coverage is required for every behavior.
- Every property test uses `fast-check` with `{ numRuns: 100 }`, tagged `// Feature: catalog-redesign, Property N: <text>`.
- The production `ExperienceDetailScreen.tsx` for Resorts is canonical and must NOT be replaced or rewritten; all resort links navigate to it. `ResortGuideSectionProps` is likewise unchanged by this feature — see design.md's note on the real prop signature.
- `ExploreHubScreen.tsx` and `ParkDestinationScreen.tsx` ARE replacements for `CatalogScreen.tsx` and `DestinationScreen.tsx`'s `ThemeOrWaterParkLayout`/`ResortsLayout` (Requirement 7) — this is a migration, not a parallel build. Do not leave the old components registered or in the tree once the new ones are verified; task 9.2 is not optional.
- The dining-category keyword classifier (Requirement 5.4a) is the single source of truth for `table`/`quick`/`lounge` classification, shared by `ResortGuideSection`'s in-card filter and the Resorts Directory Dining tab. Do not introduce a second, differently-worded taxonomy for either surface.
- Mobile component tests use `@testing-library/react-native` with Jest (`jest-expo`), mocking only network queries and navigation.
- The interactive visual reference lives at `.kiro/specs/catalog-redesign/mockup.html`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["1.4", "1.5", "1.6"] },
    { "id": 2, "tasks": ["2"] },
    { "id": 3, "tasks": ["3.1", "3.2", "3.3", "3.4"] },
    { "id": 4, "tasks": ["3.5"] },
    { "id": 5, "tasks": ["4"] },
    { "id": 6, "tasks": ["5.1", "5.2", "5.3", "7.1", "7.2", "7.3", "7.4"] },
    { "id": 7, "tasks": ["5.4", "7.5"] },
    { "id": 8, "tasks": ["6.1", "6.2", "6.3", "6.4"] },
    { "id": 9, "tasks": ["6.5", "8.1", "8.2"] },
    { "id": 10, "tasks": ["9.1", "9.2"] },
    { "id": 11, "tasks": ["9.3", "9.4", "9.5"] }
  ]
}
```

Wave 0 establishes shared contracts, constants, and pure view helpers. Wave 1 writes the fast-check property tests, and Wave 2 verifies them at Checkpoint 1. Wave 3 enhances the canonical Resort Detail page with progressive disclosure, and Wave 4-5 adds component tests and executes Checkpoint 2. Wave 6-7 implements the Resorts Directory and Park Land View enhancements (including the Height/Physical filter dimension and the carried-over migration logic) with tests. Wave 8-9 builds the Explore Hub, its tests, and migrates Resorts browsing off `DestinationScreen.tsx`. Wave 10 wires the final navigation repointing and deletes the superseded screens/tests (Requirement 7). Wave 11 performs the Anti-Hallucination Source Diff Audit and runs the final `npm run verify` gate.

Task 9.1 (navigation repointing) depends on task 5 (Resorts Directory existing), task 7's wave (Park Destination Screen existing), task 6's wave (Explore Hub existing), and task 8 (Resorts migration) all being complete — it is the point where the old and new screens swap places, so it must run after every replacement screen is built and tested, never before.
