# Design Document

## Overview

Trip Reservations adds a booking *facet* to the existing `planned_items` row plus one new read surface. There is no new service, no new table, no background work, and no engine change.

### Key design decisions

1. **A Reservation is a Planned_Item, not a new entity.** The alternative — a `reservations` table materialized into `planned_items` — would need a synchronization path with no good answer to "the member deleted the derived schedule item" or "the member changed the derived item's time." One row means one truth, and Requirement 4's "automatically put it in the schedule builder" becomes a property of the data model rather than a job that can fail. This is also why no `add_reservation` Trip_Action is added: the row is already governed by Planned_Item authorization.

2. **`reservation_kind` is orthogonal to the timing flags.** `is_fixed` / `is_lightning_lane` say *how the optimizer times the item*; `reservation_kind` says *what kind of real booking it is*. Keeping them separate is what lets the UI distinguish "I hold a 6 PM ADR" from "I'd like to ride this at 6 PM," which is Requirement 4.3. The repo derives the timing flags from the kind on write (R1.7), so a client cannot produce a `dining` Reservation that is not fixed.

3. **A Non_Catalog_Reservation reuses `itemType = 'break'`.** An unlocated item already must be a break, and the optimizer already gives breaks zero queue wait and travel-neutral linkage — exactly right for an off-property dinner. So the `item_type` CHECK constraint stays a two-value vocabulary, and only the *presentation* changes: `reservation_kind` overrides the "break" label. Widening `item_type` would have touched the optimizer's downtime-adjacency and duration logic for no behavioral gain.

4. **The optimizer must not rewrite a Booked_Time.** In `simulate()`, a fixed item's arrival is `Math.max(travelArrival, fixedArrival)`, so when a day is infeasible the returned `suggestedArrival` is *later* than the pin — and `updatePlannedItemTimes` writes `planned_time = suggestedArrival` for every result item. For a self-pinned preference that is merely surprising; for a real booking it corrupts a fact about the world. This design makes the persistence step skip `planned_time` for rows with a non-null `reservation_kind` while still storing the wait, travel leg, and `optimized_at` (R4.4). Scoping the fix to Reservations keeps it additive: existing day-planning behavior and property tests for non-reservation fixed items are unchanged.

5. **No new endpoint.** The Reservations_Screen reads `GET /trips/:id/planned-items` — which it already needs in full to compute date groups — and filters on `reservationKind != null` client-side. A trip is capped at 500 planned items, so there is no payload argument for a second endpoint, and reusing the existing route means the membership gate, the DTO, and the query-key invalidation are all inherited (R6.1).

## Architecture

### Placement

| Concern | Location |
| --- | --- |
| Reservation vocabulary, Zod fields, DTO fields | `packages/shared/src/trips.ts`, `packages/shared/src/enums.ts` |
| Columns + constraints | `apps/api/migrations/0031_planned_item_reservations.sql` |
| Write rules (kind → timing flags, date/time invariant) | `apps/api/src/services/trips/repo.ts` (`addPlannedItem`, `editPlannedItem`) |
| Booked_Time preservation on optimize | `apps/api/src/services/trips/repo.ts` (`updatePlannedItemTimes`) |
| Routes | none new — existing Planned_Item routes carry the new fields |
| Reservations screen | `apps/mobile/src/screens/trips/TripReservationsScreen.tsx` |
| Hub entry + route registration | `apps/mobile/src/screens/trips/TripDetailScreen.tsx`, `apps/mobile/src/navigation/TripsStack.tsx` |
| Reservation badge on the timeline | `apps/mobile/src/screens/trips/TripScheduleScreen.tsx` |

Nothing is added to `composeServices.ts`: the feature introduces no new service and no new injected port.

### Reservations screen architecture

`TripReservationsScreen` is a read-mostly screen over the same two queries the Schedule_Builder uses, so opening it after the Schedule_Builder is a cache hit:

- `tripDetailKeys.detail(tripId)` → `TripDTO`, for the header and the trip date range.
- `tripPlannedListKeys.items(tripId)` → `readonly PlannedItemDTO[]`, the single source for the list.

Grouping is a pure derivation over the item list (see `groupReservationsByDate` below) so it is unit- and property-testable without rendering. Mutations reuse the Schedule_Builder's endpoints and invalidate `tripPlannedListKeys.items(tripId)`, which is why an add on this screen shows up on the Schedule_Builder with no extra wiring.

