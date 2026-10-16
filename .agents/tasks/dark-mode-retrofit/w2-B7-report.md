# W2 Batch B7 report — Identity, stats, friends (spec 9.7)

No `review-b7.json` existed, so this is a from-scratch conversion. Work was done in place, with no commits. Kit, shared and other batches' non-test files were not touched.

## Snapshot (C1)

- `$env:TEMP\dark-mode-snapshot\B7\` was taken before any edit: 35 files, which equals `$files.Count`.
- None of the owned files had theme edits beforehand. The `FriendsSearchScreen.tsx` and `YouAndCrewScreen.tsx` diffs against HEAD are unrelated feature work that was already uncommitted.
- The snapshot was **kept**, per the w2-plan "Snapshot lifetime" rule, so the reviewer can re-run the audit. The integrate step deletes it.
- My scratch tsconfig (`$env:TEMP\dm-b7-tsc`) has been deleted. Nothing was written to the repo outside owned files, new co-located palettes, owned tests and this report.

## DoD 1 — strict guard (C4)

```
$env:THEME_GUARD_STRICT='B7'; npx jest src/__tests__/themeRetrofit.guard.test.ts --maxWorkers=2
Test Suites: 1 passed, 1 total
Tests:       9 passed, 9 total
```

All 9 checks pass. That includes palette purity and Property 14 across every `*.palette.ts` in the tree.

## DoD 6 — typecheck (C5)

```
npm run typecheck --workspace apps/mobile   →   tsc -p tsconfig.json --noEmit   exit=0   (no `error TS` lines at all)
```

Mid-batch, B3's `ExperienceListDetailScreen.tsx` and B4's `ExpenseFormModal.tsx` had in-flight syntax errors. Those stopped `tsc` before its semantic pass. While they were present I ran a TS-API semantic check scoped to B7: 119 files (sources plus owned tests) and 0 diagnostics. The final full workspace run above is clean.

## DoD 2 — light-colour multiset audit (C7)

```
Get-Content "$env:TEMP\dark-mode-audit\audit.cjs" -Raw | node - B7 @files
PASS × 31 files
DIFF screens/stats/components/RatingsSection.tsx      categoryVisual[*].label: before 1, after 0
DIFF screens/friends/FriendProfileScreen.tsx          categoryVisual[*]: before 1, after 0
DIFF screens/navigation/CompletionRow.tsx             categoryVisual[*]: before 2, after 1
DIFF screens/navigation/ExperiencesList.tsx           categoryVisual[*]: before 1, after 0
AUDIT: 4 file(s) with differences
```

Justification: all four differences are the same thing. A **label** lookup (`theme.categoryVisual[cat]?.label`) moved to the colour-free `categoryMeta[cat].label`, the static export the design names for colour-free category metadata.

- A label is not a colour, so no light colour was removed.
- In `CompletionRow`, the remaining `categoryVisual[*]` is the dot's `t.categoryVisual[cat]?.tint`, unchanged.
- The audit records an optional-chained computed read as `categoryVisual[*]` with an empty path, which is why these show up at all.

The other 31 files show multiset PASS, so their light values are byte-identical. `git diff --no-index` against the snapshot was read for every owned file.

## Conversion decisions worth review

- **`statsView.ts`.** `buildParkTiles`, `buildCategoryTiles`, `rankParkRows` and `rankCategoryRows` gain a trailing `t: StatsViewTheme`, which is `Pick<AppTheme,'color'|'parkAccent'|'categoryVisual'>` (a new exported type alias). Every other export is unchanged. The only non-test callers are `CoverageSection` (which passes `useAppTheme()`) and the owned tests (which pass `lightTheme` or `darkTheme`). Tile accents use `.tint`, because they are ring and icon marks, not fills behind white.
- **Rule 1a, `primary` as text, icon, border or mark → `primaryFg`.** Applied across all 35 files: ActivityIndicators, segment and active labels, odometer values, links, Card accent stripes, dots and bars, the avatar selection ring, and the friends-count Badge.
- **Rule 1, `#ffffff`.**
  - Text on a fill, gradient or H surface → `textOnPrimary`: the podium titles and names, the AvatarChip pill label, and Profile's Save label.
  - The ring on a themed surface → `surface`: Profile's CHANGE pill border.
