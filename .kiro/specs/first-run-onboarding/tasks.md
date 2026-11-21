# Implementation Plan

## Overview

This plan implements the `first-run-onboarding` spec in four ordered phases. Read `requirements.md` and `design.md` in this folder before starting any task.

1. **Foundation (Task 1):** the `user_onboarding` migration, shared DTOs and Zod schemas, account-deletion registration, and privacy policy updates.
2. **Backend (Task 2):** the onboarding service, repo, and routes (`GET` and `PATCH /me/onboarding`, `POST /me/onboarding/quick-completions`), with first-read grandfathering of existing users.
3. **Wave 1 mobile polish (Task 3):** `HomeSearchBar`, `TripDetailScreen`, and the `You` tab 0-pin cold start. This work runs in parallel with Task 2.
4. **Wave 2 mobile (Task 4):** the 3-step first-run onboarding flow, the Home Start Here card, and the Home declutter. It starts after both Task 2 and Task 3 checkpoints pass.

Each task lists the requirements it satisfies. Work in Task Dependency Graph order and stop at each checkpoint task.

## Tasks

- [x] 1. Migration, Shared Contracts, Account Deletion, and Privacy Policy
  - [x] 1.1 Create `apps/api/migrations/0078_user_onboarding.sql` per design.md Data Models (`user_onboarding` table with `user_id` PK referencing `users(id) ON DELETE CASCADE`, nullable `completed_at`, `skipped_at`, `grandfathered_at`, `initial_intent`, `selected_park`, `starter_checklist_dismissed_at`, non-null `updated_at`, and `CHECK` constraints on `initial_intent` and `selected_park`; no data backfill)
    - _Requirements: 1.1, 1.2_
  - [x] 1.2 Add `apps/api/src/db/__tests__/migration0078.test.ts` asserting the table and columns (including `grandfathered_at`), valid and rejected values for `chk_user_onboarding_intent` and `chk_user_onboarding_park`, and `ON DELETE CASCADE` when deleting the owning user
    - _Requirements: 1.1, 1.2_
  - [x] 1.3 Register `user_onboarding.user_id` in `apps/api/src/services/accountDeletion/dispositions.ts` (`delete`, stage 4, `chunkColumns: ['user_id']`, `today: 'cascade'`, `nullable: false`), update any explicit disposition enumerations in `dispositions.test.ts`, add a purge test confirming a user's `user_onboarding` row is deleted on purge, and update both privacy policy copies (`docs/privacy-policy.md` and `renderPrivacyPolicyHtml` in `apps/api/src/services/accountDeletion/webPages.ts`) to disclose onboarding preferences (`initial_intent`, `selected_park`, checklist state) and their deletion on account purge
    - _Requirements: 3.1, 3.2, 3.3_
  - [x] 1.4 Add shared onboarding contracts: `packages/shared/src/constants/onboarding.ts`, `packages/shared/src/dto/Onboarding.ts`, and `packages/shared/src/schemas/Onboarding.ts` (all `.strict()`, reusing `ianaTzSchema` for `userTz`, and refining `onboardingPatchSchema` to reject simultaneous `dismissStarterChecklist: true` and `restoreStarterChecklist: true`); barrel from `packages/shared/src/index.ts` and `dto/index.ts`, then run `npm run build:shared`
    - _Requirements: 1.3, 1.7, 1.9, 2.1_
  - [x] 1.5 Add `packages/shared/src/__tests__/onboarding.test.ts` testing valid and invalid cases for `onboardingPatchSchema` (each field, unknown key rejection, simultaneous dismiss+restore rejection, invalid intent/park) and `quickCompletionsInputSchema` (1–20 valid UUIDs, 0 items, 21 items, non-UUID, invalid `userTz`, unknown key)
    - _Requirements: 1.7, 1.9, 2.1_
  - [x] 1.6 Checkpoint — run `npm run build:shared`, `npm run verify:shared`, and `npm run typecheck`

