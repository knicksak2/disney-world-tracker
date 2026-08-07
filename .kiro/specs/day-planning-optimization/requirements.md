# Requirements Document

## Introduction

The Day Planning and Wait Time Optimization feature lets Trip_Members organize their planned experiences into a day-by-day schedule and receive an optimized touring plan that minimizes time spent waiting in line and walking between attractions.

This feature **depends on the Crowd Calendar and Wait-Time Intelligence feature** (`.kiro/specs/crowd-calendar`), which owns the wait-time model, the crowd forecast, and the collection/seed pipeline. Day Planning consumes that feature's Prediction_Service (`getDaySnapshot()` and `crowdMultiplier()`) to obtain predicted waits for a date; it does not reimplement wait prediction, sampling, or seeding. Its own concerns are the scheduling model (fixed/flexible items, breaks, Lightning Lane, priorities), the optimization engine, and the timeline UI.

The optimizer solves a Time-Dependent Traveling Salesperson Problem: the cost of visiting an attraction depends on when you arrive, using the predicted wait at that simulated time. It respects user constraints — fixed-time events (Lightning Lane returns, dining), Lightning Lane usage, group walking pace, breaks, must-do priorities, park hours, and park-hopping transit.

## Glossary

- **Day_Planner**: The feature allowing Trip_Members to assign Planned_Items to dates and receive optimized schedule suggestions.
- **Schedule**: An ordered list of planned activities for a specific calendar day within a Trip.
- **Fixed_Item**: A planned activity with a user-specified start time the optimizer MUST NOT move (e.g., a Lightning Lane return or dining reservation).
- **Flexible_Item**: A planned activity whose start time is chosen by the optimizer.
- **Prediction_Service**: The Crowd Calendar feature's consumable API. The method actually used here is `getDaySnapshot(experienceIds: string[], park: string, date: Date): Promise<Record<string, WaitSnapshot>>` (note the argument order is **park before date**, and the return is a map keyed by `experienceId`); it is the sole source of predicted waits.
- **Optimization_Engine**: The backend logic that computes the optimal ordered schedule for a day.
- **Walking_Pace**: A per-Trip setting (`slow`, `moderate`, `fast`) scaling travel time between experiences.
- **Transit_Penalty**: A fixed 45-minute cost added when consecutive items are in different Parks (park hopping).
- **Early_Entry**: A 30-minute window before official opening for Disney Resort guests, usable when enabled.
- **Priority**: A per-item ranking (1 = Must-Do, 2 = Standard, 3 = Nice-to-Do) used to decide what to drop when a day is over-constrained.

## Requirements

### Requirement 1: Wait Prediction Dependency

**User Story:** As a Trip_Member, I want my plan built on the app's wait-time predictions, so that the suggested order reflects realistic waits for my chosen date.

#### Acceptance Criteria

1. THE Optimization_Engine SHALL obtain all predicted waits from the Crowd Calendar feature's Prediction_Service (`getDaySnapshot`) and SHALL NOT implement its own wait model, sampling, or seeding.
2. THE Optimization_Engine SHALL request predictions for the specific `planned_date`, so that same-day live correction and future-date forecasts are handled by the Prediction_Service transparently.
3. IF the Prediction_Service returns a fallback prediction (e.g., no live data for a far-future date), THE Optimization_Engine SHALL still produce a plan without failing.
4. THE Day Planner MAY link to the Crowd Calendar so a user can pick a low-crowd date before optimizing it.

### Requirement 2: Day Scheduling and Constraints

**User Story:** As a Trip_Member, I want to organize my planned experiences into a specific day and mark fixed times, breaks, Lightning Lanes, and priorities, so that the optimizer builds a realistic schedule around my real constraints.

#### Acceptance Criteria

1. THE Trip_Service SHALL allow a Trip_Member to assign a `planned_date` and `planned_time` to any item in the Planned_List.
2. THE Trip_Service SHALL support an `is_fixed` flag indicating that `planned_time` is a hard constraint (e.g., a Lightning Lane return or dining reservation).
3. THE Trip_Service SHALL support an `is_lightning_lane` flag; a Lightning_Lane item SHALL be modeled with a minimal return-and-board wait rather than the standby prediction.
4. THE Trip_Service SHALL support an `item_type` discriminator allowing `break` items (e.g., dining reservations, rest breaks). Break items SHALL link to a catalog experience (e.g. dining location or venue) preserving non-null `experience_id` and geographic coordinates (`latitude`/`longitude`) for walking time calculations, and SHALL support a custom `duration_minutes` (defaulting to 45 minutes).
5. THE Trip_Service SHALL allow a `priority` per item (1 = Must-Do, 2 = Standard, 3 = Nice-to-Do).
6. THE Trip_Service SHALL allow multiple instances of the same Experience in a single Trip.


