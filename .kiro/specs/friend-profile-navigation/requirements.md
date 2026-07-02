# Requirements Document

## Introduction

The Friend Profile Navigation feature reorganizes the existing Friend_Profile_View in the Disney World Tracker mobile application so a User can browse an accepted Friend's progress through an intuitive, tab-based navigation instead of a single straight-through scroll. Today the Friend_Profile_View renders the Friend's Profile summary, completion statistics, and a flat list of completed Experiences stacked in one scroll. This feature keeps all of that information but surfaces it through a View_Selector — a row of icon-and-label tabs — that lets the User switch between an Overview, the Friend's progress organized by Park, the Friend's progress organized by Experience_Category, and the full list of individual completed Experiences.

This feature is a presentation and in-screen navigation enhancement only. It reuses the data already served by the existing Friend_Viewing_Services (the Auth_Service Profile read, the Stats_Service statistics read, and the Tracking_Service Completions read introduced by the friend-stats-viewing feature) and the established Owner_Or_Friend_Rule authorization model. It does not change those services, their authorization behavior, or the data they return.

The Parks and Categories modes fold the per-Park and per-Experience_Category completion statistics together with the relevant completed Experiences, so the statistics are reachable through the same tabbed navigation rather than as a separate flat block. This answers the question of whether the statistics presentation should adopt the same navigation pattern: within the Friend_Profile_View, it does.

This document also extends the same tabbed navigation pattern to the User's own statistics page — the Own_Stats_View — so that the User browses their own progress through an Own_Stats_Selector that mirrors the Friend_Profile_View's View_Selector. The Own_Stats_View reuses the existing Own_Stats_Service (the `GET /me/stats` read), which returns the User's own overall, per-Park, and per-Experience_Category completion statistics and enforces no Friend authorization because it returns only the requesting User's own data. As a result, the Own_Stats_View has no `profile_forbidden` authorization concern, which is the one behavioral difference from the Friend_Profile_View's loading and error handling.

Superseded assumption — Own_Stats_View now has an Experiences mode: An earlier revision of this document assumed the Own_Stats_View could have no Experiences mode because the Own_Stats_Service returns completion statistics only (overall, per-Park, per-Experience_Category, and per-Park-and-Experience_Category roll-ups) and no own-Completions data source was thought to exist. That assumption is now superseded. The existing Tracking_Service Completions read at `GET /users/{userId}/completions` is governed by the Owner_Or_Friend_Rule, which grants access on the owner path whenever the requesting User is the target User. The App therefore reads the requesting User's own Completion_Entries through this same existing endpoint — the Own_Completions_Read — with no new backend work, and an own Experiences mode IS feasible via the owner path of the existing Tracking_Service Completions read. Accordingly, the Own_Stats_Selector now provides four modes — Own_Overview, Own_Parks, Own_Categories, and Own_Experiences — mirroring the Friend_Profile_View's four Profile_View_Modes. Because the Own_Completions_Read returns only the requesting User's own data on the owner path, it raises no `profile_forbidden` concern for own data.

## Glossary

