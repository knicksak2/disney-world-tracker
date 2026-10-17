# Implementation Plan: Trip Booking Timeline

## Overview

This plan adds three things to the Trip Hub: a **derived** booking timeline (Advance Dining and Lightning Lane drop dates), **push reminders** tied to those drops, and a collaborative **packing list**. It is a new sibling service to `trips` and `tripExpenses`: `apps/api/src/services/tripBooking/`, five new tables in migration `0061`, a new `@dwt/shared` module (`packages/shared/src/tripBooking.ts`), two new mobile screens plus two modals, and two new hub tiles on `TripDetailScreen`.

**Read before starting:** `.kiro/steering/tech-conventions.md`, `.kiro/steering/execution-discipline.md`, and all of `requirements.md` and `design.md` in this folder. `design.md` is authoritative for concrete defaults, env var names, SQL, formulas, and file placement (Configuration & Constants, External Interfaces, Components and Interfaces, Data Models). Do not invent alternatives. Do not edit `requirements.md` or `design.md` except where a task says so, and then only additively.

**Build order (design):** (a) shared enums, rules, dates, schemas, DTOs; (b) pure API modules plus property tests; (c) migration `0061`, repo, `permissions.ts`; (d) routes; (e) config, runner, internal endpoint, Notification_Service handler; (f) `composeServices.ts` and `server.ts` wiring; (g) mobile API client, view modules, screens, hub tiles, stack routes, tap routing; (h) ops docs and the operator cron setup.

**Cross-spec dependencies:** hard on `trips` (Trip, `trip_memberships`, `trip_resorts`, `permissions.ts`, `authz.ts`, `wdwClock.ts`, `formatCalendarDate`, `TripDetailScreen`, `tripsListNotice`); read-only on `trip-reservations` (`planned_items.reservation_kind`, `planned_date`); infrastructure on `notification-center` and `social-sharing-loop` (Notification_Service, `push_delivery_log`, `useNotificationResponse`). `trip-expenses` is a sibling with no dependency.

**Migration number:** `apps/api/migrations/0060_trip_expenses.sql` is currently the latest file on disk, so this plan uses `0061`. If another spec lands a `0061` first, renumber this one (file name, `migration0061.test.ts`, the vocabulary-parity test path, and every reference in this spec and in `docs/hosting.md`). Never edit an applied migration. Any migration that extends `push_delivery_log_kind_chk` must re-add the constraint with the union of every kind already allowed, including `trip_booking_reminder`.

**Verification discipline (execution-discipline.md):** tests ship in the same task as the code they cover; none are optional. While iterating, run only the single test file you are editing (`npx vitest run <path>` in `apps/api` or `packages/shared`, `npx jest <file>` in `apps/mobile`) plus `npm run typecheck` after contract changes. Checkpoints run the scoped `npm run verify:shared` / `verify:api` / `verify:mobile`. Only the final checkpoint runs the full `npm run verify`, once, and pastes the literal tail and exit code. A vitest or jest run is never the gate. Edit source directly (no codegen or `sed` scripts) and leave no stray files.

**Test conventions:** property tests use `fast-check`, `numRuns >= 100`, one `fc.assert` per property, tagged `// Feature: trip-booking-timeline, Property N: <text>`. Each task below lists its tests and the assertion that would fail if the behavior were wrong. A task is not done until those tests exist and pass.

## Tasks

- [x] 1. Shared contracts: vocabularies, rules, dates, schemas, DTOs
  - [x] 1.1 Add vocabularies and rule constants to `@dwt/shared`
    - In `packages/shared/src/enums.ts` add `STAY_TYPES`/`StayType`, `LIGHTNING_LANE_TIMINGS`/`LightningLaneTiming`, `WINDOW_KINDS`/`WindowKind` (order `dining`, `lightning_lane` is the tie-break order), `WINDOW_STATUSES`/`WindowStatus`, `REMINDER_LEADS`/`ReminderLead`, `PACKING_CATEGORIES`/`PackingCategory` (order is display order), exactly as in design.md "Shared contracts".
    - Create `packages/shared/src/tripBooking.ts` with `BOOKING_RULES_VERSION = 1`, the `WindowRule` interface, `BOOKING_RULES`, `REMINDER_LEAD_SCHEDULE`, `CHECK_IN_OVERRIDE_MAX_DAYS_BEFORE_START = 30`, `PACKING_LIST_MAX_ITEMS = 300`, `PACKING_NAME_MAX = 80`, `PACKING_QUANTITY_MIN/MAX = 1/99`, `BOOKING_REMINDER_BODY_MAX = 100`, and `STARTER_PACKING_LIST` with the 21 entries listed in design.md "Starter_List" (quantity 1 each). Re-export from `packages/shared/src/index.ts`. No other file may contain an offset, Drop_Time, or cover-days literal (R1.1).
    - Tests: `packages/shared/src/__tests__/tripBooking.rules.test.ts`. Assert `BOOKING_RULES.dining.dropMinutes === 360` and `lightning_lane.dropMinutes === 420`; the `byStayType`/`byTiming` entries equal the design table field-for-field (a changed offset fails); `defaultTimingByStayType` is `seven_day` for `resort` and `partner_hotel` and `three_day` for `offsite`; `BOOKING_RULES_VERSION` is a positive integer; `STARTER_PACKING_LIST` has every name 1 to 80 chars, every category in `PACKING_CATEGORIES`, every quantity 1, names unique under `trim().toLowerCase()`, and `.length === 21` (this is the only place a literal 21 appears; every other test uses `.length`).
    - _Requirements: 1.1, 1.14, 11.2, 11.10, 15.1, 15.2_
  - [x] 1.2 Add calendar-date helpers, override predicate, and formatters
    - In `tripBooking.ts` add `addCalendarDays`, `diffCalendarDays`, `listCalendarDates` (inclusive, `[]` when `to < from`), `checkInOverrideRange`, `isCheckInOverrideValid`, `formatMonthDay` (fixed English month table, no `Intl`), and `formatDateRange` (equal dates give `Jun 1`, otherwise `Jun 1 – Jun 5`). All UTC-only `Date.UTC` arithmetic (R1.2). `isCheckInOverrideValid` is the single predicate used by API and mobile.
    - Tests: `packages/shared/src/__tests__/tripBooking.prop.test.ts`.
    - **Property 3 (calendar half): Calendar arithmetic is DST-immune.** Generator biased to `2025-03-09`, `2025-11-02` and their neighbours, `k` in -400..400. Assert `addCalendarDays(addCalendarDays(d, k), -k) === d` and `diffCalendarDays(addCalendarDays(d, k), d) === k`; fails if a local-time `Date` is used.
    - **Property 6 (predicate half): Override range is exactly `[start - 30, start]`.** Assert `isCheckInOverrideValid(o, start)` is true iff `o >= start - 30d && o <= start`; example cases at `start - 31` (false), `start - 30` (true), `start` (true), `start + 1` (false).
    - Unit cases: `listCalendarDates('2025-06-05','2025-06-01')` is `[]`; `formatDateRange('2025-06-01','2025-06-01')` is `Jun 1`; `formatDateRange('2025-06-01','2025-06-05')` is `Jun 1 – Jun 5`.
    - **Validates: Requirements 1.2, 2.2, 2.3, 6.14**
    - _Requirements: 1.2, 2.2, 2.3, 6.14_
  - [x] 1.3 Add Zod schemas and DTOs
    - In `tripBooking.ts` add every schema in design.md (`bookingSettingsUpdateSchema` with the at-least-one-key `superRefine`, `windowDoneSchema`, `reminderMuteSchema`, `windowDoneParamsSchema`, `packingItemCreateSchema`, `packingItemUpdateSchema` with the at-least-one-key refine, `packingItemPackedSchema`). All objects `.strict()`; every violation carries the message `trip_validation_failed`. Add the DTO types `BookingWindowDTO`, `BookingTimelineDTO`, `BookingSettingsDTO`, `BookingReminderMuteDTO`, `PackingItemDTO`, `PackingListDTO`, `StarterPackingEntry`. Confirm `tripCalendarDateSchema` and `uuidSchema` are imported from their existing homes, not redeclared.
    - Tests: `packages/shared/src/__tests__/tripBooking.schemas.test.ts` with a valid and an invalid case per schema, plus:
    - **Property 29 (schema half): Packing input accepted exactly when it satisfies the schema.** Generator: names with leading/trailing/only whitespace and lengths 0, 1, 80, 81; quantities incl. non-integers, 0, 1, 99, 100, strings; categories in/out of vocabulary; extra keys. Assert accept iff trimmed name length is 1..80, quantity is an integer 1..99 (absent allowed on create), category in vocabulary, no unknown key; accepted name is trimmed; an update with no key fails.
    - Examples: a `bookingSettingsUpdateSchema` body `{}` fails; `{ checkInOverride: null }` passes (null counts as present); `{ userId: '...' , muted: true }` fails `reminderMuteSchema` (R12.3 groundwork); `{ done: 'yes' }` fails.
    - **Validates: Requirements 2.11, 5.4, 9.13, 11.2, 11.7, 12.3, 15.1, 15.6**
    - _Requirements: 2.4, 2.5, 2.11, 5.4, 9.13, 11.2, 11.7, 12.3, 15.1, 15.5, 15.6_

