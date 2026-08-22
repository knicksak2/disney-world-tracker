# Implementation Plan: Trip Reservations

## Overview

This plan adds a Reservations surface to Trips and makes bookings flow into the Schedule Builder. It **depends on the Trips feature** (`.kiro/specs/trips`, which owns `planned_items`, the Planned_Item routes, and the Trip Detail hub) and on the **Day Planning and Wait Time Optimization feature** (`.kiro/specs/day-planning-optimization`, which owns the timing modes, the Schedule Builder, and the Optimization_Engine). Both are already built, so this plan has no blocking cross-spec work.

The build order is bottom-up: shared contracts and the migration first, then the repo write rules and the Booked_Time preservation fix, then the pure grouping module, then the mobile screen and hub wiring. The Optimization_Engine itself is **not** modified — a Reservation reuses the existing fixed-item and Lightning-Lane return-window handling. The only backend behavior change outside the new columns is that `updatePlannedItemTimes` stops overwriting `planned_time` for Reservations (Requirement 4.4), which is a defect fix and therefore needs a pg-mem regression test at the repo layer.

Migration numbering: `0030_derived_stat_runs.sql` is the last file on disk, so this plan uses **`0031`**. Never reuse or edit an applied migration.

## Tasks

- [x] 1. Shared contracts and migration
  - [x] 1.1 Add the Reservation vocabulary and constants to `@dwt/shared`
    - Add `RESERVATION_KINDS` and `ReservationKind` to `packages/shared/src/enums.ts`; add `CONFIRMATION_NUMBER_MAX = 40`, `PARTY_SIZE_MIN = 1`, `PARTY_SIZE_MAX = 50` to `packages/shared/src/trips.ts`; export all from the `index.ts` barrel.
    - _Requirements: 1.2, 7.1, 7.3_
  - [x] 1.2 Add the reservation fields to the Planned_Item schemas and DTO
    - Add `reservationKind`, `confirmationNumber`, `partySize` to `plannedItemAddSchema`, `plannedItemEditSchema` (both are `.strict()`, so omitting this makes every reservation request a validation error), and `PlannedItemDTO`. Extend `plannedItemAddSchema.superRefine`: a non-null `reservationKind` requires both `plannedDate` and `plannedTime`, and requires either an `experienceId` or a `customTitle`.
    - _Requirements: 1.4, 1.5, 5.4, 7.1_
  - [x] 1.3 Widen the `PlannedItemDTO` field-set guard test
    - `apps/api/src/services/trips/__tests__/plannedCompletionModelConstraints.test.ts` asserts `PlannedItemDTO`'s field list with an exact `toEqual`, so task 1.2 turns it red. Add exactly `reservationKind`, `confirmationNumber`, `partySize` to that list and keep both completion-token assertions. Do **not** relax the assertion to a subset check.
    - _Requirements: 7.2_
  - [x] 1.4 Add migration `0031_planned_item_reservations.sql`
    - The three columns, `chk_planned_items_reservation_kind`, `chk_planned_items_party_size`, `chk_planned_items_reservation_anchored`, and the partial `planned_items_reservation_idx`, exactly as in the design. `BEGIN/COMMIT`, `IF NOT EXISTS` / `DROP CONSTRAINT IF EXISTS` so reapplying is a no-op, inline comments.
    - _Requirements: 1.1, 1.2, 1.4, 1.5_
  - [x] 1.5 Migration test `apps/api/src/db/__tests__/migration0031.test.ts`
    - Assert the three columns exist with the right types, that each `CHECK` rejects an out-of-vocabulary kind / a `party_size` of `0` and `51` / a Reservation row with a null `planned_date` or `planned_time`, that a non-reservation row with nulls is still accepted, and that reapplying the file changes nothing.
    - _Requirements: 1.2, 1.4, 1.5_
  - [x] 1.6 Shared schema tests
    - Valid and invalid cases for each new field on both schemas, the reservation-requires-date-and-time refinement, and the venue refinement; plus the add/edit/DTO field-parity property test at ≥ 100 runs.
    - **Property 5: Reservation field bounds are enforced at the contract edge.**
    - _Requirements: 1.2, 1.4, 3.6, 7.1_

