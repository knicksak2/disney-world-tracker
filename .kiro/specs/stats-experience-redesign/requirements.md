# Requirements Document

## Introduction

This feature redesigns the mobile stats experience in `apps/mobile` and adds one
additive backend coverage dimension to the Stats_Service in `apps/api`.

On mobile, the landing surface becomes a compact, roughly screen-height
**Overview hub** (a hero overall-completion ring, an opt-in percentile brag
banner, and 3–4 curated highlight/entry cards) that drills into focused,
bounded detail screens — **Coverage**, **Ratings**, **Interests**, and
**Experiences** — pushed onto a Stats-tab-local native stack. Both the Own Stats
screen and the Friend Profile screen migrate off the removed flat stats shape
onto the new nested `coverage` / `ratings` / `percentileRank` contract, and all
new data is surfaced with progress rings (hero / at-a-glance) and ranked bars
(comparisons). The hub and every detail screen read a single shared cached
`['me-stats', { percentile: true }]` query as one source of truth.

The sole backend change is additive: one new `byResort` per-resort *activity*
completion dimension is added to the `coverage` object returned by both
`GET /me/stats` and `GET /me/stats/summary`, computed live inside the existing
single stats snapshot transaction, with no migration, no new endpoint, and no
new transaction.

These requirements are derived from the approved design document and map to the
design's 13 correctness properties where relevant.

## Glossary

- **Stats_Service**: The backend expanded-stats service (`apps/api/src/services/stats`) that computes and returns the nested stats contract on `GET /me/stats` and `GET /me/stats/summary`.
- **Stats_Response**: The nested response shape `{ coverage, ratings, percentileRank?, percentileUnavailable? }` returned by the Stats_Service and mirrored in the mobile layer.
- **Coverage_Response**: The `coverage` object of Stats_Response, containing `overall`, `byPark`, `byCategory`, `byAreaType`, `byLand`, `byResortArea`, `byFacetValue`, `resort`, and `byResort`.
- **Completion_Cell**: A coverage cell `{ completed, total, percent, remaining, completeBadge }`, where `percent ∈ [0.0, 100.0]` (one decimal, server-rounded), `remaining = total - completed`, and `completeBadge` is true iff `total > 0 && completed === total`.
- **Overview_Hub**: The Stats tab landing screen (`StatsScreen`), a compact ~screen-height surface showing the hero ring, percentile banner, and highlight/entry cards. Also the initial route of the StatsStack.
- **StatsStack**: A native stack navigator local to the Stats tab whose initial route is the Overview_Hub, with detail routes CoverageDetail, RatingsDetail, InterestsDetail, and ExperiencesDetail pushed above it.
- **Coverage_Detail**: The `CoverageDetailScreen` drill-in that presents the full coverage story via a lens switcher.
- **Ratings_Detail**: The `RatingsDetailScreen` drill-in that presents the ratings story (rich or unlock state).
- **Interests_Detail**: The `InterestsDetailScreen` drill-in that presents per-facet ("interests") coverage.
- **Experiences_Detail**: The `ExperiencesDetailScreen` drill-in that wraps the unchanged shared ExperiencesList over the user's own completions.
- **Highlight_Card**: A tappable card on the Overview_Hub that both teases a dimension's story and acts as an entry point to a detail screen; produced by buildOverviewHighlights.
- **buildOverviewHighlights**: The pure function from a Stats_Response to the ordered list of Highlight_Cards shown on the Overview_Hub.
- **Percentile_Banner**: The "you're ahead of X% of trackers" brag line on the Overview_Hub.
- **Percentile_Rank**: The optional `percentileRank` number in Stats_Response, present only when requested with `?percentile=true` and computed.
- **Progress_Ring**: A circular progress arc visual used for hero and at-a-glance completion.
- **Ranked_Bar**: A horizontal progress bar (ProgressBar) used for ranked comparisons (lands, resort areas, per-resort activity).
- **Complete_Badge**: The celebratory gold star/check chip shown when a Completion_Cell's `completeBadge` is true.
- **Lens_Switcher**: The Coverage_Detail control selecting among the lenses Parks, Categories, Areas, Lands, Resorts.
- **Resorts_Lens**: The Coverage_Detail lens that renders `coverage.byResort` (per-resort activity completion) as ranked per-resort bars.
- **byResort / Resort_Activity_Completion**: The additive coverage dimension measuring per-resort *activity* completion (dining, recreation, spa, and other resort-area activities owned by a specific resort), grouped by `experiences.resort_id`.
- **Resort_Coverage**: The wire type `{ resortId, label, cell }` for one entry of `byResort`.
- **Hotels_Visited**: The existing `coverage.resort` Completion_Cell measuring whether the user has *stayed* at a hotel; distinct from Resort_Activity_Completion.
- **Rating_Statistics**: The `ratings` object `{ sufficient, ratedCompletionsCount, average?, averageByPark?, averageByCategory?, distribution?, highest?, lowest? }`.
- **Rating_Distribution**: The `distribution` map from each value 1–10 to a count.
- **Rating_Dial**: The average-rating dial visual (value out of 10).
- **Rating_Histogram**: The 1–10 distribution histogram whose bars are normalized to the tallest bin.
- **Minimum_Ratings_Threshold**: The rating-count threshold (3) below which the rich ratings view is gated behind an unlock/neutral state.
- **Facet_Coverage**: A per-facet ("interest") coverage entry `{ key, label, cell }` in `byFacetValue`.
- **Own_Surface**: The Own Stats experience (Overview_Hub + StatsStack detail screens) driven by `GET /me/stats?percentile=true`.
- **Friend_Surface**: The Friend Profile experience (`FriendProfileScreen` within FriendsStack) driven by `GET /me/stats/summary?for=<id>` without percentile.
- **buildProgressShareParams**: The pure projection that builds the progress-share composer params from a Stats_Response.

