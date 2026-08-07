# Requirements Document

## Introduction

A single physical attraction can appear in the upstream catalog (ThemeParks.wiki) as **more than one entity over time**, because Disney re-themes or film-swaps the same ride system. The clearest example is Soarin': "Soarin' Around the World" and "Soarin' Across America" are the same building, queue, and ride vehicle running a different film — ThemeParks tracks them as two `externalId`s, and Disney swaps which one is live. Each maps to its own `experiences` row and therefore its own `ride_shapes`/`experience_season_hour` history.

Because standby-wait behavior is driven by the physical ride system (throughput, capacity, popularity) and is essentially unchanged by a film swap, splitting the wait history across two identities is a modeling defect: the currently-live version can be data-thin while the dormant version's rich history sits unused, and a plan for a future date cannot know which version will be live. This feature lets multiple upstream Experiences that are **the same physical ride** be grouped under one **Canonical_Ride** so their wait history is pooled and prediction is continuous across swaps.

This is **not** an automatic name/location match. A film swap (same ride system) is aliased; a ride **replacement** (e.g. Splash Mountain → Tiana's Bayou Adventure — a different ride in the same building) is **not**. The alias set is curated by hand.

This feature depends on the shipped Crowd Calendar and Wait-Time Intelligence feature (`.kiro/specs/crowd-calendar`) for `ride_shapes`, `experience_season_hour`, the sampling pass, and `predictionService.getDaySnapshot`. It interacts with `.kiro/specs/day-planning-optimization` (planned items resolve to a Canonical_Ride for prediction and coordinates).

## Glossary

- **Canonical_Ride**: The single Experience chosen to own the pooled wait history for a set of Experiences that are the same physical ride. A non-aliased Experience is its own Canonical_Ride.
- **Alias_Experience**: An Experience whose wait history is pooled into a different Experience's Canonical_Ride (e.g. "Soarin' Across America" aliased to the Soarin' Canonical_Ride).
- **Ride_Alias_Map**: The curated mapping from each Alias_Experience to its Canonical_Ride.
- **Film_Swap**: A change of overlay/media on the same physical ride system (aliased). Distinct from a **Ride_Replacement**, where the ride itself changes (never aliased).

## Requirements

### Requirement 1: Curated canonical-ride grouping

**User Story:** As the system maintainer, I want to declare that several catalog Experiences are the same physical ride, so their wait history is treated as one continuous ride rather than fragmented per re-theme.

#### Acceptance Criteria

1. THE system SHALL persist a Ride_Alias_Map associating each Alias_Experience with exactly one Canonical_Ride Experience.
2. THE Ride_Alias_Map SHALL be curated (an explicit, human-maintained mapping) and SHALL NOT be inferred automatically from names, coordinates, or fuzzy matching.
3. WHERE an Experience has no alias entry, THE system SHALL treat that Experience as its own Canonical_Ride.
4. THE Ride_Alias_Map SHALL be acyclic and single-level: a Canonical_Ride SHALL NOT itself be an Alias_Experience, so resolving any Experience to its Canonical_Ride terminates in one step.
5. THE system SHALL NOT alias a Ride_Replacement (a different ride occupying the same building); only Film_Swaps of the same physical ride system are eligible.

### Requirement 2: Pooled wait history on write

**User Story:** As a Trip_Member relying on wait predictions, I want observations from whichever version of a ride is currently live to accrue to one shared history, so the prediction stays accurate across a film swap.

#### Acceptance Criteria

1. WHEN the sampling pass records a wait observation for an Alias_Experience, THE system SHALL attribute the `ride_shapes` and `experience_season_hour` update to that Experience's Canonical_Ride.
2. THE pooled history for a Canonical_Ride SHALL be identical regardless of which aliased version produced the observations (a wait on any alias updates the same canonical bucket).
3. THE per-day, per-experience raw signals that are inherently version-specific (daily Lightning Lane price/availability, showtimes, virtual-queue status) MAY remain attributed to the live Experience; only the aggregate wait shape/season history is pooled.

### Requirement 3: Prediction reads the canonical history

**User Story:** As a Trip_Member planning a day, I want a prediction for a ride regardless of which version I picked or which version will be live that day, so the plan is valid across swaps.

#### Acceptance Criteria

1. WHEN `getDaySnapshot` is asked for an Alias_Experience, THE Prediction_Service SHALL compute that experience's wait curve from its Canonical_Ride's pooled `ride_shapes`/`experience_season_hour` history.
2. THE Prediction_Service SHALL return the resulting `WaitSnapshot` keyed by the **originally requested** `experienceId`, so callers that key results by the id they passed are unaffected.
3. WHERE an Experience is its own Canonical_Ride, THE prediction SHALL be unchanged from current behavior.

### Requirement 4: Day-planning resolves to the canonical ride

**User Story:** As a Trip_Member, I want a planned item for one version of a ride to still produce a valid optimized plan if a different version is live on my trip date.

#### Acceptance Criteria

1. WHEN the day-planning optimize route prefetches the snapshot for a planned item that is an Alias_Experience, THE system SHALL obtain a prediction via the Canonical_Ride (per Requirement 3) rather than falling back to the flat default for want of version-specific history.
2. WHERE an Alias_Experience lacks its own geographic coordinates, THE system MAY use the Canonical_Ride's coordinates for travel-time computation (same physical location).
