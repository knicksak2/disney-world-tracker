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

> **Revision note (additive).** A User found that several permanent, year-round restaurants
> (Tangierine Cafe, Marketplace - Hawai'i, Swirled Showcase, La Poutinerie, Regal Eagle Smokehouse,
> Block & Hans) carry genuine Food & Wine Festival menu items but were never discovered as
> Festival_Booth candidates, because R3.3's sole discovery signal is the `Festival Kiosk`
> `quickService` facet, and these restaurants are faceted as ordinary permanent quick-service
> locations instead. Disney's own persisted menu data for these restaurants reliably carries a
> festival-named menu group (e.g. `"Food & Wine Festival Food Offerings"`) even when the facet does
> not identify them as festival kiosks. Acceptance Criteria 3.8-3.10 below add a second, independent
> discovery signal based on that menu content. This does not change R3.1-3.7's existing
> `Festival Kiosk`-facet discovery path, the CLI's prompts/confirmation flow, or `upsertTags`; it
> only broadens what the CLI treats as a *candidate* to tag.

8. THE Tagging_CLI SHALL, in addition to the `Festival Kiosk` facet rule (R3.3), also treat an
   active, `category = 'Restaurant'` Experience as a Festival_Booth candidate when at least one of
   its persisted menus contains a group whose name matches the selected Festival's menu-keyword
   pattern (e.g. "Food & Wine Festival", matched case-insensitively and tolerant of "and"/"&" and
   singular/plural "Offering(s)" wording variants), so a permanent restaurant carrying
   festival-specific menu items without the `Festival Kiosk` facet is discovered.
9. THE Tagging_CLI's menu-keyword pattern for one Festival SHALL NOT match a menu group name
   carrying a different Festival's keyword (e.g. a Flower & Garden-named menu group SHALL NOT cause
   a Restaurant to be discovered as a Food & Wine candidate), so a permanent restaurant's leftover
   or upcoming other-festival menu content never cross-tags it under the wrong Festival.
10. BEFORE discovery, THE Tagging_CLI SHALL refresh every active, EPCOT Restaurant's cached menu
    that is missing or stale, reusing the existing demand-driven menu-retrieval freshness rule
    (restaurant-menu-display R8.4), so the menu-based signal in R3.8 reflects current festival
    content rather than a stale pre-festival cache. The refresh pass SHALL be scoped to EPCOT, not
    the full catalog, since every known Festival_Booth (temporary or permanent-with-menu-overlay)
    is located in EPCOT and refreshing every Restaurant across all Parks would needlessly cost
    minutes against Disney's shared rate limit for restaurants discovery can never match. An
    operator MAY skip this refresh pass via an explicit `--skip-menu-refresh` flag for fast
    iteration when menus are already known to be fresh.

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

---

## Catalog Festival Filtering — Added Requirement

> **Revision note (additive).** A User asked whether the catalog could be searched/filtered for
> "all the Food & Wine booths this season." It could not: `experience_festival_tags` (Requirement 2)
> was written only by the Tagging_CLI and read only by the Pin_Service (Requirement 4) and
> Stats_Service (Requirement 5) — never surfaced on the Experience DTO or `GET /catalog`, so no
> catalog browse/filter surface could use it. Requirement 8 below closes that gap by exposing a
> Festival_Booth's tag on the DTO and adding a filter. It does not change the Festival_Tag
> persistence model, the Tagging_CLI, the Pin_Service fix, or the Stats_Service counts; those
> remain exactly as Requirements 1-7 define them. No existing requirement is removed, changed, or
> renumbered.

### Requirement 8: Catalog Festival Filtering

**User Story:** As a guest, I want to filter or search the catalog for a specific festival's
booths, so that I can find every Food & Wine (or other festival) booth without recalling each
booth's name individually.

#### Acceptance Criteria

1. WHEN at least one Festival_Tag exists for an Experience, THE API SHALL include that
   Experience's Festival_Tag with the highest Festival_Year (festival and year) in the Experience
   DTO as `festivalTag`, regardless of the Experience's `active` state.
