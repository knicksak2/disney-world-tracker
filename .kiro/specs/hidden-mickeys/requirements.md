# Requirements Document

## Introduction

Hidden Mickeys are small Mickey Mouse shapes that Imagineers concealed in the design of Walt Disney World attractions, queues, restaurants, resorts and grounds. Finding them is a long-standing guest pastime, and it fits the moment this app serves: standing in a 45-minute queue with the family and wanting something to do right where you are.

This feature adds a **Hidden Mickeys hunt**. The app carries a list of Hidden Mickeys, each tied to an existing catalog Experience. A User browses the list per attraction or per park, reads progressive hints without being spoiled, taps "I found it", says whether a Hidden Mickey is still there, and compares progress with Friends and with the other members of a Trip. Users can also add Hidden Mickeys they know about, and those go live right away.

**Design stance (decided with the owner).**

- **Honor system.** A find is one tap. There is no proof, no photo and no verification step.
- **No photos in this feature.** Photos of finds, a shared gallery, an AI "Verified" tier and AI image checks were designed and deliberately removed: nothing in the feature needs them, they carry the most privacy, moderation and cost burden, and they can be added later without reworking the data. See "Explicitly deferred".
- **Official and Community entries.** *Official* entries are the owner-reviewed seed list plus any Community entry the Operator promotes. They alone make up park totals and completion. *Community* entries are added by Users, go live immediately after an automatic text check, carry a "Community" badge, and are counted in a separate "Community Mickeys found" number. Finding a Community entry always rewards the finder at once and never moves anyone's official total.
- **Publish first, moderate after.** Submissions are not approved one by one. An automatic text check, a daily limit, a report button with a reversible soft-hide, "still there?" votes, and Operator tools (promote, retire, restore, ban) keep quality up. A configuration switch can send submissions to a review queue instead, if abuse appears.
- **Spoiler-safe by default.** The list shows only a vague first clue. Stronger hints and the full answer are fetched from the server only after the User asks, or after the User has found that Hidden Mickey.
- **Refurbishment-aware.** Paint jobs remove real Hidden Mickeys, so Users can vote whether one is still there, and a recency-weighted confidence label flags the ones likely gone. The label is a warning only: it never changes a total. A Hidden_Mickey that is really gone is retired by the Operator.
- **A fixed denominator.** Every User sees the same Official total for a park. Votes, Confidence_Labels and the catalog's `active` flag never change it; only Operator actions do.
- **Seasonal variants share Mickeys.** Some rides have a seasonal variant that the catalog lists as a separate Experience (for example Living with the Land and Living with the Land – Glimmering Greenhouses). The Operator links such an Experience to its base as an *alias*, so a Hidden_Mickey is stored once and is shown, found and counted once whichever of the two the User opens (Requirement 16).
- **Mickeys outlive catalog churn.** Whether the catalog currently lists an Experience (`experiences.active`) does not decide whether a Hidden_Mickey is shown. The Operator's Status does (Requirement 16.4).

**Explicitly deferred (not built by this spec):**

- **Photos of any kind**: find photos, a shared gallery, reference photos, the Verified tier, submission evidence photos, and any new AI image check. No change is made to the photo service, its tables or its constraints.
- **Pins and achievements for Hidden Mickeys.** They wait for the next round of pins. Nothing here touches `pin-collection`.
- **Push notifications** about submissions (approved, promoted, hidden). Status is visible in My Submissions.
- **A shared crew checklist or live leaderboard.** Each User has an individual checklist; Friends and Trip members compare through read-only tallies.
- **A Trip Recap line and Trip Activity feed items** for Hidden Mickey finds.
- **Location-based features** ("Hidden Mickeys near me", geofenced check-in).
- **User-to-user blocking** for this feature. Abusive submitters are handled by an Operator ban (Requirement 8).
- **Disneyland and non-WDW parks.** Scope is the Experiences already in this app's catalog.

## Glossary

