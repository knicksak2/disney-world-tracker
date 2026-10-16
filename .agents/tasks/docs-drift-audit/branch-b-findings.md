
# Documentation Drift Audit — Branch B

Methodology, severity rubric, and finding format replicated from the prior audit
(`.agents/tasks/docs-drift-audit/findings.md`). Scope for this branch: 6 specs —
`experience-search-aliases`, `festival-booth-tagging`, `food-item-logging`, `food-lists`,
`friend-stats-viewing`, `notification-center`. Each spec's requirements.md, design.md, and
tasks.md were read in full; every concrete factual claim (file path, function/class/service
name, navigation route, DB table/column, "reuse existing X" pointer, cross-spec reference,
status claim) was checked against the real current source using targeted grep/search —
not an exhaustive repo read.

---

## HIGH findings

### HIGH-1: `food-item-logging` task 10.4 and `food-lists` task 10.1 both say the entry-point button lives on `ProfileScreen.tsx`; it does not — this is the exact seed-incident pattern recurring a third/fourth time

- **Claim:** `.kiro/specs/food-item-logging/tasks.md` task 10.4: *"Add a 'View your food
  history' `SecondaryButton` to `ProfileScreen.tsx` alongside the existing 'View your
  stats'/'View your pins' entry points, navigating to `MyFoodHistory`."* `.kiro/specs/food-lists/tasks.md`
  task 10.1 says the same for a "View your food lists" button, citing `testID="profile-view-food-history"`
  as the existing sibling pattern it mirrors, and task 10.2 says to extend
  `apps/mobile/src/screens/__tests__/ProfileScreen.test.tsx` to assert it.
- **Reality:** `apps/mobile/src/screens/ProfileScreen.tsx`'s own module docstring (lines 1-9,
  read in full) states: *"Trimmed to the identity block... Personal stats, food history, food
  lists, pins, and notification center entry points have been retired from this screen and
  relocated to Collection and the global header."* Reading the full file confirms it: the
  default-exported `ProfileScreen` renders only the identity block
  (`ProfileIdentityBlock`), a Notifications preference card, an Account Security card, and
  Logout — there is no "View your food history," "View your food lists," "View your stats,"
  or "View your pins" button anywhere in the file, and no `testID="profile-view-food-history"`
  or `profile-view-food-lists` exists in the codebase (confirmed: zero grep hits for either
  string in `apps/mobile`). `apps/mobile/src/screens/__tests__/ProfileScreen.test.tsx` has no
  assertion for either button (confirmed: zero hits for "food-history"/"food-lists"/"View your
  food" in that file).
  - The real entry points: food history is reached via `CollectionScreen.tsx`'s "Open Food
    History Timeline" button (`testID="food-entry-button"`, navigates to `MyFoodHistory`,
    confirmed at `CollectionScreen.tsx` ~line 840). Food lists are reached via
    `CollectionScreen.tsx`'s "My Food Lists" card (`testID="food-lists-card"`, with
    "+ New"/"Discover"/"Saved"/"View all (N)" controls, confirmed ~lines 866-987).
    `CollectionScreen.test.tsx` explicitly asserts these cards are **absent** under the old
    Profile-tab framing (`expect(screen.queryByTestId('food-lists-card')).toBeNull()` for the
    wrong tab) — the real UI and its real tests both agree the home for these controls is
    `CollectionScreen`, not `ProfileScreen`.
  - This is confirmed, independently, by the already-merged `navigation-redesign` spec's own
    tasks.md task 10.1, which explicitly lists removing *"the 'View your stats,' 'View your food
    history,' 'View your food lists,' 'View your pins'/'My Showcase,' and 'View notifications'
    buttons/cards (relocated per Requirements 6 and 8)"* from `ProfileScreen.tsx` as part of that
    spec's own work — i.e. `navigation-redesign` is a later spec that structurally removed
    exactly the buttons `food-item-logging` task 10.4 and `food-lists` task 10.1 still describe
    adding there, and neither older spec's tasks.md was ever amended to reflect it.
- **Why HIGH:** this is not a new category of mistake — it is the literal, named incident this
  whole audit exists to find (per the prior audit's HIGH-1 and the user's original bug report
  "there is no profile on the bottom bar... you get there via the top right icon"), now found
  independently in **two more specs**, both still checked off `[x]` as done. A cold-start agent
  asked to add a similar "View your X" entry point by following either tasks.md's literal
  instruction would edit `ProfileScreen.tsx`, land on a screen whose own docstring says personal
  entry points were retired from it, and build something unreachable from the real tab bar.
