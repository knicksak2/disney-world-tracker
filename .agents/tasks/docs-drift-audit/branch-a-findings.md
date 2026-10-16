# Documentation Drift Audit — Branch A

Scope: `crowd-calendar`, `disney-world-tracker`, `expanded-stats`,
`experience-activity-logging`, `experience-detail-redesign`, `experience-facet-enrichment`.
Methodology and severity rubric follow the prior audit at
`.agents/tasks/docs-drift-audit/findings.md`: each finding cites the file+line making the
claim, the real source file+line showing the actual state, and a suggested fix; each clean
spec gets a short "Confirmed NOT drifted" entry.

---

## HIGH findings

### HIGH-A1: `disney-world-tracker` describes a ThemeParks.wiki-only architecture that `disney-facilities-catalog-source` has fully replaced, with zero cross-reference in either direction

- **Claim:** `.kiro/specs/disney-world-tracker/design.md` and `requirements.md` describe the
  **sole** catalog/live data source as the ThemeParks.wiki API (`requirements.md`'s glossary:
  *"ThemeParks_API: ... base URL https://api.themeparks.wiki/v1 ... accessed via the
  entity-based endpoints `/destinations` and `/entity/{id}/children`"*), a `Catalog_Service`
  whose `Catalog_Sync` fetches those two endpoints (`design.md` "Catalog_Service" section), a
  standalone out-of-band `Image_Sourcing_Job` (`src/scripts/sourceImages.ts`, run via
  `npm run source-images`) that scrapes Wikipedia/Wikimedia Commons for imagery with curated
  `imageOverrides.json` overrides, and a `BullMQ`-scheduled 24-hour sync against those two
  endpoints only. `requirements.md` R1.1–R1.25 (entity-type classification `ATTRACTION`→Ride,
  `SHOW`→Show, `RESTAURANT`→Restaurant, closed category set `Ride|Show|Restaurant|Parade|
  Character_Meet|Other`) and `tasks.md` line 587 describe a 5-tab mobile navigator ("Home,
  Catalog, Stats, Friends, Profile").
- **Reality:** `.kiro/specs/disney-facilities-catalog-source/requirements.md`'s Introduction
  (lines 3-5) states explicitly: *"This feature replaces ThemeParks.wiki entirely with
  Disney's own internal data sources... This is a full, single-ecosystem migration. After it
  completes, no part of the app reads from ThemeParks.wiki"* (for the catalog/static path; live
  is further revised by `disney-source-resilience`, per `tech-conventions.md`). Confirmed
  against real code:
  - `apps/api/src/services/catalog/reconcile.ts:43-47`: *"Image URLs: previously (the
    ThemeParks.wiki design) `image_url` was owned by an out-of-band image-sourcing job... That
    job is retired; `image_url` is now Disney-provided (R7)."*
  - `apps/api/src/services/catalog/types.ts:103-106`, `repo.ts` throughout: `image_url` is a
    plain carried-through Disney field (`detailImageUrl`/`listImageUrl`), not sourced by any
    out-of-band job.
  - `apps/api/src/services/catalog/__tests__/imageSurvival.prop.test.ts:1,12-15,59-61`: the
    test's own docstring confirms the *inversion* — "In the retired ThemeParks.wiki design,
    `applyReconciliation` deliberately NEVER touched `image_url`... With the Disney sources
    that job is gone, `image_url` is Disney-provided... `image_attribution` is dropped."
  - `.kiro/specs/disney-facilities-catalog-source/tasks.md:261-264`: task 12.2, *"Delete the
    out-of-band image-sourcing job and curated overrides — Delete
    `apps/api/src/scripts/sourceImages.ts` and `apps/api/src/scripts/imageOverrides.json`;
    remove the `source-images` command."* `file_search` for `imageOverrides.json` and
    `sourceImages.ts` returns **zero hits** anywhere in the live tree — both are gone exactly as
    that later spec describes.
  - `Experience_Category` is no longer the 6-value closed set `disney-world-tracker` describes:
    `packages/shared/src/enums.ts:25-44`'s `EXPERIENCE_CATEGORIES` includes `Tour`, `Recreation`,
    `Spa`, `Event`, and `Resort` in addition to the original six — matching
    `disney-facilities-catalog-source/design.md:536-538`'s expanded ten-value set, not
    `disney-world-tracker`'s original mapping table.
  - The mobile tab bar is not `Home, Catalog, Stats, Friends, Profile`:
    `apps/mobile/src/navigation/RootNavigator.tsx:137-189` registers `Home, Explore, MagicFab,
    Trips, Collection` (label "Vault") — confirmed identically by the prior audit's own
    "Confirmed NOT drifted" entry for `tech-conventions.md`'s bottom-tabs claim. `CatalogStack`
    and `FriendsStack`, which `disney-world-tracker/tasks.md:587` names, do not exist (per the
    prior audit's confirmed finding).
  - The classification pipeline itself has moved: `apps/api/src/services/catalog/types.ts:60-64`
    now documents deriving `category` via `classify(entity)` as only one of several inputs, and
    `disney-facilities-catalog-source/design.md:310-339` replaces it with `classifyFacility.ts`
    operating over `Facility_Document`/`Facility_Type`, a different upstream shape entirely
    (Disney Sync Gateway documents, not ThemeParks.wiki entities).
  - No file in `disney-world-tracker/*.md` mentions `disney-facilities-catalog-source`,
    `disney-source-resilience`, or any superseding spec by name (`grep` for
    `superseded|supersede|disney-facilities-catalog-source|disney-source-resilience` across all
    three `disney-world-tracker` files returns zero hits). Conversely,
    `disney-facilities-catalog-source`'s own files never name `disney-world-tracker` as the
    spec they are replacing — it is only inferable from context.
- **Why HIGH:** this is the single largest architectural claim in the repo's spec set
  (`disney-world-tracker` is the foundational "Overview" spec most cold-start readers would open
  first) and it describes an upstream source, data flow, out-of-band job, and classification
  pipeline that have been **entirely removed and replaced**. An agent asked to "add a new
  Experience field from the catalog source" or "fix the image sourcing job" who reads only this
  spec would edit or recreate deleted files (`sourceImages.ts`, `imageOverrides.json`), target
  the wrong upstream endpoint (`ThemeParks_API /destinations` instead of the Disney Sync
  Gateway), and use a stale 6-value category enum. This is a repo-wide, foundational-document
  version of the same "built against the pre-redesign surface" mistake that seeded this entire
  audit, at far larger scope than the dark-mode HIGH-1 finding from the prior report.
- **Suggested fix:** Add a prominent supersession note at the top of
  `disney-world-tracker/design.md`'s Overview and `requirements.md`'s Introduction stating that
  the Catalog_Service's ThemeParks.wiki sourcing, the `Image_Sourcing_Job`, and the 6-value
  `Experience_Category` enum are superseded by `disney-facilities-catalog-source` (and live data
  further by `disney-source-resilience`), per the tech-conventions "editing an existing spec"
  convention — add, don't delete, since `disney-world-tracker`'s Auth/Tracking/Stats/Friends/
  Sharing/Aggregate-Ratings sections remain the accurate original design for those modules. Also
  correct `tasks.md:587`'s tab list, which no cold-start agent should treat as the current
  navigation shape.

---

## MEDIUM findings

### MEDIUM-A1: `experience-activity-logging/design.md` names a `confirmRodeWithLog` repo method on `ExperienceLogRepo` that does not exist; the real rode-with confirmation logic lives inline in `trips/repo.ts`

- **Claim:** `.kiro/specs/experience-activity-logging/design.md`'s "Backend Structure" section
  lists `repo.ts`'s `ExperienceLogRepo` interface as providing four methods, including
  `confirmRodeWithLog(taggedMemberId: string, originatingLogId: string):
  Promise<ExperienceLogDTO>`.
- **Reality:** `apps/api/src/services/tracking/logs/repo.ts:95-110`'s real `ExperienceLogRepo`
  interface has exactly four methods — `addLog`, `getVisitHistory`, `deleteLog`,
  `getVisitSummaries` — and **no** `confirmRodeWithLog` method at all. The rode-with
  confirmation flow described in Requirement 3 (R3.1/R3.2: "a tagged User confirms a
  `rode_with_tags` invite... insert an `Experience_Log` record for that tagged User") is instead
  implemented as a raw inline SQL `INSERT INTO experience_logs` inside
  `apps/api/src/services/trips/repo.ts`'s `confirmRodeWithTag` function (lines 3605-3722,
  specifically the insert at ~3700-3707), which also handles the completion dual-write and
  rating upsert itself rather than delegating to the logs repo. The function and its insert are
  explicitly commented as implementing exactly this requirement: *"experience-activity-logging
  R3.1 / R3.2: record the confirming Member's own Experience_Log..."* (repo.ts ~3698-3702).
- **Why MEDIUM not HIGH:** the described *behavior* (R3.1/R3.2) is correctly implemented and the
  requirement is satisfied — this is a pure interface/location mismatch, not a missing or broken
  feature. The confusion is scoped to someone extending the rode-with confirm flow (e.g. to also
  write a note) who looks for `confirmRodeWithLog` on `ExperienceLogRepo` per the design and
  would not find it there; they would need to discover the real location is
  `trips/repo.ts::confirmRodeWithTag`'s inline SQL instead.
- **Suggested fix:** Amend `design.md`'s "Backend Structure" bullet list to remove
  `confirmRodeWithLog` from `ExperienceLogRepo` and add a short note that Requirement 3's
  rode-with confirmation is implemented inline inside `trips/repo.ts`'s `confirmRodeWithTag`
  (not via a dedicated logs-repo method), with a pointer to that function.

### MEDIUM-A2: `crowd-calendar/tasks.md` task 21.5 (365-day Ride_Baseline re-anchor, R14.9) is unchecked and still pending — not yet drifted, but close to a false-done risk given the surrounding wave's heavy "complete" density

- **Claim:** `tasks.md` task group 21 is almost entirely `[x]` (21.1, 21.2, 21.3, 21.4, 21.6,
  21.7, 21.8 all checked complete), making task **21.5** ("Re-anchor the Ride_Baseline from a
  trailing 365-day archive window (R14.9)") the single unchecked `[ ]` item buried in an
  otherwise-complete-looking wave, with its own explicit gating note: *"Once `wait_archive` holds
  ≥ 365 days... Gated on the archive actually having a year of coverage — before then this leg is
  a no-op."*
- **Reality:** this is correctly left unchecked and is **not** a drift finding — the task is
  genuinely incomplete and honestly marked as such (`wait_archive` was only introduced in this
  same task group, so 365 days of data cannot yet exist). No source file claims this leg is
  implemented; `grep` for a 365-day baseline recompute function in
  `apps/api/src/services/intelligence/derivedStatsService.ts` finds no such leg, consistent with
  the unchecked box.
- **Why reported anyway:** flagging this defensively because the design's R14.9 and Property
  14's "re-anchor" language exist in `requirements.md`/`design.md` as already-written
  requirements text describing a mechanism that is not yet built — a future reader of
  `requirements.md` alone (without `tasks.md`) could mistake R14.9 for shipped behavior. This is
  template/structural, not a factual error, so it is listed as a LOW-weight MEDIUM rather than a
  true drift — downgrade freely if the convention is "unchecked tasks are self-evidently
  pending" and don't need a flag here.
- **Suggested fix:** none required for correctness; optionally add a one-line "pending, gated on
  data accrual" annotation directly in `requirements.md` next to R14.9 so a `requirements.md`-only
  reader doesn't need to cross-reference `tasks.md` to learn it isn't live yet.

---

## LOW / NIT findings

### LOW-A1: `experience-detail-redesign/requirements.md`'s glossary entry for `Single_Rider_Strip` cites `RideLiveSection.tsx` / `WaitInsightsSection.tsx` as the pre-existing single-rider UI; `WaitInsightsSection.tsx` is no longer reachable from `ExperienceDetailScreen.tsx` — only `LiveWaitCockpit.tsx` (which absorbed its logic) is

- **Claim:** `requirements.md` lines 387-390: *"Single_Rider_Strip: The existing single-rider
  surfacing (Requirement pre-dating this amendment; see `RideLiveSection.tsx` /
  `WaitInsightsSection.tsx`), repositioned within the Live_Wait_Cockpit."* `design.md` lines
  655-658 repeats this, additionally stating single-rider data is "already rendered by
  `RideLiveSection.tsx` and `WaitInsightsSection.tsx`."
- **Reality:** `RideLiveSection.tsx` is still real, still renders single-rider wait
  (`apps/mobile/src/screens/catalog/live/RideLiveSection.tsx:82-91`), and is unaffected.
  `WaitInsightsSection.tsx` (`apps/mobile/src/screens/catalog/WaitInsightsSection.tsx`) still
  exists on disk and still has its own passing test suite
  (`__tests__/WaitInsightsSection.test.tsx`), but it is **not imported or rendered anywhere** in
  `apps/mobile/src/screens/**/*.tsx` outside its own test file (`grep` for
  `from '../WaitInsightsSection'` / `require('../WaitInsightsSection')` across all non-test
  `.tsx` finds zero hits). `ExperienceDetailScreen.tsx` → `TodayInParkLens.tsx` renders
  `LiveWaitCockpit.tsx` instead, whose own header comment
  (`apps/mobile/src/screens/catalog/LiveWaitCockpit.tsx:170`) says *"// Verdict logic from
  existing WaitInsightsSection"* — i.e. `LiveWaitCockpit` was built by porting
  `WaitInsightsSection`'s verdict/single-rider/forecast logic inline, not by composing or
  wrapping the component itself. This is exactly the `experience-detail-redesign` task's own
  stated plan (design.md's Architecture section lists `Live_Wait_Cockpit` as the new
  Ride/Character_Meet live component superseding "the plain Live_Operational_Section layout"),
  so the orphaning of `WaitInsightsSection.tsx` is this spec's own intended and already-completed
  outcome (task 18.1, checked `[x]`) — the design/requirements text just never updated its own
  "already rendered by" claim after task 18 finished.
- **Why LOW not MEDIUM:** no behavioral risk — `LiveWaitCockpit.tsx` genuinely contains
  equivalent (in places richer) UI, so a reader following the design to find single-rider
  surfacing would reach working code either way (`RideLiveSection.tsx` is still accurate; only
  the second citation, `WaitInsightsSection.tsx`, is now a dead end for *this specific screen's*
  reachability, though the file itself is not deleted and its tests still pass in isolation).
- **Suggested fix:** Update `requirements.md`'s `Single_Rider_Strip` glossary entry and
  `design.md`'s "Research Notes" to say single-rider surfacing is now in `RideLiveSection.tsx`
  and `LiveWaitCockpit.tsx` (which inlines `WaitInsightsSection.tsx`'s former verdict logic),
  rather than `WaitInsightsSection.tsx` itself, which is no longer wired into
  `ExperienceDetailScreen.tsx`.

### LOW-A2: `experience-detail-redesign/design.md`/`requirements.md`'s Trip_Context_Date bug description (R16) still names `WaitInsightsSection.tsx` as the file carrying the bug and fix; the fix (task 22) is correctly applied to both `WaitInsightsSection.tsx` AND `LiveWaitCockpit.tsx`, but the spec text only mentions the former by name in its narrative framing

- **Claim:** `design.md`'s Research Notes (lines 658-662) frame the entire Trip_Context_Date
  defect as being in `WaitInsightsSection.tsx` ("`WaitInsightsSection.tsx` currently computes
  `tripDate` as `activeTrip?.startDate` unconditionally"), and `tasks.md:408-411`'s task 22 title
  says *"Fix the Trip_Context_Date regression in the existing `WaitInsightsSection`/
  `LiveWaitCockpit` wiring"* — correctly naming both — but the design's own narrative framing
  only elaborates the bug against `WaitInsightsSection.tsx`.
- **Reality:** `apps/mobile/src/screens/catalog/LiveWaitCockpit.tsx:107-110` calls
  `resolveTripContextDate(...)` correctly (confirmed by reading the file), and
  `WaitInsightsSection.tsx:9` imports the same `resolveTripContextDate` helper — both files were
  fixed by task 22, consistent with the task title. This is not a drift in substance (the task
  title and the actual fix match each other); it is only that `design.md`'s prose explanation
  singles out one of the two files it actually touched. Not actionable beyond noting it is
  internally consistent once `tasks.md` is also read — downgraded to a NIT.

---

## Confirmed NOT drifted (checked and found accurate)

- **`crowd-calendar`** — extensively verified against real code: `services/intelligence/` has
  all the pure modules the design names (`waitMath.ts`, `calibration.ts`, `crowdForecast.ts`,
  `derivedStats.ts`, `seasonalPrior.ts`, `showtimePatterns.ts`, `weatherClient.ts`,
  `samplingService.ts`, `predictionService.ts`, `IntelligenceRepo.ts`); migrations `0020`,
  `0021`, `0029`, `0030`, `0033` all exist exactly as named; `CROWD_INDEX_MIN_SHAPE_SAMPLES`,
  `CROWD_INDEX_MIN_EXPECTED_MINUTES`, `isBaselineEstablished`, `getComparableCrowdIndices` all
  match the design's described shapes and values in `waitMath.ts`/`IntelligenceRepo.ts`;
  `composeServices.ts` wires `liveService` into `createPredictionService` exactly per task 22.2;
  `CrowdCalendarScreen.tsx` exists, is registered on `ExploreStack.tsx` as `CrowdCalendar`, and
  has the predicted-vs-actual test coverage the design/tasks describe. The task-group-21
  unchecked item (21.5) is honestly unchecked, not a drift (see MEDIUM-A2 above for the
  defensive note).
- **`expanded-stats`** — design and real code match closely: `apps/api/src/services/stats/`
  contains `coverage.ts`, `facets.ts`, `ratingStats.ts`, `percentile.ts`, `repo.ts`, `routes.ts`,
  `curatedShare.ts`, exactly the modules the design describes; `routes.ts` implements
  `GET /me/stats[?percentile=true]` and `GET /me/stats/summary?for=<userId>` with
  `assertOwnerOrFriend` gating and a `getStatsSnapshot`/`StatsSnapshotInput` repo contract
  matching the design's TypeScript interfaces verbatim. No new tables/migrations were needed, as
  the design states, and none were added. (The real `stats/` folder additionally contains
  `resorts.ts`, `festivals.ts`, `foodActivity.ts`, `activity.ts` beyond what this design
  describes — that is expected forward drift from later specs layering on top, not a
  contradiction of this spec's own claims, so it is not flagged as a finding here.)
- **`experience-activity-logging`** — migration `0034_experience_logs.sql` exists with the
  exact table/column/constraint shape the design specifies; `apps/api/src/services/tracking/logs/`
  contains `repo.ts` and `routes.ts` implementing `addLog`, `getVisitHistory`, `deleteLog`
  (plus an additional `getVisitSummaries` added later by `experience-lists`, documented inline as
  such) matching the dual-write-to-completions/ratings behavior Property 1/2 describe;
  `apps/mobile/src/screens/catalog/LogVisitModal.tsx` and the "Log a visit"/"Log another visit"
  button wiring in `ExperienceDetailScreen.tsx` exist and are wired exactly as R6.2/R6.3
  describe. Only the single `confirmRodeWithLog` interface-location claim is drifted (MEDIUM-A1).
- **`experience-detail-redesign`** — the two-Lens shell (`Today_In_Park_Lens`/
  `My_Passport_And_Lore_Lens`), `LiveWaitCockpit.tsx`, `TodayInParkLens.tsx`,
  `PassportAndLoreLens.tsx`, `QuickSpecsRow.tsx`, `LensSwitcher` (implied), and
  `FloatingActionDock.tsx` are all real and wired into `ExperienceDetailScreen.tsx` exactly as
  the design's Architecture diagram describes; the `boardingGroup`/`VirtualQueueBanner`
  surfacing and the Trip_Context_Date fix (task 22) are both genuinely implemented. Only the
  "already rendered by `WaitInsightsSection.tsx`" framing is stale post-task-18 (LOW-A1/LOW-A2).
- **`experience-facet-enrichment`** — this spec is fully accurate against real code with no
  drift found anywhere. Migration `0008_experience_facet_enrichment.sql` exists;
  `apps/api/src/services/catalog/disney/facilityDoc.ts` defines `PERSISTED_FACET_GROUPS`,
  `INTEREST_FACET_GROUPS`, and `buildGroupedFacets` exactly as designed;
  `apps/api/src/services/catalog/disney/enrich.ts` defines `extractHeightRequirement`,
  `extractPhysicalConsiderations`, `extractInterestFacets`, `extractWhyThis`, `extractSubType`,
  and the shared `deriveFacetViews` helper exactly as designed, reused by `catalog/repo.ts`'s
  `rowToDto` exactly as the design's code sample shows; the mobile rendering (height/advisory/
  interest tags, Why_This bullets) is real and present — relocated into `PassportAndLoreLens.tsx`
  by the later `experience-detail-redesign` spec, which is expected/correct forward evolution,
  not a contradiction of this spec's own claims.

---

## Notes on methodology for this subset

- Per the brief, navigation/screen references were checked against the real
  `RootNavigator.tsx`/`ExploreStack.tsx` et al.; service/repo references were checked against
  real files in `apps/api/src/services/<name>/`; supersession was checked by reading the
  superseding specs' own text and cross-checking real source; DB/migration claims were verified
  by listing `apps/api/migrations/` and reading the named files; the one orphaned-UI claim
  checked (`WaitInsightsSection.tsx`'s reachability) was confirmed by `grep`-ing all non-test
  `.tsx` imports.
- No exhaustive reachability sweep was performed beyond the one orphan check named above, per
  the brief's scope limitation.