- **App**: The Disney World Tracker mobile application as a whole.
- **User**: An authenticated account holder of the App, whether viewing a Friend's profile in the Friend_Profile_View or their own statistics in the Own_Stats_View.
- **Friend**: A User who has an accepted, mutual relationship with the viewing User.
- **Profile**: The public-facing account information for a Friend, including display name, avatar image, and overall completion percentage.
- **Experience**: An individual catalog item at Walt Disney World, such as a ride, show, restaurant, parade, character meet-and-greet, or other activity.
- **Active Experience**: An Experience currently present in the catalog and not marked inactive.
- **Park**: One of the Walt Disney World locations to which an Experience belongs, as defined by the catalog.
- **Experience_Category**: The classification of an Experience, one of Ride, Show, Restaurant, Parade, Character_Meet, or Other.
- **Completion**: A record indicating that a Friend has completed a specific Experience, including the Completion date.
- **Completion_Entry**: One item in a Completions list — either a Friend's Completions list or the requesting User's own Completions list — comprising the completed Experience's name, Park, Experience_Category, Completion date, the Rating when one exists, and the shared Note text when a shareable Note exists, as served by the Tracking_Service.
- **Friend_Viewing_Services**: Collectively, the existing Auth_Service Profile read, Stats_Service statistics read, and Tracking_Service Completions read, each of which enforces the Owner_Or_Friend_Rule.
- **Own_Completions_Read**: The existing Tracking_Service Completions read served at `GET /users/{userId}/completions`, governed by the Owner_Or_Friend_Rule, which the App invokes with the requesting User's own userId so that the Owner_Or_Friend_Rule grants access on the owner path and returns the requesting User's own Completion_Entries; because this read returns only the requesting User's own data on the owner path, it raises no `profile_forbidden` concern for own data.
- **Owner_Or_Friend_Rule**: The existing authorization rule that grants a requesting User read access to a Friend's Profile, statistics, or Completions only when the requesting User is the target User or an accepted Friend, and otherwise denies the read with a `profile_forbidden` error.
- **Friend_Profile_View**: The App screen that displays a selected Friend's Profile summary, completion statistics, and completed Experiences.
- **View_Selector**: The navigation control within the Friend_Profile_View, composed of one selectable tab per Profile_View_Mode, where each tab carries a distinct icon and a text label.
- **Profile_View_Mode**: One of the four mutually exclusive presentations of a Friend's data reachable from the View_Selector: Overview, Parks, Categories, or Experiences.
- **Overview mode**: The Profile_View_Mode that presents the Friend's Profile summary and overall completion progress.
- **Parks mode**: The Profile_View_Mode that presents the Friend's progress organized by Park.
- **Categories mode**: The Profile_View_Mode that presents the Friend's progress organized by Experience_Category.
- **Experiences mode**: The Profile_View_Mode that presents the full list of the Friend's individual completed Experiences.
- **Park_Group**: The grouping, within Parks mode, of the Friend's Completion_Entries that share a single Park, together with that Park's completion statistic.
- **Category_Group**: The grouping, within Categories mode, of the Friend's Completion_Entries that share a single Experience_Category, together with that Experience_Category's completion statistic.
- **Own_Stats_View**: The App screen that displays the User's own completion statistics, comprising the User's overall completion, per-Park completion, and per-Experience_Category completion as served by the Own_Stats_Service.
- **Own_Stats_Service**: The existing read served at `GET /me/stats` that returns the requesting User's own completion statistics — overall completion, per-Park completion, per-Experience_Category completion, and a per-Park-and-Experience_Category roll-up — and that enforces no Friend authorization because it returns only the requesting User's own data.
- **Completion_Statistic**: A single completion figure comprising a completed-Experience count, a total-Experience count, and a completion percentage from 0.0 to 100.0 inclusive, as computed and served by the Own_Stats_Service.
- **Own_Stats_Selector**: The navigation control within the Own_Stats_View, composed of one selectable tab per Own_Stats_View_Mode, where each tab carries a distinct icon and a text label.
- **Own_Stats_View_Mode**: One of the four mutually exclusive presentations of the User's own data reachable from the Own_Stats_Selector: Own_Overview, Own_Parks, Own_Categories, or Own_Experiences.
- **Own_Overview mode**: The Own_Stats_View_Mode that presents the User's overall Completion_Statistic.
- **Own_Parks mode**: The Own_Stats_View_Mode that presents the User's own statistics organized by Park.
- **Own_Categories mode**: The Own_Stats_View_Mode that presents the User's own statistics organized by Experience_Category.
- **Own_Experiences mode**: The Own_Stats_View_Mode that presents the full list of the User's own individual completed Experiences, drawn from the Completion_Entries served by the Own_Completions_Read.
- **Own_Park_Stat**: The presentation, within Own_Parks mode, of a single Park together with that Park's Completion_Statistic from the Own_Stats_Service.
- **Own_Category_Stat**: The presentation, within Own_Categories mode, of a single Experience_Category together with that Experience_Category's Completion_Statistic from the Own_Stats_Service.
- **Experience_Filter**: A presentation-only control available on an Experiences list — both the Friend_Profile_View's Experiences mode and the Own_Stats_View's Own_Experiences mode — composed of an independent Park selection and an independent Experience_Category selection, each defaulting to "All", that narrows which already-loaded Completion_Entries the App displays without re-fetching data from any service.
- **Filter_Park_Selection**: The current Park value of an Experience_Filter, either "All" or exactly one Park defined in the catalog.
- **Filter_Category_Selection**: The current Experience_Category value of an Experience_Filter, either "All" or exactly one of the Experience_Categories Ride, Show, Restaurant, Parade, Character_Meet, or Other.

