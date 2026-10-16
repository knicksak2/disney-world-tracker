# Documentation Drift & Orphaned Code Audit

Date: investigation performed against `develop` branch, workspace `c:\Users\knick\dev\disney-app`.
Scope: `.kiro/steering/*.md`, `AGENTS.md` (root + `.agents/`), `README.md`, `docs/*.md`, mobile
navigation structure, mobile/API orphaned-code sweep, and a spot-check of 10 specs.

## Summary — the headline finding

**The exact dark-mode incident is still live, in a different file.** `tech-conventions.md`'s
bottom-tabs line has already been fixed, but the *implementation* that caused it is itself
broken the same way: `dark-mode/design.md` and `dark-mode/tasks.md` both say the Appearance
toggle is inserted into `apps/mobile/src/screens/ProfileScreen.tsx`'s self-mode block. **It is
not there.** `ProfileScreen.tsx` has no `AppearancePreferenceControl` import and no Appearance
`Card`. The toggle actually lives in `YouAndCrewScreen.tsx`'s "Preferences & Security" section —
exactly the same "built it, but wired it into the post-`navigation-redesign` home, not the
pre-redesign screen the spec still describes" mistake tech-conventions.md's own bottom-tabs line
made. Six *other* test files in the repo already carry a one-line comment pointing this out
(`// ProfileScreen.tsx's default-exported screen is not registered as a route anywhere in the
navigator...`), so the drift was independently discovered and silently worked around at the test
level without the spec itself ever being corrected. See HIGH-1.

Beyond that, this audit found:
- **1 more HIGH** finding (the dark-mode spec/code mismatch above), of the same shape as the
  seed incident — spec says X, code does Y, and an agent reading only the spec would wire new
  work to the wrong screen.
- **5 MEDIUM** findings — stale-but-lower-blast-radius claims in specs and docs (two specs whose
  `design.md` still cites `CatalogStack`/`FriendsStack` and a `navigate('Catalog', ...)` call
  shape that no longer exists; a free-tier hosting doc whose Upstash/Neon numbers are
  out of date relative to each provider's current published plan; a pin-collection README claim
  that nothing in that folder is committed, when it has been on `develop` since Sep 11).
- **3 LOW/NIT** findings — wording/architecture-diagram staleness with no behavioral consequence.
- **No new orphaned screens** beyond the already-known `ProfileScreen.tsx` default export, and
  the retired Disney live modules are still correctly retired and still pinned by
  `retirement.smoke.test.ts` exactly as `tech-conventions.md` describes.

---

## HIGH findings

### HIGH-1: `dark-mode` spec says the Appearance toggle lives on `ProfileScreen.tsx`; it actually lives on `YouAndCrewScreen.tsx`

