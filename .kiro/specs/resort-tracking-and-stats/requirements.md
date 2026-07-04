# Requirements Document

## Introduction

Today the App tracks a User's progress against Experiences (rides, shows,
restaurants, and so on) and reports completion statistics broken down by Park
and by Experience_Category. Two kinds of "hotel" content have nowhere to live
in this model:

1. **Resort-area Experiences** — Experiences whose Area_Type is `Resort` (for
   example a resort restaurant, spa, or recreation activity). These already
   exist in the catalog and are already completable, but they carry no owning
   Park (`experiences.park` is NULL for them), so the current Stats_Service —
   which groups strictly by Park and Category and discards Park-less rows —
   drops them from every statistic, including the overall total.

2. **Resorts themselves** — a Resort (a Walt Disney World hotel) is a
   first-class catalog entity persisted in its own `resorts` table, not an
   Experience. There is no way for a User to record that they have stayed at or
   visited a Resort, and therefore no way to see Resort progress.

This feature makes both kinds of content trackable and visible. It introduces
an Area_Type dimension to completion statistics so resort-area Experiences are
counted, and it makes Resorts completable so a User can track which Resorts
they have visited and see that progress alongside their other statistics — for
themselves and, under the existing authorization rules, for their Friends.

## Glossary

- **App**: The Disney World Tracker mobile application as a whole.
- **User**: An authenticated account holder of the App.
- **Experience**: An individual catalog item at Walt Disney World, such as a
  ride, show, restaurant, parade, character meet-and-greet, tour, recreation
  activity, spa, or event.
- **Active Experience**: An Experience currently present in the catalog and not
  marked inactive; inactive Experiences are excluded from browse, search,
  filter, and statistics while their Completion, Rating, and Note records are
  preserved.
- **Park**: One of the Walt Disney World theme parks, water parks, or Disney
  Springs to which an Experience belongs. Resort-area Experiences have no
  owning Park.
- **Experience_Category**: The classification of an Experience (Ride, Show,
  Restaurant, Parade, Character_Meet, Tour, Recreation, Spa, Event, Other).
- **Area_Type**: The kind of place an Experience belongs to, from the closed
  set `ThemePark`, `WaterPark`, `DisneySprings`, `Resort`.
- **Resort**: A Walt Disney World hotel, a first-class catalog entity with its
  own identity, name, and attributes, distinct from the Experiences located
  within it.
- **Resort-area Experience**: An Experience whose Area_Type is `Resort`; it is
  an activity located at a Resort and references its owning Resort.
- **Completion**: A record indicating that a User has completed a specific
  trackable item, including the Completion date.
- **Completion date**: The local calendar date, in the completing User's time
  zone, on which a Completion was recorded.
- **Trackable_Item**: A catalog item a User can complete — every Active
  Experience and, once this feature ships, every active Resort.
- **Resort_Visit**: A Completion recorded by a User against a Resort, indicating
  the User has visited or stayed at that Resort.
- **Stats_Service**: The component that computes completion percentages and
  progress statistics for a User.
- **Completion_Statistic**: A `{ completed, total, percent }` triple where
  `percent` is `completed / total` expressed as a percentage, rounded to one
  decimal place, constrained to `0.0`–`100.0`, and reported as `0.0` when
  `total` is zero.
- **Area_Statistic**: A Completion_Statistic scoped to one Area_Type.
- **Resort_Statistic**: The Completion_Statistic over a User's Resort_Visits
  against active Resorts.
- **Own_Stats_View**: The App screen showing the User's own statistics.
- **Owner_Or_Friend_Rule**: The existing authorization rule granting a
  requesting User read access to a target User's Profile, statistics, or
  Completions only when the requester is the target User or an accepted Friend.

## Requirements

### Requirement 1: Resort-area Experiences counted in statistics

**User Story:** As a User, I want the resort restaurants, spas, and activities I
complete to count toward my statistics, so that my progress reflects everything
I have actually done, not only the things inside a Park.

#### Acceptance Criteria

1. THE Stats_Service SHALL include every Active Experience in the overall
   Completion_Statistic denominator regardless of the Experience's Area_Type,
   including Experiences with no owning Park.
2. THE Stats_Service SHALL count a User's Completion of an Active Experience in
   the overall Completion_Statistic numerator regardless of the Experience's
   Area_Type.
3. THE Stats_Service SHALL include every Active Experience in its
   Experience_Category Completion_Statistic for the Experience's
   Experience_Category regardless of the Experience's Area_Type.
4. THE Stats_Service SHALL continue to exclude Experiences with no owning Park
   from the per-Park and per-Park-and-Category statistics, so those dimensions
   remain scoped to Experiences that belong to a Park.
