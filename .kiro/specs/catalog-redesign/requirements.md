# Requirements Document

## Introduction

The App's catalog and explore experience is the primary discovery engine for Walt Disney World, encompassing four theme parks, two water parks, Disney Springs, and 32 on-property resorts spanning over 600 attractions, entertainment venues, dining options, and recreation offerings.

While destination details (such as `ExperienceDetailScreen` for resorts and theme park attractions) provide rich data, the top-level exploration and browsing surfaces suffer from several structural usability issues:
1. **Explore Hub Disconnect**: The top-level catalog home lacks a clear visual hierarchy, combining inconsistent utility links, missing direct access to crowd calendar and favorites tools, and presenting water parks and Disney Springs with awkward horizontal carousels.
2. **Resort Directory Sprawl**: Browsing resorts currently risks overwhelming guests with massive accordion drawers or losing track of the 250+ resort dining venues and recreation activities.
3. **Excessive Vertical Scroll on Resort Detail**: On resort pages like Disney's Grand Floridian Resort & Spa, rendering 12 dining venues and 8+ recreation items in an un-truncated vertical column produces a 3,000px+ scrolling list, burying transit times and the property map.
4. **Static Recreation Amenities**: Unlike restaurants, which link to their dedicated experience page for completion logging, ratings, and favorites, resort recreation activities have historically been static text cards without interactive detail pages.

This feature introduces a structured catalog and explore architecture across three levels while strictly preserving the production `ExperienceDetailScreen` for resorts, enhancing it with inline progressive disclosure ("Show all / Show fewer" limiting default display to 4 items), in-card category filter pills, and interactive activity navigation.

**Relationship to existing screens.** `Explore_Hub` and `Park_Destination_Screen` are not greenfield builds: they replace the production `CatalogScreen.tsx` (route `CatalogList`) and `DestinationScreen.tsx` respectively, both of which already implement a substantial portion of what this feature asks for (global search, category tabs, the adjacent Favorites toggle, Dynamic_Quick_Chips, and land accordions already exist in `DestinationScreen.tsx`; the hero header, search, and three utility shortcuts already exist in `CatalogScreen.tsx`, as full-width stacked banners and a uniform 8-cell destination grid rather than the dock/2x2-grid/differentiated-banners layout this feature specifies). Requirement 7 defines exactly what is replaced, what is carried over, and what is net-new, so this is implemented as a migration of two working, tested screens rather than two parallel, undifferentiated rebuilds. Only `Resorts_Directory` is a genuinely new screen with no existing equivalent (today's resort browsing is a single collapsed-accordion-per-resort list inside `DestinationScreen.tsx`'s `ResortsLayout`).

Per the repo's mobile conventions and hosting constraints, this feature introduces no new backend daemons or un-indexed queries: all data is served through existing Fastify catalog and live endpoints with local TanStack Query caching.

## Glossary

- **Explore_Hub**: The Level-1 root screen of the Explore tab, presenting the global search bar, the 3-tile canonical utility dock, the 2x2 theme parks grid, the Disney Springs showcase card, the 2-column water parks grid, and the Resorts spotlight card.
- **Utility_Dock**: The fixed 3-column quick-action bar on Explore_Hub providing one-tap navigation to Live Waits (`LiveWaitsScreen`), Crowd Calendar (`CrowdCalendarScreen`), and Favorites. There is no standalone `FavoritesScreen` route today — `CatalogScreen.tsx`'s existing Favorites tile toggles an in-screen favorites-filtered view (`setFavoritesViewActive(true)`) rather than navigating to a separate screen. The Utility_Dock's Favorites tile SHALL reuse that same in-screen mode unless a dedicated `FavoritesScreen` route is explicitly decided on and added as its own requirement before implementation.
- **Resorts_Directory**: The Level-2 destination screen for browsing on-property Disney Resort Hotels, partitioned into 4 dedicated tabs: Hotels (32), Dining (104), Recreation (85), and Sub-Destinations (37).
- **Hotel_Preview_Card**: A compact, glanceable card representing a Disney resort hotel, displaying its hero photo, tier badge, transit pills, description, quick metric pills (dining count, activities count, transit time to nearest park), favorite toggle, and a CTA navigating to `ExperienceDetailScreen`.
- **Park_Destination_Screen**: The Level-2 screen for exploring a single theme park (e.g. Magic Kingdom), featuring category tabs, an adjacent Favorites toggle pill, dynamic quick chips, collapsible land accordions, and rich experience cards.
- **Dynamic_Quick_Chips**: Horizontally scrollable filter pills automatically derived from the active category tab (e.g. `Thrill Ride`, `Quick Service`, `Table Service`, `Height 40"+`).
- **Resort_Guide_Lens**: The primary tab lens within `ExperienceDetailScreen` for a Resort experience, rendering Property Highlights, Dining & Lounges, Recreation & Resort Amenities, and Property Map & Transit Times.
- **Stay_Passport_Lens**: The secondary tab lens within `ExperienceDetailScreen` for a Resort experience, rendering the Park Passport & Journal, visit history logging, and architectural history.
- **Inline_Progressive_Disclosure**: The expandable "Show all [N] / Show fewer" toggle within the Dining & Lounges and Recreation cards in `ResortGuideSection`, limiting default display to the top 4 items to keep the screen compact.
- **Recreation_Experience**: A distinct on-property leisure, wellness, boating, or sports activity that has a trackable `ExperienceDTO` or facility ID and opens `ExperienceDetailScreen` for completion logging, ratings, and favorites.

