# Requirements Document

## Introduction

The Trip Booking Timeline feature adds three things to the Trip Hub: an automated timeline of the dates and times at which Walt Disney World booking windows open for a Trip, push reminders tied to those dates, and a collaborative packing list.

Disney opens its two most competitive booking windows relative to a guest's arrival: Advance Dining Reservations open 60 days before arrival at 6:00 AM Eastern, and Lightning Lane selections open 7 days before check-in for Disney Resort hotel guests, or 3 days before the ticket start date for everyone else, at 7:00 AM Eastern. Missing a window by an hour can cost a group its first-choice restaurant. Today the Trip carries only a start date and an end date, so each member computes these dates by hand. This feature derives them from the Trip, shows them as a countdown timeline, and reminds the group before each window opens.

Three design decisions shape the feature:

- **The timeline is derived, never stored.** Drop dates are a pure function of the Trip's arrival date, its stay type, and a declarative rules table. Nothing about a window's date is persisted, so editing a Trip's dates can never leave a stale timeline behind. Only user choices are persisted: a stay-type and check-in override, a per-window "done" mark, and a per-member reminder mute.
- **Reminders are stateless to schedule and idempotent to send.** There is no scheduled-job table to reschedule when dates change. On each authenticated Reminder_Cron tick, the Reminder_Runner recomputes which reminders are due from current Trip data and claims each one in a small ledger before sending, so overlapping or repeated ticks cannot double-send and a date edit simply produces new reminder keys. The Reminder_Cron is a dedicated scheduled job, separate from the existing Keep_Alive_Cron, because every reminder pass queries Trips from the Neon database and a call every 10 minutes would keep Neon awake for about 19 hours a day (about 580 hours against a free-tier ceiling of about 400 CU-hours). Reminders fire only at fixed WDW_Calendar wall-clock times (06:00, 07:00, 20:00, and 09:00 when the `week` lead is enabled), so a schedule of a few calls per day is enough. This fits the hosting constraints: no always-on worker, a `202` fast reply, async in-process work, and no Redis commands.
- **Delivery reuses existing infrastructure.** Reminders go out through the existing Notification_Service and Push_Service, gated by the existing master push preference. They are informational, not pending actionable items, so they are not Attention_Items in the Notification_Center and do not change that feature's requirements.

The packing list is a new Trip-owned shared checklist. It reuses the Trip membership gate and extends the `permissions.ts` role/action matrix with new actions rather than inventing authorization.

This feature **depends on the Trips feature** (`.kiro/specs/trips`), which owns the Trip, Trip_Membership, Trip_Role, the Trip_Resort_Stay, the Trip_Detail_View hub, and the `permissions.ts` matrix; it **reads the Reservations of the `trip-reservations` feature** for an informational booked count; and it **reuses the push infrastructure and tap-routing conventions of the `notification-center` feature** (see Cross-Spec Dependencies and Build Order). It adds no new external data source: the booking rules are a versioned constant table, not a runtime fetch.

The following are explicitly out of scope for v1: booking or purchasing anything on a member's behalf, reading a member's My Disney Experience account, booking windows other than Advance Dining and Lightning Lane (room booking, ticket purchase, virtual queues, and mobile-order windows are not modelled), per-member ticket-type rules for off-site guests (a multi-day ticket is assumed), real-time collaborative editing of the packing list, packing-list change notifications, and reminders delivered by any channel other than push.

## Glossary

- **Trip_Service**: The existing backend component that owns Trips, Trip_Memberships, and Trip authorization (`trips` feature).
- **Booking_Timeline_Service**: The new backend service in `apps/api/src/services/tripBooking/` that owns the Booking_Timeline read, Booking_Settings, Window_Done_Marks, Reminder_Mutes, the Reminder_Runner, the Reminder_Ledger, and the Packing_List. Its pure modules (rules, timeline derivation, reminder derivation, reminder composition) perform no I/O.
- **Mobile_App**: The React Native client that hosts the Booking_Timeline_Screen and the Packing_List_Screen.
- **Notification_Service**: The existing backend component that composes and sends push notifications through the Push_Service (`notification-center` and `social-sharing-loop` infrastructure).
- **Push_Service**: The existing component that delivers push notifications to a User's registered devices and carries a routing-only data payload.
- **Trip**, **Trip_Member**, **Trip_Role**, **Organizer**, **Member**, **Trip_Start_Date**, **Trip_End_Date**, **Trip_Detail_View**, **Trip_Resort_Stay**: As defined by the `trips` feature.
- **Reservation**: A Planned_Item with a non-null `reservation_kind`, as defined by the `trip-reservations` feature.
- **WDW_Calendar**: The `America/New_York` calendar date and wall-clock time used by `wdwClock.ts`. Every date and time in this feature is interpreted in WDW_Calendar unless stated otherwise, and every persisted or transmitted instant is a UTC `TIMESTAMPTZ` or ISO-8601 UTC string.
- **Stay_Type**: One of `resort`, `partner_hotel`, or `offsite`. `resort` means the party holds a Disney Resort hotel reservation; `partner_hotel` means an eligible non-Disney-owned hotel (for example the Walt Disney World Swan and Dolphin or Shades of Green) that receives resort-guest Lightning Lane timing but not resort-guest dining timing; `offsite` means any other lodging.
- **Lightning_Lane_Timing**: How the `lightning_lane` windows open, independent of Stay_Type. One of `seven_day` (one shared drop 7 days before the Arrival_Date covering the first 14 Stay_Dates, with later Stay_Dates sharing a drop 3 days before the Arrival_Date), `three_day` (one shared drop 3 days before the Arrival_Date covering every Stay_Date, as for a multi-day date-based ticket), or `three_day_daily` (each Stay_Date opens on its own 3 days before that date, as for a day-by-day ticket or annual pass). It exists because a party staying on property may still be limited to the 3-day window by the passes its members hold.
- **Arrival_Date**: The WDW_Calendar date from which every window offset is measured. It equals the Check_In_Override when a valid one is stored, and otherwise equals the Trip_Start_Date.
- **Check_In_Override**: An optional date stored in Booking_Settings that replaces the Trip_Start_Date as the Arrival_Date when the Disney Resort check-in precedes the first planned park day. It is valid only when it falls on or after 30 days before the Trip_Start_Date and on or before the Trip_Start_Date.
- **Stay_Dates**: Every WDW_Calendar date from the Arrival_Date through the Trip_End_Date inclusive.
- **Window_Kind**: One of `dining` (Advance Dining Reservations and other experiences that open on the dining schedule) or `lightning_lane` (Lightning Lane Multi Pass, Single Pass, and Premier Pass selections).
- **Booking_Rules**: The declarative table, declared once in `@dwt/shared`, that gives for each Window_Kind and Stay_Type the offset in days, the Drop_Time, and the Resort_Cover_Days. It carries an integer `BOOKING_RULES_VERSION`.
- **Drop_Time**: The WDW_Calendar wall-clock time at which a window opens: 06:00 for `dining`, 07:00 for `lightning_lane`.
- **Resort_Cover_Days**: The number of Stay_Dates, counted from the Arrival_Date, that a single resort-guest drop covers: 10 for `dining` and 14 for `lightning_lane`.
- **Booking_Window**: One derived row of the Booking_Timeline: a Window_Kind, a Drop_On, a Drop_At, and the Covered_Dates that open at that moment.
- **Drop_On**: The WDW_Calendar date on which a Booking_Window opens.
- **Drop_At**: The UTC instant of Drop_On at the Drop_Time in WDW_Calendar.
- **Covered_Dates**: The Stay_Dates that become bookable when a Booking_Window opens.
- **Window_Key**: The string `<Window_Kind>:<Drop_On>` that identifies a Booking_Window within a Trip.
- **Window_Status**: One of `upcoming` (Drop_At is later than now), `open` (Drop_At has passed and the last Covered_Date is today or later), or `past` (the last Covered_Date is earlier than today).
- **Booking_Timeline**: The ordered list of Booking_Windows derived for a Trip at read time.
- **Booking_Settings**: The optional per-Trip row holding the Stay_Type override, the Check_In_Override, and the Lightning_Lane_Timing override.
- **Window_Done_Mark**: A record that the group has finished booking for one Window_Key, which suppresses further reminders for that Window_Key.
- **Reminder_Lead**: One of `eve` (Drop_On minus 1 day at 20:00), `open` (the Drop_At itself), or `week` (Drop_On minus 7 days at 09:00). The enabled set is configured (see Configuration and Constants).
- **Send_Window**: The WDW_Calendar wall-clock interval within which the Reminder_Runner may dispatch pushes, 06:00 inclusive to 23:00 exclusive by default. Its start is configurable, and its 06:00 default lets the Reminder_Cron deliver the 06:00 dining `open` reminder at the drop.
- **Fire_At**: The UTC instant at which a Reminder_Lead becomes due for a Booking_Window.
- **Reminder_Runner**: The component that, on each authenticated Reminder_Cron tick, derives due reminders, claims them in the Reminder_Ledger, and dispatches them to the Notification_Service.
- **Reminder_Ledger**: The table `trip_booking_reminder_log` keyed by (Trip, Window_Kind, Drop_At, Reminder_Lead) that records each claimed reminder so it is dispatched at most once.
- **Reminder_Mute**: A per-Trip_Member, per-Trip record that suppresses booking reminders for that member on that Trip.
- **Keep_Alive_Cron**: The existing external scheduler (cron-job.org, crontab `*/10 0-1,7-23 * * *`, timezone `America/New_York`) that sends a `HEAD` request to `/health` every 10 minutes from 07:00 through 01:50 WDW_Calendar and does nothing from 02:00 to 06:59. It touches no database and exists only to keep the Render instance awake.
- **Reminder_Cron**: A dedicated external scheduled job, separate from the Keep_Alive_Cron, that calls `POST` or `HEAD /internal/trip-booking-reminders/run` with the `x-cron-secret` header on the Reminder_Cron_Schedule.
- **Reminder_Cron_Schedule**: The set of WDW_Calendar (`America/New_York`) times at which the Reminder_Cron fires, by default minutes 0, 10, and 20 of the hours 06, 07, and 20 (crontab `0,10,20 6,7,20 * * *`), plus hour 09 WHERE the `week` Reminder_Lead is enabled (see Configuration and Constants).
- **Booking_Timeline_Screen**: The Mobile_App screen, reached from the Trip_Detail_View, that presents the Booking_Timeline.
- **Packing_Item**: One entry of a Trip's Packing_List with a name, a Packing_Category, a quantity, an optional assignee, an adder, and a packed state.
- **Packing_List**: The shared collection of Packing_Items of a Trip.
- **Packing_Category**: One of `documents`, `clothing`, `toiletries`, `health`, `tech`, `park_gear`, `kids`, `other`.
- **Starter_List**: The fixed list of suggested Packing_Items declared in `@dwt/shared`.
- **Packing_List_Screen**: The Mobile_App screen, reached from the Trip_Detail_View, that presents the Packing_List.

