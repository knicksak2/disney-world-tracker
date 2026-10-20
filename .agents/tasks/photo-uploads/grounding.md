# Photo Uploads: Grounding Findings

Read-only investigation of `c:\Users\knick\dev\disney-app` for the design author of the new
`photo-uploads` spec. Everything below was read from the code at HEAD (`fbc7d00`, working tree
clean). It reports what the code does. It does not decide product questions; where a product
question is implicated, the relevant facts are listed under "Facts that constrain the decision".

Secrets: no `.env*` value was opened or is echoed here. Only variable NAMES are referenced.

Contents: 0 Orientation, 1 Trip summary sharing, 2 Trip feed, 3 Trip permissions matrix,
4 Food item logs, 5 Migrations, 6 Config and env, 7 Block/report, 8 packages/shared,
9 Mobile, 10 Admin panel, 11 Hosting/runtime constraints, 12 Cross-spec touchpoints,
13 Open facts and risks.

---

## 0. Orientation

- Steering that governs this work (already in context): `tech-conventions`,
  `execution-discipline`, `pin-collection` (+ `pin-collection-detail`, file-match only).
  Pin gate does NOT apply unless a pin/catalogue file changes. `AGENTS.md` rules: spec must be
  self-sufficient (Configuration & Constants, External Interfaces, concrete formulas,
  cross-spec dependencies), additive edits only to existing specs, `npm run verify` is the
  gate, behavior->test map required on completion.
- No photo, album, gallery, or user-upload concept exists anywhere in `apps/**/src`
  (grep for `album|gallery|photo` finds only: an Ionicons `albums` glyph for the Collection
  tab in `RootNavigator.tsx:114`, catalog text containing the words "Gallery"/"PhotoPass", and
  pin motif SVG paths). This is a net-new capability.
- There is no object storage anywhere in the current code (details in section 6).
- The only prior upload in this repo was profile avatars. They were removed in commit
  `f6e9914` (2026-07-05, "replace avatar uploads with bundled Disney-themed presets"),
  migration `0013_avatar_presets.sql`. The pre-removal implementation is recoverable read-only
  from git and is a direct pattern source (section 6.3).

Relevant existing specs and what they contribute:

| Spec | Relevance to photo-uploads |
| --- | --- |
| `friend-food-ratings` | Friend-visible per-dish read projection; defines the "notes never leave the owner" rule and "do not reuse owner DTOs". Implemented at HEAD. Photos on a food log run straight into these rules (section 4.4). |
| `trip-booking-timeline` | Most recent pattern for adding Trip actions to `permissions.ts` (`edit_booking_settings`, `mark_booking_window_done`, `set_booking_reminder_mute`, `add_packing_item`, ...), migration `0061`, config additions, cron + `202` pattern. |
| `trip-expenses` | States the receipt photo "is never uploaded or stored" (on-device OCR, Requirement 9, and the out-of-scope list: "persisting the receipt photo used for OCR"). Photo-uploads must not silently contradict this; `receiptScan.native.ts` is the only existing `expo-image-picker` consumer. |
| `admin-panel` | Server-rendered HTTP-Basic admin UI. There is NO review queue today (section 10). |
| `experience-favorites` | Style reference for a small per-user join table + routes + mobile hook (migration `0054`). |
| `catalog-redesign` | Owns `ExperienceDetailScreen`/Explore surfaces where an experience-level photo UI might render. Its stated rule: "no new backend daemons or un-indexed queries". |

---

## 1. How trip summary sharing works today

**Answer: it is a client-only, plain-text OS share sheet. There is no in-app friend share, no
link, no token, and no public/unauthenticated URL for trip summaries.**

Evidence:

- Screen: `apps/mobile/src/screens/trips/TripSummaryScreen.tsx` (route `TripSummary: { tripId }`
  in `TripsStackParamList`, `apps/mobile/src/navigation/TripsStack.tsx`).
  - `handleShare(data: TripSummaryDTO)` (line ~122) calls React Native's built-in
    `Share.share({ message: formatSummaryShareText(data), title: 'Walt Disney World Vacation Summary' })`
    and swallows cancel/failure silently.
  - `formatSummaryShareText(summary: TripSummaryDTO): string` (line ~785) builds an emoji text
    block from: `distinctExperienceCount`, `plannedCompletedCount/plannedTotalCount`,
    `superlatives[]`, and the top 3 of `topRated[]`, ending with "Tracked with Disney World
    Tracker". It contains no URL and no image.
  - Two entry points: header button `testID="trip-summary-header-share"`
    (`accessibilityLabel="Share Summary"`) and bottom button `testID="trip-summary-share-btn"`
    (label "Share Vacation Highlights").
  - Tests: `apps/mobile/src/screens/trips/__tests__/TripSummaryScreen.test.tsx`.
- Server: `GET /trips/:id/summary` (`apps/api/src/services/trips/routes.ts` line ~1190):
  `requireSession` -> `parseOrAppError(tripIdParamsSchema)` -> `assertTripMember(pool, userId, id)`
  -> `repo.getSummary(id)`. Non-members and non-existent trips both get `403 trip_forbidden`
  (no existence probing). So only Trip members can fetch the summary from the API at all.
- Derivation: `apps/api/src/services/trips/summary.ts` `deriveTripSummary(input: TripSummaryInput): TripSummary`
  is pure (no I/O). Output shape is `TripSummaryDTO` in `packages/shared/src/trips.ts` (line ~1041):
  `distinctExperienceCount`, `topRated[]` (with `experienceId/experienceName/meanRating/ratingCount/park?/category?/imageUrl?`
  where `imageUrl` is the CATALOG hero image, not a user photo), `perMember[]`
  (`memberId/displayName/avatarPreset?/logEntryCount/confirmedTagCount/totalCompletedCount?/topRatedExperienceName?/topRating?`),
  `plannedTotalCount`, `plannedCompletedCount`, `totalCompletionsCount?`, `totalRatingsCount?`,
  `parkBreakdown?`, `categoryBreakdown?`, `superlatives?[]`. It has no photo field of any kind.
- The in-app friend Sharing_Service (`apps/api/src/services/sharing/{repo,routes}.ts`,
  `POST /me/shares`, `GET /me/inbox`, ...) has no trip payload. `SHARE_PAYLOAD_KINDS` in
  `packages/shared/src/enums.ts` is `['experience', 'progress', 'pinShowcase']`; recipients
  must be Friends (atomic check, `share_atomic_rejected`). `shares.payload_kind` CHECK was
  widened by `0038_pin_showcase_share_kind.sql` for `pinShowcase`.
  Two precedents exist in that service:
  - snapshot payloads (`experience`, `progress`) frozen at send time;
  - a pointer payload (`pinShowcase { ownerId, ownerDisplayName }`) where the recipient reads
    live data through a friend-gated route (`/users/:userId/pin-showcase`).
- No public, token-based or unauthenticated route exists for any trip data. All trip routes use
  `requireSession`. (Not exhaustively audited: other unauthenticated routes I confirmed are
  `/health`, the auth routes, and `GET /experiences/:id/food-items` / `GET /locations/:id/food-items`.)

Facts that constrain the "shared summary shows photos" decision:

- A summary sent today via the OS sheet is text only; a recipient need not be an app user or a
  trip member. Anything beyond text would be new behavior.
