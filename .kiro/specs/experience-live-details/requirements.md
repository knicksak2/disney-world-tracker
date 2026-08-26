# Requirements Document

## Introduction

This feature enriches the Experience detail view in the Disney World Tracker App with live, category-specific operational information sourced from the ThemeParks.wiki API. Today the detail view shows only static catalog fields (name, Park, Experience_Category, description, and an optional image). This feature adds a live layer that surfaces information relevant to each Experience_Category: current operating status and standby wait times for rides and character meet-and-greets, current-day performance schedules for shows and parades, and operating status and operating hours for restaurants.

Live operational data is provided by the existing upstream source, the ThemeParks.wiki API, through its per-entity live endpoint (`/entity/{id}/live`). Unlike the catalog data — which changes slowly and is refreshed at most once every 24 hours — live data is volatile (wait times and statuses change minute to minute). This feature therefore introduces a separate retrieval and short-lived caching path, distinct from the existing Catalog_Sync, so that the detail view reflects near-real-time conditions without overwhelming the upstream API.

**Scope note on restaurant menus.** The original request mentioned restaurant menus. The ThemeParks.wiki API does not expose menu content (it provides dining operating status, operating hours, and reservation/availability windows, but not dish-level menus). The requirements below therefore scope restaurant enrichment to the dining information that the upstream source actually provides. Sourcing menus would require a separate, additional upstream provider and is documented as an open decision in the Assumptions section rather than committed here.

## Glossary