- [x] 2. Checkpoint — contracts compile and the guard test is green
  - Run `npm run verify:shared` and `npx vitest run apps/api/src/services/trips/__tests__/plannedCompletionModelConstraints.test.ts`. Do not start task 3 until both are green: task 1.2 is a cross-workspace contract change and a red guard test here will otherwise be blamed on the repo work.
  - _Requirements: 7.1, 7.2_

- [x] 3. Trip_Service repo write rules
  - [x] 3.1 Derive the timing mode from the kind in `addPlannedItem`
    - Before the INSERT, force `is_fixed = true` / `is_lightning_lane = false` / null window+meal for a non-null kind other than `lightning_lane`, and `is_lightning_lane = true` / `is_fixed = false` for `lightning_lane`, regardless of the flags the client sent. Add `reservation_kind`, `confirmation_number`, `party_size` to the INSERT column list and values array (currently 15 columns — keep the placeholders in step).
    - _Requirements: 1.7, 4.2_
  - [x] 3.2 Enforce the anchored-Reservation invariant in `editPlannedItem`
    - Extend the `SELECT … FOR UPDATE` to read `reservation_kind`; if the stored or incoming kind is non-null and the edit would set `planned_date` or `planned_time` to null, `ROLLBACK` and throw `trip_validation_failed` with a `field` pointer. Re-derive the timing flags when the kind changes. Add the three columns to the dynamic `SET` list. The existing unconditional optimization-result clear already satisfies R3.7 — leave it.
    - _Requirements: 1.6, 1.7, 3.4, 3.7_
  - [x] 3.3 Preserve the Booked_Time in `updatePlannedItemTimes`
    - Omit `planned_time` from the `SET` list for a row whose `reservation_kind IS NOT NULL`, while still writing `predicted_wait_minutes`, `travel_from_prev_minutes`, `travel_from_prev_kind`, `scheduled_showtime`, and `optimized_at = now()`. Keep today's behavior — `planned_time = suggestedArrival` — for rows with a null kind. Express the split in SQL so it holds for any caller, not only the optimize route.
    - _Requirements: 4.4, 4.5_
  - [x] 3.4 Extend the read projection
    - Add the three columns to `selectPlannedItem` and `listPlannedItems` and map them in `rowToPlannedItemDto`.
    - _Requirements: 7.1_
  - [x] 3.5 Repo pg-mem tests
    - Insert a Reservation of each kind via `addPlannedItem` and read the row back to assert the derived `is_fixed` / `is_lightning_lane` / null window and the three stored columns. Assert an edit clearing `plannedDate` throws `trip_validation_failed` and the row is byte-identical afterwards. **Regression test for task 3.3:** insert a Reservation with a known `planned_time`, call `updatePlannedItemTimes` with a *different* `plannedTime`, read the row back and assert `planned_time` is unchanged while `predicted_wait_minutes` / travel / `optimized_at` were written — and a companion case asserting a non-reservation row *does* take the new `planned_time`. This test must fail against the pre-fix code.
    - **Property 1: Reservation kind determines the timing mode.**
    - **Property 2: A Reservation always keeps a date and a time.**
    - **Property 3: Optimization never rewrites a Booked_Time.**
    - _Requirements: 1.6, 1.7, 4.4, 4.5_
  - [x] 3.6 Route integration tests
    - `server.inject`: create a Reservation through `POST /trips/:id/planned-items` and assert the 201 body carries the new DTO fields; a validation-failure path; the membership gate returning `trip_forbidden` for a non-member and for an unknown Trip id; removal by a non-adding `member` rejected; and assertions that the `GET /trips/:id/feed` and `GET /trips/:id/summary` payloads contain no `confirmationNumber` or `partySize`.
    - **Property 7: Reservation data is member-gated.**
    - _Requirements: 3.1, 3.5, 3.6, 6.1, 6.2, 6.3_

