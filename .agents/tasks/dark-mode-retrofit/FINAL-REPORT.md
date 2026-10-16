# Dark-Mode Retrofit ("Twilight") — Final Report (spec tasks 11–12)

## Status

- **Task 12.1 (final gate): done.** `npm run verify` ran once and exited `0` (tail below).
- **Task 11 (visual verification): partly done, left unchecked.** I captured and inspected light
  and dark shots on the `emulator-5554` AVD for 9 of the brief's 10 screens, plus Crowd Calendar,
  the System + OS-dark path, and live-switch round trips. The pass found one real defect, which is
  now fixed, re-captured and covered by a regression test. **Login was not captured** (reason below).
  Most of spec task 11.1's ~40-screen checklist is also uncaptured, so 11.1 and 11.2 stay `[ ]`.

## Files changed, by area

Counts come from `git status --porcelain --untracked-files=all` (the retrofit is uncommitted; no commits were made).

| Area | Files | Notes |
| --- | --- | --- |
| `apps/mobile/src/theme/` (kit + token model) | 22 | `theme.ts` (Twilight tokens, `DARK_TONAL`, `withAlpha`, `definePalette`, colour-free static `theme`), new `useAppTheme.ts`, `makeStyles.ts`, `appearance.ts`, `AppearanceChrome.ts`, `appearanceStorage.ts`, `useActiveTheme.ts`, `contrast.ts`, `components.palette.ts`; `components.tsx` / `charts.tsx` on `makeStyles` |
| `apps/mobile/src/screens/**` (source) | 136 | Every screen moved to `makeStyles((t) => …)` / `useAppTheme()`; literals moved to palettes |
| `*.palette.ts` (co-located `definePalette({ light, dark })`) | 81 | light = original literal, byte-identical |
| `components/`, `features/`, `navigation/` | 8 | `RootNavigator` tab bar from `t.tabBar`, `DatePickerField` / `ResortPicker` themed props, notifications |
| Other mobile (state, test infra, mocks) | 9 | `state/themeStore.ts`, `src/test/themeGuard.ts`, AsyncStorage jest mock, `setupScrollDefaults.ts` |
| Mobile tests | 112 | New property/guard/render tests plus updated fixtures |
| `.kiro/` (spec + steering) | 30 | `.kiro/specs/dark-mode/*` (additive amendments), `.kiro/steering/tech-conventions.md` Mobile bullet |
| `.agents/tasks/dark-mode-retrofit/` | 33 | design, wave plans, batch reports, reviews, this report (screenshots not counted) |
| `apps/api`, `packages/shared` | **0** | confirmed below |

Outside the retrofit, `README.md`, `docs/hosting.md`, `render.yaml` and `package-lock.json`
also show as modified. Those come from earlier work in this session (the README/hosting and admin-panel docs) and aren't part of this change.

**This step's own edits (task 11 fix):**

- `apps/mobile/src/theme/theme.ts`: light `outline.card` changed from `{}` to `{ borderWidth: 0 }`, and its doc comment updated.
- `apps/mobile/src/theme/__tests__/theme.tokens.test.ts`, `components.theme.test.tsx`, `screens/foodLists/__tests__/MarkGottenUndoToast.test.tsx`, `screens/profile/__tests__/PinCelebrationModal.test.tsx`: the light assertions now expect `borderWidth` to be `0` instead of undefined. I also added the live-switch regression test.
- `.kiro/specs/dark-mode/design.md`, `.kiro/specs/dark-mode/tasks.md` (light-parity note; task 12 checked), and `.agents/tasks/dark-mode-retrofit/design.md`: the `outline.card` light value is updated. The edits are additive, with nothing renumbered.

## Final Twilight palette

### Core tokens (light unchanged / dark)

