# Design Document

## Overview

First-Run Onboarding & App Clarity adds a lightweight, account-synced onboarding and clarity layer across the monorepo (`packages/shared`, `apps/api`, `apps/mobile`) so brand-new users immediately understand what Disney World Tracker does, complete one high-value action in 20 seconds, and land on a calm, non-duplicative Home screen.

The design follows five core constraints established with the owner:

1. **Dedicated backend table (`user_onboarding`)** rather than mutating `profiles` — zero blast radius on `ProfileDTO`, `GET /me`, or existing auth/profile tests across the repo.
2. **First-read veteran grandfathering (`grandfathered_at`)** — on a User's first `GET /me/onboarding` when no `user_onboarding` row exists yet, the server checks prior activity (`completions`, `experience_logs`, `food_item_logs`, or `active_trip_memberships`) and inserts a row with `grandfathered_at = NOW()` if any exists or `NULL` otherwise (`ON CONFLICT (user_id) DO NOTHING`). No migration backfill is needed, closing the API-deploy-to-App-Store rollout gap, avoiding `pg-mem` backfill hazards, preventing mid-onboarding Step 2 writes from flipping a new user into veteran status, and keeping real veterans grandfathered even if they later clear data.
3. **Reuse existing infrastructure** — `POST /me/onboarding/quick-completions` writes `(user_id, experience_id, completed_on, user_tz)` to `completions` (intentionally skipping `experience_logs`, matching the `skipLog: true` precedent in `tracking/completion/repo.ts`, because `experience_logs` drives dated visit history and `singleDay` multi-park pins in `pins/evaluator.ts`), validates `userTz` with `ianaTzSchema` + `formatYmdInTimeZone` (`apps/api/src/services/tracking/logs/visitDate.ts`), and calls the existing `awardPins` port once per batch; `OnboardingFlow` Step 2's trip creation calls the existing `POST /me/trips`; `Crew & Settings` reuses the existing `YouAndCrewStack` (`YouAndCrewScreen`); `HomeSearchBar` reuses the existing `GET /catalog?q=` alias search.
4. **Pure domain modules for every non-trivial rule** — onboarding derivation, patch merge semantics, starter ride selection, and trip summary banner copy live in pure functions covered by `fast-check` property tests.
5. **Preserve existing Trip muscle memory** — `TripDetailScreen` retains its fixed section order and varied visual shapes (no rotating 2×2 grid or accordions).

## Architecture

### Backend flow (`apps/api/src/services/onboarding/`)

```
user_onboarding (user_id PK -> users(id) ON DELETE CASCADE)
      │
      ├── GET /me/onboarding
      │     └─► OnboardingRepo.getOrInitSnapshot(userId)
      │           (reads user_onboarding + EXISTS checks on completions,
      │            experience_logs, food_item_logs, experience_favorites,
      │            active_trip_memberships (view), user_pins[claimed_at IS NOT NULL];
      │            if no user_onboarding row exists yet, inserts with
      │            grandfathered_at = NOW() iff prior core activity exists,
      │            else NULL, using ON CONFLICT (user_id) DO NOTHING)
      │         └─► domain/statePolicy.ts::deriveOnboardingState() -> OnboardingStateDTO
      │
      ├── PATCH /me/onboarding
      │     └─► Zod onboardingPatchSchema (.strict())
      │         └─► OnboardingRepo.getOrInitSnapshot(userId) (same first-read grandfathering as GET,
      │             so a PATCH that arrives before any GET still grandfathers veterans)
      │         └─► domain/statePolicy.ts::mergeOnboardingPatch()
      │         └─► OnboardingRepo.upsertState(userId, next) (preserves grandfathered_at)
      │         └─► returns refreshed OnboardingStateDTO
      │
      └── POST /me/onboarding/quick-completions
            └─► Zod quickCompletionsInputSchema (.strict(), using ianaTzSchema)
                └─► formatYmdInTimeZone(clock(), userTz) -> completedOn
                └─► dedupe experienceIds
                └─► OnboardingRepo.insertQuickCompletions(userId, ids, completedOn, userTz)
                      (single tx: verify all active -> INSERT INTO completions
                       (user_id, experience_id, completed_on, user_tz) ON CONFLICT DO NOTHING;
                       intentionally omits experience_logs)
                └─► awardPins(userId) once (best-effort)
                └─► returns QuickCompletionsResponseDTO
```

