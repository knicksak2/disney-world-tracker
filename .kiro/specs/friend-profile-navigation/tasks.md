# Implementation Plan: Friend Profile Navigation

## Overview

This plan implements the tabbed reorganization of the Friend_Profile_View and the Own_Stats_View as a purely client-side (mobile) presentation enhancement. It builds bottom-up: first the pure, framework-free logic that carries the feature's correctness guarantees (`useViewMode`, `grouping`, `experienceFilter`), then the shared presentation components (`TabSelector`, `CompletionRow`, `ExperiencesList`), then the new `useOwnCompletions` query, and finally the two screen refactors that wire everything together. Property-based tests (Properties 1–5) accompany the pure modules; React Native Testing Library (RNTL) and request-spy tests accompany the components and screens. No backend code, route, authorization rule, or response shape changes.

All paths are under `apps/mobile/src/`. Implementation language is TypeScript (React Native), per the design.

## Tasks

- [x] 1. Implement the selection state machine (`screens/navigation/useViewMode.ts`)
  - [x] 1.1 Implement `resolveSelectedMode` and `useViewMode`
    - Create `screens/navigation/useViewMode.ts` with the generic `resolveSelectedMode<M>(modes, selected)` pure resolver: return the sole element when exactly one valid mode is selected, otherwise return the default `modes[0]` (covers empty, no-mode, and multi-mode states, and the initial render)
    - Implement the `useViewMode<M>(modes)` hook that holds the active mode, exposes `select(next)` that makes a tapped unselected mode the sole selected mode and leaves an already-active mode active, and routes all state through `resolveSelectedMode` so zero/two selected modes are unrepresentable
    - _Requirements: 1.3, 1.4, 1.8, 8.3, 8.4, 8.8, 8.9_

  - [x] 1.2 Write property test for mode resolution
    - File: `screens/navigation/__tests__/useViewMode.prop.test.ts`, `fast-check`, `numRuns: 100`, header comment `// Feature: friend-profile-navigation, Property 5: ...`
    - **Property 5: Mode selection always resolves to exactly one mode**
    - Use a `selectionArb` generating empty, singleton, and multi/duplicate selection sets over both the Profile_View_Modes and Own_Stats_View_Modes tuples; assert `resolveSelectedMode` returns exactly one mode (the sole valid selection, else the default) and that selecting the already-active mode is idempotent
    - **Validates: Requirements 1.3, 1.4, 1.8, 8.3, 8.4, 8.8, 8.9**

- [x] 2. Implement pure grouping folds (`screens/navigation/grouping.ts`)
  - [x] 2.1 Implement `namedEntries`, `groupByPark`, and `groupByCategory`
    - Create `screens/navigation/grouping.ts` importing `CompletionEntryDTO`, `Park`, `ExperienceCategory` from `@dwt/shared`
    - `namedEntries(entries)`: keep only entries with an available (non-empty, non-whitespace) Experience name, preserving source order
    - `groupByPark(entries, parks)`: one `ParkGroup` per catalog Park in catalog order; each named entry lands in exactly the group whose Park equals its Park; other-Park and unnamed entries excluded; source order preserved within each group
    - `groupByCategory(entries, categories)`: one `CategoryGroup` per Experience_Category in enumerated order with the same partition guarantees
    - _Requirements: 3.1, 3.4, 3.6, 4.1, 4.3, 4.5, 4.6, 6.1, 6.2, 6.3, 6.4_

  - [x] 2.2 Write property test for the Experiences-list identity
    - File: `screens/navigation/__tests__/grouping.prop.test.ts`, `fast-check`, `numRuns: 100`, Property 1 header comment
    - **Property 1: The Experiences list is exactly the named entries in source order**
    - Use a `completionEntryArb` mixing named and empty/whitespace-named entries; assert `namedEntries` keeps exactly the named entries, once each, in source order, and drops every unnamed entry
    - **Validates: Requirements 5.1, 5.3, 13.1, 13.3**

  - [x] 2.3 Write property test for Park grouping
    - File: `screens/navigation/__tests__/grouping.prop.test.ts` (same suite), `numRuns: 100`, Property 2 header comment
    - **Property 2: Park grouping is a faithful, order-preserving partition**
    - Generate entry lists over all Parks (including never-visited Parks) and unnamed entries; assert one group per catalog Park in order, each named entry in exactly one group, no unnamed entry in any group, source order preserved, and the concatenation of groups equals `namedEntries(entries)` as a multiset and count
    - **Validates: Requirements 3.1, 3.4, 3.6, 6.1, 6.3**

  - [x] 2.4 Write property test for Category grouping
    - File: `screens/navigation/__tests__/grouping.prop.test.ts` (same suite), `numRuns: 100`, Property 3 header comment
    - **Property 3: Category grouping is a faithful, order-preserving partition**
    - Generate entry lists over all categories (including empty categories) and unnamed entries; assert one group per category in enumerated order, single-group membership, no unnamed entries, source order preserved, and concatenation equals `namedEntries(entries)` as a multiset and count
    - **Validates: Requirements 4.1, 4.3, 4.5, 4.6, 6.2, 6.4**

