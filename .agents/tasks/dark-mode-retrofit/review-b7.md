# Dark-mode retrofit of the identity, stats and friends surfaces (W2 batch B7)

B7 moves 35 owned mobile files (stats hub and detail screens, stats components, friends, the navigation row and list components, You & Crew, and the auth and profile controls) from the module-scope `theme`/`StyleSheet.create` pattern to `makeStyles` + `useAppTheme()`, with 12 co-located `*.palette.ts` files for non-token literals. The batch's one allowed signature change is in `statsView.ts`. `buildParkTiles`, `buildCategoryTiles`, `rankParkRows` and `rankCategoryRows` take a trailing `t: StatsViewTheme` (`Pick<AppTheme,'color'|'parkAccent'|'categoryVisual'>`). The only non-test caller, `CoverageSection`, passes `useAppTheme()`. Every test caller passes `lightTheme`, or `darkTheme` for the new dark assertions, and the light assertions still check today's hex. The coder's evidence covers all the gates: strict guard 9/9, mobile `tsc` exit 0, light multiset audit with 31 PASS plus 4 justified label-only diffs, owned jest at 36 suites / 296 tests, and the related sweep at 61 / 410.

Watch for: the ProfileScreen avatar ring is kept gold in dark under a G-role reading, which departs from the deterministic rule-3 B mapping (confirmed deviation, flagged by the coder for screenshots). The `#3d1c5c` podium border exposes a real contradiction in design rule 1. The coder resolved it the right way, but the design should record the resolution (confirmed). The other findings are nits about cross-file consistency and test hygiene.

**Verdict**: APPROVED

## High-level view

The `statsView` change is minimal and correct. Only the four functions that used to read the module `theme` gained the parameter. `statsView.ts` no longer imports any runtime theme value, only `type AppTheme`, so the guard's per-scheme-object ban holds. The module also no longer contains a hex or `rgba` literal. Category tiles and rows carry `.tint`, which is right because they are ring, icon and dot marks rather than fills behind white. The new fast-check property (100 runs) pins three things: light values byte-for-byte (`#7e57c2`, `#f6a609`, `#00897b`), dark parity with `darkTheme.parkAccent`/`categoryVisual[k].tint`, and the rank rows following `t`.

The conversions follow the rule order. `primary` used as text, icon, Badge, spinner or data mark becomes `primaryFg`. White on a fill becomes `textOnPrimary`, and the white cut-out ring becomes `surface`. Chromatic `rgba` becomes `withAlpha`, and its output format (`rgba(r, g, b, a)` with spaces) reproduces the original light strings exactly. The H-role podiums (`#201032`, `#2b1430`) and the gold G pieces are mode-invariant, and the cork-board artwork is kept invariant under rule 6. All 16 `TextInput`s found in the owned files have both `placeholderTextColor` and `keyboardAppearance`. The `Switch` uses a palette pair. Module-scope colour maps were moved into render, and colour helpers take `t`. The FlatLists render row components that call `useStyles()` themselves, so they don't need `extraData`, and test (d) proves a live repaint on the same row instance.

There are two deliberate departures from a literal reading of the rules, and both keep light byte-identical. First, the ExperiencesDetail podium border `#3d1c5c` is a palette pair `{light '#3d1c5c', dark primaryFg}`, because the rule-1 token target `primaryFg` is `#5b2a86` in light. Second, the Profile avatar ring `#ffd54f` is treated as G rather than B. Neither blocks approval. The ring needs a screenshot decision, and the podium resolution should be written back into the design.

Edits to unowned tests show up in the working tree: async-storage mocks in `friendSelectionNavigation`, `friendsListConsolidation` and `experienceDetailBackNavigation.*`. Their mtimes (2026-10-14) predate B7's snapshot work, so they belong to earlier W1/settings work, not this batch.

<details>
<summary>Issues (6)</summary>

1. **Avatar ring G-role deviation** (confirmed, non-blocking): `ProfileScreen.palette.ts` `AVATAR_GOLD.dark.ring` keeps `#ffd54f`, where rule 3 role B would give `DARK_TONAL.amber.border`. Confirm the reading in the screenshot pass. If the gold-ring-plus-gold-pill grouping is accepted, record the reading in the design's role table.
2. **Design rule 1 `#3d1c5c` → `primaryFg` conflicts with light byte-identity** (confirmed, non-blocking): `primaryFg` light is `#5b2a86`, so a literal application would change light. B7's palette pair `{light '#3d1c5c', dark darkTheme.color.primaryFg}` is the correct resolution. Amend the design so other batches resolve it the same way.
3. **Sibling podium borders resolved differently** (confirmed, nit): the ExperiencesDetail border uses dark `primaryFg` (`#c4a3ff`), and the FoodStats border uses `DARK_TONAL.violet.border` (`#584678`). Both are defensible, but the two podiums will look different in dark. Check in screenshots and unify if it shows.
4. **`#f6a609` resolved two ways** (confirmed, nit): the Disney Springs `AREA_ACCENT` dark value is `parkAccent['Disney Springs']` (`#ffb732`), while the `InterestsSection` facet amber is `DARK_TONAL.amber.fg` (`#f5b83d`) for the same light literal. This is acceptable because the area type is semantically a park, but note it.
5. **Hardcoded dark hex and missing property tag in `orderingDeterminism.prop.test.ts`** (confirmed, nit): `toBe('#b28dff')` breaks the plan's "dark values from `darkTheme`, never hex" rule, though it duplicates a `darkTheme`-based assertion on the same values. The new property's tag also has no `Property N`. Replace the hex with `darkTheme.categoryVisual.Ride.tint` and add the tag.
6. **Converted files with no dark assertion** (confirmed, informational): `AvatarChip` (the HomeScreen header pill), `AvatarPicker`, `RegisterScreen`, `CompactEmptyState`, `GroupSection`, `PercentileBanner`, `CoverageStatGrid` and `CompletionStatTile` rely on the guard and screenshots only. The plan allows this. Include `AvatarChip` and `RegisterScreen` explicitly in the visual pass.

