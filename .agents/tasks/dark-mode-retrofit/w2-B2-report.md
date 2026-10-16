# W2 batch B2 report — Experience detail & live

Converted from scratch (no `review-b2.json` existed). All 27 owned source files now use
`makeStyles` / `useAppTheme` / `usePalette`; 16 co-located `*.palette.ts` files were added. No
kit, shared, guard, steering or other-batch file was edited. No commits.

## DoD checklist

1. Strict guard (`THEME_GUARD_STRICT=B2`): **PASS**, 9/9 tests, exit 0.
2. Light-colour multiset audit: 26/27 PASS; 1 justified difference (below).
3. Dark tests (a)/(b)/(c)/(d) added (map below).
4. Memo / list sites reviewed (below).
5. Owned tests: 31 files, 220 tests, all pass. Related-test sweep (`--findRelatedTests`, 55 suites / 380 tests, includes unowned importers): all pass.
6. `npm run typecheck` (apps/mobile): exit 0, **0 errors in the whole tree** at the final run.
7. Behavior→test map and files without a render test: below.
8. Rule 2a: no alpha-suffix sites in B2. PrimaryButton / active Chip placements: below.

## Command tails

```
C4  $env:THEME_GUARD_STRICT='B2'; npx jest src/__tests__/themeRetrofit.guard.test.ts --maxWorkers=2
    PASS src/__tests__/themeRetrofit.guard.test.ts
    Test Suites: 1 passed, 1 total
    Tests:       9 passed, 9 total            exit=0
C5  npm run typecheck   →  exit=0, total TS errors in tree: 0, B2 TS errors: 0
C6  npx jest --findRelatedTests <27 files> --maxWorkers=2
    Test Suites: 55 passed, 55 total
    Tests:       380 passed, 380 total
    (an earlier sweep run hit a transient SyntaxError in B7's in-flight
     ChangePasswordControl.tsx, reached via RootNavigator; it was clean on re-run)
C7  audit.cjs B2 <27 files>
    PASS … (26 files)
    DIFF screens/catalog/NoteControl.tsx
        #6b6480: before 4, after 5
Owned tests  npx jest <31 owned files> --maxWorkers=2
    Test Suites: 31 passed, 31 total
    Tests:       220 passed, 220 total        exit=0
```

## Audit difference

- `NoteControl.tsx` `#6b6480` +1. I added `placeholderTextColor={t.scheme === 'dark' ? t.color.textSecondary : undefined}`, plus `keyboardAppearance={t.scheme}`, per "Third-party and native props". The `textSecondary` read counts as a light colour, but the branch only runs in dark. Light still gets the platform-default placeholder (no `placeholderTextColor`), so light stays byte-identical. The test asserts `placeholderTextColor` is `undefined` under light.
- Not visible to the audit (it goes through a local alias): `ExperienceDetailScreen` hero placeholder `visual.tint → visual.fill` (rule 1, category fill split / Property 22). Light is unchanged because fill === tint in light.

## Deviations from the plan (design wins)

