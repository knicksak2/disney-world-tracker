# Implementation Plan: Day Planning and Wait Time Optimization

## Overview

This plan adds a day-by-day schedule and an optimized touring plan to Trips. It **depends on the Crowd Calendar and Wait-Time Intelligence feature** (`.kiro/specs/crowd-calendar`), which must provide `predictionService.getDaySnapshot()` before task 6 wiring. This plan builds bottom-up: shared scheduling contracts and a small migration first, then the pure travel/optimizer modules (property-tested with no I/O), then backend wiring that prefetches a `WaitSnapshot` and runs the optimizer, then the mobile Schedule/timeline UI.

Implementation is **TypeScript**. It reuses `experiences.latitude/longitude` for coordinates, `services/trips/permissions.ts` for authorization, and `services/trips/wdwClock.ts` for the WDW time zone. Scheduling columns already exist from migration `0019`; this plan adds only `planned_items.is_lightning_lane` in migration `0021`. Wait prediction, sampling, and seeding are NOT in this plan — they belong to the crowd-calendar feature.

## Tasks

- [ ] 1. Shared contracts and migration
  - [ ] 1.1 Extend `@dwt/shared` scheduling contracts
    - Add `WALKING_SPEEDS` and `PLANNED_ITEM_TYPES` to `enums.ts`; add `plannedDate`, `plannedTime`, `isFixed`, `isLightningLane`, `useSingleRider`, `priority`, `itemType`, `durationMinutes` to `PlannedItemDTO`/`PlannedItemAddInput` with Zod validation and index exports.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 6.4_
  - [ ] 1.2 Add optimization DTOs
    - Define `TripOptimizationInput` and `TripOptimizationResult` (with `OptimizedItem`, `unfittedItemIds`, `warnings`, `travelFromPrev`); import `WaitSnapshot` from the crowd-calendar shared contracts.
    - _Requirements: 3.1, 3.8, 4.4_
  - [ ] 1.3 Add migration `0021_planned_item_ride_options.sql`
    - Add `planned_items.is_lightning_lane BOOLEAN NOT NULL DEFAULT FALSE` and `planned_items.use_single_rider BOOLEAN NOT NULL DEFAULT FALSE`. `BEGIN/COMMIT`, inline comment.
    - _Requirements: 2.3, 6.4_
  - [ ] 1.4 Property test for scheduling schema alignment
    - **Property: PlannedItem inputs and DTOs stay aligned after the scheduling/LL field additions.**
    - _Requirements: 2.1, 2.3_

- [ ] 2. Pure travel + optimizer (`services/planning/`)
  - [ ] 2.1 `travel.ts` — Haversine × 1.4 path factor, absolute pace scaling (50/80/100 m/min), default travel for null coordinates, 45-minute park-hop penalty.
    - _Requirements: 3.4, 3.5, 3.6_
  - [ ] 2.2 `optimizer.ts` greedy construction + timeline simulation
    - Respect fixed anchors, Lightning_Lane minimal waits, early-entry start; per-item arrival simulation reading the injected `WaitSnapshot` at each simulated hour. Experience-type handling: shows scheduled to a showtime (wait = time-to-next-show), virtual-queue rides flagged and excluded from standby, `use_single_rider` items using the single-rider wait; label each in the result.
    - _Requirements: 3.1, 3.2, 3.3, 3.7, 6.1, 6.2, 6.3, 6.4, 6.5_
  - [ ] 2.3 `optimizer.ts` or-opt / 2-opt local search + seeded restarts
    - Re-simulate downstream arrivals after each move; keep the best under a fixed seed; enforce the ≤20-item / 2s budget; drop lowest-priority items when over-constrained and report them.
    - _Requirements: 3.2, 3.8, 3.9, 3.10_
  - [ ] 2.4 Optimizer + travel property tests
    - **Property 1: Fixed items are never moved.**
    - **Property 2: The simulated timeline is monotonic and self-consistent.**
    - **Property 3: Optimization is deterministic.**
    - **Property 4: Priority dominates under over-constraint.**
    - **Property 5: Travel cost is symmetric, pace-scaled, and penalizes hops.**
    - **Property 6: Experience types are handled per their kind.**
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.8, 3.10, 6.2, 6.3, 6.4_

- [ ] 3. Checkpoint — pure core complete
  - Ensure `travel` and `optimizer` property tests pass before wiring; ask the user if questions arise.

- [ ] 4. Backend wiring and routes (`services/trips/`)
  - [ ] 4.1 Persistence for scheduling fields
    - Extend `addPlannedItem`/`listPlannedItems`, add `updateSuggestedTimes`; store/read `planned_time` as UTC via `wdwClock`.
    - _Requirements: 2.1, 2.2, 5.2_
  - [ ] 4.2 Add scheduling actions to `permissions.ts` and gate routes
    - Member-allowed scheduling actions; `POST /trips/:id/schedule/optimize` and `PATCH /trips/:id/planned-items/:itemId` require membership.
    - _Requirements: 5.1_
  - [ ] 4.3 `POST /trips/:id/schedule/optimize` handler
    - Prefetch `WaitSnapshot` via the crowd-calendar `predictionService.getDaySnapshot(experienceIds, date, park)`, run `optimize`, persist suggested times, return `TripOptimizationResult`; tolerate a fallback snapshot.
    - _Requirements: 1.1, 1.2, 1.3, 3.1_
  - [ ] 4.4 Integration tests (`routes.schedule.test.ts`)
    - Member gate, scheduling persistence, transit penalty + pace reflected in results, `planned_time` time-zone round-trip; optimize route with a stubbed Prediction_Service.
    - _Requirements: 5.1, 5.2, 3.5, 3.6_

- [ ] 5. Mobile Schedule UI (`apps/mobile`)
  - [ ] 5.1 New `TripSchedule` screen + Schedule Builder (in `TripsStack`)
    - Add a dedicated `TripSchedule` screen (reached from `TripDetail`/`TripPlannedList`, which stays the "bucket" of planned items); group by date vs. unscheduled; toggle Fixed/Flexible, set fixed times, mark Lightning_Lane, toggle single-rider, add breaks, set priority; planning settings (`walking_speed`, `early_entry_eligible`); optional link to the Crowd Calendar to pick a date.
    - _Requirements: 4.1, 4.2, 1.4_
  - [ ] 5.2 "Optimize Day" action + timeline (on `TripSchedule`)
    - Trigger with loading state; render arrivals, predicted waits, walk/park-hop gaps; label single-rider / show-slot / virtual-queue items; over-hours / unfitted-priority warnings.
    - _Requirements: 4.3, 4.4, 4.5, 6.5_
  - [ ] 5.3 Component tests for Timeline, TransitGap, and warning states.
    - _Requirements: 4.4, 4.5_

- [ ] 6. Verification
  - [ ] 6.1 `migration0021.test.ts` — the `is_lightning_lane` and `use_single_rider` columns apply.
    - _Requirements: 2.3, 6.4_
  - [ ] 6.2 End-to-end manual pass — plan a multi-ride, multi-park day (with a fixed LL and a break) and confirm the plan is realistic and minimizes wait + walk.
    - _Requirements: 3.2, 3.6, 4.4_

## Notes

- Test-only tasks (1.4, 2.4, 4.4, 5.3, 6.1) are optional for a faster MVP; core tasks are never optional.
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
    { "id": 7, "tasks": ["6.2"] }
  ]
}
```