- [x] 3. Implement the pure Experience_Filter (`screens/navigation/experienceFilter.ts`)
  - [x] 3.1 Implement `applyExperienceFilter`, `DEFAULT_FILTER`, and filter types
    - Create `screens/navigation/experienceFilter.ts` with `FilterParkSelection`, `FilterCategorySelection`, `ExperienceFilterState`, and `DEFAULT_FILTER = { park: 'All', category: 'All' }`
    - `applyExperienceFilter(entries, state)`: keep every named entry whose Park matches `state.park` (or `'All'`) AND whose Category matches `state.category` (or `'All'`), in source order; exclude entries failing either selection; with both `'All'` the result equals `namedEntries(entries)`
    - _Requirements: 14.2, 14.3, 14.5, 14.6, 14.7_

  - [x] 3.2 Write property test for the Experience_Filter
    - File: `screens/navigation/__tests__/experienceFilter.prop.test.ts`, `fast-check`, `numRuns: 100`, Property 4 header comment
    - **Property 4: The Experience_Filter selects exactly the matching named entries in source order**
    - Generate entry lists × a `filterStateArb` (`All/All`, single-axis, and both-axis selections); assert the result is exactly the named entries satisfying both selections in source order, and that `All/All` equals the unfiltered named-entry set
    - **Validates: Requirements 14.5, 14.6, 14.7**

- [x] 4. Checkpoint - pure logic complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Build the shared presentation components
  - [x] 5.1 Implement `TabSelector` (`screens/navigation/TabSelector.tsx`)
    - Create the generic `TabSelector<M>` rendering one `Pressable` tab per `TabSpec` (distinct icon, non-empty label), with `accessibilityRole="tab"`, `accessibilityState={{ selected: tab.mode === active }}`, and a visible active treatment differing in at least one attribute from inactive tabs; mount only the active pane's content via `onSelect`
    - Define `TabSpec<M>` and the module-constant tab spec arrays (fixed order, distinct icons) for both screens' selectors
    - _Requirements: 1.1, 1.2, 1.5, 1.6, 1.7, 8.1, 8.2, 8.5, 8.6, 8.7_

  - [x] 5.2 Write RNTL tests for `TabSelector`
    - File: `screens/navigation/__tests__/TabSelector.test.tsx`
    - Assert four tabs with expected labels and distinct icons, the active tab's `accessibilityState.selected === true` and others `false`, tapping an unselected tab fires `onSelect`, and tapping the active tab keeps it active
    - _Requirements: 1.1, 1.2, 1.6, 1.7, 8.1, 8.2, 8.6, 8.7, 8.9_

  - [x] 5.3 Extract `CompletionRow` (`screens/navigation/CompletionRow.tsx`)
    - Extract the existing per-entry row from `FriendProfileScreen.tsx` into a reusable `CompletionRow` component rendering the Experience name, Completion date as a calendar date, Rating when present (omitted when absent), and shared Note when present (omitted when absent)
    - Add a `fields` prop selecting the contextual metadata line (Parks omits Park, Categories omits Category, Experiences shows both) so all modes and both screens render entries identically
    - _Requirements: 3.5, 4.4, 5.2, 13.2_

  - [x] 5.4 Write RNTL tests for `CompletionRow`
    - File: `screens/navigation/__tests__/CompletionRow.test.tsx`
    - Assert name/date always render; Rating and Note appear only when present; the `fields` prop omits the implied field per mode
    - _Requirements: 3.5, 4.4, 5.2, 13.2_

  - [x] 5.5 Implement `ExperiencesList` with the Experience_Filter UI (`screens/navigation/ExperiencesList.tsx`)
    - Create `ExperiencesList({ entries, testIDPrefix })` owning its own `useState(DEFAULT_FILTER)` (independent per instance), rendering Park and Category filter controls plus a `CompletionRow` per `applyExperienceFilter(entries, state)` result
    - Offer `'All'` plus exactly one option per catalog Park and per Experience_Category; expose `accessibilityLabel` and `accessibilityValue` on each control; show the no-match message when the filtered result is empty and the mode empty-state when the unfiltered named set is empty; update synchronously on selection change with no read
    - _Requirements: 5.1, 5.4, 13.1, 13.4, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9_

  - [x] 5.6 Write RNTL tests for `ExperiencesList` and the Experience_Filter
    - File: `screens/navigation/__tests__/ExperiencesList.test.tsx`
    - Assert default `All`/`All`; option sets equal `PARKS`/`EXPERIENCE_CATEGORIES` plus `All`; two mounted lists hold independent filter state; the no-match empty-state message; the empty named-set message; and the controls' `accessibilityLabel`/`accessibilityValue`
    - _Requirements: 5.4, 13.4, 14.1, 14.2, 14.3, 14.8, 14.9_

