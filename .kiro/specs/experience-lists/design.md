# Design Document

## Architecture Overview

Experience Lists introduces five new tables, structurally identical in shape to `food-lists`'
five tables, plus one bridge table for Trip attachment (mirroring `trips`' `trip_food_lists`
exactly) and one new read endpoint on the existing `experience_logs` service. Access is **live**,
not a delivered snapshot — every read computes the list's current contents and the requester's
current access at read time, with zero payload copies anywhere, identical to `food-lists`.

Three distinct relationships are modeled as three distinct join tables, deliberately not
conflated — same rationale as `food-lists`:

1. **Ownership** — `experience_lists.owner_id`. One owner, full CRUD including managing shares —
   never represented by an `experience_list_shares` row.
2. **Access grant, with a role** — `experience_list_shares` (private-list, friend-scoped,
   revocable, carrying `role: 'viewer' | 'editor'`) and the `visibility = 'public'` column
   (implicit *viewer* access for everyone). Together these answer "can User X view this list
   right now?" and "can User X mutate its items right now?"
3. **Affinity** — `experience_list_likes` and `experience_list_saves` (a standing live
   reference), view-gated, neither implying the other or ownership/edit access.

```
experience_lists (owner_id, name, visibility, like_count, version)
     │
     ├──< experience_lists_items (experience_list_id, experience_id, position, added_by_user_id) ──> experiences
     │
     ├──< experience_list_shares (experience_list_id, shared_with_user_id, shared_by_user_id, role)
     │
     ├──< experience_list_likes (experience_list_id, user_id)
     │
     └──< experience_list_saves (experience_list_id, saved_by_user_id)

trip_experience_lists (trip_id, experience_list_id, added_by)   [Trip attachment bridge, view-access only]

Access predicates (every read/mutate path):
  can_view(list, user) := list.owner_id = user
                        OR list.visibility = 'public'
                        OR EXISTS experience_list_shares(list, user)                       -- either role
                        OR EXISTS trip_experience_lists(list) JOIN trip_memberships(user)   -- Requirement 14
  can_edit(list, user) := list.owner_id = user
                        OR EXISTS experience_list_shares(list, user, role='editor')
```

This is a direct structural port of `food-lists`' design — see that spec's design.md for the
full "why live-access, not `shares`/`share_recipients`" and "why a role column, not a second
table" rationale, both of which apply unchanged here. Three things are genuinely different from
`food-lists`, each addressed in its own section below:

- **No checklist/manual-done concept.** `food-lists` added `is_checklist`/`gotten` (its own
  Requirement 13) specifically because a `Food_Item` has no automatically-populated visit
  record to derive completion from. An `Experience` does — `experience_logs` already exists,
  is automatically populated by the unrelated `experience-activity-logging` feature, and is not
  scoped to any one list's lifetime. So Experience_List's "done" state (this spec's Requirement
  13) is a pure read-time derivation with **no stored flag anywhere**, simpler than the
  checklist mechanism it might otherwise have copied.
- **Dining is excluded, enforced at the write path**, not just a UI convention (Requirement 2.3).
- **A Trip attachment bridge and picker integration are in-scope from day one** (Requirements 14,
  15), whereas `trip_food_lists` was a downstream addition specified entirely in `trips`. Here,
  because both sides of the bridge are new, this spec owns the bridge table and the picker
  change directly, rather than splitting it across two specs' task lists.

### Why Visit_Summary lives in `tracking/logs`, not in this feature's own service

Requirement 13's batched `{ repeatCount, ratedCount, averageRating }` projection reads
`experience_logs` exclusively — a table this spec's service has no other reason to touch and
does not own. Rather than duplicating `experience_logs` query logic inside the new
`experienceLists` service, this design adds one new method to the existing
`ExperienceLogRepo` (`apps/api/src/services/tracking/logs/repo.ts`) and calls it as an
injected port from the Experience_List mobile screens directly (a second, independent `GET`
call alongside `GET /experience-lists/:id`, not a field folded into that response). This
mirrors how `trips` resolves `Food_List` eligibility/detail through an injected
`Food_List_Service` port rather than querying `food_lists` from `trips`' own repo — cross-service
reads go through the owning service's own repo method, never a second copy of its query.

## Components and Interfaces

### Backend Structure (`apps/api/src/services/experienceLists/`)

A new top-level service, sibling to `foodLists/`, `foodLog/`, `sharing/`, `friends/`, structured
identically:

- `repo.ts`:
  - `ExperienceListRepo` — `createList`, `renameList`, `setVisibility`, `deleteList`,
    `listOwned(userId)`, `getListDetail(listId, viewerId)` (applies the view-access predicate,
    resolves `myRole`), `discover(sort, cursor)`. Identical shape to `FoodListRepo`.
  - `ExperienceListItemRepo` — `addItem` (requires edit access; **rejects `category ===
    'Restaurant'` before the duplicate check**, per Requirement 2.3; stamps `added_by_user_id`;
    bumps `version`), `removeItem`, `reorderItems(listId, userId, experienceIds,
    expectedVersion)` (identical optimistic-concurrency shape to `FoodListItemRepo.reorderItems`).
  - `ExperienceListShareRepo` — identical shape to `FoodListShareRepo`:
    `shareWithFriend`/`revokeShare`/`listShares`/`revokeSharesBetween`.
  - `ExperienceListAffinityRepo` — identical shape to `FoodListAffinityRepo`:
    `like`/`unlike`/`save`/`getCollection`.
  - **Edit-access check:** `hasEditAccess(listId, userId) := owner OR EXISTS
    experience_list_shares(listId, userId, role='editor')`, single predicate reused across every
    mutating method, mirroring `food-lists`.
- `routes.ts`: Fastify routes for `/me/experience-lists`, `/me/experience-lists/:id/items`
  (add/remove/reorder — owner and editors), `/me/experience-lists/:id/shares`
  (`POST`/`GET`/`DELETE /:recipientId` — owner-only), `/experience-lists/:id`,
  `/experience-lists/:id/like`, `/experience-lists/:id/save`, `/experience-lists/discover`,
  `/me/experience-lists/collection`.

### Backend Addition — Batched Visit Summary (`apps/api/src/services/tracking/logs/repo.ts`)

New method on the existing `ExperienceLogRepo` interface:

```typescript
export interface VisitSummary {
  readonly experienceId: string;
  readonly repeatCount: number;
  readonly ratedCount: number;
  /** ROUND(AVG(rating), 1) over rated logs only; `null` when ratedCount is 0. */
  readonly averageRating: number | null;
}

export interface ExperienceLogRepo {
  // ...existing methods unchanged...
  getVisitSummaries(
    userId: string,
    experienceIds: readonly string[],
  ): Promise<readonly VisitSummary[]>;
}
```

Implementation — one grouped query across all requested ids, mirroring the food-item stats
`AVG()`/`ROUND()` pattern from `apps/api/src/services/stats/repo.ts` (the closest existing
precedent for "average rating across a user's own repeat logs of the same item"), but with no
`HAVING count >= N` gate (that food-stats threshold exists for a *leaderboard-style* "top 5"
feature; this is a personal per-item reference and should show `averageRating` starting at the
first rated visit):

```sql
SELECT experience_id,
       COUNT(*)::int AS repeat_count,
       COUNT(*) FILTER (WHERE rating IS NOT NULL)::int AS rated_count,
       ROUND(AVG(rating) FILTER (WHERE rating IS NOT NULL)::numeric, 1)::float AS average_rating
  FROM experience_logs
 WHERE user_id = $1 AND experience_id = ANY($2::uuid[])
 GROUP BY experience_id
```

