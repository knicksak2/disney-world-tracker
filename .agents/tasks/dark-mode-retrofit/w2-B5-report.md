# W2 batch B5 — Trip shell — report

Converted all 16 owned files in `apps/mobile/src/screens/trips/` to `makeStyles` / `useAppTheme` / `usePalette`. No review file existed, so this was a from-scratch conversion. Snapshot `$env:TEMP\dark-mode-snapshot\B5\` was taken once, before any edit. It is kept for the reviewer and fix loop; the plan's snapshot-lifetime rule says the integrate step deletes it. No commits.

New palettes (11, co-located `*.palette.ts`): `AttachedExperienceListsSection`, `AttachedFoodListsSection`, `ExperiencePicker`, `GroupFavoritesSection`, `TripDetailScreen`, `TripFeedScreen`, `TripGuestManagementModal`, `TripMembersScreen`, `TripPlannedListScreen`, `TripSummaryScreen`, `TripsListScreen`.

## DoD 1 — strict guard (C4)

`THEME_GUARD_STRICT=B5 npx jest src/__tests__/themeRetrofit.guard.test.ts`: `Tests: 9 passed, 9 total`, exit 0.

## DoD 2 — light-colour multiset audit (C7)

14 of 16 files PASS. There are 2 DIFFs, and every line is justified:

- `TripPlannedListScreen.tsx`: `#7e57c2 3→2`, `#e8505b 1→0`, `parkAccent[*] 0→2`. `getParkColor` is a park hue used for a park, so rule 1 makes it `t.parkAccent['Magic Kingdom']` / `t.parkAccent['Hollywood Studios']`. Bracket reads are recorded symbolically. EPCOT resolves through the dotted read `t.parkAccent.EPCOT`.
- `TripDetailScreen.tsx`:
  - `parkAccent[*] 0→5`, `#7e57c2 −1`, `#e8505b −1`, `rgba(126,87,194,0.15) −1`, `rgba(232,80,91,0.15) −1`, `rgba(63,163,77,0.15) −1`. These are the park-pill colours `parkColorsFor(t)`: MK/HS/AK bg and text become `withAlpha(t.parkAccent[...], 0.15)` and `t.parkAccent[...]` (rule 1 park hue for a park, rule 2). The AK text `#2e9e6b` is the `success` token, so it stays `t.color.success`.
  - `#5b2a86 −2`, `#7e57c2 −2`, `#f6c343 −2`, `#6b6480 −1`. These are the 7 `HUB_SECTIONS[].color` values, now `HUB_SECTION_COLOR.light.<key>`. The audit does not resolve `.light` reads. **Flagged, see below.**

## DoD 3 — dark tests (a)/(b)/(c)/(d)

All 11 owned test files gained a `dark mode` block. (d) is in `TripsListScreen.test.tsx`. The Property 22 chip case is in `TripReservationsScreen.test.tsx`. Each block also has a "light keeps pre-retrofit values" case.

## DoD 4 — memo / list sites, textDefault

- `TripFeedScreen` FlatList: `ListHeaderComponent` reads parent `styles`/`t`, so it got `extraData={t.scheme}`.
- `TripsListScreen` FlatList: `renderRow` reads nothing themed, and the rows (`TripRow` / `SectionHeader`) call `useStyles()` themselves, so it has no `extraData`. Test (d) proves the live repaint.
- No owned `useMemo`/`useCallback`/effect reads styles or colours (checked: RodeWithConfirm `heading`, TripMembers `candidates`, TripDetail/PlannedList/Feed memos). No `React.memo`, no colour in `useRef`.
- Module-scope colour tables moved to `…For(t)` helpers: `STATUS_META` (TripsList, TripDetail), `ROLE_META` (Members), `RESERVATION_KIND_LABELS`/`getParkColor` (PlannedList), `REACTION_META`/`FEED_TYPE_META`/`RODE_WITH_VISUAL` (Feed). Avatar arrays became render-time palette reads.
- `...t.textDefault` placements: TripFeed `itemActorLine`, `commentAuthorLine`, `composerCtaIcon`, `rxEmoji`. Exclusions:
  - TripDetail `summaryEmoji`: H gradient.
  - ExperiencePicker `filterModalBtnText`: the style array already sets a colour.

## DoD 5 / 6 — tests, typecheck

- 11 owned files: `Test Suites: 11 passed`, `Tests: 189 passed`.
- C6 related sweep: `Test Suites: 35 passed`, `Tests: 451 passed`. That includes the unowned `tripStructureRegression` (HUB_SECTIONS snapshot) and `TripGuestManagement.test.tsx`.
- `npm run typecheck --workspace apps/mobile`: 0 errors, whole workspace.

## DoD 7 — files without an owned render test

| File | Coverage |
| --- | --- |
| `GroupFavoritesSection` | (c) in `TripDetailScreen.test.tsx` |
| `AttachedExperienceListsSection` | (c) in `TripDetailScreen.experienceLists` |
| `AttachedFoodListsSection` | (c) in `TripDetailScreen.foodLists` |
| `ResortPickerModal`, `RodeWithConfirmScreen`, `TripInviteScreen` | Guard and audit only |
| `TripGuestManagementModal` | Rendered by the unowned `TripGuestManagement.test.tsx` (still green), with no dark assertion |

## DoD 8 — rule 2a, surfaceAlt placements