## Components and Interfaces

### Pure module (`apps/mobile/src/screens/trips/reservations.ts`)

```ts
/** One date's Reservations, ordered by Booked_Time ascending (R2.1). */
export interface ReservationDateGroup {
  readonly date: string;                       // YYYY-MM-DD
  readonly items: readonly PlannedItemDTO[];
}

/**
 * Select the Reservations from a Planned_List and group them by date (R1.3, R2.1).
 * Items with a null `reservationKind` are excluded. Groups are date-ascending;
 * items within a group are `plannedTime`-ascending, with a stable tie-break on
 * `id` so the order is total and does not flicker between renders.
 */
export function groupReservationsByDate(
  items: readonly PlannedItemDTO[],
): readonly ReservationDateGroup[];

/** The display title for a Reservation: Experience name, else Custom_Title, else a kind fallback (R5.2). */
export function reservationTitle(item: PlannedItemDTO): string;

/** Icon + text label for a kind; never color-only (R2.3). */
export function reservationKindPresentation(
  kind: ReservationKind,
): { readonly icon: string; readonly label: string };

/** True only when the item carries a non-null kind — a pinned time is not a booking (R1.3). */
export function isReservation(item: PlannedItemDTO): boolean;

/** Total across every group, for the header count. */
export function countReservations(groups: readonly ReservationDateGroup[]): number;

/**
 * Booked_Time entry and display. A guest reads a reservation as park-local wall
 * clock ("6:00 PM"), never as an instant, so the entry direction interprets the
 * typed time in `America/New_York` on the reservation's own date — deliberately
 * not in the device's zone — and returns the UTC instant the wire contract and
 * `planned_time TIMESTAMPTZ` expect. The offset is derived from `Intl` per date,
 * so DST is handled rather than hardcoded. Returns `null` for malformed input so
 * the screen can show a validation message instead of posting a bad instant.
 * Display of an existing Booked_Time reuses the shared `formatParkTime` from
 * `screens/catalog/live/parkTime.ts` rather than a second formatter.
 */
export function etWallClockToIso(dateString: string, timeText: string): string | null;
export function isoToEtWallClock(iso: string | null | undefined): string;

/** A group's date as a readable heading (e.g. `Thu, Oct 1`), zone-stable. */
export function formatGroupDate(dateString: string): string;

/**
 * Time_Picker support (R3.8–R3.12). A Reservation's Booked_Time is chosen from
 * discrete hour / minute / AM-PM selections rather than typed, so the
 * twelve-hour ambiguity of free text ("1:00" meaning 1 AM or 1 PM) cannot
 * arise. `etWallClockToIso` accepts the picker's unambiguous `H:MM AM/PM` form
 * as well as the original 24-hour `HH:MM`; `isoToWheelTime` seeds the picker
 * from a stored instant (R3.10).
 */
export function isoToWheelTime(iso: string | null | undefined): string;
```

### Shared component (`apps/mobile/src/components/TimeWheelPicker.tsx`)

```ts
export interface TimeWheelPickerProps {
  /** Current selection as `H:MM AM/PM`, or `''` when nothing is chosen yet. */
  readonly value: string;
  readonly onChange: (next: string) => void;
  /** Minute granularity. Reservations use 5; the Schedule Builder uses 15. */
  readonly minuteStep?: 5 | 15;
  readonly testIDPrefix: string;
}
```

Extracted from the inline hour/minute/AM-PM wheel that already existed in `TripScheduleScreen`, so there is one implementation rather than two that can drift. The Schedule Builder keeps 15-minute granularity — it is choosing a *touring preference* — while a Reservation uses 5-minute granularity because it records a real booking, and a 6:25 PM dining reservation must be representable (R3.9). When `value` is `''` the picker shows no selection, which is what lets the Reservations form require an explicit choice (R3.11).

### Shared contracts (`@dwt/shared`)

