# Implementation Plan: Experience Detail Navigation

## Overview

This plan threads the catalog `Experience_Id` through the Tracking_Service Completions read (backend repo → route DTO → shared wire contract), then makes the mobile `CompletionRow` a tappable navigation affordance into the existing `ExperienceDetailScreen`, and finally turns the four grouped views into collapsible `Group_Section`s. Work proceeds from the data layer outward so each client step builds on a contract that already carries `experienceId`. Pure logic (read projection, target resolver, repeat-tap guard, group-section reducer) is property-tested with `fast-check`; wiring, accessibility roles, and timing are covered by example/integration tests.

The implementation language is **TypeScript**, matching the existing `apps/api`, `packages/shared`, and `apps/mobile` codebases.

## Tasks

- [x] 1. Extend the shared Completions wire contract
  - [x] 1.1 Add `experienceId` to `CompletionEntryDTO`
    - In `packages/shared/src/dto/CompletionEntry.ts`, add `readonly experienceId: string;` as the first field, documented as the catalog Experience_Id (UUID) used as the `ExperienceDetail` navigation target.
    - Keep all other fields and their order unchanged so existing consumers compile unchanged.
    - _Requirements: 1.1, 1.3_

- [x] 2. Project the Experience_Id through the Tracking_Service Completions read
  - [x] 2.1 Add `experienceId` to the friend-completions repo
    - In `apps/api/src/services/tracking/friendCompletions/repo.ts`, add `e.id AS experience_id` as the first projected column of the existing SELECT (reusing the current `JOIN experiences e ON e.id = c.experience_id AND e.active = TRUE`); add no new join, filter, ordering, or limit.
    - Add `readonly experienceId: string;` to the `CompletionEntry` interface and map `experienceId: row.experience_id` in `rowToEntry`.
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 2.2 Map `experienceId` onto the route DTO
    - In `apps/api/src/services/tracking/friendCompletions/routes.ts`, add `experienceId: entry.experienceId` to `toCompletionEntryDTO`, leaving the `assertOwnerOrFriend` authorization gate and the rest of the handler unchanged.
    - _Requirements: 1.1, 1.5_

  - [x] 2.3 Write property test for the Experience_Id projection
    - **Property 1: Completion projection carries the matching Experience_Id**
    - Using `pg-mem` per the existing `friendCompletions/__tests__` pattern, generate random users/experiences/completions and assert each returned entry's `experienceId` equals the `experiences.id` of the same Active Experience whose `name`/`park`/`category` the entry reports.
    - **Validates: Requirements 1.1, 1.2, 1.3**

  - [x] 2.4 Write property test for read-contract preservation
    - **Property 2: Adding Experience_Id preserves the existing read contract**
    - Assert that the returned entries with `experienceId` stripped are identical in membership, ordering (`completed_on` desc, then case-insensitive name/park/category), 5,000-entry cap, Rating values, and shared-Note disclosure to the pre-change contract.
    - **Validates: Requirements 1.4**

  - [x] 2.5 Confirm authorization is unaffected by the new field
    - Extend/confirm the existing route test that a denied request returns `profile_forbidden` (403) and discloses no Completion_Entry or Experience_Id (read not performed on the deny path).
    - _Requirements: 1.5_

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement the mobile navigation module
  - [x] 4.1 Implement `resolveExperienceTarget`
    - Create `apps/mobile/src/screens/navigation/experienceNavigation.ts` with a pure `resolveExperienceTarget(entry: CompletionEntryDTO): string | null` that returns `entry.experienceId` unmodified when present and non-empty, otherwise `null`.
    - _Requirements: 6.1, 6.2_

  - [x] 4.2 Implement the `useOpenExperience` hook
    - In the same file, add `useOpenExperience()` returning `openExperience(experienceId)` that dispatches `navigation.navigate('Catalog', { screen: 'ExperienceDetail', params: { experienceId } })`.
    - Hold a `useRef` in-flight flag so a burst of taps dispatches exactly once; clear the flag on screen focus (`useFocusEffect`) so a deliberate later tap navigates again.
    - _Requirements: 2.1, 3.1, 5.1, 5.2, 5.3, 6.2_

  - [x] 4.3 Write property test for target resolution
    - **Property 3: Navigation target is the exact Experience_Id when present, and absent otherwise**
    - Generate entries with present, missing, null, and blank `experienceId` and assert the returned value is the unchanged id or `null` accordingly.
    - **Validates: Requirements 2.1, 3.1, 3.3, 6.1, 6.2, 11.3**

  - [x] 4.4 Write property test for the repeat-tap guard
    - **Property 4: Repeated taps navigate exactly once**
    - Generate N ≥ 1 activations occurring before the originating screen regains focus and assert exactly one navigation dispatch with no duplicate instances.
    - **Validates: Requirements 5.1, 5.2**