- Every rule-2a suffix site is a theme token:
  - AttachedExperience ×5, AttachedFood ×5 (`danger`/`primary`/`primaryFg`)
  - TripDetail ×4 (`primary` ×3, `primaryLight` ×1)
  - GroupFavorites ×2
  - There are no non-token suffix sites.
- Background tints keep the fill token (`primary`, `danger`). The empty-state borders use `primaryFg`. `TripDetail` tile `${primaryLight}18` keeps `primaryLight`: a translucent tint of the token, and dark `#b28dff` at 9% reads well.
- On `surfaceAlt` there is no kit `PrimaryButton` or active `Chip`. ExperiencePicker's break card (`surfaceAlt`) holds custom primary-filled `durChipActive` and `addBreakBtn`.

## Named rule-1a sites

- `TripReservationsScreen` `kindChipTextActive`, `dateChipTextActive` and the active kind icon: `surface` becomes `textOnPrimary`.
- `TripDetailScreen` `heroCard`/`glanceCard`/`hubTile` `shadowColor: primaryDark` becomes `t.shadow.card.shadowColor` (rule 0).
- Every `primary` used as text, icon, border, ActivityIndicator or Badge colour becomes `primaryFg`.

## Flagged decisions for the reviewer / integrator

1. **`HUB_SECTIONS` (TripDetailScreen).** The plan says to remove the module-scope colour. But `HUB_SECTIONS` is exported, and the unowned `tripStructureRegression` snapshot pins its light hex values. The hub never renders `HubSection.color`. I kept the export's shape and values: `color` reads `HUB_SECTION_COLOR.light.*`, and a palette documents the dark mapping for any future consumer. That keeps the snapshot green without editing an unowned test, but it is a static light read that doesn't follow the palette read-form rule. The alternative is to drop or replace the field and update the unowned snapshot, which is the integrator's call.
2. **Category placeholder glyph** (TripSummary/TripFeed `ExperienceThumb`). The glyph was `primary` on the category tile, not white. The tile now uses `categoryVisual[k].fill` (rule 1 split, light identical), and the glyph is a pair `{light '#5b2a86', dark textOnPrimary}` so it reads on every dark fill.
3. `TripFeedScreen` keeps its private `withAlpha(hex, a)` helper. It gives the same output as `theme.withAlpha` for the 6-digit token inputs it receives.

## Behavior → test map

| Behavior | Test | Assertion |
| --- | --- | --- |
| Trips list root/text/past badge/row border dark | TripsListScreen.test | `backgroundColor === darkTheme.color.background`; name `color === textPrimary`; past badge `=== TRIP_ROW.dark.pastBg/pastBorder`; row `borderColor === TRIP_ROW.dark.rowBorder`; active tile `=== activeBg` |
| (d) live repaint without remount | TripsListScreen.test | light `pastBg` / `#1f1235` → `setTestScheme('dark')` → same row `=== TRIP_ROW.dark.pastBg`, name `textPrimary` |
| Property 22 chips | TripReservationsScreen.test | active kind/date chip `backgroundColor === darkTheme.color.primary`, label `color === textOnPrimary` (not `surface`); light `#5b2a86` / `#ffffff` |
| Reservation row | TripReservationsScreen.test | root dark bg; title `textPrimary`; time `primaryFg` |
| Picker tabs/search/badges/staged row | ExperiencePicker.test | tab bg `surfaceAlt`/`primary`; search `placeholderTextColor`, `keyboardAppearance 'dark'`, `color`; park Badge `primaryFg`; Ride Badge `categoryVisual.Ride.tint`; staged row `PICKER.dark.stagedRowBg` |
| Hub tiles + GroupFavorites | TripDetailScreen.test | root bg; tile title `textPrimary`; Logs badge `HUB_TILE.dark.activityText`; Ledger `primaryFg`; count `GROUP_FAVORITES.dark.heart`; empty `${primary}0a` / `${primaryFg}18`; past hero `primaryDark` |
| Attached lists sections | TripDetailScreen.{experienceLists,foodLists}.test | unavailable row `…dark.unavailableBg`; Attach btn `primary` + label `textOnPrimary`; empty rule-2a tint/border |
| Edit form inputs | TripEditScreen.test | root bg; input `color`/`backgroundColor`/`borderColor`/`placeholderTextColor`/`keyboardAppearance` |
| Feed CTA / rode-with chip | TripFeedScreen.test | CTA `FEED_MISC.dark.ctaBg/ctaBorder`; title `primaryFg`; `✓ Ariel` `RODE_WITH.dark.confirmedFg` |
| Members badge/avatar/modal | TripMembersScreen.test | Organizer badge `primaryFg`; Eric avatar `MEMBER_AVATAR.dark.success`, initial `textOnPrimary`; invite card `surface`, scrim `MEMBERS_MODAL.dark.scrim` |
| Planned badges | TripPlannedListScreen.test | unscheduled `SCHED_BADGE.dark.*`; park Badge `parkAccent['Magic Kingdom']`; LL Badge `RESERVATION_BADGE.dark.lightningLane` |
| Summary stats/favourite/thumb/hero | TripSummaryScreen.test | compass icon/disc `SUMMARY_STAT.dark.green*`; Top Ride text `SUMMARY_MISC.dark.favoriteText`; Ride thumb `categoryVisual.Ride.fill` + white glyph; hero gradient mode-invariant |

Observed during the batch: B4's `ExpenseFormModal.tsx` was transiently unparsable mid-edit, which made `TripsListScreen.test` fail to load. It resolved without any B5 change. No other batches' errors remain.