## Requirements

### Requirement 1: Explore Hub (Level 1 Root Screen)

**User Story:** As a guest, I want a clean, visually compelling Explore Hub, so that I can instantly search, jump to live tools, or dive into any Disney World destination.

#### Acceptance Criteria

1. THE Explore_Hub SHALL present a top compact hero gradient header containing the title "Explore", the operating subtitle "Where would you like to explore?", a notification bell icon, and a You & Crew shortcut control, sized compactly to maximize screen real estate.
2. THE Explore_Hub SHALL present a global search input field capable of searching and filtering across all 600+ rides, shows, dining locations, and resort hotels.
3. THE Explore_Hub SHALL present the Utility_Dock as a fixed 3-column row containing `⏱️ Live Waits` (navigating to `LiveWaitsScreen`), `📊 Crowds` (navigating to `CrowdCalendarScreen`), and `♥ Favorites` (activating the existing in-screen favorites-filtered view carried over from `CatalogScreen.tsx` — see Glossary note on Utility_Dock; there is no separate `FavoritesScreen` route).
4. THE Explore_Hub SHALL present the four WDW Theme Parks in a 2x2 grid layout comprising Magic Kingdom, EPCOT, Disney's Hollywood Studios, and Disney's Animal Kingdom.
5. EACH theme park tile in the 2x2 grid SHALL display a rich themed gradient using the park accent hue, watermark landmark iconography, the park name, current integer average wait pulse badge, experience count badge, and SHALL navigate to that park's Park_Destination_Screen upon tap, omitting attraction landmark subheadings to maintain a clean layout.
6. THE Explore_Hub SHALL present Disney Springs as a full-width showcase feature banner displaying a sunset amber themed gradient, watermark shopping/dining iconography, destination subtitle, and dining/shopping count badges.
7. THE Explore_Hub SHALL present the two WDW Water Parks (Disney's Blizzard Beach and Disney's Typhoon Lagoon) in a balanced 2-column grid featuring park-specific themed gradients (lagoon teal and ice blue) with watermark landmark iconography, without horizontal cutoff or single-row carousel scrolling.
8. THE Explore_Hub SHALL present a full-width Resorts Spotlight Card featuring a rich royal purple gradient and hotel iconography, highlighting the 32 on-property resort hotels and navigating to the Resorts_Directory upon tap.

**Amendment — Explore Hub Section Ordering (Option A):** The vertical scroll order of Explore Hub sections SHALL be: (1) Header & Global Search, (2) Utility Dock (Live Waits, Crowds, Favorites), (3) Theme Parks 2x2 Grid, (4) Resorts Spotlight Card, (5) Disney Springs Showcase Card, and (6) Water Parks 2-column Grid. This prioritizes high-volume lodging and dining discovery at Disney Resorts above Disney Springs, placing seasonal water parks at the base of the page. Section headers SHALL provide descriptive subtitles for visual consistency across all destination categories.

### Requirement 2: Resorts Directory Screen (Level 2)

