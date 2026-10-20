# photo-uploads spec: finishing report

Scope: spec editing only (`.kiro/specs/photo-uploads/{requirements,design,tasks}.md`). No application code, migrations, or other specs were touched. Nothing was committed. The working tree shows only `.kiro/specs/photo-uploads/` and `.agents/tasks/photo-uploads/` as untracked.

## 1. Design summary (10 lines)

1. One shared pipeline: client resizes to JPEG (1280 px long edge, quality 0.75) plus a 320 px thumbnail, asks the API for two presigned PUT URLs to `u/<id>/...` in a private Cloudflare R2 bucket, PUTs directly, then calls confirm (`202`).
2. Confirm HEADs both objects, records ETags, sets `pending`, and starts moderation in-process. No worker, no Redis polling, no image bytes in Postgres.
3. Harm check (OpenAI Moderation) on every photo, full and thumbnail. Food photos also get a Gemini vision screen; the verdict is computed in our own pure code from structured fields.
4. Approval copies the exact moderated object (ETag-bound) to `p/<id>/...`, verifies it, deletes the upload object, then writes `approved`. Nothing a presigned PUT can still overwrite is ever served.
5. Reads are presigned GETs (1 h) for serving keys only, never proxied; DB CHECKs enforce "approved implies pass verdicts".
6. Food photos are public to signed-in users, anonymous to non-Friends, day-precision only, and never expose the log's `note` or any other column (SQL allowlist guard).
7. Trip photos are members-only. The Album is a view over every trip-target photo; a feed post is a `member_post` item whose ordered `metadata.photoIds` drive its slots. One photo is one row and one lifecycle.
8. The Trip Recap gets a photos section (pure highlight rule, 6 max). A member can send the recap to Friends as a pointer share (new `tripSummary` kind); the Friend reads it through a share-keyed route. The OS text share is unchanged.
9. Report, auto-hide, block-by-photo-id, admin review queue (same-origin POST guard), strikes that survive the sweep, per-user and global daily caps, kill switches.
10. A cron-job.org sweep (`HEAD`, `202`, async, single-flight, contained) resumes stuck photos, expires and deletes objects, reaps orphans, and prunes counters.

## 2. Trip feed and summary sharing: what exists, how the spec adapts

Verified in code (see `grounding.md`, re-checked for the sharing routes):

- Trip summary sharing today is client-only: `TripSummaryScreen` `handleShare` calls React Native `Share.share` with plain text from `formatSummaryShareText`. No link, token, recipient list, or server state. `GET /trips/:id/summary` is member-only.
- The in-app Sharing service has `POST /me/shares`, `GET /me/inbox`, `POST /me/inbox/:shareId/open`, `DELETE /me/inbox/:shareId` (recipient soft delete), `GET /me/shares`, and a sender-gated reactions list. It has no trip payload and no sender revoke or unsend. `pinShowcase` is the pointer-payload precedent.
- The trip feed (`trip_feed_items`) is system events plus reactions and comments. There is no user post. `getFeed` returns all items, with no actor id.
- No URL scheme, `linking` prop, associated domains, or intent filters were found in `apps/mobile/app.config.ts` or `apps/mobile/src/navigation/*.tsx`. I did not search elsewhere, so whether linking is configured is unverified. Nothing in the spec depends on it.

How the spec adapts (final owner decisions applied):

