# Implementation Plan

## Overview

Adds a durable Festival_Tag table (never touched by Catalog_Sync), a closed `FestivalSlug` enum,
an interactive CLI to apply tags with minimal manual effort, a fix to the pin-collection
`festivalBooths` metric so tagged completions survive the tagged booth's deactivation, and a new
additive `festivals` field on `GET /me/stats` (lifetime count + per-festival breakdown, no
denominator). Built bottom-up: shared enum/schema first, then the migration and its repo, then the
CLI, then the two independent read-side consumers (pins, stats), each gated by its own test suite,
finishing with one full verification gate.

## Tasks

- [x] 1. Shared: `FestivalSlug` enum and schema (`@dwt/shared`)
  - [x] 1.1 Add `FESTIVAL_SLUGS`, `FestivalSlug`, and `FESTIVAL_SLUG_LABELS` to
        `packages/shared/src/enums.ts` per design.md (R1.1, R1.2, R1.3)
  - [x] 1.2 Add `festivalSlugSchema = z.enum(FESTIVAL_SLUGS)` to
        `packages/shared/src/schemas/` (new `Festival.ts` or alongside `enums`-derived schemas
        wherever `pinCountMetricSchema` lives); export both from `packages/shared/src/index.ts`
        and `schemas/index.ts` (R1.2)
  - [x] 1.3 Add `FestivalStatsDTO` to `packages/shared/src/dto/Stats.ts` and add `festivals:
        FestivalStatsDTO` to `StatsDTO` per design.md's Data Models section (R5.4)
  - [x] 1.4 Add `festivalStatsSchema` to `packages/shared/src/schemas/Stats.ts` and thread
        `festivals: festivalStatsSchema` into `statsSchema` (which is `.strict()` — every existing
        `StatsDTO` schema-test fixture must be updated or it will now fail parsing) (R5.4)
  - [x] 1.5 Unit tests: `festivalSlugSchema` accepts every `FESTIVAL_SLUGS` member and rejects an
        arbitrary string; `festivalStatsSchema` accepts a valid `FestivalStatsDTO` and rejects one
        with an extra `percent`/`total` field (Property 28) and one with a `count: 0` entry
  - [x] 1.6 Rebuild `@dwt/shared` (`npm run build:shared`) so `apps/api` sees the new exports

- [x] 2. Migration: `experience_festival_tags`
  - [x] 2.1 Confirm the actual latest migration number under `apps/api/migrations/` (expected
        `0039_experience_festival_tags.sql` as of this writing) and create it per design.md's
        Data Models SQL (table, unique constraint, year `CHECK`, two indexes, cascade) (R2.1, R2.3,
        R2.4)
  - [x] 2.2 Add `apps/api/src/db/__tests__/migration0039.test.ts` (pg-mem) asserting the table
        exists, the `(experience_id, festival_year)` unique constraint rejects a duplicate pair
        under the same festival vs. allows two different years for the same experience, the year
        `CHECK` rejects an out-of-range year, and the cascade fires on the parent experience's
        deletion (R2.1, R2.3, R2.4)

- [x] 3. `FestivalTagRepo` (write-side, used only by the CLI)
  - [x] 3.1 Implement `apps/api/src/services/catalog/festivalTags/repo.ts` — `FestivalTagRow`,
        `DiscoveredBooth`, `FestivalTagRepo` with `listActiveFestivalBooths(year, slug)` and
        `upsertTags(entries, { force })` exactly per design.md's SQL (R2.2, R2.5, R3.3, R3.5, R3.6)
  - [x] 3.2 Integration tests `apps/api/src/services/catalog/festivalTags/__tests__/
        repo.integration.test.ts` (real Postgres, per this repo's existing catalog-adjacent
        integration-test convention): `listActiveFestivalBooths` returns only active +
        `Restaurant` + `Festival Kiosk`-faceted rows and correctly flags `conflictingTag`;
        `upsertTags` re-run with identical inputs makes no additional row (Property 26); a
        same-year different-slug call is excluded without `force` and applied with `force`; a
        soft-deleted (`active = FALSE`) experience's existing tag is unaffected by the
        active/inactive toggle (Property 27)
  - [x] 3.3 Property test `apps/api/src/services/catalog/festivalTags/__tests__/
        repo.prop.test.ts` (`fast-check`, ≥100 runs, tagged `Feature: festival-booth-tagging,
        Property 26`): arbitrary sequences of `upsertTags` calls over a small fixed set of
        experience ids/years/slugs/force-flags never produce more than one row per
        `(experience_id, festival_year)`