- [x] 2. Checkpoint - shared contracts compile and pass
  - Run `npm run verify:shared` and paste the tail and exit code. Do not start task 3 until green: every later task imports from `packages/shared/src/tripBooking.ts`.
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Pure API domain modules (the property-test surface)
  - [x] 3.1 `timeline.ts`: settings resolution and window derivation
    - Create `apps/api/src/services/tripBooking/timeline.ts` with `StoredBookingSettings`, `TimelineTripInput`, `DerivedWindow`, `DerivedTimeline`, `resolveSettings`, `applyRule`, `mk`, `compareWindows`, `deriveBookingTimeline` exactly as in design.md. Drop_At via `wdwIsoAtMinutes` from `../trips/wdwClock.js`; no clock reads; no literals outside `BOOKING_RULES`.
    - Tests: `apps/api/src/services/tripBooking/__tests__/timeline.prop.test.ts`. The oracle for P2 hard-codes 60/10/7/14/3 independently of the table, so editing the table without the oracle fails.
    - **Property 1: Covered_Dates partition the Stay_Dates and Window_Keys are unique.** Fails if a date is dropped/duplicated or two `windowKey`s collide, including when `end < arrival`.
    - **Property 2: Anchor, offset, and count follow the table.** Fails if resort dining head covers other than min(n,10), if `seven_day` emits a second window when `n <= 14`, or if `three_day_daily` is not one per date.
    - **Property 3 (Drop_At half): Drop_At is exact WDW wall-clock.** `wdwMinutesFromMidnight(dropOn, dropAt)` is 360 for dining and 420 for lightning_lane; dropAt is 10:00Z/11:00Z in EDT and 11:00Z/12:00Z in EST; generator includes `2025-03-09` and `2025-11-02`.
    - **Property 4: Ordered, deterministic, versioned, total.** Run under a stubbed clock that throws; two derivations deep-equal; sorted by dropAt then dining-before-LL then earliest covered date; `rulesVersion === BOOKING_RULES_VERSION`; zero windows (no throw) when end precedes arrival.
    - **Property 5: Shifting by k days shifts the timeline by k days.** Every `dropOn` and covered date shifts by k; `dropAt` is the Drop_Time on the shifted `dropOn` (not `+k*24h`); same count and sizes.
    - **Property 6 (resolution half): Settings resolution.** Stored/auto/override values and `source` fields exactly as R2.1, R2.2, R2.9; override outside `[start-30,start]` is ignored with source `trip_start` and the input is not mutated (deep-frozen input).
    - Unit example: resort party arriving `2025-06-14`, 5 nights, default settings yields dining `dropOn 2025-04-15` (`dropAt 2025-04-15T10:00:00Z`) and LL `dropOn 2025-06-07` (`dropAt 2025-06-07T11:00:00Z`), the design's reminder-timeline example.
    - **Validates: Requirements 1.1, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 1.13, 1.14, 1.15, 2.1, 2.2, 2.3, 2.9, 3.2, 4.1, 4.2, 4.7, 14.4**
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 1.13, 1.14, 1.15, 2.1, 2.2, 2.3, 2.9, 3.2, 4.1, 4.2, 4.7, 14.4_
  - [x] 3.2 `timeline.ts`: read-time annotation
    - Append `AnnotateContext`, `windowStatus`, `daysUntilDrop`, `bookedCount`, `annotateWindows` to `timeline.ts`. `today = wdwToday(ctx.now)`; `now` is captured once by the caller; `bookedCount` never feeds status or done.
    - Tests: `apps/api/src/services/tripBooking/__tests__/annotate.prop.test.ts`.
    - **Property 8: Status is monotone in one instant and countdown matches.** Fails if `dropAt === now` is `upcoming` (equality means opened) or if `daysUntilDrop` is non-null when not `upcoming`; sweeping `now` upward only moves `upcoming -> open -> past`; `past` windows are still returned.
    - **Property 9: Done and bookedCount are independent annotations.** `done` iff a mark for the windowKey exists with marker name/instant present only then; `bookedCount` equals the count of same-kind reservations whose `plannedDate` is covered; changing reservations or marks changes no `status`/`daysUntilDrop`/other window.
    - **Property 10: Done marks follow the Window_Key across a date change.** After a shift, `done` iff the NEW key has a mark; a mark under a vanished key applies to no window and is not modified; an unchanged key keeps `done`.
    - **Validates: Requirements 3.3, 3.4, 3.5, 3.6, 3.7, 4.4, 4.6, 5.7, 5.8**
    - _Requirements: 3.3, 3.4, 3.5, 3.6, 3.7, 4.4, 4.6, 5.7, 5.8_
  - [x] 3.3 `settings.ts`: null-aware merge
    - Create `apps/api/src/services/tripBooking/settings.ts` with `applySettingsUpdate(current, update, tripStart)`: supplied keys (including `null`) overwrite, omitted keys untouched, throws `AppError('trip_validation_failed')` when a non-null `checkInOverride` fails `isCheckInOverrideValid`, all-or-nothing.
    - Tests: `apps/api/src/services/tripBooking/__tests__/settings.prop.test.ts`.
    - **Property 7: Booking-settings updates are null-aware, merge-only, atomic.** Fails if an explicit `null` is treated as omitted, if an omitted key changes, or if an invalid override still lets an individually valid sibling field through (the thrown path returns nothing and mutates nothing).
    - **Validates: Requirements 2.4, 2.5, 2.11**
    - _Requirements: 2.4, 2.5, 2.11_
  - [x] 3.4 `reminders.ts`: Fire_At, due decision, Send_Window, horizon, candidate predicate
    - Create `apps/api/src/services/tripBooking/reminders.ts` with `ReminderEnv`, `DueReminder`, `reminderFireAt`, `ledgerKey`, `isDue`, `deriveDueReminders`, `inSendWindow`, `reminderHorizonDays`, `reminderHorizonDate`, `isCandidateTrip`. The horizon's 60 is read from `BOOKING_RULES` (largest head offset), not hard-coded; lead offset floors at 1 (61 default, 67 with `week`).
    - Tests: `apps/api/src/services/tripBooking/__tests__/reminders.prop.test.ts`.
    - **Property 12: Fire_At matches the lead schedule.** `eve` is 20:00 WDW on `dropOn-1`, `week` is 09:00 on `dropOn-7`, `open === dropAt`, verified with `wdwMinutesFromMidnight`, generator includes DST `dropOn` dates.
    - **Property 13: Due exactly inside catch-up and not suppressed.** Returned iff lead enabled, `fireAt <= now < fireAt + catchup`, key not done, last covered date `>= today`, ledger key not claimed. Fails if the upper bound is inclusive or if a claimed key is re-returned; removing a done key re-introduces only unclaimed reminders.
    - **Property 16: Date change yields fresh reminders and no stale ones.** Ledger keys for a shifted window differ from pre-shift keys, so a ledger of every pre-shift key suppresses nothing post-shift.
    - **Property 28: Horizon soundness.** If `deriveDueReminders` returns anything then `isCandidateTrip(...)` is true, including the `week` lead on the primary dining window and a valid override preceding start; `reminderHorizonDays(['eve','open']) === 61` and `(['eve','open','week']) === 67` (fails if the `week` offset is ignored).
    - Example: `inSendWindow(360, 360, 1380)` true, `(1380, 360, 1380)` false, `(359, ...)` false.
    - **Validates: Requirements 4.3, 4.8, 5.9, 5.10, 7.1, 7.3, 7.4, 7.5, 7.7, 7.8, 8.14**
    - _Requirements: 4.3, 4.8, 5.9, 5.10, 7.1, 7.3, 7.4, 7.5, 7.7, 7.8, 8.14_
  - [x] 3.5 `reminders.ts`: coalescing and recipients
    - Append `ReminderGroup`, `coalesceReminders`, and `selectRecipients` to `reminders.ts`. Group by lead (order of `REMINDER_LEADS`); one entry per kind (earliest dropAt, min firstCovered, max lastCovered); dining before lightning_lane; `reminderCount` conserves input.
    - Tests: add to `reminders.prop.test.ts` (separate `describe`).
    - **Property 17: Coalescing conserves reminders and respects kind and range rules.** `sum(reminderCount) === input.length`; each group has each kind at most once (<= 2 entries); entry range is min..max of that kind's reminders in that lead; fails if two leads are merged into one group.
    - **Property 18: Recipients are members minus muted.** `selectRecipients(members, muted)` equals the sorted set difference with duplicates removed; muted ids that are not members have no effect.
    - **Validates: Requirements 9.3, 9.4, 9.11**
    - _Requirements: 9.3, 9.4, 9.11_
  - [x] 3.6 `passGate.ts`: pass gating and secret comparison
    - Create `apps/api/src/services/tripBooking/passGate.ts` with `PassDecision`, `decidePassStart` (start-to-start debounce), and `secretMatches(provided, expected)` (SHA-256 both sides then `timingSafeEqual`; non-string or empty is false). `secretMatches` lives here (pure, no Fastify import) and is imported by `routes.ts`.
    - Tests: `apps/api/src/services/tripBooking/__tests__/passGate.prop.test.ts`.
    - **Property 24: At most one pass at a time with start-to-start debounce.** Simulate `(requestTimeMs, passDurationMs)` sequences; no overlap; requests during a pass are `skip_in_flight`; an idle request starts iff `now - lastStart >= minInterval` (fails if the debounce is measured from pass end); for every `minInterval` in 60..599 s, two requests exactly 600 s apart always start the later one.
    - **Property 25 (pure half): Only the exact secret matches.** Generator: missing, empty, wrong, case-differing, extra whitespace, array. `secretMatches` true iff byte-equal string.
    - **Validates: Requirements 8.1, 8.5, 8.6, 8.7, 8.13, 8.15**
    - _Requirements: 8.1, 8.2, 8.5, 8.6, 8.7, 8.13, 8.15_
  - [x] 3.7 `reminderConfig.ts`: lead and clock parsing
    - Create `apps/api/src/services/tripBooking/reminderConfig.ts` with `parseReminderLeads`, `parseClockMinutes`, and the `ReminderConfig` interface.
    - Tests: `apps/api/src/services/tripBooking/__tests__/reminderConfig.prop.test.ts`.
    - **Property 14: Lead parsing ignores unknown tokens; empty derives nothing.** Output is a subset of `REMINDER_LEADS`, de-duplicated, canonical order, case/whitespace tolerant; with an empty set `deriveDueReminders` returns `[]` for any input (import from task 3.4). Examples: `'eve, OPEN ,bogus,eve'` gives `['eve','open']`; `''` gives `[]`; `parseClockMinutes('06:00') === 360`, `('24:00')`, `('6:0')`, `('abc')` are `null`.
    - **Validates: Requirements 7.2**
    - _Requirements: 7.2_
  - [x] 3.8 `packing.ts`: packing rules
    - Create `apps/api/src/services/tripBooking/packing.ts` with `normalizeName`, `nameKey`, `selectStarterToAdd`, `wouldExceedCap`, `sortPackingItems`, `summarizePacking`, `projectAssignee`, `nextPackedState`.
    - Tests: `apps/api/src/services/tripBooking/__tests__/packing.prop.test.ts`.
    - **Property 30 (pure half): `wouldExceedCap(c,k)` iff `c + k > 300`.** Fails on an off-by-one at 300.
    - **Property 31: Starter adds exactly the missing entries and is idempotent.** Existing names with arbitrary case/whitespace; result preserves list order; applying the result then re-running yields `[]`; empty existing yields `STARTER_PACKING_LIST.length` entries.
    - **Property 32 (sort and summary half): Sort/summary consistent.** Order is category index, then `createdAt`, then `id`; `totalCount`/`packedCount` independent of filter.
    - **Property 33 (transition half): Packed-state transitions.** Same state returns the previous state unchanged (marker and instant not overwritten); to-packed records `(userId, nowIso)`; to-unpacked clears both; result always satisfies `packed => packedAt != null` and `!packed => packedBy == null && packedAt == null`; last toggle wins.
    - **Property 34: Departed assignee projected as unassigned.** `assigneeIsMember === false` gives both null; true returns stored id/name; input not mutated.
    - **Validates: Requirements 11.3, 11.4, 11.5, 11.6, 11.9, 11.10, 11.11, 14.5**
    - _Requirements: 11.3, 11.4, 11.5, 11.6, 11.9, 11.10, 11.11, 14.5_
  - [x] 3.9 `packingAuth.ts`: per-item authorization rule
    - Create `apps/api/src/services/tripBooking/packingAuth.ts` with `canModifyPackingItem(role, callerId, addedBy)`.
    - Tests: `apps/api/src/services/tripBooking/__tests__/packingAuth.prop.test.ts`.
    - **Property 35 (pure half): Only the adder or an Organizer may modify.** True iff `role === 'organizer' || callerId === addedBy`; a member whose id differs from `addedBy` is denied; when the adder has left the Trip (so can never be `callerId`) only an organizer passes.
    - **Validates: Requirements 12.4**
    - _Requirements: 12.4_
  - [x] 3.10 `bookingReminderCompose.ts`: notification copy
    - Create `apps/api/src/services/notifications/bookingReminderCompose.ts` (pure) with `REMINDER_TITLES`, `composeBookingReminder`, `formatClock12`, `sliceSafe`; reuse `formatMonthDay`/`formatDateRange` from `@dwt/shared`. Declare the `TripBookingReminderEvent` shape locally here or in `service.ts`'s event types per the existing "declare in the producer, mirror in the consumer" convention (see `trips/events.ts`).
    - Tests: `apps/api/src/services/notifications/__tests__/bookingReminderCompose.prop.test.ts`.
    - **Property 19: Body is at most 100 chars and the Trip name is shortened first.** Names empty, whitespace, very long, emoji/surrogate pairs; `body.length <= 100`; when over, only the name is shortened (ends in `…`, never splits a surrogate); name dropped only when one char plus ellipsis does not fit; whole-body cut only if still over without the name. Fails if the body is cut mid-surrogate.
    - **Property 20: Title follows the lead; "Opened at" appears exactly when a window has opened.** Titles are exactly `Booking window opens tomorrow` / `Booking window is open` / `Booking window in 7 days`; body starts with `Opened at <h:mm AM|PM>: ` iff some window has `dropAt <= dispatchedAt` (equality counts), showing the earliest such window's `America/New_York` time (6:00 AM / 7:00 AM); an `open`-lead event built at its fire instant always carries the prefix.
    - Unit examples: dining 2025-04-15 to 2025-04-19 gives `Dining for Apr 15 – Apr 19 · <name>`; single date gives `Apr 15`.
    - **Validates: Requirements 7.6, 9.6**
    - _Requirements: 7.6, 9.6_