- [x] 5. Make `CompletionRow` an activatable navigation affordance
  - [x] 5.1 Enhance `CompletionRow` with optional navigation
    - In `apps/mobile/src/screens/navigation/CompletionRow.tsx`, add an optional `onOpenExperience?: (experienceId: string) => void` prop and compute `target = resolveExperienceTarget(entry)`.
    - When `onOpenExperience` is provided and `target !== null`, render through the `Card`'s single full-row `Pressable` `onPress` with `accessibilityRole="button"` and an `accessibilityLabel` that includes the Experience name; pressing or assistive-activating calls `onOpenExperience(target)`.
    - When `target === null` or no callback is supplied, render exactly as today as a plain, non-activatable card that ignores taps.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 6.1, 6.2_

  - [x] 5.2 Write property test for the row accessibility label
    - **Property 5: Row accessibility label includes the Experience name**
    - Over generated entries rendered as activatable rows, assert the accessibility label includes the entry's Experience name.
    - **Validates: Requirements 4.2**

  - [x] 5.3 Write affordance-gating example tests
    - Render a row without a callback and with a missing/blank id; assert no activatable control is exposed and presses/activations perform no navigation.
    - _Requirements: 4.4, 6.1_

- [x] 6. Implement the group-section state model
  - [x] 6.1 Implement the pure `groupSectionState` reducer
    - Create `apps/mobile/src/screens/navigation/groupSectionState.ts` with `GroupSectionState = ReadonlySet<string>`, `initialGroupSectionState()` (empty ⇒ all Collapsed), `isExpanded(state, key)`, and `toggle(state, key)` that returns a new set flipping only `key`.
    - _Requirements: 7.3, 8.1, 10.1, 10.3_

  - [x] 6.2 Implement the `useGroupSections` hook
    - Create `apps/mobile/src/screens/navigation/useGroupSections.ts` as a thin `useState(initialGroupSectionState)` wrapper exposing `isExpanded(key)` and `toggle(key)`; state lives for the Screen_Session and resets to all-Collapsed on remount. Document the per-mode key namespacing (e.g. `parks:Magic Kingdom`, `categories:Ride`).
    - _Requirements: 8.1, 10.2, 10.3_

  - [x] 6.3 Write property test for default-collapsed initial state
    - **Property 7: Default Collapsed on first display**
    - Over generated key sets, assert `initialGroupSectionState` reports every section Collapsed.
    - **Validates: Requirements 8.1, 10.3**

  - [x] 6.4 Write property test for toggle isolation and self-inverse
    - **Property 8: Toggling affects exactly one section and is self-inverse**
    - Over generated states and key pairs `k ≠ j`, assert `toggle` flips `k`, leaves `j` unchanged, and `toggle(toggle(state, k), k) === state`.
    - **Validates: Requirements 7.3, 10.1**

- [x] 7. Implement the `GroupSection` and `Compact_Empty_State` primitives
  - [x] 7.1 Implement `GroupSection`
    - Create `apps/mobile/src/screens/navigation/GroupSection.tsx` whose `Group_Header` is a `Pressable` wrapping the existing stat-header content, exposing `accessibilityRole="button"`, `accessibilityState={{ expanded }}`, and an `accessibilityLabel` containing the Park/Experience_Category name; `onPress` (and assistive activation) toggles the section.
    - Header name + statistic content is identical in both states; `children` (the `Group_Body`) is rendered only when `expanded` is true.
    - _Requirements: 7.1, 7.3, 7.4, 7.5, 9.1, 9.2, 9.3, 12.1, 12.2, 12.3, 12.4_

  - [x] 7.2 Implement `Compact_Empty_State`
    - Create `apps/mobile/src/screens/navigation/CompactEmptyState.tsx` as a single-line, non-interactive muted-text indication for an empty group's body, with no press handler and no accessibility action.
    - _Requirements: 11.2, 11.4_

  - [x] 7.3 Write property test for header content/state consistency
    - **Property 9: Group_Header content and announced state are consistent**
    - Over generated groups in both Expanded and Collapsed states, assert the header displays/announces the group name identically in both states and the announced expanded/collapsed state equals the section's current state.
    - **Validates: Requirements 9.1, 9.3, 12.2, 12.3**

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Refactor the grouped views to use collapsible sections
  - [x] 9.1 Refactor `StatsScreen` Own_Parks/Own_Categories into `Group_Section`s
    - In `apps/mobile/src/screens/stats/StatsScreen.tsx`, render every Park and every Experience_Category (none omitted, including zero-count groups) as a `GroupSection`, reusing the current `BreakdownCard`/`StatHeader` content for the header (preserving empty-group figure suppression).
    - Render the `Group_Body` (when Expanded) with the group's `CompletionRow`s when the group has named entries, or `Compact_Empty_State` otherwise; drive `isExpanded`/`toggle` via `useGroupSections` keyed per section.
    - _Requirements: 7.1, 7.2, 7.4, 7.5, 8.2, 9.2, 11.1, 11.2, 11.3_

  - [x] 9.2 Refactor `FriendProfileScreen` Parks/Categories into `Group_Section`s
    - In `apps/mobile/src/screens/.../FriendProfileScreen.tsx`, apply the same `GroupSection` rendering to the Parks and Categories modes with the same header reuse, body selection, and per-section `useGroupSections` state.
    - _Requirements: 7.1, 7.2, 7.4, 7.5, 8.2, 9.2, 11.1, 11.2, 11.3_

  - [x] 9.3 Write property test for group-section completeness
    - **Property 6: Every group is present as a Group_Section**
    - Over generated entry sets, assert a Grouped_View_Mode renders exactly one `GroupSection` per catalog Park (or per Experience_Category) in canonical order, including zero-count groups, with none added or omitted.
    - **Validates: Requirements 7.2, 8.2**

  - [x] 9.4 Write property test for expanded body content
    - **Property 10: Expanded Group_Body content matches the group's named entries**
    - Over generated groups, assert an Expanded body renders exactly the group's named-entry rows (same count/identity/order) when any exist, and a single `Compact_Empty_State` with no rows otherwise.
    - **Validates: Requirements 11.1, 11.2**

  - [x] 9.5 Write group-rendering example/integration tests
    - Assert headers visible with bodies hidden on first display; toggling reveals/hides the body and leaves other sections unchanged; header figures match the stats breakdown (with empty-group suppression); `Compact_Empty_State` has no activatable control; the header exposes the expandable role and toggles under assistive activation; state survives a mode switch and resets on remount.
    - _Requirements: 7.4, 7.5, 8.2, 9.2, 10.1, 10.2, 10.3, 11.4, 12.1, 12.4_