## Requirements

### Requirement 1: Overview hub landing

**User Story:** As a user opening the Stats tab, I want a compact overview hub with my headline number, my percentile brag, and a few curated stories, so that I can glance at my progress and choose what to explore without endless scrolling.

#### Acceptance Criteria

1. WHEN the Overview_Hub renders with a valid Stats_Response, THE Overview_Hub SHALL display a hero overall-completion Progress_Ring derived from `coverage.overall`.
2. WHERE `coverage.overall.completeBadge` is true, THE Overview_Hub SHALL render the hero Progress_Ring in the celebratory complete treatment.
3. WHEN the Overview_Hub renders, THE Overview_Hub SHALL display the curated Highlight_Cards produced by buildOverviewHighlights in the order returned.
4. WHEN a Highlight_Card is displayed, THE Overview_Hub SHALL render it as a tappable control that drills into the detail route named by that card's `target`.
5. WHEN a user activates a Highlight_Card, THE Overview_Hub SHALL navigate to the matching StatsStack route (CoverageDetail, RatingsDetail, InterestsDetail, or ExperiencesDetail).

### Requirement 2: Overview highlight derivation

**User Story:** As a user, I want the hub's highlight cards to be curated deterministically from my data, so that the same progress always tells the same story in the same order.

#### Acceptance Criteria

1. THE buildOverviewHighlights function SHALL be total over any valid Stats_Response, producing an ordered list of Highlight_Cards.
2. WHEN buildOverviewHighlights is called twice with equal Stats_Response inputs, THE buildOverviewHighlights function SHALL produce equal ordered outputs.
3. THE buildOverviewHighlights function SHALL order its output as coverage, ratings, interests (when present), experiences.
4. IF `coverage.byFacetValue` is empty, THEN THE buildOverviewHighlights function SHALL produce a list of length 3 that omits the interests card.
5. WHERE `coverage.byFacetValue` is non-empty, THE buildOverviewHighlights function SHALL produce a list of length 4 including the interests card.
6. WHERE at least one `coverage.byPark` Completion_Cell has `completeBadge` true, THE buildOverviewHighlights function SHALL set the coverage highlight `complete` to true and `percent` to 100.
7. WHERE no `coverage.byPark` Completion_Cell has `completeBadge` true and at least one `byPark` cell has `total > 0`, THE buildOverviewHighlights function SHALL set the coverage highlight to the highest-percent park with ties broken by canonical PARKS order.
8. WHERE `ratings.sufficient` is false, THE buildOverviewHighlights function SHALL produce a locked ratings highlight whose text shows `ratedCompletionsCount` of Minimum_Ratings_Threshold and whose `target` is RatingsDetail.
9. THE buildOverviewHighlights function SHALL set every produced highlight's `target` to an existing StatsStack route.

