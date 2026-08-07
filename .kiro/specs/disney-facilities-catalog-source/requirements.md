# Requirements Document

## Introduction

The Disney World Tracker app currently sources both its catalog and its live operational data from the public ThemeParks.wiki API. That source exposes no imagery, no hotel/resort information, no menus, and a coarser hierarchy than the app would like. This feature replaces ThemeParks.wiki entirely with Disney's own internal data sources (the Couchbase Sync Gateway and public dining-menu service used by the `mousetools` library and verified live during discovery) as the sole origin of both catalog and live data.

This is a full, single-ecosystem migration. After it completes, no part of the app reads from ThemeParks.wiki. The motivations, in priority order, are: (1) surface hotel/resort information the app cannot obtain today; (2) use Disney's native imagery; (3) add richer metadata (accessibility and price facets, coordinates, full dining menus); and (4) source live wait times from Disney directly, which discovery showed to be fresher than the ThemeParks.wiki mirror.

The migration MUST preserve existing user data. Completions, Ratings, and Notes reference the stable internal Experience id (a UUIDv5 derived from an upstream entity id). To avoid orphaning that data, the migration bridges identity across sources exactly once: ThemeParks.wiki exposes the Disney enterprise id in its `externalId` field, so an internal id re-derived from the Disney enterprise id remains identical to the one derived today.

Two live fields the app shows today — Lightning Lane return windows (`returnWindow` / `paidReturnWindow`) and boarding groups (`boardingGroup`) — are deliberately **out of scope**. Discovery verified these are not available from any public Disney route: they are computed per authenticated guest and per entitlement (the reference Lightning Lane client operates entirely on guest ids behind a Disney account login), and the Disney virtual-queue service returns HTTP 403 to app-level credentials. ThemeParks.wiki itself only ever exposed a price and a coarse state for these, not real availability. The Individual Lightning Lane price is likewise out of scope.

The Disney sources are undocumented, protected by static reverse-engineered credentials (for the Sync Gateway) and an app-level anonymous token (for the menu service), and subject to Disney's Terms of Use with no SLA. Requirements therefore treat operational resilience and risk explicitly. Scope is limited to Walt Disney World Resort.

## Glossary

