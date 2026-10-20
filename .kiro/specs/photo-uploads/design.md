# Design Document

## Overview

Photo uploads adds one shared pipeline with two attach points. **Food photos** hang off a food-item log and are public on dish and restaurant pages. **Trip photos** hang off a Trip, appear in a Trip Album and in member posts on the Trip feed, and are readable only by Trip members. The member-only Trip Recap (`TripSummaryScreen`) gets a photos section (Requirement 26). A member can send the recap to Friends through the existing Sharing service as a pointer share (decision D1, option B, decided): the Friend reads the recap and its highlight photos (from every crew member's approved photos; there is no per-photo opt-out) through a friend-gated route keyed on the share row. There are no links and no public URLs. Food photos also surface as a read-only "Photos from guests" strip on the experience page for restaurants (Requirement 27, decision D24), fed by the restaurant-wide gallery read that already exists.

The mobile client resizes and re-encodes a photo (long edge 1280 px, JPEG quality 0.75) plus a 320 px thumbnail. Re-encoding through `expo-image-manipulator` is expected to drop EXIF/GPS, but that is an assumption until a real-device check (task 13.10) confirms it, so the server also scans every object for an Exif segment and counts it (Requirement 2.7). The client asks the API for two presigned PUT URLs that point at **upload keys** (`u/<id>/...`), `PUT`s both objects straight to a private Cloudflare R2 bucket, and calls a confirm endpoint. Confirm verifies the objects with HEAD, records their ETags, marks the photo `pending`, returns `202`, and starts moderation in the same process: a harm check (OpenAI Moderation) on every photo, plus a vision food screen (Gemini) on food photos only. The food verdict is computed in our own pure code from the model's structured fields. Only when every required check passes does the server **copy the exact moderated object version** (conditional on its ETag) to a **serving key** (`p/<id>/...`) and delete the upload key; the photo becomes `approved` only after that copy is verified. A photo is visible to others only when it is `approved`, and reads use short-lived presigned GET URLs for serving keys only. Because a presigned PUT URL is reusable until it expires, this upload-key/serving-key split is what guarantees that nothing a client can still write to is ever served.

Everything is designed for the free-tier hosting in `docs/hosting.md`: the API never carries image bytes, there is no always-on worker, there is no Redis polling, Postgres stores only small metadata rows, and housekeeping runs from one extra cron-job.org job that returns `202` fast. Because Render can sleep in the middle of a moderation job, a stuck `pending` photo is also resumed opportunistically when its owner next polls its status, so users do not wait for the next cron tick.

### Key design decisions

1. **One `photos` table with a polymorphic target, no per-kind FKs.** `target_kind` + `target_id` identify the attach row; `scope_id` is the listing scope (the `food_item_id` for food, the `trip_id` for trips). There is deliberately no foreign key from `photos` to `food_item_logs` or `trips`. A Target_Adapter authorizes and reports existence. An FK with `ON DELETE CASCADE` would delete the row and orphan the bucket object, and the repo has no object-deletion hook. Instead `owner_id` is `ON DELETE SET NULL` and the Sweep's orphan reaper soft-deletes any photo whose owner is null or whose target is gone. This covers user, trip, food-log, and food-item cascades with one mechanism. The routes that delete a log or a trip also soft-delete immediately (fast path); the reaper is the safety net.
   - *Alternative rejected:* an `AFTER DELETE` trigger writing keys into an outbox. It is robust, but pg-mem trigger support is uncertain and it hides behavior from tests. The reaper is plain SQL that is testable at the repo layer.
2. **Soft delete, then sweep-delete the object, then hard-delete the row.** A row in `deleted` has no visibility anywhere. The Sweep deletes both objects (idempotent) and then the row. A failed object delete leaves the row for the next sweep.
3. **Presigned PUT directly to R2, to an upload key, with a copy-on-approval to a serving key.** The API never sees bytes. The signature pins `Content-Type: image/jpeg` and signs the declared `Content-Length`: with `@aws-sdk/s3-request-presigner` this is not automatic, so the adapter passes `signableHeaders: new Set(['content-type', 'content-length'])` and the adapter test asserts both appear in `X-Amz-SignedHeaders`. Whether R2 enforces the signed length is not assumed; confirm re-checks size with HEAD, which is authoritative. Whether the presigner actually signs `content-length` is also not assumed (Requirement 3.11): if the adapter test shows it does not, the adapter signs `content-type` only, the HEAD size check stays authoritative, and the "signs the declared length" wording here and in Requirement 3.10 is amended. A presigned PUT URL stays valid and reusable for its 900 s lifetime, so the client could overwrite the object during or after moderation. Three layers close that hole: (a) the PUT URL only ever covers `u/<id>/...`, never a key that is served; (b) confirm records the ETag of each upload object, and the runner refuses to use any object whose ETag differs from the recorded one (a post-confirm overwrite is detected and rejected), also invalidating any partial verdict computed on another version; (c) approval copies upload to serving with `CopySourceIfMatch` set to the recorded ETag and then verifies the destination ETag equals it (the adapter does this check itself, so safety does not depend on R2 honouring the conditional header), then deletes the upload objects. An overwrite after the copy only touches an upload key that is never served and is removed by the sweep and a 7-day `u/` lifecycle rule. *Alternative rejected:* "minimum viable" ETag-only binding while serving from the upload key. It narrows but does not close the window after approval, because the URL stays usable until expiry.
4. **The server never processes images; the client makes the thumbnail.** *Decision D6.* The client uploads a second 320 px object. The cost is that a malicious client can upload a thumbnail that differs from the full image. The mitigation is that the harm check runs on both objects (free, `PHOTO_HARM_CHECK_THUMB=true`), both are sniffed for the JPEG signature, and the thumbnail has a 64 KB cap. The residual risk is that the food screen runs on the full image only, so a modified client could show a face in a food thumbnail that passes the harm check. That is accepted for launch because the report/auto-hide/block/admin path covers it. *Alternatives rejected:* server-side resizing with `sharp` (memory on a 512 MB free instance, and it breaks the "no server image processing" decision), and Cloudflare Images / Image Resizing (paid add-on).
5. **Vision verdict computed in our code.** The model returns structured fields; a pure module applies the thresholds. Flags and face counts vary run to run even at temperature 0, so the model's own verdict is never trusted, and rejection copy comes from our table keyed by the rule that tripped.
6. **Provider errors are retryable, never a rejection.** Only a successful verdict can approve or reject. A 503, 429, timeout, or malformed response leaves the photo `pending` with backoff, and after 6 attempts moves it to `needs_review` for the operator.
7. **Resume without a worker.** Three triggers can start a job: confirm (immediate), the owner's status poll (opportunistic, lease-guarded), and the Sweep. A lease claim in a single conditional `UPDATE` prevents double processing across all three.
8. **Album is a view, feed posts are a join.** A Trip post is a new `trip_feed_items` type `member_post`. Its photos are ordinary Trip photos with `feed_item_id` set. The Album query ignores `feed_item_id`. Deleting a photo flips one row to `deleted`; both the Album and the post slot read that row. Deleting a post deletes its photos (D3).
9. **Recap share is an in-app pointer share to Friends, never a link.** *Decision D1 (option B, decided by the owner).* Today's summary share is OS-sheet text only (`Share.share` of `formatSummaryShareText`), which cannot carry photos, and it stays unchanged. A new `tripSummary` payload kind follows the existing `pinShowcase` precedent but is a pure pointer (trip id, trip name, sharer id and name, `includePhotos`), not a snapshot: the recipient's read-only recap and its photos come from a friend-gated route keyed on the share row (`GET /me/inbox/:shareId/trip-recap`, owned by the Sharing side so it survives the photo kill switch, D28) that re-checks on every call that the recipient is still a Friend of the sharer (D25), loads the figures live through the `TripShareFacts` port, and mints fresh presigned URLs per request after the gate, for the recap highlights (the pure `selectRecapHighlights` of decisions D21 and D29: one photo per New York day of `sort_at`, earliest that day, chronological, at most `PHOTOS_RECAP_HIGHLIGHT_MAX`). There is no per-photo opt-out flag (D23): every approved trip photo of every crew member is eligible, which is an accepted trade-off, and an uploader's only control is deleting their own photo. Sender revocation is not built (D22: the existing Sharing service has none; the recipient's own inbox delete ends their access). No public, token, or deep link exists; the tokenized-link option was rejected for this release.
10. **Kill switches and safe rollout.** `PHOTOS_ENABLED` defaults to false and requires nothing else, so merging and deploying the code cannot break the Render build (the migrate step calls `loadConfig`). The operator turns it on after creating the bucket and keys.
11. **Quota counters are a tiny table.** A per-user per-day counter with a conditional update gives an atomic cap without Redis.
12. **Technology stack (locked on approval).** TypeScript; Fastify 4 + `pg` (existing); Zod; `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` (exact pinned versions, S3-compatible R2); `fetch` (Node 22 global; the repo requires Node >= 22) for OpenAI and Gemini REST calls, with no vendor SDKs; `fast-check` + Vitest (API/shared); Jest + `@testing-library/react-native` (mobile); `expo-image-manipulator` (exact version matched to Expo SDK 56, installed with `npx expo install` and then pinned) and the existing `expo-image-picker` and `expo-image`.
13. **Operator approval keeps the invariant literal.** A `needs_review` photo has no final verdict, so an operator "approve" runs the same ETag check and serving-key copy as the runner, then writes `harm_verdict='pass'`, `vision_verdict='pass'` (food only), and `approved_by_operator=true`. The status machine and two database CHECKs (`status IN ('approved','hidden')` implies `harm_verdict='pass'`, and for `food_log` also `vision_verdict='pass'`) then hold without an exception. *Alternative rejected:* allowing `approved` with null verdicts when an operator approves; it weakens the one invariant every read relies on.
14. **Admin POSTs get a same-origin check.** HTTP Basic credentials are attached by browsers to cross-site form posts, and public food photo ids are visible to every user, so `POST /admin/photos/*` rejects cross-site requests using `Sec-Fetch-Site` / `Origin` (pure function `isSameOriginRequest`). *Alternative rejected:* a per-render hidden token; it adds server state for no gain once same-origin is enforced on modern browsers. The existing admin Trigger_Actions share the weakness and are noted for a separate follow-up in the admin-panel amendment, not changed here.
15. **Batched status polling.** The gateway allows 300 reads per minute per user. Polling each pending photo every 3 s would use 20 reads per minute per photo. One owner-only batched endpoint (`GET /me/photos/status?ids=`) makes the poll cost one read per tick however many photos are pending.
16. **Exif is detected, not trusted away.** A pure scan of the first 64 KB for a JPEG APP1 `Exif\0\0` segment feeds a counter and a `warn` log; the default policy is log-only so a device quirk cannot mass-reject honest uploads, and a config flag switches to reject once real-device testing proves the client strips cleanly.
17. **The public food photo is anonymous to non-Friends.** *Decision D8 (revised).* Report and block are keyed by the photo id (the server resolves the owner), so the byline is not needed for either. The DTO therefore carries `uploader: PhotoUploaderDTO | null`: non-null only for the uploader and the uploader's Friends, resolved per page with one batched `friendships` query. This keeps the `friend-food-ratings` posture (strangers cannot see "named person X ate dish Y"). *Alternative rejected:* a named byline for every signed-in user; it publishes a name, a dish, and a day to strangers for no functional gain.
18. **Leases are renewed per step, and every zero-row write re-reads before cleaning up.** A fixed lease shorter than a slow job lets two jobs overlap. Each job renews its lease before every provider call and before publishing, and the config loader requires the lease to exceed the longest single step. If a job's final conditional write affects zero rows it re-reads the status and removes serving objects only when the photo is not `approved`/`hidden`, so a losing job can never delete the objects behind a served photo. Objects live under `u/` until approval, so a `needs_review` photo has a hard age limit (default 120 h) that is strictly inside the `u/` lifecycle expiry (default 7 days); a missing upload object is an unrecoverable `invalid_image`, not a retry.
19. **A global daily upload ceiling is an automatic stop.** Per-user caps do not bound spend when many accounts each stay under their cap, so `PHOTOS_GLOBAL_DAILY_CAP` (default 2000 per park-calendar day) is reserved with the same conditional-update technique and refuses new uploads with `photo_uploads_disabled`.

## Architecture

### Placement

```
apps/api/src/services/photos/
  domain/                      # pure, no I/O (property-testable)
    visionVerdict.ts           # computeVisionVerdict, parseVisionFields
    harmVerdict.ts             # computeHarmVerdict
    rejectionCopy.ts           # reason -> user message
    statusMachine.ts           # canTransition, applyOutcome
    retryPolicy.ts             # nextAttemptAt, shouldEscalate
    accessPolicy.ts            # canViewPhoto, tripPostSlotState
    quota.ts                   # dayKey, checkCaps
    objectKeys.ts              # photoKeys(photoId)
    reportPolicy.ts            # shouldAutoHide
    albumCursor.ts             # encode/decode keyset cursor
    recapHighlights.ts         # selectRecapHighlights (D21, D29, R26.6)
    sniff.ts                   # isJpeg(bytes)
    exifScan.ts                # hasExifSegment(bytes, maxScanBytes)
  ports.ts                     # ObjectStore, HarmModerator, VisionChecker, Clock, Scheduler, TargetAdapter
  adapters/
    r2ObjectStore.ts           # AWS SDK S3 client + presigner against the R2 endpoint
    openaiHarmModerator.ts     # POST /v1/moderations
    geminiVisionChecker.ts     # POST :generateContent
  targets/
    foodLogTarget.ts           # TargetAdapter for 'food_log'
    tripTarget.ts              # TargetAdapter for 'trip' (Phase 2)
  repo.ts                      # photos, counters, usage (pg)
  reportsRepo.ts               # photo_reports, user_blocks, photo_upload_bans, photo_upload_strikes
  service.ts                   # initiate, confirm, status, delete, list, report, block
  moderationRunner.ts          # claim + pipeline + bounded in-memory queue
  sweep.ts                     # Photo_Sweep + single-flight runner
  routes.ts                    # /photos/*, /me/blocks, /internal/photos/sweep/run
  foodReadRoutes.ts            # dish / experience / location galleries
  tripRoutes.ts                # /trips/:id/photos, /trips/:id/feed/posts (Phase 2)
  recapPhotoPort.ts            # RecapPhotoPort implementation: highlights + isHighlight for a granted share (Phase 2)
  __tests__/
apps/api/src/services/sharing/
  tripRecapRoutes.ts           # GET /me/inbox/:shareId/trip-recap, registered by the Sharing plugin, NOT by the photo plugin (D28, Phase 2)
  tripRecapGate.ts             # RecapShareGate: share row + Friendship re-check + TripShareFacts (D25, Phase 2)
  tripRecapProjection.ts       # pure projectRecapFigures(summary) allowlist (D26, Phase 2)
apps/api/src/services/admin/sameOrigin.ts  # pure isSameOriginRequest(headers) for /admin/photos POSTs (beside the existing admin routes.ts, repo.ts, html.ts, basicAuth.ts)
apps/api/src/services/admin/photoRoutes.ts # /admin/photos queue + actions, registered from the existing admin routes plugin
apps/api/src/scripts/photoVisionEval.ts    # manual evaluation script
apps/api/src/scripts/photoStoreSmoke.ts    # manual live-storage smoke script
apps/mobile/src/photos/pollPlan.ts         # pure: one batched status request per tick
apps/api/migrations/0062_photo_uploads.sql         # Phase 1
apps/api/migrations/0063_trip_photos.sql           # Phase 2
packages/shared/src/constants/photos.ts, dto/Photos.ts, schemas/Photos.ts
apps/mobile/src/photos/        # imagePrep (+ .native), uploadMachine, hooks, components
```

Wiring is by constructor injection in `apps/api/src/composeServices.ts` through structural port interfaces: `services.photos` is an opt-in block on `BuildServerServices`, and a wiring test asserts production registration (an omitted entry silently drops routes). The `foodLog` and `trips` route plugins receive optional ports (`PhotoLifecyclePort`, `FeedPhotoPort`) so they never import the photos service concretely.

**Admin wiring (R18.12).** The admin plugin receives its collaborators through `AdminRoutesOptions` in `apps/api/src/services/admin/routes.ts`, filled by the `admin:` block of `composeServices.ts`. This spec adds one optional field:

```ts
export interface AdminPhotoPort {
  presignGet(key: string, ttlSeconds: number): Promise<string>;           // Object_Store presigner (R9.9, R18.2)
  operatorApprove(photoId: string): Promise<OperatorApproveResult>;       // PhotoService.operatorApprove (R8.12)
}
export interface AdminRoutesOptions { /* existing fields */ readonly photos?: AdminPhotoPort; }
```

`composeServices.ts` sets `admin.photos` only when `config.photos.enabled` is true and leaves it `undefined` otherwise; `undefined` is what selects the degraded mode of R18.10 (no thumbnails, `approve` refused). The queue's database reads (list, remove, restore, dismiss, ban, usage) go through the admin repo and need no port. A wiring test beside the routes wiring test asserts both directions, because an unwired port passes every test that injects fakes and fails only in production.

**Sharing wiring (Phase 2; R15.17, R15.18, decisions D25, D28).** `SharingRoutesOptions` today carries `repo`, `requireSession`, `emitShareDelivered`, `computeProgressShareStats`, and `resolveSenderDisplayName`; it has no pool and no trips access, and `assertTripMember(pool, userId, tripId)` needs a `DbPool`. The Sharing service therefore gets two new optional structural ports, so `sharing/routes.ts` imports neither the pool nor `trips/repo`:

```ts
// apps/api/src/services/sharing/ports.ts
export interface TripShareFacts {
  roleOf(userId: string, tripId: string): Promise<TripRole | null>;     // null for a non-member, a former member, or a missing Trip (same collapse as assertTripMember)
  tripName(tripId: string): Promise<string | null>;                     // null when the Trip does not exist
  isMember(userId: string, tripId: string): Promise<boolean>;           // current membership only
  summary(tripId: string): Promise<TripSummaryDTO | null>;              // null when the Trip does not exist
}
export interface RecapShareAccess {                                      // what the gate learned about one (shareId, recipient) pair
  readonly tripId: string; readonly sharerId: string;                    // sharerId = shares.sender_id (D33)
  readonly includePhotos: boolean; readonly tripAvailable: boolean;      // tripAvailable = Trip exists AND sharer is still a member
}
export interface RecapShareGate {                                        // null => the collapsed validation_failed
  resolve(shareId: string, recipientId: string): Promise<RecapShareAccess | null>;
}
export interface RecapPhotoPort {                                        // implemented by the Photo_Service; ABSENT when PHOTOS_ENABLED is false
  highlights(access: RecapShareAccess, recipientId: string): Promise<SharedSummaryPhotoDTO[]>;
  isHighlight(access: RecapShareAccess, recipientId: string, photoId: string): Promise<boolean>;
}
```

`composeServices.ts` builds `TripShareFacts` from the existing `tripRepo` and the pool: `roleOf` runs the same membership query `assertTripMember` uses but returns `null` instead of throwing; `tripName` and `isMember` are single-row primary-key reads of `trips` and `trip_memberships`; `summary` calls `tripRepo.getSummary(tripId)` (it takes a trip id and performs the four live reads; `deriveTripSummary` itself takes a prepared `TripSummaryInput` and is not called from Sharing) and returns `null` for a missing Trip. It passes `tripShareFacts` to the Sharing plugin (optional, like `computeProgressShareStats`), builds `RecapShareGate` from the sharing repo, `friendships`, and `TripShareFacts`, and registers `tripRecapRoutes.ts` from the Sharing plugin **always when `tripShareFacts` is wired**. `RecapPhotoPort` is passed only when `config.photos.enabled` is true. The same `RecapShareGate` and `RecapPhotoPort` are also passed to the photos plugin (for the `shareId` branch of the report and photo-id block routes, R16.8), which is registered only when photos are enabled. A wiring test in the style of the existing production-registration tests asserts: with photos enabled the recap route, the gate, and the `RecapPhotoPort` are wired; with photos disabled the recap route is still registered, no `RecapPhotoPort` is passed, and no other photo route exists; with `tripShareFacts` unwired a `tripSummary` create answers `validation_failed`.

### Flow

```
Mobile                        API (Render)                   R2          OpenAI / Gemini
  | pick, resize, thumb         |                              |                |
  |-- POST /photos/uploads ---->| authorize (TargetAdapter),   |                |
  |<-- 2 presigned PUT per photo| quota, insert 'uploading'    |                |
  |    (u/<id>/full|thumb)      |                              |                |
  |-- PUT full + thumb (u/) ---------------------------------->|                |
  |-- POST /photos/confirm ---->| HEAD x2, record ETags,       |                |
  |<-- 202 {results[]} ---------|   -> 'pending', enqueue      |                |
  |                             |-- claim lease                |                |
  |                             |-- GET u/ bytes + ETag ------>| (ETag must equal recorded)
  |                             |-- Exif scan (count/log)      |                |
  |                             |-- harm (full + thumb) --------------------->  |
  |                             |-- vision (food only) ----------------------->  |
  |                             |-- CopyObject u/ -> p/ (If-Match ETag), verify |
  |                             |-- delete u/, set approved/rejected/retry      |
  |-- GET /me/photos/status --->| batched, owner only; if pending+due: resume   |
  |                                                                              
cron-job.org -- HEAD /internal/photos/sweep/run (x-cron-secret) --> 202, async sweep
```

### Visibility and access matrix

`approved` is required for anyone but the owner. "Block" means a Block row in either direction between viewer and uploader.

| Viewer | Food photo (approved) | Trip photo (approved) | Own non-approved photo | Hidden photo |
| --- | --- | --- | --- | --- |
| Uploader | yes | yes | yes, with status chip | yes, "under review" |
| Other signed-in user | yes unless Block | no | no | no |
| Trip organizer | n/a | yes, can delete any | n/a | no |
| Trip member | n/a | yes unless Block | no | no |
| Former or non-member | n/a | no (`trip_forbidden`) | n/a | no |
| Summary-share recipient (a Friend of the sharer who received a `tripSummary` share and is **still** a Friend, re-checked on every read, D25) | n/a | the recap highlights and, through the paginated Recap_Album, every approved Trip photo not blocked either way, through the Summary_Share rules (R15.3, D35) | n/a | no |
| Unauthenticated | no | no | no | no |
| Admin_Panel (Basic auth) | yes | yes | yes | yes; also `needs_review` photos through Upload_Key URLs (300 s, R9.9) |

Who sees the uploader's name on a food photo (D8): the uploader and the uploader's Friends see name and avatar; every other signed-in user sees the photo with `uploader: null` and the generic label "Another guest". Trip photos always show the uploader to members.