- A pointer-style share would require the recipient to pass a read gate on the photos. The
  existing gates are `assertTripMember` (trip) and `assertOwnerOrFriend` (user data); neither
  admits "a Friend of a trip member who is not themselves a member".
- `apiRequest` (mobile) is JSON-only (section 9.4), so binary/link handoff needs new plumbing.

---

## 2. What the trip feed is today

**Answer: system-generated activity events plus member reactions and text comments on those
events. Members cannot "post" anything to the feed.**

Tables (`apps/api/migrations/0015_trips.sql`):

```sql
CREATE TABLE trip_feed_items (
    id UUID PK DEFAULT gen_random_uuid(),
    trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    actor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT trip_feed_items_type_chk CHECK (type IN (
        'trip_created','member_joined','completion_logged','rating_recorded','rode_with_confirmed'))
);  -- later tightened by 0018 (rode_with_confirmed removed)
CREATE INDEX trip_feed_items_trip_order_idx ON trip_feed_items(trip_id, created_at DESC, id DESC);

CREATE TABLE trip_reactions (trip_id, target_type, target_id, member_id, reaction, created_at,
  PRIMARY KEY (target_type, target_id, member_id, reaction),
  CHECK target_type IN ('feed_item','log_entry'), CHECK reaction IN ('like','love','celebrate','wow'));

CREATE TABLE trip_comments (id, trip_id, target_type, target_id, author_id, body, created_at,
  CHECK target_type IN ('feed_item','log_entry'), CHECK char_length(body) BETWEEN 1 AND 2000);
```

Also `trip_log_entries(id, trip_id, member_id, experience_id, created_at)` (+ `log_id` FK added in
`0034_experience_logs.sql`) and `rode_with_tags`.

Who writes feed items (`apps/api/src/services/trips/repo.ts`):

| `type` | Written at | Metadata |
| --- | --- | --- |
| `trip_created` | `createTrip` (line ~1702) | none |
| `member_joined` | accept-invite path (line ~2140) | none |
| `completion_logged` | `createLogEntry` transaction, step 5c (line ~3468) | `{ experienceId, logEntryId }` |
| `rating_recorded` | present in the CHECK, NOT written by any current code path | n/a |

Routes (`trips/routes.ts`): `GET /trips/:id/feed`, `POST /trips/:id/feed/:targetType/:targetId/reactions`,
`DELETE .../reactions/:type`, `POST .../comments`, `DELETE /trips/:id/comments/:commentId`,
`POST /trips/:id/log-entries`, `GET /trips/:id/log-entries`. All Member-gated via
`assertTripMember`. `POST /trips/:id/log-entries` body is `tripLogEntryCreateSchema`
`{ experienceId, rodeWith: uuid[], rating? }` (strict). It logs a ride/dish completion and creates
the `completion_logged` feed item. There is no "post text/photo to the feed" endpoint.

Read shape: `getFeed(ctx, tripId, callerId): Promise<TripFeedItemDTO[]>` (`repo.ts` line ~3984),
three parallel queries (items enriched with experience name/park/category/land/image, caller's
rating and rode-with tags; reaction aggregates; comments). Returns ALL items for the trip (no
pagination, no LIMIT). Ordered by the pure `orderFeed` (`trips/feedOrder.ts`; `createdAt` desc,
then `id` desc). `TripFeedItemDTO` (`packages/shared/src/trips.ts` ~line 998):
`{ id, type: string, actorDisplayName, actorAvatarPreset, createdAt, metadata: Record<string, unknown>, reactions[], comments[] }`.
`metadata` is an open record, so enrichment keys can be added without a DTO type change.

Facts relevant to "post photos in the feed" / "would they show up in the album":

- `trip_feed_items.type` is a closed CHECK; a new event type (for example a photo event)
  needs a migration that drops and re-adds `trip_feed_items_trip_order`/`trip_feed_items_type_chk`
  exactly as `0018_drop_rode_with_confirmed_feed.sql` did. `type` is `string` in the DTO.
- Reactions/comments accept `target_type IN ('feed_item','log_entry')`, but `getFeed` only
  reads and renders `feed_item` targets, and the mobile screen uses
  `FEED_TARGET_TYPE = 'feed_item'`. `log_entry` targets are accepted by the API but never shown.
  Neither table has a foreign key to its target (`target_id` is a bare UUID); `0018` had to
  delete engagement rows explicitly when removing feed items. Deleting a feed item or photo
  therefore requires explicit cleanup of its reactions/comments.
- There is no album concept, no trip-level media table, and no "album" read. The mobile feed
  is `apps/mobile/src/screens/trips/TripFeedScreen.tsx` (the Trip_Activity screen, route
  `TripFeed`), which also hosts the "Log a ride or snack" flow.
- Trip delete cascades by FK through `trips(id) ON DELETE CASCADE` (R3.7 of `trips`). That
  cascade does not touch any external object store.
- Members who leave or are removed lose all read access (`trip_forbidden`, indistinguishable
  from a never-member). Their authored comments/log entries/feed items are not deleted by
  leaving (no code path found that does so).

---

## 3. Trips `permissions.ts` role/action matrix (verbatim)

File: `apps/api/src/services/trips/permissions.ts`.

```ts
export type TripRole = 'organizer' | 'member';

export type TripAction =
  | 'edit_settings'
  | 'send_invite'
  | 'cancel_invite'
  | 'remove_member'
  | 'promote'
  | 'demote'
  | 'delete_trip' // organizer-only (R4.2)
  | 'edit_booking_settings' // trip-booking-timeline organizer-only (R12.1, R12.5)
  | 'add_planned_item'
  | 'edit_planned_item'
  | 'optimize_day'
  | 'create_log_entry'
  | 'add_rode_with'
  | 'add_comment'
  | 'add_reaction'
  | 'leave_trip' // member + organizer (R4.3, R4.4)
  | 'add_packing_item'
  | 'toggle_packing_item'
  | 'edit_packing_item'
  | 'mark_booking_window_done'
  | 'set_booking_reminder_mute'; // trip-booking-timeline member (R12.1, R12.2)

const MEMBER_ACTIONS: ReadonlySet<TripAction> = new Set<TripAction>([
  'add_planned_item', 'edit_planned_item', 'optimize_day', 'create_log_entry',
  'add_rode_with', 'add_comment', 'add_reaction', 'leave_trip',
  'add_packing_item', 'toggle_packing_item', 'edit_packing_item',
  'mark_booking_window_done', 'set_booking_reminder_mute',
]);

const ORGANIZER_ONLY_ACTIONS: ReadonlySet<TripAction> = new Set<TripAction>([
  'edit_settings', 'send_invite', 'cancel_invite', 'remove_member',
  'promote', 'demote', 'delete_trip', 'edit_booking_settings',
]);

export function can(role: TripRole, action: TripAction): boolean {
  if (role === 'organizer') return MEMBER_ACTIONS.has(action) || ORGANIZER_ONLY_ACTIONS.has(action);
  return MEMBER_ACTIONS.has(action);
}
// also: Membership, MembershipChange, violatesLastOrganizer(members, change)
```

How actions are consumed (so new actions are added additively and correctly):

- `assertTripMember(pool, userId, tripId): Promise<TripRole>` and
  `assertTripOrganizer(pool, userId, tripId): Promise<void>` live in `trips/authz.ts`
  (one membership lookup; non-member and missing trip both throw `AppError('trip_forbidden')`).