- [x] 2. Backend Onboarding Service (`apps/api/src/services/onboarding/`)
  - [x] 2.1 Implement pure domain module `apps/api/src/services/onboarding/domain/statePolicy.ts` (`shouldGrandfatherOnFirstRead`, `deriveOnboardingState`, `mergeOnboardingPatch`) per design.md exact formulas; write `statePolicy.prop.test.ts` (`fast-check`, ≥100 runs) tagged for Property 1 (first-read grandfathering: `grandfatheredAt !== null` stays veteran even if activity is later cleared; `grandfatheredAt === null` keeps `needsOnboarding: true` even after Step 2 inserts completions/trips), Property 2 (monotonic idempotent `completedAt`/`skippedAt`, preserved `grandfatheredAt`), and Property 3 (`showStarterChecklist` visibility invariant)
    - _Requirements: 1.4, 1.5, 1.6, 1.7, 1.8, 1.9_
  - [x] 2.2 Implement `apps/api/src/services/onboarding/repo.ts` (`getOrInitSnapshot`, `upsertState`, `insertQuickCompletions`): `getOrInitSnapshot` checks `EXISTS` signals for `completions`, `experience_logs`, `food_item_logs`, `experience_favorites`, `active_trip_memberships`, and `user_pins (claimed_at IS NOT NULL)`, and when no `user_onboarding` row exists yet inserts `(user_id, grandfathered_at)` (`NOW()` iff prior core activity exists, else `NULL`) via `ON CONFLICT (user_id) DO NOTHING` before reading the row back; `upsertState` preserves `grandfathered_at`; `insertQuickCompletions` dedupes `experienceIds`, verifies every id exists with `active = TRUE` inside a transaction (throwing `experience_not_found` if any is missing/inactive), and inserts into `completions (user_id, experience_id, completed_on, user_tz)` with `ON CONFLICT (user_id, experience_id) DO NOTHING` without inserting into `experience_logs`
    - _Requirements: 1.3, 1.4, 1.5, 1.7, 2.2, 2.3_
  - [x] 2.3 Implement `apps/api/src/services/onboarding/service.ts` and `routes.ts` (`GET /me/onboarding`, `PATCH /me/onboarding`, `POST /me/onboarding/quick-completions`), validating `userTz` with `ianaTzSchema` and deriving `completedOn` via `formatYmdInTimeZone(clock(), userTz)` from `apps/api/src/services/tracking/logs/visitDate.ts`, calling `awardPins` at most once best-effort after commit, and gating every route with `requireSession`; wire into `apps/api/src/composeServices.ts` and `apps/api/src/server.ts`
    - _Requirements: 1.3, 1.7, 1.10, 2.1, 2.4, 2.5_
  - [x] 2.4 Write pg-mem repo tests (`repo.test.ts`) covering real SQL for first-read grandfathering (user with prior activity gets `grandfathered_at` persisted and remains grandfathered after deleting activity; brand-new user gets `grandfathered_at = NULL` so adding Step 2 completions/trip keeps `needsOnboarding: true`; concurrent/repeated first reads are idempotent), each checklist signal (including `user_pins.claimed_at IS NOT NULL` vs unclaimed pins), idempotent upsert preserving `grandfathered_at`, Property 4 (quick-completions dedupe, idempotency, persisted `user_tz`, and zero rows inserted into `experience_logs`), and Property 5 (atomic rollback on missing/inactive id)
    - _Requirements: 1.3, 1.4, 1.5, 1.6, 1.8, 2.2, 2.3_
  - [x] 2.5 Write route integration tests (`routes.test.ts` via `server.inject`) covering 401 on all 3 routes, happy paths, `validation_failed` on bad intent/park/IANA tz/simultaneous dismiss+restore/0 or >20 ids, `404 experience_not_found`, and verifying `awardPins` is called once per batch and a throwing `awardPins` still returns HTTP 200 with `newlyAwardedPinIds: []`
    - _Requirements: 1.10, 2.1, 2.2, 2.4, 2.5_
  - [x] 2.6 Checkpoint — run `npm run verify:api`

