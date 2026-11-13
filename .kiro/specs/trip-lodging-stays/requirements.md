# Requirements Document

## Introduction

Trip Lodging Stays replaces the Trip's flat list of resorts with an ordered list of **dated stays**. A Trip today records only *which* resorts the party used (`trip_resorts`, `trips` Requirement 21): a split stay is three hotel names with no dates, so the app cannot say which hotel the party is in tonight, cannot tell a Disney resort from an off-site hotel, and cannot compute booking windows for a second reservation. Several features already assume "the stay" is one trip-wide thing:

- The **Trip hub** lists resort chips, and the **Live Glance** card names one resort ("Relax at Disney's All-Star Movies Resort") on every day of a trip that spans three hotels.
- The **booking timeline** (`trip-booking-timeline`) uses one trip-wide Stay_Type and one arrival date, so a second reservation never gets its own 60-day dining window or its own Lightning Lane timing.
- The **Dining Plan Calculator** (`dining-plan-calculator`) needs to know which nights belong to which room reservation, because a dining plan belongs to one reservation, covers its whole length, and its credits expire at that reservation's check-out.

A **Stay** is one lodging booking: a kind (Disney Resort, partner hotel such as the Swan and Dolphin, or other lodging), a Resort from the catalog or a free-text name, a check-in and a check-out date, and optionally the subset of the party who are on it. The Trip stores an ordered list of Stays. Stays never overlap in nights; consecutive Stays may share a hand-off date (one's check-out is the next one's check-in).

Existing behavior is preserved. `trip_resorts` remains as a derived set of resort ids so every current reader (booking, stats, summaries, pins) keeps working. A Trip with no dated Stays behaves exactly as today, through a pure resolver (`effectiveStays`) that every consumer calls. Existing data is migrated conservatively: a Trip with one recorded resort becomes one dated Stay; a Trip with several becomes several *unscheduled* Stays (hotel but no dates) that prompt the organizer to add dates and are treated as one trip-wide stay until then.

**Depends on** (must be built after): `trips` (Trip, roles, `trip_resorts`, `edit_settings`, TripDTO, edit screen, hub, Live Glance), `trip-booking-timeline` (derivation, `BOOKING_RULES`, settings), `account-deletion` (visibility rules), `dark-mode` (theming). **Consumed by**: `dining-plan-calculator`, which must be built after this spec. See the design's Cross-Spec Dependencies and Build Order.

## Glossary

- **Trip**, **Trip_Member**, **Trip_Guest**, **Organizer**, **Trip_Resort_Stay**, **Trip_Start_Date**, **Trip_End_Date**: as defined by `trips` and `trip-expenses`.
- **Stay**: one lodging booking of a Trip; a row of `trip_stays`.
- **Lodging_Kind**: `resort` (a Disney Resort hotel, referencing a catalog Resort), `partner_hotel` (an eligible non-Disney-owned hotel, free-text name) or `offsite` (any other lodging, free-text name). These are the existing `STAY_TYPES` of `trip-booking-timeline`.
- **Scheduled_Stay**: a Stay with both a `check_in` and a `check_out`.
- **Unscheduled_Stay**: a Stay with neither (a legacy or newly named hotel whose dates are not yet known).
- **Night**: a calendar date `d` such that `check_in <= d < check_out` for a Scheduled_Stay. A Stay's nights are the nights it covers.
- **Hand_Off_Date**: a date that is the `check_out` of one Scheduled_Stay and the `check_in` of the next.
- **Party_Keys**: an optional list of Person_Keys (`m:<id>` or `g:<id>`) naming who is on a Stay; NULL means the whole Trip party.
- **Effective_Stay**: an element of the list returned by the pure resolver `effectiveStays`: a Scheduled_Stay, or a synthesized segment standing for lodging the Trip has not recorded. Its `source` is `stay`, `legacy_resorts`, `implicit_no_lodging` or `implicit_gap`.
- **Stay_Warning**: an advisory (never blocking) finding about a Trip's Stays: `gap`, `outside_trip`, `unscheduled`, `trip_not_covered`.
- **Trip_Service**: the API-side service for Trips (`apps/api/src/services/trips/`); extended here.
- **Mobile_App**: the React Native and Expo client in `apps/mobile`.
- **Live_Glance**: the "Live Glance" card on the Trip hub (`TripDetailScreen.tsx`).
- **Booking_Timeline**: the derived timeline of `trip-booking-timeline` (`deriveBookingTimeline`).
- **WDW_Today**: the current calendar date in `America/New_York`, from `wdwToday` in `services/trips/wdwClock.ts`.

