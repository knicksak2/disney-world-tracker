# Recap album (D35) fixer notes, iteration 1

## What I checked (cross-FEAT integration + source diff audit)

- `npm run build:shared` ran clean before the gate.
- AC citation: every new AC is cited by task 21.6 or 22.8 in `.kiro/specs/photo-uploads/tasks.md`.
  - 21.6 `_Requirements:_` cites 15.25 to 15.30, 16.8, 16.10, 17.1, 20.2, 20.9.
  - 22.8 `_Requirements:_` cites 15.13, 15.31, 15.32, 15.33, 16.8, 16.10, 17.5, 26.7.
  - All of 15.25 to 15.33 and 16.10 exist as numbered items in `requirements.md` (Requirement 15 has 33 items; Requirement 16 item 10 exists). No `- [/]` markers in the spec files.
- Source audit (grep, non-test sources), every plan item exists:
  - shared: `TripRecapPhotosDTO` (dto/Photos.ts), `tripRecapPhotosQuerySchema` (schemas/Photos.ts), exported from dto/index.ts, schemas/index.ts and src/index.ts.
  - api: route `GET /me/inbox/:shareId/trip-recap/photos` in `sharing/tripRecapRoutes.ts`; `resolveShareAccess` / `photoAccessFor` in `sharing/tripRecapAccess.ts`; `RecapAlbumPage`, `albumPage`, `isAlbumPhoto` in `sharing/ports.ts`; `DefaultRecapPhotoPort.albumPage` / `isAlbumPhoto` in `photos/recapPhotoPort.ts` (explicit columns, serving keys via `photoKeys`); `PhotoService.report` / `addBlock` call `isAlbumPhoto`.
  - mobile: `photoKeys.recapAlbumAll` / `recapAlbum`, `fetchRecapAlbum`, `useRecapAlbum`; `TripRecapAlbum` param and `Stack.Screen` in `YouAndCrewStack.tsx`; `view-all-photos-btn` in `TripPhotosSection.tsx`; `TripRecapScreen` `onViewAll` navigation; every `trip-recap-album-*` and `recap-album-day-*` / `recap-album-grid-*` testID in `TripRecapAlbumScreen.tsx`.
  - No TODO / FIXME / not-implemented markers in any of the new or changed album sources. No stray files at the repo root.

## What I changed

1. First `npm run verify` was RED (exit 1): one api test failed,
   `apps/api/src/services/photos/__tests__/recapAlbum.prop.test.ts` (Property 45) with
   `expected 5 to be greater than 5` on its anti-vacuity counter `stats.multiPageRuns`.
   Root cause: a test-design flaw, not a product bug. `limit` was uniform over 1..100 against at most 40 rows, so
   multi-page runs were rare and the `> 5` guard sat on the edge (a probabilistic flake).
   Fix (test only): weighted the `limit` arbitrary toward small values
   (`fc.oneof` weight 4 for 1..6, weight 1 for 1..100). All assertions and thresholds are unchanged, so the property
   is no weaker; it now exercises paging far more often.
   The test was re-run 11 times standalone and passed every time.

No product code, spec, or other test was changed in this iteration.

## Verification

`npm run verify` (run twice: first red as described above, second after the fix):

```
EXIT=0
 Test Files  491 passed (491)
      Tests  3517 passed (3517)
All files     |   96.68 |    94.05 |     100 |   97.05 |     (planning coverage gate met)
Test Suites: 326 passed, 326 total
Tests:       2559 passed, 2559 total
Snapshots:   2 passed, 2 total
Time:        116.147 s
> @dwt/shared@0.0.0 test
> vitest --run
 Test Files  45 passed (45)
      Tests  581 passed (581)
```

Exit code of `npm run verify`: 0. The root typecheck of all workspaces is part of the script and passed.
The "worker process has failed to exit gracefully" Jest notice and the JSON error log lines in the api output are expected test log output and appear in the green run.

## Not verified

- No device or visual check of the new screen. The Kiro spec-format validator tool was not run (not available in this session; the format checklist was applied by hand in FEAT-001).
- The new SQL was exercised through pg-mem only, not a real Postgres.
