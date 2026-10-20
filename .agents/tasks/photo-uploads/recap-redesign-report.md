# Recap redesign report (photo-uploads task 22.7, decision D34)

First iteration (no `recap-review.json` existed). Worked on `develop` in place; nothing staged, committed or pushed.

## Files changed

Spec (`.kiro/specs/photo-uploads/`, additive; the folder is untracked in git, so there is no diff to show):
- `requirements.md`: D34 added after D33; "(D25 to D34)" in the Requirement 15 status line; "(extended by Requirement 15.21, decision D34)" appended to 15.12 and 15.16; new 15.21 to 15.24 at the end of Requirement 15.
- `design.md`: `TripRecapFiguresDTO` block amended and `TripRecapTopRatedDTO` added; step 3 of the recap read (the `projectRecapFigures` description) rewritten to the new allowlist; sentence added to Property 40; new subsection "Recap screen reuses the Trip Summary components (Phase 2, D34)"; new `### Property 43: Recap aggregate-only boundary` with `**Validates: Requirements 15.12, 15.16, 15.21, 15.22, 15.24**`; Testing Strategy sharing row extended.
- `tasks.md`: task 22.7 (cites 15.12, 15.13, 15.16, 15.21 to 15.24), wave 37 in the dependency graph plus one prose sentence, dated Notes bullet, "D1 to D34". 22.7 is `[x]` (gate green).
- Spec checks: no `get_diagnostics` tool was available to me. I checked by hand: no checkbox other than `[ ]`/`[x]`; Property 43 has the `**Validates: ...**` line with the colon inside the bold; a read-only PowerShell check over `requirements.md` found 279 acceptance criteria and none uncited by a task `_Requirements:_` line.

Shared: `packages/shared/src/dto/Photos.ts` (new `TripRecapTopRatedDTO`; `totalCompletionsCount`, `totalRatingsCount`, `parksExploredCount` as required numbers on `TripRecapFiguresDTO`), `dto/index.ts`, `src/index.ts` (export), `src/__tests__/contracts.phase2.test.ts`.

API: `apps/api/src/services/sharing/tripRecapProjection.ts` (explicit literal allowlist, no spread, never reads `perMember`), `.../__tests__/tripRecapRoutes.test.ts`. `tripRecapRoutes.ts`, `ports.ts`, `composeServices.ts` are unchanged (Cache-Control `private, no-store`, Friend re-check, collapsed `validation_failed`, `recap: null` and the kill switch are untouched).

Mobile:
- New `apps/mobile/src/screens/trips/summary/`: `SummaryHeroCard.tsx`, `SummaryStatTiles.tsx`, `SummarySectionHeader.tsx`, `SummaryAwardCard.tsx`, `TopRatedMomentRow.tsx` (with `ExperienceThumb`), `summaryFormat.ts`, `__tests__/summaryComponents.test.tsx`. Styles were moved verbatim; no new palette file (reuses `TripSummaryScreen.palette.ts`).
- `TripSummaryScreen.tsx`: now uses the five components (hero, tiles, section headers, award card, top-rated row). Member Contributions, Adventures by Park, photos, share buttons and `MemberAvatar` stay local.
- `TripRecapScreen.tsx` rebuilt on the components; `RECAP_NO_PLAN_COPY` added; `__tests__/TripRecapScreen.test.tsx` amended and extended.
- `TripSummaryScreen.test.tsx`, `tripStructureRegression.test.tsx` and its `.snap` were not edited by me (they show as modified in `git status` from earlier, unrelated work) and pass unchanged.

## Behavior to test map

