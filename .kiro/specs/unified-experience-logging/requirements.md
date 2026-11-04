# Requirements Document

## Introduction

Unified Experience Logging merges the two disconnected ways a User records a ride, attraction, or restaurant visit into one flow that is quick, social, and visibly connected to the Trip.

Today there are two flows that do different things:

- **Catalog "Log a visit"** (`LogVisitModal`, opened from the Home dock and FAB, Live Waits, the Experience detail screen, Experience lists, and the Passport cards) records a visit date, optional Rating, and optional note, and has an optional Trip chip with no default. Choosing a Trip writes only a `trip_log_entries` row. It writes no Trip_Feed_Item, so nothing appears in Trip_Activity; it offers no rode-with tagging; and it notifies no one.
- **Trip "Log a completion"** (`LogComposerModal`, opened from the Trip_Activity screen and from each Planned_Item) records an Experience, rode-with tags, optional Rating, and optional note. It writes the Trip_Log_Entry, the pending Rode_With_Tags, and the `completion_logged` Trip_Feed_Item, and notifies tagged Members. It has no visit date (always the WDW current date).

The result is that logging from where a User naturally is (the catalog or live waits) loses the Trip connection, and tagging people is only possible by re-finding the Experience from inside the Trip.

This feature delivers:

1. **One sheet, everywhere.** A single Unified_Log_Sheet is used by every logging entry point, including the Trip screens.
2. **Trip pre-selected, riders one tap away.** The Trip is pre-selected when it is unambiguous; once a Trip is selected the same sheet offers the "Rode with" / "Dined with" member row.
3. **One server write path.** A Trip-linked log from either endpoint creates the same records: Experience_Log, canonical Completion and Rating, Trip_Log_Entry, `completion_logged` Trip_Feed_Item, pending Rode_With_Tags, and tag notifications.
4. **Feedback that closes the loop.** A confirmation toast with a "View in trip" action, refreshed Trip data, the existing Pin celebration, and, for restaurants, an optional "Log what you ate" prompt.
5. **One-tap response for tagged Members** directly on the Trip_Activity card, in addition to the existing Notification Center and deep-link screen.
6. **Repair of existing data** so Trip-linked logs made before this feature also appear in Trip_Activity.

This feature reuses and extends, additively, the following specs: `experience-activity-logging` (Experience_Log and `POST /me/experiences/:id/logs`), `trips` (Trip_Log_Entry, Rode_With_Tag, Trip_Feed_Item, `POST /trips/:id/log-entries`), `planned-list-completion-sync` (the Log_Composer entry from a Planned_Item, which must keep posting to `POST /trips/:id/log-entries`), `food-item-logging` (dish logging, which stays personal), and `pin-collection` (award hook and celebration). Dish-level logging is out of scope for Trip linkage: Food_Item_Logs gain no Trip link in this feature.

## Glossary

Terms reused from other specs, as defined there:

- **App**, **User**, **Trip**, **Trip_Member**, **Trip_Status** (`upcoming` / `active` / `past`), **Trip_Service**, **Trip_Activity**, **Trip_Feed_Item**, **Trip_Log_Entry**, **Rode_With_Tag** (states `pending`, `confirmed`, `declined`, `cancelled`), **Tagged_Member**, **Tagging_Member**, **Planned_Item**, **Trip_Summary** — as defined in the Trips spec (`.kiro/specs/trips/requirements.md`).
- **Experience**, **Catalog**, **Completion**, **Rating**, **Tracking_Service** — as defined in the Trips spec.
- **Experience_Log**, **Visit_History** — as defined in `.kiro/specs/experience-activity-logging/requirements.md`.
- **Log_Composer**, **Planned_Item_Log_Control** — as defined in `.kiro/specs/planned-list-completion-sync/requirements.md`.
- **Food_Item_Log**, **Restaurant_Experience** — as defined in `.kiro/specs/food-item-logging/requirements.md`.
- **Pin**, **Pin_Celebration** — as defined in `.kiro/specs/pin-collection/`.
- **Notification_Center** — the screen that lists pending Rode_With_Tags with one-tap Confirm / Decline.

Terms introduced by this feature:

- **Unified_Log_Sheet**: The single bottom-sheet logging UI used by every logging entry point. It captures a Visit_Date, an optional Rating, an optional note, a Trip_Selection, and (when a Trip is selected) a Riding_With_Row.
- **Log_Draft**: The in-memory state of an open Unified_Log_Sheet: Visit_Date, Rating, note, Trip_Selection, and tagged Member ids. Never persisted.
- **Visit_Date**: The calendar date (`YYYY-MM-DD`) the User says the visit happened. Defaults to today in the device time zone.
- **Active_Trip**: A Trip the caller belongs to whose Trip_Status is `active`, as returned in the `active` group of `GET /me/trips`.
- **Trip_Selection**: Either a Trip id or "No trip" (`null`).
- **Preselected_Trip**: The Trip the Unified_Log_Sheet selects automatically on open under Requirement 2.
- **Locked_Trip**: A Trip fixed by the entry point (opened from Trip_Activity or from a Planned_Item_Log_Control). The User cannot change or clear it.
- **Riding_With_Row**: The row of selectable Trip_Member chips in the Unified_Log_Sheet. Labeled "Rode with", or "Dined with" for a Restaurant_Experience.
- **Linked_Log**: An Experience_Log that has a Trip_Log_Entry (`trip_log_entries.log_id = experience_logs.id`).
- **Trip_Log_Port**: The structural port through which the Tracking_Service's log route delegates a Trip-linked create to the Trip_Service's `logCompletion` (so the Tracking_Service does not import the Trip_Service).
- **Log_Toast**: The transient confirmation message shown after a successful log, hosted once at the app root so it outlives the Unified_Log_Sheet.
- **Dish_Prompt**: The optional "Log what you ate" action on the Log_Toast, shown after logging a Restaurant_Experience.
- **Inline_Tag_Response**: The Confirm / Decline controls shown on a Trip_Activity `completion_logged` card to the Tagged_Member whose Rode_With_Tag is `pending`.
- **Feed_Backfill**: The one-time data migration that creates a `completion_logged` Trip_Feed_Item for every existing Trip_Log_Entry that lacks one.

## Requirements

### Requirement 1: One Log Sheet for Every Entry Point

**User Story:** As a User, I want logging a ride to look and work the same wherever I start it, so that I do not have to learn two different forms.

#### Acceptance Criteria

1. THE App SHALL present the Unified_Log_Sheet for each of these entry points: the Home Log Ride tile and quick-log button, the center action button's Log Ride action, Live Waits per-row logging, the Experience detail "Log a visit" action, the Your Visit card, the Park Passport card, per-row logging in an Experience list, the Trip_Activity "Log a completion" control, and each Planned_Item_Log_Control.
2. THE Unified_Log_Sheet SHALL contain these inputs in this order: Visit_Date, Rating, note, Trip_Selection, and Riding_With_Row (the last only when a Trip is selected, per Requirement 3).
3. THE Unified_Log_Sheet SHALL use one shared Rating selector (whole numbers 1 to 10, tapping the selected value again clears it) and one shared note field (maximum 2000 characters) for all entry points.
4. WHEN the Unified_Log_Sheet is opened from Trip_Activity without a pre-selected Experience, THE App SHALL first present the existing Experience picker and, after the User picks an Experience, present the Unified_Log_Sheet for that Experience.
5. THE App SHALL NOT present a separate, differently-shaped logging form for the same purpose from any entry point listed in criterion 1.

### Requirement 2: Trip Pre-selection and Date Rules

**User Story:** As a User on a trip, I want the app to assume I mean my current trip, so that I do not have to choose it every time.

#### Acceptance Criteria

1. WHEN the Unified_Log_Sheet opens from an entry point that is not Trip-specific, AND the caller has exactly one Active_Trip whose date range contains the Visit_Date, THE App SHALL select that Trip as the Preselected_Trip.
2. WHEN the Unified_Log_Sheet opens from a non-Trip-specific entry point, AND the caller has two or more Active_Trips, THE App SHALL select no Trip (Trip_Selection `null`) and SHALL present each Active_Trip as a chip for the User to choose.
3. WHEN the caller has no Active_Trip, THE Unified_Log_Sheet SHALL omit the Trip_Selection and Riding_With_Row entirely.
4. WHEN the Unified_Log_Sheet opens from Trip_Activity or from a Planned_Item_Log_Control, THE App SHALL set the Trip_Selection to that Trip as a Locked_Trip, SHALL NOT offer the "No trip" chip or other Trip chips, and SHALL show the Trip's name as a non-interactive label.
5. WHEN a Trip is selected and not locked, THE Unified_Log_Sheet SHALL offer a "No trip" chip that sets the Trip_Selection to `null`.
6. WHEN the User changes the Visit_Date to a date outside the selected Trip's inclusive range from `startDate` to `endDate`, THE Unified_Log_Sheet SHALL clear a non-locked Trip_Selection, SHALL clear the tagged Members, and SHALL show a hint that the date is outside the trip.
7. WHILE a Trip is locked, THE Unified_Log_Sheet SHALL restrict the Visit_Date picker to the inclusive intersection of the Trip's date range and dates not later than today.
8. WHILE a non-locked Trip is selected, THE Unified_Log_Sheet SHALL restrict the Visit_Date picker to dates not later than today and SHALL apply criterion 6 on change.
9. WHEN the User changes the Trip_Selection to a different Trip or to `null`, THE Unified_Log_Sheet SHALL clear the tagged Members.
10. IF a locked Trip's Trip_Status is `upcoming`, THEN THE App SHALL NOT open the Unified_Log_Sheet from that Trip's logging controls and SHALL instead show a message that logging opens when the trip starts.

