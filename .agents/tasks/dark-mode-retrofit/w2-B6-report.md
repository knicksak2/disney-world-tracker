# W2 batch B6 report — Home, Vault, pins UI, social (spec 9.6)

Converted from scratch (no `review-b6.json` existed). Snapshot taken once, before any edit, at
`$env:TEMP\dark-mode-snapshot\B6\` (16 files). It is **kept** for the reviewer / fix loop per the
plan's snapshot-lifetime rule; the integrate step deletes it after APPROVED. Nothing was committed.

## Files

Converted (16): `screens/home/{ActionDock, ExplorationPromptCard, HomeFavoritesSection, HomeScreen,
ParkWaitPulse, UpcomingTripHero}.tsx`, `screens/collection/CollectionScreen.tsx`,
`screens/profile/{AttributionScreen, PinBoardScreen, PinCelebrationModal, PinDetailModal,
PinShowcaseScreen}.tsx`, `screens/share/{InboxScreen, SentSharesScreen, ShareComposerScreen}.tsx`,
`screens/notifications/NotificationCenterScreen.tsx`.

New palettes (12): `home/{ActionDock, ExplorationPromptCard, HomeFavoritesSection, ParkWaitPulse,
UpcomingTripHero}.palette.ts`, `collection/CollectionScreen.palette.ts`,
`profile/{PinBoardScreen, PinCelebrationModal, PinDetailModal, PinShowcaseScreen}.palette.ts`,
`share/ShareComposerScreen.palette.ts`, and `profile/tierText.palette.ts` (rule 7, exactly as the
design: `TIER_TEXT = definePalette({ light: TIER_COLOR, dark: { ...TIER_COLOR, amethyst: '#c08ff5', bronze: '#e0965f' } })`).
`pinTierMeta.ts`, `PinView.tsx` and `components/pins/**` untouched.

Tests: dark cases added to the 7 owned test files; new
`profile/__tests__/PinDetailModal.tierText.test.tsx` (Property 21).

## C4 — strict guard

```
$env:THEME_GUARD_STRICT='B6'; npx jest src/__tests__/themeRetrofit.guard.test.ts
PASS src/__tests__/themeRetrofit.guard.test.ts
Tests:       9 passed, 9 total
```

## C5 — typecheck (owned files)

`npm run typecheck --workspace apps/mobile` currently reports only
`src/screens/ChangePasswordControl.tsx(290,3): error TS1005` (B7, in flight). Because tsc skips
semantic checking while any syntax error exists, I also ran the TS API (stdin `node -`, no file
written) for syntactic + semantic diagnostics on every B6 source/test/palette file:
`B6 files checked: 68; diagnostics: 0`.

## C6 — related-tests sweep

`npx jest --findRelatedTests <16 files + tierText.palette.ts>`:
`Test Suites: 10 failed, 30 passed, 40 total` / `Tests: 240 passed, 240 total`. All 10 failed
suites are "failed to run" on **another batch's in-flight file**:
`SyntaxError: src/screens/ChangePasswordControl.tsx` (B7), reached through
`YouAndCrewScreen`/`ProfileScreen` (navigation, friends, notificationNavigation suites). An earlier
run also hit `ExpenseFormModal.tsx` (B4) and `TripDetailScreen.tsx` "StyleSheet is not defined" (B5)
transiently. No test that loaded failed. Stop-and-report: not edited.

## C7 — light-colour multiset audit

```
PASS screens/home/ActionDock.tsx (12)            PASS screens/home/ExplorationPromptCard.tsx (11)
DIFF screens/home/HomeFavoritesSection.tsx       DIFF screens/home/HomeScreen.tsx
DIFF screens/home/ParkWaitPulse.tsx              PASS screens/home/UpcomingTripHero.tsx (10)
DIFF screens/collection/CollectionScreen.tsx     PASS screens/profile/AttributionScreen.tsx (3)
PASS screens/profile/PinBoardScreen.tsx (13)     DIFF screens/profile/PinCelebrationModal.tsx
DIFF screens/profile/PinDetailModal.tsx          DIFF screens/profile/PinShowcaseScreen.tsx
PASS screens/share/InboxScreen.tsx (19)          PASS screens/share/SentSharesScreen.tsx (11)
PASS screens/share/ShareComposerScreen.tsx (12)  PASS screens/notifications/NotificationCenterScreen.tsx (9)
```

No `UNRESOLVED` notes. Every difference, with its rule:

| File | Difference | Justification |
| --- | --- | --- |
| HomeFavoritesSection | `-#7e57c2 -#2f80ed -#e8505b(1) -#3fa34d`, `+parkAccent[*]` | Rule 1 park hue used for a park: the module `PARK_COLORS` map (MK/EPCOT/HS/AK, each equal to the light `parkAccent`) became one `t.parkAccent[park]` read. An `ACCENTED_PARKS` set keeps the old 4-park scope, so other parks still fall back to primary (light unchanged). The 2 remaining `#e8505b` are the heart icons (palette). |
| ParkWaitPulse | same 4 park literals → `parkAccent[*]` | Rule 1, as above. |
| HomeScreen | `#f59e0b` 2 → 1 | `theme.color.starRating ?? '#f59e0b'` → `t.color.starRating`. The literal equals the token (rule 1) and the `??` fallback was unreachable (token always defined). Same light value. |
| CollectionScreen | `-#7e57c2`, `+parkAccent[*]` | Rule 1: `PARK_META` Magic Kingdom park hue → `t.parkAccent['Magic Kingdom']` (light `#7e57c2`). Other three park-bar colours (`#0288d1 #e53935 #2e7d32`) aren't park-accent values → rule-3 palette, counted unchanged. |
| CollectionScreen | `TIER_COLOR[*]` 3 → 2, `+TIER_TEXT[*]` | Rule 7: the "Badges in Reach" tier `Badge color`. Tier dot (`:614`) and progress fill (`:681`) keep `TIER_COLOR`. |
| PinCelebrationModal, PinDetailModal, PinShowcaseScreen | `TIER_COLOR[*] → TIER_TEXT[*]` | Rule 7: the tier `Badge color` site in each. |

`git diff --no-index` read for all 16 files; changes are the conversions above plus hook calls,
`extraData`, and memo deps.

## DoD 4 — memo / list / React.memo sites

- `PinBoardScreen`: `FlatList` gets `extraData={t.scheme}` (`ListHeaderComponent` reads parent
  `styles`). `renderPinCell` reads no styles (unchanged deps). `React.memo` `PinCell` now calls
  `useStyles()` itself.
- `PinShowcaseScreen`: `renderUnplacedPin` deps += `styles, t, tierUi`; modal `FlatList`
  `extraData={t.scheme}`. `PlacedPinItem`/`TrayPinItem` call `useStyles()`. `useRef`s hold only
  `Animated` values / drag state, no colour.
- `PinCelebrationModal`: module-scope `CONFETTI_COLORS` (2 theme reads + 3 literals) removed; the
  seeded spec stores `colorIndex`, and `ConfettiParticle` resolves the hue at render
  (`[t.color.primary, t.color.accent, CONFETTI.gold/teal/pink]`). The 4 `interpolate` calls carry
  no colours.
- `NotificationCenterScreen`: `renderRow` deps += `styles`; `FlatList extraData={t.scheme}`.
- `ShareComposerScreen`: `renderRow` deps += `styles, t, pal`; `FlatList extraData={t.scheme}`.
- `InboxScreen`, `SentSharesScreen`: `FlatList extraData={t.scheme}` (header/empty components read
  `styles`); `renderRow` renders a row component with its own hooks (no dep change).
- `HomeScreen`: `useCallback`s/`useMemo`s read no styles/colours; `LeaderboardRow` calls `useStyles()`.
- `CollectionScreen`: `useMemo`s read no colours; `PARK_META` moved into render as `parkMeta`.

## Default text (`...t.textDefault`) placements

Emoji `Text`s with no colour on themed backgrounds: `ActionDock.emojiIcon` (on a DARK_TONAL tint),
`ParkWaitPulse.icon`, `HomeScreen.sectionIcon`, `CollectionScreen.claimBannerMedal` (amber tint),
`CollectionScreen.iconicTreatEmoji` (surfaceAlt). Exclusions: the invisible test-anchor
`<Text>{n} to claim</Text>` (opacity 0); every other `Text` already sets a colour. TextInputs:
both `PinShowcaseScreen` inputs already set `color: textPrimary`; added
`keyboardAppearance={t.scheme}` (placeholder already `textSecondary`).

## DoD 8

- Rule-2a non-token suffix site: `HomeFavoritesSection` `parkColor + '18'` where `parkColor` is
  `t.parkAccent[park]` or `t.color.primaryFg` — both `#rrggbb` in both schemes (Property 7). No
  palette value is ever suffixed.
- No `PrimaryButton` or active `Chip` rendered directly on `surfaceAlt` in B6 files (Chips sit on
  the screen background / modal surface).

## Rule-1a / role decisions worth review

- `primary` as text/icon/border/data mark → `primaryFg`: links, `ActivityIndicator`/`RefreshControl`
  tints, `summaryPct`, progress fills, `readyRing` border, Card `accentColor` stripes (Inbox read
  rows, ShareComposer selected row), track Badge in PinDetailModal.
- `primaryDark` text on gold (`canvasEmptyBtnText`) → `textOnAccent` (same light value).
- `ShareComposerScreen` unselected-recipient icon read `theme.color.borderStrong` (a border token
  as an icon) → rule 3 violet T → `SHARE_COMPOSER.unselectedIcon` (dark `DARK_TONAL.violet.fg`).
- `#7e57c2` gradient stop behind the gold sparkle (ExplorationPromptCard) → violet fill pair; the
  `#5b2a86` stop → `primary`.
- Corkboard wood frames (Collection + Showcase) and confetti hues → `// artwork — mode-invariant`
  pairs. Pin modal scrims `rgba(10,7,20,a)` → H-role mode-invariant pairs.
- `PinShowcaseScreen` `rgba(255,255,255,a)` veils on the themed tray/modal → `withAlpha(t.color.surface, a)` (rule 5).
- Screenshot candidates: `ParkWaitPulse` active-park ring is `#22c55e` as B → `green.border`
  (`#2e5150`), which is faint on the dark surface; the deterministic rule gives this value.

## Converted files without their own render test

`ActionDock`, `HomeFavoritesSection`, `ParkWaitPulse`, `UpcomingTripHero` — covered by dark
assertions in `HomeScreen.render.test.tsx`. `AttributionScreen`, `InboxScreen`, `SentSharesScreen`,
`ShareComposerScreen` — guard + audit + screenshots only.

## Behavior → test map

| Behavior | Test → assertion |
| --- | --- |
| Home root/text/sections dark | `HomeScreen.render` "(a)(b)(c)": ScreenContainer bg = `darkTheme.color.background`; section title = `textPrimary`; hero title `textOnPrimary`; greeting `accent`; "See All" `primaryFg`; dock tile border/shadow = `ACTION_DOCK.dark.*`; pins badge = `ACTION_DOCK.dark.badgeBg`; pulse pill border = `PARK_WAIT_PULSE.dark.pillBorder`; AK name = `darkTheme.parkAccent['Animal Kingdom']`; upcoming card border/countdown = `UPCOMING_TRIP_HERO.dark.*`, tag `primaryLight` |
| Favorite pill status palette | `HomeScreen.render` "favorite pill…": border = `HOME_FAVORITES.dark.pillBorder`, top border = dark MK `parkAccent`, wait text = `HOME_FAVORITES.dark.moderateText` |
| Home light parity | `HomeScreen.render` "keeps … light": `#f5f2fb`, `#ffffff`, `#f6c343`, `#eee6f7`, `#5b2a86`, `#ef4444`, `#3fa34d`, `#7e57c2` |
| ExplorationPromptCard (c) | `ExplorationPromptCard.test` dark: border = `EXPLORATION_PROMPT.dark.cardBorder`, tag = `primaryLight`; light: `#ebdff8`, `#7e57c2` |
| Vault root/text/segments/banner | `CollectionScreen.test` "(a)(b)(c)": root bg `background`; heading `textPrimary`; seg track = `COLLECTION.dark.segTrackBg`; active seg `surface`; seg badge `COLLECTION.dark.segBadgeBg`; claim banner bg/border; cork frame = `CORKBOARD.light.frameBg` (invariant) |
| Rule 7 in Vault | `CollectionScreen.test`: in-reach tier Badge text = `TIER_TEXT.dark[tier]`; light = `TIER_COLOR[tier]` |
| Park stats bars | `CollectionScreen.test`: MK name = dark `parkAccent`, EPCOT = `COLLECTION.dark.parkEpcot`; light `#7e57c2` / `#0288d1` |
| Notification center dark | `NotificationCenterScreen.test` "(a)(b)(c)": root `background`; group header `textPrimary`; failure banner `warningSurface`/`warning`/`warningText` |
| (d) live repaint of list row | `NotificationCenterScreen.test` "(d)": group header `#1f1235` → after `setTestScheme('dark')`, no remount, `textPrimary` (fails if `styles` is missing from `renderRow` deps or `extraData`) |
| Pin board dark + tier dot art | `PinBoardScreen.test` dark: root `background`; "Tier" label `textPrimary`; overall % `primaryFg`; ready badge `primary` + `textOnPrimary`; tier dot = `TIER_COLOR.bronze` |
| Memoized PinCell repaints | `PinBoardScreen.test`: ready badge `#5b2a86` → `darkTheme.color.primary` without remount |
| Celebration modal | `PinCelebrationModal.test` dark: sheet `surface` + border `border`; backdrop = `PIN_CELEBRATION.dark.backdrop`; heading `textPrimary`; amethyst Badge = `TIER_TEXT.dark.amethyst`; confetti 0 = dark `primary`, 2 = `CONFETTI.dark.gold`; light: `#ffffff`, no borderWidth, `TIER_COLOR.amethyst`, confetti `#5b2a86`/`#f6c343` |
| Showcase | `PinShowcaseScreen.test` dark: root `background`; tray `surface`; "Unplaced Pins" `textPrimary`; frame = `SHOWCASE_FRAME.light.bg`; remove badge `surface`; sort btn = `withAlpha(surface, 0.06)`; active search = `PIN_SHOWCASE.dark.trayActionActiveBg`; input `keyboardAppearance 'dark'`, placeholder `textSecondary`; modal `surface`; card amethyst Badge `TIER_TEXT.dark`; light parity values |
| Property 21 | `PinDetailModal.tierText.test` (fast-check, 100 runs): `TIER_TEXT.light` = `TIER_COLOR`, dark = TIER_COLOR+lifts = `TIER_TEXT_DARK`; ≥4.5:1 on 14% tint over surface/surfaceAlt/background; Badge text dark = `TIER_TEXT.dark[tier]`, light = `TIER_COLOR[tier]`; PinView host subtree identical (non-empty, contains hex) across schemes; Badge tint = `withAlpha(TIER_TEXT.dark.amethyst, 0.14)` |

Not asserted by a test: `AttributionScreen`, `InboxScreen`, `SentSharesScreen`, `ShareComposerScreen`
dark values (no owned render test; guard + audit only).

## Tests run (file level)

`npx jest` on the 8 owned test files: `Test Suites: 8 passed, 8 total` / `Tests: 146 passed, 146 total`.
