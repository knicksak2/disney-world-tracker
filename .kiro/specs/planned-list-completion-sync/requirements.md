# Requirements Document

## Introduction

Planned List Completion Sync is an enhancement to the existing Trips feature. It creates synergy between the shared Planned_List and the Trip_Activity surface (the consolidated feed plus log-a-completion control) on the Trip_Detail_View, so that planning what the group wants to do and recording what the group actually did feel like one connected loop instead of two disconnected lists.

The enhancement delivers three payoffs:

1. **One-tap logging from a plan.** Each Planned_Item offers a control that opens the existing Log-a-Completion composer (the same `POST /trips/:id/log-entries` flow with rode-with tags and an optional Rating defined in Trips Requirement 10 and Requirement 20) pre-filled with that Planned_Item's referenced Experience, so a Trip_Member does not re-search the Catalog for something already on the list.

2. **Derived completed state instead of deletion.** A Planned_Item is presented as completed when any Trip_Member has a Trip_Log_Entry for that same Experience in that Trip. Completed Planned_Items are never deleted; they are visually marked done, grouped into a Done section, and retain their "added by" attribution. The completion link is derived at read time by matching the referenced Experience within the Trip and is never stored as a new field or as a Trip-local copy of catalog data.

3. **Progress and summary payoff.** The Planned_List displays progress as a completed-of-total count, and the Trip_Summary surfaces how many planned Experiences the group has completed.

This feature is a presentation and derivation layer on top of the existing Trips data model. Planned_Item and Trip_Log_Entry remain distinct records; no destructive deletion of Planned_Items occurs on completion, and no Trip-local copy of canonical Completion, Rating, or Experience data is introduced. It reuses the existing Trips endpoints (`GET /trips/:id/planned-items`, `POST /trips/:id/log-entries`, `GET /trips/:id/feed`, `GET /trips/:id/summary`) and honors the existing Trips authorization rules (member-gated actions, and the collapse of non-member and non-existent Trips to the same forbidden response) and the single canonical Rating model.

## Glossary

This feature reuses terms defined in the Trips spec glossary (`.kiro/specs/trips/requirements.md`) rather than redefining them. Referenced existing terms:

- **App**, **User**, **Trip**, **Trip_Service**, **Trip_Member**, **Trip_Detail_View**, **Trip_Member_Rule** — as defined in the Trips spec.
- **Experience** — an individual Catalog item, as defined in the Trips spec.
- **Park** — the Park of an Experience, as surfaced by the Catalog in the Trips spec.
- **Planned_List** — the shared list of Experiences that Trip_Members want to do on a Trip, as defined in the Trips spec.
- **Planned_Item** — one entry in a Planned_List referencing one Experience and recording the Trip_Member who added it, as defined in the Trips spec.
- **Trip_Activity** — the single Trip_Detail_View surface that combines the Trip_Feed with the control to log a Completion, as defined in the Trips spec (Requirement 20).
- **Trip_Log_Entry** — a record that a Trip_Member completed an Experience in the context of a Trip, referencing the logging Member's canonical Completion, as defined in the Trips spec.
- **Rode_With_Tag** — a tag on a Trip_Log_Entry naming another Trip_Member the logging Member rode with, as defined in the Trips spec.
- **Completion** — a canonical record that a User completed an Experience, as defined in the Trips spec (Tracking_Service).
- **Rating** — the single canonical whole-number score from 1 to 10 inclusive per User per Experience, as defined in the Trips spec (Tracking_Service); referenced, never copied, per Trips Requirement 12.
- **Trip_Summary** — the derived view over a Trip presenting group counts and per-Member contributions, as defined in the Trips spec (Requirement 14).
- **Tracking_Service**, **Catalog** — existing components, as defined in the Trips spec.

Terms introduced by this feature:

- **Log_Composer**: The existing Log-a-Completion composer surfaced within Trip_Activity that assembles the `POST /trips/:id/log-entries` request described in Trips Requirement 10 and Requirement 20, comprising a referenced Experience, zero or more Rode_With_Tags, and an optional Rating.
- **Planned_Item_Log_Control**: The control offered on each Planned_Item in the Planned_List that opens the Log_Composer pre-filled with that Planned_Item's referenced Experience.
- **Planned_Item_Completion_State**: A derived value of `done` or `not_done` for a Planned_Item, computed by matching the Planned_Item's referenced Experience against the Trip_Log_Entries of the same Trip; it is never stored as an independent field.
- **Completed_Planned_Item**: A Planned_Item whose Planned_Item_Completion_State is `done`.
- **Done_Section**: The grouping within the Planned_List presentation that contains the Completed_Planned_Items.
- **Planned_List_Progress**: A derived pair for a Trip's Planned_List comprising the count of Completed_Planned_Items and the total count of Planned_Items, presented as a completed-of-total value.
- **Planned_Completion_Match**: The derivation rule that a Planned_Item is a Completed_Planned_Item when at least one Trip_Log_Entry in the same Trip references the same Experience as that Planned_Item.