- Feed post is net-new behavior with its own requirement (R14, decision D2). The Album is a view over all trip-target photos (R13, D3). Deleting a photo anywhere deletes it everywhere (R1.6).
- D1 is decided: option B. A member sends the recap to Friends through the existing Sharing service. The payload is a pointer (trip id, name, sharer id and name, `includePhotos`), not a snapshot. Migration `0063` widens the shares CHECKs as `0038` did. The recipient read is `GET /me/inbox/:shareId/trip-recap`, keyed on the share row: the recipient must be a live recipient, the sharer must still be a member, figures are computed live without per-member data, and photos are minted fresh per request after the gate. The inbox card opens a read-only recap (R15.12, R15.13).
- No link, public URL, token route, deep link, domain work, or option C exists (R15.7, R26.4). The OS `Share.share` text stays as it is, with a note that photos cannot ride along.
- No per-photo "keep out of shared recap" flag. I removed `include_in_summary`, `PATCH /photos/:id`, the `photoPatchSchema`, the DTO fields, the toggle, and their tests. To keep ids contiguous I repurposed the slots: R12.7 and R12.10 now state the no-opt-out rule, R15.10 is now the crew notice, and D23 records the decision. The share composer states that the recap includes photos from all crew members (R15.8).
- Highlights are decided as a pure function (D21, R26.6, Property 38, task 5.5): group by the New York calendar day of upload (`wdwToday`), take the earliest photo per day, order chronologically, keep the first `RECAP_HIGHLIGHT_MAX` (default 6). If the Trip has no photos the section is omitted.
- Sender revoke (D22) is left open with the recommendation "out of scope" because the Sharing service has no revoke. I removed the revoke route, the `photo_access_revoked_at` column, and the "Stop sharing" control. Task 21.2 now pins that nothing is built and that a recipient's own inbox delete ends their access. `access` has three values: `granted`, `not_included`, `unavailable`.

## 3. Decision points for the user

| # | Decision | Recommendation / written default | If the user chooses otherwise |
| --- | --- | --- | --- |
| D1 | Trip-summary photos | DECIDED: option B (in-app pointer share to Friends) | Option A-only would drop R15 and tasks 21.x, 22.4; option C (tokenized public link) needs a new requirement and a moderation-maturity decision; not written |
| D2 | Feed posts | Allowed: 1 to 4 photos plus caption, `member_post` | Dropping it removes R14, tasks 20.x, 22.3, and the `0063` feed CHECK change |
| D3 | Album | A view over all trip-target photos, one lifecycle | A separate album copy breaks the single-lifecycle guarantee; do not |
| D19 | Who can delete others' trip photos | Uploader, plus organizer via `delete_any_trip_photo` | Uploader-only drops that action, parts of R12.5 and R14.7, and the organizer controls |
| D5 | Signed-URL TTL | 3600 s (`PHOTOS_GET_URL_TTL_SECONDS`); PUT 900 s; admin 300 s | Shorter means more refetches; longer widens the residual window after deletion (R15.11) |
| D6 | Thumbnails | Client makes a 320 px thumbnail; harm check runs on both objects | Server-side resizing needs `sharp` (512 MB host) or a paid image service, and breaks "no server image processing" |
| D4 | Harm check on trip photos | Yes, every upload, harm only (no food screen) | Skipping it removes the abuse safety net on crew photos |
| D7 | Block-user handling | Minimal block by photo id, hides photos both ways, no unfriend | A broader block (friends, shares, trips) is a follow-up spec |
| D20 | Face / text thresholds | 0 faces, text fraction 0.25, food confidence 0.6 (starting values, env vars) | Tune via env after the 100-photo evaluation (task 12.2) |
| D20 | Per-user caps | 20/day user, 2000/day global, 4 per food log, 300 per trip, 4 per post | All env vars; the global cap is the automatic cost ceiling |
| D8 | Food photo byline | Name shown to Friends only; strangers see none | Naming everyone changes R10.5, R11.7, R17.1, Property 14, and several tasks; needs explicit confirmation |
| D23 | Per-photo recap opt-out | DECIDED: none | Reintroducing it needs a column, route, UI toggle, and a recipient-side filter |
| D21 | Highlight rule | DECIDED: one per upload day, earliest, chronological, cap 6. Assumptions: day = upload day (not capture time or trip dates); more than 6 days keeps the first 6 | Last 6 days or capture-day grouping is a one-line change to the pure function and Property 38 |
| D22 | Sender revokes a share | OPEN. Recommend out of scope (no sender revoke exists today) | Wanting it means a new `shares` column, a route, one more read gate, and a UI control |
| D16 | Crew notice | One-time Album notice; composer line "includes photos from all crew members" | Removing it hides the trade-off below from members |

