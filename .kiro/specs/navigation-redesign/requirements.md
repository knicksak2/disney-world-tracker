# Requirements Document

## Introduction

The App's navigation is a flat 5-tab bar (Home, Catalog, Trips, Friends, Profile) that has accreted every feature shipped since launch directly onto the Profile tab: personal stats, pin collection, pin showcase, food history, food lists, notification center, push preferences, and account security all live as a single vertical scroll under Profile. Home is a single leaderboard list with no quick-log path and no sense of where the guest is in a Trip. There is no in-app way to check a park's live attraction wait times without opening each Experience individually.

This feature redesigns the App's top-level navigation and relocates existing screens to where they are actually used, and adds one net-new capability — a park-wide Live Waits screen — that the redesign's navigation depends on to be worth building. The navigation shape is **4 tabs plus a center action control** (the "Magic FAB"): Home, Explore, (FAB), Trips, Collection. Friends, Profile identity, sharing, and account settings move to a header-reachable "You & Crew" surface. Notifications move to a global header control reachable from every screen. This is a full vertical slice — new backend route, new mobile screens, and relocated navigation — not a UI-only reshuffle.

This feature builds on top of the existing `trips`, `pin-collection`, `stats-experience-redesign`, `notification-center`, `crowd-calendar`, and `experience-live-details` specs and reuses their vocabulary and services unchanged (`Live_Service`, `themeParksDirectory`, `Trip_Activity`, `Attention_Feed`, `PinBoardScreen`, `StatsStack`). It does not change the Trips feature's internal section structure (Planned List, Schedule, Reservations, Activity, Members, Summary remain as specified in the `trips` spec, including the Requirement 20 consolidation of Shared_Log and Trip_Feed into the single Trip_Activity surface — that consolidation is preserved, not revisited, by this feature).

## Glossary

- **Main_Tab**: One of the four persistent bottom-tab destinations: Home, Explore, Trips, Collection. Distinct from the existing `MainTabParamList` tabs, which this feature replaces.
- **Magic_FAB**: The center, raised, gold action control on the bottom tab bar, positioned between Explore and Trips, that opens the Quick_Action_Sheet. Not a Main_Tab; it has no associated screen of its own and does not participate in tab selection state.
- **Quick_Action_Sheet**: The modal bottom sheet the Magic_FAB opens, presenting a fixed, ordered list of quick actions: Check Live Waits, Log Ride, Log Snack, Claim Pins (only shown when at least one Pin is claimable), and View Today's Schedule.
- **You_And_Crew**: The header-reachable surface (opened via the avatar chip in the Home header, and reachable from any Main_Tab via the same control) presenting the signed-in User's identity (avatar, display name), Friends list and search, Share inbox and sent shares, and account settings (push preferences, change password, log out). Replaces the current Profile tab and the current Friends tab as top-level destinations.
- **Notification_Bell**: The header-reachable control, present on every Main_Tab's header, that opens the existing Notification_Center's Attention_Feed as a modal sheet. Carries the existing combined Attention_Badge count unchanged.
- **Collection**: The Main_Tab presenting the User's Pins, Food History/Lists, and personal Stats as three sub-sections, replacing their current placement as buttons under Profile.
- **Live_Waits_Screen**: The net-new screen, reachable from the Explore tab and from the Quick_Action_Sheet, presenting every trackable Experience's live status and wait for a single selected Park in one list.
- **Park_Live_Snapshot**: The net-new server-side read that fetches every live entry for a Park in a single upstream call and serves it to the Live_Waits_Screen, keyed and cached separately from the existing single-Experience `Live_Cache`.
- **Walk_On_Threshold**: The configured wait-minutes value (default 25) at or below which the Live_Waits_Screen's "Walk-on" filter includes an Experience.
- **Headliner_Facet**: An Experience whose persisted `groupedFacets.thrillFactor` contains a configured high-intensity Facet_Value, used by the Live_Waits_Screen's "Headliners" filter. Reuses the existing `thrillFactor` Facet_Group; introduces no new catalog concept or persisted field.
- **Active_Trip_Mode**: The existing derived state (already computed by `Active_Trip_Shortcut` — a Trip_Member of >= 1 `active` Trip) that this feature reuses to select which quick actions the Quick_Action_Sheet leads with; it does NOT change the Main_Tab bar's shape (Requirement 8).

