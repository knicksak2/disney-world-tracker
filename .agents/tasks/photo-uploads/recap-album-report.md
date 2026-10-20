# Recap album (D35) final report

Verdict of the review loop: **APPROVED** (recap-album-review.json; four low-severity observations, none blocking).
Nothing was committed, pushed or staged. The work is uncommitted on `develop`, beside unrelated uncommitted changes.

## What changed per FEAT

**FEAT-001 (spec, additive only).** `.kiro/specs/photo-uploads/` (untracked, so `git diff` cannot show it):
- requirements.md: D35 (with veto consequence), D32 heading and body note, 16.8 clause replaced, new 16.10, new 15.25 to 15.33, additive notes on 15.5, 15.13, 20.2, 20.9, 26.7, a Glossary entry (Recap_Album) and the Intro visibility bullet.
- design.md: matrix row, `TripRecapPhotosDTO` and `tripRecapPhotosQuerySchema` blocks, Recap album paragraph, routes table, mobile paragraph, Properties 44 and 45, Error Handling rows, Testing Strategy row, Configuration sentence.
- tasks.md: tasks 21.6 and 22.8 (unchecked), waves 38 and 39, Notes bullet.
- The Kiro spec-format validator was NOT run (not available); the format checklist was applied by hand.

**FEAT-002 (shared + API).**
- `packages/shared`: `TripRecapPhotosDTO`, `tripRecapPhotosQuerySchema`, exported from `dto/index.ts`, `schemas/index.ts` and `src/index.ts`.
- `GET /me/inbox/:shareId/trip-recap/photos` in `sharing/tripRecapRoutes.ts`. It shares the gate with the recap route through the new `sharing/tripRecapAccess.ts` (`resolveShareAccess`, `photoAccessFor`).
- `RecapPhotoPort.albumPage` and `isAlbumPhoto` in `sharing/ports.ts` and `photos/recapPhotoPort.ts`: explicit columns, serving keys only, keyset paging, block filter.
- `PhotoService.report` and `addBlock` now call `isAlbumPhoto` (D32 widened, D31 unchanged).
- Forced test edits: `fakePhotoPort`, `reportsRepo.test.ts`, the report step 2 (404 to 204), and the `noRevoke.test.ts` route inventory.

**FEAT-003 (mobile).**
- New `photos/dayGroups.ts`, with `TripAlbumScreen` re-exporting from it.
- `PhotoGrid` gained an optional `accessibilityLabel`.
- `photoKeys.recapAlbum`, `fetchRecapAlbum` and `useRecapAlbum` in `photos/api.ts`.
- `TripPhotosSection` recipient `onViewAll` renders `view-all-photos-btn`.
- `TripRecapScreen` navigates to `TripRecapAlbum`, which is registered in `YouAndCrewStack`.
- New `TripRecapAlbumScreen.tsx`, with Report and Block uploader only.

## Source diff audit

Every item in the plan exists in non-test source:
- Route `/me/inbox/:shareId/trip-recap/photos`.
- DTO keys `access/photos/nextCursor`.
- Shared exports in all three index files.
- `albumPage`, `isAlbumPhoto`, `resolveShareAccess`, `photoAccessFor`.
- `TripRecapAlbum` param and `Stack.Screen`.
- `useRecapAlbum`, `photoKeys.recapAlbum` and `recapAlbumAll`.
- testIDs: `view-all-photos-btn`, `trip-recap-album-{loading,list,empty,error,retry,unavailable,not-included,more-retry}`, `recap-album-day-group-*`, `recap-album-day-heading-*`, `recap-album-grid-*`.
- No TODO, FIXME or not-implemented markers in the new sources.
- No stray files at the repo root; the only top-level untracked paths are in-scope directories.
- `git diff --stat` covers tracked files only. Most album files are untracked (`??`) and so absent from it. The tracked modifications to `routes.ts`, `TripsStack`, `RootNavigator`, `TripFeedScreen` and others belong to other uncommitted work. They were not touched or reverted here.