```ts
// enums.ts
export const RESERVATION_KINDS = ['dining', 'lightning_lane', 'activity', 'other'] as const;
export type ReservationKind = (typeof RESERVATION_KINDS)[number];

// trips.ts — added to plannedItemAddSchema and plannedItemEditSchema (both .strict())
reservationKind: z.enum(RESERVATION_KINDS).nullable().optional(),
confirmationNumber: z.string().trim().min(1).max(CONFIRMATION_NUMBER_MAX).nullable().optional(),
partySize: z.number().int().min(PARTY_SIZE_MIN).max(PARTY_SIZE_MAX).nullable().optional(),

// trips.ts — added to PlannedItemDTO
readonly reservationKind: ReservationKind | null;
readonly confirmationNumber: string | null;
readonly partySize: number | null;
```

`plannedItemAddSchema.superRefine` gains: when `reservationKind` is non-null, `plannedDate` and `plannedTime` are both required (R1.5), and either `experienceId` or `customTitle` must be present (R5.4). `plannedItemEditSchema.superRefine` cannot see the stored row, so the "must not clear date/time" rule (R1.6) is enforced in the repo where the current `reservation_kind` is known.

### Trip_Service repo changes (`services/trips/repo.ts`)

- `addPlannedItem` — derive timing flags from the kind before the INSERT (R1.7): a non-null kind other than `lightning_lane` forces `is_fixed = true` and leaves `window_start_minutes` / `window_end_minutes` / `meal_period` null; `lightning_lane` forces `is_lightning_lane = true`, `is_fixed = false`. Adds `reservation_kind`, `confirmation_number`, `party_size` to the existing 15-column INSERT.
- `editPlannedItem` — extend the `SELECT … FOR UPDATE` to read the current `reservation_kind`; reject an edit that would null `planned_date` or `planned_time` on a Reservation with `trip_validation_failed` (R1.6); re-derive timing flags when the kind changes; add the three columns to the dynamic `SET` list. The existing unconditional optimization-result clear satisfies R3.7.
- `updatePlannedItemTimes` — for a row whose `reservation_kind IS NOT NULL`, update only `predicted_wait_minutes`, `travel_from_prev_minutes`, `travel_from_prev_kind`, `scheduled_showtime`, `optimized_at`, omitting `planned_time` from the `SET` list (R4.4). The guard is expressed in SQL (`WHERE id = $n AND trip_id = $m` with a `CASE`/second statement keyed on `reservation_kind IS NULL`) so it holds regardless of caller.
- `selectPlannedItem` / `listPlannedItems` — add the three columns to the projection and to `rowToPlannedItemDto`.

### Mobile

- `TripsStack.tsx` — add `TripReservations: { tripId: string }` to `TripsStackParamList` and register the screen.
- `TripDetailScreen.tsx` — add `'TripReservations'` to `HubSection['route']` and a `{ key: 'reservations', route: 'TripReservations', title: 'Reservations', icon: 'ticket-outline' }` entry to `HUB_SECTIONS`, placed after `schedule`.
- `TripReservationsScreen.tsx` — `GradientHeader` + grouped `Card` rows + `EmptyState`; an add-reservation `Modal` reusing `ExperiencePicker` with a kind-driven category filter; an edit/remove `Modal`. Row press navigates to `TripSchedule` for that date.
- `ExperiencePicker.tsx` — the Reservations screen also enables the component's **existing** `showParkFilter` prop (R3.13–R3.15). No new code is needed for it: the picker already renders Destination chips for the four theme parks, the two water parks, Disney Springs, and the aggregate Resorts, and already composes the chosen Destination with the active tab's categories into one Catalog request (`categories=` plus `parkId=` / `areaType=Resort`). It is left at its default `'all'` rather than pre-selected from the day's starting park, because a booking is frequently *not* in the park the day starts in — resort dining and Disney Springs are common — so a helpful-looking default would hide the very venues hardest to find by name. Enabling the chips also makes the `activity` and `other` kinds browsable: their tab is `all`, so without a Destination or a search query the picker shows nothing.
- `ExperiencePicker.tsx` — one new optional prop, `defaultTab?: ExperiencePickerTab` (default `'all'`, so every existing usage is unchanged). Combined with the existing `showTabs={false}`, it scopes the picker to one category with no way to widen it: `dining` → the `dining` tab (`category = 'Restaurant'`), `lightning_lane` → `attractions` (`Ride`), and `activity`/`other` stay unscoped (R3.2, R3.3). The Reservations screen mounts the picker with `key={draft.kind}`, because `defaultTab` only seeds the picker's initial tab state — without the remount, changing the kind would leave the previous kind's Catalog slice on screen. That is a real defect the component test caught, so the test drives a kind change and asserts the `categories=` the picker requests.
- `TripScheduleScreen.tsx` — render a kind `Badge` on a timeline item whose `reservationKind` is non-null (R4.3), and prefer the reservation label over the break label for a Non_Catalog_Reservation (R5.2).