- Older trips routes call `assertTripMember`/`assertTripOrganizer` directly and do NOT call
  `can(...)`. The `trip-booking-timeline` routes (`tripBooking/routes.ts`) are the pattern to follow:
  `const role = await assertTripMember(pool, userId, tripId); if (!can(role, '<action>')) throw ...`.
  Imports: `assertTripMember` from `../trips/authz.js`, `can` from `../trips/permissions.js`.
- The matrix is pinned by `apps/api/src/services/trips/__tests__/permissions.matrix.prop.test.ts`
  with an independently declared partition: `MEMBER_ALLOWED`, `ORGANIZER_ONLY`,
  `ALL_ACTIONS = [...MEMBER_ALLOWED, ...ORGANIZER_ONLY]`, plus `BOOKING_MEMBER_ACTIONS` /
  `BOOKING_ORGANIZER_ACTIONS` blocks for the last feature. Any new action must be added to
  BOTH the source sets and the test partition, or the property test's oracle diverges.
- Per-resource ownership (adder-or-organizer) is NOT in the matrix; it is a separate pure helper,
  e.g. `tripBooking/packingAuth.ts` `canModifyPackingItem`, and `trip-expenses` uses a
  "adder-or-organizer edit/delete rule". Comment deletion is author-only (`trip_forbidden` if
  not the author), enforced in `repo.removeComment`.

---

## 4. Food item logs

### 4.1 Data model (`0040_food_item_logging.sql`, `0043_food_item_log_history_index.sql`)

```sql
user_submitted_locations(id, name, park NOT NULL CHECK in 7 parks, created_by_user_id, created_at)
food_items(id, experience_id XOR location_id (CHECK exactly one), name, price, source, created_by_user_id, last_seen_at, created_at)
food_item_logs(
  id UUID PK DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  food_item_id UUID NOT NULL REFERENCES food_items(id) ON DELETE CASCADE,
  visited_on DATE NOT NULL,
  user_tz TEXT NOT NULL,
  logged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rating SMALLINT CHECK (rating IS NULL OR rating BETWEEN 1 AND 10),
  note TEXT CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 2000))
-- indexes: food_item_logs_user_item_idx (user_id, food_item_id, visited_on DESC, logged_at DESC),
--          food_item_logs_user_idx (user_id, visited_on DESC, logged_at DESC)
```

No unique constraint on `(user_id, food_item_id)`; a dish can be logged many times. Sibling
`experience_logs` (`0034`) has the same shape (`rating`, `note`, `visited_on`, `user_tz`,
`logged_at`) and `trip_log_entries.log_id` links a trip log to exactly one `experience_logs` row.

### 4.2 Service / repo / routes (owner-scoped)

- Folder `apps/api/src/services/foodLog/` : `repo.ts`, `routes.ts`, `locations.ts`,
  `__tests__/`.
- `FoodItemLogRepo` (`repo.ts` line ~70) has `addLog(input: CreateFoodItemLogRepoInput): Promise<FoodItemLogDTO>`
  and sibling methods; factory `createFoodItemLogRepo(options: { pool: DbPool })` (line ~409).
  Also `createFoodItemRepo(pool)` (menu items) and `createUserSubmittedLocationRepo(pool)`.
- Routes (`routes.ts`): `GET /experiences/:id/food-items` and `GET /locations/:id/food-items`
  (public, unauthenticated, must stay so), `POST|GET /me/food-items/:foodItemId/logs`,
  `PATCH|DELETE /me/food-items/:foodItemId/logs/:logId`, `GET /me/food-item-logs`,
  `GET /experiences/:id/food-item-logs/mine`, `GET /locations/:id/food-item-logs/mine`,
  and the locations routes under `/locations`. Wired in `composeServices.ts` as
  `foodLog: { items, logs, locations }` and registered in `server.ts` (`foodItemRoutes`,
  `foodItemLogRoutes`, `userSubmittedLocationRoutes`).
- Owner DTOs (`packages/shared/src/dto/FoodItemLog.ts`): `FoodItemLogDTO { id, userId, foodItemId, visitedOn, userTz, loggedAt, rating, note }`,
  `FoodItemLogHistoryDTO`, `CreateFoodItemLogInputDTO { visitedOn, userTz, rating?, note? }`,
  `UpdateFoodItemLogInputDTO { rating?, note? }`, `FoodItemLogWithContextDTO extends FoodItemLogDTO`.
  Zod (`schemas/FoodItemLog.ts`): `createFoodItemLogInputSchema`, `updateFoodItemLogInputSchema`,
  `foodItemLogSchema` (all `.strict()`), so any new field on these bodies/DTOs is a schema change
  (a new key is rejected today).
- Mobile entry points for food logging: `screens/catalog/LogFoodItemModal.tsx`
  (`LogFoodItemModalProps`, builds `CreateFoodItemLogInputDTO`), `RestaurantFoodLogsSheet.tsx`,
  `FoodItemLogHistorySheet.tsx`, `FoodItemPickerModal.tsx`, `MyFoodHistoryScreen.tsx`, `MenuScreen.tsx`.

### 4.3 Friend visibility today (implemented, commit `fbc7d00`)

Service `apps/api/src/services/friendFoodRatings/` (`dishAggregate.ts`, `repo.ts`, `routes.ts`,
tests including `friendFoodRatings.noNoteSql.test.ts`, `friendFoodRatings.notes.prop.test.ts`,
`friendFoodRatings.wiring.test.ts`). Routes:

- `GET /users/:userId/food-ratings` gated by `assertOwnerOrFriend(pool, requester, :userId)`
  (`friends/ownerOrFriend.ts`: owner always allowed, else one lookup in `friendships`; throws
  `AppError('profile_forbidden')` -> 403). Returns `FriendFoodRatingsPageDTO`.