## Requirements

### Requirement 1: The Stay model

**User Story:** As an Organizer, I want to record each hotel booking of a trip with its dates, so that the app knows where the party sleeps on each night.

#### Acceptance Criteria

1. THE Trip_Service SHALL store a Trip's Stays in the table `trip_stays`, in the order of their `check_in` (Unscheduled_Stays after Scheduled_Stays, ordered by `position`).
2. EACH Stay SHALL have: `lodging_kind`; for `resort` a `resort_id` referencing an active catalog Resort; for `partner_hotel` and `offsite` a `place_name` of 1 to 100 characters; optionally both `check_in` and `check_out` (both or neither); and optional `party_keys`.
3. A `resort` Stay SHALL NOT carry a `place_name` (its name always comes from the catalog Resort); a `partner_hotel` or `offsite` Stay SHALL always carry one.
4. A Trip SHALL hold at most `TRIP_STAY_LIMIT` (8) Stays.
5. THE Trip_Service SHALL return each Stay with a `displayName`: the Resort's name for a `resort` Stay, otherwise the `place_name`.
6. THE Stays SHALL reference the catalog Resort by id and SHALL NOT copy Resort data.
7. WHEN a Trip is deleted, THE database SHALL delete its Stays through `ON DELETE CASCADE`.

### Requirement 2: Validation

**User Story:** As an Organizer, I want impossible stays rejected and unusual-but-valid ones allowed with a warning, so that I can record real trips without fighting the form.

#### Acceptance Criteria

1. IF a Scheduled_Stay has `check_out` on or before `check_in`, THEN THE Trip_Service SHALL reject the request with `trip_validation_failed` naming the stay.
2. IF two Scheduled_Stays share a Night (their half-open ranges `[check_in, check_out)` intersect), THEN THE Trip_Service SHALL reject the request with `trip_validation_failed`; two Stays that touch at a Hand_Off_Date SHALL be accepted.
3. IF a Scheduled_Stay is longer than `TRIP_STAY_MAX_NIGHTS` (60) nights, or the earliest `check_in` and the latest `check_out` of the Trip's Stays are more than `TRIP_STAY_SPAN_MAX_DAYS` (90) days apart, THEN THE Trip_Service SHALL reject the request.
4. IF a `resort` Stay references a Resort that does not exist or is not active, THEN THE Trip_Service SHALL reject the request and leave the Trip's Stays unchanged (as `trips` Requirement 21.4 does for resorts).
5. IF a `resort` Stay has no `resort_id` or has a `place_name`, or a `partner_hotel` or `offsite` Stay has no `place_name` or has a `resort_id`, THEN THE Trip_Service SHALL reject the request.
6. THE Trip_Service SHALL NOT reject a Stay because its dates fall outside the Trip's start and end dates, or because two Scheduled_Stays leave a gap; it SHALL report these as Stay_Warnings (Requirement 5).
7. THE same Resort MAY appear in more than one Stay (a party can return to a hotel after another).
8. WHEN a request is rejected, THE Trip_Service SHALL change none of the Trip's Stays (the replace is atomic).

### Requirement 3: Effective stays (the resolver)

**User Story:** As a developer of any feature that needs "where are we staying", I want one function that answers it for every Trip, including Trips with no or partial lodging data, so that features cannot disagree.

#### Acceptance Criteria

