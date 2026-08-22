# Requirements Document

## Introduction

The Trip Reservations feature gives a Trip a single place to see every real booking the group holds — dining reservations, Lightning Lane return windows, and other timed bookings such as tours, cabanas, or dessert parties — and makes those bookings flow into the Schedule Builder with no synchronization step.

The central design decision is that a **Reservation is not a new entity**. A Reservation is an existing `planned_items` row that carries a non-null `reservation_kind` plus optional booking metadata (confirmation number, party size). The scheduling model already supports exactly the two timing shapes a booking needs: an exact pinned time (`is_fixed = true` + `planned_time`, used by dining and timed activities) and a return window (`is_lightning_lane = true` + `planned_time`, used by Lightning Lane). Modelling a Reservation as a facet of a Planned_Item means the Schedule Builder and the Optimization_Engine pick it up for free, and there is exactly one row — so a Reservation and its scheduled item can never drift apart.

This feature **depends on the Trips feature** (`.kiro/specs/trips`), which owns `planned_items`, the Planned_Item routes, the membership gate, and the Trip Detail hub; and on the **Day Planning and Wait Time Optimization feature** (`.kiro/specs/day-planning-optimization`), which owns the timing modes, the Schedule Builder screen, and the Optimization_Engine. It adds no new external data source and no background work.

It also closes one defect that only becomes visible once a pinned time represents a real-world booking: the optimizer currently writes its simulated arrival back over `planned_time` for every item it schedules, including fixed ones, so an unreachable 6:00 PM booking could be silently rewritten to 6:12 PM. A booked time is a fact about the world and must survive optimization (Requirement 4).

## Glossary

- **Reservation**: A Planned_Item with a non-null `Reservation_Kind`, representing a booking the group actually holds. A Planned_Item with `reservation_kind = NULL` is an ordinary planned item, even if it has a pinned time.
- **Reservation_Kind**: The closed vocabulary `dining`, `lightning_lane`, `activity`, `other`. It records *what kind of booking* this is, which is distinct from `is_lightning_lane` / `is_fixed`, which record *how the optimizer should time it*.
- **Confirmation_Number**: The free-text booking reference Disney issues (≤ 40 characters), stored so a member can read it off at the podium.
- **Party_Size**: How many guests the booking covers (1–50). Display and reference only; it does not feed the Optimization_Engine.
- **Booked_Time**: The `planned_time` of a Reservation — the time the guest is actually expected. For every kind except `lightning_lane` it is an exact arrival; for `lightning_lane` it is the start of the return window.
- **Reservations_Screen**: The new mobile screen listing every Reservation on a Trip, grouped by date.
- **Schedule_Builder**: The existing `TripScheduleScreen`, which renders one trip date's timeline and runs the optimizer.
- **Optimization_Engine**: The existing `services/planning/optimizer.ts`, consumed unchanged by this feature.
- **Non_Catalog_Reservation**: A Reservation whose venue is not in the Catalog (e.g. an off-property restaurant), carried as `experience_id = NULL` with a Custom_Title.

## Requirements

### Requirement 1: Reservation as a Planned_Item Facet

**User Story:** As a Trip_Member, I want my bookings stored as the same records the schedule uses, so that a reservation and its place in my day can never disagree.

#### Acceptance Criteria

1. THE Trip_Service SHALL represent a Reservation as a `planned_items` row carrying a non-null `reservation_kind`, and SHALL NOT introduce a separate reservations table, join table, or duplicate scheduled row.
2. THE Reservation_Kind vocabulary SHALL be exactly `dining`, `lightning_lane`, `activity`, `other`, enforced by both a shared Zod enum and a database `CHECK` constraint.
3. THE Trip_Service SHALL treat a Planned_Item whose `reservation_kind` is `NULL` as an ordinary planned item and SHALL NOT list it on the Reservations_Screen, even when it has a pinned `planned_time`.
4. THE Trip_Service SHALL persist an optional Confirmation_Number of at most 40 characters and an optional Party_Size between 1 and 50 on a Reservation.
5. WHEN a Reservation is created, THE Trip_Service SHALL require both a `planned_date` and a `planned_time`, and SHALL reject a request missing either with `trip_validation_failed`.
6. IF a request would clear the `planned_date` or `planned_time` of a Planned_Item whose `reservation_kind` is non-null, THEN THE Trip_Service SHALL reject it with `trip_validation_failed` and SHALL leave the stored item unchanged.
7. WHERE `reservation_kind = 'lightning_lane'`, THE Trip_Service SHALL store the row with `is_lightning_lane = true` and `is_fixed = false` so that `planned_time` is read as the return-window start; WHERE `reservation_kind` is any other non-null value, it SHALL store the row with `is_fixed = true` and SHALL NOT set a soft window or meal period from the same request.

