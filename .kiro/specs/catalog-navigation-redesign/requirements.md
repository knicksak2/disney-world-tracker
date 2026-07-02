# Requirements Document

## Introduction

The mobile catalog is currently one long, flat scroll of several hundred active Experiences, driven by two filter-chip rows (Area_Type and Experience_Category) and a search box. Finding a specific Experience is hard, and the grouping (by Area_Type) does not match how guests think about the parks — they think in terms of *where they are* (which park, which land) rather than an abstract area classification. The Experience detail view also under-surfaces the metadata the catalog already persists: it shows the Park and little else, even though the DTO already carries a price tier, accessibility tags, coordinates, meal periods, menus, area type, and resort reference.

This feature redesigns catalog navigation into a two-level drill-down with always-available global search (the confirmed "Option A" direction), and enriches the detail view. It is a full vertical slice, not a UI-only change:

1. **New data — Land.** Each Disney Facility_Document carries an ancestor chain in which a `land`-type ancestor (e.g. Fantasyland, Tomorrowland) is present for theme-park and water-park Experiences. Land is not currently captured or persisted. This feature resolves the Land from that ancestor during Catalog_Sync, persists it via an additive migration, and reconciles it with the same soft-delete/upsert discipline the catalog already uses.
2. **API + shared DTO.** The Experience DTO gains a `land` field, and the catalog read endpoints make Land available and filterable alongside the existing `parkId`, `category`, `areaType`, and `q` filters.
3. **Mobile drill-down.** The catalog screen becomes a Catalog_Home destination grid (Level 1) plus a per-Destination screen (Level 2). Theme parks and water parks group their Experiences by Land as collapsible sections with Experience_Category acting as a filter on top; Disney Springs groups by Experience_Category; the Resorts Destination groups by specific Resort. Global search from Catalog_Home searches the entire catalog so locating a specific Experience never requires drilling in.
4. **Enriched detail.** The Experience detail view surfaces the persisted enrichment (Land, price tier, accessibility, coordinates, meal periods, area/resort) as compact Info_Tags, rendered only when the data is present.

This feature builds directly on the completed `disney-facilities-catalog-source` spec and reuses its vocabulary (Facility_Document, ancestor chain, Enterprise_Id, Catalog_Sync, Catalog_Cache, `resolveArea`, Area, Area_Type, Park, Resort, Internal_Id). Scope is limited to Walt Disney World. The redesign must preserve existing user data (Completions, Ratings, Notes reference the stable Experience Internal_Id, whose derivation does not change) and must not regress the catalog's resilience behaviors (stale-cache serving, `catalog_unavailable`), image placeholders, tap-to-detail navigation, or react-query caching.

## Glossary

