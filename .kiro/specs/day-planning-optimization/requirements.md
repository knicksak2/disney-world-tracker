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
4. THE Trip_Service SHALL support an `item_type` discriminator allowing `break` items (e.g., "Lunch") to be placed in the schedule.
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

### Requirement 4: Day Planner UI

**User Story:** As a Trip_Member, I want a clear timeline view of my suggested day, so that I can follow the plan while in the park.

#### Acceptance Criteria

1. THE App SHALL provide a "Schedule" view within the Trip detail that groups planned items by date and separates unscheduled items.
2. THE Schedule view SHALL let users toggle an item between Fixed and Flexible, set times for Fixed_Items, mark Lightning_Lane items, add breaks, and set priority.
3. THE Schedule view SHALL provide an "Optimize Day" action per date with a loading state.
4. THE optimized timeline SHALL show suggested arrival times, predicted waits, and travel indicators (e.g., "12 min walk", "45 min park hop").
5. THE App SHALL warn the user when the suggested schedule extends beyond operating hours or when high-priority items could not be fitted.

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