2. WHERE no Festival_Tag exists for an Experience, THE API SHALL represent `festivalTag` as `null`
   or absent in the Experience DTO.
3. THE API SHALL expose `festivalTag` on both the `GET /catalog` list response and the
   `GET /catalog/:experienceId` detail response.
4. THE API SHALL accept an optional `festivalSlug` query parameter on `GET /catalog`, validated
   against the closed `FestivalSlug` enum, returning only active Experiences that carry at least
   one Festival_Tag whose festival equals the supplied value.
5. THE API SHALL accept an optional `festivalYear` query parameter on `GET /catalog`, usable only
   together with `festivalSlug`, restricting the `festivalSlug` match to a Festival_Tag whose
   Festival_Year also equals the supplied value.
6. IF a `GET /catalog` request carries `festivalYear` without `festivalSlug`, THEN THE API SHALL
   reject the request with a validation error naming `festivalYear` as the offending field.
7. WHERE a `GET /catalog` request carries `festivalSlug` (optionally with `festivalYear`) together
   with any combination of the existing `parkId`, `category`, `categories`, `areaType`, `land`,
   `worldShowcaseCountry`, `resortId`, or `q` query parameters, THE API SHALL return only active
   Experiences that simultaneously satisfy the festival filter and every other supplied parameter.
8. IF a `GET /catalog` request carries a `festivalSlug` that matches no active Experiences, THEN
   THE API SHALL return an empty Experience list in a success response without an error.
9. THE Destination_Screen SHALL derive a Festival filter chip for each distinct `festivalTag.slug`
   present among its currently-loaded Experiences, labeled with that slug's `FESTIVAL_SLUG_LABELS`
   display label, and present it as a multi-select filter alongside the existing Land/Price/
   Attribute chips in the Filters modal (R6.13 of `catalog-navigation-redesign`), composed OR
   within the Festival dimension and AND with every other active filter dimension.
10. WHEN a User selects a Festival filter chip, THE Destination_Screen SHALL display only
    Experiences whose `festivalTag.slug` matches at least one selected Festival chip, while
    preserving the existing Land grouping, section ordering, and collapse state rules.
11. THE Destination_Screen SHALL NOT display a Festival filter chip for a `FestivalSlug` with zero
    currently-loaded Experiences carrying that `festivalTag.slug`.
12. THE Destination_Screen's Festival filter chip SHALL NOT display or imply any percentage or
    denominator, consistent with Requirement 6.

---

## Qualifying-Visit Correctness for Menu-Matched Restaurants — Added Requirements

> **Revision note (additive).** Requirement 3.8's menu-keyword signal (added above) discovers
> permanent, year-round restaurants (Tangierine Cafe, Marketplace - Hawai'i, Swirled Showcase, La
> Poutinerie, Regal Eagle Smokehouse, Block & Hans, and others) as Festival_Booths. Three
> correctness problems were found in how a "visit" to one of these is counted, none of which apply
> to a temporary `Festival Kiosk`-faceted booth (a temporary booth sells nothing BUT festival food,
> so a plain visit is already unambiguous):
>
> 1. **No expiry.** A temporary booth's Festival_Tag survives *because* the booth itself
>    deactivates when Disney's feed drops it (Property 27) — the Tag's permanence was only ever
>    load-bearing for a thing that stops existing. A permanent restaurant never deactivates, so once
>    tagged, EVERY completion of it — including one recorded next calendar year, long after this
>    Festival_Year's edition ended — would count toward this Festival_Year's stat forever, with no
>    mechanism to ever stop.
> 2. **Wrong granularity.** `completions` (and the existing Pin/Stats join) records "visited this
>    Restaurant," not "ordered a festival item." A permanent restaurant's regular, non-festival menu
>    is what most of its visits are for; counting every visit as a festival visit over-counts.
> 3. **A logged dish with no completion is invisible.** A User who logs a specific dish via
>    `food_item_logs` (`food-item-logging`) without separately marking the Restaurant `completed`
>    today contributes nothing to the festival count, even though logging the specific festival dish
>    is a *more* precise signal of a qualifying visit than a bare completion.
>
> Requirements 9-11 below fix all three together, since they share one mechanism: a
> **Qualifying_Visit** computation that replaces the plain `completions JOIN
> experience_festival_tags` read in both the Pin_Service (`festivalBooths` metric) and the
> Stats_Service (`festivals` field). This changes ONLY how a visit to an ALREADY-tagged experience
> is recognized as counting; it does not change Requirement 1-8's discovery, tagging, persistence,
> or catalog-filtering behavior. No existing requirement is removed, changed, or renumbered.

