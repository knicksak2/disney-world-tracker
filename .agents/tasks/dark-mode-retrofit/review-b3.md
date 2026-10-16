# B3 dark-mode retrofit: logging sheets, food lists and experience lists

B3 moves 25 logging/list screens, sheets and modals off the static `theme` import and onto the `makeStyles` + `useAppTheme()` consumer pattern. Non-token literals go into 12 co-located `*.palette.ts` files, plus the `MarkGottenUndoToast` H-role pair. All 21 owned tests gain dark-mode cases, including the designated (d) live-repaint test in `MyFoodListsScreen` and the Property 22 toast case. I read the source diff against the pre-batch snapshot, all 13 B3 palettes, and the test-file deltas, and hand-checked the rule-3 family/role choices against the design's HSL and luminance bands. Every role assignment I checked matches the rules. The memo deps and `extraData` sites are complete, and the toast conversion is exactly what rule 1a specifies. I did not re-run verification, per the step brief. The report pastes the literal guard tail (`9 passed`, `exit=0`), the owned-suite and related-suite counts (21/254 and 64/562), and the audit result (23 PASS plus 2 justified DIFF).

Watch for: `LogVisitModal`'s placeholder colour is set only in dark mode, which departs from the design's literal TextInput rule to keep light identical (non-blocking). The `FoodItemPickerModal` `extraData` array is rebuilt on every render (non-blocking). The two `AddToTrip*` sheets have no render test at all. `git diff HEAD` on two B3 files includes `keyboardShouldPersistTaps` edits that were already in the snapshot before B3 started.

**Verdict**: APPROVED

## High-level view

The conversion is a role-driven mechanical change. Most of the diff is `theme.` → `t.`, with three role swaps applied consistently. First, `primary` used as text, an icon, a border on a surface, a spinner or a data mark becomes `primaryFg`; that covers the progress fill, the attribution labels, the `Badge` colours and the empty-state links. Second, literal white on fills becomes `textOnPrimary`. Third, a fill's own border stays `primary` when it equals the fill. The `rgba(91,42,134,a)` and `rgba(214,51,108,a)` tints go through `withAlpha(t.color.primary|danger, a)` (rule 2). The off-token `rgba(107,70,193,a)` and `rgba(239,68,68,a)` tints become violet/red S-role palette values.

The two literal-heavy files are `RateExperienceModal` and `RestaurantDishLogCard`. Every literal in them lands on the family and band the design tables give. That includes the near-threshold neutrals (`#8b7aa3` and `#7b6899` both fall under 0.20 saturation, so they become `textSecondary`), the lavender-subtle `#fbf9fe` (→ `surfaceAlt`), and the near-white amber tints (→ `amber.tint`). Shadow literals follow rule 0 (`#5b2a86`/`#d4a017` → `#000000`).

`MarkGottenUndoToast` is the one rule-1a site. The `textPrimary`-as-background read becomes the mode-invariant `{ light: '#1f1235', dark: '#1f1235' }` pair with `...t.outline.card`, and its test pins all three properties.

Live repaint is handled at every virtualised site. Each FlatList, and the `NestableDraggableFlatList`, whose callbacks read parent `styles`/`t` gets `extraData={t.scheme}`, and the `useCallback` deps were widened to match. `FoodItemPickerModal`'s row component and `ExperienceListDetailScreen`'s `AddItemsCatalogSearch` call `useStyles()`/`useAppTheme()` themselves. `AddToTripPickerSheet`'s module-scope `STATUS_META` became a `statusMeta(t)` builder.

Test coverage is real, not a smoke check. Each dark case asserts a `darkTheme` or palette `.dark` value that differs from its light counterpart, so it would fail if the element stayed light. The toast case would fail under the naive `t.color.textPrimary` substitution (dark `#f3eefc`), and also if the outline spread were dropped.

<details>
<summary>Issues (5)</summary>