### Requirement 3: Riding With, in the Same Sheet

**User Story:** As a User, I want to tag the people I rode with while I log, so that the ride shows up for the whole group.

#### Acceptance Criteria

1. WHILE a Trip is selected, THE Unified_Log_Sheet SHALL show the Riding_With_Row listing every current Trip_Member of that Trip except the caller, each as a toggle chip showing the Member's display name, with a selected state that is not conveyed by color alone.
2. WHEN the experience being logged is a Restaurant_Experience (category `Restaurant`), THE Unified_Log_Sheet SHALL label the Riding_With_Row "Dined with"; otherwise THE Unified_Log_Sheet SHALL label it "Rode with".
3. IF the selected Trip has no other Trip_Member, THEN THE Unified_Log_Sheet SHALL show the text "No other members to tag yet. You can still log this on your own." in place of the chips.
4. WHEN the User taps a chip, THE Unified_Log_Sheet SHALL toggle that Member's tag selection without changing any other input.
5. WHILE no Trip is selected, THE Unified_Log_Sheet SHALL NOT show the Riding_With_Row and SHALL submit no tagged Members.
6. WHILE the Trip_Members of the selected Trip have not loaded, THE Unified_Log_Sheet SHALL show a loading indicator in the Riding_With_Row and SHALL still allow submitting with no tags.
7. IF the Trip_Members of the selected Trip fail to load, THEN THE Unified_Log_Sheet SHALL show an inline retry control in the Riding_With_Row and SHALL still allow submitting with no tags.

### Requirement 4: Fast Defaults

**User Story:** As a User standing in a queue, I want to log a ride in two taps, so that logging is something I actually do.

#### Acceptance Criteria

1. THE Unified_Log_Sheet SHALL default the Visit_Date to today in the device time zone and SHALL display it as a single "Today" row that expands to the date picker only when tapped.
2. THE Unified_Log_Sheet SHALL display the note as a collapsed "Add a note" row that expands to the text field only when tapped, and SHALL expand it automatically if it already contains text.
3. THE Unified_Log_Sheet SHALL enable the submit control with no input beyond opening the sheet, so a log with today's date, no Rating, no note, and the Preselected_Trip (if any) can be submitted with one tap.
4. WHEN the Unified_Log_Sheet is opened with a Preselected_Trip and the User taps submit without changing anything, THE App SHALL submit the log linked to that Trip with no tagged Members.
5. WHILE a submit request is in flight, THE Unified_Log_Sheet SHALL disable every input and the submit control and SHALL show a busy indicator.
6. WHEN the Unified_Log_Sheet is closed or a submit succeeds, THE App SHALL discard the Log_Draft so a later open starts from the defaults in this Requirement and Requirement 2.

### Requirement 5: Single Server Write Path for Trip-Linked Logs

**User Story:** As a User, I want a ride I log to a trip to behave identically no matter which screen I logged it from, so that the trip is never missing my ride.

#### Acceptance Criteria

