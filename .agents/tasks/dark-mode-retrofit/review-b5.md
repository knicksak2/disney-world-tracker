# Trip shell (B5) dark-mode retrofit: 16 trip screens converted to makeStyles/useAppTheme with 11 co-located palettes

B5 converts all 16 owned `screens/trips/*` files from module-scope `StyleSheet.create` + static `theme.color.*` reads to `makeStyles((t) => …)` / `useAppTheme()` / `usePalette()`. It moves non-token literals into 11 new `*.palette.ts` files and adds `dark mode` blocks to all 11 owned test files, including the Property 22 chip case and the (d) live-repaint case. The review compared each file with the pre-batch snapshot (`$env:TEMP\dark-mode-snapshot\B5\`), which separates B5's edits from the unrelated uncommitted edits already in these files. Every hunk in that diff is colour or style plumbing. The only non-colour edits are behaviour-preserving extractions: `STATUS_LABEL`, and a private `getAvatarColor` that now takes its palette as a parameter. Owned-test diffs against `HEAD` are purely additive apart from widened `react-native` imports, so no existing light assertion was edited. Guard, audit, typecheck and jest were not re-run. The coder's recorded results were taken as evidence.

Watch for: `HUB_SECTIONS[].color` still holds a module-scope colour through a `HUB_SECTION_COLOR.light.*` read (confirmed). It is dead data today, but it breaks the plan instruction and the palette read-form rule, so the integrator has to decide on it. The batch report summarises C4–C7 rather than pasting literal output tails (confirmed).

**Verdict**: APPROVED

## High-level view

The two named rule-1a sites in `TripReservationsScreen` (`kindChipTextActive`, `dateChipTextActive`) and the active kind-chip icon now read `textOnPrimary` instead of `surface` on the `primary` fill. The test asserts Property 22 against `darkTheme.color.primary` / `textOnPrimary`, with a `not.toBe(surface)` guard that would have caught a naive port. Across the batch, `primary` used as text, icon, border, badge or spinner colour becomes `primaryFg`. `primary` used as a fill stays `primary`.

All four rule-2a suffix groups convert verbatim. In AttachedExperience ×5, AttachedFood ×5, TripDetail ×4 and GroupFavorites ×2, the tint fills keep their fill token and the empty-state borders move to `primaryFg` under rule 1a. Every suffixed X is a `color.*` token, so there are no non-token suffix sites and the 6-digit invariant holds.

Module-scope colour tables became `…For(t)` factories or render-time palette reads. Park hues used for a park go through `t.parkAccent[...]`. Park hues used for anything else (avatars, reaction tints, the Activity tile, the Lightning-Lane badge) fall through to the rule-3 family tables. A spot-check of the hue and luminance classifications matched every family the palettes claim.

`HUB_SECTIONS` is the one exported-structure wrinkle. The unowned `tripStructureRegression` snapshot pins its light hexes, so the coder fed the field from `HUB_SECTION_COLOR.light.*` rather than editing that test, and reported the deviation. Nothing renders `HubSection.color`, so there is no visible dark defect. What remains is a static colour read that the guard can't see.

<details>
<summary>Issues (4)</summary>

1. **`HUB_SECTIONS` static `.light` palette read**: `TripDetailScreen.tsx:136–184` sets `color: HUB_SECTION_COLOR.light.*`. That is a module-scope colour in a non-allowed palette read form. The integrator should either drop or replace `HubSection.color` and re-record the unowned `tripStructureRegression` snapshot, or explicitly accept it as dead data. Non-blocking.
2. **Batch report lacks literal output tails**: C8 asks for the literal C4/C5/C6/C7 tails. `w2-B5-report.md` gives quoted counts (`Tests: 9 passed, 9 total`, `Test Suites: 11 passed`, `Tests: 189 passed`, `0 errors`) and a hand-transcribed audit DIFF breakdown. Paste the raw tails at integration, or have the integrator's run supply them. Non-blocking.
3. **Active kind-chip icon not asserted**: The rule-1a icon colour `active ? t.color.textOnPrimary : …` (`TripReservationsScreen.tsx:507`) is untested. Only the chip label and fill are asserted. Add an icon-colour assertion to the Property 22 case. Non-blocking.
4. **Four owned files with no dark render assertion**: `ResortPickerModal`, `RodeWithConfirmScreen`, `TripInviteScreen` and `TripGuestManagementModal` have guard and audit coverage only. The plan sanctions this. Carry it to the W3 screenshot pass. Non-blocking.

</details>

<details>
<summary>Details</summary>

### `TripReservationsScreen` rule-1a chips and Property 22

`kindChipTextActive` and `dateChipTextActive` now read `t.color.textOnPrimary`, and the kind-chip icon ternary follows the same rule. The active chips keep `t.color.primary` for fill and border. Light is unchanged because `textOnPrimary` and `surface` are both `#ffffff` in light, so the audit records no difference.

The Property 22 test drives the real flow. It opens the add modal, presses a date chip, then reads the default-active Dining chip and an inactive chip. It asserts the dark fill, the label colour, the inactive `textSecondary`, and `not.toBe(darkTheme.color.surface)`. A light twin pins `#5b2a86` / `#ffffff`. The kind-chip icon is the only rule-1a site in the file left without an assertion (confirmed).

### `HUB_SECTIONS` and the unowned snapshot

```ts
export const HUB_SECTIONS: readonly HubSection[] = [
  { key: 'planned', …, color: HUB_SECTION_COLOR.light.planned },
  …
```

The w2-plan's instruction for `TripDetailScreen.tsx:143` is: "Move the colour read into render, or a factory taking `t`; don't keep a module-scope colour." But `HUB_SECTIONS` is exported, and `tripStructureRegression.test.tsx` snapshots it with the light hexes, so any reshaping needs an edit to an unowned test. Stopping and reporting matches the design's out-of-ownership row. The cost is that `.light.*` is none of the allowed read forms (`P[t.scheme].k`, `usePalette(P).k`, or a single `const` alias). The guard therefore can't see it, and the audit logs it as a DIFF (`#5b2a86 −2`, `#7e57c2 −2`, `#f6c343 −2`, `#6b6480 −1`). A grep across `apps/mobile/src` finds `HUB_SECTIONS` used only by that regression test, and nothing reads `.color`. The risk is limited to a future consumer painting with it and silently getting light values in dark (confirmed).

### Park pills and the category placeholder glyph

In `parkColorsFor(t)`, the Animal Kingdom pill text keeps `t.color.success` rather than `parkAccent['Animal Kingdom']`, because the original `#2e9e6b` is the success token, not the AK hue `#3fa34d`. The tint still uses the AK accent. The result is light-identical, but the pill's text and tint come from two different sources.

In `TripSummaryScreen` and `TripFeedScreen`, the `ExperienceThumb` placeholder moved from `tint` to `fill`, which is the same `#7e57c2` in light. The glyph became a pair `{ light '#5b2a86', dark textOnPrimary }`. A literal rule-1a reading ("primary icon on a surface") would give `primaryFg`. But the glyph sits on a category fill, not a surface, and white on the dark fills is the pairing Property 22 guarantees. The coder flagged the choice, and the dark test asserts both the glyph colour and the painted-ancestor `categoryVisual.Ride.fill`.

### Private `withAlpha` in `TripFeedScreen`

`TripFeedScreen` keeps its pre-existing private `withAlpha(hex, a)`, which only parses 6-digit hex and returns `NaN` channels for anything else, with no error. It now receives theme- and palette-sourced inputs: `color.*` tokens and `DARK_TONAL.*.fg` via `FEED_TONE`. All of these are 6-digit today (`theme.ts:558+`), so the current output is correct. A future `rgba` palette value fed into `meta.tone` would render transparent with no error (likely). The shared `theme.withAlpha` throws on unsupported input. Switching to it would close this gap. That is outside this batch's mandate, so it is not listed as an action.

### Test coverage

All 11 owned test files gained a `dark mode` block with (a), (b) and (c) assertions plus a light-parity twin. Dark values come from `darkTheme` or the palette's `.dark`. The section files are covered through their host screens: `GroupFavoritesSection` in `TripDetailScreen.test`, and both Attached sections in `TripDetailScreen.{experienceLists,foodLists}.test`, including the rule-2a empty tint and border. The (d) test switches a mounted `TripsListScreen` to dark and asserts the past-badge row repaints from `TRIP_ROW.light.pastBg` to `.dark.pastBg`.

Not tested:
- `ResortPickerModal`, `RodeWithConfirmScreen` and `TripInviteScreen` have no render test.
- `TripGuestManagementModal` renders only in the unowned `TripGuestManagement.test.tsx`, which has no dark assertion.
- The active kind-chip icon colour in `TripReservationsScreen` is unasserted.

</details>

<details>
<summary>File map</summary>

- `AttachedExperienceListsSection.tsx` / `AttachedFoodListsSection.tsx`: makeStyles; 5 rule-2a sites each; `#eee` unavailable row → palette.
- `ExperiencePicker.tsx`: bare `categoryVisual` import → `t.categoryVisual`; scrim, break-feedback, staged-row and rule-4 success fill → `PICKER`.
- `GroupFavoritesSection.tsx`: heart/count pill → `GROUP_FAVORITES`; 2 rule-2a sites.
- `ResortPickerModal.tsx`, `RodeWithConfirmScreen.tsx`, `TripEditScreen.tsx`, `TripInviteScreen.tsx`: token reads; `TextInput` keyboard/placeholder props.
- `TripDetailScreen.tsx`: `statusMetaFor`/`parkColorsFor` factories; `HUB_SECTION_COLOR.light` reads; glance/hub-tile/avatar/past-hero/progress palettes; rule-0 shadows.
- `TripFeedScreen.tsx`: reaction/feed-type/rode-with factories; avatar/CTA/scrim palettes; `extraData={t.scheme}`; 4 `textDefault` spreads.
- `TripGuestManagementModal.tsx`: error tint → `GUEST_MANAGEMENT`.
- `TripMembersScreen.tsx`: `roleMetaFor`; avatar fills → `MEMBER_AVATAR`; scrim.
- `TripPlannedListScreen.tsx`: `getParkColor(park, t)` → `parkAccent`; reservation/sched badges; `withAlpha(primary, 0.10)`.
- `TripReservationsScreen.tsx`: rule-1a chip text/icon → `textOnPrimary`.
- `TripsListScreen.tsx`: `STATUS_LABEL` + `statusMetaFor`; `TRIP_ROW`/`TRIPS_MODAL` palettes.
- `TripSummaryScreen.tsx`: hero/medal/stat/misc/avatar palettes; category fill split.
- 11 new `*.palette.ts`; 11 owned tests (additive `dark mode` blocks).

Full diff: `git diff --no-index -- "$env:TEMP\dark-mode-snapshot\B5\screens\trips\<file>" apps/mobile/src/screens/trips/<file>`; tests: `git diff -- apps/mobile/src/screens/trips/__tests__/`.

</details>