**User Story:** As a guest, I want a dedicated, structured directory for Disney resorts and hotels, so that I can easily discover hotels, dining venues, activities, and sub-destinations without cluttered accordions.

#### Acceptance Criteria

1. THE Resorts_Directory SHALL present a header matching the size, shape, and rounded bottom corners of `GradientHeader` on the Explore page, containing a back navigation button returning to Explore_Hub, the title "Disney Resorts & Hotels", and an informative subtitle, with a dedicated search input positioned beneath the header.
2. THE Resorts_Directory SHALL present exactly four partition tabs: `🏨 Hotels`, `🍽️ Dining`, `🏊 Recreation`, and `🎪 Sub-Destinations`.
3. WHEN the `Hotels` tab is active, THE Resorts_Directory SHALL present a filter strip containing tier filters (`All`, `Deluxe`, `Moderate`, `Value`, `DVC Villas`) and transportation mode filters (`Monorail`, `Skyliner`, `Boat`). The `DVC Villas` filter label is a display-only alias; it SHALL filter on the persisted `ResortDTO.tier` value `'Deluxe Villa'` (there is no separate `'DVC'` tier value in the data model).
4. WHEN the `Hotels` tab is active, THE Resorts_Directory SHALL render each hotel as a compact Hotel_Preview_Card.
5. EACH Hotel_Preview_Card SHALL display a hero photo with gradient overlay (or themed resort gradient when photo is omitted), a tier badge, transportation mode pills, hotel name, thematic highlight sentence, three glanceable metric pills (`🍽️ [N] Dining Venues`, `🏊 [N] Activities & Pools`, `⏱️ [N]m to [Park]`), an interactive Favorite toggle button (`♥`), and a call-to-action button labeled `🏨 View Resort Page`.
6. WHEN a guest taps any Hotel_Preview_Card or its CTA button, THE App SHALL navigate directly to the existing production `ExperienceDetailScreen` for that resort.
7. WHEN the `Dining` tab is active, THE Resorts_Directory SHALL present category filters (`All`, `Table Service`, `Quick Service`, `Lounges`) and render cards showing venue name, owning resort, tags, meal periods, price tier, and favorite toggle. These filter categories SHALL be the same three-way `DiningCategoryFilter` partition (`table` | `quick` | `lounge`) used by `ResortGuideSection`'s in-card filter (Requirement 5.4), classified from each venue's existing freeform `tag` field (e.g. `"Rooftop Signature"`, `"Tiki Lounge"`, `"Savanna Table Service"`) via the keyword rule in Requirement 5.4a, so the two screens cannot drift onto different taxonomies.
8. WHEN the `Recreation` tab is active, THE Resorts_Directory SHALL present filters (`All`, `Pools & Water`, `Arts & Classes`, `Boating & Marinas`, `Spas & Wellness`, `Golf & Sports`, `Family Fun`) and render cards with title, owning resort name, badge, description, hours, price tier, and favorite toggle. THE Resorts_Directory SHALL aggregate and preserve both catalog recreation experiences and on-property resort recreation activities (including painting experiences like Colors of Coronado, mosaic art, sangria classes, archery, trail rides, marinas, and wellness) across all resorts, without omitting or dropping any activity.
9. WHEN the `Sub-Destinations` tab is active, THE Resorts_Directory SHALL present dedicated showcase cards for Disney's BoardWalk & Promenade, ESPN Wide World of Sports Complex, Fantasia Gardens & Winter Summerland Miniature Golf, and Championship Golf Courses.
10. WHEN either the `Dining` or `Recreation` tab is active, THE Resorts_Directory SHALL present a hotel filter affordance (`🏨 All Hotels ▾` or selected hotel pill) that opens a searchable bottom sheet allowing guests to filter the directory to venues or activities belonging to any single Disney Resort property, with an option to reset back to all hotels.

### Requirement 3: Theme Park Destination Screen (Level 2)

**User Story:** As a guest, I want an intuitive, rich land view for each theme park, so that I can filter rides, dining, and shows by my preferences without losing my place.

#### Acceptance Criteria

