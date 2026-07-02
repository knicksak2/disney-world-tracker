# Experience Detail Back Navigation Bugfix Design

## Overview

The Experience_Detail_View can be reached from four entry points — a Completed_Experience_Row in the Stats_View, a Completed_Experience_Row in a Friend_Profile_View, a leaderboard row on the Home_View, and a row in the Catalog_List_View. All four open the detail screen with a single cross-tab dispatch into the Catalog tab's nested stack:

```
navigation.navigate('Catalog', { screen: 'ExperienceDetail', params: { experienceId } })
```

`ExperienceDetail` is registered **only** inside `CatalogStack` (`apps/mobile/src/navigation/CatalogStack.tsx`). Because the screen lives in the Catalog stack, React Navigation's back affordance pops within that stack to `CatalogList`, never crossing back to the originating tab. For a User who arrived from Stats, a Friend's profile, or the Home leaderboard, "back" lands on the Catalog list — a screen they never visited.

The same registration causes a second, visible symptom: the Catalog stack declares `ExperienceDetail` with `options={{ title: 'Experience' }}`, so React Navigation renders a native header bar titled "Experience" directly above the screen's own themed `GradientHeader` (Experience name + Park). The result is two stacked headers, and the native bar is also the only back affordance — which is why it always returns to the Catalog list.

The fix is a navigation-structure change: promote `ExperienceDetail` out of `CatalogStack` to a **root-level native stack** that wraps the main tab navigator. Pushing the detail screen onto the root stack leaves the originating tab and screen intact underneath, so back returns to the exact origin regardless of which tab the User started in. The native header is suppressed (`headerShown: false`) and a visible, accessible back control is added to the screen's themed `GradientHeader`, presenting a single header with a working back action that returns to origin. All four entry-point call sites are updated to dispatch the root-level navigation; the Catalog-list entry continues to return to the Catalog list because the Catalog tab (showing `CatalogList`) remains the screen beneath the pushed detail view.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — a return-navigation request from an Experience_Detail_View that was opened from an originating screen other than the Catalog_List_View (Stats_View, Friend_Profile_View, or Home_View), where back currently lands on the Catalog_List_View. It also covers every presentation of the Experience_Detail_View, which today shows a redundant native header and exposes no in-screen back control.
- **Property (P)**: The desired behavior — back from the Experience_Detail_View returns to the exact originating screen, the screen presents a single themed header with no redundant native header bar, and a visible, accessible back control is present.
- **Preservation**: Existing behavior that must remain unchanged — the Catalog_List_View entry point still returns to the Catalog_List_View, the same Experience data is displayed, exactly one detail instance is presented per tap (repeat-tap guard intact), the originating screen is restored in the same tab and mode, and rows without an Experience_Id carry no navigation affordance.
- **Experience_Detail_View**: `ExperienceDetailScreen` in `apps/mobile/src/screens/catalog/ExperienceDetailScreen.tsx`. Renders Experience name, Park, category, description, and the viewing User's own Completion, Rating, and Note.
- **Stats_View**: `StatsScreen` in `apps/mobile/src/screens/stats/StatsScreen.tsx`, on the Stats tab.
- **Friend_Profile_View**: `FriendProfileScreen` in `apps/mobile/src/screens/friends/FriendProfileScreen.tsx`, nested in `FriendsStack` on the Friends tab.
- **Home_View**: `HomeScreen` in `apps/mobile/src/screens/home/HomeScreen.tsx`, the Home tab's leaderboard screen.
- **Catalog_List_View**: `CatalogScreen` (`CatalogList`) in `apps/mobile/src/screens/catalog/CatalogScreen.tsx`, on the Catalog tab.
- **useOpenExperience**: The hook in `apps/mobile/src/screens/navigation/experienceNavigation.ts` that dispatches the cross-stack navigation and holds the repeat-tap in-flight guard; used by the Stats_View and Friend_Profile_View.
- **GradientHeader**: The themed in-content banner component in `apps/mobile/src/theme/components.tsx`, accepting `title`, `subtitle`, `icon`, `compact`, and a `right` slot.
- **RootStack**: The proposed root-level native stack that wraps `MainTabs` and hosts `ExperienceDetail` above the tab navigator.