### Requirement 3: Optimization Engine

**User Story:** As a Trip_Member, I want the app to suggest the best order for my day, so that I spend less time in line and walking and more time enjoying the parks.

#### Acceptance Criteria

1. THE Optimization_Engine SHALL compute a suggested ordered sequence and per-item arrival time for all Flexible_Items, reading the predicted wait for each item at its simulated arrival time from the Prediction_Service snapshot.
2. THE optimizer SHALL minimize the cost function `Total_Wait_Time + Total_Travel_Time` over the day.
3. THE optimizer SHALL keep every Fixed_Item at its user-defined time and slot Flexible_Items around Fixed_Items without overlaps.
4. THE optimizer SHALL compute travel time from the Experiences' geographic coordinates using Haversine distance with a 1.4× walking-path factor; WHERE an Experience has no coordinates, it SHALL apply a default intra-park travel time.
5. THE travel time SHALL scale by the Trip's `walking_speed` as absolute speeds — `fast`: 100 m/min, `moderate`: 80 m/min, `slow`: 50 m/min.
6. THE optimizer SHALL add a 45-minute Transit_Penalty whenever an item's Park differs from the previous item's Park.
7. IF `early_entry_eligible` is TRUE, THE optimizer SHALL start the schedule 30 minutes before official opening and use rope-drop-appropriate waits for that window.
8. WHEN the schedule cannot fit all items within operating hours, THE optimizer SHALL keep higher-priority items and drop or defer lower-priority ones, and SHALL report which items were not fitted.
9. THE Optimization_Engine SHALL accept at most 20 items per day per request and SHALL return within a 2-second latency budget (excluding any Prediction_Service call, which is prefetched once per request).
10. THE Optimization_Engine SHALL be deterministic: identical inputs (including a fixed random seed for any restarts) SHALL produce an identical result.
11. WHEN a standby or single-rider item is scheduled within the first 30 minutes of the operating window's open (rope drop — including the early-entry window when `early_entry_eligible` is TRUE, which begins the window 30 minutes early per R3.7), THE optimizer SHALL model its wait as ramping linearly from a near-walk-on floor (5 minutes) at open up to the full predicted wait at the end of that 30-minute window, and SHALL never raise a wait that is already at or below the floor. This makes rope-dropping a headliner read as a near-walk-on wait rather than the hourly-average standby wait.
12. THE optimizer SHALL take a per-Experience `operatesDuringEarlyEntry` flag (sourced from the catalog per `disney-facilities-catalog-source`; an unknown/absent flag is treated as NOT operating during Early Entry). WHERE the day is `early_entry_eligible` and an Experience does not operate during Early Entry, THE optimizer SHALL clamp that Experience's earliest arrival to official park open (it MUST NOT be scheduled in the [official open − 30 min, official open) early-entry window). WHERE an Experience operates during Early Entry, THE optimizer MAY schedule it from early-entry open. THE rope-drop opening ramp (R3.11) SHALL be anchored per Experience to the time it can first be ridden — early-entry open for Early-Entry Experiences on an early-entry day, official open otherwise — so a ride that opens at park open is modeled with its opening ramp starting at official open, not 30 minutes early. This change does NOT model the elevated waits a non-Early-Entry headliner can have immediately at official open from the early-entry crowd surging over; that remains the deferred per-ride opening-curve calibration.
13. THE optimizer SHALL take per-Experience `operatesDuringExtendedEvening` and `operatesDuringTicketedEvent` flags (sourced from the catalog; unknown/absent treated as NOT operating). WHERE a day uses Extended Evening hours, only Experiences that operate during Extended Evening MAY be scheduled to complete within the +120-minute evening extension; every other Experience (including unknown-flag) SHALL close at base park hours. WHERE a day has an after-hours Special Ticketed Event, only Experiences that operate during that event MAY be scheduled to complete within the +180-minute extension; others SHALL close at base hours. Concretely, an Experience's latest allowed completion is base close plus only the extensions it is eligible for. (This gates the *end* of the day symmetrically to the Early-Entry start clamp of R3.12; it does not re-model the after-hours event's own park-close/reopen boundary, which remains approximated by the existing mix-in start.)

