# Documentation Drift Audit — Branch D

Scope: `.kiro/specs/{ride-identity-aliases, social-sharing-loop, trip-expenses, trip-reservations, trips}`,
read in full (requirements.md, design.md, tasks.md), each concrete factual claim verified against the
real current source (navigation files, service/repo files, migrations, mobile screens/tests). Methodology
and severity rubric follow `.agents/tasks/docs-drift-audit/findings.md`.

## Headline

This subset is in materially better shape than the original audit's `dark-mode` finding. All five specs'
file paths, service/function names, navigation routes, migration numbers/shapes, and "reuse existing X"
pointers were checked against the real source and matched. Several specs in this batch (`trip-reservations`,
`trips` R21.11) already contain their own inline "this requirement is amended to match the implementation"
corrections, which is exactly the convention `tech-conventions.md` asks for — a good sign these specs are
actively kept in sync. The only finding worth recording is a MEDIUM citation slip in a sixth spec
(`pin-collection`) that references a requirement number in `social-sharing-loop` which does not say what
it's cited for.

- **0 HIGH** findings.
- **1 MEDIUM** finding (a cross-spec citation to the wrong requirement number; the underlying behavior it
  describes is itself correct).
- **0 LOW/NIT** findings worth recording beyond the note below.

---

## MEDIUM findings

### MEDIUM-1: `pin-collection/design.md` cites "Requirement 9.7 of the social-sharing-loop design" for the progress-snapshot-at-send-time behavior; that requirement is about the Share_Notification_Preference default, not the Progress_Share snapshot

- **Claim:** `.kiro/specs/pin-collection/design.md` (Sharing the Showcase section, ~line 1277): *"Unlike
  `progress` (which snapshots stats at send time, Requirement 9.7 of the social-sharing-loop design), a
  `pinShowcase` payload carries no snapshot at all..."*
- **Reality:** `social-sharing-loop/requirements.md` Requirement 9 is "Notification Permission and
  Opt-Out (Phase 2)," and its acceptance criterion 9.7 reads: *"WHERE a User has never set the
  Share_Notification_Preference, THE App SHALL treat the Share_Notification_Preference as enabled by
  default."* That is unrelated to Progress_Share content capture. The actual "progress snapshots stats
  at send time" behavior is `social-sharing-loop/requirements.md` Requirement 1 ("Content-Anchored Share
  Entry Points," AC 1.8: *"...THE App SHALL open the Share_Composer pre-populated with a Progress_Share
  containing the viewing User's overall, per-Park, and per-Experience_Category completion percentages,
  each to one decimal place, as displayed on the Progress_Screen at activation time"*) together with the
  `Share_Payload` glossary entry ("The content snapshot carried by a Share, captured at delivery time and
  unchanged thereafter"). `social-sharing-loop/design.md` echoes this at its own "R1.8" citations (e.g.
  the `ShareComposerParams` `progress` variant comment: `overallPercent: number; // one decimal (R1.8)`).
  Separately, in `social-sharing-loop/design.md` itself, "R9.7" is used three times, each time correctly,
  for the Share_Notification_Preference default-enabled behavior — so the slip is local to the
  `pin-collection` document's citation, not a drift in `social-sharing-loop` itself.
- **Why MEDIUM not HIGH:** the behavioral claim `pin-collection/design.md` is making (progress shares
  snapshot at send time, pinShowcase shares do not) is itself correct and matches the real
  `social-sharing-loop` requirements and the real `ExperienceShareParams`/`ProgressShareParams` shapes in
  `apps/mobile/src/navigation/RootNavigator.tsx` and `apps/mobile/src/screens/catalog/shareEntryPoint.ts`
  (both read during this investigation). Only the citation number is wrong, and it points to a
  requirement in the same feature's own numbering space, so a reader who opens `social-sharing-loop`
  Requirement 9 to double-check will immediately see the mismatch and can self-correct — no agent is
  likely to build the wrong thing off this, but a cold-start agent asked to "verify this citation" or to
  extend sharing based on "see R9.7" would waste a round-trip.
