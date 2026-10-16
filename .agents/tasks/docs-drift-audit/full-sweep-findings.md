# Documentation Drift & Orphaned Code Audit — Full Sweep

Scope: this report closes the gap left by the prior audit (`.agents/tasks/docs-drift-audit/findings.md`,
which spot-checked 10 specs plus steering/docs/README). It covers the remaining **22 specs** not
checked there, split across four parallel branches: Branch A (`crowd-calendar`,
`disney-world-tracker`, `expanded-stats`, `experience-activity-logging`,
`experience-detail-redesign`, `experience-facet-enrichment`), Branch B
(`experience-search-aliases`, `festival-booth-tagging`, `food-item-logging`, `food-lists`,
`friend-stats-viewing`, `notification-center`), Branch C (`password-reset`, `pin-collection`,
`planned-list-completion-sync`, `resort-tracking-and-stats`, `restaurant-menu-display`), and
Branch D (`ride-identity-aliases`, `social-sharing-loop`, `trip-expenses`, `trip-reservations`,
`trips`). All four branch findings files were present and non-empty — no gap to re-run.
Methodology, severity rubric (HIGH/MEDIUM/LOW-NIT), and finding format are unchanged from the
prior audit: each finding cites the file+line making the claim, the real source file+line
showing the actual state, and a suggested fix; each clean spec gets a short "Confirmed NOT
drifted" entry.

---

## Summary

Across all 22 specs: **4 HIGH**, **5 MEDIUM**, **5 LOW/NIT** findings, plus two Branch-B items
explicitly recorded as scope-disclosure notes rather than counted findings (see the note after
the MEDIUM section).

**Single highest-value finding: HIGH-4 (`pin-collection`'s claimable-pin badge architecture).**
This is the clearest recurrence yet of the exact seed incident from the prior audit's HIGH-1
(dark-mode/ProfileScreen) — a spec describing a `ProfileTabIcon` component, a `profile-tab-badge`
testID, and a "View your pins" button on `ProfileScreen.tsx` that do not exist anywhere in the
real navigator. The real badge lives on `CollectionScreen.tsx`'s claim banner and the Collection
tab's native `tabBarBadge`, a fact the mobile test suite (`pinTabBadge.test.tsx`,
`profilePinBadge.test.tsx`) already quietly worked around without the spec ever being corrected —
the same silent-workaround pattern the prior audit flagged. Close behind it: **HIGH-2
(`food-item-logging`/`food-lists`)** and **HIGH-1 (`disney-world-tracker`)** are each, in their
own way, the same "spec describes a surface `navigation-redesign` (or
`disney-facilities-catalog-source`) already replaced" failure mode recurring at a third/fourth/
fifth instance across this sweep — this is clearly a systemic documentation-maintenance gap, not
isolated incidents, and warrants a repo-wide pass (not just a per-finding fix) adding supersession
notes wherever `navigation-redesign` or `disney-facilities-catalog-source` retired something an
older spec still describes as current.

Branch D (`ride-identity-aliases`, `social-sharing-loop`, `trip-expenses`, `trip-reservations`,
`trips`) is, by contrast, in materially better shape than the rest of the sweep — 0 HIGH, 1
MEDIUM, all five specs otherwise clean, several even containing their own inline "amended to
match the implementation" self-corrections. This suggests the drift problem is concentrated in
specs whose mobile surface was touched by `navigation-redesign` or by the Disney-source migration,
not a uniform property of spec age.

---

## HIGH findings

### HIGH-1: `disney-world-tracker` describes a ThemeParks.wiki-only catalog architecture that `disney-facilities-catalog-source` has fully replaced, with zero cross-reference in either direction

- **Claim:** `.kiro/specs/disney-world-tracker/design.md` and `requirements.md` describe the
  **sole** catalog/live data source as the ThemeParks.wiki API (base URL
  `https://api.themeparks.wiki/v1`, `/destinations` and `/entity/{id}/children`), a
  `Catalog_Service`/`Catalog_Sync` fetching those two endpoints, a standalone out-of-band
  `Image_Sourcing_Job` (`src/scripts/sourceImages.ts`, `npm run source-images`) scraping
  Wikipedia/Wikimedia Commons with curated `imageOverrides.json` overrides, a closed 6-value
  `Experience_Category` set (`Ride|Show|Restaurant|Parade|Character_Meet|Other`), and (per
  `tasks.md` line 587) a 5-tab mobile navigator ("Home, Catalog, Stats, Friends, Profile").
