# Implementation Plan: Experience Detail Redesign

## Overview

This plan implements the client-side presentation and layout reorganization of the mobile
`ExperienceDetailScreen` and its supporting pure module `infoTags.ts`. The strategy pushes all
derivation logic (grouping, relabeling, de-duplication, coordinate validation, directions-URL
construction) into framework-free modules that are property-tested in isolation, then reorganizes
the screen as a thin renderer over those pure results, validated with example-based render tests.

Implementation language: **TypeScript** (React Native / Expo, matching the existing workspace).

Tasks build incrementally: the pure cores land first, then the new local components, then the
screen is rewired to compose them in the reordered layout. No backend, API, or DTO changes are
involved.

## Tasks

- [x] 1. Extend `infoTags.ts` pure grouping core
  - [x] 1.1 Add grouping types, relabeling map, and `relabelTagValue`
    - Add `TagGroupId` (`'location' | 'goodToKnow' | 'accessibility' | 'goodFor'`), the `TagGroup`
      interface (`id`, `label`, `tags`), and a `TagGroupExperience` type extending the existing
      `InfoTagExperience` pick with `park`
    - Add the static `ACCESSIBILITY_LABELS` slug→label map including
      `'no-service-animals' → 'Service animals not permitted'`
    - Implement `relabelTagValue(value)`: exact whitespace-trimmed, case-sensitive map lookup;
      on miss replace every `-`/`_` with a space, collapse consecutive separators to one space,
      and trim
    - Keep the module free of React and react-navigation imports
    - _Requirements: 2.1, 2.2, 2.3, 9.1_

  - [x] 1.2 Implement `buildTagGroups`
    - Build the ordered `TagGroup[]` in fixed order location → goodToKnow → accessibility → goodFor
    - Assign each tag to exactly one group with the fixed intra-group field order (Location:
      park → land → resort → resort-area; Good to know: height → indoor/outdoor → ride-intensity;
      Accessibility: service-animal → ambulatory; Good for: age facets → interest facets)
    - Emit a tag only when its enrichment value is present and non-empty (string: non-null,
      non-undefined, ≥1 non-whitespace char; coordinate: finite number); trim emitted labels
    - Never emit raw coordinates as a tag
    - De-duplicate per group by relabeled+trimmed case-sensitive display label, keeping the first
      occurrence and its `accessibilityLabel`
    - Omit any empty group (including its label); return `[]` when nothing renders; total and
      never-throwing for null/undefined/empty inputs
    - Preserve `priceTierListTag` and `resortAreaLabel` exports unchanged
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 3.1, 3.2, 3.3, 4.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [x] 1.3 Write property test for tag relabeling
    - **Property 5: Relabeling**
    - **Validates: Requirements 2.1, 2.3**

  - [x] 1.4 Write property tests for `buildTagGroups` grouping guarantees
    - **Property 1: Tag partition** (Validates: Requirements 1.1, 9.2)
    - **Property 2: Group order and non-emptiness** (Validates: Requirements 1.6, 1.8)
    - **Property 3: Intra-group ordering and omission** (Validates: Requirements 1.2, 1.3, 1.4, 1.5)
    - **Property 4: Presence gating and trimming** (Validates: Requirements 9.3)
    - **Property 6: Accessible text always present** (Validates: Requirements 2.4, 2.5)
    - **Property 7: Per-group de-duplication** (Validates: Requirements 3.1, 3.2, 3.3)
    - **Property 8: Coordinates are never a tag** (Validates: Requirements 4.1)
    - **Property 15: Grouping is total** (Validates: Requirements 9.5)
    - **Property 16: Grouping is deterministic** (Validates: Requirements 9.6)
    - Implement each property as its own single property-based test at 100+ iterations

  - [x] 1.5 Write property test for preserved price/area outputs
    - **Property 14: Preserved price/area label outputs**
    - **Validates: Requirements 9.4**