### Requirement 3: Drill-in navigation

**User Story:** As a user, I want to drill into focused detail screens and return with native back, so that navigating my stats feels app-like and the tab bar stays available.

#### Acceptance Criteria

1. THE StatsStack SHALL register the Overview_Hub as its initial route and CoverageDetail, RatingsDetail, InterestsDetail, and ExperiencesDetail as detail routes.
2. WHILE a StatsStack detail route is displayed, THE mobile app SHALL keep the bottom tab bar visible.
3. WHEN a user performs a native back gesture or activates the back control on a detail route, THE StatsStack SHALL return to the previously displayed StatsStack route.
4. WHEN a deep-link targets a specific StatsStack detail route via `navigate('MainTabs', { screen: 'Stats', params: { screen: <route> } })`, THE StatsStack SHALL display that detail route.
5. THE StatsStack SHALL pass only small serializable hint params (such as CoverageDetail `focus`) between routes and SHALL NOT pass a Stats_Response through navigation params.

### Requirement 4: Single shared stats query (one source of truth)

**User Story:** As a user, I want the hub and every detail screen to show the same numbers, so that drilling in or refreshing never shows inconsistent data.

#### Acceptance Criteria

1. THE Overview_Hub SHALL issue exactly one query keyed `['me-stats', { percentile: true }]` and SHALL derive its hero Progress_Ring, Percentile_Banner, and Highlight_Card data from that query's cached Stats_Response.
2. THE Coverage_Detail, Ratings_Detail, and Interests_Detail screens SHALL each read the Stats_Response from the shared `['me-stats', { percentile: true }]` cached query and SHALL NOT receive a Stats_Response through navigation route params.
3. WHILE the shared `['me-stats', { percentile: true }]` query is within its freshness window (a staleTime of 30 seconds since the last successful fetch), WHEN a stat detail screen mounts after the Overview_Hub has populated that cache entry, THE detail screen SHALL render values from the identical cached Stats_Response snapshot and SHALL NOT issue an additional network fetch.
4. WHEN a background refetch of the shared `['me-stats', { percentile: true }]` query completes and replaces the cached Stats_Response, THE Overview_Hub and every mounted stat detail screen reading that query SHALL re-render from the replacement snapshot within one render cycle so that each surface displays values from the same Stats_Response.
5. WHILE the Overview_Hub and one or more stat detail screens are mounted at the same time, THE mobile app SHALL source all of them from the same `['me-stats', { percentile: true }]` cache entry so that any Completion_Cell rendered on more than one surface shows byte-identical `completed`, `total`, and `percent` values.

### Requirement 5: Coverage detail screen

**User Story:** As a user, I want a coverage screen with a lens switcher and rich rings, bars, and complete badges, so that I can explore every coverage dimension in one focused place.

#### Acceptance Criteria

1. THE Coverage_Detail screen SHALL present a Lens_Switcher offering exactly the five lenses Parks, Categories, Areas, Lands, and Resorts, with exactly one lens marked active at any time.
2. WHEN the Coverage_Detail screen is first displayed, THE Coverage_Detail screen SHALL set the first lens (Parks) as the active lens.
3. WHEN a lens in the Lens_Switcher is selected, THE Coverage_Detail screen SHALL render the coverage content for exactly that lens and SHALL NOT render content for any other lens.
4. WHEN a fixed-enum lens (Parks, Categories, Areas) is displayed, THE Coverage_Detail screen SHALL render one tile for every enum member, including members whose Completion_Cell has `total === 0`.
5. WHEN a fixed-enum member's Completion_Cell has `total === 0`, THE Coverage_Detail screen SHALL render that member's tile in a reduced-emphasis (muted) treatment displaying `0.0%` and a completed count of 0, and SHALL NOT hide the tile.
6. WHEN rendering comparison lists (Lands, Resort areas, Resorts), THE Coverage_Detail screen SHALL render Ranked_Bar rows.
7. WHEN rendering hero or at-a-glance completion, THE Coverage_Detail screen SHALL render a Progress_Ring.
8. WHEN a Completion_Cell has `completeBadge` true, THE Coverage_Detail screen SHALL display the Complete_Badge for that tile or row.
9. IF a Completion_Cell has `completeBadge` false and `total > 0`, THEN THE Coverage_Detail screen SHALL display a "N to go" affordance whose count N equals `cell.remaining`.
10. IF a Completion_Cell has `completeBadge` true, THEN THE Coverage_Detail screen SHALL suppress the "N to go" affordance.
11. THE Coverage_Detail screen SHALL render the Hotels_Visited resort tile from `coverage.resort` as a treatment distinct from the Resorts_Lens.