Accepted trade-off (owner decision): any member who shares a recap exposes crew members' approved photos to the sender's Friends, and the crew members cannot opt out. Their only control is deleting their own photo, which removes it everywhere.

## 4. Additive amendments needed in other specs (listed, not edited)

- `admin-panel`: new "Photo review queue" requirement, design section, and task, plus a note that photo POSTs carry a same-origin check and that existing Trigger_Actions would benefit from it (task 10.4).
- `trips`: four new actions in `permissions.ts` (`upload_trip_photo`, `post_feed_photo`, `share_trip_summary` for members; `delete_any_trip_photo` for organizers); `member_post` added to the feed type CHECK; optional `photos` and `mine` fields on `TripFeedItemDTO`; a trip-delete hook; the feed route calls the optional `FeedPhotoPort`.
- Sharing service (`social-sharing-loop`): new `tripSummary` payload kind and widened CHECKs (migration `0063`); no sender revoke is added.
- `notification-center`: `ShareDeliveredNotice` gains a `tripSummary` branch.
- `food-item-logging`: an optional `PhotoLifecyclePort` on the log-delete route; no DTO or schema change.
- `friend-food-ratings`: no edit. The citation was corrected to R3 and R5; its R1, R2, and R9 are withdrawn.
- Non-spec files touched later by tasks: `docs/hosting.md`, `README.md`, `render.yaml`, `apps/api/.env.example`, `configSecrets.test.ts`.

## 5. Assumptions that could NOT be verified

- Cloudflare R2: free-tier limits; whether the dashboard supports prefix-scoped expiry rules; whether `CopySourceIfMatch` is honored and the ETag preserved on copy; whether it enforces a signed `Content-Length`; AWS SDK `WHEN_REQUIRED` checksums with presigned PUTs; whether the presigner signs `content-length` at all (fallback is written, R3.11).
- OpenAI Moderation: live request and response shape, image size limit, rate limits, and pricing and terms. It is described as "documented as free at the time of writing"; that is not verified. `PHOTO_HARM_INVALID_IMAGE_CODES` stays empty until the live probe (task 14.5) observes a corrupt-file response.
- Gemini: that `gemini-3.5-flash-lite` and `gemini-3.1-flash-lite` are still served; paid-tier pricing and data terms.
- Devices: that `expo-image-manipulator` drops Exif/GPS on iOS and Android, and that `(await fetch(uri)).blob()` yields the right size on a real device (task 13.10).
- pg-mem support for row-value keyset comparison and `UPDATE ... RETURNING` claims (fallbacks are written in the task notes).
- App linking: unverified, and not needed by the chosen design.
- The Kiro spec validator was **not run**. See section 7.

## 6. Counts

- Requirements: 26 (25 original plus the new Requirement 26).
- Acceptance criteria: 242, all cited by at least one task (computed).
- Correctness properties: 38 (new: 35 post slot order and placeholders, 36 job containment, 37 per-target cap counting, 38 recap highlights).
- Tasks: 94 numbered entries: 24 top-level groups and 70 sub-tasks, of which 5 are checkpoints (4, 11, 15, 23, 24) and 4 are manual launch gates (12.2, 13.10, 14.3, 14.5). New tasks: 5.5, 19.4, 22.6. Repurposed: 21.2, 21.3, 22.4.
- Phases: 3 (Phase 1 shared pipeline plus food photos; Phase 2 trip photos, recap, recap share; Phase 3 future, no tasks).
- Structural checks I ran (read-only, inline): AC citations (0 uncited, 0 dangling), every `### Property N` has a `**Validates:**` line with resolvable numbers (0 dangling), every sub-task and checkpoint id appears exactly once in the dependency graph, only `- [ ]` / `- [x]` checkboxes, and no secret-shaped strings (`sk-`, `AIza`, `AQ.` shapes) in the three files.