5. THE Stats_Service SHALL exclude inactive Experiences from every statistic's
   numerator and denominator while preserving the underlying Completion records.

### Requirement 2: Area_Type statistics dimension

**User Story:** As a User, I want to see my completion progress grouped by area
type, so that I can see how much of the resort-area content I have experienced
separately from the Parks.

#### Acceptance Criteria

1. THE Stats_Service SHALL report an Area_Statistic for each Area_Type in the
   closed set `ThemePark`, `WaterPark`, `DisneySprings`, `Resort`.
2. THE Stats_Service SHALL compute each Area_Statistic over the Active
   Experiences whose Area_Type equals that value, with the numerator being the
   requesting scope's Completions of those Experiences.
3. WHERE an Area_Type has no Active Experience, THE Stats_Service SHALL report
   its Area_Statistic as `{ completed: 0, total: 0, percent: 0.0 }`.
4. THE Stats_Service SHALL apply the same rounding, range, and zero-denominator
   rules to every Area_Statistic that it applies to all other
   Completion_Statistics.

### Requirement 3: Resorts are completable

**User Story:** As a User, I want to mark that I have visited a Resort, so that I
can track which Disney hotels I have stayed at or been to.

#### Acceptance Criteria

1. WHEN a User records a Resort_Visit for an active Resort, THE App SHALL persist
   a Completion associating the User with that Resort and the Completion date in
   the User's time zone.
2. THE App SHALL allow at most one Resort_Visit per User per Resort; a repeated
   record for the same User and Resort SHALL leave a single Completion in place
   rather than creating a duplicate.
3. WHEN a User removes a Resort_Visit, THE App SHALL delete the corresponding
   Completion for that User and Resort.
4. IF a User attempts to record a Resort_Visit for a Resort that does not exist
   or is not active, THEN THE App SHALL reject the request and record no
   Completion.
5. THE App SHALL preserve a User's existing Resort_Visit records when a Resort is
   marked inactive and later reactivated, consistent with how Experience
   Completions are preserved across catalog changes.

### Requirement 4: Resort statistics

**User Story:** As a User, I want to see how many Disney resorts I have visited,
so that I can gauge my resort progress the way I gauge my Park progress.

#### Acceptance Criteria

1. THE Stats_Service SHALL report a Resort_Statistic whose denominator is the
   count of active Resorts and whose numerator is the count of the requesting
   scope's Resort_Visits against active Resorts.
2. WHERE there are no active Resorts, THE Stats_Service SHALL report the
   Resort_Statistic as `{ completed: 0, total: 0, percent: 0.0 }`.
3. THE Stats_Service SHALL apply the same rounding, range, and zero-denominator
   rules to the Resort_Statistic that it applies to all other
   Completion_Statistics.
4. THE Stats_Service SHALL keep the Resort_Statistic distinct from the `Resort`
   Area_Statistic so that visited-hotel progress and completed resort-area
   activity progress are not conflated.

### Requirement 5: Viewing resort progress in the Own_Stats_View

**User Story:** As a User, I want a place in my stats to see my resort-area and
resort progress, so that hotel content is visible instead of missing.

#### Acceptance Criteria

1. THE Own_Stats_View SHALL present a dedicated area-and-resort section in
   addition to the existing Overview, Parks, Categories, and Experiences
   sections.
2. WHEN the area-and-resort section is displayed, THE Own_Stats_View SHALL show
   one Area_Statistic per Area_Type and the Resort_Statistic, each with its
   completed count, total count, and percentage to one decimal place.
3. WHEN the area-and-resort section is displayed, THE Own_Stats_View SHALL let
   the User expand the Resort group to see the individual Resorts they have
   recorded as visited.
4. WHEN the User opens a listed Resort_Visit, THE Own_Stats_View SHALL navigate
   to that Resort's detail view.
5. WHERE the User has recorded no Resort_Visits, THE Own_Stats_View SHALL show a
   zero-state message in the Resort group rather than omitting the group.

### Requirement 6: Friend parity and authorization

**User Story:** As a User, I want a Friend's resort progress to be visible under
the same rules as their other stats, so that sharing works consistently.

#### Acceptance Criteria

1. WHEN an authorized requester reads a target User's statistics, THE
   Stats_Service SHALL include the Area_Statistics and the Resort_Statistic for
   the target User computed over the target User's Completions.
2. THE Stats_Service SHALL evaluate the Owner_Or_Friend_Rule for the
   Area_Statistics and Resort_Statistic exactly as it does for the existing
   statistics, denying non-Friend reads with a `profile_forbidden` error and
   recording no viewing attempt.
3. WHERE a target User's overall completion percentage is surfaced elsewhere in
   the App (for example on a Profile), THE App SHALL compute it using the same
   Resort-inclusive overall Completion_Statistic defined in Requirement 1.
