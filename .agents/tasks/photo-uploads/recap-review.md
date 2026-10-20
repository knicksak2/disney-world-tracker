# Shared Trip Recap reuses Summary components with aggregate-only figures

The shared recap payload gains three Trip-wide counts (`totalCompletionsCount`, `totalRatingsCount`, `parksExploredCount`) and optional catalog fields (`park`, `category`, `imageUrl`) on each top-rated row. `TripRecapScreen` is rebuilt on five presentational components extracted from `TripSummaryScreen` into `screens/trips/summary/`, with no Member Contributions section. The privacy boundary is intact: the projection is an explicit-key literal that never reads `perMember`, and the tests pin the exact key sets and a sentinel no-leak assertion at the route layer. The spec is amended additively and consistently.

Watch for: nothing blocking. Two minor notes (confirmed): the extraction added non-visual accessibility props to the owner Summary screen, which is stricter than a literal reading of 15.24; and the coder's `%TEMP%\recap-verify.txt` no longer exists, so the full-gate tail rests on the report, though I re-ran the narrow suites below and they are green.

**Verdict**: APPROVED

## High-level view

Server side, `projectRecapFigures` stays the single allowlist choke point. It returns a literal object, defaults absent totals to `0`, derives `parksExploredCount` from the distinct parks of `parkBreakdown`, and builds top-rated rows from three required keys plus conditionally spread catalog keys. Nothing is spread from the summary and `perMember` is never touched, so no per-person value can reach the response.

The route, the Friend re-check gate, the port and `composeServices.ts` were not touched (file mtimes pre-date this change: route 10/18 8:23 PM, gate/ports 10/18 5:27 PM, composeServices 10/18 5:47 PM, against projection 10/19 1:16 AM). The collapsed `validation_failed`, `recap: null` handling, `Cache-Control: private, no-store` and kill-switch behaviour are therefore unchanged by construction, and the route tests re-assert the header and the null shape.

On mobile the screen keeps its loading, error, collapsed, `recap: null` and photos branches verbatim and swaps only the figures block for the shared hero, tile grid, award card and top-rated row. `TripSummaryScreen.test.tsx`, `tripStructureRegression.test.tsx` and its `.snap` were not edited in this change (mtimes 10/18, before the refactor at 10/19 1:21 AM) and pass under `jest --ci`, which refuses to write snapshots.

The spec carries D34, ACs 15.21 to 15.24, Property 43 with a Validates line, task 22.7 citing every new AC, and wave 37 in the dependency graph.

<details>
<summary>Issues (3)</summary>

1. **Summary a11y tree changed (minor, confirmed)** — the shared components add `accessibilityRole="header"` on section titles and an `accessible` plus `Average rating X out of 10` label on the rating pill, which now also apply to the owner `TripSummaryScreen` (`summary/SummarySectionHeader.tsx:28`, `summary/TopRatedMomentRow.tsx:79-80`). Visual output is identical and the Summary tests pass, but 15.24 says the extraction SHALL NOT change what the Summary renders. Either state "visual output" in 15.24 or make these props opt-in as plan decision 5 allowed.
2. **Full-gate output not independently corroborated (minor, confirmed)** — `%TEMP%\recap-verify.txt` is gone, so the 487/322/45 file counts and `VERIFY_EXIT=0` come from the report only. I did not re-run the full gate. I re-ran the narrow suites that matter for the boundary (results below) and they pass.
3. **Spec validator not run (minor, confirmed)** — no `get_diagnostics` tool was available to the coder or to me. Format was checked by reading: only `[ ]`/`[x]` checkboxes appear in the 22.7 region, Property 43 has a `**Validates: ...**` line with the colon inside the bold, JSON graph ends cleanly at wave 37. Run the Kiro spec diagnostics once in the editor.

</details>

<details>
<summary>Details</summary>

### Allowlist projection and the leak boundary (checklist 1, 2)

`apps/api/src/services/sharing/tripRecapProjection.ts:25-72` returns an object literal with eight explicit keys (`distinctExperienceCount`, `plannedCompletedCount`, `plannedTotalCount`, `totalCompletionsCount`, `totalRatingsCount`, `parksExploredCount`, `superlatives`, `topRated`). Spread appears only inside per-row conditionals that add one named catalog key (lines 44-49) and per-superlative optional keys (lines 34-36, unchanged D26 mapping); the summary object itself is never spread. `perMember` has zero occurrences in the file apart from comments. The totals fall back to `0` (lines 59-60), never to a sum over `perMember`. `experienceId` is not copied into the row. Confidence: confirmed.

The sentinel tests exist and assert the right things.

At the route layer (`tripRecapRoutes.test.ts`, "route payload: exact figure and top-rated key sets..." around lines 813-975) a fixture carries sentinel `memberId`, display name, avatar preset, top-rated experience name, `experienceId`s and the numbers 918273 to 918276 inside `perMember` and a superlative `memberId`. It asserts against the serialized `res.body` that none of those strings or numbers appear and that `perMember`, `memberId`, `experienceId`, `actor_id`, `avatarPreset`, `logEntryCount`, `confirmedTagCount` keys are absent. It then asserts `Object.keys(recap).sort()` equals a literal 8-key list written inline (not imported), the full top-rated row keys equal the literal `['category','experienceName','imageUrl','meanRating','park','ratingCount']`, and the catalog-less row has exactly the three required keys. The fourth row is asserted dropped.