- **Suggested fix:** amend both tasks.md files' task 10.4/10.1 (additive correction, per the
  "editing an existing spec" convention) to note the real destination is
  `CollectionScreen.tsx`'s "Food" tab/"My Food Lists" card (post-`navigation-redesign`), and
  point at `CollectionScreen.test.tsx`'s real `food-entry-button`/`food-lists-card` tests rather
  than `ProfileScreen.test.tsx`. Note this is a build-order quirk, not a broken implementation —
  both features were implemented correctly against the *contemporary* Profile-tab screen before
  `navigation-redesign` later relocated it; only the spec text was never updated to follow.

### HIGH-2: `festival-booth-tagging` task 12.4 claims Festival-chip component tests live in `DestinationScreen.layouts.test.tsx`, checked off `[x]`; that file has zero festival coverage, and the real UI lives in a different screen entirely

- **Claim:** `.kiro/specs/festival-booth-tagging/tasks.md` task 12.2: *"`DestinationScreen.tsx`'s
  `ThemeOrWaterParkLayout`: add a `selectedFestivals` state set, a 'FESTIVALS' Filters-modal
  section... (R8.9, R8.10, R8.11)."* Task 12.4: *"Component test extension
  (`apps/mobile/src/screens/catalog/__tests__/DestinationScreen.layouts.test.tsx`): Festival chip
  rendering per distinct tagged slug, selecting a chip narrows results while preserving Land
  grouping, no chip for an unobserved slug."*
- **Reality:** `DestinationScreen.tsx`'s own module docstring (confirmed by reading it, and
  independently flagged by the prior audit's MEDIUM-2) states it **no longer defines**
  `ThemeOrWaterParkLayout` — that dispatch now goes straight to `ParkDestinationScreen.tsx`
  (a different file), which is where the real `selectedFestivals` state, `toggleFestivalFilter`,
  and the "FESTIVALS" modal section (`testID="destination-modal-festivals-section"`) actually
  live (confirmed by reading `ParkDestinationScreen.tsx` lines ~273-880). `
  DestinationScreen.layouts.test.tsx` contains **zero** matches for "festival" anywhere in the
  file (confirmed by direct grep) — its own file header explicitly scopes its coverage to the
  Disney Springs layout only, since the theme/water-park layout it would have tested isn't in
  this file anymore. Meanwhile `ParkDestinationScreen.test.tsx` — the file that actually renders
  the Festival UI — has **zero** matches for a Festival **chip** test either (its only "Festival"
  hits are an unrelated fixture named "Festival of Fantasy Parade"); no test anywhere asserts
  `destination-modal-festivals-section`, a festival chip's selected/unselected state, or
  "no chip for an unobserved slug."
- **Why HIGH:** the checked-off task names a specific test file and specific assertions for a
  real, shipped, user-facing filter control (visible in `ParkDestinationScreen.tsx`'s Filters
  modal) — and that coverage does not exist anywhere in the codebase, in either the file the task
  names or the file that actually contains the feature. This is a "false-checked" task per this
  repo's own execution-discipline convention (a half-done task marked done), not merely a stale
  citation — the behavior described (chip rendering, narrowing, no-chip-for-unobserved-slug) is
  unverified in CI today.
- **Suggested fix:** retarget task 12.4 at `ParkDestinationScreen.test.tsx` (not
  `DestinationScreen.layouts.test.tsx`, which structurally cannot cover this — it has no
  `ThemeOrWaterParkLayout` to test) and leave the task unchecked until the three named assertions
  (festival chip rendering, selection narrowing while preserving Land grouping, omission for an
  unobserved slug) are actually added there.

---

## MEDIUM findings

### MEDIUM-1: `food-item-logging`/`food-lists` tasks correctly post-date `navigation-redesign` for *most* mobile wiring but still name the pre-redesign screen for two specific buttons (same root cause as HIGH-1, narrower blast radius)

