# Requirements Document

## Introduction

The Experience Detail Navigation feature lets a User open an Experience's detail page directly from a completed-Experience row, whether that row appears on the User's own Stats page or on a Friend's profile. Today the Disney World Tracker mobile application renders every completed-Experience entry through a single shared Completion_Row component that is purely presentational — it shows the Experience name, contextual metadata, the Rating, and the shared Note, but tapping it does nothing. This feature makes that row a navigation affordance: tapping a completed-Experience row navigates the App to the existing Experience_Detail_View for that Experience.

The destination screen already exists. The Experience_Detail_View is registered in the Catalog tab's stack and is addressed by an Experience_Id. Cross-stack navigation is already supported by the navigation typing, so the Stats tab and the Friends tab can dispatch a navigation into the Catalog tab's Experience_Detail_View. The presentational row and the destination screen are both in place; what is missing is the data and the wiring that connect them.

The central gap this feature closes is that the Completion_Entry data does not currently carry an Experience_Id. The Completion_Entry record served by the Tracking_Service Completions read — the same record that backs both a Friend's completed-Experience list and the User's own completed-Experience list — carries the Experience name, Park, Experience_Category, Completion date, Rating, and shared Note, but not the Experience_Id that the Experience_Detail_View requires as its navigation target. This feature therefore threads the Experience_Id through the Tracking_Service Completions read: the underlying query already joins the Experience row, so the Experience_Id is available and is added to the Completion_Entry projection, the shared Completion_Entry wire contract, and the route mapping. This makes the feature a coordinated backend, shared-contract, and mobile change rather than a client-only change.

This feature reuses the existing Experience_Detail_View without modification. The Experience_Detail_View loads the viewing User's own Completion, Rating, and Note for the Experience (from the viewing User's own tracking reads), independent of whose completed-Experience row was tapped. Accordingly, when a User opens a Friend's completed Experience, the Experience_Detail_View presents the viewing User's own tracking data and controls for that Experience — not the Friend's. The Rating and shared Note shown on the Friend's row therefore may differ from the viewing User's own Rating and Note shown on the detail page. This is an intentional decision recorded here for review: the destination screen is the standard, shared Experience_Detail_View, with no read-only or Friend-scoped variant introduced by this feature.

This feature builds on the existing friend-stats-viewing and friend-profile-navigation specs, reusing the Tracking_Service Completions read and the Owner_Or_Friend_Rule those specs introduced. It does not change the Owner_Or_Friend_Rule, the set of Completions returned, the ordering, the cap, or the Rating and shared-Note disclosure behavior; it only adds the Experience_Id field to each returned Completion_Entry.

This document also adds a presentation-only enhancement to the grouped views introduced by the friend-profile-navigation spec. Today the Friend_Profile_View's Parks and Categories modes and the Stats_View's Own_Parks and Own_Categories modes render every Park and every Experience_Category as a stat header followed by a vertically stacked body — and groups with no completed Experiences show a large inline empty-state block, which makes the views verbose and cluttered. Requirements 7 through 12 keep every Park and every Experience_Category visible (no group is hidden) but make each group a collapsible Group_Section: a tappable Group_Header carrying the group's name and completion statistic, plus a Group_Body that, when expanded, shows that group's completed-Experience rows or a compact empty indication. This is a mobile, client-only presentation change that reuses the friend-profile-navigation grouping (groupByPark / groupByCategory) and the shared Completion_Row; it changes no backend read, route, authorization rule, or response shape, and it leaves Requirements 1 through 6 unchanged. The expanded rows are the same tappable Completed_Experience_Rows specified in Requirements 2 through 4, so tapping an Experience inside an expanded group still navigates to the Experience_Detail_View.

