# Requirements Document

## Introduction

Guests currently have two ways to mark an Experience as personally significant: a retrospective
`Completion`/`experience_logs` entry (recorded only after a visit) and an `Experience_List`
(deliberate curation — creating or choosing a named list, then adding the item to it, which
takes several taps and a navigation hop via `AddToTripOrListChoiceSheet`). Neither is a fast,
casual "I like this one" marker a guest can set while idly scrolling the catalog or glancing at
live wait times, before or regardless of ever visiting.

This feature adds **Favorite** — a 1-tap, boolean affinity a User can set on any Experience,
independent of visiting it, logging it, or curating any list. It is deliberately **not** a
replacement for `experience-lists`: a Favorite carries no name, no visibility, no sharing, no
ordering, and no membership concept — it is a single persisted bit per `(User, Experience)` pair,
closest in shape to `experience_list_likes`' affinity row, not to an `Experience_List` itself. A
User's favorites then become a standing, reusable filter signal surfaced across the catalog, the
trip day-planning picker, the live waits screen, the Home tab, and a Trip's group summary.

Unlike `experience-lists` (which excludes `Restaurant`-category Experiences, since dining stays
in `Food_List`'s domain), Favorite applies uniformly to every `ExperienceCategory` — it is not a
curation tool with a dining/non-dining split, just a personal-interest marker a guest might set
on a ride, a show, or a restaurant alike.

**Why this is not a replacement for `Completion`:** a `Completion` (and the paired
`experience_logs` row) records that a visit *happened*, on a specific calendar date, and feeds
derived stats, superlatives, and Pin challenges. A Favorite records no date and implies nothing
about whether the Experience has ever been visited — a guest can favorite a ride they have never
ridden, and an already-visited Experience is favorited or not independently of its completion
state.

**Why this is not a replacement for `experience-lists`:** an `Experience_List` is a named,
ordered, optionally-shared collection a User deliberately curates for a purpose ("Must Do",
"Thrill Rides"). A Favorite has none of that — no name, no ordering, no sharing, no visibility,
and exactly one list-like set per User (their favorites), not an arbitrary number of named
collections. A User may favorite an Experience and separately add it (or not) to any number of
Experience_Lists; the two concepts do not read from or write to each other's tables.

**Explicitly deferred (not built by this spec):**

- **Optimizer soft-priority weighting.** `day-planning-optimization`'s `optimize()` engine
  already has a tested `priority` field and is still being tuned; this spec does not add
  favorite-status as a new `OptimizeInput` field or cost-function input. Favorites are surfaced
  only as a candidate filter in `ExperiencePicker` (Requirement 7) — the optimizer itself is
  untouched.
- **Proactive wait-threshold push notifications** (e.g. "Space Mountain dropped below 30 min").
  No experience-level push-notification infrastructure currently exists for live wait data (the
  existing "Alert < 30 min" control on `LiveWaitCockpit.tsx` has no handler wired to it), and
  continuously polling live waits for every User's favorites would conflict with this project's
  free-tier hosting constraints (no always-on background worker; bounded Upstash command
  budget). A future spec may revisit this once a polling/notification strategy is designed.

## Glossary

- **App**: The mobile client (`apps/mobile`) of the Disney World Tracker.
- **User**: An authenticated user of the App.
- **Experience**: An existing catalog item of any `ExperienceCategory` (`Ride`, `Show`,
  `Restaurant`, `Parade`, `Character_Meet`, `Walkthrough`, `PlayArea`, `Game`, `Tour`,
  `Recreation`, `Spa`, `Event`, `Other`, `Resort`), as defined by the base catalog. Unlike
  `experience-lists`, Favorite places no restriction on category — a `Restaurant` is favoritable
  exactly like any other Experience.
- **Favorite**: A boolean affinity recording that a User has marked a specific, active Experience
  as a favorite, persisted as one row in `experience_favorites` keyed by `(user_id,
  experience_id)`. A Favorite carries no name, visibility, sharing, or ordering — it either
  exists for a `(User, Experience)` pair or it does not.
- **Favorite_Service**: The backend capability owning `experience_favorites` — in this design, a
  new module (`tracking/favorite/`) inside the existing Tracking_Service family (alongside
  `completion`, `rating`, `note`), since a Favorite is a simple per-`(User, Experience)` tracking
  fact structurally identical in shape to a Completion, not a new sharing/ownership domain like
  `experience-lists`.
- **Favorited_Set**: The complete set of `experienceId`s a User has favorited, as returned by
  `GET /me/favorites`. Every mobile surface in this spec reads from the same client-side cache of
  this set (`useFavoritedExperiences`) so a toggle on any one surface is reflected everywhere
  else without a page reload.
- **Group_Favorite**: An Experience favorited by two or more Trip_Members of the same Trip,
  computed at read time from each Member's own Favorited_Set — never a separately stored or
  Trip-scoped concept. Deliberately named distinctly from the existing Trip_Summary superlative
  "Crowd Favorite" (`crowd_favorite`, the Trip's single highest-average-rated Experience), which
  is an unrelated, already-shipped concept derived from Ratings, not from Favorites.
- **Trip_Member**: An existing User with a `trip_memberships` row for a given Trip, as defined by
  `trips`.

## Requirements

### Requirement 1: Mark and Unmark a Favorite

**User Story:** As a User, I want to mark any Experience as a favorite with a single tap, and
unmark it just as easily, so that casually noting "I like this one" costs no more effort than a
tap.

#### Acceptance Criteria

1. WHEN a User marks an Experience as a favorite (`PUT /me/experiences/:id/favorite`), THE
   Favorite_Service SHALL insert a `Favorite` row for `(userId, experienceId)` if one does not
   already exist, and SHALL leave the existing row unchanged (idempotent, no error) if one does.
2. IF the `:id` path parameter does not reference an existing, active Experience, THE
   Favorite_Service SHALL reject the request with HTTP `404` and error code `experience_not_found`,
   creating no row.
3. WHEN a User unmarks a favorite (`DELETE /me/experiences/:id/favorite`), THE Favorite_Service
   SHALL delete the `Favorite` row for `(userId, experienceId)` if one exists, and SHALL return
   success (idempotent, no error) if none exists.
4. THE Favorite_Service SHALL NOT require or accept a request body on either the mark or unmark
   endpoint; both operations are fully determined by the authenticated User and the `:id` path
   parameter.
5. WHEN a User requests their Favorited_Set (`GET /me/favorites`), THE Favorite_Service SHALL
   return every `experienceId` that User has favorited, as `{ experienceIds: string[] }`, with no
   required ordering guarantee.
6. Marking or unmarking a Favorite SHALL have no effect on, and SHALL NOT be affected by, that
   Experience's `Completion` state, `experience_logs` rows, Rating, Note, or membership in any
   Experience_List.

### Requirement 2: Favorite Toggle on the Experience Detail Screen

**User Story:** As a User viewing an Experience's detail page, I want to favorite or unfavorite
it from a clearly visible control, so that I don't need to leave the screen or open a separate
sheet to do it.

#### Acceptance Criteria

1. WHEN the App renders `ExperienceDetailScreen` for any Experience, THE App SHALL present a
   heart-icon favorite toggle in the header, alongside the existing share action, reflecting the
   Experience's current favorited state from the User's Favorited_Set.
2. WHEN the User taps the favorite toggle, THE App SHALL optimistically reflect the new state
   immediately and SHALL dispatch `PUT` (to favorite) or `DELETE` (to unfavorite)
   `/me/experiences/:id/favorite` accordingly.
3. IF the dispatched request fails, THE App SHALL revert the toggle to its prior state and
   surface a brief, non-blocking error indication, consistent with the App's existing optimistic-
   mutation error-recovery pattern.
4. WHEN a favorite toggle mutation succeeds, THE App SHALL invalidate the cached Favorited_Set so
   every other currently-mounted surface reading it (catalog rows, Destination_Screen,
   ExperiencePicker, LiveWaitsScreen, Home_Favorites_Section) re-renders with the updated state
   without requiring navigation away and back.

### Requirement 3: Favorite Toggle on Catalog Rows

**User Story:** As a User browsing the catalog or search results, I want to favorite an
Experience directly from its row, so that I can mark things I like while scanning a list without
opening each one's detail page.

#### Acceptance Criteria

1. WHEN the App renders an Experience row on the catalog search-results list (`SearchResultRow`
   on `CatalogScreen`) or on a Destination's experience list (`ExperienceRow` on
   `DestinationScreen`), THE App SHALL present a small favorite-toggle affordance on that row,
   reflecting the Experience's current favorited state.
2. WHEN the User taps a row's favorite-toggle affordance, THE App SHALL toggle that Experience's
   favorited state via Requirement 1's endpoints without navigating away from the current list,
   and SHALL NOT trigger the row's own tap-to-detail navigation.
3. THE row-level favorite-toggle affordance SHALL follow the same optimistic-update and
   error-recovery behavior as Requirement 2.2–2.3.

### Requirement 4: Filter a Destination's Experiences to Favorites Only

**User Story:** As a User browsing a specific park or destination, I want to filter the list down
to just the experiences I've favorited, so that I can quickly find and act on the things I care
about within that destination.

#### Acceptance Criteria

1. WHEN the App renders a Destination_Screen for any Destination, THE App SHALL present a
   "Favorites only" toggle control, independent of and in addition to the existing
   Experience_Category and attribute/land filter chips.
2. WHILE the "Favorites only" toggle is active, THE App SHALL display only Experiences present in
   the User's Favorited_Set, with every other active filter (category, land, attribute, search
   text) continuing to apply conjunctively.