- **H-role, mode-invariant:**
  - `ExperiencesDetailScreen` podium: `#201032` and `#b7a3d9`.
  - `FoodStatsScreen` podium: `#2b1430` and `#d6a3d9`.
  - `AvatarChip` pill initial: `#3b1d60` on gold.
- **The `#3d1c5c` podium border (ExperiencesDetail).** Rule 1 says border-on-surface → `primaryFg`, but `primaryFg`'s light value is `#5b2a86`. So it became a palette pair: light `#3d1c5c`, dark `darkTheme.color.primaryFg`. That keeps light byte-identical.
- **The FoodStats `#4d2055` border.** Violet family, rule 3 B → `DARK_TONAL.violet.border`.
- **G-role judgement call (ProfileScreen).** The avatar ring `#ffd54f` is treated as G (mode-invariant), together with the CHANGE pill (`#ffd54f` fill, `#311b92` text). A literal "B" reading would turn the ring a muddy `#694d35` while the pill stays gold. Flagged for the screenshot pass.
- **Artwork, rule 6.** The FriendProfile cork-board frame and cork (`#5D3A1A`, `#c49a6c`) are mode-invariant, with the `// artwork — mode-invariant` comment. The `AvatarPresets` art and `PinView` are untouched.
- **Park hues not used for a park or category, rule 3 T.**
  - `InterestsSection` facet cycle: the `#7e57c2` stop → the `primaryLight` token; the others → `DARK_TONAL.{sky,teal,amber,red,green}.fg`.
  - `CoverageSection` area-type accents: Theme Parks, Water Parks and Disney Springs reuse the Magic Kingdom, Typhoon Lagoon and Disney Springs accents, so dark = `darkTheme.parkAccent[...]`. This is the rule-1 park-hue reading.
- **Rule 2:**
  - `rgba(246,195,67,0.3)` → `withAlpha(t.color.accent, 0.3)` (both podiums)
  - `rgba(214,51,108,0.08)` → `withAlpha(t.color.danger, 0.08)` (YouAndCrew remove button)
  - `rgba(246,195,67,0.7)` → `withAlpha(t.color.accent, 0.7)` (AvatarChip)
- **Rule 5 exempt:** the `rgba(255,255,255,…)` overlays on the H podiums and the header gradient (AvatarChip pill), and `shadowColor: '#000'`.
- **Switch.** The `PushNotificationPreferenceControl` `trackColor` became the palette pair `NOTIFICATION_SWITCH`: light `#e2d9f0`/`#5b2a86`, dark `borderStrong`/`primary`.
- **TextInputs (17).** Every one got `placeholderTextColor={t.color.textSecondary}` and `keyboardAppearance={t.scheme}`. All of them already set `color: textPrimary`, so none got `textDefault`.
- **`CompletionStatTile`.** The muted arc stays `surfaceAlt`: it is drawn in the ring's track colour, the kit's track role.

## DoD 3 — dark tests (C3)

Every owned test below has a `describe('… dark mode')` with `setTestScheme('dark')` and `afterEach(resetTestScheme)`. Dark values come from `darkTheme` or palette `.dark`, never from hex. Light-parity checks use the original hex.

- **(a)/(b)/(c):**
  - CoverageDetailScreen, ExperiencesDetailScreen, FoodStatsScreen, InterestsDetailScreen, RatingsDetailScreen and StatsScreen.hub
  - FriendProfileScreen.states and FriendsSearchScreen
  - YouAndCrewScreen
  - ForgotPasswordScreen (that file also covers a LoginScreen (c)) and ResetPasswordScreen
- **(c):** CoverageSection, RatingsSection, CompletionRow, ExperiencesList, TabSelector, ChangePasswordControl, PushNotificationPreferenceControl, and ProfileScreen (`ProfileIdentityBlock`).
- **(d)** in `FriendsListScreen.removeConfirmation.test.tsx`: mount light, assert the light colours, call `setTestScheme('dark')`, then assert the same row instance (`toBe(row)`) now shows the dark `textPrimary`/`primaryFg`. The section-header row repaints too.
- **Extra:** in `YouAndCrewScreen.test.tsx`, pressing the real Appearance control's **Dark** option repaints the mounted screen with no remount.
- **`statsView` unit assertion** in `orderingDeterminism.prop.test.ts` (fast-check, 100 runs): light values are today's literals; `buildCategoryTiles(…, darkTheme)` gives `darkTheme.categoryVisual[k].tint`; `rankParkRows`/`rankCategoryRows` follow `t`.

