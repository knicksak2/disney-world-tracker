# Implementation Plan

## Tasks

- [x] 1. Dependency and Pure Appearance Module
  - [x] 1.1 Add `"@react-native-async-storage/async-storage": "2.2.0"` (exact, pinned — confirmed against the installed `expo@56`'s `node_modules/expo/bundledNativeModules.json`, which lists exactly `"2.2.0"` for this package) to `apps/mobile/package.json` `dependencies` and install it; confirm no existing `AsyncStorage` usage anywhere in `apps/mobile/src` is disturbed (verified during planning — there is none today, confirmed via a repo-wide search for `AsyncStorage`). **Jest-mock path/export CONFIRMED during planning** (not a guess — fetched the real package contents for `@react-native-async-storage/async-storage@2.2.0` from the npm registry): the file is `node_modules/@react-native-async-storage/async-storage/jest/async-storage-mock.js`, and it is a **default export** (`module.exports = asMock`, no named `AsyncStorage` export) that is itself a full fake implementation backed by an in-memory `__INTERNAL_MOCK_STORAGE__` object (real `getItem`/`setItem` round-trip, not just empty jest.fn() stubs) — so every test in tasks 2.3/2.4/5.3/5.4 should mock the module as `jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'))` and import the default export, matching the already-correct guess in design.md's Testing Strategy for the path, but note here explicitly that it is a default export so no test imports `{ AsyncStorage }` as a named import by mistake
    - _Requirements: 3.1_
  - [x] 1.2 Create `apps/mobile/src/theme/appearance.ts`: `AppearancePreference`/`ActiveTheme` types, `APPEARANCE_PREFERENCE_VALUES`, `DEFAULT_APPEARANCE_PREFERENCE`, `isAppearancePreference`, `resolveActiveTheme`, `resolveStatusBarStyle`, `LIGHT_ROOT_BACKGROUND`, `DARK_ROOT_BACKGROUND` per design.md Components and Interfaces / Configuration & Constants
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 6.2, 6.3_
  - [x] 1.3 Write `apps/mobile/src/theme/__tests__/appearance.test.ts` (unit tests covering every valid/invalid input per design.md Testing Strategy) and `apps/mobile/src/theme/__tests__/appearance.prop.test.ts` (fast-check, ≥100 runs, tagged `// Feature: dark-mode, Property N`) implementing Property 1 (fallback is total) and Property 2 (pinned preference is scheme-invariant)
    - _Requirements: 1.2, 1.3, 1.4, 2.1, 2.2, 3.3_
  - [x] 1.4 Checkpoint — run `npx jest src/theme/__tests__/appearance` and `npm run typecheck` in `apps/mobile` (mobile uses Jest, not Vitest, per repo conventions)