### Mobile navigation & surface ownership

```
RootStackNavigator
 ├── MainTabs
 │    ├── Home        -> Search (with Popular Tools + 0-trip tools)
 │    │                  StartHereCard (when showStarterChecklist === true)
 │    │                  Active/Upcoming Trip Hero (or ExplorationPromptCard)
 │    │                  Compact 4-park Live Park Pulse strip (no 2x2 grid, no Log buttons, no Mickeys banner)
 │    │                  HomeFavoritesSection (with 1-card empty prompt when 0 favorites)
 │    │                  Highest-Rated leaderboard
 │    ├── Explore     -> Full Parks / Resorts / Springs / Water Parks / Live Waits / Crowds / Hidden Mickeys
 │    ├── MagicFab    -> Single fast-action dock (Live Waits, Log Ride, Log Food, Hidden Mickeys, Claim Pins, Today's Schedule)
 │    ├── Trips       -> TripsList -> TripDetailScreen (unchanged fixed layout + itinerary subtitles + upcoming summary fix)
 │    └── Collection  -> Tab label "You"
 │                       4 segments: Pins | Food | Lists | Stats (Crew sub-tab removed)
 │                       Header right: MyPhotosEntry + Crew & Settings pill (-> YouAndCrew)
 │                       Pins segment: 0-pin starter card when totalUnlocked === 0 && claimableCount === 0
 ├── OnboardingFlow   -> Full-screen modal/stack screen auto-presented when needsOnboarding === true,
 │                       or opened in replay mode from YouAndCrewScreen Settings
 └── YouAndCrew       -> Single unified home for Profile, Friends, Inbox/Sent, Appearance, Notifications,
                         "App Tour & Quick Guide", and "Show Start Here checklist on Home"
```

## Components and Interfaces

### Shared Contracts (`packages/shared`)

- `packages/shared/src/constants/onboarding.ts`
  - `ONBOARDING_INTENTS = ['plan', 'in_park', 'track_history', 'explore'] as const`
  - `ONBOARDING_PARKS = ['Magic Kingdom', 'EPCOT', 'Hollywood Studios', 'Animal Kingdom'] as const`
  - `QUICK_COMPLETIONS_MIN = 1`
  - `QUICK_COMPLETIONS_MAX = 20`
- `packages/shared/src/dto/Onboarding.ts`
  - `OnboardingIntent`, `OnboardingPark`, `StarterChecklistDTO`, `OnboardingStateDTO`, `QuickCompletionsResponseDTO`
- `packages/shared/src/schemas/Onboarding.ts`
  - `onboardingIntentSchema`, `onboardingParkSchema`
  - `onboardingPatchSchema` (`.strict()`, refined to reject `dismissStarterChecklist: true` combined with `restoreStarterChecklist: true`)
  - `quickCompletionsInputSchema` (`.strict()`: `experienceIds`: `z.array(z.string().uuid()).min(1).max(20)`, `userTz`: `ianaTzSchema` from `packages/shared/src/schemas/primitives.ts`, further verified against `Intl.DateTimeFormat` via `formatYmdInTimeZone` on the server)

### Backend (`apps/api/src/services/onboarding/`)

