# W2 batch B3 — Logging sheets & lists (spec 9.3) — report

Status: converted, self-checked, ready for review. `tasks.md` 9.3 not ticked (integrate step does that).
No commits. Snapshot kept at `%TEMP%\dark-mode-snapshot\B3\` (25 files) for the reviewer's audit
re-run; per the plan the integrate step deletes it after `APPROVED`. No scratch files in the repo
(the TS-API check and audit ran via stdin `node -`; a temp tsconfig dir in `%TEMP%` was deleted).

## Files changed

Source (25, all owned):
- `screens/catalog/`: AddToTripOrListChoiceSheet, AddToTripPickerSheet, CreateLocationModal,
  FoodItemLogHistorySheet, FoodItemPickerModal, LogFoodItemModal, LogVisitModal, MyFoodHistoryScreen,
  RateExperienceModal, RestaurantDishLogCard, RestaurantFoodLogsSheet
- `screens/foodLists/`: AddToListsSheet, CreateFoodListModal, FoodListDetailScreen,
  FoodListDiscoveryScreen, ManageFoodListSharesSheet, MarkGottenUndoToast, MyFoodListsScreen,
  RateOnCheckoffPrompt
- `screens/experienceLists/`: AddToExperienceListsSheet, CreateExperienceListModal,
  ExperienceListDetailScreen, ExperienceListDiscoveryScreen, ManageExperienceListSharesSheet,
  MyExperienceListsScreen

New palettes (14): `catalog/{FoodItemPickerModal,LogFoodItemModal,RateExperienceModal,RestaurantDishLogCard}.palette.ts`,
`foodLists/{AddToListsSheet,FoodListDetailScreen,FoodListDiscoveryScreen,ManageFoodListSharesSheet,MarkGottenUndoToast}.palette.ts`,
`experienceLists/{AddToExperienceListsSheet,ExperienceListDetailScreen,ExperienceListDiscoveryScreen,ManageExperienceListSharesSheet}.palette.ts`.

Tests (21 owned, dark-mode cases added): catalog `CreateLocationModal, FoodItemLogHistorySheet,
FoodItemPickerModal, LogFoodItemModal, MyFoodHistoryScreen, RateExperienceModal, RestaurantFoodLogsSheet`;
foodLists `AddToListsSheet, CreateFoodListModal, FoodListDetailScreen, FoodListDiscoveryScreen,
ManageFoodListSharesSheet, MarkGottenUndoToast, MyFoodListsScreen, RateOnCheckoffPrompt`;
experienceLists `AddToExperienceListsSheet, CreateExperienceListModal, ExperienceListDetailScreen,
ExperienceListDiscoveryScreen, ManageExperienceListSharesSheet, MyExperienceListsScreen`.

## DoD 1 — strict guard (C4)

`$env:THEME_GUARD_STRICT='B3'; npx jest src/__tests__/themeRetrofit.guard.test.ts --maxWorkers=2`

```
    √ has zero violations outside the allowlists and PENDING_RETROFIT (766 ms)
    √ every *.palette.ts is a pure definePalette module (6 ms)
    √ every palette has identical light/dark key sets and only valid colour values (70 ms)
    √ withAlpha(value, 0.14) never throws on any token, DARK_TONAL or palette value (127 ms)
Test Suites: 1 passed, 1 total
Tests:       9 passed, 9 total
exit=0
```
(Baseline before conversion: 795 B3 violations.)

## DoD 2 — light-colour multiset audit (C7)

`Get-Content "$env:TEMP\dark-mode-audit\audit.cjs" -Raw | node - B3 @files` → 23 PASS, 2 DIFF, `exit=1`.

| File | Difference | Justification |
| --- | --- | --- |
| `catalog/LogVisitModal.tsx` | `#6b6480`: before 1, after 2 | Dark-only addition. The note `TextInput` had no `placeholderTextColor`; it now gets `placeholderTextColor={t.scheme === 'dark' ? t.color.textSecondary : undefined}` (same pattern B2 used), so light keeps RN's default placeholder (prop `undefined`) and contributes no light colour at runtime. The audit counts the `t.color.textSecondary` read textually. |
| `foodLists/FoodListDetailScreen.tsx` | `#5b2a86`: before 35, after 34 | Trailing code-line comment reworded: snapshot line `backgroundColor: 'rgba(91, 42, 134, 0.12)', // muted tint of theme.color.primary` — the comment's `theme.color.primary` was counted on the before side. It now reads `// muted tint of the primary token` (a `t.color.primary` in the comment would be a false read). The rgba itself converted by rule 2 and matches. |