## Requirements

### Requirement 1: Bottom Tab Bar Restructure

**User Story:** As a guest, I want a small, stable set of top-level destinations, so that I always know where to find the app's core areas without the bar changing shape.

#### Acceptance Criteria

1. THE App SHALL present exactly four Main_Tabs on the bottom tab bar, in this order: Home, Explore, Trips, Collection.
2. THE App SHALL present the Magic_FAB as a fifth, visually distinct (raised, gold) control positioned between the Explore and Trips tabs.
3. THE App SHALL NOT remove, reorder, rename, or conditionally hide any Main_Tab based on Trip status, time of day, or any other runtime condition.
4. WHEN the App is freshly launched and a session is active, THE App SHALL select Home as the initial Main_Tab.
5. THE Friends and Profile tabs SHALL NOT be presented as Main_Tabs.

### Requirement 2: Home Tab

**User Story:** As a guest, I want Home to orient me toward what to do next, so that it is a rich command center rather than just a static leaderboard.

#### Acceptance Criteria

1. THE Home tab SHALL present, in vertical scroll order:
   - A personalized hero header featuring a time-aware greeting pill (e.g. "✨ Good morning, [Name]!"), the Notification_Bell with Attention_Badge, a pill-shaped "You & Crew" avatar chip that navigates to You_And_Crew, a hero title ("Ready for the Magic?"), and an operating context subtitle.
   - A Vacation Context hero: an Upcoming Vacation countdown card displaying days remaining, trip name, date range, and metrics when the user has an upcoming Trip; or the active in-park day card when a Trip is active; or an exploration prompt when no trips exist.
   - An Action Dock presenting quick-action tiles for Live Waits, Log Ride, Log Snack, and My Pins (with claimable badge).
   - A Park Wait Pulse horizontal carousel displaying current wait averages and line status for Magic Kingdom, EPCOT, Disney's Hollywood Studios, and Disney's Animal Kingdom, with a link to Live Waits.
   - A Community Favorites section featuring the Highest-Rated Experiences leaderboard with a "See All" link navigating to Explore.
2. THE Home tab's header SHALL present the Notification_Bell and a pill-shaped avatar chip ("You & Crew") that opens You_And_Crew.
3. THE Home tab SHALL preserve the existing leaderboard's caching (R11.7-R11.9 of `disney-world-tracker`), empty state, and tap-to-detail navigation unchanged.
4. THE Home tab's Action Dock SHALL present four quick-action controls: "Live Waits" (navigates to LiveWaits), "Log Ride" (opens LogVisitModal), "Log Snack" (opens LogFoodItemModal), and "My Pins" (navigates to Collection with claimable badge count).
5. THE Home tab's Park Wait Pulse SHALL display live wait averages across operating attractions for each of the four Walt Disney World theme parks with crowd status classification (Walk-on, Light lines, Moderate, Heavy); selecting any park navigates to Live Waits pre-filtered to that park.
6. THE Home tab's operating context subtitle SHALL derive its park hours and current weather from real server data (the existing `GET /crowd-calendar` day's `parkHours`, and a new weather read backed by the existing `weatherClient.getWDWWeather()`) for the User's active or upcoming Trip's park, defaulting to Magic Kingdom when the User has no Trip; the subtitle SHALL NOT display a hardcoded or fabricated hours or weather value under any condition, including when the underlying reads are loading or have failed. IF the weather read fails or has not yet returned, THEN THE Home tab SHALL omit the weather segment from the subtitle rather than substitute a placeholder value.

### Requirement 3: Explore Tab

**User Story:** As a guest, I want park browsing, the crowd calendar, and live wait times together in one place, so that planning and in-the-moment checking live in the same tab.

