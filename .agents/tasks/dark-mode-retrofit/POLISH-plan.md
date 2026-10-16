# Dark-Mode ("Twilight") Polish Pass — Implementation Plan

Planner output for workflow `wf_f412c7549a14b47b`. The build loop implements items 1–14. The
`visual-verify` step runs item 15. The `finalize` step runs item 16. Every path below was read
during planning. Line numbers are approximate, so re-grep the symbol before editing.

## Binding rules (coder and reviewer both enforce these)

1. **Light renders exactly as today.** Change dark values and selected-state wiring only. Every
   new palette key's `light` value is the literal that renders today, byte-identical (e.g. `'#ffffff'`
   where the code reads `t.color.surface` in light). Never change an existing `light:` value.
   Never recolour pin artwork or avatar art.
2. **Pattern.** Styles use `makeStyles((t) => …)` and inline values use `useAppTheme()`. One-off colours
   go in the co-located `*.palette.ts` via `definePalette({ light, dark })`, with `dark` built from
   `darkColor.*` / `darkTheme.*` / `DARK_TONAL.*`. `src/__tests__/themeRetrofit.guard.test.ts` must stay green
   with **no new allowlist entries**.
3. **Contrast.** Dark text pairs need ≥ 4.5:1 and selected indicators / non-text marks need ≥ 3:1. Every new pair goes
   into `apps/mobile/src/theme/contrast.ts` `CONTRAST_REQUIREMENTS` (item 13), so
   `theme/__tests__/contrast.prop.test.ts` (Property 9) checks it. Planning computed every ratio
   quoted below (WCAG 2.x).
4. **Dependencies.** No new dependency, with **one user-approved exception: `expo-system-ui`**
   (item 11 only). Install it with `npx expo install expo-system-ui` from `apps/mobile`, then pin it
   **exact** in `apps/mobile/package.json` (SDK 56's `bundledNativeModules.json` lists
   `~56.0.5`, so write the exact resolved version, e.g. `"56.0.5"`, with no `^`/`~`). Do **not** add
   `expo-navigation-bar` or anything else.
5. **Work in place.** No worktree and no commits. The tree holds many uncommitted changes (the whole
   retrofit plus earlier unrelated work), so edit only the lines you need and never revert or reformat
   unrelated code. Touch only `apps/mobile/**` and, additively, `.kiro/specs/dark-mode/**`. Do not touch
   `apps/api` or `packages/shared`. The `package-lock.json` change from item 11's install is
   expected.
6. **Tests.** Use Jest (jest-expo) with `@testing-library/react-native`, **never Vitest**. Every fix gets a test
   that flips the store with `setTestScheme('dark')` (`src/test/themeTestUtils.ts`, plus
   `afterEach(resetTestScheme)`), asserts the **real rendered** style or prop, and **would fail
   without the fix**. Mock only the network/query layer and AsyncStorage (the automock is already in place).
   **Anti-tautology rule:** a regression assertion must compare against a theme token
   (`darkTheme.color.textSecondary`), a light value (`RESORTS.light.tierDeluxe`), or a relation
   (`not.toBe(active)`). It must **never** compare against the same palette key it is fixing
   (`expect(x).toBe(LOCATION.dark.briefSub)` passes before and after, so it guards nothing).
   Existing tests written that way may stay, but each fix also needs a non-tautological assertion.
7. **Verification tiers** (execution-discipline steering): while iterating, run `npx jest <file>` and
   `npm run typecheck` in `apps/mobile`. When the area is done, run `npm run verify:mobile` once.
   Run the full `npm run verify` **once**, at the end (item 14), and paste its literal tail and exit code.

## Root-cause notes from planning (confirmed on `emulator-5554`, gesture nav)

- **Fix 11 (white strip below content).** Reproduced on You & Crew in Dark. Pixels at y 2337–2400 are
  `#ffffff`, and content directly above is `#120a1f`. A `uiautomator` dump shows
  `android:id/content` and the whole React root (`you-and-crew-screen`) bounded at
  **`[0,136][1080,2337]`**. Expo Go's `ExperienceActivity` does not lay the React root view out under the
  navigation bar, so the strip is the **native window/decor background showing through the
  transparent gesture-nav bar**. No JS view (ScreenContainer, ScrollView, native-stack `contentStyle`,
  SafeAreaProvider) can paint outside the root view, so an in-JS fix cannot work. Tab screens look
  fine only because the tab bar's bottom inset paints dark *inside* the root, above y=2337. That
  justifies `expo-system-ui` `setBackgroundColorAsync`, which sets the window/root-view background
  natively. Today's light strip is `#ffffff`, so light keeps `#ffffff`.
- **Fix 12.** The same screenshot shows the Push notifications Switch with a blue platform thumb on a
  purple track in dark, because `PushNotificationPreferenceControl.tsx` sets only `trackColor`.
- **Fix 8 premise correction.** `TripDetailScreen`'s rendered tool tiles already read
  `t.color.*` / `usePalette(HUB_TILE)` and follow dark. They are asserted in
  `TripDetailScreen.test.tsx`'s dark describe. The defect B5-1 flagged is narrower: the exported
  `HUB_SECTIONS[].color` is built from `HUB_SECTION_COLOR.light.*` at module scope, so any consumer of
  that contract gets light colours. Nothing renders it today. Item 8 makes the contract
  scheme-aware without changing the snapshot.
- **Fix 9.** A scan of every `<TextInput` in non-test `apps/mobile/src/**/*.tsx` found exactly two
  without `keyboardAppearance`: `ExpenseFormModal.tsx` ~1734 (`tier-count-${tIdx}-${p.id}`, matrix
  view) and ~1851 (the same testID, cards view). There are no others.
- **Switch inventory (fix 12).** There are six: `PushNotificationPreferenceControl.tsx:213`,
  `catalog/NoteControl.tsx:281`, `trips/ExpenseFormModal.tsx:1990` (item alcohol), `:2106` (discount
  exclude-alcohol), `trips/ReceiptReviewModal.tsx:485` (item alcohol), `:600` (charge exclude-alcohol).

---

# Implementation Plan

- [ ] 1. **Spec amendment first (additive only), so the code changes are backed by requirements.**
      Add the polish behaviours to `.kiro/specs/dark-mode/`. Do not renumber or delete anything, and do not
      change any checkbox state.
      - `requirements.md`, Requirement 9: append criteria **12–15** after the existing 11.
        - 9.12: WHILE dark, a selected/active indicator SHALL differ from the unselected state, reach
          ≥ 3:1 against its surface, and an active tab/pill label SHALL NOT be dimmer than the idle label.
        - 9.13: WHILE dark, muted secondary copy (the light neutral `#655d78` band) SHALL use
          `textSecondary`, and the near-black heading/name/ink text in the same component SHALL use
          `textPrimary`.
        - 9.14: Badges and overlays drawn on a photo SHALL keep the same fill in both schemes.
        - 9.15: WHILE dark, every React Native `Switch` SHALL receive token-derived `trackColor`
          (false/true), `thumbColor` and `ios_backgroundColor`. WHILE light, it SHALL receive exactly
          today's props, and it SHALL remount on a scheme switch.
      - `requirements.md`, Requirement 6: append the next criterion number after the last existing one
        (verify it; it's expected to be 6.5). WHEN the Active theme changes, THE App SHALL set the
        native window/root-view background (visible behind the Android navigation bar) to the
        Active theme's value: light `#ffffff` (today's), dark `background` `#120a1f`.
      - `design.md`:
        - Add a "Polish-pass rulings" subsection after the literal conversion rules. Record the
          decisions listed under item 10 below as design rulings: B1-1, B2-1, B3-N1/B4-6, the B7
          `#3d1c5c` rule, the `#655d78` band rule, the on-photo rule and the Switch pattern.
        - Add `### Property 23: Dark Selected States and Text Hierarchy Are Preserved`
          (**Validates:** Requirements 9.12, 9.13, 9.14).
        - Add `### Property 24: Every Switch Is Themed in Dark and Unchanged in Light`
          (**Validates:** Requirement 9.15).
        - Add `### Property 25: The Native Window Background Follows the Active Theme`
          (**Validates:** Requirement 6.5).
        - Amend External Interfaces additively: `expo-system-ui`
          `setBackgroundColorAsync(color): Promise<void>` is now used, by user approval, which supersedes the
          earlier "native dependency out of scope" note for this one module. `expo-navigation-bar` is still
          out.
        - Add Configuration & Constants rows for the system window background (light `#ffffff`,
          dark `#120a1f`) and for the dark Switch tokens (item 12).
      - `tasks.md`: add `- [ ] 13. Dark-mode polish pass` with sub-tasks 13.1–13.5 mirroring items 2–13
        of this plan, each with a `_Requirements:_` line. Add wave `{ "id": 30, "tasks": ["13.1", …] }`
        to the Task Dependency Graph JSON. Leave task 11 unchecked; the visual-verify step decides it.
      - Files: `.kiro/specs/dark-mode/requirements.md`, `design.md`, `tasks.md`
      - Verify: re-read all three files. Checkboxes are only `- [ ]`/`- [x]`. Every new property has a
        `**Validates:**` line naming existing criteria. No existing number changed: `git diff` on these files
        shows only additions (`+` lines).