### Requirement 2: Reservations Screen

**User Story:** As a Trip_Member, I want one screen listing every booking on the Trip in date order, so that I can see what we are committed to without paging through each day.

#### Acceptance Criteria

1. WHEN a Trip_Member opens the Reservations_Screen, THE Mobile_App SHALL list every Reservation on the Trip grouped by `planned_date` ascending, and ordered by `planned_time` ascending within each date group.
2. THE Reservations_Screen SHALL show, for each Reservation, its Booked_Time in `America/New_York`, its title (Experience name or Custom_Title), its Park when known, its Reservation_Kind, its Party_Size when set, its Confirmation_Number when set, and the display name of the Trip_Member who added it.
3. THE Reservations_Screen SHALL convey Reservation_Kind with both an icon and a text label, and SHALL NOT rely on color alone to distinguish kinds.
4. IF the Trip holds no Reservations, THEN THE Reservations_Screen SHALL render an Empty_State that invites the member to add one, and SHALL NOT render an empty date group.
5. WHEN a Trip_Member taps a Reservation row, THE Mobile_App SHALL open the edit and details view for that Reservation.
6. THE Trip Detail hub SHALL present a Reservations section that opens the Reservations_Screen for that Trip.
7. WHERE a Reservation's date falls outside the Trip's start–end range, THE Reservations_Screen SHALL still list it under its own date group rather than hiding it.

### Requirement 3: Create, Edit, and Remove a Reservation

**User Story:** As a Trip_Member, I want to record a booking with its time, party size, and confirmation number, so that the group has the details on hand and the schedule plans around it.

#### Acceptance Criteria

1. WHEN a Trip_Member submits the add-reservation form, THE Mobile_App SHALL send `POST /trips/:id/planned-items` with `reservationKind`, `plannedDate`, `plannedTime`, and any supplied `confirmationNumber` and `partySize`, and SHALL NOT call a separate reservations endpoint.
2. WHERE the chosen Reservation_Kind is `dining`, THE add-reservation experience picker SHALL restrict Catalog choices to experiences whose `category` is `Restaurant`.
3. WHERE the chosen Reservation_Kind is `lightning_lane`, THE add-reservation experience picker SHALL restrict Catalog choices to ride-like experiences and SHALL exclude restaurants.
4. WHEN a Trip_Member edits a Reservation, THE Mobile_App SHALL send `PATCH /trips/:id/planned-items/:itemId` with only the changed fields, and THE Trip_Service SHALL apply them under the Requirement 1 rules.
5. WHEN a Trip_Member removes a Reservation, THE Mobile_App SHALL send `DELETE /trips/:id/planned-items/:itemId`, and THE Trip_Service SHALL apply the existing adder-or-organizer removal rule unchanged.
6. IF a request supplies a `partySize` outside 1–50, a `confirmationNumber` longer than 40 characters, or a `reservationKind` outside the vocabulary, THEN THE Trip_Service SHALL reject it with `trip_validation_failed` and SHALL persist nothing.
7. WHEN a Reservation is created or edited, THE Trip_Service SHALL clear that item's persisted optimization result so the timeline shows it as not yet optimized, consistent with the existing Planned_Item edit behavior.
8. WHEN a Trip_Member sets a Reservation's Booked_Time, THE Mobile_App SHALL present a Time_Picker offering discrete hour, minute, and AM/PM selections, and SHALL NOT accept a free-text time entry for a Reservation.
9. THE Time_Picker SHALL offer minutes in 5-minute increments, so that a booking on a non-quarter-hour boundary (e.g. 6:25 PM) is representable.
10. WHEN the Time_Picker is opened for an existing Reservation, THE Mobile_App SHALL preselect that Reservation's current Booked_Time rendered in park-local time.
11. IF no time has been selected for a new Reservation, THEN THE Mobile_App SHALL NOT submit the form and SHALL indicate that a time is required.
12. THE Mobile_App SHALL convert the selected park-local hour, minute, and AM/PM into a UTC instant before submitting, so that a selected afternoon time can never be submitted as its morning counterpart.
13. WHEN the add-reservation venue picker is shown, THE Mobile_App SHALL present Destination filter chips covering each theme park, each water park, Disney Springs, and Resorts, so a Trip_Member can narrow to where the booking actually is.
14. THE Destination filter SHALL default to no destination selected, so that no venue is hidden until the Trip_Member chooses to narrow.
15. WHERE a Destination filter is applied, THE Mobile_App SHALL scope the Catalog request to that Destination in addition to the Reservation_Kind's category restriction, so the two filters compose rather than override one another.