- **Catalog_Sync**: The existing orchestrator that fetches Disney Facility_Documents, classifies and enriches them, reconciles the result against the Catalog_Cache within one transaction, and records the run outcome. Reused unchanged except to additionally resolve and persist Land.
- **Catalog_Cache**: The existing local persisted catalog (the `experiences` table and Resort persistence) plus its sync metadata.
- **API**: The API-side Catalog_Service that serves catalog reads (`GET /catalog`, `GET /catalog/:experienceId`, `GET /resorts`) to the App.
- **App**: The Disney World Tracker mobile application (`apps/mobile`).
- **Facility_Document**: One Disney entity document, carrying an ancestor chain used to resolve the owning Area (and now the Land).
- **Ancestor_Chain**: The ordered set of ancestor references on a Facility_Document that `resolveArea` walks. The App-side adapter synthesizes it from the flat `ancestor*` fields, including an `ancestorLand`/`ancestorLandId` pair.
- **Land_Ancestor**: The entry in a Facility_Document's Ancestor_Chain whose ancestor Facility_Type is `land` (e.g. Fantasyland, Tomorrowland). Present only for Experiences within a theme park or water park.
- **Land**: The themed area within a theme park or water park to which an Experience belongs, resolved from the name of the Land_Ancestor. Land is meaningful only for `ThemePark` and `WaterPark` Area_Types; it is `null` for `DisneySprings` and `Resort` Experiences.
- **Land_Catchall**: The single defined, stable presentation grouping used for a `ThemePark` or `WaterPark` Experience that has no persisted Land, so that grouping by Land never omits an Experience.
- **Experience**: An existing catalog item (Ride, Show, Restaurant, Parade, Character_Meet, Tour, Recreation, Spa, Event, or Other) surfaced to the App.
- **Experience_Category**: The existing closed classification set (`Ride`, `Show`, `Restaurant`, `Parade`, `Character_Meet`, `Tour`, `Recreation`, `Spa`, `Event`, `Other`).
- **Area_Type**: The existing closed classification of the place an Experience belongs to (`ThemePark`, `WaterPark`, `DisneySprings`, `Resort`).
- **Park**: One of the four WDW theme parks, the two water parks, or Disney Springs.
- **Resort**: The existing first-class catalog concept representing a Disney hotel/resort; a `Resort`-area Experience references a specific Resort's Internal_Id.
- **Internal_Id**: The stable internal identifier for a catalog item (UUIDv5 of the Enterprise_Id). Unchanged by this feature.
- **Destination**: A top-level browse target presented on Catalog_Home. The Destination set is: each of the four theme parks, each of the two water parks, Disney Springs, and a single aggregate **Resorts** Destination.
- **Catalog_Home**: The Level 1 mobile screen presenting the Destination grid and the global search control.
- **Destination_Screen**: The Level 2 mobile screen presenting the Experiences of one selected Destination.
- **Experience_Detail_Screen**: The existing mobile screen presenting a single Experience's detail, enriched by this feature.
- **Info_Tag**: A compact, labelled indicator on a list row or the Experience_Detail_Screen surfacing one persisted enrichment value (e.g. Land, price tier, an accessibility tag).

## Requirements

### Requirement 1: Capture Land During Catalog Sync

**User Story:** As a guest, I want each theme-park and water-park Experience associated with its land, so that the catalog can group Experiences the way I think about the parks.

#### Acceptance Criteria

1. WHEN Catalog_Sync processes an Experience whose Area_Type is `ThemePark` or `WaterPark` and whose Facility_Document Ancestor_Chain contains at least one Land_Ancestor, THE Catalog_Sync SHALL resolve the Experience's Land from the name of the Land_Ancestor nearest to the Experience in the Ancestor_Chain.
2. WHEN Catalog_Sync resolves a Land value, THE Catalog_Sync SHALL store the Land as the Land_Ancestor name with leading and trailing whitespace removed and with its original character casing preserved.
3. WHERE an Experience whose Area_Type is `ThemePark` or `WaterPark` has no Land_Ancestor in its Ancestor_Chain, THE Catalog_Sync SHALL set the Experience's Land to `null`.
4. WHERE an Experience whose Area_Type is `ThemePark` or `WaterPark` has a Land_Ancestor whose name is absent or consists only of whitespace, THE Catalog_Sync SHALL set the Experience's Land to `null`.
5. WHERE an Experience's Area_Type is `DisneySprings` or `Resort`, THE Catalog_Sync SHALL set the Experience's Land to `null`.
6. WHEN Catalog_Sync resolves an Experience's Land, THE Catalog_Sync SHALL resolve the Experience's Area_Type, Park, and Resort reference using the same values it resolves today.
7. WHERE a resolved Land value would exceed 200 characters, THE Catalog_Sync SHALL store at most the first 200 characters as the Experience's Land, consistent with the existing Experience name length constraint.

### Requirement 2: Persist and Reconcile Land

**User Story:** As an API maintainer, I want Land persisted and reconciled with the existing cache discipline, so that Land survives restarts and syncs without disturbing referential integrity.

#### Acceptance Criteria