- **Reality:** `.kiro/specs/disney-facilities-catalog-source/requirements.md`'s Introduction
  states this feature "replaces ThemeParks.wiki entirely with Disney's own internal data
  sources... no part of the app reads from ThemeParks.wiki" for the catalog/static path.
  Confirmed against real code: `apps/api/src/services/catalog/reconcile.ts:43-47` and
  `types.ts:103-106` show `image_url` is now a plain Disney-provided field, not sourced by any
  out-of-band job; `imageSurvival.prop.test.ts:1,12-15,59-61`'s own docstring documents the
  inversion; `disney-facilities-catalog-source/tasks.md:261-264` task 12.2 explicitly deletes
  `sourceImages.ts`/`imageOverrides.json` and both are confirmed gone from the live tree (zero
  `file_search` hits). `packages/shared/src/enums.ts:25-44`'s `EXPERIENCE_CATEGORIES` has ten
  values (adds `Tour`, `Recreation`, `Spa`, `Event`, `Resort`), matching
  `disney-facilities-catalog-source/design.md:536-538`, not the original six. The mobile tab bar
  is `Home, Explore, MagicFab, Trips, Collection` (`RootNavigator.tsx:137-189`) — `CatalogStack`/
  `FriendsStack` do not exist. The classification pipeline moved to `classifyFacility.ts` over
  `Facility_Document`/`Facility_Type` (Disney Sync Gateway documents), replacing
  `classify(entity)` over ThemeParks.wiki entities. No `disney-world-tracker` file mentions
  `disney-facilities-catalog-source`/`disney-source-resilience` by name (zero grep hits), and
  vice versa.
- **Why HIGH:** this is the single largest architectural claim in the repo's spec set —
  `disney-world-tracker` is the foundational "Overview" spec a cold-start reader opens first —
  and it describes an upstream source, data flow, out-of-band job, and classification pipeline
  that have been entirely removed and replaced. An agent asked to "add a new Experience field
  from the catalog source" or "fix the image sourcing job" reading only this spec would edit or
  recreate deleted files, target the wrong upstream endpoint, and use a stale 6-value enum. This
  is the dark-mode-incident pattern at the largest scope found in this sweep.
- **Suggested fix:** add a prominent supersession note at the top of
  `disney-world-tracker/design.md`'s Overview and `requirements.md`'s Introduction stating the
  Catalog_Service's ThemeParks.wiki sourcing, the `Image_Sourcing_Job`, and the 6-value
  `Experience_Category` enum are superseded by `disney-facilities-catalog-source` (live data
  further by `disney-source-resilience`), per the "editing an existing spec" convention — add,
  don't delete, since the Auth/Tracking/Stats/Friends/Sharing/Aggregate-Ratings sections remain
  accurate. Also correct `tasks.md:587`'s tab list.

### HIGH-2: `food-item-logging` task 10.4 and `food-lists` task 10.1 both say the entry-point button lives on `ProfileScreen.tsx`; it does not — the seed-incident pattern recurring a third/fourth time

- **Claim:** `food-item-logging/tasks.md` task 10.4: add a "View your food history"
  `SecondaryButton` to `ProfileScreen.tsx` alongside "View your stats"/"View your pins",
  navigating to `MyFoodHistory`. `food-lists/tasks.md` task 10.1: same, for "View your food
  lists," citing `testID="profile-view-food-history"` as the existing sibling pattern, with task
  10.2 extending `ProfileScreen.test.tsx` to assert it.
- **Reality:** `ProfileScreen.tsx`'s own docstring (lines 1-9) states personal stats/food
  history/food lists/pins/notification entry points were retired from this screen and relocated
  to Collection and the global header. Reading the full file confirms it: only the identity
  block, a Notifications preference card, Account Security card, and Logout — no such buttons,
  and zero grep hits for `profile-view-food-history`/`profile-view-food-lists` anywhere in
  `apps/mobile`. `ProfileScreen.test.tsx` has no matching assertion. Real entry points: food
  history via `CollectionScreen.tsx`'s "Open Food History Timeline" button
  (`testID="food-entry-button"`, ~line 840); food lists via `CollectionScreen.tsx`'s "My Food
  Lists" card (`testID="food-lists-card"`, ~lines 866-987). Independently confirmed by the
  already-merged `navigation-redesign` spec's own tasks.md task 10.1, which explicitly lists
  removing these exact buttons from `ProfileScreen.tsx` as part of its own work — i.e. a later
  spec structurally removed what these two older specs' tasks.md still describe adding, and
  neither older tasks.md was ever amended.
- **Why HIGH:** this is the literal, named incident this audit exists to find, found
  independently in two more specs, both checked off `[x]` as done. A cold-start agent following
  either tasks.md literally would edit `ProfileScreen.tsx` and build something unreachable from
  the real tab bar.
- **Suggested fix:** amend both tasks.md files' task 10.4/10.1 (additive correction) to note the
  real destination is `CollectionScreen.tsx`'s Food entry points (post-`navigation-redesign`),
  pointing at `CollectionScreen.test.tsx`'s real `food-entry-button`/`food-lists-card` tests
  rather than `ProfileScreen.test.tsx`. This is a build-order quirk, not a broken
  implementation — both features were correctly implemented against the contemporary
  Profile-tab screen before `navigation-redesign` later relocated it.