- [x] 2. Storage Wrapper and Zustand Theme Store
  - [x] 2.1 Create `apps/mobile/src/theme/appearanceStorage.ts`: `APPEARANCE_PREFERENCE_KEY`, `getStoredAppearancePreference` (catches read errors and corrupt/missing values, falls back to the default per design.md Error Handling), `setStoredAppearancePreference`, mirroring `api/sessionStorage.ts`'s shape
    - _Requirements: 3.1, 3.3_
  - [x] 2.2 Create `apps/mobile/src/state/themeStore.ts`: Zustand `ThemeState` (`preference`, `hydrated`, `setPreference`, `loadFromStorage`) mirroring `state/sessionStore.ts`'s structure exactly, per design.md
    - _Requirements: 1.2, 3.1, 3.2, 3.4_
  - [x] 2.3 Write `apps/mobile/src/theme/__tests__/appearanceStorage.test.ts` using the confirmed mock from task 1.1 (`jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'))`, default export): the three named Requirement 3.3 failure modes — missing key (nothing set in the mock's `__INTERNAL_MOCK_STORAGE__`), a throwing `getItem` (override the mocked module's `getItem` with `jest.fn().mockRejectedValueOnce(...)` for that one test), and a corrupt stored string (pre-seed the key via the mock's `setItem` with a value outside `APPEARANCE_PREFERENCE_VALUES`) — each resolving to `'system'` without throwing; and a round-trip set/get test
    - _Requirements: 3.1, 3.3_
  - [x] 2.4 Write `apps/mobile/src/state/__tests__/themeStore.test.ts` per design.md Testing Strategy: `loadFromStorage()` with nothing stored → `'system'`/`hydrated: true`; `loadFromStorage()` with a corrupt stored value → `'system'` (the fallback-on-corrupt-storage test); `setPreference('dark')` updates `preference` synchronously and persists; a simulated storage-write failure still leaves `preference` updated in memory; and the `fast-check` (≥100 runs) Property 6 test (`// Feature: dark-mode, Property 6: Appearance_Preference is invariant under any session token change`) driving an arbitrary sequence of `useSessionStore.getState().setToken(...)`/`.clearToken()` calls and asserting `useThemeStore.getState().preference` is unchanged throughout — the Requirement 3.4 regression guard
    - _Requirements: 1.2, 3.1, 3.2, 3.3, 3.4_
  - [x] 2.5 Checkpoint — run `npx jest src/theme/__tests__/appearanceStorage src/state/__tests__/themeStore` and `npm run typecheck` in `apps/mobile`

- [x] 3. `useActiveTheme` Hook
  - [x] 3.1 Create `apps/mobile/src/theme/useActiveTheme.ts`: combines `useThemeStore`'s `preference` with React Native's `useColorScheme()` via `resolveActiveTheme`, per design.md
    - _Requirements: 1.3, 1.4, 2.1, 2.2_
  - [x] 3.2 Write `apps/mobile/src/theme/__tests__/useActiveTheme.test.tsx`: mocks `react-native`'s `useColorScheme` using the concrete pattern design.md specifies (`jest.mock('react-native', () => ({ ...jest.requireActual('react-native'), useColorScheme: jest.fn() }))`, so the rest of the real `react-native` module is preserved and not shadowed — spec-review Finding 4), drives `useThemeStore.setState(...)` directly, asserts the hook's value tracks both inputs and reacts live to a simulated OS scheme change while `preference` is `'system'` (Requirement 2.1), and stays pinned while `preference` is `'light'`/`'dark'` (Requirement 2.2)
    - _Requirements: 1.3, 1.4, 2.1, 2.2_
    - **Superseded note (design-review iteration 3; additive correction):** the spread-form mock named in 3.2's text crashes on RN 0.85.3 (spreading `jest.requireActual('react-native')` eagerly invokes the lazy `DevMenu` getter). The shipped `useActiveTheme.test.tsx` uses the descriptor-copy mock instead. Use that form for any new test, as given in design.md "(Retrofit) Testing strategy" → "OS-scheme mocking". Task 3.2's text above is kept unedited for history.
  - [x] 3.3 Checkpoint — run `npx jest src/theme/__tests__/useActiveTheme` and `npm run typecheck` in `apps/mobile`

- [x] 4. App Root Wiring (Navigation Theme, Status Bar, Safe-Area Background)
  - [x] 4.1 Create `apps/mobile/src/theme/AppearanceChrome.ts`: the exported `AppearanceChrome` interface and `deriveAppearanceChrome(activeTheme)` function per design.md Components and Interfaces — this is the single production code path both `App.tsx` and `App.appearance.test.tsx` call, so the test exercises real production logic rather than a parallel stand-in (spec-review Finding 2)
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - [x] 4.2 Modify `apps/mobile/src/App.tsx`: call `useThemeStore((s) => s.loadFromStorage)` once on mount (alongside the existing session `loadFromStorage` effect); compute `activeTheme` via `useActiveTheme()`; destructure `{ navigationTheme, statusBarStyle, rootBackground }` from `deriveAppearanceChrome(activeTheme)` (task 4.1); pass `theme={navigationTheme}` to `NavigationContainer`; replace `<StatusBar style="auto" />` with `<StatusBar style={statusBarStyle} />`; apply `rootBackground` as the `SafeAreaProvider` root background per design.md
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - [x] 4.3 Write `apps/mobile/src/__tests__/App.appearance.test.tsx`: imports and calls the real, exported `deriveAppearanceChrome` (task 4.1) directly, asserting the (navigationTheme, statusBarStyle, rootBackground) triple is correct for both Active theme values, per design.md Testing Strategy (does not re-render the full `App.tsx` tree with its push/notification wiring — see design.md for why this is no longer a stand-in-vs-production gap); include the `fast-check` (≥100 runs, tagged `// Feature: dark-mode, Property 3: chrome triple is a pure function of Active theme`) Property 3 test over the full `(preference, osScheme)` input domain, resolving each pair via `resolveActiveTheme` before feeding it to `deriveAppearanceChrome`, per design.md
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - [x] 4.4 Checkpoint — run `npx jest src/__tests__/App.appearance` and `npm run typecheck` in `apps/mobile`

- [x] 5. Profile Screen Appearance Control
  - [x] 5.1 Create `apps/mobile/src/screens/AppearancePreferenceControl.tsx` per design.md: three `Chip` options (System/Light/Dark) from `theme/components.tsx`, reading/writing `useThemeStore` directly, satisfying Requirement 5's accessibility criteria via `Chip`'s existing `accessibilityRole`/`accessibilityState`/label behavior
    - _Requirements: 4.2, 4.3, 4.4, 5.1, 5.2, 5.3_
  - [x] 5.2 Insert a new titled `Card` rendering `<AppearancePreferenceControl />` into `apps/mobile/src/screens/youAndCrew/YouAndCrewScreen.tsx`'s "Preferences & Security" self-mode section, between the existing Notifications and Account Security cards. **(Corrected — see Notes.)** This task originally named `apps/mobile/src/screens/ProfileScreen.tsx`'s self-mode block; that file's default-exported screen is not registered on any navigator (only its `ProfileIdentityBlock` export is reused elsewhere), because the earlier `navigation-redesign` spec had already relocated the App's reachable Profile/settings surface onto `YouAndCrewScreen.tsx` before this task was implemented. The real, reachable implementation inserts the control into `YouAndCrewScreen.tsx` as described here.
    - _Requirements: 4.1_
  - [x] 5.3 Write `apps/mobile/src/screens/__tests__/AppearancePreferenceControl.test.tsx` per design.md Testing Strategy: mocks only `@react-native-async-storage/async-storage`; for each of the three states, asserts the corresponding `Chip`'s `accessibilityState.selected` is `true` and the others `false`; `fireEvent.press` on each other option updates `useThemeStore.getState().preference` and the mocked storage after `waitFor`
    - _Requirements: 1.1, 2.1, 2.2, 3.1, 4.2, 4.3, 5.1, 5.2, 5.3_
  - [x] 5.4 Write `apps/mobile/src/screens/__tests__/AppearancePreferenceControl.prop.test.tsx` per design.md Testing Strategy: `fast-check` (≥100 runs each) Property 4 (`// Feature: dark-mode, Property 4: control selection always agrees with store state`) driving an arbitrary sequence of option presses on the real rendered control and asserting agreement with `useThemeStore.getState().preference` after each; Property 5 (`// Feature: dark-mode, Property 5: every option is labeled and operable regardless of selection state`) asserting every option's accessible label/role independent of selection state
    - _Requirements: 4.2, 4.3, 5.1, 5.2, 5.3_
  - [x] 5.5 Extend `apps/mobile/src/screens/youAndCrew/__tests__/YouAndCrewScreen.test.tsx`: the Appearance card and all three `appearance-option-*` testIDs render in self-mode; the card does not render when `YouAndCrewScreen` is viewing a different (non-self) User. **(Corrected — see Notes.)** This task originally named `apps/mobile/src/screens/__tests__/ProfileScreen.test.tsx`, which has no Appearance assertion today (the task was never actually carried out against that file); the real test coverage belongs in `YouAndCrewScreen.test.tsx`, the suite for the screen that actually renders the control.
    - _Requirements: 4.1_
  - [x] 5.6 Checkpoint — run `npx jest src/screens/__tests__/AppearancePreferenceControl src/screens/youAndCrew/__tests__/YouAndCrewScreen` and `npm run typecheck` in `apps/mobile`

- [x] 6. Final Verification Gate
  - [x] 6.1 Run the full `npm run verify` (typecheck + test suite across `apps/api`, `apps/mobile`, `packages/shared`) once, as the final gate for the complete change; paste the literal tail output (per-workspace pass counts and exit code) before declaring the feature done. Confirm `apps/api` and `packages/shared` are unaffected (no files touched in either workspace) — this task's gate exists to catch any accidental cross-workspace regression, not because this feature is expected to change either workspace
    - _Requirements: all_
    - Ran `npm run verify` from the repo root. Result: exit code 0. `apps/api`: 411 test files / 2905 tests passed. `apps/mobile`: 261 test suites / 1829 tests passed. `packages/shared`: 37 test files / 470 tests passed. `git status`/diff confirm no files under `apps/api` or `packages/shared` are touched by this feature. (One earlier run in this session hit a single flaky failure in an unrelated pre-existing test, `ExperienceDetailScreen.recreationExperience.test.tsx`; re-running that file alone and the full mobile suite twice more, plus this final full `npm run verify`, all passed clean — confirmed not caused by this feature's changes.)

- [ ] 7. Retrofit Foundation (Twilight tokens, hooks, test infrastructure)
  - [ ] 7.1 Capture the light baseline **before any visual change**. Start Expo Go on the `Pixel_7` AVD (`npm run dev:cloud` in `apps/mobile`) on a signed-in test account. For every screen on the task 11.1 checklist, run `adb exec-out screencap -p > .agents/tasks/dark-mode-retrofit/screenshots/NN-<screen>-baseline.png`. If no account or backend is reachable, pause and ask the user. Do not skip.
    - _Requirements: 9.2, 12.2_
  - [x] 7.2 Extend `apps/mobile/src/theme/theme.ts` per design.md "(Retrofit) `theme.ts`". Add `ColorScheme`, `lightColor` (today's values + `primaryFg`), `darkColor` (`as const satisfies ColorTokens`), `GradientTokens`/`ShadowTokens`/`TabBarTokens`/`CategoryVisual`/`AppTheme`, `categoryMeta`, both category-tint maps, `lightTheme`/`darkTheme`/`themes`, `DARK_TONAL`, `withAlpha` (accepts `#rgb`/`#rrggbb`/`#rrggbbaa`, `rgb()` and `rgba()`, replacing alpha; throws `Error('withAlpha: unsupported colour <v>')` otherwise), and `definePalette`. Use the exact values in Configuration & Constants. Keep the legacy exports (`color`, `gradient`, `shadow`, `parkAccent`, `categoryVisual`, `resortVisual`, `theme`) as light aliases. Import nothing at runtime from `appearance.ts`/`useActiveTheme.ts`/the store (no cycle).
    - **(iteration 3)** These additions apply:
      - `GradientTokens` gains `fab` and `chartBar`. Both light values equal today's `headerVivid`.
      - `CategoryVisual` gains `fill`, with light `fill === tint` and `CATEGORY_FILL_DARK` per "(Retrofit) Category fills".
      - Dark `primaryLight` is `#b28dff`.
      - Dark `gradient.header` is `['#7e57c2','#7650b9']`.
      - `withAlpha` output is exactly `` `rgba(${r}, ${g}, ${b}, ${alpha})` ``.
    - _Requirements: 7.1, 7.2, 7.3, 8.4_
  - [x] 7.3 Create `theme/useAppTheme.ts` (`useAppTheme`, `usePalette`) and `theme/makeStyles.ts`, exactly as in design.md.
    - _Requirements: 8.1, 8.2, 8.3_
  - [x] 7.4 In `theme/appearance.ts`, set `LIGHT_ROOT_BACKGROUND = lightTheme.color.background` and `DARK_ROOT_BACKGROUND = darkTheme.color.background` (`#120a1f`). In `theme/AppearanceChrome.ts`, add `buildNavigationTheme` (light returns `DefaultTheme` by identity; dark is a module-constant token-built theme) and use it in `deriveAppearanceChrome`. Update `src/__tests__/App.appearance.test.tsx`: replace the `toBe(DarkTheme)` assertions with Property 12's token assertions, keep Property 3's property, and add `DARK_ROOT_BACKGROUND === '#120a1f'`.
    - _Requirements: 10.3, 10.4, 6.1, 6.3_
  - [x] 7.5 Create `apps/mobile/__mocks__/@react-native-async-storage/async-storage.js` containing `module.exports = require('@react-native-async-storage/async-storage/jest/async-storage-mock');`. Leave the existing per-file `jest.mock` calls in place. Create `apps/mobile/src/test/themeTestUtils.ts` (`setTestScheme`, `resetTestScheme`, and `setTestOsScheme`, which drives the descriptor-copy `useColorScheme` mock from `useActiveTheme.test.tsx` and throws a clear error if that mock isn't installed; see design.md "OS-scheme mocking").
    - _Requirements: 8.2_
  - [x] 7.6 Create `theme/contrast.ts` (`relativeLuminance`, `contrastRatio`, `mixOver`, `CONTRAST_REQUIREMENTS` covering every dark pair in Configuration & Constants, including the `DARK_TONAL` fg-on-surface, fg-on-tint and white-on-fill pairs, and every row of (superseded by the iteration-3 note below) `.agents/tasks/dark-mode-retrofit/design.md` "Additional used dark pairs": badge-on-tint over surfaceAlt/background, park accents vs surfaceAlt/background, textSecondary on tonal tints, tonal fg on background, the selected row, and the `TIER_TEXT` dark values). **(iteration 3)** The source for every row is now this spec's design.md Configuration & Constants: "(Retrofit) Additional used dark pairs", "(Retrofit) Category fills", "(Retrofit) Iteration 3 pairs" and the pin-tier table. Add the iteration-3 rows: `primaryLight` badge pairs; white on every dark `fill` (min 4.5); the non-text graphics pairs (min 3.0); and the rule-1a pairs. **(iteration 4)** Also add, at min 3.0, `gradient.header` stops vs `background` (3.70 / 3.32) and the Chip-active fill `primary` vs `surface` and `background` (3.36 / 3.70). Do not add the `surfaceAlt` values (2.98 / 2.67); criterion 7.5 is scoped to `surface`/`background` (design.md "Scope of criterion 7.5"). Write the tests:
    - **(iteration 4)** The Property 7 `/^#[0-9a-f]{6}$/` check also covers every `parkAccent.*`, `categoryVisual[k].tint`/`.fill` and `resortVisual.tint`/`.fill` value in both schemes.
    - **(iteration 3)** `theme.tokens.test.ts` also covers the Property 7/8 iteration-3 additions (`fill`, `fab`, `chartBar`, the `#rrggbb` check, the `withAlpha` string) and Property 22's pure half (`// Feature: dark-mode, Property 22: role-converted token reads and category fills stay legible in dark`)
    - `theme/__tests__/contrast.prop.test.ts` (`// Feature: dark-mode, Property 9: declared contrast floors hold`, at least 100 runs)
    - `theme/__tests__/theme.tokens.test.ts` (Property 7 key parity and Property 8 light byte-identity, plus `withAlpha`/`definePalette` unit cases)
    - `theme/__tests__/useAppTheme.test.tsx` (Property 10)
    - `theme/__tests__/makeStyles.prop.test.tsx` (Property 11, including "factory not called at `require` time")
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.2, 8.3, 8.4, 9.8, 9.9, 9.11_
  - [x] 7.7 Checkpoint: run `npx jest src/theme src/__tests__/App.appearance --maxWorkers=4` and `npm run typecheck` in `apps/mobile`. Both must be green.

- [ ] 8. Shared Kit, Navigation Chrome, and Regression Guard (sequential, before any batch)
  - [x] 8.1 Convert `theme/components.tsx` and `theme/charts.tsx` to `makeStyles`/`useAppTheme` per design.md's "Shared kit token mapping". Move `hexToRgba` to `withAlpha`. Create `theme/components.palette.ts` (`HEADER.eyebrowText`, `DANGER_BUTTON`). `Card` spreads `t.outline.card`. `Badge` defaults to `primaryFg`. `SecondaryButton`/`EmptyState`/charts use `primaryFg` for text and icons.
    - **(iteration 3)** The kit gets these changes:
      - `ProgressBar`'s default fill becomes `primaryFg`.
      - `ProgressRing`'s default arc becomes `[primaryLight, primaryFg]`.
      - `RatingHistogram` bars use `gradient.chartBar`.
      - `PrimaryButton` keeps `gradient.header`, which has a new dark value.
      - `withAlpha` keeps `hexToRgba`'s exact output string.
    - Before editing, snapshot the 8.1–8.3 files. After 8.3, run the light-colour multiset audit from design.md "(Retrofit) Batch decomposition" on every W1 file and record its result.
    - _Requirements: 7.5, 9.1, 9.3, 9.4_
  - [x] 8.2 Convert `components/{ActiveTripShortcut, DatePickerField, ResortPicker, TimeWheelPicker}.tsx`. `DatePickerField`'s calendar gets the themed theme plus `key={t.scheme}`, and a `DatePickerField.palette.ts` pair for disabled days. Also convert `features/notifications/{AttentionBadge, AttentionItemRow, NotificationBell}.tsx` (the AttentionBadge `#e11d48` fill becomes `DARK_TONAL.red.fill` in dark) and `screens/AppearancePreferenceControl.tsx`. Apply the conversion rules and the `TextInput` rules.
    - _Requirements: 9.1, 9.4, 9.6, 9.7, 9.8_
  - [x] 8.3 Convert `navigation/RootNavigator.tsx` (tab tints and badge from `t.tabBar`, no `tabBarStyle`), the `navigation/*Stack.tsx` files if they carry colours, and `screens/quickAction/{MagicFab, QuickActionSheet}.tsx` per design.md.
    - **(iteration 3)** The `MagicFab` disc uses `t.gradient.fab`. Light equals today's `headerVivid` values.
    - _Requirements: 7.5, 10.1, 10.2, 10.5_
  - [x] 8.4 Write the tests:
    - `theme/__tests__/components.theme.test.tsx` and `charts.theme.test.tsx` (`// Feature: dark-mode, Property 16` and `Property 17`)
    - `navigation/__tests__/tabBarTheme.test.tsx` (Property 13)
    - `components/pins/__tests__/artworkInvariance.test.tsx` (Property 18, with every `TIER_COLOR` tier and every `AVATAR_PRESET_IDS` id)
    - `components/__tests__/nativeControlsTheme.test.tsx` (Property 19: `DatePickerField` calendar theme + scheme `key`, `ResortPicker` `TextInput` props, plus the default-text exclusion cases: nested `Text` and `Text` on a gold fill get no `textPrimary`)
    - `theme/__tests__/consumerPatterns.prop.test.tsx` (`// Feature: dark-mode, Property 20: memoized and virtualized consumers repaint live`, at least 100 runs, including the control variant that must fail to repaint)
    - dark cases for the 8.2/8.3 components that have existing render tests
    - existing light assertions (e.g. in `pinTabBadge.test.tsx`) must keep passing unchanged
    - **(iteration 3)** These test changes apply:
      - The Property 16 additions go in `charts.theme.test.tsx`/`components.theme.test.tsx`: histogram `chartBar`, `ProgressBar` fill `primaryFg`, `ProgressRing` arc, and the `PrimaryButton` gradient.
      - Property 13 now asserts `gradient.fab`.
      - The 8.2/8.3 dark cases go in the W1-owned tests listed in design.md "W1 … Test ownership (iteration 3)", including `quickActionComponents.test.tsx` and `notificationNavigation.test.tsx`.
    - _Requirements: 7.5, 8.2, 8.5, 9.1, 9.3, 9.5, 9.6, 9.7, 10.1, 10.2, 10.5_
  - [x] 8.5 Create `src/test/themeGuard.ts` (pure `scanSource`, `ARTWORK_AND_TOKEN_FILES`, `THEME_INTERNALS`, `PALETTE_FILE`, `STATIC_IMPORT_RE`, `NAMESPACE_IMPORT_RE`, `FORBIDDEN_THEME_IMPORTS`, and the `namespaceImport` rule) and `src/__tests__/themeRetrofit.guard.test.ts`, exactly per design.md, with `PENDING_RETROFIT` holding the B1–B7 file lists and `THEME_GUARD_STRICT` support. Write `src/test/__tests__/themeGuard.prop.test.ts` (`// Feature: dark-mode, Property 15`, at least 100 runs, including multi-line, `type`, `as`-aliased and namespace imports) and the Property 14 palette scan (including `withAlpha(v, 0.14)` not throwing on every token and palette value). The guard must be green on the tree: every W1-owned file is clean, and only `PENDING_RETROFIT` files have violations. **(iteration 3)** `staticImport` also flags an aliased `theme as <alias>` specifier, and Property 15 includes that fixture.
    - _Requirements: 11.1, 11.2, 11.3, 11.5_
  - [ ] 8.6 Checkpoint: run `npm run verify:mobile` once. It must be green before any batch starts.

- [x] 9. Screen Retrofit — seven parallel batches (disjoint files; design.md "(Retrofit) Batch decomposition")
  - Every batch follows the same rules. It edits only its listed files, the test files it owns and new co-located `<File>.palette.ts` files. It applies the literal conversion rules exactly, keeps light values byte-identical, and makes no exported-signature changes. It adds `...t.textDefault` to a `Text`/`TextInput` style that had no colour, under the default-text rule below. It adds a `describe('dark mode')` case (asserts a, b, c, plus d on the designated screen) to each existing render test of a top-level screen, modal or sheet.
  - **Amended by design-review iteration 2.** These rules refine the line above:
    - **Test ownership is exact.** A batch owns a test in a `__tests__/` directory whose first dot-separated filename segment equals an owned file's basename. It also owns the explicit cross-cutting tests in design.md "Ownership rules" (B7: every `screens/stats/**/__tests__/` and `screens/stats/__testSupport__/` file, `consumerSurfacesTaxonomy.test.ts`, `shareEntryPointProjection.prop.test.tsx`; B4: `TripScheduleScreen.test.tsx`). Any other failing test is a stop-and-report.
    - **`...t.textDefault`** goes only on a `Text`/`TextInput` that sets no colour, isn't nested in a `Text`, and sits on a themed surface. Text on a G/H/V, gradient, image or art background is left unchanged.
    - **Memoized consumers.** Every `useMemo`/`useCallback`/effect reading `styles`/`t`/a palette lists it in deps. No `useRef` holds a colour. Every `FlatList`/`SectionList`/`DraggableFlatList` whose render callbacks read parent `styles`/`t` gets `extraData` including `t.scheme`.
    - **Test (d).** On the batch's designated screen (design.md Testing Strategy), mount under light, call `setTestScheme('dark')` without remounting, and assert a row's dark colour.
    - **Report.** The report lists every memo or list site touched.
  - **Done when** all of these hold:
    - `$env:THEME_GUARD_STRICT='<id>'; npx jest src/__tests__/themeRetrofit.guard.test.ts --maxWorkers=2` is green.
    - Owned tests pass with `--maxWorkers=2`.
    - `npm run typecheck --workspace apps/mobile` shows zero errors in owned files.
    - A read-only diff audit shows every removed literal reappears as a palette `light` value, or as a token whose light value equals it. The audit runs against a pre-batch snapshot of the owned files, copied to `$env:TEMP\dark-mode-snapshot\<batch>\` before editing and compared with `git diff --no-index`, not against `HEAD`, because many owned files already carry unrelated uncommitted edits. The snapshot is deleted afterwards.
    - **(iteration 3)** The pass/fail proof of the audit is the **light-colour multiset audit** in design.md "(Retrofit) Batch decomposition". It runs as a stdin `node -` script with the esbuild loader, and `before(F) == after(F)` must hold for every owned file. Every difference is listed in the report with its rule justification, and an unexplained difference fails the batch. The batch also applies conversion rules 1a (out-of-role token reads) and 2a (template-literal alpha suffixes verbatim), and the category `tint`/`fill` split.
    - **(iteration 4)** The audit uses the amended design.md text. These amendments apply:
      - `before(F)` also counts bare reads of names the snapshot imports from the theme module (`import { color }` in `NotificationBell.tsx`/`AvatarChip.tsx`, `import { theme, categoryVisual }` in `ExperienceListDetailScreen.tsx`/`ExperiencePicker.tsx`), plus their `[*]` computed forms.
      - `after(F)` resolves palette aliases declared as `const x = usePalette(P);` or `const x = P[t.scheme];` and counts `P.light[k]` for every `x.k` (`x[…]` → `P[*]`). Palette records are never destructured.
      - rgb()/rgba() values are normalised numerically with `Number()`, so `0.10` ≡ `0.1`.
      - Rule-5 exempt literals are counted on both sides. An exempt literal new in F is a listed difference.
      - **(iteration 5)** A numeric `withAlpha(t.x, a)` call counts once, as its rgba value: its span is removed from F before the `t.<GROUPS>` read regex runs, so the base token is not also counted (e.g. `withAlpha(t.color.primary, 0.10)` → exactly `rgba(91,42,134,0.1)`). A `withAlpha` with a non-numeric alpha keeps its `t.<path>` as an ordinary read.
    - **(iteration 4)** Rule 2a covers any token, park accent, category tint/fill, tier colour or palette value suffixed as `` `${X}NN` `` or `X + 'NN'` (e.g. `HomeFavoritesSection.tsx:135`, `ResortsDirectoryScreen.tsx:2262`, `TripExpensesScreen.tsx:945`). Any palette value used that way is `#rrggbb` in both schemes, and the report lists each such site.
    - **(iteration 4)** The report lists any `PrimaryButton` or active `Chip` found rendered directly on a `surfaceAlt` container (outside criterion 7.5's scope).
  - The report includes a behavior→test map and lists the converted files that have no render test.
  - [x] 9.1 B1 Explore & destinations: `screens/catalog/{ExploreHubScreen, DestinationScreen, ParkDestinationScreen, ResortsDirectoryScreen, ResortGuideSection, CrowdCalendarScreen, LocationGroupSection, TodayInParkLens}.tsx` and `destinationVisuals.ts`. Remove `accent` (consumers use `t.parkAccent`, or `primaryFg` for Resorts) and keep the gradients. The CrowdCalendar `Calendar` gets `key={t.scheme}`.
    - **(iteration 3)** The category placeholder tiles in `DestinationScreen.tsx:1013`, `ExploreHubScreen.tsx:900` and `ParkDestinationScreen.tsx:1445` use `t.categoryVisual[cat].fill` (or `t.resortVisual.fill`). Add Property 22's tile assertion to the `ExploreHubScreen` test. (B2 applies the same rule to `ExperienceDetailScreen.tsx:1177`.)
    - _Requirements: 8.5, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.10, 9.11_
  - [x] 9.2 B2 Experience detail & live: the B2 list in design.md (21 catalog detail files, `catalog/live/*` 5 files, `liveWaits/LiveWaitsScreen.tsx`).
    - **(iteration 3)** The `ExperienceDetailScreen.tsx:1177` hero placeholder uses `t.categoryVisual[cat].fill`, and its glyph stays `textOnPrimary`.
    - _Requirements: 8.5, 9.1, 9.2, 9.3, 9.4, 9.6, 9.7, 9.8, 9.10, 9.11_
  - [x] 9.3 B3 Logging sheets & lists: 11 catalog logging/sheet files, `foodLists/*.tsx`, `experienceLists/*.tsx`.
    - **(iteration 3)** Under rule 1a, the `foodLists/MarkGottenUndoToast.tsx` inverse toast becomes the H-role pair `{ light: '#1f1235', dark: '#1f1235' }` with `textOnPrimary`/`accent` text, plus `...t.outline.card`. Add Property 22's toast case to `foodLists/__tests__/MarkGottenUndoToast.test.tsx`, and name the site in the report.
    - _Requirements: 8.5, 9.1, 9.2, 9.3, 9.4, 9.6, 9.7, 9.8, 9.10_
  - [x] 9.4 B4 Trip money & schedule: `trips/{TripScheduleScreen, TripExpensesScreen, ExpenseFormModal, TripBalancesScreen, SettlementModal, RefundModal, ReceiptReviewModal}.tsx`.
    - _Requirements: 8.5, 9.1, 9.2, 9.3, 9.4, 9.6, 9.7, 9.8_
  - [x] 9.5 B5 Trip shell: the 16 remaining `trips/*.tsx` files in design.md's B5 list.
    - **(iteration 3)** Under rule 1a, the `TripReservationsScreen.tsx` `kindChipTextActive`/`dateChipTextActive` (`theme.color.surface` on a `primary` fill) become `t.color.textOnPrimary`. Add Property 22's chip case to `trips/__tests__/TripReservationsScreen.test.tsx`, and name the sites in the report. The `${theme.color.X}NN` suffixes (e.g. `AttachedExperienceListsSection`, `TripDetailScreen`, `GroupFavoritesSection`) are converted verbatim under rule 2a.
    - _Requirements: 8.5, 9.1, 9.2, 9.3, 9.4, 9.6, 9.7, 9.8, 9.10_
  - [x] 9.6 B6 Home, Vault, pins UI, social: `home/*.tsx`, `collection/CollectionScreen.tsx`, `profile/*.tsx` (UI only; pin art stays mode-invariant), `share/*.tsx`, `notifications/NotificationCenterScreen.tsx`. Create `screens/profile/tierText.palette.ts` (`TIER_TEXT`, conversion rule 7; light = `TIER_COLOR`, dark amethyst `#c08ff5` and bronze `#e0965f`). Use `usePalette(TIER_TEXT)[tier]` for every tier `Badge` `color` and tier text or icon in `PinCelebrationModal`, `PinDetailModal`, `PinShowcaseScreen` and `CollectionScreen`. Tier dots and fills keep `TIER_COLOR`, and `pinTierMeta.ts` isn't edited. Write `screens/profile/__tests__/PinDetailModal.tierText.test.tsx` (`// Feature: dark-mode, Property 21: pin tier UI text is legible while tier art is unchanged`).
    - _Requirements: 8.5, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9_
  - [x] 9.7 B7 Identity, stats, friends: `stats/**` (`statsView.ts` takes a theme parameter; its tests pass `lightTheme`), `friends/*.tsx`, `screens/navigation/*.tsx`, `youAndCrew/YouAndCrewScreen.tsx`, the 8 root `screens/*.tsx` listed in design.md, and `catalog/__tests__/consumerSurfacesTaxonomy.test.ts` (switch to `categoryMeta`/`lightTheme`). B7 also owns, and updates for the new `statsView` theme parameter, every test under `screens/stats/**/__tests__/` and `screens/stats/__testSupport__/` (e.g. `orderingDeterminism.prop.test.ts`), plus `catalog/__tests__/shareEntryPointProjection.prop.test.tsx`.
    - _Requirements: 8.5, 9.1, 9.2, 9.3, 9.4, 9.6, 9.7, 9.8_

- [x] 10. Integration and Conventions
  - [x] 10.1 Remove the legacy static colour exports and the colour keys of `theme` from `theme.ts`, so that `theme` = `{ spacing, radius, layout, typography }`. Update every remaining test that imports them (e.g. to `lightTheme`/`categoryMeta`). Delete `PENDING_RETROFIT` and the `THEME_GUARD_STRICT` handling, and make the end-state assertion unconditional. Run `npm run typecheck` and the guard. Both must be green. **(iteration 3)** Also remove `export type Theme = typeof theme`, which has no consumers. Use `AppTheme`.
    - _Requirements: 11.1, 11.4_
  - [x] 10.2 Update the `.kiro/steering/tech-conventions.md` Mobile conventions bullet ("themed component kit") to cover four things: styles via `makeStyles((t) => …)`/`useAppTheme()`; literals via co-located `definePalette` with light = original; `primary` for fills and `primaryFg` for text and icons; and `themeRetrofit.guard.test.ts` failing on raw colours or static token reads.
    - _Requirements: 12.1_

- [ ] 11. Visual Verification
  - [ ] 11.1 Run Expo Go on the `Pixel_7` AVD and capture `NN-<screen>-light.png` and `NN-<screen>-dark.png` (Appearance set to Dark in You & Crew) into `.agents/tasks/dark-mode-retrofit/screenshots/`. The checklist: Login, Register, Forgot/Reset Password, Home, You & Crew with Appearance, Explore hub, a Destination, a Park destination, Resorts directory, Crowd calendar, Live waits, Experience detail (ride Today lens, Passport lens, restaurant), Menu, Trips list, Trip detail, Schedule, Expenses, Balances, Expense form modal, Members, Feed, Summary, Reservations, Planned list, Vault, Pin board, Pin showcase, Food lists + detail, Experience lists + detail, Stats + one detail, Friends list/search/profile, Notification center, Inbox, Sent shares, Share composer, MagicFab sheet, Date picker modal, tab bar. Also capture one shot with Appearance = System while the emulator OS is dark (`adb shell cmd uimode night yes`).
    - _Requirements: 9.1, 9.2, 10.1, 12.2_
  - [ ] 11.2 View every PNG. Compare light against baseline side by side for any change. Check the dark shots for light surfaces, black or invisible text, unreadable icons and recoloured art. Fix each finding in the owning file, add a regression test at the layer that was wrong, re-capture the shot, and record the findings list.
    - _Requirements: 9.1, 9.2, 9.5, 12.2_

- [x] 12. Final Verification Gate
  - [x] 12.1 Run `npm run verify` once from the repo root and paste the literal tail (per-workspace counts and exit code `0`). Confirm with `git status` that no `apps/api` or `packages/shared` files changed and no stray helper files remain. Changes to pin artwork, motifs or the catalogue would require the pin gate; none are expected.
    - _Requirements: all_

- [ ] 13. Dark-mode polish pass (design.md "(Retrofit) Polish-pass rulings" and "Polish-pass constants")
  - [ ] 13.1 Selected states: `ParkWaitPulse` active ring → `DARK_TONAL.green.fg`; `ShareComposer` unselected ring → `textSecondary`; Expenses tabs and Balances toggle get a `tabActiveBg`/`toggleActiveBg` key (light `#ffffff`, dark `borderStrong`) with the idle label `textSecondary`; `ExpenseFormModal` active tier count pill gets `tierPillActiveBg`/`tierPillActiveBorder`; the Schedule showtime pill gets `showtimeActiveBorder`. Add the two missing tier-count `TextInput` `keyboardAppearance` props (rename the shadowing `tiers.map((t, …))` parameter to `tier`). Tests: `ParkWaitPulse.dark.test.tsx`, `ShareComposerScreen.dark.test.tsx`, and dark/light cases in `TripExpensesScreen.test.tsx`, `TripBalancesScreen.test.tsx`, `TripScheduleScreen.test.tsx` (`// Feature: dark-mode, Property 23`).
    - _Requirements: 9.6, 9.12_
  - [ ] 13.2 Text hierarchy and on-photo overlays: the `#655d78` band → `textSecondary` and same-component ink → `textPrimary` in ResortGuide, LocationGroup, LensSwitcher, LiveWaitCockpit, PassportAndLoreLens, DiningReservationCard and ParkPassportCard; Expenses/Balances name ink → `textPrimary`; Resorts tier badges equal their light fills. Tests assert against `darkTheme.color.*` tokens or light values, never the palette key being fixed.
    - _Requirements: 9.13, 9.14_
  - [ ] 13.3 Switches: create `theme/switchColors.ts` (`themedSwitchProps`) and apply it with `key={t.scheme}` at all six `Switch` sites; mirror the tokens in `FORM_SWITCH`/`NOTIFICATION_SWITCH` dark. Tests: `theme/__tests__/switchColors.test.ts` (`// Feature: dark-mode, Property 24`, ≥ 100 runs) and dark/light render cases in `PushNotificationPreferenceControl.test.tsx`, `NoteControl.shareable.test.tsx` (including the remount), `ReceiptReviewModal.test.tsx` and `TripExpensesScreen.test.tsx`.
    - _Requirements: 9.15_
  - [ ] 13.4 Remaining review findings: `hubSectionsFor(scheme)` (B5-1, snapshot unchanged), the memoized `FoodItemPickerModal` `extraData` (B3-N2), the `orderingDeterminism` token assertion and Property tag (B7), the kind-chip icon assertion (B5-3), and dark render tests for `AddToTripPickerSheet`/`AddToTripOrListChoiceSheet` (B3-N3), `RegisterScreen` and `AvatarChip` (B7).
    - _Requirements: 9.1, 9.2, 9.5, 9.10_
  - [ ] 13.5 Declare every new dark pair in `theme/contrast.ts` `CONTRAST_REQUIREMENTS` (the Switch rows derived from `themedSwitchProps(darkTheme, …)`), and keep `themeRetrofit.guard.test.ts` green with no allowlist edits.
    - _Requirements: 7.4, 9.12, 9.15, 11.1_

- [x] 14. Native window background behind the Android gesture bar (polish Fix 11, user-approved `expo-system-ui`)
  - [x] 14.1 Run `npx expo install expo-system-ui` in `apps/mobile` and pin `"expo-system-ui": "56.0.5"` exactly in `apps/mobile/package.json`, syncing the root `package-lock.json`. In `App.tsx`, add a `useEffect` keyed on `rootBackground` that calls `SystemUI.setBackgroundColorAsync(rootBackground)` and logs a rejection with `console.warn`. Make no `app.config.ts` change: prebuild auto-applies the plugin (design.md External Interfaces). Tests: `src/__tests__/App.systemUI.test.tsx` renders the real `App` with `expo-system-ui`, the navigator subtree and the push hooks mocked. It asserts `'#120a1f'` in dark, `'#f5f2fb'` in light, one more call per theme flip while mounted, no extra call on an unchanged re-render, and a logged, non-crashing rejection (`// Property 25`). Device check: You & Crew scrolled to the bottom, plus Sent Shares, in Dark on `emulator-5554`. Rows 2337–2399 sample `#120a1f` (`screenshots/polish/p69-*`, `p70-*`).
    - _Requirements: 6.5, 6.4_

## Notes

- **Post-implementation correction (docs-drift audit, HIGH-1): tasks 5.2/5.5 target
  `YouAndCrewScreen.tsx`, not `ProfileScreen.tsx`.** Both this file and design.md originally said
  the Appearance control is inserted into `ProfileScreen.tsx`'s self-mode block, and that its test
  coverage lives in `ProfileScreen.test.tsx`. That was false: `ProfileScreen.tsx`'s default-exported
  screen is not registered as a route on any navigator (only its `ProfileIdentityBlock` export is
  reused, inside `YouAndCrewScreen`), because the earlier `navigation-redesign` spec had already
  relocated the App's reachable Profile/settings surface onto `YouAndCrewScreen.tsx` before this
  dark-mode spec was implemented. The real, reachable control lives in `YouAndCrewScreen.tsx`'s
  "Preferences & Security" section, and its real tests are in
  `apps/mobile/src/screens/youAndCrew/__tests__/YouAndCrewScreen.test.tsx`. This note and the
  corrected task text above are additive corrections per the repo's spec-editing convention; the
  original task numbering/checkboxes are unchanged.
- **Planning-time verification (this revision).** Every path/symbol/version referenced by the
  existing tasks below was checked against the real repo before refining the wording: confirmed
  `apps/mobile/package.json` has no `@react-native-async-storage/async-storage` dependency today
  and no existing `AsyncStorage`/`useColorScheme` usage anywhere in `apps/mobile/src`; confirmed
  `theme/theme.ts`'s single static frozen `theme` export (no context/hook) and `theme/components.tsx`'s
  `Chip` component's exact props/accessibility behavior (`accessibilityRole="button"`,
  `accessibilityState={{ selected: active }}`); confirmed `state/sessionStore.ts` /
  `api/sessionStorage.ts`'s mirror-pattern shape (`token`/`hydrated`/`setToken`/`clearToken`/
  `loadFromStorage`, with `api/sessionStorage.ts` as the sole `expo-secure-store` I/O boundary);
  confirmed `App.tsx`'s current structure (`GestureHandlerRootView` > `SafeAreaProvider` >
  `QueryClientProvider` > `NavigationContainer` + `StatusBar style="auto"`, one `loadFromStorage`
  effect for the session store); confirmed `ProfileScreen.tsx`'s self-mode block and its
  Notifications/Account Security `Card` ordering (`PushNotificationPreferenceControl` then
  `ChangePasswordControl`); confirmed `@react-navigation/native`'s `DarkTheme`/`DefaultTheme`
  exports and the installed `@react-navigation/native-stack@6.11.0` version design.md cites; and
  fetched the real `@react-native-async-storage/async-storage@2.2.0` package from the npm
  registry to confirm its jest mock's exact path and export shape (task 1.1, corrected below —
  design.md's path guess was right, but it did not previously confirm the export is a **default**
  export backed by a real in-memory fake, not bare `jest.fn()` stubs). No task path, symbol, or
  version in this file needed correction beyond that one jest-mock export-shape clarification;
  everything else the existing tasks named was already accurate against the real code.
- **No visual retrofit in this plan.** No task above changes any existing screen's `StyleSheet`
  colors or converts any of the 135 `theme`-importing files (or the 15 hardcoded-hex files named
  in design.md) to a theme-aware source. That is explicit, deliberate follow-up scope — see
  requirements.md's Introduction and Out of Scope. Do not expand any task above into a per-screen
  retrofit without first amending requirements.md/design.md per the repo's spec-authoring
  convention.
- **One AsyncStorage key, one store, one hook.** `APPEARANCE_PREFERENCE_KEY` (Task 2.1) is the only
  key this feature reads or writes; `useThemeStore` (Task 2.2) is the only Zustand store for this
  preference; `useActiveTheme()` (Task 3.1) is the only place `useColorScheme()` is called. Any
  future consumer (including the follow-up retrofit spec) should call `useActiveTheme()` rather
  than re-deriving the Active theme independently.
- **`DARK_ROOT_BACKGROUND`'s value is a placeholder, not a design decision.** `'#121212'` (Task
  1.2) is a neutral baseline so the chrome doesn't flash white; it is explicitly not a Disney-
  themed dark palette color and may be replaced by the follow-up retrofit spec once that palette
  is designed.