1. THE system SHALL provide a pure function `effectiveStays(trip, stays)` in `@dwt/shared` returning a list of Effective_Stays ordered by `checkIn`, each with `id` (null when synthesized), `lodgingKind`, `displayName`, `resortId`, `checkIn`, `checkOut`, `nights`, `partyKeys` and `source`.
2. WHEN the Trip has at least one Scheduled_Stay, THE resolver SHALL return those Stays (`source: 'stay'`) and, for every run of consecutive Trip nights (from Trip_Start_Date up to but not including Trip_End_Date) that no Scheduled_Stay covers, one synthesized `offsite` segment `source: 'implicit_gap'` whose `checkIn` is the first uncovered night and whose `checkOut` is the day after the last uncovered night.
3. WHEN the Trip has no Scheduled_Stay but has at least one Unscheduled_Stay, THE resolver SHALL return one segment `source: 'legacy_resorts'` spanning the Trip's dates, with the `lodgingKind` of the first Unscheduled_Stay by `position` and the legacy booking overrides applying as today (Requirement 9.6).
4. WHEN the Trip has no Stay at all, THE resolver SHALL return one `offsite` segment `source: 'implicit_no_lodging'` spanning the Trip's dates, matching today's behavior of a Trip with no resorts.
5. FOR a Trip whose dates are the same day, THE resolver SHALL return a segment whose `checkIn` equals its `checkOut` (zero nights) only for `implicit_no_lodging` and `legacy_resorts`.
6. THE resolver SHALL provide `stayForNight(effective, date)` returning the Effective_Stay whose Night is `date` or null, and `tonightsStay(effective, today)` returning `stayForNight(today)` when it exists, otherwise the Effective_Stay whose `checkOut` equals `today` (the stay being checked out of), otherwise null.
7. THE resolver SHALL be total: for any inputs it returns a (possibly empty-night) list and never throws.

### Requirement 4: Compatibility with `trip_resorts` and the legacy API

**User Story:** As a maintainer, I want every existing feature that reads the Trip's resorts to keep working unchanged, so that adding dates does not break stats, pins or summaries.

#### Acceptance Criteria

1. THE Trip_Service SHALL keep `trip_resorts` equal to the set of distinct `resort_id` values of the Trip's `resort` Stays, updated in the same transaction as every change to the Stays.
2. THE `TripDTO.resorts` projection SHALL be unchanged in shape and ordering (by name then id, `trips` Requirement 21.1).
3. WHEN `POST /trips` or `PATCH /trips/:id` supplies `resortIds` (the legacy field), THE Trip_Service SHALL compare the supplied set with the set of resorts of the Trip's current Stays; IF the sets are equal, THEN it SHALL change nothing; OTHERWISE it SHALL replace the Stays as follows: no ids clears every Stay; one id creates one `resort` Stay spanning the Trip's start and end dates (an Unscheduled_Stay when the Trip is a single day); several ids create one Unscheduled_Stay per id in the order given.
4. WHEN an edit changes the Trip's start or end date, AND the Trip has exactly one Scheduled_Stay whose dates equal the Trip's previous start and end, THE Trip_Service SHALL move that Stay to the new dates in the same transaction (an Unscheduled_Stay when the new dates are the same day); in every other case it SHALL leave the Stays unchanged.
5. THE existing readers of `trip_resorts` (booking `hasResortStay`, stats, summaries, pins) SHALL need no change and their tests SHALL pass unmodified.
6. WHERE the legacy `resortIds` field and the new Stays route are both used, THE last write SHALL win and the Trip's `trip_resorts` SHALL equal the resorts of its Stays after each write.

### Requirement 5: API and warnings

**User Story:** As a Mobile_App developer, I want the Stays in the Trip payload and one replace route, so that the screen is simple.

#### Acceptance Criteria