### HIGH-3: `festival-booth-tagging` task 12.4 claims Festival-chip tests live in `DestinationScreen.layouts.test.tsx`, checked off `[x]`; that file has zero festival coverage and the real UI lives in a different screen entirely

- **Claim:** `festival-booth-tagging/tasks.md` task 12.2: `DestinationScreen.tsx`'s
  `ThemeOrWaterParkLayout` gets `selectedFestivals` state, a "FESTIVALS" Filters-modal section
  (R8.9-R8.11). Task 12.4: component test extension in
  `apps/mobile/src/screens/catalog/__tests__/DestinationScreen.layouts.test.tsx` covering
  festival-chip rendering per tagged slug, chip selection narrowing results while preserving Land
  grouping, and no chip for an unobserved slug.
- **Reality:** `DestinationScreen.tsx` no longer defines `ThemeOrWaterParkLayout` — dispatch now
  goes straight to `ParkDestinationScreen.tsx`, which is where the real `selectedFestivals`
  state, `toggleFestivalFilter`, and the "FESTIVALS" modal section
  (`testID="destination-modal-festivals-section"`) actually live (`ParkDestinationScreen.tsx`
  ~lines 273-880). `DestinationScreen.layouts.test.tsx` has **zero** matches for "festival"
  (confirmed by grep); its header explicitly scopes coverage to Disney Springs only.
  `ParkDestinationScreen.test.tsx` — the file that actually renders the Festival UI — also has
  zero festival-chip tests (its only "Festival" hits are an unrelated parade fixture); no test
  anywhere asserts `destination-modal-festivals-section`, chip selected/unselected state, or
  "no chip for an unobserved slug."
- **Why HIGH:** the checked-off task names a specific test file and specific assertions for a
  real, shipped, user-facing filter control, and that coverage does not exist anywhere — neither
  in the named file (which structurally cannot cover it) nor in the file that actually contains
  the feature. A "false-checked" task per this repo's own execution-discipline convention —
  the behavior is unverified in CI today.
- **Suggested fix:** retarget task 12.4 at `ParkDestinationScreen.test.tsx` and leave it unchecked
  until the three named assertions (chip rendering, selection narrowing while preserving Land
  grouping, omission for an unobserved slug) are actually added there.

### HIGH-4: `pin-collection`'s claimable-Pin badge architecture (R22.3–22.6) is entirely superseded by `navigation-redesign`, with no cross-reference in either direction

- **Claim:** `pin-collection/design.md`'s "Claimable-Pin Discoverability" section and
  `requirements.md` R22.3-22.6 describe: a `useClaimablePinsBadge()` hook; `RootNavigator.tsx`'s
  `ProfileTabIcon` combining `useAttentionBadge()` + `useClaimablePinsBadge()` into one
  `AttentionBadge` rendered at `testID="profile-tab-badge"` on the **Profile tab icon**; and a
  "View your pins" entry control on `ProfileScreen.tsx` carrying the same badge via the existing
  `notificationBtnWrap`/`notificationBadgeOverlay` pattern. `tasks.md` task 12.4/12.9 repeat this
  verbatim, both checked `[x]`.
- **Reality:** there is no Profile tab at all — `RootNavigator.tsx`'s `MainTabParamList` is
  `Home | Explore | Trips | Collection` (zero `ProfileTabIcon` hits anywhere, zero
  `useAttentionBadge()` call in `RootNavigator.tsx`). The claimable-pin badge lives on
  `CollectionScreen.tsx` as a "Ready to Claim" banner (`testID="claim-banner"`, text anchor
  `claimable-pins-badge`), and the Collection tab itself carries a native React Navigation
  `tabBarBadge` showing `claimableCount` — directly contradicting the design's explicit claim
  that "No `tabBarBadge`... is used." `ProfileScreen.tsx` has no "Pin collection" card, no "View
  your pins" button, no badge of any kind (consistent with the prior audit's HIGH-1 and this
  sweep's HIGH-2 above). `pinTabBadge.test.tsx`'s own doc comment and assertions explicitly say
  "Bottom tab bar no longer carries profile-tab-badge" and re-target `CollectionScreen`'s
  `claimable-pins-badge` anchor; `profilePinBadge.test.tsx` likewise now tests
  `CollectionScreen` despite its name. `navigation-redesign/requirements.md` R6.5/R6.7a is the
  source of the real current behavior and names `pin-collection` as a spec it builds on top of —
  but neither direction records that it replaced R22.3-22.6's badge architecture.
- **Why HIGH:** the same class of mistake as the seed `dark-mode` incident — a spec describing a
  hook point/component/testID that does not exist in the real navigator, with no superseding
  note. An agent asked to "add a third badge domain next to notifications and pins" or "fix the
  Profile tab badge" would read this spec, go looking for `ProfileTabIcon` and a `ProfileScreen`
  "Pin collection" card, and find neither.