- [x] 3. Wave 1 Mobile Polish — `HomeSearchBar`, `TripDetailScreen`, and `You` 0-Pin Cold Start
  - [x] 3.1 Update `apps/mobile/src/screens/home/HomeSearchBar.tsx`: add empty-focus Popular Tools panel (5 curated shortcuts from `POPULAR_TOOLS_IDS`), keep all 12 trip-scoped tools in `toolShortcuts` even when `activeOrUpcomingTrips.length === 0` with a 0-trip modal bridge ("Create a Trip" → `Trips › TripsList` / "Cancel"), add section headers (`Your Trips`, `App Tools`, `Experiences & Dining`) and tool location breadcrumbs, replace client-side catalog filter with debounced (250 ms) `GET /catalog?q=` so ride aliases match, and update `Profile, Crew & Settings` shortcut to navigate to `YouAndCrew`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 8.3_
  - [x] 3.2 Update `apps/mobile/src/screens/home/__tests__/HomeSearchBar.test.tsx` to assert Popular Tools on empty focus, 0-trip tool search + bridge modal navigation, section headers & breadcrumbs, debounced `/catalog?q=` query on ≥2 chars, and `YouAndCrew` navigation for settings
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 8.3_
  - [x] 3.3 Create pure helper `apps/mobile/src/screens/trips/tripSummaryCopy.ts` (`deriveTripSummaryBannerCopy`) and property test `tripSummaryCopy.prop.test.ts` (Property 7); update `apps/mobile/src/screens/trips/TripDetailScreen.tsx` to add the 3 single-line itinerary subtitles (`Schedule Builder`, `Planned List`, `Reservations`), wire `deriveTripSummaryBannerCopy` so upcoming trips never show `"VACATION UNDERWAY"`, and tighten empty `Saved Lists & Favorites` padding on upcoming trips (keeping `HUB_SECTIONS` and visual layout unchanged)
    - _Requirements: 9.1, 9.2, 9.3, 9.4_
  - [x] 3.4 Update `TripDetailScreen` mobile tests to assert the 3 itinerary subtitles, `"UPCOMING TRIP"` on upcoming trips vs `"VACATION UNDERWAY"` on active trips, compact empty `Saved Lists & Favorites` styling when `trip.status === 'upcoming'` (Requirement 9.4), and confirm the existing `tripStructureRegression` test stays green
    - _Requirements: 9.1, 9.2, 9.3, 9.4_
  - [x] 3.5 Create `apps/mobile/src/screens/collection/ZeroPinsStarterCard.tsx` (+ `ZeroPinsStarterCard.palette.ts`) and update `apps/mobile/src/screens/navigation/AvatarChip.tsx` and `apps/mobile/src/screens/collection/CollectionScreen.tsx`: route `AvatarChip` directly to `YouAndCrew` (`YouAndCrewMain`); remove the 5th `'crew'` sub-tab from `CollectionScreen` (leaving `Pins | Food | Lists | Stats`); add the unified `Crew & Settings` pill beside `MyPhotosEntry` in `CollectionScreen`'s `GradientHeader`; render `ZeroPinsStarterCard` (with log-ride CTA + Badges in Reach) when `boardQuery.isSuccess && totalUnlocked === 0 && claimableCount === 0`, keeping the corkboard unchanged when `totalUnlocked > 0 || claimableCount > 0`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_
  - [x] 3.6 Update `AvatarChip` and `CollectionScreen` tests to assert direct `YouAndCrew` navigation, 4 segments with no `vault-seg-crew`, `ZeroPinsStarterCard` rendering + CTA flow at 0 pins, and corkboard rendering when `totalUnlocked > 0`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_
  - [x] 3.7 Checkpoint — run `npm run verify:mobile`