- **Disney_Sync_Gateway**: Disney's internal Couchbase Sync Gateway backing WDW facility, status, schedule, forecast, and dining-status data. Base URL `https://realtime-sync-gw.wdprapps.disney.com/park-platform-pub/`. Exposes `POST /_changes` and `POST /_bulk_get`. Authenticated with Static_Credentials (HTTP Basic).
- **Menu_Service**: Disney's public dining-menu service (`diningMenuSvc`), reached with a Public_Token. Returns full menus for a restaurant.
- **Public_Token**: An app-level OAuth bearer token obtained from Disney's authorization service via an anonymous `assertion` / `public` grant. Requires no per-guest login and expires periodically.
- **Static_Credentials**: The HTTP Basic username/password required by the Disney_Sync_Gateway, supplied through configuration.
- **Facilities_Client**: The new API-side client that talks to the Disney sources, analogous to the existing `createThemeParksClient()`. Config-driven; surfaces a single typed error.
- **Facilities_Parser**: The component that parses the `multipart/related` body returned by `POST /_bulk_get` into individual documents.
- **Facility_Document**: One Disney entity document (attraction, entertainment, restaurant, resort, etc.). Carries fields such as `id`, `name`, `type`, `subType`, `description`, `detailImageUrl`, `listImageUrl`, `latitude`, `longitude`, `address`, `phone`, an ancestor chain, `facets`, `mealPeriods`, `lastUpdate`, and `channels`.
- **Facilities_Channel**: The Sync Gateway channel listing catalog entities, `wdw.facilities.1_0.en_us`.
- **Status_Channel**: The channel of live status/wait documents, `wdw.facilitystatus.1_0`.
- **Dining_Status_Channel**: The channel of walk-up dining-availability documents, `wdw.diningfacilitystatus.1_0`.
- **Schedule_Channel**: The channels of current-day schedule documents grouped by entity type, `wdw.today.1_0.{Type}`, carrying showtimes and operating hours.
- **Forecast_Channel**: The channel of hourly wait-time forecast documents, `wdw.forecastedwaittimes.1_0.en_us`.
- **Enterprise_Id**: The Disney entity identifier, formatted `{numericId};entityType={Type}` (e.g. `80010177;entityType=Attraction`).
- **Tombstone**: A soft-deleted document, present in a channel with `softDeleted: true` and no `name`.
- **Facility_Type**: The `type` field of a Facility_Document (e.g. `attraction`, `entertainment`, `restaurant`, `resort`).
- **Facility_SubType**: The optional `subType` field providing finer classification (e.g. `"Nighttime Spectacular"`).
- **Facet**: A structured tag on a Facility_Document, grouped as `accessibility` (e.g. `"wheelchair-access"`), `priceRangeDining` (e.g. `"$"`), or `interests`.
- **Meal_Period**: An entry under a restaurant Facility_Document's `mealPeriods`, carrying a meal type and price tier.
- **Coordinates**: The `latitude` and `longitude` of a Facility_Document.
- **Experience**: An existing catalog item (Ride, Show, Restaurant, Parade, Character_Meet, or Other) surfaced to the App.
- **Experience_Category**: The closed classification set: `Ride`, `Show`, `Restaurant`, `Parade`, `Character_Meet`, `Tour`, `Recreation`, `Spa`, `Event`, `Other`.
- **Experience_Eligible_Type**: A Facility_Type that becomes a catalog Experience: `attraction`, `entertainment`, `restaurant`, `dinner-show`, `recreation`, `recreation-activity`, `tour`, `audio-tour`, `spa`, `event`, `dining-event`.
- **Non_Experience_Type**: A Facility_Type that is structural or non-experiential and is never a catalog Experience: `guest-service`, `merchandise-facility`, `transportation`, `photopass`, `bus-stop`, `land`, `entertainment-venue`, `resort-area`, `destination`, `theme-park`, `water-park`, `avatar` (and `resort`, which is handled as a Resort per Requirement 6).
- **Area**: The place an Experience belongs to, classified by an **Area_Type** of `ThemePark`, `WaterPark`, `DisneySprings`, or `Resort`. For a `Resort` area, the Experience references the specific Resort's Internal_Id (e.g. dining at Disney's Polynesian Village Resort).
- **Park**: The subset of Areas that are the WDW theme parks and water parks; retained for existing park-based grouping and for park operating hours.
- **Resort**: A new first-class catalog concept representing a Disney hotel/resort (Facility_Type `resort`, distinct from `resort-area`).
- **Live_Detail**: The projected live operational information for a single Experience — status, standby wait, single-rider wait, forecast, showtimes, operating hours, and walk-up dining availability.
- **Internal_Id**: The stable internal identifier for a catalog item, derived as UUIDv5 of an upstream entity id over a fixed namespace. Must remain identical across the source migration.
- **Catalog_Sync**: The orchestrator that fetches upstream data, classifies it, reconciles it against the local cache, and records the run outcome.
- **Catalog_Cache**: The local persisted catalog (`experiences` table and the new resort persistence) plus its sync metadata.
- **Bridge_Map**: A one-time mapping from Enterprise_Id to the existing ThemeParks.wiki-derived Internal_Id, used only during migration to guarantee id continuity.
- **App**: The Disney World Tracker mobile application (`apps/mobile`).

## Requirements

### Requirement 1: Disney Sources Client

**User Story:** As an API maintainer, I want a dedicated, config-driven client for the Disney sources, so that catalog and live data come from Disney with the same isolation and typed-error discipline as the existing upstream client.

#### Acceptance Criteria