- **Suggested fix:** add a superseding note to `pin-collection/requirements.md` R22.5/R22.6 and
  `design.md`'s "Claimable-Pin Discoverability" section pointing at `navigation-redesign` R6.5/
  R6.7a for the current real badge/banner location (`CollectionScreen.tsx`'s claim banner + the
  Collection tab's native `tabBarBadge`), noting the `ProfileTabIcon`/`profile-tab-badge`/"View
  your pins" architecture was retired by that spec's tab redesign.

---

## MEDIUM findings

### MEDIUM-1: `experience-activity-logging/design.md` names a `confirmRodeWithLog` repo method on `ExperienceLogRepo` that does not exist; the real logic lives inline in `trips/repo.ts`

- **Claim:** design.md's "Backend Structure" lists `ExperienceLogRepo` as providing
  `confirmRodeWithLog(taggedMemberId, originatingLogId): Promise<ExperienceLogDTO>` among four
  methods.
- **Reality:** `apps/api/src/services/tracking/logs/repo.ts:95-110`'s real interface has exactly
  `addLog`, `getVisitHistory`, `deleteLog`, `getVisitSummaries` — no `confirmRodeWithLog`. The
  R3.1/R3.2 rode-with confirmation flow is instead a raw inline SQL `INSERT INTO
  experience_logs` inside `apps/api/src/services/trips/repo.ts`'s `confirmRodeWithTag`
  (lines ~3605-3722, insert at ~3700-3707), explicitly commented as implementing exactly this
  requirement.
- **Why MEDIUM not HIGH:** the described behavior is correctly implemented and the requirement
  is satisfied — a pure interface/location mismatch, not a missing feature. Risk is scoped to
  someone extending the rode-with-confirm flow who looks for `confirmRodeWithLog` on
  `ExperienceLogRepo` and won't find it there.
- **Suggested fix:** amend design.md's "Backend Structure" to remove `confirmRodeWithLog` from
  `ExperienceLogRepo` and note R3's rode-with confirmation is implemented inline inside
  `trips/repo.ts`'s `confirmRodeWithTag`, with a pointer to that function.

### MEDIUM-2: `crowd-calendar/tasks.md` task 21.5 (365-day Ride_Baseline re-anchor, R14.9) is honestly unchecked, flagged defensively given the surrounding wave's heavy "complete" density

- **Claim:** task group 21 is almost entirely `[x]` (21.1-21.4, 21.6-21.8), leaving only 21.5
  ("re-anchor the Ride_Baseline from a trailing 365-day archive window") unchecked, with its own
  gating note that it's a no-op until `wait_archive` holds ≥365 days.
- **Reality:** correctly left unchecked and not itself a drift — `wait_archive` was only
  introduced in this same task group, so a year of data cannot yet exist; no source file claims
  this leg is implemented, and no such recompute function exists in
  `derivedStatsService.ts`. Flagged only because R14.9/Property 14's "re-anchor" language already
  exists in requirements.md/design.md describing a mechanism not yet built, so a
  requirements.md-only reader could mistake it for shipped behavior.
- **Suggested fix:** none required for correctness; optionally add a one-line "pending, gated on
  data accrual" annotation directly in requirements.md next to R14.9.

### MEDIUM-3: `password-reset/tasks.md` task 1.2 names `packages/shared/src/schemas/auth.ts`/`dto/auth.ts`; the real files are `schemas/User.ts`/`dto/User.ts`

- **Claim:** task 1.2: define `forgotPasswordInputSchema`, `resetPasswordInputSchema`, and DTO
  types in `packages/shared/src/schemas/auth.ts` and `packages/shared/src/dto/auth.ts`.
- **Reality:** neither file exists. The schemas live in `packages/shared/src/schemas/User.ts`
  (~lines 85-120, confirmed via `schemas/index.ts`'s re-exports); the DTOs
  (`ForgotPasswordResponseDTO`, `ResetPasswordSuccessDTO`) live in
  `packages/shared/src/dto/User.ts`. Task 1.1's `errors/codes.ts` claim is also off — there is no
  `errors/` subdirectory; `ERROR_CODES` and the three error codes live in a single
  `packages/shared/src/errors.ts`.
- **Why MEDIUM not HIGH:** the schema/DTO/error-code names and behavior are exactly as described
  and fully implemented/tested — only the file path is wrong, so an agent lands one directory
  listing away rather than at a nonexistent module. A reasonable repo convention
  (grouping by domain-entity file) the plan predates.
- **Suggested fix:** update tasks.md 1.1/1.2 to say `packages/shared/src/errors.ts` and
  `schemas/User.ts`/`dto/User.ts`.

### MEDIUM-4: `resort-tracking-and-stats`'s "By Area" mobile presentation (`Own_Areas` mode, `OwnAreasPane`) was fully replaced by `stats-experience-redesign`, leaving a dead UI description with no cross-reference

- **Claim:** design.md's "Mobile" section describes an `Own_Areas` `OwnStatsViewMode`, an
  "Areas" tab in `OWN_STATS_TABS` (`TabSelector.tsx`), and a new `OwnAreasPane` mounted in
  `StatsScreen.tsx` rendering a single "By Area" list (Park-like Area_Types plus Resorts as a
  4th area card). tasks.md 9.3/9.4 match, both `[x]`.
- **Reality:** `OWN_STATS_TABS` does contain an `Own_Areas` entry, but it and the whole
  `useViewMode`/tab-selector machinery is dead code as far as `Own_Stats_View` is concerned —
  `StatsScreen.tsx` references none of `OWN_STATS_TABS`/`TabSelector`/`OwnStatsViewMode`/
  `OwnAreasPane` (zero hits). `StatsScreen.tsx`'s own doc comment states it's the Overview hub
  (`stats-experience-redesign` task 8.1), which removed `useViewMode`/`OWN_STATS_MODES` usage —
  the exact same supersession pattern the prior audit's MEDIUM-5 flagged for
  `friend-profile-navigation`'s Own-side tabs. The real presentation today is
  `CoverageDetailScreen.tsx`'s Lens_Switcher with separate `'areas'` and `'resorts'` lenses — a
  materially different structure (Resorts is a separate lens, not folded into Areas as a 4th
  card). The backend `byAreaType`/`resort` fields remain the accurate, unaffected data source.
- **Why MEDIUM not HIGH:** the stale description doesn't point at a nonexistent file for the
  backend half (accurate and current); only the specific mobile component names and their active
  render path are gone, and the underlying user-facing capability still exists via a different
  screen that satisfies the same requirements.
- **Suggested fix:** add a supersession note to design.md's "Mobile" section and tasks.md 9.3/9.4
  pointing at `CoverageDetailScreen.tsx`'s Areas/Resorts lenses as the current real mobile
  presentation, noting `OwnAreasPane` was retired by `stats-experience-redesign`'s rewrite while
  the backend contract remains unchanged.

### MEDIUM-5: `pin-collection/design.md` cites "Requirement 9.7 of the social-sharing-loop design" for progress-snapshot-at-send-time behavior; that requirement is actually about the Share_Notification_Preference default, not the Progress_Share snapshot

- **Claim:** pin-collection/design.md's Sharing-the-Showcase section (~line 1277): progress
  "snapshots stats at send time, Requirement 9.7 of the social-sharing-loop design," unlike a
  `pinShowcase` payload which carries no snapshot.
- **Reality:** `social-sharing-loop/requirements.md` R9 is "Notification Permission and Opt-Out
  (Phase 2)"; AC 9.7 is about defaulting Share_Notification_Preference to enabled, unrelated to
  Progress_Share content capture. The actual snapshot-at-send-time behavior is R1 ("Content-
  Anchored Share Entry Points," AC 1.8: Share_Composer pre-populated with completion percentages
  "as displayed on the Progress_Screen at activation time") plus the `Share_Payload` glossary
  entry. `social-sharing-loop/design.md` itself uses "R9.7" correctly three times elsewhere for
  the notification-preference default — the slip is local to the `pin-collection` document's
  citation only.
- **Why MEDIUM not HIGH:** the behavioral claim pin-collection is making is itself correct and
  matches the real `ExperienceShareParams`/`ProgressShareParams` shapes
  (`RootNavigator.tsx`/`shareEntryPoint.ts`); only the citation number is wrong, and it's wrong in
  a way a reader checking the citation would self-correct immediately — low risk of building the
  wrong thing, but wastes a round-trip for an agent asked to verify or extend it.
- **Suggested fix:** change the citation to "Requirement 1.8 of the social-sharing-loop
  requirements" (or cite the `Share_Payload` glossary entry instead).

*Scope-disclosure notes, not counted as findings (per Branch B's own tally treatment, mirrored
here):* Branch B recorded two additional items that were explicitly **not** counted toward its
MEDIUM tally and are preserved here only for completeness: (a) `food-lists/design.md`'s
"Discovery Cursor" claim that no existing endpoint paginates with a cursor was not independently
falsified but is narrower than it reads (scoped to the two named list endpoints, not every
endpoint in the app) — recorded as a low-confidence non-finding; (b) `food-lists`' large volume of
amendments (pin/unpin, visibility badges, menu-item add affordances, etc.) received only a
spot-check, not a full line-by-line re-verification of every amendment's file/testID targets —
flagged as a scope disclosure for a future auditor, not a confirmed drift.

---

## LOW / NIT findings

### LOW-1: `experience-detail-redesign/requirements.md`'s `Single_Rider_Strip` glossary entry cites `WaitInsightsSection.tsx` as still-rendered UI; it's no longer reachable from `ExperienceDetailScreen.tsx` — only `LiveWaitCockpit.tsx` (which absorbed its logic) is

- **Claim:** requirements.md lines 387-390 and design.md lines 655-658 cite
  `RideLiveSection.tsx`/`WaitInsightsSection.tsx` as the existing single-rider surfacing,
  "already rendered."
- **Reality:** `RideLiveSection.tsx` is real and unaffected. `WaitInsightsSection.tsx` still
  exists on disk with its own passing tests but is not imported or rendered anywhere outside its
  own test file (zero non-test `.tsx` imports). `ExperienceDetailScreen.tsx` → `TodayInParkLens.tsx`
  renders `LiveWaitCockpit.tsx` instead, whose own header comment says its verdict logic was
  ported from `WaitInsightsSection` rather than composing/wrapping it. This is the spec's own
  intended, already-completed outcome (task 18.1, `[x]`) — the text just never updated its
  "already rendered by" framing after task 18 finished.
- **Why LOW:** no behavioral risk — `LiveWaitCockpit.tsx` contains equivalent (richer in places)
  UI, so a reader following the design still reaches working code; only the second citation is a
  dead end for this specific screen's reachability.
- **Suggested fix:** update both glossary/design citations to say single-rider surfacing is now
  in `RideLiveSection.tsx` and `LiveWaitCockpit.tsx` (which inlines `WaitInsightsSection.tsx`'s
  former verdict logic).

### LOW-2: `experience-detail-redesign`'s Trip_Context_Date bug narrative (R16) singles out `WaitInsightsSection.tsx` by name even though the task title and the actual fix correctly cover both files

- **Claim:** design.md's Research Notes frame the entire defect against `WaitInsightsSection.tsx`
  alone, while tasks.md task 22's title correctly names both `WaitInsightsSection`/
  `LiveWaitCockpit`.
- **Reality:** both `LiveWaitCockpit.tsx:107-110` and `WaitInsightsSection.tsx:9` call
  `resolveTripContextDate(...)` — both were fixed by task 22, consistent with the task title.
  Not a substantive drift; the task title and the actual fix agree with each other, only
  design.md's prose elaboration is narrower than its own task.
- **Suggested fix:** none required beyond noting it; downgraded to a NIT.

### LOW-3: `festival-booth-tagging/design.md`'s `FestivalStatsDTO` section narrates its own prior mistake and correction inline, rather than being clean

- **Reality:** not a drift — design.md explicitly and correctly documents that an earlier draft
  wrongly pointed at `@dwt/shared`'s unused `StatsDTO`/`statsSchema` instead of the real
  `StatsResponse`, and the real code today matches the corrected text. Recorded only as a nit
  because a cold-start reader must read past the "earlier draft was wrong" narration to reach the
  authoritative text.
- **Suggested fix:** none needed; the file is accurate but not maximally terse.

### LOW-4: `notification-center/design.md`'s flagged "design consideration" (trip-invite `createdAt`) was resolved in the implementer's favor with no update to the flag

- **Reality:** design.md's "flagged for review" section on adding an additive `createdAt` to
  `TripIncomingInviteDTO` was resolved via the proposed (non-fallback) path, confirmed in the real
  DTO shape — but the "flagged for review" framing is never marked resolved in the document. Zero
  behavioral risk; cosmetic only.
- **Suggested fix:** mark the design consideration resolved inline.

### LOW-5: `restaurant-menu-display/tasks.md` tasks 13/13.1/13.2 (Menu Screen Food List Affordances, R5.10) are marked incomplete (`[ ]`) but are fully implemented and tested in the real codebase

- **Reality:** `MenuScreen.tsx` already imports and renders `FoodItemPickerModal`
  (`testID="menu-screen-add-to-list-btn"`) and `AddToListsSheet`
  (`testID="menu-item-add-to-list-0-0-0"`), with a dedicated passing test file
  `MenuScreen.foodListAffordances.test.tsx` exercising both. Code and tests are ahead of the
  task tracker, not behind it.
- **Why LOW:** bookkeeping staleness only, not a factual claim that would mislead an agent about
  where code lives or how it behaves.
- **Suggested fix:** mark tasks 13, 13.1, 13.2 `[x]`.

---

## Confirmed NOT drifted (checked and found accurate)

- **`experience-search-aliases`** — accurate end-to-end: `experienceAliases.ts`/`fuzzyDistance.ts`
  exist with the exact described exports; tier scoring (85/80/70/60/40/35/20) matches design.md
  verbatim; all claimed mobile/backend consumers exist and call it as described.
- **`festival-booth-tagging`** — overwhelmingly accurate across a very large, heavily-amended
  spec (migrations `0039`/`0055`, `FestivalStatsDTO` threading, `pins/evaluator.ts`'s Property 25,
  `ExperiencesDetailScreen.tsx`'s Festival Booths section, `ExperienceDTO.festivalTag`,
  `experiencePickerFilters.ts`, `qualifyingVisit.ts`/`qualifyingVisitQuery.ts` all confirmed).
  The one real gap is HIGH-3 above.
- **`food-item-logging`** — accurate apart from HIGH-2's single stale button-placement claim;
  migration `0040`, `MyFoodHistoryScreen.tsx`, `RestaurantFoodLogsSheet.tsx`,
  `deriveDisplayedFoodLogs` all confirmed.
- **`food-lists`** — accurate apart from HIGH-2's claim and the two scope-disclosure notes above;
  `MyFoodListsScreen.tsx`'s `handleBack`, `createFoodListInputSchema`'s `visibility` field, and
  `CollectionScreen.tsx`'s `MAX_COLLECTION_PREVIEW_ROWS`/pinned-first slice/testIDs all confirmed.
- **`friend-stats-viewing`** — fully accurate; `ownerOrFriend.ts`, migration `0003`, the
  `friendCompletions/` module's exact SQL and query shape, and `FriendsListScreen.tsx`'s
  navigation all confirmed, including a large battery of real pg-mem property/integration tests.
- **`notification-center`** — fully accurate apart from LOW-4's cosmetic note; migration `0017`,
  the pending-rode-with-tags endpoint/repo method, and the entire mobile pure/hook/presentation
  layering (`useAttention.ts`, `useAttentionActions.ts`, `useAttentionBadge.ts`, etc.) confirmed.
- **`crowd-calendar`** — extensively verified: all named pure modules
  (`waitMath.ts`/`calibration.ts`/`crowdForecast.ts`/`derivedStats.ts`/`seasonalPrior.ts`/
  `showtimePatterns.ts`/`weatherClient.ts`/`samplingService.ts`/`predictionService.ts`/
  `IntelligenceRepo.ts`), migrations `0020`/`0021`/`0029`/`0030`/`0033`, and
  `CrowdCalendarScreen.tsx`'s registration/tests all confirmed. (See MEDIUM-2 for the one
  honestly-unchecked item.)
- **`expanded-stats`** — design and real code match closely; `stats/`'s named modules, the
  `GET /me/stats`/`GET /me/stats/summary` endpoints, and the `getStatsSnapshot` contract all
  confirmed verbatim.
- **`experience-activity-logging`** — migration `0034`, `tracking/logs/` repo/routes, and
  `LogVisitModal.tsx`'s wiring all confirmed. Only MEDIUM-1's interface-location claim is
  drifted.
- **`experience-detail-redesign`** — the two-Lens shell, `LiveWaitCockpit.tsx`,
  `TodayInParkLens.tsx`, `PassportAndLoreLens.tsx`, `QuickSpecsRow.tsx`, and
  `FloatingActionDock.tsx` are all real and wired exactly as described. Only LOW-1/LOW-2's
  citation staleness found.
- **`experience-facet-enrichment`** — fully accurate; migration `0008`, `facilityDoc.ts`'s facet
  groups, `enrich.ts`'s extraction functions, and the mobile rendering (relocated into
  `PassportAndLoreLens.tsx` by the later redesign, expected forward evolution) all confirmed.