- **App**: The mobile client (`apps/mobile`).
- **User**: An authenticated user of the App.
- **Experience**: An existing catalog item (`experiences` row), including resort Experiences, whose `park` is null.
- **Hidden_Mickey**: One catalogued hidden Mickey shape: a row in `hidden_mickeys` tied to exactly one Experience, with a Zone, a Difficulty, three text layers (Clue_1, Clue_2, Reveal), a Source, an Official flag and a Status.
- **Zone**: `exterior`, `queue`, `pre_show`, `on_ride`, `exit`, `interior`, `grounds`.
- **Difficulty**: `easy`, `medium`, `hard`.
- **Clue_1**: The vague first hint, and the spoiler-safe label for the Hidden_Mickey everywhere it is listed.
- **Clue_2**: The stronger hint, shown only at Hint_Level 2 or above.
- **Reveal**: The full answer, shown only at Hint_Level 3 or after a Find.
- **Source**: `seed` (imported from a Seed_File) or `user` (a Submission).
- **Official**: A boolean on a Hidden_Mickey. Every `seed` Hidden_Mickey is Official. A `user` Hidden_Mickey becomes Official only when the Operator promotes it. **Community** means not Official.
- **Status**: `pending`, `approved`, `rejected`, `retired`, `hidden`. Only `approved` Hidden_Mickeys are visible to Users, apart from a submitter's own entries in My Submissions.
- **Progress_Row**: A row in `mickey_progress`, one per `(User, Hidden_Mickey)`, holding the User's Hint_Level, Find fields and Trip link.
- **Hint_Level**: 1 (Clue_1 only; the default), 2 (adds Clue_2), 3 (adds Reveal). It only ever rises.
- **Find**: A Progress_Row with `found_at` set. Created by one tap; idempotent.
- **Still_There_Vote**: A User's single latest vote, `there` or `gone`, on whether a Hidden_Mickey still exists.
- **Confidence** and **Confidence_Label**: A number in `[0, 1]` computed at read time from Still_There_Votes, and its display projection `confirmed`, `uncertain` or `possibly_removed`.
- **Community_Verified**: A read-time flag, true for a Community Hidden_Mickey that at least `MICKEYS_COMMUNITY_VERIFIED_MIN` distinct Users other than its submitter have voted `there` on, whose Confidence_Label is not `possibly_removed`.
- **Submission**: A User-created Hidden_Mickey with Source `user`.
- **Report**: A User's single report on a Hidden_Mickey, with a reason.
- **Counted_Report**: An open Report made by a User who has at least one Find on any Hidden_Mickey.
- **Operator**: The person using the password-protected admin console (`/admin/...`), as defined by `admin-panel`.
- **Seed_File**: A JSON file of Hidden_Mickey entries consumed by the import script (Requirement 12).
- **Alias_Experience** and **Canonical_Experience**: A row in `mickey_experience_aliases` links an Alias_Experience (for example a seasonal variant the catalog lists separately) to its Canonical_Experience (the base ride). An Experience is never both, and a link is one hop only (Requirement 16).
- **Experience_Group**: A Canonical_Experience together with every Alias_Experience linked to it. An Experience that is in no link is a group of one. The group of an Alias_Experience is the group of its Canonical_Experience.
- **Trip_Member**, **Friend**: As defined by `trips` and `friends`.

## Requirements

### Requirement 1: Hidden Mickey Entries and Lifecycle

**User Story:** As an Operator, I want every Hidden Mickey stored with a consistent shape and a clear lifecycle, so that Users see a trustworthy list.

#### Acceptance Criteria

1. THE Hunt_Service SHALL store each Hidden_Mickey with exactly one `experience_id` referencing an existing Experience, one Zone, one Difficulty, Clue_1 of 10 to 140 characters, Clue_2 of 10 to 300 characters, Reveal of 10 to 500 characters, a Source, an Official flag and a Status.
2. THE Hunt_Service SHALL set Official to true for every Hidden_Mickey with Source `seed`, and to false for every Hidden_Mickey created by a Submission. THE database SHALL reject a `seed` row that is not Official.
3. THE Hunt_Service SHALL permit only these Status transitions: `pending` to `approved`, `pending` to `rejected`, `approved` to `retired`, `retired` to `approved`, `approved` to `hidden`, `hidden` to `approved`, `hidden` to `retired`. Any other transition SHALL be rejected without changing the row.
4. WHEN an import or Submission creates a Hidden_Mickey, THE Hunt_Service SHALL set Status as follows: a Submission accepted by Requirement 6 gets `approved` in publish mode or `pending` in review mode or when the text check was unavailable; an imported entry gets `pending`, or `approved` when the import script is run with `--approve`.
5. WHEN an Experience is deleted, THE database SHALL delete its Hidden_Mickeys and, by cascade, their Progress_Rows, Still_There_Votes and Reports.
6. THE Hunt_Service SHALL NOT return any Hidden_Mickey whose Status is not `approved` from any read route available to Users, except a User's own Submissions through Requirement 9.
7. THE Hunt_Service SHALL reject, with `validation_failed`, any create or edit whose Zone or Difficulty is outside the closed sets or whose text lengths are outside the bounds in criterion 1.

### Requirement 2: Hunt Lists and Progress Summary

**User Story:** As a User, I want to browse Hidden Mickeys by attraction or park and see how far along I am, without being spoiled.

#### Acceptance Criteria

