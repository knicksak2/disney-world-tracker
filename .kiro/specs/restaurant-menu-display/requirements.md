# Requirements Document

## Introduction

Restaurant dining menus never appear in the mobile app today. The backend already
models menus on the Experience detail response through a `menus` field, and a
demand-driven (lazy, throttled) menu-retrieval seam exists in code, but nothing
wires that seam into the running server. As a result the `experience_menus` cache
stays empty and the `menus` field is always omitted. The mobile Experience detail
screen also has no UI that renders the static Disney menus (its existing
`DiningSection` renders live walk-up availability, which is a different concern).

Menus were deliberately removed from the bulk Catalog_Sync because that path issued
~576 back-to-back Menu_Service calls that triggered an Akamai/WAF edge block. The
replacement is demand-driven retrieval: a restaurant's menu is fetched from the
Menu_Service only when that restaurant's detail is read and the cached copy is
missing or stale, routed through the shared rate-limited Disney_Transport so no
burst is reintroduced.

This feature wires the lazy retrieval into the read path, reliably exposes menus on
the Experience detail response, and adds a themed mobile experience: a compact
Menu_Summary_Card on the Experience detail screen that, when tapped, opens a
dedicated Menu_Screen where the user browses the restaurant's menu(s) organized by
menu type, group/course, and item, with graceful loading, empty, and error
handling.

## Glossary

- **Catalog_Service**: The backend service that serves the Experience list and the single-Experience detail read (`GET /catalog/:experienceId`).
- **Experience_Detail_Response**: The response body of `GET /catalog/:experienceId`, which optionally carries a `menus` field.
- **Restaurant_Experience**: An Experience whose category equals `Restaurant`.
- **Menu_Retrieval**: The lazy, throttled retrieval seam (`getMenuForRestaurant`) that decides freshness, fetches on miss/stale, serves cache on fresh, and serves stale on failure without throwing.
- **Menu_Service**: The upstream Disney source of restaurant menus, reached via the Facilities_Client `getMenus` call.
- **Disney_Transport**: The shared HTTP transport for all Disney-bound calls; it acquires a lease from the Rate_Limiter before every dispatch and applies retry/backoff.
- **Request_Budget**: The single authoritative rate budget enforced by the shared Rate_Limiter across every Disney caller.
- **Menu_Cache**: The persisted `experience_menus` store holding a restaurant's menus and their `fetched_at` timestamp.
- **Freshness_Window**: The configured freshness interval `MENU_FRESHNESS_MS` (default `86400000` ms / 24 hours) that bounds how long a cached menu is served without contacting the Menu_Service.
- **MenuDTO**: The menu shape defined in `packages/shared/src/dto/Menu.ts`: a `menuType`, an optional `cuisineType`, and ordered `groups[]`, where each group has a `name` and ordered `items[]` and each item has a `name` and optional `price` string.
- **Menu_Summary_Card**: A compact card on the Experience detail screen that summarizes a Restaurant_Experience's available menus (e.g. a count and the menu-type names) and acts as the tappable entry point to the Menu_Screen.
- **Menu_Screen**: A dedicated mobile screen, reachable by tapping the Menu_Summary_Card, that renders the full menu(s) of a Restaurant_Experience organized by menu type, group/course, and item.
- **ExperienceDetailScreen**: The mobile screen (`apps/mobile/src/screens/catalog/ExperienceDetailScreen.tsx`) that loads and renders Experience detail.

## Requirements

### Requirement 1: Demand-driven menu retrieval at read time

**User Story:** As an app user, I want a restaurant's menu to be retrieved when I open its detail, so that menus appear without a costly bulk sync.

The cached menu age is the elapsed time from the cached menu's recorded fetch timestamp to the time the detail is requested. The current fetch timestamp persisted with a fetched menu is the time the Menu_Service response is received.

#### Acceptance Criteria

1. WHEN a Restaurant_Experience detail is requested AND no cached menu exists in the Menu_Cache, THE Catalog_Service SHALL fetch the menu from the Menu_Service through the Disney_Transport, persist the result to the Menu_Cache with the current fetch timestamp, and include the fetched menus in the Experience_Detail_Response.
2. WHEN a Restaurant_Experience detail is requested AND the cached menu age is greater than the Freshness_Window, THE Catalog_Service SHALL fetch a refreshed menu from the Menu_Service through the Disney_Transport, persist the refreshed result to the Menu_Cache with the current fetch timestamp, and include the refreshed menus in the Experience_Detail_Response.
3. WHEN a Restaurant_Experience detail is requested AND the cached menu age is less than or equal to the Freshness_Window (default 86,400,000 ms / 24 hours), THE Catalog_Service SHALL include the cached menu in the Experience_Detail_Response and SHALL complete the request without contacting the Menu_Service.
4. WHERE an Experience is not a Restaurant_Experience, THE Catalog_Service SHALL complete the detail request without contacting the Menu_Service and SHALL omit the `menus` field from the Experience_Detail_Response.

### Requirement 2: Rate-limit and WAF safety

**User Story:** As an operator, I want menu fetches to draw from the shared rate budget, so that the burst that triggered the WAF edge block is not reintroduced.

#### Acceptance Criteria