- [x] 2. Create `directions.ts` pure directions core
  - [x] 2.1 Implement `hasValidCoordinates` and `directionsUrl`
    - `hasValidCoordinates(lat, lng)`: true iff both finite with lat ∈ [-90, 90] and lng ∈ [-180, 180]
    - `directionsUrl(lat, lng, platform?)`: build the platform-appropriate maps URL, defaulting to
      a deterministic cross-platform web maps URL that encodes the exact coordinate values
    - Keep the module pure and framework-free (no `Linking` call here)
    - _Requirements: 4.2, 4.3, 4.4_

  - [x] 2.2 Write property tests for the directions core
    - **Property 9: Coordinate validity gate** (Validates: Requirements 4.2, 4.3)
    - **Property 10: Directions URL encodes coordinates** (Validates: Requirements 4.4)
    - Implement each property as its own single property-based test at 100+ iterations

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Create the `YourVisitCard` component
  - [x] 4.1 Implement `YourVisitCard`
    - Single `Card` with a "Your visit" `SectionLabel` rendering, in fixed vertical order,
      `CompletionControls` → `RatingControl` → `NoteControl`, reusing the exact existing components
    - Preserve each control's per-control loading/error/empty rendering with `isError` taking
      precedence over loading, and independence between the three controls
    - Preserve `onMutated` invalidations verbatim: `['experience-completion', id]` + `['me-stats']`;
      `['experience-rating', id]` + `['experience-aggregate', id]`; `['experience-note', id]`
    - Disable an in-progress control independently; retain last stored value on mutation failure;
      preserve existing accessibility labels
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10_

  - [x] 4.2 Write render tests for `YourVisitCard`
    - Assert fixed control order; per-control loading/error/empty/disabled independence; exact
      `onMutated` query invalidations; preserved accessibility labels
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10_

- [x] 5. Create the `AboutSection` component
  - [x] 5.1 Implement collapsible `AboutSection`
    - Render description with `numberOfLines={4}` while collapsed, unclamped while expanded
    - Detect overflow via `onTextLayout` line count to decide whether to render the `Read_More_Toggle`
    - Initial state collapsed when text overflows; toggle shows "Read more" collapsed / "Read less"
      expanded and toggles state on activation with a non-empty accessibility label reflecting the
      current action
    - Render the existing "No description available." empty state and no toggle when the description
      is absent, empty, or whitespace-only
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10_

  - [x] 5.2 Write render tests for `AboutSection`
    - Collapsed shows 4-line clamp and "Read more"; toggling expands to full text and "Read less"
      and re-collapses; overflow detection shows/hides the toggle; absent/empty/whitespace-only
      description shows the empty state with no toggle
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10_

- [x] 6. Establish and test pure helpers for share, live selection, and aggregate formatting
  - [x] 6.1 Provide the pure share-enablement and aggregate-formatting helpers
    - Ensure `isExperienceShareEntryEnabled(detailLoading, ratingLoading, noteLoading)` exists in
      `shareEntryPoint.ts`, returning enabled iff none of the three are loading
    - Extract a pure aggregate formatting helper that renders the mean as `value.toFixed(1)` with the
      rating count for non-null aggregates, and confirm `liveSectionFor()` remains the sole live
      section selector
    - _Requirements: 8.1, 8.3, 8.6_

  - [x] 6.2 Write property test for share entry enablement
    - **Property 11: Share entry enablement**
    - **Validates: Requirements 8.1**

  - [x] 6.3 Write property test for live section selection
    - **Property 12: At most one live section by category**
    - **Validates: Requirements 8.3**

  - [x] 6.4 Write property test for community aggregate formatting
    - **Property 13: Community aggregate formatting**
    - **Validates: Requirements 8.6**

- [x] 7. Reorganize `ExperienceDetailScreen.tsx` as the thin renderer
  - [x] 7.1 Render the Location group and wire the Get directions action
    - Map the `location` `TagGroup` from `buildTagGroups` to rendered cards
    - Render the `Get_Directions_Action` within the Location area only when
      `hasValidCoordinates` is true, calling `Linking.openURL(directionsUrl(...))` on activation
    - Wrap the open call in `try/catch` (and/or `Linking.canOpenURL`) to render an inline,
      non-blocking error indication on failure while preserving all other screen state
    - Give the action a non-empty accessibility label
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 7.2 Reorder sections and compose the new components
    - Recompose the `ScrollView` body top-to-bottom: header + hero → Location group + Get directions
      → `YourVisitCard` → `LiveOperationalSection` → `MenuSummaryCard` (Restaurant only, between live
      and About) → `AboutSection` → "Why visit" → Community rating → remaining groups
      (Good to know, Accessibility, Good for)
    - Omit any section that would render no content while preserving relative order
    - Keep the existing data layer, loading/error gating, and Share entry point wiring unchanged
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 7.3 Write render tests for section ordering and info-tag rendering
    - Fully-populated render asserts top-to-bottom section order; sparse render asserts omitted
      sections with preserved relative order; Restaurant places the Menu_Summary_Card between the
      live section and About; exact group labels; `no-service-animals` renders as
      "Service animals not permitted"
    - _Requirements: 1.7, 2.2, 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 7.4 Write render tests for preserved screen behaviors
    - Share disabled while loading and navigation with built params when enabled; live-unavailable
      indicator on live failure; aggregate empty/populated states; Restaurant menu card; detail
      loading/error empty states; "Why visit" omission when absent or fully duplicating the
      description
    - _Requirements: 8.1, 8.2, 8.4, 8.5, 8.7, 8.8, 8.9, 8.10, 8.11_

  - [x] 7.5 Write static contract test for the pure core
    - Assert `infoTags.ts` imports neither React nor react-navigation
    - _Requirements: 9.1_

