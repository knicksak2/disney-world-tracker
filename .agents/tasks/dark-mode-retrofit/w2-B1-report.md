# W2 batch B1 report: Explore & destinations (iteration 1)

## Files changed

Owned sources (all under `apps/mobile/src/screens/catalog/`):

- `ExploreHubScreen.tsx`, `DestinationScreen.tsx`, `ParkDestinationScreen.tsx`, `ResortsDirectoryScreen.tsx`, `ResortGuideSection.tsx`, `CrowdCalendarScreen.tsx`, `LocationGroupSection.tsx`: converted to `makeStyles` + `useAppTheme`/`usePalette`.
- `destinationVisuals.ts`: removed only the `accent` field (interface and all 8 entries). The gradients are unchanged and the file stays allowlisted.
- `TodayInParkLens.tsx`: no change. It has no colour reads or literals; it composes children only.

New co-located palettes: `ExploreHubScreen.palette.ts`, `DestinationScreen.palette.ts`, `ParkDestinationScreen.palette.ts`, `ResortsDirectoryScreen.palette.ts`, `ResortGuideSection.palette.ts`, `CrowdCalendarScreen.palette.ts`, `LocationGroupSection.palette.ts`.

Owned tests extended (existing light assertions untouched): `ExploreHubScreen.test.tsx`, `DestinationScreen.render.test.tsx`, `ParkDestinationScreen.test.tsx`, `ResortsDirectoryScreen.test.tsx`, `CrowdCalendarScreen.test.tsx`, `ResortGuideSection.test.tsx`, `LocationGroupSection.test.tsx`, `TodayInParkLens.render.test.tsx`. `DestinationScreen.layouts.test.tsx` is unchanged and passing.

`ResortGuideSection` exports `KNOWN_DINING_METADATA` and `resolveFallbackResortMeta`. Both are colour-free and untouched. No exported name, signature or prop changed.

## C4: strict guard (`THEME_GUARD_STRICT=B1`)

```
PASS src/__tests__/themeRetrofit.guard.test.ts
    √ has zero violations outside the allowlists and PENDING_RETROFIT
    √ every *.palette.ts is a pure definePalette module
    √ every palette has identical light/dark key sets and only valid colour values
    √ withAlpha(value, 0.14) never throws on any token, DARK_TONAL or palette value
Tests:       9 passed, 9 total
EXIT=0
```

## C5: typecheck (`npm run typecheck --workspace apps/mobile`, filtered)

```
total TS errors in workspace: 0
--- errors in B1 files (owned sources, palettes, owned tests):
--- end
```

During the batch, other batches' files (`MyExperienceListsScreen.tsx`, `ExperiencesList.tsx`, `TabSelector.test.tsx`) were red for a while. By the final run they were green. I did not touch them.

## C6: regression sweep (`npx jest --findRelatedTests <B1 files>`)

```
Test Suites: 37 passed, 37 total
Tests:       266 passed, 266 total
```

## Owned test files (each run with `npx jest <file> --maxWorkers=2`)

```
PASS ExploreHubScreen.test.tsx (14) · DestinationScreen.render.test.tsx (9) · DestinationScreen.layouts.test.tsx
PASS ParkDestinationScreen.test.tsx (11) · ResortsDirectoryScreen.test.tsx (14, run 3× for stability)
PASS ResortGuideSection.test.tsx (31) · CrowdCalendarScreen.test.tsx (11) · LocationGroupSection.test.tsx
PASS TodayInParkLens.render.test.tsx
Test Suites: 9 passed, 9 total
Tests:       114 passed, 114 total
```

## C7: light-colour multiset audit

```
DIFF screens/catalog/ExploreHubScreen.tsx        #17a2b8: before 2, after 1 · #7e57c2: before 2, after 1
DIFF screens/catalog/DestinationScreen.tsx       categoryVisual[*]: before 3, after 2
DIFF screens/catalog/ParkDestinationScreen.tsx   #7e57c2: before 2, after 1
PASS screens/catalog/ResortsDirectoryScreen.tsx (126 light colours)
PASS screens/catalog/ResortGuideSection.tsx (78 light colours)
DIFF screens/catalog/CrowdCalendarScreen.tsx     #ffffff: before 7, after 8
PASS screens/catalog/LocationGroupSection.tsx (19 light colours)
PASS screens/catalog/TodayInParkLens.tsx (0 light colours)
DIFF screens/catalog/destinationVisuals.ts       #17a2b8 #2f80ed #3fa34d #4dabf7 #5b2a86 #7e57c2 #e8505b #f6a609: before 2, after 1 each
```