| Token | Light | Dark |
| --- | --- | --- |
| background | `#f5f2fb` | `#120a1f` |
| surface | `#ffffff` | `#1e1430` |
| surfaceAlt | `#efe9f7` | `#2a1d42` |
| border / borderStrong | `#e2d9f0` / `#cdbce6` | `#33264d` / `#4a3a6b` |
| textPrimary / textSecondary | `#1f1235` / `#6b6480` | `#f3eefc` / `#b3a8c9` |
| textOnPrimary / textOnAccent | `#ffffff` / `#3d1c5c` | `#ffffff` / `#3d1c5c` |
| primary / primaryDark / primaryLight | `#5b2a86` / `#3d1c5c` / `#7e57c2` | `#7e57c2` / `#2a1450` / `#b28dff` |
| primaryFg (text, icons, links, data marks) | `#5b2a86` | `#c4a3ff` |
| accent / accentDark | `#f6c343` / `#d4a017` | `#f6c343` / `#d4a017` |
| success / danger / warning | `#2e9e6b` / `#d6336c` / `#e8a317` | `#4cc38a` / `#ff6b9a` / `#f5b83d` |
| warningSurface / warningText | `#fff4d6` / `#8a5a00` | `#3a2c0e` / `#ffd27a` |
| starRating | `#f59e0b` | `#f6c343` |
| gradient.header (PrimaryButton) | `#5b2a86 → #3d1c5c` | `#7e57c2 → #7650b9` |
| gradient.headerVivid | `#7e57c2 → #5b2a86 → #3d1c5c` | `#5b2a86 → #3b1d6e → #1a0d33` |
| gradient.fab / gradient.chartBar | (= headerVivid light) | `#9d7ae0 → #7e57c2 → #7650b9` / `#c4a3ff → #9d7ae0 → #7e57c2` |
| outline.card | `{ borderWidth: 0 }` (**changed this step**, was `{}`; draws nothing) | hairline `#33264d` |
| textDefault | `{}` | `{ color: '#f3eefc' }` |
| tab bar bg / border / active / inactive / badge | DefaultTheme / `#003a9b` / `#6b7280` / `#d97706` | `#170e27` / `#33264d` / `#f6c343` / `#8a7fa3` / `#f6c343` on `#3d1c5c` |

### Category tints and fills (dark), with computed WCAG 2.x contrast

I recomputed these ratios in this step from the hex values in `theme.ts` (`CATEGORY_TINT_DARK`,
`CATEGORY_FILL_DARK`), using a stdin-only Node expression with no file written. They match the
design tables. The minimums are surface `#1e1430`, surfaceAlt `#2a1d42`, background `#120a1f`,
and the Badge's 14% tint over surface.

| Category | Dark tint | vs surface | vs surfaceAlt | vs background | Badge text on 14% tint | Dark fill | White on fill |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Ride | `#b28dff` | 6.80 | 6.02 | 7.48 | 5.39 | `#7e57c2` | 5.21 |
| Show | `#ff7a83` | 6.98 | 6.18 | 7.68 | 5.58 | `#c42b3c` | 5.59 |
| Restaurant | `#ffb732` | 10.08 | 8.92 | 11.09 | 7.58 | `#b5520f` | 5.03 |
| Parade | `#f6c343` | 10.69 | 9.47 | 11.76 | 7.93 | `#9a5b00` | 5.43 |
| Character_Meet | `#5aa2ff` | 6.72 | 5.95 | 7.39 | 5.39 | `#2563eb` | 5.17 |
| Walkthrough / Tour | `#2ec4b0` | 8.05 | 7.12 | 8.85 | 6.36 | `#0e7490` | 5.36 |
| PlayArea / Recreation | `#6fcf73` | 9.06 | 8.02 | 9.96 | 7.03 | `#1f7a52` | 5.30 |
| Game / Event | `#d27ff0` | 6.71 | 5.94 | 7.38 | 5.34 | `#8e24aa` | 7.04 |
| Spa | `#ff7eb3` | 7.42 | 6.57 | 8.16 | 5.83 | `#b8336f` | 5.61 |
| Other | `#b3a8c9` | 7.81 | 6.92 | 8.60 | 6.06 | `#4a3a6b` | 9.96 |
| Resort / resortVisual | `#c4a3ff` | 8.37 | 7.41 | 9.21 | 6.42 | `#5b2a86` | 9.90 |

Every pair clears 4.5:1. Light tints are unchanged, and light fill equals light tint. The
pre-existing light white-on-fill values of 2.02 (Restaurant) and 1.64 (Parade) are left as they
were (Requirement 9.2). `theme/contrast.ts` holds more than 150 declared pairs (the core text,
park accents, `DARK_TONAL`, tier text and non-text marks), and `contrast.prop.test.ts` (Property 9)
re-checks every floor in CI.

## Regression-guard allowlist (`apps/mobile/src/test/themeGuard.ts`)

- **`ARTWORK_AND_TOKEN_FILES`** (may contain raw hex / chromatic rgb):
  - `theme/theme.ts`
  - `theme/contrast.ts`
  - `components/pins/motifPaths.ts`, `pinArt.ts`, `pinRenderModel.ts`, `pinTierMeta.ts`, `PinView.tsx`
  - `avatars/AvatarPresets.tsx`
  - `screens/catalog/destinationVisuals.ts`
  - plus any `*.palette.ts`