- [x] 4. Wave 2 Mobile — 3-Step First-Run Onboarding, Home Start Here Card, and Home Declutter
  - [x] 4.1 Create `apps/mobile/src/screens/onboarding/onboardingApi.ts` (`onboardingKeys`, `useOnboardingState`, `useUpdateOnboarding`, `useQuickCompletions`) and pure `starterRides.ts` (`selectStarterRides` filtering `active === true && category === 'Ride'` from the cached unpaginated `['catalog', 'all']` query with curly/straight apostrophe and en/em-dash normalization) with `starterRides.prop.test.ts` (Property 6: ≤12 items, active `Ride` entries only, unique IDs, realistic catalog fixtures with apostrophes/dashes like `"Soarin’ Around the World"`, deterministic ordering, and graceful backfill when curated names are absent)
    - _Requirements: 4.1, 4.4_
  - [x] 4.2 Implement `apps/mobile/src/screens/onboarding/OnboardingFlowScreen.tsx` (+ `.palette.ts` via `definePalette`), `OnboardingGate.tsx`, and register `OnboardingFlow` in `apps/mobile/src/navigation/RootNavigator.tsx`: Step 1 intent selection, Step 2 adaptive action (Quick Trip Starter calling `POST /me/trips`, 2×2 park live-wait picker, or starter rides grid reading `['catalog', 'all']` and calling `POST /me/onboarding/quick-completions` with live `"First Pin Ready!"` banner backed by `bronze_park_starter_*` / `bronze_land_starter_*`), Step 3 4-tab + `MagicFab` map with intent-tailored finish CTA calling `PATCH /me/onboarding` (`complete: true`), persistent `Skip` calling `PATCH /me/onboarding` (`skip: true`), and read-only `replay` mode (renders Step 3 Tab Map only with `"Got it"` close button and performs zero API mutations)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  - [x] 4.3 Add **"App Tour & Quick Guide"** (opens `OnboardingFlow` with `{ mode: 'replay' }`) and conditional **"Show Start Here checklist on Home"** (`PATCH /me/onboarding` `{ restoreStarterChecklist: true }`) rows in `apps/mobile/src/screens/youAndCrew/YouAndCrewContent.tsx` / `YouAndCrewScreen.tsx`
    - _Requirements: 4.6, 5.5_
  - [x] 4.4 Create `apps/mobile/src/screens/home/StartHereCard.tsx` (+ `.palette.ts`) and wire into `HomeScreen.tsx` when `onboardingQuery.data?.showStarterChecklist === true`: progress bar (`N of 4`), 4 interactive items routing to ride picker / Explore / Trips / PinBoard, optimistic `Dismiss` calling `PATCH /me/onboarding` (`dismissStarterChecklist: true`), and invalidating `['me', 'onboarding']` on ride/food log completion
    - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - [x] 4.5 Declutter `HomeThemeParksSection.tsx` and `HomeFavoritesSection.tsx`: replace the 2×2 park landmark grid with the compact single-row 4-park **Live Park Pulse** strip (`MK`, `EP`, `HS`, `AK` + avg wait) keeping `All Live Waits ›`; remove the duplicate `Log a Ride` / `Log Food` tiles and the `HIDDEN MICKEYS HUNT` banner from Home; add the 1-card empty Favorites prompt tapping to `Explore`
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - [x] 4.6 Write and update mobile component tests: `OnboardingGate.test.tsx` (no flash while loading, graceful fall-through on API error, triggers `OnboardingFlow` once on `needsOnboarding: true`, never triggers on `false`), `OnboardingFlowScreen.test.tsx` (all 4 intents, Step 2 `POST /me/trips` & `POST /me/onboarding/quick-completions`, Step 3 `PATCH /me/onboarding`, Skip, read-only `replay` mode firing zero mutations), `StartHereCard.test.tsx` (all 4 row actions + Dismiss mutation), `YouAndCrewScreen` test (replay + restore checklist buttons), and update `HomeScreen.render.test.tsx` (including line 363) / `HomeThemeParksSection` / `HomeFavoritesSection` tests for the compact pulse strip, empty favorites prompt, and removed duplicate tiles/Hidden Mickeys banner
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4_
  - [x] 4.7 Update `docs/features.md` (flip `first-run-onboarding` status to `Shipped`, bump snapshot date/commit) and check if `navigation-redesign` / `hidden-mickeys` / `trips` spec notes need cross-reference updates
    - _Requirements: 6.1, 6.3, 8.1, 9.3_
  - [x] 4.8 Final Checkpoint — run full `npm run verify` across `packages/shared`, `apps/api`, and `apps/mobile` (must exit 0, including `themeRetrofit.guard.test.ts` and `dispositions.test.ts`)

## Notes