- [ ] 2. **Fix 1: ParkWaitPulse selected-park ring (B6-2).**
      - `ParkWaitPulse.palette.ts`: set `PARK_WAIT_PULSE.dark.activeBorder` to `DARK_TONAL.green.fg`
        (`#4cc38a`). Its contrast is 7.91:1 vs `surface` and 3.70:1 vs the unselected
        `pillBorder` `DARK_TONAL.violet.border`. Keep `activeShadow` at `'#000000'` and keep light
        `#22c55e`/`#22c55e`. `pillActive` in `ParkWaitPulse.tsx` already reads the key, so no `.tsx` change is needed.
      - Test: create `screens/home/__tests__/ParkWaitPulse.dark.test.tsx`.
        - Render `<ParkWaitPulse activePark="Magic Kingdom" />` in a `QueryClientProvider`, with
          `jest.mock('../../../api/client')` returning a live-waits payload shaped like the one in
          `HomeScreen.render.test.tsx`, and `jest.mock('../../../navigation/navigationRef')`.
        - In dark, assert that `home-pulse-pill-Magic Kingdom`'s flattened `borderColor` is
          `DARK_TONAL.green.fg` and `borderWidth` is 2.
        - Assert that `home-pulse-pill-EPCOT`'s `borderColor` is `DARK_TONAL.violet.border` and differs from the active one.
        - In light, assert the active pill is `'#22c55e'`.
      - Files: `apps/mobile/src/screens/home/ParkWaitPulse.palette.ts`, the new test
      - Verify: `npx jest src/screens/home` in `apps/mobile` passes. The new dark assertion fails if the
        palette edit is reverted.

- [ ] 3. **Fix 2: ShareComposer unselected recipient icon (B6-1).**
      - `ShareComposerScreen.palette.ts`: set `SHARE_COMPOSER.dark.unselectedIcon` to
        `darkColor.textSecondary` (`#b3a8c9`, 7.81:1 on `surface`). Import `darkColor` and drop the
        now-unused `DARK_TONAL` import. Light stays `'#cdbce6'`.
      - Test: create `screens/share/__tests__/ShareComposerScreen.dark.test.tsx`.
        - Reuse the render harness and `/me/friends` mock from `composerStates.test.tsx`.
        - In dark, before selecting anyone, the row's `Ionicons` (via `within(row).UNSAFE_getByType(Ionicons)`)
          has `name: 'ellipse-outline'` and `color` equal to `darkTheme.color.textSecondary`.
        - `fireEvent.press` the row. Assert `name: 'checkmark-circle'`, `color` equal to
          `darkTheme.color.primaryFg`, and that the two colours differ.
        - Also assert the selected Card background is `darkTheme.color.surfaceAlt` (B6-4 coverage).
      - Files: `apps/mobile/src/screens/share/ShareComposerScreen.palette.ts`, the new test
      - Verify: `npx jest src/screens/share` passes.