1. THE Catalog_Cache SHALL persist each Experience's Land value, including a persisted `null`, such that the persisted Land remains retrievable unchanged across application restarts and across subsequent Catalog_Sync runs that do not modify it.
2. THE migration that adds Land SHALL add the Land field to the Experience persistence as an additive change that preserves every existing Experience row and its Internal_Id.
3. WHEN the migration that adds Land completes and before the first subsequent Catalog_Sync run resolves Land, THE Catalog_Cache SHALL represent the Land of every pre-existing Experience row as `null`.
4. WHEN a cached Experience's persisted Land differs from the Land resolved from its Facility_Document, THE Catalog_Sync SHALL upsert the row so that the persisted Land equals the resolved Land.
5. WHEN a cached Experience's persisted Land already equals the Land resolved from its Facility_Document, THE Catalog_Sync SHALL leave the persisted Land unchanged.
6. WHEN Catalog_Sync runs two or more consecutive times over the same Facility_Documents with no intervening change to those Facility_Documents, THE Catalog_Cache SHALL hold the same persisted Land value for each Experience after every such run.
7. WHEN Catalog_Sync soft-deletes or reactivates an Experience, THE Catalog_Sync SHALL apply the existing soft-delete and Internal_Id rules while retaining the Experience's persisted Land.
8. IF applying Land changes within a Catalog_Sync run fails, THEN THE Catalog_Sync SHALL roll back all cache changes for that run so that the Catalog_Cache, including its sync metadata, is identical to its pre-run state, and SHALL record the run outcome as failed.

### Requirement 3: Expose and Filter Land Through the API

**User Story:** As a mobile developer, I want Land exposed on the Experience DTO and filterable through the catalog API, so that the App can group and drill down by land.

#### Acceptance Criteria

1. WHEN the API returns an Experience through the Experience DTO and a Land is persisted for that Experience, THE API SHALL include the persisted Land value in the DTO.
2. WHERE no Land is persisted for an Experience, THE API SHALL represent the Experience's Land as `null` or absent in the Experience DTO.
3. THE API SHALL expose Land through the Experience DTO on both the `GET /catalog` list response and the `GET /catalog/:experienceId` detail response.
4. WHERE a `GET /catalog` request carries a Land filter value, THE API SHALL return only active Experiences whose persisted Land is exactly equal, as a case-sensitive string comparison, to the supplied Land filter value.
5. THE API SHALL continue to accept the existing `parkId`, `category`, `areaType`, and `q` query parameters on `GET /catalog` with their current behavior.
6. WHEN the App requests catalog data for Catalog_Home, THE API SHALL provide, for each of the eight Destinations (the four theme parks, the two water parks, Disney Springs, and the aggregate Resorts Destination), the count of active Experiences belonging to that Destination, where the Resorts Destination count aggregates every active `Resort`-area Experience.
7. WHERE a `GET /catalog` request carries a Land filter value together with any combination of the `parkId`, `category`, `areaType`, or `q` query parameters, THE API SHALL return only active Experiences that simultaneously satisfy the Land filter value and every other supplied parameter.
8. IF a `GET /catalog` request carries a Land filter value that matches no active Experiences, THEN THE API SHALL return an empty Experience list in a success response without an error.

### Requirement 4: Catalog Home Destination Grid

**User Story:** As a guest, I want to pick where I am from a compact grid of destinations, so that I can start browsing from a place that matches my mental model of the parks.

#### Acceptance Criteria

1. WHEN a user opens the Catalog tab, THE Catalog_Home SHALL present a grid of Destination cards ordered as the four theme parks, then the two water parks, then Disney Springs, then the Resorts Destination.
2. THE Catalog_Home SHALL display a representative image on each Destination card.
3. WHERE no representative image is available for a Destination, THE Catalog_Home SHALL display a bundled placeholder image for that Destination card.
4. THE Catalog_Home SHALL display on each Destination card the count of active Experiences belonging to that Destination.
5. THE Catalog_Home SHALL display on the Resorts Destination card a count equal to the aggregate number of active `Resort`-area Experiences across all Resorts.
6. WHERE a Destination has zero active Experiences, THE Catalog_Home SHALL display that Destination card with a count of zero.
7. WHILE the Destination data is being fetched and no prior data is available, THE Catalog_Home SHALL display a loading state.
8. WHEN a user selects a Destination card, THE App SHALL navigate to the Destination_Screen for that Destination.

