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
    { "wave": 7, "tasks": ["10.1"] }
  ]
}
```

Wave 4 groups the CLI (task 5), the pins fix (task 6), and the stats addition (task 7) together —
they depend only on the shared enum/schema and migration/repo (waves 1-3) and are otherwise
independent of one another (disjoint files). Wave 5 was the final gate for the backend-only
change. Wave 6 (task 9) is the mobile display work, added after the fact once it became clear the
backend `festivals` field had no UI consumer — it depends only on task 7's field already existing
on `StatsResponse`. Wave 7 is the final gate for this additive follow-up.
