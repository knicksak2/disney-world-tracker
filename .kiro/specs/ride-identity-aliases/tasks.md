# Implementation Plan: Ride Identity Aliases

## Overview

Group multiple upstream Experiences that are the same physical ride (film swaps like Soarin') under one Canonical_Ride so wait history is pooled and prediction is continuous across swaps. Reuses the shipped crowd-calendar tables/services and the day-planning optimize route; adds one curated mapping table and a small resolver, then routes sampling (write) and prediction (read) through the canonical. Implementation is TypeScript. Depends on `crowd-calendar` and interacts with `day-planning-optimization` (both built).

Use the **next free sequential migration number** at implementation time (check `apps/api/migrations/` — do not reuse an existing number).

## Tasks

- [ ] 1. Migration + curated seed
  - [ ] 1.1 Add migration `00NN_ride_aliases.sql`
    - `ride_aliases(alias_experience_id UUID PK REFERENCES experiences(id) ON DELETE CASCADE, canonical_experience_id UUID NOT NULL REFERENCES experiences(id) ON DELETE CASCADE, CHECK (alias_experience_id <> canonical_experience_id))`. `BEGIN/COMMIT`.
    - Seed the curated pair(s) from design → Configuration & Constants, each with a comment justifying it as a film swap (not a replacement). Look up the two Soarin' `experiences.id`s by name at seed time.
    - _Requirements: 1.1, 1.2, 1.5_
  - [ ] 1.2 `migrationNNNN.test.ts` (pg-mem)
    - Assert the table + `not-self` constraint; assert a canonical id never also appears as an alias id (single-level/acyclic guard).
    - _Requirements: 1.4_

- [ ] 2. Resolver
  - [ ] 2.1 `services/intelligence/rideIdentity.ts` + `IntelligenceRepo.getRideAliases`
    - Pure resolution (`resolveCanonical`, `resolveCanonicalMap`) given the loaded map, with a lazy TTL-cached load (reuse the directory refresh pattern). Non-aliased → self; single-step only.
    - _Requirements: 1.3, 1.4_
  - [ ] 2.2 Resolver property tests
    - **Property 1: Resolution is total, idempotent, and single-step.**
    - _Requirements: 1.3, 1.4_

- [ ] 3. Write path — sampling pools to canonical
  - [ ] 3.1 Route `ride_shapes`/`experience_season_hour` upserts through `resolveCanonical`
    - Key shape/season buckets by canonical id; leave wait_samples, daily signals, and experience signals keyed by the live experience.
    - _Requirements: 2.1, 2.2, 2.3_
  - [ ] 3.2 Pooling test (property + repo)
    - **Property 2: Wait pooling is alias-invariant.** Plus a pg-mem repo test that an observation on an alias lands on the canonical's bucket.
    - _Requirements: 2.1, 2.2_

- [ ] 4. Read path — prediction reads canonical
  - [ ] 4.1 `getDaySnapshot` resolves requested ids → canonicals, reads canonical shapes/seasons, returns keyed by requested id
    - _Requirements: 3.1, 3.2, 3.3_
  - [ ] 4.2 Prediction test
    - **Property 3: Prediction is alias-invariant and identity-preserving.** Plus a unit test: aliased id returns canonical curve keyed by requested id; non-aliased id unchanged.
    - _Requirements: 3.1, 3.2, 3.3_

- [ ] 5. Day-planning coordinate fallback
  - [ ] 5.1 In the optimize route, when an item's experience has null coordinates, fall back to its canonical's coordinates
    - Prediction already flows through `getDaySnapshot` (task 4), so no optimizer change is needed.
    - _Requirements: 4.1, 4.2_
  - [ ] 5.2 Integration test (`server.inject`)
    - Optimize for a planned item that is an alias yields a real prediction (not the flat default).
    - _Requirements: 4.1_

- [ ] 6. Checkpoint — verify and hand back
  - Run the full `npm run verify` once; paste output; confirm the behavior→test map covers every property and route above.

## Notes

- Test tasks are **required, not optional** — every new module gets unit + property tests, every migration a `migrationNNNN.test.ts`, every routed read/write a test proving the canonical routing. Tag property tests `Feature: ride-identity-aliases, Property {n}`, ≥100 `fast-check` runs.
- The alias set is **curated, never auto-detected** — a film swap merges, a ride replacement (e.g. Splash → Tiana's) must not. Adding a pair is a deliberate, justified edit to the seed.
- No new external API and no new env vars. Version-specific per-day signals (LL price/availability, showtimes, VQ) stay attributed to the live experience; only aggregate wait shape/season history pools.
- Open question for the maintainer: which of the Soarin' pair is the canonical (pick the historically-richest and document it), and confirm no other pair is added without manual film-swap-vs-replacement review.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "2.2"] },
    { "id": 2, "tasks": ["3.1", "4.1"] },
    { "id": 3, "tasks": ["3.2", "4.2", "5.1"] },
    { "id": 4, "tasks": ["5.2"] },
    { "id": 5, "tasks": ["6"] }
  ]
}
```
