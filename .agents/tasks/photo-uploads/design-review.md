# Design Review: photo-uploads (iteration 4)

Reviewer: fresh-context design review subagent. Docs-only; no builds or tests were run.
Reviewed in full: `.kiro/specs/photo-uploads/{requirements,design,tasks}.md`. Also read: the previous review, `grounding.md` (targeted), `AGENTS.md`, the steering rules, `docs/hosting.md`, and the real code, migrations and sibling specs the spec cites (listed under "Verified Assumptions").

## Verdict: CHANGES_REQUESTED

- HIGH: 0
- MEDIUM: 6
- NIT: 11

The four MEDIUM findings from iteration 3 are closed. I re-walked each fix:

- Strike history now lives in `photo_upload_strikes` (migration 0062), survives the sweep, and `ban-uploader` works on an unswept `deleted` photo (R18.5, R18.11, Property 32, tasks 7.2/10.1/10.2).
- The admin port is named and wired (`AdminRoutesOptions.photos`, R18.12) with a two-direction wiring test.
- Client sizes come from the `Blob`s that are PUT (R3.9, R3.10, Property 33).
- A harm-adapter HTTP 400 is retryable `harm_bad_request` unless its body is on an allow-list populated from a live probe (R6.6, R6.9, R24.4, tasks 6.3/6.6/14.5).

Six MEDIUM findings remain. Each is a place where an implementer following the text literally either cannot build a stated criterion, builds something that diverges from it after the first sweep, or cites something that does not exist. All are small, additive edits.

## Conformance to the requested checks