1. THE Tracking_Service SHALL accept an optional `rodeWith` list of Trip_Member user ids in the body of `POST /me/experiences/:id/logs`, in addition to the existing `visitedOn`, `userTz`, `rating`, `note`, and `tripId`.
2. WHEN `POST /me/experiences/:id/logs` carries a `tripId`, THE system SHALL create all of: the Experience_Log (with `visitedOn`, `userTz`, Rating and note), the caller's canonical Completion (without duplicating an existing one), the canonical Rating when supplied (emitting `RatingChanged`), the Trip_Log_Entry, one `completion_logged` Trip_Feed_Item whose metadata carries `experienceId` and `logEntryId`, and one `pending` Rode_With_Tag per distinct tagged Member.
3. WHEN `POST /trips/:id/log-entries` is called with the same Experience, date, Rating, note, and `rodeWith` as a `POST /me/experiences/:id/logs` call carrying that Trip's id, THE system SHALL produce the same persisted records (same tables, same column values other than generated ids and timestamps) as the other call.
4. THE system SHALL implement criteria 2 and 3 with one shared server code path (the Trip_Service's `logCompletion`) so the two endpoints cannot diverge.
5. THE Tracking_Service SHALL reach that path only through the Trip_Log_Port, and SHALL NOT import the Trip_Service.
6. THE Trip_Service SHALL accept optional `visitedOn` (`YYYY-MM-DD`) and `userTz` (IANA zone) in the body of `POST /trips/:id/log-entries` and SHALL use them as the Completion date and time zone; WHEN they are absent THE Trip_Service SHALL behave exactly as before this feature (WDW current date, default zone).
7. WHEN a Trip-linked create commits, THE system SHALL dispatch one `RodeWithTagCreatedNotice` per created `pending` Rode_With_Tag on the existing fire-and-forget port, from either endpoint, and a notification failure SHALL NOT fail or delay the response.
8. WHEN a Trip-linked create commits, THE system SHALL evaluate Pin awards for the caller and return `newlyAwardedPinIds` in the response, from either endpoint.
9. THE response of `POST /me/experiences/:id/logs` SHALL keep every existing field and, WHEN the request carried a `tripId`, SHALL additionally include `tripLog: { tripId, logEntryId, taggedCount }`.
10. WHEN `POST /me/experiences/:id/logs` carries no `tripId`, THE Tracking_Service SHALL behave exactly as before this feature: no Trip_Log_Entry, no Trip_Feed_Item, no Rode_With_Tag.
11. IF `POST /me/experiences/:id/logs` carries a non-empty `rodeWith` and no `tripId`, THEN THE Tracking_Service SHALL reject the request with `validation_failed` and SHALL write nothing.

### Requirement 6: Validation, Authorization, and No Partial State

**User Story:** As a Trip_Member, I want a rejected log to leave no trace, and I want non-members to be unable to write into my trip.

#### Acceptance Criteria

1. IF the caller is not a current Trip_Member of the `tripId`, or the Trip does not exist, THEN THE system SHALL reject a Trip-linked create from either endpoint with the same `trip_forbidden` response, disclosing nothing about whether the Trip exists.
2. IF the caller's session is missing or invalid, THEN THE system SHALL reject with `unauthorized` before evaluating membership or Trip existence.
3. IF `rodeWith` contains the caller, a duplicate id, or a user who is not a current Trip_Member of the Trip, THEN THE system SHALL reject with `trip_validation_failed` (field `rodeWith`).
4. IF `visitedOn` is later than today in `userTz`, THEN THE system SHALL reject a Trip-linked create from either endpoint with `log_future_date`.
5. IF a Trip-linked create supplies an explicit `visitedOn` outside the Trip's inclusive range from `startDate` to `endDate`, THEN THE system SHALL reject it with the new error code `log_outside_trip_dates` (HTTP 400, field `visitedOn`).
6. WHEN `POST /trips/:id/log-entries` is called without `visitedOn`, THE system SHALL NOT apply the date-range check of criterion 5, preserving existing behavior.
7. WHEN a request is rejected under criteria 1 to 5, THE system SHALL create no Experience_Log, Completion, Rating, Trip_Log_Entry, Trip_Feed_Item, or Rode_With_Tag.
8. WHEN a request fails at the client because the network is unavailable, THE Unified_Log_Sheet SHALL remain open with the Log_Draft intact and SHALL show a retryable error message.
9. THE Unified_Log_Sheet SHALL map `trip_forbidden`, `trip_validation_failed`, `log_future_date`, `log_outside_trip_dates`, `rating_out_of_range`, and `note_length_invalid` to specific inline messages and SHALL keep the sheet open.

### Requirement 7: Success Feedback, Refresh, and Pin Celebration

**User Story:** As a User, I want a clear, friendly confirmation that my ride landed in the trip, so that logging feels rewarding.

#### Acceptance Criteria

1. WHEN a log succeeds, THE App SHALL close the Unified_Log_Sheet and show the Log_Toast at the app root.
2. THE Log_Toast SHALL read "<Experience name> logged" when no Trip was linked, and "<Experience name> logged to <Trip name>" when a Trip was linked, appending " with <names>" listing the tagged Members' display names (at most two names, then "and N more") when any were tagged.
3. WHEN a Trip was linked, THE Log_Toast SHALL include a "View in trip" action that navigates to that Trip's Trip_Activity screen (the `TripFeed` route in the Trips stack, seeded under `TripDetail`).
4. THE Log_Toast SHALL dismiss itself after 6 seconds, or after 8 seconds when the Dish_Prompt is shown, and SHALL be replaced (not stacked) by a newer Log_Toast.
5. WHEN a log succeeds, THE App SHALL invalidate and refetch every cached read that the new log can change: the Experience's visit history, completion, rating, and aggregate reads; `['me-stats']`; the Trips list; and, when a Trip was linked, that Trip's feed, summary, and planned-items reads (`['trips','feed',tripId]`, `['trips',tripId,'summary']`, `['trips',tripId,'planned-items']`).
6. WHEN the success response contains one or more `newlyAwardedPinIds`, THE App SHALL present the existing Pin_Celebration for those ids after closing the sheet.
7. THE Log_Toast SHALL be hosted once at the application root so entry points need no per-screen toast code, and a success from any entry point SHALL produce the same toast.

### Requirement 8: Dish Prompt After a Restaurant Visit

**User Story:** As a User who just logged a restaurant visit, I want an easy way to record what I ate, so that my dish history stays complete.

#### Acceptance Criteria

1. WHEN a log succeeds for an Experience whose category is `Restaurant`, THE Log_Toast SHALL show a "Log what you ate" action.
2. WHEN the User taps "Log what you ate", THE App SHALL open the existing dish picker (`FoodItemPickerModal`) scoped to that Restaurant_Experience and, after a dish is chosen, the existing `LogFoodItemModal`.
3. THE App SHALL NOT show the Dish_Prompt for an Experience whose category is not `Restaurant`.
4. THE dish picker and dish log opened from the Dish_Prompt SHALL behave exactly as when opened from the Experience detail screen; Food_Item_Logs SHALL NOT gain a Trip link and SHALL NOT create Trip_Feed_Items or Rode_With_Tags.
5. WHEN the User ignores the Dish_Prompt, THE App SHALL perform no further action.

### Requirement 9: Inline Rode-With Response on the Activity Card

**User Story:** As a tagged Member, I want to confirm or decline right on the trip's activity card, so that I do not have to open a separate screen.

#### Acceptance Criteria

1. WHEN the Trip_Activity feed read is made for a caller who is the Tagged_Member of a `pending` Rode_With_Tag on a `completion_logged` item, THE Trip_Service SHALL include that tag's `tagId` in the item's `rodeWith` entry for that tag.
2. THE Trip_Service SHALL NOT include a `tagId` for any Rode_With_Tag whose Tagged_Member is not the caller, nor for any non-`pending` tag.
3. WHEN a `completion_logged` card contains a `rodeWith` entry with a `tagId`, THE App SHALL show Confirm and Decline controls on that card.
4. WHEN the Tagged_Member taps Confirm, THE App SHALL call the existing `POST /me/rode-with-tags/:tagId/confirm` with an empty body (no Rating), and WHEN they tap Decline THE App SHALL call the existing `POST /me/rode-with-tags/:tagId/decline`.
5. WHEN a Confirm or Decline succeeds, THE App SHALL refetch that Trip's feed and summary and `['me-stats']`, and the card SHALL show the tag's new state without the controls.
6. IF a Confirm or Decline fails, THEN THE App SHALL keep the controls, show an inline error on the card, and SHALL NOT change the displayed tag state.
7. THE existing Notification_Center actions and the `RodeWithConfirm` deep-link screen (which also offers an optional Rating) SHALL continue to work unchanged.
8. THE confirm-before-write rule SHALL be unchanged: a Tagged_Member's own canonical Completion changes only on Confirm.

### Requirement 10: Planned List and Summary Consistency

**User Story:** As a Trip_Member, I want a ride I logged from the catalog to tick off the plan and count in the summary, so that all the trip's screens agree.

#### Acceptance Criteria

1. WHEN a Trip-linked log succeeds for an Experience that is a Planned_Item of that Trip, THE App SHALL derive that Planned_Item as `done` on the next computation of the Planned_List presentation, using the existing `Planned_Completion_Match`.
2. WHEN a Trip-linked log succeeds, THE Trip_Summary planned-completed count and total logged count SHALL include the new Trip_Log_Entry on the next `GET /trips/:id/summary`.
3. THE feature SHALL add no new derived or stored field to Planned_Item, and SHALL NOT change `derivePlannedListPresentation`, `derivePlannedCounts`, or `deriveTripSummary`.

### Requirement 11: Deleting a Trip-Linked Log

**User Story:** As a User, I want deleting a ride from my visit history to remove it from the trip too, so that no ghost entries remain.

#### Acceptance Criteria

1. WHEN a User deletes a Linked_Log with `DELETE /me/experiences/:id/logs/:logId`, THE system SHALL also remove that log's Trip_Log_Entry, its Rode_With_Tags, its `completion_logged` Trip_Feed_Item, and the Trip_Reactions and Trip_Comments attached to that Trip_Feed_Item.
2. THE system SHALL leave every other Trip_Log_Entry, Trip_Feed_Item, reaction, and comment unchanged.
3. THE existing rules for removing the canonical Completion (only when the deleted log was the last for that Experience) and for never touching the Rating SHALL be unchanged.
4. WHEN a Linked_Log is deleted from the Trip side (`DELETE /trips/:id/log-entries/:logEntryId`), THE existing behavior SHALL be unchanged.
5. WHEN the deleted log has no Trip_Log_Entry, THE route SHALL behave exactly as before this feature.

### Requirement 12: Backfill of Existing Linked Logs

**User Story:** As a User who already logged rides to a trip from the catalog, I want those rides to appear in the trip's activity, so that my past logs are not stranded.

#### Acceptance Criteria

1. THE Feed_Backfill SHALL, for every existing Trip_Log_Entry that has no `completion_logged` Trip_Feed_Item referencing its id in `metadata.logEntryId`, insert one `completion_logged` Trip_Feed_Item with `trip_id` = the entry's Trip, `actor_id` = the entry's `member_id`, `metadata` = `{ "experienceId": <entry experience_id>, "logEntryId": <entry id> }`, and `created_at` = the entry's `created_at`.
2. THE Feed_Backfill SHALL be idempotent: running it again SHALL insert no additional Trip_Feed_Item.
3. THE Feed_Backfill SHALL NOT modify or delete any existing row, SHALL NOT create Rode_With_Tags, and SHALL NOT send notifications.
4. THE Feed_Backfill SHALL be delivered as a new sequential migration and SHALL NOT edit any previously applied migration.

### Requirement 13: Contract Preservation

**User Story:** As a maintainer, I want this change to be additive, so that no other feature breaks.

#### Acceptance Criteria

1. THE feature SHALL add no new HTTP endpoint.
2. THE Log_Composer opened from Trip_Activity or from a Planned_Item_Log_Control SHALL submit to the existing `POST /trips/:id/log-entries` (preserving `planned-list-completion-sync` Requirement 1.4), and every other entry point SHALL submit to `POST /me/experiences/:id/logs`.
3. THE `LogVisitModal` module SHALL keep its default export and its props (`experienceId`, `visible`, `onClose`, `onLogged`) so existing call sites compile unchanged.
4. THE `LogComposerModal` export of the Trip_Activity screen SHALL keep its props so `TripPlannedListScreen` compiles unchanged.
5. THE existing `testID` prefixes `log-visit` (non-Trip entry points) and `activity-log` (Trip entry points) SHALL be preserved for inputs that exist in both the old and new forms (rating tiles, note input, cancel, submit, member chips).
6. THE legacy Trip-link branch inside the Tracking_Service's `addLog` SHALL no longer be reachable from the serving route when the Trip_Log_Port is wired (a structural test pins this).

### Requirement 14: Accessibility and Theming

**User Story:** As a User with accessibility needs or a dark-mode device, I want the logging sheet to be usable and legible, so that I can log rides comfortably.

#### Acceptance Criteria

1. THE Unified_Log_Sheet SHALL give every interactive control an accessibility role and label, and SHALL expose selected state for Rating tiles, Trip chips, and Riding_With chips through accessibility state in addition to visual styling.
2. THE Unified_Log_Sheet, Log_Toast, and Inline_Tag_Response controls SHALL take all colors from the active theme (`makeStyles` / `useAppTheme` / `*.palette.ts`) and SHALL pass the repository's theme guard test.
3. THE Log_Toast SHALL be announced to screen readers when shown and its "View in trip" and "Log what you ate" actions SHALL be reachable by assistive technology.
4. THE Unified_Log_Sheet SHALL keep the focused text input visible above the keyboard on iOS and Android, as `LogVisitModal` does today.
