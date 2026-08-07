# Implementation Plan: Day Planning and Wait Time Optimization

## Overview

This plan adds a day-by-day schedule and an optimized touring plan to Trips. It **depends on the Crowd Calendar and Wait-Time Intelligence feature** (`.kiro/specs/crowd-calendar`), which must provide `predictionService.getDaySnapshot()` before task 6 wiring. This plan builds bottom-up: shared scheduling contracts and a small migration first, then the pure travel/optimizer modules (property-tested with no I/O), then backend wiring that prefetches a `WaitSnapshot` and runs the optimizer, then the mobile Schedule/timeline UI.

Implementation is **TypeScript**. It reuses `experiences.latitude/longitude` for coordinates, `services/trips/permissions.ts` for authorization, and `services/trips/wdwClock.ts` for the WDW time zone. Scheduling columns already exist from migration `0019`; this plan adds only `planned_items.is_lightning_lane` and `use_single_rider` in migration **`0022`** (`0020` and `0021` are taken by the deployed crowd-calendar feature — never reuse them). Wait prediction, sampling, and seeding are NOT in this plan — they belong to the crowd-calendar feature, whose `getDaySnapshot(experienceIds, park, date)` this plan consumes.

## Tasks

- [x] 1. Shared contracts and migration
  - [x] 1.1 Extend `@dwt/shared` scheduling contracts
    - Add `WALKING_SPEEDS` and `PLANNED_ITEM_TYPES` to `enums.ts`; add `plannedDate`, `plannedTime`, `isFixed`, `isLightningLane`, `useSingleRider`, `priority`, `itemType`, `durationMinutes` to `PlannedItemDTO`/`PlannedItemAddInput` with Zod validation and index exports.
    - **Then update `apps/api/src/services/trips/__tests__/plannedCompletionModelConstraints.test.ts`:** it asserts `PlannedItemDTO` has exactly its five original fields. Adding the scheduling/LL fields makes that false — widen that assertion to allow the new scheduling/LL fields while still forbidding a *completion* field. (The migration-scan half of this guard was already relaxed to allow post-0015 `planned_items` scheduling migrations while still forbidding a completion column/link, so the baseline is green; you only need the `PlannedItemDTO` field assertion. Do **not** re-introduce a persisted completion field/column/route.)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 6.4_
  - [x] 1.2 Add optimization DTOs
    - Define `TripOptimizationInput` and `TripOptimizationResult` (with `OptimizedItem`, `unfittedItemIds`, `warnings`, `travelFromPrev`); import `WaitSnapshot` from the crowd-calendar shared contracts.
    - _Requirements: 3.1, 3.8, 4.4_
  - [x] 1.3 Add migration `0022_planned_item_ride_options.sql` (NOT `0021` — `0020`/`0021` are the deployed crowd-calendar migrations)
    - Add `planned_items.is_lightning_lane BOOLEAN NOT NULL DEFAULT FALSE` and `planned_items.use_single_rider BOOLEAN NOT NULL DEFAULT FALSE`. `BEGIN/COMMIT`, inline comment. File goes in `apps/api/migrations/`.
    - _Requirements: 2.3, 6.4_
  - [x] 1.4 Property test for scheduling schema alignment
    - **Property: PlannedItem inputs and DTOs stay aligned after the scheduling/LL field additions.**
    - _Requirements: 2.1, 2.3_
  - [x] 1.5 Add migration `0023_trip_touring_hours.sql` and `@dwt/shared` DTO contracts
    - Add `day_touring_hours JSONB NOT NULL DEFAULT '{}'::jsonb` column to `trips`. Add `dayTouringHoursSchema` and `DayTouringHoursDTO` to `@dwt/shared`.
    - _Requirements: 7.1_