## Glossary (additive)

- **Match_Kind**: A closed discriminator, `'facet' | 'menu'`, recorded on each Festival_Tag
  (Requirement 9.1) stating which Requirement 3 discovery signal produced it: `'facet'` for the
  existing `Festival Kiosk`-faceted (temporary) discovery path (R3.3), `'menu'` for the
  menu-keyword (permanent-restaurant) path (R3.8).
- **Festival_Edition**: An optional, operator-set date window — a `starts_on` date and an optional
  `ends_on` date (absent/`null` = "still running") — for one specific `(FestivalSlug,
  Festival_Year)` pair. Absent for a pair no operator has set a window for (Requirement 9.4).
- **Food_Item_Festival_Tag**: A durable record associating one `food_items` row with one Festival
  and Festival_Year, naming that specific dish as a qualifying festival item. Written only for
  `'menu'`-matched (permanent-restaurant) Festival_Tags (Requirement 10.2); a `'facet'`-matched
  booth never needs one because every dish it serves is a festival dish.
- **Qualifying_Visit**: The corrected per-User, per-tagged-experience "did this count as a festival
  visit" computation (Requirement 11) that replaces the plain `completions`-only join used by the
  Pin_Service and Stats_Service before this revision.

### Requirement 9: Festival Edition Date Window

**User Story:** As a User, I want a Festival Foodie credit for a permanent restaurant to apply only
to the festival run I actually visited it during, so that a regular lunch there next year does not
silently inflate this year's festival stat.

#### Acceptance Criteria

1. THE Festival_Tagging_Service SHALL record a `Match_Kind` (`'facet'` or `'menu'`) on every
   Festival_Tag, set automatically from whichever Requirement 3 discovery signal produced it at the
   time it was written (`'facet'` when the `Festival Kiosk` facet matched, `'menu'` otherwise).
2. WHERE a Festival_Tag was persisted before this revision (no recorded `Match_Kind`), THE
   Festival_Tagging_Service SHALL derive its `Match_Kind` once, at migration time, from the SAME
   facet predicate Requirement 3.3 already uses against the experience's currently-persisted
   `grouped_facets` — `'facet'` when it matches, `'menu'` otherwise — so every existing Festival_Tag
   is correctly classified without an operator having to retag anything.
3. THE Tagging_CLI SHALL, before discovery, allow the operator to set a Festival_Edition's
   `starts_on` (required, defaulting to today) and `ends_on` (optional; blank means "still
   running," and SHALL NOT overwrite a previously-set `ends_on` with blank on a later run of the
   CLI for the same `(FestivalSlug, Festival_Year)`) for the Festival and Festival_Year being
   tagged.
4. WHERE no Festival_Edition row exists for a `(FestivalSlug, Festival_Year)` pair, THE
   Qualifying_Visit computation (Requirement 11) SHALL apply no date restriction for that pair —
   so a Festival_Tag written before this revision, whose edition an operator has not yet set,
   continues to count exactly as it did before this revision until the operator does set one.
5. WHERE a Festival_Edition row exists for a `(FestivalSlug, Festival_Year)` pair, THE
   Qualifying_Visit computation SHALL only count a signal (a completion or a Food_Item_Log, per
   Requirement 11) whose date falls between that edition's `starts_on` and `ends_on` inclusive,
   treating an absent `ends_on` as "today" (i.e. the edition is still open-ended and running).

### Requirement 10: Dish-Level Signal for Menu-Matched Restaurants

**User Story:** As a User, I want a permanent restaurant's Festival Foodie credit to require that I
actually ordered a festival dish there, so that an ordinary visit for the regular menu is not
mistaken for a festival visit.