- **App**: The Disney World Tracker mobile application as a whole.
- **Experience**: An individual catalog item at Walt Disney World, such as a ride, show, restaurant, parade, character meet-and-greet, or other activity.
- **Experience_Category**: The classification of an Experience. Allowed values are Ride, Show, Restaurant, Parade, Character_Meet, and Other.
- **Park**: One of the four Walt Disney World theme parks (Magic Kingdom, EPCOT, Hollywood Studios, Animal Kingdom), the two water parks (Typhoon Lagoon, Blizzard Beach), or Disney Springs.
- **Catalog_Service**: The existing component responsible for sourcing Experience data from the ThemeParks_API, maintaining a local cache, and serving the list and detail of Experiences to the App.
- **ThemeParks_API**: The public ThemeParks.wiki HTTP API (version 1, base URL https://api.themeparks.wiki/v1) used as the upstream source of Walt Disney World data.
- **ThemeParks_Live_Endpoint**: The ThemeParks_API endpoint `/entity/{id}/live`, which returns volatile operational data (operating status, queue/wait times, performance schedules, operating hours) for an entity and its children.
- **Live_Service**: The component responsible for retrieving live operational data for an Experience from the ThemeParks_Live_Endpoint, caching it for a short period, and serving it to the App detail view.
- **Live_Detail**: The category-specific live operational information served by the Live_Service for a single Experience, comprising some combination of Operating_Status, Wait_Time, Single_Rider_Wait, Return_Window, Paid_Return_Window, Boarding_Group_Status, Wait_Time_Forecast, Showtimes, Operating_Hours, Dining_Availability, and Upstream_Last_Updated as applicable to the Experience_Category.
- **Operating_Status**: The current operational state of an Experience. Allowed values are Operating, Closed, Down, Refurbishment, and Unknown.
- **Wait_Time**: The posted standby queue wait for an Experience, expressed as a whole number of minutes greater than or equal to 0, or absent when no standby wait is posted.
- **Showtime**: A scheduled performance occurrence for a Show or Parade Experience on the current day in the Park's local time zone, comprising a start time, an optional end time, and an optional Showtime_Type.
- **Operating_Hours**: The opening and closing times for a Restaurant Experience on the current day in the Park's local time zone, optionally carrying an Operating_Hours_Type.
- **Live_Cache**: The short-lived local store of the most recently retrieved Live_Detail for each Experience, keyed by the Experience's stable internal identifier.
- **Live_Cache_TTL**: The freshness window for cached Live_Detail; cached data older than this window is considered stale and triggers a fresh retrieval on the next request.
- **Retrieved_At**: The time at which a served Live_Detail was retrieved from the ThemeParks_API.
- **Single_Rider_Wait**: The posted single rider line wait for a Ride or Character_Meet Experience, expressed as a whole number of minutes greater than or equal to 0, or absent when no single rider line wait is posted.
- **Return_Window**: A Lightning Lane or virtual return-time queue for a Ride or Character_Meet Experience, comprising a state of Available, Temporarily_Full, or Finished, an optional return-window start time, and an optional return-window end time, the times expressed in the Park's local time zone.
- **Paid_Return_Window**: A Return_Window for a paid Lightning Lane queue that additionally carries a price comprising an amount, a currency, and a formatted price string supplied by the ThemeParks_API.
- **Boarding_Group_Status**: A virtual queue (boarding group) state for a Ride or Character_Meet Experience, comprising an allocation status of Available, Paused, or Closed, an optional current boarding group start number, an optional current boarding group end number, an optional next allocation time expressed in the Park's local time zone, and an optional estimated wait in whole minutes.
- **Wait_Time_Forecast**: A best-effort, optional series of predicted standby conditions for a Ride or Character_Meet Experience across hours of the current day, each entry comprising a forecast time in the Park's local time zone, a predicted standby wait in whole minutes, and a percentage from 0 to 100 inclusive representing a relative busyness index where higher values indicate busier conditions.
- **Showtime_Type**: A label supplied by the ThemeParks_API distinguishing a Showtime offering, such as a regular performance versus a special offering (for example a dessert-party performance).
- **Operating_Hours_Type**: A label supplied by the ThemeParks_API distinguishing a set of Operating_Hours, such as Early Entry, Operating, or Extended Evening.
- **Dining_Availability**: A walk-up waitlist offering for a Restaurant Experience, comprising zero or more entries, each entry comprising an optional party size and an optional estimated wait in whole minutes for that party size.
- **Upstream_Last_Updated**: The freshness timestamp the ThemeParks_API reports for an entity's live data, indicating when the upstream source itself last updated the data; distinct from Retrieved_At, which is when the Live_Service fetched the data.

## Requirements

### Requirement 1: Live Data Retrieval and Projection

**User Story:** As a User, I want the App to pull current operational data for an Experience from the upstream source, so that the detail view reflects near-real-time conditions in the park.

#### Acceptance Criteria

1. WHEN the App requests Live_Detail for an Experience, THE Live_Service SHALL resolve the upstream entity ID for that Experience from the one-to-one mapping maintained by the Catalog_Service and request the ThemeParks_Live_Endpoint using that upstream entity ID.
2. WHEN the ThemeParks_API returns a successful live response for an Experience, THE Live_Service SHALL project that response into a Live_Detail containing only the Operating_Status, the Wait_Time, the current-day Showtimes, and the current-day Operating_Hours that are present in the response.
3. WHEN the ThemeParks_API live response contains a recognized status value, THE Live_Service SHALL map that value to an Operating_Status of Operating, Closed, Down, or Refurbishment.
4. IF the ThemeParks_API live response contains a status value that the Live_Service does not recognize or omits the status entirely, THEN THE Live_Service SHALL assign an Operating_Status of Unknown.
5. THE Live_Service SHALL represent a posted standby Wait_Time as a whole number of minutes from 0 to 1440 inclusive.
6. IF the ThemeParks_API live response provides no posted standby wait time for an Experience, or provides a standby wait time that is not a whole number or falls outside the range 0 to 1440 inclusive, THEN THE Live_Service SHALL represent the Wait_Time as absent.
7. THE Live_Service SHALL represent each Showtime with a start time and an optional end time expressed in the Park's local time zone for the current day.
8. IF the ThemeParks_API live response cannot be parsed into the expected live shape, or the ThemeParks_API returns a non-success response, THEN THE Live_Service SHALL treat the retrieval as a failed retrieval and SHALL retain any existing cached Live_Detail for that Experience unchanged.
9. IF the Catalog_Service mapping cannot resolve an upstream entity ID for the requested Experience, THEN THE Live_Service SHALL treat the retrieval as a failed retrieval and SHALL NOT request the ThemeParks_Live_Endpoint.
10. WHEN the ThemeParks_API returns a successful live response for an Experience, THE Live_Service SHALL project into the Live_Detail each of the Single_Rider_Wait, Return_Window, Paid_Return_Window, Boarding_Group_Status, Wait_Time_Forecast, Showtime_Type, Operating_Hours_Type, Dining_Availability, and Upstream_Last_Updated fields that are present in the response, and SHALL represent as absent each such field that is not present in the response.
11. THE Live_Service SHALL represent a Single_Rider_Wait as a whole number of minutes from 0 to 1440 inclusive.
12. IF the ThemeParks_API live response provides no single rider line wait for an Experience, or provides a single rider line wait that is not a whole number or falls outside the range 0 to 1440 inclusive, THEN THE Live_Service SHALL represent the Single_Rider_Wait as absent.
13. WHEN the ThemeParks_API live response contains a return-time queue for an Experience, THE Live_Service SHALL project a Return_Window with a state mapped to Available, Temporarily_Full, or Finished, an optional return-window start time, and an optional return-window end time expressed in the Park's local time zone.
14. WHEN the ThemeParks_API live response contains a paid return-time queue for an Experience, THE Live_Service SHALL project a Paid_Return_Window comprising the same fields as a Return_Window plus the price amount, the price currency, and the formatted price string exactly as provided by the ThemeParks_API.
15. WHEN the ThemeParks_API live response contains a boarding group queue for an Experience, THE Live_Service SHALL project a Boarding_Group_Status with an allocation status mapped to Available, Paused, or Closed, an optional current boarding group start number, an optional current boarding group end number, an optional next allocation time expressed in the Park's local time zone, and an optional estimated wait represented as a whole number of minutes from 0 to 1440 inclusive.
16. WHEN the ThemeParks_API live response contains a forecast for an Experience, THE Live_Service SHALL project a Wait_Time_Forecast as an ordered series of entries, each entry comprising a forecast time expressed in the Park's local time zone, a predicted standby wait represented as a whole number of minutes from 0 to 1440 inclusive, and a percentage from 0 to 100 inclusive.
17. IF the ThemeParks_API live response omits the forecast for an Experience, or contains a forecast that cannot be parsed into the expected Wait_Time_Forecast shape, THEN THE Live_Service SHALL represent the Wait_Time_Forecast as absent and SHALL still project the remaining live fields that are present.
18. WHEN the ThemeParks_API live response contains showtime entries for an Experience, THE Live_Service SHALL project each Showtime's Showtime_Type when the type label is present in the response, and SHALL represent the Showtime_Type as absent for a Showtime whose type label is not present.
19. WHEN the ThemeParks_API live response contains operating hours entries for an Experience, THE Live_Service SHALL project each set of Operating_Hours together with its Operating_Hours_Type when the type label is present in the response, and SHALL represent the Operating_Hours_Type as absent when the type label is not present.
20. WHEN the ThemeParks_API live response contains a dining walk-up availability list for an Experience, THE Live_Service SHALL project a Dining_Availability comprising one entry per provided list item, each entry carrying the party size when present and the estimated wait represented as a whole number of minutes from 0 to 1440 inclusive when present, independently of whether the response contains Operating_Hours.
21. IF the ThemeParks_API live response provides no dining walk-up availability list for an Experience, or provides an empty list, THEN THE Live_Service SHALL represent the Dining_Availability as an empty Dining_Availability.
22. WHEN the ThemeParks_API live response provides the upstream freshness timestamp for an Experience, THE Live_Service SHALL project that timestamp as the Upstream_Last_Updated, distinct from the Retrieved_At time, and SHALL represent the Upstream_Last_Updated as absent when the response provides no such timestamp.

### Requirement 2: Live Data Freshness and Caching

**User Story:** As a User, I want live information to be current but to load quickly, so that I see up-to-date conditions without long waits or excessive upstream load.

#### Acceptance Criteria

1. WHEN the App requests Live_Detail for an Experience and either no Live_Detail for that Experience exists in the Live_Cache or the cached Live_Detail age strictly exceeds the Live_Cache_TTL, THE Live_Service SHALL retrieve fresh live data from the ThemeParks_API before serving the response.
2. WHEN the App requests Live_Detail for an Experience and a cached Live_Detail for that Experience exists in the Live_Cache with an age of the Live_Cache_TTL or less, THE Live_Service SHALL serve the cached Live_Detail without contacting the ThemeParks_API.
3. THE Live_Service SHALL use a Live_Cache_TTL of 5 minutes.
4. WHEN a live data retrieval from the ThemeParks_API completes successfully, THE Live_Service SHALL store the resulting Live_Detail in the Live_Cache together with its Retrieved_At time.
5. THE Live_Service SHALL include the Retrieved_At time of the served Live_Detail in the response to the App.
6. WHEN the App requests Live_Detail for an Experience, a fresh retrieval from the ThemeParks_API does not complete within 5 seconds, and a cached Live_Detail for that Experience exists in the Live_Cache, THE Live_Service SHALL serve the most recent cached Live_Detail for that Experience regardless of its age, including a stale indicator in the response to the App.
7. IF a fresh retrieval from the ThemeParks_API for an Experience returns an error and a cached Live_Detail for that Experience exists in the Live_Cache, THEN THE Live_Service SHALL serve the most recent cached Live_Detail for that Experience regardless of its age, including a stale indicator in the response to the App, and SHALL NOT overwrite the cached Live_Detail.
8. IF a fresh retrieval from the ThemeParks_API for an Experience does not complete within 5 seconds or returns an error, and no cached Live_Detail for that Experience exists in the Live_Cache, THEN THE Live_Service SHALL respond to the App with an error indicating that live data is currently unavailable, and SHALL NOT store any Live_Detail in the Live_Cache.

### Requirement 3: Live Data Error Handling

**User Story:** As a User, I want the detail view to stay usable when live data cannot be loaded, so that a transient upstream problem does not block me from seeing an Experience.

#### Acceptance Criteria

1. IF a retrieval from the ThemeParks_API fails (a non-success response, an unreachable upstream, or a response that cannot be parsed into the expected live shape per Requirement 1.8) and a cached Live_Detail for the Experience exists in the Live_Cache, THEN THE Live_Service SHALL serve the most recent cached Live_Detail, return a stale indicator, and retain the cached Live_Detail unchanged.
2. IF a retrieval from the ThemeParks_API fails (a non-success response, an unreachable upstream, or a response that cannot be parsed into the expected live shape per Requirement 1.8) and no cached Live_Detail for the Experience exists in the Live_Cache, THEN THE App SHALL display an indicator that live information is currently unavailable for that Experience and SHALL display no live operational values.
3. WHEN live information is unavailable for an Experience because no Live_Detail could be served, THE App SHALL display the Experience's static detail fields of name, Park, Experience_Category, and description.
4. IF the Experience's static detail fields cannot be rendered, THEN THE App SHALL still display the live-unavailable indicator for that Experience.
5. WHEN the App displays a served Live_Detail that carries a stale indicator, THE App SHALL display an indicator that the live information may be out of date together with the Retrieved_At time of the displayed Live_Detail.

### Requirement 4: Attraction and Character Meet Live Display

**User Story:** As a User, I want to see current wait times and operating status for rides and character meet-and-greets, so that I can decide what to do and when.

#### Acceptance Criteria

1. WHEN a User opens the detail view of an Experience whose Experience_Category is Ride or Character_Meet, THE App SHALL display the Experience's Operating_Status as exactly one of the labels Operating, Closed, Down, Refurbishment, or Unknown.
2. WHILE the Operating_Status of an Experience whose Experience_Category is Ride or Character_Meet is Operating and a Wait_Time is present, THE App SHALL display the standby Wait_Time as a whole number of minutes greater than or equal to 0 and SHALL NOT display the no-standby-wait-time-posted indicator.
3. IF the Operating_Status of an Experience whose Experience_Category is Ride or Character_Meet is Closed, Down, Refurbishment, or Unknown, THEN THE App SHALL NOT display a standby Wait_Time value.
4. WHEN a User opens the detail view of an Experience whose Experience_Category is Ride or Character_Meet, the Operating_Status is Operating, and the Wait_Time is absent, THE App SHALL display an indicator that no standby wait time is currently posted.
5. WHEN the App displays Live_Detail for an Experience whose Experience_Category is Ride or Character_Meet, THE App SHALL display the Retrieved_At time of the displayed Live_Detail in the Park's local time zone.
6. WHILE the displayed Live_Detail for an Experience whose Experience_Category is Ride or Character_Meet carries the Live_Service stale indicator, THE App SHALL display a stale indicator alongside the displayed Operating_Status and Wait_Time.
7. WHILE the Operating_Status of an Experience whose Experience_Category is Ride or Character_Meet is Operating and a Single_Rider_Wait is present, THE App SHALL display the Single_Rider_Wait as a whole number of minutes greater than or equal to 0, labeled as a single rider line wait distinct from the standby Wait_Time.
8. WHEN a User opens the detail view of an Experience whose Experience_Category is Ride or Character_Meet and the Live_Detail contains a Return_Window, THE App SHALL display the Return_Window state as exactly one of the labels Available, Temporarily_Full, or Finished, and WHERE the Return_Window state is Available and a return-window start time and a return-window end time are present, THE App SHALL display the return-window start time and end time in the Park's local time zone.
9. WHEN a User opens the detail view of an Experience whose Experience_Category is Ride or Character_Meet and the Live_Detail contains a Paid_Return_Window, THE App SHALL display the Paid_Return_Window's formatted price string exactly as provided by the ThemeParks_API.
10. WHEN a User opens the detail view of an Experience whose Experience_Category is Ride or Character_Meet and the Live_Detail contains a Boarding_Group_Status, THE App SHALL display the Boarding_Group_Status allocation status as exactly one of the labels Available, Paused, or Closed, and WHERE the current boarding group start number and current boarding group end number are present, THE App SHALL display the current boarding group range.
11. WHEN a User opens the detail view of an Experience whose Experience_Category is Ride or Character_Meet and the Live_Detail contains a Wait_Time_Forecast with one or more entries whose forecast time is at or after the current time, THE App SHALL display those upcoming entries in chronological ascending order of forecast time in the Park's local time zone, each showing its predicted standby wait in minutes, and SHALL highlight the single upcoming entry with the lowest predicted standby wait.
12. WHEN a User opens the detail view of an Experience whose Experience_Category is Ride or Character_Meet and the Live_Detail contains no Wait_Time_Forecast or contains a Wait_Time_Forecast with no entries whose forecast time is at or after the current time, THE App SHALL display an empty-state indicator that no wait time forecast is available and SHALL display no forecast entries.
13. WHEN the App displays Live_Detail for an Experience whose Experience_Category is Ride or Character_Meet and the Live_Detail contains an Upstream_Last_Updated, THE App SHALL display the Upstream_Last_Updated in the Park's local time zone, labeled distinctly from the Retrieved_At time.

### Requirement 5: Show and Parade Schedule Display

**User Story:** As a User, I want to see today's performance times for shows and parades, so that I can plan to attend them.

#### Acceptance Criteria

1. WHEN a User opens the detail view of an Experience whose Experience_Category is Show or Parade and the Live_Detail contains one or more Showtimes for the current day, THE App SHALL display each current-day Showtime's start time in chronological ascending order of start time in the Park's local time zone.
2. WHEN a User opens the detail view of an Experience whose Experience_Category is Show or Parade and the Live_Detail contains no Showtimes for the current day, THE App SHALL display an empty-state indicator that no performance times are scheduled for the current day and SHALL display no Showtime entries.
3. WHEN the App displays Live_Detail for an Experience whose Experience_Category is Show or Parade, THE App SHALL display the Operating_Status of that Experience.
4. WHERE a displayed current-day Showtime has an end time present, THE App SHALL display that Showtime's end time in the Park's local time zone.
5. WHEN the App displays Live_Detail for an Experience whose Experience_Category is Show or Parade, THE App SHALL display the Retrieved_At time of the displayed Live_Detail.
6. WHERE a displayed current-day Showtime has a Showtime_Type present, THE App SHALL display that Showtime's Showtime_Type label alongside that Showtime's start time.
7. WHEN the App displays Live_Detail for an Experience whose Experience_Category is Show or Parade and the Live_Detail contains an Upstream_Last_Updated, THE App SHALL display the Upstream_Last_Updated in the Park's local time zone, labeled distinctly from the Retrieved_At time.

### Requirement 6: Restaurant Dining Display

**User Story:** As a User, I want to see whether a restaurant is open and its hours, so that I can plan where and when to eat.

#### Acceptance Criteria

1. WHEN a User opens the detail view of an Experience whose Experience_Category is Restaurant, THE App SHALL display the Experience's current Operating_Status as one of the values Operating, Closed, Down, Refurbishment, or Unknown.
2. WHEN a User opens the detail view of an Experience whose Experience_Category is Restaurant and the Live_Detail contains Operating_Hours for the current day with both an opening time and a closing time, THE App SHALL display the current-day opening time and closing time in the Park's local time zone.
3. WHEN a User opens the detail view of an Experience whose Experience_Category is Restaurant and the Live_Detail contains no Operating_Hours for the current day, or contains Operating_Hours that lack either an opening time or a closing time, THE App SHALL display an empty-state indicator that dining hours are unavailable for the current day and SHALL display no opening time or closing time.
4. WHEN the App displays Live_Detail for an Experience whose Experience_Category is Restaurant, THE App SHALL display the Retrieved_At time of the displayed Live_Detail.
5. WHERE a displayed set of current-day Operating_Hours has an Operating_Hours_Type present, THE App SHALL display that Operating_Hours_Type label alongside the corresponding opening time and closing time.
6. WHEN a User opens the detail view of an Experience whose Experience_Category is Restaurant and the Live_Detail contains a Dining_Availability with one or more entries, THE App SHALL display the walk-up dining availability as a first-class element of the dining section independently of whether Operating_Hours are present, showing for each entry the party size when present and the estimated wait in minutes when present.
7. WHEN a User opens the detail view of an Experience whose Experience_Category is Restaurant and the Live_Detail contains an empty Dining_Availability, THE App SHALL display an empty-state indicator that walk-up dining availability is unavailable for the current day and SHALL display no Dining_Availability entries.
8. WHEN the App displays Live_Detail for an Experience whose Experience_Category is Restaurant and the Live_Detail contains an Upstream_Last_Updated, THE App SHALL display the Upstream_Last_Updated in the Park's local time zone, labeled distinctly from the Retrieved_At time.

### Requirement 7: Category-Appropriate Display Gating

**User Story:** As a User, I want each Experience to show only the live information that applies to it, so that the detail view is relevant and uncluttered.

#### Acceptance Criteria

1. WHEN a User opens the detail view of an Experience whose Experience_Category is Other, THE App SHALL display only the static detail fields of name, Park, Experience_Category, and description, and SHALL display no wait time and operating status section, no showtime section, and no dining section.
2. WHEN a User opens the detail view of an Experience whose Experience_Category is Ride or Character_Meet, THE App SHALL present the wait time and operating status section as the live operational section, and SHALL display no showtime section and no dining section.
3. WHEN a User opens the detail view of an Experience whose Experience_Category is Show or Parade, THE App SHALL present the showtime section as the live operational section, and SHALL display no wait time and operating status section and no dining section.
4. WHEN a User opens the detail view of an Experience whose Experience_Category is Restaurant, THE App SHALL present the dining section as the live operational section, and SHALL display no wait time and operating status section and no showtime section.
5. WHEN a User opens the detail view of an Experience, THE App SHALL display at most one live operational section, determined solely by the Experience's Experience_Category. (Refined by R7.6 and R7.7: the choice remains at most one section, but for the cases named there it also consults what the Live_Detail actually carries, so the App never presents a section it has no data for.)
6. WHEN a User opens the detail view of an Experience whose Experience_Category is Walkthrough, PlayArea, or Game, THE App SHALL present the wait time and operating status section as the live operational section WHERE the Live_Detail carries a standby wait, and SHALL display no live operational section WHERE it does not. These three categories are introduced by `catalog-taxonomy-cleanup`; some of them (for example a walk-through animal trail) do post a standby wait upstream while most do not, so the section is presented on the presence of data rather than on the category alone.
7. WHEN a User opens the detail view of an Experience whose Experience_Category is Show or Parade and the Live_Detail carries no showtimes but does carry a standby wait, THE App SHALL present the wait time and operating status section instead of an empty showtime section. This narrows R7.3, which continues to govern whenever showtimes are present, and is required because `catalog-taxonomy-cleanup` re-categorizes continuously-operating theater attractions (for example Mickey's PhilharMagic and Monsters, Inc. Laugh Floor) from Ride to Show, and those attractions post a standby wait rather than a performance schedule.

## Assumptions

- **Restaurant menus are out of scope.** The ThemeParks_API does not provide dish-level menu data. If menu content is required, it must be sourced from an additional upstream provider (e.g., a separate menu data source) and would warrant its own requirement set and licensing/attribution review. This is flagged as an open decision for confirmation.
- **Live_Cache_TTL of 5 minutes** balances freshness against upstream load. This value is an assumption open to adjustment.
- **5-second retrieval deadline** mirrors the existing Catalog_Service opportunistic-sync deadline (R1.11 of the disney-world-tracker spec) for consistency.
- **Live data is retrieved on demand** when the App opens an Experience detail view, rather than on a fixed schedule, because live data is per-Experience and volatile.
- **Character_Meet Experiences are treated like rides** (wait time plus operating status) because the ThemeParks_API typically exposes meet-and-greet entities with queue data. If a given Character_Meet is schedule-based upstream, that is an edge case to revisit in design.
- **The ThemeParks_API does return a Wait_Time_Forecast.** The verified live responses include a `forecast` array of hourly entries (time, predicted standby wait, and a 0–100 relative busyness percentage) for rides, even though the published OpenAPI schema omits it. Any prior assumption that the upstream provides no forecast is superseded: the forecast is real but undocumented, so it is treated as best-effort and optional and the App degrades gracefully when it is absent. The forecast covers the current day and entries may fall in the past as the day progresses, so only upcoming entries are displayed.
- **The published OpenAPI schema is incomplete.** The verified real responses include fields the schema omits, notably the `forecast` array and the `type` label on operating-hours entries. The verified real-response shapes are treated as ground truth over the published schema for projection and validation.
- **Dining_Availability is independent of Operating_Hours.** A verified restaurant returned walk-up dining availability and a status but no operating hours at all, so walk-up dining availability is modeled as a first-class part of the restaurant dining section rather than something gated on operating hours being present. Reservation-only restaurants may return an empty availability list, which is handled with a graceful empty state.
- **Lightning Lane and paid return-time pricing is displayed exactly as provided.** The Paid_Return_Window price (amount, currency, and formatted string) is surfaced verbatim from the ThemeParks_API rather than reformatted locally, to avoid currency or rounding errors in money-sensitive display.
- **Upstream_Last_Updated is distinct from Retrieved_At.** The per-entity `lastUpdated` timestamp reported by the ThemeParks_API reflects when the upstream source last updated its data, whereas Retrieved_At reflects when the Live_Service fetched it; both are surfaced so Users can judge true currency.