Requirements 8 (default collapsed on first display) and 10 (in-memory, per-Screen_Session retention of each section's state) record recommended defaults for the two open product decisions and are flagged here for the User's confirmation during review.

## Glossary

- **App**: The Disney World Tracker mobile application as a whole.
- **User**: An authenticated account holder of the App, whether viewing their own Stats_View or a Friend's Friend_Profile_View.
- **Friend**: A User who has an accepted, mutual relationship with the viewing User.
- **Experience**: An individual catalog item at Walt Disney World, such as a ride, show, restaurant, parade, character meet-and-greet, or other activity.
- **Active Experience**: An Experience currently present in the catalog and not marked inactive.
- **Experience_Id**: The stable, unique identifier of an Experience in the catalog, formatted as a UUID, by which the Experience_Detail_View addresses an Experience.
- **Park**: One of the Walt Disney World locations to which an Experience belongs.
- **Experience_Category**: The classification of an Experience, one of Ride, Show, Restaurant, Parade, Character_Meet, or Other.
- **Completion**: A record indicating that a User has completed a specific Experience, including the Completion date.
- **Rating**: A numeric score, an integer from 1 to 10 inclusive, assigned by a User to an Experience.
- **Note**: A free-form personal text entry assigned by a User to an Experience, carrying a per-Note shareable flag.
- **Completion_Entry**: One item in a Completions list — either a Friend's Completions list or the viewing User's own Completions list — as served by the Tracking_Service Completions read, comprising the Experience_Id, the completed Experience's name, Park, and Experience_Category, the Completion date, the Rating when one exists, and the shared Note text when a shareable Note exists.
- **Tracking_Service**: The component responsible for recording and serving per-User Completions, Ratings, and Notes, including the Completions read served at `GET /users/{userId}/completions` that returns a list of Completion_Entry records.
- **Owner_Or_Friend_Rule**: The existing authorization rule that grants a requesting User read access to a target User's Completions only when the requesting User is the target User or an accepted Friend, and otherwise denies the read with a `profile_forbidden` error.
- **Completion_Row**: The shared App component that renders a single Completion_Entry, displaying the Experience name, contextual metadata, the Rating when present, and the shared Note when present.
- **Stats_View**: The App screen that displays the viewing User's own completion statistics and, within its Own_Experiences mode, the viewing User's own completed-Experience Completion_Rows.
- **Friend_Profile_View**: The App screen that displays a selected Friend's progress and, within its Parks, Categories, and Experiences modes, the Friend's completed-Experience Completion_Rows.
- **Completed_Experience_Row**: A Completion_Row that the App renders within the Stats_View's Own_Experiences mode or within the Friend_Profile_View's Parks, Categories, or Experiences modes.
- **Experience_Detail_View**: The existing App screen, registered in the Catalog tab's navigation stack and addressed by an Experience_Id, that displays an Experience's name, Park, Experience_Category, description, live operational information, the viewing User's own Completion, Rating, and Note controls, and the community aggregate Rating.
- **Grouped_View_Mode**: Any one of the four App modes that organize completed Experiences under per-group stat headers: the Friend_Profile_View's Parks mode and Categories mode, and the Stats_View's Own_Parks mode and Own_Categories mode. (The Stats_View's per-Park and per-Experience_Category modes are named Own_Parks and Own_Categories in the friend-profile-navigation spec.)
- **Group_Section**: The presentation, within a Grouped_View_Mode, of a single Park or single Experience_Category, comprising a Group_Header and a collapsible Group_Body. A Group_Section generalizes the existing Park_Group, Category_Group, Own_Park_Stat, and Own_Category_Stat presentations as collapsible sections.
- **Group_Header**: The tappable header of a Group_Section that names the Section's Park or Experience_Category, displays that group's completion statistic exactly as the underlying Grouped_View_Mode already specifies, and serves as the control that expands or collapses the Group_Section.
- **Group_Body**: The collapsible content region of a Group_Section that, while the Group_Section is Expanded, contains either the group's Completed_Experience_Rows or a Compact_Empty_State, and that is hidden while the Group_Section is Collapsed.
- **Expanded**: The state of a Group_Section in which the App displays the Group_Section's Group_Body.
- **Collapsed**: The state of a Group_Section in which the App hides the Group_Section's Group_Body.
- **Compact_Empty_State**: A single, non-row indication the App displays inside an Expanded Group_Body when the Group_Section's group contains no completed Experiences, conveying that nothing has been completed in that Park or Experience_Category, and carrying no navigation affordance.
- **Screen_Session**: A single continuous presentation of the Stats_View or the Friend_Profile_View, from the time the screen is presented until the viewing User navigates away from that screen.

## Requirements

### Requirement 1: Experience_Id in the Completions Read

**User Story:** As a User, I want each completed-Experience entry to carry the identity of its Experience, so that the App can open the correct Experience's detail page when I tap the entry.

#### Acceptance Criteria

1. WHEN the Tracking_Service serves a Completion_Entry from the Completions read, THE Tracking_Service SHALL include in that Completion_Entry the Experience_Id of the Experience that the Completion references.
2. THE Tracking_Service SHALL set each Completion_Entry's Experience_Id to the Experience_Id of the same Active Experience whose name, Park, and Experience_Category that Completion_Entry reports.
3. THE Tracking_Service SHALL format each Completion_Entry's Experience_Id as the catalog Experience_Id of that Experience, so that the value matches the Experience_Id the Experience_Detail_View uses to load the same Experience.
4. WHEN the Tracking_Service adds the Experience_Id to a Completion_Entry, THE Tracking_Service SHALL leave unchanged the set of returned Completion_Entries, their ordering, the 5,000-entry cap, the Rating values, and the shared-Note disclosure behavior established by the existing Completions read.
5. WHEN the Tracking_Service evaluates a Completions read request, THE Tracking_Service SHALL apply the Owner_Or_Friend_Rule before returning any Completion_Entry, returning a `profile_forbidden` authorization error for a request that the Owner_Or_Friend_Rule denies and disclosing no Completion_Entry or Experience_Id for that request.

### Requirement 2: Navigate from a Friend's Completed-Experience Row

**User Story:** As a User, I want to tap one of a Friend's completed experiences and open that Experience's detail page, so that I can explore an Experience my Friend has done.

#### Acceptance Criteria

1. WHEN a User taps a Completed_Experience_Row in the Friend_Profile_View, THE App SHALL navigate to the Experience_Detail_View addressed by that row's Completion_Entry Experience_Id.
2. WHEN a User taps a Completed_Experience_Row in the Friend_Profile_View's Parks mode, Categories mode, or Experiences mode, THE App SHALL navigate to the Experience_Detail_View for that same row's Experience regardless of which of those three modes the row was displayed in.
3. WHEN the App navigates from a Completed_Experience_Row in the Friend_Profile_View to the Experience_Detail_View, THE App SHALL complete the navigation within 2 seconds of the tap.
4. WHEN the App navigates from a Friend's Completed_Experience_Row to the Experience_Detail_View, THE App SHALL display in the Experience_Detail_View the viewing User's own Completion, Rating, and Note for that Experience, independent of the Friend's Rating and Note shown on the tapped row.

### Requirement 3: Navigate from the User's Own Completed-Experience Row

**User Story:** As a User, I want to tap one of my own completed experiences on my Stats page and open that Experience's detail page, so that I can review or update my Completion, Rating, and Note for it.

#### Acceptance Criteria

1. WHEN a User taps a Completed_Experience_Row in the Stats_View's Own_Experiences mode, THE App SHALL navigate to the Experience_Detail_View addressed by that row's Completion_Entry Experience_Id.
2. WHEN the App navigates from a Completed_Experience_Row in the Stats_View to the Experience_Detail_View, THE App SHALL complete the navigation within 2 seconds of the tap.
3. WHEN the App navigates from the Stats_View to the Experience_Detail_View, THE App SHALL display in the Experience_Detail_View the same Experience identified by the tapped row's Completion_Entry Experience_Id.

### Requirement 4: Completed-Experience Row Tap Affordance

**User Story:** As a User, I want completed-experience rows to be clearly interactive and reachable by assistive technology, so that I can discover and use the navigation on any device.

#### Acceptance Criteria

1. THE App SHALL render each Completed_Experience_Row as a single activatable control that responds to a tap anywhere within the row.
2. THE App SHALL expose, for each Completed_Experience_Row, an accessibility role indicating an activatable control and an accessibility label that includes the row's Experience name.
3. WHEN a User activates a Completed_Experience_Row through an assistive technology activation gesture, THE App SHALL perform the same navigation to the Experience_Detail_View that a direct tap performs, independent of any direct tap on the row.
4. WHILE the Stats_View or the Friend_Profile_View displays a Completion_Row in a context other than a Completed_Experience_Row, THE App SHALL apply the navigation affordance only to Completed_Experience_Rows.

### Requirement 5: Repeated and Concurrent Navigation Handling

**User Story:** As a User, I want tapping a completed experience to open exactly one detail page even if I tap quickly or repeatedly, so that navigation stays predictable.

#### Acceptance Criteria

1. WHEN a User taps a single Completed_Experience_Row, THE App SHALL navigate to exactly one Experience_Detail_View instance for that tap.
2. IF a User taps a Completed_Experience_Row more than once before the Experience_Detail_View has been presented, THEN THE App SHALL present the Experience_Detail_View for that row's Experience exactly once and SHALL NOT stack duplicate Experience_Detail_View instances for the repeated taps.
3. WHEN a User navigates from a Completed_Experience_Row to the Experience_Detail_View and then returns, THE App SHALL return to the originating screen from which the navigation began, whether that screen is the Stats_View, the Friend_Profile_View, or any other screen from which a Completed_Experience_Row is displayed.

### Requirement 6: Missing Experience Identifier Handling

**User Story:** As a User, I want the app to behave safely if an experience's identity is unavailable, so that a malformed entry never opens a broken or wrong detail page.

#### Acceptance Criteria

1. IF a Completion_Entry has no Experience_Id available, THEN THE App SHALL render that row without a navigation affordance and SHALL ignore every tap and activation gesture on that row, performing no navigation.
2. WHERE a Completion_Entry's Experience_Id is present, THE App SHALL use that exact Experience_Id, unmodified, as the navigation target for the Experience_Detail_View.

### Requirement 7: Collapsible Group Sections in the Grouped Views

**User Story:** As a User, I want each park and category in the grouped views to be a section I can expand or collapse, so that I can scan the headers without scrolling past long or empty lists.

#### Acceptance Criteria

1. WHILE a Grouped_View_Mode is displayed, THE App SHALL render each Park and each Experience_Category that the Grouped_View_Mode presents as a Group_Section composed of a Group_Header and a collapsible Group_Body.
2. WHILE a Grouped_View_Mode is displayed, THE App SHALL render a Group_Section for every Park and every Experience_Category that the Grouped_View_Mode presents, including a Park or Experience_Category whose completed-Experience count is zero, and SHALL omit no such Group_Section.
3. THE App SHALL render each Group_Header as a single activatable control that, when tapped anywhere within the Group_Header, toggles its Group_Section between the Expanded state and the Collapsed state.
4. WHILE a Group_Section is Collapsed, THE App SHALL hide that Group_Section's Group_Body.
5. WHILE a Group_Section is Expanded, THE App SHALL display that Group_Section's Group_Body.

### Requirement 8: Default Expand/Collapse State on First Display

**User Story:** As a User, I want a predictable starting layout when I open a grouped view, so that the screen is compact and I choose what to expand.

> Recommended default, flagged for confirmation: every Group_Section starts Collapsed so the first display shows only the compact list of stat headers.

#### Acceptance Criteria

1. WHEN a Grouped_View_Mode is first displayed within a Screen_Session, THE App SHALL place every Group_Section in that Grouped_View_Mode in the Collapsed state.
2. WHEN a Grouped_View_Mode is first displayed within a Screen_Session, THE App SHALL display every Group_Header for that Grouped_View_Mode regardless of each Group_Section's Collapsed state.

### Requirement 9: Group Header Content and Visibility

**User Story:** As a User, I want each section header to always show the park or category name and its completion stat, so that I can read my progress without expanding the section.

#### Acceptance Criteria

1. THE App SHALL display in each Group_Header the Park name or the Experience_Category name of that Group_Section.
2. THE App SHALL display in each Group_Header the same completion statistic figures — completed-Experience count, total-Experience count, and completion percentage to exactly one decimal place — that the underlying Grouped_View_Mode already specifies for that Park or Experience_Category, including any suppression of figures that the Grouped_View_Mode specifies for an empty group.
3. WHILE a Group_Section is Collapsed and WHILE that Group_Section is Expanded, THE App SHALL display that Group_Section's Group_Header with identical name and statistic content in both states.

### Requirement 10: Independent Toggling and Per-Session Retention

**User Story:** As a User, I want expanding one section to leave the others alone and to keep my expanded sections as I move between tabs, so that the view behaves consistently.

> Recommended default, flagged for confirmation: each Group_Section's Expanded/Collapsed state is held in memory for the duration of the Screen_Session and is reset to the default when the screen is presented again.

#### Acceptance Criteria

1. WHEN a User toggles one Group_Section, THE App SHALL change only that Group_Section's Expanded/Collapsed state and SHALL leave every other Group_Section's Expanded/Collapsed state unchanged.
2. WHILE the viewing User remains in the same Screen_Session, THE App SHALL retain each Group_Section's Expanded/Collapsed state across switches between modes and across re-renders that do not present the screen anew.
3. WHEN the Stats_View or the Friend_Profile_View is presented anew, beginning a new Screen_Session, THE App SHALL place every Group_Section in the default Collapsed state defined in Requirement 8.

### Requirement 11: Expanded Group Body Contents

**User Story:** As a User, I want an expanded section to show the experiences I completed there and to tell me clearly when there are none, so that the section body is useful in both cases.

#### Acceptance Criteria

1. WHILE a Group_Section is Expanded and that Group_Section's group contains at least one Completion_Entry with an available Experience name, THE App SHALL display in that Group_Section's Group_Body the group's Completed_Experience_Rows exactly as the underlying Grouped_View_Mode specifies for that group.
2. WHILE a Group_Section is Expanded and that Group_Section's group contains zero Completion_Entries with an available Experience name, THE App SHALL display in that Group_Section's Group_Body a Compact_Empty_State indicating that nothing has been completed in that Park or Experience_Category.
3. WHEN a User taps a Completed_Experience_Row within an Expanded Group_Body, THE App SHALL navigate to the Experience_Detail_View addressed by that row's Completion_Entry Experience_Id, consistent with Requirement 2 and Requirement 3.
4. THE App SHALL render the Compact_Empty_State without a navigation affordance and SHALL ignore every tap and activation gesture on the Compact_Empty_State, performing no navigation.

### Requirement 12: Accessibility of Collapsible Group Headers

**User Story:** As a User who relies on assistive technology, I want section headers announced as expandable controls with their current state, so that I can operate the collapsible sections.

#### Acceptance Criteria

1. THE App SHALL expose each Group_Header with an accessibility role indicating an expandable and collapsible control.
2. THE App SHALL expose for each Group_Header an accessibility label that includes the Group_Section's Park name or Experience_Category name.
3. THE App SHALL expose for each Group_Header an accessibility expanded/collapsed state that reflects that Group_Section's current Expanded or Collapsed state.
4. WHEN a User activates a Group_Header through an assistive technology activation gesture, THE App SHALL toggle that Group_Section between the Expanded state and the Collapsed state, performing the same toggle that a direct tap performs and independent of any direct tap.