- [x] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Extend `directions.ts` with the pure `staticMapUrl` builder
  - [x] 9.1 Implement `staticMapUrl(latitude, longitude, options?)`
    - Add a pure, framework-free `staticMapUrl` to the existing
      `apps/mobile/src/screens/catalog/directions.ts` that builds a keyless OpenStreetMap-based
      static map image URL targeting `https://staticmap.openstreetmap.de/staticmap.php`
    - Compose the query string from `center=<lat>,<lng>`, `zoom=<z>` (default `16`),
      `size=<w>x<h>` (default `600x300`), and `markers=<lat>,<lng>,<style>`, stringifying the
      coordinates verbatim so both `center` and `markers` encode the exact latitude and longitude
    - Accept optional `zoom`, `width`, `height`, and `markerStyle` overrides; require no API key,
      access token, or secret; perform no I/O and no clamping
    - Keep the function total and deterministic — returns a defined string and never throws for any
      finite latitude in [-90, 90] and longitude in [-180, 180], yielding equal URLs for equal inputs
    - Preserve the existing `hasValidCoordinates` and `directionsUrl` exports unchanged
    - _Requirements: 10.3, 10.4, 10.9, 10.10_

  - [x]* 9.2 Write property tests for `staticMapUrl`
    - **Property 17: Static map URL encodes coordinates** (Validates: Requirements 10.3, 10.10)
    - **Property 18: Static map URL is total and deterministic for valid inputs** (Validates: Requirements 10.9, 10.10)
    - Add each as its own single property-based test at 100+ iterations in the existing
      `apps/mobile/src/screens/catalog/__tests__/directions.prop.test.ts`, following the existing
      directions property-test style and tagged
      `Feature: experience-detail-redesign, Property {number}: {property_text}`

- [x] 10. Render the Static Map Preview in `ExperienceDetailScreen.tsx`
  - [x] 10.1 Render the `Static_Map_Preview` within the Location area
    - In the `LocationGroupSection` of `ExperienceDetailScreen.tsx`, render a tappable `<Image>`
      (wrapped in a `Pressable`) sourced from `staticMapUrl(latitude, longitude)`, gated by the
      **same** `hasValidCoordinates(latitude, longitude)` check that governs the Get directions action
    - On tap, open the OS maps app via the same `Linking.openURL(directionsUrl(...))` path (same
      `try/catch` / `canOpenURL`) as Get directions, rendering the same inline error indication on
      failure while preserving the current screen state
    - Add a local `mapImageFailed` state flag set by the `<Image>` `onError` handler; when set, omit
      only the image while continuing to render the rest of the Location group content, including the
      Get directions action
    - Give the preview a non-empty accessibility label describing the map preview for the Experience;
      keep the Get directions button rendered independently of the preview
    - _Requirements: 10.1, 10.2, 10.5, 10.6, 10.7, 10.8_

  - [x]* 10.2 Write render tests for the Static Map Preview
    - Renders the `<Image>` preview when coordinates are valid; omits it when latitude/longitude are
      missing or out of range
    - Tapping the preview (with `Linking.openURL` mocked) invokes the same open-OS-maps behavior as
      Get directions and shows the error indication on failure while preserving screen state
    - The `<Image>` `onError` hides only the image while the Get directions action remains rendered
    - The preview exposes a non-empty accessibility label
    - _Requirements: 10.1, 10.2, 10.5, 10.6, 10.7, 10.8_