1. THE Facilities_Client SHALL read the Disney_Sync_Gateway base URL and the Static_Credentials from application configuration.
2. WHEN the Facilities_Client sends a request to the Disney_Sync_Gateway, THE Facilities_Client SHALL include the Static_Credentials as HTTP Basic authentication on that request.
3. WHEN the Facilities_Client sends a request to the Menu_Service, THE Facilities_Client SHALL include a valid Public_Token as bearer authentication on that request.
4. WHEN no unexpired Public_Token is held, THE Facilities_Client SHALL obtain a Public_Token from Disney's authorization service using an anonymous `assertion` / `public` grant before calling the Menu_Service.
5. WHERE no Disney_Sync_Gateway base URL is configured, THE Facilities_Client SHALL use the default base URL `https://realtime-sync-gw.wdprapps.disney.com/park-platform-pub/`.
6. THE Facilities_Client SHALL expose operations to list a channel's child document ids via `POST /_changes` and to fetch documents by id via `POST /_bulk_get`.
7. WHEN any request to a Disney source fails, THE Facilities_Client SHALL raise exactly one typed error carrying a discriminator whose value is exactly one of `http_status`, `network`, `invalid_response`, or `aborted`.
8. IF a Disney source returns an HTTP status outside the 200–299 range, THEN THE Facilities_Client SHALL raise the typed error with discriminator `http_status` and SHALL include the received status code.
9. IF a request to a Disney source fails to establish a connection or terminates before any HTTP response is received, THEN THE Facilities_Client SHALL raise the typed error with discriminator `network`.
10. IF a request to a Disney source is cancelled by the caller before a complete HTTP response is received, THEN THE Facilities_Client SHALL raise the typed error with discriminator `aborted`.

### Requirement 2: Facilities Document Retrieval

**User Story:** As an API maintainer, I want the client to enumerate and fetch WDW facility documents, so that Catalog_Sync has the full entity set to reconcile.

#### Acceptance Criteria

1. WHEN listing a channel, THE Facilities_Client SHALL send the `POST /_changes` request body with `style` set to `"all_docs"`, `filter` set to `"sync_gateway/bychannel"`, and `feed` set to `"normal"`.
2. WHEN enumerating the WDW facilities, THE Facilities_Client SHALL request the Facilities_Channel `wdw.facilities.1_0.en_us`.
3. WHEN fetching documents, THE Facilities_Client SHALL send one or more `POST /_bulk_get` requests, each request body listing between 1 and 100 of the requested document ids with `json` set to `true`, until all requested document ids have been requested.
4. IF the set of requested document ids is empty, THEN THE Facilities_Client SHALL return an empty document set to the caller and SHALL NOT send a `POST /_bulk_get` request.
5. WHEN the channel enumeration and all corresponding `POST /_bulk_get` fetches complete, THE Facilities_Client SHALL return to the caller the complete set of enumerated document ids and every fetched document, without applying business classification, filtering, or deduplication.

### Requirement 3: Resilient Response Parsing

**User Story:** As an API maintainer, I want parsing to tolerate the real shape of Disney responses, so that a single malformed or unexpected document does not fail an entire sync.

#### Acceptance Criteria

1. WHEN a `POST /_bulk_get` response is received, THE Facilities_Parser SHALL parse the `multipart/related` body into individual documents.
2. IF the entire `POST /_bulk_get` response body cannot be parsed into any document, THEN THE Facilities_Client SHALL raise the typed error with discriminator `invalid_response`, and THE Catalog_Sync SHALL leave the upstream entity set unchanged.
3. IF an individual part of the `multipart/related` body cannot be parsed into a document, THEN THE Facilities_Parser SHALL exclude that part and SHALL continue parsing the remaining parts.
4. WHEN a Facility_Document has `softDeleted` set to `true`, THE Catalog_Sync SHALL exclude that document from the upstream entity set.
5. WHERE a Facility_Document omits any optional field, THE Catalog_Sync SHALL process the document using the fields that are present.
6. WHERE a Facility_Document contains only the required fields `id`, `name`, and `type`, THE Catalog_Sync SHALL process the document using those required fields.
7. WHERE a Facility_Document has no `name`, or a `name` consisting only of whitespace, THE Catalog_Sync SHALL exclude that document from the upstream entity set.

### Requirement 4: Classification of the Expanded Taxonomy

**User Story:** As a user, I want every Disney experience mapped into a meaningful category, so that browse, search, and filtering work after the migration and nothing worth seeing is dropped.

#### Acceptance Criteria