| Behavior | Test file | Assertion |
| --- | --- | --- |
| Figures key set is exactly the D34 list; no member sentinel leaks | `tripRecapRoutes.test.ts` "route payload: exact figure and top-rated key sets..." | `Object.keys(recap).sort()` equals the literal 8-key list; `res.body` contains none of the SENTINEL ids, names, avatar, experience ids or the numbers 918273 to 918276; no `"perMember"`, `"memberId"`, `"experienceId"`, `"actor_id"`, `"avatarPreset"` |
| Top-rated rows: catalog fields only when present, no `experienceId`, max 3 | same | row 0 keys equal `['category','experienceName','imageUrl','meanRating','park','ratingCount']`; null-catalog row keys equal `['experienceName','meanRating','ratingCount']`; names list has exactly 3 entries (4th dropped) |
| Totals and `parksExploredCount` equal the real summary's | `tripRecapRoutes.test.ts` "totals equal the real derived summary totals..." | built from real `deriveTripSummary` output: `totalCompletionsCount === 5` (= logs + tags), `totalRatingsCount === 3`, `parksExploredCount === 3 === parkBreakdown.length`; top row carries `park/category/imageUrl` |
| Absent totals default to 0, never from `perMember` | `tripRecapRoutes.test.ts` "absent totals and park breakdown default to 0..." | with a `perMember` of 40 + 10 completions, the three counts are 0; sentinel id absent |
| Happy path shape | `tripRecapRoutes.test.ts` happy path | `body.recap` `toEqual` the full 8-key object including the three counts and `park/category/imageUrl` |
| `recap: null` carries no figure key | `tripRecapRoutes.test.ts` "Trip deleted or sharer removed" | serialized body lacks `totalCompletionsCount`, `totalRatingsCount`, `parksExploredCount` |
| Property 40 (amended to the D34 key lists) | `tripRecapRoutes.test.ts` | figures keys equal the 8-key list; row keys equal the 6-key list; no `"experienceId"` |
| Property 43 aggregate-only boundary | `tripRecapRoutes.test.ts` "Property 43..." (fast-check, `numRuns: 150`) | key set equality; row keys within the list and containing the three required keys, catalog keys present iff source non-null; serialized output has no `SENTINEL_` and none of the forbidden keys; totals equal the summary's or 0; `parksExploredCount` equals the distinct-park count; `projectRecapFigures(s)` equals `projectRecapFigures({...s, perMember: other})`; input not mutated; unknown extra keys never emitted |
| DTO has exactly the allowed keys, none forbidden | `contracts.phase2.test.ts` | `Record<keyof ..., true>` literals (compile-time) plus sorted key-list equality for both DTOs; `Extract<keyof ..., Forbidden>` is `never`; full and minimal `TripRecapDTO` type-check |
| Hero: trip name header, pill, ring, N of M | `TripRecapScreen.test.tsx` "hero: trip name as a header..." | `accessibilityRole === 'header'`, text `Shared by Minnie Mouse`, label `78% of planned experiences completed`, `trip-recap-planned-count` has `7 of 9`, no `Vacation Wrap-Up` |
| Pill fallback | same file | empty sharer name renders `Shared recap` |
| Four tiles, labels and bound values | same file | 12 / 31 / 18 / 4 in their own tiles (`within(tile)`); four Summary labels; singular `Distinct Ride` when 1 |
| Awards render with icon mapping and winner fallbacks | same file | `trophy` and `sparkles` icons inside their cards, `Mickey`, `7`, `9.5 ★`; unknown icon gives `ribbon`; no winner gives `The Group` |
| Awards hidden when empty | same file | no `Group Superlatives & Awards`, no `trip-recap-superlatives` |
| Top-rated image / placeholder / rating / count / park | same file | `Image` `source.uri` equals the fixture URL; no-image row has a Ride glyph on the `lightTheme.categoryVisual.Ride.fill` view; `9.5`, `4 ratings`, `1 rating`, `7.3`, `Magic Kingdom`, `EPCOT`, `#1`..`#3`; label `Average rating 9.5 out of 10` |
| Image load error falls back | same file | `fireEvent(image, 'error')` removes the `Image` and shows the category glyph |
| Max 3 rows, hidden when empty | same file | 4th row absent; no `Top-Rated Moments` with `topRated: []` |
| No Member Contributions / member id | same file | `queryByText('Member Contributions')` and `/contributions/i` null; with a payload carrying `memberId`/`perMember` runtime extras, `JSON.stringify(screen.toJSON())` lacks the sentinel id, name and counts; source guard (no `perMember|memberId|Member Contributions`, imports the five components) |
| Empty trip | same file | hero + `RECAP_NO_PLAN_COPY`, no ring label, no `N of M`, four tiles `0`, no section headings, no empty-state text, photo highlight still renders |
| Scheme switch repaints | same file "theme" | flattened tile value `color` equals `darkTheme.color.textPrimary` under dark and `lightTheme.color.textPrimary` under light; placeholder fill is the Ride fill in both (Ride fills are scheme-invariant, so only the text colour differs) |
| States unchanged | existing `TripRecapScreen.test.tsx` tests | loading/error+retry/collapsed `validation_failed`/`recap: null`/photos `granted`, `not_included`, `unavailable`, Report and Block flows all pass (stats testID now `trip-recap-stats` on the tile grid) |
| Shared components in isolation | `summaryComponents.test.tsx` | ring `75%` label and `3 of 4`; congrats pill at 100%; `0 of 0` default vs `emptyPlannedLine` (no ring, no `N of M`); header role only with `titleIsHeader`; tile ids/labels/values; award icon map and winner chain; medal fills gold/silver/bronze/`surfaceAlt`; em dash for NaN; unknown category placeholder; `summaryFormat` clamps, rounding and labels |
| Summary output unchanged | `TripSummaryScreen.test.tsx`, `tripStructureRegression.test.tsx(.snap)` | pass unedited (hero `colors`, painted-ancestor of the compass icon, section title colour, placeholder fill, share text, album navigation) |
| No raw colours / static token reads | `themeRetrofit.guard.test.ts` | passes |