## Requirements

### Requirement 1: Log a Completion Directly From a Planned Item

**User Story:** As a Trip_Member, I want to log a completion straight from a Planned_Item, so that I do not have to re-find in the Catalog something the group already planned.

#### Acceptance Criteria

1. WHEN the App displays a Planned_Item in the Planned_List of a Trip to a Trip_Member, THE App SHALL present a Planned_Item_Log_Control for that Planned_Item.
2. WHEN a Trip_Member activates the Planned_Item_Log_Control for a Planned_Item, THE App SHALL open the Log_Composer with the Planned_Item's referenced Experience pre-filled as the Experience to be logged.
3. WHEN the App opens the Log_Composer from a Planned_Item_Log_Control, THE App SHALL provide the same rode-with tagging and optional Rating inputs defined in Trips Requirement 10 for the pre-filled Experience.
4. WHEN a Trip_Member submits the Log_Composer opened from a Planned_Item_Log_Control, THE App SHALL send the completion using the existing `POST /trips/:id/log-entries` request defined in Trips Requirement 10 without introducing a separate logging endpoint.
5. WHERE a Planned_Item's Planned_Item_Completion_State is `done`, THE App SHALL continue to present the Planned_Item_Log_Control so that a Trip_Member can log an additional Completion of the referenced Experience.
6. THE App SHALL present the Planned_Item_Log_Control only to a Trip_Member of the Trip, in accordance with the Trip_Member_Rule.

### Requirement 2: Derived Completion State of a Planned Item

**User Story:** As a Trip_Member, I want a Planned_Item to show as done once anyone in the group logs it, so that the plan reflects what we have actually accomplished together.

#### Acceptance Criteria

1. WHEN the App computes the Planned_List presentation for a Trip, IF at least one Trip_Log_Entry in that Trip references the same Experience, matched by Experience identity, as a Planned_Item in that Trip, THEN THE App SHALL derive that Planned_Item's Planned_Item_Completion_State as `done`.
2. WHEN the App computes the Planned_List presentation for a Trip, IF no Trip_Log_Entry in that Trip references the same Experience, matched by Experience identity, as a Planned_Item in that Trip, THEN THE App SHALL derive that Planned_Item's Planned_Item_Completion_State as `not_done`.
3. THE App SHALL derive the Planned_Item_Completion_State of a Planned_Item from the Planned_Completion_Match regardless of which Trip_Member created the matching Trip_Log_Entry.
4. WHEN a Trip_Member loads or refreshes the Trip_Detail_View after a Trip_Log_Entry referencing a Planned_Item's Experience has been created in the Trip, THE App SHALL derive that Planned_Item's Planned_Item_Completion_State as `done` within that same computation of the Planned_List presentation, without requiring any additional Trip_Member action.
5. THE App SHALL derive the Planned_Item_Completion_State from Planned_Items and Trip_Log_Entries already loaded for the Trip_Detail_View and SHALL NOT require a Planned_List retrieval endpoint beyond the existing `GET /trips/:id/planned-items` and the existing Trip_Activity data from `GET /trips/:id/feed`.
6. THE App SHALL treat the Planned_Item_Completion_State as a derived value computed at display time and SHALL NOT persist the Planned_Item_Completion_State as a field on the Planned_Item.
7. IF the Trip_Activity data from `GET /trips/:id/feed` required to evaluate the Planned_Completion_Match has not been successfully loaded for the Trip_Detail_View, THEN THE App SHALL derive each affected Planned_Item's Planned_Item_Completion_State as `not_done`, SHALL present an indication that completion status could not be determined, and SHALL NOT display any Planned_Item as `done` from unavailable data.

### Requirement 3: Presentation of Completed Planned Items Without Deletion

**User Story:** As a Trip_Member, I want completed plans marked done and kept in the list, so that we retain a record of what we planned and who added it.

#### Acceptance Criteria