1. THE Catalog_Sync SHALL treat every Experience_Eligible_Type as a candidate Experience and SHALL exclude every Non_Experience_Type from the Experience set.
2. WHEN a Facility_Document has Facility_Type `attraction`, THE Catalog_Sync SHALL classify it as `Ride` unless the sub-classification signal in criterion 9 identifies it as `Parade` or `Character_Meet`.
3. WHEN a Facility_Document has Facility_Type `entertainment`, THE Catalog_Sync SHALL classify it as `Show` unless the sub-classification signal in criterion 9 identifies it as `Parade` or `Character_Meet`.
4. WHEN a Facility_Document has Facility_Type `restaurant` or `dinner-show`, THE Catalog_Sync SHALL classify it as `Restaurant`.
5. WHEN a Facility_Document has Facility_Type `tour` or `audio-tour`, THE Catalog_Sync SHALL classify it as `Tour`.
6. WHEN a Facility_Document has Facility_Type `recreation` or `recreation-activity`, THE Catalog_Sync SHALL classify it as `Recreation`.
7. WHEN a Facility_Document has Facility_Type `spa`, THE Catalog_Sync SHALL classify it as `Spa`.
8. WHEN a Facility_Document has Facility_Type `event` or `dining-event`, THE Catalog_Sync SHALL classify it as `Event`.
9. WHERE a Facility_Document carries a non-empty Facility_SubType, THE Catalog_Sync SHALL determine the sub-classification from a case-insensitive keyword match on the Facility_SubType; and WHERE the Facility_SubType is absent or empty, THE Catalog_Sync SHALL determine the sub-classification from a case-insensitive keyword match on the Facility_Document `name`.
10. WHERE an Experience_Eligible_Type is not covered by an explicit mapping in criteria 2–8, THE Catalog_Sync SHALL classify it as `Other`.
11. WHEN classifying an Experience, THE Catalog_Sync SHALL resolve its owning Area as follows and SHALL record the resulting Area_Type.
12. WHERE an Experience has a theme park or water park ancestor, THE Catalog_Sync SHALL set the Area to that Park with Area_Type `ThemePark` or `WaterPark` respectively.
13. WHERE an Experience has no theme park or water park ancestor but belongs to Disney Springs, THE Catalog_Sync SHALL set the Area to `Disney Springs` with Area_Type `DisneySprings`.
14. WHERE an Experience has no theme park, water park, or Disney Springs ancestor but has a resort ancestor, THE Catalog_Sync SHALL set the Area to that specific Resort with Area_Type `Resort`, referencing the Resort's Internal_Id.
15. WHERE an Experience's Area cannot be resolved to a theme park, water park, Disney Springs, or a specific resort, THE Catalog_Sync SHALL assign a resort-wide catch-all Area rather than exclude the Experience.

### Requirement 5: Experience Enrichment Metadata

**User Story:** As a user, I want experiences to carry location, accessibility, and price information, so that I can make better decisions and a future map view is possible.

#### Acceptance Criteria