#### Acceptance Criteria

1. THE Explore tab SHALL preserve the existing Catalog_Home destination grid and global search unchanged.
2. THE Explore tab SHALL present a jump-in control to the Live_Waits_Screen and a jump-in control to the existing Crowd_Calendar screen, both reachable in one tap from the Explore tab's landing screen.
3. THE Explore tab's header SHALL present the Notification_Bell.
4. Navigating into a Destination_Screen, the Crowd_Calendar, or the Live_Waits_Screen from Explore SHALL preserve back navigation to the Explore landing screen.

### Requirement 4: Magic FAB and Quick Action Sheet

**User Story:** As a guest in a park, I want one control that is always in the same place to log a ride, log a snack, claim a pin, or check waits, so that I do not have to navigate into a specific tab to do something quick.

#### Acceptance Criteria

1. WHEN the User taps the Magic_FAB from any Main_Tab, THE App SHALL present the Quick_Action_Sheet as a modal bottom sheet without changing the selected Main_Tab.
2. THE Quick_Action_Sheet SHALL present, in order: "Check Live Waits," "Log Ride," "Log Snack," "Claim Pins" (WHERE the User has at least one claimable Pin per the existing Pin_Board claimable count), and "View Today's Schedule."
3. WHEN the User selects "Check Live Waits," THE App SHALL dismiss the Quick_Action_Sheet and navigate to the Live_Waits_Screen, defaulting to the Park of the User's active Trip WHERE one exists, else the most recently viewed Park, else the first Park in canonical order.
4. WHEN the User selects "Log Ride" or "Log Snack," THE App SHALL dismiss the Quick_Action_Sheet and present the existing LogVisitModal or LogFoodItemModal experience-selection flow unchanged.
5. WHEN the User selects "Claim Pins," THE App SHALL dismiss the Quick_Action_Sheet and navigate to the existing PinBoardScreen with `celebratePinIds` set to the User's currently claimable Pin ids, reusing the existing claim-and-celebrate queue (`pin-collection` Requirement 20, 23) unchanged. THE App SHALL NOT present a Pin_Celebration_Modal directly from the Quick_Action_Sheet without first navigating through PinBoardScreen.
6. WHEN the User selects "View Today's Schedule," THE App SHALL dismiss the Quick_Action_Sheet and navigate to the Schedule section of the User's active Trip WHERE one exists, else navigate to the Trips tab's list screen.
7. IF the User has no claimable Pins, THEN THE Quick_Action_Sheet SHALL NOT present the "Claim Pins" action.

### Requirement 5: Trips Tab

**User Story:** As a Trip_Member, I want the Trips tab to keep working exactly as it does today, so that this redesign does not regress trip planning.

#### Acceptance Criteria

1. THE Trips tab SHALL preserve the existing Trips_List_Screen and Trip_Detail_View hub with its six sections (Planned_List, Schedule Builder, Reservations, Trip_Activity, Members, Summary) unchanged, including the Requirement 20 consolidation of Shared_Log and Trip_Feed into the single Trip_Activity surface.
2. THE Trips tab SHALL NOT gain, lose, merge, or split any section as a result of this feature.
3. THE Trips tab's header SHALL present the Notification_Bell.

### Requirement 6: Collection Tab

**User Story:** As a guest, I want my pins, food history, and stats in one place separate from my account settings, so that Profile is no longer a catch-all.

**Amendment (superseded in part by `experience-lists` Requirement 12's revision):** the "Food &
Lists" segment (R6.6, R6.8) is split into two separate segments — "Food" (logging and food-history
content only) and "Lists" (both Food_Lists and Experience_Lists, presented as peers). This split
exists because Experience_Lists are not food-related, and sharing a segment named "Food & Lists"
with them read as an unrelated capability tacked onto a food-specific screen rather than a
first-class part of the hub. The acceptance criteria below are left unchanged as this
requirement's historical record; see the new Requirement 6.6a–6.8b below for the current
four-segment structure, and `experience-lists` Requirement 12 for the Lists segment's own entry
point behavior.

