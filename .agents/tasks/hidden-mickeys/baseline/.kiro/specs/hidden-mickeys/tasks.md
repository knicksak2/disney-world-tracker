# Implementation Plan

## Tasks

- [x] 1. Migration, Shared Contracts and Configuration
  - [x] 1.1 Create `apps/api/migrations/0072_hidden_mickeys.sql` per design.md Data Models: `hidden_mickeys`, `mickey_progress`, `mickey_still_there_votes`, `mickey_reports`, `mickey_submission_bans` and `mickey_experience_aliases`, with their indexes and `CHECK`s. The migration changes no existing table
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 4.1, 5.1, 7.1, 8.6, 14.5, 16.1_
  - [x] 1.2 Add `apps/api/src/db/__tests__/migration0072.test.ts` asserting every table and column; the `CHECK`s (`chk_hm_seed_official`, `chk_hm_hidden_reason`, `chk_mp_trip_needs_find`, `chk_mp_found_pair`, `chk_mea_distinct`, text length bounds); the unique `seed_key` partial index; each cascade and `SET NULL` (delete an experience, a user and a mickey, and assert the dependent rows; delete an alias Experience and a canonical Experience and assert the link row goes in both cases); that an alias cannot be linked twice (primary key); and that a `seed` row with `official = false` is rejected
    - _Requirements: 1.1, 1.2, 1.5, 16.1_
  - [x] 1.3 Add shared contracts: `packages/shared/src/constants/mickeys.ts`, `dto/Mickeys.ts`, `schemas/Mickeys.ts` (all `.strict()`; `mickeyListQuerySchema` includes the optional single `zone`), and the new `ErrorCode` entries and statuses in `errors.ts`; barrel everything from `index.ts` and `dto/index.ts`. Run `npm run build:shared` afterwards, because `apps/api` resolves `@dwt/shared` from `dist`
    - _Requirements: 1.1, 1.7, 2.3, 14.3_
  - [x] 1.4 Add shared tests `packages/shared/src/__tests__/mickeys.test.ts`: each Zod schema accepts a valid body and rejects an invalid one (level 1, level 4, unknown field, text one character under and over each bound, bad zone, bad report reason, search under 2 characters; the list query accepts each valid `zone` and omitting it, and rejects an unknown `zone` and more than one)
    - _Requirements: 1.7, 2.2, 3.6, 7.1_
  - [x] 1.5 Add the `MICKEYS_*` variables from design.md Configuration & Constants to `apps/api/src/config.ts` (Zod, defaults as listed, `permissivePhotoNumber` style for numbers), expose `config.mickeys`, and add the startup validation of Requirement 14.2 (submissions enabled in `publish` mode requires the text screen enabled and `PHOTO_HARM_API_KEY`). Add config tests for the defaults, an invalid number falling back to its default, and each failing combination
    - _Requirements: 14.1, 14.2_
  - [x] 1.6 Checkpoint — run `npm run build:shared`, `npm run verify:shared`, and `npm run typecheck`