- [x] 6. Implement the Own_Completions query hook (`hooks/useOwnCompletions.ts`)
  - [x] 6.1 Implement `useOwnCompletionsQuery`
    - Create `hooks/useOwnCompletions.ts` that reads the cached `['me']` query to resolve `ownUserId`, then issues the existing `fetchFriendCompletions(ownUserId)` helper (reusing its 30-second timeout and error translation), keyed `['own-completions', ownUserId]` and fetched once so a mode switch reads from cache
    - Because this is the owner path, no `profile_forbidden` branch is required; failures flow through the standard error+retry path
    - _Requirements: 12.4, 12.7, 12.8, 12.9_

  - [x] 6.2 Write unit test for `useOwnCompletionsQuery`
    - File: `hooks/__tests__/useOwnCompletions.test.tsx`
    - With a mocked `apiRequest`/`fetchFriendCompletions`, assert it resolves `ownUserId` from `['me']`, calls completions with that id, keys the query as `['own-completions', ownUserId]`, and surfaces a failure as a non-forbidden error
    - _Requirements: 12.7, 12.8_

- [x] 7. Checkpoint - shared building blocks complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Refactor the Friend_Profile_View (`screens/friends/FriendProfileScreen.tsx`)
  - [x] 8.1 Wire the View_Selector and the four modes into `FriendProfileScreen`
    - Keep the existing three queries (`useFriendProfileQuery`, `useFriendStatsQuery`, `useFriendCompletionsQuery`) and their retry policy unchanged; when any Friend read is `profile_forbidden`, withhold the View_Selector and all modes and show the unavailable message
    - Otherwise render `TabSelector` via `useViewMode(['Overview','Parks','Categories','Experiences'])` and the active mode: Overview (profile card, name, avatar/placeholder, overall percent to one decimal, completed count); Parks (per-Park stat header from `byPark` + `groupByPark`, empty-Park message); Categories (per-category header from `byCategory` with suppressed counts/percent when empty + `groupByCategory`); Experiences (`ExperiencesList` over `completionsQuery.data.entries` with `testIDPrefix="friend"`)
    - Scope each mode's loading indicator and error+retry to the read(s) that mode displays; keep the selector usable while a non-forbidden read is in error and retain other modes' loaded data
    - _Requirements: 1.1, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.1, 5.2, 5.3, 5.4, 6.5, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x] 8.2 Write RNTL tests for Friend mode content
    - File: `screens/friends/__tests__/FriendProfileScreen.modes.test.tsx`
    - Per mode, assert rendered fields, one-decimal percentages, completed/total counts, avatar vs. placeholder, empty Park/Category indications, and the Experiences empty-state, using fixture data; assert tapping a tab swaps the visible pane
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.2, 3.5, 3.7, 4.2, 4.4, 4.7, 5.2, 5.4_

  - [x] 8.3 Write RNTL tests for Friend loading / forbidden / error / retry
    - File: `screens/friends/__tests__/FriendProfileScreen.states.test.tsx`
    - With controllable promises and fake timers, assert in-pane loaders, the `profile_forbidden` unavailable-and-withheld-selector branch, in-pane error + retry, and the 30-second timeout surfacing as a non-forbidden error
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x] 8.4 Write request-spy tests for Friend no-refetch and scoped retry
    - File: `screens/friends/__tests__/FriendProfileScreen.refetch.test.tsx`
    - Assert zero additional `apiRequest` calls when switching through every mode and when changing filter selections; assert tapping a failed read's retry re-issues only that read while other modes keep cached data and tabs stay selectable
    - _Requirements: 6.5, 7.5, 7.6, 14.4_