- [x] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Fix the directions open path — drop the `canOpenURL` gate, add an ordered candidate fallback
  - [x] 12.1 Add `directionsUrlCandidates` to `directions.ts`
    - Export `directionsUrlCandidates(latitude, longitude, platform?)` returning the ordered,
      duplicate-free Directions_Url_Candidates: `directionsUrl(lat, lng, platform)` first, then the
      universal web maps URL `directionsUrl(lat, lng, 'web')`; when `platform` is `'web'` the two
      coincide and a single-element list is returned
    - Keep the module pure and framework-free (no `Linking`, no `Platform`); preserve the existing
      `hasValidCoordinates`, `directionsUrl`, and `staticMapUrl` exports unchanged
    - _Requirements: 4.7, 4.9_

  - [x] 12.2 Rewrite `handleGetDirections` in `ExperienceDetailScreen.tsx`
    - Remove the `Linking.canOpenURL` pre-check entirely — on Android 11+ package visibility makes it
      resolve `false` for the `geo:` scheme unless declared in a native `<queries>` manifest element,
      which suppressed an `openURL` call that in fact succeeds
    - Iterate `directionsUrlCandidates(latitude, longitude, Platform.OS)`, awaiting
      `Linking.openURL(candidate)` inside `try/catch` and returning on the first success (clearing any
      prior error flag)
    - Set the error flag only after every candidate has rejected; keep all other screen state intact
    - Keep the `Static_Map_Preview` and the Get directions button sharing this single handler
    - _Requirements: 4.4, 4.5, 4.7, 4.8, 4.9, 10.5, 10.6_

  - [x] 12.3 Write the property test for `directionsUrlCandidates`
    - **Property 19: Directions URL candidates are ordered, non-empty, and coordinate-preserving**
      (Validates: Requirements 4.7, 4.9)
    - Add as its own single property-based test at 100+ iterations in
      `apps/mobile/src/screens/catalog/__tests__/directions.prop.test.ts`, tagged
      `Feature: experience-detail-redesign, Property 19: {property_text}`

  - [x] 12.4 Write regression render tests for the open path
    - Update `ExperienceDetailScreen.staticMap.test.tsx`: a `canOpenURL` stub resolving `false` must
      **not** suppress the open — assert `Linking.openURL` is still called and no
      `experience-directions-error` renders (this test fails against the pre-fix code)
    - Assert a first-candidate rejection falls back to the second candidate (two `openURL` calls, the
      second being the `https` web maps URL) with no error indication
    - Assert the error indication renders only when **every** candidate rejects, with screen state
      preserved
    - _Requirements: 4.5, 4.7, 4.8, 4.9, 10.5, 10.6_

## Amendment: Two-Lens Navigation (Requirements 11–19)

- [x] 13. Create the `tripContextDate.ts` pure module
  - [x] 13.1 Implement `resolveTripContextDate`
    - Precedence: non-null `plannedDate` first; else `todayWdw` when `activeTripRange` is non-null
      and `todayWdw` falls within `[startDate, endDate]` inclusive; else `activeTripRange.startDate`
      when `activeTripRange` is non-null; else `null`
    - Keep the module pure and framework-free (no React, no `Linking`, no navigation, no direct
      `wdwClock` call — `todayWdw` is passed in as a plain string)
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5_

  - [x] 13.2 Write property tests for `resolveTripContextDate`
    - **Property 20: Trip_Context_Date precedence** (Validates: Requirements 16.1, 16.2, 16.3, 16.4, 16.5)
    - **Property 21: Trip_Context_Date is total and deterministic** (Validates: Requirements 16.1, 16.2, 16.3, 16.4)
    - Generate the full cross-product of null/non-null `plannedDate` and `activeTripRange`, and
      `todayWdw` both inside and outside the range boundary (inclusive edges specifically), at 100+
      iterations each

- [x] 14. Create the `passportStats.ts` pure module
  - [x] 14.1 Implement `computePassportAverage`
    - Mean of non-null ratings in the input list, rounded to one decimal place; `null` when every
      entry is null (including the empty list); pure, total, never throws
    - _Requirements: 17.2, 17.3_

  - [x] 14.2 Write property tests for `computePassportAverage`
    - **Property 22: Passport average is the mean of non-null ratings, rounded to one decimal** (Validates: Requirements 17.2, 17.3)
    - **Property 23: Passport average recomputes correctly after a rating change** (Validates: Requirements 17.5, 17.6)
    - Generate rating lists mixing nulls and numeric values (including all-null and empty), plus
      single-entry edit/delete operations, at 100+ iterations each

