# Requirements Document

## Introduction

EPCOT festival booths (Restaurant experiences carrying the `Festival Kiosk` facet) are seasonal:
Disney's feed carries no signal for which festival a booth belongs to, and when a festival ends
its booths are soft-deleted (`experiences.active = FALSE`) by the existing Catalog_Sync pipeline.
Today, once a booth deactivates, both the fact of which festival it was part of and every
statistic derived from it (the pin-collection Festival Foodie ladder, per-festival stats) become
unrecoverable or silently wrong, because nothing persists the festival association and every
downstream reader filters on `active = TRUE`.

This feature adds a durable, app-owned tag recording which festival (and which year's edition of
that festival) a booth belonged to, an interactive CLI to apply that tag with minimal manual
effort, a fix to the pin-collection Festival Foodie ladder so it counts festival-booth completions
for their full history rather than only while the booth is active, and a lifetime + per-festival
stats surface so a User can see their festival-dining history persist across festival rotations.

## Cross-Spec Dependencies

- **`pin-collection`** (already implemented): this spec amends its Festival Foodie ladder
  (Requirement 10.3) so the ladder's `festivalBooths` metric counts festival-tagged completions
  regardless of the underlying experience's `active` state. `pin-collection`'s own
  requirements.md/design.md/tasks.md are amended additively alongside this spec (see that spec's
  Requirement 10.3 revision note).
- **`stats-experience-redesign`** (already implemented): this spec adds a new, independent count
  stat (not a `CompletionCell`/percentage dimension) to the existing `GET /me/stats` response. It
  does not modify any existing coverage dimension, transaction boundary, or gating rule from that
  spec.
- **Disney catalog sync** (`apps/api/src/services/catalog/`, already implemented): this spec
  reads (never writes) `experiences.active`, `experiences.category`, and
  `experiences.grouped_facets` to identify festival-kiosk booths, and never modifies the
  Catalog_Sync reconcile/diff pipeline itself.

## Glossary