## Data Models

### Migration `0031_planned_item_reservations.sql`

Additive and idempotent-on-reapply; `0030_derived_stat_runs.sql` is the last applied migration.

```sql
BEGIN;

ALTER TABLE planned_items ADD COLUMN IF NOT EXISTS reservation_kind    VARCHAR(20);
ALTER TABLE planned_items ADD COLUMN IF NOT EXISTS confirmation_number VARCHAR(40);
ALTER TABLE planned_items ADD COLUMN IF NOT EXISTS party_size          SMALLINT;

ALTER TABLE planned_items DROP CONSTRAINT IF EXISTS chk_planned_items_reservation_kind;
ALTER TABLE planned_items ADD  CONSTRAINT chk_planned_items_reservation_kind
  CHECK (reservation_kind IS NULL
      OR reservation_kind IN ('dining', 'lightning_lane', 'activity', 'other'));

ALTER TABLE planned_items DROP CONSTRAINT IF EXISTS chk_planned_items_party_size;
ALTER TABLE planned_items ADD  CONSTRAINT chk_planned_items_party_size
  CHECK (party_size IS NULL OR (party_size BETWEEN 1 AND 50));

-- A Reservation is a real booking, so it is always anchored to a date and a
-- time (R1.5, R1.6). The repo rejects clearing either with a validation error;
-- this constraint is the backstop.
ALTER TABLE planned_items DROP CONSTRAINT IF EXISTS chk_planned_items_reservation_anchored;
ALTER TABLE planned_items ADD  CONSTRAINT chk_planned_items_reservation_anchored
  CHECK (reservation_kind IS NULL
      OR (planned_date IS NOT NULL AND planned_time IS NOT NULL));

CREATE INDEX IF NOT EXISTS planned_items_reservation_idx
  ON planned_items (trip_id, planned_date)
  WHERE reservation_kind IS NOT NULL;

COMMIT;
```

No column is dropped, renamed, or made `NOT NULL`, so every existing row stays valid with all three columns `NULL` — i.e. no existing planned item retroactively becomes a Reservation (R1.3).

### Storage notes

- `planned_time` remains `TIMESTAMPTZ` in UTC and is rendered in `America/New_York` via the existing mobile formatter and `wdwClock` on the server. No new time handling.
- `confirmation_number` is free text, not validated against a Disney format — the format is undocumented and varies by booking channel, so a length bound is the only safe rule.
- `party_size` is `SMALLINT`; it is display-only and never enters the Optimization_Engine.

## Correctness Properties

### Property 1: Reservation kind determines the timing mode

For any accepted add or edit, a stored Planned_Item with `reservation_kind = 'lightning_lane'` has `is_lightning_lane = true` and `is_fixed = false`; a stored Planned_Item with any other non-null `reservation_kind` has `is_fixed = true`, `is_lightning_lane = false`, and null `window_start_minutes`, `window_end_minutes`, and `meal_period`. A client cannot produce a combination that violates this, regardless of the timing flags it sends.

**Validates: Requirements 1.7, 4.2**

### Property 2: A Reservation always keeps a date and a time

For any sequence of accepted add and edit operations, every stored row with a non-null `reservation_kind` has a non-null `planned_date` and a non-null `planned_time`. Any request that would violate this is rejected with `trip_validation_failed` and leaves the stored row byte-identical.

**Validates: Requirements 1.5, 1.6, 5.4**

### Property 3: Optimization never rewrites a Booked_Time

For any optimizer result applied to a day, the `planned_time` of every row with a non-null `reservation_kind` is unchanged, including when the simulated arrival is later than the Booked_Time and the run emits `infeasible_fixed_gap` or `expired_lightning_lane`. The same run still persists that row's `predicted_wait_minutes`, `travel_from_prev_minutes`, `travel_from_prev_kind`, and `optimized_at`. Rows with a null `reservation_kind` retain today's behavior of taking the suggested arrival.

**Validates: Requirements 4.4, 4.5**

### Property 4: Reservation grouping is total, ordered, and lossless