## Requirements

### Requirement 1: View_Selector Navigation Control

**User Story:** As a User, I want a tabbed navigation with icons at the top of a Friend's profile, so that I can move between different organized views of the Friend's progress instead of scrolling through one long list.

#### Acceptance Criteria

1. THE App SHALL display a View_Selector in the Friend_Profile_View containing exactly one selectable tab for each Profile_View_Mode: Overview, Parks, Categories, and Experiences.
2. THE App SHALL display, for each tab in the View_Selector, an icon that differs from the icon of every other tab and a non-empty text label that names the tab's Profile_View_Mode.
3. WHEN the Friend_Profile_View is first displayed for a Friend, THE App SHALL select the Overview mode and display the Overview mode content.
4. THE App SHALL display the content of exactly one Profile_View_Mode at a time in the Friend_Profile_View.
5. WHEN a User selects a tab in the View_Selector, THE App SHALL display the selected Profile_View_Mode's content and cease displaying the previously selected Profile_View_Mode's content within 300 milliseconds.
6. WHILE a Profile_View_Mode is selected, THE App SHALL render that mode's tab in the View_Selector so that it differs in at least one visible attribute from every unselected mode's tab.
7. THE App SHALL expose, for each tab in the View_Selector, an accessibility label identifying the Profile_View_Mode and an accessibility selected-state that matches the visual selection exactly, set for the active tab and unset for every inactive tab.
8. IF the Friend_Profile_View enters a state in which no Profile_View_Mode or more than one Profile_View_Mode is selected, THEN THE App SHALL resolve the View_Selector to the single Overview mode and display the Overview mode content.

### Requirement 2: Overview Mode

**User Story:** As a User, I want an overview of a Friend that shows who they are and their overall progress, so that I can recognize the Friend and gauge their total completion at a glance.

#### Acceptance Criteria

1. WHILE the Overview mode is selected, THE App SHALL display the Friend's display name and the Friend's overall completion percentage as a value from 0.0 to 100.0 inclusive to exactly one decimal place.
2. WHILE the Overview mode is selected and the Friend has an avatar image set, THE App SHALL display the Friend's avatar image.
3. WHILE the Overview mode is selected and the Friend has no avatar image set, THE App SHALL display a default avatar placeholder.
4. WHILE the Overview mode is selected, THE App SHALL display the total count of the Friend's completed Active Experiences as a non-negative integer.
5. IF the Overview mode is selected and the Friend has an avatar image set but the avatar image fails to load, THEN THE App SHALL display a default avatar placeholder.

### Requirement 3: Parks Mode

**User Story:** As a User, I want to browse a Friend's completed experiences grouped by park, so that I can see how much of each park the Friend has experienced and what they did there.

#### Acceptance Criteria

1. WHILE the Parks mode is selected, THE App SHALL display one Park_Group for each Park defined in the catalog, ordered by the Park order defined in the catalog and applied identically on every display.
2. THE App SHALL display, for each Park_Group, the Park name, that Park's completion percentage computed as the Park's completed-Experience count divided by the Park's total-Experience count multiplied by 100 and rounded to exactly one decimal place, the Park's completed-Experience count, and the Park's total-Experience count.
3. IF a Park_Group's total-Experience count is zero, THEN THE App SHALL display that Park_Group's completion percentage as 0.0.
4. THE App SHALL display in a Park_Group every Friend Completion_Entry whose Park equals that Park_Group's Park in the order returned by the Tracking_Service, and SHALL exclude from that Park_Group every Completion_Entry whose Park differs from that Park_Group's Park.
5. WHEN the App displays a Friend's Completion_Entry within a Park_Group, THE App SHALL display the Experience name, the Experience_Category, the Completion date as a calendar date, the Rating when a Rating is present in the Completion_Entry, and the shared Note text when a shared Note is present in the Completion_Entry.
6. IF a Completion_Entry has no Experience name available, THEN THE App SHALL omit that Completion_Entry from every Park_Group.
7. IF a Park_Group contains zero of the Friend's Completion_Entries, including a Park the Friend has never visited, THEN THE App SHALL display a message in that Park_Group indicating that the Friend has no completed Experiences in that Park.

