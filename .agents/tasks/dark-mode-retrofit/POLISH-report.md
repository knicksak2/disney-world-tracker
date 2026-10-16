# Dark-mode ("Twilight") polish pass: final report

All of this work is in `apps/mobile` and `.kiro/specs/dark-mode`. Nothing is committed. One full
`npm run verify` ran at the end and exited `0`. `apps/api` and `packages/shared` are untouched.

One user-visible issue is still open: **Fix 11**, the white strip under non-tab screens in Dark
(see "Open item").

**Update: Fix 11 is resolved.** The user approved `expo-system-ui`, now pinned at `56.0.5`.
`App.tsx` sets the native window background to the Active theme's root background. See "Open
item" for the before and after samples.

## Findings and dispositions

### Planned fixes

| Fix | Finding | What changed |
| --- | --- | --- |
| 1 | B6-2 ParkWaitPulse: the selected park ring was invisible in dark | `PARK_WAIT_PULSE.dark.activeBorder` is now `DARK_TONAL.green.fg` (`#4cc38a`). Light stays `#22c55e`. |
| 2 | B6-1 ShareComposer: the unselected recipient icon was too faint | `SHARE_COMPOSER.dark.unselectedIcon` is now `darkColor.textSecondary`. Light stays `#cdbce6`. |
| 3 | B4-1 Expenses tabs were inverted (the active pill was darker than the track), plus B4-4 | New `EXPENSES.tabActiveBg` (light `#ffffff`, dark `borderStrong`). Dark `tabIdleText` is now `textSecondary`. The same fix went into the Balances toggle via `BALANCES.toggleActiveBg`. Dark `inkText`/`indigoText` (name ink) are now `textPrimary`. |
| 4 | B4-2 ExpenseFormModal: the active tier count pill was indistinct | New `FORM.tierPillActiveBg`/`tierPillActiveBorder` (dark `violet.tint` / `primaryFg`). The cards-view pill got `testID tier-count-pill-*`. |
| 5 | B4-3 The alcohol Switch used platform colours in dark | Handled by the shared `themedSwitchProps` helper (see Fix 12). |
| 6 | B1-2 / B2-3 Dark had flattened the muted-vs-heading text hierarchy | In the dark values of 7 palettes (`RESORT_GUIDE`, `LOCATION`, `LENS`, `COCKPIT`, `LORE`, `DINING`, `PASSPORT`), headings now use `textPrimary` and muted text uses `textSecondary`. `QuickSpecsRow.specText` and `ShowtimesCard.title/futureText` were left as they are because they have no muted sibling. |
| 7 | B1-3 The Resorts tier badges on the hotel photo changed colour in dark | `RESORTS.dark.tier*` now equals light (on-photo overlays don't change with the theme, Requirement 9.14). |
| 8 | B5-1 The exported `HUB_SECTIONS` was light-only | New `hubSectionsFor(scheme)`. `HUB_SECTIONS = hubSectionsFor('light')`, and its snapshot passes without being re-recorded. The rendered tiles were already themed. |
| 9 | B4-5 Two tier-count `TextInput`s had no `keyboardAppearance` | Added `keyboardAppearance={t.scheme}` to both (matrix and cards). The shadowing `t` map parameter was renamed to `tier`. A scan found 83 `<TextInput` tags, and none are missing it now. |
| 10 | The remaining small review findings | See the next table. |
| 12 | The Push notifications Switch had a blue platform thumb in dark, and the other Switches were unthemed (also covers B2-4 and Fix 5) | New `theme/switchColors.ts` `themedSwitchProps`. In light it passes the props through unchanged. In dark it uses `borderStrong`/`primary` for the track and `textOnPrimary`/`textSecondary` for the thumb. It is applied with `key={t.scheme}` at all six Switch sites. |
| 11 | The white strip below non-tab screens in Dark | **Not built.** See "Open item". |

### Fix 10 and the batch-review findings (review-b1 to b7)

| Finding | Disposition |
| --- | --- |
| B1-1 crowd scale | Left as-is and recorded as a design ruling. The scale stays the same in both themes, because the fallback would merge Quiet and Below-average into one green. |
| B1-2, B1-3 | Fixed (Fixes 6 and 7). |
| B2-1 `starRating` used as a fill behind white | Left as-is and recorded as a ruling: use `DARK_TONAL.amber.fill`. |
| B2-2 ForecastChart uses `primaryLight` | Left as-is. The code matches the design, and switching to `primaryFg` would change light. Only the closed w2-plan text was wrong. |
| B2-3 | Fixed (Fix 6). |
| B2-4 NoteControl Switch | Fixed (Fix 12). Light keeps the platform defaults. |
| B2-5 LiveWaits moderate dot | Left as-is. It is the same amber step and is at least 3:1 on the dark surface, so moving it would change nothing visible. |
| B3-N1 / B4-6 dark-only placeholder ternary | Left as-is and recorded as the approved pattern (it keeps the light default). |
| B3-N2 inline `extraData` array | Fixed. `FoodItemPickerModal` now uses a memoized `listExtraData`. |
| B3-N3 untested sheets | Tested: `AddToTripPickerSheet.dark.test.tsx`, `LogVisitModal.dark.test.tsx`, and a RestaurantDishLogCard dark describe. `AddToTripOrListChoiceSheet` was covered by the visual pass (MagicFab sheet). |
| B3-N4, B3-N5, B4-7, B5-2, B6-3 | Process and evidence notes. No code change. This report's verify tail is the evidence. |
| B4-1 to B4-5 | Fixed (Fixes 3, 4, 5, 9). |
| B4-8 untested dark values | Tier pills, Switches and `AVATAR_FILL` now have dark assertions. The schedule settings modal was captured in the visual pass (p28). The park-hours stripes have no dedicated shot. |
| B4-9 Showtime selected border was 2.98:1 | Fixed. New `SCHEDULE.showtimeActiveBorder`, dark `primaryFg` (7.41:1). |
| B5-1 | Fixed (Fix 8). |
| B5-3 kind-chip icon unasserted | Fixed. The test now asserts the icon is `textOnPrimary` when active and `textSecondary` when inactive. |
| B5-4 / B6-4 untested screens | Covered by the visual pass. ShareComposer also got a render test. |
| B6-1, B6-2 | Fixed (Fixes 2 and 1). |
| B7 `orderingDeterminism` hard-coded hex | Fixed. It now asserts `darkTheme.categoryVisual.Ride.tint` (and that it differs from light), with the Property 22 tag. |
| B7 RegisterScreen / AvatarChip | Fixed. Dark render tests were added (`authScreenLayout.test.tsx`, `AvatarChip.dark.test.tsx`). |
| B7 `AVATAR_GOLD.dark.ring` `#ffd54f` | Left as-is. It is the gold role and stays the same in both themes (13.67:1). |
| B7 podium borders | Left as-is. The light values already differ by design. `#3d1c5c` maps to `primaryFg`, and this is recorded as a ruling. |
| B7 `#f6a609` resolved two ways | Left as-is. One is a park accent and the other an amber facet, which are different roles. |
| B7 guard-only components (AvatarPicker, CompactEmptyState, GroupSection, PercentileBanner, CoverageStatGrid, CompletionStatTile) | Covered by the visual pass: the You & Crew, Vault, Full stats, Coverage detail and Friend profile screenshots. |

### Review-pass items (POLISH-review P-1 to P-6)

| Item | Disposition |
| --- | --- |
| P-1 | Fixed. The `extraData` stability test re-renders through a `makeUi()` factory. A mutation check confirmed it fails when the `useMemo` is removed. |
| P-2 | Fixed. A timing race in `recreationExperience.test.tsx` now uses `findByText`. It was green in the final run. |
| P-3 | Fix 11 is still not built (see "Open item"). |
| P-4 | Fixed. LogVisitModal, RestaurantDishLogCard and `AVATAR_FILL` now have dark and light render tests. |
| P-5 | Fixed. Both "exclude alcohol" Switches now have their own render tests. Removing either `key={t.scheme}` or the spread makes them fail. |
| P-6 | Resolved in the visual pass (next table). The spec checkboxes are all `- [ ]` or `- [x]`. The Kiro Spec Format validator can't run from the CLI, so the diagnostics were checked by hand only. |

### Found on the emulator during the visual pass, and fixed

The same defect showed up on 11 controls. The active segment used `surface` (`#1e1430`), which is
darker than its `surfaceAlt`/`violet.tint` track, so the selected segment looked like a darker hole
instead of a raised pill. The fix is the same everywhere: the active fill in dark is `borderStrong`
(`#4a3a6b`), and light keeps `#ffffff`.

| Control | File | AFTER shot |
| --- | --- | --- |
| LensSwitcher (Today / Passport). Idle labels were already `textSecondary`. | `LensSwitcher.palette.ts` `LENS.dark.activeBg` | p67, p68 |
| Expense form split-mode chips | `ExpenseFormModal.palette.ts` `FORM.modeChipSelectedBg` | p39 |
| Expense matrix stepper: the active border was the same as the idle `violet.border` | `FORM.matrixPillActiveBorder` dark is now `primaryFg` | p40 |
| Vault Pins/Food/Lists/Stats segments. Idle labels also went from `textPrimary` to `textSecondary`. | `CollectionScreen.palette.ts` `segActiveBg` / `segText` | p48 |
| Coverage detail lens | `CoverageDetailScreen.tsx` | p57 |
| Stats experiences sort | `ExperiencesDetailScreen.tsx` | p59 |
| Food stats sort | `FoodStatsScreen.tsx` | p60 |
| Crowd calendar park filter | `CrowdCalendarScreen.tsx` | p61 |
| Park destination category tabs | `ParkDestinationScreen.tsx` | p62 |
| Friend profile coverage lens | `FriendProfileScreen.tsx` | p63 |
| Schedule timing-mode segments | `TripScheduleScreen.tsx` | (render-tested; p28 shows the modal) |

## Open item: Fix 11, the white strip under non-tab screens in Dark

No dependency was added. `expo-system-ui` appears in neither `apps/mobile/package.json` nor the
lockfile, because this pass's build steps forbade adding it.

**Measured:** in `p00-you-crew-bottom-dark-start.png` (You & Crew, Dark, scrolled to the bottom),
the pixel at y 2330 is `#120a1f`, and y 2345 and 2395 are `#ffffff`. So the strip still reproduces
there.

**Not seen elsewhere:** these dark screenshots are `#120a1f` at the bottom rows, with no strip:

- `p02-inbox-dark`
- `p03-sent-shares-dark`
- `p51-food-list-detail-dark`

That fits the user's "i dont see it anymore": the strip only shows when a stack screen's content
ends above the gesture bar.

**Root cause:** the native window background behind the gesture bar. JavaScript can't paint there.

**Decision still needed:** the user said "if you think we need it thats fine". If they want it fixed,
the fix is `expo-system-ui`, pinned exact, using plan item 11 as written. Otherwise it stays a known
limitation.

**Resolved (follow-up step).** The user saw the strip again on their own device and approved the
dependency.

- **Dependency:** `expo-system-ui@56.0.5`, pinned exact.
- **Code:** in `App.tsx`, a `useEffect` keyed on `rootBackground` calls
  `SystemUI.setBackgroundColorAsync(rootBackground)`. A rejection is only logged.
- **Spec:** criterion 6.5, Property 25 and task 14.
- **Not done:** plan item 11's separate light `#ffffff` palette was not built. Light uses
  `rootBackground`, `#f5f2fb`.
- **Device check:** done after a reload, in the same bounded layout as `p00`. `android:id/content`
  was `[0,136][1080,2337]`, and samples were taken at x 100 and 980.
  - `p69-you-crew-bottom-dark-after`: y 2330, 2337, 2345 and 2395 are all `#120a1f`. Before, in
    `p00`, y 2345 and 2395 were `#ffffff`.
  - `p70-sent-shares-bottom-dark-after`: the same rows are all `#120a1f`.
  - `p69-you-crew-bottom-light-after`: the same rows are all `#f5f2fb`.
- **Light before:** `p69-*-before` was taken in the edge-to-edge layout, where the root spans the
  full 2400 px. There, dark is `#120a1f` and light is `#f5f2fb` at every sampled row, so in that
  layout light looks the same before and after. In the bounded layout, the light strip changes
  from the platform window default (white with the OS in light, per planning) to `#f5f2fb`,
  which matches the screen above it.

## Files changed in this pass (`apps/mobile/src` unless noted)

- **Spec:** `.kiro/specs/dark-mode/requirements.md`, `design.md` and `tasks.md`. Additive edits only: the polish requirements, the Property 24 Switch helper, and the rulings.
- **Theme:** `theme/switchColors.ts` (new), `theme/contrast.ts`, `theme/__tests__/switchColors.test.ts` (new).
- **Home and share:** `screens/home/ParkWaitPulse.palette.ts`, `screens/share/ShareComposerScreen.palette.ts`.
- **Trips:**
  - `TripExpensesScreen.palette.ts`/`.tsx`
  - `TripBalancesScreen.palette.ts`/`.tsx`
  - `ExpenseFormModal.palette.ts`/`.tsx`
  - `ReceiptReviewModal.tsx`
  - `TripDetailScreen.tsx`
  - `TripScheduleScreen.palette.ts`/`.tsx`
- **Catalog:**
  - `ResortGuideSection.palette.ts`, `LocationGroupSection.palette.ts`, `LensSwitcher.palette.ts`/`.tsx`
  - `LiveWaitCockpit.palette.ts`, `PassportAndLoreLens.palette.ts`, `DiningReservationCard.palette.ts`
  - `ParkPassportCard.palette.ts`, `ResortsDirectoryScreen.palette.ts`, `FoodItemPickerModal.tsx`
  - `NoteControl.tsx`, `CrowdCalendarScreen.tsx`, `ParkDestinationScreen.tsx`
- **Other screens:**
  - `screens/PushNotificationPreferenceControl.tsx`/`.palette.ts`
  - `screens/collection/CollectionScreen.palette.ts`/`.tsx`
  - `screens/stats/CoverageDetailScreen.tsx`, `ExperiencesDetailScreen.tsx`, `FoodStatsScreen.tsx`
  - `screens/friends/FriendProfileScreen.tsx`
- **New tests:** `ParkWaitPulse.dark`, `ShareComposerScreen.dark`, `AddToTripPickerSheet.dark`, `AvatarChip.dark`, `LogVisitModal.dark`, `LensSwitcher.dark`.
- **Extended tests:**
  - `TripExpensesScreen`, `TripBalancesScreen`, `TripDetailScreen`, `tripStructureRegression`
  - `TripScheduleScreen`, `TripReservationsScreen`, `ReceiptReviewModal`
  - `ResortGuideSection`, `LocationGroupSection`, `DiningReservationCard`, `FloatingActionDock`
  - `ExperienceDetailScreen.preservedBehaviors`, `ExperienceDetailScreen.recreationExperience`
  - `ResortsDirectoryScreen`, `FoodItemPickerModal`, `ParkPassportCard`, `orderingDeterminism.prop`
  - `PushNotificationPreferenceControl`, `NoteControl.shareable`, `authScreenLayout`, `CollectionScreen`
  - `CoverageDetailScreen`, `ExperiencesDetailScreen`, `FoodStatsScreen`, `CrowdCalendarScreen`
  - `ParkDestinationScreen`, `FriendProfileScreen.states`

Light values were not changed. Every new key's `light` value is the literal that rendered before
this pass. `themeGuard.ts` has no new allowlist entries.

## New contrast pairs (`CONTRAST_REQUIREMENTS`, re-checked by Property 9)

The text minimum is 4.5:1 and the non-text minimum is 3:1. All pairs are dark-theme.

| Pair | Ratio |
| --- | --- |
| ParkWaitPulse active ring vs surface | 7.91 |
| ParkWaitPulse active ring vs inactive ring | 3.70 |
| ShareComposer unselected icon vs surface | 7.81 |
| Expenses active tab label on active pill | 4.76 |
| Expenses idle tab label on track | 6.92 |
| Expenses active tab badge | 6.12 |
| Expenses idle tab badge | 5.71 |
| Balances active toggle label | 8.75 |
| Balances idle toggle label | 6.92 |
| Tier pill active border vs pill | 6.12 |
| Tier pill active border vs idle border | 3.9 |
| Showtime active border vs `surfaceAlt` | 7.41 |
| Switch on thumb vs on track | 5.21 |
| Switch on track vs surface | 3.36 |
| Switch off thumb vs surface | 7.81 |
| Switch off thumb vs off track | 4.44 |
| Split-mode selected label (`primaryFg` on `borderStrong`) | 4.76 |
| Split-mode idle label (`textSecondary` on `surfaceAlt`) | 6.92 |
| Matrix stepper active border vs surface | 8.37 |
| Matrix stepper active border vs idle `violet.border` | 3.91 |
| LensSwitcher active label on active segment | 4.76 |
| LensSwitcher idle label on track | 6.92 |
| Vault segment active label | 4.76 |
| Vault segment idle label (`textSecondary` on `violet.tint`) | 5.71 |
| Shared segmented control active label (`primaryFg` on `borderStrong`) | 4.76 |
| Shared segmented control idle label (`textSecondary` on `surfaceAlt`) | 6.92 |

## `npm run verify` (repo root, run once, literal tail)

The typecheck for `@dwt/api`, `@dwt/mobile` and `@dwt/shared` passed first. Then:

```
> @dwt/api@0.0.0 test
 Test Files  411 passed (411)
      Tests  2905 passed (2905)
   Duration  82.11s (transform 34.46s, setup 0ms, import 449.95s, tests 1584.38s, environment 99ms)

> @dwt/mobile@0.0.0 test
Test Suites: 281 passed, 281 total
Tests:       2150 passed, 2150 total
Snapshots:   2 passed, 2 total
Time:        63.434 s, estimated 75 s
Ran all test suites.

> @dwt/shared@0.0.0 test
 RUN  v4.1.10 C:/Users/knick/dev/disney-app/packages/shared
 Test Files  37 passed (37)
      Tests  470 passed (470)
   Duration  1.65s (transform 8.93s, setup 0ms, import 17.51s, tests 2.64s, environment 7ms)
EXIT=0
```

The api output includes some JSON error logs, such as "Failed archiveWaitSamples" and "Sampling
pass failed fatally". Those are failure paths that the api tests trigger on purpose, and every api
test passed. Jest also printed its usual "worker process has failed to exit gracefully" notice, which
is not a failure.

## Behaviour → test map

| Behaviour | Test file | Assertion that fails if the behaviour is wrong |
| --- | --- | --- |
| Fix 1: selected park ring visible in dark | `home/__tests__/ParkWaitPulse.dark.test.tsx` | The active pill's `borderColor` is `DARK_TONAL.green.fg` with width 2. The inactive EPCOT pill is `violet.border` and not equal to the active one. Light is `#22c55e`. |
| Fix 2: unselected recipient icon is muted | `share/__tests__/ShareComposerScreen.dark.test.tsx` | Unselected `ellipse-outline` is `textSecondary`. After the press, `checkmark-circle` is `primaryFg`, and the two differ. |
| Fix 3: Expenses active tab is stronger than idle | `TripExpensesScreen.test.tsx` | `tab-expenses-btn` background is `borderStrong`, the idle label is `textSecondary`, and the active label is `primaryFg`. The emphasis swaps on press. Light is `#ffffff`/`#655d78`. |
| Fix 3: Balances toggle emphasis | `TripBalancesScreen.test.tsx` | The active toggle background is `borderStrong`, the active label is `textPrimary`, and both differ from idle. |
| Fix 4: active tier pill is distinct | `TripExpensesScreen.test.tsx` | `tier-count-pill-0-*` `borderColor` is `primaryFg`, and the idle pill-1 is `violet.border`, which differs. Light is `#bca5db`/`#f5effa`. |
| Fix 9: tier inputs use the dark keyboard | `TripExpensesScreen.test.tsx` | `tier-count-0-user-1` `keyboardAppearance` is `'dark'` in the matrix view and again in the cards view. |
| Fix 6: muted text hierarchy | `ResortGuideSection`, `LocationGroupSection`, `DiningReservationCard`, `FloatingActionDock`, `ExperienceDetailScreen.preservedBehaviors` tests | The heading is `textPrimary`, the muted node is `textSecondary`, and heading ≠ muted. The inactive lens label is `textSecondary` and the active one is `primaryFg`. |
| Fix 7: on-photo tier badges don't change in dark | `ResortsDirectoryScreen.test.tsx` | The dark Deluxe and Moderate badge backgrounds equal `RESORTS.light.tierDeluxe` / `tierModerate`. |
| Fix 8: `HUB_SECTIONS` follows the theme | `tripStructureRegression.test.tsx`, `TripDetailScreen.test.tsx` | `hubSectionsFor('light')` equals `HUB_SECTIONS`, and the snapshot passes without being re-recorded. The dark colours equal the listed dark tokens and each differs from light. The tile icons are `primaryFg`, `primaryLight` and `amber.fg`. |
| B4-9: showtime selected border ≥ 3:1 | `TripScheduleScreen.test.tsx` | `showtime-autofit-pill` `borderColor` is `primaryFg`, and the inactive pill is `border`. |
| B3-N2: stable `extraData` | `FoodItemPickerModal.test.tsx` | `extraData` is the same reference (`toBe`) after a parent re-render. After switching to dark it is a new identity with `[1] === 'dark'`. This was mutation-checked. |
| B7: Ride tint read from tokens | `orderingDeterminism.prop.test.ts` | `toBe(darkTheme.categoryVisual.Ride.tint)` and `not.toBe(lightTheme…tint)`. |
| B5-3: kind-chip icon | `TripReservationsScreen.test.tsx` | The active icon is `textOnPrimary` and the inactive one is `textSecondary`. Light is `#ffffff`/`#6b6480`. |
| B3-N3: add-to-trip sheet in dark | `AddToTripPickerSheet.dark.test.tsx` | The `statusMeta` badge colour equals the dark token, and the icon is `primaryFg`. |
| B3-N3 / P-4: LogVisitModal in dark | `LogVisitModal.dark.test.tsx` | The sheet is `surface`. The note placeholder is `textSecondary`, with `keyboardAppearance 'dark'`. The selected rating pill is `primary` and the idle one `surfaceAlt`. The POST payload has `rating: 7`. The light placeholder is `undefined`. |
| P-4: RestaurantDishLogCard in dark | `ParkPassportCard.test.tsx` | The card is `amber.tint`, and the title is `orange.fg` at ≥ 4.5:1. Light pins `#fffdfa`/`#78350f`/… |
| P-4: `AVATAR_FILL` | `TripExpensesScreen.test.tsx` | In dark the payer avatar is the same hue family's `DARK_TONAL.*.fill`, and in light it is the original literal. The initial is ≥ 4.5:1. |
| B7: Register / AvatarChip in dark | `authScreenLayout.test.tsx`, `AvatarChip.dark.test.tsx` | The Register root is `background`, an input has `keyboardAppearance 'dark'`, and the label is `textSecondary`. The chip pill uses the token-derived dark value, and the avatar art equals light. |
| Fix 12: Switch helper | `theme/__tests__/switchColors.test.ts` (fast-check, Property 24) | Light returns its input by deep equality. Dark returns the token set, and the on/off thumbs differ. |
| Fix 12 / 5 / B2-4: every Switch is themed and remounts | `PushNotificationPreferenceControl`, `NoteControl.shareable`, `TripExpensesScreen` (item and discount alcohol), `ReceiptReviewModal` (item and charge) | The dark `trackColor`, `thumbColor` and `ios_backgroundColor` are tokens, and the thumb changes on flip. A dark→light switch produces a new host instance with the light props, which is `undefined` where the platform default applies. This was mutation-checked against removing `key` and the spread. |
| New contrast pairs | `theme/__tests__/contrast.prop.test.ts` | `failing` equals `[]` across the polish and visual-verify blocks. |
| Visual pass: LensSwitcher raised segment | `LensSwitcher.dark.test.tsx` | The active segment is `borderStrong` and not `surface`, and it is lighter than the `surfaceAlt` track. It moves on press. A live dark→light switch gives `#ffffff`. |
| Visual pass: split-mode chip raised | `TripExpensesScreen.test.tsx` | `split-mode-chip-even` is `borderStrong` and lighter than the track. The selection moves to `tiered` on press. Light is `#ffffff`. |
| Visual pass: active matrix stepper is distinct | `TripExpensesScreen.test.tsx` | After an increment, `tier-matrix-pill-0` `borderColor` is `primaryFg`, and the idle pill-1 is `violet.border`, which differs. The pair is ≥ 3:1. |
| Visual pass: Vault segments | `CollectionScreen.test.tsx` | `vault-seg-pins` is `borderStrong`. The idle label is `textSecondary`, not `textPrimary`. The emphasis swaps on press. |
| Visual pass: Coverage lens, stats sorts, Crowd calendar, park tabs, Friend coverage, timing-mode segments | `CoverageDetailScreen`, `ExperiencesDetailScreen`, `FoodStatsScreen`, `CrowdCalendarScreen`, `ParkDestinationScreen`, `FriendProfileScreen.states`, `TripScheduleScreen` tests | The active segment is `borderStrong`, not `surface` or `surfaceAlt`. After the press, the new segment is `borderStrong`, the old one is `undefined`, and the active label is `primaryFg`. |
| Fix 11: window background | none | Not implemented, so it has no test. |
| Fix 11: window background (resolved later) | `src/__tests__/App.systemUI.test.tsx` | `setBackgroundColorAsync` is called with `#120a1f` in dark and `#f5f2fb` in light. It is called again on each store flip while mounted, and not on a re-render with the same theme. A rejection is warned and the app stays mounted. |

## Screenshots (`screenshots/polish/`, emulator-5554, Expo Go)

Each numbered capture has `-light`, `-dark` and `-dark-return` shots (the return shot is taken
after a live switch back to Dark).

**Captures:**

- **p00:** You & Crew bottom at the start in Dark, and with the system set to OS-dark.
- **p01–p06:** You & Crew settings, Inbox, Sent shares, Friends search and results, Friend profile.
- **p07–p22:**
  - Home ParkWaitPulse (Fix 1), MagicFab sheet, Live waits
  - Experience Today lens and Passport lens
  - Resorts directory (Fix 7), Resort destination, Resort guide (Fix 6)
  - Experience load error, Restaurant detail (top and Today)
  - Location group (Fix 6), Menu, Restaurant Passport lens
  - Disney Springs destination and its list
- **p23–p41:**
  - Trip detail tiles (Fix 8), Planned list, Reservations, Reservation form
  - Schedule, Schedule settings modal
  - Expenses tabs (Fix 3), Balances, Balances toggle (Fix 3)
  - Guest management
  - Expense form: tier pills (Fix 4), tier cards, tier keyboard (Fix 9), alcohol Switch off and on (Fix 5)
  - Split mode (AFTER), Tier matrix (AFTER)
  - Members
- **p42–p66:**
  - Pin board tier pills, Vault pin showcase, Showcase customize
  - Share composer unselected and selected (Fix 2)
  - Food lists, Vault segments (AFTER), Vault lists, Food lists (all), Food list detail
  - Experience list detail, Experience lists (all)
  - Park stats, Full stats, Coverage detail, Coverage lens (AFTER)
  - Stats experiences sort (before and AFTER), Food stats sort (AFTER)
  - Crowd calendar (AFTER), Park destination tabs (AFTER), Friend coverage lens (AFTER)
  - Trip activity feed, Trip summary, Date picker modal
- **p67–p68:** Experience lens Today and Passport (AFTER).

**Extra parity shots:** `p26b`/`p26c`/`p26d` (Reservation form light after a wait, a fresh light
render, and dark after a fresh light), and `p45b` (Share composer, fresh light).

The older `screenshots/*.png` (26 files) are from the earlier retrofit pass.

**Defects found on screen:**

- The darker-hole active segment on 11 controls. All were fixed, re-shot as AFTER, and given tests.
- The Fix 11 white strip, which is still open.

The scratch `tmp-probe.png` was deleted.

## Screens still needing a manual check

- **Auth screens:** Login, Register, Forgot Password and Reset Password, in light and dark. No shots were taken, because that needs logging out, and the user wasn't asked to sign back in. Register has a dark render test only.
- **Fix 11 strip:** after any decision on `expo-system-ui`, recheck You & Crew scrolled to the bottom in Dark, plus one other short stack screen.
- **No dedicated shots:** ResortPickerModal, RodeWithConfirm and TripInvite (B5-4), and Attribution (B6-4).
- **Behind native modules:** a custom dev or EAS build, to confirm that Switch remounts and keyboard appearance behave as they do in Expo Go.

## `git status --short -- apps/api packages/shared`

```
(no output)
```

The command printed nothing, so neither workspace has any changes. No scratch scripts or helper
files remain. The scratch verify log and `tmp-probe.png` were deleted. The working tree still shows
`apps/mobile/jest.config.js` and `__mocks__/@react-native-async-storage/`, which are intended
changes from dark-mode task 1, not from this pass.