Review findings addressed: M1 (author id via `FeedPhotoPort`, R14.11, Property 35, task 20.2), M2 (ordered `metadata.photoIds`, persistent `removed` slots, R14.10), M3 (`runContained`, R8.19, Property 36, tasks 8.3/8.4), M4 (citation fixed to R3/R5), M5 (allowlist guard with negative tests, R10.7, task 9.5), M6 (pricing wording and verify list, R21.5, task 14.2). N1 (fenced renewal, R8.20), N2 (R8.11 qualifier), N3 (R6.10), N4 (R3.11), N5 (R19.13), N6 (R4.12), N7 (R5.12, Property 37), N8 (R15.11), N9 (task 9.5 scan scope and `AQ.` shape), N10 (`configSecrets.test.ts`, task 3.1), N11 (`in_flight` reason, revision notes removed from design.md, full-log message R11.8).

## 7. Review status and format validation

- The previous reviewer-gated loop ended at its iteration cap. I addressed its latest findings (6 MEDIUM, 11 NIT) and then applied three rounds of owner decisions on trip photos, without an independent re-review. A fresh review is recommended before implementation. The Phase 2 rewrite (recap share, highlight rule, flag removal) has had no independent read at all.
- `get_diagnostics` is not available to me in this session. I could not run the Kiro spec format validator on any of the three files, so I cannot claim they validate. Please run the Kiro Spec Format diagnostics on `requirements.md`, `design.md`, and `tasks.md` and fix anything it reports. The required headings, `### Property N` with `**Validates:**`, and `- [ ]`-only checkboxes were checked by my own scan only.
- Edits were additive except where the owner's decisions required a change. Reworded in place (ids kept): D1, D16, R12.7, R12.10, R15.2, R15.3, R15.5, R15.6, R15.8, R15.10, R15.11, and the whole of Requirement 26. Removed because of the no-flag decision: `include_in_summary`, `PATCH /photos/:id`, `photoPatchSchema`, `photo_access_revoked_at`, `PHOTOS_SHARE_MAX_PHOTOS`, the revoke route, and their tests. The old "Revision notes" section was removed from `design.md`, as review N11 asked.

## 8. Secrets

The Gemini key pasted into chat earlier is exposed. Rotate it before any use, and keep every key only in environment variables (Render, `.env` files that stay uncommitted). No key or key-shaped string is in the spec files, and none is in this report. Task 14.3 covers rotation.

## 9. Addendum: experience-page "Photos from guests" strip (additive amendment, undated)

Spec editing only: no application code, no other spec edited, nothing committed.

Why: Requirement 11.5 put food photo strips and a gallery only on each dish row in `MenuScreen`. The server already had restaurant-wide lists (R11.2) and task 13.3 names `useRestaurantFoodPhotos`, but no requirement placed that data on a screen. Owner decision D24 adds a read-only strip on the experience page.

New ids (nothing deleted or renumbered):

- Requirement 27 (15 acceptance criteria, 27.1 to 27.15). Decision D24 and three glossary terms (`Experience_Photo_Strip`, `Restaurant_Photos_Sheet`, `Restaurant_Food_Photo`). Two sentences added to the Introduction Phasing paragraph and one Out of Scope bullet (photos of a ride or attraction itself stay Phase 3).
- Correctness Property 39 (strip: bounded count, order kept, approved only, blocked omitted, label present, absent when empty, no-leak restated for the new item shape; Property 14 is untouched). `**Validates: Requirements 27.2, 27.3, 27.7, 27.8, 27.11, 27.12, 27.13**`.
- Tasks 1.5 (shared `RestaurantFoodPhotoDTO`, `foodGalleryQuerySchema`, `experienceStripMax`), 3.3 (config, `.env.example`, `render.yaml`, `configSecrets.test.ts` fixture), 9.6 (restaurant gallery `foodItemName`, `limit`, config route; pg-mem repo test, route tests, Property 39 server half), 13.11 (strip, restaurant sheet, `PhotoGallerySheet` extraction, `Menu` focus param, RNTL tests for every interaction). Graph: 1.5 and 3.3 in wave 2, 9.6 in wave 12, 13.11 in wave 21. All 15 new ACs are cited by a task.
- New config variable `PHOTOS_EXPERIENCE_STRIP_MAX` (default 8, integer 1 to 24, validated only when `PHOTOS_ENABLED`), exposed to the app as `experienceStripMax` on `GET /photos/config`.
- design.md: Overview sentence, shared-contract additions, routes table row, new section "Experience page guest photo strip", config row, relationship rows (`catalog-redesign`, `experience-detail-redesign`, `restaurant-menu-display`; cross-references only, none edited), error-handling rows, testing-strategy row.
- Counts in section 6 are now: Requirements 27; Properties 39; four more sub-tasks (98 numbered entries by the same count that gave 94 before).