### Requirement 4: Automatic Schedule Integration

**User Story:** As a Trip_Member, I want a booking I record to appear in the Schedule Builder for that day automatically, so that I never have to enter it twice or keep two copies in step.

#### Acceptance Criteria

1. WHEN a Reservation exists on a date, THE Schedule_Builder SHALL render it in that date's timeline with no synchronization, import, or materialization step, because the Reservation and the scheduled item are the same record.
2. THE Optimization_Engine SHALL treat a Reservation whose kind is not `lightning_lane` as a Fixed_Item, and a `lightning_lane` Reservation as a return window, using its existing rules with no engine change.
3. THE Schedule_Builder timeline SHALL badge a Reservation with its Reservation_Kind so a real booking is visually distinguishable from a time the member merely pinned themselves.
4. WHEN the optimizer persists its results, THE Trip_Service SHALL leave a Reservation's `planned_time` exactly as booked, and SHALL persist only that item's predicted wait, travel leg, and `optimized_at`.
5. IF the optimized timeline cannot reach a Reservation by its Booked_Time, THEN THE Schedule_Builder SHALL surface the existing `infeasible_fixed_gap` or `expired_lightning_lane` warning, and THE stored Booked_Time SHALL remain unchanged.
6. WHEN a Reservation is removed, THE Schedule_Builder SHALL no longer render it on that date, with no second delete required.

### Requirement 5: Non-Catalog Reservations

**User Story:** As a Trip_Member, I want to record a booking at a place the app does not know about, so that an off-property dinner still blocks out my evening.

#### Acceptance Criteria

1. WHERE a Reservation's venue is absent from the Catalog, THE Trip_Service SHALL accept `experienceId = null` together with a Custom_Title and `itemType = 'break'`, and SHALL NOT widen the `item_type` vocabulary.
2. THE Reservations_Screen and THE Schedule_Builder SHALL label a Non_Catalog_Reservation by its Reservation_Kind and Custom_Title, and SHALL NOT present it to the user as a break.
3. THE Optimization_Engine SHALL continue to treat a Non_Catalog_Reservation as travel-neutral with zero queue wait, per its existing unlocated-break handling.
4. IF a Reservation is submitted with neither an `experienceId` nor a Custom_Title, THEN THE Trip_Service SHALL reject it with `trip_validation_failed`.

### Requirement 6: Authorization and Visibility

**User Story:** As a Trip_Member, I want our booking details shared with the group but with nobody else, so that anyone in the party can check in and no outsider can read our confirmation numbers.

#### Acceptance Criteria

1. THE Trip_Service SHALL gate every Reservation read and write behind the existing Trip membership check, and SHALL collapse a non-member caller or an unknown Trip to `trip_forbidden` so Trip existence cannot be probed.
2. THE Trip_Service SHALL make Confirmation_Number and Party_Size visible to every Trip_Member of that Trip, and SHALL NOT include them in any payload that is not membership-gated, including the Trip feed, the Trip summary, and any shared or public surface.
3. THE Trip_Service SHALL apply the existing adder-or-organizer rule to Reservation removal, rejecting a non-adding `member` with `trip_forbidden` and leaving the Reservation in place.
4. THE Trip_Service SHALL NOT require a new Trip_Action, because Reservations are shared Planned_List data governed by the existing Planned_Item authorization.

### Requirement 7: Contract Integrity

**User Story:** As a developer, I want the reservation fields defined once, so that the API and the app cannot drift.

#### Acceptance Criteria

1. `PlannedItemDTO` SHALL carry `reservationKind`, `confirmationNumber`, and `partySize`, defined in `@dwt/shared` and imported by both `apps/api` and `apps/mobile`.
2. THE existing `PlannedItemDTO` field-set guard test SHALL be widened to include exactly those three new field names, and SHALL continue to forbid a persisted completion field.
3. THE Reservation_Kind vocabulary SHALL be declared once as a shared constant and reused by the Zod schema, the mobile UI, and the migration's `CHECK` constraint text.
