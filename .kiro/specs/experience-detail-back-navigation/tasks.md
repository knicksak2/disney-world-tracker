# Implementation Plan

## Overview

This plan fixes the Experience Detail back-navigation bug using the bug condition methodology. It follows an explore → preserve → implement → validate order: write exploration tests that demonstrate the bug on unfixed code (Property 1), capture baseline behavior to preserve (Property 2), then apply the navigation-structure fix (root-level `RootStack` hosting `ExperienceDetail` above `MainTabs`, repointed call sites, a themed accessible back control, and updated param typings), and finally re-run the same tests plus added property-based and integration coverage.

## Tasks

- [x] 1. Write bug condition exploration tests (BEFORE implementing the fix)
  - **Property 1: Bug Condition** - Back Returns To Originating Screen / Single Themed Header With Accessible Back Control
  - **CRITICAL**: These tests MUST FAIL on the unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the tests or the code when they fail**
  - **NOTE**: These tests encode the expected behavior - they will validate the fix when they pass after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug (`isBugCondition` returns true) on the current code
  - **Scoped PBT Approach**: The bug is deterministic per origin, so scope the property to the concrete failing origins {Stats_View, Friend_Profile_View, Home_View} and the single pres* `presentDetail` case
  - Mount the real tab + nested-stack topology in a `NavigationContainer` (mirror `returnNavigationDetailSource.integration.test.tsx` and `navigationWiring.integration.test.tsx`)
  - Symptom A test (`action = 'backFromDetail'`): from each non-Catalog origin, open `ExperienceDetail`, issue a back request, assert the current route equals the origin
    - From Stats_View → open detail → back → assert current route is Stats (will land on `CatalogList` on unfixed code)
    - From Friend_Profile_View → open detail → back → assert current route is FriendProfile (will land on `CatalogList` on unfixed code)
    - From Home_View leaderboard row → open detail → back → assert current route is Home (will land on `CatalogList` on unfixed code)
  - Symptom B test (`action = 'presentDetail'`): present the detail screen and assert no native header bar is rendered AND a back control with `accessibilityRole="button"` and a back `accessibilityLabel` exists
  - Run the tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests FAIL (this is correct - it proves the bug exists)
  - Document counterexamples found: back from Stats/Friend/Home resolves to `CatalogList` instead of origin; detail presentation renders a native "Experience" header above the themed `GradientHeader` with no in-screen back affordance (cause: `ExperienceDetail` registered inside `CatalogStack`, reached via `navigate('Catalog', { screen: 'ExperienceDetail' })`, plus `options={{ title: 'Experience' }}`)
  - Mark task complete when tests are written, run, and failures are documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 2. Write preservation property tests (BEFORE implementing the fix)
  - **Property 2: Preservation** - Catalog Origin, Data, Single Instance, Restored Context, No-Affordance Rows
  - **IMPORTANT**: Follow observation-first methodology - run the UNFIXED code, record actual outputs, then write tests that assert those outputs
  - Observe and capture baseline behavior on UNFIXED code for inputs where `isBugCondition` returns false:
    - Catalog_List_View → detail → back returns to `CatalogList` (clause 3.1)
    - Detail screen renders the same Experience data for a given Experience_Id: catalog detail, own Completion, Rating, Note (clause 3.2)
    - An N-tap burst yields exactly one `ExperienceDetail` navigation and focus-regain re-arms navigation (clause 3.3; mirror `experienceNavigation.repeatTap.prop.test.ts`)
    - Returning restores the originating screen's tab and mode (clause 3.4)
    - A row with a missing/blank Experience_Id renders without a navigation affordance and performs no navigation (clause 3.5; `resolveExperienceTarget` returns `null`)
  - Write property-based tests where the input domain is wide (generated Experience_Id values including blank/missing; generated tap-burst counts N >= 1) and unit tests for the fixed-shape cases
  - Run the tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms the baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 3. Fix for Experience Detail back navigation and redundant header

  - [x] 3.1 Introduce a root-level native stack (`RootStack`) hosting `ExperienceDetail` above `MainTabs`
    - In `apps/mobile/src/navigation/RootNavigator.tsx`, wrap the authenticated experience in a native stack navigator whose initial route is `MainTabs` (the existing bottom-tab navigator)
    - Register `ExperienceDetail` as a sibling screen on `RootStack` with `options={{ headerShown: false }}` (suppresses the redundant native header bar)
    - Keep `MainTabs` with `headerShown: false` as today
    - Define `RootStack` param list as `{ MainTabs: undefined; ExperienceDetail: { experienceId: string } }`
    - _Bug_Condition: isBugCondition(input) where input.action = 'backFromDetail' with origin in {Stats_View, Friend_Profile_View, Home_View}, OR input.action = 'presentDetail'_
    - _Expected_Behavior: back pops the root stack to the originating tab/screen; native header is hidden (Property 1, Property 3)_
    - _Preservation: Catalog tab (showing CatalogList) remains the screen beneath the pushed detail, so Catalog origin still returns to CatalogList_
    - _Requirements: 2.1, 2.2, 2.3, 2.5_

  - [x] 3.2 Remove `ExperienceDetail` from `CatalogStack`
    - In `apps/mobile/src/navigation/CatalogStack.tsx`, delete the `ExperienceDetail` `Stack.Screen` and its `options={{ title: 'Experience' }}`
    - Drop the `ExperienceDetail` member from `CatalogStackParamList`; leave `CatalogList` as the sole screen
    - _Bug_Condition: isBugCondition(input) - the misplaced registration is the root cause of Symptom A and B_
    - _Expected_Behavior: Catalog tab no longer owns the detail route; no native "Experience" header from this stack_
    - _Preservation: CatalogList remains registered and unchanged_
    - _Requirements: 2.5_

  - [x] 3.3 Repoint all non-Catalog and Catalog call sites to the root-level route
    - In `apps/mobile/src/screens/navigation/experienceNavigation.ts`, update `useOpenExperience` to dispatch `navigate('ExperienceDetail', { experienceId })` typed against `RootStack`, replacing `navigate('Catalog', { screen: 'ExperienceDetail', params: { experienceId } })` (fixes Stats_View and Friend_Profile_View together)
    - Preserve the existing `inFlightRef` repeat-tap guard and its `useFocusEffect` reset exactly as-is
    - In `apps/mobile/src/screens/home/HomeScreen.tsx`, replace the inline `navigation.navigate('Catalog', { screen: 'ExperienceDetail', params: { experienceId: item.experienceId } })` with `navigate('ExperienceDetail', { experienceId: item.experienceId })`; leave the no-Experience_Id row guard unchanged
    - In `apps/mobile/src/screens/catalog/CatalogScreen.tsx`, change the row `onPress` from the in-stack `navigate('ExperienceDetail', { experienceId })` to the root-level target resolved against `RootStack`
    - _Bug_Condition: isBugCondition(input) where origin in {Stats_View, Friend_Profile_View, Home_View}_
    - _Expected_Behavior: every entry point pushes ExperienceDetail onto the root stack so back returns to origin (Property 1)_
    - _Preservation: repeat-tap in-flight guard intact (clause 3.3); no-Experience_Id rows carry no affordance (clause 3.5); Catalog origin still returns to CatalogList (clause 3.1)_
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.3, 3.5_

  - [x] 3.4 Add a visible, accessible back control to the themed `GradientHeader`
    - In `apps/mobile/src/screens/catalog/ExperienceDetailScreen.tsx` (and `apps/mobile/src/theme/components.tsx` if the control is added to `GradientHeader` via the `right` slot or a new leading `onBack` prop), render a back control that calls `navigation.goBack()`
    - The control MUST set `accessibilityRole="button"` and an `accessibilityLabel` conveying the back action (e.g., "Go back")
    - Keep the themed `GradientHeader` showing the Experience name and Park (clause 3.6); the native header is now hidden so this is the single, themed back affordance
    - _Bug_Condition: isBugCondition(input) where input.action = 'presentDetail'_
    - _Expected_Behavior: exactly one themed header with a visible back control whose role is 'button' and label conveys back; goBack() pops to origin (Property 3)_
    - _Preservation: Experience name and Park still rendered in the themed header (clause 3.6)_
    - _Requirements: 2.4, 2.5, 3.6_

  - [x] 3.5 Update param typings for the root route
    - Update `MainTabParamList` so `Catalog` no longer needs `NavigatorScreenParams<CatalogStackParamList>` for the detail route
    - Update the navigation prop types used by `useOpenExperience`, `HomeScreen`, and `CatalogScreen` so `navigate('ExperienceDetail', { experienceId })` is typed against `RootStack`
    - Change `ExperienceDetailScreen`'s `useRoute` param type from `CatalogStackParamList` to the root stack's param list (the `{ experienceId: string }` shape is unchanged)
    - _Bug_Condition: isBugCondition(input) - typing supports the relocated route_
    - _Expected_Behavior: all call sites and the screen resolve ExperienceDetail against RootStack with no type errors_
    - _Preservation: the `{ experienceId: string }` param shape is unchanged so the screen body is otherwise untouched_
    - _Requirements: 2.1, 2.2, 2.3, 3.2_

  - [x] 3.6 Add/confirm unit tests for the fixed structure
    - `RootStack` registers `ExperienceDetail` with `headerShown: false` and `MainTabs` as the initial route
    - `CatalogStack` no longer registers `ExperienceDetail`
    - `useOpenExperience` dispatches `navigate('ExperienceDetail', { experienceId })` against the root stack and retains the in-flight guard
    - The `GradientHeader` back control renders with `accessibilityRole="button"` and a back `accessibilityLabel`, and invokes `goBack()` on press
    - `resolveExperienceTarget` still returns `null` for missing/blank ids (no affordance)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.5_

  - [x] 3.7 Verify bug condition exploration tests now pass
    - **Property 1: Expected Behavior** - Back Returns To Originating Screen / Single Themed Header With Accessible Back Control
    - **IMPORTANT**: Re-run the SAME tests from task 1 - do NOT write new tests
    - The tests from task 1 encode the expected behavior; when they pass they confirm the expected behavior is satisfied
    - Run the Symptom A back-target tests (Stats, Friend profile, Home) and the Symptom B header/back-control test from task 1
    - **EXPECTED OUTCOME**: Tests PASS (confirms the bug is fixed - back returns to origin, single themed header, accessible back control)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 3.8 Verify preservation tests still pass
    - **Property 2: Preservation** - Catalog Origin, Data, Single Instance, Restored Context, No-Affordance Rows
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run the preservation property and unit tests from task 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions - Catalog origin returns to CatalogList, data parity, single-instance guard, restored tab/mode, no-affordance rows)
    - Confirm all tests still pass after the fix
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 4. Add property-based and integration tests for the fixed flow
  - **Property-based tests**:
    - For a generated origin in {Stats, Friend profile, Home}, open detail then back resolves to that origin (Property 1)
    - For a generated burst of N >= 1 taps, exactly one `ExperienceDetail` navigation is dispatched (Property 2; mirrors `experienceNavigation.repeatTap.prop.test.ts`)
    - For generated Experience_Id values (including blank/missing), navigation affordance presence matches the original (Property 2, clause 3.5)
  - **Integration tests** (real `NavigationContainer`):
    - Full flow per origin (Stats, Friend profile, Home, Catalog): tap a row → real `ExperienceDetailScreen` mounts → press the themed back control → assert the originating screen is shown in its prior tab and mode
    - Switch tabs/modes before navigating and confirm the restored context after return
    - Structural assertion that exactly one themed header is present and no native header bar renders on the detail screen
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.3, 3.4, 3.5_