1. WHERE a Facility_Document carries Coordinates, THE Catalog_Sync SHALL populate the Experience's latitude and longitude from those values.
2. WHERE a Facility_Document omits `latitude` or `longitude`, THE Catalog_Sync SHALL set the corresponding Experience field to `null`.
3. WHERE a Facility_Document carries `accessibility` Facets, THE Catalog_Sync SHALL persist those accessibility tags on the Experience.
4. WHERE a Facility_Document of Facility_Type `restaurant` carries a `priceRangeDining` Facet, THE Catalog_Sync SHALL persist that price tier on the Experience.
5. WHERE a Facility_Document of Facility_Type `restaurant` carries `mealPeriods`, THE Catalog_Sync SHALL persist the Meal_Period types and price tiers on the Experience.
6. WHEN the App requests an Experience, THE API SHALL expose the Experience's coordinates, accessibility tags, price tier, and meal periods through the Experience DTO, each present only when persisted.
7. WHEN the App requests an Experience, THE API SHALL expose the Experience's Area_Type and, for a `Resort` area, the referenced Resort's Internal_Id, so the App can group Experiences by area.
8. WHEN Catalog_Sync processes a ride/attraction Experience, THE Catalog_Sync SHALL request that Experience's current-day schedule from the Schedule_Channel and persist a stable `operates_during_early_entry` boolean on the Experience: TRUE when the schedule carries a block whose normalized type is an early-entry type (`EARLY_ENTRY`, `EARLY_PARK_ENTRY`, `EXTRA_MAGIC_HOURS`, `EXTRA_MAGIC_HOUR`), else FALSE. Because Early Entry participation is stable, this value is applied to future planning dates as-is.
9. IF the Schedule_Channel fetch fails or returns no schedule for an Experience, THEN THE Catalog_Sync SHALL leave any previously persisted `operates_during_early_entry` value unchanged (a never-captured Experience's value remains absent/`NULL`), and SHALL record the failure without failing the overall catalog run — mirroring the Menu_Service failure discipline (R8.4).
10. WHEN the App requests an Experience, THE API SHALL expose the Experience's `operatesDuringEarlyEntry` flag through the Experience DTO when persisted.
11. In the same Schedule_Channel capture (R5.8), THE Catalog_Sync SHALL also persist `operates_during_extended_evening` (TRUE iff a block's type is an Extended Evening type — `EXTENDED_EVENING` / `EXTENDED_EVENING_HOURS`) and `operates_during_ticketed_event` (TRUE iff a block's type is a Special Ticketed / after-hours event type — `SPECIAL_TICKETED_EVENT` / `AFTER_HOURS`), else FALSE; the R5.9 failure-isolation rule applies to all three flags together. Note: the `Early Entry`, `Special Ticketed Event`, and `Extended Evening` `scheduleType` strings are all verified against the live gateway (Extended Evening confirmed via the forward `wdw.calendar.1_0` channel — EPCOT on 2026-08-10 carries a `scheduleType: "Extended Evening"` block).

### Requirement 6: Resort as a First-Class Catalog Concept

**User Story:** As a user, I want to see Disney hotel/resort information in the app, so that I can browse resorts alongside experiences.

#### Acceptance Criteria

1. WHEN a Facility_Document has Facility_Type `resort`, THE Catalog_Sync SHALL produce exactly one Resort record for that Facility_Document.
2. THE Catalog_Sync SHALL exclude Facility_Documents with Facility_Type `resort-area` from the Resort set.
3. THE Resort record SHALL carry `name`, `description`, `imageUrl`, `latitude`, `longitude`, `address`, and `phone` copied from the corresponding Facility_Document fields.
4. WHERE a Facility_Document omits `description`, `latitude`, `longitude`, `address`, or `phone`, THE Catalog_Sync SHALL set the corresponding Resort record field to `null`.
5. WHEN a resort Facility_Document carries a `detailImageUrl` or `listImageUrl`, THE Catalog_Sync SHALL populate the Resort record's `imageUrl` from that field, and WHERE neither field is present, THE Catalog_Sync SHALL set `imageUrl` to `null`.
6. THE Resort record SHALL carry a stable Internal_Id derived as UUIDv5 of the Facility_Document Enterprise_Id over the existing fixed namespace.
7. THE Catalog_Cache SHALL persist Resort records such that they remain retrievable across application restarts and subsequent Catalog_Sync runs.
8. WHEN the App requests resorts, THE API SHALL expose each active (non-soft-deleted) Resort record through a DTO containing the Resort record's Internal_Id, `name`, `description`, `imageUrl`, `latitude`, `longitude`, `address`, and `phone`.
9. WHEN a Resort record's source Facility_Document is absent from a later Catalog_Sync run, THE Catalog_Sync SHALL mark the Resort record as soft-deleted while preserving the persisted row and its Internal_Id.
10. WHEN a resort Facility_Document reappears upstream for a previously soft-deleted Resort record, THE Catalog_Sync SHALL reactivate the Resort record using the same Internal_Id.

### Requirement 7: Native Imagery

**User Story:** As a user, I want experiences and resorts to show real Disney images, so that the catalog is visually complete without a separate image-sourcing job.

#### Acceptance Criteria

1. WHEN a Facility_Document carries a non-empty `detailImageUrl`, THE Catalog_Sync SHALL populate the catalog item's `imageUrl` from the `detailImageUrl` value.
2. WHEN a Facility_Document carries a non-empty `listImageUrl` and carries no non-empty `detailImageUrl`, THE Catalog_Sync SHALL populate the catalog item's `imageUrl` from the `listImageUrl` value.
3. WHERE a Facility_Document carries neither a non-empty `detailImageUrl` nor a non-empty `listImageUrl`, THE Catalog_Sync SHALL set the catalog item's `imageUrl` to `null`.
4. WHEN the migration state is complete, THE catalog SHALL source all catalog imagery from the Disney sources and SHALL NOT read catalog imagery from the out-of-band image-sourcing job, the manual image-override file, or object storage.
5. WHEN a catalog item whose `imageUrl` is `null` is displayed, THE App SHALL display a placeholder image corresponding to that item's Experience_Category, or a Resort placeholder image when the item is a Resort.

### Requirement 8: Dining Menus

**User Story:** As a user, I want to see a restaurant's menu with items and prices, so that I can decide where to eat.

#### Acceptance Criteria

1. WHEN Catalog_Sync processes a restaurant Experience, THE Catalog_Sync SHALL request that restaurant's menus from the Menu_Service using the restaurant's Enterprise_Id.
2. WHEN the Menu_Service returns menus, THE Catalog_Sync SHALL persist, per menu, the menu type, cuisine type, and each menu group's name, item names, and item price strings.
3. IF the Menu_Service returns no menus for a restaurant, THEN THE Catalog_Sync SHALL persist no menu for that restaurant and SHALL leave the restaurant Experience otherwise unchanged.
4. IF a request to the Menu_Service fails, THEN THE Catalog_Sync SHALL leave any previously persisted menu for that restaurant unchanged and SHALL record the failure without failing the overall catalog run.
5. WHEN the App requests a restaurant Experience's menu, THE API SHALL expose the persisted menus through a defined DTO.

### Requirement 9: Live Operational Data from Disney

**User Story:** As a user, I want current wait times, showtimes, hours, and walk-up dining availability, so that I can plan my day — sourced first-party from Disney.

#### Acceptance Criteria

1. WHEN the App requests Live_Detail for an Experience, THE API SHALL derive it from the Disney sources using the Experience's Enterprise_Id.
2. THE API SHALL populate Live_Detail `status`, standby `waitMinutes`, and `singleRiderWaitMinutes` from the Experience's document in the Status_Channel.
3. WHERE the Experience is a restaurant, THE API SHALL populate Live_Detail walk-up dining availability from the Experience's document in the Dining_Status_Channel, carrying each party-size entry's status and estimated wait when present.
4. THE API SHALL populate Live_Detail `forecast` from the Experience's document in the Forecast_Channel, carrying each hourly entry's predicted wait minutes and busyness percentage.
5. THE API SHALL populate Live_Detail `showtimes` and `operatingHours` from the Experience's current-day entries in the Schedule_Channel.
6. WHERE a live field is absent or unparseable in the Disney sources, THE API SHALL omit that field from Live_Detail rather than fabricate a value, and SHALL always present `status` (using `Unknown` when absent).
7. THE API SHALL NOT include Lightning Lane return windows or boarding-group information in Live_Detail.
8. THE API SHALL render every Live_Detail time in the Park's local time zone.

### Requirement 10: Identity Continuity and Data Migration

**User Story:** As an existing user, I want my completions, ratings, and notes preserved after the source switch, so that my history is not lost.

#### Acceptance Criteria

1. THE Catalog_Sync SHALL derive each catalog item's Internal_Id as UUIDv5 of the Facility_Document Enterprise_Id over the existing fixed namespace.
2. THE migration SHALL build a Bridge_Map that maps each Facility_Document Enterprise_Id to the Internal_Id previously derived from the ThemeParks.wiki entity id whose `externalId` field equals that Enterprise_Id.
3. WHEN an Experience's Enterprise_Id matches an entry in the Bridge_Map, THE migration SHALL assign that Experience the existing cached Internal_Id from the matching entry.
4. IF an Experience's Enterprise_Id has no matching entry in the Bridge_Map, THEN THE migration SHALL assign the Internal_Id derived per criterion 1 and record the Experience as a new active catalog item.
5. WHEN the migration assigns an Experience an existing cached Internal_Id, THE migration SHALL retain all Completions, Ratings, and Notes that reference that Internal_Id without modification or loss.
6. IF a previously cached Experience has no corresponding Facility_Document after migration, THEN THE Catalog_Sync SHALL soft-delete the cached Experience, preserve the persisted row, and retain all Completions, Ratings, and Notes that reference that Experience's Internal_Id.

### Requirement 11: Reconciliation and Cache Preservation

**User Story:** As an API maintainer, I want the Disney source to reconcile into the cache with the same soft-delete guarantees, so that referential integrity is maintained across syncs.

#### Acceptance Criteria

1. WHEN a Facility_Document is present upstream and absent from the Catalog_Cache, THE Catalog_Sync SHALL insert a new catalog row with active status.
2. WHEN a Facility_Document reappears upstream for a previously soft-deleted catalog row, THE Catalog_Sync SHALL reactivate the row using the same Internal_Id and apply the upstream `name`, `park`, and `category` values.
3. WHEN a cached catalog row's `name`, `park`, or `category` differs from its Facility_Document, THE Catalog_Sync SHALL upsert the row so that those fields equal the upstream values.
4. WHEN a cached catalog row's `name`, `park`, and `category` already equal its Facility_Document, THE Catalog_Sync SHALL leave the row unchanged.
5. WHEN an active cached catalog row has no corresponding Facility_Document upstream, THE Catalog_Sync SHALL soft-delete the row while preserving the persisted row and its Internal_Id.
6. IF any upsert or soft-delete in a Catalog_Sync run fails, THEN THE Catalog_Sync SHALL roll back all cache changes for that run so that the Catalog_Cache is identical to its pre-run state with no partial changes persisted.
7. THE Catalog_Sync SHALL apply all inserts, upserts, and soft-deletes for a single run within one database transaction.
8. THE Catalog_Sync SHALL store each Facility_Document description with all HTML and markup tags removed, leaving plain text only.

### Requirement 12: Upstream Resilience and Risk

**User Story:** As an operator, I want defined behavior when the undocumented Disney sources fail or block us, so that the app degrades gracefully and the risk is visible.

#### Acceptance Criteria

1. IF a Disney source fails to establish a connection or does not return a response within a 10-second request timeout and a prior Catalog_Cache exists, THEN THE API SHALL serve the cached catalog with a staleness indicator conveying that the response was served from cache and the cache's age.
2. IF a Disney source fails to establish a connection or does not return a response within a 10-second request timeout and no prior Catalog_Cache exists, THEN THE API SHALL respond with a `503 catalog_unavailable` error.
3. IF the Disney_Sync_Gateway rejects the Static_Credentials with an authentication or authorization status, THEN THE Catalog_Sync SHALL record the run as failed and leave the prior Catalog_Cache unchanged.
4. WHEN a Catalog_Sync run fails for any reason, THE Catalog_Sync SHALL record the run status as `failed` and retain the prior Catalog_Cache unchanged.
5. THE Catalog_Sync SHALL record the outcome of every run in the sync-run history with a discriminator whose value is one of `success`, `http_status`, `network`, `invalid_response`, or `aborted`.
6. WHILE the Disney sources are reachable, THE API SHALL serve catalog reads from the Catalog_Cache.
7. IF a prior Catalog_Cache exists, THEN THE API SHALL serve the cached catalog rather than respond with a `503 catalog_unavailable` error.
8. THE Catalog_Sync SHALL refresh the Catalog_Cache from the Disney sources on a schedule whose interval does not exceed 24 hours.
9. WHEN the Catalog_Cache is older than 24 hours at the time of a catalog read, THE Catalog_Sync SHALL refresh the Catalog_Cache from the Disney sources.
10. IF a Live_Detail request to a Disney source fails, THEN THE API SHALL surface the failure to the App as a stale or unavailable live result without affecting the Catalog_Cache.

### Requirement 13: Configuration

**User Story:** As an operator, I want all Disney source settings supplied through configuration, so that no provider details or secrets are hard-coded in application logic.

#### Acceptance Criteria

1. THE configuration loader SHALL accept the Disney_Sync_Gateway base URL as an optional configuration value.
2. THE configuration loader SHALL accept the Static_Credentials as two required configuration values: a Basic-auth username and a Basic-auth password.
3. IF the Basic-auth username or the Basic-auth password is absent or an empty string at application startup, THEN THE configuration loader SHALL halt startup before the API accepts any request and SHALL emit an error message that names each missing credential value.
4. THE application modules other than the configuration loader SHALL obtain Disney source settings only through the loaded configuration.
5. WHEN no Disney_Sync_Gateway base URL is configured at application startup, THE configuration loader SHALL supply the default base URL `https://realtime-sync-gw.wdprapps.disney.com/park-platform-pub/` to the application modules.
6. IF a configured Disney source URL is not a well-formed absolute URL, THEN THE configuration loader SHALL halt startup before the API accepts any request and SHALL emit an error message identifying the invalid value.

### Requirement 14: Full Retirement of ThemeParks.wiki

**User Story:** As an API maintainer, I want ThemeParks.wiki removed from every path once Disney is live, so that there is a single source of truth for both catalog and live data.

#### Acceptance Criteria

1. WHEN the migration state is complete, THE API SHALL source all catalog data, all live data, resorts, imagery, and menus exclusively from the Disney sources.
2. WHILE the migration state is complete, THE API SHALL NOT issue any request to ThemeParks.wiki for catalog or live data.
3. THE migration SHALL read the ThemeParks.wiki `externalId` field exactly once, during a one-time Bridge_Map build step, and thereafter SHALL NOT issue any request to ThemeParks.wiki.
4. IF a Disney source becomes unavailable while the migration state is complete, THEN THE API SHALL NOT issue any request to ThemeParks.wiki, and THE API SHALL serve the existing Catalog_Cache marked as stale.
5. THE migration state SHALL be defined as complete once the Bridge_Map has been built and at least one Catalog_Sync run sourced entirely from the Disney sources has succeeded and persisted its results to the Catalog_Cache.
6. WHEN the migration state is complete, THE catalog codebase SHALL exclude the out-of-band Wikimedia/Wikipedia image-sourcing job, comprising the `sourceImages.ts` script and its `source-images` command.
7. WHEN the migration state is complete, THE catalog codebase SHALL exclude the curated image-override file `imageOverrides.json`.
8. WHEN the migration state is complete, THE Catalog_Cache SHALL exclude the `image_attribution` column from the `experiences` persistence and SHALL persist no image-attribution value for any Experience, because Disney-sourced imagery requires no third-party attribution.
9. WHILE the migration state is complete, THE Catalog_Sync SHALL be the sole writer of each catalog item's `image_url`, populating it through reconciliation from the Disney-provided `imageUrl` defined in Requirement 7.

### Requirement 15: Scope Boundaries and Excluded Data

**User Story:** As a stakeholder, I want the migration's boundaries explicit, so that unrelated or unreachable concerns are not silently pulled in.

#### Acceptance Criteria

1. THE Catalog_Sync SHALL limit catalog coverage to Walt Disney World Resort by enumerating only the Facilities_Channel `wdw.facilities.1_0.en_us`.
2. THE Catalog_Sync SHALL NOT request any facilities channel other than `wdw.facilities.1_0.en_us`, thereby excluding Disneyland Resort and all non-Walt Disney World destinations.
3. WHERE a Disney data source or operation requires per-guest authentication, THE feature SHALL exclude that data source or operation, sending only the Static_Credentials or Public_Token and no per-guest credentials.
4. THE feature SHALL exclude Lightning Lane return windows (`returnWindow` and `paidReturnWindow`) from Live_Detail, because that data is available only through per-guest authenticated, entitlement-based Disney endpoints.
5. THE feature SHALL exclude boarding-group / virtual-queue information from Live_Detail, because the Disney virtual-queue service requires per-guest authentication.
6. THE feature SHALL exclude the Individual Lightning Lane price from the catalog and Live_Detail.

### Requirement 16: Browsing Theme Parks and Resorts Separately

**User Story:** As a user, I want theme-park experiences and resort experiences presented in separate sections, so that I can browse the parks and the hotels without them being mixed together.

#### Acceptance Criteria

1. WHEN the App displays the catalog, THE App SHALL present Experiences grouped by Area_Type so that `ThemePark`, `WaterPark`, `DisneySprings`, and `Resort` experiences appear in distinct sections or tabs.
2. WHEN the App displays `Resort`-area Experiences, THE App SHALL group them under their specific Resort.
3. WHEN the App offers catalog filtering, THE App SHALL allow the user to filter Experiences by Area_Type.
4. THE App SHALL continue to allow filtering Experiences by Experience_Category within any Area_Type section.
5. WHERE a Resort has no associated Experiences, THE App SHALL still present the Resort as a browsable item.
