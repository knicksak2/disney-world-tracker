# Design Document

## Overview

The expanded-stats feature grows the Stats_Service from a single overall/per-Park/per-Category
completion surface into three richer groups of statistics — **Coverage** (Group A),
**Personal Rating Statistics** (Group B), and **Comparative** (Group C) — plus a curated
subset of those statistics injected into the existing Progress_Share payload.

The controlling design decision, mandated by the requirements, is a clean split between two
kinds of statistics:

- **Per-user, request-scoped statistics** (every Coverage_Statistic, every Rating_Statistic,
  and the Percentile_Rank) are computed **live per request** inside a single
  `REPEATABLE READ READ ONLY` transaction. This is exactly the model the current Stats_Service
  already uses (`services/stats/repo.ts` opens `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`
  and reads denominators and numerators against the same snapshot). We extend that snapshot;
  we do not add caching for per-user data.
- **Global aggregates** (the incrementally-maintained `aggregate_ratings` store and the
  Redis-cached highest-rated leaderboard) stay precomputed/cached and are explicitly **not**
  converted to live computation. The Stats_Service continues to read them through their
  existing services (`services/aggregate/repo.ts`, `services/aggregate/leaderboard.ts`).

This design is almost entirely additive. It reuses the existing transaction shape, the
`computePercent`/`round1` primitives, the `assertOwnerOrFriend` authorization gate, and the
`experiences` catalog columns that Catalog_Sync already populates (`land`, `resort_area`,
`grouped_facets`, `represents_resort_id`, `area_type`). It requires **no new tables and no new
migrations**: every new statistic is derived from columns and rows that already exist. The
one persistence-adjacent change is an enrichment of the `progress` Share payload snapshot with
three curated fields.

### Key sources reviewed

- `apps/api/src/services/stats/repo.ts` — the current single-snapshot repo (the transaction we extend).
- `apps/api/src/services/stats/routes.ts` — the current roll-up and the two endpoints (`GET /me/stats`, `GET /me/stats/summary?for=<userId>`).
- `apps/api/src/services/stats/computePercent.ts` — `round1` (round-half-away-from-zero) and `computePercent`.
- `apps/api/src/services/aggregate/{repo,leaderboard,updateMeanX10}.ts` — the Global_Aggregate stores we must **not** convert to live.
- `apps/api/src/services/sharing/{repo,routes}.ts` and `packages/shared/src/dto/Share.ts` — the Progress_Share payload we curate stats into.
- `apps/api/src/services/friends/ownerOrFriend.ts` — the `assertOwnerOrFriend` gate reused for friend viewing.
- Migrations `0001`, `0006`–`0010` and `packages/shared/src/enums.ts` — the catalog schema and closed enums (`PARKS`, `EXPERIENCE_CATEGORIES`, `AREA_TYPES`).
- `apps/api/src/services/catalog/disney/enrich.ts` — confirms **Interest_Facets is a derived subset of `grouped_facets`** (all groups except `height` and `physicalConsiderations`); there is no separate `interest_facets` column.

## Architecture

The Stats_Service keeps its two-layer shape: a **repository** that owns the one snapshot
transaction and returns raw rows, and a **pure roll-up layer** that folds raw rows into the
wire response. Expanding stats means (a) the repo reads more raw material inside the same
transaction, and (b) the roll-up layer gains pure modules for coverage, rating statistics,
facets, and percentile.

```mermaid
flowchart TD
    subgraph Client
      SP[Stats_Page]
    end

    subgraph StatsService[Stats_Service]
      RT[routes.ts\nGET /me/stats\nGET /me/stats/summary]
      AUTH[assertOwnerOrFriend]
      REPO[repo.ts\nsingle REPEATABLE READ READ ONLY txn]
      COV[coverage.ts\npure roll-up]
      RAT[ratingStats.ts\npure roll-up]
      FAC[facets.ts\npure unnest + group]
      PCT[percentile.ts\npure]
      PCTFN[computePercent / round1 / roundHalfUpDecimal]
    end

    subgraph DB[(Postgres)]
      EXP[experiences\n+land +resort_area +grouped_facets\n+represents_resort_id +area_type]
      COMP[completions]
      RATT[ratings]
    end

    subgraph Global[Global aggregates - NOT live]
      AGG[aggregate_ratings store]
      LB[Redis leaderboard cache]
    end

    subgraph Sharing[Sharing_Service]
      SHRT[routes.ts]
      SHREPO[repo.ts]
    end

    SP -->|GET stats| RT
    RT --> AUTH
    RT --> REPO
    REPO -->|1 snapshot| DB
    REPO --> COV & RAT & FAC & PCT
    COV & RAT & PCT --> PCTFN
    RT -->|StatsResponse| SP
    RT -.reads, not live.-> AGG
    RT -.reads, not live.-> LB
    SHRT -->|create progress share| REPO
    SHRT --> SHREPO
```