## Behavior to test map

| Behavior | Test file | Concrete assertion |
|---|---|---|
| Route needs a session | `sharing/__tests__/tripRecapAlbumRoutes.test.ts` | no session gives 401 |
| Gate matrix (Property 44) | same | an exhaustive 96-combination loop equals an independent table; 0 calls to `isMember`, `tripName`, `summary` and the port after a failed Friend check |
| Sharer left, Trip gone, PHOTOS_ENABLED=false, includePhotos=false | same | body is `unavailable` or `not_included` with empty photos and null cursor; no URLs minted; `unavailable` wins |
| Contents and ordering | same | only approved, not-blocked photos of the share's Trip, in sort_at desc, id desc order, including ties |
| 9 photos vs 3 highlights | same | the recap returns 3 and the album returns 9 |
| Pagination bounds | same | pages of 2, 2, 1 with a final null cursor; default 40; limit 0, 101, 1.5, abc, unknown key and bad cursor give 400 |
| Exact keys, no identity leak | same | top-level and item key sets are exact; no sentinel name, caption, owner id, `u/` path or bucket in the body |
| Serving keys only | same | `missingGetKeys()` is empty and minted keys match `p/<id>/(full\|thumb).jpg` |
| Cache header | same | `private, no-store` on granted, unavailable and not_included |
| No URLs in logs | same | captured log has no URL host, `X-Amz` or `p/` key |
| Production registration | same | `buildServer` serves the album route with photos on and off |
| Widened report and block | same, plus `tripRecapRoutes.test.ts` step 2 | a non-highlight approved photo with shareId gives 204 and one `photo_reports` row |
| Report and block negatives | `tripRecapAlbumRoutes.test.ts` | other Trip, pending, hidden, blocked, own, includePhotos=false and unfriended cases give 404 `photo_not_found` with the report count unchanged; a block returns no userId and the next album read excludes that uploader |
| D31 unchanged | same | a recipient report is stored `open` and the photo stays approved; a member report hides it |
| Shared gate functions | `sharing/__tests__/tripRecapAccess.test.ts` | `photoAccessFor` 2x2x2 truth table; `resolveShareAccess` throws `validation_failed` on null; source guard against a second inline gate |
| Route inventory | `sharing/__tests__/noRevoke.test.ts` | expected list includes `GET /me/inbox/:shareId/trip-recap/photos` |
| Port SQL | `photos/__tests__/recapPhotoPort.test.ts` | `isAlbumPhoto` false for each ineligible case; zero queries when the flags forbid it; malformed cursor rejects with `validation_failed` |
| Completeness (Property 45) | `photos/__tests__/recapAlbum.prop.test.ts` | fast-check, 100 runs: paging equals the oracle with no duplicates; counters prove ties and multi-page runs occurred |
| Shared schema and DTO | `packages/shared/src/__tests__/photos.test.ts`, `contracts.phase2.test.ts` | valid and invalid limit and cursor cases; DTO key set is `access,nextCursor,photos` |
| View all photos action | `photos/__tests__/TripPhotosSection.test.tsx` | button present with an `onViewAll`; absent in member mode, without the callback, and with no photos; press calls the handler once |
| Recap navigates to the album | `screens/share/__tests__/TripRecapScreen.test.tsx` | params `{ shareId, tripName }`; no button for not_included or unavailable |
| Album screen request, grouping and paging | `screens/share/__tests__/TripRecapAlbumScreen.test.tsx` | GET path and `?cursor=`; `2026-05-02T01:30Z` sits under 2026-05-01; day counts; next-page retry recovers |
| Viewer: Report and Block only | same | report posts `{reason, shareId}`; block posts exactly `{photoId, shareId}`; no delete control |
| Refetch after block | same | a second album GET occurs and the recap key is invalidated |
| Empty, error, unavailable, not_included | same | "No photos to show"; Retry re-requests; collapsed `validation_failed` shows the unavailable copy with no Retry and one request |
| Theme and a11y, source guard | same | dark and light heading colour differ; tiles have role and label; no uploader, delete or add code |
| Registered in the real navigator | `navigation/__tests__/youAndCrewStack.recapAlbum.test.tsx` | the real stack renders the album route |
| Day grouping (Property 45, client half) | `photos/__tests__/dayGroups.test.ts` | New York day examples, DST edge, and a 100-run property |
| PhotoGrid label | `photos/__tests__/PhotoGrid.test.tsx` | custom label, "Guest photo" default, "Photo of X" |
| Hook and key | `photos/__tests__/api.test.tsx` | key is `['photos','recapAlbum',id]` under `photoKeys.all`; `nextCursor` is followed |
| Extraction regression | `screens/trips/__tests__/TripAlbumScreen.test.tsx` | unchanged and green |