### Requirement 4: Categories Mode

**User Story:** As a User, I want to browse a Friend's completed experiences grouped by experience type, so that I can compare how much of each kind of experience the Friend has completed.

#### Acceptance Criteria

1. WHILE the Categories mode is selected, THE App SHALL display exactly one Category_Group for each of the Experience_Categories Ride, Show, Restaurant, Parade, Character_Meet, and Other, in that enumerated order.
2. WHERE a Category_Group contains at least one of the Friend's Completion_Entries, THE App SHALL display, for that Category_Group, the Experience_Category name, that Experience_Category's completion percentage to exactly one decimal place, the Experience_Category's completed-Experience count, and the Experience_Category's total-Experience count.
3. THE App SHALL display in a Category_Group every Friend Completion_Entry whose Experience_Category equals that Category_Group's Experience_Category, and SHALL exclude from that Category_Group every Completion_Entry whose Experience_Category differs from that Category_Group's Experience_Category.
4. WHEN the App displays a Friend's Completion_Entry within a Category_Group, THE App SHALL display the Experience name, the Park, the Completion date as a calendar date, the Rating when a Rating is present in the Completion_Entry and omit the Rating when no Rating is present, and the shared Note text when a shared Note is present in the Completion_Entry and omit all Note text when no shared Note is present.
5. THE App SHALL display the Friend's Completion_Entries within a Category_Group in the order returned by the Tracking_Service.
6. IF a Completion_Entry has no Experience name available, THEN THE App SHALL omit that Completion_Entry from every Category_Group.
7. IF a Category_Group contains zero of the Friend's Completion_Entries, THEN THE App SHALL display the Experience_Category name and an empty indication for that Category_Group and SHALL suppress that Category_Group's percentage and counts.

### Requirement 5: Experiences Mode

**User Story:** As a User, I want a single list of every experience a Friend has completed in order, so that I can scan their full history when I do not want it broken up by park or type.

#### Acceptance Criteria

1. WHILE the Experiences mode is selected and the Friend has at least one Completion_Entry with an available Experience name, THE App SHALL display every such Friend Completion_Entry returned by the Tracking_Service in the order returned by the Tracking_Service.
2. WHEN the App displays a Friend's Completion_Entry in the Experiences mode, THE App SHALL display the Experience name, the Park, the Experience_Category, the Completion date as a calendar date, the Rating when a Rating is present in the Completion_Entry, and the shared Note text when a shared Note is present in the Completion_Entry.
3. IF a Completion_Entry has no Experience name available, THEN THE App SHALL omit that Completion_Entry from the Experiences mode.
4. IF the Friend has zero Completion_Entries with an available Experience name, THEN WHILE the Experiences mode is selected, THE App SHALL display an empty-state message indicating that the Friend has no completed Experiences to show.

### Requirement 6: Grouping Integrity Across Modes

**User Story:** As a User, I want the grouped views to show the same set of completions as the full list, so that I can trust that switching views never hides or duplicates a Friend's experiences.

#### Acceptance Criteria

1. THE App SHALL place each of the Friend's Completion_Entries that has an Experience name available into exactly one Park_Group in the Parks mode, namely the Park_Group whose Park equals that Completion_Entry's Park, and SHALL NOT place any Completion_Entry into more than one Park_Group.
2. THE App SHALL place each of the Friend's Completion_Entries that has an Experience name available into exactly one Category_Group in the Categories mode, namely the Category_Group whose Experience_Category equals that Completion_Entry's Experience_Category, and SHALL NOT place any Completion_Entry into more than one Category_Group.
3. THE App SHALL display, across all Park_Groups in the Parks mode, a combined count of the Friend's Completion_Entries that equals the count of the Friend's Completion_Entries with an Experience name available that the App displays in the Experiences mode, counting each such Completion_Entry exactly once.
4. THE App SHALL display, across all Category_Groups in the Categories mode, a combined count of the Friend's Completion_Entries that equals the count of the Friend's Completion_Entries with an Experience name available that the App displays in the Experiences mode, counting each such Completion_Entry exactly once.
5. WHEN a User switches between Profile_View_Modes without leaving the Friend_Profile_View, THE App SHALL continue to display the Friend data already loaded for the newly selected Profile_View_Mode and SHALL NOT re-issue any Friend_Viewing_Services request solely because the selected Profile_View_Mode changed.