- **No backend or shared-package changes.** Confirmed during design: this feature touches only
  `apps/mobile`. If implementation surfaces a genuine need to touch `apps/api` or
  `packages/shared`, stop and flag it rather than proceeding — per the task's explicit instruction,
  this would be a scope deviation requiring a spec amendment and user confirmation, not a silent
  addition.
- **Superseding note (retrofit amendment) — "No visual retrofit in this plan" and the
  `DARK_ROOT_BACKGROUND` placeholder note above.** Both describe Tasks 1–6 only. Tasks 7–12
  add the per-screen retrofit (Requirements 7–12), and Task 7.4 replaces `'#121212'` with the
  dark `background` token value `#120a1f`. The notes above are kept unedited for history. The
  "no backend or shared-package changes" note still holds for Tasks 7–12.
- **Retrofit execution model.** Tasks 7 and 8 are sequential and must be green
  (`npm run verify:mobile`) before any Task 9 batch starts. The Task 9 batches run in parallel
  in the **single main working tree**: no worktrees and no commits, since commits need
  explicit user approval. Isolation comes from disjoint file ownership. Batches never edit
  `theme/*`, the guard, `jest.config.js`, `__mocks__/`, steering, or any file outside their
  list. A batch that needs one of those changes stops, reports it, and leaves its task
  unchecked.
