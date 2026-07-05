# Requirements Document

## Introduction

The Stats_Page today surfaces only overall completion percentage, even though the
Stats_Service already computes overall, per-Park, and per-Experience_Category
breakdowns from a single point-in-time snapshot. This feature expands the
Stats_Page into a richer surface across three groups of statistics that serve
both personal insight and shareable, brag-worthy moments:

- **Group A — Coverage:** expanded completion breakdowns (per-Land, per-Area_Type,
  per-Resort_Area), hotels-visited progress, remaining counts, 100%-complete
  badges, and per-facet-value completion computed dynamically from the
  Disney-sourced facets stored as JSONB on Experiences.
- **Group B — Personal Rating Statistics:** the Requesting_User's own rating
  averages (overall, per Park, per Experience_Category), rating distribution,
  personal highest- and lowest-rated Experiences, and a count of rated
  completions — gated by a Minimum_Ratings_Threshold so thin data does not
  surface noise.
- **Group C — Comparative:** a live Percentile_Rank against all trackers and the
  surfacing of the existing friend comparison on the Stats_Page.

A curated subset of the new statistics also flows into the existing progress
Share payload so shares stay clean and headline-worthy.

The architectural dividing principle is: **per-user, request-scoped statistics
are computed live per request** (consistent with the existing REPEATABLE READ
READ ONLY snapshot with no cache), while **global aggregates shared across users
remain precomputed/cached** and are explicitly NOT converted to live.

## Glossary

- **Stats_Service**: The backend service that computes and returns a
  Requesting_User's statistics for the Stats endpoints.
- **Stats_Page**: The mobile surface that renders the statistics returned by the
  Stats_Service.
- **Requesting_User**: The authenticated user whose session makes a Stats request.
- **Target_User**: The user whose statistics are being read — either the
  Requesting_User (self) or a Friend, per the friend-viewing authorization rule.
- **Friend**: A user who has an accepted, mutual friendship with the
  Requesting_User.
- **Experience**: A single active catalog item (ride, show, restaurant, etc.).
- **Completion**: A record that a user has completed a specific Experience.
- **Rating**: A user's integer score for an Experience, in the inclusive range
  1 to 10, at most one per (user, Experience).
- **Park**: A closed enum of Disney parks (fixed key set).
- **Experience_Category**: A closed enum of Experience classifications (fixed key
  set).
- **Area_Type**: A closed enum describing the kind of place an Experience belongs
  to (e.g. ThemePark, WaterPark, DisneySprings, Resort).
- **Land**: A themed Land within a Park, stored per-Experience; open-ended and
  data-driven (not a fixed enum), and may be absent for some Experiences.
- **Resort_Area**: A broad geographic zone of the property, stored per-Experience
  for Resort-area Experiences; open-ended and data-driven, and may be absent.
- **Facet_Value**: A single Disney-sourced facet entry, a `{ id, name }` pair,
  where `name` is the human-readable display label.
- **Grouped_Facets**: Display-and-targeting-ready Facet_Values keyed by facet
  group name, stored as JSONB on an Experience.
- **Interest_Facets**: Grouped Facet_Values describing thematic interests, stored
  as JSONB on an Experience.
- **Facet_Value_Key**: The stable grouping identity for a Facet_Value used to
  aggregate completion across Experiences (the Facet_Value `name`, or `id` where
  the design later prefers it — resolved in design). Facet_Value_Keys are
  open-ended and data-driven, NOT a fixed enum.
- **Coverage_Statistic**: A completion breakdown expressed as a Completion_Cell.
- **Completion_Cell**: The triple `{ completed, total, percent }` for a group,
  where `completed` and `total` are non-negative integers, `percent` is in
  `[0.0, 100.0]` to one decimal place, and `total == 0` implies
  `completed == 0` and `percent == 0.0`.
- **Remaining_Count**: For a group, `total - completed` — the number of
  Experiences the Target_User has not yet completed.
- **Resort_Statistic**: The hotels-visited Coverage_Statistic, whose denominator
  is the count of active resort-representing rows (one per active Resort) and
  whose numerator is the Target_User's completions of those rows.
- **Complete_Badge**: A boolean flag on a group, true when the group's completed
  count equals its total count and its total count is greater than 0.
- **Rating_Statistics**: The Group B statistics derived from the Target_User's
  own Ratings.
- **Minimum_Ratings_Threshold**: The minimum number of the Target_User's own
  Ratings on active Experiences required before gated Rating_Statistics are
  reported. Its value is 3, matching the leaderboard precedent.