## DoD 4 — memo / list sites

- **`FriendsListScreen` FlatList.** `renderRow` (`useCallback`) returns row components (`SectionHeader`, `SectionEmpty`, `FriendRow`, `OutgoingRequestRow`), and each calls `useStyles()`/`useAppTheme()` itself. The callback reads no `styles`/`t`, so no `extraData` is needed. Test (d) proves the repaint.
- **`FriendsSearchScreen` FlatList.** `renderRow` returns `ResultRow`, which calls `useStyles()` itself, so no `extraData`. The `useMemo`s (friend/request id sets, `inlineLengthError`) read no colours.
- **Other hooks reviewed, none reading colours:**
  - `FriendProfileScreen` `ComparisonMode` `useEffect` (timer)
  - `GroupSection` `useCallback`
  - `StatsScreen` `useOpenShareComposer` (`useRef` holds a boolean, not a colour)
  - `PushNotificationPreferenceControl` and `ProfileScreen` `useEffect`s
- **Nothing else needed:** no colour or style is held in a `useRef`. There is no `React.memo`, no Animated interpolation and no calendar in B7.
- **Module-scope helpers that read colour now take `t`:** `CoverageSection.labeledRows`/`resortRows`/`rankAreaRows`, and `CompletionRow.categoryTint`/`ratingColor`. The module-scope colour maps (`HighlightCard` `ICON_STYLE`, `InterestsSection` `FACET_PALETTE`, `CoverageSection` `AREA_TYPE_VISUAL`) are now built in render from `t` plus one `usePalette` alias.

## `textDefault` placements and exclusions

**Placed** (all three conditions hold):
- `FacetCoverageTile.trophy` (🏆)
- `LabeledCellList.trophy` (🏆)
- the `FriendProfileScreen` shared-attraction crown (👑, inline style on a Card)

**Excluded:**
- the podium medals in ExperiencesDetail and FoodStats (on an H surface)
- the `PercentileBanner` medal (gold gradient, G)
- every other `Text`, because it already sets a colour

## DoD 8 — rule 2a and `surfaceAlt` placements

- There are no rule-2a alpha-suffix sites in B7. Alpha uses numeric `withAlpha`.
- No `PrimaryButton` or kit `Chip` sits directly on `surfaceAlt`. All of B7's PrimaryButtons are in Cards (`surface`) or on the screen background.
- **For the integrator:** `TabSelector`'s active tab is a `primary` fill on the `surfaceAlt` bar. It is chip-like, not the kit `Chip`; dark ratio 2.98, identified by its white label at 5.21. This is the same pattern as today's light design.

## Converted files with no B7 render/dark assertion

These are covered by the guard and screenshots only:

- `CoverageStatGrid` and `CompletionStatTile`: no non-test caller renders them today.
- `PercentileBanner`: rendered in the hub test, but no dark assertion.
- `AvatarChip`: rendered by B6's HomeScreen test only.
- `CompactEmptyState`, `GroupSection` (prop test only, no colour assertion), `AvatarPicker` and `RegisterScreen`.
- `statsView.ts`: unit-tested.

`HighlightCard`, `OverallHeroCard`, `InterestsSection`, `FacetCoverageTile` and `LabeledCellList` are asserted through their parent screens' dark tests.

## C6 regression sweep

```
npx jest --findRelatedTests <35 B7 files> --maxWorkers=2
Test Suites: 61 passed, 61 total
Tests:       410 passed, 410 total
```

Unowned related suites also pass, for example `friendsListConsolidation`, `friendSelectionNavigation`, `experienceDetailBackNavigation.*`, `HomeScreen.render` and `tabBarTheme`.

## C5/C3 owned-test run

```
npx jest <every B7-owned test> --maxWorkers=2
Test Suites: 36 passed, 36 total
Tests:       296 passed, 296 total
```

## Stop-and-report and other batches

- **Stop-and-report: none.** No kit or shared change was needed.
- **Other batches:** they had in-flight syntax errors during the batch (B3 `ExperienceListDetailScreen.tsx`, B4 `ExpenseFormModal.tsx`). These were resolved by the final typecheck.

## Behavior → test map