## Bug Details

### Bug Condition

The bug manifests in two coupled ways. First, when a User opens the Experience_Detail_View from an originating screen other than the Catalog_List_View and then issues a back request, the App returns to the Catalog_List_View instead of the originating screen — because `ExperienceDetail` is registered only inside `CatalogStack`, so back pops within the Catalog stack rather than crossing back to the originating tab. Second, on every presentation the Experience_Detail_View renders a redundant native stack header above its themed `GradientHeader`, and the screen exposes no in-screen back control of its own.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type NavigationScenario
         { originScreen: Screen,           // where navigation to detail began
           action: 'backFromDetail' | 'presentDetail' }
  OUTPUT: boolean

  // Symptom A — wrong return target on back from a non-Catalog origin.
  wrongReturnTarget :=
        input.action = 'backFromDetail'
        AND input.originScreen IN { Stats_View, Friend_Profile_View, Home_View }

  // Symptom B — every detail presentation shows the redundant native
  // header and lacks an in-screen back control.
  brokenHeaderOrControl :=
        input.action = 'presentDetail'
        AND originatedFromAnyEntryPoint(input.originScreen)

  RETURN wrongReturnTarget OR brokenHeaderOrControl
END FUNCTION
```

### Examples

- **Stats origin (Symptom A):** Open the Stats_View, tap a Completed_Experience_Row, then press back. Expected: return to the Stats_View. Actual: lands on the Catalog_List_View.
- **Friend profile origin (Symptom A):** Open a Friend_Profile_View, tap a Completed_Experience_Row, then press back. Expected: return to the Friend_Profile_View. Actual: lands on the Catalog_List_View.
- **Home leaderboard origin (Symptom A):** Tap a leaderboard row on the Home_View, then press back. Expected: return to the Home_View. Actual: lands on the Catalog_List_View.
- **Header / control (Symptom B):** Open the Experience_Detail_View from any entry point. Expected: one themed header with a visible back control. Actual: a native "Experience" header bar stacked above the themed `GradientHeader`, and no in-screen back control.
- **Catalog origin (not a bug — preserved):** Open the Catalog_List_View, tap a row, then press back. Returns to the Catalog_List_View, which is correct and must stay correct.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Opening the Experience_Detail_View from a Catalog_List_View row and pressing back must continue to return to the Catalog_List_View (bugfix.md clause 3.1).
- The Experience_Detail_View must continue to display the same Experience addressed by the entry point's Experience_Id, showing the viewing User's own Completion, Rating, and Note (clause 3.2).
- A tap must continue to complete navigation within 2 seconds and present exactly one Experience_Detail_View instance, with no duplicates stacked for repeated taps — the `useOpenExperience` in-flight guard must remain intact (clause 3.3).
- On return, the originating screen must continue to be presented in the same tab and mode it had before navigation began (clause 3.4).
- A Completed_Experience_Row or leaderboard row with no available Experience_Id must continue to render without a navigation affordance and perform no navigation (clause 3.5).

**Scope:**
All inputs that do NOT involve a return from a non-Catalog origin, and all behaviors other than header presentation and back-control availability, should be completely unaffected by this fix. This includes:
- Catalog_List_View → ExperienceDetail → back (must remain CatalogList).
- The data shown on the Experience_Detail_View (catalog detail, completion, rating, note, aggregate, live sections).
- The repeat-tap guard and its focus-based reset.
- Rows that carry no Experience_Id.

## Hypothesized Root Cause

Based on the bug description and the code, the cause is structural rather than a local logic error:

1. **Misplaced screen registration**: `ExperienceDetail` is registered inside `CatalogStack` (`apps/mobile/src/navigation/CatalogStack.tsx`). Every entry point reaches it with a cross-tab `navigate('Catalog', { screen: 'ExperienceDetail', ... })`, which switches to the Catalog tab and pushes the detail onto the Catalog stack. Back therefore pops to `CatalogList`, discarding the originating tab/screen context. This is the single root cause of Symptom A.

2. **Native header from stack options**: The Catalog stack declares `options={{ title: 'Experience' }}` for `ExperienceDetail`, so React Navigation renders a native header bar. The screen also renders its own themed `GradientHeader`, producing two stacked headers. This is the source of Symptom B's redundant bar.

3. **No in-screen back affordance**: `ExperienceDetailScreen` renders a `GradientHeader` with no back control and relies entirely on the native header for back, so once the native header is hidden there is no way back at all unless an explicit control is added.

4. **Multiple call sites share the broken pattern**: The cross-tab dispatch is duplicated across `useOpenExperience` (used by Stats and Friend profile) and the inline `navigate('Catalog', { screen: 'ExperienceDetail', ... })` in `HomeScreen`. The Catalog list uses an in-stack `navigate('ExperienceDetail', ...)`. A correct fix must update every non-Catalog call site to target the new root-level route while leaving the Catalog list's in-tab return semantics intact.

## Correctness Properties

Property 1: Bug Condition - Back Returns To Originating Screen

_For any_ navigation scenario where the bug condition holds for a back request (`isBugCondition` returns true with `action = 'backFromDetail'` and an origin of Stats_View, Friend_Profile_View, or Home_View), the fixed navigation structure SHALL return the User to that exact originating screen rather than to the Catalog_List_View.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - Catalog Origin, Data, Single Instance, Restored Context

_For any_ input where the bug condition does NOT hold for a back request — in particular a return from a Catalog_List_View origin — the fixed code SHALL produce the same result as the original code: back returns to the Catalog_List_View, the same Experience data is displayed, exactly one detail instance is presented per tap, the originating screen is restored in its prior tab and mode, and rows without an Experience_Id carry no navigation affordance.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

Property 3: Bug Condition - Single Themed Header With Accessible Back Control

_For any_ presentation of the Experience_Detail_View (the bug condition holds with `action = 'presentDetail'`), the fixed screen SHALL render exactly one themed header with no redundant native header bar above it, and SHALL expose a visible back control with an accessibility role indicating an activatable control and an accessibility label conveying the back action.

**Validates: Requirements 2.4**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct, the fix relocates `ExperienceDetail` to a root-level stack, hides the native header, adds an in-screen back control, and updates all non-Catalog call sites.

**File**: `apps/mobile/src/navigation/RootNavigator.tsx`

**Specific Changes**:
1. **Introduce a root native stack (`RootStack`)**: Wrap the authenticated experience in a native stack navigator whose first screen is `MainTabs` (the existing bottom-tab navigator) and which also registers `ExperienceDetail` as a sibling screen pushed above the tabs.
   - `RootStack` param list: `{ MainTabs: undefined; ExperienceDetail: { experienceId: string } }`.
   - Register `ExperienceDetail` with `options={{ headerShown: false }}` so no native header bar renders (resolves Symptom B's redundant bar).
   - Keep `MainTabs` with `headerShown: false` as today.
   - Because the detail screen is pushed onto the root stack on top of the current tab state, back pops to whatever tab/screen was active when navigation began (resolves Symptom A and satisfies clause 3.4's "same tab and mode").

**File**: `apps/mobile/src/navigation/CatalogStack.tsx`

2. **Remove `ExperienceDetail` from `CatalogStack`**: Delete the `ExperienceDetail` `Stack.Screen` (and its `options={{ title: 'Experience' }}`) so the Catalog tab no longer owns the detail route. `CatalogStackParamList` drops the `ExperienceDetail` member; `CatalogList` remains the sole screen.

**File**: `apps/mobile/src/screens/catalog/CatalogScreen.tsx`

3. **Repoint the Catalog list entry to the root route**: Change the row `onPress` from `navigation.navigate('ExperienceDetail', { experienceId })` (in-stack) to the root-level target `navigation.navigate('ExperienceDetail', { experienceId })` resolved against the root stack (e.g., via the root navigation prop / a typed `navigate('ExperienceDetail', { experienceId })` that now lives on `RootStack`). Returning from the detail must still land on the Catalog_List_View because the Catalog tab (showing `CatalogList`) is the screen beneath the pushed detail (preserves clause 3.1).

**File**: `apps/mobile/src/screens/navigation/experienceNavigation.ts`

4. **Update `useOpenExperience` to the root route**: Replace the cross-tab dispatch
   `navigate('Catalog', { screen: 'ExperienceDetail', params: { experienceId } })`
   with a root-level `navigate('ExperienceDetail', { experienceId })` typed against `RootStack`. Preserve the existing `inFlightRef` repeat-tap guard and its `useFocusEffect` reset exactly as-is (preserves clause 3.3). This single change fixes the Stats_View and Friend_Profile_View origins together.

**File**: `apps/mobile/src/screens/home/HomeScreen.tsx`

5. **Update the Home leaderboard entry to the root route**: Replace the inline `navigation.navigate('Catalog', { screen: 'ExperienceDetail', params: { experienceId: item.experienceId } })` with the root-level `navigate('ExperienceDetail', { experienceId: item.experienceId })`. The no-Experience_Id guard on the row remains unchanged (preserves clause 3.5).

**File**: `apps/mobile/src/screens/catalog/ExperienceDetailScreen.tsx` (and `apps/mobile/src/theme/components.tsx` if the back control is added to `GradientHeader`)

6. **Add a visible, accessible back control to the themed header**: Render a back control inside the Experience_Detail_View's `GradientHeader` (e.g., via the existing `right` slot or a new leading `onBack` prop) that calls `navigation.goBack()`. The control MUST set `accessibilityRole="button"` and an `accessibilityLabel` such as "Go back" (satisfies clause 2.4). Because the native header is now hidden, this becomes the single, themed back affordance, and `goBack()` pops the root stack to the originating screen.

### Param-typing note

`MainTabParamList` no longer needs `Catalog` to accept `NavigatorScreenParams<CatalogStackParamList>` for the detail route; the detail target moves to `RootStack`. Update the navigation prop types used by `useOpenExperience`, `HomeScreen`, and `CatalogScreen` so `navigate('ExperienceDetail', { experienceId })` is typed against the root stack. The `ExperienceDetailScreen`'s `useRoute` param type changes from `CatalogStackParamList` to the root stack's param list (the `{ experienceId: string }` shape is unchanged, so the screen body is otherwise untouched).

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on the unfixed code, then verify the fix returns to origin, presents a single header with an accessible back control, and preserves all existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root-cause analysis (misplaced `ExperienceDetail` registration + native header). If refuted, re-hypothesize.

**Test Plan**: Mount the real tab + nested-stack topology in a `NavigationContainer` (mirroring the existing `returnNavigationDetailSource.integration.test.tsx` and `navigationWiring.integration.test.tsx`). Navigate from each non-Catalog origin into `ExperienceDetail`, issue a back request, and assert the current route. Run on the UNFIXED code to observe the wrong return target. Separately, render the detail screen within the Catalog stack and inspect for the native header presence and the absence of an in-screen back control.

**Test Cases**:
1. **Stats back target**: From Stats_View, open detail, go back; assert current route is Stats (will fail on unfixed code — lands on `CatalogList`).
2. **Friend profile back target**: From Friend_Profile_View, open detail, go back; assert current route is FriendProfile (will fail on unfixed code).
3. **Home leaderboard back target**: From Home_View, open detail, go back; assert current route is Home (will fail on unfixed code).
4. **Header / back control**: Present the detail screen; assert no native header bar is rendered and a back control with `accessibilityRole="button"` exists (will fail on unfixed code — native header present, no in-screen control).

**Expected Counterexamples**:
- Back from Stats/Friend/Home origins resolves to `CatalogList` instead of the origin.
- The detail presentation renders a native "Experience" header above the themed `GradientHeader`, with no in-screen back affordance.
- Cause: `ExperienceDetail` registered inside `CatalogStack` and reached via a cross-tab `navigate('Catalog', { screen: 'ExperienceDetail' })`, plus `options={{ title: 'Experience' }}`.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed code produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  IF input.action = 'backFromDetail' THEN
    result := navigateOpenDetailThenBack_fixed(input.originScreen)
    ASSERT result.currentScreen = input.originScreen        // Property 1
  ELSE // presentDetail
    view := presentDetail_fixed(input.originScreen)
    ASSERT view.headerCount = 1 AND NOT view.hasNativeHeader // Property 3
    ASSERT view.backControl.role = 'button'
       AND view.backControl.label conveys back action         // Property 3
  END IF
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed code produces the same result as the original code.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT navigateAndReturn_original(input) = navigateAndReturn_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many origin/Experience_Id combinations automatically across the input domain.
- It catches edge cases (blank/missing Experience_Id, repeat-tap bursts) that manual unit tests might miss.
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs.

**Test Plan**: Observe behavior on UNFIXED code first for the Catalog-list origin, the displayed data, the single-instance guard, and the no-affordance rows, then write tests (property-based where the input domain is wide) capturing that behavior and re-run after the fix.

**Test Cases**:
1. **Catalog origin preserved**: Observe that Catalog_List_View → detail → back returns to `CatalogList` on unfixed code, then assert it still does after the fix (clause 3.1).
2. **Data parity preserved**: Observe the Experience detail / own Completion, Rating, Note rendering for a given Experience_Id, then assert identical rendering after the fix (clause 3.2).
3. **Single-instance guard preserved**: Observe that an N-tap burst yields exactly one detail instance and a focus-regain re-arms navigation, then assert unchanged after the fix (clause 3.3).
4. **Restored tab/mode preserved**: Observe that returning restores the originating screen's tab and mode, then assert unchanged after the fix (clause 3.4).
5. **No-affordance rows preserved**: Observe that a row with a missing/blank Experience_Id renders without a navigation affordance and performs no navigation, then assert unchanged after the fix (clause 3.5; `resolveExperienceTarget` returning `null`).

### Unit Tests

- `RootStack` registers `ExperienceDetail` with `headerShown: false` and `MainTabs` as the initial route.
- `CatalogStack` no longer registers `ExperienceDetail`.
- `useOpenExperience` dispatches `navigate('ExperienceDetail', { experienceId })` against the root stack and retains the in-flight guard.
- The `GradientHeader` back control renders with `accessibilityRole="button"` and a back `accessibilityLabel`, and invokes `goBack()` on press.
- `resolveExperienceTarget` still returns `null` for missing/blank ids (no affordance).

### Property-Based Tests

- For a generated origin in {Stats, Friend profile, Home}, open detail then back resolves to that origin (Property 1).
- For a generated burst of N >= 1 taps, exactly one `ExperienceDetail` navigation is dispatched (Property 2, repeat-tap guard preserved) — mirrors the existing `experienceNavigation.repeatTap.prop.test.ts`.
- For generated Experience_Id values (including blank/missing), navigation affordance presence matches the original (Property 2, clause 3.5).

### Integration Tests

- Full flow per origin (Stats, Friend profile, Home, Catalog) in a real `NavigationContainer`: tap a row → real `ExperienceDetailScreen` mounts → press the themed back control → assert the originating screen is shown in its prior tab and mode.
- Switching tabs/modes before navigating and confirming the restored context after return.
- Visual/structural assertion that exactly one themed header is present and no native header bar renders on the detail screen.
