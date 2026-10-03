# Requirements Document

## Introduction

The Disney World Tracker backend (`apps/api`) has accumulated a wide surface of operationally
important state that is currently visible only through `psql`, `redis-cli`, log scraping, or
re-running CLI scripts by hand: Disney catalog sync outcomes, the Disney egress rate-limiter's
live budget usage, the ThemeParks.wiki entity directory's cache state, the intelligence/
prediction system's forecast accuracy and model internals, the sampling cron's pass-by-pass
health, login lockouts, push notification delivery outcomes, Neon/Upstash free-tier budget
consumption, and basic growth counts. None of this is surfaced anywhere a human can look at it
without SSHing in or writing ad hoc SQL.

This feature adds an **Admin_Panel**: a server-rendered, HTTP-Basic-authenticated set of pages
and actions inside the existing `apps/api` Fastify process, under the `/admin` path prefix. It
is an internal operator tool, not a user-facing feature — there is exactly one operator (the
maintainer) and no multi-tenant admin concept is introduced. The panel is entirely **read-only
visibility** except for a small, explicitly enumerated set of **trigger actions** (manual catalog
sync, manual Pin reconciliation, account unlock, forecast recompute-and-diff) that reuse
existing service entry points rather than introducing new business logic.

Per the repo's hosting constraints (`docs/hosting.md`), the Admin_Panel introduces no new hosted
service, no new always-on process, and no new scheduled background work: it rides along inside
the existing Render web service and only does work in response to an operator's browser request.

## Glossary

- **Admin_Panel**: The server-rendered set of routes under `/admin` introduced by this feature,
  authenticated by HTTP Basic Auth against a single operator credential pair.
- **Operator**: The single trusted individual (the maintainer) who authenticates to the
  Admin_Panel. The Admin_Panel has no concept of multiple distinct admin identities, roles, or
  permissions in v1.
- **Admin_Credentials**: The HTTP Basic username/password pair, read from
  `ADMIN_PANEL_USERNAME` / `ADMIN_PANEL_PASSWORD`, that gates every `/admin` route.
- **Admin_Section**: One top-level page of the Admin_Panel (e.g. "Catalog & Sync",
  "Intelligence & Predictions"). Each Admin_Section is independently listed in this document as
  its own Requirement.
- **Trigger_Action**: A `POST` endpoint under `/admin` that performs a side-effecting operation
  (e.g. "run a sync now") by invoking an existing service function; distinguished from the
  read-only `GET` pages that make up the rest of the Admin_Panel.
- **Catalog_Sync**, **Sync_Run_History**, **Disney_Transport**, **Rate_Limiter**,
  **Request_Budget**, **WAF_Block**, **Auth_Failure**: As defined in the
  `disney-source-resilience` spec; the Admin_Panel surfaces their existing state and outcomes
  without changing their behavior.
- **ThemeParks_Directory**: The existing cached `Enterprise_Id → ThemeParks entity id` map
  (`themeParksDirectory.ts`) built from ThemeParks.wiki and refreshed on a 12-hour TTL.
- **Sampling_Pass**: One execution of `SamplingService.runSamplingPass()`, which polls
  ThemeParks.wiki live/schedule data on a roughly 10-minute cadence (driven by the existing
  external keep-alive cron hitting `POST/HEAD /internal/sampling/run`) and updates the
  intelligence model's rolling state.
- **Sampling_Run_History**: A new persisted record of each Sampling_Pass's outcome, introduced
  by this feature (mirroring the existing `catalog_sync_runs` pattern) because no such record
  exists today — pass outcomes are currently visible only in process logs.
- **Forecast_Accuracy**: The existing recency-weighted mean-absolute-error (MAE) and bias
  tracked per Experience/lead-days bucket (`wait_forecast_accuracies`) and per park/lead-days
  bucket (`forecast_accuracies`), including the shadow Challenger_Model's parallel MAE/bias
  where tracked.
- **Challenger_Model**: The existing shadow wait-time model whose predictions
  (`challenger_wait_minutes`, `challenger_error`) are computed and logged alongside the live
  model's but never served to the App.