1. **Dark-only placeholder in `LogVisitModal`** — `placeholderTextColor={t.scheme === 'dark' ? t.color.textSecondary : undefined}` departs from the design's unconditional `placeholderTextColor={t.color.textSecondary}`, to keep light identical (the input had no placeholder colour before). This is the same pattern B2 used. The integrator should record it as a design clarification, so B4–B7 apply one consistent rule. Non-blocking.
2. **`extraData` array rebuilt every render in `FoodItemPickerModal`** — `extraData={[selectedItems, t.scheme]}` is a new array on each parent render, so FlatList's shallow compare never skips a render: unrelated parent state changes re-render the list. Wrap it in `useMemo(() => [selectedItems, t.scheme], [selectedItems, t.scheme])`. Non-blocking: the plan sanctions the `[x, t.scheme]` form, and the cost is only performance.
3. **No render coverage for `AddToTripOrListChoiceSheet` / `AddToTripPickerSheet`** — no test renders either sheet in either scheme, so the `statusMeta(t)` refactor and the `primaryFg` icon swaps are covered only by the guard and screenshots. The plan acknowledges this. A render test in a later pass would close it.
4. **Pre-batch uncommitted edits ride along in `git diff HEAD`** — the `keyboardShouldPersistTaps="handled"` additions in `CreateLocationModal.tsx` (×2) and `FoodItemPickerModal.tsx` (×1) are already in the B3 snapshot, so they aren't B3's work. They still show up against HEAD. The integrator should know about them before committing.
5. **Typecheck evidence is summarised, not pasted** — C5 reports "no `error TS` lines, `exit=0`" plus a per-file TS-API count, not the literal `tsc` tail. That's adequate for a batch gate, and W3's `npm run verify` is the binding check. Non-blocking.

</details>

<details>
<summary>Details</summary>

### `MarkGottenUndoToast` H-role conversion

A straight token substitution of `theme.color.textPrimary` would put white and gold text on dark `#f3eefc`, at 1.14:1 and 1.44:1. The test runs over both schemes with `test.each` and checks the outline separately (dark border and hairline in dark, `undefined` in light). So it would catch a naive `t.color.textPrimary` conversion, a dropped outline spread, and an outline leaking into light. The test hardcodes `'#1f1235'`/`'#ffffff'` alongside the palette and `t` reads. The plan asks for palette and `darkTheme` sources, but here the literal *is* the invariant being pinned.

### Non-obvious rule-3 calls in `RateExperienceModal`

`#371756` is listed among the H-role violets, but here it's title text on the dialog surface, so role T applies (`violet.fg`). Keeping it mode-invariant would have put a dark violet title on `#1e1430`. The dialog scrim `rgba(20,8,36,0.65)` stays mode-invariant: it isn't the `rgba(31,18,53,a)` textPrimary scrim that rule 2 sends to black, and it's already near-black. The other literals in this file and in `RestaurantDishLogCard` land where the design's family and band tables put them, including the near-threshold neutrals `#8b7aa3`/`#7b6899` (s < 0.20) and `#a16207`, which is amber at hue 35.4°.

### `LogVisitModal` placeholder and the design's TextInput rule

The note `TextInput` had no `placeholderTextColor`, so light used RN's platform default. Applying the design's TextInput bullet literally would change the light placeholder to `#6b6480`. That breaks Property 8 / Requirement 9.2 (light unchanged), and the multiset audit would flag it as a real light change. The batch resolved the conflict with a dark-only prop and listed the extra `textSecondary` read as its first audit DIFF. That keeps light byte-identical at runtime and still themes dark. The plan says design/plan conflicts are reported, not silently picked. The report states the choice, but only inside the audit table, not as a design conflict. Two batches have now made the same call, so the design's TextInput bullet should say so explicitly.

### `FoodItemPickerModal` list bailout

The `FoodItemPickerModal` `extraData={[selectedItems, t.scheme]}` literal is the plan's prescribed form. But the previous `extraData={selectedItems}` kept a stable reference between selection changes, while the array literal never does. So the list re-renders whenever the parent does, including on unrelated state changes like `isSubmitting` or `historyItem`. This is a confirmed loss of the bailout. Its impact is performance only.

### Scope and stray changes

I diffed the B3 snapshot against HEAD for every owned file. Apart from console-encoding noise in comments, the only real differences are three `keyboardShouldPersistTaps="handled"` props, in `CreateLocationModal` (×2) and `FoodItemPickerModal` (×1), that predate B3. They are uncommitted, so a plain `git diff HEAD` review, or a commit of these files, would attribute them to the dark-mode change. The worktree also holds B1/B2/B4–B7 in-flight edits, which have nothing to do with B3.

