# Implementation Plan — W2 Screen Retrofit (spec task 9, batches B1..B7)

Source of truth: `.agents/tasks/dark-mode-retrofit/design.md` (sections "Consumer pattern",
"Memoized and virtualized consumers", "Third-party and native props", "Default-text rule",
"Literal conversion rules" 0–7, "Testing Strategy", "Parallel-Batch Decomposition", "Per-batch
definition of done" 1–8) and `.kiro/specs/dark-mode/tasks.md` task 9 / 9.1–9.7. This plan
sequences that design. It does not re-decide it. If this plan and the design disagree, the
design wins. Report the conflict; don't pick silently.

## Planning decisions

- **Keep the seven batches as written. No restructure.** The guard's `PENDING_RETROFIT`
  (`apps/mobile/src/__tests__/themeRetrofit.guard.test.ts`) is keyed `B1..B7`, and batches
  may not edit the guard. A split batch couldn't self-check in strict mode without a guard
  edit. The batches are balanced by lines, measured on the current tree:
  - B1 13.6k
  - B2 11.2k
  - B3 14.2k
  - B4 13.5k
  - B5 14.4k
  - B6 10.4k
  - B7 12.9k

  B4 has the most colour sites (~1,000 across 7 files, vs 378–819 elsewhere). But it has only
  4 owned tests and no list virtualisation, so its total effort is comparable. The existing
  parallel implement→review loops run this plan unchanged.
- **The baseline is green.** I ran `npm run verify:mobile` once during planning, so this
  covers W1 checkpoint 8.6 (root typecheck plus mobile Jest). Result:
  `Test Suites: 273 passed, 273 total`, `Tests: 1917 passed, 1917 total`, `EXIT=0`. Any red
  run after a batch's edits belongs to that batch (execution-discipline rule 4).
- **Cross-batch imports were checked.** 47 imports cross batch lines, for example
  `ExperienceDetailScreen` (B2) imports B3's sheets and B1's `TodayInParkLens`, and
  `HomeScreen` (B6) imports B4/B5 query keys and B7's `AvatarChip`. All of them are
  components, functions or query keys. None is a style or colour export. They stay safe as
  long as no batch changes an exported name, signature or props (the design's rule). The only
  exported-signature change allowed in W2 is B7's `statsView.ts`. Every non-test caller of it
  is under `screens/stats/`, which B7 owns, and so is every test that calls it.
- **`destinationVisuals.accent` consumers are all in B1** (`ExploreHubScreen`,
  `DestinationScreen`, `ParkDestinationScreen`). Removing it is safe inside B1.
- **Test ownership is matched case-sensitively** on the first dot-separated filename segment.
  So `screens/catalog/live/__tests__/forecastChart.test.ts` is **not** owned by B2. It tests
  `live/liveView.ts`, which is unowned. The owned-test lists below are computed from the real
  tree.
- **Snapshot lifetime.** The design says to delete the snapshot afterwards, and that still
  holds. But each batch runs as an implement→review loop, and both the fix iterations and the
  reviewer need the *pre-batch* snapshot to re-run the audit. So:
  - A batch takes its snapshot **once**, only if `$env:TEMP\dark-mode-snapshot\<B>\` does not
    exist yet.
  - It **never** re-snapshots.
  - The snapshot is deleted by the integrate step after the batch's verdict is `APPROVED`.

  The snapshot lives outside the repo, so the working tree stays clean either way. If the
  snapshot is missing while owned files are already edited, the batch stops and reports. It
  doesn't re-snapshot, because a snapshot of half-converted files would make the audit
  meaningless.
- **There is one canonical audit script, outside the repo.** The light-colour multiset audit
  (DoD item 2) is a ~200-line regex/loader procedure. If seven agents re-derive it, they'll
  get seven different results. I wrote it once to `$env:TEMP\dark-mode-audit\audit.cjs`
  (`C:\Users\knick\AppData\Local\Temp\dark-mode-audit\audit.cjs`). It is run via stdin
  (`Get-Content … -Raw | node - …`) from the repo root, so it writes nothing to the repo.
  - It is verbatim in Appendix A in case the TEMP copy is missing. If so, recreate it at that
    TEMP path, never inside the repo.
  - **Smoke-tested, read-only, against W1.** Using `git show HEAD:` copies as the snapshot, 10
    of the 12 W1 files came out PASS. The 2 differences are the expected, justified ones:
    - `theme/components.tsx`: the private `hexToRgba` template literal moved into
      `theme.withAlpha`.
    - `navigation/RootNavigator.tsx`: the tab-tint literals moved to `t.tabBar`, which isn't
      in the audit's GROUPS.
  - **Ran without errors on all 135 W2 files,** with no unresolved reads, when snapshot =
    current file.
- **Shared files are never edited by a batch.** `.kiro/specs/dark-mode/tasks.md` checkboxes
  for 9.1–9.7 are ticked by the **integrate** step once the batch is `APPROVED`. That avoids
  seven concurrent writers on one file. Other shared files no batch may edit: `theme/*`,
  `test/*`, `__tests__/themeRetrofit.guard.test.ts`, `jest.config.js`, `__mocks__/*`,
  `.kiro/steering/*`, and W1-owned files.
- **Per-batch report path:** `.agents/tasks/dark-mode-retrofit/w2-<B>-report.md`, for example
  `w2-B4-report.md`. Each batch writes only its own report, so the files are disjoint. The
  reviewer reads that report plus the diff.
- **No batch runs `npm run verify`.** The single full gate is W3 (spec task 12). Batches use
  file-level Jest plus a filtered `npm run typecheck --workspace apps/mobile`.

## Common procedure (every batch Bn runs these steps in order)

Commands assume PowerShell. Use `cwd` = repo root `c:\Users\knick\dev\disney-app` unless a
step says `apps/mobile`. `$B` is the batch id. `$files` is the batch's "Owned source files"
list below, with paths relative to `apps/mobile/src`, POSIX. `$tests` is the batch's owned
test list, with paths relative to `apps/mobile`.

- [ ] C1. Take the pre-batch snapshot, once, before any edit.
      `$root="$env:TEMP\dark-mode-snapshot\$B"; if (Test-Path $root) { 'snapshot exists — reuse, do NOT overwrite' } else { foreach($f in $files){ $d=Join-Path $root $f; New-Item -ItemType Directory -Force (Split-Path $d) | Out-Null; Copy-Item "apps/mobile/src/$f" $d } }`
      Files: none in the repo.
      Verify: `(Get-ChildItem $root -Recurse -File).Count` equals `$files.Count`. If owned
      files already show edits (the guard in strict mode reports fewer violations than
      expected) and there is no snapshot, stop and report.

- [ ] C2. Convert every owned file to the consumer pattern.
      - Use `const useStyles = makeStyles((t) => ({…}))` with `useStyles()` called in every
        function component that reads `styles`.
      - Read inline colours through `const t = useAppTheme()`.
      - Put literals in a co-located `<File>.palette.ts`. It may export only
        `export const NAME = definePalette({...})`, with light = the original literal
        byte-for-byte.
      - Apply conversion rules 0 → 7 in order, the first match wins, including 1a, 2a, the
        category `tint`/`fill` split, and rule 5 exemptions.
      - Read palettes only as `P[t.scheme].k`, `usePalette(P).k`, or through one `const`
        alias. Never destructure them.
      - Apply the memoized/virtualized rules:
        - `styles`/`t`/palette go in the deps of every `useMemo`/`useCallback`/effect that
          reads them, including `navigation.setOptions` effects;
        - no colour or style is held in a `useRef`;
        - `Animated` colour interpolations go in a `useMemo([t])`;
        - every `FlatList`/`SectionList`/`DraggableFlatList` whose callbacks read parent
          `styles`/`t` gets `extraData={t.scheme}` (or `[x, t.scheme]`);
        - a `React.memo` component that reads a module-scope `styles` calls `useStyles()`
          itself;
        - module-scope helpers that take `styles` move inside the component or take
          `styles`/`t` as parameters.
      - Apply the third-party/native rules:
        - `TextInput`: `...t.textDefault` (only per the default-text rule),
          `placeholderTextColor={t.color.textSecondary}`, `keyboardAppearance={t.scheme}`;
        - `ActivityIndicator`/`RefreshControl` tint: `primaryFg`, or `textOnPrimary` on a
          filled button;
        - `Switch` colours become a palette pair;
        - a `react-native-calendars` component gets a themed `theme` plus `key={t.scheme}`.
      - Apply `...t.textDefault` **only** when all three default-text conditions hold.
      - Don't change exported names, signatures or props (B7's `statsView` is the one
        exception). Don't touch unlisted helper `.ts` files. If one embeds a colour, stop and
        report.
      Files: the batch's owned source files plus new `<File>.palette.ts` beside them.
      Verify (inner loop, after each file): from `apps/mobile`, run
      `npx jest <that file's owned tests> --maxWorkers=2`. They must pass with the existing
      light assertions unchanged.

- [ ] C3. Add the dark-mode tests (Testing Strategy a/b/c/d), only in owned test files.
      - In each listed test file, add a `describe('dark mode', …)` with
        `setTestScheme('dark')` and `afterEach(resetTestScheme)`, imported from
        `src/test/themeTestUtils`. It asserts:
        - **(a)** the root container's flattened `backgroundColor` equals
          `darkTheme.color.background`, or `surface` for sheets and modals;
        - **(b)** one primary text node's `color` equals `darkTheme.color.textPrimary`;
        - **(c)** one converted element has its token or palette **dark** value.
      - Section and card files with an owned render test get a single (c) assertion.
      - Add the designated **(d)** test: mount under light, call `setTestScheme('dark')`
        **without remounting**, and assert a rendered list row's or memo-derived colour equals
        the dark value.
      - Assert only elements the batch owns, by testID or text. Children rendered from another
        batch's file may still be light while that batch is in flight.
      - Flatten styles with `StyleSheet.flatten`, as the W1 tests do. Take dark values from
        `darkTheme` or from the palette module's `.dark`, never from hardcoded hex.
      Files: the batch's owned test files (listed per batch). New test files only where this
      plan names them.
      Verify: from `apps/mobile`, `npx jest @tests --maxWorkers=2`. All pass.

- [ ] C4. Self-check against the strict-mode guard for the batch's own id. From `apps/mobile`:
      `$env:THEME_GUARD_STRICT='<B>'; npx jest src/__tests__/themeRetrofit.guard.test.ts --maxWorkers=2; Remove-Item Env:THEME_GUARD_STRICT`
      Verify: green, with zero violations in owned files. The palette-purity and Property-14
      checks scan **every** `*.palette.ts`. If the only failure is in another batch's
      in-flight palette file, that isn't yours. Note it in the report and don't edit that file.

- [ ] C5. Typecheck, filtered to owned files. From the repo root:
      `$pats = foreach($f in $files){ $d=(Split-Path $f -Parent).Replace('\','/'); $b=[IO.Path]::GetFileNameWithoutExtension($f); "src/$d/$b"; "src/$d/__tests__/$b." }; npm run typecheck --workspace apps/mobile 2>&1 | Select-String 'error TS' | Select-String -SimpleMatch -Pattern $pats`
      (B7 also adds `src/screens/stats/` and the two catalog cross-cutting test paths to `$pats`.)
      Verify: no output, so there are zero errors in owned files, palettes and owned tests.
      Errors in other batches' files are listed in the report, not fixed.

- [ ] C6. Regression sweep over every test that imports an owned file, including unowned ones.
      From `apps/mobile`:
      `npx jest --findRelatedTests @(($files) | % { "src/$_" }) --maxWorkers=2`
      Verify: all pass. A failure in a test the batch doesn't own is a stop-and-report: name
      it in the report and don't edit it.

- [ ] C7. Run the light-colour multiset audit (DoD item 2, the pass/fail proof). From the repo
      root:
      `Get-Content "$env:TEMP\dark-mode-audit\audit.cjs" -Raw | node - $B @files`
      Also read the human diff:
      `git diff --no-index -- "$env:TEMP\dark-mode-snapshot\$B\<rel>" "apps/mobile/src/<rel>"`
      (exit 1 just means there are differences).
      Verify: every file prints `PASS`, or every `DIFF` line is listed in the report with a
      rule justification, for example:
      - `categoryVisual[*].tint → categoryVisual[*].fill` (rule 1 fill split)
      - `TIER_COLOR[*] → TIER_TEXT[*]` (rule 7)
      - a removed `destinationVisuals` accent → `parkAccent[*]` (rule 6)
      - a hex removed from a trailing code-line comment (guard rewording)

      Any `UNRESOLVED(...)` note or unexplained difference fails the batch.
      Script facts the batch must know:
      - It strips block comments and full-line `//`/JSDoc lines on both sides.
      - It counts the `theme.`/`t.`/bare-imported reads, `withAlpha(t.x, <numeric>)` as rgba
        only, and palette reads/aliases resolved from any `…palette` import.
      - It normalises hex case, 3-digit hex and numeric rgba.
      - It exits 1 when any file has differences, so justified differences still exit 1.

- [ ] C8. Write `.agents/tasks/dark-mode-retrofit/w2-<B>-report.md`. It contains:
      - the C4/C5/C6/C7 literal output tails;
      - each audit difference with its justification;
      - every memo/`useCallback`/effect/`FlatList`/`React.memo` site touched (DoD 4);
      - every `...t.textDefault` placement, plus the default-text exclusions applied;
      - the rule-2a non-token suffix sites, confirming each suffixed palette value is
        `#rrggbb` in both schemes (DoD 8);
      - any `PrimaryButton` or active `Chip` rendered directly on `surfaceAlt` (DoD 8);
      - the named rule-1a/Property-22 sites;
      - converted files with **no** render test (covered only by the guard plus screenshots);
      - other batches' typecheck or palette errors observed;
      - stop-and-report items;
      - a **behavior→test map** (every converted behavior → test file + the concrete
        assertion).

      Don't tick `tasks.md`.
      Verify: the report exists, and every DoD item 1–8 has an explicit line.

**Reviewer checklist (per batch, run independently; write the verdict file LAST).**
- Re-run C4, C5, C6 and C7 yourself. Don't trust the report's pasted output.
- Read `git diff --no-index` against the snapshot for every owned file. Check:
  - rules 0–7 are applied by role;
  - no destructured palette;
  - memo deps and `extraData` are present;
  - no colour in `useRef`;
  - `textDefault` placements satisfy all three conditions;
  - no exported-signature change;
  - no edits outside the owned files, owned tests and new co-located palettes
    (`git status --short` cross-checked against the owned list);
  - no stray files in the repo.
- Confirm the (a)/(b)/(c)/(d) tests exist where this plan lists them, and that each asserts a
  dark value that would fail if the element stayed light.

## Batch B1 — Explore & destinations (spec 9.1)

- [ ] B1.1 Snapshot → convert → test → self-check → audit → report (C1–C8) for:
      Owned source files (`$files`):
      - `screens/catalog/ExploreHubScreen.tsx`
      - `screens/catalog/DestinationScreen.tsx`
      - `screens/catalog/ParkDestinationScreen.tsx`
      - `screens/catalog/ResortsDirectoryScreen.tsx`
      - `screens/catalog/ResortGuideSection.tsx`
      - `screens/catalog/CrowdCalendarScreen.tsx`
      - `screens/catalog/LocationGroupSection.tsx`
      - `screens/catalog/TodayInParkLens.tsx`
      - `screens/catalog/destinationVisuals.ts`

      Owned tests (`$tests`), under `src/screens/catalog/__tests__/`:
      - `ExploreHubScreen.test.tsx`
      - `DestinationScreen.render.test.tsx`
      - `DestinationScreen.layouts.test.tsx`
      - `ParkDestinationScreen.test.tsx`
      - `ResortsDirectoryScreen.test.tsx`
      - `ResortGuideSection.test.tsx`
      - `CrowdCalendarScreen.test.tsx`
      - `LocationGroupSection.test.tsx`
      - `TodayInParkLens.render.test.tsx`

      Batch specifics:
      - `destinationVisuals.ts`: remove only the `accent` field. Gradients stay, and the file
        stays allowlisted. Consumers use `t.parkAccent[id]`, or `t.color.primaryFg` for
        `'Resorts'`.
      - Placeholder tiles at `DestinationScreen.tsx:1013`, `ExploreHubScreen.tsx:900` and
        `ParkDestinationScreen.tsx:1445` use `t.categoryVisual[cat].fill` or
        `t.resortVisual.fill`, and the glyph stays `textOnPrimary`.
      - The `CrowdCalendarScreen` `Calendar` gets the themed `theme` plus `key={t.scheme}`.
      - `ResortsDirectoryScreen.tsx:2262` `` `${tierColor}18` ``: rule 2a. The tier palette
        value is `#rrggbb` in both schemes.
      - Lists: Explore ×2, Destination ×2, Park ×2, Resorts ×3.
      - `React.memo`: 11 sites across the four screens.
      - `TextInput`s: 5.
      - `ResortGuideSection` exports `KNOWN_DINING_METADATA`/`resolveFallbackResortMeta`, and
        B2's `ExperienceDetailScreen` imports from it. Their shape must not change. If they
        embed colours, colour values go into a palette, but the exported names and types stay.
        If that's impossible without a type change, stop and report.

      Dark tests:
      - (a/b/c) in `ExploreHubScreen`, `DestinationScreen.render`, `ParkDestinationScreen`,
        `ResortsDirectoryScreen` and `CrowdCalendarScreen`. `CrowdCalendarScreen` also asserts
        the calendar's `theme.calendarBackground === darkTheme.color.surface`.
      - (c) in `ResortGuideSection`, `LocationGroupSection` and `TodayInParkLens.render`.
      - **(d)** in `ExploreHubScreen.test.tsx`: mount light → `setTestScheme('dark')` →
        a FlatList row colour equals the dark value.
      - **Property 22 tile assertion** in `ExploreHubScreen.test.tsx`: the placeholder tile
        background equals `darkTheme.categoryVisual[cat].fill`.

      Strict guard: `$env:THEME_GUARD_STRICT='B1'`.
      Audit snapshot: `$env:TEMP\dark-mode-snapshot\B1\`. Audit:
      `Get-Content "$env:TEMP\dark-mode-audit\audit.cjs" -Raw | node - B1 @files`. Expected
      justified differences: the removed `accent` literals in `destinationVisuals.ts`, and
      `parkAccent[*]`/`color.primaryFg` reads added in its consumers (rule 6).
      Files without a render test: `destinationVisuals.ts`.
      Verify: C4–C7 green as defined. Report at `w2-B1-report.md`.

## Batch B2 — Experience detail & live (spec 9.2)

- [ ] B2.1 C1–C8 for:
      Owned source files:
      - `screens/catalog/`:
        - `ExperienceDetailScreen.tsx`
        - `QuickSpecsRow.tsx`
        - `LensSwitcher.tsx`
        - `LiveStatusStrip.tsx`
        - `LiveWaitCockpit.tsx`
        - `FloatingActionDock.tsx`
        - `PassportAndLoreLens.tsx`
        - `ParkPassportCard.tsx`
        - `AboutSection.tsx`
        - `WaitInsightsSection.tsx`
        - `VirtualQueueBanner.tsx`
        - `ShowtimesCard.tsx`
        - `DiningReservationCard.tsx`
        - `YourVisitCard.tsx`
        - `VisitHistoryTimeline.tsx`
        - `CompletionControls.tsx`
        - `RatingControl.tsx`
        - `NoteControl.tsx`
        - `FavoriteToggle.tsx`
        - `MenuScreen.tsx`
        - `MenuSummaryCard.tsx`
      - `screens/catalog/live/`:
        - `DiningSection.tsx`
        - `ForecastChart.tsx`
        - `liveSectionShared.tsx`
        - `RideLiveSection.tsx`
        - `ShowtimesSection.tsx`
      - `screens/liveWaits/LiveWaitsScreen.tsx`

      Owned tests:
      - `src/screens/catalog/__tests__/`:
        - `ExperienceDetailScreen.{addToExperienceList,dockActions,enrichedDetail,favoriteToggle,headerSubtitle,preservedBehaviors,recreationExperience,reservationAction,sectionOrdering,staticMap,taxonomyGating,whyThis}.test.tsx`
        - `AboutSection.render.test.tsx`
        - `DiningReservationCard.test.tsx`
        - `FavoriteToggle.test.tsx`
        - `FloatingActionDock.test.tsx`
        - `MenuScreen.{backControlAndTheme,foodListAffordances}.test.tsx`
        - `MenuScreen.{completeness,cuisine,price}.prop.test.tsx`
        - `MenuSummaryCard.test.tsx`
        - `MenuSummaryCard.structure.test.tsx`
        - `NoteControl.shareable.test.tsx`
        - `ParkPassportCard.test.tsx`
        - `ShowtimesCard.test.tsx`
        - `VirtualQueueBanner.test.tsx`
        - `WaitInsightsSection.test.tsx`
        - `YourVisitCard.logs.test.tsx`
        - `YourVisitCard.render.test.tsx`
      - `src/screens/liveWaits/__tests__/LiveWaitsScreen.test.tsx`

      **Not owned:** `src/screens/catalog/live/__tests__/forecastChart.test.ts`. It tests
      `liveView.ts`.

      Batch specifics:
      - The `ExperienceDetailScreen.tsx:1177` hero placeholder uses
        `t.categoryVisual[cat].fill`, and its glyph stays `textOnPrimary`.
      - The `NoteControl` `Switch` gets a palette pair.
      - `TextInput` in `CompletionControls` and `NoteControl`.
      - `LiveWaitsScreen` has a `FlatList` and 8 memo/callback sites.
      - `ForecastChart` bars: a data mark on a surface uses `primaryFg`, not `primary`
        (rule 1a, non-text graphics).
      - `theme.color.accent` stars stay `t.color.accent`.
      - `MenuScreen`'s cuisine `Badge color={theme.color.accent}` → `t.color.accent`.
      - `liveSectionShared.tsx` is a shared module inside B2. Keep its exports' names and
        types unchanged.

      Dark tests:
      - (a/b/c) for `ExperienceDetailScreen`, in
        `ExperienceDetailScreen.preservedBehaviors.test.tsx`. Render a fixture with no image
        so the :1177 placeholder renders, and also assert its background equals
        `darkTheme.categoryVisual[cat].fill` (the Property 22 instance for B2).
      - (a/b/c) for `MenuScreen`, in `MenuScreen.backControlAndTheme.test.tsx`.
      - (a/b/c) for `LiveWaitsScreen`, in `LiveWaitsScreen.test.tsx`.
      - (c) in `AboutSection.render`, `DiningReservationCard`, `FavoriteToggle`,
        `FloatingActionDock`, `MenuSummaryCard`, `ParkPassportCard`, `ShowtimesCard`,
        `VirtualQueueBanner`, `WaitInsightsSection` and `YourVisitCard.render`.
      - **(d)** in `LiveWaitsScreen.test.tsx`: mount light → `setTestScheme('dark')` → a
        FlatList row colour equals the dark value.

      Strict guard: `$env:THEME_GUARD_STRICT='B2'`.
      Audit snapshot: `$env:TEMP\dark-mode-snapshot\B2\`. Audit:
      `… | node - B2 @files`.
      Files without a render test: `QuickSpecsRow`, `LensSwitcher`, `LiveStatusStrip`,
      `LiveWaitCockpit`, `PassportAndLoreLens`, `VisitHistoryTimeline`,
      `CompletionControls`, `RatingControl`, `live/DiningSection`, `live/liveSectionShared`,
      `live/RideLiveSection`, `live/ShowtimesSection`. `NoteControl` has only a
      behaviour test, so add a (c) assertion there if it renders the control.
      Verify: C4–C7 green. Report at `w2-B2-report.md`.

## Batch B3 — Logging sheets & lists (spec 9.3)

- [ ] B3.1 C1–C8 for:
      Owned source files:
      - `screens/catalog/`:
        - `AddToTripOrListChoiceSheet.tsx`
        - `AddToTripPickerSheet.tsx`
        - `CreateLocationModal.tsx`
        - `FoodItemLogHistorySheet.tsx`
        - `FoodItemPickerModal.tsx`
        - `LogFoodItemModal.tsx`
        - `LogVisitModal.tsx`
        - `MyFoodHistoryScreen.tsx`
        - `RateExperienceModal.tsx`
        - `RestaurantDishLogCard.tsx`
        - `RestaurantFoodLogsSheet.tsx`
      - `screens/foodLists/`:
        - `AddToListsSheet.tsx`
        - `CreateFoodListModal.tsx`
        - `FoodListDetailScreen.tsx`
        - `FoodListDiscoveryScreen.tsx`
        - `ManageFoodListSharesSheet.tsx`
        - `MarkGottenUndoToast.tsx`
        - `MyFoodListsScreen.tsx`
        - `RateOnCheckoffPrompt.tsx`
      - `screens/experienceLists/`:
        - `AddToExperienceListsSheet.tsx`
        - `CreateExperienceListModal.tsx`
        - `ExperienceListDetailScreen.tsx`
        - `ExperienceListDiscoveryScreen.tsx`
        - `ManageExperienceListSharesSheet.tsx`
        - `MyExperienceListsScreen.tsx`

      Owned tests:
      - `src/screens/catalog/__tests__/`: `CreateLocationModal`, `FoodItemLogHistorySheet`,
        `FoodItemPickerModal`, `LogFoodItemModal`, `MyFoodHistoryScreen`,
        `RateExperienceModal`, `RestaurantFoodLogsSheet` (each `.test.tsx`)
      - `src/screens/foodLists/__tests__/`: `AddToListsSheet`, `CreateFoodListModal`,
        `FoodListDetailScreen`, `FoodListDiscoveryScreen`, `ManageFoodListSharesSheet`,
        `MarkGottenUndoToast`, `MyFoodListsScreen`, `RateOnCheckoffPrompt` (each
        `.test.tsx`)
      - `src/screens/experienceLists/__tests__/`: `AddToExperienceListsSheet`,
        `CreateExperienceListModal`, `ExperienceListDetailScreen`,
        `ExperienceListDiscoveryScreen`, `ManageExperienceListSharesSheet`,
        `MyExperienceListsScreen` (each `.test.tsx`)

      Batch specifics:
      - **Rule 1a, `MarkGottenUndoToast.tsx:82`.** The inverse toast becomes the H-role
        palette pair `{ light: '#1f1235', dark: '#1f1235' }`, with `textOnPrimary`/`accent`
        text and `...t.outline.card`. Name this site in the report.
      - `ExperienceListDetailScreen.tsx` imports `{ theme, categoryVisual }`. Its bare
        `categoryVisual[...]` reads convert to `t.categoryVisual[...]` (tint or fill by role).
      - 15 `TextInput`s; lists in 14 files. Each needs `extraData` if its callbacks read
        parent `styles`/`t`.
      - `theme.color.accent` stars stay `t.color.accent`. The `CreateLocationModal`/
        `LogFoodItemModal` accent text colours are rule-1 hue tokens, so they stay `accent`.

      Dark tests:
      - (a/b/c) in every owned screen, modal or sheet test above: all 21 except
        `MarkGottenUndoToast`.
      - The **Property 22 toast case** in `MarkGottenUndoToast.test.tsx`: dark background
        `#1f1235`, text `darkTheme.color.textOnPrimary`, the action text
        `darkTheme.color.accent`, and the outline border present.
      - **(d)** in `MyFoodListsScreen.test.tsx`: mount light → `setTestScheme('dark')` → a
        FlatList row colour equals the dark value.

      Strict guard: `$env:THEME_GUARD_STRICT='B3'`.
      Audit snapshot: `$env:TEMP\dark-mode-snapshot\B3\`. Audit: `… | node - B3 @files`.
      Files without a render test: `AddToTripOrListChoiceSheet`, `AddToTripPickerSheet`,
      `LogVisitModal`, `RestaurantDishLogCard`.
      Verify: C4–C7 green. Report at `w2-B3-report.md`.

## Batch B4 — Trip money & schedule (spec 9.4)

- [ ] B4.1 C1–C8 for:
      Owned source files: `screens/trips/{TripScheduleScreen, TripExpensesScreen,
      ExpenseFormModal, TripBalancesScreen, SettlementModal, RefundModal,
      ReceiptReviewModal}.tsx`.
      Owned tests, all under `src/screens/trips/__tests__/`:
      - `TripScheduleScreen.test.tsx` (also explicitly B4-owned)
      - `TripExpensesScreen.test.tsx`
      - `TripBalancesScreen.test.tsx`
      - `ReceiptReviewModal.test.tsx`

      Batch specifics:
      - These are the densest files: ~1,000 colour sites. `ExpenseFormModal` alone is
        3.9k lines with 16 `TextInput`s and 2 `Switch`es.
      - `TripExpensesScreen.tsx:945` `catMeta.fg + '33'`: rule 2a. The palette value is
        `#rrggbb` in both schemes, so list it in the report.
      - `Switch` pairs in `ExpenseFormModal` and `ReceiptReviewModal`.
      - `TripScheduleScreen` exports `getParkHoursDetails`/`getTodayWDW`, used by B2/B6.
        Their signatures must not change.
      - Many owned files carry unrelated uncommitted edits. That's exactly why the audit
        runs against the snapshot, not `HEAD`.

      Dark tests:
      - (a/b/c) in `TripScheduleScreen`, `TripExpensesScreen`, `TripBalancesScreen` and
        `ReceiptReviewModal`.
      - **(d)** in `TripScheduleScreen.test.tsx`. B4 has no `FlatList`, so use the
        memo-heavy schedule screen: mount light → `setTestScheme('dark')` → a rendered
        schedule item card's colour equals the dark value.

      Strict guard: `$env:THEME_GUARD_STRICT='B4'`.
      Audit snapshot: `$env:TEMP\dark-mode-snapshot\B4\`. Audit: `… | node - B4 @files`.
      Files without a render test: `ExpenseFormModal`, `SettlementModal`, `RefundModal`. If
      `TripExpensesScreen.test.tsx` opens `ExpenseFormModal`, add a (c) assertion for a modal
      element there. Otherwise list it as guard/screenshot-only.
      Verify: C4–C7 green. Report at `w2-B4-report.md`.

## Batch B5 — Trip shell (spec 9.5)

- [ ] B5.1 C1–C8 for:
      Owned source files: `screens/trips/{AttachedExperienceListsSection,
      AttachedFoodListsSection, ExperiencePicker, GroupFavoritesSection, ResortPickerModal,
      RodeWithConfirmScreen, TripDetailScreen, TripEditScreen, TripFeedScreen,
      TripGuestManagementModal, TripInviteScreen, TripMembersScreen, TripPlannedListScreen,
      TripReservationsScreen, TripsListScreen, TripSummaryScreen}.tsx`.
      Owned tests, under `src/screens/trips/__tests__/`:
      - `ExperiencePicker.test.tsx`
      - `TripDetailScreen.test.tsx`
      - `TripDetailScreen.experienceLists.test.tsx`
      - `TripDetailScreen.foodLists.test.tsx`
      - `TripEditScreen.test.tsx`
      - `TripFeedScreen.test.tsx`
      - `TripMembersScreen.test.tsx`
      - `TripPlannedListScreen.test.tsx`
      - `TripReservationsScreen.test.tsx`
      - `TripsListScreen.test.tsx`
      - `TripSummaryScreen.test.tsx`

      Batch specifics:
      - **Rule 1a, `TripReservationsScreen.tsx:1062,1079`.** `kindChipTextActive`/
        `dateChipTextActive` (`theme.color.surface` on a `primary` fill) →
        `t.color.textOnPrimary`. Name the sites in the report.
      - Rule 2a `` `${theme.color.X}NN` `` → `` `${t.color.X}NN` ``, verbatim, with X's role
        decided by rule 1a. Sites:
        - `AttachedExperienceListsSection.tsx:631–760` (5)
        - `AttachedFoodListsSection` (5)
        - `TripDetailScreen.tsx:787/816/917/1138` (4)
        - `GroupFavoritesSection.tsx:165/168` (2)
      - `TripDetailScreen.tsx:143` `color: theme.color.accent` sits in a module-scope card
        config array. Move the colour read into render, or a factory taking `t`; don't keep a
        module-scope colour.
      - `TripPlannedListScreen.tsx:1186` `'rgba(91, 42, 134, 0.10)'` →
        `withAlpha(t.color.primary, 0.10)`. The audit normalises it.
      - `ExperiencePicker`, `ResortPickerModal` and `TripGuestManagementModal` are imported
        by B4/B6. Their props must not change.
      - `ExperiencePicker.tsx` imports `{ theme, categoryVisual }`. Convert the bare reads.

      Dark tests:
      - (a/b/c) in all 11 owned test files' top-level screens.
      - The **Property 22 chip case** in `TripReservationsScreen.test.tsx`: an active
        kind/date chip's text `color === darkTheme.color.textOnPrimary` on a
        `darkTheme.color.primary` fill.
      - **(d)** in `TripsListScreen.test.tsx`: mount light → `setTestScheme('dark')` → a
        FlatList trip row colour equals the dark value.

      Strict guard: `$env:THEME_GUARD_STRICT='B5'`.
      Audit snapshot: `$env:TEMP\dark-mode-snapshot\B5\`. Audit: `… | node - B5 @files`.
      Files without a render test: `AttachedExperienceListsSection` and
      `AttachedFoodListsSection` (both rendered in `TripDetailScreen.{experienceLists,foodLists}`;
      add a (c) assertion there), `GroupFavoritesSection`, `ResortPickerModal`,
      `RodeWithConfirmScreen`, `TripGuestManagementModal`, `TripInviteScreen`.
      Verify: C4–C7 green. Report at `w2-B5-report.md`.

## Batch B6 — Home, Vault, pins UI, social (spec 9.6)

- [ ] B6.1 C1–C8 for:
      Owned source files:
      - `screens/home/`: `ActionDock.tsx`, `ExplorationPromptCard.tsx`,
        `HomeFavoritesSection.tsx`, `HomeScreen.tsx`, `ParkWaitPulse.tsx`,
        `UpcomingTripHero.tsx`
      - `screens/collection/CollectionScreen.tsx`
      - `screens/profile/`: `AttributionScreen.tsx`, `PinBoardScreen.tsx`,
        `PinCelebrationModal.tsx`, `PinDetailModal.tsx`, `PinShowcaseScreen.tsx`
      - `screens/share/`: `InboxScreen.tsx`, `SentSharesScreen.tsx`,
        `ShareComposerScreen.tsx`
      - `screens/notifications/NotificationCenterScreen.tsx`
      - **New:** `screens/profile/tierText.palette.ts`. It's not in the audit list, because
        it has no snapshot.

      Owned tests:
      - `src/screens/collection/__tests__/CollectionScreen.test.tsx`
      - `src/screens/home/__tests__/ExplorationPromptCard.test.tsx`
      - `src/screens/home/__tests__/HomeScreen.render.test.tsx`
      - `src/screens/notifications/__tests__/NotificationCenterScreen.test.tsx`
      - `src/screens/profile/__tests__/PinBoardScreen.test.tsx`
      - `src/screens/profile/__tests__/PinCelebrationModal.test.tsx`
      - `src/screens/profile/__tests__/PinShowcaseScreen.test.tsx`
      - **New:** `src/screens/profile/__tests__/PinDetailModal.tierText.test.tsx`

      Batch specifics:
      - **Rule 7.** Create `tierText.palette.ts` exactly as in the design:
        `TIER_TEXT = definePalette({ light: TIER_COLOR, dark: { ...TIER_COLOR, amethyst: '#c08ff5', bronze: '#e0965f' } })`.
        Use `usePalette(TIER_TEXT)[tier]` for every tier `Badge color`, `Text color` and
        `Ionicons color`. Sites:
        - `PinCelebrationModal.tsx:198`
        - `PinDetailModal.tsx:58`
        - `PinShowcaseScreen.tsx:846`
        - `CollectionScreen.tsx:667`

        Tier dots, fills and swatches keep `TIER_COLOR`:
        - `CollectionScreen.tsx:614/681`
        - `PinBoardScreen.tsx:398`

        `pinTierMeta.ts`, `PinView.tsx` and every `components/pins/**` file are not edited.
        That's artwork, rule 6. The pin gate isn't required, because no catalogue or motif
        file changes.
      - The `PinCelebrationModal.tsx:55` module-scope `CONFETTI_COLORS` array (theme reads +
        literals) becomes a palette or render-time array. It also has 4 `interpolate(` calls:
        any colour `outputRange` goes in a `useMemo([t])`.
      - `HomeFavoritesSection.tsx:135` `parkColor + '18'`: rule 2a. The park accent falls back
        to `primary`, and both are 6-digit hex. List it in the report.
      - `PinShowcaseScreen.tsx:1457` `'rgba(230,195,92,0.15)'` is non-token, so rule 3 applies
        (amber family, S role).
      - `PinBoardScreen` has a `React.memo` and a list.

      Dark tests:
      - (a/b/c) in `CollectionScreen`, `HomeScreen.render`, `NotificationCenterScreen`,
        `PinBoardScreen`, `PinCelebrationModal` and `PinShowcaseScreen`.
      - (c) in `ExplorationPromptCard`.
      - **(d)** in `NotificationCenterScreen.test.tsx`: mount light → `setTestScheme('dark')`
        → a FlatList notification row colour equals the dark value.
      - **Property 21** in the new `PinDetailModal.tierText.test.tsx`, tagged
        `// Feature: dark-mode, Property 21: pin tier UI text is legible while tier art is unchanged`.
        It uses fast-check over every `PinTier` (≥100 runs) and asserts:
        - in dark, the tier `Badge` text colour equals `TIER_TEXT.dark[tier]`;
        - in light it equals `TIER_COLOR[tier]`;
        - the rendered `PinView` art props are identical across schemes.

      Strict guard: `$env:THEME_GUARD_STRICT='B6'`.
      Audit snapshot: `$env:TEMP\dark-mode-snapshot\B6\`. Audit: `… | node - B6 @files`.
      Expected justified differences: `TIER_COLOR[*] → TIER_TEXT[*]` at the 4 text sites
      (rule 7).
      Files without a render test: `ActionDock`, `HomeFavoritesSection`, `ParkWaitPulse`,
      `UpcomingTripHero`, `AttributionScreen`, `InboxScreen`, `SentSharesScreen`,
      `ShareComposerScreen`. `PinDetailModal` gains the new test.
      Verify: C4–C7 green. Report at `w2-B6-report.md`.

## Batch B7 — Identity, stats, friends (spec 9.7)

- [ ] B7.1 C1–C8 for:
      Owned source files:
      - `screens/stats/`:
        - `CoverageDetailScreen.tsx`
        - `ExperiencesDetailScreen.tsx`
        - `FoodStatsScreen.tsx`
        - `InterestsDetailScreen.tsx`
        - `RatingsDetailScreen.tsx`
        - `StatsScreen.tsx`
        - `statsView.ts`
      - `screens/stats/components/`:
        - `CompletionStatTile.tsx`
        - `CoverageSection.tsx`
        - `CoverageStatGrid.tsx`
        - `FacetCoverageTile.tsx`
        - `HighlightCard.tsx`
        - `InterestsSection.tsx`
        - `LabeledCellList.tsx`
        - `OverallHeroCard.tsx`
        - `PercentileBanner.tsx`
        - `RatingsSection.tsx`
      - `screens/friends/`: `FriendProfileScreen.tsx`, `FriendsListScreen.tsx`,
        `FriendsSearchScreen.tsx`
      - `screens/navigation/`: `AvatarChip.tsx`, `CompactEmptyState.tsx`,
        `CompletionRow.tsx`, `ExperiencesList.tsx`, `GroupSection.tsx`, `TabSelector.tsx`
      - `screens/youAndCrew/YouAndCrewScreen.tsx`
      - `screens/`: `AvatarPicker.tsx`, `ChangePasswordControl.tsx`,
        `ForgotPasswordScreen.tsx`, `LoginScreen.tsx`, `ProfileScreen.tsx`,
        `PushNotificationPreferenceControl.tsx`, `RegisterScreen.tsx`,
        `ResetPasswordScreen.tsx`

      Owned tests:
      - Every file under `src/screens/stats/**/__tests__/` and
        `src/screens/stats/__testSupport__/`:
        - `__tests__/`: `badgeRemaining.prop`, `CoverageDetailScreen`,
          `distributionNormalization.prop`, `ExperiencesDetailScreen`, `FoodStatsScreen`,
          `highlightDerivation.prop`, `InterestsDetailScreen`, `orderingDeterminism.prop`,
          `percentDisplay.prop`, `RatingsDetailScreen`, `shareEntryPointEnablement.prop`,
          `shareProjectionStability.prop`, `StatsScreen.hub`
        - `components/__tests__/`: `CoverageSection`, `interestsHeroHighlightPercentile`,
          `RatingsSection`
        - `__testSupport__/statsFixture.ts`
      - `src/screens/catalog/__tests__/consumerSurfacesTaxonomy.test.ts`
      - `src/screens/catalog/__tests__/shareEntryPointProjection.prop.test.tsx`
      - `src/screens/friends/__tests__/`:
        - `FriendProfileScreen.{comparison.prop,comparison.states,modes,refetch,states}.test.tsx`
        - `FriendsListScreen.removeConfirmation.test.tsx`
        - `FriendsSearchScreen.test.tsx`
      - `src/screens/navigation/__tests__/`: `CompletionRow.test.tsx`,
        `CompletionRow.prop.test.tsx`, `ExperiencesList.test.tsx`,
        `GroupSection.prop.test.tsx`, `TabSelector.test.tsx`
      - `src/screens/youAndCrew/__tests__/YouAndCrewScreen.test.tsx`
      - `src/screens/__tests__/`: `ChangePasswordControl.test.tsx`,
        `ForgotPasswordScreen.test.tsx`, `ProfileScreen.test.tsx`,
        `PushNotificationPreferenceControl.test.tsx`, `ResetPasswordScreen.test.tsx`

      **Not owned** (stop-and-report if red):
      - `screens/friends/__tests__/{friendsListConsolidation,friendSelectionNavigation}.test.tsx`
      - `screens/navigation/__tests__/useViewMode.prop.test.ts`
      - `screens/navigation/__tests__/experienceDetailBackNavigation.*`

      Batch specifics:
      - **`statsView.ts` theme parameter.** Only the functions that embed colours, for
        example `buildParkTiles`/`buildCategoryTiles`, gain a trailing parameter
        `t: Pick<AppTheme, 'color' | 'parkAccent' | 'categoryVisual'>`. `AppTheme` is
        imported as a type from `../../theme/theme`, which the guard allows, since only the
        named per-scheme objects are forbidden. Callers pass `useAppTheme()`, and the owned
        tests pass `lightTheme`, imported in tests only (tests are outside the scan set).
        Functions with no colour keep their signatures, so
        `buildProgressShareParams` stays unchanged unless it reads colours.
      - `consumerSurfacesTaxonomy.test.ts` switches from `categoryVisual` to
        `categoryMeta`/`lightTheme`.
      - `AvatarChip.tsx` imports `{ color }`: convert its bare reads, for example
        `color.textOnPrimary` → `t.color.textOnPrimary`. `AvatarChip` is used by B6's
        `HomeScreen`, so its props must not change.
      - `AvatarPicker.tsx` renders `avatars/AvatarPresets.tsx` art. The art stays untouched
        (rule 6), and only the UI chrome converts.
      - The `PushNotificationPreferenceControl` `Switch` gets a palette pair.
      - 17 `TextInput`s across the auth screens and controls. Auth screens sit on themed
        backgrounds unless a gradient hero is present, so apply the default-text rule per
        element.

      Dark tests:
      - (a/b/c) in `CoverageDetailScreen`, `ExperiencesDetailScreen`, `FoodStatsScreen`,
        `InterestsDetailScreen`, `RatingsDetailScreen`, `StatsScreen.hub`,
        `FriendProfileScreen.states`, `FriendsSearchScreen`, `YouAndCrewScreen`,
        `ForgotPasswordScreen` and `ResetPasswordScreen`.
      - (c) in `CoverageSection`, `RatingsSection`, `CompletionRow`, `ExperiencesList`,
        `TabSelector`, `ChangePasswordControl`, `PushNotificationPreferenceControl` and
        `ProfileScreen` (`ProfileIdentityBlock`).
      - **(d)** in `FriendsListScreen.removeConfirmation.test.tsx`: mount light →
        `setTestScheme('dark')` → a FlatList friend row colour equals the dark value.
      - A `statsView` unit assertion: `buildCategoryTiles(…, darkTheme)` yields
        `darkTheme.categoryVisual[k].tint`. Use `.fill` instead only if the tile is a solid
        fill behind white, per rule 1.

      Strict guard: `$env:THEME_GUARD_STRICT='B7'`.
      Audit snapshot: `$env:TEMP\dark-mode-snapshot\B7\`. Audit: `… | node - B7 @files`.
      Add `src/screens/stats/`, `src/screens/catalog/__tests__/consumerSurfacesTaxonomy` and
      `src/screens/catalog/__tests__/shareEntryPointProjection` to C5's `$pats`.
      Files without a render test: `CompletionStatTile`, `CoverageStatGrid`,
      `FacetCoverageTile`, `HighlightCard`, `InterestsSection`, `LabeledCellList`,
      `OverallHeroCard`, `PercentileBanner`, `statsView.ts` (unit-tested), `AvatarChip`,
      `CompactEmptyState`, `AvatarPicker`, `LoginScreen`, `RegisterScreen`.
      Verify: C4–C7 green. Report at `w2-B7-report.md`.

## After all seven batches are APPROVED (existing `integrate` → `visual-and-final` steps)

- [ ] I1. Integrate (spec 10.1, 10.2):
      - Confirm every `w2-B*-report.md` exists, then apply any stop-and-report kit or shared
        changes serially.
      - Tick `.kiro/specs/dark-mode/tasks.md` 8.6 (baseline above) and 9.1–9.7.
      - Remove the legacy exports, `PENDING_RETROFIT` and `THEME_GUARD_STRICT`, and make the
        end-state assertion unconditional.
      - Update the `tech-conventions.md` Mobile bullet.
      - Delete `$env:TEMP\dark-mode-snapshot\` and `$env:TEMP\dark-mode-audit\`.
      - Re-run the spec validator.
      Verify: `npm run typecheck` green, and the guard green
      (`npx jest src/__tests__/themeRetrofit.guard.test.ts` in `apps/mobile`).
- [ ] I2. Visual verification (spec 11) on `Pixel_7`: the full light/dark checklist into
      `.agents/tasks/dark-mode-retrofit/screenshots/`. Fix findings in the owning file.
- [ ] I3. Run the final gate (spec 12) **once**: `npm run verify`. Paste the literal tail
      with per-workspace counts and exit code 0, then run `git status` for stray files.

## Gaps and assumptions

- **No visibility into the downstream loops.** The parallel `w2-batches` branches already
  exist, and I couldn't see their verdict-file paths from `inspect_workflow`, because pending
  children aren't expanded. I assume each loop's reviewer uses its own configured
  per-batch verdict path. This plan doesn't redefine those paths.
- **Line references are from the design.** References such as `:1177` or `:2262` come from
  design-time line numbers. Uncommitted edits may have shifted them by a few lines, so locate
  each site by its content.
- **The audit script is broader than the design text in one way.** It strips comments,
  which the design's audit text doesn't specify. The guard already forces hex in trailing
  comments to be reworded, so those show up as listed differences. Hex in full-line comments
  is ignored on both sides. This is a superset-safe choice, and it's documented in the script
  header.

## Appendix A — canonical audit script (`$env:TEMP\dark-mode-audit\audit.cjs`)

Recreate it **only** if the TEMP copy is missing, at that same path, outside the repo. Run it
from the repo root: `Get-Content "$env:TEMP\dark-mode-audit\audit.cjs" -Raw | node - <B> @files`.
`DM_AUDIT_SNAPSHOT_DIR` overrides the snapshot root. It defaults to
`%TEMP%\dark-mode-snapshot\<B>`.

```js
// Light-colour multiset audit (design.md "Per-batch definition of done" item 2).
// Run from the REPO ROOT via stdin so nothing is written to the repo:
//   Get-Content "$env:TEMP\dark-mode-audit\audit.cjs" -Raw | node - B4 screens/trips/TripScheduleScreen.tsx ...
// argv: <batchId> <rel paths under apps/mobile/src ...>
// Snapshot of each file must exist at %TEMP%\dark-mode-snapshot\<batchId>\<rel path>
// (override the root with env DM_AUDIT_SNAPSHOT_DIR).
// Superset note: comments (block, full-line //, JSDoc lines) are stripped on both sides.
// Exit 0 = every file PASS; exit 1 = differences (each must be justified in the report).
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const esbuild = require('esbuild');

const [batch, ...rels] = process.argv.slice(2);
if (!batch || rels.length === 0) {
  console.error('usage: node - <batchId> <rel path> [...]');
  process.exit(2);
}
const SRC = path.resolve('apps/mobile/src');
const SNAP = process.env.DM_AUDIT_SNAPSHOT_DIR || path.join(os.tmpdir(), 'dark-mode-snapshot', batch);

// ---------- loader (esbuild transform + custom require) ----------
const cache = new Map();
function resolveRel(fromDir, spec) {
  const base = path.resolve(fromDir, spec);
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  throw new Error(`audit loader: cannot resolve ${spec} from ${fromDir}`);
}
function load(abs) {
  if (cache.has(abs)) return cache.get(abs).exports;
  const src = fs.readFileSync(abs, 'utf8');
  const { code } = esbuild.transformSync(src, { loader: abs.endsWith('x') ? 'tsx' : 'ts', format: 'cjs' });
  const mod = { exports: {} };
  cache.set(abs, mod);
  const req = (spec) => {
    if (spec.startsWith('.')) return load(resolveRel(path.dirname(abs), spec));
    if (spec === 'react-native') return { StyleSheet: { hairlineWidth: 1, create: (s) => s } };
    return {};
  };
  new Function('require', 'module', 'exports', code)(req, mod, mod.exports);
  return mod.exports;
}
const themeMod = load(path.join(SRC, 'theme/theme.ts'));
const LT = themeMod.lightTheme;
const withAlpha = themeMod.withAlpha;

// ---------- extraction ----------
const GROUPS = 'color|gradient|shadow|parkAccent|categoryVisual|resortVisual';
const GROUP_SET = new Set(GROUPS.split('|'));
const HEX_RE = /(['"`])#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\1/g;
const RGB_LIT_RE = /rgba?\([^)]*\)/g;
const STATIC_IMPORT_RE = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"](?:\.\.?\/)+(?:theme\/)?theme['"]/g;
const PALETTE_IMPORT_RE = /import\s+\{([^}]*)\}\s*from\s*['"]([^'"]+\.palette)['"]/g;
const ALIAS_RE = /const\s+(\w+)\s*=\s*(?:usePalette\((\w+)\)|(\w+)\[t\.scheme\])\s*(?:;|$)/gm;
const WITHALPHA_RE = new RegExp(`withAlpha\\(\\s*t\\.((?:${GROUPS})(?:\\.\\w+)+)\\s*,\\s*(\\d*\\.?\\d+)\\s*\\)`, 'g');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function stripComments(s) {
  const blank = (x) => x.replace(/[^\n]/g, ' ');
  let out = s.replace(/\/\*[\s\S]*?\*\//g, blank);
  out = out.replace(/^[ \t]*\/\/.*$/gm, blank);
  out = out.replace(/^[ \t]*\*.*$/gm, blank);
  return out;
}
function norm(v) {
  let s = String(v).trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(s)) s = '#' + [...s.slice(1)].map((c) => c + c).join('');
  else if (/^#[0-9a-f]{4}$/.test(s)) s = '#' + [...s.slice(1)].map((c) => c + c).join('');
  const m = s.match(/^rgba?\(([^)]*)\)$/);
  if (m) {
    const parts = m[1].split(',').map((p) => p.trim());
    const nums = parts.map(Number);
    if ((parts.length === 3 || parts.length === 4) && nums.every((n) => Number.isFinite(n))) {
      if (parts.length === 3) nums.push(1);
      s = `rgba(${nums.join(',')})`;
    } else s = s.replace(/\s+/g, '');
  }
  return s;
}
function resolveLT(group, pathStr) {
  let v = LT[group];
  for (const seg of pathStr.split('.').filter(Boolean)) {
    if (v == null) break;
    v = v[seg];
  }
  return v;
}
function contribute(out, v, label) {
  if (typeof v === 'string') out.push(norm(v));
  else if (Array.isArray(v)) v.forEach((x) => contribute(out, x, label));
  else if (v && typeof v === 'object' && typeof v.shadowColor === 'string') out.push(norm(v.shadowColor));
  else if (v === undefined) out.push(`UNRESOLVED(${label})`);
  // other objects (e.g. outline.card, textDefault) contribute no light colour
}

function extract(absReal, source) {
  const text = stripComments(source);
  const out = [];
  // literals
  for (const m of text.matchAll(HEX_RE)) out.push(norm(m[0].slice(1, -1)));
  for (const m of text.matchAll(RGB_LIT_RE)) out.push(norm(m[0]));
  // theme imports (legacy names + `theme as Alias`)
  const themeNames = ['theme'];
  const bare = []; // [local, group]
  for (const m of text.matchAll(STATIC_IMPORT_RE)) {
    for (let spec of m[1].split(',')) {
      spec = spec.trim().replace(/^type\s+/, '');
      if (!spec) continue;
      const mm = spec.match(/^(\w+)(?:\s+as\s+(\w+))?$/);
      if (!mm) continue;
      const [, name, alias] = mm;
      if (name === 'theme' && alias) themeNames.push(alias);
      if (GROUP_SET.has(name)) bare.push([alias || name, name]);
    }
  }
  // numeric withAlpha(t.<path>, a): contributes only its rgba value; remove spans
  let rest = text.replace(WITHALPHA_RE, (full, p, a) => {
    const [group, ...segs] = p.split('.');
    const base = resolveLT(group, segs.join('.'));
    out.push(typeof base === 'string' ? norm(withAlpha(base, Number(a))) : `UNRESOLVED(withAlpha ${p})`);
    return ' '.repeat(full.length);
  });
  // computed reads (symbolic) — before dotted reads so spans don't overlap
  for (const tn of [...themeNames, 't']) {
    const re = new RegExp(`\\b${esc(tn)}\\.(\\w+)\\[[^\\]]+\\]((?:\\.\\w+)*)`, 'g');
    rest = rest.replace(re, (full, g, p) => {
      if (GROUP_SET.has(g)) out.push(`${g}[*]${p}`);
      return GROUP_SET.has(g) ? ' '.repeat(full.length) : full;
    });
  }
  for (const [local, group] of bare) {
    const re = new RegExp(`(?<![\\w.])${esc(local)}\\[[^\\]]+\\]((?:\\.\\w+)*)`, 'g');
    rest = rest.replace(re, (full, p) => { out.push(`${group}[*]${p}`); return ' '.repeat(full.length); });
  }
  rest = rest.replace(/\bTIER_COLOR\[[^\]]+\]/g, (full) => { out.push('TIER_COLOR[*]'); return ' '.repeat(full.length); });
  // dotted token reads
  for (const tn of [...themeNames, 't']) {
    const re = new RegExp(`\\b${esc(tn)}\\.(${GROUPS})((?:\\.\\w+)+)`, 'g');
    for (const m of rest.matchAll(re)) contribute(out, resolveLT(m[1], m[2]), `${tn}.${m[1]}${m[2]}`);
  }
  for (const [local, group] of bare) {
    const re = new RegExp(`(?<![\\w.])${esc(local)}((?:\\.\\w+)+)`, 'g');
    for (const m of rest.matchAll(re)) contribute(out, resolveLT(group, m[1]), `${local}${m[1]}`);
  }
  // palette reads (palette modules resolved relative to the REAL file location)
  const palettes = new Map(); // local -> ThemedPalette
  for (const m of text.matchAll(PALETTE_IMPORT_RE)) {
    let mod;
    try { mod = load(resolveRel(path.dirname(absReal), m[2])); } catch (e) { out.push(`UNRESOLVED(palette ${m[2]})`); continue; }
    for (let spec of m[1].split(',')) {
      spec = spec.trim();
      const mm = spec.match(/^(\w+)(?:\s+as\s+(\w+))?$/);
      if (mm && mod[mm[1]] && mod[mm[1]].light) palettes.set(mm[2] || mm[1], mod[mm[1]]);
    }
  }
  const aliases = new Map(); // alias -> palette local name
  for (const m of text.matchAll(ALIAS_RE)) {
    const p = m[2] || m[3];
    if (palettes.has(p)) aliases.set(m[1], p);
  }
  for (const [pn, pal] of palettes) {
    const forms = [`usePalette\\(${esc(pn)}\\)`, `\\b${esc(pn)}\\[t\\.scheme\\]`];
    for (const f of forms) {
      rest = rest.replace(new RegExp(`${f}\\[[^\\]]+\\]`, 'g'), (full) => { out.push(`${pn}[*]`); return ' '.repeat(full.length); });
      for (const m of rest.matchAll(new RegExp(`${f}\\.(\\w+)`, 'g'))) {
        const v = pal.light[m[1]];
        out.push(v === undefined ? `UNRESOLVED(${pn}.${m[1]})` : norm(v));
      }
    }
  }
  for (const [al, pn] of aliases) {
    const pal = palettes.get(pn);
    rest = rest.replace(new RegExp(`(?<![\\w.])${esc(al)}\\[[^\\]]+\\]`, 'g'), (full) => { out.push(`${pn}[*]`); return ' '.repeat(full.length); });
    for (const m of rest.matchAll(new RegExp(`(?<![\\w.])${esc(al)}\\.(\\w+)`, 'g'))) {
      const v = pal.light[m[1]];
      out.push(v === undefined ? `UNRESOLVED(${al}.${m[1]})` : norm(v));
    }
  }
  return out;
}