- **Derived_Stat_Run**: The existing per-"leg" record (`derived_stat_runs`) of the last successful
  and last failed run of a specific derived-statistics computation (weather sensitivity, ride
  cascades, showtime patterns, etc.), including `consecutive_failures`.
- **Ride_Baseline**: The existing slow-moving (~500-sample memory) expected wait
  (`ride_shapes.baseline_wait_minutes`) that denominates the Crowd_Index for a given
  Experience/day-of-week/hour bucket; `null` until established.
- **Push_Delivery_Log**: A new persisted record of each Expo push send attempt's outcome
  (`ok` / `device_unregistered` / `error`), introduced by this feature because no such record
  exists today — the Notification_Service already classifies every delivery internally but
  only ever logs it.
- **Account_Lockout**: The existing Redis-backed login lockout state (`lockout:{userId}`,
  `locked:{userId}`) described in `auth/lockout.ts`.
- **Database_Size_Snapshot** / **Redis_Command_Budget**: Point-in-time measurements of
  PostgreSQL storage consumption and Upstash Redis daily command usage, read live at request
  time (no new persisted history).
- **Data_Quality_Check**: One named, read-only aggregate query over the catalog or intelligence
  tables that counts rows matching a specific incompleteness or inconsistency condition (e.g.
  active Experiences with no `image_url`).

## Requirements

### Requirement 1: Admin_Panel Authentication

**User Story:** As the Operator, I want every admin page and action gated by a single credential
pair, so that the operational data and trigger actions in the panel are not reachable by anyone
else.

#### Acceptance Criteria

1. WHEN a request targets any path under `/admin`, THE Admin_Panel SHALL require HTTP Basic
   Authentication before executing the route handler or rendering any page content.
2. IF a request to a path under `/admin` carries no `Authorization` header, or an
   `Authorization` header whose scheme is not `Basic`, THEN THE Admin_Panel SHALL respond
   `401` with a `WWW-Authenticate: Basic` header and SHALL NOT execute the route handler.
3. IF a request's decoded Basic Auth username and password do not both exactly match
   `ADMIN_PANEL_USERNAME` and `ADMIN_PANEL_PASSWORD` respectively, THEN THE Admin_Panel SHALL
   respond `401` with a `WWW-Authenticate: Basic` header and SHALL NOT execute the route handler,
   using the same response as Criterion 2 so a wrong-credential attempt and a missing-credential
   request are indistinguishable.
4. THE Admin_Panel SHALL compare the supplied password to `ADMIN_PANEL_PASSWORD` using a
   constant-time comparison so response timing does not reveal how many leading characters
   matched.
5. WHEN `ADMIN_PANEL_USERNAME` or `ADMIN_PANEL_PASSWORD` is missing or empty at startup, THE API
   SHALL fail to start with a configuration error naming the missing variable, consistent with
   every other required secret in `config.ts`.
6. THE Admin_Panel SHALL NOT consult the `sessions` table, the mobile app's session token
   scheme, or any Trip/User role for its own authentication; Admin_Panel access is governed
   solely by Admin_Credentials.
7. THE Admin_Panel's authentication gate SHALL apply uniformly to every `/admin` route, including
   Trigger_Action `POST` routes, so no admin route is reachable without the credential.

### Requirement 2: Admin_Panel Shell and Navigation

**User Story:** As the Operator, I want a single entry point that links to every Admin_Section,
so that I can navigate the panel without memorizing URLs.

#### Acceptance Criteria

1. WHEN an authenticated request targets `GET /admin`, THE Admin_Panel SHALL render an HTML page
   listing a navigation link to every Admin_Section defined by Requirements 3 through 12.
2. THE Admin_Panel SHALL render every page as server-generated HTML with no client-side build
   step, consistent with this feature introducing no new frontend application or JavaScript
   framework dependency.
3. WHEN any Admin_Panel page encounters an unhandled error while rendering, THE Admin_Panel SHALL
   render a generic error page identifying which Admin_Section failed, without leaking a raw
   stack trace or database error detail into the HTML response.
