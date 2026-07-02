# Requirements Document

## Introduction

The Disney World Tracker app previously sourced both its catalog and its live
operational data from the public ThemeParks.wiki API. The shipped
`disney-facilities-catalog-source` spec replaced ThemeParks.wiki entirely,
making Disney's undocumented internal sources (the Couchbase Sync Gateway and
the public dining-menu service) the sole origin of **both** catalog and live
data, and fully retired ThemeParks.wiki.

Real-world operation revealed that decision is not safe to keep in full. The
implemented Catalog_Sync fired an unthrottled burst of requests against Disney's
Sync Gateway — one large `_changes` enumeration (~6,195 documents), roughly 62
back-to-back `_bulk_get` batches of 100, and up to ~576 per-restaurant menu
calls — which tripped Disney's Akamai edge protection. Akamai returned an
"Access Denied" HTML `403` and then rate/IP-blocked **all** subsequent requests
(both `_changes` and `_bulk_get`). A separate defect was also found and already
fixed in code: the Sync Gateway rejects requests that do not send the Couchbase
Lite `User-Agent` with `403` even when the HTTP Basic credentials are valid.

This feature re-architects data sourcing along a **data-by-change-rate**
principle and hardens all Disney access:

1. **Split the sources.** Disney remains the sole source of **static catalog**
   data (descriptive fields, resorts/hotels, image URLs, menus, coordinates,
   facets, area/park hierarchy) — low-volume, staleness-tolerant data that is
   only available from Disney. **Live** data (status, standby wait, single-rider
   minutes, forecast, showtimes, operating hours, walk-up dining) moves back to
   ThemeParks.wiki, which is stable, documented, richer for live use, and
   maintained by a third party. This un-retires ThemeParks.wiki for the live
   path only.

2. **Harden Disney access.** Every Disney request funnels through a single
   shared transport that owns rate limiting against a shared request budget,
   bounded exponential backoff with jitter, `Retry-After` handling,
   classification of the Akamai/WAF "Access Denied" `403` as a transient
   (retriable) condition distinct from a genuine auth `403`, and the required
   `User-Agent` headers. Catalog_Sync becomes incremental (a persisted
   `_changes` checkpoint plus a durable local document store), fetches menus
   lazily/throttled rather than all-at-once, and runs on an infrequent cadence.

3. **Degrade gracefully.** A Disney block or credential rotation degrades only
   to slightly-stale static data (stale hotel names, images, and menus are
   harmless); the app stays fully usable and the live path is unaffected because
   it uses ThemeParks.wiki. Disney WAF/rate blocks are recorded distinctly from
   genuine auth failures in sync-run history so operators can tell them apart.

