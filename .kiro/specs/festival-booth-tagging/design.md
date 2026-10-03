# Design Document

## Overview

Disney's Sync Gateway feed carries no field identifying which festival a Festival_Booth belongs
to (verified against `facilityDoc.ts`'s `AncestorRef`/`ANCESTOR_FIELD_MAP` and the
`resolveArea`/`resolveLand` walkers — neither models nor would surface an Event-typed ancestor).
Only one festival's booths are ever active in EPCOT at a time, so the currently-active set of
`Festival Kiosk`-faceted booths **is** "this festival's booths" with no further disambiguation
needed. This feature adds:

1. A new, Catalog_Sync-untouched table, `experience_festival_tags`, recording which Festival and
   Festival_Year a tagged experience belonged to.
2. An interactive local CLI (`tag-festival-booth`) that discovers the active kiosk set, prompts
   for the festival (from a closed enum) and year, and writes tags after confirmation.
3. A one-line fix to the pin-collection `festivalBooths` metric so it joins through the tag table
   instead of relying solely on `active = TRUE`.
4. A new additive `festivals` field on the existing `GET /me/stats` response: a lifetime count and
   a per-festival breakdown, both plain counts (no denominator).

## Architecture

```
                    npm run tag-festival-booth
                                │
                                ▼
                 ┌───────────────────────────────┐
                 │   Tagging_CLI (local script)   │
                 │  1. prompt festival (enum)     │
                 │  2. prompt/read year           │
                 │  3. discover active kiosks     │
                 │  4. print + confirm             │
                 │  5. upsert festival tags        │
                 └───────────────┬───────────────┘
                                 │  INSERT ... ON CONFLICT
                                 ▼
                 ┌───────────────────────────────┐
                 │  experience_festival_tags      │◄──── never written by Catalog_Sync
                 │  (experience_id, slug, year)   │
                 └───────────────┬───────────────┘
                                 │  read (join, not filtered by active)
                    ┌────────────┴─────────────┐
                    ▼                          ▼
        Pin_Service festivalBooths      Stats_Service festivals{}
        metric (evaluator.ts / repo.ts)  (stats/repo.ts, additive field)
```

The tag table sits beside `experiences`, never inside it — this is the load-bearing design
decision. Catalog_Sync's `applyReconciliation` upsert (`apps/api/src/services/catalog/repo.ts`)
fully overwrites every column it writes on each sync; a tag stored as an `experiences` column
would need to be excluded from that upsert's column list forever, which is a much easier
invariant to break by a future edit than "this is simply a different table Catalog_Sync's code
never imports."

## Components and Interfaces

### `apps/api/migrations/00XX_experience_festival_tags.sql` (new)

Creates `experience_festival_tags`. See Data Models below.

### `packages/shared/src/enums.ts` (amended)

Adds `FESTIVAL_SLUGS` / `FestivalSlug`, mirroring the existing `PARKS` / `Park` and
`PIN_COUNT_METRICS` / `PinCountMetric` pattern (a `readonly [...] as const` tuple + a derived
type).

### `packages/shared/src/schemas/` (amended)

Adds `festivalSlugSchema = z.enum(FESTIVAL_SLUGS)`, exported alongside the existing
`pinCountMetricSchema` for the same reason: one runtime-validated closed set, reused by the CLI's
own input validation and (later) any route that accepts a festival value.

### `apps/api/src/services/catalog/festivalTags/` (new small module — not a "service" in the
`composeServices.ts` sense; a repo used only by the CLI script and read by `pins`/`stats`)

- `repo.ts`: `FestivalTagRepo` — `listActiveFestivalBooths()`, `getExistingTagsForYear(year)`,
  `upsertTags(entries, { force })`, and the two read helpers `pins`/`stats` consume:
  `festivalBoothIdsEverTagged(): Promise<Set<string>>` style reads live directly in
  `pins/repo.ts` and `stats/repo.ts` respectively (see below) rather than through this repo, to
  avoid adding a cross-service dependency for a two-column join; this module owns only the
  write-side (CLI) operations and the shape of a `FestivalTagRow`.

### `apps/api/src/scripts/tagFestivalBooth.ts` (new)

The interactive CLI (Requirement 3). Mirrors `backfillFacetEnrichment.ts`'s shape: a `main()` that
opens the pool, does its work, and closes it; uses Node's built-in `node:readline/promises` for
the two prompts (festival choice, confirmation) — no new dependency, since this is a ≤5-item menu
and a y/n confirm, not a rich TUI.

### `apps/api/src/services/pins/evaluator.ts` / `repo.ts` (amended)

`isFestivalBooth`'s role narrows to "identify a currently-active kiosk for CLI discovery and for
the pre-tag grace window (Requirement 4.2)". The `festivalBooths` metric itself is recomputed from
a new snapshot field, `festivalTaggedIds: ReadonlySet<string>` (the User's completed upstream ids
that carry *any* Festival_Tag), unioned with the existing active-kiosk completion count. See Data
Models / metric change below.

### `apps/api/src/services/stats/` (amended)

A new pure roll-up (mirroring `resorts.ts`'s pattern from `stats-experience-redesign`) computing
`FestivalStatsDTO` from a new raw read, added to the existing single stats snapshot transaction
exactly as `byResort` was added — no new endpoint, no new transaction.

## Data Models

### Migration `00XX_experience_festival_tags.sql`

(The exact number is the next sequential migration id at implementation time — `0039` as of this
writing, following `0038_pin_showcase_share_kind.sql`; the implementer MUST confirm the actual
latest number in `apps/api/migrations/` before creating the file, per the existing pin-collection
task convention.)

```sql
BEGIN;

-- Festival_Tag (design.md "Festival Booth Tagging"). Deliberately NOT a column on
-- `experiences`: Catalog_Sync's applyReconciliation fully overwrites every column
-- it writes on each sync run, so any festival association stored on the
-- experiences row itself would be silently erased the next time that booth's
-- document is (re)synced. This table is never referenced by any Catalog_Sync
-- code path — it is written only by the `tag-festival-booth` CLI and read only
-- by the Pin_Service and Stats_Service.
CREATE TABLE IF NOT EXISTS experience_festival_tags (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    experience_id  UUID         NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    festival_slug  TEXT         NOT NULL,
    festival_year  INTEGER      NOT NULL,
    tagged_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT experience_festival_tags_unique UNIQUE (experience_id, festival_year),
    CONSTRAINT experience_festival_tags_year_chk
        CHECK (festival_year BETWEEN 2015 AND 2100)
);

-- Read: "every tag for this experience" (pin/stats joins) and "every tag for this
-- year" (CLI conflict detection).
CREATE INDEX IF NOT EXISTS experience_festival_tags_experience_idx
    ON experience_festival_tags (experience_id);
CREATE INDEX IF NOT EXISTS experience_festival_tags_year_idx
    ON experience_festival_tags (festival_year);

COMMIT;
```

Design notes:

- `ON DELETE CASCADE` on `experience_id`: `experiences` rows are soft-deleted (`active = FALSE`),
  never hard-deleted, so this cascade is a defensive default matching every other FK to
  `experiences` in this schema (e.g. `completions.experience_id` has none — intentionally, per
  R2.5 of this spec's Requirement 2 — actually correcting this: `completions.experience_id` has
  **no** cascade either, verified in `0001_init.sql`; `experience_festival_tags`'s cascade is safe
  regardless since a genuine hard delete of an experience never happens in this codebase's write
  paths).
- `festival_slug` is `TEXT`, not a DB `CHECK ... IN (...)` enum: the closed set lives in
  `@dwt/shared`'s `FESTIVAL_SLUGS` (Requirement 1.3 — extensible by a code change, not a
  migration), matching how `sync_run_outcome` and other closed-but-evolving sets are validated at
  the application layer rather than the database layer elsewhere in this schema. The CLI is the
  only writer and validates against the enum before ever issuing SQL.
- `UNIQUE (experience_id, festival_year)` is what backs both the "one tag per booth per year"
  rule (Requirement 2.3) and the CLI's idempotent upsert (Requirement 3.6) — a second run for the
  same booth/year either no-ops (identical festival) or is blocked pending `--force` (different
  festival), per the repo method below.

### `packages/shared/src/enums.ts` addition

```typescript
// ---------------------------------------------------------------------------
// Festival_Slug
// ---------------------------------------------------------------------------
//
// The closed set of EPCOT festivals a Festival_Booth (a Restaurant experience
// carrying the `Festival Kiosk` quickService facet) can be tagged with
// (festival-booth-tagging R1). Extending this list is a one-line code change,
// never a migration — the persisted `experience_festival_tags.festival_slug`
// column is plain TEXT validated against this enum at the application layer.

export const FESTIVAL_SLUGS = [
  'food-and-wine',
  'flower-and-garden',
  'festival-of-the-arts',
  'festival-of-the-holidays',
] as const;

export type FestivalSlug = (typeof FESTIVAL_SLUGS)[number];

/** Display label for the Tagging_CLI's menu and any future stats/pin surface. */
export const FESTIVAL_SLUG_LABELS: { readonly [K in FestivalSlug]: string } = {
  'food-and-wine': 'EPCOT International Food & Wine Festival',
  'flower-and-garden': 'EPCOT International Flower & Garden Festival',
  'festival-of-the-arts': 'EPCOT International Festival of the Arts',
  'festival-of-the-holidays': 'EPCOT International Festival of the Holidays',
};
```