## Requirements

### Requirement 1: Booking Rules and Drop Computation

**User Story:** As a Trip_Member, I want the exact moment each booking window opens computed for me, so that I do not have to do date arithmetic or look up Disney's rules.

#### Acceptance Criteria

1. THE Booking_Timeline_Service SHALL derive every Drop_On and Drop_At from the single Booking_Rules table declared in `@dwt/shared`, and SHALL NOT embed an offset, Drop_Time, or Resort_Cover_Days literal anywhere else.
2. THE Booking_Timeline_Service SHALL compute a Drop_On by subtracting the rule's offset in whole days from a WDW_Calendar date using calendar-date arithmetic on `YYYY-MM-DD` values, so that a daylight-saving transition between the two dates does not shift the result, and SHALL NOT clamp or adjust a Drop_On that falls before the current WDW_Calendar date.
3. THE Booking_Timeline_Service SHALL compute each Drop_At as the UTC instant of the Drop_Time on Drop_On in WDW_Calendar using the existing `wdwClock.ts` conversion, so that a 06:00 or 07:00 Drop_Time is correct on both sides of a daylight-saving transition (06:00 `dining` and 07:00 `lightning_lane` WDW_Calendar wall-clock time, equal to 10:00 or 11:00 UTC during daylight saving time and 11:00 or 12:00 UTC during standard time).
4. WHERE the effective Stay_Type is `resort`, THE Booking_Timeline_Service SHALL give the first 10 Stay_Dates counted from the Arrival_Date (or all Stay_Dates when there are fewer than 10) a single `dining` window with the shared Drop_On of the Arrival_Date minus 60 days, and SHALL give each later Stay_Date its own `dining` window with Drop_On of that date minus 60 days.
5. WHERE the effective Stay_Type is `partner_hotel` or `offsite`, THE Booking_Timeline_Service SHALL give every Stay_Date its own `dining` window with Drop_On of that date minus 60 days.
6. WHERE the effective Lightning_Lane_Timing is `seven_day`, THE Booking_Timeline_Service SHALL give the first 14 Stay_Dates counted from the Arrival_Date (or all Stay_Dates when there are fewer than 14) a `lightning_lane` window with the shared Drop_On of the Arrival_Date minus 7 days, and, only when more than 14 Stay_Dates exist, SHALL give every later Stay_Date the shared Drop_On of the Arrival_Date minus 3 days in a second `lightning_lane` window.
7. WHERE the effective Lightning_Lane_Timing is `three_day`, THE Booking_Timeline_Service SHALL give every Stay_Date the shared Drop_On of the Arrival_Date minus 3 days in a single `lightning_lane` window.
8. WHERE the effective Lightning_Lane_Timing is `three_day_daily`, THE Booking_Timeline_Service SHALL give every Stay_Date its own `lightning_lane` window with Drop_On of that date minus 3 days.
9. THE Booking_Timeline_Service SHALL resolve the effective Lightning_Lane_Timing as the Lightning_Lane_Timing stored in Booking_Settings when one is set, and otherwise as `seven_day` when the effective Stay_Type is `resort` or `partner_hotel` and `three_day` when the effective Stay_Type is `offsite`, so that the timing can be chosen independently of the Stay_Type.
10. THE Booking_Timeline_Service SHALL place every Stay_Date in exactly one Booking_Window per Window_Kind, so that the Covered_Dates of the windows of one Window_Kind partition the Stay_Dates with no gap and no overlap.
11. THE Booking_Timeline_Service SHALL order Booking_Windows by Drop_At ascending, breaking ties by Window_Kind with `dining` before `lightning_lane`, and then by the earliest Covered_Date ascending.
12. WHEN the Arrival_Date is shifted by k days (k a whole number, positive or negative) with the Stay_Type, the Lightning_Lane_Timing, and Trip_End_Date shifted by the same k days, THE Booking_Timeline_Service SHALL produce the same number of Booking_Windows with the same Window_Kinds, with each Drop_On and each Covered_Date shifted by exactly k days, and with each Drop_At equal to the Drop_Time on the shifted Drop_On.
13. THE Booking_Timeline_Service SHALL implement rule evaluation and timeline derivation as pure functions that perform no I/O, that take the current instant as an argument and do not read the system clock, and that return identical output for identical inputs.
14. THE Booking_Rules table SHALL carry an integer `BOOKING_RULES_VERSION`, and THE Booking_Timeline_Service SHALL return that version with every Booking_Timeline.
15. IF the Trip_End_Date is earlier than the Arrival_Date so that there are no Stay_Dates, THEN THE Booking_Timeline_Service SHALL return a Booking_Timeline containing zero Booking_Windows and the `BOOKING_RULES_VERSION`, and SHALL NOT raise an error.

### Requirement 2: Stay Type and Arrival Date

**User Story:** As an Organizer, I want the timeline to use the right check-in date and lodging type, so that the drop dates match how our party is actually booking.

#### Acceptance Criteria

1. THE Booking_Timeline_Service SHALL resolve the effective Stay_Type as the Stay_Type stored in Booking_Settings when a non-null value is stored, and otherwise as `resort` when the Trip has one or more Trip_Resort_Stay links and `offsite` when the Trip has zero.
2. THE Booking_Timeline_Service SHALL resolve the Arrival_Date as the stored Check_In_Override when it is valid, and otherwise as the Trip_Start_Date, and SHALL report the Arrival_Date source as `override` in the first case and `trip_start` in the second. A Check_In_Override is valid when it is a WDW_Calendar date from 30 days before the Trip_Start_Date through the Trip_Start_Date, both bounds inclusive.
3. IF a stored Check_In_Override falls outside the range of 30 days before the Trip_Start_Date through the Trip_Start_Date inclusive (including after the Trip_Start_Date is changed), THEN THE Booking_Timeline_Service SHALL ignore it on that read, SHALL use the Trip_Start_Date as the Arrival_Date, SHALL report the Arrival_Date source as `trip_start`, and SHALL leave the stored value unmodified.
4. WHEN an Organizer submits `PATCH /trips/:id/booking-settings` with a `stayType` of `resort`, `partner_hotel`, `offsite`, or `null` (meaning automatic), a `lightningLaneTiming` of `seven_day`, `three_day`, `three_day_daily`, or `null` (meaning derived from the Stay_Type), and a `checkInOverride` date or `null` (meaning no override), THE Booking_Timeline_Service SHALL store every supplied field, including those supplied as `null`, SHALL leave every omitted field unchanged, and SHALL return the resulting stored Booking_Settings.
5. IF a `PATCH /trips/:id/booking-settings` request supplies a `stayType` or `lightningLaneTiming` outside its vocabulary, a `checkInOverride` that is not a valid calendar date in `YYYY-MM-DD` form, or a `checkInOverride` outside the valid range, THEN THE Booking_Timeline_Service SHALL reject the whole request with `trip_validation_failed` and SHALL leave every stored Booking_Settings field unchanged, including fields in the same request that were individually valid.
6. IF a Trip_Member who holds the Trip_Role `member` submits `PATCH /trips/:id/booking-settings`, THEN THE Booking_Timeline_Service SHALL reject it with `trip_forbidden` and SHALL leave the stored Booking_Settings unchanged.
7. THE Booking_Timeline_Service SHALL persist Booking_Settings in a separate table keyed by Trip, and SHALL NOT add a column to the `trips` table.
8. WHEN Booking_Settings are changed, THE Booking_Timeline_Service SHALL reflect the change in every Booking_Timeline read for that Trip that begins after the `PATCH /trips/:id/booking-settings` response is returned.
9. THE Booking_Timeline_Service SHALL resolve the effective Lightning_Lane_Timing as the Lightning_Lane_Timing stored in Booking_Settings when a non-null value is stored, and otherwise as `seven_day` when the effective Stay_Type is `resort` or `partner_hotel` and `three_day` when the effective Stay_Type is `offsite`.
10. IF `PATCH /trips/:id/booking-settings` is submitted for a Trip that does not exist or by a requester who is not a Trip_Member of that Trip, THEN THE Booking_Timeline_Service SHALL reject it with the same error the Trip_Service returns for that case and SHALL leave the stored Booking_Settings unchanged.
11. IF a `PATCH /trips/:id/booking-settings` request body supplies none of `stayType`, `lightningLaneTiming`, or `checkInOverride`, THEN THE Booking_Timeline_Service SHALL reject it with `trip_validation_failed` and SHALL leave the stored Booking_Settings unchanged.