- **`THEME_INTERNALS`** (may import per-scheme theme objects): `theme/theme.ts`, `useAppTheme.ts`,
  `makeStyles.ts`, `appearance.ts`, `AppearanceChrome.ts` and `contrast.ts`. `*.palette.ts` is also
  allowed for named imports.
- **`staticToken`** is allowed only in `theme/theme.ts`.
- **Exempt everywhere**: `shadowColor: '#000'` / `'#000000'`, and neutral `rgba(255,255,255,a)` /
  `rgba(0,0,0,a)`.

### Code-level sweep result

- `themeRetrofit.guard.test.ts` ("has zero violations outside the allowlists") passed in the final
  gate, along with the stale-allowlist and palette-shape checks. That confirms zero leftover hex
  literals, chromatic rgb, static token reads or forbidden theme imports anywhere in `apps/mobile/src`.
- I also ran an independent grep outside the allowlists for quoted hex and `rgba(`. It turned up
  only black shadows (`'#000'`) and neutral white/black rgba: scrims, header pills and photo
  overlays. All are deliberately exempt.
- A grep for named colour literals (`'white'`, `'black'`, `'red'`, …), which the guard does not
  cover, found only `'transparent'`. That is scheme-neutral.

## `npm run verify` — literal tail (run once, from the repo root)

```
> @dwt/api@0.0.0 typecheck
> @dwt/mobile@0.0.0 typecheck
> @dwt/shared@0.0.0 typecheck
> @dwt/api@0.0.0 test
 Test Files  411 passed (411)
      Tests  2905 passed (2905)
   Start at  00:22:44
   Duration  84.11s (transform 38.68s, setup 0ms, import 430.61s, tests 1511.33s, environment 149ms)
> @dwt/mobile@0.0.0 test
A worker process has failed to exit gracefully and has been force exited. This is likely caused by
Test Suites: 274 passed, 274 total
Tests:       2095 passed, 2095 total
Snapshots:   2 passed, 2 total
Time:        81.574 s
Ran all test suites.
> @dwt/shared@0.0.0 test
 RUN  v4.1.10 C:/Users/knick/dev/disney-app/packages/shared
 Test Files  37 passed (37)
      Tests  470 passed (470)
   Start at  00:25:31
   Duration  1.31s (transform 6.60s, setup 0ms, import 14.01s, tests 2.17s, environment 8ms)
EXIT CODE: 0
```

- The `apps/api` run also prints pino `level:50` lines such as "Failed archiveWaitSamples" and
  "Sampling pass failed fatally". Those come from error-path tests that exercise failure handling
  on purpose. All 2905 tests passed.
- The mobile "worker failed to exit gracefully" line is a Jest open-handle warning, not a failure.
- A green gate shows nothing is broken. It doesn't show that every new behaviour is covered; the
  map below covers that.

## Behavior → test map