3. WHERE the "Favorites only" toggle is active and no Experience in the current Destination is
   favorited, THE App SHALL display an empty state indicating no favorited experiences were
   found in this destination, distinct from the existing no-filter-matches empty state's wording.
4. Toggling "Favorites only" SHALL NOT alter the User's Favorited_Set; it is a display filter
   only.

### Requirement 5: Cross-Park "My Favorites" View

**User Story:** As a User, I want to see every experience I've favorited across all parks, water
parks, Disney Springs, and resorts in one flat list, so I don't have to remember or re-visit each
destination separately to find something I favorited.

#### Acceptance Criteria

1. THE Catalog_Home screen (`CatalogScreen`) SHALL provide a "My Favorites" entry point,
   presented alongside the Destination grid and reachable without first drilling into a specific
   Destination.
2. WHEN the User opens "My Favorites", THE App SHALL display a flat, tappable list of every
   Experience in the User's Favorited_Set across every Destination (`ThemePark`, `WaterPark`,
   `DisneySprings`, and `Resort` Area_Types alike), reusing the existing flat search-result row
   presentation (thumbnail, name, Destination/Land meta, category badge).
3. WHEN the User selects an Experience from the "My Favorites" view, THE App SHALL navigate to
   `Experience_Detail_Screen` for that Experience.