- [x] 4. Checkpoint — backend complete
  - Run `npm run verify:api`. Confirm the `src/services/planning/**` coverage threshold still passes (this plan adds no planning code, so it should be untouched) and that no day-planning optimizer property test regressed from task 3.3.
  - _Requirements: 4.2, 4.4_

- [x] 5. Pure grouping module
  - [x] 5.1 `apps/mobile/src/screens/trips/reservations.ts`
    - Implement `groupReservationsByDate`, `reservationTitle`, `reservationKindPresentation`, and `RESERVATION_KIND_ICONS` exactly as the design specifies. No I/O, no React import.
    - _Requirements: 1.3, 2.1, 2.2, 2.3, 5.2_
  - [x] 5.2 Unit + property tests
    - Unit cases: null-kind items excluded, single date, multiple dates out of order, equal `plannedTime` tie-break, empty input, title fallback for an Experience-backed item, a Custom_Title item, and a kind-only fallback.
    - **Property 4: Reservation grouping is total, ordered, and lossless** — `fast-check`, ≥ 100 runs, tagged `// Feature: trip-reservations, Property 4: …`.
    - _Requirements: 1.3, 2.1, 2.4, 2.7, 5.2_

- [x] 6. Reservations screen and navigation
  - [x] 6.1 Register the route
    - Add `TripReservations: { tripId: string }` to `TripsStackParamList` and the `<Stack.Screen>` registration in `apps/mobile/src/navigation/TripsStack.tsx`.
    - _Requirements: 2.6_
  - [x] 6.2 Add the hub section
    - Add `'TripReservations'` to `HubSection['route']` and a `reservations` entry to `HUB_SECTIONS` in `TripDetailScreen.tsx`, after `schedule`, with `testID={'trip-detail-section-reservations'}` following the existing pattern.
    - _Requirements: 2.6_
  - [x] 6.3 Build `TripReservationsScreen.tsx`
    - `ScreenContainer` + `GradientHeader` + grouped `Card` rows driven by `groupReservationsByDate`, using `tripDetailKeys.detail(tripId)` and `tripPlannedListKeys.items(tripId)`. Row shows time (ET), title, park, kind icon **and** text label, party size, confirmation number, and adder name. `EmptyState` when there are no Reservations. Row press opens the edit and details modal.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.7_
  - [x] 6.4 Add / edit / remove flows
    - Add modal: kind selector, `ExperiencePicker` filtered to `category === 'Restaurant'` for `dining` and to ride-like categories for `lightning_lane`, a Custom_Title fallback for a non-catalog venue, date, time, party size, confirmation number; submits `POST /trips/:id/planned-items`. Edit modal submits `PATCH …/:itemId` with only changed fields; remove submits `DELETE …/:itemId`. All invalidate `tripPlannedListKeys.items(tripId)` so the Schedule Builder reflects the change with no extra wiring.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 5.1_
  - [x] 6.5 Reservation badge on the Schedule Builder timeline
    - In `TripScheduleScreen.tsx`, render a kind `Badge` on a timeline item whose `reservationKind` is non-null, and prefer the reservation label over the break label for a Non_Catalog_Reservation.
    - _Requirements: 4.1, 4.3, 5.2_
  - [x] 6.6 Component tests
    - `TripReservationsScreen.test.tsx` with `@testing-library/react-native`, mocking only `apiRequest`: grouped render with date headers; **each** interaction driven with `fireEvent`/`waitFor` and asserting both the network call and the on-screen result — open add modal, submit add (assert POST path and exact body), submit edit (assert PATCH body), remove (assert DELETE path), tap a row (assert opens edit and details modal); plus the empty state. A `TripScheduleScreen.test.tsx` case asserts the kind badge renders for a Reservation and does **not** render for a self-pinned fixed item.
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 3.1, 3.4, 3.5, 4.3_