- [x] 15. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Build the persistent header region components
  - [x] 16.1 Implement `LiveStatusStrip`
    - Reads `liveQ.data` and `liveSectionFor(category)`; renders standby wait + Lightning Lane
      (Ride/Character_Meet), reservation availability + next time (Restaurant), or next-showtime
      countdown (Show); omitted when `liveSectionFor` yields no section; renders the existing
      live-unavailable indicator on live failure
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_
  - [x] 16.2 Implement `QuickSpecsRow`
    - Renders duration/height/climate/category-feature chips from existing DTO fields; no new fields
    - _Requirements: 11.3_
  - [x] 16.3 Implement `LensSwitcher`
    - Two-segment control with `activeLens` state (`'today' | 'passport'`, default `'today'`);
      non-empty accessibility label per segment reflecting tab role and selected state
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.6_
  - [x] 16.4 Write render tests for the header region
    - Default Lens is `Today_In_Park_Lens`; switching swaps only the content below the switcher while
      header/hero/strip/specs/switcher/dock stay identical; correct `LiveStatusStrip` headline per
      category; strip omitted when `liveSectionFor` yields nothing; live-unavailable indicator on
      failure; segment accessibility labels reflect selected state
    - _Requirements: 11.1, 11.3, 11.4, 11.5, 11.6, 11.7, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_

- [x] 17. Build `VirtualQueueBanner`
  - [x] 17.1 Implement `VirtualQueueBanner`
    - Renders only when `liveDetail.boardingGroup?.state` is a non-empty string; displays the
      `currentGroupStart`–`currentGroupEnd` range when both are present; non-empty accessibility label
    - Consumes the existing `liveDetail.boardingGroup` field — no new DTO field, migration, or endpoint
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5_
  - [x] 17.2 Write tests for `VirtualQueueBanner`
    - **Property 24: Virtual Queue Banner renders iff `state` is present** (Validates: Requirements 15.1, 15.3)
    - Boundary cases as example-based render tests: `state` present with/without the group range,
      `state` absent, `boardingGroup` entirely absent; non-empty accessibility label asserted
    - _Requirements: 15.1, 15.2, 15.3, 15.4_

- [x] 18. Build `LiveWaitCockpit` and the category-specific Today_In_Park_Lens cards
  - [x] 18.1 Implement `LiveWaitCockpit` (Ride / Character_Meet)
    - Composes `WaitContextSelector` (Now/Trip/Typical, default Now; "Trip" segment present only when
      `resolveTripContextDate(...)` is non-null), the standby-wait instrument, the existing
      Lightning_Lane display, `VirtualQueueBanner`, the relocated existing Single_Rider_Strip, the
      forecast chart driven by the selected context, the Typical/Worst + Reliability stat pair, and
      the existing Best_Time_Verdict text
    - "Now" renders the live standby wait + current-hour forecast; "Typical" issues the
      `WaitInsightsDTO` query with no `date`; "Trip" issues it with `resolveTripContextDate(...)`'s
      result as `date`
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10_
  - [x] 18.2 Implement `DiningReservationCard` and `ShowtimesCard`
    - `DiningReservationCard` (Restaurant): reservation availability + the existing Reservation_Action
      unchanged
    - `ShowtimesCard` (Show/Character_Meet where `liveSectionFor()` resolves to showtimes): today's
      showtimes list + next-upcoming indicator
    - _Requirements: 14.1, 14.2_
  - [x] 18.3 Wire the Today_In_Park_Lens category dispatch
    - Render `LiveWaitCockpit` | `DiningReservationCard` | `ShowtimesCard` | neither (per
      `liveSectionFor()`), then the existing `LocationGroupSection` (Static_Map_Preview +
      Get_Directions_Action) below it for every category
    - _Requirements: 14.1, 14.2, 14.3, 14.4_
  - [x] 18.4 Write render tests for Today_In_Park_Lens category dispatch and the Cockpit
    - Default "Now"; switching to "Typical"/"Trip" issues the correctly-parameterized query; "Trip"
      segment omitted when `resolveTripContextDate` returns null; Single_Rider_Strip and
      Lightning_Lane assertions carried over from existing tests; Restaurant renders
      `DiningReservationCard`, Show renders `ShowtimesCard`, a no-live category renders neither;
      Location_Group renders below whichever (or none) is shown, for every category
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10, 14.1, 14.2, 14.3, 14.4_

