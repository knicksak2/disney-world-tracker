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

## Notes

- Tasks marked with `*` are optional test tasks and can be skipped for a faster MVP.
- Each task references specific requirements for traceability; property test tasks additionally
  reference the exact design property they implement.
- Property tests run at a minimum of 100 iterations and each implements exactly one correctness
  property, tagged `Feature: experience-detail-redesign, Property {number}: {property_text}`.
- Property tests target the pure cores (`infoTags.ts`, `directions.ts`, `shareEntryPoint.ts`,
  `gating.ts`, aggregate helper); example-based render tests cover UI composition, ordering, and
  interaction criteria (R5, R6, R7, most of R8).
- Checkpoints ensure incremental validation before wiring the screen together.

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
    { "id": 7, "tasks": ["10.2"] }
  ]
}
```