```
apps/api/src/services/onboarding/
  domain/
    statePolicy.ts     // pure: shouldGrandfatherOnFirstRead, deriveOnboardingState, mergeOnboardingPatch
  repo.ts              // OnboardingRepo (pg DbPool): getOrInitSnapshot, upsertState, insertQuickCompletions
  service.ts           // OnboardingService composing repo + statePolicy + awardPins + clock
  routes.ts            // Fastify plugin: GET /me/onboarding, PATCH /me/onboarding, POST /me/onboarding/quick-completions
```

#### Pure module signatures (`domain/statePolicy.ts`)

```typescript
export interface StoredOnboardingRow {
  readonly completedAt: string | null;
  readonly skippedAt: string | null;
  readonly grandfatheredAt: string | null;
  readonly initialIntent: OnboardingIntent | null;
  readonly selectedPark: OnboardingPark | null;
  readonly starterChecklistDismissedAt: string | null;
}

export interface ActivitySignals {
  readonly hasCompletion: boolean;
  readonly hasExperienceLog: boolean;
  readonly hasFoodLog: boolean;
  readonly hasFavorite: boolean;
  readonly hasTripMembership: boolean;
  readonly hasClaimedPin: boolean;
}

export function shouldGrandfatherOnFirstRead(signals: ActivitySignals): boolean;

export function deriveOnboardingState(
  stored: StoredOnboardingRow,
  signals: ActivitySignals,
): OnboardingStateDTO;

export function mergeOnboardingPatch(
  current: StoredOnboardingRow | null,
  patch: OnboardingPatchInput,
  nowIso: string,
): StoredOnboardingRow;
```

**Exact derivation formulas (authoritative):**

- `shouldGrandfatherOnFirstRead(signals) = signals.hasCompletion || signals.hasExperienceLog || signals.hasFoodLog || signals.hasTripMembership`
- `isVeteran = stored.grandfatheredAt !== null`
- `hasOnboardingDecision = stored.completedAt !== null || stored.skippedAt !== null`
- `needsOnboarding = !isVeteran && !hasOnboardingDecision`
- `checklist = { loggedFirstExperience: signals.hasCompletion || signals.hasExperienceLog || signals.hasFoodLog, starredFavorite: signals.hasFavorite, hasTrip: signals.hasTripMembership, claimedPin: signals.hasClaimedPin }`
- `allChecklistDone = checklist.loggedFirstExperience && checklist.starredFavorite && checklist.hasTrip && checklist.claimedPin`
- `showStarterChecklist = !isVeteran && stored.starterChecklistDismissedAt === null && !allChecklistDone`
- `mergeOnboardingPatch` timestamp monotonicity:
  - `grandfatheredAt`: `current?.grandfatheredAt ?? null` (never modified by `PATCH`)
  - `completedAt`: `current?.completedAt ?? (patch.complete ? nowIso : null)` (never overwritten once set)
  - `skippedAt`: `current?.skippedAt ?? (patch.skip ? nowIso : null)` (never overwritten once set)
  - `starterChecklistDismissedAt`:
    - if `patch.dismissStarterChecklist`: `current?.starterChecklistDismissedAt ?? nowIso`
    - else if `patch.restoreStarterChecklist`: `null`
    - else: `current?.starterChecklistDismissedAt ?? null`
  - `initialIntent`: `patch.initialIntent !== undefined ? patch.initialIntent : (current?.initialIntent ?? null)`
  - `selectedPark`: `patch.selectedPark !== undefined ? patch.selectedPark : (current?.selectedPark ?? null)`

#### Wiring (`apps/api/src/composeServices.ts` & `apps/api/src/server.ts`)

- Construct `OnboardingRepo` + `OnboardingService` using the shared `pool`, `awardPins`, and `clock` already built in `composeServices.ts`.
- Register `onboardingRoutes` in `server.ts` with `requireSession: sessionMiddleware`.
- Register `user_onboarding.user_id` in `apps/api/src/services/accountDeletion/dispositions.ts` (`e('user_onboarding', 'user_id', 'delete', 4, ['user_id'])`).

### Mobile (`apps/mobile/src/`)

