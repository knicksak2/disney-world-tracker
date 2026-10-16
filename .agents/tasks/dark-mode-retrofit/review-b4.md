# Dark-mode retrofit, batch B4: trip money and schedule

B4 moves the seven trip money and schedule files (`TripScheduleScreen`, `TripExpensesScreen`, `ExpenseFormModal`, `TripBalancesScreen`, `SettlementModal`, `RefundModal`, `ReceiptReviewModal`) off the static `theme` import and onto `makeStyles`/`useAppTheme`/`usePalette`. It adds seven co-located `*.palette.ts` files. About 1,000 colour sites go through rules 0–7. Non-token slate, violet and status literals become family/role palette pairs, `primary` reads used as text, icon or border become `primaryFg`, white text on fills becomes `textOnPrimary`, and non-black shadows go to `#000000` in dark. Two file-private colour helpers (`getCategoryMeta`, `getAvatarColor`) now take the theme as a parameter. The snapshot diff contains only colour/style edits and the mechanical changes they need. The pre-existing unrelated uncommitted work in these files is untouched, and so are the exported schedule helpers `getParkHoursDetails`/`getTodayWDW`.

Watch for: several selected-vs-unselected states lose or invert their emphasis in dark because the deterministic rules merge or flip the light distinction. The Expenses tab switcher's idle label (`textPrimary` `#f3eefc`) is brighter than the active one (`primaryFg` `#c4a3ff`). The tiered-split count pill's active and idle styles map to identical dark values. The alcohol `Switch`'s on-track is nearly the same colour as its off-track (confirmed values, likely visible; non-blocking, screenshot pass). Typecheck evidence is scoped: root `tsc` is blocked by B7's syntax error, so the integrator's full `npm run verify` is still owed (confirmed, non-blocking).

**Verdict**: APPROVED

## High-level view

The only audit DIFFs are in `ExpenseFormModal` and `ReceiptReviewModal`. Six `TextInput`s that had no `placeholderTextColor` now get a dark-only `t.scheme === 'dark' ? t.color.textSecondary : undefined`. That departs from the design's literal "TextInput gets `placeholderTextColor={t.color.textSecondary}`" rule, deliberately, to keep light byte-identical. `ReceiptReviewModal.test` pins both halves.

The visual risks come from the rules, not from slips. Rule 3 collapses many distinct violet tints and borders onto the single `DARK_TONAL.violet.tint`/`.border`. The neutral T band sends mid-grey idle labels (`#655d78`, L 0.1195) to `textPrimary`. Rule 1 turns the "white pill on lavender track" segmented controls into a pill that's darker than its track. Each mapping is correct by the letter of the design. Together they produce the dark-only "this isn't right" states that matter most for this user, and none of them is covered by a test.

One `tiers.map((t, …))` callback shadowed the theme `t` while needing theme reads, so it was renamed to `tier`. Two sibling callbacks still shadow the theme, and their `TextInput`s were skipped for `keyboardAppearance`. The tests reach the three modals that have no render test of their own through their parent screens, and the (d) test repaints a mounted schedule card live.

<details>
<summary>Issues (9)</summary>