- **`planned-list-completion-sync`** — fully accurate end-to-end: no new migration/endpoint
  needed as designed; `packages/shared/src/plannedCompletion.ts`'s exports,
  `TripSummaryDTO`'s additive fields, `deriveTripSummary`'s extension, `repo.ts`'s `getSummary`
  query, and `TripPlannedListScreen.tsx`'s wiring all confirmed exactly.
- **`restaurant-menu-display`** — fully accurate apart from LOW-5's bookkeeping note;
  `composeServices.ts` wiring, the category gate in `catalog/routes.ts`, migration `0044`'s
  `dining_url`, and `MenuScreen.tsx`/`MenuSummaryCard` all confirmed.
- **`password-reset`** — accurate apart from MEDIUM-3's file-path claim; `AuthStackParamList`'s
  `ForgotPassword`/`ResetPassword` routes, `LoginScreen.tsx`'s "Forgot password?" button,
  `ForgotPasswordScreen.tsx`/`ResetPasswordScreen.tsx`, migration `0059`, `PasswordResetRepo`,
  `mailService.ts`'s three-way branching, and all four HTTP endpoints (including the
  anti-enumeration/rate-limit behavior) confirmed exactly.
- **`pin-collection`** (non-badge parts) — `useClaimablePinsBadge`/`isReadyToClaim`'s hook
  mechanics, `CollectionStack.tsx`'s registration of `PinBoard`/`PinAttribution`/`PinShowcase`,
  `pin-roster-v2.html`, and the `PINS` catalog in `packages/shared/src/pins/catalog.ts` all
  confirmed; backend award-wiring (R20/21) and the migration were not independently
  re-verified line-by-line but surfaced no contradiction. Only HIGH-4 and MEDIUM-5 found.