- **New folder `apps/mobile/src/screens/onboarding/`:**
  - `onboardingApi.ts` — TanStack Query key `onboardingKeys.me = ['me', 'onboarding']`, `useOnboardingState()`, `useUpdateOnboarding()`, `useQuickCompletions()`.
  - `starterRides.ts` — Pure selector `selectStarterRides(experiences: readonly ExperienceDTO[]): readonly ExperienceDTO[]` picking up to 12 active iconic rides (`category === 'Ride'`) across the 4 theme parks from the existing cached unpaginated `['catalog', 'all']` query (deterministic curated list matched by normalized name + park after normalizing curly apostrophes `’`/`‘` → `'` and dashes `–`/`—` → `-`, backfilled evenly across the 4 parks if catalog names vary).
  - `OnboardingFlowScreen.tsx` + `OnboardingFlowScreen.palette.ts` — 3-step interactive flow (`step: 1 | 2 | 3`) accepting `{ mode?: 'firstRun' | 'replay' }`. In `'replay'` mode, renders ONLY Step 3 (the read-only 4-tab + `MagicFab` map) with a `"Got it"` close button and performs zero API mutations. In Step 2's ride picker, selecting ≥1 ride displays `"First Pin Ready!"` (backed by real 1-experience Bronze Starter pins `bronze_park_starter_*` / `bronze_land_starter_*` in `packages/shared/src/pins/catalog.ts`).
  - `OnboardingGate.tsx` — Lightweight controller inside `RootStackNavigator` (or `MainTabsNavigator`) that opens `OnboardingFlow` once per session when `data?.needsOnboarding === true` without blocking render while loading or on API error.
- **Home updates (`apps/mobile/src/screens/home/`):**
  - `StartHereCard.tsx` + `StartHereCard.palette.ts` — Dismissible 4-item checklist card with `N of 4` progress bar; invalidates `['me', 'onboarding']` on dismiss or when returning from actions.
  - `HomeScreen.tsx` — Render `StartHereCard` when `onboardingQuery.data?.showStarterChecklist === true`; keep ride-picker callback wired for checklist item 1; invalidate `['me', 'onboarding']` when a ride/food item is logged.
  - `HomeThemeParksSection.tsx` — Replace 2×2 park landmark cards with compact single-row 4-park **Live Park Pulse** strip (`MK`, `EP`, `HS`, `AK` + live avg wait); remove duplicate `Log a Ride` / `Log Food` row and `HIDDEN MICKEYS HUNT` banner.
  - `HomeFavoritesSection.tsx` — Add compact 1-card empty prompt when `favorites.length === 0` tapping through to `Explore`.
  - `HomeSearchBar.tsx` — Add empty-focus **Popular Tools** panel (5 curated items); always include trip-scoped tools in `toolShortcuts` with a 0-trip modal bridge ("This tool lives inside a Trip — Create a Trip / Cancel"); add section headers (`Your Trips`, `App Tools`, `Experiences & Dining`) and tool breadcrumbs; query `GET /catalog?q=` (debounced 250 ms) for alias-aware experience search; point `Profile, Crew & Settings` shortcut to `YouAndCrew`.
- **Navigation & `You` tab updates:**
  - `RootNavigator.tsx` — Register `OnboardingFlow` on `RootStackParamList` (`presentation: 'fullScreenModal'`, `gestureEnabled: false` in `firstRun` mode or `true` in `replay` mode, `headerShown: false`).
  - `AvatarChip.tsx` — Change `handlePress` from `Collection / initialTab: 'crew'` to `navigation.navigate('YouAndCrew', { screen: 'YouAndCrewMain' })`.
  - `CollectionScreen.tsx` & `apps/mobile/src/screens/collection/ZeroPinsStarterCard.tsx` (+ `ZeroPinsStarterCard.palette.ts`) — Remove `'crew'` from `VaultSubTab` (4 segments: `'pins' | 'food' | 'lists' | 'stats'`); add unified `Crew & Settings` pill (`AvatarChip` or matched pill) in `GradientHeader` `right` beside `MyPhotosEntry`; replace empty corkboard with `ZeroPinsStarterCard` when `boardQuery.isSuccess && totalUnlocked === 0 && claimableCount === 0`.
  - `YouAndCrewScreen.tsx` / `YouAndCrewContent.tsx` — Add **"App Tour & Quick Guide"** row (opens `OnboardingFlow` with `{ mode: 'replay' }`) and conditional **"Show Start Here checklist on Home"** row (when dismissed & incomplete).