### Requirement 7: Loading, Authorization, and Error States Within Navigation

**User Story:** As a User, I want clear loading and error feedback while a Friend's profile loads, so that the new tabbed navigation stays reliable when data is unavailable.

#### Acceptance Criteria

1. WHILE a Friend_Viewing_Services request whose data the selected Profile_View_Mode displays is in progress and no prior data for that request is available, THE App SHALL display a loading indicator within the selected Profile_View_Mode within 1 second of the request starting and SHALL continue to display it until that request completes, fails, or reaches a 30-second timeout.
2. IF any Friend_Viewing_Services request for the displayed Friend fails with a `profile_forbidden` authorization error, THEN THE App SHALL display, within the Friend_Profile_View, a message indicating that the Friend's data is unavailable and SHALL withhold the View_Selector and the Overview, Parks, Categories, and Experiences mode content from display.
3. IF a Friend_Viewing_Services request whose data the selected Profile_View_Mode displays fails with an error other than `profile_forbidden`, THEN THE App SHALL display, within the selected Profile_View_Mode and within 1 second of the failure, an error message indicating that the request failed and SHALL present a retry control for the failed request.
4. IF a Friend_Viewing_Services request whose data the selected Profile_View_Mode displays reaches the 30-second timeout without completing, THEN THE App SHALL treat that request as failed with an error other than `profile_forbidden`.
5. WHEN a User selects the retry control after a failed Friend_Viewing_Services request, THE App SHALL re-issue only the failed request and SHALL display the loading indicator for that request while the re-issued request is in progress.
6. WHILE a Friend_Viewing_Services request whose data the selected Profile_View_Mode displays has failed with an error other than `profile_forbidden`, THE App SHALL continue to allow the User to select any tab in the View_Selector and SHALL retain any Friend data already successfully loaded for the other Profile_View_Modes.

### Requirement 8: Own_Stats_Selector Navigation Control

**User Story:** As a User, I want a tabbed navigation with icons at the top of my own stats page, so that I can move between different organized views of my progress with the same pattern I use on a Friend's profile.

#### Acceptance Criteria

1. THE App SHALL display an Own_Stats_Selector in the Own_Stats_View containing exactly one selectable tab for each Own_Stats_View_Mode, in the order Own_Overview, Own_Parks, Own_Categories, Own_Experiences, applied identically on every display.
2. THE App SHALL display, for each tab in the Own_Stats_Selector, an icon that differs from the icon of every other tab and a non-empty text label that names the tab's Own_Stats_View_Mode.
3. WHEN the Own_Stats_View is first displayed, THE App SHALL select the Own_Overview mode and display the Own_Overview mode content.
4. THE App SHALL display the content of exactly one Own_Stats_View_Mode at a time in the Own_Stats_View.
5. WHEN a User selects a currently-unselected tab in the Own_Stats_Selector, THE App SHALL display the selected Own_Stats_View_Mode's content and cease displaying the previously selected Own_Stats_View_Mode's content within 300 milliseconds of the selection.
6. WHILE an Own_Stats_View_Mode is selected, THE App SHALL render that mode's tab in the Own_Stats_Selector so that it differs in at least one visible attribute from every unselected mode's tab.
7. THE App SHALL expose, for each tab in the Own_Stats_Selector, an accessibility label identifying the Own_Stats_View_Mode and an accessibility selected-state that matches the visual selection exactly, set for the active tab and unset for every inactive tab.
8. IF the Own_Stats_View enters a state in which no Own_Stats_View_Mode or more than one Own_Stats_View_Mode is selected, THEN THE App SHALL resolve the Own_Stats_Selector to the single Own_Overview mode and display the Own_Overview mode content.
9. WHEN a User selects the already-active tab in the Own_Stats_Selector, THE App SHALL retain that Own_Stats_View_Mode as selected and continue to display its content.

### Requirement 9: Own Overview Mode

**User Story:** As a User, I want an overview of my overall progress, so that I can gauge my total completion at a glance.

#### Acceptance Criteria