### Requirement 4: Day Planner UI

**User Story:** As a Trip_Member, I want a clear, interactive date-based schedule builder and timeline view, so that I can easily plan my day, add experiences inline, set dining/LL options, and follow an optimized itinerary in the park.

#### Acceptance Criteria

1. THE App SHALL provide a "Schedule Builder" view (`TripScheduleScreen`) within the Trip stack that features a horizontal scrollable Date Selector Bar for switching between trip calendar dates.
2. THE Schedule Builder SHALL provide an inline **"+ Add Experience to [Date]"** action opening an `ExperiencePicker` modal, allowing users to search the Catalog and add attractions, dining spots, or shows directly to the currently selected day (persisting `plannedDate`) without leaving the Schedule Builder.
3. THE Schedule Builder SHALL render a persistent chronological **Itinerary Timeline** for the selected day, displaying items assigned to that day along with arrival times, predicted wait times, dining/LL badges, and walking time connectors (`+3m walk`) derived from attraction coordinates.
4. THE Schedule Builder SHALL provide an Item Settings control with a **Native Time Wheel Picker Dialog** (3 wheel columns: Hour 1-12, Minute :00-:45, AM/PM + quick presets), allowing users to pick a Pass/Reservation Time (`plannedTime`) effortlessly, set Fixed Time locks (for dining reservations or show return times), toggle `is_lightning_lane` (⚡ with pass time), toggle `use_single_rider` (👤), set `priority` (1-3), and set custom durations for dining/breaks.
5. THE Schedule Builder SHALL provide an **"✨ Optimize Day"** action per date with a loading state, which executes the backend optimizer, persists calculated timestamps to the database, refetches updated trip state, and smoothly updates the persistent timeline view.
6. THE App SHALL format all optimization warning codes (`infeasible_fixed_gap`, `over_constrained`, `expired_lightning_lane`) and experience notes into clean, human-readable user messages using experience names instead of raw internal keys or UUIDs.
7. WHERE an Experience has `is_lightning_lane` enabled with a start time, THE Optimization_Engine SHALL model its return window as 1 hour starting at `planned_time` with a 5-minute early grace period and 15-minute late grace period (valid arrival range: `[start - 5m, start + 75m]`), and THE Item Settings modal SHALL maintain local form draft state while open, saving to the API only when the user confirms.
8. THE Schedule Builder SHALL provide a Schedule Settings modal (via header gear action `⚙️`) allowing users to configure per-date Day Touring Hours (start/end hour preset pills e.g. 8:00 AM – 9:00 PM for the active date), toggle Early Entry Eligibility (30m early access), and select Walking Pace (`slow`, `moderate`, `fast`), passing each date's custom hours to the Optimization_Engine.

### Requirement 5: Authorization and Time Zones

**User Story:** As a Trip_Member, I want scheduling to use the correct park time zone and be editable only by authorized members, so that my plan stays accurate and private.

#### Acceptance Criteria

1. THE Trip_Service SHALL permit only Trip_Members to view or optimize a Trip's schedule, reusing the existing Trip permission model; scheduling actions SHALL be added to that model as Member-allowed actions.
2. THE Trip_Service SHALL interpret and display all `planned_time` values in the Walt Disney World time zone (`America/New_York`), reusing the existing WDW clock, and SHALL store them as UTC `TIMESTAMPTZ`.

### Requirement 6: Experience-Type-Aware Optimization

**User Story:** As a Trip_Member, I want the optimizer to handle shows, virtual-queue rides, and single-rider correctly, so that my plan is realistic for attractions that don't behave like a normal standby line.

#### Acceptance Criteria