- **Trips micro-polish (`apps/mobile/src/screens/trips/`):**
  - `tripSummaryCopy.ts` — Pure helper `deriveTripSummaryBannerCopy({ status, completedCount, plannedCount, feedCount, dayText })` returning `{ eyebrow, title, subtitle }` so `upcoming` trips never render `"VACATION UNDERWAY"`.
  - `TripDetailScreen.tsx` — Add single-line subtitles to `Schedule Builder`, `Planned List`, and `Reservations`; wire `deriveTripSummaryBannerCopy`; compact vertical padding on empty `Saved Lists & Favorites` state when `trip.status === 'upcoming'`.

## Data Models

### Migration `apps/api/migrations/0078_user_onboarding.sql`

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS user_onboarding (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NULL,
  skipped_at TIMESTAMPTZ NULL,
  grandfathered_at TIMESTAMPTZ NULL,
  initial_intent TEXT NULL,
  selected_park TEXT NULL,
  starter_checklist_dismissed_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_user_onboarding_intent CHECK (
    initial_intent IS NULL
    OR initial_intent IN ('plan', 'in_park', 'track_history', 'explore')
  ),
  CONSTRAINT chk_user_onboarding_park CHECK (
    selected_park IS NULL
    OR selected_park IN ('Magic Kingdom', 'EPCOT', 'Hollywood Studios', 'Animal Kingdom')
  )
);

COMMIT;
```

### Shared DTOs (`packages/shared/src/dto/Onboarding.ts`)

```typescript
export type OnboardingIntent = 'plan' | 'in_park' | 'track_history' | 'explore';
export type OnboardingPark =
  | 'Magic Kingdom'
  | 'EPCOT'
  | 'Hollywood Studios'
  | 'Animal Kingdom';

export interface StarterChecklistDTO {
  readonly loggedFirstExperience: boolean;
  readonly starredFavorite: boolean;
  readonly hasTrip: boolean;
  readonly claimedPin: boolean;
}

export interface OnboardingStateDTO {
  readonly needsOnboarding: boolean;
  readonly completedAt: string | null;
  readonly skippedAt: string | null;
  readonly initialIntent: OnboardingIntent | null;
  readonly selectedPark: OnboardingPark | null;
  readonly starterChecklistDismissedAt: string | null;
  readonly checklist: StarterChecklistDTO;
  readonly showStarterChecklist: boolean;
}