- [x] 4. Checkpoint - pure modules
  - Run `npm run verify:api` and paste the tail and exit code. These modules have no I/O, so the repo and route work that follows should be wiring, not debugging domain logic.
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Migration 0061, repo, and permissions
  - [x] 5.1 Migration `0061_trip_booking_timeline.sql` and `migration0061.test.ts`
    - Create `apps/api/migrations/0061_trip_booking_timeline.sql` exactly as in design.md "Data Models": `trip_booking_settings`, `trip_booking_window_done`, `trip_booking_reminder_mutes`, `trip_booking_reminder_log` (+ `drop_at` index), `trip_packing_items` (+ index), all `IF NOT EXISTS`, `BEGIN`/`COMMIT`, `gen_random_uuid()`, `TIMESTAMPTZ`, named `CHECK`s, `ON DELETE CASCADE` to `trips(id)`.
    - **`push_delivery_log_kind_chk` (design conflict C1):** after the tables, `ALTER TABLE push_delivery_log DROP CONSTRAINT IF EXISTS push_delivery_log_kind_chk;` then `ALTER TABLE push_delivery_log ADD CONSTRAINT push_delivery_log_kind_chk CHECK (notification_kind IN (...))` with the full list from `0056_admin_panel.sql` (`share_delivered`, `friend_request_received`, `trip_invite_created`, `rode_with_tag_created`, `food_list_shared`, `food_list_role_changed`, `experience_list_shared`, `experience_list_role_changed`) plus `trip_booking_reminder`. Open `0056_admin_panel.sql` and copy the list from the real file rather than from memory. Do not edit `0056`. If another migration has since extended the list, include its kinds too (union). Before writing, `ls apps/api/migrations` and renumber if `0061` is taken.
    - Tests: `apps/api/src/db/__tests__/migration0061.test.ts` (pg-mem, following `migration0060.test.ts`). Assert: all five tables and columns/types; each `CHECK` rejects (`stay_type='x'`, `lightning_lane_timing='x'`, `window_kind='x'`, `reminder_lead='x'`, `category='x'`, `quantity` 0 and 100, empty/whitespace `name`, `packed=true` with null `packed_at`, `packed=false` with non-null `packed_by`); PKs reject duplicates; every FK to `trips(id)` cascades (delete a Trip, all five tables empty for it, `planned_items` untouched); reapplying the file leaves rows and constraints unchanged and does not throw; file text contains `BEGIN` and `COMMIT`.
    - **`push_delivery_log` cases:** inserting `notification_kind = 'trip_booking_reminder'` is accepted; inserting `'not_a_kind'` is rejected by `push_delivery_log_kind_chk`; each of the eight `0056` kinds is still accepted (the replaced constraint is the full union). These fail if the constraint is not replaced or if a `0056` kind is dropped.
    - _Requirements: 9.10, 14.1, 14.4, 14.5, 14.6, 14.9, 14.10_
  - [x] 5.2 Vocabulary parity test
    - Create `packages/shared/src/__tests__/tripBooking.vocab.test.ts`: read `apps/api/migrations/0061_trip_booking_timeline.sql`, parse each `IN (...)` set for `stay_type`, `lightning_lane_timing`, `window_kind` (both tables), `reminder_lead`, `category`, and assert set-equality (same members, no extras) with `STAY_TYPES`, `LIGHTNING_LANE_TIMINGS`, `WINDOW_KINDS`, `REMINDER_LEADS`, `PACKING_CATEGORIES`. The test fails if either side adds a member.
    - _Requirements: 14.9, 15.2_
  - [x] 5.3 `permissions.ts`: six new actions and the matrix test
    - In `apps/api/src/services/trips/permissions.ts` add `add_packing_item`, `toggle_packing_item`, `edit_packing_item`, `mark_booking_window_done`, `set_booking_reminder_mute` to `MEMBER_ACTIONS`, and `edit_booking_settings` to `ORGANIZER_ONLY_ACTIONS`; `can()` unchanged.
    - Tests: update `apps/api/src/services/trips/__tests__/permissions.matrix.prop.test.ts`. Extend its independently declared `MEMBER_ALLOWED`/`ORGANIZER_ONLY` oracle lists with the five member actions and `edit_booking_settings`, and **also add the two real member actions the oracle currently omits, `edit_planned_item` and `optimize_day`** (both exist in `permissions.ts`). Do not derive the oracle from the module under test.
    - **Property 36: Members get the five shared actions, Organizers all six.** `can('organizer', a)` true for all six; `can('member', a)` true for the five and false for `edit_booking_settings`; a user with no membership is permitted none. Fails if `edit_booking_settings` is added to `MEMBER_ACTIONS`.
    - **Validates: Requirements 12.1, 12.2, 12.5, 12.9, 2.6**
    - _Requirements: 2.6, 12.1, 12.2, 12.5, 12.9_
  - [x] 5.4 `repo.ts` part A: timeline inputs, settings, done marks, mutes
    - Create `apps/api/src/services/tripBooking/repo.ts` with `createTripBookingRepo(pool: DbPool)` and the `TimelineReadModel` type. Declare the repo interface as parts (`BookingTimelineRepo`, `PackingRepo`, `ReminderRunnerRepo` from `runner.ts` in task 5.5) whose intersection becomes `TripBookingRepo` in task 5.6, so each task typechecks on its own. Implement `getTimelineInputs` (3 reads, returns `null` when the Trip is gone), `patchBookingSettings` (transaction: `SELECT start_date FROM trips WHERE id=$1 FOR UPDATE`, read current row, `applySettingsUpdate`, full-row `INSERT ... ON CONFLICT (trip_id) DO UPDATE ... RETURNING`), `setWindowDone` (`ON CONFLICT DO NOTHING` / `DELETE`), `setReminderMute` (same). Reuse `formatCalendarDate` from `trips/repo.ts` for every `DATE`.
    - Tests: `apps/api/src/services/tripBooking/__tests__/repo.settings.integration.test.ts` on pg-mem using the `tripExpenses/__tests__/testDb.ts` harness (adapt `= ANY($n)` where pg-mem needs it). Every test reads the stored row back with raw SQL.
    - **Property 11: Done and mute writes are idempotent, one row per key.** Async fast-check (>= 100 runs) of small op sequences against an in-memory model: after each step at most one row per `(trip, kind, dropOn)` and per `(trip, user)`; `done=true` on an existing mark leaves `marked_by` and `marked_at` unchanged (fails if the upsert uses `DO UPDATE`); `done=false` removes it; settings writes leave exactly one row per Trip.
    - Read-back regression tests: after `patchBookingSettings({ stayType: 'resort' })` the row's `stay_type = 'resort'` and `lightning_lane_timing`, `check_in_override` are unchanged; after `{ lightningLaneTiming: null }` that column is NULL while others are untouched (fails if `null` is treated as omitted); an out-of-range override throws `trip_validation_failed` and the row is unchanged, including a valid sibling field in the same call; an override that becomes invalid after the Trip start moves is retained in the row, and `getTimelineInputs` still returns it.
    - `getTimelineInputs` performs no writes (row counts of all five tables identical before and after, R3.8); returns `null` for an unknown Trip; `viewerMuted` is true only for the caller's own mute; cascade delete of the Trip removes all rows.
    - _Requirements: 2.4, 2.5, 2.7, 3.8, 3.11, 5.1, 5.2, 5.6, 9.8, 14.1, 14.4, 14.6_
  - [x] 5.5 `repo.ts` part B: reminder-runner port, ledger claim, candidates, prune
    - First create `apps/api/src/services/tripBooking/events.ts` (`TripBookingReminderNotice`) and the **type surface** of `apps/api/src/services/tripBooking/runner.ts`: `TRIPS_PER_PASS = 500`, `CandidateTrip`, `ReminderRunnerRepo`, `ReminderRunnerDeps`, `StartResult`, `PassSummary`, `ReminderRunner` (implementation `createReminderRunner` arrives in task 8.2). Then in `repo.ts` implement `listCandidateTrips` (SQL from design.md, ordered `start_date, id`, `LIMIT`), `listDoneKeys`, `listClaimedKeys` (one query each, skip when `tripIds` is empty, keys rebuilt in TS), `claimReminder` (`INSERT ... ON CONFLICT DO NOTHING RETURNING trip_id`; true iff a row came back), `listReminderRecipients` (members LEFT JOIN mutes), `pruneLedger` (`DELETE ... WHERE drop_at < $1`).
    - Tests: `apps/api/src/services/tripBooking/__tests__/repo.reminders.integration.test.ts` (pg-mem).
    - **Property 27: Pruning deletes exactly rows older than the cutoff.** Generator of ledger rows with arbitrary `drop_at`; after `pruneLedger(cutoff)` the survivors are exactly `drop_at >= cutoff`; a row at exactly the cutoff is retained (fails with `<=`).
    - **Conflict-ignoring claim:** calling `claimReminder` twice with the same key returns `true` then `false` and the table holds one row (fails if the insert is not conflict-ignoring or if the PK omits `reminder_lead`); a different `reminder_lead` or `drop_at` for the same window yields a new row (supports R4.3).
    - **Candidate query:** a Trip with `end_date < today` is excluded; a Trip with `start_date <= horizon` is included; a Trip with `start_date > horizon` but a stored `check_in_override <= horizon` is included; ordering is `(start_date, id)`; `limit` is honored (500 cap via small `limit`); `hasResortStay` is true only when a `trip_resorts` row exists; stored settings are returned verbatim.
    - `listReminderRecipients` excludes muted members and non-members; `listDoneKeys`/`listClaimedKeys` return keys for only the requested Trip ids and `listClaimedKeys` honours `sinceIso`.
    - _Requirements: 4.3, 7.7, 9.1, 9.2, 9.4, 14.2, 14.3_
  - [x] 5.6 `repo.ts` part C: packing list with Trip-row-lock cap
    - Implement `listPacking`, `getPackingItemOwner`, `addPackingItem`, `updatePackingItem`, `removePackingItem`, `setPacked`, `addStarterItems`, and finalize `TripBookingRepo = BookingTimelineRepo & PackingRepo & ReminderRunnerRepo`. `addPackingItem` and `addStarterItems` open a transaction, `SELECT id FROM trips WHERE id = $1 FOR UPDATE`, count existing items, call `wouldExceedCap`, validate assignee membership (`R11.4`), then insert (starter: one multi-row `VALUES`, no `unnest`). `setPacked` row-locks the item `FOR UPDATE` and uses `nextPackedState`. Project the assignee with `projectAssignee`; join display names for adder, assignee, packer.
    - Tests: `apps/api/src/services/tripBooking/__tests__/repo.packing.integration.test.ts` (pg-mem), reading rows back with raw SQL.
    - **Property 30 (repo half): The list never exceeds 300; batch adds are all-or-nothing.** Bulk-insert 299 rows, then add 1 (succeeds, count 300) and add 1 more (throws `trip_validation_failed`, count still 300); with 295 rows a starter run needing 21 throws and **adds nothing** (count still 295, fails if the insert is not transactional); concurrent `Promise.all` adds from 295 with 10 requests accept exactly 5 (fails if the Trip row is not locked or the count is read outside the transaction). If pg-mem cannot serialise `FOR UPDATE`, also assert via a query-recording pool that the lock statement `FOR UPDATE` on `trips` is issued before the count and state that in the test.
    - **Property 31 (repo half): Starter is idempotent.** Run twice: first returns `STARTER_PACKING_LIST.length`, second returns 0; stored rows have each entry's declared category and quantity and `added_by` = caller; pre-existing item `' sunscreen '` (different case/whitespace) suppresses the `Sunscreen` entry.
    - **Property 33 (repo half): Packed transitions persist.** `setPacked(true)` stores `packed_by` and `packed_at`; repeating it leaves `packed_at` unchanged (fails if overwritten); `setPacked(false)` NULLs both.
    - **Property 34 (repo half): Assignee.** Adding with a non-member `assigneeId` throws `trip_validation_failed` and writes no row; after the assignee's `trip_memberships` row is deleted, `listPacking` returns `assigneeId: null, assigneeDisplayName: null` while the stored `assignee_id` is unchanged.
    - Read-back regression test for `addPackingItem`: the stored row's `name` is the trimmed input, `quantity` defaults to 1, `category` and `added_by` are the supplied values, `packed = false` (fails if any column is dropped from the INSERT, the `addPlannedItem` defect pattern).
    - `getPackingItemOwner` returns `null` for an item of another Trip; `updatePackingItem` leaves omitted fields and packed state unchanged and sets `assignee_id` to NULL when `null` is supplied; `removePackingItem` removes the row and `listPacking` counts drop.
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10, 11.11, 11.13, 14.5**
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10, 11.11, 11.13, 14.5_