1. THE Optimization_Engine SHALL read per-experience type signals (single-rider wait, virtual-queue status, showtimes, Lightning Lane info) from the Prediction_Service `WaitSnapshot`.
2. WHERE an Experience is a show, THE optimizer SHALL schedule it to one of its showtimes and model its wait as the time until the next show rather than a standby wait.
3. WHERE an Experience uses a virtual queue, THE optimizer SHALL NOT standby-optimize it; it SHALL flag the item for boarding-group signup and exclude it from standby wait accumulation.
4. THE Trip_Service SHALL support a per-item `use_single_rider` flag; WHERE set, THE optimizer SHALL use the single-rider wait from the snapshot for that item.
5. THE optimized timeline SHALL indicate when an item is planned via single-rider, a show slot, or a virtual queue, so the user understands the suggestion.
6. IF the `WaitSnapshot` for an Experience does not carry the signal a type needs (e.g. `showtimes` is absent for a show on a far-future date), THE optimizer SHALL fall back to treating it as a standby item rather than failing — never read an absent field as a wait. (`getDaySnapshot` now populates `waits[].singleRiderWaitMinutes` for any date, and `showtimes` / `lightningLane` whenever per-date signals exist; only far-future `showtimes` are inherently unavailable, hence this fallback.)

### Requirement 7: Extended Evening Hours, After-Hours Ticket, and Touring Hours Persistence

**User Story:** As a Trip_Member, I want to configure per-date Extended Evening Hours (+120 min), Ticketed After-Hours Events (+180 min / 4 PM mix-in start), Early Entry, and Walking Pace and have them persisted on my Trip record, so that the optimizer generates accurate schedule windows for special park events and custom touring preferences.

#### Acceptance Criteria

1. THE Trip_Service SHALL support persisting `walking_speed`, `early_entry_eligible`, and a JSONB `day_touring_hours` map containing per-date `{ startHour, endHour, useEarlyEntry, useExtendedEvening, hasAfterHoursTicket, startingPark }` settings on `trips`, exposed via `TripDTO` and editable via `PATCH /trips/:id`.
2. IF `useExtendedEvening` is TRUE for a date, THE Optimization_Engine SHALL extend the operating window closing time by 120 minutes (+2 hours).
3. IF `hasAfterHoursTicket` is TRUE for a date, THE Optimization_Engine SHALL extend the operating window closing time by 180 minutes (+3 hours) and, WHERE `startHour` is not explicitly customized to an earlier morning hour, SHALL set default mix-in itinerary start time to 16:00 (4:00 PM ET).
4. THE Schedule Settings Modal SHALL provide interactive controls for Walking Pace (`slow`, `moderate`, `fast`), Early Entry Eligibility, Extended Evening Hours, Ticketed After-Hours Events, and Starting Park selection, persisting all settings to the backend API via `PATCH /trips/:id` on Done.
5. WHEN `startingPark` is configured for a date, THE Optimization_Engine SHALL prioritize starting the itinerary at `startingPark` and SHALL apply a penalty if the first item is scheduled in a different park.
6. WHEN a user selects a Starting Park in Schedule Settings, THE App SHALL automatically populate the Day Start Time to that park's official opening time and update the Park Open to Close preset button to match that park's operating schedule.

### Requirement 8: Persisted Optimization Results and Un-Optimized State

**User Story:** As a Trip_Member, I want my optimized plan to be saved so that returning to the Schedule Builder shows my last result instead of resetting, and I want it to be obvious when a day has not been optimized yet so I am never shown placeholder wait times as if they were real predictions.

#### Acceptance Criteria

1. WHEN the Optimization_Engine produces a plan, THE Trip_Service SHALL persist, for each scheduled item, its derived `predicted_wait_minutes`, its travel-from-previous leg (`travel_from_prev_minutes` and `travel_from_prev_kind` ∈ {`walk`, `park_hop`}), and an `optimized_at` timestamp, alongside the already-persisted `planned_time`.
2. WHEN the Schedule Builder loads a day whose items carry a persisted optimization result, THE App SHALL render those persisted predicted waits and travel connectors (never placeholder constants) and SHALL display when the day was last optimized (from the latest `optimized_at` of that day's items).
3. WHERE a day's scheduled items have no persisted optimization result, THE App SHALL NOT display a predicted wait time for those items and SHALL indicate that the day has not been optimized yet.
4. WHEN a Planned_Item's scheduling-relevant fields are edited after an optimization, THE Trip_Service SHALL clear that item's persisted optimization result (`predicted_wait_minutes`, travel legs, and `optimized_at`) so a stale wait or travel time is never shown as current until the day is re-optimized.