1. WHEN the Catalog_Service fetches a menu from the Menu_Service, THE Catalog_Service SHALL dispatch the request through the shared Disney_Transport governed by the single authoritative Request_Budget enforced by the Redis-backed Rate_Limiter.
2. WHEN the Catalog_Service serves a single Restaurant_Experience detail request, THE Catalog_Service SHALL issue at most one Menu_Service request regardless of how many meal periods the restaurant offers, because a single Menu_Service request returns all of the restaurant's menus in one response.
3. THE Catalog_Service SHALL route every Menu_Service egress request through the shared Disney_Transport and SHALL NOT issue any Menu_Service request that bypasses the Disney_Transport or the Request_Budget.
4. IF dispatching a Menu_Service request would exceed the Request_Budget as evaluated by the Rate_Limiter, THEN THE Catalog_Service SHALL withhold the request from the edge until Request_Budget capacity is available, and SHALL surface a rate-limit indication to the caller when capacity cannot be obtained, without dispatching the request outside the Disney_Transport.

### Requirement 3: Menu exposure on the Experience detail response

**User Story:** As an app user, I want a restaurant's menus reliably included on its detail response, so that the mobile app can display them.

#### Acceptance Criteria

1. WHEN a Restaurant_Experience has one or more menus available (available menu count greater than 0), THE Catalog_Service SHALL include a `menus` field in the Experience_Detail_Response containing every available menu in MenuDTO shape.
2. IF a Restaurant_Experience has zero menus available, THEN THE Catalog_Service SHALL omit the `menus` field entirely from the Experience_Detail_Response, rather than including it with an empty array or a null value.
3. IF a Menu_Service fetch fails AND a previously cached menu exists in the Menu_Cache, THEN THE Catalog_Service SHALL include that previously cached menu unchanged in the Experience_Detail_Response and SHALL complete the Experience_Detail_Response without error.
4. IF a Menu_Service fetch fails AND no previously cached menu exists in the Menu_Cache, THEN THE Catalog_Service SHALL complete the Experience_Detail_Response with the `menus` field omitted and without error.
5. IF a Menu_Service fetch fails, THEN THE Catalog_Service SHALL record the failure and SHALL NOT propagate the failure to the enclosing Experience_Detail_Response read.
6. WHEN the Catalog_Service includes menus in the Experience_Detail_Response, THE Catalog_Service SHALL preserve, for each menu, its `menuType`, its `cuisineType` when present, and its `groups` in their provided order, where each group retains its `name` and its `items` in their provided order, and each item retains its `name` and its `price` string when present, as modeled by MenuDTO.

### Requirement 4: Menu summary card and navigation on the detail screen

**User Story:** As an app user, I want a compact menu card on a restaurant's detail screen that I can tap, so that I can open its menus without cluttering the detail view.

#### Acceptance Criteria

1. WHERE the Experience is a Restaurant_Experience AND the Experience_Detail_Response carries one or more menus, THE ExperienceDetailScreen SHALL render a Menu_Summary_Card that summarizes the available menus, including the number of menus and each menu's menu type.
2. WHEN the user activates the Menu_Summary_Card, THE ExperienceDetailScreen SHALL navigate to the Menu_Screen for that Restaurant_Experience.
3. WHILE the Experience detail is loading, THE ExperienceDetailScreen SHALL render a loading indicator in place of the Menu_Summary_Card and SHALL render no Menu_Summary_Card content.
4. IF the Experience is a Restaurant_Experience AND the Experience_Detail_Response carries no menus, THEN THE ExperienceDetailScreen SHALL render an empty state in place of the Menu_Summary_Card that communicates that no menu is available and SHALL provide no navigation to the Menu_Screen.
5. IF the Experience detail load fails, THEN THE ExperienceDetailScreen SHALL render an error indication and SHALL render no Menu_Summary_Card.
6. WHERE the Experience is not a Restaurant_Experience, THE ExperienceDetailScreen SHALL render no Menu_Summary_Card and SHALL provide no navigation to the Menu_Screen.
7. THE Menu_Summary_Card SHALL render using the shared Magical / Whimsical theme components (Card, SectionLabel, Badge) used by the other detail sections.

### Requirement 5: Dedicated menu screen

**User Story:** As an app user, I want a dedicated screen that lays out a restaurant's full menus, so that I can browse the dishes and prices with room to read.

#### Acceptance Criteria

1. WHEN the Menu_Screen renders for a Restaurant_Experience, THE Menu_Screen SHALL render every menu, every group within each menu, and every item within each group, so the complete menu is visible.
2. WHEN the Menu_Screen renders menus, groups, and items, THE Menu_Screen SHALL preserve the provided order of the menus, of the groups within each menu, and of the items within each group.
3. WHEN a Restaurant_Experience has more than one menu, THE Menu_Screen SHALL present each menu as a distinct labelled group identified by its menu type.
4. WHERE a menu has a cuisine type, THE Menu_Screen SHALL render the cuisine type alongside that menu's menu type.
5. WHERE a menu has no cuisine type, THE Menu_Screen SHALL render that menu's menu type without a cuisine type.
6. WHEN a menu item has a non-empty price string, THE Menu_Screen SHALL render the item name together with its price exactly as provided.
7. WHEN a menu item has no price or an empty price string, THE Menu_Screen SHALL render the item name and SHALL render no price for that item.
8. THE Menu_Screen SHALL provide a control to return to the Experience detail screen.
9. THE Menu_Screen SHALL render using the shared Magical / Whimsical theme components (Card, SectionLabel, Badge, GradientHeader) used by the other detail sections.