1. THE Park_Destination_Screen SHALL present a hero header matching the size, shape, and rounded bottom corners of `GradientHeader` on the Explore page, displaying the park-themed gradient, park title, active experience count subtitle, and back navigation button (with the live wait pulse badge omitted to maintain a clean header focused on destination navigation).
2. THE Park_Destination_Screen SHALL present top category tabs (`All`, `Rides`, `Dining`, `Shows`).
3. THE Park_Destination_Screen SHALL present a dedicated `♥ Favorites` quick toggle pill immediately adjacent to the category tabs, allowing instant filtering to favorited experiences within that park.
4. THE Park_Destination_Screen SHALL present a Filters button that opens a multi-select modal sheet supporting filtering by Land, Price Tier, Height Requirement, and Physical Considerations.
5. THE Park_Destination_Screen SHALL display Dynamic_Quick_Chips horizontally beneath the tabs, automatically derived from the active category tab.
6. THE Park_Destination_Screen SHALL group experiences by Land using collapsible accordion sections, each displaying the land name and experience count badge.
7. EACH experience card in the land accordion SHALL display thumbnail photography, experience name, land text, category badge, price tier, height requirement badge, visited completion toggle, and favorite heart toggle.

### Requirement 4: Preservation of Existing Resort Detail Page Structure

**User Story:** As a guest, I want the existing resort detail page preserved with its current layout and features, so that I do not lose any functionality or familiar design.

#### Acceptance Criteria

1. THE App SHALL preserve `ExperienceDetailScreen` with `ResortGuideSection` and `PassportAndLoreLens` as the canonical destination for resort hotel experiences.
2. THE Resort detail page SHALL maintain the custom gradient header with back navigation, resort title, area subtitle, hero photography, and top badges (`Deluxe Resort`, `Monorail Transit`, `Beach Pool`).
3. THE Resort detail page SHALL maintain the dual-lens switcher supporting switching between `Resort Guide` and `Stay Passport & Lore`.
4. THE `Stay Passport & Lore` lens SHALL preserve the Park Passport & Journal, visit history logging, and architectural lore sections unchanged.
5. THE Resort detail page SHALL maintain the floating action dock containing `[Log Stay]` and `[+ Add to...]` controls.
6. THE `Property Map & Transit Times` section SHALL maintain verified multi-modal direct transit times to all four theme parks and Disney Springs.

### Requirement 5: Inline Progressive Disclosure on Resort Detail (Shortening Long Lists)

**User Story:** As a guest viewing a resort with many restaurants and activities (like Grand Floridian), I want long lists truncated by default with an expand toggle, so that I don't have to scroll through dozens of cards to reach the map and transit information.

#### Acceptance Criteria

1. IN `ResortGuideSection`, THE Dining & Lounges card SHALL display by default at most four (4) featured dining venues when the list is collapsed.
2. WHEN a resort has more than four dining venues and the list is collapsed, THE Dining & Lounges card SHALL display an expandable toggle button labeled `Show all [N] dining locations ([M] more) ▾`.
3. WHEN the guest taps the dining expand button, THE Dining & Lounges card SHALL expand the remaining venues smoothly in place, and THE toggle button label SHALL update to `Show fewer dining locations ▴`.
4. THE Dining & Lounges card SHALL present category filter chips (`All ([N])`, `Table Service ([N])`, `Quick Service ([N])`, `Lounges ([N])`).
4a. EACH dining venue's category (`table` | `quick` | `lounge`) SHALL be derived deterministically from its existing freeform `tag` string (`ResortDiningVenue.tag`, e.g. `"Rooftop Signature"`, `"Tiki Lounge"`, `"Savanna Table Service"` — there is no persisted enum field) by the following case-insensitive keyword rule, checked in order, first match wins:
   - Contains `"lounge"`, `"bar"`, or `"tiki"` → `lounge`.
   - Contains `"quick"`, `"counter"`, or `"snack"` → `quick`.
   - Otherwise (including `"signature"`, `"character"`, `"buffet"`, `"table service"`, `"fine dining"`, `"family-style"`, and any unrecognized tag) → `table`.
   This is the single classification rule shared by `filterDiningByCategory` (Property 2) and the Resorts Directory Dining tab (Requirement 2.7), so the two surfaces cannot classify the same venue differently.