- [x] 9. Refactor the Own_Stats_View (`screens/stats/StatsScreen.tsx`)
  - [x] 9.1 Wire the Own_Stats_Selector, the four modes, and `useOwnCompletions` into `StatsScreen`
    - Keep the existing `me-stats` query (`GET /me/stats`) and render `TabSelector` via `useViewMode(['Own_Overview','Own_Parks','Own_Categories','Own_Experiences'])`: Own_Overview (`overall` to one decimal with completed/total, zero-total shows 0.0/0); Own_Parks (one `Own_Park_Stat` per catalog Park in order from `byPark`); Own_Categories (one `Own_Category_Stat` per category in order from `byCategory`); Own_Experiences (`ExperiencesList` over `useOwnCompletionsQuery` entries with `testIDPrefix="own"`)
    - Gate the selector and the three stats modes on `GET /me/stats` loading/error; give the Own_Experiences pane its own loading/error/retry scoped to the Own_Completions_Read; include no `profile_forbidden` branch
    - _Requirements: 8.1, 8.3, 8.4, 8.5, 9.1, 9.2, 9.3, 10.1, 10.2, 10.3, 11.1, 11.2, 11.3, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9, 13.1, 13.2, 13.3, 13.4_

  - [x] 9.2 Write RNTL tests for Own mode content
    - File: `screens/stats/__tests__/StatsScreen.modes.test.tsx`
    - Per mode, assert the overall percent/counts (incl. zero-total 0.0/0), per-Park and per-category stats in catalog/enumerated order, the Own_Experiences list, and its empty-state; assert tapping a tab swaps the visible pane and keeps the active tab active
    - _Requirements: 8.5, 8.9, 9.1, 9.2, 9.3, 10.1, 10.2, 10.3, 11.1, 11.2, 11.3, 13.2, 13.4_

  - [x] 9.3 Write RNTL tests for Own loading / error / retry
    - File: `screens/stats/__tests__/StatsScreen.states.test.tsx`
    - With controllable promises and fake timers, assert the view-level `GET /me/stats` loader and error+retry (incl. 30-second timeout) and the Own_Experiences in-pane loader and error+retry scoped to the Own_Completions_Read
    - _Requirements: 12.1, 12.2, 12.3, 12.5, 12.7, 12.8_

  - [x] 9.4 Write request-spy tests for Own no-refetch and scoped retry
    - File: `screens/stats/__tests__/StatsScreen.refetch.test.tsx`
    - Assert zero additional reads when switching through every Own mode and when changing filter selections; assert the stats retry re-issues only `GET /me/stats` and the Own_Experiences retry re-issues only the Own_Completions_Read
    - _Requirements: 12.4, 12.6, 12.9, 14.4_

- [x] 10. Final checkpoint - full feature integrated
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test tasks and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each task references specific requirement sub-clauses for traceability.
- Properties 1–5 are each implemented by exactly one property-based test using `fast-check` at `numRuns: 100`, located in `screens/navigation/__tests__/*.prop.test.ts`, placed next to the pure module they validate to catch regressions early.
- RNTL tests cover rendering, accessibility, and loading/forbidden/error/retry branches; request-spy tests cover the no-refetch-on-mode-switch (R6.5, R12.4), no-refetch-on-filter-change (R14.4), and scoped-retry (R7.5, R7.6, R12.6, R12.9) behaviors.
- The feature is client-only: no backend code, route, authorization rule, or response shape changes.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1", "5.1", "5.3", "6.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "2.3", "2.4", "3.2", "5.2", "5.4", "6.2", "5.5"] },
    { "id": 2, "tasks": ["5.6", "8.1", "9.1"] },
    { "id": 3, "tasks": ["8.2", "8.3", "8.4", "9.2", "9.3", "9.4"] }
  ]
}
```