### Requirement 5: Global Search From Catalog Home

**User Story:** As a guest, I want to search the entire catalog from the top level, so that finding a specific experience never requires drilling into a destination first.

#### Acceptance Criteria

1. THE Catalog_Home SHALL present a search control at the top level.
2. WHEN the search query changes and contains at least one non-whitespace character, THE App SHALL, no earlier than 300 milliseconds after the most recent change to the search query, request matching active Experiences across the entire catalog — including Experiences of every Area_Type (`ThemePark`, `WaterPark`, `DisneySprings`, and `Resort`) — through the `q` query parameter.
3. WHILE a search query containing at least one non-whitespace character is active, THE Catalog_Home SHALL present the matching Experiences as a flat, tappable result list in place of the Destination grid, and SHALL display on each result row the Experience's Destination and, where the Experience has a persisted Land, its Land.
4. WHEN a user selects a search result, THE App SHALL navigate to the Experience_Detail_Screen for that Experience.
5. WHEN the search query is cleared to contain no non-whitespace characters, THE Catalog_Home SHALL restore the Destination grid in place of the result list.
6. WHERE an active search query matches no Experiences, THE Catalog_Home SHALL display an empty-results state indicating that no Experiences matched the query while retaining the active search query in the search control.
7. IF a search request fails to return matching Experiences, THEN THE Catalog_Home SHALL display a search-error state indicating that the search could not be completed while retaining the active search query in the search control.

### Requirement 6: Theme Park and Water Park Destination Screen

**User Story:** As a guest, I want a theme park or water park's experiences grouped by land with a category filter, so that I can browse by area the way the park is laid out.

#### Acceptance Criteria

1. WHEN the Destination_Screen opens for a `ThemePark` or `WaterPark` Destination, THE App SHALL request that Destination's active Experiences from the API.
2. THE Destination_Screen SHALL group the Destination's Experiences by Land as the primary grouping, ordering the named Land sections in case-insensitive ascending alphabetical order by Land name.
3. THE Destination_Screen SHALL order the Experiences within each Land section in case-insensitive ascending alphabetical order by Experience name.
4. WHEN the Destination_Screen opens, THE Destination_Screen SHALL render each Land group as a collapsible section in the expanded state.
5. WHEN a user toggles a Land section, THE App SHALL expand or collapse that section's Experiences.
6. WHERE a `ThemePark` or `WaterPark` Experience in the Destination has no persisted Land, THE Destination_Screen SHALL place that Experience in the Land_Catchall section, positioned after all named Land sections, so that no Experience in the Destination is omitted.
7. THE Destination_Screen SHALL provide an Experience_Category filter scoped to the Destination, defaulting to no active Experience_Category so that all Experiences are shown.
8. WHILE an Experience_Category filter is active, THE Destination_Screen SHALL display only Experiences of the selected Experience_Category while preserving the Land grouping and section ordering.
9. WHILE an Experience_Category filter is active, IF a Land section contains no Experience of the selected Experience_Category, THEN THE Destination_Screen SHALL omit that Land section from the display.
10. WHEN a user selects an Experience row, THE App SHALL navigate to the Experience_Detail_Screen for that Experience.

### Requirement 7: Disney Springs Destination Screen

**User Story:** As a guest, I want Disney Springs experiences grouped by category, so that I can browse it sensibly even though it has no lands.

#### Acceptance Criteria