### Live vs. cached boundary (Requirement 8)

All Coverage_Statistics, Rating_Statistics, and the Percentile_Rank are computed inside one
transaction opened with `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`. Because every read
observes the snapshot pinned at `BEGIN`, all numerators and denominators — coverage, ratings,
and percentile — see the same point-in-time catalog and the same point-in-time completion/rating
state (R8.1, R8.3). A `Catalog_Sync`, `Completion`, or `Rating` mutation committed after `BEGIN`
is invisible to the request. `READ ONLY` is a sentinel that makes an accidental write fail loudly.

The service never reads a per-user statistic from a cache (R8.2). It continues to read the
Global_Aggregate ratings from `aggregate_ratings` and the highest-rated leaderboard from its
Redis cache exactly as today (R8.4, R8.5) — those code paths are untouched by this feature.

### Percentile computation as an opt-in

The Percentile_Rank is the only statistic that scans **all** trackers' completions rather than
just the Target_User's. To keep the common case cheap and to honor R7.2, the percentile query
runs **only** when the request explicitly asks for it (`?percentile=true`). When it is not
requested, no percentile query is issued and the field is omitted. The percentile query runs
inside the same snapshot transaction so it observes the same catalog/completions as the coverage
numbers (R7.1, R7.7 — never persisted or cached).

## Components and Interfaces

### 1. `repo.ts` — extended snapshot repository

The repo keeps its single-transaction contract but returns a richer `StatsSnapshot`. The
transaction issues these reads (all within one `REPEATABLE READ READ ONLY` block):

1. **Coverage denominators** — grouped counts of active experiences by
   `(park, category, area_type, land, resort_area, is_resort_representation)`.
2. **Coverage numerators** — the same grouping restricted to the Target_User's completions
   (`completions c JOIN experiences e ... WHERE c.user_id = $1 AND e.active`).
3. **Facet rows** — for each active experience, its `id`, whether the Target_User completed it,
   and its `grouped_facets` JSONB (which contains both Grouped_Facets and, as a derived subset,
   Interest_Facets). Grouping/unnesting/dedup happens in the pure `facets.ts` layer.
4. **Rating rows** — the Target_User's ratings on active experiences: `(experience_id, name,
   value, park, category)` from `ratings r JOIN experiences e ... WHERE r.user_id = $1 AND
   e.active`.
5. **Percentile rows** *(only when requested)* — per-user total completion counts over active
   experiences (`SELECT user_id, COUNT(*) ... GROUP BY user_id`), used to rank the Target_User.

```ts
export interface StatsSnapshotInput {
  readonly targetUserId: string;
  readonly includePercentile: boolean;
}

export interface RawCoverageCell {
  readonly park: Park | null;
  readonly category: ExperienceCategory;
  readonly areaType: AreaType;
  readonly land: string | null;         // raw; normalized in coverage.ts
  readonly resortArea: string | null;   // raw; normalized in coverage.ts
  readonly isResortRepresentation: boolean;
  readonly completed: number;
  readonly total: number;
}

export interface RawFacetExperienceRow {
  readonly experienceId: string;
  readonly completedByUser: boolean;
  readonly groupedFacets: GroupedFacetsDTO; // parsed JSONB; drives facet unnest
}

export interface RawUserRatingRow {
  readonly experienceId: string;
  readonly experienceName: string;
  readonly value: number;               // 1..10
  readonly park: Park | null;
  readonly category: ExperienceCategory;
}