### Requirement 3: Booking Timeline Read

**User Story:** As a Trip_Member, I want to read the full timeline with each window's status and countdown, so that I can see what to book and when.

#### Acceptance Criteria

1. WHEN a Trip_Member requests `GET /trips/:id/booking-timeline`, THE Booking_Timeline_Service SHALL return a BookingTimelineDTO containing the Trip identifier, the `rulesVersion` (equal to the current `BOOKING_RULES_VERSION`), the effective Stay_Type and whether it came from `auto` or `override`, the effective Lightning_Lane_Timing and whether it came from `auto` or `override`, the Arrival_Date and whether it came from `trip_start` or `override`, a `muted` boolean that is true when a Reminder_Mute exists for the requesting Trip_Member on that Trip and false otherwise, and the list of Booking_Windows ordered by Drop_At ascending, with `dining` ordered before `lightning_lane` when two windows share the same Drop_At.
2. THE Booking_Timeline_Service SHALL report a source of `override` for the Stay_Type, the Lightning_Lane_Timing, or the Arrival_Date only when the corresponding value is stored in the Trip's Booking_Settings (for the Arrival_Date, only when the stored Check_In_Override is valid), and SHALL report `auto` or `trip_start` respectively when the Trip has no Booking_Settings row, the corresponding stored value is null, or the stored Check_In_Override is invalid.
3. THE Booking_Timeline_Service SHALL include in each Booking_Window its Window_Key, Window_Kind, Drop_On, Drop_At as an ISO-8601 UTC string, Covered_Dates, Window_Status, `daysUntilDrop`, `done`, and `bookedCount`, and SHALL set `done` to `true` when a Window_Done_Mark exists for that Trip and Window_Key and to `false` otherwise.
4. THE Booking_Timeline_Service SHALL evaluate Window_Status for every Booking_Window in a response against a single current instant captured once per request, and SHALL set Window_Status to `upcoming` when Drop_At is later than that instant, to `open` when Drop_At is not later than that instant and the last Covered_Date is not earlier than the current WDW_Calendar date, and to `past` otherwise.
5. WHILE a Booking_Window has Window_Status `upcoming`, THE Booking_Timeline_Service SHALL set `daysUntilDrop` to the whole-day difference, as an integer of 0 or greater, between Drop_On and the current WDW_Calendar date (0 when Drop_On is the current WDW_Calendar date), and WHILE the Window_Status is `open` or `past` THE Booking_Timeline_Service SHALL set `daysUntilDrop` to `null`.
6. THE Booking_Timeline_Service SHALL set `bookedCount` to the integer count, 0 or greater, of Reservations on the Trip whose `reservation_kind` is `dining` for a `dining` window or `lightning_lane` for a `lightning_lane` window and whose `planned_date` is one of the window's Covered_Dates (a Reservation with a null `planned_date` is not counted), and SHALL NOT use `bookedCount` to alter any Window_Status, `done` value, or reminder.
7. THE Booking_Timeline_Service SHALL include windows with Window_Status `past` in the response.
8. THE Booking_Timeline_Service SHALL derive the Booking_Timeline at read time from the Trip, its Trip_Resort_Stay, and its Booking_Settings, SHALL NOT persist any Drop_On, Drop_At, or Window_Status, and SHALL NOT create, modify, or delete any stored record as a result of the read.
9. IF the requesting User is not a Trip_Member of the Trip or the Trip does not exist, THEN THE Booking_Timeline_Service SHALL reject the request with `trip_forbidden` and return no timeline data, using the same error for both cases so that Trip existence is not disclosed.
10. IF the request carries no valid session, THEN THE Booking_Timeline_Service SHALL reject it with `unauthorized` before any Trip lookup and return no timeline data.
11. THE Booking_Timeline_Service SHALL derive `muted` from the Reminder_Mute of the requesting Trip_Member only, and SHALL NOT disclose in any Booking_Timeline response whether any other Trip_Member has a Reminder_Mute.

### Requirement 4: Reaction to Trip Changes

**User Story:** As a Trip_Member, I want the timeline and reminders to follow the Trip when its dates or lodging change, so that no one acts on an outdated date.

#### Acceptance Criteria

1. WHEN an Organizer changes the Trip_Start_Date or Trip_End_Date, THE Booking_Timeline_Service SHALL derive the Arrival_Date, Stay_Dates, Covered_Dates, Drop_On, Drop_At, and Window_Status of every Booking_Window from the updated dates on the first Booking_Timeline read that starts after the change is saved, with no separate recompute step and no stored copy of the previous Booking_Timeline.
2. WHEN a Trip_Resort_Stay link is added or removed and no Stay_Type override is stored, THE Booking_Timeline_Service SHALL derive the effective Stay_Type, and with it any Lightning_Lane_Timing that has no stored override, from the updated links on the first Booking_Timeline read that starts after the change is saved, and SHALL keep any stored Lightning_Lane_Timing override unchanged.
3. WHEN a Trip date change moves a Booking_Window to a different Drop_At, THE Reminder_Runner SHALL treat each reminder for that window as a new Reminder_Ledger key and SHALL NOT suppress it because a reminder for the former Drop_At was already sent.
4. WHEN a Trip date change moves a Booking_Window to a different Drop_On, THE Booking_Timeline_Service SHALL NOT apply a Window_Done_Mark recorded under the former Window_Key to the new Window_Key, and SHALL leave the stored Window_Done_Mark for the former Window_Key unmodified.
5. THE Reminder_Runner SHALL NOT recall, amend, or resend a reminder that was already dispatched for a former Drop_At, and SHALL NOT delete or modify the Reminder_Ledger rows recorded for that former Drop_At.
6. WHEN a Trip date change leaves a Booking_Window with the same Window_Key as before the change, THE Booking_Timeline_Service SHALL continue to apply the Window_Done_Mark recorded under that Window_Key.
7. IF a Trip_Start_Date change leaves a stored Check_In_Override outside its valid range of 30 days before the Trip_Start_Date through the Trip_Start_Date inclusive, THEN THE Booking_Timeline_Service SHALL use the updated Trip_Start_Date as the Arrival_Date, SHALL NOT reject the Trip date change, and SHALL retain the stored Check_In_Override value in Booking_Settings.
8. WHEN a Trip date change moves a Booking_Window to a different Drop_At, THE Reminder_Runner SHALL NOT dispatch any reminder whose Fire_At was computed from the former Drop_At and was not yet dispatched at the time of the change, and SHALL derive each subsequent reminder from the updated Drop_At.

### Requirement 5: Window Done Marks

**User Story:** As a Trip_Member, I want to mark a window as finished once our group has booked, so that no one keeps getting reminders for it.

#### Acceptance Criteria

1. WHEN a Trip_Member submits `PUT /trips/:id/booking-windows/:kind/:dropOn/done` with `done` set to true and no Window_Done_Mark exists for that Window_Key, THE Booking_Timeline_Service SHALL record a Window_Done_Mark for that Window_Key with the marking Trip_Member and the marking instant as a UTC instant, and SHALL return the Booking_Window with `done` as true.
2. WHEN a Trip_Member submits the same request with `done` set to false and a Window_Done_Mark exists for that Window_Key, THE Booking_Timeline_Service SHALL remove the Window_Done_Mark for that Window_Key and SHALL return the Booking_Window with `done` as false.
3. IF the user submitting a done request is not a Trip_Member of the Trip, THEN THE Booking_Timeline_Service SHALL reject the request with `trip_forbidden` and SHALL NOT record or remove any Window_Done_Mark.
4. IF `done` is absent from a done request or is not a boolean, THEN THE Booking_Timeline_Service SHALL reject the request with `trip_validation_failed` and SHALL leave any stored Window_Done_Mark unchanged.
5. IF the Window_Key in a done request (the `:kind` and `:dropOn` path values) does not name a Booking_Window on the Trip's current Booking_Timeline, because `:kind` is not a Window_Kind, `:dropOn` is not a valid calendar date, or no Booking_Window with that Window_Kind and Drop_On exists, THEN THE Booking_Timeline_Service SHALL reject the request with `trip_validation_failed` and SHALL NOT record or remove any Window_Done_Mark.
6. WHEN a done request repeats the state already stored for the Window_Key (`done` true with a mark present, or `done` false with no mark present), THE Booking_Timeline_Service SHALL return success and SHALL leave the stored mark, including its marking Trip_Member and marking instant, unchanged.
7. WHILE a Window_Done_Mark exists for a Booking_Window's Window_Key, THE Booking_Timeline_Service SHALL return `done` as true, the marking instant, and the display name of the marking Trip_Member in that Booking_Window.
8. WHILE no Window_Done_Mark exists for a Booking_Window's Window_Key, THE Booking_Timeline_Service SHALL return `done` as false in that Booking_Window with no marking Trip_Member display name and no marking instant.
9. WHILE a Window_Done_Mark exists for a Window_Key, THE Reminder_Runner SHALL NOT dispatch any reminder, for any Reminder_Lead, for that Window_Key to any Trip_Member.
10. WHEN a Window_Done_Mark is removed for a Window_Key, THE Reminder_Runner SHALL resume deriving reminders for that Window_Key under its normal due rules from the next Reminder_Cron tick, and SHALL NOT re-dispatch any reminder already recorded in the Reminder_Ledger.

### Requirement 6: Booking Timeline Screen

**User Story:** As a Trip_Member, I want a clear timeline screen in the Trip Hub, so that I can see what opens next and how long I have.

#### Acceptance Criteria