4. WHERE the User's Favorited_Set is empty, THE "My Favorites" view SHALL display an empty state
   explaining that no experiences have been favorited yet, rather than an empty list with no
   explanation.
5. THE "My Favorites" view SHALL reflect the User's current Favorited_Set at the time it is
   opened and SHALL refresh when a favorite is toggled while the view is mounted (Requirement
   2.4).

### Requirement 6: Favorites as a Candidate Source on the Trip Day-Planning Picker

**User Story:** As a User building a trip's day plan or planned list, I want a direct, dedicated
way to pull up and add from my favorited experiences, so that I can prioritize adding the things
I actually want to do without first scrolling through or searching the full catalog.

**Amendment:** this requirement was originally written as a quick-toggle filter chip layered over
the picker's existing catalog-sourced results (Requirement 6.3's original text explicitly forbade
a dedicated tab or candidate-source prop). In practice that chip only ever filtered an
*already-loaded* candidate pool — on the picker's default "All" tab with no park selected and no
search text entered, no catalog query had fired yet, so the chip filtered an empty list to an
empty list, making favorites effectively undiscoverable from the picker's default state. This
amendment promotes Favorites to a dedicated picker tab, structurally identical to the existing
"My Lists" tab (Requirement 15 of `experience-lists`) — a caller-resolved candidate source,
omitted entirely when the User has no favorites, that never issues its own `GET /catalog` call.
Requirement 6.3 is revised below (not deleted) to reflect this; Requirements 6.1, 6.2, and 6.4 are
preserved in spirit and restated against the new mechanism.

