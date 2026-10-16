# Dark-mode retrofit, batch B2: Experience detail and live surfaces

B2 converts the 27 Experience-detail and live-data files (the detail screen, its hero, lens switcher, dock, passport and lore lenses, the live cockpit, live-section modules, menu screen and cards, the your-visit controls, and `LiveWaitsScreen`) from module-scope `StyleSheet.create` + `theme` imports to `makeStyles` / `useAppTheme` / `usePalette`. It adds 16 co-located `*.palette.ts` files whose `light` values are the original literals byte-for-byte. Dark values come from the rule 0–7 ladder: tokens by role, `DARK_TONAL` by family and role, and mode-invariant pairs for H-role and photo-overlay surfaces. Dark (a)/(b)/(c) tests went into the 14 owned test files the plan names, plus the (d) live-repaint test in `LiveWaitsScreen.test.tsx`. Per the step brief, I reviewed the snapshot diffs (`%TEMP%\dark-mode-snapshot\B2\` vs working tree) for all 27 owned files and read every palette and new test block. I did not re-run guard, audit, typecheck or Jest. The recorded evidence in `w2-B2-report.md` covers all of them: strict guard 9/9, typecheck exit 0, 31 owned suites / 220 tests, 55 related suites / 380 tests, and audit 26/27 PASS with one justified diff.

Watch for: four places where the coder deliberately departed from the plan or from a literal reading of the rules (ForecastChart `primaryLight`, NoteControl placeholder/Switch, the ParkPassportCard active rating chip, the LiveWaits moderate dot). Each keeps light byte-identical and is reported, but the design should record the rulings. The neutral-T band also sends `#655d78` "muted" copy to `textPrimary`, which flattens hierarchy in several B2 components (confirmed value, UX impact possible). None of this blocks.

**Verdict**: APPROVED

## High-level view

The only structural move is `liveSectionShared`'s private module-scope `STATUS_COLOR`, which read `theme.color` at import and now lives inside `StatusBadge`'s render. No exported name, signature or prop changed, and no palette is destructured. I re-derived the HSL family for the unlisted literals (`#faf8ff`, `#e9e4f5`, `#f6f2fa`, `#e2d9f3`, `#f0eaf7`, the VQ sky/blue set and others), and found no misassigned family or role. The one non-obvious call: the `#190c2d`/`#371756`/`#581c87` literals the high-frequency table lists as "H-role violet" are used as text on cards here, so they go to `violet.fg`. Reading them as H would leave near-black text on the dark surface. This matches B1.

The one list site, `LiveWaitsScreen`, has `styles, t, waitStatus` in `renderItem`'s deps and `extraData={t.scheme}`. The (d) test pins this with a same-instance light→dark repaint. No other B2 file has a memo, ref or list that reads colour.

The deviations are all on the side of light parity or legibility. ForecastChart and WaitInsights bars keep `primaryLight`, which is the design-correct call: rule 1a sends only `primary`/`primaryDark` data marks to `primaryFg`, and switching would change light from `#7e57c2` to `#5b2a86`. The plan's instruction was wrong there. NoteControl's `placeholderTextColor` is applied only in dark, because the original had none and an unconditional `textSecondary` would change light. Its `Switch` has no literals, so there is no pair to make. The passport's active rating chip uses `amber.fill` instead of the rule-1 `starRating` dark `#f6c343`, which would be about 1.6:1 under white text.

<details>
<summary>Issues (5)</summary>

1. **Rule-1 gap: `starRating` as a fill behind white** — `ParkPassportCard` `pickerActiveBg` uses `DARK_TONAL.amber.fill` by analogy with rule 4. A literal rule-1 reading gives an illegible ~1.6:1. The integrator should add `starRating` to rule 4's status-fill list (or note the ruling) so other batches resolve it the same way. Non-blocking.
2. **Plan/design conflict on chart bars** — w2-plan says ForecastChart bars use `primaryFg`, but the source reads `primaryLight`, which rule 1a leaves in place. The coder followed the design. Correct the plan text so the integrator and later reviewers don't flag it. Non-blocking.
3. **Neutral-T band flattens muted copy** — `#655d78` (L 0.1195, just under 0.12) maps to `textPrimary`. In dark, LensSwitcher's inactive label (`#f3eefc`) is brighter than the active `primaryFg` label, and the cockpit chip, lore and dining "muted" labels lose their secondary weight. This is rule-compliant and matches B1. Raise it as a design question for the screenshot pass. Non-blocking, possible UX impact.
4. **NoteControl `Switch` left on platform defaults** — the plan asked for a palette pair, but there are no literals to convert, and adding colours would change light. Confirm on the dark screenshots that the iOS/Android default track reads acceptably on `surface`. Non-blocking.
5. **LiveWaits moderate dot changes hue in dark while the rest of the scale is invariant** — `#f59e0b` → `t.color.starRating` (dark `#f6c343`) by rule-1 first-match, while low/high/down are V-invariant. Rule-correct and still distinct, but the scale is no longer fully mode-invariant. Accept, or move it into `WAIT_STATUS` if the integrator wants an invariant scale. Non-blocking.

</details>

<details>
<summary>Details</summary>

### Deliberate departures that keep light byte-identical

ForecastChart `barDefault` and WaitInsights `sparkBar` read `theme.color.primaryLight` before and `t.color.primaryLight` after. Rule 1a only redirects `primary`/`primaryDark` used as a data mark to `primaryFg`. `primaryLight` on a surface is its natural role (rule 1's `#7e57c2` bullet), and the dark value `#b28dff` is 6.80:1 on `surface`. The plan's "`ForecastChart` bars use `primaryFg`" conflicts with both the source and the design, and the coder correctly let the design win and reported it (confirmed). Where the source literal really was `#5b2a86` (LiveWaitCockpit `sparkBarActive`), it became `primaryFg`, consistent with the data-mark reading.

NoteControl's `TextInput` originally had no `placeholderTextColor`. The design's blanket "`placeholderTextColor={t.color.textSecondary}`" would move light from the platform placeholder grey to `#6b6480`, a light regression. So the code uses `t.scheme === 'dark' ? t.color.textSecondary : undefined`. The test asserts `undefined` under light and dark `textSecondary` under dark, and the audit shows the single `#6b6480` +1 this produces (confirmed). CompletionControls already had `placeholderTextColor={theme.color.textSecondary}`, so it gets the straight conversion plus `keyboardAppearance`.

The ParkPassportCard active rating chip (`#f59e0b` fill, white text, `#d97706` border) is the one call that goes against a literal reading of rule 1. `#f59e0b` matches `starRating`, and rule 1 lists hue tokens "as text, icon, fill or border". Only `success`/`danger`/`warning` are redirected to rule 4 when they are fills behind white. Taken literally, dark gets `#f6c343` with white text at about 1.6:1. The coder used `DARK_TONAL.amber.fill` (white 5.43:1) and `orange.border`, with a test (confirmed). The outcome is right, but the design should record it so B3–B7 don't resolve the same pattern differently.

### Status scales and invariant surfaces

`LiveWaitsScreen`'s status dot scale keeps low `#22c55e`, high `#ef4444` and down `#8e889b` invariant as a V-role data scale with no text on it. The moderate step `#f59e0b` matched `starRating` first, so in dark it shifts to `#f6c343` (confirmed). That is legitimate first-match behaviour, but it makes the scale partially scheme-dependent. If an invariant scale is the intent, the moderate step belongs in `WAIT_STATUS`.

LiveWaitCockpit's closed standby instrument `#1e293b` (L ≈ 0.02) is H and invariant. The status copy on both instruments (`#bbf7d0`, `#94a3b8`) stays invariant because those fills are always dark, while the operating fill itself moves `#1b864d` → `green.fill`. So `standbyOperatingStatus` is an invariant text value on a scheme-dependent fill. It is outside the literal wording of rule 3 H, which covers the surface, not the text on it. This is not listed as an issue: the coder reported it as a judgement call.

### Neutral-band hierarchy flattening

`#655d78` has relative luminance 0.1195, so the closed neutral-T band sends it to `textPrimary`. In B2 that literal is the "muted/inactive" colour in LensSwitcher (inactive icon and label), the LiveWaitCockpit chips and stat labels, the PassportAndLoreLens muted labels, DiningReservationCard `statusSub`, and the passport tip-close glyph. In dark these render at `#f3eefc`, the same weight as body copy. In LensSwitcher the inactive label is even brighter than the active `primaryFg` `#c4a3ff` label, although the active segment still stands out by its `surface` background against the `surfaceAlt` track (confirmed by reading the palettes). This is the design's rule applied correctly, and B1 does the same. It is a design-level question for the W3 screenshot review, not a B2 defect.

### Tests

All 14 test files the plan names now have a `describe('dark mode')` block with `afterEach(resetTestScheme)`. Each asserts dark values taken from `darkTheme` or the palette's `.dark` export, and most pair it with a light-parity case using the original hex. Each of these assertions would fail if its element stayed light. The required (a)/(b)/(c) triples exist for ExperienceDetailScreen (with the Property 22 fill-vs-tint check and the white glyph), MenuScreen and LiveWaitsScreen. `MenuScreen.backControlAndTheme.test.tsx` changed its `ScreenContainer` mock to delegate to the real component so (a) can see the root background. The existing composition assertions still pass on the recorded run.

Not tested by a render test: `QuickSpecsRow`, `LiveStatusStrip`, `LiveWaitCockpit`, `live/DiningSection`, `live/ForecastChart`, `live/liveSectionShared`, `live/RideLiveSection`, `live/ShowtimesSection`. These are covered only by the strict guard, the audit and screenshots, as the plan allows. LiveWaitCockpit is the largest of these, with about 50 palette keys and no dark assertion. `LensSwitcher`, `PassportAndLoreLens`, `VisitHistoryTimeline`, `CompletionControls` and `RatingControl` are asserted indirectly through parent tests.

</details>

<details>
<summary>File map</summary>

- `screens/catalog/ExperienceDetailScreen.tsx` + `.palette.ts` (`HERO`): `makeStyles` across 3 components, hero placeholder `tint→fill`, hero shadow/scrim/land-pill pairs, rating pill → `accent`/`textOnAccent`.
- `screens/catalog/LiveWaitCockpit.tsx` + `.palette.ts` (`COCKPIT`): about 50 literals → violet/green/red tonal, standby H invariants, active spark bar → `primaryFg`.
- `screens/catalog/ParkPassportCard.tsx` + `.palette.ts` (`PASSPORT`): amber/orange passport ink and surfaces, white veils → `withAlpha(surface)`, active chip → `amber.fill`, `textDefault` on emoji and hidden texts.
- `screens/catalog/PassportAndLoreLens.tsx` + `.palette.ts` (`LORE`): violet/amber lore surfaces and ink.
- `screens/catalog/FloatingActionDock.tsx` + `.palette.ts` (`DOCK`): dock veil → `withAlpha(surface, 0.95)`, primary fill → `primary`, secondary pill tonal.
- `screens/catalog/ShowtimesCard.tsx`, `DiningReservationCard.tsx`, `VirtualQueueBanner.tsx`, `WaitInsightsSection.tsx`, `LensSwitcher.tsx`, `LiveStatusStrip.tsx`, `QuickSpecsRow.tsx`, `FavoriteToggle.tsx` + their palettes: card and badge literals → tonal pairs, F fills, shadow pairs.
- `screens/catalog/CompletionControls.tsx` + `.palette.ts` (`SCRIM`): textPrimary-rgba scrim pair, `keyboardAppearance`, modal `outline.card`.
- `screens/catalog/NoteControl.tsx`: dark-only `placeholderTextColor`, `keyboardAppearance`.
- `screens/catalog/AboutSection.tsx`, `MenuSummaryCard.tsx`, `YourVisitCard.tsx`, `VisitHistoryTimeline.tsx`, `RatingControl.tsx`, `MenuScreen.tsx` (+ `MENU_ITEM`): token-read conversions (`primary` text/spinner → `primaryFg`).
- `screens/catalog/live/{DiningSection,ForecastChart,liveSectionShared,RideLiveSection,ShowtimesSection}.tsx`: `makeStyles`. `STATUS_COLOR` moved into the render.
- `screens/liveWaits/LiveWaitsScreen.tsx` + `.palette.ts` (`WAIT_STATUS`, `LIVE_WAITS`): `renderItem` deps, `extraData={t.scheme}`, crowd card and LL text tonal.
- Tests: dark blocks in the 14 owned test files listed in w2-plan B2 "Dark tests".

Full diff: `git diff --no-index -- "%TEMP%\dark-mode-snapshot\B2\<rel>" "apps/mobile/src/<rel>"` per owned file. New palettes are untracked files beside each source.

</details>