Deviations from the brief, all recorded in design.md: (1) the strip count is an API env var surfaced through the config route, not a mobile-only constant; (2) `Menu` gets an optional `focusFoodItemId` param because the real `MenuScreen` takes only `experienceId` and cannot target a dish (a dish on no menu still opens its gallery sheet); (3) restaurant gallery routes get `limit`, since no gallery route had a query schema; (4) the strip sits in the Today lens dining branch only; (5) the shared viewer keeps its own-photo Delete; (6) "restaurants, bars, lounges, quick-service" are gated as category `Restaurant`, verified in the enum and `gating.ts` but not against catalog data.

Locations: not applicable. No user-submitted-location detail screen exists in `apps/mobile` (locations appear only in sheets and lists), so no location strip; the component takes a `kind` so a future screen can reuse it.

Still open: photos of rides and attractions themselves (Phase 3, an `experience` attach point) are not added and are not specified. Verification: structural checks were run inline (see the final message); the Kiro spec validator (`get_diagnostics`) was not available to me, so it has not been run on the three files. `npm run verify` was not run because only spec markdown changed.

## 10. Final review fixes (2026-10-18)

Spec editing only: no application code, no other spec edited, nothing committed, no new review loop started. Source: `.agents/tasks/photo-uploads/final-review.md` (1 HIGH, 12 MEDIUM, 7 NIT). Edits were additive or amending in place; no requirement, AC, property, or task id was deleted or renumbered. New ids start at the next free number.

### Finding -> what changed -> new ids