4. THE Admin_Panel SHALL set the HTTP response header `X-Robots-Tag: noindex, nofollow` on every
   `/admin` response so no admin page is ever indexed by a search crawler.

### Requirement 3: Catalog & Disney Sync Visibility

**User Story:** As the Operator, I want to see the catalog's sync history and current cache
staleness, so that I know whether Disney data is current without querying Postgres directly.

#### Acceptance Criteria

1. WHEN an authenticated request targets `GET /admin/catalog`, THE Admin_Panel SHALL display the
   catalog's current cache age (via the existing `CatalogRepo.getCacheAge`) and the 20 most
   recent `catalog_sync_runs` rows ordered by `started_at` descending, including each run's
   `status`, `outcome`, `started_at`, `completed_at`, `error_message`, and `entities_processed`.
2. WHEN the 20 most recent sync runs include at least one `waf_block` or `auth_failure` outcome,
   THE Admin_Panel SHALL visually distinguish that run from a `success` run on the same page.
3. THE Admin_Panel SHALL display the active `AppConfig` values governing Disney sync behavior
   (`CATALOG_SYNC_INTERVAL_MS`, `MENU_FRESHNESS_MS`, the `Request_Budget`, and the
   `Backoff_Policy` parameters) as currently resolved, without exposing the Disney credential
   values themselves.
4. THE Admin_Panel SHALL display the Data_Quality_Check counts: active Experiences with
   `image_url IS NULL`, active Experiences with `latitude IS NULL OR longitude IS NULL`, and
   active Experiences whose `Enterprise_Id` the ThemeParks_Directory cannot resolve to a live
   entity id.
5. WHEN an authenticated request submits `POST /admin/catalog/sync`, THE Admin_Panel SHALL
   invoke the existing `runSync` orchestration exactly as `npm run sync` does, respond
   immediately without waiting for the sync to complete, and the subsequent `catalog_sync_runs`
   history SHALL reflect the triggered run once it starts.
6. IF a `Catalog_Sync` is already in progress (the existing Redis NX coordination lock is held)
   when `POST /admin/catalog/sync` is submitted, THEN THE Admin_Panel SHALL inform the Operator
   that a sync is already running and SHALL NOT start a second concurrent sync.

### Requirement 4: Disney Transport & Rate-Limiter Visibility

**User Story:** As the Operator, I want to see how close the Disney egress is to its rate/
concurrency budget and the ThemeParks_Directory's cache state, so that I can tell whether a
sync problem is Disney-side throttling versus something else.

#### Acceptance Criteria

1. WHEN an authenticated request targets `GET /admin/disney-transport`, THE Admin_Panel SHALL
   display, for each `DisneyTarget` bucket (`sync_gateway`, `web`), the current in-window
   dispatch count against `DISNEY_MAX_RPS` and the current held-concurrency count against
   `DISNEY_MAX_CONCURRENCY`, read live from the Redis-backed Rate_Limiter's counters.
2. THE Admin_Panel SHALL display the ThemeParks_Directory's cache state: whether a map is
   currently built, the number of resolved `Enterprise_Id` entries, and the age of the cached
   map relative to its 12-hour TTL.
3. IF the Redis-backed rate-limiter counters are unreachable (a Redis error), THEN THE
   Admin_Panel SHALL render the page with an explicit "unavailable" indicator for the affected
   section rather than failing the whole page.

### Requirement 5: Intelligence & Crowd-Prediction Accuracy Visibility

**User Story:** As the Operator, I want to see how accurate the crowd/wait predictions actually
are, broken down by park and by lead time, so that I can tell whether the model is working
before a user complains.

#### Acceptance Criteria

1. WHEN an authenticated request targets `GET /admin/intelligence/accuracy`, THE Admin_Panel
   SHALL display the park-level `forecast_accuracies` rows (`park`, `lead_days`, `mae`, `bias`,
   `sample_count`) for every tracked park/lead-days combination.