1. WHEN a User requests `GET /mickeys` with optional `experienceId`, `park`, `areaType`, `land`, `q`, `zone`, `found`, `scope`, `cursor` and `limit` (default 50, maximum 100), THE Hunt_Service SHALL return the approved Hidden_Mickeys matching every supplied filter, in a stable order: park, land, Experience name, Difficulty (easy first), then id. WHEN `experienceId` is supplied, THE Hunt_Service SHALL match the Hidden_Mickeys of that Experience's whole Experience_Group (Requirement 16.2).
2. THE `areaType` filter SHALL accept `ThemePark`, `WaterPark`, `DisneySprings` or `Resort`, so resort Hidden_Mickeys, whose `park` is null, can be browsed. THE `q` filter SHALL be a case-insensitive substring of the Experience name or land, 2 to 60 characters. THE `zone` filter SHALL be exactly one Zone and SHALL match Hidden_Mickeys whose Zone equals it, so a User standing in a queue can list only what is findable there. THE `found` filter SHALL be `all` (default), `found` or `unfound`. THE `scope` filter SHALL be `all` (default), `official` or `community`. THE Hunt_Service SHALL apply every filter in SQL before pagination.
3. THE Hunt_Service SHALL return for each item: `id`, `experienceId`, Experience name, park, land, Zone, Difficulty, Clue_1, `official`, `communityVerified`, Confidence_Label, and the requesting User's Hint_Level and `found` flag. THE response SHALL NOT contain Clue_2 or Reveal.
4. THE Hunt_Service SHALL exclude from a User's list every Hidden_Mickey that User has reported (Requirement 7.2), without changing it for anyone else. For a Community Hidden_Mickey the exclusion also applies to that User's summary and `community.found`. For an Official Hidden_Mickey the exclusion applies to the list only: the User's `total` and `found` do not change, so every User keeps the same Official `total` (Requirement 2.6).
5. WHEN a User requests `GET /mickeys/summary`, THE Hunt_Service SHALL return an overall `{ total, found }`, a list of `{ park, total, found }` entries, and `community: { found }`, all computed at read time. Experiences with no owning park SHALL be reported together as one entry whose `park` is null, so the overall total always equals the sum of the entries.
6. THE Hunt_Service SHALL count only Official Hidden_Mickeys in `total` and `found`: `total` is the number of approved Official Hidden_Mickeys, whatever their Confidence_Label; `found` is the User's Finds among those. Therefore `found` SHALL never exceed `total`, and `total` SHALL be the same for every User for a given park. A `possibly_removed` Official Hidden_Mickey keeps its place in `total` and in `found`, and the App shows its warning badge; only an Operator action (Requirement 8) removes it from the count. The Experience's `active` flag SHALL NOT affect `total` or `found` (Requirement 16.4).
7. THE Hunt_Service SHALL compute `community.found` as the number of the User's Finds on approved Community Hidden_Mickeys. Finding, submitting, voting on, or reporting a Community Hidden_Mickey SHALL NOT change any User's `total` or Official `found`.
8. THE Hunt_Service SHALL exclude `retired` and `hidden` Hidden_Mickeys from every count, while keeping the User's Progress_Rows for them.
9. IF the requester has no session, THEN THE Hunt_Service SHALL reject the request with HTTP 401 before any repo work.

### Requirement 3: Progressive Hints

**User Story:** As a User, I want to ask for a stronger hint, and then for the answer, only when I choose to.

#### Acceptance Criteria

1. THE Hunt_Service SHALL treat a User with no Progress_Row, or a Progress_Row with `hint_level` 1, as being at Hint_Level 1.
2. WHEN a User requests `GET /mickeys/:id`, THE Hunt_Service SHALL return Clue_1 always, Clue_2 only if the User's Hint_Level is at least 2 or the User has a Find, and Reveal only if the User's Hint_Level is 3 or the User has a Find.
3. WHEN a User requests `POST /me/mickeys/:id/hint` with `{ level: 2 | 3 }`, THE Hunt_Service SHALL set the Progress_Row's `hint_level` to the greater of its current value and `level`, creating the row if needed, and SHALL return the detail described in criterion 2.
4. THE Hunt_Service SHALL NOT lower a Hint_Level through any route.
5. IF `:id` does not reference an approved Hidden_Mickey, THEN THE Hunt_Service SHALL reject the request with HTTP 404 and error code `mickey_not_found`.
6. THE Hunt_Service SHALL reject a `level` other than 2 or 3 with `validation_failed`.
7. THE `GET /mickeys/:id` response SHALL also include `official`, `communityVerified`, Confidence_Label, the User's `found`, `tripId` and `hintLevel`, and `friendsFoundCount`: the number of the User's Friends who have a Find on it, from `active_friendships`.

### Requirement 4: Logging and Undoing a Find

**User Story:** As a User, I want to mark a Hidden Mickey as found with one tap, optionally tie it to my Trip, and undo a mistaken tap.

#### Acceptance Criteria

1. WHEN a User requests `POST /me/mickeys/:id/find` with an optional `{ tripId }`, THE Hunt_Service SHALL create or update the User's Progress_Row so that `found_at` is the current time and `found_on` is the current Walt Disney World calendar date from `wdwClock`, and SHALL return a `MickeyProgressDTO`.
2. IF the User already has a Find on that Hidden_Mickey, THEN THE Hunt_Service SHALL leave `found_at` and `found_on` unchanged and return the existing Progress_Row. IF the existing `trip_id` is null and a valid `tripId` is supplied, THEN THE Hunt_Service SHALL set `trip_id`.
3. IF `tripId` is supplied and the User is not a Trip_Member of that Trip, THEN THE Hunt_Service SHALL reject the request with the same `trip_forbidden` response used by every other Trip-member-gated endpoint, creating or changing nothing.
4. WHEN a Find is created, THE Hunt_Service SHALL also record a Still_There_Vote of `there` for that User and Hidden_Mickey, replacing any earlier vote.
5. WHEN a User requests `DELETE /me/mickeys/:id/find`, THE Hunt_Service SHALL clear `found_at`, `found_on` and `trip_id` together in one statement (the database rejects a row that has a `trip_id` and no `found_at`), and SHALL delete the User's Still_There_Vote for that Hidden_Mickey. IF the User has no Find, THEN THE Hunt_Service SHALL return success without changing anything.
6. THE Hunt_Service SHALL keep the User's `hint_level` when a Find is undone.
7. IF `:id` does not reference an approved Hidden_Mickey, THEN THE Hunt_Service SHALL reject the request with HTTP 404 and error code `mickey_not_found`.

### Requirement 5: "Still There?" Votes, Confidence and Community Verified