Every difference and its rule-based justification:

| File | Difference | Justification |
| --- | --- | --- |
| `destinationVisuals.ts` | each of the 8 accent hues −1 | Rule 6: the `accent` field was removed. The gradient stops that share those hues remain. No consumer read `.accent`; the rows already used `parkAccent`. |
| `ExploreHubScreen.tsx` | `#7e57c2` −1, `#17a2b8` −1 | Rule 6: `accent:` removed from the two local `DESTINATION_VISUALS` fallback objects (theme-park and water-park tiles). It was never read. The fallback gradient stops moved to `EXPLORE_ART` with light values unchanged, so they produce no difference. |
| `ParkDestinationScreen.tsx` | `#7e57c2` −1 | Rule 6: same fallback-object `accent:` removal. |
| `DestinationScreen.tsx` | `categoryVisual[*]` −1 | The label-only helper `categoryLabel()` used to read `theme.categoryVisual[category]?.label`. It now reads the colour-free `categoryMeta[category]?.label`, which is the same label. No colour is involved. |
| `CrowdCalendarScreen.tsx` | `#ffffff` +1 | A dark-only branch: `calendarBackground: t.scheme === 'dark' ? t.color.surface : 'transparent'`. Light still renders `'transparent'` (the test asserts this). The audit counts the `t.color.surface` read even though light never takes that branch. |

The human diffs were read with `git diff --no-index` against `$env:TEMP\dark-mode-snapshot\B1\`.

## DoD 4: memo, list and React.memo sites

| File | Site | Change |
| --- | --- | --- |
| ExploreHub | `SearchResultsBody.renderSearchResult`, `FavoritesBody.renderFavoriteItem` (useCallback) and their 2 FlatLists | Neither reads `styles`/`t`. Rows are `SearchResultRow`, which subscribes itself, so no `extraData` is needed. |
| ExploreHub | `React.memo` `SearchResultRow`, `ExperienceThumb`, `VisitedOverlay` | Each calls `useStyles()`/`useAppTheme()` itself. |
| Destination | `DisneySpringsLayout.renderRow` (reads `styles.itemRowWrap`) | `styles` added to its deps, plus `extraData={t.scheme}` on the FlatList. |
| Destination | `DestinationSearchResults.renderRow` and its FlatList | Reads no styles, so unchanged. |
| Destination | `React.memo` `CollapsibleHeaderRow`, `ExperienceRow`, `ExperienceThumb`, `VisitedOverlay` | Each calls `useStyles()`/`useAppTheme()` itself. |
| Park | `renderRow` (reads `styles.itemRowWrap`) | `styles` added to its deps, plus `extraData={t.scheme}`. |
| Park | `DestinationSearchResults.renderItem` | Reads no styles, so unchanged. |
| Park | `React.memo` `ExperienceRow`, `ExperienceThumb`, `VisitedOverlay` | Each calls the hooks itself. `CollapsibleHeaderRow` and `SectionHeader` also call `useStyles()`. |
| Resorts | Dining and recreation FlatLists (inline `renderItem` reads `styles`/`t`) | `extraData={t.scheme}`. |
| Resorts | Hotels FlatList (inline `renderItem` renders `HotelPreviewCard`, reads no styles) | None needed; `HotelPreviewCard` calls the hooks. |
| Resorts | `React.memo` `DiningThumb` | Calls `useStyles()`/`usePalette()`. |
| CrowdCalendar | `Calendar` | Themed `theme` prop plus `key={t.scheme}`. `renderDay` is a render-scope function, and the remount covers it. |
| All | Remaining `useMemo`/`useCallback`/`useEffect` | None read `styles`/`t`/a palette, so none were changed. No `useRef` holds a colour. |

Counts against the plan: React.memo sites 11 (3 + 4 + 3 + 1), TextInputs 5 (each with `placeholderTextColor` = `textSecondary` and `keyboardAppearance={t.scheme}`; every one already sets `color`), lists 9.

## `...t.textDefault` placements and exclusions

Placed on emoji Text that has no colour, no Text ancestor, and a themed background:

- `ResortGuideSection`: `highlightEmoji` (surfaceAlt), `diningHeaderEmoji` (surface), `recreationEmoji` (surfaceAlt), `modalEmoji` (surface).
- `ResortsDirectoryScreen`: `recIconText` (DARK_TONAL violet tint), `hotelModalRowIcon` (surfaceAlt).

Excluded:

- `hotelFilterPillIcon`: its background switches to a violet fill when the pill is active, so it is not always themed.
- The 🧭 Text in `LocationGroupSection` and `ResortGuideSection`: sits on a `primary` fill.
- The ExploreHub park/showcase/resorts icon Text: white veil over a gradient.
- CrowdCalendar `bestBannerIcon`: on the gold accent (G role).
- CrowdCalendar bold spans inside `dayCap`: nested in a Text.

## Rule-2a non-token suffix sites (DoD 8)

- `ResortsDirectoryScreen` hotel picker uses `` `${tierColor}18` `` with `tierColor` from `RESORT_TIER`. Light values are `#7c3aed`, `#059669`, `#2563eb`; dark values are `#c4a3ff`, `#4cc38a`, `#5aa2ff`. All are `#rrggbb` in both schemes.
- A test asserts the light value `#7c3aed18` and the dark value `` `${RESORT_TIER.dark.deluxe}18` ``.