1. WHEN a Trip_Member selects the Booking timeline section of the Trip_Detail_View, THE Mobile_App SHALL open the Booking_Timeline_Screen for that Trip.
2. WHEN a Trip_Member opens the Booking_Timeline_Screen, THE Mobile_App SHALL request `GET /trips/:id/booking-timeline`, SHALL list the Booking_Windows with `upcoming` and `open` Window_Status in ascending Drop_At order (with `dining` listed before `lightning_lane` when two windows share a Drop_At), and SHALL list `past` windows in a separate group that is collapsed by default, shows the count of `past` windows in its header, and expands or collapses each time the Trip_Member selects the header.
3. THE Booking_Timeline_Screen SHALL show, for each Booking_Window, an icon and a text label for its Window_Kind, the Drop_On and Drop_Time in `America/New_York` with a time-zone label, the Covered_Dates as "first date – last date" (or the single date when the window covers one Stay_Date), the `bookedCount` as a whole number of 0 or more, and a countdown.
4. THE Booking_Timeline_Screen SHALL render the countdown, where `daysUntilDrop` is the whole number of WDW_Calendar days from today to Drop_On, as "Opens in N days" (N = `daysUntilDrop`) for `daysUntilDrop` greater than 1, "Opens tomorrow" for 1, and "Opens today" for 0 while `upcoming`, SHALL render "Open now" for Window_Status `open`, and SHALL render no countdown for Window_Status `past`.
5. THE Booking_Timeline_Screen SHALL convey each Window_Status (`upcoming`, `open`, `past`) and each `done` state (done, not done) with a distinct icon and a distinct text label in addition to any color, and SHALL NOT rely on color alone.
6. WHEN a Trip_Member toggles the done control of a Booking_Window, THE Mobile_App SHALL send `PUT /trips/:id/booking-windows/:kind/:dropOn/done` with the new value, SHALL disable that control until the request completes, and SHALL update the row to reflect the response.
7. THE Booking_Timeline_Screen SHALL show every Trip_Member the effective Stay_Type, the effective Lightning_Lane_Timing, and the Arrival_Date, and, beside the Stay_Type, the Lightning_Lane_Timing, and the Arrival_Date, a text label stating either "Detected automatically" or "Set by an Organizer".
8. WHERE the viewing Trip_Member holds the Trip_Role `organizer`, THE Booking_Timeline_Screen SHALL present controls to select the Stay_Type from Automatic, Resort, Partner hotel, and Off-site, to select the Lightning_Lane_Timing from Automatic, 7 days before check-in, 3 days before (whole trip), and 3 days before (each day), and to pick a Check_In_Override date, and WHEN the Organizer confirms a change THE Mobile_App SHALL send `PATCH /trips/:id/booking-settings` containing only the fields that differ from the stored values and, on success, SHALL refresh the timeline; WHEN the Organizer cancels instead of confirming, THE Mobile_App SHALL discard the pending change and send no request.
9. WHERE the viewing Trip_Member holds the Trip_Role `member`, THE Booking_Timeline_Screen SHALL NOT present the Stay_Type, Lightning_Lane_Timing, or Check_In_Override controls.
10. THE Booking_Timeline_Screen SHALL present a "Remind me" toggle whose initial position is on unless a Reminder_Mute exists for the viewing Trip_Member on that Trip, and WHEN the toggle is changed THE Mobile_App SHALL send `PUT /me/trips/:id/booking-reminders` with `muted` set to true when the toggle is switched off and to false when the toggle is switched on.
11. THE Booking_Timeline_Screen SHALL show a note stating that dates follow Disney's published booking rules at the displayed `BOOKING_RULES_VERSION` and should be confirmed in My Disney Experience.
12. WHILE the timeline request is in flight, THE Booking_Timeline_Screen SHALL show a loading indication, and IF the request fails THEN THE Booking_Timeline_Screen SHALL show an error indication with a retry control that, WHEN selected, sends the timeline request again.
13. IF a done-mark request, a booking-settings request, or a booking-reminders request fails, THEN THE Mobile_App SHALL restore the control to its value before the change, SHALL show an error indication naming the action that failed, and SHALL leave the displayed timeline unchanged.
14. IF the Organizer selects a Check_In_Override date earlier than 30 days before the Trip_Start_Date or later than the Trip_Start_Date, THEN THE Booking_Timeline_Screen SHALL reject the selection, SHALL show an indication that states the allowed date range, and SHALL send no `PATCH /trips/:id/booking-settings` request.
15. IF the returned Booking_Timeline contains zero Booking_Windows, THEN THE Booking_Timeline_Screen SHALL show an empty-state message in place of the window list and SHALL still show the settings summary, the "Remind me" toggle, and the rules note.

### Requirement 7: Reminder Derivation

**User Story:** As a Trip_Member, I want reminders to arrive at predictable moments before each window opens, so that I am ready when it does.

#### Acceptance Criteria

1. THE Booking_Timeline_Service SHALL compute Fire_At for the `eve` Reminder_Lead as 20:00 WDW_Calendar on the day before Drop_On, for the `open` Reminder_Lead as equal to Drop_At, and for the `week` Reminder_Lead as 09:00 WDW_Calendar on the day 7 days before Drop_On, each converted to a UTC instant with the existing `wdwClock.ts` conversion.
2. THE Reminder_Runner SHALL consider only the Reminder_Leads in the configured enabled set, whose default is `eve` and `open`, SHALL ignore any configured value that is not one of `eve`, `open`, or `week`, and SHALL derive no reminders WHEN the enabled set contains no valid Reminder_Lead.
3. IF the current instant is not earlier than a reminder's Fire_At and is earlier than that Fire_At plus the catch-up window (default 180 minutes), THEN THE Reminder_Runner SHALL treat the reminder as due.
4. IF the Window_Key has a Window_Done_Mark, or the last Covered_Date of the window is earlier than the current WDW_Calendar date, or the Reminder_Ledger already holds an entry for the reminder's Trip, Window_Kind, Drop_At, and Reminder_Lead, THEN THE Reminder_Runner SHALL treat the reminder as not due.
5. WHEN a pass runs at a WDW_Calendar wall-clock time within the Send_Window (06:00 inclusive to 23:00 exclusive by default), THE Reminder_Runner SHALL dispatch every reminder that is due at that instant.
6. WHEN a due reminder is dispatched at an instant not earlier than its Drop_At, THE Reminder_Runner SHALL compose the notification to state that the window has already opened, so that a Reminder_Cron tick at or after the Drop_At still delivers the reminder, and WHEN it is dispatched at an instant earlier than its Drop_At, THE Reminder_Runner SHALL compose the notification without stating that the window has already opened.
7. THE Reminder_Runner SHALL evaluate only Trips whose Trip_End_Date is not earlier than the current WDW_Calendar date and whose Arrival_Date (the Trip_Start_Date, or a valid stored Check_In_Override) is not later than the current WDW_Calendar date plus the evaluation horizon, where the evaluation horizon is 60 days plus the largest `daysBefore` offset among the enabled Reminder_Leads (1 day for `eve`, 7 days for `week`, 0 days for `open`) with that offset taken as at least 1, which is 61 days by default and 67 days WHEN the `week` Reminder_Lead is enabled, so that every enabled Reminder_Lead can fire for the primary `dining` window; THE Reminder_Runner SHALL order the evaluated Trips by Trip_Start_Date ascending with ties broken by Trip identifier ascending, up to 500 Trips per pass, and SHALL leave any further qualifying Trips unevaluated in that pass.
8. THE Booking_Timeline_Service SHALL implement reminder derivation as a pure function of the Trip data, the current instant, and the configuration, with no I/O, so that identical inputs always yield identical Fire_At values and due decisions.
9. IF a pass runs at a WDW_Calendar wall-clock time outside the Send_Window, THEN THE Reminder_Runner SHALL dispatch zero reminders and create zero Reminder_Ledger entries in that pass, and SHALL leave every unclaimed reminder due for a later pass until its catch-up window of 180 minutes elapses, after which the reminder is not dispatched.

### Requirement 8: Reminder Runner Endpoint

**User Story:** As the operator, I want reminders driven by a dedicated Reminder_Cron rather than the existing keep-alive cron, so that the free-tier hosting needs no always-on worker and the reminder pass does not keep the Neon database awake.

#### Acceptance Criteria