| Behavior / branch | Test file | Assertion that fails if it's wrong |
| --- | --- | --- |
| **(This step) Live dark→light switch clears the card hairline** | `theme/__tests__/components.theme.test.tsx` "a live dark→light switch explicitly clears the dark card hairline" | Mounted Card has `borderWidth === StyleSheet.hairlineWidth` and border `#33264d` in dark. After `preference: 'light'`, it is the **same host instance** with `borderWidth === 0`. This would fail on the old `{}` (undefined). |
| **(This step) Light outline token is an explicit zero** | `theme/__tests__/theme.tokens.test.ts` | `expect(lightTheme.outline.card).toEqual({ borderWidth: 0 })` (old `{}` fails) |
| **(This step) Light consumers of the outline** | `components.theme.test.tsx` (Card cases), `MarkGottenUndoToast.test.tsx`, `PinCelebrationModal.test.tsx` | light `borderWidth` is `0` and `borderColor` is undefined; dark keeps the hairline |
| Light/dark token key parity (P7) | `theme.tokens.test.ts` | for every group and key, `Object.keys(dark) === Object.keys(light)` and values are valid colours |
| Light byte-identical to the pre-retrofit palette (P8) | `theme.tokens.test.ts` | every `PRE_RETROFIT_COLOR` key equals its literal, e.g. `withAlpha('#5b2a86', 0.14) === 'rgba(91, 42, 134, 0.14)'` |
| Contrast floors (P9) | `theme/__tests__/contrast.prop.test.ts` | `contrastRatio(fg, bg) >= min` for all `CONTRAST_REQUIREMENTS` (more than 150 entries); `failing` equals `[]` |
| Theme resolution, total and consistent (P10) | `theme/__tests__/useAppTheme.test.tsx` | `useAppTheme() === themes[resolveActiveTheme(pref, os)]` for every input |
| `makeStyles` lazy and memoized per scheme (P11) | `theme/__tests__/makeStyles.prop.test.tsx` | factory not called at import; called at most once per scheme; `current` is `previous` |
| Navigation chrome from tokens (P12 / P3) | `__tests__/App.appearance.test.tsx` | light uses `DefaultTheme` and `'dark'` status bar; dark nav colours equal `EXPECTED_DARK_NAV_COLORS`, root background `#120a1f`, `'light'` status bar |
| Tab bar and MagicFab follow the theme (P13) | `navigation/__tests__/tabBarTheme.test.tsx` | `labelColor('Home') === t.tabBar.activeTint`, inactive labels `=== inactiveTint`, the badge renders with themed colours |
| Palette files complete and valid (P14) | `__tests__/themeRetrofit.guard.test.ts` | each `*.palette.ts` uses `definePalette(`, has only `export const X = definePalette(` and contains no logic |
| Guard sound, tree clean (P15) | `test/__tests__/themeGuard.prop.test.ts`, `themeRetrofit.guard.test.ts` | generated hex/rgb gives `['hex']` / `['chromaticRgb']` on screens and `[]` on allowlisted files; real tree `violations` equals `[]`; `stale` equals `[]` |
| Kit primitives use the active tokens (P16) | `components.theme.test.tsx`, `charts.theme.test.tsx` | e.g. Card `backgroundColor === themes[s].color.surface`, SecondaryButton neutral `=== surfaceAlt` |
| Mounted tree repaints live (P17) | `components.theme.test.tsx` | same host instances; screen, card, chip and label colours equal the resolved theme after each of 100 runs |
| Artwork invariant across schemes (P18) | `components/pins/__tests__/artworkInvariance.test.tsx` | serialized pin (every tier, locked and unlocked) and avatar output: `dark` is `light` |
| Native and third-party controls themed; default text dark-only (P19) | `components/__tests__/nativeControlsTheme.test.tsx` | Calendar `theme` matches the scheme's tokens; the Calendar remounts (new instance) on a scheme switch |
| Memoized and virtualized consumers repaint (P20) | `theme/__tests__/consumerPatterns.prop.test.tsx` | memo title `color === t.color.textPrimary`; list item `backgroundColor === t.color.surface` after each switch, same instance |
| Pin tier text legible, tier art unchanged (P21) | `screens/profile/__tests__/PinDetailModal.tierText.test.tsx` | `TIER_TEXT.light` equals `TIER_COLOR`; dark lifts only amethyst `#c08ff5` and bronze `#e0965f`; every dark tier text is ≥ 4.5 on its tint |
| Category fills behind white stay legible (P22) | `theme.tokens.test.ts`, `MarkGottenUndoToast.test.tsx` | white on each dark `categoryVisual[k].fill` is ≥ 4.5; the inverse toast stays `#1f1235` with white text in both schemes |
| Appearance control (select and persist) | `screens/__tests__/AppearancePreferenceControl.test.tsx` (+ `.prop`, P4/P5) | three options render; only the chosen chip has `accessibilityState.selected: true`; a press updates the store and persists to AsyncStorage |
| Preference survives session changes (P6) | `state/__tests__/themeStore.test.ts` | preference is unchanged across arbitrary session-token changes |

**Gap:** none of these tests reproduces Android's native "omitted key isn't reset" behaviour; only
a device can. The JS-layer guard is the explicit `borderWidth: 0` asserted above. I confirmed the
device result with the re-captures `12-system-os-light.png` and `13-pinned-dark-to-light.png`.

## Visual verification

**Environment.** I used the existing `emulator-5554` (1080×2400) running Expo Go, signed in as test
account `knicksak2`. Metro was **already running** (`expo start`, PID 37180, started by the user,
not by me), so I left it running and started no long-running process of my own. Its bundle was
stale from mid-retrofit and showed a red-box error ("Property 'StyleSheet' doesn't exist" at
`CrowdCalendarScreen.tsx:363`). The current source is correct, and reconnecting Expo Go to the
running Metro loaded the current tree. At the end I restored Appearance to **Light** (its original
value) and OS night mode to **no**.