- **Festival_Booth**: An `experiences` row with `category = 'Restaurant'` whose `grouped_facets`
  carries `quickService: 'Festival Kiosk'` (the existing predicate in
  `apps/api/src/services/pins/evaluator.ts`'s `isFestivalBooth`).
- **Festival**: One of a closed, versioned set of EPCOT festival identifiers (e.g. Food & Wine,
  Flower & Garden, Festival of the Arts, Festival of the Holidays), defined once in
  `@dwt/shared` as `FESTIVAL_SLUGS`.
- **Festival_Tag**: A durable record associating one Festival_Booth's `experiences.id` with one
  Festival and one Festival_Year, persisted independently of the booth's `active` state and never
  written or overwritten by Catalog_Sync.
- **Festival_Year**: The calendar year of a specific run/edition of a Festival (e.g. Food & Wine
  2026). A Festival_Booth may carry at most one Festival_Tag per Festival_Year, since Disney does
  not guarantee a booth's `upstream_entity_id` (Enterprise_Id) is stable from one year's edition
  to the next.
- **Tagging_CLI**: The interactive local script (`npm run tag-festival-booth`) that discovers the
  currently-active Festival_Booths and writes Festival_Tags for them.
- **Festival_Foodie_Ladder**: The existing pin-collection count ladder
  (`pin-collection` Requirement 10.3, catalog ids `bronze_festival_first` /
  `bronze_festival_5` / `bronze_festival_10` / `silver_festival_20` / `gold_festival_30`) counting
  distinct completed Festival_Booths.

## Requirements

### Requirement 1: Festival Enum

**User Story:** As a maintainer, I want the set of valid festival identifiers defined once in
shared code, so that the CLI, the persisted tag, and any future stats/pins consumer can never
drift on what a valid festival name is.

#### Acceptance Criteria

1. THE `@dwt/shared` package SHALL define a closed `FESTIVAL_SLUGS` tuple (mirroring the
   `PIN_COUNT_METRICS` / `PARKS` convention) with the four known EPCOT festivals: Food & Wine,
   Flower & Garden, Festival of the Arts, and Festival of the Holidays.
2. THE `@dwt/shared` package SHALL derive a `FestivalSlug` type and a `festivalSlugSchema` Zod
   enum from `FESTIVAL_SLUGS`, so validation cannot diverge from the display list.
3. THE `FESTIVAL_SLUGS` tuple SHALL be extensible by adding a new slug in one place (a code
   change, not a migration), since Disney's festival lineup is not itself persisted upstream.

### Requirement 2: Festival Tag Persistence

**User Story:** As a User, I want a festival booth's festival association preserved permanently,
so that it survives the booth's deactivation when the festival ends and remains available for
future stats or challenges.

#### Acceptance Criteria

1. THE Festival_Tagging_Service SHALL persist a Festival_Tag as a row referencing an
   `experiences.id`, a `FestivalSlug`, and a Festival_Year (integer calendar year), independent of
   any other `experiences` column.
2. THE Festival_Tag row SHALL NOT be inserted, updated, or deleted by Catalog_Sync's reconcile/
   diff pipeline under any circumstance, including when the tagged experience is soft-deleted
   (`active` set to `FALSE`) or reactivated.
3. THE Festival_Tagging_Service SHALL enforce at most one Festival_Tag per
   `(experience_id, festival_year)` pair; attempting to tag the same experience for the same year
   under a different festival SHALL be rejected unless explicitly forced (see Requirement 3.5).
4. THE Festival_Tagging_Service SHALL allow the same `experience_id` to carry Festival_Tags for
   multiple distinct Festival_Years (a booth's Enterprise_Id reused across festival editions in
   different years), each a separate row.
5. THE Festival_Tag's presence, festival, and year SHALL remain queryable for an experience row
   regardless of that row's current `active` value.

### Requirement 3: Interactive Tagging CLI

**User Story:** As the app's operator, I want to tag an entire festival's booths with a single
command and minimal typing, so that tagging a festival rotation takes minutes, not a manual
per-booth lookup.

#### Acceptance Criteria

1. THE Tagging_CLI SHALL be runnable as `npm run tag-festival-booth --workspace apps/api` (local)
   and `npm run tag-festival-booth:cloud --workspace apps/api` (hosted DB), mirroring the existing
   `sync` / `sync:cloud` script pairing convention.
2. THE Tagging_CLI SHALL prompt the operator to choose one Festival from the closed
   `FESTIVAL_SLUGS` list (numbered menu) rather than accepting free-text festival input, and
   SHALL accept the Festival_Year as a command-line argument or, if omitted, via a prompt.
3. THE Tagging_CLI SHALL, by default, discover every `experiences` row with `active = TRUE`,
   `category = 'Restaurant'`, and the `Festival Kiosk` facet (the same predicate as
   `isFestivalBooth`), and treat that discovered set as the Festival_Booths to tag — no name
   search or manual per-booth selection is required for the common case.
4. THE Tagging_CLI SHALL print the full list of discovered booths (name + park) and the
   festival/year they are about to be tagged with, and SHALL require an explicit confirmation
   before writing any Festival_Tag.
5. WHERE a discovered booth already carries a Festival_Tag for the selected Festival_Year under a
   **different** festival, THE Tagging_CLI SHALL exclude that booth from the default write, flag
   it distinctly in the printed output, and require a separate explicit `--force` acknowledgment
   to retag it — so a teardown/setup-overlap booth is never silently mistagged.
6. THE Tagging_CLI SHALL be idempotent: re-running it for the same festival and year against a
   booth that already carries that exact Festival_Tag SHALL make no write and report the booth as
   already tagged, rather than erroring or duplicating a row.
7. THE Tagging_CLI SHALL be a local operator tool with no new authenticated HTTP endpoint, network
   exposure, or admin UI; it connects directly to the target Postgres database exactly as
   `runSync.ts` / `backfillFacetEnrichment.ts` do.

### Requirement 4: Festival Foodie Ladder Historical Correctness

**User Story:** As a User who visited festival booths in a past festival, I want my Festival
Foodie ladder progress to keep counting those visits after the festival ends, so that completing
a since-deactivated booth is not silently lost from my pin progress.

#### Acceptance Criteria

1. THE Pin_Service's `festivalBooths` count metric SHALL count a User's completed experiences that
   carry a Festival_Tag, regardless of whether the underlying `experiences.active` is `TRUE` or
   `FALSE`.
2. THE Pin_Service's `festivalBooths` count metric SHALL continue to count a completed,
   currently-active Festival_Booth even before it has been tagged (an untagged but active
   Festival_Kiosk-faceted booth keeps behaving exactly as it does today), so tagging is additive
   and never regresses current-festival tracking during the (typically brief) window before the
   operator runs the Tagging_CLI for a newly-opened festival.
3. THE Pin_Service SHALL NOT change the `active = TRUE` catalog filter for any other Pin count
   metric or ladder; this correction is scoped to the `festivalBooths` metric only.
4. THE Festival Foodie ladder's existing thresholds, tiers, and pin ids (pin-collection
   Requirement 10.3) SHALL be unchanged by this fix; only the completeness of what counts toward
   them changes.