1. THE Booking_Timeline_Service SHALL expose `POST /internal/trip-booking-reminders/run` and `HEAD /internal/trip-booking-reminders/run`, each requiring an `x-cron-secret` header whose value is exactly equal (case-sensitive) to the configured `TRIP_BOOKING_CRON_SECRET`.
2. IF the `x-cron-secret` header is missing, is empty, or does not equal the configured secret, THEN THE Booking_Timeline_Service SHALL reject the request with the `unauthorized` error, SHALL perform no reminder work, and SHALL NOT start, or change the debounce timing of, any reminder pass.
3. WHEN an authorized request is received and no in-flight or debounce condition applies, THE Booking_Timeline_Service SHALL reply with status 202 within 2000 milliseconds, before the reminder pass completes, and SHALL run the pass asynchronously in the same process.
4. WHEN an authorized `POST` request is accepted, THE Booking_Timeline_Service SHALL return a body consisting of at most one JSON object no larger than 1024 bytes, and WHEN an authorized `HEAD` request is accepted, THE Booking_Timeline_Service SHALL return no body.
5. IF the reminder pass raises an error, THEN THE Booking_Timeline_Service SHALL log the error, SHALL NOT surface it to the caller of that request or of any later request, and SHALL release the in-flight state so that a later authorized request arriving at least 300 seconds after the start of the failed pass can start a new pass.
6. IF an authorized request arrives while a reminder pass is in flight, THEN THE Booking_Timeline_Service SHALL start no second concurrent pass and SHALL reply with status 202, with a `POST` body indicating that the pass was skipped.
7. IF an authorized request arrives less than 300 seconds after the start of the previous pass, THEN THE Booking_Timeline_Service SHALL start no new pass and SHALL reply with status 202, with a `POST` body indicating that the pass was skipped, so that Reminder_Cron ticks 10 minutes apart always clear the debounce. A request arriving 300 seconds or more after the start of the previous pass SHALL be eligible to start a new pass.
8. THE Booking_Timeline_Service SHALL perform reminder work without a queue, a background worker, or any Redis command.
9. WHEN a pass completes, THE Booking_Timeline_Service SHALL log exactly one summary entry stating the number of Trips evaluated, the number of reminders claimed, and the number of reminders dispatched, each as a non-negative integer (0 when none).
10. IF `TRIP_BOOKING_CRON_SECRET` is missing, is empty, consists only of whitespace, or equals the secret of any other cron endpoint, THEN THE application configuration SHALL fail startup validation with an error naming `TRIP_BOOKING_CRON_SECRET` and SHALL NOT start serving requests.
11. THE Reminder_Runner SHALL be invoked by the Reminder_Cron only, and THE Keep_Alive_Cron SHALL NOT call `/internal/trip-booking-reminders/run`, so that the reminder pass's database queries do not keep the Neon database awake on the keep-alive cadence.
12. THE default Reminder_Cron_Schedule SHALL fire at minutes 0, 10, and 20 of the hours 06, 07, and 20 America/New_York (crontab `0,10,20 6,7,20 * * *`), and ALSO at minutes 0, 10, and 20 of hour 09 WHERE the `week` Reminder_Lead is enabled (crontab `0,10,20 6,7,9,20 * * *`), so that every default Fire_At (06:00 dining open, 07:00 Lightning Lane open, 20:00 `eve`, 09:00 `week`) is followed within 20 minutes by three passes, the second and third acting as retries after a cold start or a failed pass, and so that the endpoint performs at most 9 passes per day by default and at most 12 passes per day WHERE the `week` Reminder_Lead is enabled.
13. THE Booking_Timeline_Service SHALL make each Reminder_Cron pass eligible to start, because consecutive Reminder_Cron ticks are 10 minutes (600 seconds) apart, which is more than the 300-second debounce of criterion 7.
14. IF a Reminder_Cron tick is missed or fails, THEN THE next tick within the 180-minute catch-up window SHALL still dispatch the due reminder, as specified in Requirement 7 criterion 3.
15. THE application configuration SHALL read `BOOKING_REMINDER_MIN_PASS_INTERVAL_SECONDS` (default 300) and SHALL fail startup validation WHEN the value is not an integer from 60 through 599, so that Reminder_Cron ticks 600 seconds apart always clear the debounce of criterion 7.

### Requirement 9: Reminder Claiming and Delivery

**User Story:** As a Trip_Member, I want to receive each reminder once, on my own devices, only if I want it, so that reminders help rather than annoy.

#### Acceptance Criteria

1. WHEN a due reminder is found, THE Reminder_Runner SHALL claim it by inserting its Reminder_Ledger row with a conflict-ignoring insert before dispatch, and SHALL dispatch only WHEN the insert created the row; IF the insert reports that the row already exists, THEN THE Reminder_Runner SHALL skip dispatch for that reminder without raising an error; and IF the insert fails with a database error, THEN THE Reminder_Runner SHALL skip dispatch for that reminder, leave no Reminder_Ledger row for it, and continue with the remaining due reminders so that the failed reminder is derived as due again on the next pass.
2. THE Reminder_Runner SHALL key the Reminder_Ledger on Trip, Window_Kind, Drop_At, and Reminder_Lead, so that two overlapping or repeated passes dispatch each reminder at most once.
3. THE Reminder_Runner SHALL coalesce the reminders claimed in one pass for the same Trip and Reminder_Lead into a single notification event that lists every distinct Window_Kind involved (at most 2, `dining` and `lightning_lane`) and a Covered_Dates range running from the earliest Covered_Date to the latest Covered_Date across the coalesced Booking_Windows.
4. THE Reminder_Runner SHALL address each notification event to every Trip_Member of the Trip, as of the moment the event is built, who has no Reminder_Mute for that Trip.
5. THE Notification_Service SHALL expose a `handleTripBookingReminder` handler that accepts the notification event, applies the recipient's master push preference with the default of enabled, sends to the recipient's active push tokens, and never throws; IF the recipient's master push preference is disabled or the recipient has no active push tokens, THEN THE handler SHALL send nothing to that recipient and SHALL return normally; and IF sending to one recipient or token fails, THEN THE handler SHALL continue with the remaining recipients and tokens.
6. THE Notification_Service SHALL compose the notification with a title of "Booking window opens tomorrow" for the `eve` lead, "Booking window is open" for the `open` lead, and "Booking window in 7 days" for the `week` lead, and a body of at most 100 characters naming the Window_Kinds, the Covered_Dates range formatted as abbreviated month and day in `America/New_York` (a single date when the earliest and latest Covered_Date are equal), and the Trip name, truncating the Trip name first (with a trailing ellipsis) when the body would exceed the limit, and truncating the whole body to 100 characters only when the body still exceeds the limit with the Trip name removed; and WHEN the dispatch instant is not earlier than the Drop_At of any listed window, THE Notification_Service SHALL begin the body with "Opened at" followed by the Drop_Time in `America/New_York` as a 12-hour clock time with AM/PM.
7. THE Notification_Service SHALL carry only the Trip identifier as the routing data payload of the notification, and SHALL disclose no Reservation, confirmation number, or member data.
8. WHEN a Trip_Member submits `PUT /me/trips/:id/booking-reminders` with `muted` set to true, THE Booking_Timeline_Service SHALL record a Reminder_Mute for that member and Trip, and WHEN `muted` is false THE Booking_Timeline_Service SHALL remove it, each idempotently, such that repeating the same request leaves exactly one Reminder_Mute (muted true) or none (muted false) and returns a success response reporting the resulting `muted` value.
9. IF a User who is not a Trip_Member of the Trip submits `PUT /me/trips/:id/booking-reminders`, THEN THE Booking_Timeline_Service SHALL reject it with `trip_forbidden` and SHALL create, change, and remove no Reminder_Mute.
10. THE Notification_Service SHALL record each per-token delivery outcome of a booking reminder in the existing delivery log with the kind `trip_booking_reminder`.
11. IF a notification event has no recipients because every Trip_Member has a Reminder_Mute or the Trip has no Trip_Members, THEN THE Reminder_Runner SHALL send no notification event for it and SHALL retain the claimed Reminder_Ledger row so that the reminder is not re-derived as due on later passes.
12. IF a claimed reminder's dispatch to the Notification_Service fails, THEN THE Reminder_Runner SHALL retain its Reminder_Ledger row, SHALL NOT re-dispatch that reminder on any later pass, and SHALL continue dispatching the remaining claimed reminders in the same pass.
13. IF `PUT /me/trips/:id/booking-reminders` is submitted with `muted` absent or not a boolean, THEN THE Booking_Timeline_Service SHALL reject it with a validation error and SHALL create, change, and remove no Reminder_Mute.

### Requirement 10: Reminder Tap Routing

**User Story:** As a Trip_Member, I want tapping a reminder to take me to the timeline, so that I can act immediately.

#### Acceptance Criteria

1. WHEN an authenticated User taps a push notification whose data payload carries a `bookingTripId` identifying a Trip of which the User is a Trip_Member, THE Mobile_App SHALL navigate to the Booking_Timeline_Screen of that Trip within 2 seconds of the tap, whether the Mobile_App was in the foreground, in the background, or not running at the time of the tap.
2. IF a User taps such a notification while not authenticated, THEN THE Mobile_App SHALL require authentication and, upon successful authentication within the same App session, navigate to the Booking_Timeline_Screen of the tapped Trip, following the same rule as `trips` Requirements 18.4 and 18.7.
3. IF authentication is cancelled or fails after a booking reminder tap, THEN THE Mobile_App SHALL NOT navigate to the Booking_Timeline_Screen and SHALL discard the pending navigation target, so that a later successful authentication in the same App session does not navigate to that Trip.
4. IF the Trip referenced by a tapped booking reminder no longer exists or the User is no longer a Trip_Member, THEN THE Mobile_App SHALL navigate to the Trips_List_Screen and display a message that the requested target is no longer available, which remains visible for at least 5 seconds unless the User dismisses it earlier, following `trips` Requirement 18.5.
5. IF a tapped push notification carries a `bookingTripId` that is empty or is not a well-formed Trip identifier, THEN THE Mobile_App SHALL treat the target as no longer available and behave as specified in criterion 4.
6. WHEN a User taps a booking reminder for the Trip whose Booking_Timeline_Screen is already the currently displayed screen, THE Mobile_App SHALL keep that screen displayed and SHALL NOT add a second instance of it to the navigation stack.
7. WHEN a User taps a booking reminder, THE Mobile_App SHALL NOT open the Notification_Center, SHALL NOT present the booking reminder as an Attention_Item, and SHALL NOT change the Attention_Badge count.
8. WHILE a booking reminder tap is pending authentication, THE Mobile_App SHALL treat a failed Login submission, a failed Register submission, or the User pressing Forgot password as authentication failed or cancelled for criterion 3, because the authentication screens have no explicit cancel control, and SHALL discard the pending navigation target.

### Requirement 11: Packing List Items

**User Story:** As a Trip_Member, I want a shared packing list for the Trip, so that the group can see what is covered and what is missing.

#### Acceptance Criteria