1. WHILE the Own_Overview mode is selected, THE App SHALL display the completion percentage of the User's overall Completion_Statistic served by the Own_Stats_Service as a value from 0.0 to 100.0 inclusive, rounded to exactly one decimal place.
2. WHILE the Own_Overview mode is selected, THE App SHALL display the completed-Experience count and the total-Experience count of the User's overall Completion_Statistic served by the Own_Stats_Service, each as a non-negative integer.
3. WHILE the Own_Overview mode is selected, IF the total-Experience count of the User's overall Completion_Statistic served by the Own_Stats_Service is zero, THEN THE App SHALL display the overall completion percentage as 0.0 and the overall completed-Experience count as 0.

### Requirement 10: Own Parks Mode

**User Story:** As a User, I want to see my completion broken down by park, so that I can tell which parks I have explored the most.

#### Acceptance Criteria

1. WHILE the Own_Parks mode is selected, THE App SHALL display one Own_Park_Stat for each Park defined in the catalog, ordered by the Park order defined in the catalog and applied identically on every display.
2. THE App SHALL display, for each Own_Park_Stat, the Park name, that Park's completion percentage as a value from 0.0 to 100.0 inclusive to exactly one decimal place, the Park's completed-Experience count as a non-negative integer, and the Park's total-Experience count as a non-negative integer, as served by the Own_Stats_Service.
3. IF a Park's total-Experience count is zero, THEN THE App SHALL display that Park's completion percentage as 0.0 and that Park's completed-Experience count as 0.

### Requirement 11: Own Categories Mode

**User Story:** As a User, I want to see my completion broken down by experience type, so that I can compare how much of each kind of experience I have completed.

#### Acceptance Criteria

1. WHILE the Own_Categories mode is selected, THE App SHALL display exactly one Own_Category_Stat for each of the Experience_Categories Ride, Show, Restaurant, Parade, Character_Meet, and Other, in that enumerated order.
2. WHILE the Own_Categories mode is selected, THE App SHALL display, for each Own_Category_Stat, the Experience_Category name, that Experience_Category's completion percentage as a value from 0.0 to 100.0 inclusive rounded to exactly one decimal place, the Experience_Category's completed-Experience count as a non-negative integer, and the Experience_Category's total-Experience count as a non-negative integer, as served by the Own_Stats_Service.
3. IF an Experience_Category's total-Experience count is zero, THEN THE App SHALL display that Experience_Category's completion percentage as 0.0 and that Experience_Category's completed-Experience count as 0.

### Requirement 12: Loading and Error States for the Own_Stats_View

**User Story:** As a User, I want clear loading and error feedback while my own stats and my own completed Experiences load, so that the tabbed navigation stays reliable when my data is unavailable. Because both the Own_Stats_Service and the Own_Completions_Read return only my own data and enforce no Friend authorization on the owner path, the Own_Stats_View has no `profile_forbidden` authorization state — the one behavioral difference from the Friend_Profile_View.

#### Acceptance Criteria

1. WHILE the Own_Stats_Service request is in progress and no prior Own_Stats_Service data is available, THE App SHALL display a loading indicator in the Own_Stats_View within 1 second of the request starting and SHALL continue to display it until that request completes, fails, or times out.
2. WHEN the Own_Stats_Service request completes successfully, THE App SHALL display, within 2 seconds of receiving the response, the Own_Stats_Selector and the content of the selected Own_Stats_View_Mode.
3. IF the Own_Stats_Service request fails, THEN THE App SHALL display, within the Own_Stats_View, an error message indicating that the statistics could not be loaded and SHALL present a retry control for the failed request.
4. WHEN a User selects an Own_Stats_View_Mode tab while the data that mode displays is already loaded, THE App SHALL display the selected mode's content from the loaded data and SHALL NOT re-issue the Own_Stats_Service request or the Own_Completions_Read solely because the selected Own_Stats_View_Mode changed.
5. IF the Own_Stats_Service request remains in progress for 30 seconds without completing, THEN THE App SHALL treat the request as a failed request, display within the Own_Stats_View an error message indicating that the request did not complete, and present a retry control for the request.
6. WHEN a User selects the retry control after a failed Own_Stats_Service request, THE App SHALL re-issue the Own_Stats_Service request and SHALL display the loading indicator in the Own_Stats_View while the re-issued request is in progress.
7. WHILE the Own_Completions_Read is in progress and no prior Own_Completions_Read data is available, THE App SHALL display a loading indicator within the Own_Experiences mode within 1 second of the request starting and SHALL continue to display it until that request completes, fails, or reaches a 30-second timeout.
8. IF the Own_Completions_Read fails with an error, or reaches the 30-second timeout without completing, THEN THE App SHALL display, within the Own_Experiences mode, an error message indicating that the User's completed Experiences could not be loaded and SHALL present a retry control for the Own_Completions_Read.
9. WHEN a User selects the retry control after a failed Own_Completions_Read, THE App SHALL re-issue only the Own_Completions_Read and SHALL display the loading indicator within the Own_Experiences mode while the re-issued request is in progress.