At the pure layer (lines ~376-490) the fast-check Property 43 (150 runs, tagged) generates `perMember` with `SENTINEL_` ids, names, avatars and counts, adds an unknown `SENTINEL_EXTRA_KEY` to the summary, and asserts the key set, the row subset-and-required rule, no `SENTINEL_` and none of the forbidden keys in the serialized result, and equality with a result computed from a different `perMember` (metamorphic). I did not run the optional fail-open spot check. The projection never reads `perMember`, so reading the code leaves no doubt that would justify it. Confidence: confirmed.

### Untouched behaviours (checklist 3)

`tripRecapRoutes.ts` still performs the gate resolve (`validation_failed` when the share is missing), the `tripAvailable` check, the `!summary` check, both returning `recap: null` with `photos: unavailable`, and sets `Cache-Control: private, no-store` on all three exits. The file's mtime pre-dates this change. `tripRecapGate.ts`, `ports.ts` and `composeServices.ts` likewise. The route test asserts the header on the happy path and the route-level sentinel test, and asserts the `recap: null` body has none of the new figure keys. Confidence: confirmed by mtime and reading; the git diff cannot isolate this because the sharing files are untracked.

### Summary screen unchanged (checklist 4)

Run by me with `npx jest --ci` (no snapshot writes): `TripSummaryScreen.test.tsx`, `tripStructureRegression.test.tsx`, `TripRecapScreen.test.tsx`, `themeRetrofit.guard.test.ts` gave 4 suites passed, 48 tests passed, 2 snapshots passed, exit 0. The snapshot and the Summary test file have mtimes of 10/18, before the extraction. `git diff` against HEAD for those files shows earlier, unrelated work (the `TripAlbum` route in the snapshot), not this change. `TripSummaryScreen.tsx` still owns Member Contributions, Adventures by Park, photos and share buttons locally (lines ~317-390, 729) and calls the five shared components at lines 234-296. The a11y additions are noted in Issues.

### No member data on the recap (checklist 5)

A scan of `TripRecapScreen.tsx` and everything in `screens/trips/summary/` finds no `perMember`, `memberId`, `Member Contributions`, `as any`, `as unknown as`, `@ts-ignore` or TODO. The DTO in `packages/shared/src/dto/Photos.ts` has `TripRecapTopRatedDTO` with no `experienceId`, and `TripRecapFiguresDTO` with exactly the eight keys. The shared contract test uses `Record<keyof ..., true>` literals plus sorted key equality and `Extract<keyof ..., Forbidden>` to `never`. The screen test includes a source guard and a runtime-extra-keys check on `screen.toJSON()`.

### Theming and accessibility (checklist 6)

The only colour literals in the new components are three white and black `rgba(...)` values in `SummaryHeroCard.tsx:182,189,214`, moved verbatim from the Summary and allowed by the guard's neutral triples. `themeRetrofit.guard.test.ts` passes. The ring has an `N% of planned experiences completed` label, header roles are present, and values are text, not colour alone.

### Spec amendments (checklist 7)

D34 is at `requirements.md:69`; the status line reads "D25 to D34" (line 365); 15.12 and 15.16 carry the D34 pointer; 15.21 to 15.24 follow at lines 389-392 before Requirement 16. `design.md` has the amended DTO block (lines 269-279), the new component subsection (line 700), the rewritten projection step (line 731), Property 43 with `**Validates: Requirements 15.12, 15.16, 15.21, 15.22, 15.24**` (lines 1258-1262), and the Testing Strategy row. `tasks.md` has 22.7 citing `15.12, 15.13, 15.16, 15.21, 15.22, 15.23, 15.24` (line 291), wave 37 in the graph (line 377), and a dated Notes bullet. Nothing appears deleted or renumbered; the folder is untracked, so there is no diff to prove it, only structure and numbering continuity. Confidence: likely for non-deletion, confirmed for presence.

### Verification evidence

Report shows `npm run verify` exit 0 with api 487 files / 3438 tests, mobile 322 suites / 2518 tests / 2 snapshots, shared 45 files / 576 tests, after one stale-`dist` rebuild disclosed honestly. I re-ran `tripRecapRoutes.test.ts` (18 passed, exit 0) and the mobile suites listed above. The report also admits the new tests were never run against the old code; reading the assertions (eight-key literal, new counts, catalog fields) confirms they cannot pass on the old five-key projection.

</details>

<details>
<summary>File map</summary>

- `apps/api/src/services/sharing/tripRecapProjection.ts` — explicit allowlist with three aggregates and catalog row fields
- `apps/api/src/services/sharing/__tests__/tripRecapRoutes.test.ts` — amended Property 40, new route sentinel test, totals test, Property 43
- `packages/shared/src/dto/Photos.ts`, `dto/index.ts`, `src/index.ts` — `TripRecapTopRatedDTO` and three counts
- `packages/shared/src/__tests__/contracts.phase2.test.ts` — exact-key and forbidden-key guards
- `apps/mobile/src/screens/trips/summary/*` — five extracted components, `summaryFormat.ts`, component tests
- `apps/mobile/src/screens/trips/TripSummaryScreen.tsx` — consumes the extracted components
- `apps/mobile/src/screens/share/TripRecapScreen.tsx` and its test — rebuilt figures block, `RECAP_NO_PLAN_COPY`
- `.kiro/specs/photo-uploads/{requirements,design,tasks}.md` — D34, 15.21 to 15.24, Property 43, task 22.7, wave 37

</details>