- **Rating_Distribution**: For each integer value 1 through 10, the count of the
  Target_User's Ratings holding that value.
- **Percentile_Rank**: A comparative statistic expressing the percentage of all
  trackers the Target_User is strictly ahead of, by total completion count,
  computed live per request.
- **Progress_Share**: The existing share whose payload carries a snapshot of the
  sender's progress statistics.
- **Global_Aggregate**: A statistic shared across all users and read far more
  than it changes — specifically the incrementally-maintained aggregate ratings
  and the cached highest-rated leaderboard.

## Requirements

### Requirement 1: Expanded coverage breakdowns

**User Story:** As a tracker, I want completion breakdowns by Land, Area_Type, and
Resort_Area, so that I can see coverage across every meaningful grouping of the
property.

#### Acceptance Criteria

1. THE Stats_Service SHALL report an overall Coverage_Statistic for the Target_User.
2. THE Stats_Service SHALL compute each Coverage_Statistic's denominator as the count of active Experiences belonging to that group and its numerator as the count of those active Experiences the Target_User has completed.
3. THE Stats_Service SHALL report a per-Park Coverage_Statistic for every Park in the closed Park enum.
4. THE Stats_Service SHALL report a per-Experience_Category Coverage_Statistic for every Experience_Category in the closed enum.
5. THE Stats_Service SHALL report a per-Area_Type Coverage_Statistic for every Area_Type in the closed enum.
6. THE Stats_Service SHALL report a per-Land Coverage_Statistic for every distinct Land present on an active Experience in the catalog snapshot, treating two Land values as the same group when they are equal after trimming leading and trailing whitespace and comparing case-insensitively.
7. THE Stats_Service SHALL report a per-Resort_Area Coverage_Statistic for every distinct Resort_Area present on an active Experience in the catalog snapshot, treating two Resort_Area values as the same group when they are equal after trimming leading and trailing whitespace and comparing case-insensitively.
8. WHERE an Experience's Land value is null, empty, or whitespace-only, THE Stats_Service SHALL exclude that Experience from every per-Land Coverage_Statistic.
9. WHERE an Experience's Resort_Area value is null, empty, or whitespace-only, THE Stats_Service SHALL exclude that Experience from every per-Resort_Area Coverage_Statistic.
10. THE Stats_Service SHALL exclude Experiences whose active flag is false from both the numerator and the denominator of every Coverage_Statistic.
11. THE Stats_Service SHALL compute every reported percent as a value in the inclusive range 0.0 to 100.0 rounded to one decimal place using round-half-away-from-zero.
12. IF a group's total count equals 0, THEN THE Stats_Service SHALL report that group's completed count as 0 and its percent as 0.0.

### Requirement 2: Hotels visited, remaining counts, and completion badges

**User Story:** As a tracker, I want to see how many hotels I have visited, how
many Experiences remain in each group, and a badge when a group is fully
complete, so that I can celebrate finished groups and target what is left.

#### Acceptance Criteria

1. THE Stats_Service SHALL report a Resort_Statistic whose denominator is the count of active resort-representing rows and whose numerator is the Target_User's completions of those rows, where the numerator is a non-negative integer not exceeding the denominator.
2. THE Stats_Service SHALL report the Resort_Statistic and the per-Area_Type Coverage_Statistic for the Resort Area_Type as two separately reported, independently computed values.
3. THE Stats_Service SHALL report a Remaining_Count for every Coverage_Statistic, including the Resort_Statistic, equal to that group's total count minus its completed count, as a non-negative integer.
4. THE Stats_Service SHALL report a Complete_Badge flag for every Coverage_Statistic, including the Resort_Statistic, that is true when the group's completed count equals its total count and its total count is greater than 0, and false otherwise.
5. IF a group's total count equals 0, THEN THE Stats_Service SHALL report that group's Complete_Badge as false and its Remaining_Count as 0.

### Requirement 3: Per-facet-value completion

**User Story:** As a tracker, I want completion percentages for each Disney facet
value, so that I can see progress on categories like "Thrill Rides" that are not
fixed Parks or Categories.

#### Acceptance Criteria