- [x] 2. Pure Domain Modules (`apps/api/src/services/mickeys/domain/`)
  - [x] 2.1 Implement `hintGate.ts` and `transitions.ts` as in design.md; write `hintGate.prop.test.ts` (Property 1), a model-based test of `hint_level` monotonicity (Property 2, model part) and `transitions.prop.test.ts` (Property 11)
    - _Requirements: 1.3, 2.3, 3.2, 3.3, 3.4_
  - [x] 2.2 Implement `stillThere.ts` (`stillThereConfidence`, `confidenceLabel`, `isCommunityVerified`) with the design.md formula and default parameters; write `stillThere.prop.test.ts` (Property 7, including the worked values: no votes gives 0.9, one fresh `gone` is `confirmed`, four fresh `gone` is `possibly_removed`, monotonicity, the aging property, the label partition) and the derivation part of Property 9 (Official never verified, the submitter never counts, `possibly_removed` never verified, the exact threshold boundary)
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 6.6_
  - [x] 2.3 Implement `progress.ts` (`summarizeProgress`); write `progress.prop.test.ts` (Property 5, and the pure part of Property 6: community rows never change `overall` or any `byPark` entry): `found <= total`, only approved Official counted, `total` identical for two Users with different Progress_Rows and unchanged by a find, a `possibly_removed` Official entry stays in `total` and in `found` when found, an inactive Experience changes no count, null-park rows in one entry, overall equals the sum, `community.found` counts only Community Finds
    - _Requirements: 2.5, 2.6, 2.7, 2.8, 16.4_
  - [x] 2.4 Implement `submissionPolicy.ts` (`validateSubmission`, `containsUrlOrEmail`, `checkDailyCap`, `initialStatus`); write `submissionPolicy.prop.test.ts` (Property 12, policy part: bounds, closed sets, URLs and email addresses in each of the three fields, the cap boundary, `initialStatus` for every mode and screen combination), with realistic URL and email shapes (`https://x.com/a`, `www.x.com`, `x.com/a`, `a@b.co`) and clean text containing dots and "@" that must pass
    - _Requirements: 1.7, 6.2, 6.4, 6.5, 6.7_
  - [x] 2.5 Implement `reportPolicy.ts` and `seedParse.ts`; write `reportPolicy.prop.test.ts` (Property 13, policy part: hide only from `approved`, only when not Official, and at or above the threshold; an Official entry is never auto-hidden at any reporter count, including far above the threshold) and `seedParse.prop.test.ts` (Property 15, parse part: duplicates collapse to the first, invalid entries are reported, the order of valid entries is preserved; an entry with `photoUrl` is valid and its parsed form has no `photoUrl` key, an entry with an unknown field, a non-string `photoUrl` or one over 2048 characters is invalid; the schema is `.strict()` with `photoUrl` optional, not `.passthrough()`). Add a test that parses the real `apps/api/data/hidden-mickeys.seed.json` and asserts that no entry is rejected for its field names
    - _Requirements: 7.4, 12.1, 12.3, 12.5, 12.10_
  - [x] 2.6 Checkpoint — run `npx vitest run src/services/mickeys/domain` in `apps/api` (covers 2.1 to 2.5 and 2.7)
  - [x] 2.7 Implement `aliasGroup.ts` (`canonicalOf`, `groupOf`, `validateAliasLinks`) as in design.md; write `aliasGroup.prop.test.ts` (Property 21, model part): an unlinked Experience is a group of one; the group of an alias equals the group of its canonical; links are one hop; the group is sorted and has no duplicates; `validateAliasLinks` rejects a self link, an alias that is already a canonical, a canonical that is already an alias, and a second link for one alias, against both the stored links and earlier candidates in the same file, and is order-stable; accepted links never form a chain
    - _Requirements: 12.8, 16.1, 16.2, 16.3_