- [x] 6. Routes
  - [x] 6.1 `routes.ts`: timeline, settings, done, mute; register in `server.ts`
    - Create `apps/api/src/services/tripBooking/routes.ts` with `TripBookingRoutesOptions` and `tripBookingRoutes`. Implement `GET /trips/:id/booking-timeline`, `PATCH /trips/:id/booking-settings`, `PUT /trips/:id/booking-windows/:kind/:dropOn/done`, `PUT /me/trips/:id/booking-reminders`. Handler order: `requireSession` pre-handler, parse `:id` with `uuidSchema`, `assertTripMember(pool, userId, id)`, `can(role, action)`, parse body with `parseOrAppError`, repo call. Capture `now` once per request. The done route validates `(kind, dropOn)` against the derived timeline **before** writing (unknown key gives `trip_validation_failed`, no write). Copy `requireUser`/`parseOrAppError` locally per the existing duplication convention. Add `readonly tripBooking?: TripBookingRoutesOptions` and its `app.register` to `apps/api/src/server.ts` next to `tripExpenses` (composition is task 9.1).
    - Tests: `apps/api/src/services/tripBooking/__tests__/routes.timeline.test.ts` via `server.inject` with the real repo on pg-mem for settings/done/mute and an injected `now`. Per route: auth gate (`unauthorized` with no session; `trip_forbidden` for non-member and for an unknown Trip with identical bodies), happy path, at least one validation error. Specific assertions that would fail without the behavior:
    - GET returns `windows` sorted, `rulesVersion === BOOKING_RULES_VERSION`, `muted` true only for the caller who muted (a second member's GET shows `muted: false`, R3.11); `past` windows present; a read leaves all table row counts unchanged (R3.8).
    - PATCH as `member` returns `trip_forbidden` and the stored row is unchanged (R2.6); as organizer with `{}` returns `trip_validation_failed`; with an out-of-range override returns `trip_validation_failed` and a valid sibling field is not stored; with valid body the next GET reflects it (R2.8).
    - PUT done with `{ done: true }` returns the window with `done: true`, `doneByDisplayName` set; repeating it leaves `doneAt` identical (R5.6); `{ done: 'x' }` and an unknown `dropOn` each return `trip_validation_failed` and no row appears (R5.4, R5.5); `done:false` removes it.
    - PUT mute `{ muted: true }` twice leaves one row; `{ muted: true, userId: '<other>' }` returns `trip_validation_failed` and creates no row for either user (R12.3).
    - **Validates: Requirements 2.4, 2.5, 2.6, 2.8, 2.10, 3.1, 3.8, 3.9, 3.10, 3.11, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 9.8, 9.9, 9.13, 12.3**
    - _Requirements: 2.4, 2.5, 2.6, 2.8, 2.10, 3.1, 3.8, 3.9, 3.10, 3.11, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 9.8, 9.9, 9.13, 12.3, 12.5, 12.6, 12.7_
  - [x] 6.2 `routes.ts`: packing endpoints
    - Add `GET/POST /trips/:id/packing-items`, `POST /trips/:id/packing-items/starter` (`{ added }`), `PATCH/DELETE /trips/:id/packing-items/:itemId` (`getPackingItemOwner` -> `trip_not_found`; then `can(role,'edit_packing_item')` and `canModifyPackingItem`), `PUT /trips/:id/packing-items/:itemId/packed`. Status codes: POST 201, DELETE 204, others 200.
    - Tests: `apps/api/src/services/tripBooking/__tests__/routes.packing.test.ts` (`server.inject`, pg-mem repo). Per route: auth gate, happy path, one validation error.
    - **Property 35 (route half): Only adder or organizer edits/removes.** A third member's PATCH and DELETE of someone else's item return `trip_forbidden` and the row is unchanged; the adder succeeds; an organizer succeeds; after the adder leaves the Trip only an organizer succeeds; any member may PUT `packed`.
    - Item of another Trip addressed through `:id` returns `trip_not_found` and nothing changes (R11.13). POST with name `'   '` returns `trip_validation_failed`; POST at 300 items returns `trip_validation_failed`; POST starter twice returns `added` = `STARTER_PACKING_LIST.length` then `0`; GET on an empty Trip returns `{ items: [], totalCount: 0, packedCount: 0 }`; GET ordering follows category vocabulary then creation time.
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.10, 11.12, 11.13, 12.2, 12.4, 14.5**
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.10, 11.12, 11.13, 12.2, 12.4, 14.5, 14.7_
  - [x] 6.3 Cross-route authorization and error-envelope properties
    - Tests only: `apps/api/src/services/tripBooking/__tests__/routes.authz.prop.test.ts`. Build a route table of every non-cron route of this feature and drive it with fast-check.
    - **Property 37: Non-members cannot distinguish an existing Trip from an unknown one; authentication precedes lookup.** For every route, random Trip id, and caller who is a non-member of a real Trip vs. a caller targeting a non-existent Trip: status, error code, and body are byte-identical (`trip_forbidden`) and no row is created, changed, or deleted; with no or invalid session the response is `unauthorized` and a recording pool observed **zero** queries; a request after the membership row is deleted is denied.
    - **Property 38: Failures use only the four existing error codes and leave data unchanged.** Malformed `:id`/`:itemId`/`:kind`/`:dropOn`, non-boolean `done`/`muted`/`packed`, unknown or extra body keys, oversize names, bad quantities/categories/assignees, unknown window keys: code is one of `unauthorized`, `trip_forbidden`, `trip_validation_failed`, `trip_not_found`, with the standard envelope, and a table snapshot is unchanged.
    - **Validates: Requirements 2.10, 3.9, 3.10, 5.3, 9.9, 11.12, 12.6, 12.7, 12.8, 14.7, 15.3, 15.6**
    - _Requirements: 2.10, 3.9, 3.10, 5.3, 9.9, 11.12, 12.6, 12.7, 12.8, 14.7, 15.3, 15.6_

- [x] 7. Checkpoint - persistence and routes
  - Run `npm run verify:api` and paste the tail and exit code. Confirm `migration0061.test.ts`, the three `repo.*.integration.test.ts` files, and the route tests are included in the run output.
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Config, runner, internal endpoint, Notification_Service handler
  - [x] 8.1 Config: `TRIP_BOOKING_CRON_SECRET`, `BOOKING_REMINDER_*`, `AppConfig.tripBooking`, and fixtures
    - In `apps/api/src/config.ts` add every env var and default from design.md "Configuration & Constants" (`TRIP_BOOKING_CRON_SECRET` required and non-blank after trim; `BOOKING_REMINDER_LEADS` default `eve,open`; `CATCHUP_MINUTES` 180; `MIN_PASS_INTERVAL_SECONDS` default 300, integer 60..599; `SEND_START` `06:00`; `SEND_END` `23:00` with start < end; `RETENTION_DAYS` 30). Chain `.superRefine` so the secret must differ from `SAMPLING_CRON_SECRET` and `PIN_RECONCILE_CRON_SECRET`, with `path: ['TRIP_BOOKING_CRON_SECRET']` so the `ConfigError` names it. `AppConfig` gains the **required** `tripBooking: { cronSecret; reminder: ReminderConfig }`.
    - **Fixtures that must gain the field or the suite fails:** `apps/api/src/services/admin/__tests__/configSecrets.test.ts` (typed `sentinelConfig: AppConfig`), `apps/api/src/__tests__/config.prop.test.ts` and `apps/api/src/__tests__/config.disney.prop.test.ts` (their full env objects need `TRIP_BOOKING_CRON_SECRET`). `grep -r "AppConfig" apps/api/src` for any other typed literal. Local `apps/api/.env` and `.env.dev` need a placeholder `TRIP_BOOKING_CRON_SECRET` (dev-only value, never committed if those files are ignored) or the API will not load config.
    - Tests: new `apps/api/src/__tests__/config.tripBooking.prop.test.ts`.
    - **Property 26: Startup rejects an invalid cron secret or pass interval and names the variable.** Secret missing/empty/whitespace/equal to either other secret throws `ConfigError` whose issues include `TRIP_BOOKING_CRON_SECRET`; non-blank and distinct succeeds and is exposed as `tripBooking.cronSecret`. Interval generator biased to 0, 59, 60, 300, 599, 600, non-integers, non-numeric: succeeds iff integer 60..599 else `ConfigError` naming `BOOKING_REMINDER_MIN_PASS_INTERVAL_SECONDS`; unset defaults to 300 (fails if the cap is 600 or the floor is missing).
    - Examples: defaults for every other `BOOKING_REMINDER_*`; `SEND_START >= SEND_END` throws; `BOOKING_REMINDER_LEADS='bogus'` loads with `leads: []` (not a startup error, R7.2).
    - Extend `configSecrets.test.ts` with a sentinel so the admin config page never renders `tripBooking.cronSecret`.
    - **Validates: Requirements 8.10, 8.15, 7.2**
    - _Requirements: 7.2, 8.10, 8.15_
  - [x] 8.2 `runner.ts`: `createReminderRunner`
    - Implement `createReminderRunner(deps)` in `apps/api/src/services/tripBooking/runner.ts` per design.md: `tryStart()` decides synchronously through `decidePassStart`, stamps `lastStart`/`inFlight` before returning, runs `runPass` with `void ... .catch(log).finally(release)`; `runPass` follows the design pseudocode (Send_Window and empty-leads guard, candidates, bulk done/claimed lookups, per-Trip try/catch, **claim before dispatch**, coalesce, recipients, dispatch with per-group catch, single `info` summary log, prune in `finally` with its own catch). No timers, queue, worker, or Redis.
    - Tests: `apps/api/src/services/tripBooking/__tests__/runner.prop.test.ts` with an in-memory ledger fake that has real conflict-ignoring semantics and failure injection (claim throws, dispatch throws, recipients empty, prune throws).
    - **Property 15: Passes outside the Send_Window do nothing; inside they dispatch everything due.** Outside: zero `claimReminder`, zero `dispatch`, zero ledger rows. Inside: the claimed set equals `deriveDueReminders` for that instant.
    - **Property 23: Across any number of passes each ledger key is dispatched at most once.** A reminder whose claim threw leaves no row and is due again next pass; a claimed reminder is never claimed again; a key reaches `dispatch` at most once even when dispatch threw or recipients were empty at claim time (fails if the claim happens after dispatch or if a failed dispatch deletes the row); one failing Trip/reminder never stops the others.
    - Examples: exactly one summary `info` log per pass with non-negative integers `tripsEvaluated`, `remindersClaimed`, `remindersDispatched` (R8.9); prune is called in a pass that threw and again next pass when it failed (R14.3); an erroring pass releases `inFlight` so a `tryStart` >= minInterval later starts (R8.5); `tryStart` during a never-resolving pass returns `{started:false, reason:'in_flight'}`, within 300 s of a start returns `debounced`.
    - **Validates: Requirements 4.5, 7.5, 7.9, 8.5, 8.6, 8.7, 8.8, 8.9, 9.1, 9.2, 9.11, 9.12, 14.2, 14.3**
    - _Requirements: 4.5, 7.5, 7.9, 8.5, 8.6, 8.7, 8.8, 8.9, 9.1, 9.2, 9.11, 9.12, 14.2, 14.3_
  - [x] 8.3 Internal endpoint `POST`/`HEAD /internal/trip-booking-reminders/run`
    - Add both handlers to `routes.ts` with no session `preHandler`; gate with `secretMatches` against `app.config.tripBooking.cronSecret` **before** `tryStart` (R8.2). POST replies `202` with `{status:'accepted'}` or `{status:'skipped', reason}`; HEAD replies `202` with no body. Neither awaits the pass.
    - Tests: `apps/api/src/services/tripBooking/__tests__/routes.internal.test.ts` (`server.inject`, fake runner recording `tryStart` calls).
    - **Property 25 (route half): Only the exact secret authorises.** For missing/empty/wrong/case-different/padded/array header on both POST and HEAD: response is the `unauthorized` envelope, `tryStart` call count is 0, and the runner's debounce timestamp is unchanged (fails if the gate runs after `tryStart`).
    - Examples: authorized POST returns 202 while a never-resolving pass is pending (fails if the handler awaits the pass); POST body is one JSON object under 1024 bytes; HEAD body is empty; in-flight and debounced cases return 202 with `status: 'skipped'` and the matching `reason`.
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.6, 8.7**
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.6, 8.7_
  - [x] 8.4 Notification_Service: `handleTripBookingReminder` and the push data variant
    - In `apps/api/src/services/notifications/expoPushClient.ts` extend `ExpoPushData` additively with `{ readonly bookingTripId: string }`. In `notifications/service.ts` add `handleTripBookingReminder(event)`: compose once via `composeBookingReminder`, then per recipient call the existing private `notifyRecipient` with `data: { bookingTripId: event.tripId }`, `notificationKind: 'trip_booking_reminder'`, each inside its own `.catch` so the handler never rejects. Extend any TypeScript union of notification kinds to include `trip_booking_reminder` (grep for `'rode_with_tag_created'` to find them) so the `onDelivery` log typechecks. Add the `TripBookingReminderEvent` type.
    - Tests: `apps/api/src/services/notifications/__tests__/bookingReminderHandler.prop.test.ts` and `bookingReminderNotification.test.ts`, with fakes for `PushTokenTargeter`, `NotificationPreferenceReader`, `ExpoPushClient`, and an injected `delay` (no real timers).
    - **Property 21: The push payload carries only the Trip identifier.** Every message sent has `data` deep-equal to `{ bookingTripId: event.tripId }` (fails if any extra key such as `lead` or a window is added); title/body equal `composeBookingReminder` output; existing `ExpoPushData` variants still typecheck and validate (additive).
    - **Property 22: The handler gates correctly, never rejects, logs every delivery.** Arbitrary per-recipient preference outcomes (enabled, disabled, read failure), token sets (none/some), Expo outcomes (`ok`, `device_unregistered`, `error`, thrown): resolves; sends only to enabled recipients with at least one active token; one recipient's failure never prevents others; every per-token outcome is passed to `onDelivery` with kind `trip_booking_reminder`.
    - Example: the `Object.keys(service)` guard test in `experienceListSharedNotification.test.ts` still passes (if it enumerates handlers, update its expected list deliberately and say so).
    - **Validates: Requirements 9.5, 9.7, 9.10, 15.4**
    - _Requirements: 9.5, 9.7, 9.10, 15.4_

- [x] 9. Wiring
  - [x] 9.1 `composeServices.ts` wiring and structural guards
    - In `apps/api/src/composeServices.ts` construct `createTripBookingRepo(pool)`, an `emitTripBookingReminder` that calls `notificationService.handleTripBookingReminder`, and `createReminderRunner({ repo, dispatch, config: config.tripBooking.reminder, logger })`, and pass `tripBooking: { repo, pool, requireSession, reminderRunner }` to `buildServer`. Do not start the runner from any timer or boot hook (R8.8, R8.11). Do not touch any Disney live module (`retirement.smoke.test.ts` stays green).
    - Tests: a composition test following the existing composeServices/server test pattern (find with `grep -rl "composeServices" apps/api/src --include=*.test.ts`): the composed app answers `GET /trips/<uuid>/booking-timeline` with `unauthorized` when unauthenticated, and `HEAD /internal/trip-booking-reminders/run` with `unauthorized` without the secret and `202` with it. Add `apps/api/src/services/tripBooking/__tests__/noWorker.test.ts`: reads every `.ts` under `tripBooking/` (excluding `__tests__`) and asserts none imports `bullmq`, `ioredis`, `redis`, or `node-cron`/`setInterval` scheduling (R8.8), and that no source file other than the new route references the path `/internal/trip-booking-reminders/run` (R8.11, the Keep_Alive_Cron never calls it).
    - _Requirements: 8.3, 8.8, 8.11, 9.5, 15.5_

- [x] 10. Checkpoint - API complete
  - Run `npm run verify:api` and paste the tail and exit code. Confirm `retirement.smoke.test.ts` and the planning coverage thresholds still pass without modification.
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Mobile: API client, view modules, screens, navigation, tap routing
  - Applies to every mobile task below: build styles with `makeStyles` and read inline values with `useAppTheme()`; no raw colour literals or static token reads (a one-off colour goes in a co-located `<File>.palette.ts` via `definePalette` and `usePalette`); `Switch` uses `themedSwitchProps(t, value)` with `key={t.scheme}`; memoized values and list callbacks list `styles`/`t` in deps and pass `extraData` including `t.scheme`; every visual has an accessibility label and state is never conveyed by color alone. After each screen or modal task run `npx jest src/__tests__/themeRetrofit.guard.test.ts` and keep it green; fix the code, never the allowlist. Tests render the real component with `@testing-library/react-native`, mock only the network/query layer (`apiRequest`), and for every interaction drive it with `fireEvent`/`waitFor` and assert both the request (endpoint, method, payload) and the on-screen change.
  - [x] 11.1 API client and query keys
    - Create `apps/mobile/src/screens/trips/bookingTimelineApi.ts` (shape of `tripExpenseApi.ts`): `bookingKeys` (`all`, `timeline`, `packing`), `fetchBookingTimeline`, `patchBookingSettings`, `putWindowDone`, `putReminderMute`, `fetchPackingList`, `addPackingItem`, `patchPackingItem`, `deletePackingItem`, `putPacked`, `addStarterItems`, all via `apiRequest` and types from `@dwt/shared` (no local DTO copies, R15.5).
    - Tests: `apps/mobile/src/screens/trips/__tests__/bookingTimelineApi.test.ts` with `apiRequest` mocked. Assert each function's exact path, method, and body: `putWindowDone('t','dining','2025-04-15',true)` calls `PUT /trips/t/booking-windows/dining/2025-04-15/done` with `{ done: true }`; `putReminderMute('t', true)` calls `PUT /me/trips/t/booking-reminders` with `{ muted: true }`; `patchBookingSettings` sends only the supplied fields; `addStarterItems` calls `POST /trips/t/packing-items/starter` with no body; `bookingKeys.timeline('t')` differs from `bookingKeys.packing('t')`.
    - _Requirements: 6.6, 6.8, 6.10, 11.6, 13.3, 13.6, 13.7, 13.11, 15.5_
  - [x] 11.2 `bookingTimelineView.ts`: presentation helpers
    - Create `apps/mobile/src/screens/trips/bookingTimelineView.ts` with `countdownLabel`, `statusPresentation`, `donePresentation`, `splitWindows`, `formatDropMoment` (`America/New_York`, reuse the WDW time-zone constant), `sourceLabel`, `pickChangedSettings`, `checkInRangeText` (built from `checkInOverrideRange`).
    - Tests: `apps/mobile/src/screens/trips/__tests__/bookingTimelineView.prop.test.ts` (Jest + fast-check).
    - **Property 41: Presentation helpers map status, countdown, and form changes exactly.** `countdownLabel`: `Opens in N days` for upcoming N>1, `Opens tomorrow` for 1, `Opens today` for 0, `Open now` for open, `null` for past; the four `(status x done)` pairs are pairwise distinct in both icon and label; `splitWindows` keeps order and loses none; `pickChangedSettings(stored, draft)` contains exactly the differing fields and is empty when equal (fails if it sends unchanged fields). Example: `formatDropMoment('2025-06-01T10:00:00Z')` contains `6:00 AM` and `ET`.
    - **Validates: Requirements 6.2, 6.3, 6.4, 6.5, 6.8, 6.14**
    - _Requirements: 6.2, 6.3, 6.4, 6.5, 6.7, 6.8, 6.14_
  - [x] 11.3 `packingListView.ts`: grouping, filtering, optimistic toggle, form validation
    - Create `apps/mobile/src/screens/trips/packingListView.ts` with `groupByCategory`, `applyFilter`, `togglePackedOptimistic` (returns new list plus counts), `validatePackingForm` (uses the shared `packingItemCreateSchema`, returns `{ok}` or `{field,message}`), `canEditItem(role, viewerId, item)` (same rule as `canModifyPackingItem`).
    - Tests: `apps/mobile/src/screens/trips/__tests__/packingListView.prop.test.ts`.
    - **Property 32 (view half): Group/filter/count consistency.** Groups follow vocabulary order, omit empty groups, oldest first; `all` returns everything, `mine` exactly assignee === viewer, `unpacked` exactly `!packed`; filtering never changes the unfiltered counts.
    - **Property 33 (optimistic half): Optimistic toggle is reversible.** Toggle then rollback restores the original list and counts exactly.
    - **Property 35 (client half): `canEditItem` matches the server rule.** True iff organizer or adder.
    - **Property 29 (client half): Form validation equals the shared schema.** For generated name/quantity inputs `validatePackingForm` is ok iff `packingItemCreateSchema.safeParse` succeeds, and a failure names the offending field.
    - **Validates: Requirements 11.5, 13.2, 13.3, 13.5, 13.6, 13.7, 13.12**
    - _Requirements: 11.5, 13.2, 13.3, 13.5, 13.6, 13.7, 13.12_
  - [x] 11.4 `BookingSettingsModal.tsx`
    - Create `apps/mobile/src/screens/trips/BookingSettingsModal.tsx`: stay-type radios (Automatic, Resort, Partner hotel, Off-site), timing radios (Automatic, 7 days before check-in, 3 days before (whole trip), 3 days before (each day)), `DatePickerField` with `minimumDate`/`maximumDate` from `checkInOverrideRange` and always-visible `checkInRangeText`. Confirm calls `onConfirm(pickChangedSettings(...))`; Cancel calls `onCancel` and nothing else. Out-of-range selection is rejected with the range text and no confirm.
    - Tests: `BookingSettingsModal.test.tsx`. Select Resort then Confirm: `onConfirm` called with exactly `{ stayType: 'resort' }` (fails if unchanged fields are included); select Automatic when stored is `resort` sends `{ stayType: null }`; Cancel after changes calls `onCancel`, `onConfirm` never called, and re-opening shows stored values; an out-of-range date shows the text from `checkInRangeText` and Confirm sends no `checkInOverride`; each radio has an accessibility label and selected state.
    - _Requirements: 6.8, 6.14_
  - [x] 11.5 `TripBookingTimelineScreen.tsx`
    - Create `apps/mobile/src/screens/trips/TripBookingTimelineScreen.tsx` per design.md "Mobile": timeline query, settings summary with `sourceLabel`, organizer-only Edit opening `BookingSettingsModal`, "Remind me" switch, active list then collapsible "Past windows (N)" header (`accessibilityRole="button"`, `accessibilityState={{ expanded }}`), window rows (kind icon + label, drop moment, date range, `{n} booked`, countdown, status chip, done control with `accessibilityRole="checkbox"` and label `"{Kind} window, {range}: {Done|Not done}"`), rules note with `rulesVersion`, loading/error+retry/empty states (`testID`s `booking-timeline-loading`, `booking-timeline-retry`), and the unavailable-Trip redirect (`trip_forbidden`/`trip_not_found` calls `setTripsListNotice('That booking timeline is no longer available.')` then navigates to `TripsList`). Role derived as `TripDetailScreen` does.
    - Tests: `TripBookingTimelineScreen.test.tsx`; each row asserts the request and the on-screen change:
    - Open: `GET /trips/t/booking-timeline`; upcoming/open rows in order; past group collapsed with count in header; pressing the header shows past rows and flips `accessibilityState.expanded`, pressing again hides them.
    - Done toggle: press sends `PUT .../booking-windows/dining/2025-04-15/done` with `{ done: true }`, control disabled while pending, row then shows the Done icon and label; on rejected request the control returns to Not done, text `Couldn't update booking status` appears, and the cached windows are unchanged.
    - Remind me: switching off sends `PUT /me/trips/t/booking-reminders` `{ muted: true }`; switching back on sends `{ muted: false }`; on failure the switch reverts and `Couldn't update reminders` appears.
    - Organizer: Edit opens the modal; choose Resort and Confirm sends `PATCH /trips/t/booking-settings` with `{ stayType: 'resort' }`, then refetches the timeline and shows `Set by an Organizer`; Cancel sends nothing; PATCH failure restores values and shows `Couldn't save booking settings`. Member: Edit and settings controls are absent.
    - Out-of-range override: no PATCH and the range text is shown.
    - Loading indicator while pending; error shows retry, pressing it issues a second GET; zero windows shows the empty state while the settings summary, Remind me toggle, and rules note still render; `trip_forbidden` rejection sets the notice and navigates to `TripsList`.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.13, 6.14, 6.15, 10.4_
  - [x] 11.6 `PackingItemFormModal.tsx`
    - Create `apps/mobile/src/screens/trips/PackingItemFormModal.tsx` (add and edit): name, quantity text, category chips, assignee chips (members plus "No one"). On submit run `validatePackingForm`; invalid keeps the form open with entered values and an error naming the field; valid calls `onSubmit(payload)`.
    - Tests: `PackingItemFormModal.test.tsx`. Empty/whitespace name shows an error naming `name` and `onSubmit` not called; 81-char name rejected; quantity `0`, `100`, `1.5` rejected naming `quantity`; valid input calls `onSubmit` with trimmed name, integer quantity (default 1), chosen category and assignee; entered values persist after a rejected submit; chips expose selected state.
    - _Requirements: 13.6, 13.7, 13.12_
  - [x] 11.7 `TripPackingListScreen.tsx`
    - Create `apps/mobile/src/screens/trips/TripPackingListScreen.tsx` per design.md: query with `refetchOnMount: 'always'` and `useFocusEffect` refetch; mutations' `onSettled` invalidate `bookingKeys.packing`; All/Mine/Unpacked chips (`accessibilityRole="button"`, `accessibilityState={{ selected }}`); grouped `SectionList`; row with packed control (`checkbox`, label `"{name}, {Packed|Not packed}"`, icon plus text), `×{quantity}`, assignee or `Unassigned`, edit/remove for `canEditItem`; optimistic packed toggle with rollback; empty state with "Add suggested items" and "Add item"; loading only when nothing cached; error plus retry.
    - Tests: `TripPackingListScreen.test.tsx`; each asserts request and screen change:
    - Open: `GET /trips/t/packing-items`; grouped rows in vocabulary order; headline counts.
    - Packed toggle: press sends `PUT .../packed` `{ packed: true }`; the row shows `Packed` and `packedCount` increments **before** the mocked response resolves (assert while the promise is pending); on rejection the row and count revert and an error message appears.
    - Filters: Mine, Unpacked, All change visible rows with **no additional request** (request count unchanged); a filter matching nothing shows the no-match text and the three chips remain; count text stays unfiltered.
    - Add: open form, valid input, submit sends `POST /trips/t/packing-items` with the payload, form closes, a refetch occurs and the new row shows `Not packed`; invalid input sends nothing and keeps the form open naming the field.
    - Edit/remove: as adder, edit sends `PATCH .../packing-items/i1` with changed fields and the row updates; remove sends `DELETE` and `totalCount` drops after success; as a non-adder member the controls are absent; as organizer present.
    - Empty list: "Add suggested items" sends `POST .../starter` and grouped rows appear; focus event triggers a refetch; list failure shows retry and pressing it issues a second GET; failed add/starter keeps the list and form unchanged with an error.
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10, 13.11, 13.12, 13.13_
  - [x] 11.8 `TripsStack` routes and `navigateToBookingTimeline`
    - In `apps/mobile/src/navigation/TripsStack.tsx` (find the actual path) add `TripBookingTimeline: { tripId: string }` and `TripPackingList: { tripId: string }` to `TripsStackParamList` and register both screens after `TripBalances`. In `navigationRef.ts` add `navigateToBookingTimeline(params)` written like `navigateToTripSchedule`, returning `true` without navigating when `getCurrentRoute()` is already `TripBookingTimeline` for the same `tripId`.
    - Tests: `navigationRef` test (follow the existing one): `navigateToBookingTimeline({tripId:'t'})` seeds `TripDetail` then `TripBookingTimeline`; with `getCurrentRoute()` mocked to `{ name:'TripBookingTimeline', params:{tripId:'t'} }` no `navigate` call is made and it returns `true` (R10.6), and for a different `tripId` it navigates. **Deliberately update `tripStructureRegression.test.tsx` and its snapshot to 15 `TripsStack` screens** (was 13): update the explicit ordered screen list, then regenerate the `.snap` by running the test with `-u` only after reviewing that the diff is exactly the two new entries.
    - _Requirements: 6.1, 10.1, 10.6, 13.1_
  - [x] 11.9 Hub tiles on `TripDetailScreen`
    - In `TripDetailScreen.tsx` extend `HubSection['route']` with `'TripBookingTimeline' | 'TripPackingList'`; add `booking` (title "Booking timeline", icon `calendar-number-outline`) and `packing` (title "Packing list", icon `bag-check-outline`) to `HUB_SECTION_DEFS` after `expenses`; add `booking`/`packing` colour keys in both schemes in `TripDetailScreen.palette.ts` (light values copied from existing hues, dark from `darkColor.*`); tiles get `testID`s `trip-detail-section-booking` and `trip-detail-section-packing`. The packing tile runs `useQuery(bookingKeys.packing(tripId))` and shows `{packedCount} of {totalCount}` (`0 of 0` when empty; no count text when the read fails); the booking tile shows "Timeline".
    - Tests: update `TripDetailScreen.test.tsx`: pressing the booking tile navigates to `TripBookingTimeline` with the Trip id; pressing the packing tile navigates to `TripPackingList`; mocked packing list `{ packedCount: 3, totalCount: 7 }` renders `3 of 7`; empty renders `0 of 0`; rejected query renders no count text. **Deliberately update `tripStructureRegression.test.tsx` and its snapshot to 9 `HUB_SECTIONS`** (was 7), including its explicit ordered list and colour lists, again reviewing the snapshot diff before `-u`. Run the theme guard test.
    - _Requirements: 6.1, 13.1_
  - [x] 11.10 `bookingTapState.ts`: pending-tap reducer and store
    - Create `apps/mobile/src/navigation/bookingTapState.ts` with `BookingTapState`, `BookingTapEvent` (`tap`, `otherTap`, `authFailed`, `delivered`), `bookingTapReducer`, and the module-level `dispatchBookingTapEvent` store plus a getter/subscription the hook can read.
    - Tests: `apps/mobile/src/navigation/__tests__/bookingTapState.prop.test.ts`.
    - **Property 40: A held booking tap navigates at most once, only after sign-in, never after an auth failure.** Model sequences of `tap`, `otherTap`, `authFailed`, `authenticated`, `delivered` with the flush rule (navigate iff authenticated and a pending target exists): at most one navigation per `tap`; a tap while unauthenticated navigates after the next `authenticated` unless `authFailed` or `otherTap` intervened; after `authFailed` no later `authenticated` navigates to that tap (fails if `authFailed` does not clear `pending`); a later `tap` replaces an earlier pending one.
    - **Validates: Requirements 10.2, 10.3, 10.8**
    - _Requirements: 10.2, 10.3, 10.8_
  - [x] 11.11 Tap classification and dispatch in `useNotificationResponse.ts`
    - In `apps/mobile/src/hooks/useNotificationResponse.ts` add `extractBookingTap` (key presence of `bookingTripId`; `tripId` set only for a well-formed UUID string, else `null`) matched **earliest** in `classifyTap`, before `tripInvite`, so it never reaches the `share` fallback; add `{ kind: 'bookingReminder'; tripId: string | null }` to `PendingTap`. `dispatchPendingTap` for it: `tripId === null` calls `setTripsListNotice('That booking timeline is no longer available.')` then `navigateToTripsList()`, otherwise `navigateToBookingTimeline({ tripId })`. It never calls `navigateToNotificationCenter` or any Attention-badge function. Wire the pending tap to `bookingTapState` so a held tap is consumed once after `hydrated && token !== null` and discarded on `authFailed`.
    - Tests: `apps/mobile/src/hooks/__tests__/useNotificationResponseBooking.test.tsx` (mock `navigationRef` functions, `setTripsListNotice`, `navigateToNotificationCenter`).
    - **Property 39: Tap classification routes booking taps and never leaks them to the Notification_Center.** For generated `data` payloads: a payload with a `bookingTripId` key classifies as `bookingReminder` (tripId only for well-formed UUIDs); a payload without it classifies identically to the pre-change `classifyTap` for every existing payload shape; dispatching never calls `navigateToNotificationCenter` or touches the Attention state.
    - Examples: foreground, background, and cold-start taps each call `navigateToBookingTimeline` once with the id; a tap while unauthenticated is held, then navigates once after sign-in; after `authFailed` a later sign-in does not navigate; `bookingTripId: ''` goes to the Trips list with the notice and no timeline navigation; the 3 s `FOREGROUND_NAV_TIMEOUT_MS` retry loop is only the readiness poll and the first ready attempt navigates immediately.
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.5, 10.7, 15.4**
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.7, 15.4_
  - [x] 11.12 Auth screens fire `authFailed`
    - In `LoginScreen.tsx` call `dispatchBookingTapEvent({ type: 'authFailed' })` from the submit-failure handler and when "Forgot password" is pressed; in `RegisterScreen.tsx` from its submit-failure handler (locate the actual handler names with grep; the design calls them `handleSubmitError`).
    - Tests: extend the existing `LoginScreen` and `RegisterScreen` tests (or create `*.bookingTap.test.tsx`): with a pending booking tap in the store, a failed Login submit dispatches `authFailed` and the pending target is cleared; pressing Forgot password does the same; a failed Register submit does the same; a **successful** submit does not dispatch `authFailed` (fails if dispatched unconditionally).
    - **Validates: Requirements 10.8**
    - _Requirements: 10.3, 10.8_

- [x] 12. Checkpoint - mobile complete
  - Run `npm run verify:mobile` and paste the tail and exit code. Confirm `themeRetrofit.guard.test.ts` and `tripStructureRegression.test.tsx` (now 9 sections / 15 screens) are in the passing set and that no snapshot was regenerated beyond the reviewed diffs.
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Ops documentation and rules re-check
  - [x] 13.1 Document the Reminder_Cron and the new secret
    - Update `docs/hosting.md` with the Reminder_Cron job: separate from the Keep_Alive_Cron, timezone `America/New_York`, method `HEAD` or `POST`, header `x-cron-secret`, URL `https://<render-host>/internal/trip-booking-reminders/run`, crontab `0,10,20 6,7,20 * * *` (<= 9 passes/day) or `0,10,20 6,7,9,20 * * *` WHERE `week` is enabled (<= 12/day), the primary/retry explanation, and the Render (~0.25 extra instance-hour/day) and Neon (<= 9-12 wake-ups/day) impact. Add `TRIP_BOOKING_CRON_SECRET` to `render.yaml` (`sync: false`, with the same "dedicated value" comment as `PIN_RECONCILE_CRON_SECRET` plus the default crontab and passes-per-day bound). Add a `change-me` row for `TRIP_BOOKING_CRON_SECRET` and commented `BOOKING_REMINDER_*` defaults to `apps/api/.env.example`. Add the new env vars to the README env paragraph. If an env-example parity test exists (`grep -rn "env.example" apps/api/src --include=*.test.ts`), keep it green. The Keep_Alive_Cron is not modified.
    - Tests: none are meaningful for prose; instead run `npx vitest run src/__tests__/config` in `apps/api` (and any env-example parity test) to confirm the documented defaults still load, and state that the doc content itself is unverified by tests.
    - _Requirements: 8.10, 8.11, 8.12, 8.13_
  - [x] 13.2 Re-check the Booking_Rules constants against Disney's current help pages
    - Before release, re-verify each constant against Disney's current published pages (the URLs in design.md "External Interfaces", plus a fresh search): Advance Dining 06:00 ET and 60 days, resort cover **10** (and whether Disney means 10 nights or 10 days); Lightning Lane 07:00 ET, 7 days (resort and select partner hotels) vs 3 days, cover **14** days (vs the whole stay or 10 days). The dining 06:00 time was not confirmed from a current source at authoring time, and Disney's pages disagree on 10 nights vs 10 days and 14 vs 10 days. Record findings with URLs and the date as an additive dated note under "External Interfaces" in `design.md` (do not delete existing text). If every value is confirmed, change nothing else. If a value differs or the sources still disagree: do not silently pick one. Report the discrepancy to the user and, once decided, edit the single constant in `BOOKING_RULES`, bump `BOOKING_RULES_VERSION`, update the independent oracle numbers in `timeline.prop.test.ts` and `tripBooking.rules.test.ts`, and amend the Configuration and Constants table in `requirements.md` additively (no renumbering). Leave this task unchecked if any value could not be confirmed from a current source, and state which.
    - Tests: if any constant changes, `timeline.prop.test.ts` (Properties 1, 2, 3, 5) and `tripBooking.rules.test.ts` must be updated in the same change and pass; the oracle in Property 2 must be edited by hand, not derived from the table.
    - _Requirements: 1.1, 1.4, 1.5, 1.6, 1.7, 1.8, 1.14_

- [x] 14. Final checkpoint - full verification, behavior-to-test map, diff audit
  - Run the full gate **once**: `npm run verify` from the repo root (typecheck plus all tests in `apps/api`, `apps/mobile`, `packages/shared`). Paste the literal tail of the output with the per-workspace `Tests: ... passed` / `Test Files ... passed` lines and the shell exit code, which must be `0`. If anything fails, fix it (you broke it, you own it) and leave this task unchecked until it is green. A vitest/jest run is not the gate.
  - Perform the pre-response source-diff audit: read `git diff` and `git status`, confirm every UI control, tile, modal, route, and payload described in this plan exists in source, and that no stray scripts, scratch files, or generated `.js` artifacts remain. The pin gate (`.kiro/specs/pin-collection/verify/run-all.js`) is not relevant: no catalogue or artwork file changes.
  - In the same completion message, write the **behavior-to-test map**: one row per user-facing behavior or code path added or changed, each naming the test file and the specific assertion. Every row from tasks 1 to 13 must appear, including at minimum: the `push_delivery_log` constraint cases, the claim-before-dispatch ordering, the `week`-lead horizon (67 days), the `open`-lead "Opened at" prefix, the done-mark key shift, the ledger key on date move, the Trip-row-lock packing cap, the optimistic packed toggle rollback, the booking tap `authFailed` discard, the six permission actions, the 9-section/15-screen structural updates, and the config fixtures. A row without a concrete assertion means the task is not done: write the test or state plainly that the behavior is untested.
  - Name every interactive flow or code path that is untested and why. Do not claim coverage that was not run.
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 15. Operator release steps (non-code; operator-run)
  - [ ] 15.1 Stand up the Reminder_Cron on cron-job.org and set the secret on Render
    - **Operator-run. Leave unchecked until the operator confirms each step; an agent must not mark this complete.** Generate a dedicated `TRIP_BOOKING_CRON_SECRET` (distinct from `SAMPLING_CRON_SECRET` and `PIN_RECONCILE_CRON_SECRET`) and set it on the Render web service. Create a new cron-job.org job (separate from the Keep_Alive_Cron, which is not modified): URL `https://<render-host>/internal/trip-booking-reminders/run`, method `HEAD` (preferred, no body) or `POST`, header `x-cron-secret: <secret>`, timezone **America/New_York**, crontab `0,10,20 6,7,20 * * *` (or `0,10,20 6,7,9,20 * * *` WHERE `BOOKING_REMINDER_LEADS` includes `week`). After deploy confirm migration `0061` applied, a manual `HEAD` with the secret returns `202`, a request without it returns the unauthorized error, and a booking reminder push opens the Booking timeline on a device. Confirm task 13.2 (rules re-check) is complete before enabling the job.
    - _Requirements: 8.1, 8.10, 8.11, 8.12, 8.13_

## Notes

- Every test requirement in this plan is part of "done" for the task that adds the code. There are no optional test tasks.
- Properties 1-10, 12-14, 16-20, 24, 25, 28-36 are pure and run without I/O; Properties 11, 15, 21-23, 25 (route half), 26, 27, 37, 38 run against fakes, `pg-mem`, or `server.inject`; Properties 39-41 run in Jest under `jest-expo`. Property numbers refer to design.md "Correctness Properties".
- Several properties are split across layers (3, 6, 25, 29, 30, 31, 32, 33, 34, 35). Each half is a separate assertion in a separate task; both must exist.
- Design conflicts C1 (push log constraint), C5 (tap handler), and C7 (structural tests) are resolved by tasks 5.1, 11.10 to 11.12, and 11.8 to 11.9. C2, C3, C4, C6 are already resolved in `requirements.md`.
- `secretMatches` is placed in `passGate.ts` (pure) rather than inline in `routes.ts` so Property 25 can test it without Fastify; `routes.ts` imports it. This is the only placement difference from the design's code listing.
- The `ReminderRunner` type surface and `events.ts` are created in task 5.5 (before routes) so `routes.ts` can type its `reminderRunner` option; the implementation arrives in task 8.2.
- `apps/api` runs v8 coverage with thresholds on `src/services/planning/**`; this feature does not touch that path. If the implementer wants the same protection for the new pure modules, extend the threshold globs; never weaken them.
- Task 15.1 is intentionally last and operator-run. Task 13.2 may remain unchecked if Disney's pages cannot be confirmed; in that case say so in the final report and do not enable the Reminder_Cron.
- Local `apps/api/.env` and `.env.dev` must gain `TRIP_BOOKING_CRON_SECRET` before running the API after task 8.1.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3"] },
    { "id": 3, "tasks": ["3.1", "3.6", "3.7", "3.8", "3.9", "3.10"] },
    { "id": 4, "tasks": ["3.2", "3.3", "3.4"] },
    { "id": 5, "tasks": ["3.5"] },
    { "id": 6, "tasks": ["5.1", "5.3"] },
    { "id": 7, "tasks": ["5.2", "5.4"] },
    { "id": 8, "tasks": ["5.5"] },
    { "id": 9, "tasks": ["5.6"] },
    { "id": 10, "tasks": ["6.1"] },
    { "id": 11, "tasks": ["6.2"] },
    { "id": 12, "tasks": ["6.3"] },
    { "id": 13, "tasks": ["8.1", "8.2", "8.4"] },
    { "id": 14, "tasks": ["8.3"] },
    { "id": 15, "tasks": ["9.1"] },
    { "id": 16, "tasks": ["11.1", "11.2", "11.3", "11.10"] },
    { "id": 17, "tasks": ["11.4", "11.6", "11.12"] },
    { "id": 18, "tasks": ["11.5", "11.7"] },
    { "id": 19, "tasks": ["11.8"] },
    { "id": 20, "tasks": ["11.9", "11.11"] },
    { "id": 21, "tasks": ["13.1", "13.2"] },
    { "id": 22, "tasks": ["15.1"] }
  ]
}
```