export interface PercentileInput {
  readonly targetTotal: number;         // Target_User's active-completion count
  readonly otherTotals: readonly number[]; // each other tracker with >= 1 completion
}

export interface StatsSnapshot {
  readonly coverage: readonly RawCoverageCell[];
  readonly facetExperiences: readonly RawFacetExperienceRow[];
  readonly userRatings: readonly RawUserRatingRow[];
  readonly percentile: PercentileInput | null; // null when not requested
}

export interface StatsRepo {
  getStatsSnapshot(input: StatsSnapshotInput): Promise<StatsSnapshot>;
}
```

The `land`/`resort_area` grouping keeps raw values so the pure layer can apply the trim +
case-insensitive normalization (R1.6, R1.7) in one place and remain independently testable.

If the transaction fails to begin, commit, or is aborted before the values are computed, the
repo lets the error propagate; the route maps it to a `stats_unavailable` error and returns no
partial or precomputed per-user statistics (R8.6).

### 2. `coverage.ts` — pure Coverage_Statistic roll-up

Consumes `RawCoverageCell[]` and produces every Coverage_Statistic dimension. A Coverage_Statistic
is reported as a `CompletionCell` extended with `remaining` and `completeBadge`:

```ts
export interface CompletionCell {
  readonly completed: number;   // >= 0 integer
  readonly total: number;       // >= 0 integer
  readonly percent: number;     // [0.0, 100.0], one decimal, half-away-from-zero
  readonly remaining: number;   // total - completed, >= 0
  readonly completeBadge: boolean; // completed === total && total > 0
}
```

Roll-up rules:

- **overall** (R1.1): sum all cells.
- **byPark** (R1.3): one cell per `Park` in `PARKS`; Park-less rows contribute to none.
- **byCategory** (R1.4): one cell per `ExperienceCategory` in `EXPERIENCE_CATEGORIES`.
- **byAreaType** (R1.5): one cell per `AreaType` in `AREA_TYPES`; excludes resort-representing rows so it stays "resort-*area* activity", not hotels visited.
- **byLand** (R1.6, R1.8): group by the **normalized Land key** = `land.trim()` compared case-insensitively; rows whose `land` is null/empty/whitespace are excluded. The display label is the first-encountered form under ascending case-insensitive ordering.
- **byResortArea** (R1.7, R1.9): identical rule for `resort_area`.
- **resort** Resort_Statistic (R2.1, R2.2): sum of resort-representing rows only, reported separately from `byAreaType['Resort']`.
- **denominator/numerator semantics** (R1.2, R1.10): denominator = count of active experiences in the group; numerator = count of those the Target_User completed; inactive experiences excluded from both.
- **percent** (R1.11): via `computePercent` → `round1`, already `[0,100]` one-decimal half-away-from-zero, capped at 100.
- **empty group** (R1.12, R2.5): `total === 0 ⇒ completed 0, percent 0.0, remaining 0, completeBadge false`.
- **remaining/badge for every cell** (R2.3, R2.4): computed uniformly by the `CompletionCell` constructor so no dimension can diverge.

```ts
export function toCompletionCell(completed: number, total: number): CompletionCell;
export function rollUpCoverage(cells: readonly RawCoverageCell[]): CoverageStats;
```

### 3. `facets.ts` — pure per-Facet_Value_Key roll-up (Requirement 3)

Consumes `RawFacetExperienceRow[]`. For each experience, it flattens every Facet_Value across
all groups of `grouped_facets` (this set already includes Interest_Facets, which is a derived
subset — see `catalog/disney/enrich.ts`), then:

- **Facet_Value_Key resolution**: the key is the Facet_Value **`id`**; the display label is the
  Facet_Value **`name`**. This resolves the glossary's open question. It is the only reading
  consistent with R3.8, which requires selecting among *multiple distinct display labels for the
  same key* — impossible if the key were the label itself.
- **Per-experience dedup** (R3.4): within one experience, collapse repeated keys so an experience
  counts **at most once** in a key's `total`, and at most once in its `completed` when completed.
  Implemented by building a `Set<FacetKey>` per experience before counting.
- **Key equality** (R3.7): keys are grouped by **exact** string equality; case and
  leading/trailing whitespace differences make distinct keys (no normalization, unlike Land).
- **Coverage** (R3.1, R3.2): one Coverage_Statistic per distinct key present on any active
  experience; denominator = experiences carrying the key, numerator = those the user completed.
- **Empty-facet exclusion** (R3.6): an experience with no Facet_Values in any group contributes
  to no key.
- **Display label** (R3.5, R3.8): report one human-readable label per key; when a key appears
  with multiple distinct labels across experiences, choose the label that sorts first by
  ascending case-insensitive comparison.
- **Open-ended** (R3.3): the key set is data-driven, returned as a list, never a fixed map.

```ts
export interface FacetCoverage {
  readonly key: string;         // Facet_Value id (exact)
  readonly label: string;       // chosen display name
  readonly cell: CompletionCell;
}
export function rollUpFacets(rows: readonly RawFacetExperienceRow[]): readonly FacetCoverage[];
```

### 4. `ratingStats.ts` — pure Personal Rating Statistics (Requirements 4, 5, 6)

Consumes `RawUserRatingRow[]` (already filtered to the Target_User's ratings on **active**
experiences, R4.5/R5.4/R6.5). All ratings gating keys off the count of these rows against
`MINIMUM_RATINGS_THRESHOLD = 3` (reusing the leaderboard precedent, glossary + R4/R5/R6).

```ts
export const MINIMUM_RATINGS_THRESHOLD = 3;