1. THE `TripDTO` SHALL gain `stays: TripStayDTO[]` and `stayWarnings: TripStayWarningDTO[]` additively; a Trip with no Stays SHALL return empty arrays; the Trip read paths SHALL load Stays with one batched statement for all returned Trips (no per-Trip query).
2. THE Trip_Service SHALL expose `PUT /trips/:id/stays` with body `{ stays: TripStayInput[] }` (at most 8), authorized as the existing `edit_settings` action (Organizer-only), returning `{ stays, stayWarnings }`.
3. THE route SHALL replace the Trip's Stays as one atomic change: an input with an `id` updates that Stay (keeping its id), an input without an `id` creates one, and a stored Stay whose id is absent from the input is deleted; stable ids SHALL be preserved so that features keyed by Stay id (the Dining Plan Calculator) keep their data.
4. IF an input `id` does not belong to the Trip, THEN THE Trip_Service SHALL reject the request with `trip_validation_failed`.
5. THE route SHALL run in a transaction that locks the Trip row, so that concurrent edits serialize.
6. IF a user who is not a Trip_Member requests the route, THEN THE Trip_Service SHALL respond `trip_forbidden`, identically for an unknown Trip; IF a Member who is not an Organizer calls it, THEN `trip_forbidden`.
7. THE Trip_Service SHALL compute Stay_Warnings on every read: `gap` for a run of Trip nights between two Scheduled_Stays that no Stay covers; `trip_not_covered` for Trip nights outside every Scheduled_Stay when at least one Scheduled_Stay exists; `outside_trip` for a Scheduled_Stay with a Night before Trip_Start_Date or on/after Trip_End_Date; `unscheduled` for each Unscheduled_Stay.
8. THE `PUT` SHALL write no Booking, Budget or Dining data.

### Requirement 6: Who is on each Stay

**User Story:** As an Organizer, I want to say that only some of the party is on a stay (a family in two rooms, or someone joining for the last hotel), so that features that depend on the room reservation are right for those people.

#### Acceptance Criteria

1. A Stay's `party_keys` SHALL be NULL (everyone on the Trip) or a list of at most 50 Person_Keys.
2. THE Trip_Service SHALL validate keys by format only; a key that names a person no longer on the Trip SHALL be stored and SHALL be ignored by consumers (stale keys are inert).
3. THE Trip_Service SHALL NOT store a reference to a user account for this purpose, so that account deletion needs no disposition entry for `trip_stays`.
4. THE edit sheet SHALL offer "Everyone" (stored as NULL) or a checklist of the Trip's current members and guests.
5. THE Effective_Stay list SHALL carry `partyKeys` unchanged for consumers; the resolver SHALL NOT itself filter by the Trip's current party.

### Requirement 7: Trip hub and edit screen

**User Story:** As a Trip_Member, I want the hub to show where we are staying and when, and as an Organizer I want to edit the stays in the same place I edit the trip, so that lodging is in one clear spot.

#### Acceptance Criteria