| # | Check | Result |
| --- | --- | --- |
| 1 | EARS format and numbered ACs | Pass. 25 requirements and 220 numbered ACs. Computed from the files: 220 of 220 ACs are cited by at least one task, 0 dangling task citations, 0 dangling `Validates:` references, 0 malformed checkboxes. |
| 2 | design.md required sections | Pass. Overview, Architecture with a Relationship-to-other-specs table and build order, Components and Interfaces, Data Models, External Interfaces (R2, OpenAI Moderation, Gemini `generateContent`, id mapping), Configuration & Constants (every variable has a name and a concrete default), 34 `### Property N` each with a `**Validates:**` line, Error Handling, Testing Strategy. |
| 3 | Vision verdict in our code, thresholds, retryable errors | Pass. `computeVisionVerdict` is pure over structured fields; defaults 0.6 / 0 faces / 0.25; `anyPersonPartVisible` and `largeText` are never read; model text never shown. Gemini failures retryable (R7.11). Harm 400/429/5xx/timeout handled; other 4xx statuses are unspecified (N3). |
| 4 | Food photos public, no `note` leakage, consistent with friend-food-ratings | Mostly pass. New DTOs, `createdDay`, Friend-only byline, SQL guard. Two defects: the cited friend-food-ratings "R9.2" is a withdrawn requirement (M4), and the guard in task 9.5(a) is a token denylist that misses `user_tz`, which R10.7 forbids (M5). |
| 5 | Trip visibility ties to real permissions, share, feed; three questions decided | Real `MEMBER_ACTIONS` / `ORGANIZER_ONLY_ACTIONS`, real text-only OS share, real closed `trip_feed_items_type_chk`, real `shares` columns. D1/D2/D3 are decided with R15/R14/R13. Gaps in the feed-post mechanics: M1, M2. |
| 6 | Hosting fit | Pass on shape: presigned PUT, `202` confirm, cron sweep, no worker, no Redis, bounded Neon. One gap: unhandled failure of the detached job (M3). |
| 7 | Report, auto-hide, admin queue, block; admin extended additively | Present and wired. |
| 8 | Cost and abuse controls, kill switches | Present with defaults. One unflagged cost claim (M6). |
| 9 | Tasks phased, tests in same task, final verify and map | Pass. |
| 10 | Privacy disclosure and secret rotation | Present (R20.7, R22.1, R22.5 to R22.7, tasks 14.1 to 14.4). No secret-shaped string in the spec folder, `.agents`, or `docs` (grep for the leaked key's prefix and for `AIza`/`sk-` forms found nothing). See N9. |
| 11 | No unverified numbers as fact | One miss: "The OpenAI Moderation endpoint is free" is stated as fact (M6). R2 and Gemini numbers are flagged. |

## Findings

### HIGH

None.

### MEDIUM

**M1. The feed `mine` flag has no data source: `getFeed` does not return the author id, and the design says `getFeed` stays unchanged.**
Where: requirements R14.7; design Shared contracts (`TripFeedItemDTO` paragraph), "Trip posts (Phase 2)", `FeedPhotoPort`; tasks 20.2.
Problem: R14.7, the design and task 20.2 all say the trips route sets `mine` from `trip_feed_items.actor_id = viewerId`. I read `apps/api/src/services/trips/repo.ts` `getFeed` (line ~3984): its SELECT list is `fi.id, fi.type, p.display_name, p.avatar_preset, fi.created_at, fi.metadata, ...` and `TripFeedItemRow` has no author id. The DTO has no actor id either. `FeedPhotoPort.slotsForFeedItems` returns `Map<feedItemId, TripPostPhotoSlotDTO[]>` and no author. The design states "The feed read in `trips/repo.getFeed` stays unchanged". So at the route there is nothing to compare with `viewerId`. This is the sole input to the author's delete control for a post whose slots are all removed (the reason `mine` exists), and to the "author always sees their own post" rule (R14.9). An executor will either invent a field or add a per-item query.
Fix: pick one and state it. Recommended: change the port to `slotsForFeedItems(tripId, viewerId, feedItemIds): Promise<Map<string, { authorId: string; slots: TripPostPhotoSlotDTO[] }>>`, whose single batched query joins `trip_feed_items` (`SELECT id, actor_id FROM trip_feed_items WHERE trip_id=$1 AND id = ANY($2)`) so the route sets `mine = authorId === viewerId` and `authorId` is dropped before the response. Alternatively add `fi.actor_id` to `getFeed`'s SELECT and `TripFeedItemRow` (not to the DTO) and delete the "stays unchanged" sentence. Add a test that a non-author gets no `mine` and the author gets `mine: true` with every slot `removed`.

**M2. Post-slot order is undefined, and a swept photo's `removed` slot disappears, contradicting R13.4, R14.6 and Property 18.**
Where: requirements R13.4, R14.4, R14.6; design `photos` DDL, Sweep step 6, "Trip posts", Property 18; tasks 20.1, 20.2.
Problem, two parts.
(a) R14.4 returns "an ordered list of photo slots", but the `photos` table has no position column and the post-create statement is `UPDATE photos SET feed_item_id=$1 WHERE id = ANY($2)`, which discards the order the client sent. Nothing defines the slot order; the same post can render its photos in a different order from the one the author chose.
(b) A deleted photo's slot is `removed` only while its `photos` row exists. Sweep step 6 hard-deletes `deleted` rows (`DELETE FROM photos`), after which a slot query on `photos WHERE feed_item_id = ...` returns nothing for it. The "photo removed" placeholder therefore vanishes within one sweep interval (up to about 6 hours), and a post whose photos were all swept shows zero slots. Task 20.2's test ("a deleted photo renders `removed`") passes with a `deleted` row and does not describe production after the sweep.
Fix: record the post's ordered photo ids on the feed item and drive the slots from them. In `POST /trips/:id/feed/posts` store `metadata = { caption, photoIds: [...] }` (the DTO's `metadata` is an open record) and have `slotsForFeedItems` build one slot per id in that order: a present row maps through `tripPostSlotState`, a missing row maps to `removed`. Update R14.4/R14.6, Property 18/22 and task 20.2 with a test that sweeps a deleted photo and still sees a `removed` slot in its original position. Alternatively add `feed_position SMALLINT` to `photos` in 0063 and state that a swept photo's slot is omitted, and reword R13.4/R14.6/Property 18 to say so.

**M3. Failure containment for the detached moderation job and the async sweep is not specified; on Node 22 an unhandled rejection crashes the API.**
Where: design Ports (`Scheduler.run`: "fire-and-forget"), Moderation runner, Sweep (`createSweepRunner`), Error Handling; tasks 8.2, 8.3, 8.4, 9.3.
Problem: confirm returns `202` and starts the job with `Scheduler.run(job)`. The adapters return outcome unions and "never throw for HTTP errors", but the runner also calls `repo` methods (claim, renew, write) that throw on a Neon disconnect or timeout, plus `store.getBytes`, which throws `ObjectTooLargeError`/`ObjectMissingError`. The spec says what to do with the last two and nothing about an unexpected exception. The repo has no `unhandledRejection` handler (grep of `apps/api/src` finds none), so a detached rejection ends the Render process and drops every in-flight photo. The existing Trip booking runner contains this with `void runPass(now).catch(...).finally(...)` (`tripBooking/runner.ts` lines 204 to 208); the photo spec says it mirrors that runner for the sweep but never says to copy the catch, and says nothing for `process()`.
Fix: add to the design (Ports and Error Handling) and a new appended criterion in R8: "THE Photo_Service SHALL contain every detached job: `Scheduler.run` wraps the job in try/catch, logs `photos.job.crashed` at `error` with the photo id and error code (no image data, URLs or keys), leaves the row `pending` so the lease expires and the next trigger resumes it, and never lets a rejection escape. The same containment applies to the async sweep." Add tests in 8.3/8.4: a repo that throws mid-job produces no `unhandledRejection` (spy on `process.on('unhandledRejection')`), the photo stays `pending`, and the sweep runner's `tryStart` releases the single-flight guard after a throw.