- [x] 2. Pure travel + optimizer (`services/planning/`)
  - [x] 2.1 `travel.ts` — Haversine × 1.4 path factor, absolute pace scaling (50/80/100 m/min), default travel for null coordinates, 45-minute park-hop penalty.
    - _Requirements: 3.4, 3.5, 3.6_
  - [x] 2.2 `optimizer.ts` greedy construction + timeline simulation
    - Respect fixed anchors, Lightning_Lane minimal waits, early-entry start; per-item arrival simulation reading the injected `WaitSnapshot` at each simulated hour. Experience-type handling: shows scheduled to a showtime (wait = time-to-next-show), virtual-queue rides flagged and excluded from standby, `use_single_rider` items using the single-rider wait; label each in the result.
    - _Requirements: 3.1, 3.2, 3.3, 3.7, 6.1, 6.2, 6.3, 6.4, 6.5_
  - [x] 2.3 `optimizer.ts` or-opt / 2-opt local search + seeded restarts
    - Re-simulate downstream arrivals after each move; keep the best under a fixed seed; enforce the ≤20-item / 2s budget; drop lowest-priority items when over-constrained and report them.
    - _Requirements: 3.2, 3.8, 3.9, 3.10_
  - [x] 2.4 Optimizer + travel property tests
    - **Property 1: Fixed items are never moved.**
    - **Property 2: The simulated timeline is monotonic and self-consistent.**
    - **Property 3: Optimization is deterministic.**
    - **Property 4: Priority dominates under over-constraint.**
    - **Property 5: Travel cost is symmetric, pace-scaled, and penalizes hops.**
    - **Property 6: Experience types are handled per their kind.**
    - **Property 7: Extended Evening and After-Hours Schedule Optimization.**
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.8, 3.10, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4_
  - [x] 2.5 Extended Evening (+120m) & Ticketed After-Hours (+180m / 4 PM mix-in) simulate logic
    - Implement `useExtendedEvening` and `hasAfterHoursTicket` window expansion and 4 PM mix-in start in `optimizer.ts`, with unit tests in `optimizer.extendedHours.test.ts`.
    - _Requirements: 7.2, 7.3_

- [x] 3. Checkpoint — pure core complete
  - Ensure `travel` and `optimizer` property tests pass before wiring; ask the user if questions arise.