1. THE Trip_Detail_View SHALL replace the resort chip row inside the top hero card (above the Crew row) with a compact, collapsible 2-line stay summary header showing: a date-aware eyebrow (`CHECK-IN TODAY` when `WDW_Today` is a subsequent Stay's check-in date, `TONIGHT` when `WDW_Today` is an active Night of a Stay, `CHECK-OUT TODAY` on the final check-out date, or `STAYING AT` otherwise) with `(<index> of <total> stays)` when the Trip has more than one Stay; the primary Stay's `displayName` with any leading `"Disney's "` prefix stripped; and a compact date range pill (`Dec 15–16`, `Dec 28–Jan 3`, or `Dates not set`) with an expand/collapse chevron. Tapping the header SHALL toggle a compact expanded list of the Stays in order, each showing its shortened `displayName` on the left (with a `"Tonight"` pill on the active Stay, plus non-Disney kind or `"N of M people"` when set) and its compact date range with nights (`Dec 15–16 · 1n`, or `"Dates not set"`) on the right.
2. WHERE a Stay is unscheduled, THE expanded list SHALL show "Dates not set" and an action to add them (Organizer only).
3. WHERE `stayWarnings` is non-empty, THE collapsed header SHALL show a text alert badge naming the warning count and THE expanded list SHALL show each warning in words (for example "Dec 20 to Dec 31 has no lodging recorded"), never by colour alone.
4. THE Trip_Edit screen SHALL replace the resort multi-select with a "Where you're staying" section: an ordered list of Stays with add, edit, remove and reorder-by-date, opening a Stay sheet; saving calls `PUT /trips/:id/stays`.
5. THE Stay sheet SHALL offer: Lodging_Kind (Disney Resort, Partner hotel, Other lodging); for Disney Resort a searchable single-select of catalog Resorts (reusing the existing `ResortPicker` in single-selection use); for the other kinds a name field; check-in and check-out using the same date control as the Trip dates; "Who's staying" (Everyone or a checklist).
6. WHEN adding a Stay, THE sheet SHALL default `check_in` to the previous Stay's `check_out` (or the Trip start) and `check_out` to the Trip end.
7. A non-Organizer SHALL see the card read-only with no edit controls.
8. THE section SHALL follow the theming conventions and SHALL label every control; the kind and every warning SHALL be conveyed by text.

### Requirement 8: Live Glance shows tonight's hotel

**User Story:** As a Trip_Member on a split stay, I want the glance card to name the hotel I am actually in, so that it is right every day of the trip.

#### Acceptance Criteria

1. THE Live_Glance "No Scheduled Plans Today" message SHALL name the `displayName` of `tonightsStay(effectiveStays(...), today)` when it exists, in the form "Relax at <name> or explore Disney Springs!".
2. WHERE the Stay is `offsite` or `partner_hotel`, THE message SHALL use the same form with its `place_name`.
3. WHERE no Stay resolves, THE message SHALL use the existing fallback text.
4. WHERE the Trip has only Unscheduled_Stays, THE message SHALL use the first Stay's `displayName`, as today.
5. THE name SHALL change on the Hand_Off_Date to the incoming Stay (the Stay whose Night is today).

### Requirement 9: Booking timeline per Stay

**User Story:** As a Trip_Member on a split stay, I want booking reminders computed for each reservation, so that I do not miss the dining window for the second hotel.

#### Acceptance Criteria

1. THE Booking_Timeline derivation SHALL compute windows for each Effective_Stay with that Stay's `lodgingKind` for the dining rule and for the default Lightning Lane timing, its `checkIn` as the arrival, and the dates `checkIn` to `checkOut` inclusive as the stay dates.
2. WHEN two segments produce a window with the same `kind` and `dropOn`, THE derivation SHALL merge them into one window (the existing `windowKey` format `<kind>:<dropOn>`) whose `coveredDates` are the sorted union.
3. THE final list SHALL be sorted by the existing `compareWindows` order.
4. FOR a Trip whose resolver returns exactly one `legacy_resorts` or `implicit_no_lodging` segment, THE derivation SHALL return output deeply equal to the pre-change derivation for the same inputs (same windows, keys, covered dates and top-level fields); FOR a Trip with exactly one Scheduled_Stay equal to the Trip's start and end dates and kind `K`, the windows SHALL equal the pre-change derivation with a `stayType` override of `K` and no check-in override; both SHALL be pinned by tests over generated Trips.
5. THE trip-level `lightningLaneTiming` override SHALL still apply to every segment when set.
6. THE trip-level `stayType` and `checkInOverride` overrides SHALL apply only when the resolver returns a `legacy_resorts` or `implicit_no_lodging` segment; WHEN the Trip has at least one Scheduled_Stay they SHALL be ignored, and the booking settings screen SHALL say "Set per stay in Trip settings" and disable those two controls.
7. THE `BookingTimelineDTO` SHALL gain, additively, `stays: { stayId, lodgingKind, checkIn, checkOut, source }[]` and a `source` value `'stays'` for `stayType` and `arrivalDate` when derived from Stays; the first segment's values SHALL fill the existing `stayType` and `arrivalDate` fields. THE internal derived timeline (`DerivedTimeline`, whose field is named `arrival`) SHALL attach `stays` only when the stays path ran, so the output of the legacy path is unchanged.
8. THE reminder runner SHALL use the same derivation, so a second reservation's windows produce reminders with the existing idempotent claim keys.
9. THE derivation SHALL remain pure and SHALL not change `BOOKING_RULES_VERSION`.

### Requirement 10: Migration of existing trips

**User Story:** As the operator, I want existing trips to keep working and to gain stays where that is safe, so that nobody loses data or sees a changed timeline.

#### Acceptance Criteria

1. THE system SHALL create `trip_stays` in one migration (DDL only, compatible with the pg-mem migration helper) and SHALL backfill in a second, data-only migration that touches only Trips with no `trip_stays` rows (idempotent).
2. FOR a Trip with exactly one `trip_resorts` row, THE migration SHALL insert one Scheduled_Stay: `lodging_kind` from `trip_booking_settings.stay_type` when set and `resort` otherwise; `resort_id` for `resort`, otherwise `place_name` = the Resort's name; `check_in` = `trip_booking_settings.check_in_override` when it lies within 30 days before the Trip start and not after it, otherwise the Trip start; `check_out` = the Trip end; except that a Trip whose end is not after its `check_in` gets an Unscheduled_Stay.
3. FOR a Trip with several `trip_resorts` rows, THE migration SHALL insert one Unscheduled_Stay per row, `lodging_kind = 'resort'`, ordered by Resort name then id.
4. FOR a Trip with no `trip_resorts` row, THE migration SHALL insert nothing.
5. THE migration SHALL NOT modify or delete `trip_resorts`, `trip_booking_settings` or any Trip row.
6. THE booking timeline of every backfilled and non-backfilled Trip SHALL be unchanged by the migration (Requirement 9.4, tested over fixtures).

### Requirement 11: Visibility and account deletion

**User Story:** As a maintainer, I want stays to follow the existing privacy and deletion rules without special cases.

#### Acceptance Criteria

1. THE `trip_stays` table SHALL carry no reference to a user account; `party_keys` is plain text and inert once the person leaves the Trip or the account is deleted.
2. THE existing account-deletion registry test SHALL pass without a new disposition entry (there is no `REFERENCES users`); IF it requires one, THE implementer SHALL read why and report it rather than guess. Because `party_keys` holds person keys as text, THE `SOFT_REFERENCES` ledger in `accountDeletion/dispositions.ts` SHALL gain an entry for `trip_stays.party_keys` stating that the keys are inert once a person leaves the Trip or the account is deleted (they are ignored by every consumer, which build the party from visible members only); no scrub is required.
3. THE Trip_Service SHALL authorize reads through the existing Trip membership gate and writes through `edit_settings`; it SHALL NOT import `trips/effectiveRole.ts` or add a `trip_memberships` read.

### Requirement 12: Pure helpers and limits

**User Story:** As a developer, I want the date and overlap math in one tested place.

#### Acceptance Criteria

1. THE `@dwt/shared` module `tripStays.ts` SHALL export: the constants `TRIP_STAY_LIMIT`, `TRIP_STAY_MAX_NIGHTS`, `TRIP_STAY_SPAN_MAX_DAYS`, `TRIP_STAY_PLACE_NAME_MAX`; `personKeySchema`; `tripStayInputSchema`, `tripStaysPutSchema`; the DTO types; `validateStays`; `effectiveStays`; `stayForNight`; `tonightsStay`; `stayNights`; `computeStayWarnings`.
2. ALL date arithmetic SHALL be on calendar-date strings with UTC-midnight math (never a local-time `Date`).
3. THE write path SHALL be bounded: at most 8 Stays, 50 keys each, no network I/O.

### Requirement 13: Cross-spec amendments (additive)

**User Story:** As a maintainer, I want the specs this feature touches to record it.

#### Acceptance Criteria

1. THE `trips` spec SHALL gain the next free requirement number (expected 26) describing Stays, the `PUT /trips/:id/stays` route, the hub card and edit section, and the compatibility rules of Requirement 4; `trips` Requirement 21 SHALL remain unchanged.
2. THE `trip-booking-timeline` spec SHALL gain the next free requirement number describing Requirement 9.
3. THE `dining-plan-calculator` spec SHALL list this spec as a dependency and consume `effectiveStays` (amended there).
4. EACH amendment SHALL be additive: no existing requirement, criterion or design section SHALL be removed or renumbered, and numbers SHALL be re-checked against the target file when written.