2. THE Admin_Panel SHALL display the Experience-level `wait_forecast_accuracies` rows
   (`experience_id`, `lead_days`, `mae`, `bias`, `sample_count`), joined to the Experience's
   name, for at least the 50 Experiences with the highest `sample_count`.
3. WHEN a `wait_forecast_accuracies` row carries a non-null `challenger_mae`/`challenger_bias`,
   THE Admin_Panel SHALL display the Challenger_Model's `challenger_mae`, `challenger_bias`, and
   `challenger_sample_count` alongside the live model's values for the same row.
4. WHEN an authenticated request targets `GET /admin/intelligence/accuracy/:experienceId`, THE
   Admin_Panel SHALL display that Experience's forecast-vs-observed history from
   `wait_forecast_logs` (`date`, `hour`, `lead_days`, `predicted_wait_minutes`,
   `observed_wait_minutes`, `error`), ordered most-recent-first.
5. IF an `:experienceId` path parameter does not resolve to an existing Experience, THEN THE
   Admin_Panel SHALL respond `404` with a page stating the Experience was not found.

### Requirement 6: Intelligence Model Internals Visibility

**User Story:** As the Operator, I want to see the model's internal learned state — ride
baselines, crowd index history, weather sensitivities, ride cascades, and showtime patterns —
so that I can sanity-check the model is not learning something absurd.

#### Acceptance Criteria

1. WHEN an authenticated request targets `GET /admin/intelligence/model`, THE Admin_Panel SHALL
   display, per theme park, the current day's `park_crowd_index` row including its `source`
   (`observed` or `seed`) and `sample_count`, and the trailing 14 days of `park_crowd_index`
   history for that park.
2. THE Admin_Panel SHALL display Ride_Baseline coverage: the count of Experiences with an
   established (`non-null`) `baseline_wait_minutes` versus the count still cold-starting
   (`null`), and the bucket density (number of distinct `(day_of_week, hour)` buckets with
   `sample_count > 0`) for at least the 20 Experiences with the most buckets populated.
3. THE Admin_Panel SHALL display the learned `experience_weather_sensitivities` rows
   (`experience_id` joined to name, `condition`, `wait_multiplier`, `sample_count`) for at least
   the 50 rows with the highest `sample_count`.
4. THE Admin_Panel SHALL display the learned `ride_cascades` rows (`down_experience_id` and
   `affected_experience_id` both joined to their Experience names, `wait_delta`,
   `wait_pct_delta`, `baseline_wait`, `sample_count`) for at least the 50 rows with the highest
   `sample_count`.
5. THE Admin_Panel SHALL display the learned `show_time_patterns` rows (`experience_id` joined
   to name, `day_of_week`, `start_minutes` rendered as a clock time, `frequency`,
   `sample_count`).

### Requirement 7: Sampling Pass & Derived-Stats Job Health

**User Story:** As the Operator, I want to see whether the sampling cron and the daily
derived-stats recompute are actually succeeding, so that a silent failure doesn't let the model
go stale for days before I notice.

#### Acceptance Criteria

1. THE API SHALL persist a Sampling_Run_History row at the end of every `Sampling_Pass`
   recording `started_at`, `completed_at`, `outcome` (`success` or `failed`), `error_message`
   (when `failed`), `parks_sampled_count`, `experiences_mapped_count`,
   `wait_samples_recorded_count`, and `unmapped_with_wait_count`.
2. WHEN a `Sampling_Pass` is skipped by the existing debounce/overlap guard
   (`isRunning` already true, or the minimum-interval throttle), THE API SHALL NOT persist a
   Sampling_Run_History row for the skipped invocation, so the history reflects only passes
   that actually executed.
3. WHEN an authenticated request targets `GET /admin/intelligence/sampling`, THE Admin_Panel
   SHALL display the 20 most recent Sampling_Run_History rows ordered by `started_at`
   descending, and the time elapsed since the most recent `success` row.