- **`resort-tracking-and-stats`** (backend) — migration `0009`'s `represents_resort_id`
  column/indexes, the `StatsCell`/`area_type`/`is_resort_representation` plumbing, and
  `AREA_TYPES`/`AreaType` reuse all confirmed. Only MEDIUM-4's mobile-presentation claim is
  drifted.
- **`ride-identity-aliases`** — not yet implemented (every task unchecked, no source files on
  disk) — this is not drift, since the spec claims nothing is built; its claimed reuse points
  (`IntelligenceRepo`'s bucket-scoped methods, `predictionService.getDaySnapshot`'s signature)
  were verified accurate against real, already-shipped code.
- **`social-sharing-loop`** — every phase complete and accurate: `ShareComposer`'s modal
  registration on the root stack, `InboxScreen.tsx`'s navigation (its own comments already
  correctly say "lives inside `YouAndCrewStack`," not the retired `FriendsStack`),
  `PushNotificationPreferenceControl.tsx`'s dual rendering, migrations `0011`/`0012`,
  `SentSharesScreen.tsx`, and the resort-fallback DTO shapes all confirmed. Only MEDIUM-5
  (a `pin-collection` citation *into* this spec, not a drift in this spec itself) touches it.
- **`trip-expenses`** — fully implemented; the `tripExpenses/` service module, migration `0060`,
  `TripExpensesScreen.tsx`/`TripBalancesScreen.tsx`'s wiring into `TripDetailScreen.tsx`, and the
  `restaurant-menu-display` read-only dependency all confirmed.