`groupReservationsByDate` returns exactly the input items whose `reservationKind` is non-null, partitioned with no duplication and no loss; group dates are strictly ascending and distinct; items within a group are non-descending by `plannedTime` with a stable `id` tie-break; no empty group is emitted; and the result is identical across repeated calls on the same input.

**Validates: Requirements 1.3, 2.1, 2.4, 2.7**

### Property 5: Reservation field bounds are enforced at the contract edge

Any `partySize` outside 1–50, any `confirmationNumber` longer than 40 characters after trimming, and any `reservationKind` outside `RESERVATION_KINDS` is rejected with `trip_validation_failed`; every value inside those bounds round-trips through add → read and edit → read unchanged, including the `null` clears.

**Validates: Requirements 1.2, 1.4, 3.6**

### Property 6: A Non_Catalog_Reservation stays break-typed and travel-neutral

A Reservation with `experienceId = null` is stored with `item_type = 'break'`, is never stored with any other `item_type`, and is presented by its Reservation_Kind and Custom_Title rather than as a break. Fed to the Optimization_Engine it contributes zero queue wait and does not break the travel chain between its neighbours.

**Validates: Requirements 5.1, 5.2, 5.3**

### Property 7: Reservation data is member-gated

Every read and write path that can observe or change `reservationKind`, `confirmationNumber`, or `partySize` rejects a non-member with `trip_forbidden` and yields the same error for an unknown Trip id, so Trip existence cannot be probed. No non-membership-gated payload — Trip feed, Trip summary, shared or public surfaces — contains a confirmation number or party size.

**Validates: Requirements 6.1, 6.2, 6.3**

### Property 8: A picked park-local time round-trips to the correct UTC instant

For every hour 1–12, every 5-minute increment, and both meridiems, converting a Time_Picker selection on a date yields the UTC instant of that park-local wall clock — correct under both EDT and EST — and seeding the picker from that instant reproduces the identical selection. An afternoon selection never converts to its morning counterpart: the twelve-hour ambiguity free-text entry allowed is unrepresentable, because the meridiem is always an explicit part of the selection rather than an inference from the typed digits.

**Validates: Requirements 3.8, 3.9, 3.10, 3.12**

## Error Handling

| Condition | Code | Behavior |
| --- | --- | --- |
| `reservationKind` outside the vocabulary | `trip_validation_failed` | Rejected at the Zod edge with a `field` pointer; nothing persisted. |
| `partySize` outside 1–50 / `confirmationNumber` > 40 chars | `trip_validation_failed` | Rejected at the Zod edge; the DB `CHECK` is the backstop, never the primary path. |
| Reservation add missing `plannedDate` or `plannedTime` | `trip_validation_failed` | Rejected in `plannedItemAddSchema.superRefine`. |
| Edit would clear `plannedDate`/`plannedTime` on a Reservation | `trip_validation_failed` | Rejected in `editPlannedItem` after the `FOR UPDATE` read, inside the transaction, so the row is left unchanged. The `chk_planned_items_reservation_anchored` constraint must never be the thing that fires — a raw `23514` would surface as `internal_error`, so the repo check is mandatory, not defensive. |
| Reservation with neither `experienceId` nor `customTitle` | `trip_validation_failed` | Rejected at the Zod edge. |
| No time selected in the Time_Picker | none (client-side) | The form does not submit and shows "Pick a time for this reservation." No request is issued (R3.11). |
| Non-member reads or writes a Reservation | `trip_forbidden` | Existing `assertTripMember`; identical for an unknown Trip id. |
| Non-adding `member` removes a Reservation | `trip_forbidden` | Existing `removePlannedItem` rule, unchanged. |
| Trip already holds 500 planned items | `trip_planned_limit` | Existing cap; Reservations are not exempt. |
| Optimizer cannot reach a Reservation in time | none (warning) | `infeasible_fixed_gap` / `expired_lightning_lane` surfaced in the result; the Booked_Time is preserved. |

## Testing Strategy