- [x] 7. Final checkpoint and verification gate
  - Re-read the full diff adversarially for stubs, unrealistic fixtures, and uncovered branches; produce the behavior→test map. Then run the full `npm run verify` **once** and confirm exit code `0` with per-workspace test counts for `apps/api`, `apps/mobile`, and `packages/shared`.
  - _Requirements: 7.1, 7.2, 7.3_

- [x] 8. Time_Picker for the Booked_Time (replaces free-text entry)
  - Added after the first release of this feature: the free-text time field accepted `1:00` and silently read it as 1 AM, so a real 1 PM dining reservation saved twelve hours off. A picked meridiem makes that unrepresentable.
  - [x] 8.1 Extract `TimeWheelPicker` into `apps/mobile/src/components/TimeWheelPicker.tsx`
    - Lift the existing inline hour / minute / AM-PM wheel out of `TripScheduleScreen` into a controlled component with `value` / `onChange` / `minuteStep` / `testIDPrefix`, then have `TripScheduleScreen` consume it so one implementation remains. Its existing wheel tests are the regression net for that swap — do not change their assertions to accommodate the refactor.
    - _Requirements: 3.8, 3.9_
  - [x] 8.2 Accept the picker's 12-hour form in the pure time helpers
    - Extend `etWallClockToIso` to parse `H:MM AM/PM` in addition to the existing 24-hour `HH:MM`, and add `isoToWheelTime` for seeding the picker from a stored instant. Keep both DST-correct.
    - _Requirements: 3.10, 3.12_
  - [x] 8.3 Replace the free-text time fields on the Reservations screen
    - Both the add and the edit modal use `TimeWheelPicker` with `minuteStep={5}`. A new Reservation starts with no selection and the save is blocked with "Pick a time for this reservation." until one is made; the edit modal preselects the stored Booked_Time.
    - _Requirements: 3.8, 3.9, 3.10, 3.11_
  - [x] 8.4 Tests
    - Unit + property tests for the extended helpers, tagged `// Feature: trip-reservations, Property 8: …` at ≥ 100 runs, covering every hour/step/meridiem across an EDT and an EST date, and asserting a PM selection never yields its AM instant.
    - `TimeWheelPicker.test.tsx`: renders the offered options for each `minuteStep`, and pressing an hour / a minute / a meridiem emits the expected `onChange` value.
    - `TripReservationsScreen.test.tsx`: driving the picker to 1:00 PM submits `plannedTime` for 13:00 park time (the exact defect that prompted this task); the edit modal preselects the stored time; and saving with no selection issues no request.
    - _Requirements: 3.8, 3.9, 3.10, 3.11, 3.12_
  - [x] 8.5 Checkpoint
    - `npm run verify:mobile`, then the full `npm run verify` once.
    - _Requirements: 3.8_

- [x] 9. Destination filter on the venue picker
  - [x] 9.1 Enable `showParkFilter` on the Reservations venue picker
    - Pass the picker's existing `showParkFilter` prop. Leave `defaultPark` unset so nothing is filtered out until the member narrows. No change to `ExperiencePicker` itself is required — the chips, the `all` chip, and the Destination-plus-category request composition already exist.
    - _Requirements: 3.13, 3.14, 3.15_
  - [x] 9.2 Tests
    - `TripReservationsScreen.test.tsx`: the Destination chips render (including Resorts); no Destination is selected initially; pressing a park chip issues a Catalog request carrying BOTH `categories=` for the kind and `parkId=` for the destination (proving R3.15 composition rather than override); and pressing the Resorts chip scopes by `areaType=Resort`.
    - _Requirements: 3.13, 3.14, 3.15_
  - [x] 9.3 Checkpoint
    - `npm run verify:mobile`, then the full `npm run verify` once.
    - _Requirements: 3.13_