"Would this have failed against the old code": the route tests (exact key sets, new counts, catalog fields) and the DTO key-guard cannot pass against the old five-key projection and DTO; the screen tests assert testIDs, labels and text that the old plain screen did not render. I reasoned this from the diff and did not run the new tests against a checkout of the old code.

## Verification (literal)

`npm run verify` from the repo root, run once at the end (output redirected to `%TEMP%\recap-verify.txt`):

```
 Test Files  487 passed (487)
      Tests  3438 passed (3438)
Test Suites: 322 passed, 322 total
Tests:       2518 passed, 2518 total
Snapshots:   2 passed, 2 total
 Test Files  45 passed (45)
      Tests  576 passed (576)
VERIFY_EXIT=0
```

(api = Vitest 487 files / 3438 tests; mobile = Jest 322 suites / 2518 tests / 2 snapshots; shared = Vitest 45 files / 576 tests. Typecheck for api, mobile and shared ran as part of the script and passed.) Inner-loop runs before that: `npx vitest run src/services/sharing/__tests__/tripRecapRoutes.test.ts` (18 passed); `npx jest src/screens/share src/screens/trips src/photos src/__tests__/themeRetrofit.guard.test.ts` (71 suites, 733 tests, 2 snapshots).

Environment note: the first `npm run verify` attempt failed in `apps/api` typecheck because `@dwt/shared` resolves through its gitignored `packages/shared/dist`, which was stale. I ran `npm run build:shared` (no source change) and re-ran the gate once more; only that second run is reported above. The owner will need the same `npm run build:shared` before the API picks up the new DTO fields outside the test runner.

## Deviations from the plan

- `TripRecapScreen` still has the standalone trip-name heading only for `recap: null`; with figures the trip name is the hero title (as planned).
- I added `${prefix}-total-completions-count`, `-total-ratings-count` and `-parks-explored-count` testIDs on the tile value texts (the Summary previously had no id on those three; non-visual) so tests can pin each binding.
- Added non-visual a11y props not in the old Summary: header role on section titles, and an `accessible` + `Average rating X out of 10` label on the rating pill, `accessibilityIgnoresInvertColors` on the thumbnail. The Summary tests still pass.
- No Zod schema exists for `TripRecapDTO`, so the shared test is type-level plus a runtime key-list check, not a schema test.
- Superlative fixture value changed from `'9.5'` to `'9.5 ★'` in the recap test so the rating pill text `9.5` is unambiguous.

## Not verified

- The visual result on a device or emulator. The owner must `npm run build:shared`, restart the API, reload the app and open the shared recap from the Inbox to see the new hero, tiles, awards and top-rated rows.
- The spec validator (`get_diagnostics`) was not available; the spec was checked by hand as described above.
- The new tests were not executed against the pre-change code.