### Requirement 13: Own Experiences Mode

**User Story:** As a User, I want a single list of every Experience I have completed in order, so that I can scan my full history the same way I can on a Friend's profile.

#### Acceptance Criteria

1. WHILE the Own_Experiences mode is selected and the Own_Completions_Read has completed successfully and the User has at least one Completion_Entry with an available Experience name in the Own_Completions_Read data, THE App SHALL display every such Completion_Entry returned by the Own_Completions_Read in the order returned by the Own_Completions_Read, displaying each such Completion_Entry exactly once.
2. WHEN the App displays a Completion_Entry of the User in the Own_Experiences mode, THE App SHALL display the Experience name, the Park, the Experience_Category, and the Completion date as a calendar date, SHALL display the Rating when a Rating is present in the Completion_Entry and omit the Rating when no Rating is present, and SHALL display the shared Note text when a shared Note is present in the Completion_Entry and omit all Note text when no shared Note is present.
3. IF a Completion_Entry has no Experience name available, THEN THE App SHALL omit that Completion_Entry from the Own_Experiences mode.
4. IF the Own_Completions_Read has completed successfully and the User has zero Completion_Entries with an available Experience name in the Own_Completions_Read data, THEN WHILE the Own_Experiences mode is selected, THE App SHALL display an empty-state message indicating that the User has no completed Experiences to show.

### Requirement 14: Experience_Filter on Experiences Lists

**User Story:** As a User, I want to narrow a list of completed Experiences to a single park and a single experience type, so that I can focus on just the completions I care about on both a Friend's profile and my own stats.

#### Acceptance Criteria

1. THE App SHALL display an Experience_Filter within the Friend_Profile_View's Experiences mode and within the Own_Stats_View's Own_Experiences mode, each Experience_Filter providing an independent Filter_Park_Selection and an independent Filter_Category_Selection.
2. WHEN an Experiences list is first displayed, THE App SHALL set that list's Experience_Filter to a Filter_Park_Selection of "All" and a Filter_Category_Selection of "All".
3. THE App SHALL offer, for the Filter_Park_Selection, the value "All" and exactly one value for each Park defined in the catalog, and SHALL offer, for the Filter_Category_Selection, the value "All" and exactly one value for each of the Experience_Categories Ride, Show, Restaurant, Parade, Character_Meet, and Other.
4. THE App SHALL apply the Experience_Filter only to Completion_Entries already loaded for the active mode and SHALL NOT re-issue the Tracking_Service Completions read or the Own_Completions_Read solely because a Filter_Park_Selection or a Filter_Category_Selection changed.
5. WHILE an Experience_Filter is active, THE App SHALL display, in the order returned by the originating read, every loaded Completion_Entry that has an available Experience name and whose Park matches the Filter_Park_Selection or where the Filter_Park_Selection is "All" and whose Experience_Category matches the Filter_Category_Selection or where the Filter_Category_Selection is "All", and SHALL exclude from display every loaded Completion_Entry that does not satisfy both selections.
6. WHILE both the Filter_Park_Selection and the Filter_Category_Selection are "All", THE App SHALL display the same set of Completion_Entries that the active mode displays with no Experience_Filter applied, in the order returned by the originating read.
7. WHEN a User changes the Filter_Park_Selection or the Filter_Category_Selection, THE App SHALL update the displayed list within 300 milliseconds to show exactly the Completion_Entries that satisfy the updated selections, in the order returned by the originating read.
8. IF no loaded Completion_Entry with an available Experience name satisfies the active Filter_Park_Selection and Filter_Category_Selection, THEN THE App SHALL display an empty-state message indicating that no completed Experiences match the active filter.
9. THE App SHALL expose, for the Filter_Park_Selection control and the Filter_Category_Selection control, an accessibility label identifying the control and an accessibility value reflecting the currently active selection.