1. WHEN a Planned_Item's Planned_Item_Completion_State is `done`, THE App SHALL display on that Planned_Item a completed indicator that is visually distinct from the presentation of Planned_Items whose Planned_Item_Completion_State is `not_done`.
2. WHEN the App displays the Planned_List, THE App SHALL place each Completed_Planned_Item in the Done_Section and each Planned_Item whose Planned_Item_Completion_State is `not_done` outside the Done_Section, presenting each Planned_Item in exactly one of these two groupings.
3. WHEN the App displays a Completed_Planned_Item, THE App SHALL display the referenced Experience name, the Park of the referenced Experience, and the display name of the Trip_Member who added the Planned_Item, in accordance with Trips Requirement 9.
4. IF the display name of the Trip_Member who added a Completed_Planned_Item cannot be resolved, THEN THE App SHALL retain that Completed_Planned_Item in the Done_Section and display an attribution indicating that the adding Trip_Member is unavailable rather than omitting the Completed_Planned_Item.
5. THE Trip_Service SHALL retain a Planned_Item when the Planned_Item's Planned_Item_Completion_State becomes `done` and SHALL NOT delete the Planned_Item as a result of any Trip_Log_Entry being created.
6. WHEN a Trip_Log_Entry that causes a Planned_Item to become a Completed_Planned_Item is created, THE Trip_Service SHALL preserve the Planned_Item's referenced Experience and its recorded adding Trip_Member unchanged.
7. THE App SHALL derive the completed presentation of a Planned_Item without creating a Trip-local copy of the referenced Experience or of any canonical Completion.

### Requirement 4: Planned List Progress

**User Story:** As a Trip_Member, I want to see how much of our plan we have completed, so that I can gauge the group's progress at a glance.

#### Acceptance Criteria

1. WHEN the App displays the Planned_List of a Trip, THE App SHALL display the Planned_List_Progress as the count of Completed_Planned_Items out of the total count of Planned_Items in that Trip, presenting both the completed count and the total count as non-negative integers.
2. THE App SHALL compute the completed count within the Planned_List_Progress as the number of Planned_Items whose Planned_Item_Completion_State is `done`, counting each such Planned_Item at most once regardless of how many Trip_Log_Entries in the Trip reference that Planned_Item's Experience.
3. THE App SHALL compute the total count within the Planned_List_Progress as the number of Planned_Items in the Trip's Planned_List, counting each Planned_Item once regardless of its Planned_Item_Completion_State.
4. WHERE a Trip's Planned_List contains zero Planned_Items, THE App SHALL display the Planned_List_Progress with a completed count of 0 and a total count of 0, overriding any other computed count value.
5. WHEN a Trip_Log_Entry changes a Planned_Item's Planned_Item_Completion_State to `done`, THE App SHALL increase the completed count of the Planned_List_Progress by exactly one for that Planned_Item on the next computation of the Planned_List presentation.
6. THE App SHALL compute the completed count of the Planned_List_Progress as a value greater than or equal to 0 and less than or equal to the total count of Planned_Items in that Trip.

### Requirement 5: Trip Summary Planned-Versus-Completed Counts

**User Story:** As a Trip_Member, I want the Trip_Summary to show planned versus completed counts, so that our summary reflects how much of what we planned we accomplished.

#### Acceptance Criteria

1. WHEN a Trip_Member requests a Trip's Trip_Summary through `GET /trips/:id/summary`, THE Trip_Service SHALL include the total count of Planned_Items in the Trip as a non-negative integer.
2. WHEN a Trip_Member requests a Trip's Trip_Summary, THE Trip_Service SHALL include the count of Planned_Items whose referenced Experience matches at least one Trip_Log_Entry in the Trip under the Planned_Completion_Match as a non-negative integer.
3. THE Trip_Service SHALL derive the planned total count and the planned-completed count of the Trip_Summary from Planned_Items and Trip_Log_Entries and SHALL NOT store either count as an independent editable field.
4. WHERE a Trip's Planned_List contains zero Planned_Items, THE Trip_Service SHALL report the planned total count and the planned-completed count of the Trip_Summary as 0, overriding any value produced by the derivation logic.
5. THE Trip_Service SHALL count each Planned_Item at most once toward the planned-completed count of the Trip_Summary regardless of how many Trip_Log_Entries reference that Planned_Item's Experience.
6. THE Trip_Service SHALL report the planned-completed count of the Trip_Summary as a value greater than or equal to 0 and less than or equal to the planned total count of the Trip_Summary.
7. IF a User who is not a Trip_Member of a Trip, or a User requesting a non-existent Trip, requests that Trip's Trip_Summary, THEN THE Trip_Service SHALL withhold the planned total count and the planned-completed count and deny the request with the same authorization response returned for a non-existent Trip, disclosing no information about whether the Trip exists, in accordance with Trips Requirement 14 and Trips Requirement 15.