### Requirement 6: Resorts lens rendering of byResort

**User Story:** As a user, I want to see how much I've done at each resort, so that I understand my per-resort activity separately from which hotels I've stayed at.

#### Acceptance Criteria

1. WHEN the Resorts_Lens is displayed, THE Coverage_Detail screen SHALL render `coverage.byResort` as ranked per-resort Ranked_Bar rows in the order the server returned them.
2. WHEN rendering a Resorts_Lens row, THE Coverage_Detail screen SHALL read each value only through `coverage.byResort[i].resortId`, `coverage.byResort[i].label`, and `coverage.byResort[i].cell`.
3. IF `coverage.byResort` is empty, THEN THE Coverage_Detail screen SHALL display a compact empty state for the Resorts_Lens.
4. THE Coverage_Detail screen SHALL render the Resorts_Lens (Resort_Activity_Completion) and the Hotels_Visited resort tile as two separate treatments that are never merged.

### Requirement 7: byResort backend dimension computation

**User Story:** As a Stats_Service maintainer, I want per-resort activity completion computed correctly inside the existing snapshot, so that the new data is consistent, isolated, and adds no new endpoint or migration.

#### Acceptance Criteria

1. THE Stats_Service SHALL compute `byResort` by grouping active experiences by `experiences.resort_id` joined to `resorts` for the display name.
2. THE Stats_Service SHALL exclude experiences whose `represents_resort_id` is set from the `byResort` computation.
3. THE Stats_Service SHALL exclude inactive resorts and inactive experiences from the `byResort` computation.
4. THE Stats_Service SHALL include in `byResort` only resorts that have at least one active experience carrying that `resort_id`.
5. THE Stats_Service SHALL set each `byResort` entry's `label` to the resort's `name` and carry the resort's `id` as `resortId`.
6. THE Stats_Service SHALL order `byResort` by percent descending, then total descending, then case-insensitive label ascending, then exact label.
7. THE Stats_Service SHALL construct each `byResort` Completion_Cell so that `0 <= completed <= total`, `total >= 1`, `percent ∈ [0.0, 100.0]`, `remaining = total - completed`, and `completeBadge` is true iff `completed === total`.
8. THE Stats_Service SHALL produce `byResort` values that are independent of the Hotels_Visited `coverage.resort` statistic, such that for a fixed catalog no change to one alters the other.
9. IF no active resort-linked experiences exist, THEN THE Stats_Service SHALL return `byResort` as an empty list.
10. THE Stats_Service SHALL return `byResort` containing no duplicate `resortId`.
11. THE Stats_Service SHALL compute `byResort` inside the existing single `REPEATABLE READ READ ONLY` stats snapshot transaction, adding no new transaction, no new endpoint, and no database migration.
12. THE Stats_Service SHALL return `byResort` within the `coverage` object of both `GET /me/stats` and `GET /me/stats/summary`.

### Requirement 8: Ratings detail screen

**User Story:** As a user, I want a ratings screen that shows my average, distribution, extremes, and per-facet averages once I've rated enough, so that I get a rich view when it's meaningful and clear progress toward unlocking it otherwise.

#### Acceptance Criteria