</details>

<details>
<summary>Details</summary>

### `statsView` theme parameter and its callers

```ts
export type StatsViewTheme = Pick<AppTheme, 'color' | 'parkAccent' | 'categoryVisual'>;
export function buildCategoryTiles(byCategory, t: StatsViewTheme) { … accentColor: visual.tint … }
```

A grep over `apps/mobile/src` finds every call site of the four functions. The only production call sites are the two in `CoverageSection.tsx` (`rankParkRows(coverage.byPark, t)` and `rankCategoryRows(coverage.byCategory, t)`, with `t = useAppTheme()`). `buildParkTiles`/`buildCategoryTiles` have no non-test caller today, because `CoverageStatGrid` isn't rendered. The test callers are `orderingDeterminism.prop` (`lightTheme`/`darkTheme`), `consumerSurfacesTaxonomy` (`lightTheme`) and `CoverageDetailScreen.test` (`lightTheme`, for ordering only). `shareEntryPointProjection.prop` doesn't call them. `buildProgressShareParams` and the other colour-free exports keep their signatures.

### Rule departures that keep light byte-identical

Design rule 1 says `#3d1c5c` as a border on a surface → `primaryFg`. But `lightColor.primaryFg` is `#5b2a86`, so applying that rule literally would repaint the ExperiencesDetail podium outline in light. The coder kept `#3d1c5c` in light and used `darkTheme.color.primaryFg` in dark through `PODIUM.border`. Byte-identity outranks the mapping table, so that's the right call. But the design table is wrong for this literal-in-role, and other batches may hit the same case. FoodStats' `#4d2055` hue is 291°, so it's violet B → `DARK_TONAL.violet.border`. That's correct by the rules, but it leaves the two podium outlines visibly different in dark.

`ProfileScreen`'s avatar ring `#ffd54f` is a border, which is role B, so the rules would give `#694d35`. The coder groups it with the gold CHANGE pill (`#ffd54f` fill, `#311b92` text, true G) and keeps it gold. A muddy amber ring beside a bright gold pill would look wrong, so the reading is reasonable. It is still a judgement call in a rule set the design calls deterministic, and it needs an explicit sign-off.

### Test coverage

Each named (a/b/c) and (c) file has a dark `describe` with `afterEach(resetTestScheme)`. Dark expectations come from `darkTheme` or palette `.dark`, with the one hex exception above. Test (d) in `FriendsListScreen.removeConfirmation` mounts in light, switches scheme without remounting, and asserts `toBe(row)` identity plus dark `textPrimary`/`primaryFg` on the row and dark `textSecondary` on the section header. That covers the virtualized-list repaint risk. `YouAndCrewScreen.test` also drives the real Appearance control to Dark and asserts a repaint.

Not tested at the render layer: `AvatarChip`'s pill (`AVATAR_PILL.initialText`, the `withAlpha(accent, 0.7)` ring), `AvatarPicker` chrome, `RegisterScreen` inputs, `PercentileBanner`, `CompactEmptyState`, and the two unrendered stat tiles.

</details>

<details>
<summary>File map</summary>

- `screens/stats/statsView.ts`: `StatsViewTheme` type, and a trailing `t` on four colour-bearing helpers.
- `screens/stats/{CoverageDetail,ExperiencesDetail,FoodStats,InterestsDetail,RatingsDetail,Stats}Screen.tsx`: `makeStyles`/`useAppTheme`, `primaryFg` marks, H-role podium palettes.
- `screens/stats/components/*.tsx`: render-time colour maps, a `t` param on `CoverageSection` helpers, `textDefault` on trophy glyphs.
- `screens/stats/**/*.palette.ts` (6): `PODIUM`, `RECORD_ICON`, `FOOD_PODIUM`, `FOOD_RATING`, `FOOD_RECORD_ICON`, `AREA_ACCENT`, `HIGHLIGHT_ICON`, `FACET_ACCENT`, `HERO_METRIC`.
- `screens/friends/*.tsx`: per-row `useStyles`, input props, `CORK_BOARD` artwork palette.
- `screens/navigation/*.tsx`: `AvatarChip` bare `color` reads → `t` (props unchanged), `REPEAT_BADGE`/`AVATAR_PILL` palettes.
- `screens/youAndCrew/YouAndCrewScreen.tsx` + `SHARE_ICON` palette; `withAlpha(danger, 0.08)`.
- `screens/{AvatarPicker,ChangePasswordControl,ForgotPassword,Login,Profile,PushNotificationPreferenceControl,Register,ResetPassword}*.tsx`: input props, `AVATAR_GOLD`, `NOTIFICATION_SWITCH`.
- Owned tests: dark `describe`s, test (d), the new `statsView` dark property, and the `consumerSurfacesTaxonomy` switch to `categoryMeta`/`lightTheme`.

Full diff: `git diff -- apps/mobile/src/screens/{stats,friends,navigation,youAndCrew}` plus the listed `screens/*.tsx`, and `git diff --no-index "$env:TEMP\dark-mode-snapshot\B7" …` for the B7-only delta on `FriendsSearchScreen`/`YouAndCrewScreen`.

</details>