export interface QuickCompletionsResponseDTO {
  readonly addedCount: number;
  readonly alreadyCompletedCount: number;
  readonly newlyAwardedPinIds: readonly string[];
}
```

## Configuration & Constants

No new environment variables are required. All runtime constants have concrete defaults:

| Constant | Default | Where | Purpose |
|---|---|---|---|
| `QUICK_COMPLETIONS_MIN` | `1` | `packages/shared/src/constants/onboarding.ts` | Minimum ids per bulk quick-completion request |
| `QUICK_COMPLETIONS_MAX` | `20` | `packages/shared/src/constants/onboarding.ts` | Maximum ids per bulk quick-completion request |
| `STARTER_RIDES_MAX` | `12` | `apps/mobile/src/screens/onboarding/starterRides.ts` | Number of iconic rides shown in Step 2 grid |
| `POPULAR_TOOLS_IDS` | `['tool-waits', 'tool-crowds', 'tool-dining', 'tool-mickeys', 'tool-pins']` | `apps/mobile/src/screens/home/HomeSearchBar.tsx` | 5 curated shortcuts shown on empty-focus search |
| `HOME_SEARCH_DEBOUNCE_MS` | `250` | `apps/mobile/src/screens/home/HomeSearchBar.tsx` | Debounce window before issuing `GET /catalog?q=` |
| `ONBOARDING_STALE_TIME_MS` | `60_000` (1 min) | `apps/mobile/src/screens/onboarding/onboardingApi.ts` | TanStack Query stale window for `['me', 'onboarding']` |

**Curated Starter Rides list (`starterRides.ts`, 3 per park = 12):**
- Magic Kingdom: `Space Mountain`, `Haunted Mansion`, `Pirates of the Caribbean`
- EPCOT: `Guardians of the Galaxy: Cosmic Rewind`, `Soarin' Around the World`, `Spaceship Earth`
- Hollywood Studios: `Star Wars: Rise of the Resistance`, `The Twilight Zone Tower of Terror`, `Slinky Dog Dash`
- Animal Kingdom: `Avatar Flight of Passage`, `Expedition Everest`, `Kilimanjaro Safaris`
(Normalized by lowercasing, collapsing whitespace, and mapping curly apostrophes `’`/`‘` → `'` and en/em dashes `–`/`—` → `-`, then matched by `includes` against active `category === 'Ride'` experiences in the same `park` from the cached unpaginated `['catalog', 'all']` query; if any entry is absent in a seeded catalog, remaining slots backfill deterministically by park round-robin sorted alphabetically by name.)

## External Interfaces

No new third-party or upstream APIs are introduced. All routes are internal authenticated Fastify routes under `/me/onboarding*` using the existing `sessionMiddleware` and `AppError` envelope:

| Method & Path | Request Body | Success Response | Error Codes |
|---|---|---|---|
| `GET /me/onboarding` | none | `200 OnboardingStateDTO` | `401 unauthorized` |
| `PATCH /me/onboarding` | `{ initialIntent?, selectedPark?, complete?, skip?, dismissStarterChecklist?, restoreStarterChecklist? }` | `200 OnboardingStateDTO` | `401 unauthorized`, `400 validation_failed` |
| `POST /me/onboarding/quick-completions` | `{ experienceIds: string[], userTz: string }` | `200 QuickCompletionsResponseDTO` | `401 unauthorized`, `400 validation_failed`, `404 experience_not_found` |

Existing internal endpoints reused unchanged:
- `POST /me/trips` (Step 2 `plan` Quick Trip Starter)
- `GET /catalog` (Step 2 starter rides resolution)
- `GET /catalog?q=<query>` (`HomeSearchBar` alias-aware experience search)
- `GET /parks/:park/live` (Step 2 `in_park` wait averages + Home compact pulse strip)

## Correctness Properties

### Property 1: First-Read Grandfathering Never Interrupts Veterans and Never Fires Mid-Onboarding
*For any* `ActivitySignals`, `shouldGrandfatherOnFirstRead(signals)` SHALL return `true` if and only if at least one of `hasCompletion`, `hasExperienceLog`, `hasFoodLog`, or `hasTripMembership` is `true`. Once a `StoredOnboardingRow` is persisted with `grandfatheredAt !== null`, `deriveOnboardingState(stored, signals)` SHALL return `needsOnboarding === false` and `showStarterChecklist === false` for *every* `ActivitySignals` (including all-false after deleting logs/trips). Conversely, when `stored` has `grandfatheredAt === null`, `completedAt === null`, and `skippedAt === null`, `deriveOnboardingState(stored, signals)` SHALL keep `needsOnboarding === true` even when Step 2 inserts completions or trip memberships.
**Validates: Requirements 1.3, 1.5, 1.6**