- **Prerequisite git hygiene:** Before starting implementation (especially in a branched workspace or worktree), commit the currently untracked baseline files that Tasks 3.1, 4.3, and 4.7 build on (`apps/mobile/src/screens/home/HomeSearchBar.tsx`, `apps/mobile/src/screens/home/__tests__/HomeSearchBar.test.tsx`, `apps/mobile/src/screens/youAndCrew/YouAndCrewContent.tsx`, and `docs/features.md`).
- **Cross-spec impacts (intentional superseding changes):**
  - `navigation-redesign` R2.7 (`HomeThemeParksSection` 2×2 grid + Quick Log buttons) and R6 (`CollectionScreen` 5th `crew` segment) are superseded by Requirements 6 and 8 of this spec. Update affected tests in `HomeScreen.render.test.tsx`, `CollectionScreen.test.tsx`, and `AvatarChip.test.tsx` in the same PR.
  - `hidden-mickeys` R13 Home banner entry point is superseded by Requirement 6.3 (the other 6 Hidden Mickeys entry points remain untouched).
  - `trips` `TripDetailScreen` keeps `HUB_SECTIONS` and its existing layout intact; Requirement 9 only adds itinerary subtitles, tightens empty spacing, and fixes the upcoming-trip summary banner copy bug.
- **Theming guard:** Every new mobile component (`OnboardingFlowScreen`, `StartHereCard`, `ZeroPinsStarterCard`) must use `makeStyles((t) => ...)` and co-located `*.palette.ts` via `definePalette({ light, dark })` so `src/__tests__/themeRetrofit.guard.test.ts` stays green in both Light and Twilight Dark modes.
- **No raw colors or stray scripts:** Follow `.kiro/steering/execution-discipline.md` and `.kiro/steering/tech-conventions.md` on every task.

## Task Dependency Graph

```
1.1 (Migration 0078) ──► 1.2 (Migration test)
                     └──► 1.3 (Account deletion disposition)
1.4 (Shared DTOs/Schemas) ──► 1.5 (Shared tests)
                                │
                          [1.6 Checkpoint]
                                │
             ┌──────────────────┴──────────────────┐
             ▼                                     ▼
2.1 (Pure statePolicy)                   3.1–3.2 (HomeSearchBar polish)
2.2 (OnboardingRepo)                     3.3–3.4 (TripDetailScreen polish)
2.3 (Service + Routes + Wiring)          3.5–3.6 (You tab 0-pin & Crew header)
2.4 (Repo tests)                                   │
2.5 (Route tests)                            [3.7 Checkpoint]
      │                                            │
[2.6 Checkpoint]                                   │
      └──────────────────┬─────────────────────────┘
                         ▼
         4.1 (onboardingApi + starterRides)
         4.2 (OnboardingFlowScreen + OnboardingGate + RootNavigator)
         4.3 (YouAndCrew Settings replay & restore rows)
         4.4 (StartHereCard + HomeScreen wiring)
         4.5 (HomeThemeParksSection pulse strip + HomeFavoritesSection empty)
         4.6 (Mobile tests & updated Home/Collection tests)
         4.7 (docs/features.md status update)
                         │
                 [4.8 Final Checkpoint]
```

Waves group tasks whose dependencies are all satisfied by earlier waves. Tasks in the same wave are independent of each other. Tasks 2.x (backend) and 3.x (Wave 1 mobile polish) both start after checkpoint 1.6 and run in parallel. Task 4.x starts only after both checkpoints 2.6 and 3.7. Task 4.3 follows 4.2 because the replay row opens the `OnboardingFlow` route registered there.

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.4"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.5"] },
    { "id": 2, "tasks": ["1.6"] },
    { "id": 3, "tasks": ["2.1", "2.2", "3.1", "3.3", "3.5"] },
    { "id": 4, "tasks": ["2.3", "2.4", "3.2", "3.4", "3.6"] },
    { "id": 5, "tasks": ["2.5", "3.7"] },
    { "id": 6, "tasks": ["2.6"] },
    { "id": 7, "tasks": ["4.1", "4.5"] },
    { "id": 8, "tasks": ["4.2", "4.4"] },
    { "id": 9, "tasks": ["4.3"] },
    { "id": 10, "tasks": ["4.6", "4.7"] },
    { "id": 11, "tasks": ["4.8"] }
  ]
}
```