The live comparison that drives the split: for live data ThemeParks.wiki matches
or exceeds Disney-direct. ThemeParks.wiki provides single-rider wait **minutes**
(Disney's status document exposes only a `singleRider` availability boolean),
and it uniquely provides Lightning Lane price/coarse-state (`paidReturnWindow`)
and boarding-group status (`boardingGroup`) — data that Disney's public gateway
gates behind per-guest authentication (`403`). Disney-direct's only live
advantages are marginally fresher standby waits and cosmetic forecast labels the
app already derives itself.

Scope is limited to Walt Disney World Resort. This spec **supersedes** specific
requirements of the shipped `disney-facilities-catalog-source` spec; the exact
supersessions are enumerated in Requirement 13.

## Glossary

- **Disney_Source**: Any Disney-owned upstream this feature contacts: the
  Disney_Sync_Gateway, the Menu_Service, and Disney's authorization service that
  issues the Public_Token.
- **Disney_Sync_Gateway**: Disney's internal Couchbase Sync Gateway backing WDW
  facility, status, schedule, forecast, and dining-status data. Base URL
  `https://realtime-sync-gw.wdprapps.disney.com/park-platform-pub/`. Exposes
  `POST /_changes` and `POST /_bulk_get`. Authenticated with Static_Credentials
  (HTTP Basic). Fronted by Akamai edge protection.
- **Menu_Service**: Disney's public dining-menu service (`diningMenuSvc`),
  reached with a Public_Token, returning full menus for a restaurant.
- **Public_Token**: An app-level anonymous OAuth bearer token obtained from
  Disney's authorization service via an `assertion` / `public` grant. Requires
  no per-guest login and expires periodically.
- **Static_Credentials**: The HTTP Basic username/password required by the
  Disney_Sync_Gateway, supplied through configuration
  (`DISNEY_SYNC_GATEWAY_USERNAME`, `DISNEY_SYNC_GATEWAY_PASSWORD`).
- **Disney_Transport**: The single shared component this feature introduces
  through which every Disney_Source HTTP request passes. It owns rate limiting,
  backoff, `Retry-After` handling, WAF-`403` classification, and the required
  `User-Agent` headers. Both existing Disney clients funnel their requests
  through it.
- **Facilities_Client**: The existing Disney Sync Gateway catalog client
  (`apps/api/src/services/catalog/disney/facilitiesClient.ts`) used by
  Catalog_Sync.
- **Disney_Live_Client**: The existing Disney live-document client
  (`apps/api/src/services/catalog/disney/liveClient.ts`). Retired from the
  serving path by this feature (see Requirement 13) but named here because it is
  the second Disney client that historically bypassed a shared transport.
- **WAF_Block**: An Akamai edge response denying access — an HTML
  "Access Denied" body returned with HTTP `403` (or `429`) that reflects
  rate/IP throttling rather than a credential problem. A transient, retriable
  condition.
- **Auth_Failure**: A genuine authentication or authorization rejection from a
  Disney_Source caused by invalid, expired, or insufficient credentials. A
  non-retriable condition that must fail fast.
- **Couchbase_User_Agent**: The Couchbase Lite client `User-Agent` string the
  Disney_Sync_Gateway requires; requests without it are rejected with `403`
  even when Static_Credentials are valid
  (`DISNEY_SYNC_GATEWAY_USER_AGENT` in code).
- **Web_User_Agent**: A browser-like `User-Agent` string required by Disney's
  public web services (the authorization service and the Menu_Service).
- **Request_Budget**: The maximum permitted rate and concurrency of outbound
  requests to a Disney_Source, expressed as configured limits. Because all
  processes share one egress IP as seen by Disney, the budget is shared across
  every process that contacts Disney.
- **Rate_Limiter**: The Disney_Transport component that enforces the
  Request_Budget by requiring each Disney request to acquire capacity before
  dispatch.
- **Backoff_Policy**: Bounded exponential backoff with jitter applied to
  retriable failures, capped by a maximum retry count and a maximum total delay.
- **Changes_Checkpoint**: The persisted Disney_Sync_Gateway `_changes`
  sequence (`since` value / `last_seq`) from which the next incremental
  enumeration resumes.
- **Bootstrap_Sync**: The one-time full enumeration of the Facilities_Channel
  performed when no Changes_Checkpoint exists.
- **Delta_Sync**: A routine incremental enumeration that requests only documents
  changed since the persisted Changes_Checkpoint.
- **Document_Store**: The durable local persistence of fetched Facility
  Documents and the Changes_Checkpoint, enabling Delta_Syncs and offline
  reconciliation.
- **Facilities_Channel**: The Sync Gateway channel listing catalog entities,
  `wdw.facilities.1_0.en_us`.
- **Facility_Document**: One Disney entity document (attraction, entertainment,
  restaurant, resort, etc.) as defined by the shipped catalog spec.
- **Enterprise_Id**: The Disney entity identifier, formatted
  `{numericId};entityType={Type}` (e.g. `80010177;entityType=Attraction`).
- **Internal_Id**: The stable internal catalog identifier, derived as UUIDv5 of
  the Enterprise_Id over the existing fixed namespace. Unchanged by this feature.
- **ThemeParks_Wiki**: The public ThemeParks.wiki API, base URL
  `https://api.themeparks.wiki/v1`. Documented, stable, third-party-maintained,
  and itself powered by the same Disney data via a maintained Couchbase
  replicator.
- **External_Id**: The field ThemeParks_Wiki exposes for each entity that
  equals the Disney Enterprise_Id, used to join ThemeParks_Wiki live data to
  catalog Experiences.
- **Live_Service**: The API component that serves Live_Detail for an Experience.
  After this feature it sources exclusively from ThemeParks_Wiki.
- **Live_Detail**: The projected live operational information for a single
  Experience — status, standby wait, single-rider wait minutes, forecast,
  showtimes, operating hours, walk-up dining availability, and (newly)
  Lightning Lane price/coarse-state and boarding-group status.
- **Static_Catalog_Data**: The low-change-rate catalog data sourced only from
  Disney — Experience descriptive fields, resorts/hotels, image URLs, menus,
  coordinates, facets (accessibility/price/meal periods), and the area/park
  hierarchy.
- **Live_Data**: The high-change-rate operational data — status, standby wait,
  single-rider wait minutes, forecast, showtimes, operating hours, walk-up
  dining availability, Lightning Lane price/coarse-state, and boarding-group
  status.
- **Catalog_Sync**: The orchestrator that fetches Static_Catalog_Data from
  Disney, reconciles it into the Catalog_Cache, and records the run outcome
  (`apps/api/src/services/catalog/sync.ts`).
- **Catalog_Cache**: The local persisted catalog (`experiences` table and resort
  persistence) plus its sync metadata.
- **Sync_Run_History**: The recorded outcome of every Catalog_Sync run
  (`catalog_sync_runs`), including its outcome discriminator.
- **App**: The Disney World Tracker mobile application (`apps/mobile`).

## Requirements

### Requirement 1: Single Shared Disney Transport

**User Story:** As an API maintainer, I want every Disney request to pass
through one shared transport, so that rate limiting and resilience are enforced
uniformly across both Disney clients rather than duplicated or bypassed.

#### Acceptance Criteria

1. THE Disney_Transport SHALL expose a single request operation through which every outbound request to a Disney_Source is dispatched.
2. WHEN the Facilities_Client sends any request to a Disney_Source, THE Facilities_Client SHALL dispatch that request through the Disney_Transport.
3. WHERE any other component sends a request to a Disney_Source, THE component SHALL dispatch that request through the Disney_Transport.
4. THE Disney_Transport SHALL apply the Rate_Limiter, the Backoff_Policy, the WAF_Block classification, and the required User-Agent headers to every request it dispatches.
5. WHEN a Disney_Source request fails, THE Disney_Transport SHALL raise exactly one typed error carrying a discriminator whose value is one of `http_status`, `network`, `invalid_response`, or `aborted`.

### Requirement 2: Shared Request Budget and Rate Limiting

**User Story:** As an operator, I want Disney requests paced against a shared
budget, so that a sync burst never again trips Disney's edge protection.

#### Acceptance Criteria

1. WHEN the Disney_Transport dispatches a request to a Disney_Source, THE Rate_Limiter SHALL require that request to acquire capacity from the Request_Budget before the request is sent.
2. THE Rate_Limiter SHALL limit the outbound request rate to a Disney_Source to no more than the configured maximum requests per second.
3. THE Rate_Limiter SHALL limit the number of concurrent in-flight requests to a Disney_Source to no more than the configured maximum concurrency.
4. WHERE the sync worker and the API serving the application run as separate operating-system processes, THE Rate_Limiter SHALL enforce the Request_Budget across all such processes using a Redis-backed shared limiter, so that the combined outbound rate from one egress IP does not exceed the configured maximum.
5. WHERE the sync worker and the API run within a single operating-system process, THE Rate_Limiter SHALL enforce the Request_Budget using an in-process limiter.
6. WHEN capacity is not immediately available, THE Rate_Limiter SHALL delay dispatch until capacity is available rather than reject the request.

### Requirement 3: Bounded Backoff, Jitter, and Retry-After

**User Story:** As an operator, I want transient Disney failures retried
politely, so that recovery is automatic without amplifying load.

#### Acceptance Criteria

1. WHEN a Disney_Source request fails with a retriable condition, THE Disney_Transport SHALL retry the request according to the Backoff_Policy.
2. THE Backoff_Policy SHALL increase the delay between successive retries exponentially and SHALL add randomized jitter to each computed delay.
3. THE Backoff_Policy SHALL stop retrying once the configured maximum retry count is reached, and THEN THE Disney_Transport SHALL raise the typed error for the final failure.
4. WHEN a Disney_Source response includes a `Retry-After` header, THE Disney_Transport SHALL wait at least the duration indicated by that header before the next retry.
5. IF a Disney_Source request fails with a non-retriable condition, THEN THE Disney_Transport SHALL raise the typed error without performing any retry.
6. THE Backoff_Policy SHALL cap the total elapsed retry delay for a single request at the configured maximum retry duration.

### Requirement 4: Classify WAF Blocks Distinctly from Auth Failures

**User Story:** As an operator, I want Disney edge blocks treated as transient
and genuine auth rejections treated as fatal, so that the system retries the
right failures and fails fast on the wrong ones.

#### Acceptance Criteria

1. WHEN a Disney_Source returns an HTTP `403` or `429` whose body indicates an Akamai edge "Access Denied" or rate-limit denial, THE Disney_Transport SHALL classify the failure as a WAF_Block.
2. THE Disney_Transport SHALL treat a WAF_Block as a retriable condition subject to the Backoff_Policy.
3. WHEN the Disney_Sync_Gateway returns an HTTP `401`, or returns an HTTP `403` that is not classified as a WAF_Block, THE Disney_Transport SHALL classify the failure as an Auth_Failure.
4. THE Disney_Transport SHALL treat an Auth_Failure as a non-retriable condition and SHALL raise the typed error without retry.
5. WHEN the Disney_Transport raises a typed error for a WAF_Block, THE typed error SHALL carry a discriminator that distinguishes the WAF_Block from an Auth_Failure.

### Requirement 5: Required User-Agent Identification

**User Story:** As an API maintainer, I want each Disney endpoint to receive the
User-Agent it requires, so that requests are not rejected for failing to
identify the client.

#### Acceptance Criteria

1. WHEN the Disney_Transport dispatches a request to the Disney_Sync_Gateway, THE Disney_Transport SHALL include the Couchbase_User_Agent header on that request.
2. WHEN the Disney_Transport dispatches a request to Disney's authorization service or to the Menu_Service, THE Disney_Transport SHALL include the Web_User_Agent header on that request.
3. THE Disney_Transport SHALL send the Static_Credentials as HTTP Basic authentication on every Disney_Sync_Gateway request and SHALL send a valid Public_Token as bearer authentication on every Menu_Service request.

### Requirement 6: Incremental Replication with a Persisted Checkpoint

**User Story:** As an operator, I want routine syncs to pull only changed
documents, so that Disney load stays low and stable.

#### Acceptance Criteria

1. WHERE no Changes_Checkpoint exists, THE Catalog_Sync SHALL perform a Bootstrap_Sync that enumerates the full Facilities_Channel.
2. WHERE a Changes_Checkpoint exists, THE Catalog_Sync SHALL perform a Delta_Sync that requests the Facilities_Channel `_changes` feed with the `since` value equal to the persisted Changes_Checkpoint.
3. WHEN a Catalog_Sync run enumerates the Facilities_Channel successfully, THE Catalog_Sync SHALL persist the returned `last_seq` value as the new Changes_Checkpoint.
4. WHEN a Delta_Sync completes, THE Catalog_Sync SHALL fetch document bodies only for the document ids reported changed since the persisted Changes_Checkpoint.
5. IF a Catalog_Sync run fails before persisting a new Changes_Checkpoint, THEN THE Catalog_Sync SHALL leave the prior Changes_Checkpoint unchanged so the next run resumes from the last successful sequence.
6. THE Catalog_Sync SHALL pace the Bootstrap_Sync request sequence within the Request_Budget so that the initial full enumeration does not exceed the configured outbound rate.

### Requirement 7: Durable Local Document Store

**User Story:** As an API maintainer, I want fetched documents stored durably,
so that reconciliation can run against a local copy and deltas can be applied
incrementally.

#### Acceptance Criteria

1. WHEN the Catalog_Sync fetches a Facility_Document, THE Document_Store SHALL persist that document such that it remains retrievable across application restarts.
2. WHEN a Delta_Sync fetches a changed Facility_Document, THE Document_Store SHALL replace the previously stored document that has the same Enterprise_Id.
3. WHEN a Delta_Sync reports a Facility_Document as deleted or tombstoned, THE Document_Store SHALL mark the corresponding stored document as removed while preserving the Changes_Checkpoint continuity.
4. WHEN reconciling into the Catalog_Cache, THE Catalog_Sync SHALL derive the upstream entity set from the Document_Store rather than require a full re-enumeration from Disney.
5. THE Changes_Checkpoint SHALL be persisted in the Document_Store such that it is read at the start of each Catalog_Sync run and updated only on successful enumeration.

### Requirement 8: Lazy and Throttled Menu Retrieval

**User Story:** As an operator, I want restaurant menus fetched sparingly, so
that hundreds of menu calls per sync no longer contribute to edge blocks.

#### Acceptance Criteria

1. THE Catalog_Sync SHALL NOT fetch every restaurant's menu during each routine Catalog_Sync run.
2. WHEN a restaurant Experience's menu is requested and no cached menu exists for that restaurant, THE API SHALL fetch that restaurant's menu from the Menu_Service on demand and SHALL cache the fetched menu.
3. WHERE menus are refreshed on a background cadence, THE menu refresh SHALL dispatch its Menu_Service requests through the Disney_Transport within the Request_Budget.
4. WHEN a cached menu exists for a restaurant, THE API SHALL serve the cached menu without contacting the Menu_Service until the cached menu's configured freshness interval has elapsed.
5. IF a Menu_Service request fails, THEN THE API SHALL serve any previously cached menu for that restaurant unchanged and SHALL record the failure without failing the overall Catalog_Sync run.

### Requirement 9: Infrequent Static Sync Cadence

**User Story:** As an operator, I want the Disney sync to run rarely, so that
low-change-rate static data imposes minimal load on the fragile source.

#### Acceptance Criteria

1. THE Catalog_Sync SHALL refresh Static_Catalog_Data from Disney on a schedule whose interval is configurable and whose default does not run more frequently than once per 24 hours.
2. WHILE the most recent successful Catalog_Sync completed within the configured freshness interval, THE Catalog_Sync SHALL NOT initiate an additional scheduled sync.
3. WHEN a catalog read occurs and the Catalog_Cache age exceeds the configured freshness interval, THE Catalog_Sync SHALL initiate a refresh of the Catalog_Cache from Disney.

### Requirement 10: Static Catalog Sourced Only from Disney

**User Story:** As a user, I want rich descriptive catalog data, resorts,
imagery, and menus, so that the catalog is visually and informationally complete
— and this data comes only from Disney because no other source provides it.

#### Acceptance Criteria

1. THE Catalog_Sync SHALL source all Static_Catalog_Data exclusively from the Disney_Sync_Gateway and the Menu_Service.
2. THE Static_Catalog_Data SHALL comprise each Experience's descriptive fields, resorts/hotels, image URLs, menus, coordinates, facets covering accessibility, price tier, and meal periods, and the area/park hierarchy.
3. WHEN the Disney_Sync_Gateway is reachable, THE Catalog_Sync SHALL reconcile Static_Catalog_Data into the Catalog_Cache using the existing soft-delete and identity-continuity guarantees.
4. THE Catalog_Sync SHALL NOT request Live_Data from any Disney_Source.

### Requirement 11: Live Data Sourced from ThemeParks.wiki

**User Story:** As a user, I want current wait times, showtimes, hours, dining
availability, Lightning Lane state, and boarding groups, so that I can plan my
day — served from the stable ThemeParks.wiki source.

#### Acceptance Criteria

1. WHEN the App requests Live_Detail for an Experience, THE Live_Service SHALL derive it from ThemeParks_Wiki.
2. THE Live_Service SHALL resolve the ThemeParks_Wiki entity for an Experience by matching the Experience's Enterprise_Id to the ThemeParks_Wiki External_Id.
3. THE Live_Service SHALL populate Live_Detail `status`, standby `waitMinutes`, and `singleRiderWaitMinutes` from the ThemeParks_Wiki live data.
4. THE Live_Service SHALL populate Live_Detail `forecast`, `showtimes`, and `operatingHours` from the ThemeParks_Wiki live data.
5. WHERE the Experience is a restaurant, THE Live_Service SHALL populate Live_Detail walk-up dining availability from the ThemeParks_Wiki live data.
6. THE Live_Service SHALL populate Live_Detail Lightning Lane price and coarse return-window state from the ThemeParks_Wiki `paidReturnWindow` data when present.
7. THE Live_Service SHALL populate Live_Detail boarding-group status from the ThemeParks_Wiki `boardingGroup` data when present.
8. WHERE a live field is absent or unparseable in the ThemeParks_Wiki data, THE Live_Service SHALL omit that field from Live_Detail rather than fabricate a value, and SHALL always present `status`, using `Unknown` when absent.
9. THE Live_Service SHALL render every Live_Detail time in the Park's local time zone.
10. THE Live_Service SHALL NOT issue any request to a Disney_Source when serving Live_Detail.

### Requirement 12: Graceful Degradation and Block Visibility

**User Story:** As an operator, I want a Disney block or credential rotation to
degrade only to stale static data, and I want blocks recorded distinctly, so
that the app stays usable and the risk is visible.

#### Acceptance Criteria

1. IF a Catalog_Sync run fails for any reason, THEN THE Catalog_Sync SHALL leave the prior Catalog_Cache unchanged and THE API SHALL continue serving the existing Catalog_Cache with a staleness indicator conveying the cache's age.
2. IF a Disney_Source block or Auth_Failure prevents refreshing Static_Catalog_Data, THEN THE API SHALL continue serving catalog reads from the Catalog_Cache without error while a prior Catalog_Cache exists.
3. WHILE the Disney_Sync_Gateway is blocked or unreachable, THE Live_Service SHALL continue serving Live_Detail from ThemeParks_Wiki unaffected.
4. WHEN a Catalog_Sync run ends in a WAF_Block, THE Catalog_Sync SHALL record the run in Sync_Run_History with an outcome that distinguishes a WAF_Block from an Auth_Failure and from a successful run.
5. WHEN a Catalog_Sync run ends in an Auth_Failure, THE Catalog_Sync SHALL record the run in Sync_Run_History with an outcome that identifies the failure as an authentication or authorization failure.
6. THE Sync_Run_History SHALL record the outcome of every Catalog_Sync run with a discriminator drawn from a closed set that includes at least `success`, `waf_block`, `auth_failure`, `network`, `invalid_response`, and `aborted`.

### Requirement 13: Supersession of the Shipped Catalog Spec

**User Story:** As an API maintainer, I want the exact changes to the shipped
`disney-facilities-catalog-source` spec recorded, so that the two specs do not
contradict each other silently.

#### Acceptance Criteria

1. THE feature SHALL supersede `disney-facilities-catalog-source` Requirement 9 ("Live Operational Data from Disney"), such that Live_Detail is derived from ThemeParks_Wiki (Requirement 11) rather than from the Disney sources.
2. THE feature SHALL supersede `disney-facilities-catalog-source` Requirement 12 ("Upstream Resilience and Risk") for its live-path clauses, such that Live_Detail resilience depends on ThemeParks_Wiki and Disney resilience is governed by the Disney_Transport (Requirements 1 through 4) and graceful degradation (Requirement 12).
3. THE feature SHALL supersede `disney-facilities-catalog-source` Requirement 14 ("Full Retirement of ThemeParks.wiki"), such that ThemeParks_Wiki is retained as the sole source of Live_Data while Disney remains the sole source of Static_Catalog_Data.
4. THE feature SHALL retain `disney-facilities-catalog-source` identity continuity, such that each Experience remains keyed by the Internal_Id derived as UUIDv5 of the Enterprise_Id, and THE Live_Service SHALL join ThemeParks_Wiki live data to Experiences through the Enterprise_Id / External_Id correspondence.
5. THE feature SHALL NOT reintroduce ThemeParks_Wiki as a source of Static_Catalog_Data, imagery, resorts, or menus.

### Requirement 14: Configuration and Credentials

**User Story:** As an operator, I want all Disney and resilience settings
supplied through configuration, so that no secrets or tuning values are
hard-coded and startup fails loudly when credentials are missing.

#### Acceptance Criteria

1. THE configuration loader SHALL obtain the Disney_Sync_Gateway base URL, the Static_Credentials, the ThemeParks_Wiki base URL, the Request_Budget limits, the Backoff_Policy limits, and the sync freshness interval from configuration.
2. IF the Static_Credentials username or password is absent or empty at application startup, THEN THE configuration loader SHALL halt startup before the API accepts any request and SHALL emit an error message naming each missing credential value.
3. THE application modules other than the configuration loader SHALL obtain Disney and ThemeParks_Wiki settings only through the loaded configuration.
4. WHERE the Static_Credentials must be re-pulled, THE existing credential re-pull tool (`tools/pull-disney-creds.mjs`) SHALL remain the supported mechanism, and THE feature SHALL NOT require credentials to be embedded in application source.
5. IF a configured Disney_Source or ThemeParks_Wiki URL is not a well-formed absolute URL, THEN THE configuration loader SHALL halt startup before the API accepts any request and SHALL emit an error message identifying the invalid value.

### Requirement 15: Scope Boundaries and Non-Goals

**User Story:** As a stakeholder, I want the feature's boundaries explicit, so
that unreachable or out-of-scope concerns are not silently pulled in.

#### Acceptance Criteria

1. THE feature SHALL limit coverage to Walt Disney World Resort and SHALL enumerate only the Facilities_Channel `wdw.facilities.1_0.en_us` from Disney.
2. WHERE a Disney data source or operation requires per-guest authentication, THE feature SHALL exclude that data source or operation and SHALL send only the Static_Credentials or the Public_Token.
3. THE feature SHALL NOT attempt to obtain real Lightning Lane return windows or boarding-group availability from any Disney_Source, and SHALL source the coarse Lightning Lane and boarding-group fields only from ThemeParks_Wiki (Requirement 11).
4. THE feature SHALL NOT source Static_Catalog_Data from ThemeParks_Wiki.
