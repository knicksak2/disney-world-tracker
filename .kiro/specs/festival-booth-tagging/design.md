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