- [x] 5. Checkpoint - Ensure all tests pass
  - Run the full mobile test suite and type-check; ensure all unit, property-based, and integration tests pass with no regressions
  - Ensure all tests pass, ask the user if questions arise

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "2"], "dependsOn": [] },
    { "wave": 2, "tasks": ["3.1", "3.2"], "dependsOn": ["1", "2"] },
    { "wave": 3, "tasks": ["3.3", "3.4"], "dependsOn": ["3.1", "3.2"] },
    { "wave": 4, "tasks": ["3.5"], "dependsOn": ["3.1", "3.2", "3.3"] },
    { "wave": 5, "tasks": ["3.6"], "dependsOn": ["3.1", "3.2", "3.3", "3.4", "3.5"] },
    { "wave": 6, "tasks": ["3.7", "3.8"], "dependsOn": ["3.6"] },
    { "wave": 7, "tasks": ["4"], "dependsOn": ["3.7", "3.8"] },
    { "wave": 8, "tasks": ["5"], "dependsOn": ["4"] }
  ]
}
```

## Notes

- Tasks 1 and 2 MUST be completed before any task 3 sub-task. Task 1 tests are expected to FAIL on unfixed code; task 2 tests are expected to PASS on unfixed code.
- Tasks 3.7 and 3.8 re-run the SAME tests from tasks 1 and 2 — do not write new tests for them.
- Property 1 covers the Bug Condition (back returns to origin; single themed header with accessible back control). Property 2 covers Preservation (Catalog origin, data parity, single-instance guard, restored context, no-affordance rows).
- Long-running test/watch commands should be run manually by the user with a single-run flag (e.g., `--run`) rather than in watch mode.