- [x] 19. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 20. Build `ParkPassportCard` and `RestaurantDishLogCard`
  - [x] 20.1 Implement `ParkPassportCard`
    - Wraps the existing `CompletionControls` / `RatingControl` / `NoteControl` and the existing
      `logsQ` visit-history list; adds a visit-count + `computePassportAverage(...)` header, an
      expandable per-visit-log list (date, per-entry rating, per-entry note), per-entry rating
      edit/delete that triggers the existing `['experience-rating', id]` +
      `['experience-aggregate', id]` invalidations and locally recomputes the header average; existing
      empty state when zero logs
    - Preserve every accessibility label, loading/error/empty independence, and mutation-invalidation
      behavior from Requirement 6 for the underlying controls
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8_
  - [x] 20.2 Implement `RestaurantDishLogCard` (Restaurant only)
    - Renders the existing food-item-log query's items as name/rating/note rows, reusing the existing
      "Log a food item" / "My logged items" / "Add to a list" handlers unchanged; existing empty state
      when the list is empty; omitted for non-Restaurant categories
    - _Requirements: 18.1, 18.2, 18.3, 18.4_
  - [x] 20.3 Write render tests for `ParkPassportCard` and `RestaurantDishLogCard`
    - Visit count + average header; per-entry rating edit recomputes the header average and fires the
      existing invalidations; per-entry delete removes the entry, updates count and average, preserves
      remaining order; empty state when zero logs; every existing R6 accessibility/loading/error/
      mutation assertion re-run against the new layout; dish log renders items with name/rating/note,
      empty state, omission for non-Restaurant categories
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 18.1, 18.2, 18.3, 18.4_

- [x] 21. Build `FloatingActionDock` and wire the My_Passport_And_Lore_Lens
  - [x] 21.1 Implement `FloatingActionDock`
    - Fixed-position, category- and Lens-aware two-button control; selects its label pair per R19.2–
      R19.4 and delegates to the exact existing handlers from Requirements 6/8/Task 7.3 — no new
      mutation logic; non-empty accessibility label per action; content area reserves bottom padding
      ≥ the dock's measured height
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7_
  - [x] 21.2 Wire the My_Passport_And_Lore_Lens
    - Compose `ParkPassportCard` → `RestaurantDishLogCard` (Restaurant only) → `AboutSection` →
      Why_This_Section under the "Imagineer's Insider Notes" label (copy change only) →
      `Community_Rating_Section` → remaining `TagGroupCard`s, all reusing existing components
    - _Requirements: 11.1, 11.5_
  - [x] 21.3 Write render tests for `FloatingActionDock` and the full Lens composition
    - Correct label pair per category × Lens combination; each action invokes the exact pre-existing
      handler (spy-asserted, not a new mock behavior); dock remains rendered while Lens content
      scrolls; My_Passport_And_Lore_Lens renders its cards in the specified order with the renamed
      Why_This_Section label
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7_

- [x] 22. Fix the Trip_Context_Date regression in the existing `WaitInsightsSection`/`LiveWaitCockpit` wiring
  - [x] 22.1 Replace the unconditional `activeTrip.startDate` resolution
    - Wire the screen to call `resolveTripContextDate(...)` with the Experience's planned-item date
      (if scheduled), the active/nearest-upcoming trip's date range, and today's WDW date, replacing
      the pre-existing `tripDate = activeTrip ? activeTrip.startDate : null` logic entirely — not as
      an additional fallback alongside it
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6_
  - [x] 22.2 Write the regression test for the Trip date fix
    - Assert that for a multi-day active trip where the Experience has a planned item scheduled on a
      day other than the trip's `startDate`, the "Trip" forecast query uses the planned item's date,
      not `startDate` — this test must fail against the pre-fix code path
    - Assert that for an active trip with no planned item for this Experience, where today falls
      within the trip's range, the query uses today's date, not `startDate`
    - Assert that for an upcoming (not-yet-started) trip with no planned item, the query falls back to
      `startDate`
    - Assert that with no active or upcoming trip at all, the "Trip" segment is omitted entirely
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.6_

- [x] 24. Backend Data Layer: Migration 0049_resort_metadata.sql, ResortDTO and Fastify routes
  - [x] 24.1 Create additive migration `0049_resort_metadata.sql` adding `tier`, `feature_pool`, `transportation_modes`, `recreation`, and `transit_times` to `resorts` with seeded values for WDW resorts, and write `apps/api/src/db/__tests__/migration0049.test.ts`
    - _Requirements: 20.1, 20.4_
  - [x] 24.2 Update `packages/shared/src/dto/Resort.ts` and `schemas/Resort.ts` to export typed fields on `ResortDTO`
    - _Requirements: 20.1, 20.4_
  - [x] 24.3 Expose resort metadata in `apps/api/src/services/catalog/` (`GET /resorts` and `GET /catalog/:id`), and add optional `resortId` filter to `listActiveExperiences`
    - _Requirements: 20.4_