PrimaryButton or active Chip rendered directly on `surfaceAlt`: none. B1 files use neither kit primitive, and every custom primary-filled active pill sits on `surface` or `background`.

## Named rule-1a and Property 22 sites

These placeholder tiles use `t.categoryVisual[cat].fill` with a `textOnPrimary` glyph:

- `ExploreHubScreen` `ExperienceThumb`
- `DestinationScreen` `ExperienceThumb`
- `ParkDestinationScreen` `ExperienceThumb` (its fallback object's `tint: primary` became `fill: t.color.primary`)

Property 22 is asserted in `ExploreHubScreen.test.tsx` for Ride and Restaurant, in both schemes.

Rule-4 site: the `DestinationScreen` visited disc used `theme.color.success` as a fill behind a white check. It is now `DESTINATION.visitedFill`, with light `#2e9e6b` and dark `DARK_TONAL.green.fill`.

## Rule interpretations for the reviewer

1. **CrowdCalendar crowd scale stays role V (mode-invariant).** The white text on the scale fails 4.5:1 identically in both schemes (3.20:1 for quiet). That is a pre-existing light-mode issue, and the text is white `textOnPrimary` in both. Reading "if it doesn't, use F" literally would map both Quiet `#3fa34d` and Below-average `#8bbf3f` to `DARK_TONAL.green.fill`, which merges two scale levels. "Moderate" is the `accent` token under rule 1.
2. **Light text drawn on H-role or gradient hero surfaces stays mode-invariant** (in `EXPLORE_HERO` and `PARK_HERO`). Examples: `#E2E8F0`, `#CBD5E1`, `#93C5FD`, `#E5DEF5`. The surface under them is identical in both schemes.
3. **Chromatic near-black scrims stay mode-invariant (role H).** These are `rgba(15, 10, 28, 0.5/0.6)` in Park and ResortGuide, and the hero veils `rgba(15, 23, 42, 0.65)`, `rgba(30, 27, 75, 0.7)`, `rgba(29, 18, 51, 0.65)`.
4. **The `hotelFilterPillActive` border uses the fill value (F), not B.** The border outlines its own fill. This follows the kit's active-Chip precedent of `primary`/`primary`.
5. **`...t.outline.card` is added only to `DestinationScreen` `modalContent`.** It is the one card-like surface that spreads `shadow.card` without its own border. The other cards already carry an explicit border.
6. **Visible consequence of rule 3 to check on screenshots.** Near-black violet headings and body copy in ResortGuide and LocationGroup (`#190c2d`, `#372f4a`, `#4a3f60`, `#371756`) map to `DARK_TONAL.violet.fg` `#c4a3ff`. So those headings read lavender in dark. `#655d78` (L 0.1195 < 0.12) maps to `textPrimary`.
7. **Pre-existing light issue, not fixed (out of scope).** When Park's Filters button is active, its label takes `filterChipTextActive` violet text on the `primary` fill (`#7E22CE` on `#5b2a86` in light). Dark carries the same role.

## Converted files with no render test (guard and screenshots only)

- `destinationVisuals.ts`: pure data.
- `TodayInParkLens.tsx` has no colour of its own. Its render test asserts the dark values of its B1-owned `LocationGroupSection` child.

## Stop-and-report items

None. No kit, shared or theme change was needed.

## Snapshot

`$env:TEMP\dark-mode-snapshot\B1\` is kept outside the repo. Per w2-plan, the integrate step deletes it after APPROVED, so the reviewer can re-run the audit. My temporary helper files in `$env:TEMP` were deleted.

## Behavior→test map

| Behavior | Test → assertion |
| --- | --- |
| Explore screen root, primary text and dock literals repaint dark | `ExploreHubScreen.test.tsx` "(a)(b)(c)": root `backgroundColor` = `darkTheme.color.background`; 'Live Waits' `color` = `textPrimary`; the waits icon `color` = `EXPLORE.dark.dockWaitsIcon` and its disc = `EXPLORE.dark.dockWaitsBg`; search `keyboardAppearance` = 'dark' |
| Explore light parity | "keeps the light values": icon `#0284C7`, disc `#E0F2FE`, root = `lightTheme.color.background` |
| Explore FlatList row repaints without remount (Property 20, test d) | "(d)": the row name is light `textPrimary`, then after `setTestScheme('dark')` it is dark `textPrimary`; the meta line is `textSecondary` |
| Category placeholder tile uses fill, glyph white (Property 22) | "placeholder tile": light = `lightTheme.categoryVisual.Ride.tint`; dark Ride/Restaurant = `.fill`; glyph = `textOnPrimary` |
| Disney Springs body dark (fill split, rail, keyboard) | `DestinationScreen.render.test.tsx` "(a)(b)(c)": screen = `background`, row name = `textPrimary`, tile = `categoryVisual.Restaurant.fill`, rail = `borderStrong`, `keyboardAppearance` dark |
| DisneySpringsLayout closure-styled rail repaints (deps + extraData) | "repaints the closure-styled list rail": `borderLeftColor` light, then dark `borderStrong` after the switch |
| Park screen dark (tile fill, height badge, visited disc ring, favorites pill) | `ParkDestinationScreen.test.tsx` "(a)(b)(c)": background, `textPrimary`, `Ride.fill`, `PARK.dark.heightBadge`, `visitedFill` with ring `textOnPrimary`, `lavenderBg` |
| Park favorites toggle active state repaints live | "repaints a mounted row…": light `favoritesActiveBg`, then dark `favoritesActiveBg` and `favoritesActiveBorder` |
| Resorts directory dark (root, title, card, tier badge, active tab) | `ResortsDirectoryScreen.test.tsx` "(a)(b)(c)": `background`, `textPrimary`, card `surface`/`RESORTS.dark.cardBorder`/`cardShadow`, tier badge `RESORTS.dark.tierDeluxe`, tab `primary` |
| Rule-2a tier suffix, both schemes | "suffixes the hotel-picker tier colour": light `#7c3aed` / `#7c3aed18`; dark `RESORT_TIER.dark.deluxe` and its `18` suffix; sheet `surface` |
| Resorts dining FlatList repaints (extraData) | "repaints a mounted dining FlatList row": light then dark `textPrimary`; card border `RESORTS.dark.cardBorder` |
| CrowdCalendar dark (root, text, badge, festival, invariant scale, calendar theme) | `CrowdCalendarScreen.test.tsx` "(a)(b)(c)": `background`, 'Moderate' `textPrimary`, Early Entry `EVENT_BADGE.dark.earlyEntry`, festival `primaryFg`, EPCOT badge `CROWD_LEVEL.dark.quiet`, `calendarBackground` = `surface`, month `textPrimary`, arrow `primaryFg` |
| Calendar light theme unchanged and remount on switch | "keeps the light calendar theme…": light 'transparent'/`#5b2a86`/`#2e7d3a`; after the switch a new `Calendar` instance (`not.toBe`) with `surface` |
| ResortGuide cards, headings, pills dark | `ResortGuideSection.test.tsx` "(c)": card `surface`/`RESORT_GUIDE.dark.cardBorder`/`cardShadow`, heading `RESORT_GUIDE.dark.heading`, tier text `tierText`, directions button `primary` with label `textOnPrimary`, active pill `primary` |
| LocationGroup card, brief, map frame, directions button dark | `LocationGroupSection.test.tsx` "(c)": `surface`, `LOCATION.dark.cardBorder`/`shadow`, `briefTitle`, `briefSub`, `primary`/`textOnPrimary`, `mapFrameBg` |
| TodayInParkLens renders its B1 child dark | `TodayInParkLens.render.test.tsx` "(c)": location card `surface`/`LOCATION.dark.cardBorder`, directions button `primary` |

Untested in render: `destinationVisuals.ts` (data only). Covered by the guard and screenshots.