**User Story:** As a User, I want to say whether a Hidden Mickey is still there, so that removed ones stop frustrating hunters and trusted Community entries stand out.

#### Acceptance Criteria

1. WHEN a User requests `PUT /me/mickeys/:id/vote` with `{ vote: 'there' | 'gone' }`, THE Hunt_Service SHALL store at most one Still_There_Vote per `(User, Hidden_Mickey)`, replacing any earlier vote and refreshing `voted_at`.
2. THE Hunt_Service SHALL compute Confidence at read time as the weighted mean `(P·p + Σ wᵢ·vᵢ) / (P + Σ wᵢ)` where `p` is `MICKEYS_CONFIDENCE_PRIOR_VALUE` (default 0.9), `P` is `MICKEYS_CONFIDENCE_PRIOR_WEIGHT` (default 3), `vᵢ` is 1 for `there` and 0 for `gone`, and `wᵢ = 0.5^(ageDays / MICKEYS_CONFIDENCE_HALF_LIFE_DAYS)` with a half-life of 90 days.
3. THE Hunt_Service SHALL derive Confidence_Label as `confirmed` when Confidence is at least `MICKEYS_CONFIDENCE_CONFIRMED_MIN` (default 0.65), `uncertain` when it is at least `MICKEYS_CONFIDENCE_UNCERTAIN_MIN` (default 0.4) and below the confirmed minimum, and `possibly_removed` otherwise.
4. THE Hunt_Service SHALL use the Confidence_Label only as a display projection (a badge and the Operator's `possibly_removed` list). It SHALL NOT use the label in any count (Requirement 2.6), and SHALL NOT feed a rounded value back into the Confidence computation.
5. THE Hunt_Service SHALL set `communityVerified` to true exactly when the Hidden_Mickey is Community, its Confidence_Label is not `possibly_removed`, and the number of distinct Users other than its submitter with a `there` vote is at least `MICKEYS_COMMUNITY_VERIFIED_MIN` (default 3). It SHALL be false for every Official Hidden_Mickey.
6. THE Hunt_Service SHALL NOT change a Hidden_Mickey's Status because of votes. Only a Report threshold (Requirement 7) or the Operator changes Status.
7. IF `:id` does not reference an approved Hidden_Mickey, THEN THE Hunt_Service SHALL reject the request with HTTP 404 and error code `mickey_not_found`.

### Requirement 6: Community Submissions

**User Story:** As a User, I want to add a Hidden Mickey I know about and see it live right away, so that the list grows beyond what the owner curated.

#### Acceptance Criteria

1. WHEN a User requests `POST /me/mickeys/submissions` with `{ experienceId, zone, difficulty, clue1, clue2, reveal }`, THE Submission_Service SHALL validate the body against Requirement 1.1 and 1.7, require that `experienceId` references an existing Experience (its `active` flag is not consulted, Requirement 16.4), and create one Hidden_Mickey with Source `user`, Official false and `submitter_id` set to the User. WHEN `experienceId` is an Alias_Experience, THE Submission_Service SHALL store the Hidden_Mickey on its Canonical_Experience (Requirement 16.3).
2. THE Submission_Service SHALL reject a Submission whose Clue_1, Clue_2 or Reveal contains a URL or an email address, with `mickey_text_rejected` (HTTP 400), creating nothing.
3. WHEN `MICKEYS_TEXT_SCREEN_ENABLED` is true, THE Submission_Service SHALL run the three text fields through the text harm check (External Interfaces). IF the check flags the text, THEN THE Submission_Service SHALL reject the Submission with `mickey_text_rejected`, creating nothing and storing none of the flagged text.
4. IF the text check fails with a retryable outcome, THEN THE Submission_Service SHALL create the Hidden_Mickey with Status `pending` and `text_screen = 'unscreened'`, so the Operator reviews it before anyone sees it.
5. WHEN `MICKEYS_SUBMISSION_MODE` is `publish` and the text check passed, THE Submission_Service SHALL create the Hidden_Mickey with Status `approved`. WHEN it is `review`, THE Submission_Service SHALL create it with Status `pending`.
6. WHEN a Submission is created, THE Submission_Service SHALL also create the submitter's Progress_Row with a Find and a `there` vote, so the submitter is credited at once. The submitter's own `there` vote SHALL NOT count toward Community_Verified.
7. THE Submission_Service SHALL reject a Submission with `mickey_submission_limit` (HTTP 429) when the User has already created `MICKEYS_SUBMISSIONS_PER_DAY` (default 5) Submissions in the trailing 24 hours.
8. IF the User is banned from submitting (Requirement 8.6), THEN THE Submission_Service SHALL reject the request with `mickey_submissions_banned` (HTTP 403).
9. THE App SHALL show the submitter, before submit, the approved Hidden_Mickeys already listed for the chosen Experience (Clue_1 labels from `GET /mickeys?experienceId=`), to reduce duplicates.
10. THE App SHALL display, on the submission form, the rule that a Hidden Mickey may be submitted only if it is visible from areas open to guests, that backstage or restricted locations are never accepted, and that links and email addresses are not allowed.
11. WHEN `MICKEYS_SUBMISSIONS_ENABLED` is false, THE Submission_Service SHALL reject submissions with `mickey_feature_disabled`.

### Requirement 7: Reports and Soft-Hide

**User Story:** As a User, I want to report a Hidden Mickey that is wrong or inappropriate, and not see it again myself.

#### Acceptance Criteria

1. WHEN a User requests `POST /mickeys/:id/report` with `{ reason, note? }`, where `reason` is `inappropriate`, `not_a_mickey`, `restricted_area`, `spam` or `other` and `note` is at most 300 characters, THE Report_Service SHALL store at most one Report per `(User, Hidden_Mickey)`, and a repeat request SHALL succeed without changing the stored Report.
2. WHEN a Report is stored, THE Hunt_Service SHALL hide that Hidden_Mickey from that User's list immediately, and from that User's Community counts as Requirement 2.4 states, whatever its Status afterwards. This applies to Official and Community Hidden_Mickeys alike.
3. THE Report_Service SHALL reject a Report on a Hidden_Mickey the User submitted, with `validation_failed`.
4. WHEN the number of distinct Users with a Counted_Report on an `approved` **Community** Hidden_Mickey reaches `MICKEYS_REPORT_AUTOHIDE` (default 3), THE Report_Service SHALL set its Status to `hidden` with `hidden_reason = 'reports'`. A Report from a User with no Find on any Hidden_Mickey SHALL be stored but SHALL NOT count toward the threshold. THE Report_Service SHALL NEVER change the Status of an Official Hidden_Mickey, whatever the number of Reports: a Report on an Official Hidden_Mickey hides it only for the reporter (criterion 2) and appears in the Operator console (Requirement 8.1), so only the Operator can retire or hide it and change an Official total.
5. THE Report_Service SHALL NOT delete a Hidden_Mickey, its Progress_Rows or its votes when hiding it. A hidden Hidden_Mickey can be restored by the Operator.
6. WHEN the Operator restores a `hidden` Hidden_Mickey, THE Report_Service SHALL mark its open Reports `dismissed`, so those Reports do not count again. WHEN the Operator retires it, THE Report_Service SHALL mark them `upheld`.
7. IF `:id` does not reference an approved Hidden_Mickey, THEN THE Report_Service SHALL reject the request with HTTP 404 and error code `mickey_not_found`.

### Requirement 8: Operator Console

**User Story:** As an Operator, I want to review what needs attention and promote, restore, retire or ban, without approving every submission.

#### Acceptance Criteria

1. THE admin console SHALL provide `GET /admin/mickeys` listing, in separate sections: Hidden_Mickeys with Status `pending` (oldest first, with Source, the text screen marker and the Experience); Hidden_Mickeys with Status `hidden` or with open Reports, Official ones first because only the Operator can act on them (with the Report counts, counted and uncounted, and reasons); Community Hidden_Mickeys that are Community_Verified ("ready to promote"); and approved Hidden_Mickeys whose Confidence_Label is `possibly_removed`.
2. THE admin console SHALL provide a page per Hidden_Mickey showing all text layers, Source, Official flag, submitter display name, the existing approved Hidden_Mickeys for the same Experience (duplicate check) and its Reports.
3. THE admin console SHALL provide mutating actions: approve, reject with a review note of up to 300 characters, edit the text layers, Zone and Difficulty, retire, restore, promote, and dismiss Reports. Each Status change SHALL follow Requirement 1.3.
4. WHEN the Operator promotes a Hidden_Mickey, THE Admin_Service SHALL require that it is `approved` and Community, SHALL set Official true and `promoted_at`, and SHALL change nothing else. Promotion is the only action that adds a Hidden_Mickey to the Official totals of existing Users. Votes, Confidence_Labels, Reports and the Experience's `active` flag never change an Official total; only an Operator action does (promotion, and retiring, hiding or restoring an Official Hidden_Mickey).
5. THE admin console SHALL show, on the promote action, the effect: which park total it will increase by one.
6. WHEN the Operator bans a submitter, THE Admin_Service SHALL insert a `mickey_submission_bans` row and set every `approved` Community Hidden_Mickey of that submitter to `hidden` with `hidden_reason = 'operator'`. WHEN the Operator lifts a ban, THE Admin_Service SHALL delete the row and SHALL NOT restore any Hidden_Mickey automatically.
7. THE admin console SHALL be reachable only through the existing basic-auth gate and, for mutations, the existing same-origin check, and SHALL set `X-Robots-Tag: noindex, nofollow` and `Cache-Control: private, no-store` on every Hidden_Mickey page, as the photo review pages do.
8. THE admin console SHALL state the review guideline that a Hidden Mickey is never accepted for a location closed to guests.
9. THE `GET /admin/mickeys` page SHALL also list, in a separate section, approved Hidden_Mickeys whose whole Experience_Group has no Experience with `active = true`, with the Experience name, as a prompt for the Operator to retire an entry whose ride has really closed. THE list SHALL be read-only: the Hunt_Service SHALL NOT retire, hide or change any Hidden_Mickey because of an Experience's `active` flag.
10. THE `GET /admin/mickeys` page SHALL also list, in a separate section, recently approved Community Hidden_Mickeys (most recent first, up to 25 entries), with their Clue 1, Experience name, Zone, Difficulty, submitter display name, and creation timestamp, linking to the detail view so Operators can inspect, edit, or retire them.

### Requirement 9: Submitter View

**User Story:** As a submitter, I want to see my submissions and what happened to them.

#### Acceptance Criteria

1. WHEN a User requests `GET /me/mickeys/submissions`, THE Submission_Service SHALL return that User's own Submissions in any Status, newest first, with `id`, Status, `official`, Clue_1, the Experience name, the review note when one exists, and `communityVerified`.
2. THE App SHALL provide a "My Submissions" screen showing that list, reachable from the Hidden Mickeys screen.
3. IF the submitter's account is later deleted, THEN THE Hunt_Service SHALL keep the Hidden_Mickey with `submitter_id` null.

### Requirement 10: Friends

**User Story:** As a User, I want to see how my Friends are doing on the hunt.

#### Acceptance Criteria

1. WHEN a User requests `GET /mickeys/summary?for=<userId>`, THE Hunt_Service SHALL apply the existing owner-or-friend rule (`assertOwnerOrFriend`) and return that User's summary under the same counting rules as Requirement 2, including `community.found`.
2. WHEN a User requests `GET /users/:userId/mickeys/finds`, THE Hunt_Service SHALL apply the same rule and return that User's Finds on approved Hidden_Mickeys as `{ mickeyId, clue1, official, experienceId, experienceName, park, foundOn }`, newest first, with `cursor` pagination.
3. THE Hunt_Service SHALL NOT return Clue_2 or Reveal in a Friend's finds. IF the requester is neither the target nor a Friend, THEN THE Hunt_Service SHALL reject with `profile_forbidden`.
4. THE App SHALL show a Friend's hunt progress on the existing Friend profile screen.
5. THE Hunt_Service SHALL NOT notify a User when a Friend finds a Hidden_Mickey.

### Requirement 11: Trip Tally

**User Story:** As a member of a Trip, I want to see how many Hidden Mickeys the crew has found on this Trip.

#### Acceptance Criteria

1. WHEN a Trip_Member requests `GET /trips/:id/mickeys`, THE Hunt_Service SHALL return, for each current Trip_Member, `{ userId, displayName, avatarPreset, count }`, where `count` is the number of distinct approved Hidden_Mickeys (Official and Community) that Member found with `trip_id` equal to that Trip, plus the list of distinct such Hidden_Mickeys as `{ mickeyId, clue1, official, experienceName, foundByCount }`.
2. IF the requester is not a current Trip_Member (including a non-existent Trip), THEN THE Hunt_Service SHALL reject with the same `trip_forbidden` response in both cases.
3. THE Hunt_Service SHALL compute the tally at read time and SHALL NOT persist it.
4. THE tally list SHALL NOT contain Clue_2 or Reveal.
5. THE App SHALL show the tally in a "Hidden Mickeys" section on `TripDetailScreen`, with an empty state when nothing was found, and SHALL default the trip chip on the find action to the Trip that contains today's date when the User is a member of exactly one such Trip (the same rule as the log sheet).

### Requirement 12: Seed Import

**User Story:** As the owner, I want to load a reviewed list of Hidden Mickeys in bulk, safely and repeatably.

#### Acceptance Criteria

1. THE import script `apps/api/src/scripts/importHiddenMickeys.ts` SHALL read a Seed_File: a JSON array of `{ seedKey, upstreamEntityId?, experienceName?, park?, zone, difficulty, clue1, clue2, reveal, photoUrl? }`, where `photoUrl`, when present, is a string of at most 2048 characters. Any other field outside this list SHALL make the entry invalid (Requirement 12.3), so a misspelled field name is reported and not silently dropped.
2. THE script SHALL resolve each entry's Experience by exact `upstreamEntityId` match against `experiences.upstream_entity_id` when given, otherwise by exact `experienceName` and `park` match, where an entry with `park` null or omitted matches only Experiences whose `park` is null (resort-area Experiences), compared with `IS NOT DISTINCT FROM`. IF zero or more than one Experience matches, THEN THE script SHALL skip that entry and report it as unresolved.
3. THE script SHALL validate every entry against Requirement 1.1 and 1.7, reporting and skipping invalid ones.
4. THE script SHALL insert resolved entries with Source `seed`, Official true and Status `pending`. WHEN run with `--approve`, it SHALL insert them as `approved`.
5. THE script SHALL be idempotent. An entry whose `seedKey` already exists SHALL be skipped without changing the existing row. THE script SHALL dedupe entries by `seedKey` within one file before issuing any `INSERT ... ON CONFLICT`.
6. THE script SHALL print a report: inserted, skipped as existing, unresolved, invalid, and duplicates within the file. A `--dry-run` option SHALL print the report without writing.
7. THE seed content SHALL be original wording. THE repository SHALL NOT contain text copied from published Hidden Mickey guidebooks, catalogs or fan sites.
8. THE import script SHALL accept an optional `--aliases <file>` argument naming an Alias_File: a JSON array of `{ aliasUpstreamEntityId, canonicalUpstreamEntityId }`. For each entry THE script SHALL resolve both Experiences by exact `upstream_entity_id`; skip and report as unresolved an entry where either resolves to zero or several rows; skip and report as invalid an entry whose two ids are equal, whose alias is already a Canonical_Experience, or whose canonical is already an Alias_Experience (including within the same file); and insert the rest with `ON CONFLICT (alias_experience_id) DO NOTHING`, so a second run changes nothing and an existing link is never repointed. `--dry-run` SHALL apply to aliases as it does to entries.
9. THE script SHALL store a seed entry on the Experience it resolves to, without redirecting an Alias_Experience to its canonical, so an entry that exists only in a seasonal variant can be seeded on that variant (Requirement 16.2 shows it for the whole group).
10. THE `photoUrl` field is reference data kept in the Seed_File for the owner's later use. THE script SHALL accept it and SHALL NOT validate it as a URL, request it, store it, or pass it to any insert or response: it SHALL NOT appear in the parsed entry, in any `hidden_mickeys` column, or in any DTO. An entry with a `photoUrl` and the same entry without one SHALL import identically. THE feature SHALL NOT fetch, hotlink, cache, display or serve any image from a `photoUrl` (photos remain deferred, see "Explicitly deferred").

### Requirement 13: Mobile Surfaces

**User Story:** As a User, I want the hunt to be one tap away from where I already am.

#### Acceptance Criteria

1. THE App SHALL add root-stack screens `HiddenMickeys` (progress and the hunt list), `HiddenMickeyDetail`, `SubmitMickey` and `MySubmissions`, registered the way `ExperienceDetail` is, so every entry point can open them above the tabs.
2. WHEN the App renders `ExperienceDetailScreen` for an Experience whose Experience_Group has at least one approved Hidden_Mickey (Requirement 16.2), so a seasonal variant shows its base ride's Hidden_Mickeys, THE App SHALL show a card "N Hidden Mickeys here · you've found M" opening `HiddenMickeys` filtered to that Experience. WHERE the Experience has none, THE App SHALL show a quiet "Know one? Add it" link to `SubmitMickey` instead. Resort tiles open `ExperienceDetail` for the resort's representing Experience, so this also covers resorts.
3. THE Explore hub SHALL provide a "Hidden Mickeys" entry, and THE Vault (Collection) home SHALL provide a progress card showing the overall Official `found / total` and the Community found count, both opening `HiddenMickeys`.
4. THE `HiddenMickeys` screen SHALL provide park and Resorts tabs (the Resorts tab uses `areaType=Resort`), an Official and Community switch (`scope`), a search field (`q`), a Found filter (`found`) and a Zone filter of pills (`zone`: Queue, Pre-show, On ride, Exit, Exterior, Interior, Grounds, plus an "All" pill that sends no `zone`), all sent to the server (Requirement 2.2).
5. THE `HiddenMickeyDetail` screen SHALL show Clue_1 with Zone and Difficulty, a "Need a hint?" control that requests Hint_Level 2, then a separate "Show me" control that requests Hint_Level 3, an "I found it" control with undo and a trip chip, a "Still there?" control with Yes and "Couldn't find it", the Confidence_Label, the Friends-found count, a "Community" badge for Community entries and a "Community verified" badge when `communityVerified`, and a "Report" control with the reasons in Requirement 7.1.
6. THE App SHALL convey Difficulty, Confidence_Label and the Community badges with text or icons as well as colour, and SHALL give every control an accessibility label.
7. THE App SHALL style every new screen with the active theme (`makeStyles`, `useAppTheme`, `*.palette.ts`) so it repaints on a scheme switch, with no raw colour literals.
8. WHEN a find, hint, vote, report or submit mutation fails, THE App SHALL revert any optimistic state and show a brief non-blocking error, consistent with the App's existing optimistic-mutation pattern.
9. WHEN `MICKEYS_ENABLED` is false server-side, THE App SHALL hide the entry points (the client config read in Requirement 14.3).
10. THE `HiddenMickeys` screen SHALL display a visual progress bar and completion percentage in the summary card, SHALL resolve the `Resorts` tab summary from the `byPark` entry whose `park` is `null`, and SHALL provide a layout switcher between individual cards (`All Mickeys`) and venue-grouped cards (`By Venue`) where each venue group renders one venue header (`N Hidden Mickeys`, `found/total Spotted`) and labels each distinct entry inside that venue as `Mickey k of N`.
11. THE `HiddenMickeys` screen SHALL provide on each list item a one-tap Spot/Undo control (`POST /me/mickeys/:id/find` when unfound, `DELETE /me/mickeys/:id/find` when found) and an inline "Need a closer hint?" control that requests Hint_Level 2 (`POST /me/mickeys/:id/hint` with `{ level: 2 }`) and reveals `Clue_2` inline without exposing `Reveal`.
12. THE `HiddenMickeyDetail` screen SHALL render a "View Venue" action on the venue header that navigates to `ExperienceDetail` for `mickey.experienceId`, and SHALL present `Clue_1` (Step 1), `Clue_2` (Step 2) and `Reveal` (Step 3) within a connected 3-step progressive hint trail with a step-progress badge.

### Requirement 14: Configuration, Kill Switches and Hosting Limits

**User Story:** As the owner, I want to turn parts of this feature off quickly and keep it inside the free-tier limits.

#### Acceptance Criteria

1. THE API SHALL read the environment variables listed in design.md "Configuration & Constants", with the defaults stated there, and SHALL validate them at startup.
2. THE API SHALL fail startup when `MICKEYS_SUBMISSIONS_ENABLED` is true, `MICKEYS_SUBMISSION_MODE` is `publish` and the text check cannot run (`MICKEYS_TEXT_SCREEN_ENABLED` false or `PHOTO_HARM_API_KEY` missing), so unscreened text can never publish.
3. THE API SHALL expose `GET /mickeys/config` returning `{ enabled, submissionsEnabled }` for the client.
4. THE feature SHALL add no background worker, no polling, no scheduled job and no Redis use. The only outside call is the text check, made inside a User's submit request.
5. THE feature's stored data SHALL be bounded: at most one Progress_Row, Still_There_Vote and Report per `(User, Hidden_Mickey)`, and one row per banned User.
6. THE hunt list, hints, finds, votes, Friends and Trip tally SHALL work with every outside service unconfigured.

### Requirement 15: Privacy, Safety and Account Deletion

**User Story:** As a User, I want my data handled carefully, and I want the content to stay safe for a family audience.

#### Acceptance Criteria

1. WHEN a User account is deleted, THE system SHALL delete that User's Progress_Rows, Still_There_Votes, Reports and submission ban, and SHALL set `hidden_mickeys.submitter_id` to null, using the dispositions registry of `account-deletion`.
2. THE `account-deletion` dispositions registry SHALL contain an entry for every new column that references `users(id)`, so its schema-completeness property continues to hold.
3. THE Hunt_Service SHALL NOT log Clue_2, Reveal, report notes or review notes at info level or above.
4. THE feature SHALL provide the controls Apple's user-generated-content guideline expects: an automatic text filter on submission, a Report control on every Hidden_Mickey, and an Operator ban of abusive submitters. THE Operator console SHALL list open Reports so each can be acted on promptly.
5. THE App's submission form and the admin console SHALL state that Hidden_Mickeys are never accepted for locations closed to guests.

### Requirement 16: Seasonal Variants (Aliases) and Catalog Independence

**User Story:** As a User, I want the same Hidden Mickeys whether I open a ride or its holiday variant, and I want them to stay listed when the catalog changes which version it shows.

#### Acceptance Criteria

1. THE database SHALL store Alias_Experience links in `mickey_experience_aliases` with `alias_experience_id` as the primary key, a `canonical_experience_id`, and a `CHECK` that the two differ, both referencing `experiences(id)` with `ON DELETE CASCADE`. THE Hunt_Service SHALL treat links as one hop only: it SHALL NOT follow a link from a Canonical_Experience, and the import script (Requirement 12.8) SHALL refuse to create a chain.
2. WHEN a request filters `GET /mickeys` by `experienceId`, or the App asks for the Hidden_Mickeys of an Experience (the Experience Detail card, the duplicate list of Requirement 6.9), THE Hunt_Service SHALL match every Hidden_Mickey whose `experience_id` is any member of that Experience's Experience_Group, so opening the Alias_Experience and opening the Canonical_Experience return the same Hidden_Mickeys. THE items SHALL keep the Experience name and park of the Experience each is stored on.
3. WHEN a Submission names an Alias_Experience, THE Submission_Service SHALL store the Hidden_Mickey with `experience_id` set to the Canonical_Experience, so the entry does not disappear when the variant leaves the catalog.
4. THE Hunt_Service SHALL decide whether a Hidden_Mickey is shown, counted or findable from its Status alone. THE Experience's `active` flag SHALL NOT hide a Hidden_Mickey, change a `total` or `found`, or block a find, hint, vote, report or Submission. A soft-deleted Experience keeps its row, so its Hidden_Mickeys still resolve their Experience name and park.
5. THE Hunt_Service SHALL count each Hidden_Mickey once in the summary, under the park of the Experience it is stored on, however many Experiences are in its group, so linking an Alias_Experience changes no User's `total` or `found`.
6. THE links SHALL be created only by the import script (Requirement 12.8) run by the Operator. THE feature SHALL NOT expose a User route that creates, changes or deletes a link.
7. THE feature SHALL leave every other feature (ride logging, favorites, planning, wait history, pins, ratings) unchanged: a link says only that two Experiences share their Hidden_Mickeys, and no other part of the App reads `mickey_experience_aliases`.

## Cross-Spec Dependencies and Build Order

- **`admin-panel`** (Requirement 8): adds `/admin/mickeys` beside `/admin/photos`, reusing basic auth, `renderPage` and the same-origin check.
- **`trips`** (Requirements 4, 11): `assertTripMember`, `trip_forbidden`, `TripMemberDTO`'s `displayName` and `avatarPreset`.
- **`friends`** (Requirement 10): `assertOwnerOrFriend`, the `active_friendships` view.
- **`unified-experience-logging`** (Requirement 11.5): the trip chip default rule is copied from `LogExperienceSheet`, not shared code.
- **`account-deletion`** (Requirement 15): the dispositions registry and its schema-completeness test.
- **Catalog (`catalog` sync)** (Requirements 8.9, 12.8, 16): reads `experiences.upstream_entity_id` to register links and `experiences.active` only for the Operator's read-only review list. The sync is not changed and does not read `mickey_experience_aliases`.
- **`photo-uploads`**: no dependency and no change. Its harm moderation endpoint is reused only through a text adapter (External Interfaces); no photo table, constraint or route is touched.
- **`pin-collection`**: no dependency. Round 2 pins may later read `mickey_progress`.
- **Order:** 1. migration, shared contracts and config, 2. pure domain modules, 3. repo and hunt routes, 4. friends and Trip reads, 5. submissions, 6. reports, 7. Operator console, 8. seed import, 9. account deletion, 10. mobile, 11. final gate.