- **Claim:** `.kiro/specs/dark-mode/design.md` ("`apps/mobile/src/screens/ProfileScreen.tsx`
  (modified)" section) and `.kiro/specs/dark-mode/tasks.md` task 5.2 ("Insert a new titled `Card`
  rendering `<AppearancePreferenceControl />` into `apps/mobile/src/screens/ProfileScreen.tsx`'s
  self-mode block, between the existing Notifications and Account Security cards"). Task 5.5 also
  says to extend `ProfileScreen.test.tsx` to assert the Appearance card renders there.
- **Reality:**
  - `apps/mobile/src/screens/ProfileScreen.tsx` has no `AppearancePreferenceControl` import and
    renders no Appearance card (verified by reading the full file — it renders only the identity
    block, a Notifications card, an Account Security card, and the logout button).
  - `apps/mobile/src/screens/youAndCrew/YouAndCrewScreen.tsx` line 43 imports
    `AppearancePreferenceControl` and renders it (line ~437) inside its own "Preferences & Security"
    section, alongside `PushNotificationPreferenceControl` and `ChangePasswordControl`.
  - `apps/mobile/src/screens/__tests__/ProfileScreen.test.tsx` has **no** "Appearance" assertion at
    all (task 5.5 was never actually done against `ProfileScreen.test.tsx`), while
    `apps/mobile/src/screens/youAndCrew/__tests__/YouAndCrewScreen.test.tsx` carries the real test
    coverage and an explicit comment admitting the spec is stale: *"`YouAndCrewScreen.tsx` renders
    `AppearancePreferenceControl` directly in its 'Preferences & Security' section (the Appearance
    toggle's actual reachable home — `ProfileScreen.tsx`'s default-exported screen is not
    registered as a route anywhere in the navigator, only its `ProfileIdentityBlock` export is
    reused here)."* The identical comment, verbatim, is duplicated across at least 8 other test
    files (`navigation.test.tsx`, `navigationStructure.test.tsx`, `pinTabBadge.test.tsx`,
    `mainTabsStructure.test.tsx`, `friendsListConsolidation.test.tsx`,
    `friendSelectionNavigation.test.tsx`, `notificationNavigation.test.tsx`,
    `experienceDetailBackNavigation.fixedFlow.{integration,prop}.test.tsx`) — the engineers (or
    agents) writing those tests all independently hit and noted the same mismatch, but nobody
    went back and fixed `dark-mode/design.md`/`tasks.md`.
  - This is consistent with `ProfileIdentityBlock` being the only piece of `ProfileScreen.tsx`
    that's actually reachable (confirmed earlier in this investigation and by the user's original
    report): `ProfileScreen`'s default export is not registered on any navigator, so a toggle
    "inserted into `ProfileScreen.tsx`'s self-mode block" per the spec's literal instruction would
    build something unreachable — this is the dark-mode incident's root cause, recurring.
- **Why HIGH:** this is not a cosmetic citation error — it is the *same category of mistake* that
  triggered this whole audit (building/documenting something against a screen that isn't the real
  navigation entry point), sitting unfixed in the very spec whose implementation prompted the
  user's original question ("how do you change the app to dark mode?" / "why is a situation like
  this happening?"). A cold-start agent asked to extend the Appearance control (e.g. add a 4th
  option, or wire a new preference control next to it following "the existing pattern") would read
  `dark-mode/design.md`, go to `ProfileScreen.tsx`, and either silently fail to find the hook point
  described or add a duplicate/parallel control there that is unreachable.