### Requirement 6: Derivation Placement and Model Preservation

**User Story:** As a maintainer, I want the completion link to stay a derived read-time relationship, so that the existing Trips data model and its guarantees remain intact.

#### Acceptance Criteria

1. THE Trip_Service SHALL derive the linkage between a Planned_Item and a Trip_Log_Entry by matching the referenced Experience within the same Trip under the Planned_Completion_Match and SHALL NOT persist a stored link between a Planned_Item and a Trip_Log_Entry.
2. THE Trip_Service SHALL keep Planned_Item records and Trip_Log_Entry records distinct such that neither record type is converted into or merged with the other when a Planned_Item becomes a Completed_Planned_Item.
3. THE App SHALL compute the Planned_Item_Completion_State and the Planned_List_Progress from data already retrieved for the Trip_Detail_View through the existing `GET /trips/:id/planned-items` and `GET /trips/:id/feed` endpoints.
4. THE Trip_Service SHALL expose the planned-versus-completed counts described in Requirement 5 through the existing `GET /trips/:id/summary` endpoint without introducing an additional summary endpoint.
5. WHEN a canonical Rating is displayed for a Completed_Planned_Item or for a completion logged from a Planned_Item, THE App SHALL retrieve and display the canonical Rating currently referenced from the Tracking_Service on each computation of the display in accordance with Trips Requirement 12 and SHALL NOT store a Trip-local copy of that Rating.
6. WHERE no canonical Rating exists in the Tracking_Service for the referenced Experience of a Completed_Planned_Item or of a completion logged from a Planned_Item, THE App SHALL present that Completed_Planned_Item or completion without a Rating value and SHALL NOT display a substitute or placeholder Rating.
7. IF the App cannot retrieve the canonical Rating from the Tracking_Service when displaying a Completed_Planned_Item or a completion logged from a Planned_Item, THEN THE App SHALL display an indication that the Rating is currently unavailable, SHALL NOT store a Trip-local copy of the Rating, and SHALL leave the referenced Planned_Item and Trip_Log_Entry records unchanged.

### Requirement 7: Authorization for Planned List Completion Sync

**User Story:** As a Trip_Member, I want completion-sync actions and data limited to the Trip's members, so that a Trip's plans and progress stay private to the people on the Trip.

#### Acceptance Criteria

1. WHILE a User has a valid, authenticated session and is a Trip_Member of a Trip, WHEN that User requests the Trip's Planned_List, the derived Planned_Item_Completion_State, the Planned_List_Progress, or the Trip_Summary planned-versus-completed counts, THE Trip_Service SHALL authorize the request and return only data scoped to that Trip, and SHALL NOT include the Planned_List, Planned_Item_Completion_State values, Planned_List_Progress, or Trip_Summary planned-versus-completed counts of any other Trip.
2. IF a User who is not a Trip_Member of a Trip requests that Trip's Planned_List, Planned_Item_Completion_State, Planned_List_Progress, or Trip_Summary planned-versus-completed counts, THEN THE Trip_Service SHALL deny the request with the same authorization response returned for a non-existent Trip, SHALL withhold the Planned_List, the Planned_Item_Completion_State values, the Planned_List_Progress, and the Trip_Summary planned-versus-completed counts, and SHALL disclose no information about whether the Trip exists, in accordance with Trips Requirement 15.
3. IF a User who is not a Trip_Member of a Trip submits a completion logged from a Planned_Item of that Trip, THEN THE Trip_Service SHALL reject the request with the same authorization response returned for a non-existent Trip disclosing no information about whether the Trip exists, SHALL NOT create a Trip_Log_Entry, and SHALL leave every Planned_Item_Completion_State and the Planned_List_Progress of that Trip unchanged, in accordance with Trips Requirement 10.
4. WHILE a User does not have a valid, authenticated session, THE Trip_Service SHALL evaluate the authenticated-session check before the Trip_Member_Rule and SHALL deny each Planned_List completion-sync request with an `unauthorized` error that discloses no information about whether the Trip exists or whether the User is a Trip_Member, in accordance with Trips Requirement 15.