- [x] 25. Mobile Core Fixes: Live queue suppression, Location Group landmark resolution, and Floating Action Dock
  - [x] 25.1 In `ExperienceDetailScreen.tsx`, suppress live queries and `<LiveUnavailableIndicator />` when `liveSectionFor === 'none'`
    - _Requirements: 20.3, 21.2_
  - [x] 25.2 In `LocationGroupSection.tsx`, update `resolveLandmarkDetails` for `areaType === 'Resort'` / `resortArea` to display resort name and area, eliminating the Magic Kingdom Central Plaza default
    - _Requirements: 21.1_
  - [x] 25.3 In `FloatingActionDock.tsx` and `DiningReservationCard.tsx`, update Quick Service handling to display `Log a Dish` + `Add to Trip` instead of `Reserve Table`, and title the card `Quick Service & Dishes`
    - _Requirements: 21.3, 21.4_

- [x] 26. Mobile Resort Guide & Lenses
  - [x] 26.1 In `QuickSpecsRow.tsx` and `ExperienceDetailScreen.tsx`, implement category-polymorphic specs for `category === 'Resort'` (Tier, Area, Primary Transit, Feature Pool) sourcing matched Resort metadata without Coronado fallbacks, and `category === 'Tour'` / `Recreation`
    - _Requirements: 20.1_
  - [x] 26.2 In `LensSwitcher.tsx`, label lenses `Resort Guide` and `Stay Passport & Lore` for Resorts, and `Today at Resort` for resort activities
    - _Requirements: 20.2, 21.5_
  - [x] 26.3 Implement `ResortGuideSection.tsx` rendering authentic resort-specific Highlights, On-Property Dining (interactive cards with venue subtitles, service tags, green price tiers, and 'Reserve' / 'Menu ›' action buttons navigating to ExperienceDetail, queried per resort with authentic fallbacks), Recreation & Amenities, and Property Map & Transit with verified street addresses and destination-specific transit mode indicators (Boat, Monorail, Skyliner, Bus)
    - _Requirements: 20.4, 20.5, 20.6_
  - [x] 26.4 Fix the Resort-representing Experience's `resortArea` (backend `toResortRepresentingExperience` in `sync.ts` hardcoded `resortArea: null` instead of resolving it from the Resort's own Facility_Document ancestor chain), populate the `Experience_Detail_Screen` header subtitle and `ExperienceHero` location pin badge from it for Resorts (falling back to Park, then omitting the text rather than rendering blank), and remove the now-redundant Geographic Area chip from `QuickSpecsRow`'s Resort branch since the header subtitle and hero photo pin already convey it
    - _Requirements: 20.1, 20.7, 20.8_
  - [x] 26.5 In `QuickSpecsRow.tsx`, replace the equal-thirds chip layout with a natural-width-plus-one-growing-chip layout (`specItemGrow` on the last, longest-text chip per category branch) so short fixed-length chips (tier, transit, duration, climate) no longer get stretched or steal space from the long, variable-length chip (feature pool / feature label) that was still truncating even after the Area chip was removed
    - _Requirements: 20.1_