- **H1** (recap never re-checks the Friendship) -> Friendship re-check on every recap read and every `shareId` report/block, before any Trip data is read; same collapsed `validation_failed`; unfriending added to the D22 consequences, R15.6 and R15.11; Property 21's generator and the 21.3 matrix gained the Friend dimension and an unfriend-after-send test; 22.4 reuses `InboxScreen`'s `stillFriend` pre-check. New: R15.14, D25. Amended: R15.3, R15.6, R15.11, R15.12, R15.13, Property 21.
- **M1** (`superlatives` typed `string[]`) -> `TripRecapSuperlativeDTO` / `TripRecapFiguresDTO` allowlist, never `memberId`, `memberDisplayName` allowed; R15.12 reworded to "no member ids and no per-member contribution counts or ratings"; 21.3 sentinel test aligned. New: R15.16, D26, Property 40 (`projectRecapFigures`).
- **M2** (undefined behavior when Trip gone or sharer left) -> `200` with `recap: null` and `photos.access: 'unavailable'`, card text "This recap is no longer available"; figures moved into a nullable `recap`; tests for both cases assert no figure and no URL. New: R15.15, D27. Amended: Property 21, Error Handling rows.
- **M3** (kill switch removes recap route; raw `photoIds` leak) -> recap route owned by the Sharing side and always registered, `unavailable` when `PHOTOS_ENABLED=false`; the trips feed route drops `photoIds` and returns an empty `photos` array when the `FeedPhotoPort` is absent. New: R14.14, R15.17, R20.9, D28, Property 42. Amended: R20.2, tasks 20.2, 21.3.
- **M4** (no cross-service port) -> `TripShareFacts`, `RecapShareGate`, `RecapPhotoPort` defined in design.md "Sharing wiring"; `composeServices.ts` builds the facts from `tripRepo` and the pool; the route calls `tripRepo.getSummary` (noted that `deriveTripSummary` takes a prepared `TripSummaryInput`). New: R15.18, task 21.4 (port and wiring plus its tests; the recap route's registration test is in 21.3).
- **M5** (highlights grouped by `created_at`) -> grouped by `photos.sort_at`, input renamed `sortAt`, tie-break `(sortAt, id)`; D21 records that upload day is replaced and why (the owner did not pick it deliberately). New: R13.8, D29. Amended: R13.7, R15.5, R26.6, Glossary Summary_Strip, Property 38, tasks 5.5, 19.4, 21.3, 22.1.
- **M6** (post link race) -> `FOR UPDATE` validating read plus guarded `UPDATE ... RETURNING id`, rollback with `validation_failed` on a short count; double-create test. New: R14.12, Property 41. Amended: R14.2, task 20.1.
- **M7** (post delete not scoped) -> load `WHERE id AND trip_id = :id AND type = 'member_post'` else `trip_not_found`; foreign-trip and wrong-type tests. New: R14.13. Amended: R14.7, Property 22, task 20.1.
- **M8** (departed-uploader deletion contradicted) -> uploader may delete their own Trip photo regardless of membership (authorized on `owner_id`); R12.6 limited to reads, uploads, posts; D19 rationale reworded; removed-member delete/read tests in 19.2. New: R12.11, D30. Amended: R12.5, R12.6, D19, Property 18.
- **M9** (one report from any recipient hides a photo) -> only a current Trip member's report counts toward auto-hide for Trip photos; a `shareId` report is stored and queued for admin review but does not count; counted in SQL at count time, no new column. New: R16.9, D31, task 21.5. Amended: R16.4, Property 13, task 5.4 (`shouldAutoHide` takes `countedOpenReports`).
- **M10** (R16.8 vs design disagree) -> R16.8 now requires the photo to be a current recap highlight (R15.5); 21.3 cites 15.5. New: D32.
- **M11** (22.4/22.5/22.6 same wave) -> 22.6 owns `TripPhotosSection` (recipient-mode prop), wave 30; 22.4 wave 31 reuses it; 22.5 wave 32; 22.1 moved to wave 29 so the `TripAlbum` route exists before 22.6. New: R26.7. Amended: tasks 22.4, 22.5, 22.6, dependency graph.
- **M12** (no Zod payload schema; unflagged consumers) -> `tripSummarySharePayloadSchema` (strict) added to `sharePayloadSchema` in 17.1 with a shared test that `inboxItemSchema` accepts a `tripSummary` item; explicit consumer checklist (attention destination, `InboxScreen` navigation before the `FriendProfile` fallback, `SentSharesScreen`, `shareBody.ts`, both notification unions, `NotificationCenterScreen`) in 21.1 (api/shared) and 22.4 (mobile), each with a behavior test. New: R15.19. Amended: 17.1, 21.1, 22.4, Notes.
- **N1** -> `RECAP_HIGHLIGHT_MAX` renamed `PHOTOS_RECAP_HIGHLIGHT_MAX` in all three files (config table, tasks 3.1/3.2/14.1/19.4/21.3, `.env.example`/`render.yaml` lists); the docs guard now covers it by its prefix.
- **N2** -> `BEGIN;`/`COMMIT;` in the `0063` snippet, task 18.1, and a file-text assertion in 18.2.
- **N3** -> `unavailable` wins over `includePhotos=false` (R15.15, D27, Error Handling row, test row in 21.3).
- **N4** -> (a) 20.2 statement count uses the wrapped pg-mem pool; (b) 22.6 asserts a style value changes on scheme switch (and 13.9 likewise for the chip); (c) 21.2 route-inventory guard is an explicit allowlist of registered routes plus a behavior check that the recipient-keyed mutations change no row.
- **N5** -> sharer comes from `shares.sender_id`; payload `sharerId` dropped (five keys); a test where sender and a Friend differ. New: R15.20, D33.
- **N6** -> "D1 to D23" now "D1 to D33" (task 24, Notes); 13.9's scope limited to the files of 13.1 to 13.8 with 13.11 running its own gate.
- **N7** -> "that has food items" removed from R27.1 (category `Restaurant` only).

### New decisions (defaults the owner approved; veto text is in requirements.md)

| Id | Default | If vetoed |
| --- | --- | --- |
| D25 | Recap read and `shareId` photo access re-check the current Friendship | unfriended people keep access until they delete the share; drop R15.14, Property 21's Friend dimension, the unfriend test |
| D26 | Superlatives carry `memberDisplayName`, never an id (the text share already prints the name). **Not explicitly confirmed by the owner.** | drop `memberDisplayName` from the allowlist and assert its absence |
| D27 | Gone Trip or departed sharer: `200`, `recap: null`, `unavailable`; `unavailable` beats `not_included` | collapsed `validation_failed` instead; `recap` non-nullable |
| D28 | Recap route on the Sharing side, survives `PHOTOS_ENABLED=false`; feed drops `photoIds` | recap card cannot be opened while photos are off |
| D29 | Highlights group by `sort_at`. **Not explicitly confirmed by the owner** (they said they did not know what the highlights should be) | revert to `created_at`; bulk uploads give one highlight |
| D30 | An uploader can delete their own Trip photo after leaving. **Not explicitly confirmed by the owner.** | a departed member has no control over their photos |
| D31 | Only current Trip members' reports count toward auto-hide on Trip photos. **Not explicitly confirmed by the owner.** | any recap recipient can hide a photo with one report |
| D32 | A photo is reportable through a share only if it is a current highlight | photo ids become probeable through a share |
| D33 | Sharer is `shares.sender_id`; no `sharerId` in the payload | six-key payload plus an equality assertion |

### Updated counts

- Requirements: 27 (unchanged). Acceptance criteria: 272 (was 257), all cited by at least one task (computed; 0 uncited, 0 dangling). New ACs: 12.11, 13.8, 14.12 to 14.14, 15.14 to 15.20, 16.9, 20.9, 26.7.
- Correctness properties: 42 (was 39). New: 40 (recap figures allowlist), 41 (a photo belongs to at most one post), 42 (photos disabled never leaks and never breaks the recap). Amended: 13, 18, 21, 22, 38.
- Tasks: 100 numbered entries (was 98): 24 top-level and 76 sub-tasks. New: 21.4 (`TripShareFacts` port and Sharing wiring), 21.5 (report counting). Dependency graph: 37 waves (0 to 36); manual launch gates now in waves 35 and 36.
- Decisions: D1 to D33 (D25 to D33 new).

### Verification and what I could not resolve

- Structural checks I ran (read-only, inline PowerShell; nothing left behind): AC citations (0 uncited, 0 dangling), every `### Property N` is followed by an exact `**Validates: Requirements ...**` line whose numbers resolve, properties are sequential 1 to 42, no checkbox other than `- [ ]`/`- [x]`, 100 task ids unique, all 81 sub-task and checkpoint ids appear exactly once in the graph and no graph id is not a task, wave ids sequential, and no secret-shaped string (`sk-`, `AIza`, `AQ.` shapes). The base64-run pattern matched only repository file paths.
- Code facts re-read before writing them in (read-only): `SharingRoutesOptions` has no pool or trips port; the seven Sharing routes; `trip_memberships(trip_id, user_id, role)`; `friendships(user_lo_id, user_hi_id)` with a primary key; `TripSuperlativeDTO` fields; `tripRepo.getSummary(tripId)`; `pinShowcaseSharePayloadSchema` shape; the `pinShowcase` branches in `attention.ts`, `InboxScreen.tsx`, `SentSharesScreen.tsx`, `shareBody.ts`, both notification unions, and `NotificationCenterScreen.tsx`; `InboxScreen`'s `stillFriend` pre-check.
- `get_diagnostics` (Kiro spec validator) is not available to me, so I have not run it; the orchestrator should run it on the three files.
- Not verified: line numbers quoted from the consumers (~530, ~543, ~790, etc.) are as of this reading and may shift; the executor re-reads them. pg-mem cannot prove the `FOR UPDATE` lock or true concurrency; the spec says so and tests the guarded update's semantics instead. That `removeFriend` deletes only the `friendships` row and touches no share rows is taken from the review's verified assumptions, not re-read by me. No test, typecheck, or `npm run verify` was run (spec markdown only).