- **Suggested fix:** amend `dark-mode/design.md`'s "`ProfileScreen.tsx` (modified)" section and
  `tasks.md` task 5.2/5.5 to say `YouAndCrewScreen.tsx`'s "Preferences & Security" section (not
  `ProfileScreen.tsx`), note that this placement happened because `navigation-redesign` (a later
  spec) relocated Profile's reachable settings surface before `dark-mode` shipped, and point at the
  real test file (`YouAndCrewScreen.test.tsx`) rather than `ProfileScreen.test.tsx`. This is a
  same-spec correction per the "editing an existing spec — additive by default" convention: add a
  corrective note rather than silently rewriting, since the requirement itself (R4.1, "present an
  Appearance control on `ProfileScreen.tsx`") is the thing that's now literally false and needs a
  superseding clause, mirroring how other specs in this repo record a superseded assumption inline
  (e.g. `friend-profile-navigation/requirements.md`'s "Superseded assumption" paragraph).

---

## MEDIUM findings

### MEDIUM-1: `experience-detail-navigation/design.md` describes a navigation shape that `experience-detail-back-navigation` (a later spec) replaced

- **Claim:** `.kiro/specs/experience-detail-navigation/design.md` states `ExperienceDetailScreen`
  "is registered in the Catalog tab's stack as `ExperienceDetail`" and that any tab dispatches
  `navigation.navigate('Catalog', { screen: 'ExperienceDetail', params: { experienceId } })`; its
  Architecture section's navigation-topology diagram shows `Catalog --> ED[ExperienceDetail]`
  nested under the Catalog tab, and its Impact table edits `CatalogStack.tsx`/`FriendsStack.tsx`.
- **Reality:** `ExperienceDetail` is registered on the **root stack** (`RootNavigator.tsx`'s
  `RootStackParamList`, sibling of `MainTabs`), not inside any tab's nested stack. `CatalogStack.tsx`
  and `FriendsStack.tsx` do not exist at all today (confirmed: `file_search` for both returns zero
  hits) — they were retired by `navigation-redesign` into `ExploreStack.tsx`/`YouAndCrewStack.tsx`.
  The real navigation call (`apps/mobile/src/screens/navigation/experienceNavigation.ts`'s
  `useOpenExperience`) dispatches `navigation.navigate('ExperienceDetail', { experienceId })`
  against a `NavigationProp<RootStackParamList>` directly — no `{ screen: 'Catalog', ... }` nesting
  at all.
- **Why MEDIUM not HIGH:** a sibling spec, `experience-detail-back-navigation/design.md`, already
  correctly documents the *current* real structure (root-level `ExperienceDetail`, no native
  header, in-screen back control) and explicitly describes itself as the fix for exactly this
  problem — so a reader who opens the back-navigation spec gets the right picture, and the actual
  code matches the back-navigation spec, not the original navigation spec. The risk is scoped to
  someone reading only `experience-detail-navigation/design.md` in isolation (e.g. "where does
  `CompletionRow` navigate to?") without also finding the superseding spec.
- **Suggested fix:** add a short superseding note at the top of
  `experience-detail-navigation/design.md`'s Architecture section pointing at
  `experience-detail-back-navigation` for the current real navigation topology, per the
  tech-conventions pattern (`disney-source-resilience` supersedes `disney-facilities-catalog-source`
  explicitly). No code change needed — this is a spec-only amendment.

### MEDIUM-2: `catalog-redesign/design.md`'s Testing Strategy still names deleted files as things to delete, and `DestinationScreen.layouts.test.tsx` was only partially cleaned up

- **Claim:** `catalog-redesign/tasks.md` task 9.2 and `design.md`'s "Migration from existing
  screens" section both say to delete `CatalogScreen.tsx`/`CatalogScreen.render.test.tsx` and
  `DestinationScreen.tsx`'s `ThemeOrWaterParkLayout`/`ResortsLayout` plus their "superseded test
  cases in `DestinationScreen.render.test.tsx`/`DestinationScreen.layouts.test.tsx`" in the same
  change.
- **Reality:** `CatalogScreen.tsx` is correctly deleted (confirmed, zero hits). `DestinationScreen.tsx`
  no longer defines a `ThemeOrWaterParkLayout` or `ResortsLayout` function — `renderBody` now
  unconditionally renders `DisneySpringsLayout` only, and the `themeOrWaterPark`/`resorts` kinds are
  dispatched *before* `renderBody` is reached, straight to `ParkDestinationScreen`/
  `ResortsDirectoryScreen` (confirmed by reading the file). **However** the file's own module
  docstring (lines ~34-40) still describes "The three Destination layouts... are dispatched by
  `renderBody`, which switches on `destination.kind` and renders the matching grouped/collapsible
  layout (`ThemeOrWaterParkLayout`, `DisneySpringsLayout`, `ResortsLayout`)" and a second comment
  block near line 647-654 repeats the same stale three-way description — both comments are dead
  code documentation for functions that no longer exist in this file. Additionally,
  `DestinationScreen.layouts.test.tsx` still exists and still contains its "Disney Springs layout"
  describe block (correctly, since that layout survives) but its file-level docstring still claims
  to cover "Theme / water park (Magic Kingdom)" and "Resorts" layout assertions that were visibly
  removed from the test body (the describe blocks for those two are gone, leaving only two
  trailing blank lines where they used to be) — so the test file's own header comment overstates
  its current coverage.
- **Why MEDIUM:** this doesn't point anyone at a wrong *file*, but it misdescribes what
  `DestinationScreen.tsx` actually does today, and a reader (or agent) extending
  `DestinationScreen.tsx` based on its own docstring would expect to find `ThemeOrWaterParkLayout`/
  `ResortsLayout` functions in the file and would not find them.
- **Suggested fix:** update `DestinationScreen.tsx`'s two stale comment blocks to say it now
  delegates `themeOrWaterPark`→`ParkDestinationScreen` and `resorts`→`ResortsDirectoryScreen`
  directly, and only renders `DisneySpringsLayout` itself; trim `DestinationScreen.layouts.test.tsx`'s
  header comment to describe only the Disney Springs coverage it actually contains.

### MEDIUM-3: `docs/hosting.md` and `README.md`'s free-tier numbers are stale against each provider's current published limits

- **Claim:** `docs/hosting.md` and `README.md` both state Upstash Redis free tier is "10,000
  commands per day," Neon free tier is "0.5 GB storage," and (hosting.md specifically) Neon's
  compute cap is "100 CU-hours per project per month (~400 hours at the default 0.25 CU)."
- **Reality (verified via web search against each provider's own current docs/blog, not an
  unofficial source):**
  - Upstash changed its Redis free tier from a 10K/day cap to **500,000 commands per month**
    ([Upstash's own pricing-change announcement](https://upstash.com/blog/redis-new-pricing),
    March 2025). The per-day framing in both docs is the superseded model.
  - Neon's free-plan storage was raised from 0.5 GB to **1 GB per project** (confirmed on
    [Neon's own changelog](https://neon.com/docs/changelog) and
    [blog post](https://neon.com/blog/neon-free-plan-1-gb-per-project)). The 100 CU-hour/month
    compute figure itself is still accurate per
    [Neon's current FAQ](https://neon.com/faqs/free-plan-limits-and-quotas) — only the storage
    number has drifted.
  - Render's free-tier facts stated in both docs (750 instance-hours/month, 15-minute idle sleep,
    30-60s cold start) are still accurate per
    [Render's own current docs](https://render.com/docs/free) and multiple 2025/2026 third-party
    confirmations — no drift found there.
- **Why MEDIUM not HIGH:** these are informational/planning docs, not steering files loaded into
  every agent session, and the inaccuracy is in the *conservative* direction (the docs understate
  the real free allowance) rather than something that would cause an agent to over-build and hit a
  limit it doesn't actually have. It could cause someone to unnecessarily avoid a feature (e.g. a
  cache strategy) believing the Upstash budget is tighter than it now is.
- **Suggested fix:** update both docs' Upstash line to "500,000 commands per month" and Neon's
  storage line to "1 GB per project," citing the current provider pages instead of the stale
  figures. The keep-alive-cron CU-hour-budget math in `hosting.md`'s "Keeping it warm for free"
  section is unaffected (it's about Render instance-hours, not Upstash/Neon), so no architecture
  conclusion in that doc actually depends on the stale numbers — only the numbers themselves need
  correcting. This is also informational-doc-only — `tech-conventions.md`'s own hosting-constraints
  section states the same two stale figures ("Upstash Redis ~10k commands/day", "Neon Postgres
  ~0.5 GB") and inherits this same drift, which raises its blast radius slightly since that file
  loads into every session — worth fixing there too even though its design conclusions ("avoid
  continuous polling," "keep stores bounded") remain correct advice regardless of the exact numbers.

### MEDIUM-4: `pin-collection/README.md` says "Nothing in this folder is committed yet," but it has been on `develop` since September 11

- **Claim:** `.kiro/specs/pin-collection/README.md`'s header: *"Nothing in this folder is
  committed yet. Until it is, all of it exists on one machine."*
- **Reality:** `git ls-files .kiro/specs/pin-collection` lists the README and every other file in
  the folder (mockups, `verify/run-all.js`, motifs, etc.) as tracked, and `git log` shows the
  README was last touched by commit `03dddb7` ("Finish pins/challenges"), dated **2026-09-11**,
  already on `origin/develop` (the current branch's remote-tracking commit `34722e4` is a
  descendant of it). The folder is not only committed, it has been pushed and is on the shared
  branch for some time.
- **Why MEDIUM not HIGH:** this doesn't cause an agent to build the wrong thing — if anything it
  understates confidence in work that is actually safe/shared — but it is read by every pin-related
  task per `pin-collection.md`'s routing, and a stale "this only exists on one machine, be careful"
  warning could cause unnecessary caution or confusion about whether changes are safe to make
  without a commit step.
- **Suggested fix:** remove or update the "Nothing in this folder is committed yet" sentence to
  reflect that the folder is tracked and on `develop` as of the v2 catalogue promotion.

### MEDIUM-5: `stats-experience-redesign/design.md` and `friend-profile-navigation` are not formally cross-referenced as supersession, though they clearly conflict on the Own_Stats_View shape

- **Claim:** `friend-profile-navigation/requirements.md` and its design describe an
  `Own_Stats_Selector` with four tabs (`Own_Overview`, `Own_Parks`, `Own_Categories`,
  `Own_Experiences`) built via a `useViewMode`/`TabSelector` pattern on `StatsScreen.tsx`.
- **Reality:** `stats-experience-redesign/design.md` (a later spec) explicitly states "The
  `useViewMode`/tab machinery is removed from the Own view (the hub + drill-in... replaces it)"
  and `stats-experience-redesign/tasks.md` task 8.1 confirms the rewrite "remove[d]... `useViewMode`/
  `OWN_STATS_MODES` usage." The real `StatsScreen.tsx` today is the Overview-hub design (hero ring +
  highlight cards navigating into `StatsStack` detail routes), not the four-tab selector
  `friend-profile-navigation` describes for the *Own* side. `friend-profile-navigation`'s Friend
  side (the `FriendProfileScreen.tsx`'s `TabSelector`/`useViewMode` with Overview/Coverage/
  Experiences/Compare modes) **is** still accurate — confirmed in `FriendProfileScreen.tsx`'s own
  imports and doc comments, which the `stats-experience-redesign` spec is also careful to call out
  as deliberately out of its scope ("Friend_Profile_View stays within `FriendsStack`" — note this
  mentions `FriendsStack`, which per MEDIUM-1/HIGH-1's finding no longer exists either, though the
  screen itself is now reached via `YouAndCrewStack` instead).
  `stats-experience-redesign/design.md` does cross-reference the situation informally in prose
  ("the hub + drill-in... replaces it") but there is no formal supersession note added to
  `friend-profile-navigation`'s own requirements/design files the way the repo's convention
  (`disney-source-resilience` supersedes `disney-facilities-catalog-source` explicitly, inside the
  *older* spec too) would call for.
- **Why MEDIUM:** the one-directional note (newer spec says what it replaces) exists and is
  correct; what's missing is the reciprocal note inside the *older*, now-partially-stale spec,
  which is what the tech-conventions.md editing convention asks for. Someone reading only
  `friend-profile-navigation` in isolation would believe the Own_Stats_View still has four tabs.
- **Suggested fix:** add a short "superseded by `stats-experience-redesign` for the Own_Stats_View
  shape; the Friend_Profile_View four-tab structure described here remains accurate" note to
  `friend-profile-navigation/requirements.md`'s Introduction, mirroring the pattern already used
  elsewhere in this repo.

---

## LOW / NIT findings

### LOW-1: `tech-conventions.md`'s hosting bullet repeats the stale Upstash/Neon numbers (see MEDIUM-3)

Already covered above — flagged separately here only because this file is injected into every
session (unlike `docs/hosting.md`), so even though the fix is identical, it is worth doing in
both places in the same change rather than only in `docs/hosting.md`.

### LOW-2: `friend-profile-navigation`'s own Friend-side description now cites a nonexistent `FriendsStack`

`friend-profile-navigation/design.md` states "`FriendProfileScreen` stays within `FriendsStack`."
`FriendsStack.tsx` was removed by `navigation-redesign` — the screen is now reached via
`YouAndCrewStack` (confirmed: `YouAndCrewStack.tsx` registers `FriendProfile` directly). The
*behavior* described (four-tab Friend view) is still accurate; only the stack name is stale. Low
severity because it's a file/module name inside prose, not a build instruction an agent would act
on literally without also finding `navigation-redesign`'s own, correct, superseding description.

### LOW-3: `catalog-navigation-redesign/design.md` is fully superseded by `catalog-redesign` with no cross-reference either direction

`catalog-navigation-redesign` describes the two-level `CatalogList`→`DestinationScreen` navigation
(no `ExploreHubScreen`, no `ParkDestinationScreen`, no `ResortsDirectoryScreen` — those are
`catalog-redesign`'s additions). `catalog-redesign/design.md`'s "Migration from existing screens"
section does walk through what it replaces, but it never names `catalog-navigation-redesign` by
spec name, and `catalog-navigation-redesign`'s own files carry no forward pointer at all. Low
severity because `catalog-redesign` is self-contained and accurate on its own — a reader doesn't
need the older spec to understand current code — but a reader who opens
`catalog-navigation-redesign` cold (e.g. searching for "Catalog_Home" or "Destination grid"
terminology, which it introduced and `catalog-redesign` still partially reuses, e.g.
`destinations.ts`/`catalogGrouping.ts`) has no signal that a newer spec changed the surrounding
screens substantially.

---

## Confirmed NOT drifted (checked and found accurate)

- **tech-conventions.md's `Live_Service`/`themeParksDirectory.resolveEntityId`/`wdwClock`/
  `permissions.ts` pointers** — all exist at the stated paths with the stated shapes
  (`apps/api/src/services/live/themeParksDirectory.ts`'s `resolveEntityId(enterpriseId)`,
  `apps/api/src/services/trips/wdwClock.ts`, `apps/api/src/services/trips/permissions.ts`).
- **The destination-children enumeration claim** in tech-conventions.md (resort-hotel
  restaurants/bars/lounges parented to the WDW destination, not any park) — verified against the
  real `themeParksDirectory.ts` source; the comment and code match exactly, including the specific
  named venues (Cove Bar, Sanaa Lounge, California Grill).
- **The empty `liveData: []` / `selectLiveEntry` behavior claim** — not independently re-verified
  against ThemeParks.wiki live (out of scope per the brief), but the referenced code
  (`themeParksLiveService.ts`, the `emptyFeed`/`permanentAbsence` test files) exists and matches
  the described shape.
- **Retired Disney live modules** (`catalog/disney/liveClient.ts`/`liveService.ts`) — both files
  still exist on disk (as the brief's steering text says they would, since retirement means "not
  wired," not "deleted"), `composeServices.ts` does not import either, and
  `retirement.smoke.test.ts` is present and its assertions (`not.toMatch(/createDisneyLiveClient/)`,
  live client wiring via `createThemeParksLiveClient`, Disney static egress wiring via
  `createFacilitiesClient`/`createDisneyTransport`) still match the real `composeServices.ts`
  content read in this investigation.
- **Mobile bottom tabs / `YouAndCrewScreen`/`ProfileScreen` claim** — the already-fixed line in
  tech-conventions.md matches `RootNavigator.tsx`, `YouAndCrewStack.tsx`, and `CollectionStack.tsx`
  exactly (Home/Explore/MagicFab/Trips/Collection tabs; `Collection`'s `tabBarLabel: 'Vault'`;
  `YouAndCrewStack` reached via `YouAndCrewMain`, not a tab).
- **`disney-source-resilience` supersedes `disney-facilities-catalog-source`** — formally and
  correctly cross-referenced in both directions (`disney-source-resilience/requirements.md`
  Requirement 13 enumerates exactly which requirements it supersedes).
- **`catalog-taxonomy-cleanup`'s three amendments** to `disney-facilities-catalog-source` (R17),
  `day-planning-optimization` (R3.19), and `experience-live-details` (R7.6/R7.7) — all three exist
  verbatim in the target specs' requirements files, additively, with no renumbering.
- **`admin-panel/design.md`** — `sampling_runs`/`push_delivery_log` tables, migration
  `0056_admin_panel.sql`, and `ADMIN_PANEL_USERNAME`/`ADMIN_PANEL_PASSWORD` config keys all exist
  exactly as described.
- **`experience-favorites`/`experience-lists` cross-references** — `tracking/favorite/repo.ts`
  exists with the exact described `FavoriteRepo` interface; `composeServices.ts`'s
  `resolveExperienceList` port matches `experience-lists/design.md`'s described shape.
- **AGENTS.md (root) vs `.agents/AGENTS.md`** — the two have not diverged; `.agents/AGENTS.md` is
  a one-paragraph pointer to the root file and makes no independent claims that could drift.
- **README.md's repository layout, scripts table, and Disney/ThemeParks.wiki source-split
  narrative** — spot-checked against `package.json` scripts and `apps/api`/`apps/mobile` structure
  with no discrepancy found.
- **`disney-facilities-catalog-source`/`disney-source-resilience`'s own internal claims** (image
  pipeline retirement, `image_attribution` column drop, Bridge_Map/migration-completeness logic) —
  all independently confirmed by reading `retirement.smoke.test.ts`'s real, passing-shaped
  assertions against the real `migrations/0004_disney_sources.sql` and `composeServices.ts`.
- **Orphaned-code sweep** — every screen file under `apps/mobile/src/screens/**` that ends in
  `Screen.tsx` is reachable from some `component={...}` registration in
  `apps/mobile/src/navigation/*.tsx` **except** the already-known `ProfileScreen.tsx` (whose
  default export is unregistered; only its `ProfileIdentityBlock` named export is reused). No
  second orphaned screen was found. On the API side, every service built in `composeServices.ts`
  is wired into `buildServer`'s options object; the two Disney live modules are the one
  deliberate, documented exception, consistent with the steering's own description.

---

## Prioritized action list

**Fix immediately (both are agent-session-wide or feature-defining risk):**
1. **HIGH-1** — correct `dark-mode/design.md`/`tasks.md`'s `ProfileScreen.tsx` placement claim to
   `YouAndCrewScreen.tsx`. This is the direct recurrence of the seed incident and the single
   highest-value fix in this report.
2. **MEDIUM-1** — add the superseding cross-reference from `experience-detail-navigation` to
   `experience-detail-back-navigation` so a reader doesn't get the stale `CatalogStack`/
   `navigate('Catalog', {...})` picture from the older spec alone.

**Add a 'supersedes'/deprecation note (per the tech-conventions editing rule) rather than leaving
silently stale:**
- `friend-profile-navigation/requirements.md` — needs a note that `stats-experience-redesign`
  superseded the Own_Stats_View's four-tab shape (MEDIUM-5), and that `FriendsStack` was retired by
  `navigation-redesign` even though the Friend-side four-tab behavior itself remains accurate
  (LOW-2 folds into the same edit).
- `experience-detail-navigation/design.md` — the cross-reference from action item 2 above doubles
  as this spec's required supersession note.
- `catalog-navigation-redesign` — optional/lower priority (LOW-3): a one-line "superseded by
  `catalog-redesign` for the Explore Hub / Park Destination / Resorts Directory screens" note would
  close the loop, but no agent risk currently stems from its absence since `catalog-redesign` is
  self-contained.

**Lower priority, batchable with any nearby edit:**
- MEDIUM-2 (`DestinationScreen.tsx`'s two stale internal doc comments + `DestinationScreen.layouts
  .test.tsx`'s overstated header comment) — pure code-comment hygiene, zero behavioral risk, but
  cheap to fix the next time that file is touched.
- MEDIUM-3 / LOW-1 (Upstash 10K/day → 500K/month, Neon 0.5 GB → 1 GB) — fix in `docs/hosting.md`,
  `README.md`, and `tech-conventions.md` together in one pass since all three repeat the same two
  numbers.
- MEDIUM-4 (`pin-collection/README.md`'s "nothing committed yet") — one-sentence removal, no spec
  format implications since this is a README, not a spec requirements/design file.

No HIGH finding in this report requires a code change — every one is a documentation-only fix,
consistent with this being a read-only investigation. I did not re-run `npm run verify` or any
build, per the brief's instruction; nothing above required executing code to confirm, since every
claim was checked by reading the real source files directly (`ProfileScreen.tsx`,
`YouAndCrewScreen.tsx`, `RootNavigator.tsx`, `DestinationScreen.tsx`, `composeServices.ts`,
`themeParksDirectory.ts`, `retirement.smoke.test.ts`, the relevant migrations, and the relevant
test files), plus two targeted web searches to verify the Upstash/Neon free-tier numbers against
each provider's own current published pages.
