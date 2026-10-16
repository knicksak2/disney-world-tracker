# Dark-mode polish pass, iteration 2: closing the POLISH-review findings

This is the second review pass. Iteration 2 answers the six first-pass findings (P-1 to P-6) and changes no app behaviour: every edit is a test, the plan or `POLISH-report.md`. The blocking P-1 is fixed. The `FoodItemPickerModal` `extraData` test now re-renders with a fresh element from a `makeUi()` factory, and the coder recorded it failing when the `useMemo` was reverted. The `/resorts` race at `recreationExperience.test.tsx:155` now uses `findByText`. Both "exclude alcohol" Switch sites have their own render tests, mutation-checked against removing both `key={t.scheme}` and the `themedSwitchProps` spread. LogVisitModal, RestaurantDishLogCard and AVATAR_FILL now have dark-plus-light render tests.

Watch for: Fix 11 (the white strip under non-tab screens in Dark) is still not built, and the report's "decision needed" text predates the user's latest reply (likely). The only `verify:mobile` on record is red. Iteration 2 hardened the flake but did not re-run the gate, so item 14's full `npm run verify` is the first run that can come back green (confirmed).

**Verdict**: APPROVED

## High-level view

The mutation checks rewrote `ExpenseFormModal.tsx`, `ReceiptReviewModal.tsx` and `FoodItemPickerModal.tsx`, and the source is now restored. All six Switch sites carry the key and the spread, and the FlatList reads the memoized `listExtraData`. Light parity holds against HEAD at both ExpenseFormModal sites (`#cbd5e1`/`#c084fc` track, `#7c3aed`/`#ffffff` thumb) and at both ReceiptReviewModal sites (platform defaults).

The new tests assert against `darkTheme` tokens, `DARK_TONAL` values or HEAD's light literals, never against the palette key under test, so none of them is tautological. The P-5 remount assertions are sound because `setTestScheme` wraps the store update in `act`.

Scope is still clean. No dependency was added: `expo-system-ui` and `expo-navigation-bar` appear in neither `apps/mobile/package.json` nor the lockfile, and the manifest's only diff is the pre-existing async-storage pin. Nothing changed under `apps/api` or `packages/shared`. The guard and `themeGuard.ts` are older than this pass. No scratch files were added, and the spec checkboxes are well-formed.

<details>
<summary>Issues (3)</summary>

1. **Fix 11 decision text is stale**: `POLISH-report.md` "Open decision" still asks whether `expo-system-ui` may be added. The user's latest messages ("i dont see it anymore but if you think we need it thats fine") appear to answer it. Visual-verify should re-sample the y 2337–2400 strip on You & Crew in Dark, then record that result and the user's reply in the report. The dependency stays out of this loop.
2. **No green workspace gate on record yet**: the only `verify:mobile` run exited 1. Item 14 must run the full `npm run verify` once and paste the literal per-workspace tail and exit code. If `recreationExperience` or any other suite is red, fix it there rather than calling it pre-existing.
3. **B7 coverage finding only partly routed**: B7 also listed AvatarPicker, CompactEmptyState, GroupSection, PercentileBanner, CoverageStatGrid and CompletionStatTile as covered only by the guard plus screenshots. The ledger files them under a catch-all "visual pass" line, but item 15 doesn't name them. Name them in the item-15 checklist, or note which listed screen covers each.

</details>

<details>
<summary>Details</summary>

### Fix 11 and the user's latest reply

The step brief forbids `expo-system-ui`, and the coder complied, so the report presents the strip as an open user decision. The request thread, though, now ends with the user asking whether "we need to add that" and then saying "i dont see it anymore but if you think we need it thats fine". That most likely refers to this strip and this dependency (likely; the referent is not explicit). If the strip no longer reproduces, the dependency question may be moot. If it does reproduce, the user has given conditional consent that the report doesn't record. Item 15a's pixel sample should settle it, and the report should state the observed result instead of the stale question. This is outside the build loop's scope, so it doesn't block.

### Verification evidence and the missing green run

The iteration-2 evidence is specific. It covers per-file Jest counts and the three mutation runs with their expected failures. It records a self-caught `ReceiptReviewModal` test mistake (reading `off.props` after the remount) and its fix. It shows `tsc --noEmit` exiting 0 after the source was restored, the guard/contrast/themeGuard trio green at 27/27, and an empty `git status` for `apps/api`/`packages/shared`. None of it left a specific doubt, so no spot-check was run.

The evidence does not include a green workspace run. The only `verify:mobile` on record is iteration 1's exit 1 (`1 failed, 2128 passed`). The flake behind that failure is now hardened, but no passing gate has been run since. Under execution-discipline, item 14 cannot report done until one is (confirmed).

</details>

<details>
<summary>File map (iteration 2)</summary>

- `screens/catalog/__tests__/FoodItemPickerModal.test.tsx`: `makeUi()` factory so the stability test really re-renders (P-1).
- `screens/catalog/__tests__/ExperienceDetailScreen.recreationExperience.test.tsx`: `await findByText` for the resort-prefixed brief title (P-2).
- `screens/trips/__tests__/TripExpensesScreen.test.tsx`: discount exclude-alcohol Switch case (P-5) and the AVATAR_FILL payer-chip case (P-4).
- `screens/trips/__tests__/ReceiptReviewModal.test.tsx`: charge exclude-alcohol Switch case (P-5).
- `screens/catalog/__tests__/LogVisitModal.dark.test.tsx` (new): sheet, note input, rating pill, busy spinner, light placeholder (P-4).
- `screens/catalog/__tests__/ParkPassportCard.test.tsx`: RestaurantDishLogCard dark and light describe (P-4).
- `screens/trips/ExpenseFormModal.tsx`, `ReceiptReviewModal.tsx`, `screens/catalog/FoodItemPickerModal.tsx`: touched by the mutation checks and restored to the iteration-1 fix.
- `.agents/tasks/dark-mode-retrofit/POLISH-plan.md`, `POLISH-report.md`: iteration-2 evidence and dispositions.

The full diff is in the working tree, uncommitted and mixed with the earlier retrofit. Iteration-2 files were written on 10-16 between 01:56 and 02:01.

</details>