- [ ] 4. **Fix 3 + B4-4 (Balances half): segmented tab/toggle emphasis in Expenses and Balances (B4-1).**
      - `TripExpensesScreen.palette.ts` `EXPENSES`:
        - Add key `tabActiveBg`, light `'#ffffff'` (today's `t.color.surface`) and dark
          `darkColor.borderStrong` (`#4a3a6b`, lighter than the `surfaceAlt` track).
        - Change `dark.tabIdleText` to `darkColor.textSecondary`.
      - `TripExpensesScreen.tsx` `tabButtonActive.backgroundColor`: change `t.color.surface` to `EXPENSES[t.scheme].tabActiveBg`.
      - The resulting pairs:
        - active label/icon `primaryFg` on `#4a3a6b`: 4.76
        - active badge `primaryFg` on `violet.tint`: 6.12
        - idle label `textSecondary` on `surfaceAlt`: 6.92
        - idle badge `textSecondary` on `violet.tint`: 5.71
      - `TripBalancesScreen.palette.ts` `BALANCES` has the same inversion:
        - Add `toggleActiveBg` (light `'#ffffff'`, dark `darkColor.borderStrong`).
        - Change `dark.inkText` to `darkColor.textPrimary` (8.75:1 on `#4a3a6b`). This also covers B4-4's
          `memberName`.
        - In `TripBalancesScreen.tsx` `toggleBtnActive`, read `BALANCES[t.scheme].toggleActiveBg`.
      - `EXPENSES.dark.indigoText` changes to `darkColor.textPrimary` (B4-4: `flowPartyName`/`memberName` are
        name ink, not accent).
      - Tests:
        - `TripExpensesScreen.test.tsx` dark describe: add a case.
          - Assert `tab-expenses-btn` background is `darkTheme.color.borderStrong`.
          - Assert the idle tab's text (`within(getByTestId('tab-balances-btn')).getByText('Who Owes What')`)
            has colour `darkTheme.color.textSecondary`.
          - Assert the active label is `darkTheme.color.primaryFg`.
          - Assert the idle and active label colours differ.
          - Press `tab-balances-btn` and assert the emphasis swaps.
        - In light, assert the active pill is `'#ffffff'` and the idle text is `'#655d78'`.
        - `TripBalancesScreen.test.tsx` dark describe: assert the active toggle background is
          `darkTheme.color.borderStrong` and the active label is `darkTheme.color.textPrimary`, and that each differs
          from the idle values.
      - Files: `screens/trips/TripExpensesScreen.palette.ts`, `TripExpensesScreen.tsx`,
        `TripBalancesScreen.palette.ts`, `TripBalancesScreen.tsx`, both test files
      - Verify: `npx jest src/screens/trips/__tests__/TripExpensesScreen.test.tsx src/screens/trips/__tests__/TripBalancesScreen.test.tsx`.

- [ ] 5. **Fix 4 + Fix 9: ExpenseFormModal tier count pills and the two missing `keyboardAppearance` (B4-2, B4-5).**
      - `ExpenseFormModal.palette.ts` `FORM`: add `tierPillActiveBg` (light `'#f5effa'`, dark
        `DARK_TONAL.violet.tint`) and `tierPillActiveBorder` (light `'#bca5db'`, dark
        `darkColor.primaryFg`). Contrast is 6.12:1 vs the pill tint and 8.37:1 vs `surface`.
      - In `ExpenseFormModal.tsx` `tierCountPillCardActive` only (~3533), read the new keys. Keep the
        other `quickActionBg`/`violetBorderActive` sites (~3225, ~3314, ~3469) untouched.
      - In both `tiers.map((t, tIdx) => {…})` callbacks that hold the TextInputs (~1703 matrix rows,
        ~1824 cards), rename the shadowing parameter `t` to `tier` and update the body's references
        (`tier.name`, `tier.priceCents`, the `accessibilityLabel`s). Then add
        `keyboardAppearance={t.scheme}` to both `TextInput`s.
      - Add `testID={\`tier-count-pill-${tIdx}-${p.id}\`}` to the cards-view pill `View` (~1828).
        Adding a testID has no visual effect.
      - Leave the header map at ~1648 alone (no TextInput).
      - Test (`TripExpensesScreen.test.tsx` dark describe):
        - Open the form, press `split-mode-chip-tiered` (the default view is matrix), and assert
          `getByTestId('tier-count-0-user-1').props.keyboardAppearance === 'dark'`.
        - Press `tier-view-toggle-cards` and assert the same on the cards-view input.
        - Press `tier-count-inc-0-user-1`. Assert `tier-count-pill-0-user-1` `borderColor` is
          `darkTheme.color.primaryFg`, and `tier-count-pill-1-user-1` (inactive) is
          `DARK_TONAL.violet.border` and differs from it.
        - In light, assert the active pill is `'#bca5db'`/`'#f5effa'`.
      - Files: `screens/trips/ExpenseFormModal.palette.ts`, `ExpenseFormModal.tsx`, `TripExpensesScreen.test.tsx`
      - Verify: `npx jest src/screens/trips/__tests__/TripExpensesScreen.test.tsx` and `npm run typecheck`
        in `apps/mobile`. Typecheck matters because of the parameter rename.

- [ ] 6. **Fix 6 + B2-3: restore dark text hierarchy (B1-2, B2-3).**
      The rule is the same everywhere: the light neutral `#655d78` band goes to `darkColor.textSecondary` /
      `darkTheme.color.textSecondary`, and the near-black `#190c2d`/`#372f4a`/`#4a3f60` ink *in the same
      component* goes to `textPrimary`. Edit these `dark:` values only:
      - `catalog/ResortGuideSection.palette.ts` `RESORT_GUIDE`: `heading`, `body` and `modalBody` to
        `darkTheme.color.textPrimary`; `bodyMuted` to `darkTheme.color.textSecondary`.
      - `catalog/LocationGroupSection.palette.ts` `LOCATION`: `briefTitle` to `textPrimary`; `briefSub` to
        `textSecondary`.
      - `catalog/LensSwitcher.palette.ts` `LENS`: `inactiveIcon` and `inactiveText` to `textSecondary`. The active
        `primaryFg` is then brighter than idle.
      - `catalog/LiveWaitCockpit.palette.ts` `COCKPIT`: `mutedText` to `textSecondary`; `inkText` to `textPrimary`.
      - `catalog/PassportAndLoreLens.palette.ts` `LORE`: `mutedText` to `textSecondary`; `inkText` to `textPrimary`.
      - `catalog/DiningReservationCard.palette.ts` `DINING`: `mutedText` to `textSecondary`; `inkText` to `textPrimary`.
      - `catalog/ParkPassportCard.palette.ts` `PASSPORT`: `tipClose` to `textSecondary`.
      - Left as-is, with a recorded reason: `QuickSpecsRow.specText` and `ShowtimesCard.title/futureText`
        (`#190c2d`, now `violet.fg`) have no muted sibling in their component, so they have no hierarchy to
        flatten. `LORE.tagPillText`-style violet text on violet tints is the accent role.
      - Tests: add a non-tautological assertion to the existing dark case in each file below. Use the
        `darkTheme.color.textPrimary` / `textSecondary` tokens and assert heading ≠ muted.
        - `ResortGuideSection.test.tsx` (~1062): 'Property Highlights & Atmosphere' is `textPrimary`, plus one
          `bodyMuted` text node is `textSecondary`.
        - `LocationGroupSection.test.tsx` (~271): `briefTitle` is `textPrimary`; 'EPCOT • Landmark Navigation' is
          `textSecondary`.
        - `DiningReservationCard.test.tsx` (~150).
        - `FloatingActionDock.test.tsx` (~414/418, LORE).
        - LensSwitcher and Cockpit: grep `LENS.dark\|COCKPIT.dark` under `src/screens/catalog/__tests__` and
          extend that test. If none exists, add a dark case to the ExperienceDetail test that renders the lens
          switcher: the inactive lens label is `textSecondary` and the active one is `primaryFg`.
      - Files: the 7 palettes above plus those test files
      - Verify: `npx jest src/screens/catalog` passes.

- [ ] 7. **Fix 7: Resorts tier badges on the hotel photo are scheme-invariant (B1-3).**
      - `catalog/ResortsDirectoryScreen.palette.ts` `RESORTS.dark`: set `tierDeluxe: '#d97706'`,
        `tierVilla: '#7c3aed'`, `tierModerate: '#0284c7'`, `tierValue: '#9333ea'` (equal to light). Add the
        comment `// On-photo overlay — mode-invariant (Requirement 9.14)`.
      - Palette literals are allowed by the guard. Light's existing white-on-badge ratios (3.19 / 5.70 / 4.10 /
        5.38) are pre-existing light values kept for parity, so they are **not** added to
        `CONTRAST_REQUIREMENTS`. Record this in the design ruling.
      - Test: change the existing dark assertion in `ResortsDirectoryScreen.test.tsx` (~607) to
        `toBe(RESORTS.light.tierDeluxe)`. That fails before the fix, which made it orange.fill.
        Add the same assertion for one other tier if the fixture has it.
      - Files: the palette and test
      - Verify: `npx jest src/screens/catalog/__tests__/ResortsDirectoryScreen.test.tsx`.

- [ ] 8. **Fix 8: `HUB_SECTIONS` contract follows the scheme (B5-1).**
      - In `TripDetailScreen.tsx`, replace the module-scope literal array with:
        - a colour-free `const HUB_SECTION_DEFS` (key/route/title/body/icon, same order and same text);
        - `export function hubSectionsFor(scheme: ColorScheme): readonly HubSection[]`, which returns
          `HUB_SECTION_DEFS.map((d) => ({ ...d, color: HUB_SECTION_COLOR[scheme][d.key] }))`. Keep the
          property order key, route, title, body, icon, color. Type the defs' `key` as
          `keyof typeof HUB_SECTION_COLOR.light` so the lookup is type-safe;
        - `export const HUB_SECTIONS = hubSectionsFor('light')`, documented as the light reference set
          the snapshot pins. Painting consumers must call `hubSectionsFor(t.scheme)`.
      - The rendered tiles stay as they are (they are already themed; see the root-cause notes).
      - Tests:
        - In `tripStructureRegression.test.tsx`, keep the existing `toMatchSnapshot()`. It must still pass
          unchanged, which proves light is byte-identical; do **not** re-record it.
        - Add a test asserting `hubSectionsFor('light')` toEqual `HUB_SECTIONS`.
        - Assert `hubSectionsFor('dark')` has the same keys/routes/titles and that its colours equal
          `[darkTheme.color.primaryFg, darkTheme.color.primaryLight, darkTheme.color.accent, darkTheme.color.primaryFg, darkTheme.color.accent, darkTheme.color.primaryLight, darkTheme.color.textSecondary]`,
          each differing from its light counterpart.
        - In `TripDetailScreen.test.tsx`'s dark describe, add tile icon assertions: the Planned tile
          (`within(getByTestId('trip-detail-section-planned')).UNSAFE_getByType(Ionicons).props.color`)
          is `darkTheme.color.primaryFg`, Schedule is `darkTheme.color.primaryLight`, and Reservations is
          `DARK_TONAL.amber.fg`. These pin the "tiles follow dark" claim.
      - Files: `screens/trips/TripDetailScreen.tsx`, `__tests__/tripStructureRegression.test.tsx`,
        `__tests__/TripDetailScreen.test.tsx`
      - Verify: `npx jest src/screens/trips/__tests__/tripStructureRegression.test.tsx src/screens/trips/__tests__/TripDetailScreen.test.tsx`
        passes with the snapshot unchanged (`Snapshots: 1 passed`, 0 written/updated).