- **Retrofit light parity.** Light mode must not change visually. Every light token keeps
  today's value. Every converted literal keeps its original value as the palette `light`
  value. Dark-only additions are `{}` in light (`textDefault`) or a zero-width no-op
  (`outline.card` = `{ borderWidth: 0 }`, so a live dark→light switch clears the native
  hairline; found in the task 11 screenshot pass). The existing
  light assertions across the suite are the regression net.
- **Pin gate not required.** No pin artwork, motif, catalogue or mockup file is touched. Pin UI
  screens (`screens/profile/*`) are app code covered by `npm run verify`.
- **Design-review iteration 2 (additive).** Requirements 8.5 and 9.9 and the 9.7 amendment
  note were appended, along with design Properties 20–21. Tasks 7.2, 7.5, 7.6, 8.4, 8.5, 9,
  9.6 and 9.7 gained wording for these items:
  - `withAlpha` input formats;
  - `setTestOsScheme`;
  - extra contrast pairs;
  - the Property 20 probe;
  - the guard's exact import regexes and `namespaceImport` rule;
  - exact test ownership;
  - the default-text exclusions;
  - memoized-consumer rules and test (d);
  - `TIER_TEXT`.

  No task was renumbered or removed. The task-9 batch-level `TIER_COLOR`, `textDefault` and
  ownership rules are in design.md "(Retrofit) Literal conversion rules" and "Ownership rules".