### Property 2: Onboarding Completion and Skip Timestamps Are Monotonic and Idempotent
*For any* existing `StoredOnboardingRow` with a non-null `completedAt` (respectively `skippedAt`) and *for any* subsequent patch containing `complete: true` (respectively `skip: true`) at a later timestamp `nowIso`, `mergeOnboardingPatch` SHALL preserve the original `completedAt` (respectively `skippedAt`) verbatim without overwriting it.
**Validates: Requirements 1.7, 1.8**

### Property 3: Starter Checklist Visibility Invariant
*For any* non-veteran user state, `showStarterChecklist` SHALL equal `true` if and only if `starterChecklistDismissedAt === null` AND at least one of `{ loggedFirstExperience, starredFavorite, hasTrip, claimedPin }` is `false`. Once all four checklist booleans are `true`, `showStarterChecklist` SHALL be `false` regardless of `starterChecklistDismissedAt`.
**Validates: Requirements 1.4, 1.6, 5.4**

### Property 4: Quick-Completions Deduplication and Idempotency
*For any* list of 1 to 20 valid active experience IDs (including lists containing duplicate IDs), calling `POST /me/onboarding/quick-completions` with that list twice yields the same stored `completions` set as calling it once, with `addedCount + alreadyCompletedCount === unique(experienceIds).length` on every call, and on the second call `addedCount === 0`.
**Validates: Requirements 2.2, 2.3**

### Property 5: Quick-Completions Atomicity on Invalid IDs
*For any* batch containing at least one non-existent or inactive (`active = FALSE`) experience ID alongside valid active IDs, `POST /me/onboarding/quick-completions` SHALL reject with `experience_not_found` (404) and insert zero rows into `completions`.
**Validates: Requirements 2.2**

### Property 6: Starter Rides Selection Determinism and Uniqueness
*For any* catalog of experiences, `selectStarterRides(experiences)` SHALL return at most `STARTER_RIDES_MAX` (12) entries, every returned entry SHALL have `active === true` and `category === 'Ride'`, all returned IDs SHALL be unique, apostrophe/dash variants (curly vs. straight) SHALL match identically, and repeated calls with the same catalog SHALL return the same ordered list.
**Validates: Requirements 4.4**

### Property 7: Trip Summary Banner Copy Matches Trip Status
*For any* trip status in `('upcoming', 'active', 'past')` and *for any* non-negative `{ completedCount, plannedCount, feedCount }`, `deriveTripSummaryBannerCopy` SHALL never return `"VACATION UNDERWAY"` when `status === 'upcoming'`, and SHALL return `"VACATION UNDERWAY"` (or `"VACATION MILESTONE"` when `completedCount > 0`) when `status === 'active'`.
**Validates: Requirements 9.3**

## Error Handling

- **Unauthenticated requests:** All three `/me/onboarding*` endpoints run `requireSession` before parsing or DB queries, returning `401 unauthorized`.
- **Invalid payloads:** Strict Zod schemas reject unknown keys, invalid intents/parks, empty or >20 `experienceIds`, invalid UUIDs, invalid IANA `userTz`, and contradictory `{ dismissStarterChecklist: true, restoreStarterChecklist: true }` with `400 validation_failed`.
- **Missing or inactive experience in quick-completions:** Checked inside the transaction before insert; throws `AppError('experience_not_found', ...)` (404) and rolls back cleanly.
- **Pin award hook failure:** Wrapped in best-effort try/catch logging a warning and returning `newlyAwardedPinIds: []` (mirroring `tracking/completion/routes.ts::awardPinsSafely`), so starter ride logging never fails if pin evaluation hiccups.
- **Mobile offline/error resilience:** If `GET /me/onboarding` fails on launch, `OnboardingGate` treats `needsOnboarding` as `false` so the user is never locked out of `MainTabs`. `StartHereCard` dismissal uses optimistic UI update and rolls back quietly only if needed.

## Testing Strategy