- `GET /experiences/:id/food-item-logs/friends` and `GET /locations/:id/food-item-logs/friends`
  (audience = viewer's `friendships`; no friend id accepted). Returns `FriendFoodSocialProofResponseDTO`.

Friend DTOs (`packages/shared/src/dto/FriendFoodRatings.ts`): `FriendDishRatingDTO`
(`foodItemId, foodItemName, scopeKind, scopeId, scopeName, park, averageRating, ratedLogCount, logCount, latestVisitedOn`),
`FriendFoodScopeDTO`, `FriendFoodRatingsPageDTO`, `FriendDishFriendRatingDTO`,
`FriendDishSocialProofDTO`, `FriendFoodSocialProofResponseDTO`.

### 4.4 The exact rule keeping private `note` out of friend reads

From `.kiro/specs/friend-food-ratings/requirements.md` Requirement 5 and design key decision 3:

- R5.1: no friend-facing payload (list, Highlights, batch, and the existing friend stats
  `foodActivity`) carries a Log `note` in any field.
- R5.2 (verbatim intent): friend DTOs have **no `note` field and no per-Log identifier, no
  Log `userId`, no `userTz`, no `loggedAt`, and must NOT reuse `FoodItemLogDTO` or
  `FoodItemLogWithContextDTO`**. The SQL for friend reads must not select `food_item_logs.note`,
  and no statement referencing `food_item_logs` may contain the identifier `note`, the wildcards
  `fil.*` or `food_item_logs.*`, or a bare `SELECT *`/`RETURNING *`.
- R5.3: new routes return only the per-dish aggregate, never an individual Log row; the opaque
  pagination cursor carries no `logged_at` and no date other than an already-present
  `latestVisitedOn`. The `recent` sort deliberately avoids `logged_at` so no Log timestamp
  finer than `latestVisitedOn` can enter an order or cursor.
- R5.4: no share flag/setting/parameter can make a note appear.
- Structural enforcement tests (source-level, template-literal extraction): 
  `friendFoodRatings/__tests__/friendFoodRatings.noNoteSql.test.ts` and
  `stats/__tests__/foodActivity.noNote.test.ts`; behavioral enforcement with a sentinel note:
  `friendFoodRatings.notes.prop.test.ts`. Pattern asserted per statement:
  `not.toMatch(/\bnote\b/i)`, `/fil\.\*/`, `/food_item_logs\.\*/`, `/\bSELECT\s+\*/i`,
  `/\bRETURNING\s+\*/i`.
- Design key decision 1: friend reads live in a SIBLING service folder, not in `foodLog/`,
  because `foodLog/` is owner-scoped end to end (`WHERE user_id = $1`).
- Visibility model: friend visibility of food ratings is always on for accepted Friends, no
  opt-out; "Friend" = a row in `friendships` (canonical pair `user_lo_id < user_hi_id`; no status
  column; `removeFriend` hard-deletes; there is no block).

Implication for photo-uploads (facts, not decisions): any photo attached to a `food_item_logs`
row is an individual-Log artifact. The friend read surface today exposes only per-dish
aggregates with no Log identifiers. Any photo exposed to friends needs its own friend DTO (do
not extend `FoodItemLogDTO`/`FoodItemLogWithContextDTO`), its own gate decision, and its own
structural/behavioral no-leak tests in the style above. The friend-food-ratings spec states
that it is not edited by other changes; photo-uploads must cross-reference it, not amend it,
unless it explicitly follows the "additive by default" editing rule from `tech-conventions`.

---

## 5. Migrations

- Directory `apps/api/migrations/`; highest existing file is
  **`0061_trip_booking_timeline.sql`**. Files present: `0001` through `0061` contiguous
  (`0056_admin_panel.sql`, `0057_resort_activities_enrichment.sql`, `0058_resort_recreation_experiences.sql`,
  `0059_password_reset_tokens.sql`, `0060_trip_expenses.sql`, `0061_trip_booking_timeline.sql`).
- **NEXT FREE NUMBER: `0062`** (e.g. `0062_photo_uploads.sql`). No existing spec text
  reserves `0062`, `0063`, or `0064` (grep of `.kiro/specs/**/*.md` found none except an unrelated
  entity id string in `catalog-taxonomy-cleanup/design.md`). If the design needs more than one
  migration, use `0062`, `0063`, ... in dependency order.
- Runner: `apps/api/src/db/migrate.ts` (hand-rolled). Filename must match
  `^\d{4,}_[a-z0-9_-]+\.sql$` (case-insensitive) or the runner throws. Applies files in
  lexicographic order, each inside its own `BEGIN`/`COMMIT` that the runner itself opens
  (`applyMigration`), records `name` + canonical (LF-normalised) SHA-256 checksum in
  `schema_migrations`; an already-applied file whose checksum differs (other than
  line-ending-only) throws "Migrations must not be modified after they are applied."
  Scripts: `npm run migrate --workspace apps/api` (local `.env`), `migrate:cloud` (`.env.dev`).
  Render runs it in the build command (`render.yaml` `buildCommand`).
- File conventions seen in `0054`, `0056`, `0060`, `0061`: header comment block explaining the
  feature; `BEGIN;` ... `COMMIT;`; `gen_random_uuid()`; `TIMESTAMPTZ NOT NULL DEFAULT now()`;
  named `CONSTRAINT <table>_<what>_chk CHECK (...)` (older) or `chk_<table>_<what>` (0060/0061);
  `REFERENCES users(id) ON DELETE CASCADE`; `CREATE TABLE IF NOT EXISTS` and
  `CREATE INDEX IF NOT EXISTS` in the newest files (0060, 0061); explicit comment next to any
  CHECK that is intentionally not in the DDL; indexes named for the access path
  (`..._user_idx`, `..._trip_idx`).
- Altering a CHECK constraint in-place precedent: `0061` lines ~74-75 do
  `ALTER TABLE push_delivery_log DROP CONSTRAINT IF EXISTS push_delivery_log_kind_chk;` then
  re-add with the widened list (this is how `trip_booking_reminder` was added to the allowed
  `notification_kind`s). The same pattern would be needed to add a new push notification kind
  (`0056` defines the original closed list) and to widen `trip_feed_items_type_chk`.
- Test conventions: `migrationNNNN.test.ts` per migration (steering). pg-mem loads real migration
  files by path; precedent for partial-load setup (load only `0001_init.sql` + `0040_*.sql`, then
  patch with `ALTER TABLE ... DROP NOT NULL`) is documented in
  `friend-food-ratings/tasks.md` task 2.4 and `foodLog/__tests__/foodItemLogs.prop.test.ts`.
  pg-mem lacks some functions (`char_length`/`lower` are registered by hand in those tests).
- `ON DELETE CASCADE` for `users`, `trips`, and `food_items` means DB rows for photo metadata
  referencing them will vanish on delete, but the stored objects will not (see section 11).

---

## 6. Config, env loading, and leftover S3/R2

### 6.1 Style (`apps/api/src/config.ts`)

- Single boundary: `loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig`. Everything
  else must receive config through `AppConfig`; the file's header says no other module may read
  `process.env`.
- A `zod` `envSchema` (`z.object({...}).superRefine(...)`) with: `.min(1, 'NAME is required and must not be empty')`
  for required secrets, `.default(...)` for tunables, `z.coerce.number().int().positive()` for
  numbers, `.url('... must be a well-formed absolute URL')` for URLs. Failure throws
  `ConfigError` with one line per issue (`path: message`).
- Structured, namespaced output: `AppConfig` has `env, server, database, redis, session,
  intelligence, pins, tripBooking, admin, themeparks, disney`. Each feature adds a namespace
  (for example `tripBooking: { cronSecret, reminder }`, `admin: { username, password }`).
  Cross-field rules live in the `.superRefine` (for example `TRIP_BOOKING_CRON_SECRET` must not
  equal the other cron secrets).
- Tests: `apps/api/src/__tests__/config.prop.test.ts`, `config.disney.prop.test.ts`.
- Required-secret pattern that fails startup: a new REQUIRED var would also have to be added
  to `render.yaml` (`sync: false`) and `apps/api/.env.example`, otherwise the Render build's
  migrate step (which calls `loadConfig`) fails. `apps/api/.env.example` is the only committed
  env template; `.env`/`.env.*` are gitignored (`.gitignore`).

### 6.2 Leftover S3/R2 variables: NONE in code

- `config.ts` has no S3/R2/bucket/storage namespace. `grep -i "S3_|R2_|aws-sdk|@aws|cloudflare|presigned|r2\.dev|cloudfront"`
  over `apps/api/src`, `render.yaml`, both `package.json`s, `docs/`, `README.md` finds nothing
  relevant (only unrelated mentions of "Cloudflare" in `docs/hosting.md` about cron-job.org error
  pages).
- Variable NAMES present in the local env files (names only, values not read):
  - `apps/api/.env`: `NODE_ENV, HOST, PORT, LOG_LEVEL, DATABASE_URL, REDIS_URL, SESSION_SECRET,
    THEMEPARKS_BASE_URL, DISNEY_SYNC_GATEWAY_BASE_URL, DISNEY_SYNC_GATEWAY_USERNAME,
    DISNEY_SYNC_GATEWAY_PASSWORD, SAMPLING_CRON_SECRET, PIN_RECONCILE_CRON_SECRET,
    TRIP_BOOKING_CRON_SECRET, ADMIN_PANEL_USERNAME, ADMIN_PANEL_PASSWORD, RESEND_API_KEY,
    SMTP_SERVICE, SMTP_HOST, SMTP_USER, SMTP_PASS, GEMINI_API_KEY`.
  - `apps/api/.env.dev`: same core set plus `RESEND_API_KEY, MAIL_FROM` (no SMTP_* here).
  - `apps/api/.env.example`: documented template (no S3/R2/GEMINI names).
  - `apps/mobile/.env.local`: `API_BASE_URL` only.
  - **No `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (or any R2 name)
    exists in any env file or in code.** They existed in the original `disney-world-tracker`
    spec task 2.1 (`.kiro/specs/disney-world-tracker/tasks.md` line 213) and were removed in
    `f6e9914` (`apps/api/.env.example` -7 lines, `config.ts` -22/+~, `composeServices.ts`, `server.ts`).
  - `GEMINI_API_KEY` exists as a NAME in local `apps/api/.env` only. Nothing in `apps/api/src`,
    `render.yaml`, `.env.example` or `config.ts` reads it. It is not wired into any service.
    (Note for the author: an API key value was pasted into the chat in an earlier turn of this
    workflow's request; treat that key as exposed and do not put any value in spec text.)
- Env vars read OUTSIDE `config.ts` today (existing deviation, so the style is not absolute):
  `services/auth/mailService.ts` (`RESEND_API_KEY`, `SMTP_*`, `MAIL_FROM`),
  `services/auth/routes.ts:196` (`API_PUBLIC_URL`), `services/intelligence/weatherClient.ts`
  (`WEATHER_REFRESH_MS`), `logger.ts` (`LOG_LEVEL`), `scripts/seedShapes.ts`. The password-reset
  mail service accepts an options object with `process.env` fallback. A new storage/moderation
  client should follow `config.ts` (the stated rule), not the mailService deviation.

### 6.3 Recoverable pre-removal avatar implementation (read-only reference, git `f6e9914^`)

- Deps then in `apps/api/package.json`: `@aws-sdk/client-s3` ^3.620.0 and `@fastify/multipart` ^8.3.0
  (both removed; neither is installed now; current `fastify` is ^4.28.1).
- `services/auth/avatarStore.ts`: `createAvatarS3Client(s3Config)` built an `S3Client` with
  `endpoint`, `region: 'auto'`, `forcePathStyle: true` (R2-compatible); `uploadAvatar(...)` used
  `PutObjectCommand`; `getAvatarPublicUrl(endpoint, bucket, key)` built `<endpoint>/<bucket>/<key>`.
- `services/auth/avatarValidation.ts`: `MAX_AVATAR_BYTES = 5 * 1024 * 1024`, `sniffAvatar(bytes)` and
  `validateAvatarBytes(bytes)` do magic-byte sniffing for PNG (`89 50 4E 47`) and JPEG (`FF D8 FF`).
- Old profiles columns `avatar_url`, `avatar_mime`, `avatar_size_bytes` were dropped by `0013`.
- Old route: `PUT /me/profile/avatar` multipart (server-proxied upload). Pino `redact` paths
  already cover `req.body.avatar`.
- Retrieve with `git show f6e9914^:apps/api/src/services/auth/avatarStore.ts` (and similarly
  `avatarValidation.ts`, `AvatarUpload.tsx` on mobile).
- Current mobile has `expo-image-picker` (`~56.0.18`, plugin registered in `app.config.ts`
  `plugins: ['expo-secure-store','expo-image-picker','expo-status-bar','expo-notifications','expo-image']`)
  and `expo-image` (`~56.0.13`, used by `ExploreHubScreen`, `DestinationScreen`,
  `ParkDestinationScreen`, `ResortsDirectoryScreen`). Not present: `expo-image-manipulator`,
  `expo-file-system`, any S3/AWS package, `@fastify/multipart`.

---

## 7. Block-user and report features in the friends service

**Definitive: NO block feature and NO report feature exist. Also no account-deletion route.**

Evidence:

- `apps/api/src/services/friends/routes.ts` registers exactly: `GET /users/search`,
  `POST /me/friend-requests`, `POST /me/friend-requests/:id/accept`,
  `POST /me/friend-requests/:id/decline`, `GET /me/friends`, `DELETE /me/friends/:userId`.
  `FriendsRepo` (`friends/repo.ts`) methods: `searchUsers`, `sendRequest`, accept/decline,
  `removeFriend` (hard delete of the canonical `friendships` row), `listFriendsAndRequests`.
- Migration grep (all 61 files) for `block|report|moderat|suspend|ban` finds no relevant table
  (only unrelated words in comments/data). Tables that exist in this area: `friend_requests`,
  `friendships`, `shares`, `share_recipients`, `share_reactions`. No `user_blocks`, `*_reports`,
  `moderation*` table anywhere.
- Source grep for `user_blocks|blockUser|reportUser|content_report|abuse_report` over
  `apps/api/src/services/**` returns nothing.
- `friend-food-ratings/requirements.md` Glossary states it explicitly: "there is no block and no
  soft-remove (`removeFriend` hard-deletes the row)".
- Auth routes (`auth/routes.ts`): `/auth/login`, `/auth/logout`, `/auth/change-password`, `/me`,
  `/auth/forgot-password`, `/auth/reset-password`. Profile routes: `/me/profile`,
  `/me/profile/avatar` (preset id), `/users/:userId/profile`. No `DELETE /me`.
- Discoverability fact: `GET /users/search` (case-insensitive substring on `display_name` and
  `email`, capped, excludes the requester) lets any authenticated user find any other and send a
  friend request, and an accepted `friendships` row is the sole gate for friend-scoped reads. There
  is no mutual-consent step beyond accepting a request and no way to sever an unwanted
  relationship without unfriending (which hard-deletes).
- External-platform fact worth surfacing to the design author (not a repo fact): Apple App
  Review Guideline 1.2 (user-generated content) and 5.1.1(v) (account deletion for apps with
  account creation) are relevant to any feature that lets users upload content visible to other
  users. The repo has neither a report/block mechanism nor an account deletion path today.
  These are product/compliance questions for the author; the code simply lacks them.

---

## 8. `packages/shared` layout (DTOs, Zod, enums, error codes)

Package `@dwt/shared` (`packages/shared/package.json`: `type: module`, `main: dist/index.js`,
scripts `build` (`tsc -p tsconfig.build.json`), `typecheck`, `test` (`vitest --run`), only dep `zod ^3.23.0`).
Apps resolve it through the compiled `dist` at runtime (`npm run build:shared`), and mobile's Jest
maps `@dwt/shared` to `packages/shared/src/index.ts`.

```
packages/shared/src/
  index.ts                 // THE public barrel; everything must be re-exported here
  enums.ts                 // runtime tuples + derived unions (PARKS, SHARE_PAYLOAD_KINDS, TRIP_REACTION_VALUES, ...)
  errors.ts                // ERROR_CODES tuple, ErrorCode union, ErrorEnvelope, errorCodeToHttpStatus map
  trips.ts                 // trips domain: Zod input schemas + DTO interfaces in one file
  tripBooking.ts           // trip-booking-timeline: constants, helpers, schemas, DTOs in one file
  tripExpenses.ts          // trip-expenses
  plannedCompletion.ts, attention.ts
  constants/               // avatarPresets.ts, catalog.ts, friendFoodRatings.ts, navigation.ts
  dto/                     // one file per DTO family + dto/index.ts barrel (types only)
  schemas/                 // one file per family + schemas/index.ts barrel; primitives.ts
  search/, pins/
  __tests__/               // vitest tests (for example friendFoodRatings.exports.test.ts, tripExpenses.test.ts)
  schemas/__tests__/, dto/__tests__/
```

Conventions to follow:

- Newer features either (a) split into `constants/<feature>.ts` + `dto/<Feature>.ts` +
  `schemas/<Feature>.ts` and re-export from all three barrels (`index.ts`, `dto/index.ts`,
  `schemas/index.ts`) as `friend-food-ratings` did, or (b) put everything in a single
  `<feature>.ts` at the package root as `tripBooking.ts`/`tripExpenses.ts` did. Both are
  accepted; (a) is the most recent for a cross-cutting read feature.
- DTO fields are `readonly`; Zod object schemas used for request bodies are `.strict()`.
  Primitives available in `schemas/primitives.ts`: `uuidSchema, emailSchema, displayNameSchema,
  passwordSchema, ratingValueSchema, noteBodySchema, isoDateSchema, ianaTzSchema,
  isoTimestampSchema, searchQuerySchema, recipientListSchema, experienceCategorySchema, parkSchema,
  sharePayloadKindSchema, shareReactionValueSchema, tripReactionValueSchema, completionPercentSchema,
  foodListNameSchema`.
- Error codes: add to the `ERROR_CODES` tuple AND to `errorCodeToHttpStatus`
  (a `{ readonly [K in ErrorCode]: number }` map, so TypeScript fails the build if one is missed).
  Existing codes relevant to reuse: `validation_failed` 400, `unauthorized` 401,
  `profile_forbidden` 403, `trip_forbidden` 403, `trip_not_found` 404,
  `trip_validation_failed` 400, `food_item_not_found`, `food_log_not_found` (404, collapses
  non-owner), `rate_limit_exceeded`, `internal_error`. Admin-specific: `admin_experience_not_found`,
  `admin_user_not_found`, `admin_sync_already_running`. The `friend-food-ratings` spec added no
  error code. There is no existing code for "unsupported media type", "file too large", "upload
  expired", "moderation rejected", or "photo not found"; any such code is net new.
- Server error envelope: `{ error: { code, message, field?, details? } }`; API throws
  `AppError(code, message)` (`apps/api/src/errors/AppError.ts`), rendered by the shared error
  handler; mobile `ApiError` mirrors it.
- Existing enums relevant to extend or mirror: `PARKS` (7 values), `SHARE_PAYLOAD_KINDS`,
  `TRIP_REACTION_VALUES`, `ExperienceCategory`.

---

## 9. Mobile navigation, themes, and client plumbing

### 9.1 Navigators

- `apps/mobile/src/navigation/RootNavigator.tsx`: `MainTabs` bottom tabs = Home, Explore, a
  center `MagicFab` action button (`name={'MagicFab' as any}`, `tabBarButton`), Trips, Collection
  (label "Vault"). `RootStackParamList` includes `MainTabs`, `ExperienceDetail: { experienceId; initialLens?: 'today'|'passport' }`,
  `Menu: { experienceId }`, `YouAndCrew: NavigatorScreenParams<YouAndCrewStackParamList>`, and
  the share composer params. `ExperienceDetail` and `Menu` are root-stack screens above the tabs.
- `ExploreStack.tsx`: `ExploreStackParamList { CatalogList; DestinationScreen: { destination }; ResortsDirectory; CrowdCalendar; LiveWaits: { park? } | undefined }`;
  `CatalogStackParamList` is only a legacy alias.
- `TripsStack.tsx` (headerShown false): `TripsStackParamList { TripsList; TripDetail: { tripId }; TripEdit; TripPlannedList; TripSchedule; TripReservations; TripExpenses; TripBalances; TripBookingTimeline; TripPackingList; TripFeed: { tripId }; TripMembers; TripSummary: { tripId }; TripInvite: { tripInviteId }; RodeWithConfirm: { rodeWithTagId; tripLogEntryId } }`.
  The `TripDetailScreen` hub (`screens/trips/TripDetailScreen.tsx`) navigates to each section by
  `navigation.navigate('<Route>', { tripId })` (lines ~565-1126).
- `YouAndCrewStack.tsx`: `YouAndCrewMain`, `FriendFoodHistory: { friendId; displayName }`,
  `FriendsSearch`, `Inbox`, `Sent`, `PinShowcase: { userId?; readOnly? } | undefined`,
  `FriendsList?` (friends, identity and account settings live here, reached from the Home header
  "You & Crew" pill; `ProfileScreen.tsx` default export is NOT a registered route).
- `CollectionStack.tsx`: `MyFoodHistory: undefined`, `Stats: NavigatorScreenParams<StatsStackParamList>`, etc.
- Friend food surfaces already built: `screens/friends/FriendFoodHistoryScreen.tsx`,
  `FriendFoodHighlightsRow.tsx` (+ tests).
- Navigation notes: tap-routing for push is in `navigationRef.ts`; deep link params stay
  routing-id-only ("never a fetched payload"), a documented convention in `TripsStack.tsx`.

### 9.2 Theme and styling rules a new photo screen/component must satisfy

- Build styles with `const useStyles = makeStyles((t) => ({ ... }))` (`theme/makeStyles.ts`) and
  call `useStyles()`; read inline values with `const t = useAppTheme()` (`theme/useAppTheme.ts`).
  A one-off literal colour goes in a co-located `<File>.palette.ts` via
  `definePalette({ light, dark })` (`DARK_TONAL`, `darkTheme` from `theme/theme.ts`; see
  `screens/catalog/MenuScreen.palette.ts`) and is read with `usePalette(P)`; derive alpha with
  `withAlpha(t.color.x, a)`.
- Static `theme` export is colour-free (`{ spacing, radius, layout, typography }`); no
  `color/gradient/shadow/parkAccent/categoryVisual/resortVisual` statics.
- Guard: `apps/mobile/src/__tests__/themeRetrofit.guard.test.ts` using rules in
  `src/test/themeGuard.ts`: fails on raw `'#rrggbb'` hex string literals and chromatic
  `rgb(a)(...)` (neutral `255,255,255` / `0,0,0` allowed), static token reads
  (`theme.color`, ...), static theme imports of forbidden names, and namespace imports of the
  theme, outside allowlists (`theme/theme.ts`, `theme/contrast.ts`, pin artwork files,
  `avatars/AvatarPresets.tsx`, `screens/catalog/destinationVisuals.ts`, `*.palette.ts`).
  Black shadow colour `shadowColor: '#000'`/`'#000000'` is exempt. Fix the code, do not extend
  the allowlist.
- Themed kit in `theme/components.tsx`: `ScreenContainer, GradientHeader, Card, PrimaryButton,
  SecondaryButton, Badge, Chip, SectionLabel, EmptyState`; charts in `theme/charts.tsx`.
  `primary` for fills, `primaryFg` for primary-hued text/icons on surfaces. Memoized values and
  list render callbacks reading `styles`/`t` must list them in deps / `extraData` with `t.scheme`.
- Accessibility: label visuals; never rely on colour alone (steering). A photo grid or viewer
  needs `accessibilityLabel` (including alt-text strategy) and non-colour state cues.
- Real-device UX mechanics are not covered by existing patterns: there is no image viewer/zoom,
  no upload progress component, no permissions-denied pattern for photos. The only image-picker
  use is `screens/trips/receiptScan.native.ts` (OCR, never uploaded), split into
  `receiptScan.ts` / `.native.ts` / `.pure.ts` so Jest never loads the native module; tests are
  `__tests__/receiptScan.test.ts`, `receiptScan.prop.test.ts`, `ReceiptReviewModal.test.tsx`.
  That platform-split is the established way to keep native modules out of Jest.

### 9.3 Test stack (mobile)

Jest with `jest-expo` preset, `@testing-library/react-native`, `fast-check`. `jest.config.js`
maps `@dwt/shared` to the TS source, uses `react-native-worklets/jest/resolver`, `maxWorkers: 8`.
No global mocks for `expo-image-picker` or `expo-image` exist in `src/test`; per-file mocks only.
Never use Vitest for RN component tests (steering).

### 9.4 API client constraint

`apps/mobile/src/api/client.ts` `apiRequest<T>(method, path, body?, signal?)` is JSON-only:
it sets `Accept: application/json`, JSON-stringifies `body` with `Content-Type: application/json`,
attaches `Authorization: Bearer <token>` from secure storage, parses the error envelope into
`ApiError`, and on 401 clears the token and notifies. Success bodies are cast, not validated.
There is no multipart helper, no binary upload helper, and no `fetch` wrapper for a third-party
URL. A direct-to-storage PUT would be a separate raw `fetch` that must NOT carry the bearer
token. Current mobile `package.json` has no `expo-file-system`, so reading a picked file URI to a
Blob relies on RN `fetch(uri).then(r => r.blob())`. `expo-image-manipulator` is confirmed absent
(`apps/mobile/package.json` dependencies listed above) and would be a new dependency; use an
exact/pinned version (steering) matched to Expo SDK 56 (`~56.x`).

---

## 10. Admin-panel review-queue shape (for cross-reference/extension)

**There is no review queue today.** The admin panel is read-mostly diagnostics.

- Spec: `.kiro/specs/admin-panel/` (`requirements.md` 14 requirements; `design.md`; `tasks.md`).
  Sections: Auth, Shell/Nav, Catalog & Sync, Disney Transport, Intelligence (accuracy/model/sampling/
  derived stats), Infra budget, Auth abuse (lockouts), Push delivery, User & Support lookup, Pin
  diagnostic, Growth, Config. Mutating "Trigger_Actions" are an explicit enumerated set: manual
  catalog sync, pin reconcile, account unlock, session revoke.
- Code: `apps/api/src/services/admin/` = `basicAuth.ts`, `html.ts`, `repo.ts`, `routes.ts`
  (+ `__tests__`). Registered in `server.ts` via `adminRoutes(services.admin)`; options wired in
  `composeServices.ts` (`admin: { repo, catalogRepo, intelligenceRepo, pinRepo, config, runCatalogSync, isSyncInProgress, getRateLimiterSnapshot, getDirectorySnapshot, basicAuth }`).
- Auth: HTTP Basic with `ADMIN_PANEL_USERNAME` / `ADMIN_PANEL_PASSWORD` (`createBasicAuthHook`,
  constant-time compare via SHA-256 digests + `timingSafeEqual`), attached as `preHandler` on
  EVERY `/admin` route (not a global hook). Does NOT use the `sessions` table or any trip/user role
  (Admin R1.6). Single operator, no roles.
- Rendering: server-generated HTML only, no templating dependency: `html.ts` exports
  `escapeHtml(value: unknown)`, `renderPage(title, bodyHtml)`, `table<T>(rows, columns)`,
  `flagged(condition, label)`. `escapeHtml` is mandatory for any user-sourced string (display
  names, filenames, captions). Every `/admin` response sets `X-Robots-Tag: noindex, nofollow`.
  Admin errors render as HTML error pages, not the JSON envelope; Redis-unavailable degrades
  per section.
- Route map at HEAD (`admin/routes.ts`): `GET /admin` (nav list built from a static
  array at lines ~64-152 of `{ path, label }` entries), `/admin/catalog`, `POST /admin/catalog/sync`,
  `/admin/disney-transport`, `/admin/intelligence/{accuracy,accuracy/:experienceId,model,sampling,derived-stats}`,
  `/admin/infra`, `/admin/accounts/lockouts`, `POST /admin/accounts/:userId/unlock`,
  `/admin/notifications`, `/admin/users`, `POST /admin/users/:userId/revoke-sessions`,
  `/admin/users/:userId/pins`, `POST /admin/users/:userId/pins/reconcile`, `/admin/growth`, `/admin/config`.
- `AdminRepo` (`createAdminRepo(pool, redis)`) is one factory of independent narrow queries; adding
  moderation methods follows "one method per page query, writes are single-statement". New admin
  `ErrorCode`s were added to the shared catalog for not-found / already-running cases.
- Data introduced by admin-panel: `0056_admin_panel.sql` created `sampling_runs` and
  `push_delivery_log(notification_kind CHECK ...)`; retention constants live in code
  (`PUSH_DELIVERY_LOG_RETENTION_DAYS = 30`, etc.), listed in the design's "Configuration & Constants"
  table (constants are code-level, not env vars, for curated internal-tool values).
- Hard constraints the extension would inherit: the panel adds NO hosted process, NO new
  scheduled work, only does work in response to an operator request (Admin intro). Images in
  server-rendered HTML need a URL the operator's browser can load (the panel has no JS and no
  session; a private-bucket image would need a short-lived URL generated at render time).
- No user-facing "report" intake exists to feed such a queue (section 7), so a queue would need
  both an intake source (for example automated-moderation flags and/or a user report) and a
  disposition action; neither exists.

---

## 11. Hosting and runtime constraints that bind the design

From `docs/hosting.md` and steering `tech-conventions`:

- Render free web service: sleeps after ~15 min idle (cold start 30-60 s), 512 MB RAM, shared
  CPU; no always-on worker (a BullMQ `Worker` polling Redis would burn the Upstash budget);
  scheduled work must be driven by an external cron (cron-job.org) hitting an authenticated
  endpoint that returns fast (`202`) and works async in-process. The keep-alive cron is ~every 10
  min, ~7 AM-1 AM ET. Dedicated per-job crons use a dedicated secret env var and an
  `x-cron-secret` header (precedent: `TRIP_BOOKING_CRON_SECRET`, `PIN_RECONCILE_CRON_SECRET`,
  `SAMPLING_CRON_SECRET`; config.ts enforces they differ). A cron that touches Neon on a 10-min
  cadence breaks the Neon budget (docs explain why; use a few ticks per day).
- Neon Postgres: ~1 GB per project, scale-to-zero (~100 CU-hours/month cap). Keep stores
  bounded: fixed-shape aggregates; prune raw rows to a recent window. Photo METADATA is small;
  photo BYTES must not go in Postgres.
- Upstash Redis: ~500k commands/month. Avoid continuous polling or per-photo Redis chatter.
- Doc drift to fix when storage returns: `docs/hosting.md` says twice that avatars are bundled
  and "no object storage is needed", has an At-a-Glance table with no storage row, and a "Setup
  Order" list; `render.yaml` has no storage env entries; `apps/api/.env.example` has no storage
  block. A new storage dependency should update all three (and README).
- API gateway rate limiting (`apps/api/src/plugins/rateLimit.ts`, registered when `rateLimit: {}`
  is passed to `buildServer`, which `composeServices.ts` always does): per-user buckets, reads 300/min,
  mutations 60/min (`DEFAULT_READS`, `DEFAULT_MUTATIONS`), login account budget 5 per 15 min.
  Key = `defaultRateLimitKey(req)` partitioned `read`/`mut`. A multi-photo upload flow that does
  one mutation per photo (for example request-URL + confirm per photo) consumes this shared
  60/min mutation budget.
- Request size: `server.ts` sets no `bodyLimit` override and `@fastify/multipart` is not installed
  (Fastify 4 default JSON/body limit applies). Server-proxied uploads would need both. Pino
  `redact` is configured in `logger.ts`/`createLogger()`; request bodies containing binary or
  URLs with signed query strings should be considered for redaction.
- Object lifecycle fact: DB `ON DELETE CASCADE` (users, trips, food_items, log rows) does not
  remove external objects. There is no account-deletion feature and no background sweeper; the
  only place that deletes trips/rows is the Organizer `DELETE /trips/:id`
  (`trips/routes.ts` line ~442) and per-resource deletes.
- Costs/free-tier reference for the spec's Configuration & Constants (from the user's own
  statements in the request, not verified here): Cloudflare R2 was used originally; the user
  proposes a NEW bucket in the existing Cloudflare account. The code retains no R2 config.

---

## 12. Cross-spec touchpoints the new spec will have to cite

1. `trips` (permissions matrix, `trip_feed_items`, `trip_comments`, `trip_reactions`,
   cascade-on-delete R3.7, Member gate R15.x). New actions are additive to `permissions.ts` +
   `permissions.matrix.prop.test.ts` partition.
2. `friend-food-ratings` (R5.1-R5.4 no-leak rules; "separate sibling service, do not reuse
   owner DTOs" decision; visibility model "always on for accepted Friends"; routes
   `/users/:userId/food-ratings` and `/experiences|locations/:id/food-item-logs/friends`).
3. `food-item-logging` (owner-scoped `/me/food-items/:foodItemId/logs`, strict Zod bodies,
   `food_item_logs` columns, `food_log_not_found` collapse of non-owner).
4. `trip-expenses` (receipt photo explicitly never uploaded or stored; OCR is on-device only).
5. `trip-booking-timeline` (pattern for new TripAction members, `can()` usage, `permissions.ts`
   test partition, `0061` migration style, config additions, `push_delivery_log` kind widening
   pattern, Reminder_Cron dedicated-secret pattern).
6. `admin-panel` (extend with a new Admin_Section by cross-reference; HTML escaping rule; Basic
   auth; no new process).
7. `social-sharing-loop` / `notification-center` (share payload kinds, push infrastructure;
   Attention_Items are for pending actionable items only).
8. `catalog-redesign` / `experience-detail-*` specs (if any experience-level photo UI is
   proposed; ExperienceDetail is a root-stack screen).
9. `dark-mode` (theme guard; every new screen must repaint on scheme switch).
10. `pin-collection` steering: only relevant if a photo-driven pin/achievement is introduced;
    otherwise the pin gate is not applicable.

Build order implied by the code: shared contracts first (`packages/shared`), then migration
`0062`, then api service + wiring in `composeServices.ts`/`server.ts` (opt-in option block on
`BuildServerServices`, plus a wiring test asserting production registration, since an omitted
entry silently drops routes), then mobile hooks/screens, then admin extension.

---

## 13. Open facts and risks the design author should resolve explicitly

These are observations, not decisions.

1. **Summary share has no server path.** Photos in a shared summary require either new
   client-side handoff (the OS Share sheet currently receives text only) or a new server-side
   share/link concept. Neither exists; the Sharing_Service has no trip payload kind.
2. **"Post photos in the trip feed" collides with the feed model.** Feed items are
   system-generated; members only react/comment. A user-authored feed post would be a new feed
   item type (CHECK widening migration like `0018`) or a separate media entity, and comments/
   reactions on `log_entry` targets are accepted by the API but never read or shown.
3. **"Album" is net new.** There is no media table, no album read, no pagination in
   `getFeed` (it returns everything), so an album listing must paginate from day one
   (precedent: keyset cursors in `friendFoodRatings` and `foodLists`).
4. **Orphaned-object risk.** DB cascades will not delete objects; no sweeper exists; Render has
   no worker. Any delete path (photo, log, trip, user) needs a defined object-cleanup story
   compatible with the cron-driven `202` pattern.
5. **No block/report/account-deletion.** UGC visible to other users has no abuse-handling
   surface today. Admin panel has no review queue.
6. **Food-log photos vs friend-food-ratings R5.** Friend reads expose no per-Log identifiers;
   a photo is per-Log. Any friend exposure must be a new DTO + gate + no-leak tests.
7. **Rate limit coupling.** One mutation per photo step counts against 60/min per user.
8. **Config/hosting drift.** `docs/hosting.md`, `render.yaml`, `.env.example` all assert
   "no object storage"; update together. New required env vars fail the Render build if unset
   (migrate step calls `loadConfig`). `GEMINI_API_KEY` is present locally but unwired and
   unmentioned in templates or `render.yaml`.
9. **Dependencies.** Not installed: any S3 client, `@fastify/multipart`, `expo-image-manipulator`,
   `expo-file-system`, any image-processing library on the server. Steering requires exact or
   pinned versions and flags unusual package names. Mobile deps must match Expo SDK 56.
10. **Verification discipline.** Per `execution-discipline`: tests with every code addition
    (repo -> pg-mem test; route -> `server.inject`; migration -> `migration0062.test.ts`; shared
    schema -> valid+invalid case; mobile component -> RNTL render test driving each interaction
    and asserting both the network call and the on-screen change); regression tests at the layer
    that was wrong; final gate `npm run verify`; behavior->test map in the completion message;
    native modules stay out of Jest via the `.native.ts` / `.pure.ts` split.
11. **Spec editing rules.** The new spec must be self-sufficient (Configuration & Constants with
    concrete defaults and env var names, External Interfaces for any new external API with
    endpoints and fields relied on, concrete formulas, cross-spec dependencies and build
    order). Format enforced by the Kiro spec validator: requirements in EARS; design with
    Architecture / Components and Interfaces / Data Models / Correctness Properties as
    `### Property N` with a `**Validates:**` line / Error Handling / Testing Strategy; tasks as
    `# Implementation Plan` with `## Tasks` / `## Notes` / `## Task Dependency Graph`; checkboxes
    `- [ ]` / `- [x]` only. Edits to existing specs (friend-food-ratings, trips, admin-panel,
    food-item-logging) must be additive, no renumbering.