1. **Expenses tab switcher emphasis inverts in dark**: idle tab label/icon/badge text `EXPENSES.dark.tabIdleText` = `textPrimary` `#f3eefc` is brighter than the active `primaryFg` `#c4a3ff`, and the active pill (`surface` `#1e1430`) is darker than the track (`surfaceAlt` `#2a1d42`). Confirm in the screenshot pass. If confirmed, record a design exception (for example idle → `textSecondary`, active pill → `surfaceAlt` with `outline.card` or a lighter tint) and add a dark assertion on the idle vs active label.
2. **Tier count pill active state vanishes in dark**: `tierCountPillCard` (`rowActiveBg` + `violetHairline`) and `tierCountPillCardActive` (`quickActionBg` + `violetBorderActive`) both resolve to `violet.tint` `#392b51` + `violet.border` `#584678`. Give the active pair a distinct dark value (for example border `primaryFg`) as a recorded exception.
3. **Alcohol Switch "on" reads weaker than "off"**: `FORM_SWITCH.dark.trackOn` `#584678` is almost the same as `trackOff` `#4a3a6b`. The on-thumb `#7e57c2` is dimmer than the white off-thumb. Consider `trackOn` → `DARK_TONAL.violet.fill` or `primaryFg` by exception, and add a test, since the switch colours are untested.
4. **Ink-indigo names become accent-violet**: `#1e1b4b` (member/flow names, Balances active toggle text) → `DARK_TONAL.violet.fg`, which equals `primaryFg`. Names now share the link/accent hue in dark, where light shows them as near-black ink. That follows the rule. Check it in screenshots and decide whether `textPrimary` is the intended dark role.
5. **Two TextInputs lack `keyboardAppearance`**: the tier matrix `matrixCountInput` and the `tierCountInput` in `ExpenseFormModal` are inside `tiers.map((t, tIdx) …)` callbacks that shadow the theme, so they were skipped. The design applies the prop to every `TextInput`. Rename the callback parameter (as was already done for the tier-name block) and add `keyboardAppearance={t.scheme}`.
6. **Dark-only placeholder ternary is an undocumented design deviation**: six `TextInput`s use `t.scheme === 'dark' ? t.color.textSecondary : undefined` instead of the design's unconditional `t.color.textSecondary`. The choice is right for light parity. The integrator should record it in design.md's third-party/native rules so other batches handle the same case the same way.
7. **Typecheck/related-tests evidence is scoped**: C5 ran through a temporary out-of-repo tsconfig over B4 files (881-file program, exit 0), because root `tsc` stops on B7's `ChangePasswordControl.tsx(290,3) TS1005`. The integrate step must run the full `npm run verify`.
8. **Untested dark values**: `FORM_SWITCH`, `AVATAR_FILL`, the tier count pill and matrix states, the TripSchedule settings/item-settings modals and the park-hours stripes have no dark assertions. Items 2 and 3 are exactly what this gap lets through, so they need screenshot coverage.
9. **`showtimePillActive` primary fill on `surfaceAlt`**: the coder flagged it (DoD 8). The integrator should check its contrast against the iteration-3 `surfaceAlt` pairs.

</details>

<details>
<summary>Details</summary>

### Selected states that collapse or invert in dark

Rule 3 is deterministic: every violet S goes to `violet.tint` and every violet B goes to `violet.border`. In light, `ExpenseFormModal` spreads eleven distinct pale violets across wells, active cards, stepper pills and quick actions. They all collapse to one value. Most active styles also change something rule-stable, like `surface` vs tint, or `primaryFg` text or border, so they survive. `tierCountPillCard` doesn't:

```
tierCountPillCard        bg rowActiveBg   (#fcfaff → #392b51)  border violetHairline     (#e8dcfa → #584678)
tierCountPillCardActive  bg quickActionBg (#f5effa → #392b51)  border violetBorderActive (#bca5db → #584678)
```

Only the count digit tells the two states apart in dark. (confirmed)

The Expenses tab switcher goes the other way. In light, a white active pill with `#5b2a86` text sits on a lavender track, and idle labels are a muted `#655d78`. In dark, the idle label hits the neutral T band at L 0.1195 < 0.12, so it becomes `textPrimary` `#f3eefc`. The active label is `primaryFg` `#c4a3ff` (L ≈ 0.45), so the unselected tab is the brightest text in the control. The active pill also becomes `surface`, which is darker than the `surfaceAlt` track. Selection still differs by weight (800 vs 700), by the pill and by the label hue, so it isn't a colour-only accessibility failure. But it's the kind of "not right" dark state the user objected to. The Balances Net/Pairwise toggle and the `ExpenseFormModal` mode chips have the same darker-pill-on-lighter-track shape, though their labels don't invert. (confirmed values; visual impact likely)

The alcohol `Switch` keeps the light structure, with role B tracks and an F on-thumb. In dark, though, the on-track `violet.border` `#584678` and off-track `borderStrong` `#4a3a6b` are almost the same, and the white off-thumb (`textOnPrimary`) stands out more than the `#7e57c2` on-thumb. Thumb position still signals state. Nothing asserts these colours. (confirmed values; visual impact likely)

### Light parity and the placeholder deviation