1. WHEN a Trip_Member submits `POST /trips/:id/packing-items` with a name, a Packing_Category, and an optional quantity and assignee, THE Booking_Timeline_Service SHALL create a Packing_Item in the unpacked state recording the adding Trip_Member and the creation instant, and SHALL return the created Packing_Item including its identifier.
2. THE Booking_Timeline_Service SHALL store the name trimmed of leading and trailing whitespace and SHALL require, on create and on update, a trimmed name of 1 to 80 characters (so a whitespace-only name is invalid), an integer quantity from 1 to 99 defaulting to 1 when omitted on create, and a Packing_Category from the closed vocabulary, rejecting any violation with `trip_validation_failed` and creating or changing nothing.
3. IF a Trip_Member adds a Packing_Item to a Packing_List that already holds 300 Packing_Items, THEN THE Booking_Timeline_Service SHALL reject the request with `trip_validation_failed` and SHALL NOT create a Packing_Item, and WHEN concurrent add requests would take the Packing_List above 300 Packing_Items, THE Booking_Timeline_Service SHALL accept only as many as keep the stored count at or below 300.
4. IF a request names an assignee who is not a Trip_Member of the Trip, THEN THE Booking_Timeline_Service SHALL reject it with `trip_validation_failed` and SHALL NOT create or change the Packing_Item.
5. WHEN a Trip_Member requests `GET /trips/:id/packing-items`, THE Booking_Timeline_Service SHALL return every Packing_Item of that Trip ordered by Packing_Category in the vocabulary order and then by creation time ascending, each with the adder's display name, the assignee's display name (absent when unassigned), the packing member's display name (absent when unpacked), and its packed state, together with a summary in which `totalCount` is the number of returned Packing_Items and `packedCount` is the number of those in the packed state, returning an empty list with `packedCount` 0 and `totalCount` 0 when the Trip has no Packing_Items.
6. WHEN a Trip_Member submits `PUT /trips/:id/packing-items/:itemId/packed` with `packed` set to true, THE Booking_Timeline_Service SHALL set the Packing_Item to the packed state, record the requesting Trip_Member as the packing member and the request instant as the packing instant, and return the updated Packing_Item; WHEN `packed` is false THE Booking_Timeline_Service SHALL set it to the unpacked state and clear both the packing member and the packing instant. WHEN the request repeats the item's current packed state, THE Booking_Timeline_Service SHALL succeed and SHALL leave the stored packing member and packing instant unchanged.
7. WHEN a Trip_Member who is authorized under criterion 12 submits `PATCH /trips/:id/packing-items/:itemId` with any of name, Packing_Category, quantity, or assignee, THE Booking_Timeline_Service SHALL apply the supplied fields under the rules of this requirement, SHALL treat an assignee supplied as null as removing the assignee, SHALL leave omitted fields and the packed state unchanged, and SHALL return the updated Packing_Item; IF the request supplies none of those fields or any supplied field is invalid, THEN THE Booking_Timeline_Service SHALL reject it with `trip_validation_failed` and SHALL change nothing, including the valid fields.
8. WHEN a Trip_Member who is authorized under criterion 12 submits `DELETE /trips/:id/packing-items/:itemId`, THE Booking_Timeline_Service SHALL remove the Packing_Item so that it is absent from every subsequent `GET /trips/:id/packing-items` response and from `totalCount` and `packedCount`.
9. WHILE the assignee of a Packing_Item is no longer a Trip_Member, THE Booking_Timeline_Service SHALL return that Packing_Item as unassigned (no assignee identifier and no assignee display name) without altering the stored row.
10. WHEN a Trip_Member submits `POST /trips/:id/packing-items/starter`, THE Booking_Timeline_Service SHALL add each Starter_List entry whose name does not match, case-insensitively after trimming, an existing Packing_Item of the Trip, using the entry's declared Packing_Category and quantity and recording the requesting Trip_Member as the adder, SHALL add them in one transaction, and SHALL return the number added (0 when every entry already matches, adding nothing); IF adding all of them would take the Packing_List above 300 Packing_Items, THEN THE Booking_Timeline_Service SHALL stop with `trip_validation_failed` and add nothing.
11. WHEN two Trip_Members toggle the packed state of the same Packing_Item concurrently, THE Booking_Timeline_Service SHALL leave exactly one stored row whose packed state, packing member, and packing instant equal those produced by the request whose write commits last.
12. IF a requester of any Packing_List endpoint is not a Trip_Member of the Trip, or a Trip_Member lacks the permission that the Trip permission matrix grants for editing or deleting Packing_Items on an endpoint that requires it, THEN THE Booking_Timeline_Service SHALL reject the request with the existing Trip authorization error and SHALL NOT create, change, or remove any Packing_Item.
13. IF a request to a `/packing-items/:itemId` endpoint names a Packing_Item that does not exist or that belongs to a different Trip than `:id`, THEN THE Booking_Timeline_Service SHALL reject the request with an error indicating the Packing_Item was not found and SHALL NOT create, change, or remove any Packing_Item.

### Requirement 12: Authorization

**User Story:** As a Trip_Member, I want the right people to be able to change the right things, so that the group can collaborate without one member overwriting another's work.

#### Acceptance Criteria

1. THE Trip_Service SHALL extend the `TripAction` union and the role/action matrix in `permissions.ts` with `add_packing_item`, `toggle_packing_item`, `edit_packing_item`, `mark_booking_window_done`, and `set_booking_reminder_mute` as actions permitted to every Trip_Member, and `edit_booking_settings` as an action permitted only to an Organizer. The `add_packing_item` action SHALL cover both adding a single Packing_Item and running the starter action. The `edit_packing_item` action SHALL cover editing, reassigning, and removing a Packing_Item, and its role-level permission for every Trip_Member is further restricted by criterion 4.
2. THE Booking_Timeline_Service SHALL permit any Trip_Member, including an Organizer, to read the Booking_Timeline and the Packing_List, to add Packing_Items, to toggle the packed state of any Packing_Item, to run the starter action, to mark any Booking_Window done, and to set their own Reminder_Mute.
3. THE `PUT /me/trips/:id/booking-reminders` endpoint SHALL act only on the requesting Trip_Member, and IF the request path or body names any other user, including a `userId` key in the body, THEN THE Booking_Timeline_Service SHALL reject the request with `trip_validation_failed` and leave every Reminder_Mute on the Trip unchanged.
4. IF a Trip_Member who is neither the member who added a Packing_Item nor an Organizer attempts to edit, reassign, or remove that Packing_Item, THEN THE Booking_Timeline_Service SHALL reject the request with `trip_forbidden` and leave the Packing_Item unchanged. WHERE the member who added a Packing_Item is no longer a Trip_Member, THE Booking_Timeline_Service SHALL permit only an Organizer to edit, reassign, or remove it.
5. IF a Trip_Member who is not an Organizer attempts to change Booking_Settings, THEN THE Booking_Timeline_Service SHALL reject the request with `trip_forbidden` and leave the Booking_Settings unchanged. WHEN an Organizer changes Booking_Settings, THE Booking_Timeline_Service SHALL accept the request, subject to the validation rules of the Booking_Settings requirement.
6. IF a User who is not a Trip_Member requests a read or write on a Trip, or any request names an unknown Trip, THEN THE Booking_Timeline_Service SHALL reject it with the identical `trip_forbidden` response, so that Trip existence cannot be probed. "Identical" means the same error code, the same response status class, and the same response body shape and content, differing in no field that reflects whether the Trip exists. The rejected request SHALL NOT create, change, or delete any record.
7. THE Booking_Timeline_Service SHALL apply the authenticated-session check before any Trip lookup. IF the request carries a missing, expired, or invalid session, THEN THE Booking_Timeline_Service SHALL reject it with `unauthorized`, perform no Trip or membership lookup, and change no record.
8. WHEN a Trip_Member's membership is removed or their Trip_Role changes, THE Booking_Timeline_Service SHALL evaluate every subsequent request from that User against the current membership and Trip_Role, with no reliance on a prior authorization result.
9. THE existing role/action matrix test SHALL be extended to enumerate the six new actions for every Trip_Role. It SHALL assert that a `member` is permitted exactly the five member-level actions and is denied `edit_booking_settings`, that an `organizer` is permitted all six, and that a User with no Trip_Membership is permitted none.

### Requirement 13: Packing List Screen

**User Story:** As a Trip_Member, I want to check things off and see what is left, so that we leave nothing important at home.

#### Acceptance Criteria