### Requirement 5: Festival Stats

**User Story:** As a User, I want to see how many festival booths I've visited, both lifetime and
broken down by festival, so that my festival-dining history is visible even after a festival ends.

#### Acceptance Criteria

1. THE Stats_Service SHALL provide a lifetime count of distinct completed, Festival_Tagged
   experiences, independent of the tagged experiences' current `active` state.
2. THE Stats_Service SHALL provide a per-Festival breakdown (grouped by `FestivalSlug`, summed
   across all Festival_Years) of distinct completed, Festival_Tagged experiences.
3. THE Stats_Service's festival counts SHALL be plain counts with no percentage-of-catalog
   denominator, since the set of all festival booths that have ever existed grows with every
   festival rotation and is not a meaningful completion target.
4. THE Stats_Service SHALL return the festival counts within the existing `GET /me/stats`
   response as a new, additive field; no existing field, gating rule, or transaction boundary in
   that response SHALL change.
5. THE Stats_Service's festival counts SHALL exclude a User's completion of a Festival_Booth that
   has never been tagged (an active, untagged booth completed today, before the operator runs the
   Tagging_CLI, does not yet count toward this stat; it counts once tagged).

### Requirement 6: No New Persisted Denominator

**User Story:** As a maintainer, I want the festival feature to avoid introducing a percentage
statistic whose denominator inflates every festival rotation, so that a User's displayed progress
never appears to regress through no fault of their own.

#### Acceptance Criteria

1. THE Festival_Tagging_Service and Stats_Service SHALL NOT compute or expose any
   percentage-of-all-festival-booths-ever statistic.
2. WHERE a percentage is meaningful (e.g. a future "this festival, this year" completion rate
   scoped to one Festival_Year's fixed booth set), THE Stats_Service MAY add it in a later
   revision, but this spec SHALL ship counts only.

---

## Mobile Festival Stats Surface — Added Requirement

> **Revision note (additive).** Requirement 5 above shipped `festivals` as a field on the
> `GET /me/stats` response, but never specified anywhere a User could actually see it in the App —
> "return it in an API response" is not the same requirement as "a User can see it," and the two
> were incorrectly treated as equivalent when this spec was first implemented. Requirement 7 below
> closes that gap by giving the existing `festivals` data a mobile presentation. It does not change
> Requirement 5's response shape, the Stats_Service's computation, or any backend behavior. No
> existing requirement is removed, changed, or renumbered.

### Requirement 7: Mobile Festival Stats Display

**User Story:** As a User, I want to see my festival-booth visit history somewhere in the App's
stats, so that tagging a booth's festival actually produces something I can look at, not just a
number sitting unused in an API response.

#### Acceptance Criteria

1. THE App SHALL display the lifetime festival-booth count (`festivals.lifetimeCount`) and the
   per-festival breakdown (`festivals.byFestival`) on the `ExperiencesDetailScreen` (the Stats
   tab's Activity & Experiences detail screen), alongside the existing odometer counters, Hall of
   Fame podium, and Personal Records & Bests sections it already renders from the same
   `['me-stats', { percentile: true }]` cached read.
2. THE App SHALL render the per-festival breakdown using each `FestivalSlug`'s display label
   (`FESTIVAL_SLUG_LABELS` from `@dwt/shared`), never the raw slug string (e.g. `food-and-wine`),
   so a User never sees an internal identifier.
3. WHEN `festivals.lifetimeCount` is `0`, THE App SHALL render a compact empty/neutral state for
   this section rather than an empty list or a section that silently fails to render, consistent
   with how the existing Personal Records section already omits itself when no records exist.
4. THE App SHALL NOT introduce a new network request for this data; it SHALL read `festivals`
   from the same shared stats query `ExperiencesDetailScreen` already issues, so this addition
   costs no additional round trip.
5. THE App SHALL NOT display any percentage or denominator alongside the festival counts,
   consistent with Requirement 6.
