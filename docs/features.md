# Disney World Tracker: Feature Inventory

What the app does, grouped by area, with where each feature lives and which spec owns it. This is a map, not a spec. The specs in `.kiro/specs/` are the source of truth for exact behavior.

**Snapshot:** commit `ab60f90` base + `SettingsScreen` relocation (2026-11-21). 51 specs, 80 API migrations.

**Keeping it current:** update this file in the same change that ships, removes or re-statuses a feature (rule in `.kiro/steering/tech-conventions.md`, "Keep `docs/features.md` current"). Bump the snapshot line when you do.

**How status was decided:** from each spec's `tasks.md` plus a check that the matching screens, routes or services exist in the code. Nothing was run on a device for this inventory. Where a spec's checkboxes disagree with the code, the code wins and the entry says so.

| Status | Meaning |
|---|---|
| Shipped | Built and wired in. |
| Partial | Built, with named pieces still open. |
| Not built | Spec exists, no code yet. |

Related docs: [`README.md`](../README.md) (setup and ops), [`hosting.md`](./hosting.md) (deploy), [`current-app-inventory.html`](./current-app-inventory.html) (screen mockups from Sept 2026, out of date), [`pin-art-direction.md`](./pin-art-direction.md).

---

## App structure (mobile)

Defined in `apps/mobile/src/navigation/`.

- **Bottom tabs:** Home, Explore, a center action button (`MagicFab`), Trips, Collection (labelled "You").
- **You & Crew** is reached from the unified header pill on both Home and You, not from the tab bar or a Collection segment. It holds identity, friends, and sharing, with a top-right header gear button opening **Settings** (`SettingsScreen`, holding preferences, account security, App Tour replay & starter checklist restore, feedback, blocked users, legal links/disclaimer, account deletion, log out, and `__DEV__`-only onboarding preview triggers).
- **Root-stack screens above the tabs:** Onboarding Flow (`OnboardingFlow` — first-run wizard & read-only Quick Guide replay), Experience Detail, Menu, Share Composer, Food List and Experience List detail and discovery, Notification Center, Pin Showcase, Hidden Mickeys (list, detail, submit, my submissions).
- **Auth stack:** Login, Register, Forgot Password, Reset Password.

---

## 1. Catalog and discovery