- [x] 10. Wire navigation through the grouped views and lists
  - [x] 10.1 Wire `onOpenExperience` into `StatsScreen`
    - In `apps/mobile/src/screens/stats/StatsScreen.tsx`, obtain `openExperience` from `useOpenExperience` and pass `onOpenExperience={openExperience}` to every `CompletionRow` in Own_Experiences and in the grouped `Group_Body`s.
    - _Requirements: 3.1, 3.3, 5.1, 11.3_

  - [x] 10.2 Wire `onOpenExperience` into `FriendProfileScreen` and `ExperiencesList`
    - In `FriendProfileScreen.tsx`, pass `onOpenExperience={openExperience}` to rows in Parks/Categories/Experiences modes; update `ExperiencesList` to forward the same callback to its rows.
    - _Requirements: 2.1, 2.2, 5.1, 11.3_

  - [x] 10.3 Write navigation-wiring integration tests
    - Mount each grouped mode and the Own_Experiences/Experiences lists inside a real `NavigationContainer`; tap and assistive-activate a row; assert the cross-stack navigation to `ExperienceDetail` is dispatched with the row's `experienceId` in each mode.
    - _Requirements: 2.1, 2.2, 3.1, 4.1, 4.3, 11.3_

  - [x] 10.4 Write return-navigation and detail-source tests
    - Navigate from a row, go back, and assert the originating screen is shown and a subsequent tap navigates again (guard reset on focus); confirm `ExperienceDetailScreen` reads the viewing User's own `/me/...` data after navigating from a Friend's row.
    - _Requirements: 2.4, 5.3_

- [x] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test tasks and can be skipped for a faster MVP, but they validate the design's correctness properties and key behaviors.
- Each task references specific requirements clauses for traceability.
- Property tests use `fast-check` (already present in `apps/api` and `apps/mobile`), run a minimum of 100 iterations, and are tagged with a comment of the form `// Feature: experience-detail-navigation, Property {number}: {property_text}`.
- Timing requirements (R2.3, R3.2 — "within 2 seconds") are performance expectations and are not asserted as deterministic unit tests.
- The Owner_Or_Friend_Rule (R1.5) is reused unchanged; the existing repo/route tests cover it.
- Checkpoints ensure incremental validation at the backend/contract boundary, the mobile-primitive boundary, and the end of wiring.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "4.1", "6.1", "7.2"] },
    { "id": 1, "tasks": ["2.2", "4.2", "5.1", "6.2", "7.1"] },
    { "id": 2, "tasks": ["2.3", "2.4", "2.5", "4.3", "4.4", "5.2", "5.3", "6.3", "6.4", "7.3", "9.1", "9.2"] },
    { "id": 3, "tasks": ["9.3", "9.4", "9.5", "10.1", "10.2"] },
    { "id": 4, "tasks": ["10.3", "10.4"] }
  ]
}
```