#### Acceptance Criteria

1. THE Collection tab SHALL present three sub-sections reachable from its landing screen: Pins (the existing PinBoardScreen and PinShowcaseScreen, with a claimable-count indicator), Food (the existing MyFoodHistoryScreen and MyFoodListsScreen), and Stats (the existing StatsStack Overview hub).
2. THE Collection tab SHALL preserve the existing behavior, caching, and navigation of PinBoardScreen, PinShowcaseScreen, MyFoodHistoryScreen, MyFoodListsScreen, and the StatsStack unchanged; this feature relocates their entry points only.
3. THE Collection tab's header SHALL present the Notification_Bell.
4. THE Collection tab's landing screen SHALL present the same claimable-Pin count used by the existing Attention_Badge composition unchanged.
5. THE Collection tab SHALL present the display label "Vault" in the bottom tab bar, displaying an unread badge indicating the claimable-pin count WHERE claimable pins exist.
6. THE Collection/Vault landing screen SHALL present a three-way segmented pill control — "Pins & Showcase", "Food & Lists", and "Park Stats" — defaulting to "Pins & Showcase".
6a. (Supersedes Requirement 6.6 per this Requirement's amendment above.) THE Collection/Vault
   landing screen SHALL present a four-way segmented pill control — "Pins", "Food", "Lists", and
   "Park Stats" — defaulting to "Pins". "Pins" carries the pre-existing claimable-pin unread
   badge, unchanged. "Lists" carries no count badge — a list count is not actionable/urgent the
   way a claimable pin is, so no badge is warranted there.
7. WHEN "Pins & Showcase" is active, THE screen SHALL present: (a) a gold claim banner with a direct claim action navigating to PinBoardScreen with `celebratePinIds` WHERE claimable pins exist; (b) a display-mode corkboard canvas rendering the user's placed pins scaled from fractional coordinates on cork texture, with a "Customize ✏️" action navigating to PinShowcaseScreen and pin taps opening PinDetailModal; (c) a collection progress card with overall collected percentage and tier breakdown badges, with a direct action navigating to PinBoardScreen.
8. WHEN "Food & Lists" is active, THE screen SHALL present: (a) logged snack count and saved list count summary metrics; (b) the user's active food list with an action navigating to list detail or discovery; (c) a recent treats preview displaying recently logged items with ratings; (d) an action navigating to MyFoodHistoryScreen.
8a. (Supersedes Requirement 6.8 per this Requirement's amendment above.) WHEN "Food" is active,
    THE screen SHALL present: (a) a logged-snacks-count summary metric (no list-count metric — list
    content moved to the "Lists" segment); (b) a "Log a food item" primary action opening the
    existing restaurant-then-dish picker flow (`ExperiencePicker` scoped to dining, then
    `FoodItemPickerModal`, then `LogFoodItemModal` — the same flow `MagicFab`'s "Log Snack" quick
    action already uses, reused here rather than duplicated) so a User can log food without
    leaving this segment; (c) a recent treats preview displaying recently logged items with
    ratings; (d) the Classic Treats Checklist card; (e) an action navigating to
    `MyFoodHistoryScreen`.
8b. WHEN "Lists" is active, THE screen SHALL present the User's "My Food Lists" and "My Experience
    Lists" cards as peers (neither visually subordinate to the other), each with its own active-list
    preview and a "+ New / Discover" action, per `experience-lists` Requirement 12's entry-point
    behavior for the Experience_Lists card and the pre-existing behavior for the Food_Lists card.

**Amendment — Multi-Row Preview, Pin-Aware Ordering, Deep Link, and Inline Create:** the single
active-list preview row named in 8b read as an arbitrary pick to Users with more than one list —
it silently selected index 0 of the owned list array with no visible reason, and tapping it (or
"+ New / Discover") navigated to the full list-management screen rather than the specific list
itself. 8c below supersedes 8b's single-row/single-destination behavior for both the "My Food
Lists" and "My Experience Lists" cards; 8b's peer-cards framing and "+ New / Discover" as the
Discover-only action are otherwise unchanged.

8c. (Supersedes 8b's single-preview-row and single-destination behavior.) WHEN "Lists" is active,
    THE "My Food Lists" and "My Experience Lists" cards SHALL each render up to 4 of the User's
    owned lists of that type as individual rows, ordered pinned-first (per `food-lists` Requirement
    14.4 / `experience-lists` Requirement 19.4) then by `updatedAt DESC` among the rest; WHERE the
    User owns more than 4 lists of that type, THE card SHALL render a fifth "View all (N) →" row
    (`N` = total owned count) navigating to `MyFoodListsScreen`/`MyExperienceListsScreen`; WHERE
    the User owns 4 or fewer, no such row is rendered. Each list row SHALL navigate directly to
    that specific list's `FoodListDetail`/`ExperienceListDetail` screen (not to the management
    screen) and SHALL render a pin/unpin toggle control per `food-lists` Requirement 14.5 /
    `experience-lists` Requirement 19.5. A User MAY pin up to 4 lists per list type (Food Lists
    and Experience Lists); IF a User attempts to pin a 5th list of that type, THE App SHALL
    display an alert titled "Pin Limit Reached" informing the User that they can pin up to 4
    lists and must unpin one first, and SHALL NOT issue or allow a 5th pin mutation. Each card's
    header SHALL additionally present a "+ New" action, distinct from "Discover", that opens
    the same create-list modal `MyFoodListsScreen`/`MyExperienceListsScreen` already uses, without
    navigating away from the Collection screen; "Discover" continues to navigate to
    `FoodListDiscoveryScreen`/`ExperienceListDiscoveryScreen` unchanged.
9. WHEN "Park Stats" is active, THE screen SHALL present overall completion and per-park coverage progress bars derived from `/me/stats`, with an action navigating to the StatsStack overview.

### Requirement 7: You & Crew (Identity, Friends, Settings)

**User Story:** As a guest, I want my identity, friends, and account settings together behind one entry point, so that they are not spread across two top-level tabs.

#### Acceptance Criteria

1. THE App SHALL present an avatar chip in the Home tab's header that, when tapped, opens You_And_Crew.
2. You_And_Crew SHALL be reachable from every Main_Tab via the same avatar-chip control in that tab's header.
3. You_And_Crew SHALL present, in order: the existing avatar-preset picker and editable display-name control, the existing Friends list with search and a per-friend "Compare Stats" control, the existing Share Inbox and Sent Shares entry points, and the existing push-notification-preference, change-password, and log-out controls.
4. You_And_Crew SHALL preserve the existing behavior, validation, and error handling of AvatarPicker, the display-name PATCH flow, FriendsListScreen, FriendsSearchScreen, InboxScreen, SentSharesScreen, PushNotificationPreferenceControl, and ChangePasswordControl unchanged; this feature relocates their entry points only.
5. THE App SHALL NOT present Friends or Profile as a selectable Main_Tab.
6. [Retired: Settings controls are rendered inline directly below Shared Items; the header shortcut is omitted to avoid duplicate navigation affordances.]
7. WHILE the user has more than `MAX_INLINE_FRIENDS` (constant value 3) friends, You_And_Crew SHALL display at most `MAX_INLINE_FRIENDS` friends inline and SHALL present an expand/collapse control that toggles between the capped list and the full friends list.

### Requirement 8: Notification Center Relocation

**User Story:** As a guest, I want to check my notifications from anywhere in the app, so that I do not have to go into Profile to see what is waiting for me.

#### Acceptance Criteria

1. THE App SHALL present the Notification_Bell in the header of every Main_Tab.
2. WHEN the User taps the Notification_Bell, THE App SHALL open the existing NotificationCenterScreen's Attention_Feed as a modal sheet.
3. THE Notification_Bell SHALL display the existing combined Attention_Badge count unchanged, reading the same shared query cache the badge reads today (`disney-world-tracker` R22.5, notification-center R4.5, R5.6, R10.6).
4. Closing the Attention_Feed sheet SHALL return the User to the Main_Tab and screen they were on when they opened it.

### Requirement 9: Live Waits — Park-Wide Read

**User Story:** As a guest in a park, I want to see every ride's live wait in one list, so that I can decide where to go without opening each ride individually.

#### Acceptance Criteria

1. THE App SHALL expose a Park_Live_Snapshot server-side read that, for a given Park, fetches every live entry for that Park's ThemeParks.wiki entity and its children in a single upstream request.
2. THE Park_Live_Snapshot SHALL resolve a Park to its ThemeParks.wiki entity id via the existing `themeParksDirectory`/park-entity resolution used by the existing sampling pass, reusing that resolution rather than introducing a second mapping.
3. THE Park_Live_Snapshot SHALL be cached server-side, separately from the existing per-Experience `Live_Cache`, WHERE a cached snapshot exists and is within its freshness window, THE System SHALL serve it without a new upstream request.
4. IF a fresh Park_Live_Snapshot retrieval fails and a cached snapshot exists, THEN THE System SHALL serve the cached snapshot marked stale, consistent with the existing per-Experience Live_Cache's stale-serve behavior (`experience-live-details` R2.6, R2.7, R3.1).
5. IF a fresh Park_Live_Snapshot retrieval fails and no cached snapshot exists, THEN THE System SHALL respond with the existing `live_unavailable` error envelope.
6. THE Park_Live_Snapshot SHALL project only Experiences the Catalog already tracks for that Park (matched via the existing Enterprise_Id / `upstream_entity_id` join), omitting live entries that do not correspond to a tracked Experience.
7. THE Park_Live_Snapshot SHALL NOT contact any Disney source; it SHALL contact only the ThemeParks.wiki live endpoint, consistent with the existing Live_Service's isolation from Disney sources (`experience-live-details` R11.10, R12.3).
8. THE Park_Live_Snapshot SHALL project coarse Lightning Lane state (`lightningLane?: LightningLaneState`) from ThemeParks.wiki's `queue.PAID_RETURN_TIME` or `queue.RETURN_TIME` when available (`experience-live-details` R11.6).

### Requirement 10: Live Waits Screen

**User Story:** As a guest, I want to switch parks, filter by walk-on, lightning lane, or headliner rides, and jump straight to logging a ride, so that Live Waits is a fast, beautifully presented in-park utility.

#### Acceptance Criteria

1. THE Live_Waits_Screen SHALL present a Park selector limited to the parks the Catalog tracks, defaulting per Requirement 4.3 when reached via the Magic_FAB, else defaulting to the most recently viewed Park, else the first Park in canonical order, styled with themed park emoji icons.
2. THE Live_Waits_Screen SHALL present each tracked queue-eligible Experience in the selected Park (categories Ride and Character_Meet, or any Experience actively posting a standby wait) with its live wait in minutes (or a closed/down indicator absent a numeric wait), sorted by ascending wait with closed/down entries last, and SHALL exclude Restaurants and schedule-only entertainment that do not post standby wait times.
3. THE Live_Waits_Screen SHALL present four filters — "All" (displaying the total count of eligible attractions), "Walk-on", "Lightning Lane", and "Headliners" — defaulting to "All."
4. WHEN the "Walk-on" filter is selected, THE Live_Waits_Screen SHALL display only Experiences whose live wait is a numeric value less than or equal to the configured Walk_On_Threshold.
5. WHEN the "Headliners" filter is selected, THE Live_Waits_Screen SHALL display only Experiences that are a Headliner_Facet.
6. WHEN the "Lightning Lane" filter is selected, THE Live_Waits_Screen SHALL display only Experiences that are eligible for or currently reporting Lightning Lane availability.
7. THE Live_Waits_Screen SHALL present a "Log" control on each Experience row that opens the existing LogVisitModal flow for that Experience.
8. THE Live_Waits_Screen SHALL display the snapshot's retrieval time and, WHERE the snapshot is stale, a staleness indicator, consistent with the existing per-Experience live detail's staleness presentation.
9. IF the Park_Live_Snapshot read fails with no cached data, THEN THE Live_Waits_Screen SHALL present the existing "live unavailable" empty state.
10. THE Live_Waits_Screen SHALL present a Crowd Status radar card displaying the selected Park's calculated crowd level and average wait time with peak line guidance and a tips modal.
11. THE Live_Waits_Screen SHALL present each attraction card with a status indicator dot (low, moderate, high, down), attraction title, land name, real-time Lightning Lane return time/price when available, a prominent numeric wait with min wait label, and a quick Log button formatted with clean non-overlapping spacing.

## Configuration & Constants

- `WALK_ON_THRESHOLD_MINUTES` (default `25`) — the Walk_On_Threshold used by Requirement 10.4. Env var: none (compile-time constant in `packages/shared`, matching the pattern of other display thresholds); adjustable without a migration.
- `MAX_INLINE_FRIENDS` (default `3`) — the maximum inline friend display count used by Requirement 7.7 before capping and displaying the expand/collapse toggle.
- `HEADLINER_THRILL_FACET_VALUES` (default: the highest-intensity `thrillFactor` Facet_Value id(s) observed in the synced catalog — to be confirmed against real synced data before implementation and pinned as a literal list, not a threshold comparison) — the Headliner_Facet match set used by Requirement 10.5.
- `PARK_LIVE_CACHE_TTL_SECONDS` (default `300`, matching the existing per-Experience `LIVE_CACHE_TTL_SECONDS`) — the Park_Live_Snapshot freshness window used by Requirement 9.3.
- `PARK_LIVE_CACHE_RETENTION_SECONDS` (default `86400`, matching the existing per-Experience `LIVE_CACHE_RETENTION_SECONDS`) — the Redis key retention backing the Requirement 9.4 stale-serve fallback.
- Home tab operating-context weather (Requirement 2.6): no new constant — reuses the existing `weatherClient.ts`'s `WEATHER_REFRESH_MS` (default 1 hour, env-overridable) cache window unchanged. The mobile-side `GET /weather/current` query's `staleTime` SHOULD match this window (60 minutes) so the client does not poll more frequently than the server-side cache refreshes.

## External Interfaces

- **ThemeParks.wiki `GET /entity/{parkGuid}/live`** (existing upstream, new usage) — verified live against the production API: given a park's ThemeParks.wiki entity GUID, returns a single JSON object `{ id, name, entityType, timezone, liveData: LiveEntry[] }` where `liveData` contains **every child entity's** live entry (confirmed: 71 entries returned for Magic Kingdom in one request, including the park entity itself). Each `LiveEntry` carries `id`, `name`, `status`, and `queue.STANDBY.waitTime` (nullable) among other fields — the same shape the existing `ThemeParksLiveClient`/`ThemeParksLiveEntry` types already model for the single-entity case. This is the same call shape `samplingService.runSamplingPass` already issues per-park during its cron pass (`liveClient.getEntityLive(park.id)`); the Park_Live_Snapshot read reuses this shape for an interactive (cached, on-demand) read rather than the batch sampling path.
- **Park → ThemeParks.wiki entity GUID resolution** — reuses the existing `catalogClient.getDestinations()` → WDW destination → `parks[]` enumeration already used by `samplingService.ts`, or the existing `themeParksDirectory` where equivalent; no new resolution mechanism is introduced.
- **`GET /weather/current`** (new route, Requirement 2.6) — thin wrapper over the existing `weatherClient.getWDWWeather()` (Open-Meteo, keyless, already used server-side by `predictionService`/`samplingService`). No new upstream integration; the route only maps the existing `WeatherResult.current` shape (`{ temp_f, condition }` or `null`) onto the shared `CurrentWeatherDTO` (`{ tempF, condition }` or `null`).