export interface RatingStatistics {
  readonly sufficient: boolean;                 // count >= threshold
  readonly ratedCompletionsCount: number;       // always reported (R5.3)
  readonly average?: number;                     // overall, [1.0,10.0] 1dp (R4.1)
  readonly averageByPark?: Partial<Record<Park, number>>;      // R4.2
  readonly averageByCategory?: Partial<Record<ExperienceCategory, number>>; // R4.3
  readonly distribution?: RatingDistribution;    // counts for 1..10 (R5.1)
  readonly highest?: RatedExperience;            // R6.1
  readonly lowest?: RatedExperience;             // R6.2
}

export interface RatedExperience {
  readonly experienceId: string;
  readonly name: string;
  readonly value: number; // 1..10
}
export type RatingDistribution = Readonly<Record<1|2|3|4|5|6|7|8|9|10, number>>;
```

Rules:

- **Gating** (R4.4, R4.6, R5.2, R6.4): when count `< threshold` (including zero, R4.6/R6 zero
  cases), omit `average`, `averageByPark`, `averageByCategory`, `distribution`, `highest`,
  `lowest`, and set `sufficient = false`. `ratedCompletionsCount` is still reported (R5.3).
- **Averages** (R4.1–R4.3): overall and per-Park/per-Category means, `[1.0,10.0]` one decimal,
  half-away-from-zero (`round1`). Per-Park/per-Category entries appear only for a group in which
  the user has ≥ 1 active rating.
- **Distribution** (R5.1, R5.5): exactly one count per integer 1..10, zeros included; the ten
  counts sum to the total active-rating count.
- **Highest/Lowest** (R6.1–R6.3, R6.6): select max/min value; break ties by ascending
  case-insensitive name, then ascending experience id, so exactly one is chosen. When all
  ratings share one value, highest and lowest are the same experience (R6.6).

### 5. `percentile.ts` — pure Percentile_Rank (Requirement 7)

Consumes `PercentileInput` (target total + other trackers' totals, each with ≥ 1 completion).

```ts
export function computePercentileRank(input: PercentileInput): number;
```

- **Definition** (R7.1, R7.3): `100 * (count of other trackers the target is strictly ahead of) /
  (total count of other trackers with ≥ 1 completion)`, `[0.0,100.0]`, one decimal, **round-half-up**.
- **Ties** (R7.4): trackers with the *same* total as the target are excluded from the numerator
  but retained in the denominator.
- **Edge cases** (R7.5, R7.6): target is the only tracker with a completion ⇒ `0.0`; target has
  zero completions ⇒ `0.0`.
- **Rounding** — R7.3 specifies round-**half-up** (toward +∞), distinct from coverage's
  round-half-away-from-zero. Since percentile is always non-negative the two coincide, but we add
  an explicit `roundHalfUpDecimal(value, 1)` helper and use it here so the rule is honored by name.
- **Never persisted/cached** (R7.7): the value lives only in the response object.

### 6. `routes.ts` — endpoints, gating, error mapping

```
GET /me/stats[?percentile=true]                 own stats (R8, R11)
GET /me/stats/summary?for=<userId>[&percentile=true]   friend-or-self stats (R9)
```

- **Authorization** (R9.2, R9.3, R9.6): `assertOwnerOrFriend` runs before any snapshot read; a
  forbidden requester gets `profile_forbidden` and no target data is read and no analytics event
  is recorded (the gate already emits none). A non-existent target yields a not-found error.
- **Friend gating of rating stats** (R9.1, R9.4, R9.5): a friend's response has the identical
  structure and Rating_Statistic types; the friend's own active-rating count is compared to the
  threshold and rating stats are hidden when below (identical to self-gating), including the
  zero-ratings case.
- **Percentile opt-in** (R7.2): `?percentile=true` toggles the percentile read; absent ⇒ omitted.
- **Percentile failure isolation** (R7.9): if percentile computation cannot complete while the
  rest of the snapshot succeeded, the response omits `percentileRank`, includes a
  `percentileUnavailable: true` indication, and returns all other requested statistics unchanged.
- **Timeout** (R7.8, R8.1, R11.1–R11.3): a per-request statement timeout (see Error Handling)
  bounds the transaction; on timeout the request aborts and returns `stats_timeout` with no
  partial statistics.

Response shape (superset of today's response; existing fields preserved for compatibility):

```ts
export interface StatsResponse {
  coverage: {
    overall: CompletionCell;
    byPark: Record<Park, CompletionCell>;
    byCategory: Record<ExperienceCategory, CompletionCell>;
    byAreaType: Record<AreaType, CompletionCell>;
    byLand: LabeledCell[];         // one per distinct normalized Land
    byResortArea: LabeledCell[];   // one per distinct normalized Resort_Area
    byFacetValue: FacetCoverage[]; // open-ended, per Facet_Value_Key
    resort: CompletionCell;        // hotels-visited Resort_Statistic
  };
  ratings: RatingStatistics;
  percentileRank?: number;         // present only when requested and computed
  percentileUnavailable?: boolean; // present only on isolated percentile failure (R7.9)
}
export interface LabeledCell { readonly label: string; readonly cell: CompletionCell; }
```

### 7. Sharing_Service — curated stats in the Progress_Share (Requirement 10)

When a `progress` Share is created, the Sharing_Service captures a curated snapshot (R10.6). The
snapshot is produced by the Stats_Service's live computation at creation time (same transaction
model), then three curated fields are written into the `progress` payload:

- `overallPercent` — sender's overall completion percent (already present, R10.1).
- `topFacet` — the sender's top per-Facet_Value_Key Coverage_Statistic as a `CompletionCell`
  plus its display label (R10.2, R10.4). "Top" = highest `completed`, tie-break highest
  `percent`, then ascending case-insensitive label. Included even when its `completed` is 0 as
  long as the sender has ≥ 1 facet statistic (R10.7); omitted entirely when the sender has no
  facet statistic (R10.8).
- `percentileRank` — sender's Percentile_Rank, `[0.0,100.0]` one decimal, `0.0` when the sender
  has zero completions (R10.3).

Excluded from the snapshot (R10.5): Rating_Distribution, per-group breakdown maps, and
highest/lowest-rated experiences. The payload change is additive on `ProgressSharePayload` (new
optional `topFacet` and `percentileRank` fields; `overallPercent` already exists). Because the
snapshot is captured at creation time, later changes to the sender's stats do not alter the
recipient's view (R10.6).

## Data Models

### Reused persistence (no new tables, no new migrations)

All inputs already exist in the schema:

| Column / table | Source migration | Used for |
|---|---|---|
| `experiences.park` | `0001_init.sql` | per-Park coverage, rating-by-Park |
| `experiences.category` | `0001` / `0010` (adds `Resort`) | per-Category coverage, rating-by-Category |
| `experiences.area_type` | resort feature | per-Area_Type coverage |
| `experiences.land` (nullable) | `0006_experience_land.sql` | per-Land coverage (normalized) |
| `experiences.resort_area` (nullable) | `0007_experience_resort_area.sql` | per-Resort_Area coverage (normalized) |
| `experiences.grouped_facets` JSONB | `0008_experience_facet_enrichment.sql` | per-Facet_Value_Key coverage |
| `experiences.represents_resort_id` | `0009_resort_representing_experiences.sql` | Resort_Statistic (hotels visited) |
| `experiences.active` | `0001` | active-only numerator/denominator |
| `completions(user_id, experience_id)` | `0001` | coverage numerators, percentile |
| `ratings(user_id, experience_id, value)` | `0001` | all Group B rating statistics |

Indexes already present that keep the reads inside budget: `experiences_active_park_category_idx`,
`experiences_active_land_idx`, `experiences_active_resort_area_idx`,
`experiences_active_represents_resort_idx`, `completions_user_id_idx`, `ratings_experience_id_idx`.
The percentile grouping scans `completions` grouped by `user_id`; at the R11.2 scale (up to
100,000 trackers) an aggregate `GROUP BY user_id` over the indexed table meets the 3-second bound.

### Facet_Value_Key resolution (design decision)

`grouped_facets` is `Record<groupName, {id, name}[]>`. Interest_Facets is not a separate column;
it is the same JSONB minus the `height` and `physicalConsiderations` groups (`catalog/disney/enrich.ts`).
Unnesting `grouped_facets` therefore covers both Grouped_Facets and Interest_Facets in one pass;
per-experience dedup (R3.4) then guarantees an experience carrying the same key in both views is
counted once.

- **Facet_Value_Key = `id`** (exact string, case- and whitespace-sensitive per R3.7).
- **Display label = `name`**, chosen by ascending case-insensitive comparison when a key carries
  multiple names (R3.8).

### Progress_Share payload extension

```ts
export interface ProgressSharePayload {
  readonly kind: 'progress';
  readonly overallPercent: number;                 // existing (R10.1)
  readonly perParkPercent: { readonly [park in Park]?: number };
  readonly perCategoryPercent: { readonly [category in ExperienceCategory]?: number };
  readonly topFacet?: { readonly label: string; readonly cell: CompletionCell }; // new (R10.2, R10.7, R10.8)
  readonly percentileRank?: number;                // new (R10.3)
}
```

Persisted as JSONB in `shares.payload_snapshot` (existing column); the shared Zod schema
`progressSharePayloadSchema` gains the two optional fields. No DB migration is required because
`payload_snapshot` is schemaless JSONB.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a
system — essentially, a formal statement about what the system should do. Properties serve as the
bridge between human-readable specifications and machine-verifiable correctness guarantees.*

The per-user statistics are pure functions over structured inputs (coverage cells, facet rows,
rating rows, completion-count vectors). Behavior varies meaningfully with input, the input space
is large, and 100+ iterations reveal edge cases (empty groups, ties, whitespace/case variants,
threshold boundaries, dedup). Property-based testing is therefore the right tool for the roll-up
layer. Authorization, endpoint wiring, timeout behavior, and the not-live cache boundary are
verified with example/integration tests (see Testing Strategy).

### Property 1: Coverage counts are bounded and consistent

*For any* set of raw coverage cells, every reported Coverage_Statistic (overall, per-Park,
per-Category, per-Area_Type, per-Land, per-Resort_Area, and the Resort_Statistic) satisfies
`0 <= completed <= total`, `remaining == total - completed`, `remaining >= 0`, and excludes
inactive experiences from both numerator and denominator.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.10, 2.1, 2.3**

### Property 2: Percent is well-formed for every coverage cell

*For any* coverage cell, `percent` is in `[0.0, 100.0]`, rounded to one decimal using
round-half-away-from-zero, and equals `0.0` whenever `total == 0`.

**Validates: Requirements 1.11, 1.12**

### Property 3: Complete_Badge and empty-group behavior

*For any* coverage cell, `completeBadge` is true if and only if `total > 0 && completed == total`;
and when `total == 0`, `completed == 0`, `percent == 0.0`, `remaining == 0`, and
`completeBadge == false`.

**Validates: Requirements 2.4, 2.5, 1.12**

### Property 4: Land and Resort_Area grouping normalizes by trim + case-insensitive

*For any* set of active experiences, two experiences fall in the same per-Land (resp.
per-Resort_Area) group if and only if their Land (resp. Resort_Area) values are equal after
trimming leading/trailing whitespace and comparing case-insensitively; and experiences whose
value is null, empty, or whitespace-only are excluded from every per-Land (resp. per-Resort_Area)
statistic.

**Validates: Requirements 1.6, 1.7, 1.8, 1.9**

### Property 5: Resort_Statistic is independent of per-Area_Type Resort

*For any* set of raw coverage cells, the Resort_Statistic is computed solely from
resort-representing rows and its numerator never exceeds its denominator, while `byAreaType['Resort']`
is computed solely from non-resort-representing rows; the two are reported as separate values.

**Validates: Requirements 2.1, 2.2**

### Property 6: Facet coverage counts each experience at most once per key

*For any* set of active experiences with facets, for every Facet_Value_Key, the key's `total`
counts each experience at most once and its `completed` counts each completed experience at most
once, even when an experience carries the same key multiple times across Grouped_Facets and
Interest_Facets.

**Validates: Requirements 3.1, 3.2, 3.4, 3.6**

### Property 7: Facet_Value_Key equality is exact; display label is case-insensitively first

*For any* set of active experiences, two Facet_Values are grouped together if and only if their
keys are exactly equal (differences in case or leading/trailing whitespace produce distinct keys),
and the reported display label for a key is the label that sorts first under ascending
case-insensitive comparison among all labels observed for that key.

**Validates: Requirements 3.5, 3.7, 3.8**

### Property 8: Rating averages are gated and well-formed

*For any* set of the Target_User's active ratings, when the count is at least the
Minimum_Ratings_Threshold the overall average and each reported per-Park and per-Category average
lie in `[1.0, 10.0]` rounded to one decimal half-away-from-zero, a per-group average is present
exactly for groups with at least one active rating, and when the count is below the threshold
(including zero) all averages are omitted and the insufficient-data flag is set.

**Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6**

### Property 9: Rating distribution partitions the active ratings

*For any* set of the Target_User's active ratings at or above the threshold, the Rating_Distribution
has exactly one count for each integer 1..10 (zeros included) and the ten counts sum to the total
active-rating count; below the threshold the distribution is omitted and the insufficient-data flag
is set; and the rated-completions count is reported regardless of the threshold and derived only
from active experiences.

**Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**

### Property 10: Highest and lowest selection is deterministic under ties

*For any* set of the Target_User's active ratings at or above the threshold, the highest-rated
result is the active experience with the maximum value and the lowest-rated is the one with the
minimum value, ties broken by ascending case-insensitive name then ascending experience id so
exactly one is selected for each; when every rating shares a single value the same experience is
returned as both; and below the threshold both are omitted with the insufficient-data flag set.

**Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6**

### Property 11: Percentile rank is well-formed and honors ties and edge cases

*For any* target completion total and any multiset of other trackers' completion totals (each with
at least one completion), the Percentile_Rank equals `100 * (count strictly less than the target) /
(number of other trackers)` in `[0.0, 100.0]` rounded to one decimal using round-half-up, with
trackers tying the target excluded from the numerator but kept in the denominator; and the result
is `0.0` when the target is the only tracker with a completion or when the target has zero
completions.

**Validates: Requirements 7.1, 7.3, 7.4, 7.5, 7.6**

### Property 12: Curated share snapshot selects the top facet and excludes verbose stats

*For any* computed stats snapshot, the curated Progress_Share payload includes `overallPercent` in
`[0.0, 100.0]`, includes `percentileRank` in `[0.0, 100.0]` (0.0 when the sender has zero
completions), includes `topFacet` (the facet statistic with the highest completed count, ties
broken by highest percent then ascending case-insensitive label) whenever the sender has at least
one facet statistic and omits it otherwise, and never includes the rating distribution, per-group
breakdown maps, or highest/lowest experiences.

**Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.7, 10.8**

### Property 13: Friend and self responses are structurally identical with independent gating

*For any* Target_User, the response returned for a friend has the identical set of
Rating_Statistic types and the same response structure as the self response, and the friend's
rating statistics are gated by the friend's own active-rating count against the threshold
(hidden when below, and hidden identically when the friend has zero active ratings).

**Validates: Requirements 9.1, 9.4, 9.5**

## Error Handling

- **Unauthenticated request**: `requireSession` pre-handler assigns `request.userId`; a missing id
  yields `AppError('unauthorized')`. (Existing behavior, preserved.)
- **Friend-view authorization** (R9.2, R9.3): `assertOwnerOrFriend` throws `profile_forbidden`
  for a non-owner non-friend requester; the deny path reads no target statistics and records no
  analytics event (the gate emits none).
- **Target not found** (R9.6): a target user id that does not exist is denied with a not-found
  error before any statistics read. The gate's friendship lookup returns no row for a
  non-existent user, producing the deny path; the route distinguishes not-found from forbidden by
  a lightweight existence check on the target when the friendship lookup fails.
- **Transaction failure** (R8.6): if `BEGIN`/`COMMIT` fails or the transaction is aborted before
  the values are computed, the repo error propagates and the route returns `stats_unavailable`;
  the response contains **no** partial or precomputed per-user statistics.
- **Percentile failure isolation** (R7.9): the percentile read is wrapped so that a failure in
  *only* the percentile computation (while coverage and ratings succeeded) omits `percentileRank`,
  sets `percentileUnavailable: true`, and returns the remaining requested statistics unchanged.
  A failure of the shared transaction itself is handled by the R8.6 path instead.
- **Timeout** (R7.8, R11.1–R11.3): each stats transaction sets a Postgres `statement_timeout`
  sized to the applicable SLA (2s without percentile, 3s with percentile) plus headroom, and the
  request is aborted within 5 seconds. On timeout the route returns `stats_timeout` and no partial
  statistics. New error codes `stats_unavailable`, `stats_timeout`, and `stats_target_not_found`
  are added to the shared `ERROR_CODES` set with appropriate HTTP status mappings.
- **Malformed facet JSONB**: `grouped_facets` is validated structurally when parsed; a group whose
  value is not a `{id, name}[]` array is skipped defensively (defense-in-depth against drift),
  mirroring the enum defense in the existing repo/leaderboard code.

## Testing Strategy

### Dual approach

- **Property-based tests** cover the pure roll-up layer (Properties 1–13) against generated inputs.
- **Unit tests** cover specific examples and edge cases (empty catalog, single rating exactly at
  the threshold, whitespace-only Land, a facet key appearing in both Grouped_Facets and
  Interest_Facets, a percentile with all-tied trackers).
- **Integration tests** cover the parts PBT is not suited to: the `REPEATABLE READ READ ONLY`
  snapshot isolation (a concurrent completion committed after `BEGIN` is invisible), the
  not-live boundary (aggregate ratings and leaderboard are still read from their stores),
  authorization/deny paths, target-not-found, percentile opt-in on/off, percentile failure
  isolation, and timeout behavior.

### Property-based testing library and conventions

- Use **fast-check** with **Vitest**, matching the existing tests in
  `apps/api/src/services/aggregate/__tests__/*.prop.test.ts`.
- Do **not** hand-roll a property runner.
- Each property test runs a **minimum of 100 iterations** (`{ numRuns: 100 }`).
- Each property test is tagged with a comment referencing its design property, in the format:
  **`Feature: expanded-stats, Property {number}: {property_text}`**.
- Generators build: random active/inactive experiences with random `park`/`category`/`area_type`,
  optional `land`/`resort_area` (including whitespace/case variants), random `grouped_facets`
  (including duplicate keys across groups and empty facets), random completions/ratings for the
  Target_User, and random per-tracker completion totals (including ties and the single-tracker and
  zero-completion cases).

### Model-based oracle

Where useful (facet dedup, percentile ranking, highest/lowest tie-breaks), tests compare the
implementation against a simple reference computed directly from the generated raw data (an
independent naive fold), following the model-based pattern used by the aggregate property tests.

### Performance verification

Integration tests seed a catalog near the R11 bounds (up to 5,000 active experiences; a
Target_User with up to 5,000 completions and 5,000 ratings; a completions dataset spanning up to
100,000 trackers for the percentile case) and assert the response is produced within the 2s /
3s bounds, and that a forced overrun aborts within 5s with `stats_timeout` and no partial data.