- **Shared (`packages/shared`, Vitest):** Schema validation tests (`onboarding.test.ts`) covering valid and invalid bodies for `onboardingPatchSchema` (including simultaneous dismiss+restore rejection and unknown keys) and `quickCompletionsInputSchema` (0 items, 21 items, non-UUID, unknown keys).
- **Migration (`apps/api`, Vitest + pg-mem):** `migration0078.test.ts` verifying table columns, `CHECK` constraints on `initial_intent` and `selected_park`, and `ON DELETE CASCADE` when deleting a user.
- **Account Deletion (`apps/api`, Vitest):** Update `dispositions.test.ts` and add a purge test asserting a user's `user_onboarding` row is deleted on purge.
- **Backend pure domain (`apps/api`, Vitest + `fast-check`, ≥100 runs):** `statePolicy.prop.test.ts` tagged with Properties 1, 2, and 3.
- **Backend repo & routes (`apps/api`, Vitest + pg-mem + `server.inject`):**
  - `onboarding/repo.test.ts` exercising real SQL for veteran detection, checklist counts (including `user_pins.claimed_at IS NOT NULL`), idempotent upsert, and Properties 4 & 5 (`quick-completions` dedupe, idempotency, atomic rollback on inactive/missing id).
  - `onboarding/routes.test.ts` testing 401 gate, happy paths, validation errors, `experience_not_found`, and best-effort `awardPins` called once per batch.
- **Mobile (`apps/mobile`, Jest + `@testing-library/react-native` + `fast-check`):**
  - Pure property tests for `starterRides.prop.test.ts` (Property 6) and `tripSummaryCopy.prop.test.ts` (Property 7).
  - Interactive component render tests (mocking network/query layer only) covering every user interaction:
    - `OnboardingGate.test.tsx`: renders nothing / no modal flash while `GET /me/onboarding` is loading, gracefully allows `MainTabs` on API error, triggers `OnboardingFlow` once when `needsOnboarding: true`, and never triggers when `needsOnboarding: false`.
    - `OnboardingFlowScreen.test.tsx`: all 4 intents, Step 2 branches (Quick Trip Starter `POST /me/trips`, park picker, ride grid `POST /me/onboarding/quick-completions` + First Pin Ready banner), Step 3 finish CTA (`PATCH /me/onboarding`), Skip button, and read-only `replay` mode (renders Step 3 only and triggers zero API mutations).
    - `StartHereCard.test.tsx` & `HomeScreen.render.test.tsx`: checklist rendering, tap navigation, Dismiss `PATCH`, automatic hide at 4/4, compact 4-park pulse strip, absence of removed Log Ride / Log Food / Hidden Mickeys banner, and empty Favorites card.
    - `HomeSearchBar.test.tsx`: Popular Tools on empty focus, 0-trip tool results + bridge modal, section headers + breadcrumbs, and debounced `/catalog?q=` alias matching.
    - `CollectionScreen.test.tsx` & `AvatarChip.test.tsx`: 4 segments (no `crew` tab), unified header navigation to `YouAndCrew`, `ZeroPinsStarterCard` rendering vs. ≥1-pin corkboard.
    - `TripDetailScreen.test.tsx`: itinerary row subtitles, `UPCOMING TRIP` vs `VACATION UNDERWAY` banner copy, compact empty `Saved Lists & Favorites` padding on upcoming trips, and intact `HUB_SECTIONS` structure regression test.
- **Cross-spec regression awareness:** Updating `HomeScreen`, `HomeThemeParksSection`, `CollectionScreen`, `AvatarChip`, and `TripDetailScreen` will require updating affected assertions in existing tests from `navigation-redesign` and `hidden-mickeys` (specifically `HomeScreen.render.test.tsx` line 363 which previously asserted the Home Hidden Mickeys banner, and `AvatarChip`/`CollectionScreen` crew-tab assertions). Those test updates are explicitly included in the tasks below.