**Screens captured** (`.agents/tasks/dark-mode-retrofit/screenshots/`):

| # | Screen | Light | Dark | Dark finding |
| --- | --- | --- | --- | --- |
| 01 | Home | yes | yes | none: themed cards, tiles, wait pills; gold active tab |
| 02 | Explore hub | yes | yes | none: park tiles keep artwork gradients (allowlisted) |
| 03 | Park destination (Magic Kingdom) | yes | yes | none: category badges legible |
| 04 | Experience detail | yes | yes | none: the white "Adventureland" pill is an on-photo overlay, the same in both schemes by design |
| 05 | Trips list | yes | yes | none |
| 06 | Trip detail (active trip) | yes | yes | none |
| 07 | Collection / Vault | yes | yes | none: corkboard and pin art unchanged (artwork); tier chips legible |
| 08 | You & Crew (with Appearance) | yes | yes | none |
| 09 | Notification center | yes | yes | none |
| 11 | Crowd calendar | — | yes | none: calendar themed; crowd-level colours are data marks |
| 12 | System + OS dark, then OS light | yes | yes | **Defect found, then fixed** (below) |
| 13 | Pinned Dark → Light round trip | yes | — | re-capture after the fix: clean |
| 14–16 | Home / Trip Activity after round trips, Trip Activity mounted across an OS toggle | yes | yes | none: emoji, `textDefault` and reaction chips repaint correctly |
| 10 | **Login** | **no** | **no** | **Not captured.** Reaching Login means logging out of the user's test account. I don't have its password, so I couldn't sign back in, and that would have left the emulator signed out. |

**Finding (fixed).** On a live **dark→light** switch, by OS toggle or by pinned Dark→Light, You &
Crew's Shared Items tiles (`Card` with `overflow: 'hidden'`) went fully blank. Every elevated card
also showed rectangular grey halos. Root cause: light `outline.card` was `{}`, so on the switch the
`borderWidth`/`borderColor` keys simply disappeared from the style. React Native's Android view
manager doesn't reset a prop that is merely omitted, so the native hairline-border state from dark
stuck around. Fix in the owning file (`theme/theme.ts`): light `outline.card = { borderWidth: 0 }`.
A zero width draws nothing, so the first light render is unchanged, but it now overwrites the dark
border on every switch. Every `...t.outline.card` spread site (11 sites) sets no `borderWidth` of its
own before the spread, so nothing else is overridden. The one site that spreads before its own
`borderLeftWidth` (`TripScheduleScreen` `parkHoursCardHorizontal`) is unaffected.

**Not a defect, noted.** The Android system navigation bar below the app stays white in dark. It
belongs to the Expo Go window, and theming it needs `expo-system-ui` / `expo-navigation-bar`, a
native dependency that is out of scope (design, External Interfaces). The gray floating gear
button is Expo Go's dev "Tools" button, not app UI.

**Screens to check by hand.** These were not captured: Login, Register, Forgot/Reset Password,
Destination (non-park), Resorts directory, Live waits, Experience detail (Passport lens; restaurant),
Menu, Trip Schedule, Expenses, Balances, Expense form modal, Members, Summary, Reservations,
Planned list, Pin board, Pin showcase, Food lists + detail, Experience lists + detail, Stats + one
detail, Friends list/search/profile, Inbox, Sent shares, Share composer, MagicFab sheet, Date
picker modal. Pay most attention to the switch **dark→light while a screen is mounted**, since that
path exposed the only real defect.

## Knowingly left light (or scheme-invariant)

- **Artwork**: pins and motifs, avatar presets, and destination hero gradients. Scheme-invariant
  by design (Requirement 9.5, Property 18).
- **On-image overlays**: white pills, scrims and watermarks over photos and gradients
  (neutral rgba, rule H). Legible on the image in both schemes.
- **Android system navigation bar**: native, out of scope (see above).
- **Pre-existing light-only contrast gaps**, kept to honour "light unchanged": the light tab badge
  (white on `#d97706`, 3.19) and light white-on-fill for Restaurant (2.02) and Parade (1.64).

## `git status` for `apps/api` / `packages/shared`

```
> git status --short -- apps/api packages/shared
(no output)
```

No `apps/api` or `packages/shared` file changed. Nothing was committed. `verify.log`, `probe.png`
and the emulator's `/sdcard/ui.xml`, all temporary, were deleted.