- **Suggested fix:** change `pin-collection/design.md`'s citation from "Requirement 9.7 of the
  social-sharing-loop design" to "Requirement 1.8 of the social-sharing-loop requirements" (or cite the
  `Share_Payload` glossary entry instead, since that is the more general statement of the capture-at-send
  rule this sentence is actually relying on).

---

## Confirmed NOT drifted (checked and found accurate)

- **`ride-identity-aliases`** — not yet implemented (every task in `tasks.md` is unchecked; no
  `services/intelligence/rideIdentity.ts`, no `ride_aliases` migration exist on disk). This is not drift:
  the spec does not claim the feature is built, and its design's claims about what it *will* reuse were
  verified against real code that already exists and matches the described shapes — `IntelligenceRepo`'s
  real methods `getRideShapesForBucket`/`getSeasonHoursForBucket`/`getRideShapes`/`getSeasonHours` (in
  `apps/api/src/services/intelligence/IntelligenceRepo.ts`), `predictionService.getDaySnapshot`'s real
  signature `(experienceIds, park, date)` (in `predictionService.ts`, matching the design's documented
  `(experienceIds: string[], park: string, date: Date)`), and `samplingService.ts`'s real call sites for
  those bucket-scoped reads. The crowd-calendar dependency it names is itself shipped and its described
  tiers/pure-module boundaries match `crowd-calendar/design.md` and the real `waitMath.ts`/`derivedStats.ts`
  module list. Nothing checked requires correction; this spec is simply queued, not stale.
- **`social-sharing-loop`** — every phase's tasks are checked complete, and spot-checks against real code
  all matched: `ShareComposer` is registered on `RootNavigator.tsx`'s `RootStackParamList` as a modal
  (not inside a `FriendsStack`, which per the original audit's HIGH-1/MEDIUM-1 doesn't exist anyway);
  `InboxScreen.tsx` navigates `ExperienceDetail` (root stack, bubbling past the tab navigator) and
  `FriendProfile`/`PinShowcase` (siblings inside `YouAndCrewStack`) exactly as its own code comments
  describe, correctly noting the Inbox "lives inside `YouAndCrewStack`" rather than the stale `FriendsStack`
  name — i.e. this spec's own in-code documentation has already absorbed the `navigation-redesign`
  relocation, unlike the file this audit's MEDIUM-1 flags. `PushNotificationPreferenceControl.tsx` exists
  with the exact `GET`/`PUT /me/notification-preferences` contract described, and is rendered in both
  `ProfileScreen.tsx` (as the design still states, for the legacy/unreachable self-mode block) and
  `YouAndCrewScreen.tsx` (the real reachable surface, consistent with the original audit's dark-mode
  finding about that same screen pair — this spec is not newly wrong, it just predates the relocation and
  was not required to be amended since the control itself still renders correctly in the reachable place).
  Migration `0011_social_sharing_loop.sql` and `0012_notification_preference_generalize.sql` exist with
  exactly the described tables/columns/rename (`push_registrations`, `notification_preferences` with the
  `share_notifications_enabled` → `push_notifications_enabled` rename, `share_reactions`). `SentSharesScreen.tsx`
  exists. The `ExperienceShareParams`/`ShareableExperienceDetail` resort-fallback shapes (`park: Park | null`
  with `resortArea` fallback, citing `experience-detail-redesign` R4.14/R4.15) match the real
  `shareEntryPoint.ts` and the real `experience-detail-redesign/requirements.md` Requirement 20 criteria 7–8
  (the requirement text uses "Requirement 20.7/20.8" internally; the design's "R4.14/R4.15" is a different,
  valid internal cross-reference style some requirements in that spec also use elsewhere — confirmed this
  is not a numbering drift, just a different requirement number landing on the same resort-fallback rule
  than the one re-verified above, both present in the same document).