#### Acceptance Criteria

1. WHEN the App renders `ExperiencePicker` and the User has one or more favorited Experiences,
   THE App SHALL present a "Favorites" tab alongside the picker's existing tabs (All, Rides,
   Dining, Shows, Breaks, and — when applicable — My Lists); WHERE the User has zero favorited
   Experiences, THE App SHALL omit the "Favorites" tab entirely, mirroring the "My Lists" tab's
   existing omission rule (`experience-lists` Requirement 15.3).
2. WHEN the User selects the "Favorites" tab, THE App SHALL display every Experience in the
   User's Favorited_Set, resolved by the caller screen (not fetched by `ExperiencePicker` itself)
   and passed in as a candidate-source prop, with every active land/attribute filter continuing
   to apply conjunctively exactly as on every other tab.
3. **(Revised)** THE "Favorites" tab SHALL be implemented as a dedicated `ExperiencePickerTab`
   value (`'favorites'`) with its own caller-supplied candidate-source prop
   (`favoriteSourcedItems`/`favoriteSourcedLoading`), mirroring the "My Lists" tab's
   `listSourcedItems`/`listSourcedLoading` props exactly, rather than as a filter layered over
   another tab's catalog-sourced results.
4. Selecting or using the "Favorites" tab SHALL have no effect on the day-planning
   Optimization_Engine (`optimize()`); it affects only which candidates the picker displays for
   the User to manually add to the Trip's Planned_List, identically to Requirement 15.6 of
   `experience-lists` ("behaviorally identical to catalog search").
5. THE caller screens that render `ExperiencePicker` with Trip-adding capability
   (`TripPlannedListScreen`, `TripScheduleScreen`) SHALL resolve the User's Favorited_Set to full
   Experience rows (via a batched `GET /catalog` read, filtered client-side to the Favorited_Set,
   never a per-id lookup) and supply the result as `favoriteSourcedItems`, gated identically to
   how each screen already gates its "My Lists" resolution (fetched only while that screen's
   add-item modal is open or visible).

### Requirement 7: Favorites Filter on the Live Waits Screen

**User Story:** As a User walking around a park, I want to filter the live waits list down to
just my favorited attractions, so that I can check on the rides I care about at a glance instead
of scanning the whole park's list.

#### Acceptance Criteria

1. THE App SHALL add a "Favorites" filter pill to `LiveWaitsScreen`'s existing filter row,
   alongside "All", "Walk-on", "Lightning Lane", and "Headliners".
2. WHEN the User selects the "Favorites" filter, THE App SHALL display only the active park's
   live-wait-eligible rows whose Experience is in the User's Favorited_Set, applying the same
   sort order (ascending wait, closed/down last) as every other filter.
3. WHERE the "Favorites" filter is selected and no live-wait-eligible Experience in the active
   park is favorited, THE App SHALL display the existing "No rides match this filter" empty
   state.
4. Switching the active park WHILE the "Favorites" filter is selected SHALL re-apply the filter
   against the newly selected park's rows.

### Requirement 8: Home Tab Favorites Section

**User Story:** As a User opening the Home tab, I want to see the live status of my favorited
rides at a glance, so that I have a quick, personalized read on the things I care about without
digging into Live Waits.

#### Acceptance Criteria

1. THE Home tab SHALL present a "Your Favorites" section, positioned below the existing Park Wait
   Pulse section, distinct from and additional to it.
2. WHERE the User has at least one favorited Experience with live wait data available in any
   park, THE "Your Favorites" section SHALL display a horizontal scroll of those Experiences, each
   showing its name and current live wait status, sorted with operating experiences carrying active
   wait times displayed first (ordered ascending by wait duration) and closed/down experiences
   placed last.
3. WHERE the User has no favorited Experiences, or none with live wait data currently available,
   THE "Your Favorites" section SHALL display a compact empty/prompt state rather than rendering
   nothing, inviting the User to favorite something.