- **Design-review iteration 3 (additive).** These were appended:
  - criteria 7.5, 9.10 and 9.11;
  - amendment notes on 7.1, 7.4, 9.3 and 10.5;
  - design Property 22, and extensions to Properties 7, 8, 9, 13, 15 and 16;
  - conversion rules 1a and 2a;
  - the light-colour multiset audit;
  - W1 test ownership.

  Tasks 3.2 (superseded note), 7.2, 7.6, 8.1, 8.3, 8.4, 8.5, 9, 9.1, 9.2, 9.3, 9.5 and 10.1
  gained "(iteration 3)" wording. Dark `primaryLight` and `gradient.header` were changed from
  the brief's values to meet the mandated contrast targets (design.md "(Retrofit) Deviations
  from the brief's palette"). No task was renumbered or removed, and no checkbox state changed.
- **Light-parity net (iteration 3 correction).** The "existing light assertions … are the
  regression net" line in "Retrofit light parity" above overstates the net. A repo search
  finds only 6 hex assertions in 4 test files. The binding light-parity proof is the
  light-colour multiset audit (task 9 Done-when, task 8.1).
- **Design-review iteration 4 (additive).** These were amended in place, with no task,
  requirement or property renumbered or removed and no checkbox state changed:
  - the light-colour multiset audit (named-import reads, palette aliases, numeric alpha,
    exemptions counted on both sides) in design.md and task 9's Done-when;
  - rule 2a, generalised to any suffixed token, park accent, category tint/fill, tier colour
    or palette value, plus a rule-3 `#rrggbb` constraint and a Property 7 extension (task 7.6);
  - the category-fill prose ("9 of 11"; named `DARK_TONAL` exceptions);
  - an amendment note on criterion 7.5 (scope `surface`/`background`, Chip-active included,
    `surfaceAlt` placements reported), the `background` rows in Property 9 and task 7.6;
  - task 7.6's original `.agents` pointer, marked superseded.