No `UNRESOLVED(...)` notes.

## DoD 3 — dark tests (a)/(b)/(c)/(d)

Every owned test above has a dark `describe` with `setTestScheme('dark')` + `afterEach(resetTestScheme)`.
(d) is in `MyFoodListsScreen.test.tsx`. Property 22 toast case in `MarkGottenUndoToast.test.tsx`.

## DoD 4 — memo / list / ref sites touched

- `CreateLocationModal`: `renderSuggestion` deps `+styles, t`; FlatList `extraData={t.scheme}`.
- `FoodItemPickerModal`: `renderRow` deps `+styles`; FlatList `extraData={[selectedItems, t.scheme]}`; `FoodItemRow` (separate component) calls `useStyles()`/`useAppTheme()` itself.
- `MyFoodHistoryScreen`: `renderHistoryRow` deps `+styles, t`; FlatList `extraData={t.scheme}`.
- `RestaurantFoodLogsSheet`: `renderLogRow` deps `+styles, t`; FlatList `extraData={t.scheme}`.
- `AddToListsSheet` / `AddToExperienceListsSheet`: `renderOwnedList` deps `+styles, t`; FlatList `extraData={t.scheme}`.
- `ManageFoodListSharesSheet` / `ManageExperienceListSharesSheet`: `renderFriend` deps `+styles`; `renderShare` deps `+styles, t`; both FlatLists `extraData={t.scheme}`.
- `FoodListDiscoveryScreen` / `ExperienceListDiscoveryScreen`: `renderDiscoveryItem` deps `+styles, t`; FlatList `extraData={t.scheme}`.
- `MyFoodListsScreen` / `MyExperienceListsScreen`: `renderOwnedList` + `renderSavedList` deps `+styles, t`; both FlatLists `extraData={t.scheme}`.
- `FoodListDetailScreen`: `renderDraggableItem` deps `+styles, t`; `renderSearchResult` deps `[]` → `[styles, t]`; `NestableDraggableFlatList` and the restaurant-search FlatList `extraData={t.scheme}`.
- `ExperienceListDetailScreen`: `renderDraggableItem` deps `+styles, t`; `NestableDraggableFlatList` `extraData={t.scheme}`; module-scope `AddItemsCatalogSearch` component calls `useStyles()`/`useAppTheme()` itself.
- `AddToTripPickerSheet`: module-scope `STATUS_META` (colour reads) → `statusMeta(t)` called in render.
- Hooks placed before early `return null` in `AddToTripOrListChoiceSheet`, `AddToTripPickerSheet`, `RestaurantDishLogCard`, and all sheets with `if (!visible)` returns.
- No colour/style in a `useRef` (`MarkGottenUndoToast`'s ref holds a callback). No `Animated` colour, no `setOptions`, no `React.memo`, no `Switch`, no calendar in B3. Other `useMemo`s don't read `styles`/`t`.

`TextInput`s (16): all got `keyboardAppearance={t.scheme}`; 15 already had `placeholderTextColor` (now `t.color.textSecondary`), `LogVisitModal`'s got the dark-only form above. All 16 set `color` in style, so no `textDefault` on inputs.

`ActivityIndicator`s: on surfaces `primary` → `primaryFg`; on filled buttons `#fff` → `textOnPrimary`.

`...t.textDefault` placements (all three default-text conditions hold — no colour, not nested, themed amber-tint card background): `RestaurantDishLogCard` two emoji `Text`s (`{ fontSize: 14|13, ...t.textDefault }`) and the hidden count `Text` (`style={t.textDefault}`). Exclusions: every other `Text` in B3 already sets `color` (nested `Text`s in `RateExperienceModal`/`RestaurantDishLogCard` set their own colour).

## DoD 6 — typecheck (C5)

The plan's filtered `npm run typecheck` was blocked mid-run by other batches' transient syntax errors (B4 `trips/ExpenseFormModal.tsx(3959)`, B7 `ChangePasswordControl.tsx(290)` — TS skips semantic checks when any file has syntax errors), so a stdin TS-API check reported per-file diagnostics for B3 against the full program:
```
B3 files checked: 61 | B3 errors: 0 | other-batch files with syntax errors: none
```
Final full run: `npm run typecheck --workspace apps/mobile` → `tsc -p tsconfig.json --noEmit`, no `error TS` lines, `exit=0`.

## DoD 5 — owned tests + regression sweep (C6)

- Owned (21 suites): `Test Suites: 21 passed, 21 total` / `Tests: 254 passed, 254 total`, exit 0.
- `npx jest --findRelatedTests <25 B3 sources>`: `Test Suites: 64 passed, 64 total` / `Tests: 562 passed, 562 total`, exit 0.

## DoD 8

- Rule 2a sites: none in B3 (no `${X}NN` / `X + 'NN'` suffixes), so no suffixed palette values.
- Active pill/chip rendered directly on `surfaceAlt` (outside criterion 7.5; integrator decides):
  `CreateFoodListModal` + `CreateExperienceListModal` `visPillActive` (in `visToggleGroup`),
  `ManageFoodListSharesSheet` + `ManageExperienceListSharesSheet` `rolePillActive` (in `roleToggleGroup`),
  `MyFoodListsScreen` + `MyExperienceListsScreen` `tabActive` (in `tabsRow`). No `PrimaryButton` on `surfaceAlt`.

## Rule 1a / Property 22 site

`foodLists/MarkGottenUndoToast.tsx` toast: `backgroundColor: theme.color.textPrimary` (text token as a
background) → `TOAST[t.scheme].bg`, palette `{ light: '#1f1235', dark: '#1f1235' }` (H role), message
`t.color.textOnPrimary`, Undo `t.color.accent`, `...t.outline.card` spread (light `{}`).

## Judgement calls (rule application, for review)

- Border of an element whose own fill is `primary` (and equals it) stays `primary`, not `primaryFg`: `parkChipSelected`, `tabActive` (picker), `ratingBtnSelected`, `pickerTileActive`, `friendChipSelected`, `roleBadgeEditor`, `chipActive`, `pickerButtonSelected`, `tripChipSelected`. Borders on a surface/tint use `primaryFg` (`filterChipActive`, `roleBadge`, `staleNotice`, `checkOffBtn`).
- `RateExperienceModal` backdrop `rgba(20, 8, 36, 0.65)` (near-black violet, L 0.004) → role H, mode-invariant.
- `RateExperienceModal` title `#371756` (violet table) used as text → violet T (`DARK_TONAL.violet.fg`).
- Discovery empty-state icon read `borderStrong` as an icon colour → rule 1a out-of-role → rule 3 palette `{ '#cdbce6' → DARK_TONAL.violet.fg }`.
- `rgba(107, 70, 193, a)` (`#6b46c1`, not a token) → violet S/B palette values; `rgba(91, 42, 134, a)` / `rgba(214, 51, 108, a)` → rule 2 `withAlpha(t.color.primary|danger, a)`; `rgba(239, 68, 68, a)` → red S palette.
- Progress bar fill → `primaryFg` (non-text data mark).
- `#f59e0b` celebration border/icon → `starRating` (hue token as border/icon).

## Converted files with no render test (guard + screenshots only)

`catalog/AddToTripOrListChoiceSheet.tsx`, `catalog/AddToTripPickerSheet.tsx`, `catalog/LogVisitModal.tsx`,
`catalog/RestaurantDishLogCard.tsx`. `LogVisitModal` and `RestaurantDishLogCard` are rendered (light
only, no colour assertions) by unowned B2 tests (`LiveWaitsScreen.test.tsx`,
`ExperienceDetailScreen.dockActions.test.tsx`, `ParkPassportCard.test.tsx`), all green in the
regression sweep. The two `AddToTrip*` sheets have no test that renders them.

## Stop-and-report items

None. No kit/shared/guard edits were needed.

## Behavior → test map

| Behavior | Test | Assertion |
| --- | --- | --- |
| Toast stays `#1f1235` both schemes (rule 1a) | `MarkGottenUndoToast.test.tsx` | `test.each` light/dark: toast `backgroundColor === '#1f1235'`, message `color === '#ffffff'` (= `textOnPrimary`), Undo `color === t.color.accent` |
| Toast outline dark-only | `MarkGottenUndoToast.test.tsx` | dark `borderColor === darkTheme.color.border`, `borderWidth === hairlineWidth`; light both `undefined` |
| Create-location sheet dark surface / text / chip / input | `CreateLocationModal.test.tsx` | sheet bg `surface`, title `textPrimary`, selected park chip bg `primary` + text `textOnPrimary`, input `placeholderTextColor`/`keyboardAppearance='dark'` |
| History sheet spinner / pill | `FoodItemLogHistorySheet.test.tsx` | spinner `color === primaryFg`, sheet `surface`, title `textPrimary`, rating pill bg `surfaceAlt` |
| Picker row (own `useStyles`) + violet badge palette | `FoodItemPickerModal.test.tsx` | `Logged 3x` color `primaryFg`, badge bg `PICKER.dark.repeatBadgeBg`, row name `textPrimary`, sheet `surface`, input dark |
| Log-dish selected tile + red banner palette | `LogFoodItemModal.test.tsx` | after press tile bg `primary`; note input bg `surfaceAlt` + `keyboardAppearance='dark'`; error banner bg `LOG_FOOD.dark.errorBannerBg` |
| Food history screen + filter chip interaction | `MyFoodHistoryScreen.test.tsx` | screen bg `background`, row `textPrimary`, `+ Add rating` `primaryFg`, pressed filter chip `borderColor === primaryFg` |
| Rate dialog literals (rule 3) | `RateExperienceModal.test.tsx` | dialog `surface`, title `RATE_DIALOG.dark.title`, idle tile `surfaceAlt`, active tile `primary` + number `textOnPrimary`, Remove `RATE_DIALOG.dark.removeText` |
| Scoped logs sheet | `RestaurantFoodLogsSheet.test.tsx` | sheet `surface`, header `textPrimary`, rating pill `surfaceAlt`, active sort chip `primary`, input dark |
| Add-to-lists violet tint + inline input | `AddToListsSheet.test.tsx`, `AddToExperienceListsSheet.test.tsx` | sheet `surface`, header/row `textPrimary`, inline-create bg `ADD_TO_*.dark.inlineAddBg`, label `primaryFg`, after press input `keyboardAppearance='dark'` |
| Create-list modal pill interaction | `CreateFoodListModal.test.tsx`, `CreateExperienceListModal.test.tsx` | dialog `surface`, title `textPrimary`, input bg `background` + dark keyboard, after pressing Public pill bg `primary` + text `textOnPrimary` |
| Discovery like badge (rule 2) + empty icon palette | `FoodListDiscoveryScreen.test.tsx`, `ExperienceListDiscoveryScreen.test.tsx` | screen `background`, row `textPrimary`, like badge bg `withAlpha(darkTheme.color.danger, 0.1)`, item count `primaryFg`, active sort bg `primary`; empty compass icon `color === *_DISCOVERY.dark.emptyIcon` |
| Shares badges | `ManageFoodListSharesSheet.test.tsx`, `ManageExperienceListSharesSheet.test.tsx` | sheet `surface`, name `textPrimary`, Viewer badge bg `*_SHARES.dark.roleBadgeBg` + border/label `primaryFg`, Editor badge bg `primary` |
| Rating prompt tiles | `RateOnCheckoffPrompt.test.tsx` | sheet `surface`, title `textPrimary`, idle tile `surfaceAlt`, selected tile `primary` + `7` text `textOnPrimary` |
| My lists screens | `MyFoodListsScreen.test.tsx`, `MyExperienceListsScreen.test.tsx` | screen `background`, row `textPrimary`, active tab + create button bg `primary`; experience: after Saved tab press saved row `textPrimary` |
| (d) FlatList row repaints live | `MyFoodListsScreen.test.tsx` | mounted light: title `lightTheme.textPrimary`, `4 items` `lightTheme.textSecondary`; `setTestScheme('dark')` without remount → `darkTheme.textPrimary` / `darkTheme.textSecondary` |
| List detail screens | `FoodListDetailScreen.test.tsx`, `ExperienceListDetailScreen.test.tsx` | screen `background`, name/row `textPrimary`, attribution `primaryFg`, visibility badge bg `withAlpha(darkTheme.color.primary, 0.08)`; food: progress fill `primaryFg`, check-off border `primaryFg`; liked list chip bg `*_LIST_DETAIL.dark.likedBg` |
| Bare `categoryVisual` → `t.categoryVisual` tint | `ExperienceListDetailScreen.test.tsx` | add-items search result `Ride` badge text `darkTheme.categoryVisual.Ride.tint`, park badge `primaryFg`, input dark |
| Light parity | all 21 owned suites + 64-suite related sweep | existing light assertions unchanged and passing; audit 23 PASS + 2 justified DIFF |