4. WHEN the most recent Sampling_Run_History row's `outcome` is `failed`, or no `success` row
   exists within the trailing 30 minutes, THE Admin_Panel SHALL visually flag the sampling
   health as degraded on the same page.
5. THE Admin_Panel SHALL display, from the most recent Sampling_Run_History row with a non-empty
   unmapped-entity list, the sample of unmapped ThemeParks.wiki live entities the sampling pass
   detected (name and ThemeParks.wiki id), reusing the data the existing warn-log already
   collects.
6. WHEN an authenticated request targets `GET /admin/intelligence/derived-stats`, THE
   Admin_Panel SHALL display every `derived_stat_runs` row (`leg`, `last_success_at`,
   `last_error_at`, `last_error`, `consecutive_failures`).
7. WHEN a `derived_stat_runs` row's `consecutive_failures` is greater than zero, THE Admin_Panel
   SHALL visually flag that leg as degraded on the same page.

### Requirement 8: Infrastructure Budget Visibility

**User Story:** As the Operator, I want to see how close the app is to Neon's storage cap and
Upstash's daily command cap, so that I have lead time before either hard limit is hit.

#### Acceptance Criteria

1. WHEN an authenticated request targets `GET /admin/infra`, THE Admin_Panel SHALL display the
   current total database size (via `pg_database_size`) and the 10 largest tables by size (via
   `pg_total_relation_size`), each rendered as a human-readable byte size.
2. THE Admin_Panel SHALL display the total database size as a percentage of Neon's free-tier
   0.5 GB cap.
3. THE Admin_Panel SHALL display the Upstash Redis daily command count for the current calendar
   day in UTC, read via Redis `INFO commandstats` (or an equivalent available command-count
   signal), as a percentage of the documented 10,000-commands/day free-tier cap.
4. IF the Redis command-count signal is unavailable from the connected Redis server (e.g. the
   `INFO` command subset is restricted), THEN THE Admin_Panel SHALL render the page with an
   explicit "unavailable" indicator for that section rather than failing the whole page.

### Requirement 9: Authentication & Abuse Visibility

**User Story:** As the Operator, I want to see currently locked-out accounts and be able to
unlock one, so that I can help a legitimately locked-out user without waiting 15 minutes and can
notice an unusual clustering of lockouts.

#### Acceptance Criteria

1. WHEN an authenticated request targets `GET /admin/accounts/lockouts`, THE Admin_Panel SHALL
   display every currently-locked account (every Redis key matching `locked:*`), each joined to
   the owning User's email, along with the key's remaining TTL.
2. WHEN an authenticated request submits `POST /admin/accounts/:userId/unlock`, THE Admin_Panel
   SHALL delete that User's `locked:{userId}` and `lockout:{userId}` Redis keys (mirroring the
   existing `clearOnSuccess` behavior) and SHALL confirm the unlock on the response page.
3. IF `POST /admin/accounts/:userId/unlock` targets a `userId` with no current lockout, THEN THE
   Admin_Panel SHALL respond with a page stating no lockout was found for that account, taking
   no destructive action.

### Requirement 10: Push Notification Delivery Visibility

**User Story:** As the Operator, I want to see recent push delivery outcomes, so that I can
catch an Expo-side delivery problem before users report missing notifications.

#### Acceptance Criteria

1. THE API SHALL persist a Push_Delivery_Log row for every per-token delivery outcome the
   Notification_Service's `sendWithRetry` resolves (`ok`, `device_unregistered`, or `error`),
   recording `occurred_at`, `user_id` (the recipient), `status`, and `notification_kind` (e.g.
   `share_delivered`, `friend_request_received`, `trip_invite_created`).
2. WHEN an authenticated request targets `GET /admin/notifications`, THE Admin_Panel SHALL
   display the 100 most recent Push_Delivery_Log rows ordered by `occurred_at` descending, and
   the count of each `status` value within the trailing 24 hours.
3. WHEN the trailing-24-hour `error` count exceeds the trailing-24-hour `ok` count, THE
   Admin_Panel SHALL visually flag push delivery health as degraded on the same page.