Folded into HIGH-1 above — recorded separately only to note that the *rest* of both specs'
mobile tasks (task 10.2/10.3/10.5/10.6 in `food-item-logging`; the Collection-screen-targeting
tasks in `food-lists`, e.g. task 8's `FoodListDetailScreen`/`AddToListsSheet` work) correctly
target real, current files and were not affected — only the single "add a button to
`ProfileScreen.tsx`" instruction in each spec is stale. This confirms the drift is a precise,
narrow miss (one call site each) rather than a wholesale restatement of the pre-redesign
architecture.

### MEDIUM-2: `food-lists/design.md`'s "Discovery Cursor" section slightly overstates "no existing endpoint... paginates with a cursor"

- **Claim:** `.kiro/specs/food-lists/design.md`'s "Discovery Cursor" section: *"No existing
  endpoint in this codebase paginates with a cursor (existing lists like `listSentShares`/
  `listInbox` return everything unbounded), so this is new."*
- **Reality:** not independently falsified in this pass (a full repo-wide cursor-pagination
  sweep was out of scope per the brief's "do not read every file" instruction), but this claim is
  narrower than it reads: it is scoped to "existing *lists* like `listSentShares`/`listInbox`,"
  not a claim about every endpoint in the app, and nothing found during this audit (across all 6
  specs read) contradicts it for those two named lists specifically. Recorded as a LOW-confidence
  non-finding rather than a MEDIUM, since no counter-evidence was found — flagged only so a future
  auditor with broader scope knows this specific claim was not exhaustively checked.

(Downgraded to a note; not counted as a MEDIUM in the final tally below.)

### MEDIUM-3: `food-lists/design.md`'s `FoodListDetailDTO`/mobile "Role-aware" design section cites `FoodListDetailScreen.tsx` test coverage for item-row delete visibility by role; worth flagging for a maintainer to re-confirm given the volume of `food-lists` amendments

`food-lists`' tasks.md is long and heavily amended (pin/unpin, visibility badges, menu-item add
affordances, user-submitted-location search, etc. — tasks 1 through 25+). A full line-by-line
re-verification of every one of those amendments' claimed file/testID targets was not performed
in this pass (the brief scopes this audit to targeted verification, not exhaustive). The
pin/unpin-ordering and Collection-preview-row claims (`MAX_COLLECTION_PREVIEW_ROWS`,
`food-lists-view-all-row`, `food-lists-card`) were spot-checked and found accurate (see Confirmed
NOT drifted below); the remainder (e.g. `food-list-visibility-toggle-badge`, `food-list-options-menu-btn`,
`ManageFoodListSharesSheet.tsx`'s exact prop/row shape) were read in design.md but not individually
grepped against source in this pass. Recorded as a scope note, not a confirmed finding — flag to a
future auditor rather than treat as resolved.

(Not counted toward the HIGH/MEDIUM/LOW tally; a scope disclosure, not a drift finding.)

---

## LOW / NIT findings

### LOW-1: `festival-booth-tagging/design.md`'s `FestivalStatsDTO` section narrates its own prior mistake and correction inline, rather than being clean

Not a drift — the design.md **explicitly, correctly** documents (in its own text) that an earlier
draft wrongly pointed at `@dwt/shared`'s unused `StatsDTO`/`statsSchema` instead of the real
`StatsResponse` in `apps/api/src/services/stats/routes.ts`, and the real code today matches the
*corrected* text (confirmed: `festivals: FestivalStatsDTO` exists on the real `StatsResponse` in
both `apps/api/src/services/stats/routes.ts` and the mobile `apps/mobile/src/api/statsTypes.ts`
mirror). Recorded only as a nit because a cold-start reader must read past the "earlier draft was
wrong" narration to reach the authoritative current text — the file is accurate but not maximally
terse. No fix needed; this is the spec correctly self-documenting its own history per the
"editing an existing spec" convention.

### LOW-2: `notification-center/design.md`'s flagged "design consideration" (trip-invite `createdAt`) was resolved in the implementer's favor with no update to the flag

`design.md`'s "Design consideration flagged for review: trip-invite source timestamp" section
proposes adding an additive `createdAt` to `TripIncomingInviteDTO` and explicitly flags it for
reviewer sign-off, with a documented fallback if the reviewer disagrees. The real code took the
proposed (non-fallback) path — confirmed via `PendingRodeWithTagDTO.createdAt` and the "Additive
field on `TripIncomingInviteDTO`" section's shape existing in the design — but the "flagged for
review" framing is never marked resolved anywhere in the document. Zero behavioral risk (the
chosen path is the one implemented and the one documented in detail), but a cold-start reader
hits an open question that was, in fact, already closed. Low severity, cosmetic.

---

## Confirmed NOT drifted (checked and found accurate)

- **`experience-search-aliases`** — the entire spec is accurate end-to-end.
  `packages/shared/src/search/experienceAliases.ts` and `fuzzyDistance.ts` exist with exactly the
  described exports (`CURATED_EXPERIENCE_ALIASES`, `checkExperienceAliasMatch`,
  `damerauLevenshteinDistance`, `isFuzzyTokenMatch`), all re-exported from
  `packages/shared/src/index.ts`. `experienceSearch.ts`'s tier scoring (85/80/70/60/40/35/20)
  matches design.md verbatim, including the `alias_exact`/`alias_phrase`/`fuzzy` tiers. Both
  claimed consumers (`CatalogRepo.listActiveExperiences` backend; `ResortPicker.tsx`,
  `DestinationScreen.tsx`, `ParkDestinationScreen.tsx` mobile, all importing
  `filterAndRankExperiences` from `@dwt/shared`) exist and call it exactly as described.

- **`festival-booth-tagging`** — overwhelmingly accurate across a very large, heavily-amended
  spec (tasks through 20, three major amendments). Verified: migrations `0039_experience_festival_tags.sql`
  and `0055_festival_edition_and_dish_tags.sql` both exist; `FestivalStatsDTO`/`festivals` field
  threaded correctly into the real `StatsResponse` in both `apps/api/src/services/stats/routes.ts`
  and the mobile mirror `apps/mobile/src/api/statsTypes.ts`; `pins/evaluator.ts`'s
  `festivalTaggedCompletedIds` union logic matches design.md's Property 25 exactly;
  `ExperiencesDetailScreen.tsx`'s Festival Booths section (lifetime count + per-festival rows +
  empty state, `FESTIVAL_SLUG_LABELS`, no percentage) matches design.md's component sketch
  verbatim, with real test coverage in `ExperiencesDetailScreen.test.tsx`; `ExperienceDTO.festivalTag`
  exists in `packages/shared/src/dto/Experience.ts`; `experiencePickerFilters.ts`'s `festivalChips`/
  `selectedFestivals`/`filterExperiencesMulti` all exist and are property-tested
  (`experiencePickerFilters.prop.test.ts`); `qualifyingVisit.ts`/`qualifyingVisitQuery.ts` (task
  17's pure cores) exist exactly as the late-amendment tasks describe. The **one** real gap found
  is HIGH-2 above (the mobile UI itself — `ParkDestinationScreen.tsx`'s Festival filter chips — is
  real and correctly implemented; only its claimed *test file location* is wrong and the actual
  festival-chip-specific assertions are missing).

- **`food-item-logging`** — accurate apart from HIGH-1's single stale button-placement claim.
  Verified: migration `0040_food_item_logging.sql` exists with the described
  `user_submitted_locations`/`food_items`/`food_item_logs` shape; `MyFoodHistoryScreen.tsx` and
  `RestaurantFoodLogsSheet.tsx` both exist and are correctly registered — `MyFoodHistoryScreen` on
  `CollectionStackParamList` (not `RootStackParamList` as task 10.3 technically still says, though
  this is itself consistent with the broader post-`navigation-redesign` relocation already
  covered by HIGH-1 and not re-counted separately), `RestaurantFoodLogsSheet` wired into
  `ExperienceDetailScreen.tsx`'s "Dishes & Food" card exactly as task 10.6 describes.
  `deriveDisplayedFoodLogs`'s pure filter→search→sort pipeline exists in
  `apps/mobile/src/screens/catalog/foodHistoryFilters.ts` per task 10.1.

- **`food-lists`** — accurate apart from HIGH-1's single stale button-placement claim (task
  10.1) and the scope-limited MEDIUM-3 note above. Verified: `MyFoodListsScreen.tsx`'s real
  `handleBack` implements exactly the `canGoBack()`/`goBack()`/`navigate('MainTabs')` fallback
  task 15.1 describes; `createFoodListInputSchema` in `packages/shared/src/schemas/FoodList.ts`
  includes the optional `visibility` field exactly as the Requirement 1a amendment describes;
  `CollectionScreen.tsx`'s `MAX_COLLECTION_PREVIEW_ROWS` (confirmed `= 4` in source, matching
  design.md's Configuration & Constants table) and its pinned-first slice/`food-lists-card`/
  `food-lists-view-all-row` testIDs all match the amendment-8c/8d tasks and
  `CollectionScreen.test.tsx`'s real assertions exactly.