1. THE Stats_Service SHALL compute a per-Facet_Value_Key Coverage_Statistic by unnesting the Grouped_Facets and Interest_Facets JSONB across active Experiences and grouping by Facet_Value_Key.
2. THE Stats_Service SHALL include one per-Facet_Value_Key Coverage_Statistic for every distinct Facet_Value_Key present on an active Experience in the catalog snapshot.
3. THE Stats_Service SHALL treat the set of Facet_Value_Keys as an open-ended, data-driven list rather than a fixed key map.
4. IF a single Experience carries the same Facet_Value_Key more than once across its Grouped_Facets and Interest_Facets, THEN THE Stats_Service SHALL count that Experience at most once in that Facet_Value_Key's total and, when the Target_User has completed that Experience, at most once in that Facet_Value_Key's completed count.
5. THE Stats_Service SHALL report each per-Facet_Value_Key Coverage_Statistic together with a single human-readable Facet_Value display label so the Stats_Page can render entries such as "Thrill Rides: 12 of 18 (66.0%)".
6. IF an active Experience has neither Grouped_Facets nor Interest_Facets, or both contain no Facet_Values, THEN THE Stats_Service SHALL exclude that Experience from every per-Facet_Value_Key Coverage_Statistic.
7. THE Stats_Service SHALL assign two Facet_Values to the same per-Facet_Value_Key Coverage_Statistic if and only if their Facet_Value_Key values are exactly equal, treating any difference in letter case or leading or trailing whitespace as distinct Facet_Value_Keys.
8. IF more than one distinct Facet_Value display label is associated with the same Facet_Value_Key across active Experiences, THEN THE Stats_Service SHALL report the display label that sorts first by ascending case-insensitive comparison.

### Requirement 4: Personal rating averages

**User Story:** As a tracker, I want my average rating overall and per Park and per
Experience_Category, so that I can understand how I score my own experiences.

#### Acceptance Criteria

1. WHERE the Target_User's count of Ratings on active Experiences is at least the Minimum_Ratings_Threshold, THE Stats_Service SHALL report the Target_User's overall average Rating as a value in the inclusive range 1.0 to 10.0 rounded to one decimal place using round-half-away-from-zero.
2. WHERE the Target_User's count of Ratings on active Experiences is at least the Minimum_Ratings_Threshold, THE Stats_Service SHALL report a per-Park average Rating, as a value in the inclusive range 1.0 to 10.0 rounded to one decimal place using round-half-away-from-zero, for every Park in which the Target_User has at least one Rating on an active Experience.
3. WHERE the Target_User's count of Ratings on active Experiences is at least the Minimum_Ratings_Threshold, THE Stats_Service SHALL report a per-Experience_Category average Rating, as a value in the inclusive range 1.0 to 10.0 rounded to one decimal place using round-half-away-from-zero, for every Experience_Category in which the Target_User has at least one Rating on an active Experience.
4. IF the Target_User's count of Ratings on active Experiences is below the Minimum_Ratings_Threshold, THEN THE Stats_Service SHALL omit the overall, per-Park, and per-Experience_Category average Ratings and report a flag indicating insufficient Rating data.
5. THE Stats_Service SHALL derive every average Rating only from Ratings whose Experience active flag is true.
6. IF the Target_User has zero Ratings on active Experiences, THEN THE Stats_Service SHALL report the insufficient-Rating-data flag regardless of the Minimum_Ratings_Threshold value.

### Requirement 5: Rating distribution and count of rated completions

**User Story:** As a tracker, I want to see how my ratings are distributed and how
many of my completions I have rated, so that I can understand my rating habits.

#### Acceptance Criteria

1. WHERE the Target_User's count of Ratings on active Experiences is at least the Minimum_Ratings_Threshold, THE Stats_Service SHALL report a Rating_Distribution containing exactly one count entry for each integer value from 1 through 10, where each entry gives the number of the Target_User's Ratings equal to that value and reports 0 for any value the Target_User has assigned to no Ratings.
2. IF the Target_User's count of Ratings on active Experiences is below the Minimum_Ratings_Threshold, THEN THE Stats_Service SHALL omit the Rating_Distribution and report a flag indicating insufficient Rating data.
3. THE Stats_Service SHALL report the count of the Target_User's Completions that have an associated Rating, regardless of the Minimum_Ratings_Threshold, reporting 0 when the Target_User has no rated Completions.
4. THE Stats_Service SHALL derive the Rating_Distribution and the rated-completions count only from Ratings whose Experience active flag is true, excluding every Rating whose Experience active flag is false from both results.
5. WHERE the Rating_Distribution is reported, THE Stats_Service SHALL ensure the sum of all 10 Rating_Distribution count entries equals the Target_User's total count of Ratings whose Experience active flag is true.

### Requirement 6: Personal highest- and lowest-rated experiences

**User Story:** As a tracker, I want to see my highest- and lowest-rated
experiences, so that I can recall my favorites and least favorites.

#### Acceptance Criteria