**M4. The friend-food-ratings requirement cited for the D8 privacy posture ("R9.2") does not exist: that requirement is withdrawn.**
Where: requirements.md D8 ("`friend-food-ratings` (R3, R9.2)"); design.md Relationship-to-other-specs row for `friend-food-ratings`; any other copy of that citation (the author should grep `R9\.2`).
Problem: I read `.kiro/specs/friend-food-ratings/requirements.md`. Requirement 9 is "(Withdrawn) One-Time Launch Notice" with the single criterion "(Withdrawn; no acceptance criteria apply.)". The claim that D8 "keeps the posture of friend-food-ratings (R3, R9.2)" therefore rests on a criterion that has no content. Check 4 of this review asks the spec to be consistent with friend-food-ratings, and a cold-start executor following the citation finds nothing. R3 (Friend-gated dish ratings list) and R5 (notes and private fields never exposed) do exist and support the posture.
Fix: cite only real requirements: "`friend-food-ratings` R3 (friend-gated, strangers get nothing) and R5 (private fields never exposed)". Re-check every other cross-spec citation in the three files in the same pass.

**M5. The source-level no-leak guard in task 9.5(a) is a token denylist that does not enforce R10.7 or Property 14.**
Where: requirements R10.7; design Property 14; tasks 9.5(a), 8.1.
Problem: R10.7 and Property 14 require that no photos SQL referencing `food_item_logs` selects "any column other than `id`, `user_id`, and `food_item_id`". Task 9.5(a) asserts only that such SQL contains none of `note`, `*`, `SELECT *`, `RETURNING *`, `rating`, `visited_on`, `logged_at`. `user_tz` (a field R10.5 names as forbidden) is not on the list, and any future column added to `food_item_logs` would pass. The guard is the explicit mechanism check 4 asks for, so as written it is weaker than the requirement it claims to pin.
Fix: implement the guard as an allowlist. Extract every `<alias>.<column>` and bare column that resolves to `food_item_logs` in each SQL template under `services/photos/` and assert the set is a subset of `{ id, user_id, food_item_id }`; keep the denylist as a second assertion. Add a negative test (a fixture SQL string selecting `l.user_tz` fails the guard) so the guard is shown to bite.

**M6. A pricing claim is asserted as fact, and the "verify before launch" list omits it: "The OpenAI Moderation endpoint is free".**
Where: design Configuration & Constants, "Budget alert guidance (docs)"; tasks 14.2 (verify list); design Storage notes ("~45k to 100k photos per 10 GB").
Problem: External Interfaces correctly says the endpoint is "described as free but rate limited ... must be verified before launch". The budget paragraph then states it flatly ("The OpenAI Moderation endpoint is free; watch for 429s"), and that sentence is what the runbook and docs tasks will copy. The user's stated worry in this conversation is cost, and the checklist for this review requires that provider pricing and free-tier figures not be asserted unflagged. Task 14.2's verify list covers R2 free-tier limits and OpenAI rate limits and image size, but not OpenAI's price/terms. The storage note's "per 10 GB" also implies a free-tier size the spec says it has not verified.
Fix: reword to "described as free at the time of planning; verify current pricing and terms before launch". Add "OpenAI Moderation pricing and terms" to task 14.2's verify list and to the R21.5 text ("R2 free-tier limits, OpenAI Moderation rate limits and pricing"). Replace "per 10 GB" with "per GB stored" (pure arithmetic: about 4k to 10k photos per GB).

### NIT

**N1. Lease renewal is not fenced, so R8.3's "cannot process the same Photo concurrently" is overstated.** `renewLease` is `WHERE id=$1 AND status='pending'`. A stale job whose lease expired can renew after a second job claimed, keeping both running. Property 30 makes the overlap safe, so this is not a correctness hole. Fix: renew with `AND attempts = $claimedAttempts` (the value returned by the claim) so a stale job's renewal affects zero rows and it exits (the exit-on-zero-rows behaviour already exists in task 8.3).