- [ ] 9. **B4-9: Schedule showtime selected pill on `surfaceAlt`.**
      - Dark `primary` `#7e57c2` on the `showtimesSection` `surfaceAlt` is **2.98:1**, below 3:1.
      - In `TripScheduleScreen.palette.ts` `SCHEDULE`, add `showtimeActiveBorder` (light `'#5b2a86'`, today's
        `t.color.primary`; dark `darkColor.primaryFg`, 7.41:1 on `surfaceAlt`).
      - In `TripScheduleScreen.tsx` `showtimePillActive.borderColor`, read it. The fill stays `t.color.primary`, so white text stays 5.21:1.
      - Test: in the `TripScheduleScreen — dark mode` describe (~3897), reuse the setup of the
        "Showtime Pills…" describe (~1872–1945) with a dark scheme. Assert `showtime-autofit-pill` (active by
        default) `borderColor` is `darkTheme.color.primaryFg` and `showtime-pill-10:00-am` (inactive) is
        `darkTheme.color.border`.
      - Files: `screens/trips/TripScheduleScreen.palette.ts`, `TripScheduleScreen.tsx`, `TripScheduleScreen.test.tsx`
      - Verify: `npx jest src/screens/trips/__tests__/TripScheduleScreen.test.tsx`.

- [ ] 10. **Remaining review findings: small code fixes.** Each finding below has a decision. The
      "leave" rows need no code but get a ruling in design.md (item 1) and a line in the report.
      - **B3-N2: fix.** In `catalog/FoodItemPickerModal.tsx` (~736), replace
        `extraData={[selectedItems, t.scheme]}` with a memoized
        `const listExtraData = useMemo(() => [selectedItems, t.scheme] as const, [selectedItems, t.scheme])`.
        - Test in `FoodItemPickerModal.test.tsx`: capture `UNSAFE_getByType(FlatList).props.extraData`, then
          trigger an unrelated parent re-render (`rerender` with the same props). Assert the same identity
          (`toBe`), which fails on the old inline array.
        - Flip to dark and assert a new identity whose `[1]` is `'dark'`.
      - **B7 orderingDeterminism: fix.** In `screens/stats/__tests__/orderingDeterminism.prop.test.ts` (~249–251),
        replace `.toBe('#b28dff')` with `.toBe(darkTheme.categoryVisual.Ride.tint)` plus
        `.not.toBe(lightTheme.categoryVisual.Ride.tint)` to keep the leak guard. Change the comment at ~227
        to `// Feature: dark-mode, Property 22: role-converted token reads stay legible in dark (view-model accents take the passed theme)`.
      - **B5-3: fix.** In `TripReservationsScreen.test.tsx` "Property 22 … in dark" (~1139), add
        `within(kindChip).UNSAFE_getByType(Ionicons).props.color` equal to `darkTheme.color.textOnPrimary` and
        the inactive `reservation-kind-other` icon equal to `darkTheme.color.textSecondary`. Import `Ionicons` from
        `@expo/vector-icons`. Add the light counterpart (`'#ffffff'` / `'#6b6480'`) to the light case.
      - **B1-1 crowd scale invariant: leave, and ratify as a design ruling.** Applying rule V's F fallback
        would merge Quiet and Below-average into one green and destroy a data scale. Contrast is identical to light.
      - **B2-1 starRating as a fill behind white** (`ParkPassportCard` `pickerActiveBg`) **: leave.** Record the
        ruling "a starRating/amber literal used as a fill behind white uses `DARK_TONAL.amber.fill`" (white
        on it is ≥ 4.5, already in Property 9).
      - **B2-2 ForecastChart bars use `primaryLight`: leave.** The code matches the design. `primaryFg` would
        change light. Only the historical w2-plan text was wrong, and that file is a closed artifact. Note it in the report.
      - **B2-4 NoteControl Switch on platform defaults: fixed by item 12.**
      - **B2-5 LiveWaits moderate dot uses `starRating`: leave.** Dark `#f6c343` vs light `#f59e0b` is the same
        amber step and reads ≥ 3:1 on the dark surface. Moving it into `WAIT_STATUS` would change no visible output.
      - **B3-N1 / B4-6 dark-only placeholder ternary: leave the code, and record the clarification.** For an
        input that had no placeholder colour, `placeholderTextColor={t.scheme === 'dark' ? t.color.textSecondary : undefined}`
        is the sanctioned form, because it keeps the light default. Android resets an undefined hint colour to the default.
      - **B3-N3 untested sheets (`AddToTripOrListChoiceSheet`, `AddToTripPickerSheet`): add a dark render test**
        `screens/catalog/__tests__/AddToTripPickerSheet.dark.test.tsx`. Render the sheet with a mocked trips
        query and assert one `statusMeta(t)` badge colour equals the dark token and a primaryFg icon equals
        `darkTheme.color.primaryFg`. `AddToTripOrListChoiceSheet` is covered by the visual pass (MagicFab →
        add flow).
      - **B3-N4, B3-N5, B4-7, B5-2, B6-3 (process/evidence notes): no code.** The final `npm run verify`
        (item 14) supplies the literal evidence. The pre-existing `keyboardShouldPersistTaps` edits are left as found.
      - **B4-8 untested dark values: covered by items 5, 12 and 15.** The tier pills and switches get
        assertions here; the schedule settings modals and park-hours stripes go to the visual pass.
      - **B5-4 (`ResortPickerModal`, `RodeWithConfirmScreen`, `TripInviteScreen`, `TripGuestManagementModal`)
        and B6-4 (Inbox, Sent shares, Attribution): visual pass (item 15).** ShareComposer gets a test in item 3.
      - **B7 `AVATAR_GOLD.dark.ring` stays `#ffd54f`: leave.** It is role G: the gold frame matches the gold
        "CHANGE" pill, which is mode-invariant. It is 13.67:1 on `background`, while `amber.border` would be 2.27:1.
      - **B7 podium borders (ExperiencesDetail `primaryFg` vs FoodStats `violet.border`): leave.** The light
        values already differ by design (`#3d1c5c` is the `primaryDark` token, so rule 1 gives `primaryFg`; `#4d2055`
        is a violet B, so `violet.border`). Record the `#3d1c5c` as a border → `primaryFg` ruling (B7 finding 2).
      - **B7 `#f6a609` resolved two ways: leave.** One is a park accent (`parkAccent['Disney Springs']`) and the
        other an amber facet (`amber.fg`), which are different roles.
      - **B7 AvatarChip / RegisterScreen not visually checked.**
        - Add a dark case to `screens/__tests__/authScreenLayout.test.tsx` for `RegisterScreen`: the root
          is `darkTheme.color.background`, one input has `keyboardAppearance: 'dark'`, and the title is `textPrimary`.
        - Create `screens/navigation/__tests__/AvatarChip.dark.test.tsx`: the chip's themed pill reads the
          `AVATAR_PILL` (`AvatarChip.palette.ts`) dark value, asserted against the token it derives from or
          a relation to light, and the avatar art is unchanged (equal to light).
        - Login and Register still need on-device shots in item 15, but only if the user can sign back in (ask; do not log out unprompted).
      - Files: as listed
      - Verify: `npx jest` on each touched test file.