- [x] 4. Checkpoint — backend data-layer verification
  - [x] 4.1 Run `npx vitest run apps/api/src/db/__tests__/migration0039.test.ts
        apps/api/src/services/catalog/festivalTags` and `npm run typecheck`; paste the literal
        tail; both must be green before moving on

- [x] 5. Interactive Tagging CLI
  - [x] 5.1 Implement `apps/api/src/scripts/tagFestivalBooth.ts` — pure helpers `buildFestivalMenu()`
        (numbered list from `FESTIVAL_SLUG_LABELS`), `formatDiscoveryReport(booths)` (name + park +
        conflict annotations), and a thin `main()` using `node:readline/promises` for the festival
        choice and confirmation prompts, `process.argv` for `--year` / `--force` flags, calling
        `FestivalTagRepo` (R3.1, R3.2, R3.4, R3.7)
  - [x] 5.2 Add `tag-festival-booth` / `tag-festival-booth:cloud` scripts to
        `apps/api/package.json`, mirroring the `sync` / `sync:cloud` pairing exactly (`--env-file`
        vs `--env-file=.env.dev`) (R3.1)
  - [x] 5.3 Unit tests for the pure helpers: `buildFestivalMenu()` lists all four festivals in
        `FESTIVAL_SLUGS` order; `formatDiscoveryReport` renders a conflict annotation only for
        booths with a non-null `conflictingTag` and omits it otherwise; a zero-booth discovery
        renders the "nothing to do" message (Requirement 3's "no active booths" case from
        design.md's Error Handling)

- [x] 6. Pin_Service: `festivalBooths` metric historical correctness
  - [x] 6.1 Add `festivalTaggedCompletedIds: ReadonlySet<string>` to `PinActivitySnapshot`
        (`apps/api/src/services/pins/evaluator.ts`) and change the `festivalBooths` case in
        `metricValue` to the union logic in design.md (active-untagged count + tagged-id count, no
        double-count) (R4.1, R4.2, R4.3, R4.4)
  - [x] 6.2 `apps/api/src/services/pins/repo.ts`'s `buildSnapshot`: add the
        `experience_festival_tags` join query from design.md, mapped to upstream ids, and thread
        it into the returned `PinActivitySnapshot` as `festivalTaggedCompletedIds` — no other
        snapshot field changes (R4.1)
  - [x] 6.3 Property test in `apps/api/src/services/pins/__tests__/evaluator.prop.test.ts`
        (`fast-check`, ≥100 runs, tagged `Feature: festival-booth-tagging, Property 25`): arbitrary
        snapshots with overlapping active-kiosk and tagged-id sets never double-count an experience
        present in both, and the total always equals the union's size
  - [x] 6.4 Extend `apps/api/src/services/pins/__tests__/repo.integration.test.ts`: a completed,
        since-deactivated, tagged booth still counts toward `festivalBooths`; a completed, active,
        untagged booth still counts (pre-tag grace window, R4.2); a completed, deactivated,
        **untagged** booth does NOT count (the documented, intentionally-unchanged existing gap —
        this is a regression guard proving the fix is scoped, not a blanket "inactive no longer
        matters" change)

- [x] 7. Stats_Service: festival lifetime + per-festival counts

  > **Correction — read before starting task 7.** An earlier version of this task told the
  > implementer to wire `festivals` into `@dwt/shared`'s `StatsDTO`/`statsSchema`. That type is
  > **not** what `GET /me/stats` returns — verified: the real response type is `StatsResponse`,
  > defined locally in `apps/api/src/services/stats/routes.ts` and mirrored in
  > `apps/mobile/src/api/statsTypes.ts`; `StatsDTO` is unused dead code nowhere imported outside
  > `packages/shared`. If task 1 already added `festivals` to `StatsDTO`/`statsSchema`, leave that
  > in place (harmless, and `FestivalStatsDTO`/`festivalStatsSchema` are still the right shared
  > types to reuse below), but it does **not** satisfy this task — `festivals` must be added to the
  > two real response types per 7.2/7.2b below, or the feature will silently do nothing.

  - [x] 7.1 Implement `apps/api/src/services/stats/festivals.ts` — the raw read (added to the
        existing single snapshot transaction, alongside the existing `resortCoverage`-style reads)
        and the pure `rollUpFestivalStats` per design.md (R5.1, R5.2, R5.3, R5.5)
  - [x] 7.1b Thread the new raw read through `apps/api/src/services/stats/repo.ts`: add a
        `festivalCounts` (or similarly named) field to `StatsSnapshot`, populate it inside
        `getStatsSnapshot`'s existing `REPEATABLE READ READ ONLY` transaction (same pattern as
        `resortCoverage`'s `resortDenominators`/`resortNumerators` queries), and export the raw row
        type per the file's existing `export type { RawResortCoverageRow } from './resorts.js';`
        convention
  - [x] 7.2 Add `festivals: FestivalStatsDTO` (imported from `@dwt/shared`) to the **real**
        `StatsResponse` interface in `apps/api/src/services/stats/routes.ts`, and wire
        `festivals: rollUpFestivalStats(...)` into the `response` object `assembleResponse` builds,
        as a sibling of `coverage`/`ratings`/`activity` (not nested under `coverage`); no change to
        gating, transaction boundary, percentile isolation, or any other existing field (R5.4)
  - [x] 7.2b Mirror the same `festivals: FestivalStatsDTO` field onto the mobile
        `StatsResponse` interface in `apps/mobile/src/api/statsTypes.ts`, per that file's existing
        convention of re-declaring the identical shape rather than importing the backend module
        (R5.4)
  - [x] 7.3 Unit + property tests `apps/api/src/services/stats/__tests__/festivals.test.ts` /
        `.prop.test.ts`: `rollUpFestivalStats` sorts by count desc then slug asc, omits zero-count
        festivals, and Property 28's no-percentage-field invariant (asserted via the Zod schema's
        parsed key set, not just the TS type)
  - [x] 7.4 Extend `apps/api/src/services/stats/__tests__/routes.test.ts` (`server.inject`):
        `GET /me/stats` response includes `festivals.lifetimeCount` and `festivals.byFestival` with
        the expected values for a seeded user with tagged completions across two festivals, and an
        empty (`lifetimeCount: 0, byFestival: []`) `festivals` for a user with none; a completed,
        untagged booth (active or not) contributes nothing to `festivals` (R5.5). This is the test
        that would have caught the StatsDTO-vs-StatsResponse mistake — it asserts against the
        actual HTTP response body, not the shared package's type.

- [x] 8. Checkpoint — final verification gate
  - [x] 8.1 Run full `npm run verify` across all workspaces, as the single final gate for this
        change (shared enum/schema + migration + repo + CLI + pins fix + stats addition + all
        tests together, per the execution-discipline "one unit, one final gate" rule); paste the
        literal tail (per-workspace test counts and the exit code); it must exit 0

## Notes

- **Task 9 origin.** Added after task 8's backend-only change shipped and the user asked where in
  the app they could see the festival stats — the answer was nowhere: `festivals` was returned by
  `GET /me/stats` but no mobile screen read it. Requirement 5's original wording ("additive field
  on `GET /me/stats`") was mistakenly treated as equivalent to "a User can see it," which it is
  not; Requirement 7 was added to close that gap, and this task implements it. No backend behavior
  changes as part of this task.

- **Source of truth for "which booths are this festival's":** at any given moment, only one
  festival's booths are ever active in EPCOT (confirmed assumption, not derived from Disney's
  feed — flag to the user if a live changeover is ever observed to briefly overlap two festivals'
  booths, since the CLI's default discovery assumes it does not). The CLI's default discovery is
  therefore "every currently-active Festival_Kiosk-faceted booth," not a name search.
- **Identifier keying:** the tag table keys on `experiences.id` (this codebase's stable internal
  UUID), not `upstream_entity_id` directly, since that's what every other FK to `experiences` in
  this schema uses; the pins/stats read paths join through it the same way `completions` already
  does.
- **Cross-spec dependency:** `pin-collection`'s Requirement 10.3 and design.md are amended
  additively in the same change (see that spec's own tasks.md follow-up task) to consume this
  spec's tag table; that amendment is tracked in `pin-collection`'s own tasks.md, not duplicated
  here.
- **No admin UI, no new endpoint.** Per explicit user decision, an admin panel is tracked as a
  separate, future spec; this feature's only write path is the local CLI script, matching the
  existing `sync` / `backfill-facets` precedent.
- **Denominator discipline:** nothing in this feature computes or exposes a
  percentage-of-all-festival-booths-ever statistic (Requirement 6) — every new count is a plain
  integer. If a future spec wants a "this year's festival, this year's completion rate" percentage
  scoped to one `festival_year`'s fixed booth set, that is new scope for that spec, not this one.

- [x] 9. Mobile: display festival stats on `ExperiencesDetailScreen` (Requirement 7 — additive;
      depends on task 7's `festivals` field already being on the real `StatsResponse`)
  - [x] 9.1 Import `FESTIVAL_SLUG_LABELS` from `@dwt/shared` into
        `apps/mobile/src/screens/stats/ExperiencesDetailScreen.tsx`; add the "Festival Booths"
        section (lifetime count card + per-festival rows using display labels, never raw slugs) in
        the existing Activity Overview block per design.md's component sketch, alongside (not
        replacing) the odometer/podium/records sections (R7.1, R7.2)
  - [x] 9.2 Add the empty-state render (`lifetimeCount === 0`) with worded copy, distinct from
        simply omitting the section (R7.3)
  - [x] 9.3 Confirm no new query is added — `festivals` is read from the same `statsQuery.data`
        (`['me-stats', { percentile: true }]`) the screen already fetches (R7.4); no percentage or
        denominator is rendered anywhere in the new section (R7.5)
  - [x] 9.4 Extend `apps/mobile/src/screens/stats/__tests__/ExperiencesDetailScreen.test.tsx`
        (mocking only the network/query layer): seed a non-empty `festivals` response and assert
        the lifetime count and each festival's display label + count render; seed an empty
        `festivals` response and assert the empty-state copy renders instead; assert no additional
        network call fires beyond the existing single stats fetch

- [x] 10. Checkpoint — final verification gate (re-run after task 9)
  - [x] 10.1 Run full `npm run verify` across all workspaces once, as the final gate for this
        additive mobile change; paste the literal tail (per-workspace test counts and exit code);
        it must exit 0

- [x] 11. Catalog: expose and filter `festivalTag` on `GET /catalog` (Requirement 8 — additive;
      depends on task 2's `experience_festival_tags` table already existing)
  - [x] 11.1 Add `festivalTag` to `ExperienceDTO` (`packages/shared/src/dto/Experience.ts`) and
        `experienceSchema` (`packages/shared/src/schemas/Experience.ts`) per design.md's Data
        Models section; rebuild `@dwt/shared` (R8.1, R8.2)
  - [x] 11.2 Add `festivalSlug` / `festivalYear` to `CatalogListFilters`
        (`apps/api/src/services/catalog/repo.ts` and `routes.ts`) and the `catalogQuerySchema`
        Zod schema, with `festivalYear` rejected (`validation_failed`) when `festivalSlug` is
        absent (R8.4, R8.5, R8.6)
  - [x] 11.3 `listActiveExperiences`/`getExperience`: add the `DISTINCT ON` derived-table LEFT JOIN
        for the DTO's `festivalTag` projection, and the `EXISTS` correlated-subquery WHERE clause
        for the `festivalSlug`/`festivalYear` filter, per design.md's SQL (R8.1, R8.4, R8.5, R8.7)
  - [x] 11.4 Repo integration test (`apps/api/src/services/catalog/__tests__/
        repo.festivalFilter.test.ts`, pg-mem): untagged/tagged/multi-year-tagged projection cases,
        `festivalSlug` matching a non-highest-year tag (Property 29), conjunctive combination with
        `park`/`category`, empty-result case (R8.1, R8.2, R8.4, R8.7, R8.8)
  - [x] 11.5 Route tests (`apps/api/src/services/catalog/__tests__/routes.test.ts`, extended):
        `festivalSlug` forwarded to the repo filter; `festivalYear` without `festivalSlug` is a 400
        naming `festivalYear`; invalid `festivalSlug` is a 400 (R8.4, R8.5, R8.6)
  - [x] 11.6 Shared schema test (`packages/shared/src/schemas/__tests__/Experience.test.ts`,
        extended): valid/absent/`null` `festivalTag` accepted; invalid slug or non-integer year
        rejected

- [x] 12. Mobile: Festival filter chips on `DestinationScreen` (Requirement 8 — additive; depends
      on task 11's `festivalTag` field already being on the real `ExperienceDTO`)
  - [x] 12.1 `experiencePickerFilters.ts`: add `festivalChips` to `deriveFilterChips`'s return
        (deduped by slug, labeled via `FESTIVAL_SLUG_LABELS`) and a `selectedFestivals` third
        parameter to `filterExperiencesMulti` (OR-within, AND-across, backward-compatible with
        every existing call site via an empty default) (R8.9, R8.10, R8.11, R8.12)
  - [x] 12.2 `DestinationScreen.tsx`'s `ThemeOrWaterParkLayout`: add a `selectedFestivals` state
        set, a "FESTIVALS" Filters-modal section mirroring the existing LANDS/PRICE
        RANGE/ATTRIBUTES sections (rendered only when `festivalChips.length > 0`), and thread
        `selectedFestivals` into the `filterExperiencesMulti` call (R8.9, R8.10, R8.11)
  - [x] 12.3 Property test extension (`apps/mobile/src/screens/trips/__tests__/
        experiencePickerFilters.prop.test.ts`): `festivalChips` dedup/labeling and
        `selectedFestivals` OR/AND composition + empty-set backward-compatibility
  - [x] 12.4 Component test extension (`apps/mobile/src/screens/catalog/__tests__/
        DestinationScreen.layouts.test.tsx`): Festival chip rendering per distinct tagged slug,
        selecting a chip narrows results while preserving Land grouping, no chip for an
        unobserved slug

- [x] 13. Checkpoint — final verification gate (re-run after task 12)
  - [x] 13.1 Run full `npm run verify` across all workspaces once, as the final gate for this
        additive catalog-filtering follow-up; paste the literal tail (per-workspace test counts
        and exit code); it must exit 0

- [x] 14. Menu-based Festival_Booth discovery (Requirement 3.8-3.10 — additive; depends on task 3's
      `FestivalTagRepo` and the existing `menuRetrieval`/`menuRefreshJob` seams)
  - [x] 14.1 Implement `apps/api/src/services/catalog/festivalTags/menuMatch.ts` —
        `menuMatchesFestival(menus, slug)` with the per-slug keyword `RegExp` table per design.md
        (R3.8, R3.9)
  - [x] 14.2 Unit + property tests `apps/api/src/services/catalog/festivalTags/__tests__/
        menuMatch.test.ts` / `.prop.test.ts` (`fast-check`, ≥100 runs, tagged `Feature:
        festival-booth-tagging, Property 30`): each observed Disney naming variant matches; no
        cross-festival match; empty menus never match
  - [x] 14.3 Amend `listActiveFestivalBooths` (`apps/api/src/services/catalog/festivalTags/
        repo.ts`) to `LEFT JOIN experience_menus` and discover a Restaurant when
        `hasFestivalKioskFacet(...) OR menuMatchesFestival(menus, slug)`, per design.md's SQL
        (R3.8)
  - [x] 14.4 Repo integration test `apps/api/src/services/catalog/festivalTags/__tests__/
        repo.menuDiscovery.integration.test.ts` (pg-mem): menu-only match discovered; same booth
        excluded when tagging a different festival; cross-festival-keyword exclusion; existing
        facet-only path unaffected when no menu row exists (Property 31)
  - [x] 14.5 Add the pre-discovery menu-refresh step to `runTaggingCli`
        (`apps/api/src/scripts/tagFestivalBooth.ts`): refresh every active Restaurant's menu via
        `MenuRetrieval.getMenuForRestaurant` before calling `listActiveFestivalBooths`, best-effort
        per restaurant (one failure never aborts the pass), skippable via `--skip-menu-refresh`
        (R3.10)
  - [x] 14.6 Wire the script's `main()` to build `menuRetrieval`/`listActiveRestaurantIds` locally
        (mirroring `backfillFacetEnrichment.ts`'s self-contained dependency construction — no
        change to `composeServices.ts`); scoped to EPCOT via `FestivalTagRepo.
        listActiveEpcotRestaurantIds()` rather than the full ~450-restaurant catalog (fixed after
        an initial implementation needlessly refreshed every Park's restaurants and measurably
        slowed the CLI, per design.md's note)
  - [x] 14.7 Extend `apps/api/src/scripts/__tests__/tagFestivalBooth.test.ts`: the refresh step is
        called for every active Restaurant id before discovery; a refresh failure for one
        restaurant does not abort the pass; `--skip-menu-refresh` skips the step

- [x] 15. Checkpoint — final verification gate (re-run after task 14)
  - [x] 15.1 Run full `npm run verify` across all workspaces once, as the final gate for this
        additive discovery follow-up; paste the literal tail (per-workspace test counts and exit
        code); it must exit 0

- [x] 16. Migration: `match_kind` backfill + `festival_editions` + `food_item_festival_tags`
      (Requirement 9.1-9.2, 10 — additive; depends on task 14's `menu`-matched tags existing)
  - [x] 16.1 Created `apps/api/migrations/0055_festival_edition_and_dish_tags.sql`:
        `experience_festival_tags.match_kind` column + CHECK + the `'facet'`-vs-`'menu'` backfill
        UPDATE (re-running the R3.3 facet predicate against current `grouped_facets`, via `UPDATE
        ... WHERE id IN (subquery)` + JSONB `@>` containment rather than `UPDATE ... FROM` +
        `jsonb_array_elements`, which this app's pg-mem harness does not support) + `NOT NULL`;
        `festival_editions` table; `food_item_festival_tags` table (R9.1, R9.2, R9.3-9.5,
        R10.1-10.2). Applied against the local dev DB and verified the real backfill split
        (28 `'facet'` / 19 `'menu'`, matching the exact facet/non-facet split found earlier)
  - [x] 16.2 Added `apps/api/src/db/__tests__/migration0055.test.ts` (pg-mem, 15 tests): a
        pre-existing Festival-Kiosk-faceted row backfills to `'facet'`; a non-kiosk-faceted row
        (including one with NO `quickService` facet at all) backfills to `'menu'`; `match_kind` is
        `NOT NULL` post-migration and its CHECK rejects an invalid value; `festival_editions`' PK,
        year CHECK, and `ends_on >= starts_on` CHECK (including the equal-dates boundary);
        `food_item_festival_tags`' UNIQUE, year CHECK, and CASCADE from `food_items`

- [x] 17. Pure cores: `qualifyingVisit.ts` + `menuMatch.ts`'s `festivalMatchingItemNames`
      (Requirement 9.4-9.5, 10.1, 11.1-11.3 — additive; depends only on task 16's migration)
  - [x] 17.1 Implemented `apps/api/src/services/catalog/festivalTags/qualifyingVisit.ts` —
        `isQualifyingVisit(signal, window, today)` and `withinWindow` per design.md (R9.4, R9.5,
        R10.3, R11.1, R11.2). Also added `collectQualifyingVisits` (groups raw repo rows into one
        `QualifyingSignal` per tag and decides once per tag — the shared aggregation step both
        `pins/repo.ts` and `stats/repo.ts` now call) and a sibling `qualifyingVisitQuery.ts`
        module holding the one shared SQL string + row-mapping both repos query
  - [x] 17.2 Implemented `festivalMatchingItemNames(menus, slug)` in `menuMatch.ts`, reusing the
        existing `FESTIVAL_MENU_KEYWORDS` table (R10.1); left `menuMatchesFestival` unchanged
  - [x] 17.3 Added `apps/api/src/services/catalog/festivalTags/__tests__/qualifyingVisit.test.ts`
        (14 unit tests) and `qualifyingVisit.prop.test.ts` (`fast-check`, 100 runs each, 7 property
        tests): Property 32 (one completion + N food-logs across M food_items at the same
        experience never exceeds a single qualifying contribution — both a general OR-reduction
        check and the adversarial "always a boolean" check), Property 33 (menu-matched requires a
        tagged-dish log; facet-matched accepts either signal), Property 34 (inclusive boundaries;
        null window; null `endsOn` treated as "today")
  - [x] 17.4 Added unit tests for `festivalMatchingItemNames` in `menuMatch.test.ts` (7 tests):
        returns exactly the matching group's item names, deduped case-insensitively, empty for no
        match / empty menus

- [x] 18. `FestivalTagRepo` + Tagging_CLI: dish tagging and festival editions (Requirement 9.3,
      10.1-10.2 — depends on task 17's pure cores)
  - [x] 18.1 Amended `FestivalTagRepo` (`apps/api/src/services/catalog/festivalTags/repo.ts`):
        `DiscoveredBooth`/`FestivalTagRow` gained `matchKind`/`matchingFoodItemIds`;
        `listActiveFestivalBooths` now classifies the discovery match on the menu GROUP name alone
        (`menuMatchesFestival`, independent of whether any item names resolved) and separately
        resolves matching dish NAMES via `festivalMatchingItemNames` then to `food_items.id`s;
        `upsertTags` accepts `matchKind`/`matchingFoodItemIds` per entry and writes
        `food_item_festival_tags` rows in the same per-entry call (never for `matchKind: 'facet'`);
        added `upsertFestivalEdition(slug, year, startsOn, endsOn)` with the "never blank a set
        `endsOn`" upsert rule (R9.3, R10.1, R10.2)
  - [x] 18.2 Added the Tagging_CLI's edition-date step (`apps/api/src/scripts/tagFestivalBooth.ts`):
        prompts `starts_on` (default today) and optional `ends_on` before discovery, calls
        `upsertFestivalEdition`; threaded `matchKind`/`matchingFoodItemIds` through the existing
        confirm/upsert flow (R9.3)
  - [x] 18.3 Extended `FestivalTagRepo` integration tests (6 new tests): `upsertTags` with
        `matchKind: 'menu'` and non-empty `matchingFoodItemIds` writes both tables; `matchKind:
        'facet'` writes zero dish tags even if `matchingFoodItemIds` is non-empty;
        `upsertFestivalEdition` never blanks a previously-set `ends_on` and does overwrite it when
        a new explicit date is supplied
  - [x] 18.4 Extended `apps/api/src/scripts/__tests__/tagFestivalBooth.test.ts` for the new edition
        prompt and the `matchKind`/`matchingFoodItemIds` threading (rewrote the mock-repo helper to
        include `upsertFestivalEdition`; added 3 new edition-prompt tests + updated existing flow
        tests' prompt sequences)

- [x] 19. Pin_Service + Stats_Service: consume Qualifying_Visit (Requirement 11 — depends on task
      18's persisted `match_kind`/dish tags/editions existing)
  - [x] 19.1 Replaced `pins/repo.ts`'s plain `completions JOIN experience_festival_tags` read with
        the `QualifyingSignal`-producing query (shared via `qualifyingVisitQuery.ts`, joined to
        `experiences` for `upstream_entity_id`), grouped per experience via `collectQualifyingVisits`,
        each passed through `isQualifyingVisit`; only `true` results populate
        `festivalTaggedCompletedIds` (R11.1-11.3)
  - [x] 19.2 Replaced `stats/repo.ts`'s equivalent raw read the same way (same shared
        `QUALIFYING_VISIT_SIGNAL_SQL`/`toRawQualifyingSignalRows`), feeding
        `festivalCounts.lifetimeCount`/per-slug counts from the post-`isQualifyingVisit`
        experience set via `collectQualifyingVisits` (R11.3)
  - [x] 19.3 Extended `apps/api/src/services/pins/__tests__/repo.integration.test.ts` (7 new tests)
        and added `apps/api/src/services/stats/__tests__/repo.qualifyingVisit.integration.test.ts`
        (6 new tests, pg-mem): a `'menu'`-matched experience with a completion but no tagged-dish
        log does not count; the same experience WITH a tagged-dish log counts exactly once even
        with the completion also present; a food log on an UNTAGGED dish at a `'menu'`-matched
        restaurant does not count; a `'facet'`-matched experience counts from either signal alone;
        a signal outside a set `festival_editions` window does not count, and does once widened;
        absence of any edition row is unrestricted; two different dishes logged the same day at
        the same restaurant still count as exactly 1 (dedup, Property 32); multi-slug breakdown
        (R9.4, R9.5, R10.3, R11.1-11.3)
  - [x] 19.4 Confirmed Property 25 (existing active-untagged union) and Property 1/15 (pin award
        idempotency) still hold: their existing property/integration test files
        (`repo.integration.test.ts`'s pre-existing tests, `routes.test.ts`) all pass unchanged
        against the new read — no new test needed, per R11.5
  - [x] 19.3b Fixed a real regression caught by the pre-existing
        `repo.menuDiscovery.integration.test.ts`: `listActiveFestivalBooths` had started requiring
        a matching menu group to also have ≥1 resolved item name to count as a 'menu' match,
        which silently stopped discovering any festival-named group with zero (or not-yet-synced)
        items. Fixed by classifying the match on the group name alone
        (`menuMatchesFestival`) and resolving `matchingFoodItemIds` as a separate, independent
        step.

- [x] 20. Checkpoint — final verification gate (re-run after task 19)
  - [x] 20.1 Ran full `npm run verify` across all workspaces once, as the final gate for this
        qualifying-visit correctness follow-up. `apps/api` (387/387 test files, 2683/2683 tests)
        and `packages/shared` (34/34, 400/400) are fully green. `apps/mobile` has 6 failing tests,
        all in `src/screens/trips/__tests__/TripScheduleScreen.test.tsx` — a pre-existing failure
        in a file this change never touched (unrelated to any navigation-redesign work also
        in-flight on this branch); confirmed via `git status` that no file in this change's diff
        touches `apps/mobile` at all. `npm run typecheck` is clean across all three workspaces.
        Overall exit code is non-zero solely due to this pre-existing, out-of-scope mobile failure.

## Task Dependency Graph

Tasks within a wave can proceed in parallel; each wave depends only on earlier waves.

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "2.1", "2.2"] },
    { "wave": 2, "tasks": ["3.1", "3.2", "3.3"] },
    { "wave": 3, "tasks": ["4.1"] },
    { "wave": 4, "tasks": ["5.1", "5.2", "5.3", "6.1", "6.2", "6.3", "6.4", "7.1", "7.1b", "7.2", "7.2b", "7.3", "7.4"] },
    { "wave": 5, "tasks": ["8.1"] },
    { "wave": 6, "tasks": ["9.1", "9.2", "9.3", "9.4"] },
    { "wave": 7, "tasks": ["10.1"] },
    { "wave": 8, "tasks": ["11.1", "11.2", "11.3", "11.4", "11.5", "11.6"] },
    { "wave": 9, "tasks": ["12.1", "12.2", "12.3", "12.4"] },
    { "wave": 10, "tasks": ["13.1"] },
    { "wave": 11, "tasks": ["14.1", "14.2"] },
    { "wave": 12, "tasks": ["14.3", "14.4", "14.5", "14.6", "14.7"] },
    { "wave": 13, "tasks": ["15.1"] },
    { "wave": 14, "tasks": ["16.1", "16.2"] },
    { "wave": 15, "tasks": ["17.1", "17.2", "17.3", "17.4"] },
    { "wave": 16, "tasks": ["18.1", "18.2", "18.3", "18.4"] },
    { "wave": 17, "tasks": ["19.1", "19.2", "19.3", "19.4"] },
    { "wave": 18, "tasks": ["20.1"] }
  ]
}
```

Wave 4 groups the CLI (task 5), the pins fix (task 6), and the stats addition (task 7) together —
they depend only on the shared enum/schema and migration/repo (waves 1-3) and are otherwise
independent of one another (disjoint files). Wave 5 was the final gate for the backend-only
change. Wave 6 (task 9) is the mobile display work, added after the fact once it became clear the
backend `festivals` field had no UI consumer — it depends only on task 7's field already existing
on `StatsResponse`. Wave 7 is the final gate for this additive follow-up. Wave 8 (task 11) is the
catalog DTO/filter follow-up, added after a user asked whether the catalog could be searched by
festival — it depends only on task 2's `experience_festival_tags` table (waves 1-3) and is
otherwise independent of tasks 5-10. Wave 9 (task 12) is the mobile Festival-chip follow-up; it
depends on task 11's `festivalTag` field existing on the real `ExperienceDTO`. Wave 10 is the
final gate for this additive follow-up. Wave 11 (task 14.1-14.2) is the new pure menu-keyword
matcher and its tests, depending only on the existing `FestivalTagRepo`/shared types. Wave 12
(14.3-14.7) wires that matcher into discovery and the CLI's pre-discovery refresh step. Wave 13 is
the final gate for this additive discovery follow-up. Wave 14 (task 16) is the migration adding
`match_kind`, `festival_editions`, and `food_item_festival_tags` — it depends on task 14's
`'menu'`-matched tags already existing so the backfill has real data to classify, but is otherwise
independent of waves 15-17. Wave 15 (task 17) is the new pure `qualifyingVisit`/
`festivalMatchingItemNames` cores and their property tests, depending only on the migration
existing (for the types) — no I/O. Wave 16 (task 18) wires those cores into `FestivalTagRepo` and
the CLI's write path. Wave 17 (task 19) is the read-side cutover: Pin_Service and Stats_Service
both switch to the Qualifying_Visit computation, which can only happen once task 18 can actually
produce `match_kind`/dish tags/editions to read. Wave 18 is the final gate for this qualifying-visit
correctness follow-up.