**N2. R8.11 says unconditionally "delete any copied Serving_Key objects" on `source_changed`; R8.13/R8.17 and the runner pseudo-code say to delete only when the final write succeeded or the status is not `approved`/`hidden`.** A loser that finds a re-PUT or deleted upload object after the winner published would delete served objects if it followed R8.11 literally. Fix: add "subject to Requirements 8.13 and 8.17" to R8.11.

**N3. Harm provider statuses other than 400/401/403/429/5xx are unspecified (404 retired model, 413, 422).** The principle (provider failure never decides a photo) implies retryable. Fix: add "any other non-2xx status maps to `retryable` with code `harm_http_<status>`, logged at `error`" to R6.5, the OpenAI error mapping, and a case in task 6.3.

**N4. The signed `content-length` has no fallback.** R3.10 and the External Interfaces say the URL signs the declared length, but whether `@aws-sdk/s3-request-presigner` signs it with `signableHeaders` is asserted by the adapter test (task 6.2), not known. If it does not, R3.10's rationale is wrong though correctness still holds (HEAD at confirm is authoritative). Fix: state "if the SDK cannot sign `content-length`, sign `content-type` only, keep the HEAD size check, and amend R3.10's wording".

**N5. The sweep's time budget cannot interrupt an in-flight job.** `resumeDue` runs `process()` sequentially (each up to about 124 s) under a 25 s budget. Fix: cap `resumeDue` at `PHOTOS_MODERATION_CONCURRENCY` jobs per sweep and check the budget before starting each, and say so in step 1.

**N6. Restart between PUT and confirm is not handled.** R4.11 lets the app list `uploading` photos after a restart, but nothing re-confirms them; PUT URLs expire in 900 s and the row is expired after 120 min. Fix: in task 13.3 add "on a `useMyPhotos` result containing `uploading` rows with no local upload in progress, call confirm (idempotent); `incomplete` shows the retry state".

**N7. The per-target cap counts `uploading` and `rejected` rows.** Four abandoned initiates block a food log for up to 120 minutes, and a rejected photo blocks a slot for 24 hours unless the owner deletes it. Fix: state it in R5.3, or exclude `uploading` older than 15 minutes (the PUT URL lifetime) from the count.

**N8. Summary-share revocation does not recall URLs already minted.** R15.6 says the next read returns nothing; a URL minted within the last hour keeps working until it expires. Same for a removed Trip member. Fix: add one sentence to R15.6 and the runbook stating the up-to-1-hour residual window (`PHOTOS_GET_URL_TTL_SECONDS`).

**N9. The secret-shaped-string guard patterns do not match the key format that was actually leaked.** Task 9.5(d) matches `sk-` and `AIza` prefixes and a long base64 run on a line containing KEY or SECRET. The key pasted during planning has a different prefix, and the guard scans only `services/photos/` and fixtures, while the Testing Strategy promises "no secret-shaped strings in the spec folder". Fix: add the `AQ.` prefix fragment (built from pieces) and extend the scan to `.kiro/specs/photo-uploads` and `docs/`.

**N10. `AppConfig.photos` will break the admin secret-redaction fixture.** `apps/api/src/services/admin/__tests__/configSecrets.test.ts` builds a complete `AppConfig` literal with sentinel secrets. Fix: in task 3.1 add "update `configSecrets.test.ts` with `photos` sentinel secrets (storage secret, harm key, vision key, cron secret) and assert none appears in `/admin/config`". The page is an allowlist today, so this pins that it stays that way.

**N11. Small consistency items.** (a) `createSweepRunner.tryStart` returns `reason: 'already_running'`, but the runner it says it mirrors returns `'in_flight' | 'debounced'`; say which the route test expects (task 9.3 expects `skipped`). (b) design.md ends with a "Revision notes" section written for the reviewer; a cold-start executor does not need it, move it to `.agents/`. (c) Task 13.6 "Add a photo" attaches to the user's most recent log of the dish; say what happens when that log is at the 4-photo cap (`photo_target_full` and offer a new log).

## Verified Assumptions

Checked directly against the repository in this iteration:

- Migrations: `0061_trip_booking_timeline.sql` is the last file, so `0062`/`0063` are free. `trip_feed_items_type_chk` is last defined in `0018_drop_rode_with_confirmed_feed.sql` as `trip_created, member_joined, completion_logged, rating_recorded`; the `0063` list plus `member_post` is correct. `shares_payload_kind_chk` and `shares_experience_payload_chk` exist (defined in `0001`, widened in `0038` for `pinShowcase`), and the `0063` DDL follows `0038`. `trip_feed_items.actor_id` is `NOT NULL ... ON DELETE CASCADE` (grounding.md).
- `forcePathStyle: true` and `region: 'auto'` appear in `git show f6e9914^:apps/api/src/services/auth/avatarStore.ts`.
- `food_item_logs` columns match R10.5/R10.7 (`id, user_id, food_item_id, visited_on, user_tz, logged_at, rating, note`); `user_id` and `food_item_id` are `ON DELETE CASCADE`, so the no-FK-plus-reaper design is needed. The food-log delete is a repo `DELETE ... WHERE id AND user_id AND food_item_id`.
- `DELETE /trips/:id` exists in `trips/routes.ts` (the lifecycle hook point). `getFeed` is unpaginated and returns all items (so dropping `member_post` items afterwards is safe for paging); `TripFeedItemDTO.type` is `string`, so `member_post` needs no union change.
- Admin: `AdminRoutesOptions` is in `services/admin/routes.ts` and filled by the `admin:` block in `composeServices.ts` (line ~966); the admin files are under `apps/api/src/services/admin/`; `/admin/config` is an allowlist of items.
- `wdwToday(now: Date)` exists in `trips/wdwClock.ts`; migration tests live in `apps/api/src/db/__tests__/migrationNNNN.test.ts`; config tests in `apps/api/src/__tests__/config*.test.ts`.
- Stack: Fastify `^4.28.1`, `pg-mem ^3.0.14`, `vitest ^4.1.9`, `fast-check ^3.21.0` (api); Expo `^56.0.0`, `expo-image-picker ~56.0.18`, `expo-image ~56.0.13`, AsyncStorage `2.2.0`, React Native `0.85.3` (mobile). The `@aws-sdk/*` packages are not yet installed (task 6.2 installs them).
- `docs/hosting.md` line 11 and `README.md` line 84 contain "no object storage" (task 14.1 removes them); `docs/hosting.md` documents the `HEAD` plus 8 KB cron-job.org rule the sweep route reuses.
- Traceability, computed from the files: 220 ACs, 220 cited by tasks, 0 uncited, 0 dangling; 34 properties each with a `Validates:` line with 0 dangling references; no malformed checkboxes; the four required task sections and a valid dependency graph.
- No secret-shaped string in `.kiro/`, `.agents/`, or `docs/`.

## Unverified / Wrong Assumptions

Wrong or unsupported by the codebase:

- "`friend-food-ratings` R9.2" (M4). R9 is withdrawn.
- "The feed read stays unchanged and the route can set `mine` from `actor_id`" (M1). The read does not return `actor_id`.
- "A deleted photo's slot renders `removed`" (M2). True only until the sweep hard-deletes the row.
- "The jobs are fire-and-forget" with no containment (M3). The repo has no unhandled-rejection handler.
- "The OpenAI Moderation endpoint is free" stated as fact (M6).

Unverified (each depends on a live system or a device, and is either flagged "verify before launch" or covered by a launch-gate task):

- OpenAI Moderation request/response shape, image size limit, rate limits, pricing and terms (task 6.6 probe, task 14.5).
- R2: `CopySourceIfMatch`, ETag preservation on copy, signed `Content-Length`, prefix lifecycle rules (tasks 6.5, 14.5).
- AWS SDK `requestChecksumCalculation: 'WHEN_REQUIRED'` with presigned PUTs on the pinned SDK version; whether the presigner signs `content-length` (N4).
- `expo-image-manipulator` drops Exif/GPS on iOS and Android, and `(await fetch(fileUri)).blob()` yields the right `size` and PUTs correctly on device (task 13.10).
- Gemini model ids `gemini-3.5-flash-lite` and `gemini-3.1-flash-lite` still served; paid-tier data terms; pricing (flagged).
- pg-mem support for row-value keyset comparison and `UPDATE ... RETURNING` lease claims (Notes give a fallback).

## Re-review checklist for the author

1. M1: give `mine` a data source (port returns `authorId`, or `getFeed` selects `fi.actor_id`) and fix the "stays unchanged" sentence in the design.
2. M2: store the ordered `photoIds` on the post and drive slots from it, so order is defined and a swept photo still renders `removed`; update R14.4/R14.6, Properties 18/22 and task 20.2.
3. M3: add detached-job and sweep containment (try/catch, `photos.job.crashed`, row stays `pending`) as an appended R8 criterion with tests in 8.3/8.4.
4. M4: replace the "R9.2" citation with R3 and R5 everywhere it appears.
5. M5: make the 9.5(a) guard an allowlist subset check with a negative test.
6. M6: flag the Moderation "free" claim, add pricing to the 14.2/R21.5 verify list, drop "per 10 GB".
7. Fix N1 to N11 as quick consistency edits, append (do not renumber) any new acceptance criteria, and re-run the spec validator on all three files.
