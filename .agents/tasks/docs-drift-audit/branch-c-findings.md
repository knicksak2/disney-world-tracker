# Documentation Drift Audit — Branch C (Spec Subset)

Methodology and severity rubric (HIGH/MEDIUM/LOW-NIT) follow the prior audit at
`.agents/tasks/docs-drift-audit/findings.md`. Read-only investigation; no source or spec files
were modified, and no build/verify was run.

**Scope:** `password-reset`, `pin-collection`, `planned-list-completion-sync`,
`resort-tracking-and-stats`, `restaurant-menu-display`. Each spec's `requirements.md`,
`design.md`, and `tasks.md` were read in full; concrete claims (file paths, function/service
names, navigation routes, DB columns, "reuse existing X" pointers, cross-spec/supersession
claims) were checked against the real source.

---

## pin-collection

### HIGH-1: `design.md`/`requirements.md`'s claimable-Pin badge architecture (Requirement 22.3–22.6) is entirely superseded by `navigation-redesign`, with no cross-reference in either direction

- **Claim:** `pin-collection/design.md`'s "Claimable-Pin Discoverability" section (and
  `requirements.md` R22.3–22.6) describes: a `useClaimablePinsBadge()` hook; `RootNavigator.tsx`'s
  `ProfileTabIcon` combining `useAttentionBadge()` + `useClaimablePinsBadge()` into one
  `AttentionBadge` rendered at `testID="profile-tab-badge"` on the **Profile tab icon**; and a
  "View your pins" entry control on `ProfileScreen.tsx` carrying the same badge via the existing
  `notificationBtnWrap`/`notificationBadgeOverlay` pattern already used for a "View notifications"
  control. `tasks.md` task 12.4/12.9 and their completion notes repeat the same architecture
  verbatim, including the `profile-tab-badge` testID and the `ProfileScreen.tsx` "Pin collection"
  card wrapping a `SecondaryButton`.