- [x] 3. Repo and Hunt Routes (`apps/api/src/services/mickeys/`)
  - [x] 3.1 Implement `repo.ts`: approved list with the Requirement 2.2 filters (`areaType`, `q`, `zone`, `found`, `scope`) applied in SQL before a keyset cursor, the `experienceId` filter resolved to the Experience_Group with the design.md SQL (Requirement 16.2), no `experiences.active` predicate in any list, detail, summary, finds or tally query (Requirement 16.4), exclusion of Hidden_Mickeys the caller reported from the list, and from `community.found` for Community entries only (an Official entry the caller reported stays in their summary `total` and `found`, Requirement 2.4), summary inputs (every approved Official entry counted regardless of Confidence_Label), detail read, hint upsert (`GREATEST`), find upsert (sets `found_at` and `found_on` from `wdwToday`; sets the trip link only when it is null), undo (one `UPDATE` setting `found_at`, `found_on` and `trip_id` to null together, plus deleting the vote, in one transaction), vote upsert, vote read for Confidence and the distinct non-submitter `there` voter count, and the Friends-found count via `active_friendships`. Every multi-row `INSERT ... ON CONFLICT` is deduped by its conflict key first
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.6, 3.3, 3.7, 4.1, 4.2, 4.5, 5.1, 16.2, 16.4_
  - [x] 3.2 Implement `service.ts` (`HuntService`) composing the repo with the pure modules: spoiler gating, Confidence and labels, `communityVerified`, the summary (Official totals, the `park: null` entry, `community.found`), the trip membership check through `assertTripMember`, and the detail read
    - _Requirements: 2.3, 2.5, 2.6, 2.7, 3.2, 3.7, 4.2, 4.3, 4.4, 5.5_
  - [x] 3.3 Implement the User routes `GET /mickeys/config`, `GET /mickeys`, `GET /mickeys/summary`, `GET /mickeys/:id`, `POST /me/mickeys/:id/hint`, `POST /me/mickeys/:id/find`, `DELETE /me/mickeys/:id/find` and `PUT /me/mickeys/:id/vote` in `routes.ts`, with static routes registered before parametric ones, the `MICKEYS_ENABLED` kill switch, and `.strict()` params and body schemas from shared
    - _Requirements: 2.1, 2.9, 3.1, 3.5, 3.6, 4.1, 4.7, 5.1, 5.7, 14.3_
  - [x] 3.4 Write pg-mem repo tests `repo.test.ts` that run the real SQL: the list excludes every Status except `approved`; the list excludes entries the caller reported and no one else's; after the caller reports an Official entry their summary `total` and `found` equal another User's `total` (and their own `found` if they found it), while after reporting a Community entry it leaves their `community.found`; find persists `found_on` and `trip_id` (read the row back); find twice keeps `found_at`; undo clears every find field and the vote and keeps `hint_level`; hint never lowers; vote replaces; the summary counts only Official entries per park and puts a null-park Hidden_Mickey in the `park: null` entry so the overall equals the sum; a Community entry changes no Official count; the list filters `areaType=Resort`, `q`, `found` and `scope` in SQL before the cursor (a filtered second page is not short); the non-submitter voter count excludes the submitter. Also: undoing a Find that has a `trip_id` succeeds and the row read back has `found_at`, `found_on` and `trip_id` all null (it would fail with the `chk_mp_trip_needs_find` violation if undo cleared `found_at` in a separate statement); `zone` returns only that Zone, composes with `park`, `scope` and `found`, and a filtered second page is not short (Property 23); with an alias link, `experienceId` of the alias and of the canonical return the same items, and the SQL result equals the `groupOf` model (Property 21, stored); a Hidden_Mickey on an `active = false` Experience is still listed, counted, findable and votable, and flipping `active` changes no response (Property 22); the summary `total` is the same for two Users, does not change when a `possibly_removed` entry is found, and does not change when a link is added. Include the property tests for Properties 2 (stored), 3, 4, 6 (stored), 8, 10, 21, 22 and 23
    - _Requirements: 1.6, 2.1, 2.2, 2.4, 2.5, 2.6, 2.7, 4.1, 4.2, 4.5, 5.1, 5.5, 16.2, 16.4, 16.5_
  - [x] 3.5 Write route integration tests `routes.test.ts` with `server.inject` and fake ports: the 401 gate on every route, happy paths, `mickey_not_found` on unknown and non-approved ids, `validation_failed` on `level: 1`, an unknown `zone`, two `zone` values and unknown fields, `trip_forbidden` for a non-member `tripId` (Property 18), spoiler gating through the real handler (detail at levels 1, 2, 3 and after a find), the kill switch, and that `/mickeys/summary` and `/mickeys/config` are not captured by `/mickeys/:id`
    - _Requirements: 2.9, 3.2, 3.5, 3.6, 4.3, 4.7, 14.3_
  - [x] 3.6 Wire `HuntService` and the routes into `apps/api/src/composeServices.ts` and the server's service-registration block, using the same opt-in pattern as `favoriteRoutes`
    - _Requirements: 2.1, 4.1_
  - [x] 3.7 Checkpoint — run `npm run build:shared`, then `npm run verify:api`

