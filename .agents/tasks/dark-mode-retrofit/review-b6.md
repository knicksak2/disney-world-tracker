# Dark-mode retrofit, batch B6: Home, Vault, pins UI, social

B6 converts 16 screens in Home, Vault (Collection), the pin board/showcase/celebration/detail UI, the share screens and the notification center from the static `theme` import to `makeStyles`/`useAppTheme`/`usePalette`. It adds 11 co-located `*.palette.ts` files and the rule-7 `profile/tierText.palette.ts`. Non-token literals go to palettes by family and role. `primary` reads used as text, icon, link or data mark become `primaryFg`. Corkboard wood, showcase frame and confetti become mode-invariant artwork pairs. The four tier `Badge color` sites read `usePalette(TIER_TEXT)[tier]`, and the three tier dot/fill sites keep `TIER_COLOR`. Pin artwork is not touched: `pinTierMeta.ts`, `PinView.tsx` and `components/pins/**` have no B6 edits, and no `PinView` prop changed in any owned file. The new Property 21 test pins both the text split and art invariance.

Watch for: the ShareComposer unselected-recipient icon now uses the same dark colour as the selected icon (`#c4a3ff`), so selection is shown only by glyph shape and the card stripe (confirmed, non-blocking). The ParkWaitPulse active-park ring drops to a faint `#2e5150` with no glow, about as visible as an inactive pill's border (confirmed, non-blocking; the coder flagged it). C5/C6 evidence comes from a scoped TS-API check and a related-tests run in which 10 suites failed to load on other batches' in-flight files, so the full gate still has to pass at integration (confirmed, non-blocking).

**Verdict**: APPROVED

## High-level view

The rule-7 split is exact. `tierText.palette.ts` matches the design byte for byte: light is `TIER_COLOR` itself, and dark is `TIER_COLOR` with only amethyst `#c08ff5` and bronze `#e0965f` lifted. All four text sites the design names (`PinCelebrationModal`, `PinDetailModal`, `PinShowcaseScreen`, `CollectionScreen` "Badges in Reach") use the palette. The snapshot's other `TIER_COLOR` reads are the `CollectionScreen` tier dot and in-reach progress fill and the `PinBoardScreen` summary dot. They're fills and stay on `TIER_COLOR`. No other tier-as-text site existed before the batch.

Pin art is untouched. Every `PinView` line in the owned files is byte-identical to the snapshot. Embedded art in UI files (corkboard frame and header, showcase wood frame, confetti hues) is wrapped in `// artwork — mode-invariant` pairs whose dark values equal light. Property 21 renders `PinDetailModal` under both schemes for every tier and asserts that the `pin-detail-art` host subtree is deep-equal, non-empty and carries hex art colours.

Light parity rests on the coder's multiset audit. Every DIFF row swaps in a value that's identical in light: park literals → `parkAccent`, `TIER_COLOR` → `TIER_TEXT`, and an unreachable `starRating ?? '#f59e0b'` fallback was dropped. Parks outside the four `ACCENTED_PARKS` still fall back to the primary hue.

Applying the conversion rules mechanically leaves two dark-only visual problems. Both follow the letter of rules 1a/3 but go against what the light design means. The ShareComposer unselected ring was a `borderStrong` token read used as an icon. Rule 1a turns that into violet role T, which is `DARK_TONAL.violet.fg` = `#c4a3ff`, the same as `primaryFg`, so the muted-vs-emphasised pair collapses. The ParkWaitPulse active ring `#22c55e` maps by role B to `green.border`, and its glow goes to `#000000`.

Verification evidence is present but partial. The strict guard is 9/9. The audit lists every DIFF with its rule. The owned jest files pass 146/146. Root typecheck was blocked by B7's `ChangePasswordControl.tsx` syntax error, so the coder ran the TS API over all 68 B6 files and got 0 diagnostics. That proves B6 compiles but not the whole program.

<details>
<summary>Issues (4)</summary>

1. **ShareComposer selected/unselected icon collision**: in dark, `SHARE_COMPOSER.dark.unselectedIcon` (`DARK_TONAL.violet.fg`) and the selected `t.color.primaryFg` are both `#c4a3ff`. Raise it at the screenshot/integration step. Choose a muted dark value (for example `darkColor.textSecondary` or `borderStrong`) as a recorded design exception, then add a dark assertion, since the screen has no render test.
2. **ParkWaitPulse active ring nearly invisible in dark**: `activeBorder` → `green.border` `#2e5150` (2px) with `activeShadow` `#000000` is barely stronger than the inactive `violet.border` `#584678`. Confirm with a screenshot. If confirmed, treat the state ring as role T (`green.fg`) by design exception.
3. **Typecheck/related-tests evidence is scoped**: C5 used a TS-API check of B6 files only, and C6 had 10 suites that couldn't load on B4/B5/B7 in-flight files (navigation, friends, notificationNavigation). Integration must run the full `npm run verify` before the batch counts as done.
4. **Share/Attribution dark values untested**: `InboxScreen`, `SentSharesScreen`, `ShareComposerScreen` and `AttributionScreen` have no dark render assertions (the plan accepts this). Issue 1 is exactly the kind of defect this gap lets through, so screenshots for these screens matter.

</details>

<details>
<summary>Details</summary>

### ShareComposer recipient ring loses its muted state

```tsx
color={isSelected ? t.color.primaryFg : pal.unselectedIcon}
// SHARE_COMPOSER: light '#cdbce6' (borderStrong), dark DARK_TONAL.violet.fg
```

