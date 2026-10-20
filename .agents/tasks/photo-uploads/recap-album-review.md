# Recap album (D35) final review

**Verdict**: APPROVED

The recipient "View all photos" album meets every checklist item I could confirm from code and tests. I re-ran `npm run verify` myself and it exited 0:

- api: 491 test files, 3517 tests passed
- mobile: 326 suites, 2559 tests passed
- shared: 45 test files, 581 tests passed

Watch for: nothing blocking. The four low items below are optional hardening.

## High-level view

The album route sits beside the recap route and calls the same two functions, `resolveShareAccess` and `photoAccessFor`. The gate order is therefore shared by construction. The Friendship primary-key lookup happens inside the gate before `isMember`/`tripName`, and a failed gate throws the collapsed `validation_failed`. The route never touches `tripShareFacts.summary`. Every response sets `Cache-Control: private, no-store`. The kill switch (no port) returns 200 `unavailable`.

`DefaultRecapPhotoPort.albumPage` selects only `p.id, p.sort_at, p.width, p.height`. It filters on `status='approved'`, `target_id` = the share's Trip, and the either-way `user_blocks` NOT EXISTS. It orders by `sort_at DESC, id DESC` with a keyset OR predicate and a `limit+1` lookahead. URLs come from `photoKeys(id)` only, and items are built from six literal keys. The schema allows limit 1..100 and the route defaults it to 40.

`PhotoService.report` and `addBlock` now call `isAlbumPhoto`: approved, same Trip, not blocked either way, gate-checked on every call. The status, own-photo and blocked checks still run first. D31 is untouched because `countedOpenReports` is unchanged.

Mobile adds `view-all-photos-btn` (recipient mode, only when `onViewAll` is given and photos exist). It also adds `TripRecapAlbumScreen`, registered in `YouAndCrewStack`, which groups photos by New York day with counts. The viewer is given `shareId` and `canDelete={false}`. The loading, empty, error+Retry, collapsed/unavailable, not_included and next-page-error states all exist. A block refetches the album because `recapAlbum` lives under `photoKeys.all`, and it also invalidates the recap query.

The spec is amended additively: D35 (with veto consequence), the D32 heading and note, 16.8 in place, 16.10, 15.25 to 15.33, and the 15.5/15.13/20.2/20.9/26.7/Glossary/Intro notes. Properties 44 and 45 have Validates lines. Tasks 21.6 and 22.8 are unchecked, and their `_Requirements_` lines cite 15.25-15.30, 16.10 and 15.31-15.33 (so every new AC is cited). The dependency graph parses as JSON with waves 38 and 39.

## Issues (4, all low)

1. **Cursor precision (possible)**: `sort_at` goes through a JS `Date` (ms) in the cursor. Inserts always pass a JS-Date `sortAt`, so paging is exact today. A row written with the column default `now()` would risk a gap or duplicate. This is optional hardening, and the member album has the same limitation.
2. **Missing route-level negative (confirmed gap in coverage)**: report/block with the sharer gone from the Trip is tested only at port level. Add one route-level case for each.
3. **Verification evidence (confirmed)**: the fixer-notes verify block is condensed, not a literal tail, and the spec validator was not run. My independent re-run was green and I checked the spec format by hand.
4. **Dead `isHighlight` (confirmed)**: it is kept on the port but unused by the service. Add a doc comment or remove it later.

<details>
<summary>Evidence by checklist item</summary>

**(1) Route and gate**
- `tripRecapRoutes.ts` registers `GET /me/inbox/:shareId/trip-recap/photos` after `requireSession`. It parses params and query, calls `resolveShareAccess`, sets the header, calls `photoAccessFor`, then `port.albumPage`.
- `tripRecapGate.resolve` does the share/recipient join, rejects sharer==recipient, then the friendships PK lookup, and only then `isMember`/`tripName`.
- Test `tripRecapAlbumRoutes.test.ts` asserts zero `isMember/tripName/summary/roleOf` calls, zero `albumPage` calls and zero presigns after a failed gate. It covers non-recipient, unknown share, deleted share, Friendship ended mid-session, and a Friend of a different user.
- The Property 44 test is an exhaustive 96-combination loop against an independently written table. It also asserts that the recap route reports the same `photos.access` and that the album never loads the summary.
- Malformed query or cursor returns `validation_failed`. That is the same code as the collapsed gate failure, so it is not an oracle. The cursor is decoded in the port, after the gate.

**(2) Payload and pagination**
- The exact key sets are asserted on the body and on items. The no-leak test checks sender/recipient/uploader ids, trip id, feed id, caption sentinel, `object_key`, `thumb_key`, `u/` and `bucket` against the serialized body.
- Minted keys are asserted against `^p/<uuid>/(full|thumb).jpg$`, and `missingGetKeys()` is empty with the store seeded only with `p/` objects. The rows keep `u/` keys, so reading `object_key` would fail the test.
- Statuses uploading/pending/rejected/needs_review/hidden/deleted, another Trip, and blocks in both directions are excluded.
- The tie order is id DESC (ID_2 before ID_1). The 5-photo limit=2 paging test checks 2/2/1 with a null last cursor.
- `recapAlbum.prop.test.ts` runs 100 fast-check runs against an oracle, with anti-vacuity counters for ties, multi-page runs and non-empty runs.

**(3) Report/block widening**
- The old narrow step (non-highlight photo with `shareId`, expected 404) is now 204. The new test proves the photo is not a highlight and checks the stored report row.
- Negatives, each with nothing recorded: another Trip, six non-approved statuses, blocked either way, own photo, `includePhotos=false`, unfriended, deleted/unknown share.
- D31: a recipient report is stored 'open' and the photo stays approved. A Trip member's report at threshold 1 then hides it.
- Block with `{ photoId, shareId }` returns 201 with no `userId`, and the album afterwards omits that uploader.
- `noRevoke.test.ts` lists the new route.

**(4) Mobile**
- Covered by `TripRecapAlbumScreen.test.tsx` (16 tests), `TripPhotosSection.test.tsx`, `TripRecapScreen.test.tsx`, `dayGroups.test.ts` and `youAndCrewStack.recapAlbum.test.tsx`.
- The New York day test uses `2026-05-02T01:30Z`, which lands under May 1. Counts of "1 photo" and "2 photos" are asserted.
- The report body `{reason, shareId}` and the block body `{photoId, shareId}` are asserted.
- The source guard forbids delete/add/uploader code.
- Light/dark repaint is asserted on a concrete style value.
- The screen source uses only `t.color.*`. No raw colour literals appear in the new sources, and `themeRetrofit.guard.test.ts` is green in the full run.

**(5) Spec**
- D35 is at requirements line 70. The D32 heading carries "widened by D35".
- 16.8 is amended in place. 16.10 and 15.25-15.33 exist. 15.5, 15.13, 20.2, 20.9, 26.7, the Glossary and the Intro are annotated.
- design.md has Properties 44 and 45 with `**Validates: …**`, and 9 mentions of D35.
- tasks.md has 21.6 and 22.8 unchecked, no `- [/]` markers, a Notes bullet, and waves 38 and 39 (40 waves, valid JSON).
- Nothing was found deleted or renumbered. The spec folder is untracked, so there is no diff to prove this beyond reading it.

**(6) Tests and hygiene**
- Every new path has a test that would fail against the old code. The route did not exist, `isAlbumPhoto` did not exist, and the report test previously expected 404.
- No TODO/FIXME found in the new sources. No stray scripts at the repo root. My temporary verify log was deleted.

</details>