1. WHERE the Target_User's count of Ratings on active Experiences is at least the Minimum_Ratings_Threshold, THE Stats_Service SHALL report the Target_User's highest-rated active Experience, comprising that Experience's identity, its name, and the Target_User's own Rating value for it, where the highest-rated Experience is the active Experience whose Target_User Rating value is the maximum in the inclusive range 1 to 10.
2. WHERE the Target_User's count of Ratings on active Experiences is at least the Minimum_Ratings_Threshold, THE Stats_Service SHALL report the Target_User's lowest-rated active Experience, comprising that Experience's identity, its name, and the Target_User's own Rating value for it, where the lowest-rated Experience is the active Experience whose Target_User Rating value is the minimum in the inclusive range 1 to 10.
3. WHEN two or more active Experiences tie for the highest or lowest Rating value, THE Stats_Service SHALL break the tie by ascending case-insensitive Experience name, and SHALL break any remaining tie by ascending Experience identity, so that exactly one Experience is selected for each of the highest- and lowest-rated results.
4. IF the Target_User's count of Ratings on active Experiences is below the Minimum_Ratings_Threshold, THEN THE Stats_Service SHALL omit both the highest- and lowest-rated Experiences from the response and report a flag indicating insufficient Rating data.
5. THE Stats_Service SHALL select the highest- and lowest-rated Experiences only from Ratings whose Experience active flag is true.
6. WHERE every one of the Target_User's Ratings on active Experiences holds the same Rating value, THE Stats_Service SHALL report the same single active Experience, selected by the tie-break in criterion 3, as both the highest- and lowest-rated Experience.

### Requirement 7: Live percentile rank

**User Story:** As a tracker, I want to see how I rank against all other trackers,
so that I have a brag-worthy sense of my standing.

#### Acceptance Criteria

1. WHEN a stats request explicitly requests the Percentile_Rank, THE Stats_Service SHALL compute it live for that request by grouping Completions by user and counting the number of users the Target_User is strictly ahead of by total Completion count.
2. WHERE a stats request does not explicitly request the Percentile_Rank, THE Stats_Service SHALL omit the Percentile_Rank from the response and perform no Percentile_Rank computation.
3. WHEN the Percentile_Rank is requested, THE Stats_Service SHALL report it as the count of other trackers with at least one Completion that the Target_User is strictly ahead of by total Completion count, divided by the total count of other trackers with at least one Completion, multiplied by 100, expressed in the inclusive range 0.0 to 100.0 and rounded to one decimal place using round-half-up.
4. WHEN one or more other trackers have the same total Completion count as the Target_User, THE Stats_Service SHALL exclude those tied trackers from the count of trackers the Target_User is ahead of, while retaining them in the total count of other trackers with at least one Completion.
5. IF the Percentile_Rank is requested and the Target_User is the only tracker with at least one Completion, THEN THE Stats_Service SHALL report the Percentile_Rank as 0.0.
6. IF the Percentile_Rank is requested and the Target_User has zero Completions, THEN THE Stats_Service SHALL report the Percentile_Rank as 0.0.
7. THE Stats_Service SHALL NOT persist or cache the Percentile_Rank between requests.
8. WHEN the Percentile_Rank is requested, THE Stats_Service SHALL return the response within 2 seconds.
9. IF the Percentile_Rank computation cannot be completed, THEN THE Stats_Service SHALL omit the Percentile_Rank from the response, include an error indication identifying the Percentile_Rank as unavailable, and return the remaining requested statistics unchanged.

### Requirement 8: Live, request-scoped computation model

**User Story:** As a maintainer, I want per-user statistics computed live from a
consistent snapshot, so that they are always fresh without new infrastructure.

#### Acceptance Criteria

1. THE Stats_Service SHALL compute every Coverage_Statistic, Rating_Statistic, and the Percentile_Rank live per request within a single REPEATABLE READ READ ONLY transaction, and SHALL return the complete response within 2 seconds (2000 milliseconds) under nominal load.
2. THE Stats_Service SHALL NOT read any per-user statistic from a precomputed cache.
3. WHEN a Catalog_Sync, a Completion, or a Rating mutation is committed after a Stats request begins its transaction, THE Stats_Service SHALL exclude that change from the response for that request so that all numerators and denominators observe the same point-in-time snapshot.
4. THE Stats_Service SHALL serve the Global_Aggregate ratings from their incrementally-maintained store without converting them to live computation.
5. THE Stats_Service SHALL serve the highest-rated leaderboard from its existing cache without converting it to live computation.
6. IF the REPEATABLE READ READ ONLY transaction fails to begin, fails to commit, or is aborted before the Coverage_Statistic, Rating_Statistic, and Percentile_Rank values are computed, THEN THE Stats_Service SHALL return an error response indicating that the statistics could not be computed and SHALL NOT return partial or precomputed per-user statistics.