- **Reality:**
  - There is no Profile tab in the current navigation at all. `RootNavigator.tsx`'s `MainTabParamList`
    is `Home | Explore | Trips | Collection` (confirmed by reading the file) — no `Profile` tab, no
    `ProfileTabIcon` component (`grep` for `ProfileTabIcon` finds zero hits anywhere in
    `apps/mobile/src`), and no `useAttentionBadge()` call anywhere in `RootNavigator.tsx`.
  - The claimable-pin badge is **not** on any tab icon. It lives on `CollectionScreen.tsx`
    (`apps/mobile/src/screens/collection/CollectionScreen.tsx`) as a "Ready to Claim" banner
    (`testID="claim-banner"`) with a `claimable-pins-badge` text anchor, inside the Collection/Vault
    tab's landing screen — not a badge overlay on a tab-bar icon.
  - The Collection tab itself carries a React Navigation native `tabBarBadge` showing
    `claimableCount` (confirmed in `RootNavigator.tsx`'s `MainTabs.Screen name="Collection"`),
    which directly contradicts the design's explicit claim that *"No `tabBarBadge` (React
    Navigation's built-in prop) is used, consistent with the existing hand-rolled overlay
    approach."*
  - `ProfileScreen.tsx` (read in full) has no "Pin collection" card, no "View your pins" button, and
    no badge of any kind — it is trimmed to the identity block only (confirmed also by the prior
    audit's HIGH-1 finding about this same file). The actual "View your pins" surfacing is the
    Collection tab banner above, with its own `claim-pins-button`/`claimable-pins-badge` testIDs —
    different component, different testID naming, different screen.
  - This is a real, shipped repo pattern already acknowledged in the mobile test suite:
    `pinTabBadge.test.tsx`'s own doc comment and assertions explicitly say *"Bottom tab bar no
    longer carries profile-tab-badge"* and assert `screen.queryAllByTestId('profile-tab-badge')`
    has length 0, then re-targets its remaining assertions at `CollectionScreen`'s
    `claimable-pins-badge` anchor instead. `profilePinBadge.test.tsx` likewise now tests
    `CollectionScreen`, not `ProfileScreen`, despite the file name.
  - `navigation-redesign/requirements.md` Requirement 6 is the source of the actual current
    behavior: "the Collection/Vault landing screen SHALL present the display label 'Vault' in the
    bottom tab bar, displaying an unread badge indicating the claimable-pin count" (R6.5) and the
    "gold claim banner with a direct claim action navigating to PinBoardScreen with
    `celebratePinIds`" (R6.7a) — this is exactly what the real `CollectionScreen.tsx`/
    `RootNavigator.tsx` implement. `navigation-redesign/requirements.md` even names
    `pin-collection` as a spec it "builds on top of ... and reuses their vocabulary and services
    unchanged," but neither direction records that `navigation-redesign` *replaced* the Requirement
    22.3–22.6 badge architecture — `pin-collection`'s own files still describe the old, dead
    architecture as current, unflagged.
- **Why HIGH:** this is the same class of mistake as the seed `dark-mode` incident the originating
  audit was triggered by — a spec describing a hook point / component / testID that does not exist
  in the real navigator, with no superseding note. A cold-start agent asked to "add a third badge
  domain next to notifications and pins" or "fix the Profile tab badge" would read
  `pin-collection/design.md`, go looking for `RootNavigator.tsx`'s `ProfileTabIcon` and a
  `ProfileScreen.tsx` "Pin collection" card, and find neither — exactly the scenario the prior
  audit's HIGH-1 flagged for `dark-mode`.
- **Suggested fix:** add a superseding note to `pin-collection/requirements.md` R22.5/R22.6 and
  `design.md`'s "Claimable-Pin Discoverability" section pointing at `navigation-redesign`
  Requirement 6 (R6.5, R6.7a) for the current real badge/banner location (`CollectionScreen.tsx`'s
  claim banner + the Collection tab's native `tabBarBadge`), noting the `ProfileTabIcon`/
  `profile-tab-badge`/"View your pins" architecture was retired by that spec's tab redesign. Per
  the "editing an existing spec — additive by default" convention, this is a corrective note, not
  a rewrite.

### Confirmed NOT drifted (pin-collection)

- **`PinBoardScreen.tsx`/`isReadyToClaim`/`useClaimablePinsBadge` core mechanics** — the hook itself
  (`apps/mobile/src/components/pins/useClaimablePinsBadge.ts`), its `pinBoardKey`-sharing with
  `PinBoardScreen.tsx`, and the `isReadyToClaim` export all exist and match the design exactly;
  only the *consumer* (where the badge is rendered) has drifted, not the hook's own contract.
- **`CollectionStack.tsx` registering `PinBoard`/`PinAttribution`/`PinShowcase`** — matches
  `design.md`'s "Mobile Structure" section (moved from `ProfileStack`, as the stack's own doc
  comment states).
- **Backend award-wiring (Requirement 20/21), `PinRepo.claimPin`/`reconcileAll`,
  `POST /me/pins/:pinId/claim`, `POST/HEAD /internal/pins/reconcile`** — not independently
  re-verified line-by-line in this pass (out of the HIGH-1 investigation path), but no claim about
  these surfaced a navigation/file-path contradiction during the exploration above, and the prior
  audit's "no new orphaned screens" sweep already covers the mobile Pin screens as reachable.
- **`pin-roster-v2.html` as the authoritative roster, `PINS` catalog in
  `packages/shared/src/pins/catalog.ts`** — both files exist exactly as `tasks.md`/`design.md`
  describe (`pin-roster-v2.html` under the spec folder, `catalog.ts` exporting `PINS`).
- **Migration file names / `apps/api/migrations/0035_pins_and_challenges.sql`** — not
  re-verified against the live DB in this pass, but no contradicting claim was found elsewhere.

---

## password-reset

### MEDIUM-1: `tasks.md` task 1.2 names `packages/shared/src/schemas/auth.ts` and `dto/auth.ts`; the real files are `schemas/User.ts` and `dto/User.ts`

- **Claim:** `password-reset/tasks.md` task 1.2: *"Define `forgotPasswordInputSchema`,
  `resetPasswordInputSchema`, and associated DTO types in `packages/shared/src/schemas/auth.ts`
  and `packages/shared/src/dto/auth.ts`."*
- **Reality:** Neither `packages/shared/src/schemas/auth.ts` nor `packages/shared/src/dto/auth.ts`
  exists (confirmed: no such files in either directory's listing). `forgotPasswordInputSchema`,
  `resetPasswordInputSchema`, and `webResetPasswordInputSchema` are defined in
  `packages/shared/src/schemas/User.ts` (lines ~85-120, confirmed by reading the file and by
  `packages/shared/src/schemas/index.ts`'s re-export list). `ForgotPasswordResponseDTO` and
  `ResetPasswordSuccessDTO` are defined in `packages/shared/src/dto/User.ts` (confirmed via
  `packages/shared/src/dto/index.ts`'s re-export list and by reading the file directly). The
  `AppError`/`ErrorCode` claim in task 1.1 ("`packages/shared/src/errors/codes.ts`") is also
  off — there is no `errors/` subdirectory in `packages/shared/src`; the `ERROR_CODES` tuple and
  `invalid_code`/`too_many_attempts`/`token_invalid` live directly in
  `packages/shared/src/errors.ts` (a single file, not a directory).
- **Why MEDIUM not HIGH:** the schema/DTO/error-code *names* and *behavior* (`forgotPasswordInputSchema`,
  the three error codes, their HTTP status mappings, the `ForgotPasswordResponseDTO`/
  `ResetPasswordSuccessDTO` shapes) are all exactly as the design describes and fully implemented
  and tested — only the *file path* within `packages/shared/src` is wrong, so an agent would find
  the real code one directory listing away rather than being pointed at a nonexistent module
  entirely. The actual implementation co-located everything into the pre-existing `User.ts`/
  `errors.ts` files rather than creating new `auth.ts`/`codes.ts`/`errors/` files, which is a
  reasonable repo convention (grouping by domain-entity file) that the plan predates.
- **Suggested fix:** update `tasks.md` task 1.1/1.2 to say `packages/shared/src/errors.ts` (not
  `errors/codes.ts`) and `packages/shared/src/schemas/User.ts` / `packages/shared/src/dto/User.ts`
  (not `schemas/auth.ts` / `dto/auth.ts`).

### Confirmed NOT drifted (password-reset)

- **`AuthStackParamList` gains `ForgotPassword`/`ResetPassword`** (R5.1, R5.2; design's Mobile
  Screens section) — confirmed exactly in `RootNavigator.tsx`: `ForgotPassword: { email?: string |
  undefined } | undefined` and `ResetPassword: { email: string }` on `AuthStackParamList`, both
  screens registered on `AuthStackNavigator`.
- **`LoginScreen.tsx`'s "Forgot password?" button** — confirmed: `testID="login-forgot-password"`,
  navigates to `'ForgotPassword'` with `{ email: email.trim() }` when non-empty, matching R5.1/R5.2
  exactly.
- **`ForgotPasswordScreen.tsx`/`ResetPasswordScreen.tsx`** — both exist at the stated paths and
  implement the described email input / 6-digit code input / password+confirm / 60s cooldown timer
  / session storage via `useSessionStore().setToken` exactly as `tasks.md` 5.3-5.5 and
  `design.md`'s Mobile Screens section describe.
- **`password_reset_tokens` migration `0059`** — the real
  `apps/api/migrations/0059_password_reset_tokens.sql` matches the design's SQL verbatim: same
  columns, same `ON DELETE CASCADE`, same indexes (plus an additional `attempts >= 0` CHECK
  constraint not mentioned in the design, which is a strictly additive safety improvement, not a
  drift).
- **`PasswordResetRepo`** (`apps/api/src/services/auth/passwordResetRepo.ts`) — the real interface
  (`findUserByEmail`, `createResetRecord`, `findActiveByEmail`, `findActiveByToken`,
  `incrementAttempts`, `invalidateRecord`, `completeReset`) is a faithful (if differently named —
  e.g. `createResetRecord` vs. the design's sketch `createToken`) implementation of the same
  responsibilities described in `design.md`'s "Components and Interfaces" section 3; the design's
  interface sketch there is explicitly a sketch, not verbatim-matched code, and the real file's
  doc comment correctly cites "Requirements 1.2, 1.6, 2.1, 2.2, 2.3, 2.4, 2.6, 3.3."
- **`mailService.ts`** — Resend/SMTP/mock three-way branching, `MAIL_FROM` default, Gmail
  App-Password auto-detection — all present and match `design.md`'s Configuration & Constants table
  and Requirement 4 exactly.
- **HTTP endpoints** (`POST /auth/forgot-password`, `POST /auth/reset-password`,
  `GET /auth/reset-password`, `POST /auth/reset-password-web`) — all four registered in
  `apps/api/src/services/auth/routes.ts` exactly as `design.md` section 4 describes, including the
  anti-enumeration 200-always behavior and the `loginRateLimitConfig()` rate-limit attachment
  (5 attempts / 15 minutes, matching the design's Configuration table's
  `PASSWORD_RESET_MAX_ATTEMPTS=5` / 15-minute window, confirmed in `plugins/rateLimit.ts`'s
  `DEFAULT_LOGIN_ACCOUNT = { max: 5, timeWindowMs: 15 * 60_000 }`).
- **Error codes `invalid_code`/`too_many_attempts`/`token_invalid`** — present in
  `packages/shared/src/errors.ts`'s `ERROR_CODES` tuple with the exact HTTP mappings
  (400/429/400) the design's Error Handling section specifies.

---

## planned-list-completion-sync

No drift found. Every concrete claim checked resolved exactly as described:

- **No new migration/table/column/endpoint** — confirmed; the feature is purely additive to
  `TripSummaryDTO` and a new pure shared module, with no new route registered in
  `apps/api/src/services/trips/routes.ts` beyond the existing four endpoints the design names.
- **`packages/shared/src/plannedCompletion.ts`** — exists exactly as designed:
  `completedExperienceIdsFromFeed`, `derivePlannedListPresentation`, `derivePlannedCounts`, and the
  `PlannedItemCompletionState`/`PlannedItemView`/`PlannedListProgress`/`PlannedListPresentation`
  types all present with matching signatures.
- **`packages/shared/src/trips.ts`'s `TripSummaryDTO`** — gained exactly the two additive fields
  `plannedTotalCount`/`plannedCompletedCount` as designed, at the top-level shared `trips.ts` file
  the design names (not a `dto/` subpath — this spec's design correctly names the real file).
- **`apps/api/src/services/trips/summary.ts`'s `deriveTripSummary`** — extended with
  `plannedItems` input and `plannedTotalCount`/`plannedCompletedCount` output, reusing
  `derivePlannedCounts` imported from `@dwt/shared` exactly as the design specifies (confirmed by
  reading the import and the call site).
- **`apps/api/src/services/trips/repo.ts`'s `getSummary`** — reads
  `SELECT experience_id FROM planned_items WHERE trip_id = $1` inside the existing `Promise.all`
  exactly as designed, with an inline comment citing the same requirement numbers
  (R5.1, R5.2, R5.3) the design and requirements docs use.
- **Mobile `TripPlannedListScreen.tsx`** — imports and uses
  `completedExperienceIdsFromFeed`/`derivePlannedListPresentation` from `@dwt/shared`, renders the
  `Done_Section`/progress/log-control exactly as `design.md`'s "Client" section and `tasks.md` task
  4.1 describe, including the `openLogComposer` pre-fill flow and the `completionAvailable` guard
  comment referencing R2.7 verbatim.

## Confirmed NOT drifted (planned-list-completion-sync)

The entire spec — requirements, design, and tasks — is accurate against the current codebase.

---

## resort-tracking-and-stats

### MEDIUM-2: `design.md`/`tasks.md`'s "By Area" mobile presentation (`Own_Areas` mode, `OwnAreasPane`, a Resorts-as-area-card UI) was fully replaced by `stats-experience-redesign` (a later spec), leaving a dead UI description with no cross-reference

- **Claim:** `resort-tracking-and-stats/design.md`'s "Mobile" section (and its own "Resort
  presentation (supersedes the earlier...)" revision note) describes: an `Own_Stats_View` mode
  `Own_Areas` added to `OwnStatsViewMode`; an "Areas" tab added to `OWN_STATS_TABS` in
  `TabSelector.tsx`; a new `OwnAreasPane` component mounted in `StatsScreen.tsx` rendering a single
  "By Area" list of collapsible Group_Sections (one per Park-like Area_Type, plus Resorts as a
  fourth area card). `tasks.md` task 9.3/9.4 give the identical implementation instructions and
  mark both `[x]` complete.
- **Reality:**
  - `OWN_STATS_TABS` (confirmed in `apps/mobile/src/screens/navigation/TabSelector.tsx`) does
    contain an `Own_Areas` entry with `icon: 'business-outline'` and `label: 'Areas'` — this part
    was genuinely built. However, `OWN_STATS_TABS` and the whole `useViewMode`/tab-selector
    machinery it belongs to is **dead code as far as the Own_Stats_View is concerned**: a `grep`
    for `OWN_STATS_TABS` usage finds it defined and tested in isolation
    (`TabSelector.test.tsx`), but **no file imports it as a consumer** — `StatsScreen.tsx` does
    not reference `OWN_STATS_TABS`, `TabSelector`, `OwnStatsViewMode`, or any `OwnAreasPane`
    (confirmed: zero hits for any of those identifiers in `apps/mobile/src/screens/stats/`).
  - `StatsScreen.tsx`'s own doc comment states plainly: *"StatsScreen — the Overview hub
    (stats-experience-redesign task 8.1)... remove the inline flat `StatsResponse`/
    `StatsBreakdown`, `byParkAndCategory`, and `useViewMode`/`OWN_STATS_MODES` usage"* — this is
    `stats-experience-redesign/design.md`'s own documented rewrite (its production-code table says
    the same, verbatim: *"drop `useViewMode`/`OWN_STATS_MODES` usage"*). `stats-experience-redesign`
    is a **later spec** that completely replaced the tabbed `Own_Stats_View` with an "Overview
    hub + drill-in detail screens" architecture (`StatsStack.tsx`, `CoverageDetailScreen.tsx`, etc.)
    — the exact same supersession pattern the prior audit's MEDIUM-5 already flagged for
    `friend-profile-navigation`'s Own-side tabs.
  - The real presentation of Area_Type/Resort data today is `CoverageDetailScreen.tsx`'s
    `Lens_Switcher` with an `'areas'` lens (confirmed: `CoverageSection.tsx`'s `case 'areas':`
    renders `rankAreaRows(coverage.byAreaType)` plus a separate "Resort areas" list) and a
    **separate `'resorts'` lens** rendering a distinct "Hotels visited" row
    (`coverage.resort`) and a "What you've done at each resort" per-resort breakdown
    (`coverage.byResort`) — a materially different structure from the design's "Resorts folds into
    the Areas list as a 4th area card" decision. The backend `byAreaType`/`resort` fields this
    spec added are still the data source (confirmed: `apps/mobile/src/api/statsTypes.ts` imports
    `AreaType` from `@dwt/shared` and types `byAreaType`), so the **backend half of this spec is
    unaffected and accurate** — only the mobile presentation layer the design/tasks describe is
    stale.
  - `resort-tracking-and-stats/design.md`/`tasks.md` carry no mention of `stats-experience-redesign`
    anywhere, and `stats-experience-redesign`'s own design doc, while it extensively describes the
    new `CoverageDetailScreen`'s Areas/Resorts lenses, does not name `resort-tracking-and-stats` as
    the spec whose mobile UI it is replacing.
- **Why MEDIUM not HIGH:** unlike the pin-collection HIGH-1 above, the stale UI description here
  does not point at a nonexistent file/component for the *backend* half of the feature (byAreaType/
  resort breakdown data, the migration, the sync wiring) — all of that is accurate and current.
  Only the specific mobile component names (`OwnAreasPane`, mounting into the old `StatsScreen`
  tab-selector) are gone; the underlying User-facing capability (seeing Area_Type and resort
  progress) still exists today, just via a different, newer screen (`CoverageDetailScreen`'s lens
  switcher) that happens to satisfy the same requirements (R5.1-R5.5) through a different UI shape.
  An agent extending "the Areas pane" would still land in the right conceptual territory
  (`CoverageDetailScreen.tsx`) once they searched for `byAreaType`'s mobile consumer, but would be
  confused by the specific named components (`OwnAreasPane`, `Own_Areas` mode as an active render
  path) not existing as live code.
- **Suggested fix:** add a supersession note to `resort-tracking-and-stats/design.md`'s "Mobile"
  section and `tasks.md` task 9.3/9.4 pointing at `stats-experience-redesign`'s
  `CoverageDetailScreen.tsx` Areas/Resorts lenses as the current real mobile presentation, noting
  that `OWN_STATS_TABS`'s `Own_Areas` entry and the originally-built `OwnAreasPane` were retired by
  that later spec's Overview-hub rewrite, while the backend `byAreaType`/`resort` contract this spec
  defines remains the data source unchanged.

### Confirmed NOT drifted (resort-tracking-and-stats, backend)

- **Migration `0009_resort_representing_experiences.sql`** — matches the design's SQL verbatim
  (`represents_resort_id` column, both indexes).
- **`derivePlannedCounts`-style stats plumbing**: `StatsCell`/`area_type`/
  `is_resort_representation`, `byAreaType`/`resort` on `StatsResponse`, and the
  `CompletionEntryDTO.areaType`/nullable `park` DTO change — all confirmed present via the mobile
  `statsTypes.ts` import of `AreaType` and `byAreaType` typing; not contradicted anywhere in this
  pass.
- **`packages/shared`'s `AREA_TYPES`/`AreaType`** reuse claim — confirmed imported and used as
  described.

---

## restaurant-menu-display

No drift found. Every concrete claim checked resolved exactly as described:

- **`composeServices.ts` wiring** — `createMenuRetrieval` is imported and constructed, and
  `getMenusFor: (id) => menuRetrieval.getMenuForRestaurant(id)` replaces the plain cache read,
  exactly as `design.md`'s "Backend wiring decision" and `tasks.md` task 1.1 describe.
  `menuRetrieval` is also passed into another service's options (`menuRetrieval` appears a second
  time around line 860), which is consistent with "the same shared instance," not a second
  construction.
- **Category gate** (`apps/api/src/services/catalog/routes.ts`) — the detail handler's
  `options.getMenusFor && experience.category === 'Restaurant' ? await
  options.getMenusFor(experienceId) : []` matches the design's sketch and `tasks.md` task 2.1
  exactly, with a code comment citing R1.4 verbatim.
- **`experiences.dining_url` migration `0044`** — exists at the exact path named, and the route's
  `toDetailResponse` attaches `diningUrl` only under the `category === 'Restaurant' &&
  diningUrl present` condition, matching R6.5-R6.7 and the design's section 12 exactly.
- **Mobile `MenuScreen.tsx`/`MenuSummaryCard`** — both exist at the designed paths; `MenuScreen.tsx`
  reads the cached `['experience', experienceId]` query, renders a `GradientHeader` with
  `onBack`, and (per the later Requirement 5.10 amendment) renders a header "Add to List" button
  opening `FoodItemPickerModal` and per-item "Add to List" buttons opening `AddToListsSheet` —
  fully implemented and tested (`MenuScreen.foodListAffordances.test.tsx`), even though `tasks.md`
  tasks 13.1/13.2 are still marked `[ ]` unchecked.

### LOW-NIT: `tasks.md` tasks 13.1/13.2 (Menu Screen Food List Affordances, R5.10) are marked incomplete (`[ ]`) but are fully implemented and tested in the real codebase

- **Claim:** `restaurant-menu-display/tasks.md` task 13 ("Menu Screen Food List Affordances")
  and its sub-tasks 13.1 ("Add item-level and header add-to-list actions to `MenuScreen.tsx`,
  opening `AddToListsSheet` and `FoodItemPickerModal`") and 13.2 ("Add interaction tests...") are
  both unchecked.
- **Reality:** `MenuScreen.tsx` already imports and renders `FoodItemPickerModal` (header "Add to
  List" button, `testID="menu-screen-add-to-list-btn"`, opening the picker in `mode="addToLists"`)
  and `AddToListsSheet` (per-item add buttons, e.g. `testID="menu-item-add-to-list-0-0-0"`), and a
  dedicated test file `MenuScreen.foodListAffordances.test.tsx` exercises both the header action
  and the item-level action end-to-end (asserting the picker/sheet open and show the correct
  content). This is the inverse of a code/doc mismatch — the code and tests are ahead of the task
  tracker, not behind it.
- **Why LOW:** this is a task-completion bookkeeping staleness, not a factual claim about the
  system that would mislead an agent about where code lives or how it behaves; if anything, an
  agent would be pleasantly surprised the work was already done. No corrective "fix the system"
  action is needed, only ticking the boxes.
- **Suggested fix:** mark `tasks.md` tasks 13, 13.1, and 13.2 as `[x]` complete, since the
  implementation and its tests already exist and were confirmed by reading both files.

---

## Summary

| Spec | HIGH | MEDIUM | LOW/NIT |
|---|---|---|---|
| password-reset | 0 | 1 | 0 |
| pin-collection | 1 | 0 | 0 |
| planned-list-completion-sync | 0 | 0 | 0 |
| resort-tracking-and-stats | 0 | 1 | 0 |
| restaurant-menu-display | 0 | 0 | 1 |
| **Total** | **1** | **2** | **1** |