- **`trip-reservations`** — fully implemented; migration `0031` matches verbatim, the named repo
  functions exist, `TripReservationsScreen.tsx`/`TimeWheelPicker.tsx` exist, and
  `ExperiencePicker.tsx`'s `defaultTab` prop is real.
- **`trips`** — the core 22-requirement spec is accurate throughout the sections checked; the
  `Trips` tab, `GET`/`POST /me/trips`, `TripsListScreen.tsx`, `ActiveTripShortcut.tsx` (R19), and
  `trip_reactions`/`trip_food_lists` migrations all confirmed. The pre-`navigation-redesign` R17
  tab description is not an uncorrected drift — `navigation-redesign/requirements.md` R5
  explicitly states the Trips tab's sections "remain unchanged," so no amendment to `trips` is
  required.

---

## Prioritized action list

**No HIGH finding in this report requires a code change — every one is a documentation-only
fix**, consistent with this being a read-only investigation (no build/verify was run, per the
brief's instruction). That said, all four HIGH findings warrant an immediate follow-up fix pass,
mirroring how the prior audit dispatched its own HIGH-1 immediately:

1. **HIGH-4 (`pin-collection`)** — correct the claimable-pin badge architecture to point at
   `navigation-redesign` R6.5/R6.7a and `CollectionScreen.tsx`. Highest-value fix in this report:
   the clearest, cleanest recurrence of the seed incident found in this sweep.
2. **HIGH-2 (`food-item-logging`/`food-lists`)** — correct both tasks.md's stale
   `ProfileScreen.tsx` button-placement claim to `CollectionScreen.tsx`.
3. **HIGH-1 (`disney-world-tracker`)** — add the supersession note to the Overview/Introduction;
   this is the largest-blast-radius single document in the repo's spec set and should not be
   left for a reader to discover piecemeal.
4. **HIGH-3 (`festival-booth-tagging`)** — retarget task 12.4 at `ParkDestinationScreen.test.tsx`
   and leave it unchecked until the named Festival-chip assertions are actually written; this is
   the one HIGH finding in this report with a real (if narrow) test-coverage gap behind it, not
   purely a stale citation.

**Add a 'supersedes'/deprecation note (per the tech-conventions editing rule) rather than leaving
silently stale:**
- `experience-activity-logging/design.md` (MEDIUM-1), `password-reset/tasks.md` (MEDIUM-3),
  `resort-tracking-and-stats/design.md`+`tasks.md` (MEDIUM-4), and `pin-collection/design.md`'s
  wrong citation (MEDIUM-5) — all four are same-spec corrective notes/edits, no behavior change.

**Lower priority, batchable with any nearby edit:**
- MEDIUM-2 (`crowd-calendar` task 21.5) — optional one-line annotation only; the task itself is
  honestly unchecked and not a drift.
- LOW-1 through LOW-5 — citation/doc-comment/task-checkbox hygiene, zero behavioral risk; fix
  opportunistically the next time each file is touched. LOW-5 in particular is a "mark it done"
  fix, not a correction.

**Cross-cutting observation worth flagging separately from any single finding:** four of this
sweep's five HIGH findings across both this report and the prior audit now follow the identical
shape — a spec describes a mobile screen/component/testID that `navigation-redesign` (or, for
HIGH-1, `disney-facilities-catalog-source`) already replaced, with no supersession note in either
direction. Given the recurrence count (dark-mode, food-item-logging, food-lists,
festival-booth-tagging's test-location variant, pin-collection, disney-world-tracker), a
one-time repo-wide pass specifically searching every spec for `ProfileScreen.tsx`/`FriendsStack`/
`CatalogStack` references and adding supersession notes wherever they're stale would likely be
more effective than fixing each instance as it's independently rediscovered.