1. WHERE `ratings.sufficient` is true, THE Ratings_Detail screen SHALL render the rich view containing the Rating_Dial (average out of 10), the Rating_Histogram of the 1–10 distribution, the highest and lowest rated experiences, and the per-park and per-category averages.
2. WHERE `ratings.sufficient` is false, THE Ratings_Detail screen SHALL render the unlock empty state showing `ratedCompletionsCount` of Minimum_Ratings_Threshold.
3. WHILE `ratings.sufficient` is false, THE Ratings_Detail screen SHALL NOT read the gated fields `average`, `distribution`, `highest`, `lowest`, `averageByPark`, or `averageByCategory`.
4. THE Ratings_Detail screen SHALL read `ratedCompletionsCount` in both the rich and the unlock states.
5. THE Minimum_Ratings_Threshold SHALL be 3.
6. WHEN rendering the Rating_Histogram, THE Ratings_Detail screen SHALL normalize each bar to a fraction in `[0,1]` of the tallest non-zero bin, mapping the tallest non-zero bin to fraction 1 and a zero-count value to a baseline bar.

### Requirement 9: Interests detail screen

**User Story:** As a user, I want an interests screen ranking my facet coverage, so that I can see which kinds of experiences I've explored most.

#### Acceptance Criteria

1. WHEN the Interests_Detail screen renders, THE Interests_Detail screen SHALL display a Facet_Coverage entry for each item in `coverage.byFacetValue`.
2. THE Interests_Detail screen SHALL order the displayed facets by percent descending, then total descending, then case-insensitive label ascending.
3. IF `coverage.byFacetValue` is empty, THEN THE Interests_Detail screen SHALL display a compact empty state.

### Requirement 10: Percentile fetch and display

**User Story:** As a user, I want an opt-in percentile brag on my own hub only, so that I see how I compare without exposing or implying a friend's percentile.

#### Acceptance Criteria

1. WHEN the Overview_Hub issues its stats query, THE Overview_Hub SHALL request `GET /me/stats?percentile=true`.
2. WHEN a Friend_Surface issues its stats query, THE Friend_Surface SHALL request `GET /me/stats/summary?for=<id>` without the `percentile` parameter.
3. WHERE `percentileRank` is a number, THE Overview_Hub SHALL render the Percentile_Banner.
4. IF `percentileRank` is absent or `percentileUnavailable` is true, THEN THE Overview_Hub SHALL hide the Percentile_Banner.
5. IF `percentileUnavailable` is true, THEN THE Overview_Hub SHALL render every other section normally.
6. THE Friend_Surface SHALL NOT render a Percentile_Banner.

### Requirement 11: Friend profile parity

**User Story:** As a user viewing a friend's profile, I want their coverage and ratings shown with the same building blocks as my own, so that comparison feels consistent while respecting friend-safe boundaries.

#### Acceptance Criteria

1. THE Friend_Surface SHALL render friend coverage and ratings using the same shared coverage and ratings section components as the Own_Surface.
2. THE Friend_Surface SHALL gate the friend's ratings on the friend's own `ratings.sufficient`.
3. WHERE the friend's `ratings.sufficient` is false, THE Friend_Surface SHALL render a neutral "Not enough ratings yet" message rather than the self-directed unlock call-to-action.
4. THE Friend_Surface SHALL omit the interests/facets section by default.
5. THE Friend_Surface Compare pane SHALL derive comparison values from `viewer.coverage.overall`, `viewer.coverage.byPark`, `viewer.coverage.byCategory`, and the corresponding `friend.coverage.*` fields.
6. WHEN identical Stats_Response data is supplied, THE Friend coverage and ratings sections SHALL render a component tree structurally identical to the Own detail screens, with differences limited to the percentile banner, the interests section, and unlock-versus-neutral copy.

### Requirement 12: Percent display consistency

**User Story:** As a user, I want percentages displayed consistently, so that empty and partial values read the same everywhere.

#### Acceptance Criteria

1. WHEN a Completion_Cell percent is displayed, THE mobile app SHALL render a value equal to `cell.percent.toFixed(1)`.
2. WHEN a Completion_Cell has `total === 0`, THE mobile app SHALL display `0.0%`, `completed` as 0, and no "N to go" affordance.

### Requirement 13: Progress share projection

**User Story:** As a user, I want the progress-share entry point to keep working after the migration, so that I can still share my overall and per-park and per-category progress.

#### Acceptance Criteria