1. WHEN the Destination_Screen opens for the Disney Springs Destination, THE App SHALL request Disney Springs active Experiences from the API.
2. THE Disney Springs Destination_Screen SHALL group the Experiences by Experience_Category and order the category groups in the canonical Experience_Category order (Ride, Show, Restaurant, Parade, Character_Meet, Tour, Recreation, Spa, Event, Other).
3. THE Disney Springs Destination_Screen SHALL render each Experience_Category group as a collapsible section, consistent with the Land sections of the `ThemePark` and `WaterPark` Destination_Screen.
4. WHEN a user toggles an Experience_Category section, THE App SHALL expand or collapse that section's Experiences.
5. WHERE an Experience_Category has zero active Experiences in the Disney Springs Destination, THE Disney Springs Destination_Screen SHALL omit that Experience_Category group.
6. WHEN a user selects an Experience row, THE App SHALL navigate to the Experience_Detail_Screen for that Experience.
7. WHERE the Disney Springs Destination has zero active Experiences, THE Disney Springs Destination_Screen SHALL display an empty state.

### Requirement 8: Resorts Destination Screen

**User Story:** As a guest, I want resort experiences grouped by specific resort, so that I can browse dining and recreation by the hotel I care about.

#### Acceptance Criteria

1. WHEN the Destination_Screen opens for the Resorts Destination, THE App SHALL request active `Resort`-area Experiences and active Resorts from the API.
2. THE Resorts Destination_Screen SHALL group each active `Resort`-area Experience under its specific Resort by matching the Experience's referenced Resort Internal_Id to that Resort's Internal_Id.
3. THE Resorts Destination_Screen SHALL list every active Resort as a browsable anchor row ordered alphabetically by Resort name using case-insensitive comparison, including a Resort that has no associated active Experiences.
4. WHERE a `Resort`-area Experience references no specific Resort or references a Resort Internal_Id that matches no active Resort, THE Resorts Destination_Screen SHALL list that Experience under a single resort-wide catch-all group positioned after all specific Resort groups.
5. WHEN a user selects an Experience row, THE App SHALL navigate to the Experience_Detail_Screen for that Experience.
6. WHEN a user selects a Resort anchor row, THE Resorts Destination_Screen SHALL scroll to that Resort's group and remain on the Resorts Destination_Screen.
7. WHERE a listed Resort has no associated active Experiences, THE Resorts Destination_Screen SHALL display an empty-group indication for that Resort's group.

### Requirement 9: Enriched Experience Detail

**User Story:** As a guest, I want the detail page to surface richer per-experience information, so that I can make better decisions than the park name alone allows.

#### Acceptance Criteria

1. WHEN the Experience_Detail_Screen renders an Experience, THE Experience_Detail_Screen SHALL display the Experience's Park using the presentation it uses today.
2. WHERE an Experience has a persisted Land, THE Experience_Detail_Screen SHALL display a Land Info_Tag.
3. WHERE an Experience has a persisted price tier, THE Experience_Detail_Screen SHALL display a price-tier Info_Tag.
4. WHERE an Experience has persisted accessibility tags, THE Experience_Detail_Screen SHALL display one accessibility Info_Tag per accessibility tag in the persisted order of those tags.
5. WHERE an Experience has persisted coordinates, THE Experience_Detail_Screen SHALL display a coordinates Info_Tag containing the Experience's latitude and longitude values.
6. WHERE an Experience has persisted meal periods, THE Experience_Detail_Screen SHALL display one Info_Tag per meal period.
7. WHERE an Experience's Area_Type is `Resort` and the Experience references a specific Resort, THE Experience_Detail_Screen SHALL display the specific Resort as an Info_Tag.
8. WHERE a persisted enrichment value for an Experience is absent, or is an empty collection, THE Experience_Detail_Screen SHALL omit that value's Info_Tag rather than display an Info_Tag with an empty value.
9. WHERE an Experience is a Restaurant with a persisted price tier, THE App SHALL display a compact price-tier Info_Tag on that Experience's list row using the same label text and value presentation as the price-tier Info_Tag on the Experience_Detail_Screen.
10. THE Experience_Detail_Screen SHALL continue to render the existing description, dining menus, live operational section, completion, rating, and note sections.
11. WHEN the Experience_Detail_Screen displays Info_Tags, THE Experience_Detail_Screen SHALL order them as Land, price tier, accessibility, coordinates, meal period, then specific Resort, omitting any absent Info_Tag while preserving the relative order of those present.