In light, the unselected `ellipse-outline` is a pale `#cdbce6` and the selected `checkmark-circle` is a strong `#5b2a86`. In dark, both are `#c4a3ff` (`DARK_TONAL.violet.fg === darkColor.primaryFg`). The rule chain is followed correctly: `borderStrong` isn't in its natural role as an icon, so rule 1a treats it as the literal `#cdbce6`. That literal has saturation 0.46, isn't on the lavender-subtle list, falls in the violet hue band, and role T gives `violet.fg`. But the result inverts the light intent. An unselected recipient looks as emphatic as a selected one, and only the glyph, the `accentColor` stripe and `friendRowSelected` tell them apart. Selection isn't colour-only, so this isn't an accessibility failure. It is a visible "this isn't right" defect of the kind the user complained about, and no test can catch it because `ShareComposerScreen` has no render test. (confirmed)

### ParkWaitPulse active-park ring

In light, the active pill gets a 2px `#22c55e` ring and a green glow. In dark, role B gives `green.border` `#2e5150` (relative luminance ≈ 0.07), and rule 0 turns the glow into `#000000`. The inactive pill border is `violet.border` `#584678` (≈ 0.08). So the active pill differs from its neighbours mostly by ring width and a faint hue shift, and the glow that made it stand out is gone. The accessibility label still says ", active park". The coder listed this as a screenshot candidate. That's the right next step, but if it's confirmed, the fix is a design-level exception, because the deterministic rule produced this value. (confirmed)

### Verification evidence gaps

The full root `npm run typecheck` couldn't run because of B7's `ChangePasswordControl.tsx(290,3) TS1005`, which makes tsc skip semantic checking program-wide. The substitute TS-API run reports syntactic and semantic diagnostics for the 68 B6 files only. B6 changes no exported names or props, so the risk is low. The related-tests sweep shows `10 failed, 30 passed` suites with `240/240` tests passing. All 10 failures are load errors in other batches' files, so the suites that reach `YouAndCrewScreen`/`ProfileScreen` (navigation, friends, notificationNavigation) never ran against B6's changes. Both gaps close only when the integration step runs the full gate. (confirmed)

### Test coverage

Property 21 is solid. Two assertions are fast-check over `PIN_TIERS` with 100 runs each: the legibility ratio on the 14% tint over `surface`/`surfaceAlt`/`background`, and the rendered Badge colour light vs dark. There are also two discriminating checks. One shows the dark amethyst/bronze differ from `TIER_COLOR`. The other shows the Badge tint follows the lifted colour (`withAlpha(TIER_TEXT.dark.amethyst, 0.14)`). The Vault rule-7 test uses `PINS[2]`, which is bronze, so it discriminates. Celebration and Showcase use amethyst. NotificationCenter's (d) test goes from light `#1f1235` to dark without a remount, so it would fail if `styles` were missing from the `renderRow` deps or from `extraData`. PinBoard's ready-badge repaint test guards the memoised `PinCell`.

Not tested: dark values in `InboxScreen`, `SentSharesScreen`, `ShareComposerScreen` and `AttributionScreen`. `ActionDock`, `HomeFavoritesSection`, `ParkWaitPulse` and `UpcomingTripHero` are covered only through `HomeScreen.render`, and nothing asserts the `ParkWaitPulse` active ring.

</details>

<details>
<summary>File map</summary>

- `screens/profile/tierText.palette.ts`: new `TIER_TEXT` (rule 7), exactly as in the design.
- `screens/profile/PinDetailModal.tsx` (+ `.palette.ts`): tier Badge → `TIER_TEXT`; track Badge, unlocked text and progress fill → `primaryFg`; scrim as an H pair.
- `screens/profile/PinCelebrationModal.tsx` (+ `.palette.ts`): tier Badge → `TIER_TEXT`; module-scope `CONFETTI_COLORS` → render-time index lookup; dark `outline.card`; scrim pair.
- `screens/profile/PinShowcaseScreen.tsx` (+ `.palette.ts`): tier Badge → `TIER_TEXT`; wood frame artwork pair; white veils → `withAlpha(surface, a)`; gold tints → amber S; `keyboardAppearance`; list `extraData`/deps.
- `screens/profile/PinBoardScreen.tsx` (+ `.palette.ts`): `primaryFg` for text and the ring; tier dot keeps `TIER_COLOR`; `extraData`; `PinCell` calls `useStyles`.
- `screens/profile/AttributionScreen.tsx`: mechanical `makeStyles` conversion.
- `screens/collection/CollectionScreen.tsx` (+ `.palette.ts`): in-reach tier Badge → `TIER_TEXT`; dot and fill keep `TIER_COLOR`; `PARK_META` → render-time with MK `parkAccent`; corkboard artwork pairs; food/stats/claim palettes.
- `screens/home/{HomeScreen, ActionDock, ExplorationPromptCard, HomeFavoritesSection, ParkWaitPulse, UpcomingTripHero}.tsx` (+ 5 palettes): park maps → `parkAccent`; status/trend badges → tonal palettes; non-black shadows → `#000000` in dark.
- `screens/share/{InboxScreen, SentSharesScreen, ShareComposerScreen}.tsx` (+ ShareComposer palette): `primaryFg`; `extraData`; unselected icon palette.
- `screens/notifications/NotificationCenterScreen.tsx`: `makeStyles`; `renderRow` deps; `extraData`.
- Tests: dark cases in the 7 owned test files, plus the new `profile/__tests__/PinDetailModal.tierText.test.tsx`.

Full diff: `git diff --no-index "$env:TEMP\dark-mode-snapshot\B6\<file>" apps/mobile/src/<file>` per file (uncommitted; the snapshot is the pre-batch baseline).

</details>