| Action | Food photo | Trip photo |
| --- | --- | --- |
| Upload | log owner | `upload_trip_photo` (organizer, member) |
| Delete | uploader (and the log's deletion) | uploader (authorized on `owner_id`, even after leaving the Trip, D30), or organizer via `delete_any_trip_photo` |
| Report | any viewer except the uploader | any viewer except the uploader; only a current Trip member's report counts toward auto-hide (D31) |
| Post to feed | n/a | `post_feed_photo` (organizer, member) |
| Delete any feed post | n/a | organizer via `delete_any_trip_photo`; author deletes own; the post must be a `member_post` of this Trip (R14.13) |

### Relationship to other specs

| Spec | Relationship | Build order |
| --- | --- | --- |
| `trips` | Depends on it: `permissions.ts` (adds `upload_trip_photo`, `post_feed_photo`, and `share_trip_summary` to member actions and `delete_any_trip_photo` to organizer-only), `assertTripMember`, `trip_feed_items`, reactions/comments, cascade R3.7. Additive changes only. | Already built; Phase 2 edits `permissions.ts` and its matrix test. |
| `trip-booking-timeline` | Pattern source: cron endpoint with dedicated secret, `can()` use, migration style, config additions. | Already built. |
| `food-item-logging` | Depends on `food_item_logs` (owner check, deletion hook). No changes to its DTOs or strict schemas. | Already built. |
| `friend-food-ratings` | Reuses its R5 no-leak rules (private fields never exposed) and its source-level guard approach for photo DTOs, and its Friend relation (`friendships`) and privacy posture (R3, friend-gated: strangers get nothing) to gate the food photo byline (D8). Its Requirements 1, 2, and 9 are withdrawn and are not cited. Not edited. | Already built. |
| `trip-expenses` | Receipt photo remains on-device only; not an attach point. Not edited. | Already built. |
| `admin-panel` | Extended by cross-reference: a new "Photo review" section and POST actions, protected by a same-origin check (Requirement 18.9) that the amendment also records as a recommended follow-up for the existing Trigger_Actions. Needs an additive amendment (new requirement, design section, task); task 10.4 appends it without renumbering. | Admin task after the repo/service. |
| Sharing service (`social-sharing-loop`) | Adds payload kind `tripSummary` (a pointer) and a widened CHECK like `0038` (in migration `0063`); no new column on `shares`. Additive: also the strict `tripSummarySharePayloadSchema`, the `TripShareFacts`, `RecapShareGate`, and `RecapPhotoPort` ports, the always-registered recap route (D28), and the Friendship re-check on every recap read (D25). It has no sender revoke today and none is added (D22). | Phase 2. |
| `notification-center` | `ShareDeliveredNotice` gains a `tripSummary` branch. | Phase 2. |
| `catalog-redesign` | Owns `ExperienceDetailScreen`. Requirement 27 is a cross-reference only: the strip is a new child component rendered from `TodayInParkLens`, which adds no state, query, or gate to `ExperienceDetailScreen`. Additive; **no edit to `catalog-redesign` is made.** | With task 13.11. |
| `experience-detail-redesign` | Owns `TodayInParkLens` and `MenuSummaryCard`. The strip is one added element in the `dining` branch; existing section ordering tests stay green. Not edited. | With task 13.11. |
| `restaurant-menu-display` | Owns `MenuScreen`. Gains an optional `focusFoodItemId` route param (additive; every existing navigation is unchanged). Not edited. | With task 13.11 (after 13.6). |
| `dark-mode` | All new mobile UI follows the theme rules and passes the theme guard. | With mobile tasks. |
| `pin-collection` | Not touched. The pin gate does not apply. | n/a |

**Build order:** shared contracts, then migration `0062`, config, pure domain, ports and adapters, repos, service and routes, API wiring, admin queue, mobile Phase 1, docs. Then Phase 2: permissions, migration `0063`, trip target, album (with the `summary` filter), feed posts, the `tripSummary` share and recap read route, mobile Phase 2 (album, upload, feed composer, recap photos section, share composer, inbox recap). Phase 3 is not built.

## Components and Interfaces

### Shared contracts (`@dwt/shared`)

Following the `friend-food-ratings` split: `constants/photos.ts`, `dto/Photos.ts`, `schemas/Photos.ts`, re-exported from `index.ts`, `dto/index.ts`, `schemas/index.ts`.

```ts
// constants/photos.ts
export const PHOTO_TARGET_KINDS = ['food_log', 'trip'] as const;
export type PhotoTargetKind = (typeof PHOTO_TARGET_KINDS)[number];
export const PHOTO_STATUSES = ['uploading','pending','approved','rejected','needs_review','hidden','deleted'] as const;
export type PhotoStatus = (typeof PHOTO_STATUSES)[number];
export const PHOTO_REJECT_REASONS = ['harm','not_food','face_visible','too_much_text','invalid_image'] as const;
export type PhotoRejectReason = (typeof PHOTO_REJECT_REASONS)[number];
export const PHOTO_REPORT_REASONS = ['inappropriate','shows_person','not_food','spam','other'] as const;
export const PHOTO_FULL_LONG_EDGE_PX = 1280;
export const PHOTO_JPEG_QUALITY = 0.75;
export const PHOTO_THUMB_LONG_EDGE_PX = 320;
export const PHOTO_THUMB_JPEG_QUALITY = 0.7;
export const PHOTO_CONTENT_TYPE = 'image/jpeg';
export const PHOTO_REPORT_NOTE_MAX = 300;
export const PHOTO_POST_CAPTION_MAX = 500;
export const PHOTO_MAX_DIMENSION_PX = 4096;
export const PHOTO_PICKER_GUIDANCE = 'Frame just the dish. No people or text.';
export const PHOTO_REJECT_MESSAGES: Record<PhotoRejectReason, string> = {
  harm: "This photo can't be shared in the app.",
  not_food: "This doesn't look like a photo of food or a drink. Try framing just the dish.",
  face_visible: "Photo has a person's face in it. Try framing just the dish.",
  too_much_text: 'Photo has too much text in it. Try framing just the dish.',
  invalid_image: "We couldn't read this image. Try taking the photo again.",
};
```

```ts
// dto/Photos.ts (all fields readonly)
export interface PhotoUploaderDTO { userId: string; displayName: string; avatarPreset: string | null }
export interface PhotoUploadSlotDTO { photoId: string; putUrl: string; thumbPutUrl: string; expiresAt: string }
export interface PhotoInitiateResponseDTO { slots: PhotoUploadSlotDTO[] }
export interface PhotoConfirmResultDTO { photoId: string; result: 'accepted' | 'already' | 'incomplete' | 'invalid' }
export interface PhotoConfirmResponseDTO { results: PhotoConfirmResultDTO[] }   // the 202 body; per-item results, no error thrown for a partial batch
export interface MyPhotoStatusResponseDTO { photos: MyPhotoDTO[] }              // GET /me/photos/status
export interface MyPhotoDTO {            // owner-only, includes status
  id: string; targetKind: PhotoTargetKind; targetId: string; scopeId: string;
  status: PhotoStatus; rejectReason: PhotoRejectReason | null; rejectMessage: string | null;
  thumbUrl: string | null; url: string | null; width: number; height: number;
  feedItemId: string | null; createdAt: string;
}
export interface FoodPhotoDTO {          // public to signed-in users; NO log fields, no second-level timestamp
  id: string; foodItemId: string; thumbUrl: string; url: string;
  width: number; height: number;
  createdDay: string;                    // 'YYYY-MM-DD' America/New_York (R10.5, D18); never a full timestamp
  uploader: PhotoUploaderDTO | null;     // non-null only when mine or the viewer is a Friend of the uploader (D8); no userId otherwise
  mine: boolean;
}
export interface TripPhotoDTO {
  id: string; tripId: string; thumbUrl: string | null; url: string | null;
  width: number; height: number; sortAt: string; createdAt: string;
  uploader: PhotoUploaderDTO; mine: boolean;
  status: PhotoStatus;                    // 'approved' for others' photos
  feedItemId: string | null;
}
export type TripPostSlotState = 'ready' | 'checking' | 'removed' | 'unavailable';
export interface TripPostPhotoSlotDTO {
  photoId: string; state: TripPostSlotState; mine: boolean; status: PhotoStatus | null;
  thumbUrl: string | null; url: string | null; width: number | null; height: number | null;
}
export interface SharedSummaryPhotoDTO { id: string; thumbUrl: string; url: string; width: number; height: number; sortAt: string }
export interface TripSummaryPhotosDTO {
  access: 'granted' | 'not_included' | 'unavailable'; photos: SharedSummaryPhotoDTO[];   // photos = the recap highlights (<= PHOTOS_RECAP_HIGHLIGHT_MAX); 'unavailable' wins over 'not_included' (R15.15)
}
export interface TripRecapSuperlativeDTO {   // projected from TripSuperlativeDTO (packages/shared/src/trips.ts); NEVER memberId or any user id (R15.16, D26)
  readonly id: string; readonly title: string; readonly description: string; readonly icon: string;
  readonly experienceName?: string; readonly value?: string | number;
  readonly memberDisplayName?: string;     // allowed: the OS text share already prints it ("Group MVP: <name>")
}
export interface TripRecapTopRatedDTO {     // one top-rated row (R15.21, D34): catalog-only fields; NEVER experienceId or anything per member
  readonly experienceName: string; readonly meanRating: number; readonly ratingCount: number;
  readonly park?: Park; readonly category?: string; readonly imageUrl?: string;   // public catalog data, present only when the Experience has them
}
export interface TripRecapFiguresDTO {       // allowlist projection of TripSummaryDTO; no perMember, no counts or ratings per member
  readonly distinctExperienceCount: number; readonly plannedCompletedCount: number; readonly plannedTotalCount: number;
  readonly totalCompletionsCount: number;    // Trip-wide aggregates (R15.21, D34); 0 when the summary omits them, never summed from perMember
  readonly totalRatingsCount: number;
  readonly parksExploredCount: number;       // distinct parks in TripSummaryDTO.parkBreakdown; a count, never a list of members
  readonly superlatives: ReadonlyArray<TripRecapSuperlativeDTO>;
  readonly topRated: ReadonlyArray<TripRecapTopRatedDTO>;   // top 3
}
export interface TripRecapDTO {          // GET /me/inbox/:shareId/trip-recap (R15.12): live figures
  readonly tripId: string; readonly tripName: string; readonly sharerDisplayName: string;
  readonly recap: TripRecapFiguresDTO | null;   // null when the Trip is gone or the sharer left (R15.15, D27): then photos.access is 'unavailable'
  readonly photos: TripSummaryPhotosDTO;
}
export interface TripRecapPhotosDTO {   // GET /me/inbox/:shareId/trip-recap/photos (R15.25 to R15.30, D35)
  readonly access: TripSummaryPhotosDTO['access'];        // 'granted' | 'not_included' | 'unavailable'; 'unavailable' wins (R15.26)
  readonly photos: ReadonlyArray<SharedSummaryPhotoDTO>;  // each item has EXACTLY id, thumbUrl, url, width, height, sortAt; `mine` is never set (R15.28)
  readonly nextCursor: string | null;                     // opaque keyset cursor, null on the last page and whenever access != 'granted'
}
export interface PhotoPageDTO<T> { items: T[]; nextCursor: string | null }
export interface PhotoClientConfigDTO {
  enabled: boolean; foodEnabled: boolean; tripEnabled: boolean;
  maxPerFoodLog: number; maxPerTrip: number; maxFeedPostPhotos: number; maxBatch: number;
  maxBytes: number; maxThumbBytes: number; dailyCap: number; remainingToday: number;
}
export interface BlockedUserDTO {         // no userId: unblock is keyed by blockId, so blocking from a photo never reveals the uploader
  blockId: string; displayName: string | null; avatarPreset: string | null;   // name and preset only when the blocker is currently a Friend
  createdAt: string;
}
```

`TripFeedItemDTO` (existing, `packages/shared/src/trips.ts`, which today has `id, type, actorDisplayName, actorAvatarPreset, createdAt, metadata, reactions, comments` and no actor id) gains two optional fields: `photos?: TripPostPhotoSlotDTO[]` and `mine?: boolean`. `mine` is set server-side for `member_post` items only, and its data source is the `FeedPhotoPort` (not `getFeed`, which returns no actor id and stays unchanged, as does the DTO): the port's batched read of `trip_feed_items` returns each post's `actor_id` as `authorId`, the trips route sets `mine = authorId === viewerId`, and `authorId` never leaves the server (Requirement 14.11). The client can therefore show the author's delete control even when every slot is `removed`. The caption and the ordered `photoIds` travel in the existing open `metadata` record (`metadata.caption`, `metadata.photoIds`, Requirement 14.10); the route strips `photoIds` from the returned `metadata` because the slots carry the ids. Adding optional fields is additive and breaks no existing fixture.

```ts
// schemas/Photos.ts (all .strict())
export const photoUploadItemSchema = z.object({
  contentType: z.literal('image/jpeg'),
  byteSize: z.number().int().positive(),
  thumbByteSize: z.number().int().positive(),
  width: z.number().int().min(1).max(4096),
  height: z.number().int().min(1).max(4096),
  takenAt: isoTimestampSchema.optional(),
}).strict();
export const photoInitiateSchema = z.object({
  target: z.object({ kind: z.enum(PHOTO_TARGET_KINDS), id: uuidSchema }).strict(),
  items: z.array(photoUploadItemSchema).min(1).max(10),
}).strict();
export const photoConfirmSchema = z.object({ photoIds: z.array(uuidSchema).min(1).max(10) }).strict();
export const photoReportSchema = z.object({
  reason: z.enum(PHOTO_REPORT_REASONS), note: z.string().trim().min(1).max(300).optional(),
  shareId: uuidSchema.optional(),                                // Phase 2 (R16.8): the tripSummary share the photo was seen through
}).strict();
export const blockCreateSchema = z.union([                       // exactly one of userId or photoId (R17.1); shareId only with photoId (R16.8)
  z.object({ userId: uuidSchema }).strict(),
  z.object({ photoId: uuidSchema, shareId: uuidSchema.optional() }).strict(),
]);
export const tripPostCreateSchema = z.object({
  photoIds: z.array(uuidSchema).min(1).max(4), caption: z.string().trim().min(1).max(500).optional(),
}).strict();
export const tripAlbumQuerySchema = z.object({          // GET /trips/:id/photos (Requirements 13.1, 13.7)
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  summary: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
}).strict();
export const tripRecapPhotosQuerySchema = z.object({     // GET /me/inbox/:shareId/trip-recap/photos (R15.25)
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),   // default 40 applied by the route
}).strict();
```

The server also enforces the per-config byte maximums (`PHOTOS_MAX_BYTES`, `PHOTOS_MAX_THUMB_BYTES`) because those are runtime config; the schema bounds are the static upper limits. `maxItems` for a feed post (4) is also enforced at runtime against `PHOTOS_MAX_FEED_POST_PHOTOS`.

**Byline gating (D8).** For food photos the repo returns `owner_id` and the profile columns to the service, and the service builds `uploader` only when `owner_id = viewerId` or `owner_id` is in `friendIdsAmong(viewerId, ownerIdsOnPage)`, one query per page: `SELECT user_lo_id, user_hi_id FROM friendships WHERE (user_lo_id = $1 AND user_hi_id = ANY($2)) OR (user_hi_id = $1 AND user_lo_id = ANY($2))`. The pure helper `bylineFor({ viewerId, ownerId, friendIds, profile })` returns the `PhotoUploaderDTO` or `null`; `owner_id` is dropped before the DTO is returned. Trip photos always build the uploader (only members can see them). The same helper gates `BlockedUserDTO`'s name for `GET /me/blocks`. Block creation by photo id runs `canViewPhoto` first (so a viewer cannot block the uploader of a photo they cannot see), refuses the viewer's own photo, and resolves `owner_id` on the server; it returns the new `BlockedUserDTO`, which has no user id.

**Uploader byline source.** Every `PhotoUploaderDTO` that is built (food gallery for Friends, Album, `BlockedUserDTO` for Friends, the admin queue's uploader name, which the operator always sees) takes `display_name` and `avatar_preset` from the `profiles` table (`profiles.user_id = photos.owner_id`, as the existing trip `getFeed` does), never from `users`, which holds only identity and credentials. Every repo query that builds a byline joins `profiles pr ON pr.user_id = ...`. A repo test per byline-bearing query asserts the name and preset come back.

**Additions for Requirement 27 (additive; nothing above changes shape).** The restaurant-wide gallery returns a new item type that extends `FoodPhotoDTO`; `FoodPhotoDTO` itself, and so the dish gallery, is untouched. `PhotoClientConfigDTO` gains one required number, and the restaurant routes get a small query schema.

```ts
// dto/Photos.ts
export interface RestaurantFoodPhotoDTO extends FoodPhotoDTO {
  readonly foodItemName: string;   // food_items.name of the photo's scope; the label shown under each thumbnail (R27.3, R27.11)
}
// PhotoClientConfigDTO gains:  experienceStripMax: number;   // PHOTOS_EXPERIENCE_STRIP_MAX, default 8 (R27.13)

// constants/photos.ts
export const PHOTO_EXPERIENCE_STRIP_MAX_DEFAULT = 8;
export const PHOTO_EXPERIENCE_STRIP_HEADING = 'Photos from guests';
export const PHOTO_STRIP_BLANK_DISH_LABEL = 'Dish';

// schemas/Photos.ts (.strict()) - GET /experiences/:id/food-photos and GET /locations/:id/food-photos (R27.12)
export const foodGalleryQuerySchema = z.object({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),   // default 40 (R9.4) applied by the service
}).strict();
```

`foodItemName` is the dish name already exposed to every client by the public `GET /experiences/:id/food-items` route, so it is not a new disclosure. It is not a log field: the gallery SQL reads it from `food_items fi`, which the restaurant gallery already joins (Requirement 11.2), and no `food_item_logs` column is added to any statement (the allowlist guard of Requirement 10.7 is unchanged).

New error codes, each added to `ERROR_CODES` and `errorCodeToHttpStatus`: `photo_not_found` 404, `photo_upload_invalid` 400, `photo_quota_exceeded` 429, `photo_target_full` 409, `photo_uploads_disabled` 503, `photo_uploads_banned` 403. An incomplete upload is not an error code: confirm reports it as the per-item result `incomplete` in the `202` body (`PhotoConfirmResponseDTO`). Existing codes reused: `validation_failed`, `unauthorized`, `trip_forbidden`, `food_log_not_found`, `rate_limit_exceeded`, `internal_error`.

`SHARE_PAYLOAD_KINDS` gains `'tripSummary'` in Phase 2 (see "Summary share (Phase 2)" below), together with a strict `tripSummarySharePayloadSchema` added to `sharePayloadSchema` in `packages/shared/src/schemas/Share.ts` (the discriminated union that `inboxItemSchema.payload` and the sent-shares schema use; the precedent is `pinShowcaseSharePayloadSchema`). Without it the inbox response schema rejects a `tripSummary` item, because TypeScript exhaustiveness does not cover Zod unions:

```ts
// packages/shared/src/schemas/Share.ts (strict; five keys, no sharerId: the sharer is shares.sender_id, D33)
export const tripSummarySharePayloadSchema = z.object({
  kind: z.literal('tripSummary'),
  tripId: uuidSchema, tripName: z.string().min(1),
  sharerDisplayName: z.string().min(1),      // same bound as pinShowcaseSharePayloadSchema.ownerDisplayName
  includePhotos: z.boolean(),
}).strict();
// sharePayloadSchema = z.discriminatedUnion('kind', [experience…, progress…, pinShowcase…, tripSummarySharePayloadSchema])
```

The recipient read adds a `TripRecapDTO` (below) that carries the live recap figures (nullable) and a `TripSummaryPhotosDTO`.

### Ports (`ports.ts`)

```ts
export type CopyOutcome =
  | { kind: 'ok'; etag: string }
  | { kind: 'source_missing' }          // the upload object does not exist (R8.15): unrecoverable, rejected as invalid_image
  | { kind: 'source_changed' }          // If-Match failed (412) or destination ETag mismatch (destination already deleted)
  | { kind: 'retryable'; code: string };
export interface ObjectStore {
  // Only ever called with Upload_Keys (u/...). Content type pinned to image/jpeg. Never called with a Serving_Key (R3.8).
  presignPut(i: { key: string; contentLength: number; expiresInSeconds: number }): Promise<string>;
  presignGet(i: { key: string; expiresInSeconds: number }): Promise<string>;
  head(key: string): Promise<{ exists: false } | { exists: true; contentType: string | null; contentLength: number; etag: string }>;
  getBytes(key: string, maxBytes: number): Promise<{ bytes: Uint8Array; etag: string }>;   // throws ObjectTooLargeError past maxBytes, ObjectMissingError when the key does not exist (NoSuchKey / 404)
  // Server-side CopyObject with CopySourceIfMatch = expectedEtag. After the copy the adapter HEADs the destination;
  // if its ETag differs from expectedEtag it deletes the destination and returns source_changed. This verification
  // is done in the adapter so safety does not depend on R2 honouring the conditional header.
  copy(i: { srcKey: string; dstKey: string; expectedEtag: string }): Promise<CopyOutcome>;
  delete(keys: readonly string[]): Promise<void>;                  // absent key = success
}
export type HarmOutcome =
  | { kind: 'ok'; flagged: boolean; categories: Record<string, boolean>; categoryScores: Record<string, number> }
  | { kind: 'invalid_image' }
  | { kind: 'retryable'; code: string };
export interface HarmModerator { check(jpeg: Uint8Array): Promise<HarmOutcome> }
export type VisionOutcome =
  | { kind: 'ok'; fields: VisionFields; usage: { promptTokens: number; outputTokens: number } }
  | { kind: 'retryable'; code: string };
export interface VisionChecker { check(jpeg: Uint8Array): Promise<VisionOutcome> }
export interface Clock { now(): Date }
export interface Scheduler { run(job: () => Promise<void>): void }   // fire-and-forget; production = queueMicrotask/setImmediate.
// The Scheduler is NOT where failure containment lives (R8.19): the runner and sweep wrap every job they hand to it in
// `runContained` (below), so a synchronous test Scheduler and the production Scheduler behave identically and nothing can
// reject without a catch.
export interface TargetAdapter {
  readonly kind: PhotoTargetKind;
  readonly screen: 'harm_and_vision' | 'harm_only';
  readonly maxPerTarget: number;
  readonly enabled: boolean;
  authorizeUpload(userId: string, targetId: string): Promise<{ scopeId: string }>;      // throws AppError
  canViewScope(viewerId: string, scopeId: string): Promise<boolean>;                    // food: true; trip: membership
  canDeleteOthers(userId: string, scopeId: string): Promise<boolean>;                   // food: false; trip: delete_any_trip_photo
  findOrphanPhotoIds(limit: number): Promise<string[]>;                                 // photos whose target is gone
}
export interface PhotoLifecyclePort { softDeleteForTarget(kind: PhotoTargetKind, targetId: string): Promise<void> }
export interface FeedPostPhotos { authorId: string; slots: TripPostPhotoSlotDTO[] }
// Two batched statements regardless of how many posts the feed holds (R14.5): (1) SELECT id, actor_id, metadata->'photoIds'
// FROM trip_feed_items WHERE trip_id=$1 AND type='member_post' AND id = ANY($2); (2) SELECT the photo rows for the union of the
// listed photo ids (explicit columns, scope_id = tripId). Slots are emitted in `metadata.photoIds` order; a listed id with no
// row (swept) or a `deleted` row becomes a `removed` slot in place (R14.10). `authorId` is used by the trips route to set
// `mine` and is dropped before the response (R14.11).
export interface FeedPhotoPort { slotsForFeedItems(tripId: string, viewerId: string, feedItemIds: readonly string[]): Promise<Map<string, FeedPostPhotos>> }
```

Adapters return outcome unions for every expected failure and never throw for HTTP errors, so the runner is a straight switch.

### Pure domain modules

**`visionVerdict.ts`**

```ts
export interface VisionFields {
  description: string; isFoodOrDrink: boolean; foodConfidence: number;
  prominentFaceCount: number; minorFaceVisible: boolean; anyPersonPartVisible: boolean;
  largeText: boolean; textFraction: number; textSeen: string;
}
export interface VisionThresholds { minFoodConfidence: number; maxProminentFaces: number; maxTextFraction: number }
export const DEFAULT_VISION_THRESHOLDS = { minFoodConfidence: 0.6, maxProminentFaces: 0, maxTextFraction: 0.25 };
export type VisionVerdict =
  | { decision: 'accept' }
  | { decision: 'reject'; reasons: readonly VisionRejectReason[]; primary: VisionRejectReason };
export function computeVisionVerdict(f: VisionFields, t: VisionThresholds): VisionVerdict;
export function parseVisionFields(raw: unknown): { ok: true; fields: VisionFields } | { ok: false };
```

Rules (starting formulas, all thresholds from config):

```
notFood      = !isFoodOrDrink || foodConfidence < minFoodConfidence
faceVisible  = prominentFaceCount > maxProminentFaces || minorFaceVisible
tooMuchText  = textFraction > maxTextFraction
reasons      = [face_visible if faceVisible] ++ [not_food if notFood] ++ [too_much_text if tooMuchText]   // fixed precedence order
decision     = reasons.length == 0 ? accept : reject(primary = reasons[0])
```

`anyPersonPartVisible` and `largeText` are never read. `parseVisionFields` validates with Zod: booleans are booleans, `foodConfidence` and `textFraction` are finite numbers in `[0,1]`, `prominentFaceCount` is an integer `0..50`, strings are truncated (`description` 300, `textSeen` 200). Any violation returns `{ ok: false }`, which the runner treats as retryable.

**`harmVerdict.ts`**: `computeHarmVerdict(r: {flagged, categoryScores}, threshold): 'pass' | 'flag'` returns `flag` when `flagged === true` or when `max(categoryScores) >= threshold` (default 0.5).

**`rejectionCopy.ts`**: `rejectionMessage(reason: PhotoRejectReason): string` reads `PHOTO_REJECT_MESSAGES`. It takes no model text.

**`statusMachine.ts`**: `canTransition(from, to)` encodes the R8.8 table. `applyOutcome(row, outcome, now, cfg)` is the pure decision used by the runner: given the stored verdicts and a new outcome, it returns the next patch (new verdicts, status, `next_attempt_at`). Invariant: `approved` requires `harm_verdict='pass'` and, when the target `screen` is `harm_and_vision`, `vision_verdict='pass'`. There is no exception for operators: `operatorApprove` produces a patch that sets both verdicts to `pass` and `approved_by_operator=true` (R8.12). The same invariant is also a database CHECK (see Data Models), so a buggy writer fails loudly. The module also owns the pure cleanup rule for a lost race (R8.13): `servingCleanupAfterZeroRows(currentStatus): 'keep' | 'delete_serving_keys'` returns `keep` for `approved` and `hidden` and `delete_serving_keys` for every other status, including `deleted` and `rejected`; the runner calls it with the status it re-reads after a zero-row write.

**`retryPolicy.ts`**

```
nextAttemptAt(now, attempts) = now + min(60s * 4^(attempts-1), 6h)       // attempts >= 1
shouldEscalate(attempts, max) = attempts >= max                           // then status = needs_review
```

`applyOutcome` applies `shouldEscalate` at the moment a retryable outcome is recorded (the claim already incremented `attempts`): if `attempts >= max` the patch is `status='needs_review'` immediately, not a `next_attempt_at` up to 6 hours away. The "found due with attempts already at max" case (process died on the last attempt) is handled at claim time and leads to the same state.

**`accessPolicy.ts`**: `canViewPhoto(facts)` where `facts = { viewerId, ownerId, status, kind, viewerIsMember, blocked, context: 'gallery'|'album'|'summaryShare', shareActive }`. `tripPostSlotState({ status, mine, blocked })` maps a photo to `ready|checking|removed|unavailable` by this complete truth table (evaluated top to bottom, first match wins), pinned by an exhaustive test over all statuses x mine x blocked:

| Condition | Slot state | Counts as visible to a non-author (R14.9)? |
| --- | --- | --- |
| `status = deleted` | `removed` | no |
| `blocked` and not mine | `unavailable` | no |
| `status = approved` | `ready` | yes |
| mine and `status` in `uploading, pending, needs_review, rejected, hidden` | `checking` (with `status` carried so the chip renders the reason or "under review") | n/a (author always sees own post) |
| not mine and `status` in `pending, needs_review` | `checking` | yes |
| not mine and `status = rejected` | `removed` | no |
| not mine and `status` in `hidden, uploading` | `unavailable` | no |

`postVisibleToNonAuthor(slots) = slots.some(s => s.state === 'ready' || s.state === 'checking')`.

`readKeysFor({ status, viewer }, photoId)` with `viewer: 'owner' | 'other' | 'admin'` is the pure key-selection rule behind R9.9 and the single source of truth for every URL the service mints. Complete table:

| Status | `owner` | `other` | `admin` |
| --- | --- | --- | --- |
| `approved`, `hidden` | Serving_Keys (`full`, `thumb`) | Serving_Keys (callers still apply visibility: `hidden` is never asked for an `other`) | Serving_Keys |
| `uploading`, `pending` | `uploadThumb` only | nothing | nothing |
| `needs_review` | `uploadThumb` only | nothing | `uploadThumb` and `uploadFull` (300 s TTL, the operator needs the full image because the food screen never completed) |
| `rejected`, `deleted` | nothing | nothing | nothing |

An Upload_Key therefore reaches only the owner (thumbnail) or the Admin_Panel (`needs_review` thumbnail and full image); an `other` viewer never gets one. The function is tested exhaustively over all 7 statuses x 3 viewers.

**`quota.ts`**: `dayKey(now)` returns the America/New_York calendar date via `wdwClock`; `checkTargetCap(current, requested, max)`; `reserveDailyAllowed(count, requested, cap)`.

**`objectKeys.ts`**: `photoKeys(id) = { uploadFull: 'u/' + id + '/full.jpg', uploadThumb: 'u/' + id + '/thumb.jpg', full: 'p/' + id + '/full.jpg', thumb: 'p/' + id + '/thumb.jpg' }`, where `id` must match the UUID regex or the function throws. `photos.object_key` / `thumb_key` store the Serving_Keys; the Upload_Keys are derived from the id (never stored separately).

**`exifScan.ts`**: `hasExifSegment(bytes, maxScanBytes)` walks the JPEG marker segments from `FF D8`, reading each segment length, within the first `maxScanBytes` bytes, and returns true when an APP1 segment (`FF E1`) has a payload starting with `45 78 69 66 00 00` (`Exif\0\0`). It never throws on malformed input (returns false), and never reads past the buffer.

**`isSameOriginRequest(headers)`** (in `apps/api/src/services/admin/sameOrigin.ts`): if `sec-fetch-site` is present, true only for `same-origin`; else if `origin` is present, true only when its host (and port) equals the `host` header; else true (non-browser client; Basic auth still applies).

**`reportPolicy.ts`**: `shouldAutoHide({ status, countedOpenReports, kind }, thresholds)`, where `countedOpenReports` is the number of distinct `open` reporters that count (R16.4, R16.9, D31): for a food photo every distinct open reporter; for a Trip photo only reporters who are **current members of the photo's Trip**. The repo computes it, not the pure function: `countedOpenReports(photoId)` for a `trip` photo is `SELECT count(DISTINCT r.reporter_id) FROM photo_reports r JOIN photos p ON p.id = r.photo_id JOIN trip_memberships m ON m.trip_id = p.scope_id AND m.user_id = r.reporter_id WHERE r.photo_id = $1 AND r.status = 'open'` (no new column; membership is evaluated at count time, so a reporter who later leaves the Trip stops counting, which is documented and tested), and the existing distinct-open-reporter count for a `food_log` photo. A report that arrives through a `shareId` is stored exactly like any other Photo_Report (one per reporter per photo, listed by the admin queue because it has an `open` report), and is simply never a member of the counted set.

**`albumCursor.ts`**: base64url of `{ s: sortAtIso, i: id }`; `decode` returns `null` on any malformed input, and the route turns `null` into `validation_failed`.

**`sniff.ts`**: `isJpeg(bytes)` returns true when the first three bytes are `FF D8 FF`.

### Moderation runner (`moderationRunner.ts`)

```
enqueue(photoId): push to bounded FIFO (max 200). A pump starts up to CONCURRENCY jobs. Overflow is dropped
  from memory and stays 'pending' for the opportunistic resume and the Sweep.

runContained(label, job): the only way a detached job is started (confirm, opportunistic resume, the pump, the sweep's resume step,
  and the async sweep itself). R8.19:
    scheduler.run(async () => {
      try { await job(); }
      catch (err) {
        logger.error({ event: 'photos.job.crashed', photoId: label, code: errorCodeOf(err) }, 'photo job crashed');   // no image data, URL, key, or provider body
        // nothing else: the row is still 'pending' with a lease that expires, so the next trigger resumes it; the attempt was
        // already counted by the claim, so repeated crashes reach attempts >= max and escalate to needs_review (R8.6).
      } finally { releaseSlot(); /* free the concurrency slot / the sweep single-flight guard */ }
    })
  The pump's `.catch` is attached to the same promise the pump awaits, so no promise in the runner is created without a catch.
  The repo throwing (Neon disconnect, timeout), the store's ObjectTooLargeError, and any bug in a pure module all end here.

process(photoId):
  row = claim(photoId)   // UPDATE photos SET lease_until = now()+lease, attempts = attempts+1
                         // WHERE id=$1 AND status='pending' AND next_attempt_at <= now()
                         //   AND (lease_until IS NULL OR lease_until < now()) AND attempts < max RETURNING ...
  if no row: if the photo exists, status='pending' and attempts >= max -> escalate:
             UPDATE photos SET status='needs_review', last_error_code='max_attempts' WHERE id=$1 AND status='pending'
               AND attempts >= max AND (lease_until IS NULL OR lease_until < now())    // R8.6: never move a live final attempt from under itself
             else return.
  adapter = targets[row.target_kind]
  keys = photoKeys(row.id)
  full  = store.getBytes(keys.uploadFull,  maxBytes)      // { bytes, etag }
  thumb = store.getBytes(keys.uploadThumb, maxThumbBytes)
  on ObjectMissingError from either read -> reject(invalid_image)   // R8.15: unrecoverable, never retried, no provider call
  if full.etag != row.full_etag or thumb.etag != row.thumb_etag -> reject(invalid_image)   // R8.10: overwritten after confirm
  if !isJpeg(full.bytes) or !isJpeg(thumb.bytes) -> reject(invalid_image)
  exif = hasExifSegment(full.bytes, N) or hasExifSegment(thumb.bytes, N)
  if exif: usage.exif_present++, log warn; if cfg.exifPolicy == 'reject' -> reject(invalid_image)
  if row.harm_verdict is null:
     renewLease(row.id, row.attempts)   // R8.3, R8.20: UPDATE photos SET lease_until = now()+lease WHERE id=$1 AND status='pending' AND attempts=$2 (the value this job's own claim returned);
                          // zero rows (deleted, or a second job re-claimed after expiry and bumped attempts) -> exit via the R8.13 rule
     h = harm.check(full.bytes); if cfg.harmCheckThumb: h2 = harm.check(thumb.bytes)
     retryable -> recordRetryable (applyOutcome; sets next_attempt_at and lease_until = NULL, R8.5; escalates to needs_review immediately at attempts >= max); return
                  // includes code 'harm_bad_request' (an HTTP 400 whose body is not on the image-decoding allow-list, R6.6), logged at error
     invalid_image -> reject(invalid_image)   // only for a 400 whose body matches PHOTO_HARM_INVALID_IMAGE_CODES (R6.6)
     verdict = computeHarmVerdict(...) for both; persist harm_verdict; if flag -> reject(harm)
  if adapter.screen == 'harm_and_vision' and row.vision_verdict is null:
     renewLease(row.id, row.attempts)
     v = vision.check(full.bytes); retryable or !parse.ok -> recordRetryable; return
     persist vision_fields; verdict = computeVisionVerdict(...)
     reject -> status rejected, reject_reason = verdict.primary; accept -> persist vision_verdict='pass'
  // publish: only now does anything reach a serving key
  renewLease(row.id, row.attempts)
  c1 = store.copy({ srcKey: keys.uploadFull,  dstKey: keys.full,  expectedEtag: row.full_etag })
  c2 = store.copy({ srcKey: keys.uploadThumb, dstKey: keys.thumb, expectedEtag: row.thumb_etag })
  any source_changed or source_missing -> reject(invalid_image)      // the reject write below is conditional and follows the zero-row rule
                                           // delete [keys.full, keys.thumb] only if that conditional write succeeded or the re-read status is not approved/hidden
  any retryable      -> recordRetryable; return                       // copy is idempotent, safe to repeat
  conditional UPDATE: status='approved', moderated_at=now(), served_at=now() WHERE id=$1 AND status='pending'
  store.delete([keys.uploadFull, keys.uploadThumb])                   // best effort; on success UPDATE photos SET upload_cleaned_at = now() WHERE id=$1
                                                                      // on failure the sweep's cleanApprovedUploads step (R19.12) retries it
  bump photo_usage_daily counters
```

`operatorApprove(photoId)` (service method used by the admin `approve` action) is the same publish step for a `needs_review` photo: it reads the upload objects' HEAD ETags, requires them to equal the recorded ETags (otherwise `invalid_image` rejection), treats a missing upload object (`head` returns `exists: false`, or `copy` returns `source_missing`) as the same unrecoverable `invalid_image` rejection (R8.15, a conditional `needs_review→rejected` write), copies, and writes `approved` together with `harm_verdict='pass'`, `vision_verdict='pass'` (food only), and `approved_by_operator=true` in one conditional `UPDATE ... WHERE status='needs_review'`.

Every status write is a conditional `UPDATE ... WHERE id=$1 AND status='pending'`, so a late job cannot overwrite a delete. **Zero-row rule (R8.13).** A zero-row write has two causes: the photo was deleted or rejected while the job ran, or another job already published it. The job therefore does not assume which: it re-reads the status and calls `servingCleanupAfterZeroRows(status)`. Only for `delete_serving_keys` (any status other than `approved` or `hidden`) does it delete the Serving_Key objects it wrote; for `keep` it deletes nothing and exits quietly. A losing job can never remove the objects behind a served photo.

**Lease sizing (R8.3, R8.14).** The lease is renewed once before the harm step (which makes up to two sequential harm calls), once before the vision step (up to three attempts per model), and once before publishing, so it only has to outlast the longest single step. A retryable outcome sets `lease_until = NULL` in the same update as `next_attempt_at` (R8.5), so the first retry waits only for its 60 s backoff, not for the rest of a 180 s lease. Step bounds with defaults: harm step up to `2 × 15 s = 30 s` (full and thumbnail, sequential; this is where the factor 2 in `2 × PHOTO_HARM_TIMEOUT_MS` comes from); vision up to `2 × (3 × 20 s + 0.5 s + 1.5 s) = 124 s` (three attempts per model, primary then fallback after a 404); publish (two copies and two HEADs) well under 30 s. `minLeaseSeconds = ceil(max(2 × harmTimeoutMs, 2 × (3 × visionTimeoutMs + 2000)) / 1000) + 10 = 134`; the default `PHOTOS_MODERATION_LEASE_SECONDS=180` leaves a 46 s margin, and `loadConfig` fails when the configured value is below the computed minimum. The runner logs one structured line per provider call (outcome, latency, token usage, no image data).

### Sweep (`sweep.ts`)

`createSweepRunner({ sweep, logger })` exposes `tryStart(): { started: true } | { started: false; reason: 'in_flight' }`, the same shape the Trip booking `reminderRunner` uses (its `StartResult` is `{ started: false; reason: 'in_flight' | 'debounced' }`; the photo sweep has no debounce because the cron cadence already bounds it, so only `in_flight` occurs). The route returns `202` for both. The sweep runs inside `runContained` (R8.19), so a throw anywhere in it is logged as `photos.job.crashed` and releases the single-flight guard. `sweep()` runs these steps in order, each bounded by `PHOTOS_SWEEP_BATCH` and the overall time budget, and each independently idempotent:

1. `resumeDue` (R19.13): select `pending` photos with `next_attempt_at <= now()` and an expired lease, at most `PHOTOS_MODERATION_CONCURRENCY` of them; `process()` each sequentially, checking the remaining time budget before starting each one (a started job cannot be interrupted and can run up to the step bound of about 124 s, longer than the 25 s budget, which is why the count is capped and the budget is checked first). Leftover due photos wait for the next trigger.
2. `expireUploading`: `uploading` older than `PHOTOS_UPLOAD_EXPIRY_MINUTES` becomes `deleted`.
3. `expireRejected`: `rejected` with `moderated_at` older than `PHOTOS_REJECTED_RETENTION_HOURS` becomes `deleted`.
4. `expireNeedsReview` (R8.16, R19.11): `needs_review` with `created_at` older than `PHOTOS_NEEDS_REVIEW_MAX_AGE_HOURS` (default 120) becomes `deleted`; the owner sees it disappear and can upload again. Aging from `created_at` (not from the escalation time) keeps the bound independent of how long retries took (about 5.7 hours of backoff before escalation). The default pair is 120 h against a 7-day (168 h) `u/` lifecycle expiry, a 48 h margin; `loadConfig` requires `maxAgeHours + 24 <= PHOTOS_UPLOAD_PREFIX_EXPIRY_DAYS × 24`.
5. `reapOrphans`: `owner_id IS NULL`, plus each adapter's `findOrphanPhotoIds`, becomes `deleted`.
6. `deleteObjects`: for `deleted` rows (oldest first), `store.delete([uploadFull, uploadThumb, full, thumb])` (all four keys; absent keys count as success), then `DELETE FROM photos WHERE id=$1 AND status='deleted'`. On failure increment `delete_attempts` and continue. An upload written to a `u/` key after its row was hard-deleted is caught by the bucket lifecycle rule that expires `u/` objects after `PHOTOS_UPLOAD_PREFIX_EXPIRY_DAYS` (7) days.
7. `prune`: delete `photo_upload_counters` older than 7 days and `photo_usage_daily` older than 90 days, and null `vision_fields` older than `PHOTOS_VISION_FIELDS_RETENTION_DAYS` (30). `photo_upload_strikes` is never pruned by the sweep (one small row per sanctioned user; it cascades only with the user).
8. `cleanApprovedUploads` (R19.12): for `approved` or `hidden` rows with `served_at < now() - interval '1 hour'` and `upload_cleaned_at IS NULL` (oldest first, bounded by the batch), `store.delete([uploadFull, uploadThumb])` (absent keys count as success), then `UPDATE photos SET upload_cleaned_at = now() WHERE id=$1`. This closes the gap where the best-effort delete after approval failed and the upload objects would otherwise wait for the lifecycle rule, whose prefix support is unverified. A partial index `photos_upload_uncleaned_idx ON photos(served_at) WHERE upload_cleaned_at IS NULL AND status IN ('approved','hidden')` keeps the scan cheap.

The food-log orphan check is `SELECT p.id FROM photos p WHERE p.target_kind='food_log' AND p.status <> 'deleted' AND NOT EXISTS (SELECT 1 FROM food_item_logs l WHERE l.id = p.target_id) LIMIT $1`. It touches `food_item_logs.id` only.

### Routes (`routes.ts` and siblings)

All routes use `requireSession` unless noted and the existing gateway rate limits (reads 300 per minute, mutations 60 per minute). Batch endpoints keep the per-photo mutation cost low: a 10-photo upload is 2 mutations.

| Method and path | Purpose | Auth and gates |
| --- | --- | --- |
| `GET /photos/config` | `PhotoClientConfigDTO` | session; works when disabled (returns `enabled:false`) |
| `POST /photos/uploads` | initiate (R3) | session; kill switch; ban; Target_Adapter; quota |
| `POST /photos/confirm` | confirm (R4) -> `202` with `PhotoConfirmResponseDTO` | session; owner only |
| `GET /photos/:id` | owner status (R4.7, R4.8) | session; owner only, else `photo_not_found` |
| `GET /me/photos/status?ids=` | batched owner status for up to 10 ids (R4.10); omits ids not owned; applies the opportunistic resume | session; this is the endpoint the client polls (R23.4) |
| `GET /me/photos?targetKind&scopeId&cursor` | owner's own non-`deleted` photos for one target kind and scope, newest first, with status and rejection reason, keyset-paginated (R4.11) | session; owner only |
| `DELETE /photos/:id` | soft delete | session; uploader (authorized on `owner_id` alone, never on current Trip membership: a departed member can delete their own Trip photo, R12.11, D30), or `canDeleteOthers`; any other caller gets `photo_not_found` |
| `POST /photos/:id/report` | report (R16); optional body `shareId` (R16.8) | session; viewer; not own; with `shareId` the photo must be an approved Trip photo of that share's Trip that is not blocked (D35, widened from D32's current-highlight rule) and the Friendship must hold (D25, D32); a report counts toward auto-hide per D31 |
| `POST /me/blocks` (body: exactly one of `userId` or `photoId`), `DELETE /me/blocks/:blockId`, `GET /me/blocks` | block (R17) | session; `photoId` requires the viewer to be able to see a photo that is not their own, else `photo_not_found` |
| `GET /food-items/:foodItemId/photos` | dish gallery | session |
| `GET /experiences/:id/food-photos`, `GET /locations/:id/food-photos` | restaurant gallery; items are `RestaurantFoodPhotoDTO` and the routes accept optional `cursor` and `limit` (1 to 100, default 40, `foodGalleryQuerySchema`; R27.11, R27.12). The experience-page strip reads it with `limit = experienceStripMax` | session |
| `POST` and `HEAD /internal/photos/sweep/run` | Sweep | `x-cron-secret` = `PHOTOS_CRON_SECRET` |
| `GET /trips/:id/photos` (Phase 2) | Album; with `?summary=true` the recap highlights from `selectRecapHighlights` over `(id, sort_at)` (R13.7, R13.8, R26.6) | `assertTripMember` |
| `POST /trips/:id/feed/posts`, `DELETE /trips/:id/feed/posts/:feedItemId` (Phase 2) | feed post | `assertTripMember` + `can(role, 'post_feed_photo')`; create: `FOR UPDATE` validation and guarded link (R14.12); delete: the item is loaded `WHERE id AND trip_id = :id AND type = 'member_post'` else `trip_not_found` (R14.13), then author or `delete_any_trip_photo` |
| `GET /me/inbox/:shareId/trip-recap` (Phase 2) | recipient's read-only recap (`TripRecapDTO`); **registered by the Sharing plugin, not the photo plugin, so it works when `PHOTOS_ENABLED=false`** (R15.17, D28) | recipient of a non-deleted `tripSummary` share **and still a Friend of `shares.sender_id`** (R15.14, D25); the existing sharing routes, including the recipient's `DELETE /me/inbox/:shareId`, are unchanged; there is no sender revoke route, D22 |
| `GET /me/inbox/:shareId/trip-recap/photos?cursor&limit` (Phase 2, D35) | Recap_Album page (`TripRecapPhotosDTO`); registered by the Sharing plugin beside the recap route | same gate, same order as the recap route (R15.26), Friendship re-checked on every call; `200` `unavailable` when `PHOTOS_ENABLED=false` |

When `PHOTOS_ENABLED=false` the photo plugin registers only `GET /photos/config`; the one other route that stays alive is the Sharing-side `GET /me/inbox/:shareId/trip-recap` (R20.2, R20.9) together with its album sibling `GET /me/inbox/:shareId/trip-recap/photos` (R15.30), and the trips feed route drops `photoIds` from every `member_post` and returns an empty `photos` array because no `FeedPhotoPort` is wired (R14.14). When a per-kind switch is off, only the initiate and confirm paths for that kind are blocked (existing approved photos are still served, R10.9, R12.8).

Every route that returns a presigned URL (galleries, Album, `MyPhotoDTO` lists, status, feed with slots, summary-share read, admin page) sets `Cache-Control: private, no-store` (R9.8) through one shared helper `setPrivateNoStore(reply)`, and request logging for these routes never records response bodies or presigned query strings (R9.7: the app's pino config logs only the request path, which for these routes contains no signature).

**Initiate transaction.** `initiate` runs in one database transaction: (1) `SELECT pg_advisory_xact_lock(hashtext($targetId))` to serialize concurrent initiates per target (R5.3); (2) the target cap count (R5.12: non-`deleted` photos on the target, excluding `uploading` rows older than `PHOTOS_PUT_URL_TTL_SECONDS`; `rejected` rows count until deleted); (3) the per-user daily-counter conditional upsert (R5.2) and then the global ceiling reservation (R5.10: `INSERT INTO photo_usage_daily(day) VALUES ($1) ON CONFLICT (day) DO NOTHING`, then `UPDATE photo_usage_daily SET uploads = uploads + $n, upload_bytes = upload_bytes + $bytes WHERE day = $1 AND uploads + $n <= $globalCap RETURNING uploads`; zero rows means `photo_uploads_disabled`, and the transaction rolls back the per-user reservation too); (4) insert the `uploading` rows; (5) presign the PUT URLs (pure local signing, no network call) before commit, so a signing failure rolls everything back, including the quota. In pg-mem tests the two functions are registered as no-op stubs; the serialization itself cannot be proven in pg-mem, and the design says so (Property 11 is stated for the serialized model).

### Food read path

The dish gallery SQL joins nothing but `photos` and `profiles` (for the Friend-only byline, D8; `display_name` and `avatar_preset` live on `profiles`, not `users`), with explicit columns. The service then calls `friendIdsAmong` once for the page's owner ids and builds `uploader` or `null` per row with `bylineFor`; `owner_id`, `display_name`, and `avatar_preset` are dropped from every row before the DTO is returned. First page (no cursor):

```sql
SELECT p.id, p.scope_id, p.object_key, p.thumb_key, p.width, p.height, p.created_at,
       p.owner_id, pr.display_name, pr.avatar_preset
  FROM photos p
  JOIN profiles pr ON pr.user_id = p.owner_id
 WHERE p.target_kind = 'food_log' AND p.scope_id = $1 AND p.status = 'approved'
   AND NOT EXISTS (SELECT 1 FROM user_blocks b
                    WHERE (b.blocker_id = $2 AND b.blocked_id = p.owner_id)
                       OR (b.blocker_id = p.owner_id AND b.blocked_id = $2))
 ORDER BY p.created_at DESC, p.id DESC
 LIMIT $3
```

Subsequent pages add `AND (p.created_at, p.id) < ($3, $4)` before `ORDER BY` and move the limit to `$5`. The repo builds the statement from two fixed string constants (with and without the cursor predicate), never by concatenating user input; there is no sentinel binding. If pg-mem cannot parse the row-value comparison, use the equivalent `(p.created_at < $3 OR (p.created_at = $3 AND p.id < $4))` and record the substitution (see the tasks Notes). `createdDay` in the DTO is `wdwToday(created_at)` (the `wdwClock` helper that returns the America/New_York date) computed in the service; `created_at` itself is dropped before the DTO is returned.

The restaurant gallery adds `JOIN food_items fi ON fi.id = p.scope_id WHERE fi.experience_id = $1` (or `fi.location_id`). `object_key` and `thumb_key` are used only to mint URLs and are dropped before the DTO is returned. The log id is never selected for these reads.

### Experience page guest photo strip (Phase 1, Requirement 27, decision D24)

**What the code looked like when this was designed (read-only inspection of `apps/mobile`).** `ExperienceDetailScreen.tsx` renders two lenses. The Today lens is `TodayInParkLens.tsx`; for `section === 'dining'` (`liveSectionFor` returns `dining` only for category `Restaurant`, `gating.ts`) it renders `DiningReservationCard` and then, only when `menus.length > 0`, `MenuSummaryCard`, which navigates to the root-stack `Menu` route (`RootNavigator.tsx`: `Menu: { experienceId: string }`). `MenuScreen.tsx` has no dish photo strip yet (task 13.6 adds it), resolves dish ids with an `itemIdByName` map over `GET /experiences/:id/food-items`, and takes only `experienceId`. `ExperienceDetail` is itself a root-stack screen. There is no user-submitted-location detail screen: `locationId` appears only in sheets and lists (`RestaurantFoodLogsSheet`, `FoodItemPickerModal`, `LogFoodItemModal`, `FoodListDetailScreen`, `FriendFoodHistoryScreen`), so locations get no strip (R27.14).

**Decision: where it goes.** The strip is rendered inside the `section === 'dining'` branch of `TodayInParkLens`, after the `MenuSummaryCard` conditional, so it does not depend on the Experience having menus (a restaurant can have guest photos of a user-submitted dish and no menu) and it inherits the existing `Restaurant` category gate (R27.1, R27.15). It is not placed in the Passport and Lore lens: one placement, no duplicate request. *Alternative rejected:* a strip on `ExperienceDetailScreen` itself above the lens switcher; it would show on every category and would need its own gate.

**Components (new files; one pure module for the testable logic).**

- `apps/mobile/src/photos/experiencePhotoStrip.pure.ts`: `buildStripModel(items: ReadonlyArray<RestaurantFoodPhotoDTO>, max: number): { visible: boolean; items: ReadonlyArray<{ photoId: string; foodItemId: string; label: string; thumbUrl: string; photo: RestaurantFoodPhotoDTO }> }`. It keeps the input order, takes the first `max` entries, sets `label` to `foodItemName.trim()` or `PHOTO_STRIP_BLANK_DISH_LABEL` when blank, and returns `visible: items.length > 0`. It never re-sorts and never mutates its input.
- `apps/mobile/src/photos/ExperiencePhotoStrip.tsx`: props `{ kind: 'experience' | 'location'; id: string; restaurantName: string; onViewDish?: (foodItemId: string) => void }`. It calls `usePhotoConfig()` (task 13.3) and, only when `config.enabled`, `useRestaurantFoodPhotos(kind, id, { limit: config.experienceStripMax })`. It reads `data.pages[0].items` only, passes them through `buildStripModel`, and returns `null` while either query is loading, when either fails, or when the model is not visible. It renders a header-role heading, a horizontal `FlatList` of tiles (thumbnail with `accessibilityRole="imagebutton"` and the dish-name text label under it), and a "See all" button. A tile tap sets the viewer photo; "See all" opens the sheet. `TodayInParkLens` renders it only inside its `dining` branch and passes `onViewDish`, which calls `navigation.navigate('Menu', { experienceId, focusFoodItemId })`; the "View dish" control is hidden when the prop is absent.
- `apps/mobile/src/photos/RestaurantPhotosSheet.tsx`: a thin wrapper over a shared `PhotoGallerySheet` (below) that supplies the paginated `useRestaurantFoodPhotos(kind, id, {})` (no `limit`, so the default page of 40; enabled only while the sheet is visible) and `getLabel = (p) => p.foodItemName`.
- **Generalizing the dish sheet (decision, not left to the implementer).** Task 13.6 builds `DishPhotosSheet`. Task 13.11 extracts its grid, paging, empty/error states, and viewer wiring into `PhotoGallerySheet` (props: `visible`, `onClose`, `title`, `pages`, `fetchNextPage`, `hasNextPage`, `isError`, `onRetry`, `getLabel?`, `onViewDish?`) and makes `DishPhotosSheet` a wrapper over it with `getLabel` omitted. The 13.6 tests stay green unchanged. *Alternative rejected:* a second, copied sheet; two galleries would drift on blocked-user handling and the viewer controls.
- The shared `PhotoViewer` (task 13.4) gains one optional prop `footerAction?: { label: string; accessibilityLabel: string; onPress: () => void }`, rendered as a button below the photo and its dish label; existing callers pass nothing and are unchanged. The strip and the sheet pass the "View dish" action with an accessibility label containing the dish name.

**Hook.** `useRestaurantFoodPhotos(kind: 'experience' | 'location', id: string, opts: { limit?: number; enabled?: boolean })` is a `useInfiniteQuery` over `GET /experiences/:id/food-photos` or `GET /locations/:id/food-photos` with `?limit=<n>&cursor=<nextCursor>` (parameters omitted when undefined), query key `['restaurant-food-photos', kind, id, limit ?? 'default']`, 30-minute stale time (R9.6), and no `throwOnError`. Task 13.3 introduced the hook name; task 13.11 gives it this signature and shape. Because the strip and the sheet use different `limit` values they have different keys, so opening the sheet fetches its own first page and the strip stays cheap (at most `experienceStripMax` presigned URL mints per page view).

**Server change (small, in the existing statements).** The restaurant gallery statements of task 7.1 (`listFoodByExperience` and `listFoodByLocation`, each in its two fixed forms) add `fi.name AS food_item_name` to the column list; they already join `food_items fi ON fi.id = p.scope_id`. The service maps `food_item_name` to `foodItemName` and returns `RestaurantFoodPhotoDTO`. `listFoodByScope` (the dish gallery) is not touched. Both restaurant routes parse `foodGalleryQuerySchema` and pass `limit` (default 40) to the repo, which keeps the existing `LIMIT` placeholder (no string concatenation). `GET /photos/config` adds `experienceStripMax` from `config.photos.experienceStripMax`.

**`MenuScreen` change (additive).** `RootStackParamList.Menu` becomes `{ experienceId: string; focusFoodItemId?: string }` in `RootNavigator.tsx`, and `MenuRouteProp` in `MenuScreen.tsx` the same. When `focusFoodItemId` is present, once `foodItemsQ` has resolved, a one-shot effect (guarded by a ref so a re-render never reopens it) finds the food item by id in `foodItemsQ.data.items`, selects the menu tab (`activeIndex`) whose groups contain an item with the same normalized name (the matching `itemIdByName` already uses), and opens `DishPhotosSheet` for that food item. When no menu contains the dish, or `menus` is empty, the tab is left unchanged and the sheet still opens, because the sheet is keyed by food item id. When `focusFoodItemId` is absent the screen behaves exactly as today. This depends on `DishPhotosSheet` from task 13.6.

**Failure isolation (R27.9).** The strip's queries are owned by the strip component, a child of `TodayInParkLens`. `ExperienceDetailScreen` keeps blocking only on `experienceQ.isLoading` and never reads the photo queries, so a slow or failing photo request cannot change the page's loading, error, or content. The strip returns `null` on loading and error: no spinner, no banner, no scoped retry (the optional retry is not built). The sheet is user-initiated, so it does show an inline error with a Retry button.

**Blocking and refresh.** "Block uploader" from the viewer calls `POST /me/blocks` with `{ photoId }` (task 13.4) and then invalidates the query-key prefixes `['restaurant-food-photos']` and `['dish-photos']` so the strip and sheets refetch; the server filter (R11.4) is the only thing that removes the photos. The client never filters by uploader.

**Not in scope here.** Photos of rides and attractions (Phase 3), an add-photo control on the experience page, and a location strip (no host screen exists).

**Recorded deviations from the owner's brief.** (1) `PHOTOS_EXPERIENCE_STRIP_MAX` is an API env var reported to the app through `GET /photos/config` (`experienceStripMax`) rather than a mobile-only constant, so the `.env.example` and `render.yaml` lists carry it and the server owns the value. (2) `Menu` gains an optional `focusFoodItemId` route param, because the real `MenuScreen` takes only `experienceId` and has no way to target a dish. (3) The restaurant routes gain `limit`, because Requirement 9.4 states a maximum page size but no gallery route had a query schema. (4) The strip is in the Today lens only. (5) Locations are not applicable (no detail screen). (6) The shared viewer keeps Delete for the viewer's own photos.

### Trip posts (Phase 2)

`POST /trips/:id/feed/posts` runs one transaction: validate photos with a locking read (`SELECT id FROM photos WHERE id = ANY($2) AND owner_id = $3 AND scope_id = $4 AND target_kind = 'trip' AND status IN ('pending','approved','needs_review') AND feed_item_id IS NULL FOR UPDATE`, which excludes `uploading`, `rejected`, `hidden`, and `deleted` per R14.2; a row count different from the requested count is `validation_failed`), insert `trip_feed_items(type='member_post', actor_id, metadata={ caption?, photoIds })` where `photoIds` is the validated list in the order the author sent it (R14.10), then link with a **guarded update**: `UPDATE photos SET feed_item_id = $1 WHERE id = ANY($2) AND owner_id = $3 AND feed_item_id IS NULL AND status IN ('pending','approved','needs_review') RETURNING id`; if the returned count differs from the requested count the transaction rolls back (no feed item remains) and the call answers `validation_failed` (R14.12). The `FOR UPDATE` serializes two concurrent creates that name the same photo (the second blocks until the first commits, then sees `feed_item_id IS NOT NULL`), and the guarded update is the belt for any state change in between (a photo moving to `rejected` or `deleted`), so a photo can never sit in two posts and deleting one post can never blank a photo shown in another. pg-mem cannot prove true concurrency (it has no row locks), so the repo test runs the second create after the first and asserts the guard refuses it; the design says so, as it does for the advisory lock. **Slot order and placeholder persistence (R14.10).** The photos table has no position column and needs none: the order lives in `metadata.photoIds`, and `FeedPhotoPort` emits exactly one slot per listed id in that order. A listed id whose row is `deleted`, or whose row the Sweep has already hard-deleted, becomes a `removed` slot in its original position, so the "photo removed" placeholder does not disappear after the up-to-6-hour sweep interval, and a post whose photos were all swept still yields one `removed` slot each for its author. The `feed_item_id` column is only an index aid (and is set null by the FK when the feed item goes); slots never depend on it. *Alternative rejected:* a `feed_position SMALLINT` column on `photos`; it would drop a swept photo's slot (nothing left to join), which contradicts R13.4/R14.6, and would need a migration for what an existing JSON field already holds. **Author source (R14.11).** The feed read in `trips/repo.getFeed` and `TripFeedItemDTO` stay unchanged and carry no actor id. The trips route calls `FeedPhotoPort.slotsForFeedItems(tripId, viewerId, memberPostIds)` once, which issues two batched statements (post rows with `actor_id` and `metadata->'photoIds'`; then the photo rows for the union of ids) and returns `{ authorId, slots }` per post; the route sets `item.photos` and `item.mine = (authorId === viewerId)` on each `member_post` item, deletes `photoIds` from `item.metadata`, discards `authorId`, and drops `member_post` items that are not the viewer's own and have no slot with state `ready` or `checking` (the `postVisibleToNonAuthor` rule). **Port absent (R14.14, D28).** When no `FeedPhotoPort` is wired (`PHOTOS_ENABLED=false`), the same trips route still deletes `photoIds` from every `member_post` item's `metadata`, sets `item.photos = []`, and leaves `mine` unset, so no raw photo id, slot, URL, or author identifier is produced and the caption still renders; the `postVisibleToNonAuthor` omission is not applied (without the port it cannot be computed). The route does this unconditionally for `type === 'member_post'` rather than relying on the port to strip. Post deletion first loads the item with `SELECT id, actor_id, metadata FROM trip_feed_items WHERE id = $1 AND trip_id = $2 AND type = 'member_post'` (`$2` is the `:id` of the route, which `assertTripMember` already authorized) and answers `trip_not_found` for any other result, so a post of another Trip, a system feed item, or an unknown id is refused before anything is touched (R14.13; it mirrors `trips/repo.assertTargetInTrip`). It then runs in one transaction: set the photos listed in `metadata.photoIds` (still present and not yet `deleted`) to `deleted`, run `DELETE FROM trip_reactions WHERE target_type='feed_item' AND target_id=$1` and `DELETE FROM trip_comments WHERE target_type='feed_item' AND target_id=$1` (the real tables, created in migration `0015`; `target_id` has no FK, per the `0018` precedent, so explicit cleanup is required), then delete the feed item.

### Trip recap photos section (Phase 2)

The Trip Recap (`TripSummaryScreen`, reached only by members: `GET /trips/:id/summary` is member-only) gains a "Trip photos" section: a horizontal highlights strip of at most `PHOTOS_RECAP_HIGHLIGHT_MAX` (default 6) thumbnails followed by a "View all in album" action that navigates to `TripAlbum`; when the highlights are empty the whole section is omitted. The data comes from the existing Album route with `?summary=true` (Requirement 13.7): the same member gate, block filter, URL minting, and `Cache-Control: private, no-store`, but the repo loads the viewer's visible `approved` trip photos' `id` and `sort_at` only (explicit columns, bounded by the per-Trip cap of 300) and the service runs the pure function below, so there is no new query shape beyond a narrower select. The component is one shared `TripPhotosSection` (built by task 22.6) with a `mode: 'member' | 'recipient'` prop: member mode reads this route and shows "View all in album"; recipient mode takes the photos from `TripRecapDTO.photos`, omits the Album action and every add, edit, or delete control, and passes the `shareId` to Report and "Block uploader" (R26.7).

**Recipient album (Phase 2, D35).** In recipient mode `TripPhotosSection` takes an optional `onViewAll`; when present and the strip has a photo it shows "View all photos" (`view-all-photos-btn`), opening `TripRecapAlbumScreen` (route `TripRecapAlbum: { shareId: string; tripName?: string }` in `YouAndCrewStack`, the only navigator that registers `TripRecap`; R15.31). The screen uses `useRecapAlbum(shareId)` (`useInfiniteQuery`, key `photoKeys.recapAlbum(shareId)` = `['photos','recapAlbum',shareId]`, stale time `PHOTO_STALE_TIME_MS`), groups the photos with the extracted `photos/dayGroups.ts` by America/New_York day, renders `PhotoGrid` tiles and the shared `PhotoViewer` (`shareId` passed, `canDelete` false), and implements the states of R15.32 and R15.33.

**`selectRecapHighlights` (D21, D29, R26.6).** Pure, in `domain/recapHighlights.ts`:

```
selectRecapHighlights(photos: ReadonlyArray<{ id: string; sortAt: Date }>, max: number): Array<{ id: string; sortAt: Date }>
  day(p)      = wdwToday(p.sortAt)                           // America/New_York calendar date via wdwClock (existing helper), 'YYYY-MM-DD'
  perDay      = for each distinct day: the photo with the minimum (sortAt, id)         // earliest that day by capture time, ties by smaller id
  result      = perDay sorted by day ascending, then first `max` entries               // chronological, capped
  empty input -> []
```

`max` is `PHOTOS_RECAP_HIGHLIGHT_MAX` (default 6, integer 1 to 24, validated by `loadConfig`). The function reads only `id` and `sortAt`, is independent of input order, and never mutates its input. `sortAt` is the `photos.sort_at` column: the client-declared capture time when it lies between 2000-01-01 and the request time plus 5 minutes, otherwise the request time (R13.3), so a photo without usable metadata behaves as the old upload-day rule did. **Why `sort_at` and not `created_at` (D29).** `created_at` is the time of the initiate call. A family that picks 25 photos from the camera roll on the last night would have all of them on one upload day and get one highlight, and the recap would disagree with the Album, which groups by the `sort_at` day (R13.6, R13.8). The owner did not choose upload day deliberately (they said they did not know what the highlights should be). One interpretation point remains an assumption: when more than `max` days have photos the first `max` days are kept. The same function serves the recipient route. **Sharing (D1).** The OS text share is unchanged (plain text; the note "Photos can't go in a text share. Use Send to friends to share the recap with photos." sits beside it), and "Send to friends" opens the `tripSummary` composer. There is no link and no deep link, so no app linking configuration (URL scheme, `linking` config, associated domains) or fallback page is needed; a search of `apps/mobile/app.config.ts` and `apps/mobile/src/navigation/*.tsx` found none configured, and nothing in this design depends on it.

### Recap screen reuses the Trip Summary components (Phase 2, D34)

`TripRecapScreen` (the recipient's read-only recap) and `TripSummaryScreen` (the member's own summary) render the same five presentational components, extracted without changing the Summary's output into `apps/mobile/src/screens/trips/summary/`:

| Component | Props the recap passes | Ids |
| --- | --- | --- |
| `SummaryHeroCard` | `title` = trip name (`titleIsHeader`), `badgeLabel` = `Shared by <sharerDisplayName>` (`Shared recap` when the name is empty), `badgeIcon` = `people`, the planned counts, `emptyPlannedLine` = `No planned itinerary on this trip.` | `trip-recap-hero`, `trip-recap-planned`, `trip-recap-planned-count`, `trip-recap-trip-name` |
| `SummaryStatTiles` | the four figure counts; labels "Distinct Rides & Shows" ("Distinct Ride" for one), "Total Logged Rides", "Ratings Given", "Parks Explored" | `trip-recap-stats` and `trip-recap-{distinct,total-completions,total-ratings,parks-explored}[-count]` |
| `SummarySectionHeader` | "Group Superlatives & Awards", "Top-Rated Moments" | none |
| `SummaryAwardCard` | one `TripRecapSuperlativeDTO` (display name or Experience name only, never an id) | `trip-recap-superlative-<id>` |
| `TopRatedMomentRow` | up to three rows: `rank`, name, mean rating, rating count, `park`, `category`, `imageUrl` | `trip-recap-top-rated-<experienceName>` |

The hero shows the progress ring and "N of M planned Experiences completed" only when `plannedTotalCount` is greater than 0; otherwise it shows the friendly line and no ring. Awards and top-rated moments are hidden when empty. A top-rated row shows the catalog image when `imageUrl` exists (falling back to the category placeholder if it fails to load) and the category-tinted placeholder otherwise. The screen has no Member Contributions section and its source mentions no `perMember` or `memberId` (a source-guard test pins it). All colours come from the active theme, `TripSummaryScreen.palette.ts` and `withAlpha`; the unchanged `TripPhotosSection` follows the figures.

### Summary share (Phase 2, decided: D1 option B)

An in-app share to Friends through the existing Sharing service, modeled on `pinShowcase` (`{ ownerId, ownerDisplayName }`, a pointer with the recipient reading live data through a friend-gated route). Option C (a tokenized public link) was rejected by the owner and is not designed. `SharePayload` gains a pointer, stored in `shares.payload_snapshot` like the other kinds:

```ts
export interface TripSummarySharePayload {
  readonly kind: 'tripSummary';
  readonly tripId: string; readonly tripName: string;
  readonly sharerDisplayName: string;   // no sharerId: the sharer is shares.sender_id, the single source of truth (R15.20, D33)
  readonly includePhotos: boolean;      // the sender's choice in the composer (default true); not a per-photo flag
}
```

There is no snapshot of summary figures in the payload (R15.2); the figures are computed when the recipient opens the recap, so the card always shows the Trip's current state. **Creation.** `POST /me/shares` with `kind: 'tripSummary'` is handled in `sharing/routes.ts` beside the `pinShowcase` branch through the `TripShareFacts` port (see "Sharing wiring"): `roleOf(senderId, tripId)` must be non-null (else `trip_forbidden`) and `can(role, 'share_trip_summary')` must hold; `tripName(tripId)` supplies the name; `resolveSenderDisplayName(senderId)` supplies `sharerDisplayName`; `recipientIds` must all be Friends (the existing atomic check). The route stores only the five payload keys; with `tripShareFacts` unwired it answers `validation_failed`. **Recipient route (R15.12, R15.14 to R15.17).** `GET /me/inbox/:shareId/trip-recap` is registered by `sharing/tripRecapRoutes.ts` and runs in this fixed order, each step failing closed:

1. `RecapShareGate.resolve(shareId, recipientId)`: one query joining `share_recipients` and `shares` (recipient row exists for the caller, `recipient_deleted_at IS NULL`, `payload_kind='tripSummary'`), reading the sharer from `shares.sender_id` (D33); then the **Friendship re-check** (D25): one primary-key read `SELECT 1 FROM friendships WHERE user_lo_id = $1 AND user_hi_id = $2` with `(lo, hi) = canonicalPair(senderId, recipientId)` (the same table `createShareAtomic` reads; `removeFriend` deletes that row and touches nothing else). Any failure returns `null`, and the route answers the collapsed `validation_failed` used by the existing inbox, before any Trip data is read.
2. `tripAvailable = TripShareFacts.isMember(sharerId, tripId)` (which is false for a missing Trip). When false (Trip deleted, or the sharer left or was removed): answer `200` with `recap: null` and `photos = { access: 'unavailable', photos: [] }`. `unavailable` wins over `not_included` (D27): this step runs before the `includePhotos` check.
3. `TripShareFacts.summary(tripId)` (it calls `tripRepo.getSummary`); a `null` result is handled as step 2. The pure `projectRecapFigures(summary)` in `sharing/tripRecapProjection.ts` builds `TripRecapFiguresDTO` from an explicit literal allowlist (never a spread of the summary): `distinctExperienceCount`, `plannedCompletedCount`, `plannedTotalCount`, the Trip-wide aggregates `totalCompletionsCount` (`summary.totalCompletionsCount ?? 0`), `totalRatingsCount` (`summary.totalRatingsCount ?? 0`) and `parksExploredCount` (`new Set((summary.parkBreakdown ?? []).map((p) => p.park)).size`) (R15.21, D34), `superlatives` mapped to `{ id, title, description, icon, experienceName?, value?, memberDisplayName? }` (never `memberId`), and the first three `topRated` mapped to `{ experienceName, meanRating, ratingCount }` plus `park`, `category` and `imageUrl` only when the source value is neither `undefined` nor `null`; `experienceId` is never copied. `perMember` is never read, and the aggregates are never summed from it. Because the projection is an allowlist, a field added to `TripSummaryDTO` later does not reach a recipient until it is added here, to Requirement 15.21 and to the exact-key-set test.
4. Photos: `includePhotos` false answers `{ access: 'not_included', photos: [] }`; `RecapPhotoPort` absent (photos disabled, D28) answers `{ access: 'unavailable', photos: [] }` with the figures still returned; otherwise `RecapPhotoPort.highlights(access, recipientId)` selects the Trip's `approved` photos (`id`, `sort_at` only) excluding uploaders blocked either way with the recipient, runs the pure `selectRecapHighlights` (D21, D29) and mints fresh presigned GET URLs for the result per request, giving `{ access: 'granted', photos }`. Nothing about a photo identifies its uploader.

The response sets `Cache-Control: private, no-store`. A recipient who deletes the share from their inbox (`DELETE /me/inbox/:shareId`) loses access at once, and a sender who unfriends the recipient cuts access at the next read; those are the only revocations that exist (D22: the existing Sharing service has no sender-side revoke, and none is added). **Report and block from the recap (R16.8, R16.9).** The report route and the photo-id block route accept an optional `shareId`; the photo service then calls `RecapShareGate.resolve` (the same gate, including the Friendship re-check) and `RecapPhotoPort.isHighlight(access, recipientId, photoId)`; a photo that is not one of the share's current highlights, or a failed gate, answers `photo_not_found` (D35 widened this: any approved Trip photo of the share's Trip that is not blocked is accepted; see the Recap album paragraph), and without a `shareId` such a photo answers `photo_not_found` as before. A report made this way is stored and queued for the admin but does not count toward the Trip auto-hide threshold (D31, `reportPolicy.ts`).

**Recap album (Phase 2, D35).** `GET /me/inbox/:shareId/trip-recap/photos` is registered by `sharing/tripRecapRoutes.ts` beside the recap route. Two shared functions in `sharing/tripRecapAccess.ts`, `resolveShareAccess` and `photoAccessFor`, are used by BOTH routes, so the gate cannot drift between them. The album order is: parse params and query (`tripRecapPhotosQuerySchema`), `resolveShareAccess` (the Friendship re-check happens inside `RecapShareGate.resolve` before `TripShareFacts.isMember` or `tripName` are called), `photoAccessFor`, then `RecapPhotoPort.albumPage(access, recipientId, { cursor, limit })`. The port owns cursor decoding (`decodeAlbumCursor`; a malformed cursor answers `validation_failed`), so Sharing imports no photo domain code. The SQL selects explicit columns `p.id, p.sort_at, p.width, p.height` with `p.target_kind='trip' AND p.target_id=$1 AND p.status='approved'`, the `user_blocks` NOT EXISTS filter in either direction, `ORDER BY p.sort_at DESC, p.id DESC`, the keyset OR predicate, and `LIMIT limit+1`; `nextCursor` comes from `encodeAlbumCursor` of the last returned row only when the extra row existed. URLs are minted from `photoKeys(id)` only, never from `object_key` or `thumb_key`. When `recapPhotoPort` is absent (the kill switch) the route answers `200` with `unavailable`, no URL and no `404`. Every `200` carries `Cache-Control: private, no-store`. Report and block widening: `RecapPhotoPort.isAlbumPhoto(access, recipientId, photoId)` (approved, same Trip, not blocked, gate flags) replaces `isHighlight` in `PhotoService.report` and `PhotoService.addBlock`; `isHighlight` stays on the port.

**Consumers of the new kind that `tsc` does not flag (R15.19).** Adding `'tripSummary'` to `SHARE_PAYLOAD_KINDS` breaks exhaustive `switch` statements at compile time, but not `if (payload.kind === 'pinShowcase') … else` chains or Zod unions. The implementation tasks (21.1 for api and shared, 22.4 for mobile) carry this explicit checklist, each with a test where it has behavior: `tripSummarySharePayloadSchema` in `sharePayloadSchema` (shared test: `inboxItemSchema` accepts a `tripSummary` item); `packages/shared/src/attention.ts` (the two `pinShowcase` branches around lines 530 and 635 get a `tripSummary` destination keyed on the share id; test the destination); `InboxScreen.tsx` (a `tripSummary` navigation branch placed after the existing `stillFriend` pre-check and **before** the `FriendProfile` fallback; a card content branch; test the navigation target); `SentSharesScreen.tsx` (a content branch); `shareBody.ts` (the `tripSummary` request body; test); `sharing/routes.ts` `ShareDeliveredEvent` and `notifications/service.ts` `ShareDeliveredNotice` (the `payloadKind` union and the label branch near line 790; test the label); `NotificationCenterScreen.tsx` (the destination branch near line 314 for a `tripSummary` destination, applying the same still-Friend check as `pinShowcase`).

**Crew notice (R15.10, D16, D23).** Because any member's recap share can show every crew member's photos and there is no per-photo opt-out, the Album shows every member a dismissible one-time notice ("Any trip member can share the trip recap with their friends, and it can include photos from everyone on the trip. Deleting a photo removes it everywhere.") and the share composer repeats that the recap includes photos from all crew members next to the "Include trip photos" toggle. The acknowledgement is per device in AsyncStorage under `photos.albumNotice.v1` (a notice, not a consent record, so per-device storage is sufficient). **Accepted trade-off (owner decision):** a sender's Friends can see crew members' photos that the crew members did not choose to share.

## Data Models

### Migration `0062_photo_uploads.sql` (Phase 1)

Written to the repo's conventions: header comment, `BEGIN/COMMIT`, `gen_random_uuid()`, `TIMESTAMPTZ`, named CHECKs `chk_<table>_<what>`, `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`.

```sql
CREATE TABLE IF NOT EXISTS photos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  target_kind      TEXT NOT NULL,
  target_id        UUID NOT NULL,
  scope_id         UUID NOT NULL,
  feed_item_id     UUID,                       -- trip posts only; FK added in 0063
  status           TEXT NOT NULL DEFAULT 'uploading',
  object_key       TEXT NOT NULL,
  thumb_key        TEXT NOT NULL,
  byte_size        INTEGER NOT NULL,
  thumb_byte_size  INTEGER NOT NULL,
  width            INTEGER NOT NULL,
  height           INTEGER NOT NULL,
  taken_at         TIMESTAMPTZ,
  sort_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  harm_verdict     TEXT,
  vision_verdict   TEXT,
  reject_reason    TEXT,
  hidden_reason    TEXT,
  vision_fields    JSONB,
  attempts         SMALLINT NOT NULL DEFAULT 0,
  next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_until      TIMESTAMPTZ,
  last_error_code  TEXT,
  delete_attempts  SMALLINT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at     TIMESTAMPTZ,
  moderated_at     TIMESTAMPTZ,
  deleted_at       TIMESTAMPTZ,
  full_etag        TEXT,                       -- ETag of u/<id>/full.jpg recorded at confirm (R4.9)
  thumb_etag       TEXT,                       -- ETag of u/<id>/thumb.jpg recorded at confirm (R4.9)
  served_at        TIMESTAMPTZ,                -- set when the serving-key copy was verified and approved written
  upload_cleaned_at TIMESTAMPTZ,               -- set when the two u/ objects of an approved photo were deleted (R19.12)
  approved_by_operator BOOLEAN NOT NULL DEFAULT false,   -- operator override marker (R8.12)
  CONSTRAINT chk_photos_target_kind CHECK (target_kind IN ('food_log','trip')),
  CONSTRAINT chk_photos_status CHECK (status IN ('uploading','pending','approved','rejected','needs_review','hidden','deleted')),
  CONSTRAINT chk_photos_harm CHECK (harm_verdict IS NULL OR harm_verdict IN ('pass','flag')),
  CONSTRAINT chk_photos_vision CHECK (vision_verdict IS NULL OR vision_verdict IN ('pass','reject')),
  CONSTRAINT chk_photos_reject_reason CHECK (reject_reason IS NULL OR reject_reason IN ('harm','not_food','face_visible','too_much_text','invalid_image')),
  CONSTRAINT chk_photos_rejected_has_reason CHECK (status <> 'rejected' OR reject_reason IS NOT NULL),
  CONSTRAINT chk_photos_hidden_reason CHECK (hidden_reason IS NULL OR hidden_reason = 'reports'),   -- the only way a photo is hidden is the auto-hide at the report threshold
  CONSTRAINT chk_photos_sizes CHECK (byte_size > 0 AND thumb_byte_size > 0 AND width BETWEEN 1 AND 4096 AND height BETWEEN 1 AND 4096),
  CONSTRAINT chk_photos_feed_trip_only CHECK (feed_item_id IS NULL OR target_kind = 'trip'),
  CONSTRAINT chk_photos_keys_distinct CHECK (object_key <> thumb_key),
  -- the one invariant every read relies on, enforced in the database too (R8.1):
  CONSTRAINT chk_photos_served_harm_pass CHECK (status NOT IN ('approved','hidden') OR harm_verdict = 'pass'),
  CONSTRAINT chk_photos_served_vision_pass CHECK (status NOT IN ('approved','hidden') OR target_kind <> 'food_log' OR vision_verdict = 'pass'),
  CONSTRAINT chk_photos_served_has_etags CHECK (status NOT IN ('approved','hidden') OR (full_etag IS NOT NULL AND thumb_etag IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS photos_object_key_uidx ON photos(object_key);
CREATE INDEX IF NOT EXISTS photos_scope_list_idx   ON photos(target_kind, scope_id, status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS photos_album_idx        ON photos(target_kind, scope_id, status, sort_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS photos_owner_idx        ON photos(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS photos_target_idx       ON photos(target_kind, target_id);
CREATE INDEX IF NOT EXISTS photos_status_due_idx   ON photos(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS photos_feed_item_idx    ON photos(feed_item_id);
CREATE INDEX IF NOT EXISTS photos_upload_uncleaned_idx ON photos(served_at) WHERE upload_cleaned_at IS NULL AND status IN ('approved','hidden');

CREATE TABLE IF NOT EXISTS photo_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL, note TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), resolved_at TIMESTAMPTZ,
  CONSTRAINT chk_photo_reports_reason CHECK (reason IN ('inappropriate','shows_person','not_food','spam','other')),
  CONSTRAINT chk_photo_reports_status CHECK (status IN ('open','upheld','dismissed')),
  CONSTRAINT chk_photo_reports_note CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 300),
  CONSTRAINT photo_reports_unique UNIQUE (photo_id, reporter_id)
);
CREATE INDEX IF NOT EXISTS photo_reports_photo_status_idx ON photo_reports(photo_id, status);
CREATE INDEX IF NOT EXISTS photo_reports_open_idx ON photo_reports(status, created_at);

CREATE TABLE IF NOT EXISTS user_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),      -- unblock is keyed by this id so a photo-id block never reveals the user id (R17.1)
  blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_blocks_pair_unique UNIQUE (blocker_id, blocked_id),
  CONSTRAINT chk_user_blocks_distinct CHECK (blocker_id <> blocked_id)
);
CREATE INDEX IF NOT EXISTS user_blocks_blocker_idx ON user_blocks(blocker_id);
CREATE INDEX IF NOT EXISTS user_blocks_blocked_idx ON user_blocks(blocked_id);

CREATE TABLE IF NOT EXISTS photo_upload_bans (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Strike history survives the Sweep: photo_reports cascade with the photo row, so the count the operator uses to
-- decide a ban cannot be derived from them (R18.5). One small row per sanctioned user, cascading only with the user.
CREATE TABLE IF NOT EXISTS photo_upload_strikes (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  upheld_count INTEGER NOT NULL DEFAULT 0,
  last_upheld_at TIMESTAMPTZ,
  CONSTRAINT chk_photo_strikes_count CHECK (upheld_count >= 0)
);

CREATE TABLE IF NOT EXISTS photo_upload_counters (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day DATE NOT NULL, upload_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day),
  CONSTRAINT chk_photo_counters_count CHECK (upload_count >= 0)
);

CREATE TABLE IF NOT EXISTS photo_usage_daily (
  day DATE PRIMARY KEY,
  uploads INTEGER NOT NULL DEFAULT 0, upload_bytes BIGINT NOT NULL DEFAULT 0,
  harm_calls INTEGER NOT NULL DEFAULT 0, vision_calls INTEGER NOT NULL DEFAULT 0,
  vision_prompt_tokens BIGINT NOT NULL DEFAULT 0, vision_output_tokens BIGINT NOT NULL DEFAULT 0,
  rejections INTEGER NOT NULL DEFAULT 0, needs_review INTEGER NOT NULL DEFAULT 0,
  exif_present INTEGER NOT NULL DEFAULT 0
);
```

Notes: The `chk_photos_served_*` CHECKs make "approved or hidden implies pass verdicts (and recorded ETags)" a database invariant; a `hidden` photo was `approved` first so it satisfies them, and an operator approval writes the verdicts before or in the same statement as the status. `photos.owner_id` is `SET NULL` (not `CASCADE`) so the Sweep can still find the row and delete the objects. `photo_reports` cascades with the photo row, which is correct for object cleanup (the Sweep deletes the row only after the objects are gone) but means reports cannot carry the operator's strike history; that lives in `photo_upload_strikes`. `removePhoto(photoId, operator)` runs one transaction: `UPDATE photos SET status='deleted', deleted_at=now() WHERE id=$1 AND status IN ('approved','hidden','needs_review','pending','rejected') RETURNING owner_id`; `UPDATE photo_reports SET status='upheld', resolved_at=now() WHERE photo_id=$1 AND status='open'`; and, when `owner_id` is not null, `INSERT INTO photo_upload_strikes(user_id, upheld_count, last_upheld_at) VALUES ($owner, 1, now()) ON CONFLICT (user_id) DO UPDATE SET upheld_count = photo_upload_strikes.upheld_count + 1, last_upheld_at = now()` (one increment per removed photo, not per report; the zero-row case of the first statement skips the other two so a double-click does not double-count). `upheldCountForUser` reads `photo_upload_strikes`. `ban-uploader` resolves the owner from `photos.owner_id` and is accepted for a `deleted` photo that has not been swept (R18.11); after the sweep the removal confirmation page, which already holds the user id server-side, carries the ban control. The quota reservation is two statements: `INSERT INTO photo_upload_counters(user_id, day, upload_count) VALUES ($1,$2,0) ON CONFLICT (user_id, day) DO NOTHING`, then `UPDATE photo_upload_counters SET upload_count = upload_count + $3 WHERE user_id=$1 AND day=$2 AND upload_count + $3 <= $4 RETURNING upload_count`. Zero rows returned means over the cap. Any batch insert with `ON CONFLICT DO UPDATE` (the `photo_usage_daily` increments) is applied one statement per day, so the same conflict key never appears twice in one command. `photo_usage_daily.uploads` and `upload_bytes` are incremented inside the initiate transaction, per item and by the declared sizes, by the conditional global-ceiling update (R5.10), so they double as the global cap counter; the provider counters (`harm_calls`, `vision_calls`, tokens, `rejections`, `needs_review`, `exif_present`) are incremented by the runner.

### Migration `0063_trip_photos.sql` (Phase 2)

```sql
BEGIN;
-- widen trip_feed_items type to add 'member_post' (drop + re-add, as 0018 did).
-- The list below is the post-0018 list (verified in 0018_drop_rode_with_confirmed_feed.sql) plus 'member_post'.
-- The executor MUST still re-read the live constraint (grep later migrations for trip_feed_items_type_chk) before
-- applying; if a migration after 0018 changed the list, re-add that list plus 'member_post'.
ALTER TABLE trip_feed_items DROP CONSTRAINT IF EXISTS trip_feed_items_type_chk;
ALTER TABLE trip_feed_items ADD CONSTRAINT trip_feed_items_type_chk CHECK (type IN (
  'trip_created','member_joined','completion_logged','rating_recorded','member_post'
));
ALTER TABLE photos DROP CONSTRAINT IF EXISTS fk_photos_feed_item;
ALTER TABLE photos ADD CONSTRAINT fk_photos_feed_item FOREIGN KEY (feed_item_id) REFERENCES trip_feed_items(id) ON DELETE SET NULL;
-- sharing: tripSummary kind (a pointer payload; no new shares column, no revoke column)
ALTER TABLE shares DROP CONSTRAINT IF EXISTS shares_payload_kind_chk;
ALTER TABLE shares ADD CONSTRAINT shares_payload_kind_chk CHECK (payload_kind IN ('experience','progress','pinShowcase','tripSummary'));
ALTER TABLE shares DROP CONSTRAINT IF EXISTS shares_experience_payload_chk;
ALTER TABLE shares ADD CONSTRAINT shares_experience_payload_chk CHECK (
  (payload_kind = 'experience' AND experience_id IS NOT NULL)
  OR (payload_kind IN ('progress','pinShowcase','tripSummary') AND experience_id IS NULL));
COMMIT;
```

The file is wrapped in `BEGIN`/`COMMIT` like `0038` and the `0062` section, per the repo's migration convention; every statement is idempotent on reapply (`DROP CONSTRAINT IF EXISTS` then `ADD CONSTRAINT`).

`ON DELETE SET NULL` on the feed FK means deleting a feed item (by the `DELETE .../feed/posts` route, or a trip cascade) does not delete photo rows; the route deletes the photos explicitly first and the trip cascade is handled by the reaper.

### Storage notes

- Rows are ~0.5 KB; 100k photos is ~50 MB plus indexes, comfortably inside the ~1 GB Neon budget. `vision_fields` is nulled after 30 days; `photo_usage_daily` is pruned after 90 days; counters after 7 days.
- Object layout: upload keys `u/<photoId>/full.jpg` and `u/<photoId>/thumb.jpg` (short-lived, deleted on approval), serving keys `p/<photoId>/full.jpg` and `p/<photoId>/thumb.jpg`. Between approval and the upload-key delete both exist briefly; steady state is serving keys only. Typical object size is ~100 to 230 KB for the full image, giving roughly 4k to 10k photos per GB stored (plain arithmetic: 1 GB divided by 230 KB and by 100 KB, ignoring thumbnails and overhead). R2 free-tier limits are not verified here and must be verified before launch.

## External Interfaces

### Cloudflare R2 (Object_Store adapter)

- Endpoint: `https://<account-id>.r2.cloudflarestorage.com`, region `auto`, S3 signature V4. Client: `new S3Client({ region: 'auto', endpoint, forcePathStyle: true, credentials, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' })`. `forcePathStyle: true` matches the earlier working avatar configuration in git history (`f6e9914^:apps/api/src/services/auth/avatarStore.ts`). The `WHEN_REQUIRED` checksum options are set because recent AWS SDK v3 versions add default CRC32 checksum parameters to `PutObject` that S3-compatible stores and presigned URLs can reject. Pin the SDK version and verify this with the live smoke test (script written in task 6.5, run in task 14.5).
- Commands used: `PutObjectCommand` (presigned, only for `u/` upload keys, with `ContentType: 'image/jpeg'` and `ContentLength`; the presigner is called with `signableHeaders: new Set(['content-type', 'content-length'])` so both headers are in `X-Amz-SignedHeaders`, which the adapter test asserts), `GetObjectCommand` (presigned for reads of `p/` serving keys and, for the owner's thumbnail preview, `u/` thumbnail keys; direct for moderation), `HeadObjectCommand`, `CopyObjectCommand` (`CopySource` = `<bucket>/u/<id>/...`, `CopySourceIfMatch` = the recorded ETag, destination `p/<id>/...`), `DeleteObjectsCommand` (or `DeleteObjectCommand` per key).
- **Where the client's declared length comes from (R3.9, R3.10).** Because the presigned PUT signs `content-length`, the byte count the client declares must equal the bytes it sends. `expo-image-manipulator` returns `{ uri, width, height }` and no size, and the app has no file-system module, so the client obtains sizes from the bytes themselves: `imagePrep.native.ts` returns `{ uri, width, height, blob }` for the full image and for the thumbnail, where `blob = await (await fetch(uri)).blob()` (React Native's `fetch` supports `file://` URIs). `byteSize = fullBlob.size` and `thumbByteSize = thumbBlob.size` are declared in `POST /photos/uploads`, and `fetch(putUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: blob })` sends the same Blob objects; `Content-Length` is never set by hand (the stack derives it from the Blob). *Alternative rejected:* `expo-file-system` `uploadAsync` with `BINARY_CONTENT`; it adds a native dependency for something `fetch` and `Blob` already do. Whether R2 enforces the signed length (403 on mismatch) or ignores it is **verify before launch** (task 6.5 smoke script PUTs a body shorter than the signed length and records the result); either way the Blob-size rule keeps `byte_size` and `photo_usage_daily.upload_bytes` exact, and task 13.10 records the PUT status from a real device.
- Response fields relied on: HEAD and GET `ContentLength`, `ContentType`, `ETag` (a single-part PUT's ETag is stable and is the value recorded at confirm; copy preserves it for single-part objects, which the adapter verifies); not-found is HTTP 404 / `NotFound`; a failed `CopySourceIfMatch` is HTTP 412 `PreconditionFailed`. Whether R2 honours `CopySourceIfMatch` and returns the same ETag on the copy is **verify before launch** with the smoke script (task 6.5 writes it, task 14.5 runs it); the adapter's post-copy destination-ETag check means correctness does not depend on the answer, only the number of wasted copies does.
- Bucket setup (manual, documented): a NEW private bucket; a NEW access token scoped to that bucket with object read and write; a CORS rule allowing `PUT` and `GET` with `Content-Type` from the app's origins (native `fetch` is not subject to CORS, but the rule is needed for any web or dev-tool use); a lifecycle rule that aborts incomplete multipart uploads; and a lifecycle rule that expires objects with the `u/` prefix after 7 days (`PHOTOS_UPLOAD_PREFIX_EXPIRY_DAYS`; a backstop for stray upload-key writes, and deliberately longer than the 120-hour `needs_review` age limit so an operator-pending photo's only objects are never expired first). Whether the R2 dashboard supports prefix-scoped expiry rules is **verify before launch**. Free-tier limits: **verify before launch**; none are asserted here.
- Id mapping: upload key = `u/<photoId>/full.jpg|thumb.jpg` and serving key = `p/<photoId>/full.jpg|thumb.jpg`, the photo id being the `photos.id` UUID.

### OpenAI Moderation (Harm_Moderator adapter)

- `POST {PHOTO_HARM_BASE_URL}/v1/moderations`, header `Authorization: Bearer <PHOTO_HARM_API_KEY>`, body `{ "model": "omni-moderation-latest", "input": [ { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,<...>" } } ] }`.
- Response fields relied on: `results[0].flagged` (boolean), `results[0].categories` (map of booleans), `results[0].category_scores` (map of numbers).
- **The request and response shapes above are from provider documentation and planning notes, not from a live call made by this repo.** They are confirmed by the live probe in task 14.5 (R24.4) before launch. Image input size limit (an unverified figure from planning of up to 20 MB; ours are about 1 MB or less, so it does not constrain the design): **verify before launch**. The endpoint is documented as free and rate limited at the time of writing (not verified here); the current pricing, terms, and exact rate limits must be verified before launch.
- Error mapping (a provider failure is never a decision about the photo, R6.5):
  - HTTP 400 whose error body (`error.code`, `error.param`, or `error.message` substring) matches an entry of `PHOTO_HARM_INVALID_IMAGE_CODES` → `invalid_image` outcome (the only permanent harm-adapter rejection). The list is **populated from the live probe (task 14.5, R24.4) and is empty until then**; it must not be filled from memory.
  - HTTP 400 with any other body, including every 400 while the list is empty → retryable with code `harm_bad_request`, logged at `error`. A 400 on a JPEG that already passed the signature check and the storage HEAD most likely means our request shape, a retired `PHOTO_HARM_MODEL`, or a changed `image_url` form is wrong; treating it as a rejection would delete every user's photos. After `PHOTO_HARM_BAD_REQUEST_ALERT_COUNT` (default 5) consecutive `harm_bad_request` results in one process the adapter logs the distinct `error` event `photos.harm.bad_request_streak` (R6.9), which the launch docs list as a page-worthy log line.
  - 401/403 → retryable with code `harm_auth_error` and an `error` log; 429, 5xx, network error, timeout (`PHOTO_HARM_TIMEOUT_MS`, default 15000) → retryable.
  - Any other non-2xx status (for example 404 for a retired model, 413, 422) → retryable with code `harm_http_<status>` and an `error` log (R6.10): a provider failure is never a decision about the photo.

### Google Gemini (Vision_Checker adapter)

- `POST {PHOTO_VISION_BASE_URL}/v1beta/models/{model}:generateContent` with header `x-goog-api-key: <PHOTO_VISION_API_KEY>` (the key is never put in the URL).
- Body: `contents: [{ parts: [{ text: <prompt> }, { inline_data: { mime_type: 'image/jpeg', data: <base64> } }] }]`, `generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: <schema> }`.
- Schema (the model must return exactly these keys, all required): `description` string; `is_food_or_drink` boolean; `food_confidence` number 0..1; `prominent_face_count` integer; `minor_face_visible` boolean; `any_person_part_visible` boolean; `large_text` boolean; `text_fraction` number 0..1; `text_seen` string. The adapter maps snake_case to `VisionFields`. The adapter's contract test pins the exact request body.
- Starting prompt (a constant in the adapter): "You are screening a photo submitted to a theme-park dish gallery. Fill the fields from what is visible. prominent_face_count: the number of human faces that are clearly recognizable, including in the background. minor_face_visible: true if any visible face appears to be a child's. any_person_part_visible: true if any part of a person (hand, arm, legs) is visible. text_fraction: the approximate fraction of the image area covered by text, signs, menus, receipts or screens, from 0 to 1. text_seen: a short transcription of the most prominent text, at most 200 characters. is_food_or_drink and food_confidence: whether the main subject is food or a drink, and how sure you are, from 0 to 1. description: one short sentence."
- Response parsing: take `candidates[0].content.parts[]` and use the **last** part that has a `text` (parts may include a `thoughtSignature` part). `usageMetadata.promptTokenCount` and `candidatesTokenCount` feed `photo_usage_daily`.
- Retry and fallback: in-call retries on 429/5xx/timeout with delays 500 ms and 1500 ms (two retries) and a per-call timeout `PHOTO_VISION_TIMEOUT_MS` (20000). On HTTP 404 for the primary model (model retired), log `vision_model_unavailable` at `error`, then try `PHOTO_VISION_FALLBACK_MODEL` once. If everything fails, return the retryable outcome.

**Observations from a planning-time test (7 photos; not reproducible from this repo).** During planning, seven real Disney food photos, resized to about 965×1280 JPEG at quality 75 (93 to 231 KB each), were sent to `gemini-3.5-flash-lite` with the request shape above. The planning conversation reported: `usageMetadata.promptTokenCount` about 1358 per photo (including about 250 prompt tokens), `candidatesTokenCount` about 150 to 190, latency about 1.5 seconds, and a correct decision on all 7 (5 accepted, including photos with a hand, arm, or legs and branded packaging text; a receipt rejected as non-food with `text_fraction` about 0.85; a crowded restaurant shot with a child's face rejected). Neither the photos nor the raw responses are in the repo, so none of these numbers is a requirement and none may be used to size budgets; they only motivate the response shape and the starting thresholds. Task 12.2 re-measures on a labeled set, and **the model id `gemini-3.5-flash-lite` must be confirmed as still served before launch** (two other ids below were retired).

Lessons encoded in this design:

1. **Models get retired.** `gemini-2.5-flash-lite` and `gemini-2.5-flash` returned HTTP 404 "no longer available to new users", and `gemini-3.1-flash-lite` returned 503 once under load. So the model is config (`PHOTO_VISION_MODEL`), calls retry with backoff, and a fallback model is configured (`PHOTO_VISION_FALLBACK_MODEL`).
2. **Free tier is for development only.** Google's pricing page, as reported during planning, says the paid tier handles data differently from the free tier (**verify the exact wording and current terms before launch**). Because user photos are third-party data, the paid tier is required before public release (Requirement 21.4). Task 14.2 records this as a launch gate.
3. **The sample is small.** It was 7 photos from one phone. Thresholds are starting values only. Requirement 24 and task 12 provide an evaluation script and a manual task for a 100-photo labeled set. No results beyond the 7 above are claimed.

## Configuration & Constants

All variables are read in `config.ts` (`photos` namespace, Zod `envSchema`, `.default(...)`, `z.coerce.number()`). The names are final. No value appears in the repo. Secrets live only in environment variables; `apps/api/.env.example` lists names with empty values and `render.yaml` lists them with `sync: false`. Decision D35 adds no environment variable: the album page size reuses Requirement 9.4 (default 40, maximum 100) and URL lifetime reuses `PHOTOS_GET_URL_TTL_SECONDS`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PHOTOS_ENABLED` | `false` | Global kill switch. Off: only `GET /photos/config` is registered. |
| `PHOTOS_FOOD_ENABLED` | `true` | New food uploads allowed. |
| `PHOTOS_TRIP_ENABLED` | `true` | New trip uploads allowed. |
| `PHOTOS_CRON_SECRET` | none; required when enabled | `x-cron-secret` value for the Sweep; must differ from the other cron secrets. |
| `PHOTO_STORE_ENDPOINT` | none; required when enabled | `https://<account-id>.r2.cloudflarestorage.com` |
| `PHOTO_STORE_BUCKET` | none; required when enabled | The new photos bucket. |
| `PHOTO_STORE_ACCESS_KEY_ID` | none; required when enabled | Bucket-scoped token id. |
| `PHOTO_STORE_SECRET_ACCESS_KEY` | none; required when enabled | Bucket-scoped token secret. |
| `PHOTO_STORE_REGION` | `auto` | |
| `PHOTO_HARM_API_KEY` | none; required when enabled | Harm provider key. |
| `PHOTO_HARM_BASE_URL` | `https://api.openai.com` | |
| `PHOTO_HARM_MODEL` | `omni-moderation-latest` | |
| `PHOTO_HARM_TIMEOUT_MS` | `15000` | |
| `PHOTO_HARM_INVALID_IMAGE_CODES` | empty (comma-separated list) | Allow-list of provider error codes/params that mean "the image cannot be decoded" and justify a permanent `invalid_image` rejection on HTTP 400 (R6.6). Empty until populated from the live probe (task 14.5); while empty every 400 is retryable `harm_bad_request`. |
| `PHOTO_HARM_BAD_REQUEST_ALERT_COUNT` | `5` | Consecutive `harm_bad_request` results in one process before the `photos.harm.bad_request_streak` error event is logged (R6.9). |
| `PHOTO_HARM_SCORE_THRESHOLD` | `0.5` | Flag when any category score is at or above this. |
| `PHOTO_HARM_CHECK_THUMB` | `true` | Also harm-check the thumbnail. |
| `PHOTO_VISION_API_KEY` | none; required when enabled and food enabled | Vision provider key. |
| `PHOTO_VISION_BASE_URL` | `https://generativelanguage.googleapis.com` | |
| `PHOTO_VISION_MODEL` | `gemini-3.5-flash-lite` | |
| `PHOTO_VISION_FALLBACK_MODEL` | `gemini-3.1-flash-lite` | Tried once on a 404 for the primary. |
| `PHOTO_VISION_TIMEOUT_MS` | `20000` | |
| `PHOTO_VISION_MIN_FOOD_CONFIDENCE` | `0.6` | |
| `PHOTO_VISION_MAX_PROMINENT_FACES` | `0` | Reject when the count exceeds this. |
| `PHOTO_VISION_MAX_TEXT_FRACTION` | `0.25` | |
| `PHOTOS_DAILY_UPLOAD_CAP` | `20` | Per user per America/New_York day. |
| `PHOTOS_GLOBAL_DAILY_CAP` | `2000` | Total uploads across all users per America/New_York day, counted per item in `photo_usage_daily.uploads` (R5.10); beyond it initiate returns `photo_uploads_disabled`. A cost ceiling, not a quota: raise it deliberately after watching spend. |
| `PHOTOS_MAX_PER_FOOD_LOG` | `4` | |
| `PHOTOS_MAX_PER_TRIP` | `300` | |
| `PHOTOS_MAX_FEED_POST_PHOTOS` | `4` | |
| `PHOTOS_MAX_BATCH` | `10` | |
| `PHOTOS_MAX_BYTES` | `1048576` | Full image. |
| `PHOTOS_MAX_THUMB_BYTES` | `65536` | |
| `PHOTOS_PUT_URL_TTL_SECONDS` | `900` | |
| `PHOTOS_GET_URL_TTL_SECONDS` | `3600` | |
| `PHOTOS_ADMIN_URL_TTL_SECONDS` | `300` | |
| `PHOTOS_UPLOAD_EXPIRY_MINUTES` | `120` | `uploading` rows older than this are expired. |
| `PHOTOS_MODERATION_MAX_ATTEMPTS` | `6` | |
| `PHOTOS_MODERATION_LEASE_SECONDS` | `180` | Renewed before the harm step, before the vision step, and before publishing (R8.3). `loadConfig` requires it to be at least `ceil(max(2 × PHOTO_HARM_TIMEOUT_MS, 2 × (3 × PHOTO_VISION_TIMEOUT_MS + 2000)) / 1000) + 10` (134 with the defaults, R8.14). |
| `PHOTOS_NEEDS_REVIEW_MAX_AGE_HOURS` | `120` | A `needs_review` photo older than this (from `created_at`) is deleted by the sweep (R8.16). `loadConfig` requires it plus 24 to be at most `PHOTOS_UPLOAD_PREFIX_EXPIRY_DAYS × 24`. |
| `PHOTOS_UPLOAD_PREFIX_EXPIRY_DAYS` | `7` | The age the bucket lifecycle rule expires `u/` objects at. The API does not configure the bucket; this value documents the dashboard rule and feeds the validation above. |
| `PHOTOS_MODERATION_CONCURRENCY` | `3` | |
| `PHOTOS_REJECTED_RETENTION_HOURS` | `24` | |
| `PHOTOS_REPORT_AUTOHIDE_FOOD` | `3` | |
| `PHOTOS_REPORT_AUTOHIDE_TRIP` | `1` | |
| `PHOTOS_RECAP_HIGHLIGHT_MAX` | `6` | Maximum recap highlight photos (one per New York day of `sort_at`, chronological, D21, D29, R26.6). Renamed from `RECAP_HIGHLIGHT_MAX` so every photo variable carries the `PHOTOS_` prefix and the docs guard of task 14.1 covers it. Integer 1 to 24, validated in `loadConfig` only when `PHOTOS_ENABLED` is true (like the other photo checks); applies to the members' recap and the recipient's recap. Read into `config.photos.recapHighlightMax`. |
| `PHOTOS_EXPERIENCE_STRIP_MAX` | `8` | Maximum photos in the experience-page "Photos from guests" strip (Requirement 27). Integer 1 to 24, validated in `loadConfig` only when `PHOTOS_ENABLED` is true. Read into `config.photos.experienceStripMax` and reported to the app as `experienceStripMax` by `GET /photos/config`; the app sends it as `limit` on `GET /experiences/:id/food-photos`. Not a secret: `render.yaml` carries the default. |
| `PHOTOS_SWEEP_BATCH` | `200` | |
| `PHOTOS_SWEEP_TIME_BUDGET_MS` | `25000` | |
| `PHOTOS_VISION_FIELDS_RETENTION_DAYS` | `30` | |
| `PHOTOS_EXIF_POLICY` | `log` | `log` counts and logs an Exif segment; `reject` rejects the photo with `invalid_image`. |
| `PHOTOS_EXIF_SCAN_BYTES` | `65536` | How much of each object the Exif scan reads. |
| `EXPO_PUBLIC_PRIVACY_POLICY_URL` (mobile) | empty string | The public URL of the hosted `docs/privacy-policy.md`; read into `PRIVACY_POLICY_URL` in `apps/mobile/src/photos/constants.ts`. When non-empty the disclosure shows a "Read the privacy policy" link that opens it with `Linking.openURL`; when empty the disclosure still shows its own text naming OpenAI and Google and no link is rendered. Hosting the page and setting this variable is a launch gate (task 14.4). |
| `PHOTOS_DISCLOSURE_VERSION` (mobile constant) | `1` | Part of the AsyncStorage key `photos.disclosure.v<version>`; bump to show the disclosure again. |

Code-level constants in `@dwt/shared/constants/photos.ts`: full long edge 1280 px, JPEG quality 0.75, thumbnail long edge 320 px, thumbnail quality 0.7, report note max 300, caption max 500, max dimension 4096, status-poll cadence (3 s for 60 s, then 15 s), list stale time 30 minutes. Other constants: the in-memory queue bound (200), upload counter retention (7 days), usage retention (90 days), retry formula `min(60 s × 4^(attempts−1), 6 h)`, the 2000-01-01 lower bound for `taken_at`.

**Cron suggestion.** One cron-job.org job, `HEAD https://<render-host>/internal/photos/sweep/run` with header `x-cron-secret: <PHOTOS_CRON_SECRET>`, crontab `5 7,13,19,0 * * *` in America/New_York (at most 4 passes per day). `HEAD` avoids the 8 KB response limit described in `docs/hosting.md`. The keep-alive job must never call it.

**Budget alert guidance (docs).** Set a billing notification on the Cloudflare account for R2 storage and operations. Set a billing budget with alerts on the Google Cloud project that owns the Gemini key. The OpenAI Moderation endpoint is documented as free at the time of writing (not verified here; verify current pricing and terms before launch, as with the R2 free-tier limits and the Gemini paid-tier pricing and data terms); watch for 429s in the logs. Review `photo_usage_daily` in the admin page weekly. The kill switches (`PHOTOS_ENABLED`, `PHOTOS_FOOD_ENABLED`, `PHOTOS_TRIP_ENABLED`) are the manual emergency stop, and `PHOTOS_GLOBAL_DAILY_CAP` is the automatic one: it bounds provider calls and storage growth per day regardless of how many accounts upload. The log events `photos.harm.bad_request_streak`, `vision_model_unavailable`, and any `harm_auth_error` are the ones to alert on; each means every new photo is about to stall in `pending` and then `needs_review`.

## Correctness Properties

### Property 1: Vision verdict is a pure, deterministic function of the fields and thresholds

For any valid `VisionFields` and `VisionThresholds`, `computeVisionVerdict` returns the same result on repeated calls and equals an independently written oracle: `accept` exactly when none of the three rules trips, and otherwise `reject` with `reasons` equal to the tripped rules in precedence order (`face_visible`, `not_food`, `too_much_text`) and `primary` equal to the first.

**Validates: Requirements 7.3, 7.4, 7.5, 7.6, 7.9**

### Property 2: Body parts alone never reject, and large_text is never read

For any valid fields with `prominentFaceCount = 0`, `minorFaceVisible = false`, `isFoodOrDrink = true`, `foodConfidence >= minFoodConfidence`, and `textFraction <= maxTextFraction`, the verdict is `accept` for every value of `anyPersonPartVisible` and `largeText`. Flipping either of those two booleans never changes the verdict for any input.

**Validates: Requirements 7.7, 7.8**

### Property 3: Verdict monotonicity

Raising `textFraction`, lowering `foodConfidence`, raising `prominentFaceCount`, or turning `minorFaceVisible` on can never turn a `reject` into an `accept` and can only add reasons. Any `minorFaceVisible = true` input is rejected with `face_visible` regardless of every other field.

**Validates: Requirements 7.4, 7.5, 7.6**

### Property 4: Rejection copy is independent of model text

For any two inputs that differ only in `description` and `textSeen`, the verdict and the user-facing message are identical. For every `PhotoRejectReason` the message is a non-empty string from the copy table and contains neither the input `description` nor `textSeen`.

**Validates: Requirements 7.10, 7.12**

### Property 5: Parsing rejects malformed model output instead of guessing

For any value that violates the schema (a missing key, a wrong type, a non-finite number, `textFraction` outside `[0,1]`, a negative or non-integer face count), `parseVisionFields` returns `{ ok: false }`. For any valid object it round-trips every field, with strings truncated to their maxima.

**Validates: Requirements 7.1, 7.11**

### Property 6: Harm verdict

For any provider result, `computeHarmVerdict` returns `flag` exactly when `flagged` is true or some category score is at or above the threshold, and `pass` otherwise. The result is monotone in every score.

**Validates: Requirements 6.3, 6.4**

### Property 7: Status machine permits only legal transitions

For any sequence of events applied through `applyOutcome` and `canTransition`, the status is always reachable from `uploading` through the R8.8 table, `deleted` is terminal, and `approved` is only ever reached with `harm_verdict = 'pass'` and, for a `harm_and_vision` target, `vision_verdict = 'pass'`. This holds for the operator path too: `operatorApprove` on a `needs_review` photo yields a patch with both verdicts `pass` and `approved_by_operator = true`, never an `approved` status with a null or non-pass verdict. The same invariant holds in the database (the `chk_photos_served_*` CHECKs reject a violating write).

**Validates: Requirements 8.1, 8.8, 8.12, 6.4, 7.2**

### Property 8: Provider errors never decide a photo

For any sequence of provider outcomes that contains only `retryable` results, the photo is never `approved` or `rejected`: it stays `pending` (with a backoff `next_attempt_at` and `lease_until = NULL`) until a retryable outcome occurs at `attempts >= max`, and then becomes `needs_review` in that same step (no wait for `next_attempt_at`). A `retryable` outcome never writes a verdict. A harm-provider HTTP 400 is retryable (`harm_bad_request`) unless its body matches the allow-list, and with an empty allow-list no 400 ever rejects. The escalation write at claim fall-through never applies to a photo whose lease is live.

**Validates: Requirements 6.5, 6.6, 6.9, 7.11, 8.5, 8.6**

### Property 9: Retry backoff

`nextAttemptAt(now, attempts)` is strictly greater than `now`, non-decreasing in `attempts`, equal to `now + 60 s × 4^(attempts−1)` until it reaches the 6-hour cap, and never exceeds `now + 6 h`.

**Validates: Requirements 8.5**

### Property 10: Visibility oracle

For any combination of viewer, owner, status, kind, membership, block relation, and context, `canViewPhoto` equals an independently declared truth table: the owner sees every non-`deleted` photo; others see only `approved` photos; `hidden`, `deleted`, and non-approved photos are never visible to others; trip photos require membership (or the Summary_Share rules in the `summaryShare` context); a block in either direction hides the photo; nobody sees a `deleted` photo.

**Validates: Requirements 8.2, 10.3, 12.3, 16.5, 17.3**

### Property 11: Quota and caps are never exceeded

For any sequence of initiate requests applied serially to the in-memory model of the counters and target counts (the real initiate is serialized per target by `pg_advisory_xact_lock` and per user and per day by the conditional counter updates, R5.2, R5.3, R5.10), the accepted photo total per user per day, counted per request item, never exceeds the daily cap; the accepted total across all users per day never exceeds `PHOTOS_GLOBAL_DAILY_CAP`; the non-deleted count per food log never exceeds 4, and per trip never exceeds 300. Deleting a photo never lowers either daily count. A request refused by the global ceiling also leaves the per-user count unchanged (one transaction). A rejected request changes nothing. (The pg-mem repo test covers the SQL; true concurrency is not provable in pg-mem and is not claimed.)

**Validates: Requirements 5.1, 5.2, 5.3, 5.7, 5.10**

### Property 12: Object keys are derived only from the photo id

For any UUID, `photoKeys` returns four pairwise-distinct keys: `uploadFull` and `uploadThumb` matching `^u/<uuid>/(full|thumb)\.jpg$`, and `full` and `thumb` matching `^p/<uuid>/(full|thumb)\.jpg$`; for any non-UUID string it throws. No user-supplied text appears in a key, and the key sets are partitioned by purpose: a presigned PUT is only ever requested for `uploadFull` and `uploadThumb`; viewer (`other`) read URLs are minted only for `full` and `thumb`; the owner additionally gets the `uploadThumb` preview while the photo is `uploading`, `pending`, or `needs_review`; and only the `admin` viewer kind can be given `uploadFull` (plus `uploadThumb`), and only for a `needs_review` photo. For every status and every viewer kind (7 x 3), `readKeysFor` equals the independently declared table in Components and never returns an Upload_Key for `other`.

**Validates: Requirements 3.3, 3.8, 9.9, 18.2**

### Property 13: Report policy

For any sequence of reports, the number of distinct counted open reporters is what `shouldAutoHide` sees: duplicates by the same reporter do not increase it, `dismissed` reports do not count, and the photo hides exactly when the count reaches the threshold for its kind and it was `approved`. For a food photo every distinct open reporter is counted. For a Trip photo only reporters who are current members of that Trip are counted: for any mix of member reporters, non-member reporters, and reports made through a `shareId` (generated over reporter kind, order, and repetition), the photo is hidden exactly when the number of distinct current-member open reporters reaches `PHOTOS_REPORT_AUTOHIDE_TRIP`; a non-member or share report is recorded (and listed for the admin) but never changes the count, and a reporter who leaves the Trip after reporting stops counting.

**Validates: Requirements 16.3, 16.4, 16.6, 16.9**

### Property 14: Food photo DTOs and SQL never leak log fields

For any food log with a sentinel `note`, `rating`, `visitedOn`, `userTz`, `loggedAt`, and log id, the serialized `FoodPhotoDTO` list and the dish and restaurant gallery responses contain none of those sentinels, and expose the upload time only as the `createdDay` date (no `createdAt`, no time of day). For any viewer, uploader, and Friend relation, `FoodPhotoDTO.uploader` is non-null exactly when the viewer is the uploader or a Friend of the uploader; for every other viewer the whole serialized response contains none of the uploader's user id, display name, or avatar preset (sentinel strings seeded on the uploader's profile), and the same holds for `GET /me/blocks` entries created from a photo id. A source-level guard asserts that no SQL string under `services/photos/` that mentions `food_item_logs` contains `note`, `*`, `SELECT *`, or `RETURNING *`, or selects any column other than `id`, `user_id`, `food_item_id`; the guard is an allowlist (every column resolving to `food_item_logs` must be in `{ id, user_id, food_item_id }`, so `user_tz` and any future column are rejected without being named), with a negative fixture that selects `l.user_tz` and must fail.

**Validates: Requirements 10.5, 10.6, 10.7, 11.7, 17.1**

### Property 15: Sweep completeness and idempotence

Against a fake Object_Store and an in-memory model of the photo table, after one sweep every photo in `deleted` has had both objects removed and its row removed; photos that are not `deleted` are untouched; a failing store delete leaves the row with `delete_attempts` incremented; a second sweep with a working store finishes the job; running the sweep twice on a stable input equals running it once.

**Validates: Requirements 19.3, 19.5, 19.6, 19.8**

### Property 16: Orphan reaper

For any combination of existing and missing owners, logs, and trips, the reaper marks `deleted` exactly the non-deleted photos whose `owner_id` is null or whose target no longer exists, and no others.

**Validates: Requirements 19.4, 12.9, 10.8**

### Property 17: Album is a view with stable keyset pagination

For any set of trip photos with arbitrary `sort_at` ties, paging through `GET /trips/:id/photos` with any page size from 1 to 100 returns every visible photo exactly once in `(sort_at desc, id desc)` order, with no duplicates and no gaps, and the set equals the viewer's visible photos including feed-attached ones.

**Validates: Requirements 13.1, 13.2, 9.4**

### Property 18: Single lifecycle

After deleting a trip photo, it is absent from the Album and its feed slot is `removed`; a post whose photo was deleted still exists. This still holds after the Sweep hard-deletes the photo row: the slot is `removed` in its original position (Property 35). After deleting a post, its photos are `deleted` and its reactions and comments are gone. For any uploader membership state (current member, organizer, removed, left), the uploader's `DELETE` of their own Trip photo succeeds because the route authorizes on `owner_id`, while a removed member's read of the Album or an upload is `trip_forbidden`; a delete by a caller who is neither the uploader nor an organizer of the photo's Trip is `photo_not_found`.

**Validates: Requirements 1.6, 12.5, 12.6, 12.11, 13.4, 14.6, 14.7, 14.10**

### Property 19: Trip photos get the harm check only

For any trip photo, the runner calls the Harm_Moderator and never calls the Vision_Checker; for any food photo, it calls the Vision_Checker only after a passing harm verdict.

**Validates: Requirements 7.2, 12.4, 6.1**

### Property 20: Trip permission matrix

For every Trip_Role and action, `can(role, action)` equals the independently declared partition: `upload_trip_photo`, `post_feed_photo`, and `share_trip_summary` are allowed for member and organizer; `delete_any_trip_photo` is allowed only for organizer; and every pre-existing action keeps its prior result.

**Validates: Requirements 12.1, 12.5, 14.3, 15.9**

### Property 21: Summary-share access

For any combination of share state (recipient present, recipient-deleted, `includePhotos`), **whether the recipient is currently a Friend of the sharer**, sharer membership, Trip existence, photo status, and block relation, the response is determined as follows. If the recipient row is absent or deleted, or the recipient is not currently a Friend of `shares.sender_id` (unfriended after the send), the route answers the collapsed `validation_failed` with no figure, no photo, and no URL (R15.14). Otherwise, if the sharer left the Trip or the Trip is gone, the response is `recap: null` with `photos.access` of `unavailable` and no photo, whatever `includePhotos` is (R15.15, `unavailable` wins). Otherwise `recap` is the allowlist projection of the live summary, and the photos equal `selectRecapHighlights(eligible, PHOTOS_RECAP_HIGHLIGHT_MAX)` where `eligible` is the set of `approved` Trip photos satisfying every R15.3 condition (with `access` of `granted`), or are empty with `access` of `not_included` when `includePhotos` is false. No per-photo attribute other than status and block changes the result (there is no opt-out flag, R12.7), and the response contains no uploader identity, no `perMember` data, and no member id. No sender-side revoke exists, so no revoked state is generated (D22).

**Validates: Requirements 15.3, 15.5, 15.6, 15.12, 15.14, 15.15, 12.7**

### Property 22: Feed post validation and slot visibility

For any set of referenced photos, a post is created only when all photos belong to the caller, target that trip, have status `pending`, `approved`, or `needs_review`, and are unlinked, and the count is 1 to 4; failure creates nothing. `tripPostSlotState` equals the truth table in Components (an exhaustive check over every status, `mine`, and `blocked` combination). For any viewer, a `member_post` whose slots are all `removed` or `unavailable` is omitted unless the viewer is the author, and a post with at least one `ready` or `checking` slot is shown. The feed item carries `mine = true` exactly when the viewer is the post's author (the author id comes from the `FeedPhotoPort`, not from `getFeed`, and never appears in a response), including when every slot is removed. A post delete succeeds only for a feed item with `trip_id = :id` and `type = 'member_post'`; for any other item (a post of another Trip, a system feed item, an unknown id) it answers `trip_not_found` and changes nothing, whatever the caller's role. With no `FeedPhotoPort` wired, every `member_post` item is returned with an empty `photos` array, no `mine`, and no `photoIds` in `metadata`.

**Validates: Requirements 14.1, 14.2, 14.4, 14.7, 14.9, 14.11, 14.13, 14.14**

### Property 23: Configuration validation

For any environment, `loadConfig` fails exactly when `PHOTOS_ENABLED` is true and at least one of these holds: a required storage, harm, or cron variable is missing (or the vision key is missing while food is enabled); `PHOTOS_CRON_SECRET` equals another cron secret; `PHOTOS_MODERATION_LEASE_SECONDS` is below `ceil(max(2 × harmTimeoutMs, 2 × (3 × visionTimeoutMs + 2000)) / 1000) + 10`; or `PHOTOS_NEEDS_REVIEW_MAX_AGE_HOURS + 24 > PHOTOS_UPLOAD_PREFIX_EXPIRY_DAYS × 24`; or `PHOTOS_RECAP_HIGHLIGHT_MAX` is not an integer from 1 to 24. All of these checks, including the cron-secret collision and both derived checks, apply only when `PHOTOS_ENABLED` is true; with `PHOTOS_ENABLED` false (or unset) `loadConfig` never fails because of any photo variable, whatever values the lease, age, and secrets hold. `PHOTO_HARM_INVALID_IMAGE_CODES` parses as a comma-separated list and an empty value is the valid empty list.

**Validates: Requirements 8.14, 8.18, 20.2, 20.3, 20.4, 20.8, 6.6, 26.6**

### Property 24: Client resize plan

For any source width and height, the planned full size has a long edge no greater than 1280 and never exceeds the source in either dimension; the planned thumbnail has a long edge no greater than 320; aspect ratio is preserved to within rounding; and a source already within the limit is not enlarged.

**Validates: Requirements 2.1, 2.2, 2.4**

### Property 25: Client upload state machine

For any sequence of events, the per-photo upload state only moves along legal edges (`selected → preparing → requesting → uploading → confirming → checking → approved | rejected`, with `failed` reachable from the active states and `retry` returning to the failed step), never from a terminal state, and the bearer token is never attached to the storage request.

**Validates: Requirements 3.5, 23.2, 23.4**

### Property 26: The served object is exactly the moderated object

Using the fake Object_Store with a hook that lets a test overwrite any object at any step, for every overwrite point (after confirm and before the runner reads; between the runner's read and the copy; after the copy), the invariant holds that a serving key never contains bytes that were not the object whose ETag was recorded at confirm and moderated: an overwrite before the copy leads to `rejected` (`invalid_image`) with no serving-key object left behind; an overwrite after the copy changes only the upload key, which no viewer read URL can reach; a copy whose destination ETag differs is deleted and the photo is rejected. No presigned PUT is ever requested for a serving key. Partial verdicts persisted before an overwrite are not reused against the new bytes.

**Validates: Requirements 3.8, 4.9, 8.10, 8.11, 9.9**

### Property 27: Admin POSTs are same-origin only

For any combination of `Sec-Fetch-Site`, `Origin`, and `Host` header values, `isSameOriginRequest` equals an independently written oracle: when `sec-fetch-site` is present it is true only for `same-origin`; otherwise, when `origin` is present, true only when its host equals `host`; otherwise true. A cross-site request to any `POST /admin/photos/*` route returns `403` and changes no state.

**Validates: Requirements 18.9**

### Property 28: Exif scan

For any generated JPEG byte sequence built from a random list of marker segments, `hasExifSegment` returns true exactly when the sequence has an APP1 segment whose payload begins with `Exif\0\0` within the scan limit, never throws on truncated or random bytes, and never reads past the buffer. Under policy `log` the photo's outcome is identical with and without an Exif segment; under policy `reject` a photo with one is rejected with `invalid_image` and no provider is called.

**Validates: Requirements 2.7, 2.8**

### Property 29: Status polling costs one request per tick

For any set of pending photo ids and any elapsed time, the client poll plan issues exactly one `GET /me/photos/status` request per tick containing at most 10 ids (chunking in groups of 10 only when more than 10 are pending), uses a 3 s interval for the first 60 s and 15 s afterwards, drops ids whose status is final, and issues no request when none is pending.

**Validates: Requirements 4.10, 23.4, 23.10**

### Property 30: Overlapping moderation jobs never remove the objects behind a served photo

Using the fake Object_Store and a fake clock with a short lease, for any interleaving of two runs of `process()` on the same photo (the second claims after the lease expires while the first is still running, in every order of their steps): the photo ends in exactly one final state; if either run published it (`approved`), the Serving_Key objects exist and equal the moderated bytes whichever run finishes last; a run whose final conditional write affects zero rows re-reads the status and deletes Serving_Key objects only when the status is neither `approved` nor `hidden`, so `servingCleanupAfterZeroRows` equals its oracle for every status; a run that loses and finds the upload objects already deleted by the winner changes nothing (the missing-object rejection is a conditional write that affects zero rows). A photo deleted mid-job ends with no Serving_Key objects. A stale job whose lease expired and was re-claimed renews zero rows (renewal is conditional on the `attempts` value its own claim returned) and exits, so two jobs never both keep a live lease.

**Validates: Requirements 8.3, 8.13, 8.15, 8.20**

### Property 31: Missing upload objects and `needs_review` age are resolved, not retried forever

For any photo whose upload object is missing at moderation or at `operatorApprove`, the outcome is `rejected` with `invalid_image`, no provider is called, and the attempt count does not drive a retry. For any set of `needs_review` photos with arbitrary `created_at` and a clock, one sweep sets to `deleted` exactly those older than `PHOTOS_NEEDS_REVIEW_MAX_AGE_HOURS`, leaves younger ones untouched, and a second sweep changes nothing. With the default configuration the age limit plus 24 hours is at most the `u/` lifecycle expiry (checked by the config property).

**Validates: Requirements 8.15, 8.16, 19.3, 19.11**

### Property 32: Strike history survives the sweep

For any sequence of operator removals, report additions, sweeps, and ban actions applied to an in-memory model of photos, reports, and strikes, the uploader's `upheld_count` equals the number of distinct photos of that uploader the operator has removed, regardless of how many reports each photo had and regardless of how many sweeps ran in between (a sweep hard-deletes the photo and cascades its reports, and the count does not change). Removing the same photo twice counts once. `ban-uploader` is accepted for a photo in any status, including `deleted` and not yet swept. The repo test replays the same sequence against the real SQL: remove a photo, run the sweep, and read the count back.

**Validates: Requirements 18.5, 18.6, 18.11**

### Property 33: Declared sizes equal sent sizes

For any prepared full and thumbnail blobs of arbitrary lengths, the initiate payload built by the client upload plan declares `byteSize` equal to the full blob's `size` and `thumbByteSize` equal to the thumbnail blob's `size`, the two `PUT` requests carry exactly those two blobs as bodies with only the `Content-Type: image/jpeg` header, and no `Content-Length` header is set by the client code. The plan never reads a size from any source other than the blobs.

**Validates: Requirements 3.9, 3.10**

### Property 34: Approved photos do not keep upload objects

For any set of `approved` or `hidden` photos with arbitrary `served_at` and `upload_cleaned_at`, one sweep deletes the two upload keys of exactly those with `served_at` older than one hour and `upload_cleaned_at` null, sets `upload_cleaned_at` for them, leaves the serving keys untouched, and a second sweep issues no further deletes. A failing store delete leaves `upload_cleaned_at` null so the next sweep retries it. Photos in any other status are untouched by this step.

**Validates: Requirements 19.12, 19.8**

### Property 35: Post slot order and placeholders survive the sweep

For any post created with an ordered list of 1 to 4 photo ids, any subset of those photos deleted (soft), and any subset of those rows then hard-deleted by the Sweep, `FeedPhotoPort.slotsForFeedItems` returns exactly one slot per original id in the original order; a slot is `removed` when its photo is `deleted` or its row no longer exists, and otherwise follows `tripPostSlotState`; the number of slots never changes and the order never changes, regardless of statement ordering of the underlying rows. The returned `authorId` equals the post's `actor_id`, the route-level `mine` equals `authorId === viewerId`, and neither `authorId` nor `photoIds` appears in the serialized response. The constant number of statements (two) does not depend on the number of posts.

**Validates: Requirements 14.4, 14.5, 14.6, 14.10, 14.11**

### Property 36: Detached jobs never escape as unhandled rejections

For any job that throws or rejects at any step (repo error, store error, adapter bug, pure-module bug), run through the moderation runner, the opportunistic resume, the queue pump, and the async sweep: no `unhandledRejection` is emitted, `photos.job.crashed` is logged once with the photo id (or `sweep`) and no image data, URL, or key, the photo is still `pending` (its lease expires and a later claim succeeds), and the sweep's single-flight guard is released so a following `tryStart` starts a new sweep; repeated crashes reach `attempts >= max` and escalate to `needs_review` rather than looping.

**Validates: Requirements 8.19, 8.6, 8.4**

### Property 37: Per-target cap counts only live uploads

For any set of photos on one target in any mix of statuses and ages, the count used for the cap equals the number of non-`deleted` photos excluding `uploading` rows older than `PHOTOS_PUT_URL_TTL_SECONDS`; a `rejected` photo counts until it is deleted; a request is refused with `photo_target_full` exactly when that count plus the requested items exceeds the cap.

**Validates: Requirements 5.3, 5.12**

### Property 38: Recap highlights

For any list of photos with arbitrary `id` and `sortAt` (including ties on `sortAt` and photos spanning the New York midnight boundary and a daylight-saving change) and any `max` from 1 to 24, `selectRecapHighlights` returns a list that (a) has at most one photo per America/New_York calendar day of `sortAt`, (b) contains for each day included the photo with the minimum `(sortAt, id)` of that day, (c) is in ascending day order, (d) has length `min(max, number of distinct days)` and consists of the earliest days when there are more than `max`, (e) is empty for empty input, (f) is identical for any permutation of the input, and (g) does not mutate its input. It equals an independently written oracle that sorts the whole input by `(sortAt, id)` and keeps the first photo seen per day. A bulk-upload case is pinned: for photos whose `created_at` all fall on one New York day but whose `sort_at` span several days, the result has one photo per `sort_at` day (the defect of the earlier upload-day rule), and a photo without a usable declared capture time (so `sort_at` equals its request time) is placed on its request-time day.

**Validates: Requirements 26.6, 13.7, 13.8, 15.5**

### Property 39: Experience photo strip

Client half, for any list of `RestaurantFoodPhotoDTO` items (arbitrary ids, names including blank and whitespace-only, and order) and any `max` from 1 to 24, `buildStripModel` returns (a) at most `max` items, (b) exactly the first `min(max, length)` input items in input order (it never re-sorts), (c) a non-empty `label` for every item, equal to the trimmed `foodItemName` or `"Dish"` when that is blank, (d) `visible === false` exactly when the input is empty (so the section, its heading, and its "See all" control are absent), and (e) it does not mutate its input. Server half, for any seeded set of food photos across several dishes of one restaurant in any mix of statuses (`pending`, `approved`, `hidden`, `rejected`, `deleted`), uploaders, Friend relations, and blocks in either direction, the first page of the restaurant gallery with `limit = n` equals the first `n` entries of an independently written in-memory oracle that keeps only `approved` photos whose uploader has no Block with the viewer, orders them by `(created_at, id)` descending, and attaches each photo's own dish name as `foodItemName`; every item carries a non-empty `foodItemName`; `nextCursor` is non-null exactly when more qualifying photos exist; and a second page via the cursor continues without repeats. No-leak, for any food log with sentinel `note`, `rating`, `visitedOn`, `userTz`, `loggedAt`, and log id, the serialized restaurant gallery response contains none of the sentinels, each item's keys are exactly the `FoodPhotoDTO` keys plus `foodItemName`, no item has `createdAt`, and `uploader` is non-null exactly when the viewer is the uploader or a Friend of the uploader (Property 14 restated for the new item shape; Property 14 itself is unchanged). The dish gallery items have no `foodItemName` key.

**Validates: Requirements 27.2, 27.3, 27.7, 27.8, 27.11, 27.12, 27.13**

### Property 40: Recap figures projection is an allowlist

For any `TripSummaryDTO` (arbitrary counts, any number of members, superlatives with and without `memberId`, `memberDisplayName`, `experienceName`, and `value`, `perMember` entries, and top-rated entries with extra fields such as `experienceId`, `park`, `category`, and `imageUrl`), `projectRecapFigures` returns an object whose keys are exactly `distinctExperienceCount`, `plannedCompletedCount`, `plannedTotalCount`, `superlatives`, and `topRated`; each superlative has only keys from `{ id, title, description, icon, experienceName, value, memberDisplayName }` and never `memberId`; `topRated` has at most 3 entries, each with only `experienceName`, `meanRating`, and `ratingCount`; no sentinel user id, member id, `perMember` key, or per-member count appears anywhere in the serialized result; the numeric fields equal the input's; and a `memberDisplayName` appears in the output only through the superlative field of the entry that carried it (D26). The result is independent of extra keys added to the input. (The key lists of this property are superseded by Property 43 and decision D34: the figures object gains three aggregate counts and a top-rated row gains the catalog fields `park`, `category` and `imageUrl`; the member-derived exclusions are unchanged.)

**Validates: Requirements 15.12, 15.16**

### Property 41: A photo belongs to at most one post

For any sequence of post-create calls over a pool of photos (arbitrary owners, trips, statuses among `uploading`, `pending`, `approved`, `needs_review`, `rejected`, `hidden`, `deleted`, and existing links), run against an in-memory model of the guarded link, a photo is linked to a post only when it was unlinked, owned by the caller, in the trip, and in a linkable status at the moment of the link; no photo appears in the `metadata.photoIds` of two posts; a create whose guarded update returns a different row count than requested leaves no feed item and links no photo; and deleting one post never changes the state of a photo listed by another post. The pg-mem integration test runs the real statements for the second-create-after-first case and for a photo moved to `rejected` between validation and link.

**Validates: Requirements 14.2, 14.12**

### Property 42: Disabling photos never leaks photo data or breaks the recap

For any `PHOTOS_ENABLED=false` configuration, any `member_post` feed items (arbitrary `photoIds`, caption, author), and any `tripSummary` share, the trips feed response contains no `photoIds` key at any depth, every `member_post` item has an empty `photos` array and no `mine`, and the recap route answers for a valid share with the figures and `photos.access` of `unavailable` and no photo or URL, while the collapsed `validation_failed` rules of Property 21 still apply unchanged.

**Validates: Requirements 14.14, 15.17, 20.9, 20.2**

### Property 43: Recap aggregate-only boundary

For any `TripSummaryDTO` (arbitrary counts, absent totals, absent or duplicated `parkBreakdown`, any `perMember` carrying sentinel ids, names, avatar presets and counts, superlatives with and without `memberId`, top-rated rows with and without `park`, `category` and `imageUrl` (absent or `null`), and extra unknown keys), `projectRecapFigures` returns a figures object whose key set is exactly `distinctExperienceCount`, `parksExploredCount`, `plannedCompletedCount`, `plannedTotalCount`, `superlatives`, `topRated`, `totalCompletionsCount` and `totalRatingsCount`; each top-rated row's keys are within `{ category, experienceName, imageUrl, meanRating, park, ratingCount }` and always include `experienceName`, `meanRating` and `ratingCount`, with each catalog key present exactly when the source has a value for it; no `experienceId`, `memberId`, `perMember`, `actor_id`, sentinel, or member-derived count appears anywhere in the serialized result; `totalCompletionsCount` and `totalRatingsCount` equal the summary's (or `0` when absent); `parksExploredCount` equals the number of distinct parks in `parkBreakdown`; and the result is identical for any two summaries that differ only in `perMember`. The input is not mutated.

**Validates: Requirements 15.12, 15.16, 15.21, 15.22, 15.24**

### Property 44: Recap album gate matrix

For any combination of recipient row (present, deleted, absent), Friendship of the recipient with `shares.sender_id` (yes, no), `includePhotos` (true, false), sharer membership (member, left), Trip existence (present, deleted), and photo wiring (`RecapPhotoPort` present, absent), the album route answers exactly as an independent table says: recipient absent or deleted, or not a Friend, gives the collapsed `validation_failed` with no photo, no URL and (read-order assertion) zero calls to `TripShareFacts.isMember`, `tripName` and `summary` and to the photo port; otherwise Trip gone or sharer left gives `200` `unavailable` with an empty list and `nextCursor` null; otherwise `includePhotos` false gives `200` `not_included` with an empty list; otherwise no port gives `200` `unavailable` with an empty list and no URL minted; otherwise `200` `granted`. `unavailable` wins over `not_included`. A Friend of a DIFFERENT user than `shares.sender_id` never opens it. For the same share state the album's `access` equals the recap route's `photos.access` whenever the gate passes.

**Validates: Requirements 15.25, 15.26, 15.30, 15.14, 15.15, 15.17**

### Property 45: Recap album completeness, exact key set and serving keys

For any set of Trip photos (arbitrary statuses among all seven, ties on `sort_at`, several uploaders, block relations in either direction with the recipient, photos of another Trip) and any `limit` from 1 to 100, following `nextCursor` from the first page returns exactly the `approved`, not-blocked photos of the share's Trip, each exactly once, in `(sort_at desc, id desc)` order; every page except the last has `limit` items; `nextCursor` is null exactly on the last page. The response key set is exactly `access`, `photos`, `nextCursor` and every item's key set is exactly `id`, `thumbUrl`, `url`, `width`, `height`, `sortAt`; no serialized response contains an owner id, uploader display name, feed item id, caption, object key, `u/` path or bucket name; every minted URL key matches `p/<id>/full.jpg` or `p/<id>/thumb.jpg` and exists in a store seeded with only `p/` objects. Client half: for any list of photos with arbitrary `sortAt`, `groupBySortAtNewYorkDay` returns groups whose concatenation is a permutation of the input, every item in a group has that group's New York day key, group keys strictly descend, and the order of items within a group follows the input order.

**Validates: Requirements 15.27, 15.28, 15.29, 15.32, 9.4**

## Error Handling

| Operation | Failure | Recoverable | Caller receives | Log |
| --- | --- | --- | --- | --- |
| Initiate | Validation (type, size, dims, batch) | yes | `400 photo_upload_invalid` or `validation_failed`, nothing created | none |
| Initiate | Not authorized for target | yes | `food_log_not_found` or `trip_forbidden` | none |
| Initiate | Daily cap | yes (next day) | `429 photo_quota_exceeded` | `info` |
| Initiate | Target full | yes (delete one) | `409 photo_target_full` | none |
| Initiate | Kill switch off | yes (operator) | `503 photo_uploads_disabled` with `details: { reason: 'kill_switch' }` | none |
| Initiate | Banned | no | `403 photo_uploads_banned` | `info` |
| Presign | R2 signing error (config) | no | `500 internal_error`; presign is local signing inside the initiate transaction before commit, so the quota and rows are rolled back | `error` |
| Client PUT | Network or 403 expired | yes | client retries; if expired, re-initiates | n/a |
| Confirm | Object missing | yes | `202` with per-item result `incomplete`; row stays `uploading` (no error code) | `info` |
| Confirm | Wrong type or too large | no | `202` with per-item result `invalid`; row to `deleted` | `warn` |
| Moderation job | Object ETag differs from the one recorded at confirm (overwritten) | no | photo `rejected` (`invalid_image`); nothing copied to a serving key | `warn` |
| Moderation job | Publish copy: `source_changed` (412, or destination ETag mismatch) | no | serving-key objects deleted; photo `rejected` (`invalid_image`) | `warn` |
| Moderation job | Publish copy: transient storage error | yes | retryable; photo stays `pending`; copy is idempotent so a retry is safe | `warn` |
| Moderation job or operator approve | Upload object missing (`ObjectMissingError`, `head` not found, or `copy` `source_missing`) | no | photo `rejected` (`invalid_image`) by a conditional write; no retry, no provider call; the owner can upload again | `warn` |
| Moderation job | Final conditional write affects zero rows | n/a | status re-read; Serving_Key objects deleted only if the status is not `approved`/`hidden`; otherwise nothing changes (another job published) | `info` |
| Sweep | `needs_review` older than `PHOTOS_NEEDS_REVIEW_MAX_AGE_HOURS` | no | photo `deleted`; objects removed in the same sweep; the owner sees it disappear | `info` |
| Initiate | Global daily ceiling reached | yes (next day, or the operator raises the cap) | `503 photo_uploads_disabled` with `details: { reason: 'global_cap' }` (the client shows "full for today" instead of "turned off", R5.11); the per-user reservation rolls back with the transaction | `warn` |
| Block | Photo not visible to the caller, or the caller's own photo | yes | `photo_not_found` (existence not revealed) or `validation_failed` | none |
| Moderation job | Exif segment found | n/a | policy `log`: counted, outcome unchanged; policy `reject`: `rejected` (`invalid_image`) | `warn` |
| Status poll (batch) | Unknown, or not-owned ids | yes | omitted from the response (existence not revealed); more than 10 ids is `validation_failed` | none |
| Admin POST | Cross-site request | yes | `403`, no state change | `warn` |
| Admin `approve` | `PHOTOS_ENABLED=false` (no Object_Store) | yes | refused with an explanatory message; other actions still work | none |
| Admin `approve` | Upload ETag changed since confirm | no | photo `rejected` (`invalid_image`) | `warn` |
| Confirm | Not owner or unknown id | yes | `photo_not_found` | none |
| HEAD | R2 outage | yes | `503`-style `internal_error`; rows stay `uploading` | `error` |
| Harm call | 429, 5xx, timeout, network | yes | none (async); photo stays `pending`, backoff | `warn` |
| Harm call | 401 or 403 | no until operator fixes | same as above, `harm_auth_error` | `error` |
| Harm call | 400 whose body matches `PHOTO_HARM_INVALID_IMAGE_CODES` (image cannot be decoded) | no | photo `rejected` (`invalid_image`) | `info` |
| Harm call | 400 with any other body (or any 400 while the allow-list is empty) | yes | none (async); `last_error_code = harm_bad_request`; photo stays `pending`, backoff, then `needs_review`; never a rejection | `error`; streak event `photos.harm.bad_request_streak` after `PHOTO_HARM_BAD_REQUEST_ALERT_COUNT` in a row |
| Moderation job | Final attempt found due with a live lease | n/a | not escalated; the `needs_review` write requires an expired lease | none |
| Sweep | Best-effort `u/` delete after approval failed | yes | `cleanApprovedUploads` deletes the two upload keys an hour later and sets `upload_cleaned_at` | `warn` on failure |
| Admin remove | Photo already swept (row gone) | yes | strike count unaffected (stored in `photo_upload_strikes`); the removal confirmation page still offers the ban | none |
| Client PUT | Declared size differs from sent body | no (a client bug) | prevented by sizing both from the same Blob (R3.9); a mismatch would be a storage 403 or a wrong `byte_size` | n/a |
| Vision call | 404 model retired | yes via fallback | fallback tried, else retryable | `error` `vision_model_unavailable` |
| Vision call | 429, 5xx, timeout, malformed JSON | yes | `pending`, backoff; at max attempts `needs_review` | `warn` |
| Moderation job | Process dies or sleeps | yes | lease expires; resumed by poll or Sweep; attempt already counted | none |
| Status poll | Not owner | yes | `photo_not_found` | none |
| Report | Cannot see, or own photo | yes | `photo_not_found` | none |
| Report | Duplicate | yes | `200`, no new row | none |
| Block | Self | yes | `validation_failed` | none |
| Feed post | Invalid photo set | yes | `validation_failed`, transaction rolled back | none |
| Album or gallery | Bad cursor | yes | `validation_failed` | none |
| Summary-share read | Not a recipient, deleted, no such share, or no longer a Friend of the sharer | yes | `validation_failed` (same as the existing inbox collapse) | none |
| Sweep | Object delete fails | yes | row kept, `delete_attempts + 1`, retried next sweep | `warn` |
| Sweep | Exceeds time budget | yes | stops cleanly; remaining work waits for the next tick | `info` |
| Sweep route | Bad secret | yes | `401 unauthorized` | `warn` |
| Config | Missing required var when enabled | no | startup `ConfigError` listing each variable | `error` |
| Detached moderation job or async sweep | Any thrown error or rejection (repo, store, adapter, pure-module bug) | yes | nothing (async); caught by `runContained`; the photo stays `pending` and is resumed after its lease expires, the sweep releases its single-flight guard; no `unhandledRejection` | `error` event `photos.job.crashed` with photo id or `sweep` and an error code only |
| Harm call | HTTP 401/403 | no until operator fixes | retryable `harm_auth_error` | `error` |
| Harm call | Any other non-2xx (404 retired model, 413, 422, ...) | yes | retryable `harm_http_<status>`; never a rejection | `error` |
| Recap read (recipient) | Not a recipient, share deleted, or unknown share | yes | collapsed `validation_failed`, no photo or figure | none |
| Recap read (recipient) | Recipient is no longer a Friend of the sharer (unfriended after the send) | yes | collapsed `validation_failed`, no figure, no photo, no URL; checked before any Trip data is read (R15.14, D25) | none |
| Recap read (recipient) | Sharer left the Trip, or Trip deleted | yes | `200` with `recap: null`, `photos.access: 'unavailable'`, and no photos; no figure and no URL; the card shows "This recap is no longer available" (R15.15, D27) | none |
| Recap read (recipient) | `includePhotos` false and the Trip is available | yes | `200` with the figures, `access: 'not_included'`, and no photos | none |
| Recap read (recipient) | `includePhotos` false and the sharer left | yes | `200` with `recap: null` and `access: 'unavailable'` (`unavailable` wins, D27) | none |
| Recap read (recipient) | `PHOTOS_ENABLED=false` (no `RecapPhotoPort`) | yes | `200` with the figures, `access: 'unavailable'`, and no photos (R15.17, D28) | none |
| Recap read (recipient) | `TripShareFacts` read throws (database error) | yes | `500 internal_error`; no partial figures are returned | `error` |
| Recap album read | Not a recipient, share deleted, unknown share, or no longer a Friend | yes | collapsed `validation_failed`, no photo, no URL; checked before any Trip data is read (R15.26, D25) | none |
| Recap album read | Sharer left the Trip, or Trip deleted | yes | `200`, `access: 'unavailable'`, `photos: []`, `nextCursor: null` (R15.26, D27) | none |
| Recap album read | `includePhotos` false | yes | `200`, `access: 'not_included'`, `photos: []` (R15.26) | none |
| Recap album read | `PHOTOS_ENABLED=false` | yes | `200`, `access: 'unavailable'`, `photos: []`, no URL minted, no `404` (R15.30, D28) | none |
| Recap album read | Bad `limit`, unknown query key or malformed cursor | yes | `400 validation_failed`, nothing read (R15.25) | none |
| Recap album screen | Request fails (network, 5xx) | yes | error state with Retry (R15.33) | none on the client |
| Recap album screen | Collapsed `validation_failed` or `access: 'unavailable'` | yes | "This recap is no longer available", no Retry (R15.33) | none on the client |
| Share create (`tripSummary`) | `TripShareFacts` not wired | no (configuration) | `validation_failed`; the wiring test (task 21.4) pins that production wires the port | none |
| Photo report or block with `shareId` | Friendship ended, share deleted, or photo not a current highlight | yes | `photo_not_found`; nothing recorded | none |
| Photo report or block with `shareId` (D35) | Photo is not approved, belongs to another Trip, is blocked either way, is the caller's own, or the share gate fails | yes | `photo_not_found`; nothing recorded (R16.10) | none |
| Photo report on a Trip photo | Reporter not a current Trip member, or reported through a `shareId` | yes | `200`; the report is stored and listed for the admin but does not count toward auto-hide (R16.9, D31) | none |
| Feed post create | A photo is already linked, changed status, or is not the caller's (guarded update returns a different count) | yes | `validation_failed`, transaction rolled back, no feed item (R14.12) | none |
| Feed post delete | Feed item is not a `member_post` of this Trip, or does not exist | yes | `trip_not_found`, nothing touched (R14.13) | none |
| Photo delete (Trip photo) | Caller is a former member deleting their own photo | n/a | succeeds (authorized on `owner_id`, R12.11, D30); reads and uploads by the same user remain `trip_forbidden` | none |
| Trips feed read | No `FeedPhotoPort` wired (`PHOTOS_ENABLED=false`) | n/a | `member_post` items returned with `photos: []`, no `mine`, and `photoIds` removed from `metadata` (R14.14) | none |
| Album `?summary=true` | Trip has no approved photos | yes | `200` with an empty list; the app omits the photos section | none |
| Initiate | Target cap reached only because of an `uploading` row older than the PUT URL lifetime | yes | not counted (R5.12); the new initiate succeeds | none |
| Feed read | A post's listed photo row was swept | yes | `removed` slot in its original position (R14.10) | none |
| Experience strip | Restaurant gallery request fails (network, 5xx, 401) | yes | the strip renders nothing: no spinner, banner, or placeholder; the rest of the experience page is unaffected (R27.9) | none on the client |
| Experience strip | Photo config request fails, or reports `enabled: false` | yes | no gallery request is made and no strip renders (R27.8) | none |
| Experience strip | Restaurant gallery returns an empty first page | n/a | the strip renders nothing and no "See all" or add control (R27.2) | none |
| Restaurant gallery | Bad `limit` (0, above 100, not an integer), unknown query key, or malformed `cursor` | yes | `400 validation_failed`, nothing read (R27.12) | none |
| Restaurant photos sheet | A later page request fails | yes | already loaded tiles stay; an inline error with a Retry control appears; the strip is unaffected | none on the client |
| Menu focus | `focusFoodItemId` matches no dish in `foodItemsQ`, or the dish is on no menu | yes | the menu tab is left unchanged; the dish gallery sheet opens when the food item resolves, otherwise the screen renders as without the param | none |

Input validation rules. All request bodies are Zod `.strict()` schemas; unknown keys fail. Ids are UUIDs. `contentType` must be exactly `image/jpeg`. Sizes are positive integers within the runtime maxima. Dimensions are integers 1 to 4096. `takenAt` is optional ISO-8601 and is clamped by the server (Requirement 13.3); an invalid value is ignored, not an error. Captions and notes are trimmed and length-checked. Cursors are opaque and validated on decode.

Invariant ownership. *Visibility* (`approved` required) is enforced in the pure `canViewPhoto` and in the SQL `WHERE status = 'approved'` of every list query (defense in depth, because a missing `WHERE` is the most dangerous bug). *No log leakage* is enforced at the SQL source (explicit columns, guard test) and at the DTO type. *Quota* is enforced in the database through the conditional update, because the API may have several instances. *Single lifecycle* is enforced by having exactly one row per photo. *Status transitions* are enforced in the pure state machine and by conditional `UPDATE ... WHERE status = ...`. *Secrets* are enforced by `loadConfig` as the sole reader of `process.env` for this feature. *Recap access* (current Friendship, non-deleted recipient row, sharer membership) is enforced in one place, `RecapShareGate` in the Sharing service, which both the recap route and the photo plugin's `shareId` branch call, so the two cannot drift. *One post per photo* is enforced in the database by the locking read plus the guarded update in the post-create transaction (R14.12). *Which reports count toward auto-hide* is enforced in the repo query that feeds the pure `shouldAutoHide`.

Security notes. The photo routes require sessions, and the internal sweep route requires the dedicated secret. Presigned URLs and bytes are never logged. The admin page escapes all user strings and sets `X-Robots-Tag`. No new route is unauthenticated except the cron route, which is gated by its secret (the secret comparison reuses the constant-time helper pattern in the Trip booking routes). The bucket is private. Public food photos still require a session so URLs are minted only for signed-in users.

## Testing Strategy

| Layer | Subject | Approach |
| --- | --- | --- |
| Pure/property (Vitest + fast-check, ≥100 runs, tagged `// Feature: photo-uploads, Property N: ...`) | `visionVerdict`, `harmVerdict`, `statusMachine`, `retryPolicy`, `accessPolicy` (including the exhaustive `tripPostSlotState` and `readKeysFor` truth tables), `quota`, `objectKeys`, `reportPolicy`, `albumCursor`, `sniff`, `exifScan`, `isSameOriginRequest`, `rejectionCopy`, `bylineFor`, `servingCleanupAfterZeroRows`, `selectRecapHighlights` | Properties 1–13, 20, 27, 28, 32 (model), 33, 38, 40 (`projectRecapFigures` allowlist), 41 (in-memory model of the guarded post link) against independent oracles; `readKeysFor` exhaustively over 7 statuses x 3 viewer kinds; `bylineFor` over viewer x Friend relation. |
| Runner with an overwrite-capable fake store | `moderationRunner`, `operatorApprove` | Property 26: the fake `ObjectStore` exposes `overwrite(key, bytes)` and a step hook so a test can replace an upload object at each of the three points; assert rejection, no serving-key leftovers, and no served photo that was not moderated. Property 30: two overlapping runs with a short fake-clock lease in every step order, asserting the served photo's objects survive. Property 31: a deleted upload object yields `invalid_image` with no provider call; the `needs_review` age sweep. |
| Adapter unit tests | R2 store, OpenAI adapter, Gemini adapter | Inject a fake `fetch` / stubbed S3 `send`. Pin exact request bodies and headers, parse real-shape fixtures (including a response with a `thoughtSignature` part), map every error class, and assert that no key appears in URLs or logs. OpenAI: a 400 with an unrecognised body is retryable `harm_bad_request`; a 400 matching a configured allow-list entry is `invalid_image`; with an empty allow-list every 400 is retryable; the streak event fires on the Nth consecutive result. |
| Sharing wiring and recap route (Phase 2) | `composeServices.ts` Sharing block, `tripRecapRoutes.ts`, `RecapShareGate` | A production-registration wiring test (the style of the existing registration tests): with photos enabled the recap route, `TripShareFacts`, the gate, and `RecapPhotoPort` are wired; with photos disabled the recap route is registered and answers the figures with `unavailable` while no `RecapPhotoPort` and no other photo route exist (Property 42); with `tripShareFacts` unwired a `tripSummary` create is `validation_failed`. Route tests (`server.inject`, pg-mem for friendships and shares, a fake `TripShareFacts` that counts calls) cover the Property 21 matrix including the unfriend-after-send case, the sentinel no-leak test of Property 40 extended by Property 43 (a realistic summary whose `perMember` carries sentinel ids, names and numbers, asserting none appears in the serialized response and that `Object.keys` of the figures object and of each top-rated row equal the literal allowlists of Requirement 15.21, so any future added field fails), a test that the three aggregates equal those of the real `deriveTripSummary` output, and the statement-count and read-order assertions (no Trip read before the Friendship check). |
| Admin wiring | `composeServices.ts` `admin:` block | A wiring test beside the photo-routes wiring test: with `PHOTOS_ENABLED=true` the composed admin options carry `photos` (an `AdminPhotoPort`), and with it false they do not (the degraded mode of R18.10). Route tests with injected fakes cannot catch an unwired port, so this test is the guard. |
| Repo (pg-mem) | `repo.ts`, `reportsRepo.ts` | Real SQL: claim lease, `recordRetryable` clearing `lease_until`, the escalation write refusing a live lease, conditional status updates, quota upsert, keyset pagination (including `GET /me/photos`), orphan queries, block filters, report uniqueness, `removePhoto` incrementing `photo_upload_strikes` once, and the regression that fails against a cascade-derived count: remove a photo, run the sweep (the photo row and its reports are gone), read `upheldCountForUser` back and assert it is still 1 (Property 32). `cleanApprovedUploads` selection and `upload_cleaned_at`. Read rows back. If pg-mem cannot parse a construct, use the repo's test-DB approach and record the substitution. |
| Migration | `migration0062.test.ts`, `migration0063.test.ts` | Columns, every CHECK, indexes, `ON DELETE SET NULL` on `owner_id`, `IF NOT EXISTS` reapply, widened `trip_feed_items` and `shares` CHECKs. |
| Service + runner | `service.ts`, `moderationRunner.ts`, `sweep.ts` | Fakes for all ports and a fake clock. Properties 7, 8, 11, 15, 16, 19, 34, 36 (containment: a repo that throws mid-job, with an `unhandledRejection` spy), 37 against an in-memory model plus pg-mem integration tests. Property 35 (post slot order and placeholders after a sweep) against the real SQL in pg-mem. |
| Route (`server.inject`) | every route in the table | Auth gate, happy path, at least one validation or error path; kill-switch off; ban; cron secret; `HEAD` and `POST` returning `202`; wiring test asserting production registration of the `photos` block. |
| Source guards | `services/photos/**` | No-leak SQL guard as an allowlist of `food_item_logs` columns with a negative `user_tz` fixture (Property 14); no provider names in `domain/`; no `process.env` outside `config.ts`; no secret-shaped strings (including the `AQ.`-prefixed key shape, built from fragments) in `services/photos/`, its fixtures, `.kiro/specs/photo-uploads`, and `docs/`. |
| Shared (Vitest) | Zod schemas, error-code map, constants | Valid and invalid case for each schema; `errorCodeToHttpStatus` covers the six new codes. |
| Mobile (Jest + RNTL, `jest-expo`) | `imagePrep.pure`, `uploadMachine`, hooks, `PhotoPickerSheet`, status chip, dish strip and gallery, `LogFoodItemModal` photo flow, my-history chips and delete, report sheet, blocked users, album, post composer, summary-share composer and inbox card | Real components; mock only the network/query layer and the native picker/manipulator behind the `.native.ts` split. Drive each interaction and assert both the request (endpoint and payload) and the on-screen change. Properties 24, 25, 29 (the batched poll plan). Theme guard stays green. |
| Experience-page strip (Requirement 27, Property 39) | `buildStripModel` (pure, Jest + fast-check, ≥100 runs); restaurant gallery SQL and routes (Vitest, pg-mem, `server.inject`); `ExperiencePhotoStrip`, `RestaurantPhotosSheet`, `PhotoGallerySheet`, `MenuScreen` focus (Jest + RNTL) | Property 39 client half on the pure module; server half as an in-memory oracle compared with the real repo statement in pg-mem over seeded scenarios, because per-run pg-mem setup is costly; route tests for `foodItemName`, `limit`, `cursor`, no-leak, and the unchanged dish shape. RNTL renders the real components, mocks only the network layer, and drives every interaction (thumbnails, "See all", pagination, viewer, Report, Block uploader, "View dish", error, empty), asserting the request and the on-screen change. |
| Recap album (Requirements 15.25 to 15.33, Properties 44 and 45) | `tripRecapAccess.test.ts`, `tripRecapAlbumRoutes.test.ts`, `recapAlbum.prop.test.ts`, the widened report/block tests, `noRevoke.test.ts`, the production-registration test, shared schema tests, mobile album tests | `tripRecapAccess.test.ts` pins the `photoAccessFor` truth table and the `resolveShareAccess` collapse. `tripRecapAlbumRoutes.test.ts` (`server.inject` + pg-mem) covers the gate order with zero-call counters, statuses and blocks, pagination bounds, exact key sets, serving keys, the cache header, the kill switch and the Property 44 matrix as an exhaustive loop. `recapAlbum.prop.test.ts` (fast-check, at least 100 runs, tagged `Feature: photo-uploads, Property 45`) pages through the real route against an in-memory oracle. The widened report/block tests assert a non-highlight approved photo is accepted through the share and every negative stays `photo_not_found` with nothing recorded. `noRevoke.test.ts` lists the new route in its inventory. The production-registration test runs with photos on and off. Shared tests cover `tripRecapPhotosQuerySchema`. Mobile (Jest + RNTL): `TripRecapAlbumScreen.test.tsx`, `TripPhotosSection.test.tsx`, `TripRecapScreen.test.tsx`, `dayGroups.test.ts`, `PhotoGrid.test.tsx`, `youAndCrewStack.recapAlbum.test.tsx`. |
| Manual / launch | Live R2 smoke test (including copy-with-If-Match and ETag behaviour), 100-photo vision evaluation, real-device GPS/EXIF upload check on iOS and Android, privacy policy hosting and disclosure review | Documented tasks; no result is recorded unless actually produced. |

Coverage notes: the enforced coverage threshold applies to `src/services/planning/**` only; this feature adds no threshold, but each code addition ships its tests in the same task. The final checkpoint runs `npm run verify` and produces the behavior-to-test map.