- **ForecastChart / WaitInsights / Cockpit bars.** The plan says to use `primaryFg`. The source reads `primaryLight` (light `#7e57c2`), so switching to `primaryFg` (`#5b2a86`) would change light. I kept `t.color.primaryLight` (dark `#b28dff`, 6.80:1 on the card). Where the source literal was `#5b2a86` (the Cockpit's active bar), the data-mark rule applies and it became `primaryFg`.
- **NoteControl `Switch`.** It has no track or thumb literals, so rule "Switch → palette pair" has nothing to convert. I left the platform default. Adding colours would change light.
- **Snapshot.** I kept `%TEMP%\dark-mode-snapshot\B2\` (outside the repo) per the plan's "Snapshot lifetime" decision, so review and fix iterations can re-run C7. The integrate step deletes it. Nothing scratch is in the repo.

## Judgement calls (flag for review)

- `#190c2d` (and `#371756`, `#581c87`) used as **text on a surface** → rule 3 T violet → `DARK_TONAL.violet.fg`. This matches B1's `LocationGroupSection.palette.ts`.
- `#655d78` (L 0.1195 < 0.12) T → `textPrimary`. This matches B1.
- ParkPassportCard active rating chip: `#f59e0b` (the `starRating` value) is a fill behind white text. I used `DARK_TONAL.amber.fill`, by analogy with rule 4. Taken literally, rule 1 would give dark `starRating` `#f6c343`, and white on that is about 1.6:1.
- LiveWaitCockpit standby instrument: closed `#1e293b` is H (L 0.022) → invariant. The status copy `#bbf7d0` / `#94a3b8` sits on those always-dark fills, so I kept it invariant (rule 3 H reasoning). Low-emphasis spark bar `#cfc2e5` → B (`violet.border`).
- LiveWaitsScreen status dots: a wait-heat scale → V, invariant. The moderate step `#f59e0b` matched a token first (rule 1) → `t.color.starRating`.
- ExperienceDetailScreen: the land pill is always white over the photo (rule 5 exempt veil), so its `#371756` text stays invariant. The scrim `rgba(20, 8, 36, 0.88)` is H → invariant. The category pill `rgba(91,42,134,0.85)` → `withAlpha(t.color.primary, 0.85)`.
- Rule-0 token read: LiveWaits `parkChipActive.shadowColor: theme.color.primary` → pair `{#5b2a86, #000000}`.

## Memo / list / effect sites (DoD 4)

- `LiveWaitsScreen.renderItem` (`useCallback`): deps now include `styles, t, waitStatus`. The `FlatList` gets `extraData={t.scheme}`. Pinned by test (d).
- `liveSectionShared` module-scope `STATUS_COLOR` (it read `theme.color`) moved into the `StatusBadge` render.
- Reviewed and unchanged, because none reads `styles` / `t` / a palette:
  - ExperienceDetailScreen: `handleLensChange`, `invalidateAfterLogChange`, `activeTrip`, `eligibleTripsForAdd`.
  - LiveWaitCockpit: `activeTrip`.
  - MenuScreen: `handleAddItemToList`.
  - AboutSection: `handleMeasureLayout`.
  - CompletionControls: `userTz`.
  - ParkPassportCard and NoteControl: their `useEffect`s.
  - LiveWaitsScreen: 7 `useMemo`s and 3 `useEffect`s.
- No `React.memo` components and no colours in a `useRef`.

## `...t.textDefault` placements

- AboutSection `hiddenTestText`.
- ShowtimesCard `titleIcon`.
- QuickSpecsRow `specIcon`.
- PassportAndLoreLens: the ✨ badge glyph, `insiderBulletIcon`, the hidden `aggregate-value`.
- ParkPassportCard: 🧭, the hidden "Park Passport", the hidden visit-count `Text`, 🗑️, the hidden `rating-empty` / `note-empty`.

Exclusions:

- Nested texts: VQ `stateText`, `heroRatingCountText`, `statSmall`, `statUnit`, `visitNoteText` inner.
- Mode-invariant backgrounds: hero pills on the photo, the LiveWaits gradient header.
- Style arrays that already set a colour: pill / tab / chip texts.

## DoD 8 — PrimaryButton / active Chip placement

- None sits on `surfaceAlt`.
- One is outside criterion 7.5's scope: ParkPassportCard's "Log first visit" `PrimaryButton` sits on the passport card's amber tint (`#402e32` in dark). The integrator should decide whether that needs a check.

## Files with no render test (guard + screenshots only)

- `QuickSpecsRow`, `LiveStatusStrip`, `LiveWaitCockpit`.
- `live/DiningSection`, `live/ForecastChart`, `live/liveSectionShared`, `live/RideLiveSection`, `live/ShowtimesSection`.

Indirectly asserted in dark:

- `LensSwitcher` (ExperienceDetailScreen test).
- `PassportAndLoreLens` (FloatingActionDock test).
- `VisitHistoryTimeline`, `CompletionControls`, `RatingControl` (YourVisitCard.render test).

## Behavior → test map

| Behavior | Test file | Assertion |
| --- | --- | --- |
| Detail screen root / body text / Property 22 tile | `ExperienceDetailScreen.preservedBehaviors.test.tsx` | root bg = dark `background`; `about-text` = dark `textPrimary`; `experience-hero-placeholder` bg = `darkTheme.categoryVisual.Show.fill` (≠ tint), glyph = `textOnPrimary`; light tile `#e8505b` |
| LensSwitcher track | same | `lens-switcher` bg = `LENS.dark.trackBg`; light `#ede6f6` |
| Menu screen (a)(b)(c) | `MenuScreen.backControlAndTheme.test.tsx` | root bg = dark `background`; "Mains" = `textPrimary`; menu-type Badge color = `primaryFg`, cuisine = `accent`; item add bg = `MENU_ITEM.dark.addBg`; inactive tab = `surfaceAlt`; light `#5b2a86` / `#f6f2fa` |
| Live waits (a)(b)(c) | `LiveWaitsScreen.test.tsx` | root bg; row name `textPrimary`; crowd card bg / border = `LIVE_WAITS.dark.*`; active filter = `withAlpha(dark primary, 0.15)`; row "+ Log" = `primaryFg` |
| Live waits (d) live repaint | same | same row host instance (`toBe(row)`) goes `#ffffff` → dark `surface`, name `#1f1235` → `textPrimary`, "+ Log" `#5b2a86` → `primaryFg` after `setTestScheme('dark')` with no remount |
| AboutSection toggle | `AboutSection.render.test.tsx` | "Read more" = `primaryFg`; light `#5b2a86` |
| Favorite heart | `FavoriteToggle.test.tsx` | filled = `HEART.dark.favorited`, outline = dark `textSecondary`; light `#FF2D55` |
| VQ banner | `VirtualQueueBanner.test.tsx` | bg / border / range bg / range text = `VQ.dark.*`; light `#eff6ff` |
| Menu summary | `MenuSummaryCard.test.tsx` | Badge text = `primaryFg`; count = `textPrimary`; spinner = `primaryFg`; light `#5b2a86` |
| Dock + Passport lens | `FloatingActionDock.test.tsx` | dock bg = `withAlpha(dark surface, 0.95)`, border / secondary = `DOCK.dark.*`, primary fill = dark `primary`; insider label `primaryFg`, bullet `LORE.dark.inkText`, tag pill `LORE.dark.cloudPillBg`; light rgba / `#5b2a86` / `#fbf9fe` |
| Showtimes card | `ShowtimesCard.test.tsx` | card surface / border / title / pulse / past / next / future pills = dark values; next text `textOnPrimary`; light `#ffffff` / `#16a34a` |
| Dining card | `DiningReservationCard.test.tsx` | card surface / border / shadow, title, open text, reserve fill `DINING.dark.reserveBg`, log-dish = dark `primary`, add-to-list bg / text; light `#ffffff` / `#d97706` / `#190c2d` |
| Note editor | `NoteControl.shareable.test.tsx` | input bg / border / text dark tokens, placeholder = dark `textSecondary`, keyboard `dark`; light placeholder `undefined`, keyboard `light`, bg `#efe9f7` |
| Wait insights | `WaitInsightsSection.test.tsx` | verdict fill (painted ancestor) = `VERDICT.dark.fill`; savings text = `VERDICT.dark.saveText`; light `#3fa34d` |
| Passport card | `ParkPassportCard.test.tsx` | card bg / border, seal bg + `accentDark` border, title ink, visit date, row veil; active rating chip = `PASSPORT.dark.pickerActiveBg`, inactive = `ribbonBg`; light `#fffcf5` / `#d4a017` / `#78350f` |
| Your-visit card + controls | `YourVisitCard.render.test.tsx` | badge `surfaceAlt`; completion date / rating value / history header `textPrimary`; history row border `border`; picker selected `primary`, others `surfaceAlt`; spinner `primaryFg`; edit modal surface, scrim ancestor = `SCRIM.dark.backdrop`, keyboard `dark`; light `#efe9f7` / `#1f1235` |

Stop-and-report items: none. Other batches' in-flight errors seen: early typecheck runs showed
errors in B7 `screens/navigation/TabSelector.tsx`, B7 stats tests and B5 `TripsListScreen.tsx`.
They were gone by the final run.