4. Selecting an Experience within the "Your Favorites" section SHALL navigate to
   `Experience_Detail_Screen` for that Experience.
5. THE "Your Favorites" section SHALL NOT alter the existing Park Wait Pulse section's data,
   computation (`calculateParkWaitAverage`, `classifyCrowdTrend`), or rendering in any way.
6. THE "Your Favorites" section SHALL provide a "See All" affordance in the section header that
   navigates to the live waits view filtered by favorites when selected.

### Requirement 9: Trip Group Favorites

**User Story:** As a member of a group trip, I want to see which experiences more than one of us
has favorited, so that the group can spot what we actually agree on without manually comparing
lists or polling each other.

#### Acceptance Criteria

1. WHEN a Trip_Member requests a Trip's group favorites (`GET /trips/:id/favorites/shared`), THE
   Favorite_Service SHALL return every Experience favorited by two or more of that Trip's current
   Trip_Members, each with the count of favoriting Trip_Members and their display names.
2. IF the requesting User is not a current Trip_Member of `:id` (including a non-existent Trip),
   THE Favorite_Service SHALL reject the request with the same `trip_forbidden` response used by
   every other Trip_Member-gated endpoint, collapsing both cases identically.
3. THE Trip's Group Favorites SHALL be computed at read time from each current Trip_Member's own
   Favorited_Set and SHALL NOT be separately persisted or cached as Trip-scoped data; a Member
   joining, leaving, or changing their own Favorited_Set SHALL be reflected on the next read with
   no manual recomputation step.
4. WHEN the App renders a Trip's summary/detail surface, THE App SHALL present a "Group
   Favorites" section listing the Experiences from Requirement 9.1, titled and visually distinct
   from the existing "Crowd Favorite" superlative (Trip_Summary's highest-average-rated
   Experience) so the two unrelated concepts are never conflated in the UI.
5. WHERE no Experience is favorited by two or more of the Trip's current Trip_Members, THE "Group
   Favorites" section SHALL display an empty state rather than being omitted silently, so Members
   understand the feature exists and simply has no current matches.

## Cross-Spec Dependencies

- **`experience-lists`**: the structural contrast this spec is deliberately built unlike — see
  Introduction. No shared tables, no shared endpoints; both read the `experiences` table
  independently. Built after `experience-lists` only incidentally (sequencing, not a dependency);
  there is no functional coupling.
- **`experience-activity-logging`**: Completion/`experience_logs` are explicitly independent of
  Favorite (Requirement 1.6); no code or table sharing.
- **`day-planning-optimization`**: Requirement 6 touches `ExperiencePicker.tsx` and
  `experiencePickerFilters.ts`, both owned by that spec's mobile surface. Requirement 6.4 is an
  explicit non-goal: the optimizer itself (`optimizer.ts`, `OptimizeInput`) is untouched by this
  spec, consistent with that spec's current fine-tuning phase.
- **`navigation-redesign`**: Requirement 8 adds a new Home tab section without modifying
  `ParkWaitPulse.tsx`/`pulseCalculations.ts` (Property 7) or the Action Dock; build after
  `navigation-redesign` has shipped the current Home tab layout, which it has.
- **`trips`**: Requirement 9 is a new read endpoint inside the existing Trips_API, gated by the
  existing `assertTripMember` authorization helper (`trips/authz.ts`) and surfaced on an existing
  Trip surface (`TripDetailScreen.tsx` or `TripSummaryScreen.tsx`); it reuses `TripMemberDTO`'s
  existing `displayName`/`avatarPreset` shape for attribution and must not collide in naming or
  presentation with the existing `crowd_favorite` Trip_Summary superlative
  (`apps/api/src/services/trips/summary.ts`).
- **Catalog base** (`disney-facilities-catalog-source` / `catalog-navigation-redesign`): Favorite
  references `experiences.id` directly; no new catalog fields are introduced, and Favorite does
  not participate in catalog sync, Land resolution, or any catalog filter parameter — it is a
  purely client/session-side filter layered on top of catalog reads already happening today.