- **Pure module** — `apps/mobile/src/screens/trips/__tests__/reservations.test.ts` (Jest, mobile workspace): unit cases for filtering, grouping, ordering, tie-breaks, empty input, and title fallbacks; plus the Booked_Time conversion helpers, including an EDT case, an EST case (proving DST is derived rather than hardcoded), midnight, and a round-trip across a DST boundary. The property tests live in `reservations.prop.test.ts` at ≥ 100 runs, tagged `// Feature: trip-reservations, Property 4: …`, generating arbitrary Planned_Item lists and asserting the partition is lossless, dates strictly ascending, times non-descending, no empty group, and that the result is both deterministic and insensitive to input order.
- **Shared schema** — `packages/shared/src/__tests__/` (Vitest): valid and invalid cases for each new field, the `reservationKind`-requires-date-and-time refinement, and the venue refinement; plus the schema-alignment property test for add/edit/DTO parity.
- **Repo** — pg-mem tests in `apps/api/src/services/trips/__tests__/`: add a Reservation of each kind and read back the derived timing flags and the three columns from the real SQL; assert an edit clearing `plannedDate` throws `trip_validation_failed` and the row is unchanged; and assert `updatePlannedItemTimes` leaves a Reservation's `planned_time` untouched while writing the wait/travel/`optimized_at` columns, and still overwrites `planned_time` for a non-reservation item. These must run the real queries — a mocked repo would not have caught the Booked_Time overwrite.
- **Migration** — `apps/api/src/db/__tests__/migration0031.test.ts` (the repo's established location for `migrationNNNN.test.ts`, alongside `migration0027`–`migration0030`): asserts the three columns, all three `CHECK` constraints, the default-NULL behavior that keeps existing rows non-reservations, and that reapplying the file is a no-op.
- **Routes** — `server.inject` tests: the membership gate on the Planned_Item routes carrying reservation fields, a happy-path create returning the new DTO fields, a validation-failure path, and an assertion that the Trip feed and Trip summary payloads contain no `confirmationNumber` or `partySize`.
- **Mobile component** — `TripReservationsScreen.test.tsx` with `@testing-library/react-native`, mocking only `apiRequest`: renders grouped rows and asserts date-group headers and row content; drives *each* interaction — opening the add modal, submitting it (asserting the POST path and the exact body including `reservationKind`/`plannedDate`/`plannedTime`/`partySize`/`confirmationNumber`), editing (asserting the PATCH body), removing (asserting the DELETE path), and tapping a row (asserting navigation to `TripSchedule` with the row's date) — and asserts the resulting on-screen change for each. Plus the empty state. A `TripScheduleScreen.test.tsx` case asserts the kind badge renders for a Reservation and not for a self-pinned fixed item.
- **Guard test** — `plannedCompletionModelConstraints.test.ts` field list widened by exactly `reservationKind`, `confirmationNumber`, `partySize`; the completion-token assertions stay.

## Configuration & Constants

No new environment variables, secrets, base URLs, or cadences: the feature adds no external integration and no scheduled work.

| Constant | Value | Where | Meaning |
| --- | --- | --- | --- |
| `RESERVATION_KINDS` | `['dining','lightning_lane','activity','other']` | `packages/shared/src/enums.ts` | The closed kind vocabulary; also the `CHECK` constraint text. |
| `CONFIRMATION_NUMBER_MAX` | `40` | `packages/shared/src/trips.ts` | Max characters, matching `VARCHAR(40)`. |
| `PARTY_SIZE_MIN` | `1` | `packages/shared/src/trips.ts` | Minimum party size. |
| `PARTY_SIZE_MAX` | `50` | `packages/shared/src/trips.ts` | Maximum party size, matching the `CHECK`. |
| `PLANNED_ITEM_LIMIT` | `500` | `apps/api/src/services/trips/repo.ts` (existing) | Reused unchanged; Reservations count against it. |
| `RESERVATION_KIND_ICONS` | `dining: restaurant-outline`, `lightning_lane: flash-outline`, `activity: ticket-outline`, `other: bookmark-outline` | `apps/mobile/src/screens/trips/reservations.ts` | Ionicons names; paired with a text label so kind is never color-only. |
| Default duration — `activity` / `other` | `60` minutes | Existing `resolveDefaultDuration` fallback | No new default is introduced; dining keeps its 30/60/90 sub-type derivation. |

### External Interfaces

None. This feature consumes no external or undocumented API — Reservations are user-entered. It reuses only in-repo interfaces: the Planned_Item routes, `assertTripMember`, `wdwClock` for `America/New_York` rendering, and `resolveDefaultDuration` in the Optimization_Engine.