| Feature | Status | What it does | Where | Spec |
|---|---|---|---|---|
| Explore catalog | Shipped | Browse parks, lands, resorts and Disney Springs as destinations, then drill into experiences. Replaced the old flat chip-filtered list. | `ExploreStack`, `DestinationScreen`, `ParkDestinationScreen`, `ResortsDirectoryScreen` | `catalog-redesign`, `catalog-navigation-redesign` |
| Catalog sourcing | Shipped | Static catalog (rides, shows, restaurants, resorts, imagery, menus) comes from Disney's own data. Live data comes from ThemeParks.wiki. Syncs are incremental and checkpointed. | `apps/api/src/services/catalog/` | `disney-facilities-catalog-source`, `disney-source-resilience` |
| Taxonomy cleanup | Shipped | Hides non-experiences (pools, hot tubs, and similar) so the catalog holds only things a guest does and logs. | catalog sync | `catalog-taxonomy-cleanup` |
| Facet enrichment | Shipped | Tags experiences with facets (thrill level, festival kiosk, and so on) taken from Disney's feed. | catalog sync | `experience-facet-enrichment` |
| Search with aliases | Shipped | Finds rides by nickname or acronym (RotR, SDD, ToT, "People Mover"). | catalog search | `experience-search-aliases` |
| Experience Detail | Shipped | One screen per experience: live status strip, wait cockpit, quick specs, showtimes, about, your visit, friends' dish ratings. Resorts get a guide section. | `ExperienceDetailScreen` and `screens/catalog/` | `experience-detail-redesign`, `experience-live-details`, `experience-detail-navigation`, `experience-detail-back-navigation` |
| Restaurant menus | Partial | Menu screen with entrées, desserts and a summary card. Three tasks open. | `MenuScreen`, `MenuSummaryCard` | `restaurant-menu-display` |
| Live Waits | Shipped | Live standby waits per park. | `LiveWaitsScreen`, `intelligence/` and `live/` routes | `experience-live-details` |
| Crowd Calendar | Shipped | Predicted busyness per park per day, best day to visit, park hours and events. Its `tasks.md` is unchecked but the screen, routes, prediction service and admin accuracy pages all exist, so the checkboxes are stale. | `CrowdCalendarScreen`, `services/intelligence/` | `crowd-calendar` |
| Wait forecasting | Shipped | Learns wait shapes by ride, hour, season and weather. Scores its own forecasts and runs shadow challenger models. Driven by `POST /internal/sampling/run`. | `services/intelligence/`, admin "intelligence" pages | `crowd-calendar` |
| Ride identity aliases | Not built | Would pool wait history for one physical ride that appears as several upstream entities (Soarin' film swaps). No migration or code found. | none | `ride-identity-aliases` (0 of 16 tasks done) |

## 2. Logging, favorites and stats

| Feature | Status | What it does | Where | Spec |
|---|---|---|---|---|
| Completions and ratings | Shipped | Mark an experience done, rate it 1 to 10, add a note. | `services/tracking/` | `disney-world-tracker` |
| Visit logging | Partial | Multiple dated visits per experience, with a rating and note on each. Open: block future-dated visits, and a count-based button label. | `LogVisitModal`, `YourVisitCard` | `experience-activity-logging` |
| Unified logging | Shipped | One quick flow for logging a ride or restaurant, tied to the active trip and to who rode with you. | `LogVisitModal`, `RodeWithConfirmScreen` | `unified-experience-logging` |
| Food item logging | Shipped | Log and rate individual dishes at restaurants and festival booths. | `LogFoodItemModal`, `MyFoodHistoryScreen`, `services/foodLog/` | `food-item-logging` |
| Unified dining logging | Partial | Logging a dish also checks off the restaurant visit. One task open. | | `unified-dining-logging` |
| Festival booth tagging | Shipped | Tags EPCOT festival booths by festival and season. | `services/catalog/` | `festival-booth-tagging` |
| Favorites | Shipped | Star an experience. Favorites appear on Home. | `FavoriteToggle`, `HomeFavoritesSection` | `experience-favorites` |
| Experience Lists | Partial | Named lists of rides, shows and meets, with sharing. Open: merge "Add to Trip" and "Add to List" into one dock action, a trip picker, and moving the Collection card. | `MyExperienceListsScreen`, `ExperienceListDetailScreen` | `experience-lists` |
| Food Lists | Partial | Named lists of dishes, public or private, shareable with specific friends (live access, not a snapshot). Open: add-to-list buttons on the restaurant card and menu screen. | `MyFoodListsScreen`, `FoodListDetailScreen` | `food-lists` |
| Stats | Shipped | Coverage by park and category, ratings, interests, repeat activity and food stats, with detail screens. | `StatsStack` | `expanded-stats`, `stats-experience-redesign` |
| Resort tracking | Shipped | Track resort stays and per-resort stats. | stats and trips | `resort-tracking-and-stats` |
| Park Passport | Shipped | Per-park completion card on experience pages. | `ParkPassportCard` | `catalog-redesign` |
| Hidden Mickeys | Partial | A hunt list of Hidden Mickeys with detail pages. Users can submit new ones, and an admin reviews them. Photo-free by design. Open: writing the starter seed file and the alias file. | `screens/mickeys/`, `services/mickeys/`, admin `/admin/mickeys` | `hidden-mickeys` |

## 3. Trips and planning

All screens are in `TripsStack` and `screens/trips/`. A trip is shared by a group of friends.

| Feature | Status | What it does | Spec |
|---|---|---|---|
| Trips core | Partial | Create a trip with dates, invite friends, role-based permissions, a shared planned list, a shared log, an activity feed with reactions and comments, and a summary. Open: Budget hub tile and permissions (task 26) and undoing a logged completion (task 28). | `trips` |
| Day planning and optimizer | Shipped | Builds a day-by-day schedule and an optimized touring order that minimizes waiting and walking. Uses crowd predictions and Lightning Lane return windows. | `day-planning-optimization` (`services/planning/`) |
| Planned list to log sync | Shipped | Completing a planned item logs it, and logging checks it off the plan. | `planned-list-completion-sync` |
| Reservations | Shipped | Dining reservations, Lightning Lane windows and other timed bookings. They flow into the schedule with no sync step. | `trip-reservations` |
| Lodging stays | Shipped | A trip has an ordered list of dated stays (Disney resort or off-site), so split stays work. | `trip-lodging-stays` |
| Booking timeline and reminders | Partial | Shows when dining (60 days out) and Lightning Lane booking windows open. Sends push reminders. Includes a shared packing list. Reminders are driven by `POST /internal/trip-booking-reminders/run`. Three tasks open. | `trip-booking-timeline` |
| Expenses | Partial | Shared ledger of who paid what, who owes whom, and settle-up. Five tasks open. | `trip-expenses` |
| Budget | Shipped | Forward-looking estimate of the trip cost: tickets, Lightning Lane, dining. Ticket prices are refreshed and managed in the admin panel. The Trips spec has not yet recorded the hub tile (see Trips core). | `trip-budget` |
| Dining Plan Calculator | Shipped | Compares No Plan, Quick-Service, Table-Service and Deluxe plans for a party and a meal list. Prices are admin-managed. | `dining-plan-calculator` |
| Trip photos | Partial | Trip album and photos in the feed. Open: recipient recap album (tasks 21.6, 22.8). The `MyPhotosScreen` exists and is registered in `CollectionStack` even though its task 25 is unchecked, so that checkbox is stale. | `photo-uploads` |
| Dining reservation finder | Not built | Alerts when a table opens up. Decisions are recorded but no spec or code exists. | none |

## 4. Social

| Feature | Status | What it does | Where | Spec |
|---|---|---|---|---|
| Friends | Shipped | Search, requests, accept or decline, block. | `screens/friends/`, `BlockedUsersScreen` | `disney-world-tracker` |
| Friend profiles | Shipped | Tabbed view of a friend's progress, completions and food history. | `FriendProfileScreen`, `FriendFoodHistoryScreen` | `friend-stats-viewing`, `friend-profile-navigation` |
| Friend dish ratings | Shipped | See what friends rated at a restaurant and browse their food history. | `FriendDishSocialProof` | `friend-food-ratings` |
| Sharing | Shipped | Send an experience to friends from a picker. Recipients get an inbox with actions. Trip recaps can be shared. | `screens/share/`, `services/sharing/` | `social-sharing-loop` |
| Notification Center | Shipped | One place for friend requests, invites, shares and other items needing attention. Bell in the Home header. | `NotificationCenterScreen`, `services/notifications/` | `notification-center` |
| Push notifications | Shipped | Push delivery with per-type preferences. | `services/push/` | `notification-center`, `trip-booking-timeline` |
| Photos | Partial | Food photos on dish logs. Photos are resized on the phone, uploaded straight to object storage with presigned URLs, then screened. Open: vision evaluation, real-device checks, storage provisioning (launch gates). | `services/photos/`, admin `/admin/photos` | `photo-uploads` |

## 5. Collection and gamification

| Feature | Status | What it does | Where | Spec |
|---|---|---|---|---|
| Pins | Shipped | Collectible pins in six tiers (bronze through prism) earned from achievements: parks, coasters, dining, resorts and more. | `CollectionScreen`, `PinBoardScreen`, `services/pins/` | `pin-collection` |
| Pin Showcase | Shipped | Arrange and share a pin display. | `PinShowcaseScreen` | `pin-collection` |
| Pin art and attribution | Shipped | Artwork rules, provenance and a credits screen. | `AttributionScreen`, `docs/pin-art-direction.md` | `pin-collection` |
| Collection tab ("Vault") | Partial | Hub for pins, stats, food history, lists and photos. Open: split the "Food & Lists" segment into "Food" and "Lists" (task 17), and the Home operating-hours subtitle (task 16). | `CollectionStack` | `navigation-redesign` |

## 6. Home and onboarding

`HomeScreen` shows `HomeSearchBar` (Popular Tools, 0-trip tool bridge & alias catalog search), the cold-start `StartHereCard` checklist for new accounts, an upcoming-trip/active-vacation hero, a compact 4-park **Live Park Pulse** strip, favorites (with an Explore empty-state prompt), and the community leaderboard. Spec: `navigation-redesign` (decluttered by `first-run-onboarding`). Partial: the subtitle still evolves alongside park-hours/weather refinements (task 16).

| Feature | Status | What it does | Where | Spec |
|---|---|---|---|---|
| First-run onboarding & clarity | Shipped | Account-synced 3-step intent-based onboarding (`OnboardingGate` + `OnboardingFlowScreen`) with bulk starter ride check-in (`POST /me/onboarding/quick-completions`), cold-start Home "Start Here" checklist + Settings restore/replay, compact Home 4-park pulse strip & empty Favorites prompt, 0-pin You starter card + 4-segment `You` header Crew pill, `HomeSearchBar` Popular Tools & 0-trip bridge, and `TripDetailScreen` itinerary subtitles & upcoming banner fix. | `apps/api/src/services/onboarding/`, `0078_user_onboarding.sql`, `OnboardingFlowScreen`, `OnboardingGate`, `StartHereCard`, `ZeroPinsStarterCard`, `HomeSearchBar`, `TripDetailScreen` | `first-run-onboarding` (4 of 4 task groups done) |

## 7. Account, safety and legal

| Feature | Status | What it does | Spec |
|---|---|---|---|
| Register, login, change password | Shipped | Email and password accounts with sessions. | `disney-world-tracker` |
| Password reset | Shipped | Forgot and reset flow by email. | `password-reset` |
| Account deletion | Partial | Self-service deletion, as the App Store requires. Purge runs through `POST /internal/account-deletion/purge/run`. Open: the cron secret and cron job setup (operator tasks), and budget data dispositions. | `account-deletion` |
| Legal disclaimers and terms | Partial | Unofficial-app disclaimers, privacy policy and `/terms` page. Open: price data credits. | `legal-disclaimers-and-terms` |
| In-app feedback | Shipped | Text-only "Report a problem or send feedback", reviewed in the admin panel. | `in-app-feedback` |
| Dark mode | Partial | Light and "Twilight" dark themes. A guard test blocks raw colors. Open: retrofit foundation tasks, visual verification and a polish pass. | `dark-mode` |

## 8. Operator tools (backend)

**Admin Panel** (HTML pages under `/admin/*`, spec `admin-panel`): users and lockouts, catalog and catalog sync, config, Disney transport health, infra, growth, notifications, feedback, photos moderation, pins, Hidden Mickeys moderation, dining-plan data, ticket prices (refresh, block, diagnose), and the wait-forecast model (accuracy, derived stats, sampling).

**Scheduled jobs.** An external cron (cron-job.org) calls each endpoint with a secret header. Each accepts POST, and the ones in `hosting.md` also accept HEAD. They answer `202` and do the work after responding.

| Endpoint | Does |
|---|---|
| `/internal/sampling/run` | Samples live waits for the forecast model. Lightning Lane prices also depend on it. |
| `/internal/trip-booking-reminders/run` | Sends booking-window reminders. |
| `/internal/photos/sweep/run` | Photo housekeeping: resumes abandoned uploads, expires stale ones, prunes rejected rows, deletes orphaned objects. |
| `/internal/pins/reconcile` | Runs a full pin reconciliation pass (`reconcileAll`). |
| `/internal/account-deletion/purge/run` | Purges accounts whose deletion is due. |

Hosting, free-tier limits and the cron schedule are in [`hosting.md`](./hosting.md) and [`runbooks/`](./runbooks/README.md).

---

## Known gaps in this inventory

- Spec checkboxes were not reconciled with the code for every spec. Two were found stale (`crowd-calendar`, and `photo-uploads` task 25), so others may be too. Shipped entries rest on a complete `tasks.md` plus matching screens or routes. None were tested by running the app.
- "What it does" text for entries not individually opened in code comes from the spec introductions.
- Account deletion's remaining open tasks (19.x) are operator setup, not code. The feature may already work in production once the cron job exists.