- **Design-review iteration 5 (additive).** The multiset audit's `after(F)` now removes each
  numeric `withAlpha(t.<path>, a)` span before counting `t.<GROUPS>` reads, so the call
  contributes only its rgba value (design.md audit block and task 9's Done-when). Without
  this, every rule-2 conversion added a spurious base hex that could also mask a dropped
  literal. No task, requirement or property was renumbered or removed, and no checkbox state
  changed.
- **Polish Fix 11 (additive).** Added criterion 6.5, Property 25 and task 14, and recorded the
  `expo-system-ui@56.0.5` dependency in design.md. Superseding notes now follow the earlier
  "out of scope" lines rather than replacing them. No requirement, property or task was
  renumbered or removed, and no other checkbox state changed. Expo Go for SDK 56 bundles the
  module. A custom dev or EAS build must be rebuilt to include it.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3"] },
    { "id": 2, "tasks": ["1.4"] },
    { "id": 3, "tasks": ["2.1", "2.2"] },
    { "id": 4, "tasks": ["2.3", "2.4"] },
    { "id": 5, "tasks": ["2.5"] },
    { "id": 6, "tasks": ["3.1"] },
    { "id": 7, "tasks": ["3.2"] },
    { "id": 8, "tasks": ["3.3"] },
    { "id": 9, "tasks": ["4.1", "5.1"] },
    { "id": 10, "tasks": ["4.2", "5.2"] },
    { "id": 11, "tasks": ["4.3", "5.3", "5.4", "5.5"] },
    { "id": 12, "tasks": ["4.4", "5.6"] },
    { "id": 13, "tasks": ["6.1"] },
    { "id": 14, "tasks": ["7.1"] },
    { "id": 15, "tasks": ["7.2"] },
    { "id": 16, "tasks": ["7.3", "7.4", "7.5"] },
    { "id": 17, "tasks": ["7.6"] },
    { "id": 18, "tasks": ["7.7"] },
    { "id": 19, "tasks": ["8.1"] },
    { "id": 20, "tasks": ["8.2", "8.3"] },
    { "id": 21, "tasks": ["8.4"] },
    { "id": 22, "tasks": ["8.5"] },
    { "id": 23, "tasks": ["8.6"] },
    { "id": 24, "tasks": ["9.1", "9.2", "9.3", "9.4", "9.5", "9.6", "9.7"] },
    { "id": 25, "tasks": ["10.1"] },
    { "id": 26, "tasks": ["10.2"] },
    { "id": 27, "tasks": ["11.1"] },
    { "id": 28, "tasks": ["11.2"] },
    { "id": 29, "tasks": ["12.1"] },
    { "id": 30, "tasks": ["13.1", "13.2", "13.3", "13.4"] },
    { "id": 31, "tasks": ["13.5"] },
    { "id": 32, "tasks": ["14.1"] }
  ]
}
```

Retrofit (Tasks 7–12) dependency chain:

```
6. (done) ──► 7. Foundation (7.1 baseline screenshots → 7.2 tokens → 7.3/7.4/7.5 → 7.6 tests → 7.7)
                    │
                    ▼
              8. Kit + chrome + guard (8.1 → 8.2/8.3 → 8.4 → 8.5 → 8.6 verify:mobile)
                    │
     ┌──────┬──────┬──────┼──────┬──────┬──────┐
     ▼      ▼      ▼      ▼      ▼      ▼      ▼
    9.1    9.2    9.3    9.4    9.5    9.6    9.7      (parallel, disjoint files)
     └──────┴──────┴──────┼──────┴──────┴──────┘
                    ▼
              10. Legacy removal (10.1) → steering (10.2)
                    │
                    ▼
              11. Visual verification (11.1 → 11.2)
                    │
                    ▼
              12. npm run verify (once)
```

Task 10.1 can't start until every Task 9 batch is checked. It deletes `PENDING_RETROFIT`, so
any unconverted file fails both `tsc` and the guard.

```
1. Dependency & Pure Appearance Module
         │
         ▼
2. Storage Wrapper & Zustand Theme Store
         │
         ▼
3. useActiveTheme Hook
         │
         ├──────────────────────┐
         ▼                      ▼
4. App Root Wiring       5. Profile Screen Appearance Control
   (Navigation/StatusBar/    (Chip options, ProfileScreen insertion)
    SafeArea background)
         │                      │
         └──────────┬───────────┘
                     ▼
         6. Final Verification Gate
```

Tasks 4 and 5 both depend only on Task 3 (`useActiveTheme`/`themeStore` existing) and are
otherwise independent of each other — they touch different files (`App.tsx` vs.
`ProfileScreen.tsx`/a new control component) and may be implemented in either order or in
parallel.
