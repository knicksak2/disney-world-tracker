# W2 batch B4 — Trip money & schedule (spec 9.4)

Converted from scratch (no `review-b4.json` existed). Pre-batch snapshot taken once, before
any edit, at `$env:TEMP\dark-mode-snapshot\B4\` (7 files). It is **kept** for the reviewer and
fix loop, per the plan's "Snapshot lifetime" decision; the integrate step deletes it.

## Files

Converted (consumer pattern, `makeStyles` + `useAppTheme`/`usePalette`):
`screens/trips/{TripScheduleScreen, TripExpensesScreen, ExpenseFormModal, TripBalancesScreen,
SettlementModal, RefundModal, ReceiptReviewModal}.tsx`.

New co-located palettes: `TripScheduleScreen.palette.ts` (`SCHEDULE`),
`TripExpensesScreen.palette.ts` (`CATEGORY_META`, `EXPENSES`), `ExpenseFormModal.palette.ts`
(`AVATAR_FILL`, `FORM_SWITCH`, `FORM`), `TripBalancesScreen.palette.ts` (`BALANCES`),
`SettlementModal.palette.ts` (`SETTLEMENT`), `RefundModal.palette.ts` (`REFUND`),
`ReceiptReviewModal.palette.ts` (`RECEIPT_REVIEW`).

Tests edited (owned): `__tests__/{TripScheduleScreen, TripExpensesScreen, TripBalancesScreen,
ReceiptReviewModal}.test.tsx`.

## C4 — strict guard (`THEME_GUARD_STRICT=B4`)

```
Test Suites: 1 passed, 1 total
Tests:       9 passed, 9 total
```

## C5 — typecheck

`npm run typecheck --workspace apps/mobile` currently stops at one **syntax** error in another
batch's in-flight file — `src/screens/ChangePasswordControl.tsx(290,3): error TS1005: ')'
expected.` (B7). Because tsc skips semantic checking when any syntactic error exists, that run
does not prove anything about B4. B4 was therefore typechecked with a temporary tsconfig
**outside the repo** (`$env:TEMP`, since deleted) that extends `apps/mobile/tsconfig.json` and
includes every `screens/trips/*.tsx`, every `screens/trips/*.palette.ts`, the 4 owned tests
and the `.d.ts` files (881 files in the program). Result: `exit: 0`, zero `error TS` lines.

## C6 — regression sweep (`--findRelatedTests` over the 7 owned sources)

```
Test Suites: 23 passed, 23 total
Tests:       229 passed, 229 total
```

## C7 — light-colour multiset audit

```
PASS screens/trips/TripScheduleScreen.tsx (228 light colours)
PASS screens/trips/TripExpensesScreen.tsx (273 light colours)
DIFF screens/trips/ExpenseFormModal.tsx
    #6b6480: before 23, after 26
PASS screens/trips/TripBalancesScreen.tsx (79 light colours)
PASS screens/trips/SettlementModal.tsx (18 light colours)
PASS screens/trips/RefundModal.tsx (21 light colours)
DIFF screens/trips/ReceiptReviewModal.tsx
    #6b6480: before 8, after 11
```

Both differences have the same justification: a **dark-only `TextInput` placeholder colour**.
Six `TextInput`s had a `placeholder` but no `placeholderTextColor` (RN's default):
ReceiptReviewModal item name, item price, charge amount (3); ExpenseFormModal itemized item
name, item price, charge amount (3). Each now gets
`placeholderTextColor={t.scheme === 'dark' ? t.color.textSecondary : undefined}`. The audit
counts the `t.color.textSecondary` read (`#6b6480`), but light passes `undefined`, so the light
render is unchanged (RN default placeholder). Writing the plain `t.color.textSecondary` would
have changed the light placeholder colour; leaving it out would leave RN's black-ish default
placeholder on the dark surface. The ReceiptReviewModal test pins both halves (dark value,
light `undefined`).

## Rule decisions worth a reviewer's look

- **H-listed `#1e1b4b` used as text** (Balances/Expenses member and flow names). The
  high-frequency table lists it as "H-role violet", but here it is text on a white card, so
  role T applies to the violet family: `DARK_TONAL.violet.fg`. Light is unchanged.
- **Neutral `#655d78`** (Expenses tab labels): L = 0.1195 < 0.12, so T → `textPrimary`, not
  `textSecondary`.
- **`#6b5880`** (L 0.1166) → `textPrimary`; **`#8b7a9f` / `#948a9e` / `#a39bb3`** → `textSecondary`.
- **`rgba(15, 23, 42, 0.6)`** (ExpenseFormModal scrim, slate, not a token) → palette pair with
  dark `rgba(0, 0, 0, 0.6)`, mirroring the rule-2 scrim exception.
- **Park-hours accent stripes** (`#22c55e/#0284c7/#a855f7/#f97316`, a 5 px left border) were
  treated as colour-coding marks (T → `fg`), following the non-text-graphics rule, rather than as
  a dim B border.
- **`theme.color.primaryLight ?? '#eee'`** (Expenses drill-down avatar well) is a primaryLight
  well behind primary-hued initials, not behind white text. Rule 3 S → `DARK_TONAL.violet.tint`.
  The dead `?? '#eee'` fallback is kept byte-identical as palette `avatarWellFallback`.
- **Borders that edge their own primary fill** (`datePillActive`, `optionChipActive`,
  `payerChipSelected`, `checkboxSelected`, …) stay `primary`, matching the fill. Borders on a
  surface became `primaryFg` (`touringStartBadge`, `exactModeBtnActive`, `scanMoreBtn`,
  `heroVenueBtnActive`, `helperSegmentBtnActive`, `miniPresetChipActive`, `assigneeChipActive`).
- **`Switch`es.** ExpenseFormModal's two alcohol switches → `FORM_SWITCH` pair (tracks are
  role B, on-thumb F). The off thumb is `#ffffff` on the track, so it becomes
  `t.color.textOnPrimary` (white in both schemes). ReceiptReviewModal's two `Switch`es set **no**
  colours today, so none were added; adding them would change light.
- **`rgba(255,255,255,0.28)`** (selected payer avatar veil on the primary fill) and
  `rgba(255, 255, 255, 0.15)` (header icon buttons on the gradient) stay literal (rule 5).
- **`'#f59e0b'` service-charge Badge** (ReceiptReviewModal) is an exact `starRating` match →
  `t.color.starRating` (rule 1 hue token as text).
- **Outline.** `...t.outline.card` was added to TripSchedule's `resultContainer` and
  `parkHoursCardHorizontal` (borderless white cards). It's dark-only (`{}` in light), and the
  card's `borderLeftWidth/Color` still wins on the left edge.

## DoD 4 — memo / list / ref sites

- No `FlatList`/`SectionList`/`DraggableFlatList`, no `React.memo`, and no `useRef` holding a
  colour in any owned file.
- `useMemo`/`useEffect` sites (TripSchedule ×4, TripExpenses ×9, ExpenseFormModal ×12 incl. 2
  `useRef`s for ids, ReceiptReview ×2, TripBalances ×1). I checked each body: none reads
  `styles`, `t`, a palette, `getAvatarColor` or `getCategoryMeta`, so no dep changes were needed.
- Module-scope helpers that embedded colours now take the theme as a parameter.
  - `getCategoryMeta(cat, t)` (TripExpenses) reads `CATEGORY_META[t.scheme]` through one
    `catPal` alias.
  - `getAvatarColor(name, t)` (ExpenseFormModal) reads `AVATAR_FILL[t.scheme]` through
    `avatarPal`; `AVATAR_PALETTE` moved inside it.
  - Both are file-private, and all their callers are in the same file.
- ExpenseFormModal: one `tiers.map((t, idx) => …)` callback shadowed the theme `t` while
  needing `t.color.textSecondary`/`danger`, so its parameter was renamed to `tier` (3 lines).
  Two other `tiers.map((t, tIdx))` blocks contain only count `TextInput`s with no placeholder.
  They got no `keyboardAppearance` because adding one would mean another param rename, and the
  prop is iOS-only.

## `...t.textDefault` placements

All of these are emoji glyph `Text`s with no colour, not nested, on a themed tint.

- TripBalances 🧾 (expense icon well, violet tint).
- TripExpenses 🧾 and 🤝/🧾 drill-down icons (tints).
- TripExpenses `categoryAvatarEmoji` (category tint).
- ExpenseFormModal `alcoholIcon` 🍸 (item card surface).

Excluded:

- Every nested `<Text style={{ fontWeight }}>` (condition 2).
- `balanceStatusText`, `amountLarge`, `pairwiseAmountText`, `meterStatusText`, `debtAvatarText`
  and `assigneeMiniAvatarText`, whose arrays always carry a colour entry (condition 1).

## DoD 8 — rule 2a non-token suffix and PrimaryButton/Chip on surfaceAlt

- `TripExpensesScreen` `catMeta.fg + '33'`: `catMeta.fg` is a `CATEGORY_META` palette value.
  Every `*Fg` is `#rrggbb` in both schemes: light `#7e22ce #b45309 #e11d48 #0284c7 #15803d
  #475569`; dark `DARK_TONAL.{violet,orange,red,sky,green}.fg` and `darkColor.textPrimary`
  `#f3eefc`. The test asserts the dark border matches `/^#[0-9a-f]{8}$/`.
- No kit `PrimaryButton`/`Chip` sits directly on `surfaceAlt`. One custom active pill does:
  TripSchedule `showtimePillActive` (primary fill) inside `showtimesSection` (`surfaceAlt`). It
  is flagged for the integrator.

## Rule-1a / Property-22 sites

There are no named sites in B4. Rule 1a was applied generically: every `primary`/`primaryDark`
read used as text, an icon, a border on a surface or a data mark (the exact-split progress fill)
→ `primaryFg`.

## Files with no render test

- **ExpenseFormModal, RefundModal** — covered through TripExpensesScreen.test (dark (c)).
- **SettlementModal** — covered through TripBalancesScreen.test (dark (c)).

None is guard/screenshot-only.

## Other batches observed

- B7 `ChangePasswordControl.tsx` syntax error (above). Not edited.
- Early in the run, B5's in-flight `TripPlannedListScreen.tsx` threw `StyleSheet is not
  defined` at import, which failed TripScheduleScreen.test's suite load. It cleared once B5
  progressed, and all later runs are green. Not edited.

## Behavior → test map

| Behavior | Test | Assertion |
| --- | --- | --- |
| Schedule screen background is themed | TripScheduleScreen.test `(a)(b)(c)` | ancestor bg of `last-optimized-hint` === `darkTheme.color.background` |
| Schedule primary text | same | "Thu, Oct 1 Itinerary" color === `darkTheme.color.textPrimary` |
| Schedule item card `#ffffff`→surface, title `#0f172a`→inkText, wait pill `#f1f5f9`→greyPillBg, active date pill primary | same | card bg `darkTheme.color.surface`; title `SCHEDULE.dark.inkText`; pill `SCHEDULE.dark.greyPillBg`; date pill `darkTheme.color.primary` |
| (d) mounted schedule card repaints live without remount | TripScheduleScreen.test `(d)` | light `SCHEDULE.light.*`/`lightTheme.color.surface` → after `setTestScheme('dark')` the same nodes are `SCHEDULE.dark.*`/`darkTheme.color.surface` |
| Expenses screen bg, primary text | TripExpensesScreen.test `(a)(b)(c)` | tab switcher ancestor bg === background; "Be Our Guest Dinner" === textPrimary |
| Expenses tab track, card surface + violet hairline | same | `EXPENSES.dark.tabTrack`; card bg surface, border `EXPENSES.dark.violetCardBorder` |
| Category avatar tint + rule-2a `fg + '33'` border | same | bg `CATEGORY_META.dark.diningBg`; border `${CATEGORY_META.dark.diningFg}33`, 8-digit hex |
| ExpenseFormModal sheet + controls | TripExpensesScreen.test "ExpenseFormModal sheet" | sheet bg surface; title textPrimary; camera btn primary; photo btn surface + `FORM.dark.violetBorder`; even row `FORM.dark.lavenderPanel`; description input `keyboardAppearance` 'dark' |
| RefundModal sheet + projection | TripExpensesScreen.test "RefundModal sheet" | sheet bg surface; "Projected Net" color primaryFg, bg `withAlpha(darkTheme.color.primary, 0.08)` |
| Balances screen bg, toggle track, owed amount, hero fill, primary text | TripBalancesScreen.test `(a)(b)(c)` | ancestor bg background; `BALANCES.dark.toggleTrack`; `BALANCES.dark.owedText`; `BALANCES.dark.heroFill`; pairwise amount textPrimary |
| SettlementModal sheet + selected chip | TripBalancesScreen.test "SettlementModal sheet" | sheet bg surface; chip bg primary, label textOnPrimary; amount input `keyboardAppearance` 'dark' |
| ReceiptReview sheet, title, subtotal banner, demo notice | ReceiptReviewModal.test `(a)(b)(c)` | sheet surface; title textPrimary; `RECEIPT_REVIEW.dark.subtotalBg`; `demoBg`; demo text `demoText` |
| Dark-only placeholder colour (audit difference) | ReceiptReviewModal.test "placeholder" | dark `placeholderTextColor` === textSecondary + `keyboardAppearance` 'dark'; light `placeholderTextColor` undefined + 'light' |
| Light parity of every converted literal | existing light tests (102, unchanged) + C7 audit | all pass; audit PASS except the two justified differences |

Not asserted by a test: the ExpenseFormModal `FORM_SWITCH` colours, the `AVATAR_FILL` dark
fills, and the TripSchedule settings/item-settings modal internals. They're covered only by the
guard, the audit and the screenshot pass.