### Requirement 10: Preserve Existing Catalog Behaviors

**User Story:** As a guest, I want the redesigned catalog to keep working when Disney data is stale or unavailable and to keep showing images and detail, so that the redesign does not regress current reliability.

#### Acceptance Criteria

1. WHEN a catalog response carries a stale-cache indicator, THE App SHALL display a stale-cache indicator on the Catalog_Home and the Destination_Screen presenting that response.
2. IF the API returns a `catalog_unavailable` error for a catalog surface and no prior cached data is available for that surface, THEN THE App SHALL display the full-screen catalog-unavailable state on that surface without automatic retry.
3. IF the API returns a `catalog_unavailable` error for a catalog surface and prior cached data is available for that surface, THEN THE App SHALL present the cached data with a stale-cache indicator.
4. WHERE an Experience has a `null` image URL, THE App SHALL display the Experience_Category placeholder image for that Experience.
5. WHERE a Resort has a `null` image URL, THE App SHALL display the Resort placeholder image for that Resort.
6. THE App SHALL cache catalog reads through react-query using the existing staleness interval.
7. WHEN a user selects an Experience on the Catalog_Home search result list or a Destination_Screen, THE App SHALL navigate to the Experience_Detail_Screen for that Experience.
8. WHEN a user opens the Experience_Detail_Screen for a soft-deleted Experience reachable through the user's Completion, Rating, or Note, THE Experience_Detail_Screen SHALL render that Experience's detail.

### Requirement 11: Identity and Data Preservation

**User Story:** As an existing user, I want my completions, ratings, and notes preserved through the redesign, so that adding Land and reorganizing the UI does not lose my history.

#### Acceptance Criteria

1. WHEN Catalog_Sync derives an Experience's Internal_Id, THE Catalog_Sync SHALL derive it as the UUIDv5 of the Experience's Enterprise_Id, such that for a given Enterprise_Id the derived Internal_Id is identical to the value derived before this feature.
2. WHEN the migration that adds Land completes, THE migration SHALL retain every existing Completion, Rating, and Note row so that the count of each is unchanged from its pre-migration value and each retained row continues to reference the same Experience Internal_Id it referenced before the migration.
3. IF the migration that adds Land fails, THEN THE migration SHALL roll back all of its changes so that every existing Completion, Rating, and Note and every Experience Internal_Id is identical to its pre-migration state, and SHALL surface an error indicating that the migration failed.
4. THE feature SHALL source all catalog data from Walt Disney World only.

### Requirement 12: Accessibility of the Redesigned Navigation

**User Story:** As a guest using assistive technology, I want the new navigation to be screen-reader friendly, so that I can browse destinations, sections, and filters like every other user.

#### Acceptance Criteria

1. THE Catalog_Home SHALL provide a screen-reader label for each Destination card that includes the Destination name and its active Experience count as a numeric value.
2. THE Destination_Screen SHALL expose to assistive technologies, for each Land section, a state value of either "expanded" or "collapsed" that reflects the section's current visual state.
3. THE Destination_Screen SHALL provide, for each Experience_Category filter control, an accessible label that includes the category name and a selected or not-selected state value.
4. THE Catalog_Home SHALL provide an accessible label for the global search control that identifies it as the search input.
5. THE App SHALL provide a screen-reader-accessible text alternative for each Info_Tag that conveys the Info_Tag's meaning.
6. WHEN a guest navigates from the Catalog_Home into a Destination_Screen, THE App SHALL move keyboard and screen-reader focus to the Destination_Screen's primary heading.
7. WHEN a guest navigates back from a Destination_Screen to the Catalog_Home, THE App SHALL restore focus to the Destination card that was activated to open that Destination_Screen.
8. WHEN the set of visible Experiences on the Destination_Screen changes as a result of a filter or search action, THE App SHALL announce the updated result count to assistive technologies within 1 second.