function counts(arr) {
  const m = new Map();
  for (const x of arr) m.set(x, (m.get(x) || 0) + 1);
  return m;
}

let failed = 0;
for (const rel of rels) {
  const real = path.join(SRC, rel);
  const snap = path.join(SNAP, rel);
  if (!fs.existsSync(snap)) { console.log(`MISSING-SNAPSHOT ${rel} (${snap})`); failed++; continue; }
  const before = counts(extract(real, fs.readFileSync(snap, 'utf8')));
  const after = counts(extract(real, fs.readFileSync(real, 'utf8')));
  const diffs = [];
  for (const k of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(k) || 0, a = after.get(k) || 0;
    if (a !== b) diffs.push(`    ${k}: before ${b}, after ${a}`);
  }
  const unresolved = [...after.keys(), ...before.keys()].filter((k) => k.startsWith('UNRESOLVED'));
  const total = [...before.values()].reduce((s, n) => s + n, 0);
  if (diffs.length === 0) console.log(`PASS ${rel} (${total} light colours)`);
  else { failed++; console.log(`DIFF ${rel}\n${diffs.sort().join('\n')}`); }
  if (unresolved.length) console.log(`    note: unresolved reads ${[...new Set(unresolved)].join(', ')}`);
}
console.log(failed === 0 ? `AUDIT PASS (${rels.length} files)` : `AUDIT: ${failed} file(s) with differences — justify each in the report`);
process.exit(failed === 0 ? 0 : 1);
```