## Notes

- **No new endpoint and no new Trip_Action.** The Reservations screen reads the existing `GET /trips/:id/planned-items` and filters client-side; writes reuse the existing Planned_Item routes. Authorization is inherited from Planned_Item rules (R6.4). Do not add a `/trips/:id/reservations` route or an `add_reservation` action to `permissions.ts`.
- **The Optimization_Engine is not modified.** `optimizer.ts` already handles a fixed anchor and a Lightning-Lane return window. If you find yourself editing `optimizer.ts`, stop — the requirement is being misread.
- **Task 3.3 is a defect fix, not a feature.** The existing `updatePlannedItemTimes` overwrites `planned_time` with the optimizer's simulated arrival for every item, which for a fixed item can be *later* than the pin when the day is infeasible. Its regression test must live at the pg-mem repo layer and must fail against the pre-fix SQL; a route test with a mocked repo would pass either way and does not count.
- **`.strict()` schemas.** `plannedItemAddSchema` and `plannedItemEditSchema` are `.strict()`, so until task 1.2 lands, any request carrying a reservation field is rejected outright. Land the shared contracts before wiring any consumer.
- **Guard test hazard.** Task 1.2 breaks `plannedCompletionModelConstraints.test.ts` by design (exact `toEqual` on the DTO field list). Task 1.3 fixes it in the same unit of work — do not report task 1 done with that test red.
- **Verification tiers.** Use the single-file inner loop (`npx vitest run <path>` / `npx jest <file>`) while iterating; the scoped `verify:shared` / `verify:api` / `verify:mobile` at tasks 2, 4, and 6; the full `npm run verify` exactly once at task 7.
- **Mobile tests are Jest.** `reservations.test.ts` and the screen tests run under `jest-expo` in `apps/mobile`, never Vitest. The shared schema tests and all `apps/api` tests are Vitest.
- **Open questions deliberately left out of scope** — do not implement without a spec amendment: a dining arrival buffer so the optimizer targets ~10 minutes before an ADR (this would change the Fixed_Item semantics and touch day-planning Property 1); Lightning Lane purchase price tracking; per-member rather than per-Trip reservations; and importing bookings from any Disney account or email source.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.4"] },
    { "id": 1, "tasks": ["1.2", "1.5"] },
    { "id": 2, "tasks": ["1.3", "1.6"] },
    { "id": 3, "tasks": ["2"] },
    { "id": 4, "tasks": ["3.1", "5.1"] },
    { "id": 5, "tasks": ["3.2", "5.2"] },
    { "id": 6, "tasks": ["3.3"] },
    { "id": 7, "tasks": ["3.4"] },
    { "id": 8, "tasks": ["3.5", "3.6"] },
    { "id": 9, "tasks": ["4"] },
    { "id": 10, "tasks": ["6.1", "6.2"] },
    { "id": 11, "tasks": ["6.3"] },
    { "id": 12, "tasks": ["6.4", "6.5"] },
    { "id": 13, "tasks": ["6.6"] },
    { "id": 14, "tasks": ["7"] },
    { "id": 15, "tasks": ["8.1", "8.2"] },
    { "id": 16, "tasks": ["8.3"] },
    { "id": 17, "tasks": ["8.4"] },
    { "id": 18, "tasks": ["8.5"] },
    { "id": 19, "tasks": ["9.1"] },
    { "id": 20, "tasks": ["9.2"] },
    { "id": 21, "tasks": ["9.3"] }
  ]
}
```

- Tasks 1.1–1.6 are the contract layer; nothing else can compile against reservation fields until 1.2 lands, and 1.2 turns the DTO guard test red until 1.3 widens it.
- Task 3 (backend) and task 5 (the pure mobile module) are independent after checkpoint 2 and may run in parallel.
- Task 6 needs both: the screen consumes the DTO fields from task 3.4 and the grouping from task 5.1.