The audit report shows every file PASS except two `#6b6480` count increases. Both come from the `textSecondary` read in the dark-only placeholder ternary, which leaves light at RN's default. The design's literal rule (`placeholderTextColor={t.color.textSecondary}`) would have changed six light placeholders from the platform default to `#6b6480`, which breaks Property 8. The coder kept the higher-priority rule and pinned it in a test. The design should say so explicitly, so batches facing the same "no placeholder colour today" case don't split. (confirmed)

`EXPENSES.avatarWellBg` replaces a `theme.color.primaryLight` read with the literal `#7e57c2`, and keeps the dead `?? '#eee'` fallback as a palette key. Light is identical, but the drill-down avatar well no longer follows the token if `primaryLight` ever changes. This is low-impact. (confirmed)

### Scope of the diff in files with unrelated uncommitted edits

The pre-batch snapshot already contained the unrelated uncommitted work, so `git diff --no-index` against it isolates B4. Across all seven sources, the hunks outside the style factories are colour reads, `keyboardAppearance`/`placeholderTextColor` props and the `StyleSheet`/`theme` import swap. The remaining ones are the hook calls, the private helper signature changes (`getCategoryMeta(cat, t)`, `getAvatarColor(name, t)`, both file-local with all callers updated), the three-line `t` → `tier` rename and `theme.spacing`/`typography`/`radius` → `t.*`. There are no reverts or reformats. The four owned test files' diffs against `HEAD` add only the dark-mode `describe` blocks and their imports. (confirmed)

### Test coverage

Not tested: `FORM_SWITCH`, `AVATAR_FILL`, the tier matrix/count pill states, the schedule settings and item-settings modals, the park-hours stripes, and the Expenses idle-tab label.

### Verification evidence

The typecheck ran through a temporary out-of-repo tsconfig that extends `apps/mobile/tsconfig.json` over every `screens/trips` source, palette and owned test (881 files, exit 0). Root `npm run typecheck` is blocked by B7's `ChangePasswordControl.tsx` TS1005, which makes tsc skip semantic checks program-wide. B4 changes no exported names or signatures, so the risk is low, but the full gate still has to run at integration. (confirmed)

</details>

<details>
<summary>File map</summary>

- `screens/trips/TripScheduleScreen.tsx` (+ `.palette.ts` `SCHEDULE`): slate/status pills, timeline nodes and the speech fill become palette pairs; park-hours stripes → tonal `fg`; badges → tokens/`primaryFg`; `outline.card` on two borderless cards; `keyboardAppearance` on 2 inputs.
- `screens/trips/TripExpensesScreen.tsx` (+ `.palette.ts` `CATEGORY_META`, `EXPENSES`): `getCategoryMeta(cat, t)`; tab switcher, hero, ledger cards, balance/flow cards and drill-downs become palette pairs; `textDefault` on emoji glyphs.
- `screens/trips/ExpenseFormModal.tsx` (+ `.palette.ts` `AVATAR_FILL`, `FORM_SWITCH`, `FORM`): `getAvatarColor(name, t)`; scrim pair; switch pairs; `tier` rename; `keyboardAppearance` on 14 of 16 inputs, plus a dark-only placeholder on 3.
- `screens/trips/TripBalancesScreen.tsx` (+ `.palette.ts` `BALANCES`): toggle, hero, settle (rule 4) and status chips become palette pairs; `primaryFg` spinners and links.
- `screens/trips/SettlementModal.tsx`, `RefundModal.tsx` (+ `.palette.ts`): error tint → red tint; `withAlpha(primary, 0.08)` projection; `keyboardAppearance`.
- `screens/trips/ReceiptReviewModal.tsx` (+ `.palette.ts` `RECEIPT_REVIEW`): banners/chips → tonal tints; charge badges → tonal `fg`/`starRating`; dark-only placeholder on 3 inputs.
- Tests: dark `describe` blocks in `TripScheduleScreen`, `TripExpensesScreen`, `TripBalancesScreen` and `ReceiptReviewModal` `.test.tsx`.

Full diff: `git diff --no-index "$env:TEMP\dark-mode-snapshot\B4\screens\trips\<file>.tsx" apps/mobile/src/screens/trips/<file>.tsx` per file.

</details>