### Test coverage

The test-file deltas only add code, except for import-line edits that add `StyleSheet`/`darkTheme`, so no existing light assertion was weakened.

Not tested: the two `AddToTrip*` sheets (no render test in either scheme). `LogVisitModal` and `RestaurantDishLogCard` are rendered only by unowned B2 tests in light, with no colour assertions, so their dark palettes, including the `DISH_CARD` amber/orange mapping and the dark-only placeholder, are covered only by the guard and screenshots.

</details>

<details>
<summary>File map</summary>

- `screens/catalog/AddToTripOrListChoiceSheet.tsx`: consumer pattern; option icons `primaryFg`.
- `screens/catalog/AddToTripPickerSheet.tsx`: module `STATUS_META` → `statusMeta(t)`; upcoming badge `primaryFg`.
- `screens/catalog/CreateLocationModal.tsx`: consumer pattern; `renderSuggestion` deps; `extraData`; input `keyboardAppearance`; chip text `textOnPrimary`.
- `screens/catalog/FoodItemLogHistorySheet.tsx`: consumer pattern; spinner `primaryFg`.
- `screens/catalog/FoodItemPickerModal.tsx` + `.palette.ts`: row component self-themes; violet S/B palette; `extraData` array.
- `screens/catalog/LogFoodItemModal.tsx` + `.palette.ts`: red error banner palette; input dark keyboard.
- `screens/catalog/LogVisitModal.tsx`: dark-only placeholder colour; spinner `primaryFg`.
- `screens/catalog/MyFoodHistoryScreen.tsx`: deps, `extraData`; filter chip border/text `primaryFg`.
- `screens/catalog/RateExperienceModal.tsx` + `.palette.ts`: 21-key rule-3 palette; dialog `surface`; tiles `primary`/`textOnPrimary`.
- `screens/catalog/RestaurantDishLogCard.tsx` + `.palette.ts`: 19-key amber/orange palette; three `textDefault` placements.
- `screens/catalog/RestaurantFoodLogsSheet.tsx`: deps, `extraData`, dark keyboard.
- `screens/foodLists/AddToListsSheet.tsx` + `.palette.ts`, `experienceLists/AddToExperienceListsSheet.tsx` + `.palette.ts`: inline-create violet tint; deps, `extraData`.
- `screens/foodLists/CreateFoodListModal.tsx`, `experienceLists/CreateExperienceListModal.tsx`: consumer pattern; pills `textOnPrimary`.
- `screens/foodLists/FoodListDetailScreen.tsx` + `.palette.ts`: celebration amber/orange palette; progress fill `primaryFg`; `withAlpha` tints; `renderSearchResult` deps.
- `screens/foodLists/FoodListDiscoveryScreen.tsx` + `.palette.ts`, `experienceLists/ExperienceListDiscoveryScreen.tsx` + `.palette.ts`: like badge `withAlpha(danger)`; empty icon violet palette.
- `screens/foodLists/ManageFoodListSharesSheet.tsx` + `.palette.ts`, `experienceLists/ManageExperienceListSharesSheet.tsx` + `.palette.ts`: role badge violet tint; deps, `extraData` ×2.
- `screens/foodLists/MarkGottenUndoToast.tsx` + `.palette.ts`: rule-1a H-role toast pair plus dark outline.
- `screens/foodLists/MyFoodListsScreen.tsx`, `experienceLists/MyExperienceListsScreen.tsx`: deps, `extraData` ×2.
- `screens/foodLists/RateOnCheckoffPrompt.tsx`: consumer pattern.
- `screens/experienceLists/ExperienceListDetailScreen.tsx` + `.palette.ts`: bare `categoryVisual` → `t.categoryVisual[*].tint`; `AddItemsCatalogSearch` self-themes; `withAlpha` tints.
- 21 owned `__tests__/*.test.tsx`: dark-mode describe blocks; (d) in `MyFoodListsScreen`; Property 22 in `MarkGottenUndoToast`.

Full diff: `git diff --no-index "%TEMP%\dark-mode-snapshot\B3\<rel>" "apps/mobile/src/<rel>"` per owned file.

</details>