- [ ] 11. **Fix 11: native window background behind the Android nav bar (user-reported, root cause confirmed above).**
      1. Run `npx expo install expo-system-ui` in `apps/mobile`, then set the exact version in
         `apps/mobile/package.json` (no `^`/`~`) and confirm `package-lock.json` updated.
      2. If `npx expo install` or `npx expo-doctor` asks for the config plugin, add `'expo-system-ui'` to
         `plugins` in `apps/mobile/app.config.ts`. That follows the `expo-status-bar` precedent noted there.
      3. Create `apps/mobile/src/theme/AppearanceChrome.palette.ts` with
         `export const SYSTEM_WINDOW = definePalette({ light: { background: '#ffffff' }, dark: { background: darkColor.background } })`.
         The comment notes light is today's observed native window colour.
      4. `theme/AppearanceChrome.ts`: add `readonly systemBackground: string` to `AppearanceChrome`, filled with
         `SYSTEM_WINDOW[activeTheme].background` in `deriveAppearanceChrome`.
      5. Create `apps/mobile/src/theme/useSystemWindowBackground.ts`, exporting
         `useSystemWindowBackground(color: string): void`. Its `useEffect` on `[color]` calls
         `SystemUI.setBackgroundColorAsync(color).catch(() => {})`. A native failure must never crash startup,
         matching Requirement 3.3's non-blocking stance.
      6. In `App.tsx`, destructure `systemBackground` next to `statusBarStyle` and call
         `useSystemWindowBackground(systemBackground)` beside the status bar wiring.
      - Tests:
        - `__tests__/App.appearance.test.tsx`: assert `deriveAppearanceChrome('light').systemBackground` is `'#ffffff'`
          and dark is `darkTheme.color.background`. Extend the fast-check domain property so `systemBackground`
          is determined by the resolved theme.
        - Create `theme/__tests__/useSystemWindowBackground.test.tsx` with
          `jest.mock('expo-system-ui', () => ({ setBackgroundColorAsync: jest.fn(() => Promise.resolve()) }))`.
          `renderHook` with `'#ffffff'` asserts the call with `'#ffffff'`. Rerendering with `'#120a1f'` asserts a
          second call with `'#120a1f'`. A rejected promise does not throw.
        - If any existing test renders `App.tsx` and now fails to resolve the native module, add the same
          `jest.mock` there. Grep for imports of `../App`; planning found none.
      - Files: `apps/mobile/package.json`, `package-lock.json`, possibly `app.config.ts`, the new palette, hook
        and test, `AppearanceChrome.ts`, `App.tsx`, `App.appearance.test.tsx`
      - Verify: `npx jest src/__tests__/App.appearance.test.tsx src/theme/__tests__/useSystemWindowBackground.test.tsx`
        and `npm run typecheck` in `apps/mobile`. The device check is in item 15.
      - Note for the report: Expo Go ships `expo-system-ui` natively, so the emulator verifies it as-is. A user
        on a custom dev/EAS build needs a rebuild to pick up the native module.

- [ ] 12. **Fix 12 + Fix 5 + B2-4: theme every `Switch`.**
      1. Create `apps/mobile/src/theme/switchColors.ts`. It is pure, with no literals, so the guard is satisfied.
         - `export interface SwitchColorProps { readonly trackColor?: { readonly false?: string; readonly true?: string }; readonly thumbColor?: string; readonly ios_backgroundColor?: string }`.
         - `export function themedSwitchProps(t: AppTheme, value: boolean, light: SwitchColorProps = {}): SwitchColorProps`.
           In **light** it returns `light` verbatim, which is exactly today's props at each call site (undefined
           stays undefined, so platform defaults are kept). In **dark** it returns the following:

           | Prop | Dark value |
           | --- | --- |
           | `trackColor.false` | `t.color.borderStrong` |
           | `trackColor.true` | `t.color.primary` |
           | `thumbColor` | on: `t.color.textOnPrimary`; off: `t.color.textSecondary` |
           | `ios_backgroundColor` | `t.color.borderStrong` |

           The resulting ratios:
           - on thumb `#ffffff` on track `#7e57c2`: 5.21
           - on track vs `surface`: 3.36
           - off thumb `#b3a8c9` vs `surface`: 7.81
           - off thumb vs off track: 4.44

           On reads stronger than off: a brighter track and a white thumb.
      2. Apply it at all six sites as `<Switch key={t.scheme} … {...themedSwitchProps(t, <value>, <lightProps>)} />`.
         `key={t.scheme}` remounts the native view on a scheme switch, so a dark→light switch cannot leave dark
         colours stuck on Android (the omitted-prop issue the FINAL-REPORT found). Remove each site's
         now-duplicated inline `trackColor`/`thumbColor`. The `lightProps` per site:
         - `PushNotificationPreferenceControl.tsx`: `{ trackColor: { false: switchTrack.trackOff, true: switchTrack.trackOn } }`.
         - `ExpenseFormModal.tsx` (both): `{ trackColor: { false: switchPal.trackOff, true: switchPal.trackOn }, thumbColor: <on> ? switchPal.thumbOn : t.color.textOnPrimary }`.
         - `NoteControl.tsx` and `ReceiptReviewModal.tsx` (both): `{}`. These are on platform defaults in light,
           which stay unchanged.
      3. Keep `FORM_SWITCH`/`NOTIFICATION_SWITCH` `light` values unchanged. Set their `dark` values equal to the
         helper's tokens (`trackOff: darkColor.borderStrong`, `trackOn: darkColor.primary`, and `thumbOn:
         darkColor.textOnPrimary` for FORM_SWITCH), with a comment saying the dark Switch colours come from
         `themedSwitchProps`. That keeps the palettes honest and Property 14 green.
      - Tests:
        - Create `theme/__tests__/switchColors.test.ts`, a pure test with fast-check over `value` and a generated light
          props object, ≥ 100 runs, tagged `// Feature: dark-mode, Property 24: …`. Light returns its input
          by deep equality. Dark returns the token set above, and the on/off thumbs differ.
        - Render tests (dark): each asserts `trackColor`, `thumbColor` and `ios_backgroundColor` on the real `Switch` via
          `UNSAFE_getByType(Switch)` or testID. Each also has a light case asserting today's props (`undefined`
          where it was default).
          - `PushNotificationPreferenceControl.test.tsx` (~320): replace the palette-based expectation with
            the tokens, and add `thumbColor` equal to `darkTheme.color.textOnPrimary` when on. This fails before
            the fix (`thumbColor` undefined).
          - `NoteControl.shareable.test.tsx` (`note-shareable`).
          - `TripExpensesScreen.test.tsx` (`item-alcohol-toggle-0` off, then `fireEvent(…,'valueChange',true)`
            and assert the on thumb and on track).
          - `ReceiptReviewModal.test.tsx` (`receipt-item-alcohol-<id>`).
        - Add one live-switch case in `NoteControl.shareable.test.tsx`: dark→light via `setTestScheme`
          produces a **new** host instance (remount) whose `thumbColor` is `undefined`.
      - Files: new `theme/switchColors.ts`, its test, the four component files, the two palettes, the four test files
      - Verify: `npx jest src/theme/__tests__/switchColors.test.ts src/screens/__tests__/PushNotificationPreferenceControl.test.tsx src/screens/catalog/__tests__/NoteControl.shareable.test.tsx src/screens/trips/__tests__/ReceiptReviewModal.test.tsx src/screens/trips/__tests__/TripExpensesScreen.test.tsx`.

- [ ] 13. **Declare the new pairs in `theme/contrast.ts` (Property 9).**
      Add a block `// Dark-mode polish pass (Requirement 9.12 / 9.15)` to `CONTRAST_REQUIREMENTS`. Import the
      palettes it needs (`PARK_WAIT_PULSE`, `FORM`, `EXPENSES`, `BALANCES`, `SCHEDULE`, `SHARE_COMPOSER`)
      and `themedSwitchProps`. Palettes import only `theme/theme.ts`, so there is no cycle.

      | Label | fg | bg | min | Ratio |
      | --- | --- | --- | --- | --- |
      | ParkWaitPulse active ring vs surface | `PARK_WAIT_PULSE.dark.activeBorder` | `d.surface` | NON_TEXT | 7.91 |
      | ParkWaitPulse active ring vs inactive ring | `PARK_WAIT_PULSE.dark.activeBorder` | `PARK_WAIT_PULSE.dark.pillBorder` | NON_TEXT | 3.70 |
      | ShareComposer unselected icon vs surface (unselected row) | `SHARE_COMPOSER.dark.unselectedIcon` | `d.surface` | NON_TEXT | 7.81 |
      | Expenses active tab label on active pill | `d.primaryFg` | `EXPENSES.dark.tabActiveBg` | TEXT | 4.76 |
      | Expenses idle tab label on track | `EXPENSES.dark.tabIdleText` | `EXPENSES.dark.tabTrack` | TEXT | 6.92 |
      | Balances active toggle label on active pill | `BALANCES.dark.inkText` | `BALANCES.dark.toggleActiveBg` | TEXT | 8.75 |
      | Balances idle toggle label on track | `BALANCES.dark.slateText` | `BALANCES.dark.toggleTrack` | TEXT | 6.92 |
      | Expense tier pill active border vs pill | `FORM.dark.tierPillActiveBorder` | `FORM.dark.tierPillActiveBg` | NON_TEXT | 6.12 |
      | Showtime active pill border vs section | `SCHEDULE.dark.showtimeActiveBorder` | `d.surfaceAlt` | NON_TEXT | 7.41 |
      | Switch on thumb on on track | dark helper output | dark helper output | NON_TEXT | 5.21 |
      | Switch on track vs surface | dark helper output | `d.surface` | NON_TEXT | 3.36 |
      | Switch off thumb vs surface | dark helper output | `d.surface` | NON_TEXT | 7.81 |
      | Switch off thumb vs off track | dark helper output | dark helper output | NON_TEXT | 4.44 |

      For the four Switch rows, derive fg/bg from `themedSwitchProps(darkTheme, true)` /
      `themedSwitchProps(darkTheme, false)` so the declared pair *is* the shipped value.
      - Files: `apps/mobile/src/theme/contrast.ts`
      - Verify: `npx jest src/theme/__tests__/contrast.prop.test.ts` passes (`failing` equals `[]`). Then run
        `npx jest src/__tests__/themeRetrofit.guard.test.ts src/test/__tests__/themeGuard.prop.test.ts`. Both
        must be green with no allowlist edits (`git diff apps/mobile/src/test/themeGuard.ts` is empty).