5. WHEN a guest selects a specific dining category filter chip, THE card SHALL display all venues matching that category and automatically hide the collapsed truncation button.
6. IN `ResortGuideSection`, THE Recreation & Resort Amenities card SHALL display by default at most four (4) primary amenities when collapsed.
7. WHEN a resort has more than four recreation items and the list is collapsed, THE Recreation card SHALL display an expandable toggle button labeled `Show all [N] recreation & activities ([M] more) ▾`.
8. WHEN the guest taps the recreation expand button, THE Recreation card SHALL expand the remaining activities smoothly in place, and THE toggle button label SHALL update to `Show fewer activities ▴`.

### Requirement 6: Interactive Activity Experience Pages

**User Story:** As a guest, I want to tap on resort activities just like I tap on restaurants, so that I can view full details, log my visits, rate activities, and add them to my favorites.

#### Acceptance Criteria

1. IN `ResortGuideSection`, EACH item in the Recreation & Resort Amenities list SHALL be an interactive, pressable card displaying an indicator chevron (`›`).
2. WHEN a guest taps a recreation item that corresponds to a tracked catalog experience, THE App SHALL navigate directly to that experience's `ExperienceDetailScreen`.
3. ON the recreation activity's `ExperienceDetailScreen`, THE App SHALL allow the guest to log completion status via `[✓ Log Visit]`, toggle favorite status via the favorite heart control (`♥`), submit a personal rating on the app's existing 1–10 scale (`RatingControl`, consistent with every other Experience — NOT a 1–5 scale), and add personal visit notes.
4. FOR complimentary property amenities without a standalone Disney facility ID, THE App SHALL provide an informational bottom sheet presenting operating hours, location details, and guest guidelines.

### Requirement 7: Migration from `CatalogScreen.tsx` and `DestinationScreen.tsx`

**User Story:** As a developer implementing this feature, I want an explicit migration plan from the existing Level-1/Level-2 screens, so that I don't orphan working, tested code or leave two undifferentiated root screens registered at once.

#### Acceptance Criteria

1. THE `ExploreHubScreen` SHALL replace `CatalogScreen.tsx` as the component backing the `CatalogList` route in `ExploreStack.tsx`; the route name `CatalogList` SHALL be retained so `RootNavigator.tsx`'s existing `navigation.navigate('Explore', { screen: 'CatalogList' })` tab-press handler requires no change.
2. THE `ParkDestinationScreen` SHALL replace `DestinationScreen.tsx`'s `ThemeOrWaterParkLayout` as the rendered layout for `ThemePark`/`WaterPark` destinations reached via the existing `DestinationScreen` route; `DestinationScreen.tsx`'s `ResortsLayout` (the single collapsed-accordion-per-resort list) SHALL be superseded by `Resorts_Directory` for the `Resorts` destination, reached from the Explore_Hub Resorts Spotlight Card rather than through `DestinationScreen`.
3. THE following logic already implemented in `CatalogScreen.tsx` SHALL be carried over into `ExploreHubScreen` with equivalent behavior, not re-derived: the debounced global search driving `GET /catalog?q=`, the flat search-result list replacing the grid while a query is active, the `catalog_unavailable` full-screen error state, and the stale-cache warning banner.
4. THE following logic already implemented in `DestinationScreen.tsx`'s `ThemeOrWaterParkLayout` SHALL be carried over into `ParkDestinationScreen` with equivalent behavior, not re-derived: the Lands/Price Filters modal (`destination-filters-modal`), the `favoritesOnly` multi-filter composition logic, and the land/catch-all grouping via `groupByLand`/`browseLandOf`.
5. WHEN `ExploreHubScreen` and `ParkDestinationScreen` are registered, THE App SHALL delete `CatalogScreen.tsx` and `DestinationScreen.tsx`'s `ThemeOrWaterParkLayout` (and their superseded test files) in the same change rather than leaving dead, unregistered code in the tree.
6. THE Height Requirement and Physical Considerations filter dimensions introduced by Requirement 3.4 SHALL be added to the Filters modal by extending `WHITELISTED_FACET_GROUPS` (`experiencePickerFilters.ts`) to include the `height`/`age` facet groups it currently deliberately excludes; this exclusion SHALL be treated as a reasoned reversal of an existing design decision, not an oversight, and the reason for the original exclusion SHALL be checked before removing it.