- [x] 4. Backend wiring and routes (`services/trips/`)
  - [x] 4.1 Persistence for scheduling fields
    - Extend `addPlannedItem`/`listPlannedItems`, add `updateSuggestedTimes`; store/read `planned_time` as UTC via `wdwClock`.
    - _Requirements: 2.1, 2.2, 5.2_
  - [x] 4.2 Add scheduling actions to `permissions.ts` and gate routes
    - Member-allowed scheduling actions; `POST /trips/:id/schedule/optimize` and `PATCH /trips/:id/planned-items/:itemId` require membership.
    - _Requirements: 5.1_
  - [x] 4.3 `POST /trips/:id/schedule/optimize` handler
    - Prefetch the snapshot via `predictionService.getDaySnapshot(experienceIds, park, date)` — **arg order park→date**, returns `Record<string, WaitSnapshot>` keyed by experienceId (resolve each item's `park` from `experiences.park`). Run `optimize`, persist suggested times, return `TripOptimizationResult`; tolerate a fallback/partial snapshot (see the snapshot gap in design → Cross-Spec Dependencies; the optimizer must degrade to standby when `showtimes`/`singleRiderWaitMinutes` are absent, per R6.6).
    - _Requirements: 1.1, 1.2, 1.3, 3.1_
  - [x] 4.4 Integration tests (`routes.schedule.test.ts`)
    - Member gate, scheduling persistence, transit penalty + pace reflected in results, `planned_time` time-zone round-trip; optimize route with a stubbed Prediction_Service.
    - _Requirements: 5.1, 5.2, 3.5, 3.6_

- [x] 5. Mobile Schedule UI (`apps/mobile`)
  - [x] 5.1 Interactive Date Selector Bar & Inline Catalog Experience Search (`TripScheduleScreen.tsx`)
    - Add horizontal date pill selector for switching trip dates; add `+ Add Experience to [Date]` button opening `ExperiencePicker` modal for inline additions.
    - _Requirements: 4.1, 4.2, 1.4_
  - [x] 5.2 Dining Reservations, Lightning Lane, Single Rider & Persistent Itinerary Timeline (`TripScheduleScreen.tsx`)
    - Add Item Settings Modal for setting Fixed Time (dining/shows), ⚡ Lightning Lane, 👤 Single Rider, priority, and durations.
    - Render persistent chronological timeline with arrival times, predicted waits, and walking time connectors (`+3m walk`).
    - Connect `✨ Optimize Day` action to backend optimizer with instant UI refetch and persistence.
    - _Requirements: 4.3, 4.4, 4.5, 6.5_
  - [x] 5.3 Mobile Schedule Component Tests (`TripScheduleScreen.test.tsx`)
    - Test date switching, adding catalog experience to day, setting fixed dining reservation times, running optimizer, and rendering walking connectors.
    - _Requirements: 4.4, 4.5_
  - [x] 5.4 Fix backend `addPlannedItem` repository SQL insert (`apps/api/src/services/trips/repo.ts`)
    - Update `INSERT INTO planned_items` to insert `planned_date`, `planned_time`, `is_fixed`, `is_lightning_lane`, `use_single_rider`, `priority`, `item_type`, and `duration_minutes` from request body so items added to a date persist `planned_date` on creation.
    - _Requirements: 4.2_
  - [x] 5.6 Model Lightning Lane 1-hour return window & grace period in optimizer (`optimizer.ts`)
    - Model Lightning Lane return windows as 1 hour starting at `plannedTime` with Disney's 5-minute early and 15-minute late grace period (valid arrival range: `[start - 5m, start + 75m]`) instead of forcing arrival at exact start time.
    - _Requirements: 3.3, 4.7_
  - [x] 5.7 Refactor Item Settings Modal local form draft state (`TripScheduleScreen.tsx`)
    - Maintain local draft state inside the modal while open so toggling options, changing category, or entering pass time strings does not auto-close the modal on each press.
    - Only batch save changes to backend API when tapping "Done" / "Save Changes".
    - Render return window details (`Return Window: 10:00 AM – 11:00 AM (Valid 9:55 AM – 11:15 AM)`).
    - _Requirements: 4.4, 4.7_
  - [x] 5.8 Add Native Time Wheel Picker Dialog control (`TripScheduleScreen.tsx`)
    - Build an interactive Time Wheel Picker Dialog with 3 wheel columns (Hour 1-12, Minute :00-:45, AM/PM) and quick preset buttons.
    - _Requirements: 4.4_
  - [x] 5.9 Format Human-Readable Optimization Warnings (`TripScheduleScreen.tsx`)
    - Map raw warning codes (`infeasible_fixed_gap`, `over_constrained`, `expired_lightning_lane`) and experience notes into clean user messages resolving item IDs to experience names.
    - _Requirements: 4.6_
  - [x] 5.10 Add Schedule Settings Modal for Custom Touring Hours (`TripScheduleScreen.tsx`, `optimizer.ts`, `routes.ts`)
    - Add a header gear icon `⚙️` opening Schedule Settings Modal with Day Start/End hour presets (e.g. 8:00 AM – 9:00 PM), Early Entry Eligibility toggle, and Walking Pace selection.
    - Pass `startHour` and `endHour` to optimizer and update trip settings via `PATCH /trips/:id`.
    - _Requirements: 4.8_
- [x] 6. Verification
  - [x] 6.1 `migration0022.test.ts` — the `is_lightning_lane` and `use_single_rider` columns apply (pg-mem, modeled on the existing `migrationNNNN.test.ts` files).
    - _Requirements: 2.3, 6.4_
  - [x] 6.2 End-to-end manual pass — plan a multi-ride, multi-park day (with a fixed LL and a break) and confirm the plan is realistic and minimizes wait + walk.
    - _Requirements: 3.2, 3.6, 4.4_

- [x] 7. Persisted optimization results and un-optimized state
  - [x] 7.1 Migration `0024_planned_item_optimization_result.sql` + `migration0024.test.ts`
    - Add nullable `predicted_wait_minutes INTEGER`, `travel_from_prev_minutes INTEGER`, `travel_from_prev_kind TEXT CHECK (... IN ('walk','park_hop'))`, `optimized_at TIMESTAMPTZ` to `planned_items`. `BEGIN/COMMIT`, inline comment. Test (pg-mem) asserts the columns exist, are nullable, and the `travel_from_prev_kind` CHECK rejects an invalid value.
    - _Requirements: 8.1_
  - [x] 7.2 Extend `PlannedItemDTO` with the persisted optimization result
    - Add `predictedWaitMinutes: number | null`, `travelFromPrev: { kind: 'walk' | 'park_hop'; minutes: number } | null`, `optimizedAt: string | null` to `PlannedItemDTO` in `@dwt/shared`. Read-projection only (no request-schema change).
    - _Requirements: 8.1, 8.2_
  - [x] 7.3 Persist + read + clear the optimization result in the repo
    - Change `updatePlannedItemTimes` to accept and write `predictedWaitMinutes`/`travelFromPrev`/`optimized_at = now()`; extend both `planned_items` SELECT projections and `rowToPlannedItemDto` to return the new fields; clear the four columns in `editPlannedItem`. pg-mem tests: optimize-style write round-trips via `listPlannedItems` (Property 8); `editPlannedItem` nulls the result (R8.4).
    - _Requirements: 8.1, 8.2, 8.4_
  - [x] 7.4 Wire the optimize route to persist the derived result
    - In `POST /trips/:id/schedule/optimize`, map each `result.items` entry's `predictedWaitMinutes` and `travelFromPrev` into the `updatePlannedItemTimes` payload. `server.inject` test: optimize then `GET /trips/:id/planned-items` returns the persisted result.
    - _Requirements: 8.1, 8.2_
  - [x] 7.5 Render persisted results and the un-optimized state (`TripScheduleScreen.tsx`)
    - Remove the hardcoded placeholder branch: render waits/travel from the fresh `optResult` when present, else from each item's persisted fields. Omit the wait pill when unoptimized; show a "Not optimized yet — tap Optimize Day" notice for a day with no persisted result; show a "Last optimized {time}" hint when it has one. Component tests: an already-optimized day renders persisted waits + hint; a never-optimized day omits the pill and shows the notice.
    - _Requirements: 8.2, 8.3_

- [x] 8. Rope-drop wait modeling (R3.7, R3.11)
  - [x] 8.1 Model rope-drop-appropriate waits in `optimizer.ts`
    - Ramp a shape-derived standby/single-rider wait from a 5-min walk-on floor at the operating-window open up to the full predicted wait over the first 30 minutes (the early-entry window when eligible). Only lowers a wait. Leave LL/VQ/show waits untouched. Unit tests (rope drop at open → walk-on; past the window → full wait) plus the Property 9 `fast-check` test (≥100 runs, tagged) in `optimizer.ropeDrop.test.ts`; both would fail against the pre-fix code that returned the raw hourly wait.
    - _Requirements: 3.7, 3.11_

- [x] 9. Early-entry ride availability (R3.12)
  - [x] 9.1 Add `operatesDuringEarlyEntry` to `OptimizeInputItem` and clamp/anchor in `optimizer.ts`
    - Add `operatesDuringEarlyEntry: boolean | null` to `OptimizeInputItem`. On an `earlyEntryEligible` day: clamp a non-early-entry (false/null) item's earliest arrival to official open (`startMins + 30`); allow early-entry items from `startMins`. Anchor the rope-drop ramp (task 8.1) per item to its first-rideable open (early-entry open for EE items, official open otherwise). Unit tests (non-EE ride not scheduled before official open; EE ride may be; ramp anchored correctly) + Property 10 `fast-check` test (≥100 runs, tagged) — all would fail against the pre-change code that scheduled any ride from `startMins`.
    - _Requirements: 3.12_
  - [x] 9.2 Feed the flags from the catalog through the optimize route (`routes.ts`)
    - Extend the route's `SELECT ... FROM experiences WHERE id = ANY($1)` to include `operates_during_early_entry`, `operates_during_extended_evening`, `operates_during_ticketed_event` and map them into each `OptimizeInputItem`. `server.inject` test: a non-early-entry ride on an early-entry day is not scheduled before official open. Depends on `disney-facilities-catalog-source` persisting the columns.
    - _Requirements: 3.12, 3.13_
  - [x] 9.3 Late-window availability gating in `optimizer.ts` (R3.13)
    - Add `operatesDuringExtendedEvening` / `operatesDuringTicketedEvent` to `OptimizeInputItem`; gate the +120 / +180 extensions per item (non-eligible rides close at base hours). Unit tests (non-eligible dropped, eligible fit, both windows) + Property 11 `fast-check` test in `optimizer.lateWindow.test.ts`.
    - _Requirements: 3.13_

## Notes

- Test tasks (1.4, 2.4, 4.4, 5.3, 6.1) are **required, not optional** — a feature task is not complete until its tests exist and pass. Per the execution-discipline steering: every new pure module gets unit + property tests, every route a `server.inject` integration test, every migration a `migrationNNNN.test.ts`, and every mobile component a `@testing-library/react-native` render test. Do not defer, skip, or mark a task done without them.
- Property tests reference a design Correctness Property, run ≥100 `fast-check` iterations, and are tagged `Feature: day-planning-optimization, Property {n}`.
- The pure modules (`travel`, `optimizer`) carry no I/O; the `WaitSnapshot` is injected, so properties run directly against the functions with a stub.
- **Dependency:** the crowd-calendar feature's `predictionService` must exist before task 4.3; until then, task 2 can proceed against a stubbed snapshot.
- `permissions.ts` and `wdwClock.ts` are reused; this plan adds no new auth or time-zone logic and no wait-model logic.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "2.1"] },
    { "id": 1, "tasks": ["1.4", "2.2"] },
    { "id": 2, "tasks": ["2.3"] },
    { "id": 3, "tasks": ["2.4", "3"] },
    { "id": 4, "tasks": ["4.1", "4.2", "4.3"] },
    { "id": 5, "tasks": ["4.4", "5.1", "5.2"] },
    { "id": 6, "tasks": ["5.3", "6.1"] },
    { "id": 7, "tasks": ["6.2"] },
    { "id": 8, "tasks": ["7.1", "7.2"] },
    { "id": 9, "tasks": ["7.3", "7.4"] },
    { "id": 10, "tasks": ["7.5"] },
    { "id": 11, "tasks": ["8.1"] },
    { "id": 12, "tasks": ["9.1", "9.2", "9.3"] }
  ]
}
```