- [x] 4. Friends and Trip Reads
  - [x] 4.1 Add `GET /mickeys/summary?for=` (via `assertOwnerOrFriend`) and `GET /users/:userId/mickeys/finds` (keyset cursor; never returns `clue2` or `reveal`), and the `friendsFoundCount` on the detail read
    - _Requirements: 3.7, 10.1, 10.2, 10.3_
  - [x] 4.2 Add `GET /trips/:id/mickeys` to the Trips routes module, gated by `assertTripMember`, computing per-member counts and the distinct Hidden_Mickey list at read time
    - _Requirements: 11.1, 11.2, 11.3, 11.4_
  - [x] 4.3 Write tests: Property 16 (self, Friend and non-friend; member, non-member and non-existent Trip collapse to identical errors; no `clue2` or `reveal` in either response), Property 17 (counts, member departure, a find without a `trip_id` or with another Trip's id, Official and Community both counted), and `server.inject` route tests for the 200 and error shapes
    - _Requirements: 10.1, 10.2, 10.3, 11.1, 11.2, 11.3, 11.4_
  - [x] 4.4 Checkpoint — run `npm run verify:api`

- [x] 5. Community Submissions
  - [x] 5.1 Implement `adapters/openaiTextScreen.ts` per design.md External Interfaces, first confirming against the OpenAI moderation documentation that a plain string `input` is accepted, and add `mickeys.guards.test.ts` (provider names and secret-shaped strings only inside `adapters/`), modeled on `photos.guards.test.ts`. Write adapter tests with an injected `fetchFn`: URL, bearer header, `input` string body, flagged and unflagged parse, malformed body, 401, 429, 5xx, timeout and network error all mapped to `retryable`
    - _Requirements: 6.3, 6.4_
  - [x] 5.2 Implement `submissionService.ts` and the routes `POST /me/mickeys/submissions` and `GET /me/mickeys/submissions`: validation, the URL and email rule, the Experience-exists check with no `active` check, alias-to-canonical resolution before the insert (Requirement 16.3), the ban check, the daily cap, the text screen (a flag rejects without storing; a retryable failure creates a `pending` row with `text_screen = 'unscreened'`), `initialStatus` from the configured mode, and creation of the Hidden_Mickey, the submitter's Progress_Row with a Find, and the `there` vote in one transaction
    - _Requirements: 1.4, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.11, 9.1, 16.3, 16.4_
  - [x] 5.3 Write tests: Property 12 (creation side: in `publish` mode with a passing screen exactly one `approved` Community Hidden_Mickey, one Progress_Row with a Find and one `there` vote; `review` mode and an unscreened result give `pending`; a flagged or URL-containing submission leaves no row of any kind; the cap boundary; a banned user is refused), route tests (401, validation, `mickey_text_rejected`, `mickey_submission_limit`, `mickey_submissions_banned`, `mickey_feature_disabled`, listing only the caller's own submissions in every Status), and that the submitter's own vote does not make a new entry `communityVerified`; a Submission naming an Alias_Experience is stored with the canonical `experience_id` and appears in the list for both; a Submission naming an `active = false` Experience is accepted (Property 12 with Property 21)
    - _Requirements: 1.4, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.11, 9.1, 16.3, 16.4_
  - [x] 5.4 Checkpoint — run `npm run verify:api`

- [x] 6. Reports and Soft-Hide
  - [x] 6.1 Implement `reportService.ts`, the repo statements (report insert `ON CONFLICT DO NOTHING`, the Counted_Report count from design.md, the conditional hide update) and `POST /mickeys/:id/report`: one report per user, the own-submission refusal, the immediate personal hide, the auto-hide at `MICKEYS_REPORT_AUTOHIDE` for Community entries only (the conditional update carries `AND official = FALSE`, and `shouldAutoHide` receives `official`), and `404 mickey_not_found` for a non-approved target
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.7_
  - [x] 6.2 Write tests (Property 13): a repeated report changes nothing; reports from users with no find are stored but never counted; the third counted reporter hides a Community entry and the second does not; ten counted reporters on an Official entry leave it `approved` and visible to everyone else, hidden only from each reporter's own list, with every Official park `total` unchanged, and the Operator index lists it with its report counts (Property 13, Property 6); hiding deletes no Progress_Row or vote; two concurrent reports hide it once; the reporter's own list drops the entry at once while another user's list keeps it until it is hidden; restoring dismisses the reports so they do not count again; reporting your own submission is refused
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_
  - [x] 6.3 Checkpoint — run `npm run verify:api`

- [x] 7. Operator Console
  - [x] 7.1 Implement `adminService.ts`: approve, reject (note up to 300 characters), edit, retire, restore (also marking the open reports `dismissed` or, on retire, `upheld`), promote (only `approved` Community; sets `official` and `promoted_at` and nothing else), dismiss reports, ban (inserts the ban and sets the submitter's `approved` Community entries to `hidden` with reason `operator`) and unban, each Status change guarded by `canTransition`
    - _Requirements: 1.3, 7.6, 8.3, 8.4, 8.6_
  - [x] 7.2 Implement `apps/api/src/services/admin/mickeyRoutes.ts`, registered beside `registerPhotoRoutes`: `GET /admin/mickeys` with the four sections of Requirement 8.1, a page per Hidden_Mickey (text layers, Source, Official flag, submitter, same-Experience duplicates, reports), the POST actions behind `basicAuth` and `requireSameOrigin`, the promote confirmation showing which park total grows by one, the guest-areas-only guideline, the read-only section of Requirement 8.9 (approved Hidden_Mickeys whose whole Experience_Group has no active Experience, with a note that nothing is changed automatically), and the `X-Robots-Tag` and `Cache-Control` headers
    - _Requirements: 8.1, 8.2, 8.3, 8.5, 8.7, 8.8, 8.9, 15.4, 15.5_
  - [x] 7.3 Write tests in the style of `admin/__tests__/photoRoutes.test.ts`: 401 without basic auth, 403 on a cross-origin POST, each action's effect and refused transitions (Property 11), promotion rules and that it changes no other column (Property 14), the ban and unban effects (Property 20), the four lists on the index page (the open-Reports section shows an Official entry that has Reports ahead of Community ones), the headers, and that promotion raises exactly one park total for a user who found the entry (Property 6, stored); that the Requirement 8.9 section lists an approved entry whose group is entirely inactive, omits one whose group has an active alias or canonical, and that rendering it changes no Status (Property 22)
    - _Requirements: 1.3, 8.1, 8.3, 8.4, 8.6, 8.7, 8.9_
  - [x] 7.4 Checkpoint — run `npm run verify:api`

- [ ] 8. Seed Import
  - [x] 8.1 Implement `apps/api/src/scripts/importHiddenMickeys.ts` per Requirement 12: file path argument, `--approve`, `--dry-run`, Experience resolution by `upstreamEntityId` or exact name and park (a null or omitted park matches only null-park resort-area Experiences, using `IS NOT DISTINCT FROM`), dedupe by `seedKey` before the insert, `ON CONFLICT (seed_key) DO NOTHING`, Source `seed` and Official true on every row, and the printed report. Add the `--aliases <file>` option of Requirement 12.8: resolve both ids by exact `upstream_entity_id`, run `validateAliasLinks` against the stored links, insert with `ON CONFLICT (alias_experience_id) DO NOTHING`, dedupe the file by alias first, and report inserted, already linked, unresolved and invalid links; seed entries are stored on the Experience they resolve to (Requirement 12.9)
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.8, 12.9_
  - [x] 8.2 Write pg-mem tests: Property 15 (importing twice equals importing once; an existing `seedKey` is untouched; ambiguous and missing Experiences insert nothing; a resort entry with a null park resolves to the resort Experience and a theme-park entry never matches a null-park row; invalid entries are reported; every row is Official with Source `seed`), the default `pending` and the `--approve` statuses, and `--dry-run` writing nothing; an entry with a `photoUrl` imports to a row identical to the same entry without it, read back from `hidden_mickeys`, and the script makes no network request (inject a `fetch` that fails the test if called); for aliases: importing twice equals once, an existing link is never repointed, a self link, a chain (alias already a canonical, or canonical already an alias, stored or within the file) and an unresolved id insert nothing and are reported, `--dry-run` writes no link, and a seed entry resolving to an alias Experience is stored on that alias and appears in the group list (Property 21)
    - _Requirements: 12.2, 12.4, 12.5, 12.6, 12.8, 12.9, 12.10_
  - [ ] 8.3 Draft the initial seed file `apps/api/data/hidden-mickeys.seed.json` in original wording from public leads, one entry per Hidden_Mickey, targeting 50 to 100 entries for the first batch across the catalog's parks and resorts. Further batches use the same idempotent import. Leave this task **unchecked until the owner has reviewed the entries for accuracy**: the agent cannot verify them. The file must contain no text copied from guidebooks, catalogs or fan sites (Requirement 12.7). An optional `photoUrl` per entry is allowed as reference data; the importer ignores it (Requirement 12.10), and nothing may fetch or serve it. Shared structure is seeded once on the base Experience; seed on a seasonal variant only a Hidden_Mickey that exists solely in that variant (Requirement 12.9)
    - _Requirements: 12.7, 12.9_
  - [ ] 8.4 Create `apps/api/data/mickey-aliases.json` with the one confirmed link in design.md ID mapping (*Living with the Land – Glimmering Greenhouses* `412010036;entityType=Attraction` as alias of *Living with the Land* `80010161;entityType=Attraction`). Before adding any other link, look both Experiences up in the catalog (Open Item 6: Jingle Cruise's base, and any Halloween or holiday variants), and run the import with `--aliases ... --dry-run` first. Leave this task **unchecked until the owner has reviewed the links**: the agent cannot know which catalog entries are the same physical ride
    - _Requirements: 12.8, 16.1, 16.6_

- [x] 9. Account Deletion
  - [x] 9.1 Read `accountDeletion/dispositions.ts` and `dispositions.test.ts`, then add registry entries for `hidden_mickeys.submitter_id` (`nullify`), `mickey_progress.user_id`, `mickey_still_there_votes.user_id`, `mickey_reports.user_id` and `mickey_submission_bans.user_id` (all `delete`), following the existing entry shape and the way composite-key tables are chunked, and update any explicit lists in the test that enumerate dispositions
    - _Requirements: 15.1, 15.2_
  - [x] 9.2 Write a purge test for Property 19: a user with Progress_Rows, votes, reports, a ban and Submissions is purged; their Progress_Rows, votes, reports and ban are gone, their Submissions remain with `submitter_id` null, and the existing registry-completeness property passes
    - _Requirements: 9.3, 15.1, 15.2_

- [x] 10. Mobile (`apps/mobile`)
  - [x] 10.1 Register the root-stack screens `HiddenMickeys`, `HiddenMickeyDetail`, `SubmitMickey` and `MySubmissions` and their param types, the way `ExperienceDetail` is registered. Add `useMickeyConfig` (reads `GET /mickeys/config`) and use it to hide entry points when `enabled` is false
    - _Requirements: 13.1, 13.9_
  - [x] 10.2 Add the query hooks and mutations (list, summary, detail, hint, find with optimistic update and rollback, undo, vote, report) and one shared set of query keys, invalidating the summary and list after a find, undo, vote or report. Add a test per mutation asserting the request (endpoint and payload) and the rollback on failure
    - _Requirements: 13.8_
  - [x] 10.3 Build `HiddenMickeysScreen`: Official progress overall and per park, the Community found count, the hunt list with Clue_1, zone, difficulty and the Community and Community verified badges (text or icon as well as colour), an Experience filter param, park tabs plus a Resorts tab (`areaType=Resort`), an Official and Community switch (`scope`), a search field (`q`), a Found filter (`found`) and a row of Zone pills (`zone`; Queue, Pre-show, On ride, Exit, Exterior, Interior, Grounds and an "All" pill that sends no `zone`; each with a text label and an accessibility label), all sent to the server, and a text or icon "Possibly removed" badge on an entry whose Confidence_Label is `possibly_removed` that does not change the progress numbers. Style with `makeStyles` and `useAppTheme`, no raw colours. Test that each control changes the request params (each Zone pill sends its `zone`, "All" sends none, and a pill composes with the park tab and the Found filter), that the Resorts tab shows resort Hidden_Mickeys, and that a `possibly_removed` entry shows its badge while the total stays the same
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6, 13.1, 13.4, 13.6, 13.7_
  - [x] 10.4 Build `HiddenMickeyDetailScreen`: Clue_1 with zone and difficulty, "Need a hint?" then a separate "Show me" (two requests), "I found it" with the trip chip (default to the one Trip containing today, as the log sheet does) and undo, the "Still there?" control with "Couldn't find it", the Confidence_Label, the Friends-found count, the Community and Community verified badges, and the "Report" control with its reason picker. Test each interaction: both the request and the on-screen change, including that a reported entry leaves the list
    - _Requirements: 3.2, 3.3, 4.1, 4.5, 5.1, 7.1, 7.2, 11.5, 13.5, 13.6, 13.8_
  - [x] 10.5 Build `SubmitMickeyScreen` (Experience picker, zone, difficulty, three text fields with counters, the existing-Mickeys list for the chosen Experience, the guest-areas-only rule and the no-links rule) and `MySubmissionsScreen` (status, Clue_1, review note, Community verified). Test validation, the duplicate list, the URL rejection message, success, the limit error, the ban error and the statuses
    - _Requirements: 6.9, 6.10, 9.1, 9.2, 15.5_
  - [x] 10.6 Add the entry points on `ExperienceDetailScreen` (the "N Hidden Mickeys here · you've found M" card, or the quiet "Know one? Add it" link) and on the Explore hub ("Hidden Mickeys" entry). First read each screen's section-composition pattern and copy it. The card's count and the "you've found M" use the Experience_Group through `GET /mickeys?experienceId=` (Requirement 16.2); test that opening an Alias_Experience shows its canonical's Hidden_Mickeys, and that the card's request uses the viewed Experience's own id (the server resolves the group)
    - _Requirements: 13.2, 13.3, 16.2_
  - [x] 10.7 Add the Friend's hunt progress section to the existing Friend profile screen (summary and recent finds, read-only, Clue_1 only). First locate where that screen composes its sections
    - _Requirements: 10.1, 10.2, 10.4_
  - [x] 10.8 Add the Vault progress card on the Collection home (Official `found / total` and the Community count) and the "Hidden Mickeys" tally section with its empty state on `TripDetailScreen`. Extend `CollectionScreen` and `TripDetailScreen` tests, asserting the existing assertions are unchanged
    - _Requirements: 11.5, 13.3_
  - [x] 10.9 Checkpoint — run `npm run typecheck` and `npm run test` in `apps/mobile`, and confirm `themeRetrofit.guard.test.ts` passes with no allowlist change

- [x] 11. Final Verification Gate
  - [x] 11.1 Run the full `npm run verify` once, as the final gate for the complete change. Paste the literal tail of the output (per-workspace pass counts and exit code) and the behavior-to-test map before declaring the feature done. Leave task 8.3 unchecked until the owner has reviewed the seed content
    - _Requirements: all_
    - _Requirements: all_

## Notes

- **Order and shared build.** `apps/api` resolves `@dwt/shared` from `packages/shared/dist`. Run `npm run build:shared` after any change under `packages/shared/src` and before running API tests.
- **No photos.** Photos in any form (find photos, a gallery, Verified, submission evidence, AI image checks) were designed and removed on purpose. No task touches the photo service, its tables or constraints, `PhotoTargetKind`, or the push-notification kinds. Adding photos later is a new spec.
- **No pins.** Pins and achievements for Hidden Mickeys are deferred to the next round of pins. No task touches `pin-collection`, so the pin gate (`verify/run-all.js`) is not run.
- **Official versus Community is the core invariant.** Only Official entries count toward park totals. Submitting, finding, voting on, reporting, hiding or retiring a Community entry must never change anyone's Official `total` or `found`; only promotion does (Properties 5, 6, 14).
- **Publish-first has a safety valve.** `MICKEYS_SUBMISSION_MODE=review` sends every submission to the Operator queue without a deploy. Startup refuses `publish` mode when the text check cannot run (Requirement 14.2).
- **Flagged text is never stored.** A flagged or link-containing submission creates no row. Only a text-check outage creates a `pending` row, visible to the Operator only.
- **The denominator is fixed.** `total` counts every approved Official entry. A `possibly_removed` label is a badge, never a count, so a really-gone Hidden_Mickey leaves the totals only when the Operator retires it (Requirements 2.6, 5.4). Votes and the catalog cannot move a park total.
- **`experiences.active` is never consulted for visibility** (Requirement 16.4). Only the Operator's read-only review list (Requirement 8.9) reads it. A reviewer who adds `AND e.active` to a list or count query is breaking Property 22.
- **Seasonal variants are aliases, not copies.** Shared Hidden_Mickeys are stored once on the base Experience; a variant listed separately in the catalog is linked with `mickey_experience_aliases`, and reads resolve the group (Requirement 16). Do not seed the same Mickey on both Experiences: it would be two Finds and a double count. No other feature reads the link table, and no task changes ride logging, favorites, planning or pins.
- **Undo is one statement.** `found_at`, `found_on` and `trip_id` are cleared in one `UPDATE`; `chk_mp_trip_needs_find` rejects any other order.
- **Reports never hide an Official entry for everyone.** Auto-hide applies to Community entries only. A Report on an Official entry hides it from the reporter's list and surfaces in the Operator console; only the Operator can retire or hide it, so Official park totals move only through Operator actions (Requirement 7.4, 8.4).
- **Reports hide, they do not delete.** Soft-hide is reversible and keeps every Progress_Row and vote.
- **Content task is human-gated.** Task 8.3 cannot be checked by the agent. It stays open until the owner has verified the entries, and the import script defaults to `pending` so nothing reaches Users unreviewed.
- **Deferred.** Photos, pins, push notifications about submissions, a shared crew checklist, a live leaderboard, a Trip Recap line, Trip Activity feed items, location-based features, user-to-user blocking, non-WDW parks.
- **Related specs are not edited.** `admin-panel` is extended in code by this spec but its document is untouched. `photo-uploads` is not touched at all.
- **Test gotchas.** Run `npm run verify` with nothing else running (a concurrent Vitest run deletes `apps/api/coverage/.tmp`). `apps/mobile` Jest does not typecheck, so run the mobile `npm run typecheck`. pg-mem cannot cast a `DATE` column with `::text`; format dates in code.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3"] },
    { "id": 1, "tasks": ["1.2", "1.4", "1.5"] },
    { "id": 2, "tasks": ["1.6"] },
    { "id": 3, "tasks": ["2.1", "2.2", "2.3", "2.4", "2.5", "2.7"] },
    { "id": 4, "tasks": ["2.6", "3.1"] },
    { "id": 5, "tasks": ["3.2", "9.1"] },
    { "id": 6, "tasks": ["3.3", "9.2"] },
    { "id": 7, "tasks": ["3.4", "3.5", "3.6", "10.1"] },
    { "id": 8, "tasks": ["3.7", "10.2"] },
    { "id": 9, "tasks": ["4.1", "4.2", "5.1", "8.1", "10.3"] },
    { "id": 10, "tasks": ["4.3", "5.2", "6.1", "8.2"] },
    { "id": 11, "tasks": ["4.4", "5.3", "6.2", "10.4"] },
    { "id": 12, "tasks": ["5.4", "6.3"] },
    { "id": 13, "tasks": ["7.1"] },
    { "id": 14, "tasks": ["7.2", "10.5", "10.6"] },
    { "id": 15, "tasks": ["7.3", "10.7", "10.8"] },
    { "id": 16, "tasks": ["7.4", "8.3", "8.4", "10.9"] },
    { "id": 17, "tasks": ["11.1"] }
  ]
}
```

Tasks within a wave can proceed in parallel; each wave depends only on earlier waves.

```
1. Migration, Contracts, Config
   │
   ├──> 2. Pure domain modules ──> 3. Repo + hunt routes ──┬──> 4. Friends + Trip reads
   │                                                        ├──> 5. Submissions ──┬──> 7. Operator console
   │                                                        ├──> 6. Reports ──────┘
   │                                                        └──> 10. Mobile (10.1–10.4 early; 10.5–10.8 after 4–6)
   ├──> 8. Seed import (8.3 content: human-gated)
   └──> 9. Account deletion
                              all of the above ──> 11. Final gate
```