### Requirement 9: Friend comparison on the stats page

**User Story:** As a tracker, I want to view a friend's stats on the stats page, so
that I can compare my progress with theirs.

#### Acceptance Criteria

1. WHEN the Requesting_User requests a Target_User's statistics for a Friend, THE Stats_Service SHALL return a response containing the identical set of Rating_Statistic types and the same response structure that it returns for the Requesting_User's own statistics, within 2 seconds.
2. IF the Requesting_User is neither the Target_User nor a Friend of the Target_User, THEN THE Stats_Service SHALL deny the request, return an error response indicating the Requesting_User is not authorized to view the Target_User's statistics, and complete without reading the Target_User's statistics.
3. WHEN the Stats_Service denies a friend-viewing request, THE Stats_Service SHALL complete the request without recording an analytics event for the attempt.
4. WHEN the Requesting_User requests a Friend Target_User's statistics, THE Stats_Service SHALL gate every Rating_Statistic by comparing that Friend's own count of Ratings on active Experiences against the Minimum_Ratings_Threshold, and SHALL hide each Rating_Statistic whose count is below the Minimum_Ratings_Threshold.
5. IF a Friend Target_User has zero Ratings on active Experiences, THEN THE Stats_Service SHALL hide that Friend's Rating_Statistics identically to a Friend whose count is below the Minimum_Ratings_Threshold.
6. IF the requested Target_User does not exist, THEN THE Stats_Service SHALL deny the request and return an error response indicating the Target_User was not found, without reading any statistics.

### Requirement 10: Curated stats in the progress share

**User Story:** As a tracker, I want my shared progress to include a few headline
stats, so that my shares are clean and brag-worthy without dumping every number.

#### Acceptance Criteria

1. WHEN a Progress_Share is created, THE Stats_Service SHALL include the sender's overall completion percent, as a value in the inclusive range 0.0 to 100.0 rounded to one decimal place, in the Progress_Share payload snapshot.
2. WHEN a Progress_Share is created, THE Stats_Service SHALL include the sender's top per-Facet_Value_Key Coverage_Statistic in the Progress_Share payload snapshot, reported as that statistic's Completion_Cell together with its Facet_Value display label.
3. WHEN a Progress_Share is created, THE Stats_Service SHALL include the sender's Percentile_Rank in the Progress_Share payload snapshot as a value in the inclusive range 0.0 to 100.0 rounded to one decimal place, reporting 0.0 when the sender has zero Completions.
4. THE Stats_Service SHALL select the top per-Facet_Value_Key Coverage_Statistic as the one with the highest completed count, breaking ties by highest percent and then by ascending case-insensitive Facet_Value display label.
5. THE Stats_Service SHALL exclude the Rating_Distribution, per-group breakdown maps, and highest- and lowest-rated Experiences from the Progress_Share payload snapshot.
6. THE Stats_Service SHALL capture the curated statistics as a snapshot at Progress_Share creation time so the recipient sees the sender's send-time values even if the sender's statistics change afterward.
7. WHERE the sender has at least one per-Facet_Value_Key Coverage_Statistic, THE Stats_Service SHALL include the top-facet field in the Progress_Share payload snapshot even when its completed count is 0.
8. IF the sender has no per-Facet_Value_Key Coverage_Statistic at all, THEN THE Stats_Service SHALL omit the top-facet field from the Progress_Share payload snapshot.

### Requirement 11: Response performance

**User Story:** As a tracker, I want the expanded stats to load promptly, so that
the Stats_Page feels responsive.

#### Acceptance Criteria

1. WHEN the Stats_Service receives a stats request for a Target_User that does not request the Percentile_Rank, THE Stats_Service SHALL return the complete response within 2 seconds, measured from receipt of the request to emission of the complete response, for a catalog snapshot of up to 5,000 active Experiences and a Target_User with up to 5,000 Completions and up to 5,000 Ratings.
2. WHEN a stats request additionally requests the Percentile_Rank, THE Stats_Service SHALL return the complete response within 3 seconds, measured from receipt of the request to emission of the complete response, for a Completions dataset spanning up to 100,000 trackers and under the volumes in criterion 1.
3. IF the Stats_Service does not produce the complete response within the applicable time bound, THEN THE Stats_Service SHALL abort the request within 5 seconds, return an error response indicating the stats computation timed out, and return no partial statistics.