4. Persisting a Push_Delivery_Log row SHALL NOT alter `sendWithRetry`'s existing delivery, retry,
   or token-invalidation behavior; the log write is additive and best-effort — a failure to
   write a Push_Delivery_Log row SHALL NOT prevent or delay the underlying push send.

### Requirement 11: User & Support Lookup

**User Story:** As the Operator, I want to look up a user by email and see a summary of their
account, so that I can answer a support question without writing a one-off SQL query.

#### Acceptance Criteria

1. WHEN an authenticated request targets `GET /admin/users?email=<value>`, THE Admin_Panel SHALL
   look up the User whose `email` case-insensitively equals the submitted value and, when found,
   display their user id, display name, account created-at date, counts of completions, ratings,
   notes, friendships, and Trips (as creator or member), and their active session count.
2. IF no User matches the submitted email, THEN THE Admin_Panel SHALL render a page stating no
   matching account was found, without revealing whether a differently-cased or similar email
   exists.
3. THE Admin_Panel SHALL display, on the same page, a link to that User's current
   `locked:{userId}` status (per Requirement 9) and their most recent 5 `push_registrations`
   rows' `status` values, when any exist.
4. WHEN an authenticated request submits `POST /admin/users/:userId/revoke-sessions`, THE
   Admin_Panel SHALL set `revoked_at = now()` on every one of that User's `sessions` rows where
   `revoked_at IS NULL`, and SHALL confirm the count of sessions revoked on the response page.

### Requirement 12: Pin Collection Diagnostic

**User Story:** As the Operator, I want to see a given user's awarded Pins against the full
catalog, so that I can debug a "why didn't I get this Pin" report without manually joining
tables.

#### Acceptance Criteria

1. WHEN an authenticated request targets `GET /admin/users/:userId/pins`, THE Admin_Panel SHALL
   display, for every Pin in the Series 1 catalog, whether that User has it unlocked
   (`awardedAt`) and claimed (`claimedAt`), reusing the existing `PinRepo.getBoard` projection.
2. WHEN an authenticated request submits `POST /admin/users/:userId/pins/reconcile`, THE
   Admin_Panel SHALL invoke the existing `PinRepo.reconcileAll` (or an equivalent single-user
   reconciliation path) and display the resulting awarded-count on the response page.
3. IF `:userId` does not resolve to an existing User, THEN THE Admin_Panel SHALL respond `404`
   with a page stating the account was not found.

### Requirement 13: Growth & Engagement Counts

**User Story:** As the Operator, I want a basic glance at how many users, trips, and completions
exist and how that has trended, so that I have a sense of the app's growth without a dashboard
tool.

#### Acceptance Criteria

1. WHEN an authenticated request targets `GET /admin/growth`, THE Admin_Panel SHALL display the
   current total counts of `users`, `trips`, `completions`, `ratings`, and `friendships`.
2. THE Admin_Panel SHALL display the count of `users` created and `completions` logged within
   each of the trailing 7 calendar days (UTC), as a simple per-day table.

### Requirement 14: Configuration Visibility

**User Story:** As the Operator, I want to confirm what configuration the running process
actually resolved, so that I can debug a local-vs-cloud environment mismatch without reading
`.env` files by hand.

#### Acceptance Criteria

1. WHEN an authenticated request targets `GET /admin/config`, THE Admin_Panel SHALL display the
   resolved non-secret fields of `AppConfig`: `env`, `server.host`, `server.port`,
   `server.logLevel`, `themeparks.baseUrl`, `disney.syncGateway.baseUrl`,
   `disney.diningMenuBaseUrl`, `disney.requestBudget`, `disney.backoff`,
   `disney.menuFreshnessMs`, `disney.syncIntervalMs`, and `intelligence.crowdSeedDir`.
2. THE Admin_Panel SHALL NOT display `database.url`, `redis.url`, `session.secret`,
   `disney.credentials`, `intelligence.samplingCronSecret`, `pins.reconcileCronSecret`, or the
   Admin_Credentials themselves, on this or any other Admin_Panel page.