- [ ] 14. **Self-review and gates.**
      - Run `npm run verify:mobile` once, and fix anything red, including other suites this change regressed.
      - Then run the full `npm run verify` **once** from the repo root and capture the literal tail (api /
        mobile / shared counts and `EXIT CODE`).
      - Run `git status --short -- apps/api packages/shared` and confirm empty output.
      - Run `git diff` on every touched file and confirm that no `light:` value changed and that no unrelated
        lines were reformatted.
      - Confirm no stray files remain: no scratch scripts, no `/sdcard` dumps left on the emulator, no temp PNGs in the repo.
      - Write the behaviour→test map (see the template at the end) into
        `.agents/tasks/dark-mode-retrofit/POLISH-report.md`, with the verify tail.
      - Files: `POLISH-report.md`
      - Verify: `npm run verify` exits `0`.

- [ ] 15. **Visual verification (the `visual-verify` step).**
      **Setup.**
      - Use the `emulator-5554` with Expo Go and the user's already-running Metro. Do not start or kill
        Metro; if it is not running, ask.
      - The app was found on You & Crew with Appearance = **Dark**. Restore that state at the end.
      - Capture with `adb exec-out screencap -p > .agents/tasks/dark-mode-retrofit/screenshots/polish-NN-<screen>-<scheme>.png`.
        Delete any `/sdcard` dumps you create.

      **a. Before/after pairs** (dark, plus a light spot-check of the same screen for parity):
      - Fix 11: You & Crew scrolled to the bottom. The y 2337–2400 strip must be `#120a1f` in dark and stay
        `#ffffff` in light. Sample pixels with `System.Drawing` as planning did. Repeat on one other non-tab
        stack screen (Experience detail or Notification center).
      - Fix 12: the Push notifications Switch, on and off.
      - Fix 1: Home with an active trip (or temporarily verify via Explore → Live waits if no active
        trip; note which).
      - Fix 2: Share composer, selected vs unselected.
      - Fixes 3/4/5/9: Expenses tabs, the Balances toggle, the Expense form tier pills (cards view), the
        alcohol Switch, and the keyboard opened on a tier count input.
      - Fix 6: Resorts guide and a location group.
      - Fix 7: Resorts hotel card badges, light vs dark identical.
      - B4-9: Schedule item settings showtime pills.

      **b. Previously unchecked screens** (FINAL-REPORT "Screens to check by hand"), dark plus the dark→light
      live switch on at least three of them:
      - Destination (non-park), Resorts directory, Live waits, Experience detail (Passport lens; restaurant), Menu
      - Trip Schedule, Expenses, Balances, Expense form, Members, Summary, Reservations, Planned list
      - Pin board, Pin showcase, Food lists + detail, Experience lists + detail, Stats + one detail
      - Friends list/search/profile, Inbox, Sent shares, Share composer, MagicFab sheet, Date picker modal
      - Also ResortPickerModal, RodeWithConfirm, TripInvite, TripGuestManagement (B5-4) and Attribution (B6-4)
      - Login/Register/Forgot only if the user confirms they can sign back in.
      - Carried forward from POLISH-review P-6: the LensSwitcher active pill (`surface`) against its
        `surfaceAlt` track (does the selected pill itself read, not just its label?), and the
        ExpenseFormModal matrix/cards view toggle emphasis (active stronger than idle).
      - Carried forward from POLISH-review P-4 (now also render-tested): LogVisitModal (rating pills,
        note input), RestaurantDishLogCard (keepsake card on a restaurant's Passport lens), and the
        ExpenseFormModal participant avatars (AVATAR_FILL) on the payer chips.
      - Finalize (item 16) must confirm the Kiro Spec Format diagnostics for `.kiro/specs/dark-mode/*`
        are clean (P-6); the build step could only check them by hand.

      **c. Findings.** Fix each new finding in its owning file, with a regression test at the wrong layer;
      re-capture the shot; record the finding.
      - If the full checklist is captured and clean, check spec tasks 11.1/11.2 and 13.x. Otherwise leave them
        unchecked and say exactly what's missing.
      - If any fix changed code, re-run `npm run verify` once more and paste its tail.
      - Files: screenshots, `POLISH-report.md`, `.kiro/specs/dark-mode/tasks.md` (checkboxes only)

- [ ] 16. **Finalize.**
      - Update `POLISH-report.md` with the final verify tail, the behaviour→test map, the screenshot list, the
        new dependency (exact version, and why), and every finding decision.
      - No commits. Leave the emulator in Dark on You & Crew, as found.
      - Summarise for the user in a few sentences.

## Behaviour → test map (template the coder must complete in POLISH-report.md)

| Behaviour | Test file | Assertion that fails without the fix |
| --- | --- | --- |
| Park pill selected ring visible (dark) | `ParkWaitPulse.dark.test.tsx` | active `borderColor === DARK_TONAL.green.fg`, inactive differs |
| ShareComposer unselected icon muted | `ShareComposerScreen.dark.test.tsx` | unselected `color === textSecondary`, selected `primaryFg`, they differ |
| Expenses active tab stronger than idle | `TripExpensesScreen.test.tsx` | active bg `borderStrong`, idle label `textSecondary` ≠ active |
| Balances toggle emphasis | `TripBalancesScreen.test.tsx` | active bg `borderStrong`, active label `textPrimary` |
| Tier pill active distinct | `TripExpensesScreen.test.tsx` | `tier-count-pill-0-*` border `primaryFg` ≠ inactive |
| Tier count inputs dark keyboard | `TripExpensesScreen.test.tsx` | `keyboardAppearance === 'dark'` (matrix + cards) |
| Muted copy hierarchy | ResortGuide / LocationGroup / Dining / FloatingActionDock / lens tests | heading `textPrimary`, muted `textSecondary` |
| On-photo tier badges invariant | `ResortsDirectoryScreen.test.tsx` | dark bg `=== RESORTS.light.tierDeluxe` |
| HUB_SECTIONS scheme-aware, snapshot intact | `tripStructureRegression.test.tsx`, `TripDetailScreen.test.tsx` | dark colours = dark tokens; snapshot passes unmodified; tile icons dark |
| Showtime selected border ≥3:1 | `TripScheduleScreen.test.tsx` | active `borderColor === primaryFg` |
| extraData identity stable | `FoodItemPickerModal.test.tsx` | `extraData` `toBe` same reference after re-render |
| Ride tint from tokens + Property tag | `orderingDeterminism.prop.test.ts` | `toBe(darkTheme.categoryVisual.Ride.tint)` |
| Kind-chip icon colour | `TripReservationsScreen.test.tsx` | active icon `textOnPrimary`, inactive `textSecondary` |
| Register / AvatarChip / AddToTripPicker dark | `authScreenLayout.test.tsx`, `AvatarChip.dark.test.tsx`, `AddToTripPickerSheet.dark.test.tsx` | root/background/token assertions |
| Window background follows theme | `App.appearance.test.tsx`, `useSystemWindowBackground.test.tsx` | `systemBackground` light `#ffffff` / dark `#120a1f`; `setBackgroundColorAsync` called with each |
| Every Switch themed / light unchanged / remount | `switchColors.test.ts` + 4 render tests | dark `trackColor`/`thumbColor`/`ios_backgroundColor` tokens; light props verbatim; new instance on switch |
| New contrast pairs | `contrast.prop.test.ts` | `failing` equals `[]` including the new block |

---

# Verification evidence (build step, iteration 1)

No `POLISH-review.json` existed, so this was the first iteration. Items 1–10, 12 and 13 are
implemented. Item 14's full `npm run verify` and items 15–16 belong to later steps and were not run
here.

## Scope deviation from this plan: item 11 not implemented

The step instructions for this build override item 11 and binding rule 4: they say **do not add
any dependency, in particular not `expo-system-ui`**. So item 11 (the native window background
behind the Android nav bar) was **not** implemented. No dependency was added, and
`apps/mobile/package.json` and `package-lock.json` are untouched by this step. (Their existing diff,
`@react-native-async-storage/async-storage`, dates from 14 Oct, dark-mode task 1.) The spec
amendment leaves out the planned Requirement 6.5 and Property 25. Instead, design.md's polish
constants record that the window background is out of scope. The white strip below non-tab stack
screens in Dark is still an open, user-visible issue that needs a decision on the dependency.

## Commands run (all in `apps/mobile` unless noted) and results

| Command | Result |
| --- | --- |
| `npx jest src/screens/home/__tests__/ParkWaitPulse.dark.test.tsx` | 1 suite, 2 passed |
| `npx jest src/screens/share/__tests__/ShareComposerScreen.dark.test.tsx` | 1 suite, 2 passed |
| `npx jest src/screens/trips/__tests__/TripExpensesScreen.test.tsx` | 1 suite, 36 passed |
| `npx jest src/screens/trips/__tests__/TripBalancesScreen.test.tsx` | 1 suite, 10 passed |
| `npx jest` on ResortGuideSection, LocationGroupSection, DiningReservationCard, FloatingActionDock, ExperienceDetailScreen.preservedBehaviors, TodayInParkLens.render, ParkPassportCard | 1st run: 6 passed and preservedBehaviors failed (my lens assertion assumed `today` was active). Fixed to pick the active tab via `accessibilityState.selected`. Re-run: `preservedBehaviors` 14 passed |
| `npx jest src/screens/catalog/__tests__/ResortsDirectoryScreen.test.tsx` | 14 passed (run twice; the second run added the Moderate badge assertion) |
| `npx jest --ci src/screens/trips/__tests__/tripStructureRegression.test.tsx src/screens/trips/__tests__/TripDetailScreen.test.tsx` | 2 suites, 26 passed, **Snapshots: 2 passed** (0 written or updated) |
| `npx jest src/screens/trips/__tests__/TripScheduleScreen.test.tsx` (full, then `-t showtime`) | 66 passed; `-t showtime`: 7 passed |
| `npx jest src/screens/catalog/__tests__/FoodItemPickerModal.test.tsx` | 20 passed |
| `npx jest src/screens/trips/__tests__/TripReservationsScreen.test.tsx src/screens/stats/__tests__/orderingDeterminism.prop.test.ts` | 2 suites, 41 passed |
| `npx jest src/screens/catalog/__tests__/AddToTripPickerSheet.dark.test.tsx` | 3 passed |
| `npx jest src/screens/navigation/__tests__/AvatarChip.dark.test.tsx src/screens/__tests__/authScreenLayout.test.tsx` | 2 suites, 5 passed. The Register label assertion was corrected from `textPrimary` to the real `textSecondary` label token. |
| `npx jest src/theme/__tests__/switchColors.test.ts src/screens/__tests__/PushNotificationPreferenceControl.test.tsx src/screens/catalog/__tests__/NoteControl.shareable.test.tsx src/screens/trips/__tests__/ReceiptReviewModal.test.tsx src/screens/trips/__tests__/TripExpensesScreen.test.tsx` | 5 suites, 68 passed |
| `npx jest src/theme/__tests__/contrast.prop.test.ts src/__tests__/themeRetrofit.guard.test.ts src/test/__tests__/themeGuard.prop.test.ts` | 3 suites, 27 passed (Property 9 includes the new polish block; guard green, no allowlist edit) |
| `npm run typecheck` (apps/mobile) | Run 1: exit 0. Run 2: **1 error**, `preservedBehaviors.test.tsx(709,33) TS2367`, from my lens helper comparing `n.type === 'Text'`. Fixed. Run 3: exit 0 |
| `npm run verify:mobile` (repo root, once) | Typecheck api + mobile + shared all clean. Jest: `Test Suites: 1 failed, 278 passed, 279 total` / `Tests: 1 failed, 2128 passed, 2129 total` / `Snapshots: 2 passed, 2 total` / exit 1. The failure is below. |
| `npx jest src/screens/catalog/__tests__/ExperienceDetailScreen.recreationExperience.test.tsx`, 3 times after the verify run | `Tests: 2 passed, 2 total` all 3 times |

**The one red test in `verify:mobile`.** `ExperienceDetailScreen.recreationExperience.test.tsx`
line 155 is a timing race in a test I did not touch. After waiting only for the title, it calls
`getByText("Disney's Coronado Springs Resort • Gran Destino Tower")` synchronously. That brief
title only gets its resort prefix once the separate `/resorts` query resolves, so the test fails
when the machine is under load. It failed in the loaded full run and in one solo run straight
after it, then passed in 3 of 3 solo re-runs. None of this pass's edits touch text or query logic
in that path: `LocationGroupSection.palette.ts` changed colour values only, and
`LocationGroupSection.tsx` / `ExperienceDetailScreen.tsx` were not edited. The one-line hardening
would be `await screen.findByText(...)`. I left it alone because the file is outside this pass's
scope. **The later full `npm run verify` can flake on it.**

Other checks:

- **TextInput scan.** A scan of every non-test `apps/mobile/src/**/*.tsx` found **83** `<TextInput` tags, and **0** were missing `keyboardAppearance`.
- **No API or shared changes.** `git status --short -- apps/api packages/shared` printed nothing.
- **No stray files.** The scratch verify log was deleted, and there are no helper scripts.

## Findings: fixed or ruled

**Fixes 1–9:**

| # | Finding | Status |
| --- | --- | --- |
| 1 | B6-2 | Fixed |
| 2 | B6-1 | Fixed |
| 3 | B4-1 | Fixed, plus the same inversion on the Balances toggle and B4-4 name ink |
| 4 | B4-2 | Fixed |
| 5 | B4-3 | Fixed via `themedSwitchProps` |
| 6 | B1-2 / B2-3 | Fixed for 7 palettes |
| 7 | B1-3 | Fixed |
| 8 | B5-1 | Fixed: `hubSectionsFor`, snapshot unchanged |
| 9 | B4-5 | Fixed |

**Other findings, fixed:**

- B4-9 (showtime border).
- B3-N2 (memoized `extraData`).
- B7 `orderingDeterminism` (token assertion and Property 22 tag).
- B5-3 (kind-chip icon).
- B3-N3 (both "add to" sheets tested).
- B7 RegisterScreen and AvatarChip (tested).
- B2-4: the NoteControl Switch is themed in dark. Light keeps the platform defaults.

**Other findings, ruled in design.md "Polish-pass rulings", no code change:**

- B1-1: the crowd scale stays invariant.
- B2-1: amber fill.
- B3-N1 / B4-6: the dark-only placeholder.
- B7: the `#3d1c5c` border maps to `primaryFg`.

**Left as-is, with reasons:**

- **B2-2 ForecastChart `primaryLight`.** The code matches the design, and `primaryFg` would change light. Only the closed w2-plan text was wrong.
- **B2-5 LiveWaits moderate dot `starRating`.** It is the same amber step, at least 3:1 on the dark surface. Moving it into `WAIT_STATUS` changes no output.
- **B7 `AVATAR_GOLD.dark.ring` `#ffd54f`.** This is the G role, matching the invariant gold "CHANGE" pill. It is 13.67:1, while `amber.border` would be 2.27:1.
- **B7 podium borders (`primaryFg` vs `violet.border`).** The light values already differ: `#3d1c5c` is the `primaryDark` token, while `#4d2055` is violet B. Unifying them would change one light value.
- **B7 `#f6a609` resolved two ways.** One is a park accent and the other an amber facet, which are different roles.
- **B3-N4 / B3-N5 / B4-7 / B5-2 / B6-3 (process and evidence notes).** These need no code. The final `npm run verify` step supplies the literal evidence. The `keyboardShouldPersistTaps` edits are left as found.
- **B4-8 / B5-4 / B6-4 / B7 informational.** The tier pills, alcohol Switch and Expenses idle tab now have dark assertions. The schedule settings modals, park-hours stripes, ResortPicker, RodeWithConfirm, TripInvite, TripGuestManagement, Inbox, Sent shares and Attribution go to the visual pass.
- **Kept per plan item 6.** `QuickSpecsRow.specText` and `ShowtimesCard.title/futureText` have no muted sibling.

**Noticed during the build, not in any review, left for visual-verify:**

- **LensSwitcher active pill.** It uses `surface`, which is darker than its `surfaceAlt` track, the same shape as B4-1. The labels now differ (`primaryFg` vs `textSecondary`), so the selection reads, but the pill itself barely contrasts.
- **ExpenseFormModal matrix/cards view toggle.** The idle label is `textPrimary` beside a white-on-fill active label. That emphasis is not inverted.

## New contrast pairs (`CONTRAST_REQUIREMENTS`, Property 9 green)

| Pair | Ratio |
| --- | --- |
| ParkWaitPulse ring vs surface | 7.91 |
| ParkWaitPulse ring vs idle ring | 3.70 |
| ShareComposer unselected icon vs surface | 7.81 |
| Expenses active label vs `borderStrong` pill | 4.76 |
| Expenses idle label vs track | 6.92 |
| Expenses active badge | 6.12 |
| Expenses idle badge | 5.71 |
| Balances active label | 8.75 |
| Balances idle label | 6.92 |
| Tier pill border vs pill | 6.12 |
| Tier pill border vs idle border | 3.9 |
| Showtime border vs `surfaceAlt` | 7.41 |
| Switch on thumb vs on track | 5.21 |
| Switch on track vs surface | 3.36 |
| Switch off thumb vs surface | 7.81 |
| Switch off thumb vs off track | 4.44 |

The ratios come from the plan's computations, and Property 9 re-checks every row. The
`themeGuard.ts` allowlist was not edited. Spec checks:

- **No validator run.** I could not run the Kiro Spec Format validator from the CLI.
- **Manual checks.** Every checkbox is `- [ ]` or `- [x]`. The design has 24 `### Property` headings and 24 `**Validates:**` lines. All edits are insertions.
- **No git diff.** The spec folder is untracked, so `git diff` cannot show the additions.

---

# Verification evidence (build step, iteration 2: POLISH-review fixes)

`POLISH-review.json` existed (verdict CHANGES_REQUESTED, 1 blocking + 5 non-blocking). Every finding
is addressed below. No app source behaviour changed in this iteration: all edits are tests, plus
this plan and `POLISH-report.md`. No dependency added; nothing under `apps/api` or `packages/shared`.

## Findings

| ID | Disposition |
| --- | --- |
| P-1 (blocking) | Fixed. `FoodItemPickerModal.test.tsx` now re-renders with a fresh element from a `makeUi()` factory, so the modal really re-renders. **Mutation check:** with `listExtraData` temporarily reverted to the inline `[selectedItems, t.scheme] as const`, the test failed at `expect(extraData()).toBe(before)` (`Received: serializes to the same string`, 1 failed). With the `useMemo` restored it passes. |
| P-2 | Fixed (test-only hardening). `ExperienceDetailScreen.recreationExperience.test.tsx` now awaits `findByText("Disney's Coronado Springs Resort • Gran Destino Tower")` instead of reading it synchronously before `/resorts` resolves. No assertion weakened. |
| P-3 | Not implemented, by instruction (no `expo-system-ui`). Stated as an open user decision in `POLISH-report.md` "Open decision". |
| P-4 | Fixed with render tests, and added to the item-15 checklist: B3-N3 `LogVisitModal` → new `LogVisitModal.dark.test.tsx`; B3-N3 `RestaurantDishLogCard` → new dark describe in `ParkPassportCard.test.tsx`; B4-8 `AVATAR_FILL` → new case in `TripExpensesScreen.test.tsx`. Recorded in `POLISH-report.md`. |
| P-5 | Fixed. One dark assertion each: `TripExpensesScreen.test.tsx` (ExpenseFormModal discount "Exclude Alcohol", found via `charge-line-0`, no source testID added) and `ReceiptReviewModal.test.tsx` (`receipt-charge-exclude-alcohol-*`). Each asserts dark `trackColor`/`thumbColor`/`ios_backgroundColor` tokens, the thumb change on flip, a remount on dark→light (`key={t.scheme}`) and light values. **Mutation checks:** removing `key={t.scheme}` at both sites → both new tests failed (2 failed); removing the `themedSwitchProps` spread at both sites → both failed (2 failed). Source restored and re-read byte-for-byte. |
| P-6 | Added to the item-15 checklist (LensSwitcher pill vs track, matrix/cards toggle) and to item 16 (spec diagnostics). No code change. |

## Commands run (in `apps/mobile`) and results

| Command | Result |
| --- | --- |
| `npx jest src/screens/catalog/__tests__/FoodItemPickerModal.test.tsx -t "stable FlatList extraData"` with `useMemo` temporarily removed | `Tests: 1 failed, 19 skipped` (expected: proves the test guards B3-N2) |
| `npx jest FoodItemPickerModal.test.tsx ExperienceDetailScreen.recreationExperience.test.tsx ReceiptReviewModal.test.tsx TripExpensesScreen.test.tsx` | 3 passed, 1 failed (`ReceiptReviewModal`: my new test read `off.props` after the remount unmounted it; captured the testID up front) |
| `npx jest src/screens/trips/__tests__/ReceiptReviewModal.test.tsx` | `Tests: 11 passed, 11 total` |
| `npx jest ReceiptReviewModal.test.tsx TripExpensesScreen.test.tsx -t "discount exclude-alcohol"` with `key` removed at both sites | `Tests: 2 failed, 46 skipped` (expected) |
| same, with the `themedSwitchProps` spread removed at both sites | `Tests: 2 failed, 46 skipped` (expected) |
| `npx jest LogVisitModal.dark.test.tsx ParkPassportCard.test.tsx TripExpensesScreen.test.tsx` (source restored) | `Test Suites: 3 passed` / `Tests: 60 passed, 60 total` |
| `npm run typecheck` | `tsc -p tsconfig.json --noEmit`, exit 0 |
| `npx jest src/__tests__/themeRetrofit.guard.test.ts src/theme/__tests__/contrast.prop.test.ts src/test/__tests__/themeGuard.prop.test.ts` | `Test Suites: 3 passed` / `Tests: 27 passed, 27 total` (guard green, no allowlist edit) |
| `npx jest ReceiptReviewModal.test.tsx ExperienceDetailScreen.recreationExperience.test.tsx FoodItemPickerModal.test.tsx` (restored source) | `Test Suites: 3 passed` / `Tests: 33 passed, 33 total` |
| `git status --short -- apps/api packages/shared` | empty |

`npm run verify:mobile` / `npm run verify` were not run in this step, per the step brief (item 14
runs the full gate once). `ParkPassportCard.test.tsx` prints an `act(...)` warning for
`ParkPassportCard` (not the new `RestaurantDishLogCard` cases); it is a warning, not a failure.

No new contrast pairs: the new tests assert existing tokens. The two ratio checks they make
(`orange.fg` on `amber.tint`, `amber.fg` on `surface`, `textOnPrimary` on the dark avatar fill and
on `primary`) are ≥ 4.5:1 at runtime.