- **`friend-stats-viewing`** — fully accurate, no drift found. `services/friends/ownerOrFriend.ts`
  exists with the exact `assertOwnerOrFriend(pool, requesterId, targetId)` signature described;
  `apps/api/migrations/0003_note_shareable.sql` adds `notes.shareable BOOLEAN NOT NULL DEFAULT FALSE`
  exactly as design.md specifies; the new `services/tracking/friendCompletions/` module (`repo.ts`,
  `routes.ts`) exists with `GET /users/:userId/completions`, `listCompletions`, and the exact
  `JOIN experiences ... AND e.active = TRUE` / `LEFT JOIN ratings` / `LEFT JOIN notes` +
  `CASE WHEN n.shareable` query design.md describes, independently confirmed by a large battery of
  real property/integration tests (`completions.integration.test.ts`, `completionsOrdering.prop.test.ts`,
  `activeOnlyCompletions.prop.test.ts`, `readContractPreservation.prop.test.ts`, etc.) that exercise
  this exact SQL against pg-mem. `FriendsListScreen.tsx`'s `FriendRow` has the described `onPress`
  wired to `YouAndCrewStack`'s real `FriendProfile` route (confirmed in `YouAndCrewStack.tsx`,
  importing the real `FriendProfileScreen.tsx`).