1. THE Trip_Detail_View SHALL present a Packing list section that shows `packedCount` of `totalCount` (the number of Packing_Items whose packed state is true, and the number of all Packing_Items in the Packing_List, both counted before any filter is applied) and opens the Packing_List_Screen for that Trip when activated. WHEN the Packing_List holds no Packing_Items, THE section SHALL show `0` of `0`.
2. WHEN a Trip_Member opens the Packing_List_Screen, THE Mobile_App SHALL request `GET /trips/:id/packing-items` and SHALL list the Packing_Items grouped by Packing_Category, with each item's name, quantity, assignee (or an "Unassigned" label when none), and packed state. THE Packing_List_Screen SHALL order groups in the order the Packing_Categories are listed in the Glossary, SHALL omit any group that has no Packing_Items under the active filter, and SHALL order items within a group by creation time, oldest first.
3. WHEN a Trip_Member toggles the packed control of a Packing_Item, THE Mobile_App SHALL send `PUT /trips/:id/packing-items/:itemId/packed` with the new value and SHALL update the row's packed state and the `packedCount` before the response is received. IF the request fails, THEN THE Mobile_App SHALL restore the row's previous packed state and `packedCount` and SHALL show an error indication.
4. THE Packing_List_Screen SHALL convey the packed state with an icon and a text label ("Packed" or "Not packed") in addition to any color, and SHALL give each packed control an accessibility label that contains the item name and its current packed state.
5. THE Packing_List_Screen SHALL provide exactly three filters named All, Mine (items whose assignee is the viewing Trip_Member), and Unpacked (items whose packed state is false), SHALL select All when the screen opens, and SHALL apply the selected filter to the already-loaded list without sending a new request. IF the selected filter matches no Packing_Items and the Packing_List holds at least one Packing_Item, THEN THE Packing_List_Screen SHALL show a text message stating that no items match the filter, and SHALL keep the three filters visible.
6. WHEN a Trip_Member submits a valid add-item form, THE Mobile_App SHALL send `POST /trips/:id/packing-items` with the name, Packing_Category, quantity, and optional assignee chosen from the Trip_Members, SHALL close the form, and SHALL show the new Packing_Item with a packed state of false. THE add-item form SHALL accept a name of 1 to 80 characters after trimming leading and trailing whitespace, an integer quantity from 1 to 99 that defaults to 1, exactly one Packing_Category, and either one Trip_Member or no assignee.
7. WHERE the viewing Trip_Member added a Packing_Item or holds the Trip_Role `organizer`, THE Packing_List_Screen SHALL present edit and remove controls for that item. WHEN the edit form for the item is submitted with valid values under the limits in criterion 6, THE Mobile_App SHALL send `PATCH /trips/:id/packing-items/:itemId` and SHALL show the updated values. WHEN the remove control is activated, THE Mobile_App SHALL send `DELETE /trips/:id/packing-items/:itemId` and SHALL remove the row and update `totalCount` once the request succeeds.
8. IF the Packing_List holds no Packing_Items, THEN THE Packing_List_Screen SHALL render an empty state with an "Add suggested items" control and an add-item control.
9. THE Packing_List_Screen SHALL refetch the Packing_List WHEN the screen gains focus and after every mutation request it issues completes (whether it succeeds or fails), so that changes by other Trip_Members appear without a realtime channel.
10. WHILE the list request is in flight and no Packing_List has been loaded, THE Packing_List_Screen SHALL show a loading indication in place of the list.
11. WHEN a Trip_Member activates the "Add suggested items" control, THE Mobile_App SHALL send `POST /trips/:id/packing-items/starter` and SHALL show the added Packing_Items grouped as in criterion 2 once the request succeeds.
12. IF the add-item or edit form is submitted with a trimmed name that is empty or longer than 80 characters, or with a quantity outside 1 to 99 or not an integer, THEN THE Packing_List_Screen SHALL not send a request, SHALL keep the form open with the entered values, and SHALL show an error indication naming the invalid field. IF an add, edit, remove, or starter request fails or is rejected, THEN THE Packing_List_Screen SHALL keep the displayed Packing_List unchanged, SHALL keep any open form open with the entered values, and SHALL show an error indication.
13. IF the list request fails, THEN THE Packing_List_Screen SHALL show an error indication with a retry control in place of the list, and WHEN the retry control is activated THE Mobile_App SHALL send `GET /trips/:id/packing-items` again.

### Requirement 14: Lifecycle, Privacy, and Resource Bounds

**User Story:** As the operator, I want this feature's data to follow the Trip and stay small, so that it fits the free-tier database and leaks nothing.

#### Acceptance Criteria

1. WHEN a Trip is deleted, THE Trip_Service SHALL delete that Trip's Booking_Settings, Window_Done_Marks, Reminder_Mutes, Reminder_Ledger rows, and Packing_Items through `ON DELETE CASCADE`, and SHALL NOT alter any Reservation or canonical Tracking data.
2. WHEN a reminder pass ends, THE Booking_Timeline_Service SHALL delete every Reminder_Ledger row whose Drop_At is more than 30 days before the current instant, and SHALL retain every Reminder_Ledger row whose Drop_At is 30 days or less before the current instant.
3. IF pruning the Reminder_Ledger fails, THEN THE Booking_Timeline_Service SHALL leave the rows it did not delete unchanged, SHALL NOT revert reminders already dispatched in that pass, and SHALL retry the prune at the end of the next reminder pass.
4. THE Booking_Timeline_Service SHALL store at most one Booking_Settings row per Trip, at most one Window_Done_Mark row per (Trip, Window_Key), and at most one Reminder_Mute row per (Trip, Trip_Member).
5. IF a request would add a Packing_Item to a Trip that already holds 300 Packing_Items, THEN THE Booking_Timeline_Service SHALL reject the request with a validation error indicating that the Packing_List limit is reached, SHALL NOT store any part of the request, and SHALL leave the existing Packing_Items unchanged.
6. IF a request would store a second row for the same Trip in Booking_Settings, the same (Trip, Window_Key) in Window_Done_Marks, or the same (Trip, Trip_Member) in Reminder_Mutes, THEN THE Booking_Timeline_Service SHALL update the existing row in place and SHALL NOT create an additional row.
7. WHERE the requester is a Trip_Member of the Trip, THE Booking_Timeline_Service SHALL include Booking_Timeline and Packing_List data in the response; for any requester who is not a Trip_Member, THE Booking_Timeline_Service SHALL reject the request with an authorization error and SHALL NOT return any Booking_Timeline or Packing_List data.
8. THE Booking_Timeline_Service SHALL NOT include Booking_Timeline or Packing_List data in the Trip feed, the Trip summary, or any shared or public surface.
9. THE migration for this feature SHALL be additive, wrapped in `BEGIN` and `COMMIT`, idempotent on reapply, use `gen_random_uuid()`, `TIMESTAMPTZ`, `CHECK` constraints for the Stay_Type, Lightning_Lane_Timing, Window_Kind, Reminder_Lead, and Packing_Category vocabularies, and `ON DELETE CASCADE` against `trips(id)`.
10. IF the migration is applied a second time, THEN THE migration SHALL complete without error and SHALL leave the existing rows and constraints unchanged.

### Requirement 15: Contract Integrity

**User Story:** As a developer, I want the wire contracts and rules defined once, so that the API and the app cannot drift.

#### Acceptance Criteria

1. THE `@dwt/shared` package SHALL export each of the following as a single declaration:
   - the Booking_Rules table, with `BOOKING_RULES_VERSION` as a positive integer
   - the Stay_Type, Lightning_Lane_Timing, Window_Kind, Reminder_Lead, and Packing_Category vocabularies
   - the Starter_List
   - the BookingTimelineDTO, the Booking_Window DTO, and the Packing_Item DTO
   - one Zod schema for the body of every request this feature accepts, including Booking_Settings updates, Window_Done_Mark changes, Reminder_Mute changes, and Packing_Item create, update, and delete.
2. THE vocabularies SHALL be declared once as shared constants. THE Zod schemas and the Mobile_App UI SHALL reference those constants. THE value set in each migration `CHECK` constraint SHALL equal the value set of the corresponding shared constant, with the same members and no extras. A test SHALL fail if any of the three sets differs.
3. THE Booking_Timeline_Service SHALL use only the existing error codes `trip_forbidden`, `trip_validation_failed`, `trip_not_found`, and `unauthorized`, and SHALL NOT introduce a new error code. IF a request of this feature fails, THEN THE Booking_Timeline_Service SHALL respond with exactly one of these four codes in the existing error envelope.
4. THE existing push data payload type SHALL be extended additively with a `{ bookingTripId }` variant whose `bookingTripId` is the identifier of the Trip and which carries no other field. THE existing variants SHALL remain unchanged, and every payload that validated against the type before the extension SHALL still validate against it afterwards.
5. THE `apps/api` and `apps/mobile` packages SHALL import every contract listed in criterion 1 from `@dwt/shared` and SHALL NOT declare a local copy of any of them. THE monorepo type-check SHALL fail if either app's use of a contract does not match its `@dwt/shared` declaration.
6. IF a request body of this feature does not satisfy its shared Zod schema, THEN THE Booking_Timeline_Service SHALL reject the request with `trip_validation_failed` and SHALL leave all stored data unchanged.

## Configuration and Constants

All values below are the defaults an implementer SHALL use. Booking_Rules values live in `@dwt/shared` as code constants because they change only with a Disney policy change and a `BOOKING_RULES_VERSION` bump; operational values are environment variables with the defaults shown.

### Booking_Rules (code constants, `BOOKING_RULES_VERSION = 1`)

| Window_Kind | Stay_Type | Offset (days before) | Drop_Time (WDW) | Shared drop covers | Remaining Stay_Dates |
| --- | --- | --- | --- | --- | --- |
| `dining` | `resort` | 60 from Arrival_Date | 06:00 | first 10 Stay_Dates | each own window, date minus 60 |
| `dining` | `partner_hotel` | 60 per Stay_Date | 06:00 | 1 date per window | n/a |
| `dining` | `offsite` | 60 per Stay_Date | 06:00 | 1 date per window | n/a |
| `lightning_lane` | `seven_day` timing (default for `resort` and `partner_hotel`) | 7 from Arrival_Date | 07:00 | first 14 Stay_Dates | one window at Arrival_Date minus 3 |
| `lightning_lane` | `three_day` timing (default for `offsite`) | 3 from Arrival_Date | 07:00 | all Stay_Dates | none |
| `lightning_lane` | `three_day_daily` timing (never a default; choose for day-by-day tickets or annual passes) | 3 per Stay_Date | 07:00 | 1 date per window | n/a |

The Lightning_Lane_Timing is selected independently of the Stay_Type, so an on-property party limited to the 3-day window by its passes can choose `three_day` or `three_day_daily`.

Note (additive, 2026-10-17): The Booking_Rules defaults above were kept by decision after re-checking Disney's current pages (design.md, External Interfaces). Two known limitations are accepted. (1) A 10-night resort stay spans 11 calendar dates including check-out day; the first 10 Stay_Dates share one dining drop and the 11th has its own drop at that date minus 60 days, which affects only stays of 10 nights or more and yields a redundant later reminder for the check-out day, not a missed one. (2) For trips longer than 14 dates, Disney's behavior for days beyond the first 14 is believed to be day-by-day rolling, and the `seven_day` row approximates it with a second shared window at Arrival_Date minus 3 days. No criterion or value changed.