An `experienceId` in the requested set with zero logs is absent from this result set entirely
(no row to `GROUP BY`); the route/repo layer fills in `{ repeatCount: 0, ratedCount: 0,
averageRating: null }` for any requested id not present in the query result, so the response
always has one entry per requested id (Requirement 13.2's "for each requested experienceId").

New route on the existing `tracking/logs/routes.ts`:

```
GET /me/experiences/visit-summary?ids=id1,id2,...
  → { [experienceId: string]: VisitSummaryDTO }
```

- Requires session (same `requireSession` preHandler as the other two routes on this file).
- `ids` query param: comma-separated UUIDs, deduplicated server-side, capped at a maximum count
  (`VISIT_SUMMARY_MAX_IDS = 100`, see Configuration & Constants) to bound the `ANY($2::uuid[])`
  array size; a request exceeding the cap is rejected `400 validation_failed` rather than
  silently truncated, since silent truncation would make some Experience_List items mysteriously
  show no visit data with no error surfaced.
- An empty or missing `ids` param returns `{}` (HTTP `200`), not an error — an empty
  Experience_List legitimately has nothing to summarize.

`getVisitHistory` itself is untouched — `ParkPassportCard` still fetches the full `logs` array
from it to render the visit-history timeline (Requirement 17.4's expandable per-visit list needs
the raw entries regardless). What changes is where the *average* comes from: today
`ParkPassportCard` computes its own average/`ratedCount` client-side by reducing over
`logsQuery`'s `logs` array. That is a second, independent implementation of the exact
averaging math `getVisitSummaries` now computes authoritatively in SQL, and the two could
silently drift (different rounding, different null-handling) if either is ever edited without
remembering the other exists. Rather than accept that duplication, this design retires
`ParkPassportCard`'s client-side average entirely: it additionally calls `GET
/me/experiences/visit-summary?ids=<thisOneExperienceId>` (a single-id batch call — no new
endpoint shape needed) and renders `averageRating`/`ratedCount` straight from that response,
deleting its own reduce-over-logs averaging code. `repeatCount` already equals `logs.length`
either way (both `getVisitHistory` and `getVisitSummaries` compute it identically), so
`ParkPassportCard` may keep sourcing `repeatCount` from whichever of the two responses is
simpler to read from at that call site — the two never disagree, per Property 20 below. This
makes `getVisitSummaries` the single, authoritative average-rating computation in the codebase;
`ParkPassportCard` and every future consumer (including this spec's own
`ExperienceListDetailScreen`) all read the same number, computed the same way, once.

### Mobile Structure — Add-to-List Entry Points (Requirement 9)

Structurally mirrors `food-lists`' `FoodItemPickerModal`/`AddToListsSheet` pair:

- **New `AddToExperienceListsSheet.tsx`** (`apps/mobile/src/screens/experienceLists/`): given
  one `experienceId`, fetches the User's owned lists (`GET /me/experience-lists`) plus which of
  those already contain it, renders the toggle checklist (Requirement 9.3), includes inline
  "Create new list."
- **Entry point 1 (Experience Detail → list):** any Eligible Experience's detail screen gains an
  "Add to a list" affordance as a sibling to the existing "Add to Trip" action (Requirement
  9.1) — both remain visible together; neither replaces the other. `ExperienceDetailScreen.tsx`
  conditionally renders this affordance only when `experience.category !== 'Restaurant'`, so a
  Restaurant Experience's detail screen shows its existing Food_List "Add to a list" affordance
  and never this one — the two features' entry points are mutually exclusive by category, never
  both present on the same screen.
- **Entry point 2 (list → Experience Detail):** `ExperienceListDetailScreen.tsx`'s "Add items"
  button (visible for `owner`/`editor` `myRole`) opens a catalog search step reusing the
  existing Catalog search component, filtered to `categories != Restaurant` (the inverse of
  `food-lists`' Restaurant-only filter), with the target list pre-determined.
- **Item removal:** identical swipe/delete-button pattern to `food-lists`, invoking `DELETE
  /me/experience-lists/:id/items/:experienceId`.
- **Attribution labels, reorder version conflict, role-aware read-only rendering, Manage Sharing
  surface:** all identical in mechanism to `food-lists`' equivalents — see that spec's design.md
  for the exact UI behavior; only the entity name and endpoint paths differ here.

### Mobile Structure — Visit Summary and Log-From-List (Requirement 13)

- **`ExperienceListDetailScreen.tsx`** fetches `GET /me/experiences/visit-summary?ids=...` with
  every currently-visible item's `experienceId` in one call, keyed the same way
  `catalogMap`-style lookups are already built elsewhere in this codebase (a `Record<string,
  VisitSummaryDTO>` from the response, looked up per row during render).
- Each item row renders:
  - No visit badge when `repeatCount === 0`.
  - A visit-count-only badge (e.g. "2 visits") when `repeatCount > 0 && ratedCount === 0`.
  - A visit-count-plus-rating badge (e.g. "4 visits · ★ 10.0") when `ratedCount > 0`, using the
    same `★ {value.toFixed(1)}` formatting `ParkPassportCard`/`RatingDial` already use elsewhere
    in the app, for visual consistency.
  - A "Log a visit" action opening the existing `LogVisitModal` (from
    `experience-activity-logging`) pre-filled with that row's `experienceId` and a default
    `visitedOn` of today's date, submitting to the existing, unmodified `POST
    /me/experiences/:id/logs`.
- On a successful log submission from this screen, invalidate and refetch the visit-summary
  query (TanStack Query `invalidateQueries` keyed by the summary's query key, scoped to this
  list's currently-visible id set) so the row's badge and done-state update immediately
  (Requirement 13.6) without a full screen remount.
- **Done/not-done sectioning:** the screen splits items into "Not yet done" (`repeatCount === 0`)
  and "Done" (`repeatCount > 0`) sections, purely from the visit-summary response — no
  server-side grouping, no stored flag, matching `TripPlannedListScreen`'s existing visual
  pattern of a flat not-done list plus a collapsed "Done" section, but derived here from
  `experience_logs` directly rather than from `trip_log_entries`.

### Trip Attachment Bridge (Requirement 14)

Structurally and behaviorally identical to `trips`' `trip_food_lists` (Requirement 22 there),
built here rather than in `trips` because this spec introduces both sides of the bridge at once:

- **Migration** `0050_trip_experience_lists.sql` creates `trip_experience_lists` (see Data
  Models below).
- **`apps/api/src/services/trips/repo.ts`** gains `attachExperienceList(tripId, callerId,
  experienceListId)` and `detachExperienceList(tripId, callerId, callerRole,
  experienceListId)`, mirroring `attachFoodList`/`detachFoodList` exactly:
  - `attachExperienceList` calls into an injected `Experience_List_Service` port to resolve the
    list's `ownerId`/`visibility`; `404 → experience_list_not_found`(the attach-target lookup
    failing, not the same code as a viewer being denied by the access predicate — matches how
    `trips` reuses `food_list_not_found` for its analogous lookup failure); neither
    owned-by-caller nor public → `403 trip_experience_list_ineligible`; otherwise `INSERT ...
    ON CONFLICT (trip_id, experience_list_id) DO NOTHING` recording `added_by = callerId`
    (Requirement 14.1, 14.3).
  - `detachExperienceList` mirrors `removePlannedItem`'s adder-or-organizer gate exactly:
    lock the row `FOR UPDATE`, reject a non-adder non-organizer with `trip_forbidden`, delete
    otherwise (Requirement 14.4).
- The Trip read projection (`getTripForMember`, create/edit response) resolves
  `experienceLists: readonly TripExperienceListDTO[]` alongside the existing `foodLists`
  resolution, marking an entry `available: false` when the port fails or returns null for a
  reason other than the link no longer existing (Requirement 14.8) — the deletion case is
  already handled by the `ON DELETE CASCADE` FK (Requirement 14.7), so `available: false` is
  reserved for genuine transient read failures.
- `Experience_List_Service`'s own view-access predicate (`can_view`, above) widens with the
  fourth OR-branch (`EXISTS trip_experience_lists JOIN trip_memberships`) — this widening lives
  in `experienceLists/repo.ts` itself, not in `trips`, since both halves of this feature ship
  together in this spec (unlike `food-lists`, where the widening was a `trips`-owned edit to an
  already-shipped spec).

### Schedule Builder / Planned List Picker Integration (Requirement 15)

- **`apps/mobile/src/screens/trips/ExperiencePicker.tsx`** gains a new candidate source. When
  the Trip currently viewing the picker has one or more attached Experience_Lists (resolved from
  the already-fetched `TripDTO.experienceLists`, no new fetch needed to know whether to show the
  tab), the picker renders an additional tab (e.g. "My Lists") alongside the existing
  All/Rides/Dining/Shows/Breaks tabs (Requirement 15.1). When zero lists are attached, this tab
  is omitted entirely — the tab bar's item count itself is conditional, not just its content
  (Requirement 15.3).
- Selecting the "My Lists" tab fetches each attached list's contents (`GET
  /experience-lists/:id`, one call per attached list — attached-list counts are expected to be
  small, unlike the 100-id cap needed for the visit-summary endpoint) and merges their `items`
  into one flat, deduplicated-by-`experienceId` result set (Requirement 15.2), reusing the same
  row-rendering component the picker already uses for catalog results so no new list-item UI is
  built.
- Each row in this merged view is annotated with whether that `experienceId` already exists as a
  `planned_items` row on the current Trip (any date) — derived by cross-referencing the Trip's
  already-fetched Planned_List/day items (the same `experienceId`-matching approach
  `planned-list-completion-sync` established), rendered as a small "Already added" tag
  (Requirement 15.5).
- Selecting a row from this tab calls the exact same `handleSelectExperience` path
  `TripScheduleScreen.tsx`/`TripPlannedListScreen.tsx`'s `AddItemModal` already use for a catalog
  result — `POST /trips/:id/planned-items` with bare `experienceId` (plus `plannedDate` from
  `TripScheduleScreen`'s active day, when applicable) — no new mutation, no provenance field
  written (Requirement 15.4, 15.6).
- Because both `TripPlannedListScreen`'s add modal and `TripScheduleScreen`'s add modal already
  render the shared `ExperiencePicker` component unmodified, this single change surfaces the new
  tab in both screens automatically — no per-screen wiring needed beyond what already exists.

### Merged Floating_Action_Dock Choice (Requirement 17)

**New component (`apps/mobile/src/screens/catalog/AddToTripOrListChoiceSheet.tsx`):** a small,
purpose-built two-option modal — not a reuse of the four-action `QuickActionSheet` (built for a
different scale of choice) and not a new generic "action sheet" abstraction, since this spec
needs exactly one two-option picker and inventing a reusable primitive for a single call site
would be premature generalization. Props: `{ visible, onClose, onAddToTrip, onAddToList }`. Two
buttons ("Add to Trip", "Add to a List") plus a Cancel/backdrop dismiss, mirroring
`QuickActionSheet`'s modal/backdrop conventions (same overlay style, same dismiss-on-backdrop
behavior) without its larger grid layout.

**`FloatingActionDock.tsx` change:** for the three cases where the secondary action is currently
"Add to Trip" (Ride/Character_Meet/Show on either lens, and Resort), the secondary pill's
`onPress` no longer calls `onAddToPlan` directly — it opens `AddToTripOrListChoiceSheet`, whose
`onAddToTrip` calls the existing `onAddToPlan` prop unchanged and whose `onAddToList` calls a new
`onAddToExperienceList` prop threaded through from `ExperienceDetailScreen.tsx` (the same handler
that already opens `AddToExperienceListsSheet` today, previously wired only to
`AddToExperienceListCard`). The Restaurant branch is untouched — its secondary action still calls
`onAddToPlan`/`reserveHandler` directly, no choice sheet, per Requirement 17.5. The pill's visible label becomes "Add to…" (short, since the two-option choice sheet itself —
also titled "Add to…" — is where the actual destinations are spelled out) while its accessibility
label remains the fuller "Add to trip or list", for the three affected branches only.

**`ExperienceDetailScreen.tsx` change:** passes `onAddToExperienceList={() =>
setAddToExperienceListsSheetVisible(true)}` into `FloatingActionDock` (the same setter already
used by the now-removed `AddToExperienceListCard`'s `onPress`). `AddToExperienceListCard` and its
render call in `PassportAndLoreLens.tsx` are deleted — the "Save this for later" card is gone, not
hidden, since its only action is now reachable via the dock (Requirement 17.4). `PassportAndLoreLens`
drops its `onAddToExperienceList` prop pass-through to that now-deleted card entirely (the prop
name is reused one level up, on `FloatingActionDock`, for the merged choice — these are two
different components at two different points in the tree, not the same wiring relocated).
`AddToExperienceListsSheet` itself is completely unchanged — the merge only changes what opens it.

### Trip Picker for "Add to Trip" (Requirement 18)

**New component (`apps/mobile/src/screens/catalog/AddToTripPickerSheet.tsx`):** a small modal
listing the User's `active`/`upcoming` Trips, mirroring `ActiveTripShortcut.tsx`'s existing
`ActiveTripChooser` row styling (name + date range, `Card` row with a chevron) rather than
inventing new row visuals — that component already solves "let the User pick from a list of
Trips" for a different entry point (opening a Trip), and this is the same list-of-Trips
presentation problem for a different action (adding to a Trip). Props: `{ visible, onClose, trips,
onSelect(tripId) }`. Always rendered when `visible`, regardless of `trips.length` — including
`length === 1` — per Requirement 18.1's "unconditional" framing; the caller decides when to open
it (see below), the sheet itself contains no auto-select-and-close shortcut for the single-trip
case.

Each row additionally renders a status `Badge` (Requirement 18.5's "at minimum name and date
range" — status is an additive third field, not a substitute for either) next to the Trip's name,
reusing `TripsListScreen.tsx`'s exact `STATUS_META` label/color mapping (`active` → success green
"Active", `upcoming` → primary purple "Upcoming") so a Trip's status reads identically here as it
does on the Trips list itself, rather than introducing a second color/label convention for the
same concept.

**`ExperienceDetailScreen.tsx` change:** `handleAddToPlan` is split into two steps. The existing
trip-resolution logic (deriving the eligible Trip set from `tripsData`) is kept, but instead of
picking `activeTrip`/the first upcoming Trip silently, it computes the full eligible list and:
- IF that list is empty, shows the existing "No Active Trip" alert unchanged (Requirement 18.3).
- ELSE (one or more Trips, no special-casing on count), opens `AddToTripPickerSheet` with that
  list (Requirement 18.1).

Selecting a Trip in the sheet calls a new `addToTrip(tripId)` function containing exactly the
`POST /trips/:id/planned-items` call, success/error `Alert`, and query invalidation that
`handleAddToPlan` already performed — unchanged, just parameterized on the picked `tripId`
instead of a silently-derived one (Requirement 18.2). `handleAddToPlan` itself becomes the thin
"resolve eligible trips, then open the picker or show the empty-state alert" step described
above; no other call site of the old `handleAddToPlan` behavior is touched (Requirement 18.6) —
this repo's other trip-add entry points (e.g. `TripPlannedListScreen`'s own composer,
`TripScheduleScreen`'s add flow) already resolve their target Trip from route params, not from
this silent-pick logic, so they are unaffected and out of this requirement's scope.

## Data Models & Migration

### Migration `0050_experience_lists.sql`

```sql
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. experience_lists
-- ---------------------------------------------------------------------------
CREATE TABLE experience_lists (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT         NOT NULL,
    visibility   TEXT         NOT NULL DEFAULT 'private',
    like_count   INTEGER      NOT NULL DEFAULT 0,
    version      INTEGER      NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT experience_lists_name_length_chk CHECK (char_length(name) BETWEEN 1 AND 100),
    CONSTRAINT experience_lists_visibility_chk CHECK (visibility IN ('private', 'public')),
    CONSTRAINT experience_lists_like_count_nonneg_chk CHECK (like_count >= 0),
    CONSTRAINT experience_lists_version_nonneg_chk CHECK (version >= 0)
);

CREATE INDEX experience_lists_owner_idx ON experience_lists(owner_id, updated_at DESC);
CREATE INDEX experience_lists_discover_popular_idx ON experience_lists(visibility, like_count DESC, id ASC);
CREATE INDEX experience_lists_discover_recent_idx ON experience_lists(visibility, created_at DESC, id ASC);

-- ---------------------------------------------------------------------------
-- 2. experience_lists_items
-- ---------------------------------------------------------------------------
CREATE TABLE experience_lists_items (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    experience_list_id  UUID         NOT NULL REFERENCES experience_lists(id) ON DELETE CASCADE,
    experience_id       UUID         NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    position            INTEGER      NOT NULL,
    added_by_user_id    UUID         REFERENCES users(id) ON DELETE SET NULL,
    added_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT experience_lists_items_unique UNIQUE (experience_list_id, experience_id),
    CONSTRAINT experience_lists_items_position_unique UNIQUE (experience_list_id, position)
);

CREATE INDEX experience_lists_items_list_idx ON experience_lists_items(experience_list_id, position ASC);

-- ---------------------------------------------------------------------------
-- 3. experience_list_shares
-- ---------------------------------------------------------------------------
CREATE TABLE experience_list_shares (
    experience_list_id   UUID         NOT NULL REFERENCES experience_lists(id) ON DELETE CASCADE,
    shared_with_user_id  UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shared_by_user_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role                 TEXT         NOT NULL DEFAULT 'viewer',
    shared_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT experience_list_shares_role_chk CHECK (role IN ('viewer', 'editor')),
    PRIMARY KEY (experience_list_id, shared_with_user_id)
);

CREATE INDEX experience_list_shares_recipient_idx ON experience_list_shares(shared_with_user_id);

-- ---------------------------------------------------------------------------
-- 4. experience_list_likes
-- ---------------------------------------------------------------------------
CREATE TABLE experience_list_likes (
    experience_list_id  UUID         NOT NULL REFERENCES experience_lists(id) ON DELETE CASCADE,
    user_id             UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    liked_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (experience_list_id, user_id)
);

-- ---------------------------------------------------------------------------
-- 5. experience_list_saves
-- ---------------------------------------------------------------------------
CREATE TABLE experience_list_saves (
    experience_list_id  UUID         NOT NULL REFERENCES experience_lists(id) ON DELETE CASCADE,
    saved_by_user_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    saved_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (experience_list_id, saved_by_user_id)
);

CREATE INDEX experience_list_saves_user_idx ON experience_list_saves(saved_by_user_id);

COMMIT;
```

### Migration `0051_trip_experience_lists.sql`

```sql
BEGIN;

-- trip_experience_lists: the Experience_List(s) a Trip's members are referencing (R14.1),
-- structurally identical to trip_food_lists (0042_trip_food_lists.sql).
CREATE TABLE trip_experience_lists (
    trip_id             UUID         NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    experience_list_id  UUID         NOT NULL REFERENCES experience_lists(id) ON DELETE CASCADE,
    added_by            UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (trip_id, experience_list_id)
);

CREATE INDEX trip_experience_lists_list_idx ON trip_experience_lists(experience_list_id);

COMMIT;
```

Design notes (identical rationale to `food-lists`' equivalents, restated briefly):

- `experience_lists.like_count` is denormalized for the same indexed-sort reason as
  `food_lists.like_count`; updated transactionally with every like/unlike.
- `experience_lists.version` is the optimistic-concurrency counter for reorder only, same
  reasoning as `food_lists.version` — add/remove are commutative and don't need the guard.
- `experience_lists_items_position_unique` makes a corrupt double-write impossible at the DB
  level, same as `food_lists_items_position_unique`.
- `experience_lists_items.added_by_user_id` is `ON DELETE SET NULL`, not `CASCADE` — a
  collaborator's contributed items survive their account deletion; only attribution is lost.
- `trip_experience_lists.experience_list_id` and `.trip_id` are both `ON DELETE CASCADE`
  (Requirement 14.6, 14.7), identical to `trip_food_lists`.
- No FK cascade exists from `experiences` deletion into `experience_lists_items` beyond the
  standard `ON DELETE CASCADE` already declared — an Experience is never hard-deleted in normal
  operation (catalog sync updates rows in place), so this is a defensive declaration rather than
  an expected runtime path, matching how `food_lists_items.food_item_id` is declared the same
  way against `food_items`.

## Shared Contracts

### `packages/shared/src/dto/ExperienceList.ts`

```typescript
export interface ExperienceListDTO {
  readonly id: string;
  readonly ownerId: string;
  readonly ownerDisplayName: string;
  readonly name: string;
  readonly visibility: 'private' | 'public';
  readonly likeCount: number;
  readonly itemCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ExperienceListItemDTO {
  readonly experienceId: string;
  readonly name: string;
  readonly park: Park | null;
  readonly category: ExperienceCategory;
  readonly position: number;
  readonly addedByUserId: string | null;
  readonly addedByDisplayName: string | null;
}

export type ExperienceListRole = 'owner' | 'editor' | 'viewer';

export interface ExperienceListDetailDTO extends ExperienceListDTO {
  readonly liked: boolean;
  readonly saved: boolean;
  readonly version: number;
  readonly myRole: ExperienceListRole;
  readonly items: readonly ExperienceListItemDTO[];
}

export interface ExperienceListCollectionDTO {
  readonly owned: readonly ExperienceListDTO[];
  readonly saved: readonly (
    | ({ readonly available: true } & ExperienceListDTO)
    | { readonly available: false; readonly experienceListId: string }
  )[];
}

export interface ExperienceListDiscoveryPageDTO {
  readonly items: readonly ExperienceListDTO[];
  readonly nextCursor: string | null;
}

export interface CreateExperienceListInputDTO {
  readonly name: string;
  readonly visibility?: 'private' | 'public';
}

export interface UpdateExperienceListInputDTO {
  readonly name?: string;
  readonly visibility?: 'private' | 'public';
}

export interface AddExperienceListItemInputDTO {
  readonly experienceId: string;
}

export interface ReorderExperienceListItemsInputDTO {
  readonly experienceIds: readonly string[];
  readonly expectedVersion: number;
}

export type ExperienceListShareRole = 'viewer' | 'editor';

export interface ShareExperienceListInputDTO {
  readonly recipientId: string;
  readonly role: ExperienceListShareRole;
}

export interface ExperienceListShareDTO {
  readonly recipientId: string;
  readonly recipientDisplayName: string;
  readonly role: ExperienceListShareRole;
  readonly sharedAt: string;
}
```

### `packages/shared/src/dto/VisitSummary.ts`

```typescript
export interface VisitSummaryDTO {
  readonly repeatCount: number;
  readonly ratedCount: number;
  /** [1.0, 10.0], one decimal; `null` when `ratedCount` is 0. */
  readonly averageRating: number | null;
}

/** GET /me/experiences/visit-summary response shape. */
export type VisitSummaryResponseDTO = Readonly<Record<string, VisitSummaryDTO>>;
```

### `packages/shared/src/dto/Trip.ts` addition

```typescript
export type TripExperienceListDTO =
  | ({ readonly available: true } & {
      readonly experienceListId: string;
      readonly name: string;
      readonly itemCount: number;
      readonly ownerDisplayName: string;
    })
  | { readonly available: false; readonly experienceListId: string };

// TripDTO gains:
//   readonly experienceLists: readonly TripExperienceListDTO[];
```

Barreled in `packages/shared/src/dto/index.ts`; matching Zod schemas in
`packages/shared/src/schemas/ExperienceList.ts` and `VisitSummary.ts` following the exact
`foodListNameSchema`/enum patterns from `packages/shared/src/schemas/FoodList.ts`.

## Composition Wiring (`apps/api/src/composeServices.ts`)

```typescript
const experienceListRepo = createExperienceListRepo(pool);
const experienceListShareRepo = createExperienceListShareRepo(pool);
const experienceListAffinityRepo = createExperienceListAffinityRepo(pool);

const emitExperienceListShared = (event: ExperienceListSharedNotice): void => {
  void notificationService.handleExperienceListShared(event).catch((err: unknown) => {
    notificationLogger.error({ err, experienceListId: event.experienceListId }, 'experience list share notification failed');
  });
};

const emitExperienceListRoleChanged = (event: ExperienceListRoleChangedNotice): void => {
  void notificationService.handleExperienceListRoleChanged(event).catch((err: unknown) => {
    notificationLogger.error({ err, experienceListId: event.experienceListId }, 'experience list role-change notification failed');
  });
};

const revokeExperienceListSharesOnUnfriend = (userIdA: string, userIdB: string): Promise<void> =>
  experienceListShareRepo.revokeSharesBetween(userIdA, userIdB);

// Port injected into trips' attach/detach (Requirement 14):
const resolveExperienceListForAttach = (experienceListId: string) =>
  experienceListRepo.resolveForAttachEligibility(experienceListId); // { ownerId, visibility } | null

// ... in the object passed to buildServer(config, {...}):
experienceLists: {
  repo: experienceListRepo,
  shareRepo: experienceListShareRepo,
  affinityRepo: experienceListAffinityRepo,
  requireSession: sessionMiddleware,
  emitExperienceListShared,
  emitExperienceListRoleChanged,
},
friends: {
  repo: friendsRepo,
  requireSession: sessionMiddleware,
  emitFriendRequestReceived,
  onFriendshipRemoved: (a, b) => Promise.all([
    revokeFoodListSharesOnUnfriend(a, b),
    revokeExperienceListSharesOnUnfriend(a, b), // NEW — both list kinds revoke on unfriend
  ]).then(() => undefined),
},
trips: {
  // ...existing options...
  resolveFoodList: resolveFoodListForAttach,
  resolveExperienceList: resolveExperienceListForAttach, // NEW
},
```

`Notification_Service` gains `handleExperienceListShared`/`handleExperienceListRoleChanged`,
structurally identical to `handleFoodListShared`/`handleFoodListRoleChanged` — same preference
gate, same delivery mechanism, push payload `data: { experienceListId }`.

### Mobile Notification Tap Deep-Link

`useNotificationResponse.ts`'s `PendingTap` union gains a sixth kind:

```typescript
| { readonly kind: 'experienceListShare'; readonly experienceListId: string }
```

Checked before the `share` fallback, alongside `foodListShare`/`tripInvite`/`rodeWithTag`.
`navigateToExperienceListDetail(experienceListId)` added to `navigationRef.ts`, mirroring
`navigateToFoodListDetail`.

## Error Handling

New `ErrorCode` entries, mirroring the `food_list_*` block exactly with `experience_list_*`
naming:

```typescript
'experience_list_not_found',
'experience_list_edit_forbidden',
'experience_list_item_duplicate',
'experience_list_dining_ineligible',
'experience_list_reorder_mismatch',
'experience_list_stale_write',
'experience_list_share_not_friend',
'experience_list_save_self',
'trip_experience_list_ineligible',
```

`errorCodeToHttpStatus`:

```typescript
experience_list_not_found: 404,
experience_list_edit_forbidden: 403,
experience_list_item_duplicate: 409,
experience_list_dining_ineligible: 400,
experience_list_reorder_mismatch: 400,
experience_list_stale_write: 409,
experience_list_share_not_friend: 403,
experience_list_save_self: 400,
trip_experience_list_ineligible: 403,
```

- `404 experience_not_found`: reused from the base catalog when an
  `AddExperienceListItemInputDTO.experienceId` doesn't resolve.
- `400 experience_list_dining_ineligible`: the referenced Experience's `category` is
  `Restaurant` (Requirement 2.3) — checked before the duplicate check.
- `403 trip_experience_list_ineligible`: attach target neither owned by caller nor public
  (Requirement 14.2), reused directly from the `trip_food_list_ineligible` precedent's shape.
- All remaining codes carry identical meaning to their `food_list_*` counterparts.

## Configuration & Constants

| Constant | Value | Purpose |
|---|---|---|
| `EXPERIENCE_LIST_NAME_MAX_LENGTH` | `100` | Maximum character length for an Experience_List name |
| `DISCOVERY_PAGE_SIZE` | `20` | Default/max page size for `GET /experience-lists/discover` |
| `DEFAULT_DISCOVERY_SORT` | `'popular'` | Default `sort` value when omitted |
| `VISIT_SUMMARY_MAX_IDS` | `100` | Maximum number of `experienceId`s accepted per `GET /me/experiences/visit-summary` request; exceeding it is a `400 validation_failed`, not silent truncation |

No new env vars. No new external API calls.

## Correctness Properties

### Property 1: Ownership-Scoped List-Level Mutation
*For any Experience_List, a rename, visibility change, delete, or share create/role-change/revoke
request succeeds only when the requesting User is the list's `owner_id`; an `editor`-role User
is rejected with `experience_list_edit_forbidden`, a User with no access at all is rejected with
`experience_list_not_found`; no row is changed in either rejection case.*
**Validates:** Requirement 1.3, Requirement 1.4, Requirement 1.5, Requirement 4.7

### Property 2: Edit-Access-Scoped Item Mutation
*For any Experience_List, an item add/remove/reorder request succeeds when the requesting User
is the owner OR holds an active `editor`-role `experience_list_shares` grant; a `viewer`-access
User is rejected with `experience_list_edit_forbidden`; a User with no access at all is rejected
with `experience_list_not_found`; no row is changed in either rejection case.*
**Validates:** Requirement 2.1, Requirement 2.4, Requirement 2.5, Requirement 2.8, Requirement 2.9

### Property 3: Dining Ineligibility Is Enforced at the Write Path
*For any Experience whose `category` is `Restaurant`, an add-item request targeting any
Experience_List is rejected with `400 experience_list_dining_ineligible` regardless of the
requesting User's role on that list, and no `Experience_List_Item` row is created; this check is
evaluated before the duplicate-item check (Requirement 2.2), so a dining Experience already
somehow present in a list (e.g. from data migrated before this constraint existed) does not mask
the ineligibility error behind a duplicate error on a repeat attempt.*
**Validates:** Requirement 2.3, Requirement 9.1

### Property 4: View-Access Predicate Consistency
*For any Experience_List and any User, `GET /experience-lists/:id`, `POST
/experience-lists/:id/like`, and `POST /experience-lists/:id/save` all resolve view access
identically: granted if and only if the User owns the list, OR the list's `visibility =
'public'`, OR an active `experience_list_shares` row exists for `(list, user)` of either role,
OR the list is attached (Requirement 14) to a Trip the User currently belongs to.*
**Validates:** Requirement 3.2, Requirement 3.3, Requirement 6.2, Requirement 6.5, Requirement 7.2

### Property 5: Like Count Denormalization Consistency
*For any Experience_List, at any point in time, `experience_lists.like_count` equals `COUNT(*)
FROM experience_list_likes WHERE experience_list_id = list.id`; every like insert increments it
by exactly 1 and every unlike delete decrements it by exactly 1, transactionally; a repeat
like/unlike changes neither the row set nor the count.*
**Validates:** Requirement 6.1, Requirement 6.3

### Property 6: Reorder Atomicity, Rejection, and Optimistic Concurrency
*For any Experience_List and any submitted reorder array with `expectedVersion`: IF the array's
id set does not exactly equal the list's current item id set, the request is rejected with
`experience_list_reorder_mismatch` and no `position`/`version` changes. ELSE IF
`expectedVersion` does not equal the list's current `version`, the request is rejected with
`experience_list_stale_write` and no changes. ELSE every item's `position` is updated to match
the submitted order and `version` is incremented by exactly 1, all in one transaction.*
**Validates:** Requirement 2.5, Requirement 2.6, Requirement 2.7

### Property 7: Unfriend Revokes Bidirectional Share Access Regardless of Role
*For any two Users A and B with one or more `experience_list_shares` rows between them in either
direction (of either `role`), deleting their `friendships` row deletes every
`experience_list_shares` row where A shared with B and every row where B shared with A; after
the deletion, neither A's nor B's shared-with-them private lists (with no other access path)
resolve via Property 4's predicate, regardless of the deleted grant's `role`.*
**Validates:** Requirement 4.5

### Property 8: Save Is a Live Reference, Never a Copy
*For any Experience_List saved by User U, and any subsequent item add/remove/reorder or rename
by the owner, U's next `GET /experience-lists/:id` (while access remains valid) reflects the
owner's latest change — no `experience_list_saves` row ever stores item or name data.*
**Validates:** Requirement 6.4, Requirement 7.1

### Property 9: Discovery Feed Sort and Scope
*For any `sort=popular` request, every returned page's items are non-increasing in `likeCount`
(ties broken by ascending `id`); for `sort=recent`, non-increasing in `createdAt` (ties broken
by ascending `id`); every returned item has `visibility = 'public'`; paginating through every
page yields the full public set with no duplicate and no omission.*
**Validates:** Requirement 5.1

### Property 10: Role Upsert and Change Notification
*For any Experience_List and any `(owner, recipient)` pair, a share request with a `role`
differing from an existing grant's current `role` updates that grant's `role` in place (no new
row) and triggers exactly one `handleExperienceListRoleChanged` dispatch; a share request with a
matching `role` changes nothing and triggers no notification.*
**Validates:** Requirement 4.3, Requirement 8.2, Requirement 8.3

### Property 11: Attribution Survives Contributor Account Deletion
*For any Experience_List_Item added by User U, if U's account is subsequently deleted, the
`experience_lists_items` row is NOT deleted — only its `added_by_user_id` becomes `null`.*
**Validates:** Requirement 2.1, Requirement 2.10, design note on `ON DELETE SET NULL`

### Property 12: Visit Summary Reflects Only the Requesting User's Own Logs
*For any two Users A and B and any Experience E, `GET /me/experiences/visit-summary` computed
for A never reflects B's `experience_logs` rows for E, regardless of whether A and B share
access to a common Experience_List containing E — `repeatCount`, `ratedCount`, and
`averageRating` are computed with `WHERE user_id = $requestingUserId` and no cross-user
aggregation.*
**Validates:** Requirement 13.2, Requirement 13.7

### Property 13: Visit Summary Batch Completeness and Zero-Log Default
*For any batched request with N distinct `experienceId`s, the response contains exactly N
entries, one per requested id; for any requested id with zero `experience_logs` rows for the
requesting User, that entry is `{ repeatCount: 0, ratedCount: 0, averageRating: null }` rather
than being omitted from the response.*
**Validates:** Requirement 13.1, Requirement 13.2

### Property 14: Done-State Is Always Derived, Never Stored
*No column on `experience_lists_items` or any other table introduced by this spec persists a
manually-set "done"/"gotten" boolean; for any Experience_List_Item, its done-state as rendered
by the App is computed at read time solely from whether `repeatCount > 0` in that item's current
Visit_Summary for the viewing User.*
**Validates:** Requirement 13.4

### Property 15: Logging From the List Updates Its Own Visit Summary
*For any Experience_List_Item currently visible in an open Experience_List view, successfully
submitting a visit log for its `experienceId` via Requirement 13.5's "Log a visit" action causes
that item's next-rendered Visit_Summary (`repeatCount`, `ratedCount`, `averageRating`) to
reflect the newly-created log without requiring the User to navigate away from and back to the
list.*
**Validates:** Requirement 13.6

### Property 16: Trip Attachment Eligibility and Idempotency
*For any Trip and any Experience_List, an attach request succeeds and records exactly one
`trip_experience_lists` row if and only if the requesting Trip_Member owns the Experience_List or
its `visibility` is `public`; a repeat attach request for an already-linked pair changes nothing
and still returns success (no error, no duplicate row); a request where the caller neither owns
nor the list is public is rejected with `trip_experience_list_ineligible` and creates no row.*
**Validates:** Requirement 14.1, Requirement 14.2, Requirement 14.3

### Property 17: Trip Attachment Is View-Access Only, Never a Scheduling Action
*For any Trip and any Experience_List, attaching or detaching that list (Requirement 14) never
creates, modifies, or deletes any `planned_items` row for that Trip — the set of `planned_items`
rows belonging to a Trip immediately before and immediately after an attach/detach operation is
identical.*
**Validates:** Requirement 14.9

### Property 18: Picker List-Sourced Candidates Are the Deduplicated Union of Attached Lists
*For any Trip with Experience_Lists L1...Ln attached, the ExperiencePicker's list-sourced
candidate view (Requirement 15.1) contains exactly the set of distinct `experienceId`s appearing
in the union of L1...Ln's current items, with each `experienceId` appearing exactly once even if
present on more than one attached list; for a Trip with zero attached lists, this candidate
source is absent from the picker's tab set entirely.*
**Validates:** Requirement 15.1, Requirement 15.2, Requirement 15.3

### Property 19: Selecting a List-Sourced Candidate Is Behaviorally Identical to Catalog Search
*For any Experience selected from the picker's list-sourced candidate view versus the same
Experience selected from ordinary catalog search, the resulting `POST /trips/:id/planned-items`
request body and the resulting `planned_items` row are identical in every field — selection
source is never recorded on the created row.*
**Validates:** Requirement 15.4, Requirement 15.6

### Property 20: `ParkPassportCard`'s Average Matches `getVisitSummaries` Exactly
*For any User and Experience with one or more rated `experience_logs` rows, the `averageRating`
and `ratedCount` rendered by `ParkPassportCard` for that Experience are byte-for-byte the values
returned by `GET /me/experiences/visit-summary?ids=<experienceId>` for that same
`(user, experience)` pair — `ParkPassportCard` computes no independent average, rated-count, or
rounding of its own; `repeatCount` as rendered by `ParkPassportCard` equals both
`getVisitHistory`'s `logs.length` and `getVisitSummaries`' `repeatCount` for the same pair (the
two never disagree, since both are `COUNT(*)` over the identical row set).*
**Validates:** Requirement 16 (Consolidate Per-Experience Average Rating Onto One Computation)

### Property 21: Merged Dock Choice Routes to the Correct Unmodified Handler
*For any Experience whose category is `Ride`, `Character_Meet`, `Show`, or `Resort`, activating
the Floating_Action_Dock's secondary action opens a two-option choice rather than immediately
adding to a Trip; selecting `Add to Trip` from that choice invokes the identical `handleAddToPlan`
call (same handler, same `POST /trips/:id/planned-items` behavior) that the pre-Requirement-17
dock invoked directly; selecting `Add to a List` opens the identical `AddToExperienceListsSheet`
that `AddToExperienceListCard` previously opened; dismissing the choice without a selection
creates no `planned_items` row and modifies no `Experience_List`. For a `Restaurant` Experience,
the secondary action is unaffected — it invokes its existing handler directly with no choice
presented.*
**Validates:** Requirement 17.1, Requirement 17.2, Requirement 17.3, Requirement 17.5, Requirement 17.6

### Property 22: Trip Picker Presented Unconditionally, Never Silently Skipped
*For any User selecting `Add to Trip` with N eligible (`active`/`upcoming`) Trips where N ≥ 1,
the App presents the Trip picker (Requirement 18.1) and creates no `planned_items` row until the
User selects a specific Trip from it — this holds identically for N = 1 and N > 1, i.e. no code
path auto-selects and skips the picker purely because exactly one Trip qualified. For N = 0, the
App presents the existing "No Active Trip" alert instead, and no picker is shown.*
**Validates:** Requirement 18.1, Requirement 18.3

### Property 23: Selected Trip Is the Trip Actually Written
*For any Trip the User selects from the picker, the `POST /trips/:id/planned-items` request's
`:id` path parameter equals that selected Trip's `id` — never a different, earlier-resolved
Trip's id.*
**Validates:** Requirement 18.2

## Testing Strategy

Testing follows `food-lists`' established structure exactly, with new/adjusted coverage where
this spec's behavior differs.

- **Repository property tests** (`apps/api/src/services/experienceLists/__tests__/*.prop.test.ts`):
  `fast-check` (>=100 runs) against pg-mem, following the `foodLists`/`experienceLogs.prop.test.ts`
  harness (`applyMigration` for `0050`/`0051` after the base catalog migrations). Covers
  Properties 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 16.
  - Property 3's dining-ineligibility test drives an actor with full edit access (owner) against
    a `Restaurant`-category Experience fixture and asserts rejection regardless of role — this
    specifically must not be conflated with Property 2's access-control tests, since an owner
    with full access is still correctly rejected here for a different reason.
  - Property 1/2's role-matrix generator (`fc.constantFrom('owner', 'editor', 'viewer', 'none')`)
    and Property 6's concurrent-reorder harness are ported directly from `food-lists`' test
    style.
  - Property 16's idempotency case drives two sequential attach calls for the same
    `(tripId, experienceListId)` pair and asserts exactly one row exists afterward and both calls
    returned success.
- **Visit summary tests** (`apps/api/src/services/tracking/logs/__tests__/visitSummary.prop.test.ts`,
  new file alongside the existing `experienceLogs.prop.test.ts`): property-based, covering
  Properties 12 and 13 — generates a random set of users/experiences/logs, asserts the batched
  query's per-id `repeatCount`/`ratedCount`/`averageRating` matches a naive in-memory
  recomputation from the generated logs, that a zero-log id defaults correctly, and that another
  user's logs never leak into the requesting user's numbers.
- **Unfriend cascade integration test**: extends the existing `unfriendFoodListRevocation`-style
  test (or a new sibling `unfriendExperienceListRevocation.integration.test.ts`) asserting
  Property 7 against the real route + repo wiring, and asserting the `Promise.all` composition in
  `composeServices.ts` revokes both list kinds' shares from a single unfriend action.
- **Route integration tests** (`apps/api/src/services/experienceLists/__tests__/routes.test.ts`):
  mirrors `foodLists/__tests__/routes.test.ts`'s Fastify harness, covering every error code
  above, the discovery cursor round-trip, and the `collection` endpoint's `available: false`
  degradation path.
- **Trip attachment route integration test** (`apps/api/src/services/trips/__tests__/experienceListAttachment.test.ts`):
  mirrors the existing `trips` Food_List attachment test file, covering Properties 16 and 17 —
  attach/detach (adder/organizer/forbidden-third-party), the ineligible-attach rejection, the
  unavailable-entry rendering, and explicitly asserting the Trip's `planned_items` row count and
  content are unchanged before/after attach and detach.
- **Migration tests** (`apps/api/src/db/__tests__/migration0050.test.ts`,
  `migration0051.test.ts`): assert every table, `UNIQUE`/`CHECK` constraint, `ON DELETE SET
  NULL`/`CASCADE` behavior, mirroring `migration0041.test.ts`'s structure.
- **Notification tests**: mirror `foodListSharedNotification.test.ts`/`foodListRoleChangedNotification.test.ts`
  exactly, substituting the Experience_List handlers and payload shape.
- **Mobile component tests**
  (`apps/mobile/src/screens/experienceLists/__tests__/ExperienceListDetailScreen.test.tsx`,
  `ExperienceListDiscoveryScreen.test.tsx`, `MyExperienceListsScreen.test.tsx`):
  `@testing-library/react-native`, mocking only the network/query layer, covering
  create/rename/delete, visibility toggle, item add/remove/reorder for `owner`/`editor`,
  read-only rendering for `viewer`, the attribution label, the `experience_list_stale_write`
  refetch-and-toast path, share/revoke/role-change, like/unlike, save, and the owned/saved tab
  switch including an `available: false` row.
- **Visit summary and log-from-list mobile tests** (added to
  `ExperienceListDetailScreen.test.tsx`): asserts the batched visit-summary fetch is issued once
  with all visible items' ids (not N separate requests) — a fixture with 5+ items and a mocked
  `apiRequest` call-count assertion is the concrete check here — asserts the three badge render
  states (no badge / visit-count-only / visit-count-plus-rating) for `repeatCount`/`ratedCount`
  fixtures matching each case (Property 13), asserts the not-done/done sectioning switches an
  item between sections purely from a changed `repeatCount` fixture (Property 14), and asserts
  tapping "Log a visit" opens `LogVisitModal` pre-filled with that row's `experienceId`, that a
  successful submission triggers a visit-summary refetch, and that the refetched data updates
  the row's badge and section without a full remount (Property 15).
- **Dining exclusion mobile test** (added to `ExperienceDetailScreen.test.tsx`): asserts the "Add
  to a list" (Experience_List) affordance is absent for a `Restaurant`-category Experience
  fixture and present for a `Ride`/`Show`/`Character_Meet` fixture, and conversely that the
  existing Food_List "Add to a list" affordance is present only for the `Restaurant` fixture
  (Property 3, Requirement 9.1).
- **Trip attachment mobile tests** (added to the Trip Detail hub's existing test file): mirrors
  the `food-lists` "Attached Food Lists" section test coverage — render, attach control, detach,
  `available: false` treatment.
- **Picker candidate-source tests** (added to
  `apps/mobile/src/screens/trips/__tests__/ExperiencePicker.test.tsx`, exercised from both
  `TripScheduleScreen.test.tsx` and `TripPlannedListScreen.test.tsx` to confirm the shared
  component surfaces identically in both): asserts the "My Lists" tab is absent with zero
  attached lists and present with one or more (Property 18), asserts selecting from it merges
  and deduplicates items across two attached-list fixtures with an overlapping experience
  (Property 18), asserts the "Already added" tag appears only for an `experienceId` already
  present among the Trip's `planned_items` fixture, and asserts selecting a list-sourced item
  issues the identical `POST /trips/:id/planned-items` request body as selecting the same
  experience from the catalog-search tab in the same test (Property 19).
- **Notification tap classification test** (added to `useNotificationResponse.test.ts`): asserts
  `classifyTap` returns `{ kind: 'experienceListShare', experienceListId }` for a response
  carrying `data.experienceListId`, takes precedence over the `share` fallback, and that the
  dispatch path calls `navigateToExperienceListDetail`.
- **`ParkPassportCard` consolidation regression test** (updates existing
  `ParkPassportCard.test.tsx` cases rather than adding new ones — this is a refactor of an
  already-tested component, not new behavior): every existing fixture in that file that
  previously asserted an average/rated-count computed from a `logsQuery`/`ExperienceVisitHistoryDTO.logs`
  fixture is updated to instead mock the `GET /me/experiences/visit-summary` response and assert
  the component renders exactly what that mock returns, with no reduction/rounding performed by
  the component itself — concretely, a test asserting `"★ 10.0 Avg"` renders now supplies
  `averageRating: 10.0` directly in the mocked visit-summary response rather than supplying raw
  `logs` with ratings `[10, 10, 10]` and relying on the component to average them; a second test
  asserts that if the visit-summary mock and the `logsQuery`-derived `repeatCount` were ever to
  disagree (a deliberately inconsistent fixture, to catch a future regression), the component
  renders the `getVisitSummaries`-sourced count, confirming there is no leftover client-side
  averaging path silently still active (Property 20).

## Amendment: List Pinning (Requirement 19)

Direct structural port of `food-lists` design's "List Pinning (Requirement 14)" amendment — same
`pinned_at TIMESTAMPTZ NULL` column choice (not a boolean, so the pinned group itself has a
natural sort key), same `pinned_at DESC NULLS LAST, updated_at DESC` ordering rule, same
"pinning never touches `updated_at`" invariant. See that amendment for the full rationale; only
the entity name differs here.

## Shared Contracts — Addition

### `packages/shared/src/dto/ExperienceList.ts` (amended)

```typescript
export interface ExperienceListDTO {
  // ...existing fields unchanged...
  readonly pinnedAt: string | null; // ISO-8601 UTC, or null if unpinned
}

export interface UpdateExperienceListInputDTO {
  // ...existing fields unchanged...
  readonly pinned?: boolean | undefined;
}
```

`updateExperienceListInputSchema` gains `pinned: z.boolean().optional()`; `experienceListSchema`
gains `pinnedAt: isoTimestampSchema.nullable()` (always present, not optional).

## Data Models & Migration — Addition

### Migration `0053_experience_list_pinning.sql`

```sql
BEGIN;

ALTER TABLE experience_lists
    ADD COLUMN pinned_at TIMESTAMPTZ NULL;

CREATE INDEX experience_lists_owner_pinned_idx ON experience_lists(owner_id, pinned_at DESC, updated_at DESC);

COMMIT;
```

## Error Handling — Addition

No new `ErrorCode`. A pin/unpin request against an Experience_List the requester does not own
reuses the existing `assertOwner` predicate's `experience_list_not_found`/
`experience_list_edit_forbidden` response, identically to `renameList`/`setVisibility`. A
non-boolean `pinned` value follows the existing `validation_failed` path.

## Configuration & Constants — Addition

Reuses `food-lists`' `MAX_COLLECTION_PREVIEW_ROWS = 3` (a single client-side constant in
`CollectionScreen.tsx`, shared by both list types' cards — not duplicated per list type).

## Correctness Properties — Addition

### Property 24: Pinning Reorders Without Touching Content or `updatedAt` (Added by this amendment)
*For any Experience_List, calling `setPinned(listId, ownerId, true)` sets `pinnedAt` to a non-null UTC timestamp and leaves `updatedAt`, `name`, `visibility`, `likeCount`, and every `Experience_List_Item`/`Experience_List_Share`/`Experience_List_Like`/`Experience_List_Save` row unchanged; calling it with `false` sets `pinnedAt` back to `null` with the same non-side-effect guarantee. A non-owner calling `setPinned` is rejected per Requirement 19.3 with no `pinned_at` change on any list.*
**Validates:** Requirement 19.1, Requirement 19.2, Requirement 19.3

### Property 25: Pinned-First Ordering Is Total and Stable (Added by this amendment)
*For any User's set of owned Experience_Lists, `listOwned`'s returned order satisfies: every list with non-null `pinnedAt` appears before every list with a null `pinnedAt`; among lists with non-null `pinnedAt`, they appear in descending `pinnedAt` order; among lists with null `pinnedAt`, they appear in descending `updatedAt` order.*
**Validates:** Requirement 19.4

## Testing Strategy — Addition

- **Repository property test** (extend `apps/api/src/services/experienceLists/__tests__/experienceLists.prop.test.ts`): mirrors `food-lists`' Property 23/24 tests exactly, substituting `Experience_List`/`experience_lists`.
- **Migration test** (`apps/api/src/db/__tests__/migration0053.test.ts`): asserts `experience_lists.pinned_at` exists, is nullable, defaults to `null`, and can be set/cleared via `UPDATE`.
- **Route integration test** (extend `apps/api/src/services/experienceLists/__tests__/routes.test.ts`): mirrors `food-lists`' pin-toggle route tests exactly.
- **Mobile component test** (extend `MyExperienceListsScreen.test.tsx`): mirrors `food-lists`' `MyFoodListsScreen.test.tsx` pin-toggle test exactly.