- **`notification-center`** — fully accurate, no drift found, apart from LOW-2's cosmetic note.
  Migration `0017_rode_with_pending_read.sql` exists with the described partial index;
  `GET /me/rode-with-tags?state=pending` and `repo.listPendingRodeWithTags(userId)` exist exactly
  as described, scoped/filtered/ordered per Property 9, in `apps/api/src/services/trips/routes.ts`
  and `repo.ts`. The entire mobile pure/hook/presentation layering exists:
  `apps/mobile/src/features/notifications/` contains `useAttention.ts`, `useAttentionActions.ts`,
  `useAttentionBadge.ts`, `AttentionBadge.tsx`, `NotificationBell.tsx`, each matching design.md's
  described responsibilities, with real property tests
  (`useAttentionActions.optimisticRemoval.prop.test.ts`, `useAttentionActions.endpointMapping.prop.test.ts`,
  `useAttention.sessionGating.prop.test.ts`). `NotificationCenterScreen.tsx` is registered on
  `RootStackParamList` with `presentation: 'modal'` exactly as described. The one place design.md
  itself is imprecise — the Profile-tab-badge framing in Requirement 10 — turns out to be
  correctly implemented in spirit: `NotificationBell` (carrying `AttentionBadge`) is rendered in
  `HomeScreen.tsx`'s header (confirmed) rather than literally overlaid on a bottom "Profile" tab
  icon, which is consistent with — and explained by — the later `navigation-redesign` spec's own
  explicit amendment ("Header Decluttering": the bell now lives in the Home tab's header only,
  non-Home landing tabs omit it) that this spec's own tasks.md ends up implementing in task 14 and
  which `navigation-redesign` cross-references by name. This is a case of a later spec correctly
  evolving an earlier one, both now consistent with the real code — not a drift.

---

## Tally

- **HIGH:** 2 (HIGH-1: `food-item-logging`/`food-lists` both still naming `ProfileScreen.tsx` for
  a now-retired button, the direct recurrence of the seed incident; HIGH-2: `festival-booth-tagging`
  task 12.4 names a test file/location that cannot and does not cover the described Festival-chip
  behavior, leaving it genuinely untested despite being checked off)
- **MEDIUM:** 0 counted (one candidate downgraded to an unconfirmed note, one recorded as a scope
  disclosure rather than a finding — see MEDIUM-2/MEDIUM-3 above)
- **LOW/NIT:** 2 (LOW-1: `festival-booth-tagging` design.md's self-correcting narration is
  accurate but non-terse; LOW-2: `notification-center` design.md's "flagged for review" question
  was resolved but never marked closed)

Specs checked: `experience-search-aliases`, `festival-booth-tagging`, `food-item-logging`,
`food-lists`, `friend-stats-viewing`, `notification-center`.