### Reminder and runner settings

| Setting | Env var | Default |
| --- | --- | --- |
| Cron secret (required, distinct per endpoint) | `TRIP_BOOKING_CRON_SECRET` | none; startup fails if empty |
| Enabled Reminder_Leads | `BOOKING_REMINDER_LEADS` | `eve,open` |
| Lead times (WDW) | code constants | `eve` = Drop_On minus 1 day at 20:00; `open` = Drop_At itself (06:00 for `dining`, 07:00 for `lightning_lane` on Drop_On); `week` = Drop_On minus 7 days at 09:00 |
| Catch-up window | `BOOKING_REMINDER_CATCHUP_MINUTES` | 180 |
| Minimum interval between pass starts | `BOOKING_REMINDER_MIN_PASS_INTERVAL_SECONDS` | 300 (integer 60 through 599; startup fails otherwise) |
| Send_Window start (WDW) | `BOOKING_REMINDER_SEND_START` | `06:00` inclusive |
| Send_Window end (WDW) | `BOOKING_REMINDER_SEND_END` | `23:00` exclusive |
| Trip evaluation horizon | code constant | Trip_End_Date not earlier than today; Arrival_Date not later than today plus 60 days plus the largest enabled lead offset (minimum 1): 61 days by default, 67 days with the `week` lead enabled |
| Trips per pass | code constant | 500 |
| Ledger retention | `BOOKING_REMINDER_RETENTION_DAYS` | 30 days after Drop_At |

The default minimum pass interval of 300 seconds is deliberately below the 10-minute spacing of consecutive Reminder_Cron ticks, because a debounce equal to the spacing would drop every other tick through clock jitter (the same rule documented for the sampling cron).

| Setting (documentation-only operator setting, not an env var) | Default |
| --- | --- |
| Reminder_Cron_Schedule, `week` lead disabled (default) | crontab `0,10,20 6,7,20 * * *`, timezone `America/New_York` |
| Reminder_Cron_Schedule, `week` lead enabled | crontab `0,10,20 6,7,9,20 * * *`, timezone `America/New_York` |

### Scheduling fit with the Reminder_Cron

Reminders are driven by a dedicated Reminder_Cron job, separate from the Keep_Alive_Cron. The Keep_Alive_Cron (`*/10 0-1,7-23 * * *`, `America/New_York`) sends a `HEAD` request to `/health` with no database access and does nothing from 02:00 to 06:59. It does not call the reminder endpoint, because the reminder pass queries Trips from Neon on every call, and a database-touching call every 10 minutes for about 19 hours a day uses about 580 hours of Neon compute, over the free-tier ceiling of about 400 CU-hours at the default 0.25 CU described in `docs/hosting.md`.

Reminders fire only at fixed WDW_Calendar wall-clock times: 06:00 (`dining` `open`), 07:00 (`lightning_lane` `open`), 20:00 (`eve`), and 09:00 (`week`, only when enabled). The Reminder_Cron therefore fires a few times a day, at minutes 0, 10, and 20 of the hours that carry a Fire_At:

- Default (`week` lead disabled): crontab `0,10,20 6,7,20 * * *`, at most 9 passes per day.
- With the `week` lead enabled: crontab `0,10,20 6,7,9,20 * * *`, at most 12 passes per day.

Operator setup on the cron-job.org job:

- The job timezone MUST be set to `America/New_York`, so the schedule follows WDW_Calendar wall-clock time across daylight-saving changes.
- The method SHOULD be `HEAD` or `POST`, with the `x-cron-secret` header set to the value of `TRIP_BOOKING_CRON_SECRET`. A `HEAD` response has no body, so it cannot exceed the 8 KB limit at which cron-job.org aborts a response and, after repeated failures, auto-disables the job.
- The first tick of each hour acts as the primary pass, and the second and third, 10 and 20 minutes later, act as retries after a cold start or a failure, so that one failed pair of ticks does not drop the 20:00 `eve` reminder. Consecutive ticks are 600 seconds apart, which clears the 300-second debounce.

`BOOKING_REMINDER_SEND_START` stays at `06:00`. With the Reminder_Cron, the dining `open` reminder is delivered at about 06:00 plus Render's cold start of up to 60 seconds, and the `lightning_lane` `open` reminder at about 07:00 plus any cold start. A reminder dispatched at or after its Drop_At states "Opened at" the Drop_Time (Requirement 9 criterion 6). The `eve` reminder at 20:00 is the one that gives the group time to prepare.

Hosting impact:

- Render: about 0.25 extra instance hour per day for the 06:00 wake (about 8 hours a month), on top of the roughly 589 hours a month the Keep_Alive_Cron already uses, which stays inside the 750 instance-hour limit in `docs/hosting.md`.
- Neon: at most 9 short wake-ups per day (12 with the `week` lead enabled), instead of a continuous database-touching call every 10 minutes.

### Packing list limits

| Limit | Value |
| --- | --- |
| Item name length | 1 to 80 characters after trimming |
| Quantity | 1 to 99, default 1 |
| Items per Trip | 300 |
| Packing_Category vocabulary and order | `documents`, `clothing`, `toiletries`, `health`, `tech`, `park_gear`, `kids`, `other` |

### Starter_List (code constant)

Documents: "Park tickets or passes", "Photo ID", "Hotel confirmation". Clothing: "Comfortable walking shoes", "Extra socks", "Swimsuit", "Light rain jacket". Toiletries: "Sunscreen", "Toiletry kit". Health: "Medications", "Blister bandages", "Pain reliever". Tech: "Phone charger", "Portable battery", "Headphones". Park gear: "Refillable water bottle", "Ponchos", "Hat and sunglasses", "Small day bag". Kids: "Stroller or wagon", "Snacks". The list holds 21 entries.

## External Interfaces

This feature calls no external API. The Booking_Rules constants encode Disney's published, user-facing booking policies as observed in Disney's own help pages on the date of authoring. Those pages are not fetched at runtime and are not a stable contract; when Disney changes a policy, an implementer edits the Booking_Rules table and bumps `BOOKING_RULES_VERSION`.

- Advance Dining Reservations: Disney Resort hotel guests book the entire stay (up to 10 days) beginning 60 days before arrival at 6:00 AM Eastern; other guests book 60 days ahead one day at a time. Source: Disney's Advance Reservations FAQ at `https://www.disneyworld.disney.go.com/en_CA/faq/dining-reservations/advance-reservations/` and the Plan Disney answer at `https://plandisney.disney.go.com/question/time-reservations-disney-world-612772/`.
- Lightning Lane Multi Pass, Single Pass, and Premier Pass: selections open at 7:00 AM Eastern, 7 days before check-in for Disney Resort hotel guests and select partner hotels, or 3 days before the ticket start date for other guests. Source: `https://plandisney.disney.go.com/question/schedule-lightning-lane-arrival-entering-park-im-614713/` and `https://plandisney.disney.go.com/question/regarding-new-lightning-lane-multi-pass-single-pass-work-580137/`.
- Identifiers used internally: the Trip's `trips.start_date`, `trips.end_date`, `trip_resorts` links, `planned_items.reservation_kind` and `planned_items.planned_date`, `push_registrations` tokens via the existing token targeter, and `notification_preferences.push_notifications_enabled`.

The sources disagree on whether the resort-guest Lightning Lane window covers 14 days or the entire stay, and on whether the dining window covers 10 nights or 10 days. The defaults take 14 and 10 Stay_Dates counted from the Arrival_Date; both are single constants in the Booking_Rules table.

## Cross-Spec Dependencies and Build Order

1. **`trips`** (hard dependency, already shipped): Trip, memberships, roles, `trip_resorts`, `TripDetailScreen` hub, `permissions.ts`, `wdwClock.ts`, `assertTripMember` and `assertTripOrganizer`, and the cascade-on-delete convention.
2. **`trip-reservations`** (read-only dependency, already shipped): `planned_items.reservation_kind` and `planned_date` for `bookedCount`. No Reservation behavior changes.
3. **`notification-center`** (infrastructure dependency, already shipped): `Notification_Service`, the push token targeter, the master push preference, the delivery log, and the mobile tap-routing hook. This feature adds a new notification kind and does not modify any notification-center requirement; Requirement 10.4 states the non-interference explicitly.
4. **`trip-expenses`** (no dependency): both features add a section to the Trip_Detail_View; they share only the hub layout and the next sequential migration number, so whichever merges second takes the next free number (`0061` is the next number as of authoring, because `0060_trip_expenses.sql` is the latest).

Build order within this feature: (a) shared rules, vocabularies, DTOs, and schemas; (b) pure timeline and reminder derivation modules with property tests; (c) migration, repo, and `permissions.ts` extension; (d) timeline, settings, done, mute, and packing routes; (e) Reminder_Runner, internal endpoint, config secret, and Notification_Service handler; (f) mobile Booking_Timeline_Screen, Packing_List_Screen, hub sections, and tap routing; (g) hosting documentation (`docs/hosting.md`, `render.yaml`) updated with the new Reminder_Cron job and secret.

Standing up the Reminder_Cron job on cron-job.org (crontab, `America/New_York` timezone, `HEAD` or `POST` method, `x-cron-secret` header) is an operator step that this feature's tasks SHALL record in `docs/hosting.md`. `docs/hosting.md` already documents the Render limits (750 instance hours a month, sleep after 15 minutes idle) and the Neon limits (about 400 CU-hours at 0.25 CU, no frequent database pings) that the Reminder_Cron schedule relies on, and the Keep_Alive_Cron is left unchanged.