- [x] 27. Resorts Destination Screen 'Other' Category Refactoring
  - [x] 27.1 In `catalogGrouping.ts`, replace the `Other` catch-all with structured sub-destinations (*Disney's BoardWalk & Promenade*, *ESPN Wide World of Sports Complex*, and *Property-Wide Recreation & Sports*)
    - _Requirements: 22.1, 22.2, 22.3, 22.4_
  - [x] 27.2 Update `DestinationScreen.tsx` and write property tests for `groupByResort`
    - _Requirements: 22.1, 22.2, 22.3, 22.4_

- [x] 28. Final Checkpoint & Full Verification
  - [x] 28.1 Run all unit and property tests across modified modules
  - [x] 28.2 Run `npm run verify` across all workspaces and paste literal output
    - _Requirements: All_

- [x] 29. Park Passport Tip Empty State & Authentic Display
  - [x] 29.1 In `ParkPassportCard.tsx`, eliminate the hardcoded placeholder quote fallback and render a clean empty tip state with an '+ Add Tip' affordance when no personal tip or visit note exists
    - _Requirements: 17.11_
  - [x] 29.2 In `ParkPassportCard.test.tsx`, write render and interaction tests verifying empty tip state prompt, '+ Add Tip' modal opening, and authentic tip rendering
    - _Requirements: 17.11_

- [x] 30. Resort Dining Served Meal Periods Display
  - [x] 30.1 In `ResortGuideSection.tsx`, update `ResortDiningVenue` interface to include `readonly meals?: readonly string[] | undefined;`, extract meal periods from dynamic `ExperienceDTO.mealPeriods` with non-meal tag filtering (e.g. 'Pool Bar') and canonical chronological sorting (`Breakfast`, `Brunch`, `Lunch`, `Dinner`, `Late Night`) with fallback to `KNOWN_DINING_METADATA`, populate authentic meal periods in `KNOWN_DINING_METADATA` and `KNOWN_RESORT_PROFILES` fallback dining items, and render meal periods on their own dedicated line between subtitle and tag row (`resort-dining-meals-${venue.id}`) to prevent truncation
    - _Requirements: 20.4_
  - [x] 30.2 In `ResortGuideSection.test.tsx`, write render tests asserting meal periods are rendered on their own dedicated line in canonical chronological order, non-meal tags are filtered, and fallback dining venues render authentic meals
    - _Requirements: 20.4_

## Notes

- Tasks marked with `*` are optional test tasks and can be skipped for a faster MVP.
- Each task references specific requirements for traceability; property test tasks additionally
  reference the exact design property they implement.
- Property tests run at a minimum of 100 iterations and each implements exactly one correctness
  property, tagged `Feature: experience-detail-redesign, Property {number}: {property_text}`.
- Property tests target the pure cores (`infoTags.ts`, `directions.ts`, `shareEntryPoint.ts`,
  `gating.ts`, aggregate helper, and — for the Two-Lens amendment — `tripContextDate.ts` and
  `passportStats.ts`); example-based render tests cover UI composition, ordering, and interaction
  criteria (R5, R6, R7, most of R8, and R11–R19).
- Checkpoints ensure incremental validation before wiring the screen together.
- Task 22 is a bug fix to already-shipped code (`WaitInsightsSection.tsx`'s trip-date resolution), not
  new-feature work; per this repo's execution-discipline convention its regression test (22.2) must be
  written to fail against the pre-fix code path, not merely pass after the fix.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "4.1", "5.1", "6.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "4.2", "5.2", "6.2", "6.3", "6.4"] },
    { "id": 2, "tasks": ["1.3", "1.4", "1.5", "7.1"] },
    { "id": 3, "tasks": ["7.2"] },
    { "id": 4, "tasks": ["7.3", "7.4", "7.5"] },
    { "id": 5, "tasks": ["9.1"] },
    { "id": 6, "tasks": ["9.2", "10.1"] },
    { "id": 7, "tasks": ["10.2"] },
    { "id": 8, "tasks": ["12.1"] },
    { "id": 9, "tasks": ["12.2", "12.3"] },
    { "id": 10, "tasks": ["12.4"] },
    { "id": 11, "tasks": ["13.1", "14.1"] },
    { "id": 12, "tasks": ["13.2", "14.2"] },
    { "id": 13, "tasks": ["15"] },
    { "id": 14, "tasks": ["16.1", "16.2", "16.3", "17.1"] },
    { "id": 15, "tasks": ["16.4", "17.2", "18.1", "18.2"] },
    { "id": 16, "tasks": ["18.3"] },
    { "id": 17, "tasks": ["18.4"] },
    { "id": 18, "tasks": ["19"] },
    { "id": 19, "tasks": ["20.1", "20.2", "21.1"] },
    { "id": 20, "tasks": ["20.3", "21.2"] },
    { "id": 21, "tasks": ["21.3"] },
    { "id": 22, "tasks": ["22.1"] },
    { "id": 23, "tasks": ["22.2"] },
    { "id": 24, "tasks": ["23"] },
    { "id": 25, "tasks": ["24.1", "24.2"] },
    { "id": 26, "tasks": ["24.3", "25.1", "25.2", "25.3"] },
    { "id": 27, "tasks": ["26.1", "26.2", "26.3"] },
    { "id": 28, "tasks": ["27.1", "27.2"] },
    { "id": 29, "tasks": ["28.1", "28.2"] },
    { "id": 30, "tasks": ["29.1", "29.2"] },
    { "id": 31, "tasks": ["30.1", "30.2"] }
  ]
}
```