### `FestivalTagRow` (`apps/api/src/services/catalog/festivalTags/repo.ts`)

```typescript
export interface FestivalTagRow {
  readonly experienceId: string;
  readonly festivalSlug: FestivalSlug;
  readonly festivalYear: number;
  readonly taggedAt: string;
}

export interface DiscoveredBooth {
  readonly experienceId: string;
  readonly name: string;
  readonly park: string | null;
  /** Existing tag for the target year under a DIFFERENT festival, if any (Requirement 3.5). */
  readonly conflictingTag: FestivalTagRow | null;
}

export interface FestivalTagRepo {
  /** Active, category=Restaurant, `Festival Kiosk`-faceted experiences (R3.3). */
  listActiveFestivalBooths(year: number, slug: FestivalSlug): Promise<DiscoveredBooth[]>;
  /**
   * Upsert one tag per (experienceId, year). Booths with a conflicting tag are
   * skipped unless `force` is true, in which case the existing row for that
   * year is overwritten. Returns the ids actually written (Requirement 3.4, 3.5, 3.6).
   */
  upsertTags(
    entries: readonly { experienceId: string; year: number; slug: FestivalSlug }[],
    opts: { force: boolean },
  ): Promise<string[]>;
}
```

`upsertTags` SQL shape (idempotent per Requirement 3.6):

```sql
INSERT INTO experience_festival_tags (experience_id, festival_slug, festival_year)
VALUES ($1, $2, $3)
ON CONFLICT (experience_id, festival_year) DO UPDATE
  SET festival_slug = EXCLUDED.festival_slug, tagged_at = now()
  WHERE $4::boolean  -- force
     OR experience_festival_tags.festival_slug = EXCLUDED.festival_slug
RETURNING experience_id;
```

The `WHERE` clause is what makes the conflict rule declarative rather than an application-level
read-then-write: without `force`, the `DO UPDATE` only actually fires (and is only counted as a
write) when the existing row's slug already matches — i.e. it's the "no-op re-run of the same
tag" case, not silently overwriting a different festival's tag. `RETURNING` reports exactly the
ids the CLI should print as "tagged" vs "skipped (conflict)".

### `PinActivitySnapshot` (`apps/api/src/services/pins/evaluator.ts`, amended)

```typescript
export interface PinActivitySnapshot {
  readonly catalog: readonly EvalExperience[];
  readonly completed: ReadonlySet<string>;
  readonly days: readonly DaySnapshot[];
  readonly friendRides: number;
  readonly ratings: number;
  readonly notes: number;
  readonly trips: number;
  /**
   * Upstream ids of every experience — active or not — that carries at least
   * one Festival_Tag (any slug, any year), restricted to those the User has
   * completed. Additive field; every other metric is unaffected
   * (festival-booth-tagging R4.1, R4.3).
   */
  readonly festivalTaggedCompletedIds: ReadonlySet<string>;
}
```

`metricValue`'s `festivalBooths` case changes from:

```typescript
case 'festivalBooths': return countCompleted(snap, isFestivalBooth);
```

to:

```typescript
case 'festivalBooths': {
  // Active, untagged kiosks still count via the existing active-catalog path
  // (R4.2 — tagging is additive, never a regression during the pre-tag
  // window); tagged completions count regardless of active (R4.1), via a
  // union so a booth is never double-counted if it is both currently active
  // AND tagged.
  const activeUntagged = countCompleted(
    snap,
    (e) => isFestivalBooth(e) && !snap.festivalTaggedCompletedIds.has(e.upstreamId),
  );
  return activeUntagged + snap.festivalTaggedCompletedIds.size;
}
```

This is a pure function change (Property 25 below covers it) — no I/O added to `evaluator.ts`.
The repo (`buildSnapshot` in `pins/repo.ts`) supplies `festivalTaggedCompletedIds` from one new
query:

```sql
SELECT DISTINCT c.experience_id AS id
  FROM completions c
  JOIN experience_festival_tags t ON t.experience_id = c.experience_id
 WHERE c.user_id = $1
```