#### Acceptance Criteria

1. WHEN the Tagging_CLI discovers a Restaurant via the menu-keyword signal (Requirement 3.8,
   `Match_Kind = 'menu'`) and the operator confirms tagging it, THE Tagging_CLI SHALL additionally
   tag, as Food_Item_Festival_Tags for the same Festival and Festival_Year, every `food_items` row
   at that Restaurant whose name was found inside a menu group that matched the Festival's
   menu-keyword pattern (Requirement 3.8's pattern, reused verbatim) — not every dish the
   Restaurant serves.
2. THE Tagging_CLI SHALL NOT write any Food_Item_Festival_Tag for a `Match_Kind = 'facet'`
   (temporary, Festival-Kiosk-faceted) booth — every dish such a booth serves is already,
   unambiguously, a festival dish, so no per-dish tag is needed for it (Requirement 11.2).
3. THE Qualifying_Visit computation SHALL count a `Match_Kind = 'menu'` Festival_Tag's experience as
   visited for a User ONLY when that User has a Food_Item_Log (within the applicable Festival_Edition
   window, Requirement 9.5) for a `food_items` row carrying a Food_Item_Festival_Tag for that same
   Festival and Festival_Year; a plain `completions` row at a `Match_Kind = 'menu'` experience,
   with no such Food_Item_Log, SHALL NOT count.
4. WHERE a Restaurant's menu changes such that a previously-tagged dish is no longer offered, THE
   Food_Item_Festival_Tag SHALL remain unchanged (mirrors `food-item-logging` Requirement 1.7's
   "a dish dropping off the menu never deletes the item or its tag" rule) — historical qualifying
   visits already counted are never retroactively un-counted.

### Requirement 11: Qualifying-Visit Union and Deduplication

**User Story:** As a User, I want logging a festival dish to count even if I forgot to separately
mark the restaurant as visited, and I want visiting (or logging dishes at) the same booth multiple
times in one festival to still count as one booth toward my Festival Foodie progress, not several.

#### Acceptance Criteria

1. THE Qualifying_Visit computation SHALL count a `Match_Kind = 'facet'` Festival_Tag's experience
   as visited for a User when EITHER a qualifying `completions` row exists for that
   `(User, experience)` pair, OR a qualifying Food_Item_Log exists for ANY `food_items` row scoped
   to that experience — no per-dish tag is required for this case (Requirement 10.2), since every
   dish at a `'facet'`-matched booth is a festival dish.
2. THE Qualifying_Visit computation SHALL count a `Match_Kind = 'menu'` Festival_Tag's experience
   as visited for a User per Requirement 10.3 (a tagged-dish Food_Item_Log only; a bare completion
   never qualifies on its own).
3. For any User and any single tagged experience, regardless of how many qualifying `completions`
   and/or Food_Item_Log rows exist for it (including multiple distinct dishes logged on the same or
   different dates), THE Pin_Service's `festivalBooths` metric and the Stats_Service's lifetime and
   per-Festival counts SHALL each count that experience's contribution as AT MOST ONE — the
   Qualifying_Visit computation is a boolean per `(User, experience)` pair, never a sum of
   qualifying signal rows (Property 32).
4. THE Qualifying_Visit computation SHALL NOT write to `completions`, `experience_logs`, or any
   other table when a Food_Item_Log alone satisfies Requirement 11.1 or 10.3 — recognizing a
   Food_Item_Log as a qualifying signal is a READ-side computation; it never synthesizes or backfills
   a `completions` row, preserving `food-item-logging` Requirement 3.5's existing boundary that a
   Food_Item_Log never writes to `completions`.
5. THE Pin_Service's `festivalBooths` metric's existing union with currently-active, untagged
   `Festival Kiosk` booths (Requirement 4.2, Property 25) SHALL be unaffected by Requirements 9-11 —
   those two unions compose: a booth may be counted via the pre-tag active-untagged path, or via the
   Qualifying_Visit computation once tagged, never both for the same experience (Property 25
   already guarantees this and is unchanged).