1. THE buildProgressShareParams function SHALL read from the nested `coverage` object of the Stats_Response.
2. THE buildProgressShareParams function SHALL emit `kind: 'progress'`, `overallPercent`, `perParkPercent`, and `perCategoryPercent`.
3. THE buildProgressShareParams function SHALL emit `perParkPercent` covering every member of PARKS.
4. THE buildProgressShareParams function SHALL emit `perCategoryPercent` covering every member of EXPERIENCE_CATEGORIES.
5. THE buildProgressShareParams function SHALL set `overallPercent`, each `perParkPercent` entry, and each `perCategoryPercent` entry to the displayed-percent of the corresponding `coverage` Completion_Cell, where a `total === 0` cell yields `0.0`.

### Requirement 14: Loading, error, and empty states per surface

**User Story:** As a user, I want each surface to handle loading, error, and empty conditions gracefully, so that a failure in one area never blanks unrelated data and I can always retry.

#### Acceptance Criteria

1. WHILE the shared stats query is in flight with no cached data, THE Overview_Hub SHALL display a view-level loading indicator.
2. IF the Overview_Hub stats read fails, THEN THE Overview_Hub SHALL display a view-level error card with a Retry control that re-issues only `GET /me/stats?percentile=true`.
3. WHEN a stat detail screen is entered as a cold deep-link with no cached snapshot, THE detail screen SHALL display the same loading and error-with-Retry treatment against the shared `['me-stats', { percentile: true }]` query.
4. IF `percentileUnavailable` is true, THEN THE Overview_Hub SHALL treat it as a data condition and SHALL NOT block any other section.
5. THE Experiences_Detail screen SHALL use its own scoped completions read with an in-pane loading indicator and an in-pane error-with-Retry that does not affect coverage or ratings data.
6. IF any friend read returns `profile_forbidden`, THEN THE Friend_Surface SHALL collapse to a single "profile unavailable" message and withhold all sections.
7. THE Friend_Surface SHALL maintain independent per-read loading and error-with-Retry states for the profile, stats, and completions reads.

### Requirement 15: Accessibility

**User Story:** As a user relying on assistive technology or dynamic type, I want the stats visuals labeled and legible, so that I can understand my progress without depending on color or sight.

#### Acceptance Criteria

1. THE mobile app SHALL expose each Progress_Ring, Ranked_Bar, Rating_Dial, and Rating_Histogram as a single accessible element with a spoken label conveying its meaning.
2. THE mobile app SHALL expose each Highlight_Card and each navigating hero card with `accessibilityRole="button"` and a descriptive label conveying both its story and its action.
3. WHEN a Completion_Cell has `completeBadge` true, THE mobile app SHALL announce "Complete" as part of that element's accessibility label.
4. THE mobile app SHALL scale stats text with dynamic type and wrap rather than truncate hero numbers.
5. THE mobile app SHALL convey completion through the Complete_Badge label and the "N to go" text in addition to color, so that color is never the sole signal.

### Requirement 16: Migration off the removed flat stats shape

**User Story:** As a maintainer, I want all stats consumers migrated onto the nested contract, so that no code depends on the removed flat fields.

#### Acceptance Criteria

1. THE mobile app SHALL read every stats value only through `coverage.*`, `ratings.*`, and `percentileRank`/`percentileUnavailable`.
2. THE mobile app SHALL NOT reference the removed `byParkAndCategory` field.
3. THE mobile app SHALL NOT reference the removed old top-level flat stats fields.
4. WHEN a valid Stats_Response is supplied, THE Overview_Hub and every detail screen SHALL render without error.

### Requirement 17: Dependency and shared-package decisions

**User Story:** As a maintainer, I want the optional dependency and shared-type decisions recorded as constraints, so that the redesign is not blocked and the choices are explicit.

#### Acceptance Criteria

1. THE Progress_Ring component SHALL expose a component API that works identically whether backed by `react-native-svg` or by the zero-dependency primitive fallback.
2. WHERE `react-native-svg` is not adopted, THE Progress_Ring component SHALL render via the primitive fallback behind the same props.
3. THE Resort_Coverage type SHALL be defined with an identical shape on both the Stats_Service route contract and the mobile layer, whether mirrored locally or centralized in the shared `@dwt/shared` package.