joined against the same `upstream_entity_id` lookup the other snapshot reads already use (i.e.
this query returns `experiences.id`, which is then mapped to `upstream_entity_id` via a small join
or a second lookup against the already-fetched catalog map — implementer's choice, whichever
avoids a second round trip most cleanly given `buildSnapshot`'s existing `Promise.all` shape).
Note this read is **not** filtered by `experiences.active` — that omission is the entire point.

### `FestivalStatsDTO` (`packages/shared/src/dto/Stats.ts`, additive)

**Correction (verified against the real running code, superseding an earlier mistake in this
design):** `GET /me/stats`'s actual response type is **`StatsResponse`**, defined locally in
`apps/api/src/services/stats/routes.ts` (`{ coverage, ratings, activity, percentileRank?,
percentileUnavailable? }`) and independently mirrored in `apps/mobile/src/api/statsTypes.ts`.
`@dwt/shared`'s `StatsDTO` / `statsSchema` (in `dto/Stats.ts` / `schemas/Stats.ts`) is a **separate,
unused legacy type** — nothing in `apps/api` or `apps/mobile` imports it (verified by grep: zero
hits for `StatsDTO` or `statsSchema` outside `packages/shared` itself). An earlier draft of this
design incorrectly told the implementer to extend `StatsDTO`/`statsSchema`; **do not do that** —
extending it has no effect on the real `GET /me/stats` payload. If task 1 of this spec's tasks.md
already added `FestivalStatsDTO`/`festivalStatsSchema` there, the type and schema are still fine to
keep and reuse (see below), but `festivals` must ALSO be threaded into the two real response types,
per the corrected task 7 below.

```typescript
/**
 * Lifetime and per-festival festival-booth visit counts (festival-booth-tagging
 * R5). Plain counts, no denominator — the set of all festival booths that have
 * ever existed grows every festival rotation, so a percentage-of-catalog stat
 * here would be meaningless (R6).
 */
export interface FestivalStatsDTO {
  /** Distinct completed, festival-tagged experiences, all festivals, all years. */
  readonly lifetimeCount: number;
  /** Per-festival breakdown, summed across every tagged year. Zero-count festivals are omitted. */
  readonly byFestival: readonly { readonly slug: FestivalSlug; readonly count: number }[];
}
```

`FestivalStatsDTO` and `festivalStatsSchema` stay defined in `@dwt/shared` (both `apps/api` and
`apps/mobile` can import the TS type; only `apps/api` needs the Zod schema, for a route response
test) — that part of task 1 was correct. What was wrong is *where the field gets threaded*:

```typescript
// apps/api/src/services/stats/routes.ts — StatsResponse (the REAL response type)
export interface StatsResponse {
  readonly coverage: CoverageResponse;
  readonly ratings: RatingStatistics;
  readonly activity: ActivityStatistics;
  readonly festivals: FestivalStatsDTO; // NEW, additive, sibling of coverage/ratings/activity
  readonly percentileRank?: number;
  readonly percentileUnavailable?: boolean;
}
```

```typescript
// apps/mobile/src/api/statsTypes.ts — the mobile mirror (existing convention: mobile
// re-declares the identical shape rather than importing the backend module)
export interface StatsResponse {
  readonly coverage: CoverageResponse;
  readonly ratings: RatingStatistics;
  readonly festivals: FestivalStatsDTO; // NEW — import the TYPE from @dwt/shared here
  // ...existing fields unchanged
}
```

`@dwt/shared`'s unused `StatsDTO`/`statsSchema` and the `festivals` field already added to them
(task 1) are harmless to leave in place — they cost nothing and the schema test still validates
`FestivalStatsDTO`'s own shape correctly — but they are **not** what makes the feature work.
Nothing further needs to change there.

### Stats roll-up (`apps/api/src/services/stats/festivals.ts`, new — mirrors `resorts.ts`)

Raw read (added to the existing snapshot transaction, same pattern as `resortCoverage`, threaded
through `StatsSnapshotInput`/`StatsSnapshot` in `apps/api/src/services/stats/repo.ts` exactly as
`resortCoverage: readonly RawResortCoverageRow[]` was added there — a new field on `StatsSnapshot`,
populated inside `getStatsSnapshot`'s existing transaction, alongside the existing
`resortDenominators`/`resortNumerators` queries):

```sql
SELECT t.festival_slug AS slug, COUNT(DISTINCT c.experience_id)::bigint AS n
  FROM completions c
  JOIN experience_festival_tags t ON t.experience_id = c.experience_id
 WHERE c.user_id = $1
 GROUP BY t.festival_slug
```

plus one more scalar for the lifetime total (`COUNT(DISTINCT c.experience_id)` with no `GROUP BY`,
same join/predicate). Pure roll-up:

```typescript
export function rollUpFestivalStats(
  lifetimeCount: number,
  rows: readonly { slug: FestivalSlug; n: number | string }[],
): FestivalStatsDTO {
  return {
    lifetimeCount,
    byFestival: rows
      .map((r) => ({ slug: r.slug, count: Number(r.n) }))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug)),
  };
}
```

## Configuration & Constants

| Constant | Value | Purpose |
| --- | --- | --- |
| `FESTIVAL_SLUGS` | `['food-and-wine', 'flower-and-garden', 'festival-of-the-arts', 'festival-of-the-holidays']` | Closed festival enum (`@dwt/shared/enums.ts`). Extend by adding a slug + label here; no env var, no migration. |
| CLI script names | `tag-festival-booth` (local, `.env`), `tag-festival-booth:cloud` (hosted, `.env.dev`) | `apps/api/package.json` scripts, mirroring the existing `sync` / `sync:cloud` pairing. No new env vars — reuses the existing `DATABASE_URL` resolution already used by every other script in `apps/api/src/scripts/`. |
| `experience_festival_tags.festival_year` bound | `CHECK (festival_year BETWEEN 2015 AND 2100)` | Sanity bound only (Disney World's EPCOT festivals postdate 2015 in their current form); not a business rule, just guards against a fat-fingered year. |

No new external interface is introduced — this feature reads only from the already-persisted
`experiences` table (via the existing Catalog_Sync pipeline) and writes only to the new tag table
via a local script. There is no new HTTP endpoint (Requirement 3.7) and no new upstream API call.

## Error Handling

This feature adds no new HTTP route, so it adds no new `ErrorCode`. Failure modes are local-script
failures, handled the same way `backfillFacetEnrichment.ts` and `runSync.ts` handle them:

- **No active Festival_Kiosk booths found** (e.g. run between festivals, or the facet changed
  upstream): the CLI prints a clear "no active festival booths found" message and exits `0`
  without prompting for confirmation — not an error, just nothing to do.
- **A discovered booth conflicts with an existing different-festival tag for the target year**
  (Requirement 3.5): printed distinctly, excluded from the default write, and the CLI's overall
  exit code remains `0` (a conflict is an expected, informative outcome, not a script failure) —
  the operator re-runs with `--force` if they actually intend to retag it.
- **Database connection failure**: the script exits non-zero with the raw error, matching every
  other script in `apps/api/src/scripts/`.
- **`GET /me/stats`**: the existing `stats_unavailable` / `stats_timeout` error codes already
  cover a snapshot-transaction failure; the new `festivals` read participates in the same
  transaction and therefore the same failure/error path as every other dimension — no new error
  code needed.

## Correctness Properties

### Property 25: Festival Metric Union Correctness

*For any `PinActivitySnapshot`, the `festivalBooths` count equals the number of distinct completed
experiences that are either (a) currently an active `Festival Kiosk`-faceted booth not present in
`festivalTaggedCompletedIds`, or (b) present in `festivalTaggedCompletedIds` — and no experience
is counted twice even when both (a) and (b) hold for it simultaneously.*
**Validates: Requirements 4.1, 4.2, 4.3**

### Property 26: Tag Uniqueness Per Year

*For any sequence of `upsertTags` calls against the same `(experienceId, year)` pair, at most one
`experience_festival_tags` row exists for that pair at any time; a call with `force: false` whose
existing row's slug differs from the requested slug never changes that row; a call with
`force: true`, or whose existing row's slug already matches, updates it in place rather than
inserting a second row.*
**Validates: Requirements 2.3, 2.4, 3.5, 3.6**

### Property 27: Tag Survives Deactivation

*For any experience with at least one `experience_festival_tags` row, toggling that experience's
`active` column (in either direction, via the same `UPDATE experiences SET active = ...` shape
Catalog_Sync's soft-delete/reactivation uses) never inserts, updates, or deletes any
`experience_festival_tags` row for it.*
**Validates: Requirements 2.2, 2.5**

### Property 28: Festival Stats Are Counts, Never Percentages

*For any `FestivalStatsDTO`, no field or nested field expresses a ratio, percentage, or `total`/
`remaining`-style denominator; `lifetimeCount` and every `byFestival[].count` are non-negative
integers with no accompanying catalog-size figure.*
**Validates: Requirements 5.3, 6.1**

## Mobile Festival Stats Surface (additive, Requirement 7)

### Component

Added directly to `apps/mobile/src/screens/stats/ExperiencesDetailScreen.tsx`, in the existing
"TOP SECTION: Activity Overview" block, as a new section alongside (not replacing) the odometer
grid, Hall of Fame Podium, and Personal Records & Bests — mirroring their existing conditional-
render-when-present pattern rather than introducing a new screen or route:

```tsx
{/* Festival Booths */}
{festivals && festivals.lifetimeCount > 0 && (
  <View style={styles.festivalSection} testID="festival-section">
    <Text style={styles.sectionTitle}>Festival Booths</Text>
    <View style={styles.festivalLifetimeCard} testID="festival-lifetime">
      <Text style={styles.festivalLifetimeVal}>{festivals.lifetimeCount}</Text>
      <Text style={styles.festivalLifetimeLbl}>Festival Booths Visited (Lifetime)</Text>
    </View>
    {festivals.byFestival.map((f) => (
      <View key={f.slug} style={styles.festivalRow} testID={`festival-row-${f.slug}`}>
        <Text style={styles.festivalRowLabel}>{FESTIVAL_SLUG_LABELS[f.slug]}</Text>
        <Text style={styles.festivalRowCount}>{f.count}</Text>
      </View>
    ))}
  </View>
)}
{festivals && festivals.lifetimeCount === 0 && (
  <View style={styles.festivalEmptyCard} testID="festival-empty">
    <Text style={styles.festivalEmptyText}>
      No festival booths visited yet — check back during the next EPCOT festival!
    </Text>
  </View>
)}
```

`festivals` is read from the same `statsQuery.data` (`StatsResponse`) the screen already fetches
via `['me-stats', { percentile: true }]` — no new query, no new endpoint call (R7.4). Since
`festivals` is a non-optional field on `StatsResponse` (per Requirement 5.4's design), the `&&
festivals` guard above is only for the loading-state case where `statsQuery.data` itself is
undefined, matching the existing `hasActivity`/`odo` guard pattern already in this file.

`FESTIVAL_SLUG_LABELS` is imported from `@dwt/shared` (R7.2) — the same source used by the CLI's
menu, so a slug's display label can never drift between the two surfaces.

No percentage or denominator is rendered anywhere in this section (R7.5) — only
`lifetimeCount` and each `byFestival[].count`, matching `FestivalStatsDTO`'s own shape (Property
28), so there is nothing to accidentally compute or display beyond what the DTO already carries.

### Empty state (R7.3)

Mirrors the existing Personal Records section's convention of a conditional render (`{records &&
<View>...}` vs. rendering nothing) but explicitly renders a compact, worded empty state instead of
disappearing entirely — because unlike Personal Records (which is genuinely optional/absent data),
`festivals` is always present on the response (an empty `{ lifetimeCount: 0, byFestival: [] }` is
a valid, common state — e.g. before any festival has ever been tagged, or before the User has
completed any tagged booth), so silently rendering nothing would look like a bug rather than a
"nothing here yet" state.

## Testing Strategy

- **Migration test** (`apps/api/src/db/__tests__/migrationNNNN.test.ts`, pg-mem): asserts the
  table, the `(experience_id, festival_year)` unique constraint, the year `CHECK`, and the
  cascade, mirroring `migration0035.test.ts`'s style.
- **`FestivalTagRepo` integration tests** (`apps/api/src/services/catalog/festivalTags/__tests__/
  repo.integration.test.ts`, real Postgres per this repo's existing integration-test convention
  for catalog-adjacent repos): `upsertTags` idempotency (Property 26) re-running the same
  festival/year twice; a same-year different-festival conflict is excluded without `force` and
  applied with `force`; `listActiveFestivalBooths` returns only `active = TRUE` +
  `category = 'Restaurant'` + `Festival Kiosk`-faceted rows and correctly flags
  `conflictingTag`.
- **Property test** (`apps/api/src/services/catalog/festivalTags/__tests__/repo.prop.test.ts`,
  `fast-check`, ≥100 runs, tagged `Feature: festival-booth-tagging, Property 26`): arbitrary
  sequences of `upsertTags` calls over a small set of experience ids/years/slugs/force-flags,
  asserting Property 26's invariant against a pg-mem-backed model.
- **CLI test**: `tagFestivalBooth.ts`'s prompt/discovery/print logic is factored into pure
  functions (`buildPrompt`, `formatDiscoveryReport`) that are unit-tested directly; the `main()`
  wiring (readline + pool) is intentionally thin and untested end-to-end, matching
  `backfillFacetEnrichment.ts` (which likewise has no automated test of its `main()`), but the
  underlying `FestivalTagRepo` it calls is fully covered by the integration tests above.
- **Evaluator property test** (`apps/api/src/services/pins/__tests__/evaluator.prop.test.ts`,
  extended, `fast-check`, ≥100 runs, tagged `Feature: festival-booth-tagging, Property 25`):
  arbitrary snapshots with overlapping active-kiosk and tagged-id sets, asserting the union-count
  invariant and no double-counting.
- **`buildSnapshot` integration test** (`apps/api/src/services/pins/__tests__/
  repo.integration.test.ts`, extended): a completed, since-deactivated, tagged booth still counts
  toward `festivalBooths`; an active, untagged booth still counts (pre-tag grace window); a
  completed, deactivated, **untagged** booth does NOT count (this is the existing, unchanged,
  documented gap the spec deliberately leaves in place — only tagged history is retained).
- **Stats roll-up unit + property tests** (`apps/api/src/services/stats/__tests__/
  festivals.test.ts` / `.prop.test.ts`): `rollUpFestivalStats` sorts deterministically, omits
  zero-count festivals, and Property 28's no-percentage invariant (asserted structurally: the
  returned type has no `percent`/`total`/`remaining` field, checked via a runtime key-set
  assertion against the Zod schema, not just the TS type).
- **Route test** (`apps/api/src/services/stats/__tests__/routes.test.ts`, extended,
  `server.inject`): `GET /me/stats` response includes a `festivals` field with the expected shape
  for a seeded user with tagged completions, and an empty-but-present `festivals` for a user with
  none.
- **Mobile component test** (`apps/mobile/src/screens/stats/__tests__/ExperiencesDetailScreen.test.tsx`,
  extended, `@testing-library/react-native`, mocking only the network/query layer): seed the shared
  `['me-stats', { percentile: true }]` query response with a non-empty `festivals` and assert the
  lifetime count and each `byFestival` row render with the correct display label (via
  `FESTIVAL_SLUG_LABELS`, not the raw slug) and count; seed a `{ lifetimeCount: 0, byFestival: [] }`
  response and assert the empty-state copy renders instead of the count section; assert no network
  request beyond the existing single `GET /me/stats?percentile=true` fires (R7.4) by asserting the
  mock's call count is unchanged from the pre-existing test baseline.
- **Shared schema test** (`packages/shared/src/schemas/__tests__/enums.test.ts` or the nearest
  existing enum test file, extended): `festivalSlugSchema` accepts every `FESTIVAL_SLUGS` member
  and rejects an arbitrary string. `packages/shared/src/schemas/Stats.ts`'s `statsSchema` is
  `.strict()`, so it MUST gain a `festivals: festivalStatsSchema` field (a new schema validating
  `lifetimeCount: z.number().int().min(0)` and `byFestival: z.array(z.object({ slug:
  festivalSlugSchema, count: z.number().int().min(1) }).strict())` — `count` is `min(1)` since
  Property 28/R5.5 already filters zero-count festivals out before this shape is constructed) or
  every existing fixture that builds a `StatsDTO` for a schema test will start failing strict-mode
  parsing the moment the TS type gains the field. Update `Stats.ts`'s schema test fixtures
  accordingly.

## Catalog Festival Filtering (additive, Requirement 8)

### Overview

`experience_festival_tags` (Requirement 2) was, until now, read only by the Pin_Service and
Stats_Service — never surfaced on the `ExperienceDTO` or `GET /catalog`, so no catalog browse/
filter surface could use it. This amendment:

1. Adds a `festivalTag: { slug: FestivalSlug; year: number } | null` field to `ExperienceDTO`,
   populated via a `LEFT JOIN` against `experience_festival_tags` picking the row with the highest
   `festival_year` per experience (an experience with tags for multiple years surfaces only its
   most recent).
2. Adds `festivalSlug` / `festivalYear` query parameters to `GET /catalog`, mirroring the existing
   `land` / `worldShowcaseCountry` exact-match filter pattern.
3. Adds a Festival filter chip dimension to `DestinationScreen`'s existing Filters modal
   (Lands/Price/Attributes → now also Festival), reusing the established chip/multi-select
   plumbing (`FilterChipItem`, `selectedTags`-style set) rather than inventing a new one.

This does not touch the Festival_Tag persistence model, the Tagging_CLI, the Pin_Service
`festivalBooths` fix, or the Stats_Service counts (Requirements 1-7) — it only reads the same
table through a new, additive projection.

### Data Models

#### `ExperienceDTO` addition (`packages/shared/src/dto/Experience.ts`)

```typescript
/**
 * The EPCOT festival this Experience is tagged with, present only when at
 * least one `experience_festival_tags` row exists for it (R8.1). When an
 * Experience carries tags for more than one Festival_Year, this reflects the
 * highest (most recent) year's tag only (R8.1). `null`/absent when untagged
 * (R8.2). Independent of the Experience's `active` state — a since-deactivated,
 * tagged booth still carries this field.
 */
readonly festivalTag?: { readonly slug: FestivalSlug; readonly year: number } | null;
```

`experienceSchema` (`packages/shared/src/schemas/Experience.ts`) gains the matching optional/
nullable field:

```typescript
festivalTag: z
  .object({ slug: festivalSlugSchema, year: z.number().int() })
  .strict()
  .nullable()
  .optional(),
```

#### `CatalogRepo.listActiveExperiences` / `getExperience` (`apps/api/src/services/catalog/repo.ts`)

Both read queries gain a two-step `LEFT JOIN`: first to a per-`experience_id` `MAX(festival_year)`
aggregate, then a self-join back onto `experience_festival_tags` on that max year, which resolves
to exactly the one highest-year tag row per experience:

```sql
LEFT JOIN (
  SELECT experience_id, MAX(festival_year) AS max_year
    FROM experience_festival_tags
   GROUP BY experience_id
) fy ON fy.experience_id = e.id
LEFT JOIN experience_festival_tags ft
  ON ft.experience_id = e.id AND ft.festival_year = fy.max_year
```

selecting `ft.festival_slug, ft.festival_year` alongside the existing columns. `rowToDto` attaches
`festivalTag: { slug: row.festival_slug, year: row.festival_year }` only when `row.festival_slug
!== null`, mirroring every other "present only when persisted" field's `...(cond ? {...} : {})`
spread convention already used throughout `rowToDto`.

**Why a `MAX` + self-join instead of `DISTINCT ON`:** `DISTINCT ON (experience_id) ... ORDER BY
experience_id, festival_year DESC` is the idiomatic Postgres way to express "the one highest-year
row per group" and works correctly standalone — but verified against this project's `pg-mem` test
harness, wrapping that `DISTINCT ON` query as a `LEFT JOIN`'s derived subquery silently returns
**every** row (not just the per-group max) once joined back against the outer table, even though
the same `DISTINCT ON` query run on its own returns the correct single row per group. This appears
to be a `pg-mem`-specific join-planning defect around `DISTINCT ON` subqueries rather than a real
Postgres behavior (not reproduced against a real Postgres instance, but this project's integration
tests run exclusively against `pg-mem`, so the subquery shape must work there). The `MAX`+self-join
form produces the identical result set and was confirmed correct both standalone and inside the
join against `pg-mem`.

#### `CatalogListFilters` (`apps/api/src/services/catalog/repo.ts`, `apps/api/src/services/catalog/routes.ts`)

```typescript
/**
 * Exact match on a tagged Festival (R8.4). Combines conjunctively with every
 * other filter. When present without `festivalYear`, matches any tagged year.
 */
readonly festivalSlug?: FestivalSlug;
/**
 * Exact match on a tagged Festival_Year, usable only alongside `festivalSlug`
 * (R8.5, R8.6).
 */
readonly festivalYear?: number;
```

SQL (added to `listActiveExperiences`'s existing `where`/`params` accumulation, after the
`resortId` filter):

```typescript
if (filters.festivalSlug !== undefined) {
  params.push(filters.festivalSlug);
  const slugParamIdx = params.length;
  let subquery = `SELECT t.experience_id FROM experience_festival_tags t
                    WHERE t.festival_slug = $${slugParamIdx}`;
  if (filters.festivalYear !== undefined) {
    params.push(filters.festivalYear);
    subquery += ` AND t.festival_year = $${params.length}`;
  }
  where.push(`e.id IN (${subquery})`);
}
```

An `IN`-subquery (rather than reusing the `DISTINCT ON` join above, or a correlated `EXISTS`) is
used for filtering because the filter must match *any* tagged year carrying the requested slug,
not only the highest year the DTO projection surfaces — a booth tagged `food-and-wine` 2025 and
`flower-and-garden` 2026 must still match `festivalSlug=food-and-wine` even though its DTO
`festivalTag` would show the 2026 tag. **Correlated `EXISTS` subqueries are not supported by this
project's `pg-mem` test harness** (verified: `pg-mem` cannot resolve the outer query's table alias
inside a correlated subquery's `WHERE`, regardless of whether the outer table is aliased) — an
uncorrelated `IN`-subquery is used instead, which `pg-mem` does support and which is semantically
identical here since the subquery needs no reference to the outer row.

#### `GET /catalog` query schema (`apps/api/src/services/catalog/routes.ts`)

```typescript
festivalSlug: festivalSlugSchema.optional(),
festivalYear: z.coerce.number().int().min(2015).max(2100).optional(),
```

added to `catalogQuerySchema`, with a `.refine` (or a post-parse check in `parseListQuery`,
matching the existing `q`-trimming post-parse style) rejecting `festivalYear` without
`festivalSlug` (R8.6) as `validation_failed` naming `festivalYear`.

### Component: `DestinationScreen` Festival filter chips (R8.9-R8.12)

`ThemeOrWaterParkLayout` (`apps/mobile/src/screens/catalog/DestinationScreen.tsx`) already derives
Land/Price/Attribute chips via `deriveFilterChips` and multi-filters via `filterExperiencesMulti`
(both in `experiencePickerFilters.ts`). This amendment extends that same pure module rather than
adding a parallel one:

- `deriveFilterChips` gains a `festivalChips: readonly FilterChipItem[]` return field (kind:
  `'festival'`), derived by scanning the input Experiences' `festivalTag?.slug`, deduped by slug,
  labeled via `FESTIVAL_SLUG_LABELS[slug]` (never the raw slug, R8.9), and included in `allChips`.
- `filterExperiencesMulti` gains a third `ReadonlySet<string>` parameter, `selectedFestivals`,
  OR-matched against `exp.festivalTag?.slug` exactly like the existing `selectedLands`/
  `selectedTags` OR-within/AND-across composition (R8.10). Call sites (`DestinationScreen`,
  `ExperiencePicker`) pass an empty set when they do not render the Festival section, so this is
  purely additive to every existing caller's behavior.
- `DestinationScreen`'s Filters modal gains a "FESTIVALS" section identical in structure to the
  existing LANDS/PRICE RANGE/ATTRIBUTES sections, rendered only when `festivalChips.length > 0`
  (R8.11 — a `FestivalSlug` with zero currently-loaded tagged Experiences never produces a chip,
  since `deriveFilterChips` only emits chips for slugs it actually observed).
- No percentage/denominator is rendered on the Festival chip or section (R8.12) — only the
  `FESTIVAL_SLUG_LABELS` display label, matching the existing chip presentation with no count
  suffix (consistent with how Land/Attribute chips render today).

### Error Handling

- `festivalSlug` with an invalid (non-enum) value fails `festivalSlugSchema` and surfaces as the
  existing `validation_failed` 400 (R8.4), identical to every other enum-validated catalog filter.
- `festivalYear` without `festivalSlug` is rejected as `validation_failed` naming `festivalYear`
  (R8.6) — no new `ErrorCode` is introduced.
- A `festivalSlug` matching no active Experience returns an empty list in a 200, exactly like the
  existing `land`/`categories` "no match" behavior (R8.8) — not an error.

### Correctness Properties

### Property 29: Festival Tag Projection Reflects the Highest Tagged Year

*For any Experience with one or more `experience_festival_tags` rows, the Experience DTO's
`festivalTag` equals the `(slug, year)` of the row with the greatest `festival_year`; for an
Experience with no such rows, `festivalTag` is `null`/absent. Independently, a `GET /catalog`
request filtered by `festivalSlug` (optionally `festivalYear`) returns exactly the active
Experiences carrying at least one tag row matching that slug (and year, when supplied) —
regardless of whether that matching row is the one the DTO projection would surface.*
**Validates: Requirements 8.1, 8.2, 8.4, 8.5, 8.7, 8.8**

### Testing Strategy (additive)

- **Repo integration test** (`apps/api/src/services/catalog/__tests__/repo.festivalFilter.test.ts`,
  pg-mem, mirroring `repo.categories.test.ts`'s harness): an Experience with no tag yields
  `festivalTag: undefined`; an Experience tagged for one year yields that `(slug, year)`; an
  Experience tagged for two years surfaces only the higher year via the DTO while
  `festivalSlug=<the lower year's slug>` still matches it via the `EXISTS` filter (Property 29);
  `festivalSlug` combined with `park`/`category` is conjunctive; `festivalYear` without
  `festivalSlug` is rejected at the route layer.
- **Route test** (`apps/api/src/services/catalog/__tests__/routes.test.ts`, extended): `GET
  /catalog?festivalSlug=food-and-wine` forwards `{ festivalSlug: 'food-and-wine' }` to
  `listActiveExperiences`; `festivalYear` alone (no `festivalSlug`) is a 400 `validation_failed`
  naming `festivalYear`; an invalid `festivalSlug` value is a 400 `validation_failed`.
- **Shared schema test** (`packages/shared/src/schemas/__tests__/Experience.test.ts`, extended):
  `experienceSchema` accepts a valid `festivalTag`, accepts an absent/`null` `festivalTag`, and
  rejects a `festivalTag` with an invalid slug or a non-integer year.
- **Pure filter unit/property tests** (`apps/mobile/src/screens/trips/__tests__/
  experiencePickerFilters.prop.test.ts`, extended): `deriveFilterChips`'s new `festivalChips` are
  deduped by slug, labeled via `FESTIVAL_SLUG_LABELS`, and never emitted for a slug absent from the
  input set; `filterExperiencesMulti`'s new `selectedFestivals` parameter composes OR-within/
  AND-across exactly like `selectedLands`/`selectedTags`, and is backward-compatible (an empty set
  changes nothing) for every existing call site.
- **Mobile component test** (`apps/mobile/src/screens/catalog/__tests__/
  DestinationScreen.layouts.test.tsx`, extended): seeding Experiences with distinct
  `festivalTag.slug` values renders a Festival filter chip per distinct slug using its display
  label; selecting a Festival chip narrows the visible rows to that festival while preserving Land
  grouping; a `FestivalSlug` with no loaded Experiences produces no chip.

## Menu-Based Festival_Booth Discovery (additive, Requirement 3.8-3.10)

### Overview

The `Festival Kiosk` `quickService` facet (R3.3) is a reliable signal for the temporary
"Marketplace - X" structures, but several **permanent** restaurants also carry genuine
festival-specific menu items without that facet — verified against this app's own persisted menu
cache for Tangierine Cafe: Flavors of the Medina, Marketplace - Hawai'i, Swirled Showcase, La
Poutinerie, Regal Eagle Smokehouse, and Block & Hans, each of which has a cached
`experience_menus.menus[].groups[].name` containing a Food & Wine Festival-labeled group despite
being faceted as an ordinary `Quick Service Kiosk` / `Quick Service Restaurant` / no `quickService`
facet at all. Disney is inconsistent in how it writes that group name:

- `"Food & Wine Festival Food Offerings"` (ampersand, plural)
- `"Food and Wine Festival Beverage Offering"` (spelled "and", singular)
- `"Food & Wine Festival Alcoholic Beverage Offerings"`

A false-positive risk was also found and must be guarded against: `Funnel Cake`'s cached menu
carries a `"Flower & Garden Festival Food Offerings"` group — a different festival's keyword. A
menu-keyword match for one festival must never fire on a different festival's menu group name.

### Pure core: `menuMatchesFestival`

New pure function in `apps/api/src/services/catalog/festivalTags/menuMatch.ts`:

```typescript
import type { FestivalSlug } from '@dwt/shared';
import type { MenuDTO } from '@dwt/shared';

/**
 * Per-festival keyword used to recognize a menu group as belonging to that
 * festival, tolerant of Disney's "&" vs "and" and singular/plural "Offering(s)"
 * variants. Each pattern requires the festival's own distinguishing word(s)
 * immediately followed by "Festival" so a different festival's menu group
 * (e.g. "Flower & Garden Festival...") never matches another festival's
 * pattern (Requirement 3.9).
 */
const FESTIVAL_MENU_KEYWORDS: Record<FestivalSlug, RegExp> = {
  'food-and-wine': /food\s*(?:&|and)\s*wine\s+festival/i,
  'flower-and-garden': /flower\s*(?:&|and)\s*garden\s+festival/i,
  'festival-of-the-arts': /festival\s+of\s+the\s+arts/i,
  'festival-of-the-holidays': /festival\s+of\s+the\s+holidays/i,
};

/**
 * Whether any group across any of the supplied menus has a name matching the
 * given Festival's keyword pattern (R3.8). Pure and total; an empty/absent
 * `menus` array never matches (R3.10 is irrelevant here — this function does
 * not fetch anything, it only inspects already-persisted menus).
 */
export function menuMatchesFestival(
  menus: readonly MenuDTO[],
  slug: FestivalSlug,
): boolean {
  const pattern = FESTIVAL_MENU_KEYWORDS[slug];
  return menus.some((menu) =>
    menu.groups.some((group) => pattern.test(group.name)),
  );
}
```

### `FestivalTagRepo.listActiveFestivalBooths` (amended)

`listActiveFestivalBooths` reads every active Restaurant's `grouped_facets` AND its persisted
`experience_menus.menus` in one additional `LEFT JOIN`, and a Restaurant is a discovered
Festival_Booth candidate when `hasFestivalKioskFacet(groupedFacets)` **OR**
`menuMatchesFestival(menus, slug)` — a straightforward `||` of the existing facet predicate and the
new pure menu-keyword predicate:

```sql
SELECT e.id, e.name, e.park, e.grouped_facets, m.menus
  FROM experiences e
  LEFT JOIN experience_menus m ON m.experience_id = e.id
 WHERE e.active = TRUE AND e.category = 'Restaurant'
 ORDER BY e.name ASC
```

```typescript
const festivalBooths = expRes.rows.filter(
  (row) =>
    hasFestivalKioskFacet(row.grouped_facets) ||
    menuMatchesFestival(row.menus ?? [], slug),
);
```

Note `slug` (the festival currently being tagged) is now threaded into the discovery filter itself,
not just the conflict-check that already consumed it — the menu-keyword predicate is
festival-specific by construction (R3.9), so discovery for `food-and-wine` never includes a
Restaurant whose only matching menu group is `flower-and-garden`-keyworded.

### CLI: pre-discovery menu refresh (R3.10)

`runTaggingCli` gains a step between festival/year selection and discovery: it force-refreshes
every active, **EPCOT** Restaurant's menu through the existing `MenuRetrieval.getMenuForRestaurant`
seam (restaurant-menu-display's demand-driven retrieval, already used by `menuRefreshJob.ts`)
before calling `listActiveFestivalBooths`, so a stale pre-festival cache (verified: this app's own
`Refreshment Outpost` row was cached in July, before this festival's menu rotated in) cannot hide a
genuine menu-keyword match. This reuses the SAME freshness decision
(`decideMenuFetch`/`freshnessMs`) the read path already applies — it is not a second freshness
policy, just an eager trigger of the existing one for every EPCOT Restaurant up front instead of
waiting for each one's detail view to be opened.

**Scoped to EPCOT, not the full catalog.** An initial implementation refreshed every active
Restaurant across all Parks (~450 rows) via `catalogRepo.listActiveExperiences({ category:
'Restaurant' })` — this measurably slowed the CLI, serializing ~450 rate-limited Disney requests
when fewer than 100 of them (EPCOT's own Restaurant count) could ever match. `listActiveExperiences`
is a correct general-purpose read, but it was the wrong port for this one call site: it has no
`park` filter, and no filter was threaded through, so it silently fetched the entire catalog.
`FestivalTagRepo` gains a sibling method, `listActiveEpcotRestaurantIds()`, mirroring
`listActiveFestivalBooths`'s own `park = 'EPCOT'` predicate, and the refresh step calls that instead
— consistent with the design's standing assumption that every Festival_Booth, temporary or
permanent-with-menu-overlay, is located in EPCOT (verified: 100% of this app's existing tagged rows
are `park = 'EPCOT'`).

```typescript
export interface TagFestivalBoothDeps {
  readonly repo: FestivalTagRepo;
  /** Restaurant ids to refresh before discovery (R3.10). */
  readonly listActiveRestaurantIds: () => Promise<readonly string[]>;
  readonly menuRetrieval: Pick<MenuRetrieval, 'getMenuForRestaurant'>;
}
```

`main()` wires `listActiveRestaurantIds` to `catalogRepo.listActiveExperiences({ category:
'Restaurant' })` and `menuRetrieval` to the same `createMenuRetrieval(...)` composition
`composeServices.ts` already builds (constructed locally in the script exactly as
`backfillFacetEnrichment.ts` builds its own one-off dependencies — no change to the running server's
composition root). The refresh pass reuses the same best-effort-per-restaurant error handling as
`menuRefreshJob.ts` (one restaurant's fetch failure never aborts the pass or the CLI run) and is
skippable via `--skip-menu-refresh` for fast iteration once an operator knows menus are already
fresh (e.g. re-running after a `--force` correction minutes later).

### Correctness Properties (additive)

### Property 30: Menu Keyword Match Is Festival-Specific

*For any set of menus and any two distinct `FestivalSlug` values `a` and `b`, if
`menuMatchesFestival(menus, a)` is `true` because of a specific group name, that same group name
does not cause `menuMatchesFestival(menus, b)` to be `true` — i.e. no group name matches more than
one Festival's keyword pattern.*
**Validates: Requirements 3.9**

### Property 31: Menu-Based Discovery Is a Pure Superset Addition

*For any discovery call, the set of booths returned by `listActiveFestivalBooths` is exactly the
union of the Restaurants matching the existing `Festival Kiosk` facet rule and the Restaurants
matching `menuMatchesFestival` for the selected slug — removing the menu-based signal (i.e.
considering only the facet rule) always yields a subset of the amended result, so this change is
strictly additive to discovery and never excludes a booth the facet rule alone would have found.*
**Validates: Requirements 3.8**

### Testing Strategy (additive)

- **Pure unit + property tests** (`apps/api/src/services/catalog/festivalTags/__tests__/
  menuMatch.test.ts` / `.prop.test.ts`): `menuMatchesFestival` matches each of Disney's observed
  naming variants ("Food & Wine Festival...", "Food and Wine Festival...", singular/plural
  "Offering(s)") for `food-and-wine`; a `flower-and-garden`-keyworded group never matches
  `food-and-wine` and vice versa (Property 30, `fast-check`, ≥100 runs); an empty/no-groups menu
  array never matches any slug.
- **Repo integration test** (`apps/api/src/services/catalog/festivalTags/__tests__/
  repo.menuDiscovery.integration.test.ts`, pg-mem): a Restaurant with no `Festival Kiosk` facet but
  a persisted menu carrying a `food-and-wine`-keyworded group is discovered when tagging
  `food-and-wine`; the same Restaurant is NOT discovered when tagging `flower-and-garden` even
  though its facets/menus are unchanged; a Restaurant whose only menu group matches a *different*
  festival's keyword is excluded; the existing facet-only discovery path (R3.3) is unaffected for a
  booth with no menu row at all (Property 31).
- **CLI test** (`apps/api/src/scripts/__tests__/tagFestivalBooth.test.ts`, extended): the
  pre-discovery refresh step calls `getMenuForRestaurant` for every active Restaurant id before
  `listActiveFestivalBooths`; a refresh failure for one restaurant does not abort the pass or
  prevent discovery from running; `--skip-menu-refresh` skips the refresh step entirely.

## Qualifying-Visit Correctness for Menu-Matched Restaurants (additive, Requirements 9-11)

### Overview

The menu-keyword discovery signal (R3.8) finds permanent restaurants, but a permanent restaurant
breaks two assumptions the original `experience_festival_tags` design relied on: (1) that the
tagged entity eventually deactivates, which is what made a tag's permanence safe (Property 27
only needed to survive deactivation, not expire on its own), and (2) that a `completions` row
unambiguously means "visited the festival" (true for a temporary booth that sells nothing else;
false for a restaurant whose festival items are a seasonal add-on to a normal menu). This
amendment adds a **Qualifying_Visit** computation — a boolean per `(User, tagged experience)` —
that both the Pin_Service and the Stats_Service read instead of the old plain
`completions JOIN experience_festival_tags`.

```
                      Tagging_CLI (amended)
                             │
             ┌───────────────┼────────────────────┐
             ▼                                     ▼
   experience_festival_tags              food_item_festival_tags  ◄── new, 'menu' Match_Kind only
   (+ match_kind column)                  (food_item_id, slug, year)
             │                                     │
             ▼                                     │
     festival_editions   ◄── optional date window, keyed (slug, year)
             │                                     │
             └──────────────┬──────────────────────┘
                             ▼
                  Qualifying_Visit (pure core, per experience per User)
                    'facet': completions OR any food_item_log at that experience
                    'menu' : food_item_log on a tagged food_item ONLY
                    both windowed by festival_editions when a window exists
                             │
                ┌────────────┴─────────────┐
                ▼                           ▼
    Pin_Service festivalBooths      Stats_Service festivals{}
```

### Data Models

#### Migration `00XX_festival_edition_and_dish_tags.sql`

```sql
BEGIN;

-- Requirement 9.1-9.2: which Requirement 3 discovery signal produced a tag.
-- Nullable with no default so a pre-existing row is NULL until the backfill
-- UPDATE below runs; the application layer never persists NULL for a NEW tag
-- (upsertTags always supplies one).
ALTER TABLE experience_festival_tags
    ADD COLUMN match_kind TEXT;

ALTER TABLE experience_festival_tags
    ADD CONSTRAINT experience_festival_tags_match_kind_chk
        CHECK (match_kind IS NULL OR match_kind IN ('facet', 'menu'));

-- Requirement 9.2: one-time backfill classifying every pre-existing row by
-- re-running the SAME `Festival Kiosk` facet predicate R3.3 already uses,
-- against the experience's CURRENTLY-persisted grouped_facets. This is a
-- plain UPDATE, not a Catalog_Sync write (that pipeline never touches this
-- table, per Requirement 2.2) — a one-time data-quality fix for rows that
-- predate the match_kind column existing at all.
--
-- Implementer note (verified while implementing): written as `UPDATE ...
-- WHERE experience_id IN (subquery)` using the JSONB containment operator
-- (`@>`) rather than `UPDATE ... FROM` + `jsonb_array_elements` as an earlier
-- draft of this design showed — this app's pg-mem test harness supports
-- neither `UPDATE ... FROM` nor that function. The substitution below is
-- semantically identical and was verified against both real Postgres (the
-- local dev DB's actual 28 facet / 19 menu split) and pg-mem.
UPDATE experience_festival_tags
   SET match_kind = 'facet'
 WHERE match_kind IS NULL
   AND experience_id IN (
     SELECT id FROM experiences
      WHERE COALESCE(grouped_facets -> 'quickService', '[]'::jsonb)
            @> '[{"name": "Festival Kiosk"}]'::jsonb
   );

UPDATE experience_festival_tags
   SET match_kind = 'menu'
 WHERE match_kind IS NULL;

ALTER TABLE experience_festival_tags
    ALTER COLUMN match_kind SET NOT NULL;

-- Requirement 9.3-9.5: optional operator-set date window per (slug, year).
-- Absent row = no restriction (R9.4); ends_on absent = "still running" (R9.5).
-- Deliberately NOT a column on experience_festival_tags: the window belongs
-- to the (slug, year) PAIR, not to any one tagged experience, and multiple
-- experiences share one edition.
CREATE TABLE IF NOT EXISTS festival_editions (
    festival_slug  TEXT         NOT NULL,
    festival_year  INTEGER      NOT NULL,
    starts_on      DATE         NOT NULL,
    ends_on        DATE,
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (festival_slug, festival_year),
    CONSTRAINT festival_editions_year_chk
        CHECK (festival_year BETWEEN 2015 AND 2100),
    CONSTRAINT festival_editions_dates_chk
        CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

-- Requirement 10.1-10.2: per-dish festival tag, written only for a
-- Match_Kind = 'menu' experience's matching dishes. References food_items
-- (food-item-logging's existing table); CASCADE mirrors experience_festival_tags'
-- own CASCADE on its experience FK, and food_items itself already CASCADEs
-- from experiences/user_submitted_locations, so this table never outlives its
-- Food_Item.
CREATE TABLE IF NOT EXISTS food_item_festival_tags (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    food_item_id   UUID         NOT NULL REFERENCES food_items(id) ON DELETE CASCADE,
    festival_slug  TEXT         NOT NULL,
    festival_year  INTEGER      NOT NULL,
    tagged_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT food_item_festival_tags_unique UNIQUE (food_item_id, festival_year),
    CONSTRAINT food_item_festival_tags_year_chk
        CHECK (festival_year BETWEEN 2015 AND 2100)
);

CREATE INDEX IF NOT EXISTS food_item_festival_tags_food_item_idx
    ON food_item_festival_tags (food_item_id);

COMMIT;
```

Design notes:

- `match_kind` is `TEXT` with an application-validated `CHECK`, mirroring `festival_slug`'s own
  "closed set validated outside the DB" convention in this same table — consistent with how this
  schema already treats small closed-but-evolving sets.
- `festival_editions`' primary key is the pair itself, not a surrogate id: there is at most one
  window per `(slug, year)`, and the Tagging_CLI's `--set-dates` step is naturally an upsert on
  that pair (`ON CONFLICT (festival_slug, festival_year) DO UPDATE ... WHERE ends_on provided`,
  mirroring `experience_festival_tags.upsertTags`'s own "don't silently overwrite with blank"
  shape for R9.3's "SHALL NOT overwrite a previously-set `ends_on` with blank" rule).
- `food_item_festival_tags` is a SEPARATE table from `experience_festival_tags`, not a shared
  polymorphic one: the two have different foreign keys (`food_items.id` vs `experiences.id`),
  different cardinality relative to a Festival_Tag (zero-to-many dishes per `'menu'`-matched
  experience, never for a `'facet'`-matched one), and keeping them separate means neither query
  needs a `CASE`-based join to figure out which column to join on.

### `FestivalTagRepo` (amended)

```typescript
export type MatchKind = 'facet' | 'menu';

export interface FestivalTagRow {
  readonly experienceId: string;
  readonly festivalSlug: FestivalSlug;
  readonly festivalYear: number;
  readonly taggedAt: string;
  readonly matchKind: MatchKind; // NEW
}

export interface DiscoveredBooth {
  readonly experienceId: string;
  readonly name: string;
  readonly park: string | null;
  readonly conflictingTag: FestivalTagRow | null;
  readonly matchKind: MatchKind; // NEW — which signal (R3.3 vs R3.8) found this candidate
  /**
   * Food_Items at this booth whose name matched the Festival's menu-keyword
   * pattern inside a matching menu group (R10.1). Empty for a `'facet'` match
   * (R10.2) — a temporary booth's dishes are never individually tagged.
   */
  readonly matchingFoodItemIds: readonly string[]; // NEW
}

export interface FestivalTagRepo {
  listActiveFestivalBooths(year: number, slug: FestivalSlug): Promise<DiscoveredBooth[]>;
  listActiveEpcotRestaurantIds(): Promise<readonly string[]>;
  upsertTags(
    entries: readonly {
      experienceId: string;
      year: number;
      slug: FestivalSlug;
      matchKind: MatchKind;         // NEW — required, no default
      matchingFoodItemIds: readonly string[]; // NEW — tagged alongside, same transaction
    }[],
    opts: { force: boolean },
  ): Promise<string[]>;
  /** Requirement 9.3: upsert a Festival_Edition's window, never blanking a set `ends_on`. */
  upsertFestivalEdition(
    slug: FestivalSlug,
    year: number,
    startsOn: string,
    endsOn: string | null,
  ): Promise<void>;
}
```

`listActiveFestivalBooths`'s existing `grouped_facets`/`menus` read is extended to also compute,
per matched Restaurant, exactly which `food_items.name` values (already loaded via the existing
`experience_menus` join) fell inside a matching group — reusing `menuMatchesFestival`'s pattern
table rather than re-deriving it (see `menuMatch.ts` amendment below). The CLI resolves those
NAMES to `food_items.id`s via a single `SELECT id FROM food_items WHERE experience_id = $1 AND
lower(name) = ANY($2)` lookup (menu-sync already seeded those rows via
`upsertFoodItemsFromMenus`, per `food-item-logging` R1.1) before calling `upsertTags`.

`upsertTags`'s SQL gains one more statement per entry (same transaction as the existing
`experience_festival_tags` upsert), inserting one `food_item_festival_tags` row per
`matchingFoodItemIds` entry with the identical `ON CONFLICT (food_item_id, festival_year) DO
UPDATE ... WHERE force OR already-same-slug` shape `experience_festival_tags` already uses — this
is the exact same idempotency/conflict rule, just at dish granularity.

### Pure core: `menuMatch.ts` amendment

```typescript
/**
 * Like menuMatchesFestival, but returns the matching item NAMES instead of a
 * boolean — the dish-level signal Requirement 10.1 needs. Pure and total;
 * dedupes by case-insensitive trimmed name (mirrors food_items' own
 * case-insensitive uniqueness).
 */
export function festivalMatchingItemNames(
  menus: readonly MenuDTO[],
  slug: FestivalSlug,
): readonly string[] {
  const pattern = FESTIVAL_MENU_KEYWORDS[slug];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const menu of menus) {
    for (const group of menu.groups) {
      if (!pattern.test(group.name)) continue;
      for (const item of group.items) {
        const trimmed = item.name.trim();
        const key = trimmed.toLowerCase();
        if (trimmed.length === 0 || seen.has(key)) continue;
        seen.add(key);
        names.push(trimmed);
      }
    }
  }
  return names;
}
```

`menuMatchesFestival` itself is UNCHANGED (`festivalMatchingItemNames(menus, slug).length > 0` is
equivalent to it, but the existing boolean function is kept as-is since `repo.ts`'s discovery
filter has no need for the full name list and changing its signature would be a gratuitous
breaking change to an already-tested function).

### Pure core: `qualifyingVisit.ts` (new)

The computation Requirement 11 describes, extracted as its OWN pure module (not inlined into
`pins/evaluator.ts` or `stats/festivals.ts`) so the Pin_Service and Stats_Service — which read it
from two different repos today and must never diverge on this rule — share one implementation and
one property-test target.

```typescript
export interface FestivalEditionWindow {
  readonly startsOn: string; // YYYY-MM-DD
  readonly endsOn: string | null; // null = still running (R9.5)
}

export interface QualifyingSignal {
  readonly experienceId: string;
  readonly matchKind: 'facet' | 'menu';
  /** Date (YYYY-MM-DD) of a qualifying `completions` row, if any (R11.1 only). */
  readonly completionDate: string | null;
  /**
   * Dates of every Food_Item_Log that qualifies as a signal for this
   * experience: for 'facet', ANY food_item_log at the experience (R11.1);
   * for 'menu', ONLY a food_item_log on a food_item carrying a matching
   * Food_Item_Festival_Tag (R10.3). The repo pre-filters to this set; the
   * pure core only applies the date window, never re-derives which food_item
   * ids qualify.
   */
  readonly qualifyingFoodLogDates: readonly string[];
}

/**
 * Whether `date` falls inside `window` inclusive, treating a null `endsOn` as
 * "today" per R9.5. `window === null` means no restriction (R9.4).
 */
function withinWindow(date: string, window: FestivalEditionWindow | null, today: string): boolean {
  if (window === null) return true;
  if (date < window.startsOn) return false;
  const end = window.endsOn ?? today;
  return date <= end;
}

/**
 * Property 32: for any signal input, returns a single boolean — never a count
 * — so the caller can safely treat "qualifies" as contributing exactly 1 to a
 * distinct-experience count regardless of how many completions/food-logs fed
 * into it (R11.3).
 */
export function isQualifyingVisit(
  signal: QualifyingSignal,
  window: FestivalEditionWindow | null,
  today: string,
): boolean {
  if (signal.matchKind === 'facet') {
    const completionQualifies =
      signal.completionDate !== null && withinWindow(signal.completionDate, window, today);
    const anyFoodLogQualifies = signal.qualifyingFoodLogDates.some((d) =>
      withinWindow(d, window, today),
    );
    return completionQualifies || anyFoodLogQualifies;
  }
  // 'menu': completions never qualify alone (R10.3); only a tagged-dish food log.
  return signal.qualifyingFoodLogDates.some((d) => withinWindow(d, window, today));
}
```

### Repo reads feeding the pure core

Both `pins/repo.ts`'s `buildSnapshot` and `stats/repo.ts`'s snapshot transaction replace their
existing

```sql
SELECT DISTINCT e.upstream_entity_id
  FROM completions c
  JOIN experience_festival_tags t ON t.experience_id = c.experience_id
 WHERE c.user_id = $1
```

with a read that supplies EVERY `QualifyingSignal` the User could have for EVERY tagged
experience, letting `isQualifyingVisit` decide per-row, then the repo (NOT the pure core)
collapses to a `Set<experienceId>`/`COUNT(DISTINCT experience_id)` so Property 32 is enforced at
the point of aggregation, not left to the caller:

```sql
-- One row per (experience_id, match_kind, completion_date-or-null, each qualifying food-log date)
WITH tagged AS (
  SELECT t.experience_id, t.match_kind, t.festival_slug, t.festival_year
    FROM experience_festival_tags t
),
qualifying_food_logs AS (
  -- 'facet': every food_item_log at the tagged experience (via food_items.experience_id)
  SELECT tg.experience_id, tg.match_kind, fil.visited_on
    FROM tagged tg
    JOIN food_items fi ON fi.experience_id = tg.experience_id
    JOIN food_item_logs fil ON fil.food_item_id = fi.id AND fil.user_id = $1
   WHERE tg.match_kind = 'facet'
   UNION ALL
  -- 'menu': only a food_item_log on a food_item carrying a matching dish tag
  SELECT tg.experience_id, tg.match_kind, fil.visited_on
    FROM tagged tg
    JOIN food_item_festival_tags ft
      ON ft.festival_slug = tg.festival_slug AND ft.festival_year = tg.festival_year
    JOIN food_items fi ON fi.id = ft.food_item_id AND fi.experience_id = tg.experience_id
    JOIN food_item_logs fil ON fil.food_item_id = fi.id AND fil.user_id = $1
   WHERE tg.match_kind = 'menu'
)
SELECT tg.experience_id, tg.match_kind, tg.festival_slug, tg.festival_year,
       c.completed_on, qfl.visited_on AS qualifying_food_log_date,
       fe.starts_on, fe.ends_on
  FROM tagged tg
  LEFT JOIN completions c ON c.experience_id = tg.experience_id AND c.user_id = $1
  LEFT JOIN qualifying_food_logs qfl ON qfl.experience_id = tg.experience_id
  LEFT JOIN festival_editions fe
    ON fe.festival_slug = tg.festival_slug AND fe.festival_year = tg.festival_year
```

The repo groups these rows by `experience_id` into one `QualifyingSignal` + `FestivalEditionWindow
| null` pair, calls `isQualifyingVisit` once per experience, and only the experiences where it
returns `true` contribute to `festivalTaggedCompletedIds` (Pin_Service) or the `COUNT(DISTINCT
...)` (Stats_Service) — identically to how both already consume the pre-amendment join, so neither
caller's OWN aggregation logic changes, only what feeds it.

### Correctness Properties (additive)

### Property 32: Qualifying Visit Is Boolean, Never Additive

*For any User and any single tagged experience, however many qualifying `completions` and/or
Food_Item_Log rows exist for it (zero, one, or many, across one or several distinct Food_Items and
dates), `isQualifyingVisit` returns a single boolean, and the aggregate count derived from it
(`festivalTaggedCompletedIds.size` / `COUNT(DISTINCT experience_id)`) increases by at most 1 for
that experience — never by the number of qualifying signal rows.*
**Validates: Requirement 11.3**

### Property 33: Menu-Matched Experiences Require a Tagged Dish, Facet-Matched Do Not

*For any `'menu'`-matched experience, `isQualifyingVisit` returns `true` for a User if and only if
at least one of that User's Food_Item_Logs is on a `food_items` row carrying a
Food_Item_Festival_Tag for the same `(slug, year)`, regardless of any `completions` row for that
experience (which never contributes to the `'menu'` case). For any `'facet'`-matched experience,
either a qualifying `completions` row OR any Food_Item_Log at that experience suffices.*
**Validates: Requirements 10.3, 11.1, 11.2**

### Property 34: Date Window Is Inclusive and Absence Means Unrestricted

*For any `FestivalEditionWindow`, a signal dated exactly `startsOn` or exactly the effective end
(`endsOn`, or `today` when `endsOn` is `null`) qualifies; a signal strictly outside that range does
not. For `window === null`, every signal date qualifies regardless of value.*
**Validates: Requirements 9.4, 9.5**

## Error Handling (additive)

- **Tagging_CLI dish-tag write failure**: `upsertTags`'s per-entry transaction now also writes
  `food_item_festival_tags` rows; a failure on either statement rolls back that entry's whole
  write (mirrors the existing per-entry loop's implicit atomicity — each entry is already its own
  statement; the dish-tag insert is added to the SAME statement batch for that entry, not a
  separate best-effort step, so a `'menu'` entry's experience tag and its dish tags are
  all-or-nothing).
- **`festival_editions` upsert with an earlier `starts_on` than an existing row**: no special
  handling — the CLI's upsert simply overwrites `starts_on`/`ends_on` with whatever the operator
  enters this run (mirrors `upsertTags`'s own "last write wins" semantics for non-conflicting
  fields); only `ends_on` has the "never overwrite set-with-blank" guard (R9.3).
- **A `'menu'`-matched experience later re-discovered with ZERO matching dishes** (e.g. the
  restaurant's festival items were fully removed from the menu before the operator ran the CLI):
  `matchingFoodItemIds` is empty, so no `food_item_festival_tags` row is written for it that run;
  any already-written tag from a PRIOR run remains (R10.4) — this is not a new error path, it is
  the existing "menu changed" tolerance already specified by R10.4.

## Testing Strategy (additive)

- **Migration test** (`apps/api/src/db/__tests__/migrationNNNN.test.ts`, pg-mem): `match_kind`
  backfill correctly classifies a pre-existing `Festival Kiosk`-faceted row as `'facet'` and a
  non-kiosk-faceted row as `'menu'`; the column is `NOT NULL` after migration; `festival_editions`'
  PK and date `CHECK` (`ends_on >= starts_on`); `food_item_festival_tags`' UNIQUE and CASCADE from
  `food_items`.
- **Pure unit + property tests** (`apps/api/src/services/catalog/festivalTags/__tests__/
  qualifyingVisit.prop.test.ts`, `fast-check`, ≥100 runs): Property 32 (the adversarial case: one
  completion + N food-item-logs across M distinct food_items at the SAME experience never yields
  more than one qualifying contribution); Property 33 (menu-matched + completion-only never
  qualifies; menu-matched + tagged-dish-log always qualifies regardless of any completion state);
  Property 34 (boundary dates, null window, null `endsOn`).
- **`festivalMatchingItemNames` unit tests** (`menuMatch.test.ts`, extended): returns exactly the
  item names inside a matching group, deduped case-insensitively, empty for no match, empty for
  empty menus.
- **`FestivalTagRepo` integration tests** (extended): `upsertTags` with `matchKind: 'menu'` and
  non-empty `matchingFoodItemIds` writes both the experience tag and the per-dish tags in one
  transaction; `matchKind: 'facet'` writes zero dish tags even if `matchingFoodItemIds` is
  (defensively) non-empty; `upsertFestivalEdition` never blanks a previously-set `ends_on`.
- **Pin_Service / Stats_Service integration tests** (extended, pg-mem, real Postgres per existing
  convention): a `'menu'`-matched experience with a completion but NO tagged-dish log does not
  count; the same experience WITH a tagged-dish log counts exactly once even with the completion
  also present; a `'facet'`-matched experience counts from either signal; a signal dated outside a
  set `festival_editions` window does not count; the same signal counts once the window is cleared
  (R9.4) or widened to include it.
