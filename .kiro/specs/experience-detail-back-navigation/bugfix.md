# Bugfix Requirements Document

## Introduction

When a User opens the Experience_Detail_View in the Disney World Tracker mobile app, there is no way to return to the screen they came from. Every entry point — a Completed_Experience_Row in the Stats_View, a Completed_Experience_Row in a Friend_Profile_View, a leaderboard row on the Home screen, and a row in the Catalog list — opens the Experience_Detail_View through a single cross-tab jump into the Catalog tab's native stack (`navigation.navigate('Catalog', { screen: 'ExperienceDetail', params: { experienceId } })`). Because `ExperienceDetail` is registered only inside `CatalogStack`, React Navigation's back affordance pops to the Catalog list (`CatalogList`) rather than crossing back to the originating tab. The Experience_Detail_View itself renders an in-content `GradientHeader` with no back control, so the only back affordance is the native stack header, which always returns to the Catalog list.

The result: a User who arrives at the Experience_Detail_View from the Stats_View, a Friend_Profile_View, or the Home leaderboard has no usable way to return to that originating screen. This violates the existing experience-detail-navigation spec requirement R5.3, which states the App SHALL "return to the originating screen from which the navigation began, whether that screen is the Stats_View, the Friend_Profile_View, or any other screen from which a Completed_Experience_Row is displayed."

The same root cause produces a second, visible symptom: the Experience_Detail_View shows two stacked headers at the top. The native stack header — driven by the Catalog stack's `options={{ title: 'Experience' }}` in `apps/mobile/src/navigation/CatalogStack.tsx` — renders a redundant bar titled "Experience" directly above the screen's own themed in-content `GradientHeader` (which shows the Experience name and Park, e.g. "Avatar Flight of Passage" / "Animal Kingdom"). The native header is currently both the only back affordance and the unwanted duplicate header, so a single fix — hiding the redundant native header and presenting one themed header with its own visible, accessible back control that returns to the originating screen — resolves both symptoms together.

This bugfix delivers the full fix: the Experience_Detail_View SHALL always return to the exact originating screen (Stats_View, Friend_Profile_View, Home leaderboard, or the Catalog list) from which navigation began, SHALL expose a visible, accessible back control on the Experience_Detail_View, and SHALL present a single themed header with no redundant native header bar above it. This likely requires a navigation-structure change so back returns to origin rather than unwinding into the Catalog stack.

The terminology below reuses the experience-detail-navigation spec: **Experience_Detail_View**, **Completed_Experience_Row**, **Stats_View**, and **Friend_Profile_View**. Two additional terms are used for the entry points not named there: **Home_View** (the Home tab's leaderboard screen) and **Catalog_List_View** (the Catalog tab's list screen, `CatalogList`).

## Bug Analysis

### Current Behavior (Defect)

These clauses describe what happens today when a User is on the Experience_Detail_View, having arrived from some originating screen S, and attempts to go back.

1.1 WHEN a User opens the Experience_Detail_View from a Completed_Experience_Row in the Stats_View and attempts to go back, THEN the App returns to the Catalog_List_View instead of the Stats_View.

1.2 WHEN a User opens the Experience_Detail_View from a Completed_Experience_Row in a Friend_Profile_View and attempts to go back, THEN the App returns to the Catalog_List_View instead of the Friend_Profile_View.

1.3 WHEN a User opens the Experience_Detail_View from a leaderboard row in the Home_View and attempts to go back, THEN the App returns to the Catalog_List_View instead of the Home_View.

1.4 WHEN a User is on the Experience_Detail_View, THEN the Experience_Detail_View presents no visible back control of its own; the only back affordance is the native stack header, which always returns to the Catalog_List_View.

1.5 WHEN a User is on the Experience_Detail_View, THEN the Experience_Detail_View renders a redundant native stack header titled "Experience" stacked directly above its own themed `GradientHeader`, showing two headers at the top of the screen.

### Expected Behavior (Correct)

These clauses define the correct behavior for the same conditions. Each corresponds to the defect clause with the same final digit.

2.1 WHEN a User opens the Experience_Detail_View from a Completed_Experience_Row in the Stats_View and goes back, THEN the App SHALL return to the Stats_View, the originating screen.

2.2 WHEN a User opens the Experience_Detail_View from a Completed_Experience_Row in a Friend_Profile_View and goes back, THEN the App SHALL return to the Friend_Profile_View, the originating screen.

2.3 WHEN a User opens the Experience_Detail_View from a leaderboard row in the Home_View and goes back, THEN the App SHALL return to the Home_View, the originating screen.

2.4 WHEN a User is on the Experience_Detail_View, THEN the App SHALL present a visible back control on the Experience_Detail_View that returns to the originating screen, exposing an accessibility role indicating an activatable control and an accessibility label conveying the back action.

2.5 WHEN a User is on the Experience_Detail_View, THEN the App SHALL present a single header — its themed `GradientHeader` — with no redundant native or second header bar above it, while still exposing the visible, accessible back control.

### Unchanged Behavior (Regression Prevention)

These clauses describe behavior that must be preserved for inputs that do not trigger the bug.

3.1 WHEN a User opens the Experience_Detail_View from a row in the Catalog_List_View and goes back, THEN the App SHALL CONTINUE TO return to the Catalog_List_View, the originating screen.

3.2 WHEN a User opens the Experience_Detail_View from any entry point, THEN the App SHALL CONTINUE TO display the same Experience addressed by that entry point's Experience_Id, showing the viewing User's own Completion, Rating, and Note for that Experience.

3.3 WHEN a User taps a Completed_Experience_Row or leaderboard row to open the Experience_Detail_View, THEN the App SHALL CONTINUE TO complete the navigation within 2 seconds and present exactly one Experience_Detail_View instance for that tap, with no duplicate instances stacked for repeated taps.

3.4 WHEN a User has returned from the Experience_Detail_View to the originating screen, THEN the App SHALL CONTINUE TO present that originating screen in the same tab and mode it was displayed in before navigation began.

3.5 WHEN a Completion_Entry or leaderboard row has no available Experience_Id, THEN the App SHALL CONTINUE TO render that row without a navigation affordance and perform no navigation.

3.6 WHEN a User is on the Experience_Detail_View, THEN the App SHALL CONTINUE TO display the Experience name and Park in the themed `GradientHeader`, and the headers of all other screens SHALL CONTINUE TO render unchanged.