- **`trip-expenses`** — fully implemented; every file the design/tasks name exists:
  `apps/api/src/services/tripExpenses/{allocation,balances,itemizedTotals,repo,routes,events}.ts`,
  migration `0060_trip_expenses.sql` (confirmed as the correct next-free sequential number — `0059` is
  the prior file on disk), `TripExpensesScreen.tsx`/`TripBalancesScreen.tsx` registered on `TripsStack.tsx`
  and wired into `TripDetailScreen.tsx`'s `HUB_SECTIONS` with the exact `testID="trip-detail-section-expenses"`
  the tasks describe. The `restaurant-menu-display`/`experience_menus` read-only dependency it names for
  Requirement 11's tier suggestions is real (`experience_menus` table and `getMenusFor` exist in
  `apps/api/src/services/catalog/repo.ts`, and `restaurant-menu-display`'s own spec folder exists with the
  described `MenuDTO`/lazy-retrieval shape).
- **`trip-reservations`** — fully implemented; migration `0031_planned_item_reservations.sql` matches the
  design's SQL verbatim (all three columns, all three CHECK constraints, the partial index). The repo
  function names it cites (`addPlannedItem`, `editPlannedItem`, `updatePlannedItemTimes`) exist in
  `apps/api/src/services/trips/repo.ts`. `TripReservationsScreen.tsx` and the extracted
  `apps/mobile/src/components/TimeWheelPicker.tsx` both exist as described. `ExperiencePicker.tsx`'s
  `defaultTab` prop (default `'all'`) is real and matches the design's description of how it combines with
  `showTabs={false}` for the kind-scoped Catalog restriction. This spec's own design.md already contains
  an inline note (R3.17's venue-editing rule) consistent with the "no drift found" pattern — no correction
  needed.
- **`trips`** — the core spec is large (22 requirements) and accurate throughout the sections checked:
  `MainTabs` in `RootNavigator.tsx` genuinely includes a `Trips` tab (now Home/Explore/MagicFab/Trips/
  Collection post-`navigation-redesign`, which the design's own R17 section predates — but this is not an
  uncorrected drift, because `navigation-redesign/requirements.md` Requirement 5 explicitly states the
  Trips tab's six sections "remain unchanged" by that later redesign and does not require `trips` to amend
  its own R17 navigation-shape description, consistent with how `navigation-redesign`'s own glossary frames
  itself as building on top of `trips` unchanged). `GET /me/trips` and `POST /me/trips` exist exactly as
  named in `apps/api/src/services/trips/routes.ts`. `TripsListScreen.tsx`, `Active_Trip_Shortcut`
  (`apps/mobile/src/components/ActiveTripShortcut.tsx`, Requirement 19) and its "no longer available"
  fallback banner in `TripsListScreen.tsx` (R19.6) all exist as described. `trip_reactions` (migration
  `0015_trips.sql`) and `trip_food_lists` (migration `0042_trip_food_lists.sql`, including the `ON DELETE
  CASCADE` the spec's own R21.11 says was corrected to match the implementation) both match. No new
  drift found beyond what the spec has already self-corrected.

## Note on an adjacent, not-strictly-in-scope observation

While reading `social-sharing-loop` and `trips` together, both reference the pre-`navigation-redesign`
tab/screen names (`FriendsStack`, a 5-tab bar including Profile) in places that are either already
superseded correctly in the newer spec (`navigation-redesign` explicitly says it builds on `trips`
unchanged) or already carry the correct resolved behavior in code even where the prose predates the
rename (`social-sharing-loop`'s own `InboxScreen.tsx` code comments already say "lives inside
`YouAndCrewStack`," not `FriendsStack`). None of this rises to a new finding beyond what the original
audit's HIGH-1/MEDIUM-1/MEDIUM-5/LOW-2 already cover for the specs *they* checked; it is mentioned here
only because this subset's specs mention the same renamed entities and were re-verified independently,
confirming the original audit's pattern rather than finding a new instance of it in these five specs.