Rows with no test: none. This table was compiled from the FEAT findings and the plan. I re-ran the full suite but did not re-read every test body to confirm each assertion.
The reviewer flagged one gap. The report and block negatives have no route-level case for "sharer left the Trip". That case is covered at port level only (`recapPhotoPort.test.ts`).

## `npm run verify` (run once, after `npm run build:shared`, which exited 0)

```
 Test Files  491 passed (491)
      Tests  3517 passed (3517)
All files     |   96.68 |    94.05 |     100 |   97.05 |
Test Suites: 326 passed, 326 total
Tests:       2559 passed, 2559 total
Snapshots:   2 passed, 2 total
> @dwt/shared@0.0.0 test
 Test Files  45 passed (45)
      Tests  581 passed (581)
VERIFY_EXIT=0
```

The api line is the vitest summary from the same run. The "worker process has failed to exit gracefully" Jest notice appears in the mobile output and is known, not new.

## Known limitations (plan section 2)

1. Day-header counts reflect the pages loaded so far. A day that spans a page boundary can read lower until the next page loads. Exact counts would need a server field.
2. A recipient who is also a Trip member sees their own approved photos in the album. Report on one answers `photo_not_found` because the service refuses reporting your own photo and the DTO has no `mine` flag.
3. A current member who reports through a `shareId` is still counted by `countedOpenReports`, which counts by membership. This is existing D31 behavior.
4. Presigned URLs stay valid for up to `PHOTOS_GET_URL_TTL_SECONDS` after a delete or unfriend (R15.11). The album widens how many URLs a Friend can hold, from 6 to up to 100 per page.

## Not verified

- No device or visual check of the new screen.
- The new SQL ran on pg-mem only, not a real Postgres. Cursor `sort_at` precision is milliseconds, and a row written with a microsecond `now()` default would break the "exactly once" paging guarantee (reviewer note).
- The Kiro spec-format validator was not run.
- `composeServices` wiring was checked only through the `buildServer` registration test.
- The four low-severity review observations were not acted on. They are the microsecond cursor precision, the missing route-level "sharer left" negative, the unused `isHighlight` doc comment, and the validator.

## Owner veto summary (D35)

D35 is the owner's choice of option B. A Friend of any member who shares a recap can now see every approved crew photo, not only the highlights, and the crew gets no per-photo say. The only uploader control remains deleting their own photo.

Veto consequence:
- Remove the route `GET /me/inbox/:shareId/trip-recap/photos`.
- Remove `TripRecapAlbumScreen` and the "View all photos" action.
- Remove the `RecapPhotoPort` album methods and `TripRecapPhotosDTO` / `tripRecapPhotosQuerySchema`.
- Revert the widened D32 report and block eligibility (R16.10, 16.8) to "a current highlight".
- Drop R15.25 to 15.33 and 16.10, Properties 44 and 45, and tasks 21.6 and 22.8.
- The recap goes back to highlights only.

Spec tasks 21.6 and 22.8 are still unchecked.