| Behavior | Test file → assertion |
| --- | --- |
| statsView tiles/rows follow `t` (light unchanged, dark tint) | `orderingDeterminism.prop.test.ts` → MK `#7e57c2`/Walkthrough `#00897b` light; dark `accentColor === darkTheme.categoryVisual[k].tint`, Ride `#b28dff`; rank rows `=== darkTheme.parkAccent[...]` |
| Coverage detail bg / summary / active lens | `CoverageDetailScreen.test.tsx` → root bg `darkTheme.color.background`; summary `textPrimary`; 'Parks' `primaryFg`; switcher `surfaceAlt`; light `#5b2a86`/`#efe9f7` |
| Area/land/park row accents | `CoverageSection.test.tsx` → `AREA_ACCENT.dark.*`, `resortVisual.tint`, `primaryFg`, `parkAccent.EPCOT`; light `#7e57c2`/`#17a2b8`/`#f6a609`/`#5b2a86` |
| Ratings hero value primary→primaryFg; averages labels | `RatingsSection.test.tsx`, `RatingsDetailScreen.test.tsx` → '3/10' `primaryFg` (light `#5b2a86`), '10/10' `success`, 'Ride' `textSecondary` |
| Facet accent cycle | `InterestsDetailScreen.test.tsx` → dots `primaryLight` / `FACET_ACCENT.dark.blue`; light `#7e57c2`/`#2f80ed` |
| Podium H surfaces + outline + record tile | `ExperiencesDetailScreen.test.tsx`, `FoodStatsScreen.test.tsx` → `PODIUM.dark.bg/border`, `RECORD_ICON.dark.marathonFg`, `FOOD_PODIUM.dark.*`, `FOOD_RATING.dark.star`; light `#201032`/`#3d1c5c`/`#4d2055`/`#f59f00` |
| Hub HighlightCard + OverallHeroCard icons, share button | `StatsScreen.hub.test.tsx` → `primaryFg`, `HIGHLIGHT_ICON.dark.experiencesFg`, `HERO_METRIC.dark.parkDaysFg`, share bg `primary`; light `#2f80ed`/`#5b2a86` |
| Friends list row repaints live (d) | `FriendsListScreen.removeConfirmation.test.tsx` → same row instance; name `textPrimary`, initial `primaryFg`, header `textSecondary` |
| Friend search input + rows | `FriendsSearchScreen.test.tsx` → `placeholderTextColor`, `keyboardAppearance 'dark'`, input/name `textPrimary`; light `'light'`/`#6b6480` |
| Friend profile placeholder + coverage lens | `FriendProfileScreen.states.test.tsx` → glyph `primaryFg` (light `#5b2a86`), 'Parks' `primaryFg`, switcher `surfaceAlt` |
| CompletionRow dot / repeat / rating badges | `CompletionRow.test.tsx` → dot `categoryVisual.Ride.tint`, '6×' `REPEAT_BADGE.dark.frequent`, '9/10' `success`; light '2×' `#3b5bdb` |
| ExperiencesList input + active filter | `ExperiencesList.test.tsx` → input props dark; 'Clear filters' `primaryFg` |
| TabSelector bar/active/labels | `TabSelector.test.tsx` → bar `surfaceAlt`, active `primary`, labels `textOnPrimary`/`textSecondary` |
| You & Crew screen + live Appearance switch | `YouAndCrewScreen.test.tsx` → bg, name, 'Compare Stats' `primaryFg`, `SHARE_ICON.dark.inboxFg`, remove veil `withAlpha(danger,0.08)`; pressing Dark repaints same root |
| Profile identity block | `ProfileScreen.test.tsx` → name `textPrimary`, initial `primaryFg`, CHANGE `AVATAR_GOLD.dark.badgeText`, input props, Save bg `primary`/text `textOnPrimary`; light `#5b2a86`/`#311b92` |
| Change password editor | `ChangePasswordControl.test.tsx` → input props/bg/text, label `textSecondary`, error `danger` |
| Push notification Switch pair | `PushNotificationPreferenceControl.test.tsx` → `trackColor` `NOTIFICATION_SWITCH.dark`; light `#e2d9f0`/`#5b2a86` |
| Forgot / Login / Reset auth screens | `ForgotPasswordScreen.test.tsx`, `ResetPasswordScreen.test.tsx` → root bg, input text/bg/keyboard, 'Sign in'/'Forgot password?'/'Resend code' `primaryFg`, error `danger`; light 'Sign in' `#5b2a86` |
