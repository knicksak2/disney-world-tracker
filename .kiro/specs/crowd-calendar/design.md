# Design Document

## Overview

The Crowd Calendar and Wait-Time Intelligence feature is the shared prediction foundation for both a browsable crowd calendar and the Day Planning optimizer. It predicts a park's daily busyness and an attraction's wait at any hour of any date, on free infrastructure, improving over time.

### Key design decisions

1. **Factored, most-specific-reliable prediction.** A wait is predicted from the most specific tier with enough data: (a) season-resolved `(ride, season, day_of_week, hour)` direct average; else (b) `Ride_Shape(day_of_week, hour) × Crowd_Multiplier(park, date)`; else (c) Park-typical shape × crowd. The factored default exists because the seed and early data are dense only in the `(day_of_week, hour)` dimension; the crowd multiplier specializes an all-season shape to a specific date. Tier (a) starts empty and densifies from the app's own sampling, then takes precedence — strictly more accurate as data grows, with no cold-start penalty.
2. **The crowd forecast leans on Disney's own signals.** ThemeParks.wiki `/entity/{park}/schedule` publishes, months ahead: park hours, Early Entry / Extended Evening / Special Ticketed Event flags, and **Lightning Lane Multi Pass price**. LL price is Disney's money-backed demand forecast and is the strongest single free forward signal; park-hours length and Extended-Evening days are secondary demand tells. A rule-computed seasonal prior (see below) fills the rest and is only load-bearing beyond Disney's publication window. This gives a usable forecast with zero observed history on day one.
3. **Reuse the existing keep-alive cron; no worker, no in-process timer, never user-driven.** The deployment already runs an external keep-alive cron; point it at the authenticated `/internal/sampling/run` endpoint so a single ping both keeps the box awake and collects data. The endpoint is **idempotent and self-throttling** — it samples waits at most once per a short debounce window and refreshes schedule/LL signals at most daily. The debounce exists only to absorb accidental rapid re-fires (a double-fire or a manual trigger); it MUST stay well below the keep-alive cadence so **every** keep-alive pass samples (R2.4). Critically, the debounce window must not equal the cron interval and must be measured from the pass **start**, not its completion — an equal-to-interval window stamped at completion lands every alternate cron hit just under the threshold and silently halves the effective sampling rate. It **returns immediately (`202`) and runs the pass asynchronously in-process**, so a slow ThemeParks.wiki response never delays or times out the calling cron; an overlap guard prevents concurrent passes. This avoids a BullMQ worker (whose continuous Redis polling would exhaust the free Upstash budget) and avoids an in-process timer (which only fires while awake and merely duplicates the keep-alive). Collection is independent of app usage; missed passes degrade gracefully.
4. **Recency-weighted updates.** Shapes, the season store, and the crowd index update via EMA (or capped count) so recent observations dominate and the model tracks Disney's operational changes.
5. **Reuse existing services.** Live waits/forecasts/hours come from the existing `Live_Service`; the Enterprise_Id → ThemeParks GUID mapping reuses the existing `themeParksDirectory`; coordinates come from `experiences.latitude/longitude`; the WDW calendar day comes from `wdwClock`.
6. **Pure math, testable.** Normalization, EMA, crowd-multiplier, forecast-from-features, and tier selection live in pure modules with no I/O, so they are deterministic and property-testable; the services pass in prefetched data.
7. **Frozen-forecast calibration loop.** Forecasts are captured at fixed lead times and stored as-issued, then reconciled against the observed index after the day closes. This measures true forecast error (not a hindsight recompute), and the resulting per-park/per-lead-time bias is fed back as a bounded correction — so the forecast self-tunes rather than only accumulating data.
8. **Rich per-ride signals captured from the same feeds.** Single-rider wait, Lightning Lane return/availability/sell-out, virtual-queue status, operating status/downtime, showtimes, and per-ride LL price all come from the live and schedule feeds already fetched each pass, so capturing them is near-free. Several are correctness-critical: virtual-queue rides have no standby line and shows use showtimes, so the snapshot must carry them or consumers would mis-model those experience types.
9. **Weather as a near-term adjustment.** Observed weather for the single WDW location is captured each pass from Open-Meteo (free, keyless); a per-ride weather sensitivity is learned (outdoor rides empty in rain, indoor rides fill). For dates inside the ~14-day forecast horizon, the prediction applies a bounded weather adjustment; beyond the horizon it is a no-op (weather is unknowable far out). One location fetch per pass, forecast refreshed daily.
10. **Derived stats and cross-ride effects, tiered by cost.** Dispersion (stddev/CV, p50/p90) and downtime rate live alongside the shape; best/worst hour, rope-drop escalation, and peak window are pure read-time derivations (no storage). Event-window wait dips and cascade (ride-down → neighbor spikes) are learned by correlation and recomputed at a **reduced daily cadence** because they are heavier; they surface as insights and MAY feed bounded same-day prediction adjustments. All bounded per decision 4/§Data Models.
11. **Crowd index over a standby basket, measured relatively (R2.7/R2.8).** The observed Crowd_Index counts only Experiences that post a standby queue — shows, dining, and parades are excluded — and is the mean of each ride's observed-vs-its-own-expected ratio, **not** a raw average of posted minutes. In practice ~75–90% of a park's operating live entries are no-queue zeros (shows, restaurants, pavilions), and the old all-entries average let them compress the index's range and make busy parks read as "empty" (Magic Kingdom averaging ~10 min, EPCOT ~5.6). The per-ride-relative form is also robust to *which* rides happen to be operating. The **same standby-queue predicate** gates raw-sample storage, so structurally-zero rows are neither aggregated nor written to `wait_samples` — bounding raw-sample growth. A walk-on 0-min ride stays in the basket (real low-crowd signal); exclusion is by absence of a standby queue, not by a zero value.

## Architecture

```mermaid
graph TD
    Cron[External keep-alive cron] -->|POST /internal/sampling/run| API[API]
    API --> Sampling[samplingService]
    Sampling -->|posted waits| Live[Live_Service / ThemeParks.wiki]
    Sampling -->|schedule + LL price| Sched[ThemeParks schedule endpoint]
    Sampling -->|EMA| Shapes[(ride_shapes)]
    Sampling -->|EMA| Season[(experience_season_hour)]
    Sampling -->|EMA| Crowd[(park_crowd_index)]
    Sampling --> SigStore[(park_schedule_signals)]
    Pred[predictionService] --> Shapes
    Pred --> Season
    Pred --> Crowd
    Pred --> SigStore
    Pred --> Live
    Calendar[Crowd Calendar UI] -->|GET /crowd-calendar| API --> Pred
    Planner[Day Planning optimizer] -->|getDaySnapshot / crowdMultiplier| Pred
    Seed[seed scripts] -.one-time.-> Shapes
```

## Components and Interfaces

### Pure modules (`services/intelligence/`)

- `waitMath.ts` — `applyEma(prev, sample, weight)`, `emaVariance(...)` (streaming stddev/CV), `normalizeCrowdIndex(dailyAvg, parkDistribution)` (returns a **continuous** value), `crowdMultiplier(forecastContinuous, typicalContinuous)` (consumes the continuous values, never a rounded 1–10), `displayLevel(continuousIndex)` (the *only* place a 1–10 integer is produced, for rendering), `selectTier(seasonBucket, shapeBucket, parkTypical, threshold)`, and `weatherAdjustment(sensitivity, forecastCondition)` — a bounded multiplier that is 1.0 (no-op) when no in-horizon forecast exists. Plus, for the crowd-index refinement (R2.7/R2.8): `isStandbyBasketEntry(liveEntry)` — a pure predicate, true iff the entry is operating AND exposes a numeric standby wait (walk-on 0 included), used both to filter the crowd-index basket and to gate `wait_samples` recording; and `relativeCrowdIndex(rides)` — the mean of per-ride `observed / expected` ratios over basket-eligible rides (expected from Ride_Shape; a ride is excluded when its shape sample count is below `CROWD_INDEX_MIN_SHAPE_SAMPLES` or its expected ≤ 0), returning the continuous ratio (1.0 = typical) that `displayLevel` rounds at render only.
- `derivedStats.ts` — pure read-time derivations over a Ride_Shape: `bestWorstHours`, `escalationRate`, `peakWindow` (park aggregate), and `coefficientOfVariation` from mean/stddev. **`escalationRate` is a signed minute delta** (a morning slope: the predicted-wait change from the first to the second operating hour) — NOT a ratio. Consumers MUST treat it as minutes: a rope-drop-favorable verdict keys off a steep positive climb (default threshold `ROPE_DROP_ESCALATION_MINUTES = 15`), never off a bare `> 1.5` comparison.
- `crowdForecast.ts` — `forecastIndex(features)` from Schedule_Signal + calendar features, with the calibration bias correction applied (on the **continuous ratio scale**, clamped to the ratio band `[0.4, 3.0]` per R2.6 — NOT `[1,10]`, and never floored at 1.0); deterministic and property-testable.
- `calibration.ts` — `updateAccuracy(prev, error, weight)` (recency-weighted MAE + bias) and `applyBiasCorrection(rawIndex, bias)` clamped to the ratio band `[0.4, 3.0]` per R2.6 (the 1–10 scale is display-only via `displayLevel`).
- `seasonalPrior.ts` — `seasonalPrior(date)` computed by rule per year, **not** hardcoded: US federal holidays via nth-weekday formulas, Easter via the Computus algorithm, an Easter-anchored spring-break window, plus summer / winter / Thanksgiving windows. Recomputes correctly every year, so it never goes stale. Weak feature within Disney's publication window; primary only for far-future dates.

### Services (`services/intelligence/`)

- `predictionService.ts` — `getDaySnapshot(experienceIds, date, park)` and `crowdMultiplier(park, date)`; applies same-day live correction (via `Live_Service`) for today/tomorrow, and — for dates inside the ~14-day forecast horizon — a bounded per-Experience weather adjustment; falls back to model + Standard Operating Hours.
- `weatherClient.ts` — thin wrapper over Open-Meteo (keyless) for the WDW location: current/observed conditions and the near-term daily forecast; base URL from config. Caches process-wide and refreshes at most once per `WEATHER_REFRESH_MS` (default 24h) with a 429 backoff + stale-serve fallback, so the shared per-IP rate limit is never tripped by per-pass/per-prediction fetches.
- `samplingService.ts` — `runSamplingPass()`: reads posted waits and additional per-ride signals (single-rider wait, Lightning Lane return/availability, virtual-queue/boarding-group status, operating status, showtimes) from the Live_Service feed, plus Schedule_Signals and per-ride LL price from the schedule endpoint. Records a standby (and single-rider) wait value only for operating rides that expose a posted standby queue — `isStandbyBasketEntry` (closed/down/refurbishment reads and no-standby entities like shows/dining/parades are skipped for both shape and `wait_samples` purposes), per-pass EMA-updates the shape and season stores and the rolling `experience_signals`, maintains `park_crowd_index` as a running **daily** aggregate whose per-pass slice is the **per-ride-relative** `relativeCrowdIndex` over the standby basket (mean of observed/expected ratios per R2.8 — not a raw average of minutes, and not a per-slice EMA), UPSERTs `experience_daily_signals`, records observed weather (one Open-Meteo fetch for the WDW location) and updates `experience_weather_sensitivity`, updates per-bucket `stddev_wait`/`down_rate` each pass, appends bounded raw samples, runs a reduced-cadence (daily) recompute of percentiles (`p50`/`p90` from retained samples), `experience_event_impact`, and `ride_cascade`, and runs the calibration steps — **capture** frozen forecasts for upcoming dates at the configured lead times into `crowd_forecast_log`, and **reconcile** newly-closed dates against their observed index (updating `crowd_forecast_accuracy` via EMA). Per-park failure isolation throughout.
- `IntelligenceRepo` — bounded snapshot reads and EMA UPSERTs.

### Routes

- `POST /internal/sampling/run` (and `HEAD /internal/sampling/run`) — cron-authenticated (shared `x-cron-secret`); idempotent and self-throttling (a start-stamped debounce below the keep-alive cadence so every pass samples per R2.4, refreshes schedule at most daily). Returns `202 Accepted` immediately and runs `runSamplingPass` asynchronously in-process (safe because Render runs a persistent Node process, not serverless), with an overlap guard and internal error handling, so a slow upstream never delays or times out the calling cron. Both methods share the same secret gate and async kick-off; **`POST` returns a tiny `{status:'accepted'}` body while `HEAD` returns headers only (no body)** — the keep-alive cron may target `HEAD` so its response can never be "too large". Intended target for the existing keep-alive cron.
- `GET /crowd-calendar?park&from&to` — session-authenticated; returns per-date forecast index, park hours, event flags, LL price, and best-park picks.
- `GET /experiences/:id/wait-insights?date=` — session-authenticated; serves `WaitInsightsDTO` for the requested date-context (defaulting to today when omitted). The service resolves the ride's `park` from `experiences.park` (via `IntelligenceRepo`) to pick the crowd multiplier — it does NOT resolve park through `themeParksDirectory` (which maps Enterprise_Id → GUID for live lookups, not experience → park) and MUST NOT fall back to a hardcoded park.

### Seed scripts (`apps/api/src/scripts/`)

- `seedShapes.ts` — maps each Experience via `themeParksDirectory.resolveEntityId(upstream_entity_id)` (Enterprise_Id → ThemeParks GUID == RopeDrop entity id), fetches RopeDrop `/api/analysis/ride/{guid}`, writes `(day_of_week, hour) → avg_wait` into `ride_shapes`. Identifying User-Agent + attribution. One-time; not in any request path.
- `seedCrowdIndex.ts` (optional) — seeds historical `park_crowd_index` from a free date-resolved source when available.

## Data Models

### Migration `0020_wait_time_intelligence.sql`

- **`ride_shapes`** — PK `(experience_id, day_of_week, hour)`; `avg_wait_minutes REAL`, `sample_count INTEGER`, plus nullable `sr_avg_wait_minutes REAL`, `sr_sample_count INTEGER` for the single-rider shape where offered, plus dispersion/reliability per bucket: `stddev_wait REAL` (EMA variance → CV), `p50_wait REAL`, `p90_wait REAL` (recomputed periodically from retained samples), and `down_rate REAL`. ~100×7×24 ≈ 17k rows.
- **`experience_season_hour`** — PK `(experience_id, season, day_of_week, hour)`; `avg_wait_minutes REAL`, `sample_count INTEGER`. Coarse `season` to densify faster; ~100×4×7×24 ≈ 67k rows. Starts empty; filled by sampling.
- **`park_crowd_index`** — PK `(park, date)`; `crowd_index REAL` (a **continuous** normalized value, not a 1–10 integer), `daily_avg_wait REAL` (the raw signal), `sample_count INTEGER`, and `source TEXT` (`observed` default | `seed`, added in `0021`). ~4 rows/day; the observed record and forecast trainer. The 1–10 shown in the UI is rounded from `crowd_index` at render time only. The rolling-baseline query filters `source='observed'`; the comparable-dates query includes seeds. **Basket & method (R2.7/R2.8):** `crowd_index` is a **per-ride-relative** aggregate — the mean over the Park's **standby basket** (only Experiences exposing a posted standby queue; shows / dining / parades / no-queue excluded) of each ride's observed standby wait ÷ its own Ride_Shape expected wait for that `(day_of_week, hour)`, over core hours, with a ride basket-eligible only once its Ride_Shape has ≥ `CROWD_INDEX_MIN_SHAPE_SAMPLES` samples. `daily_avg_wait` remains the basket's mean posted wait as an **informational signal only** — it is **no longer** the index numerator, so a park's low absolute average (historically dominated by no-queue zeros) can no longer read as "empty." Because the index is per-ride-relative it no longer needs a park-level typical, so `getParkRollingBaseline` is **removed** — its only production caller was the old numerator, and `ride_shapes` now supplies a finer per-ride, `(day_of_week, hour)`-resolved baseline. WHEN a pass's standby basket is empty (no ride yet has an eligible shape), the System writes **no** `crowd_index` slice for that pass and lets the forecast/seed carry the date, rather than falling back to a park-wide constant. A walk-on 0-min ride stays in the basket; a no-standby entity is never written to `wait_samples` at all.

**Park key (canonical).** The `park` column in every store (`park_crowd_index`, `park_schedule_signals`, `crowd_forecast_log`, `crowd_forecast_accuracy`) and every lookup MUST use the canonical `Park` enum value, mapped from the ThemeParks park name at ingestion via a single mapping helper. Storing raw ThemeParks names in one place and querying enum values (or hardcoded names) in another silently breaks the calibration reconcile and the calendar reads — writes and reads must agree on one key.
- **`park_schedule_signals`** — PK `(park, date)`; `open_time TIMESTAMPTZ`, `close_time TIMESTAMPTZ`, `early_entry BOOLEAN`, `extended_evening BOOLEAN`, `ticketed_event BOOLEAN`, `ll_multipass_price_cents INTEGER`. Keyed by park/date; refreshed each pass for the forward window.
- **`crowd_forecast_log`** — PK `(park, date, lead_days)`; `forecast_index REAL`, `forecasted_at TIMESTAMPTZ`, `observed_index REAL` (null until reconciled), `error REAL` (null until reconciled). The frozen forecast as issued; reconciled after the date closes; pruned beyond a retention window.
- **`crowd_forecast_accuracy`** — PK `(park, lead_days)`; `mae REAL`, `bias REAL`, `sample_count INTEGER`. Recency-weighted rolling accuracy that feeds the bias correction.
- **`experience_signals`** — PK `experience_id`; slowly-changing rolling per-ride facts: `has_single_rider BOOLEAN`, `uses_virtual_queue BOOLEAN`, `downtime_rate REAL`, `ll_sellout_median_hour REAL`, `sample_count INTEGER`. One row per experience (~100 rows).
- **`experience_daily_signals`** — PK `(experience_id, date)`; per-date facts from the live/schedule feeds: `ll_price_cents INTEGER`, `ll_available BOOLEAN`, `used_virtual_queue BOOLEAN`, `showtimes JSONB` (for shows). Pruned to a forward + recent window.
- **`weather_observations`** — PK `observed_at` (one WDW location); `temp_f REAL`, `precip REAL`, `condition TEXT`. Bounded recent-window retention; plus a small cached near-term forecast (by date).
- **`experience_weather_sensitivity`** — PK `(experience_id, condition)`; `wait_multiplier REAL` versus a clear-sky baseline, `sample_count INTEGER`. ~100 rides × few conditions ≈ small, bounded.
- **`experience_event_impact`** — PK `(experience_id, event_type)`; `wait_multiplier REAL` during nearby entertainment vs baseline, `sample_count INTEGER`. Learned from showtimes + waits.
- **`ride_cascade`** — PK `(down_experience_id, affected_experience_id)`; `wait_delta REAL`, `wait_pct_delta REAL`, `baseline_wait REAL`, `sample_count INTEGER`. Same-park pairwise effect of a breakdown; recomputed at reduced cadence (daily). Bounded to same-park pairs.
- **`wait_samples`** — `(experience_id, observed_at, wait_minutes, status)`; pruned to a bounded recent window.

### Migration `0021_crowd_index_source.sql`

Adds `source TEXT NOT NULL DEFAULT 'observed' CHECK (source IN ('observed','seed'))` to `park_crowd_index` so the one-time historical backfill (Task 7.2, from WDW Passport) can be stored without skewing each park's own rolling baseline. `getParkRollingBaseline` filters `WHERE source='observed'`; `getComparableCrowdIndices` (the forecast's year-over-year feature) intentionally includes both. Seeded rows carry `daily_avg_wait=0`, `sample_count=0`, `source='seed'`. Because seeds are past-dated and live sampling only writes today/forward, the two never collide on the `(park, date)` PK.

### Shared DTOs (`@dwt/shared`)

- `CrowdCalendarDayDTO` — `{ date, park, forecastIndex, observedIndex?, parkHours, earlyEntry, extendedEvening, ticketedEvent, llMultipassPriceCents?, festival? }`, plus optional per-ride surfacing of reliability, typical LL sell-out hour, and showtimes in the day-detail projection.
- `WaitSnapshot` — per-experience view carrying, per hour, the predicted standby wait, plus the single-rider wait (when offered), `isVirtualQueue`, `showtimes` (for shows), and Lightning Lane info — so consumers model each experience type correctly. Consumed internally and by Day Planning.
- `WaitInsightsDTO` — per-ride derived wait insights for the "When to ride" surface (named *wait insights*, distinct from the personal Stats tab): `p50`/`p90` (day-representative percentiles, aggregated across the day's operating-hour buckets — NOT read from a single arbitrary hour bucket such as `shape[0]`) and coefficient of variation, `bestHour`/`worstHour`, `escalationRate` (rope-drop value), reliability (`downRate`), typical LL sell-out hour, and event/cascade highlights. It also carries the fields the UI needs so it never hardcodes or fabricates values: `waits` (the real per-hour predicted-wait curve for the requested date-context — the always-visible forecast chart binds to this, per R11.11), `sampleCount` (the representative bucket sample count backing the verdict, so the UI can scale the verdict's certainty per R11.11 alongside `cv`), `hasSingleRider` and `singleRiderP50WaitMinutes?` (to render the single-rider decision helper's estimated time saved per R11.9 — absent when the ride has no single-rider line), and `llMultipassPriceCents?` (the ride's Lightning Lane price for the LL decision helper — the UI MUST render this, not a hardcoded price). The ride's `park` used to compute the crowd multiplier for this DTO is resolved from `experiences.park` (via the repo), never from a fabricated directory method or a hardcoded park default.

## Correctness Properties

### Property 1: Prediction picks the most specific reliable tier and is never unusable
*For any* experience/date/hour, `getDaySnapshot` returns a finite non-negative wait, preferring the season-resolved bucket when it clears the threshold, else `shape × crowd`, else park-typical — never a thinner tier over a denser one.

**Validates: Requirements 1.1, 4.1**

### Property 2: EMA update is recency-weighted and bounded
*For any* sequence of samples, `applyEma` yields a value within the observed range, weights the newest sample no less than any older one, and never lets `sample_count` exceed its cap.

**Validates: Requirements 3.5, 3.6**

### Property 3: Crowd index is continuous and monotonic; display rounding is separate
*For any* daily average and park distribution, `normalizeCrowdIndex` returns a **continuous** value non-decreasing in the daily average; `displayLevel` maps that continuous value to an integer in [1, 10], monotonically, and is the only producer of the 1–10 value. No calculation consumes `displayLevel`'s output.

**Validates: Requirements 2.1**

### Property 4: Crowd forecast is defined with zero history
*For any* date with only Schedule_Signal and calendar features (no observed index), `forecastIndex` returns a finite, positive continuous **ratio** in `[0.4, 3.0]` (1.0 = typical) — quieter-than-typical inputs yield a value **below 1.0**, i.e. it is not floored at typical. `crowdMultiplier` is computed from continuous ratios and falls back to 1.0 only when neither forecast nor history exists.

**Validates: Requirements 2.3, 2.4, 2.6**

### Property 5: Sampling failure is isolated
*For any* pass where one park's fetch fails, the other parks' stores are still updated and the failure is recorded.

**Validates: Requirements 3.7**

### Property 6: Calibration reconciles by key and stays bounded
*For any* captured forecast and later observed index, reconciliation pairs them by `(park, date, lead_days)` and records `error = forecast − observed`; `updateAccuracy` keeps a recency-weighted MAE/bias, and `applyBiasCorrection` returns a continuous ratio clamped to the ratio band `[0.4, 3.0]` (ratio-scale units — NOT [1, 10]).

**Validates: Requirements 7.1, 7.2, 7.3, 7.4**

### Property 7: Weather adjustment is bounded and horizon-limited
*For any* Experience and date, `weatherAdjustment` returns a bounded multiplier, and returns exactly 1.0 (no effect) when the date is outside the forecast horizon or no sensitivity is known — so weather never distorts a far-future prediction.

**Validates: Requirements 10.3, 10.4**

### Property 8: Derived statistics are internally consistent
*For any* Ride_Shape bucket, `p50 ≤ p90`, the coefficient of variation is finite and non-negative, `down_rate ∈ [0, 1]`, and `derivedStats` functions return values within the shape's own range (best/worst hour are actual hours; escalation is a difference of in-range waits).

**Validates: Requirements 11.1, 11.2**

### Property 9: Crowd index measures the standby basket, relatively, and is composition-robust
*For any* set of rides with observed and expected waits, `relativeCrowdIndex` (a) ignores rides whose expected baseline is absent, expected ≤ 0, or Ride_Shape sample count is below `CROWD_INDEX_MIN_SHAPE_SAMPLES`; (b) returns `1.0` when every included ride sits exactly at its expected wait; (c) is non-decreasing in any included ride's observed wait; and (d) is **unchanged by adding a ride that is exactly at its expected level** — so a park's index does not move merely because more at-typical or no-wait entries are operating.

**Validates: Requirements 2.7, 2.8**

### Property 10: Only standby-queue entries are sampled
*For any* Live_Service entry, `isStandbyBasketEntry` is `true` iff the entry is operating AND a numeric standby wait is posted (a walk-on `0` included) and `false` for entries with no standby queue or a non-operating status; consequently the pass contributes a `wait_samples` row and a crowd-index term for exactly the entries it selects — never for a no-standby entity (show / dining / parade).

**Validates: Requirements 3.5, 2.7**

## Error Handling

- **Slow/failing upstream during a pass:** the endpoint has already returned `202`, so the caller is never blocked; the pass runs async, bounded by the Live_Service deadline, and isolates the failing park (Property 5). Errors are logged, not surfaced to the cron.
- **Live_Service / schedule timeout or failure (prediction path):** best-effort within the existing deadline; prediction falls back to the model + Standard Operating Hours.
- **Missing LL price / schedule gap for a date:** the forecast uses the remaining features; a null LL price is treated as "unknown," not zero.
- **Thin or empty stores:** tier fallback (Property 1) and neutral 1.0 multiplier (R2.4) keep predictions finite.
- **Seed unavailable:** non-fatal; the model starts from park-typical shapes + Schedule_Signal forecast (R5.3).

## Testing Strategy

- **Property-based (`fast-check`, ≥100 runs, tagged `Feature: crowd-calendar, Property N`):** the properties above, against `waitMath.ts` and `crowdForecast.ts` — including **Property 9** (`relativeCrowdIndex` composition-robust) and **Property 10** (`isStandbyBasketEntry` selects only posted-standby entries).
- **Crowd-index basket (regression):** a repo/`server.inject` test drives a sampling pass over a mixed park (a headliner ride, a walk-on 0-min ride, a show, and a restaurant) and asserts `wait_samples` is written **only** for the two rides and that `crowd_index` is the per-ride-relative aggregate over them. This test MUST fail against the pre-change all-entries average (which read the show/restaurant zeros and understated the park), so it genuinely guards the fix.
- **Migration test (`migration0020.test.ts`):** all stores, PKs, and bounded retention.
- **Integration (`server.inject`):** `/internal/sampling/run` updates stores and isolates a failing park; `/crowd-calendar` returns forecast + signals and is session-gated; same-day correction path in `predictionService`.
- **Unit:** `crowdForecast` feature weighting (LL price / park hours / holidays / school breaks), the seed script's RopeDrop mapping, and `normalizeCrowdIndex`.
- **Mobile:** the calendar month view, day-detail, best-park pick, and predicted-vs-actual rendering.

## UI Surfaces & Navigation

Two mobile surfaces, placed on existing navigation (no new tab — the bottom bar stays Home / Catalog / Trips / Friends / Profile):

- **Crowd Calendar** — a new `CrowdCalendar` screen registered in the **Catalog stack** (`CatalogStack`), entered via a prominent "Plan your visit" card on the **Home** screen. It hosts the month view (per-park 1–10 coloring, best-park/best-days picks) and pushes a day-detail view (per-park index, park hours, Early Entry / Extended Evening / party flags, LL Multi Pass price, festival, near-term forecast weather, and captured-forecast-vs-actual + accuracy for past dates). Served by `GET /crowd-calendar`.
- **When to ride (wait insights)** — a new section on the existing root-level `ExperienceDetailScreen`, which already shows the live wait. It is **date-contextual** (a Now / trip-date / typical switcher — never an arbitrary fixed date, R11.8) and leads with an **actionable best-time-to-ride verdict** rather than a raw chart. The verdict's **tone scales with confidence** (R11.11) — prescriptive when data is dense ("Ride after 8 PM"), observational when thin ("Evenings are usually calmer") — and never uses apologetic/doubt copy; uncertainty lives in the chart, not the headline. Below it: the forecast curve for the chosen date, **decision helpers** (Lightning Lane time-saved-vs-price and single-rider tradeoffs, R11.9), and secondary insights (typical/worst p50/p90, reliability, LL sell-out, event/cascade dips). Two actions bridge outward: **"Add to my plan"** inserts the ride into a Trip's `TripSchedule` at its recommended time, and an optional **wait-drop alert** (R11.10). Served by `GET /experiences/:id/wait-insights`. Named *wait insights* to stay distinct from the personal **Stats** tab (own tracking), a different domain.

Model internals (weather sensitivity, calibration bias, cascade/event correlation tables, EMA counts, seasonal-prior weights, raw per-date LL prices) are inputs that sharpen the rendered numbers; they are not their own screens.

## Configuration & Constants

Concrete defaults so nothing is left to guess. Override via env where noted.

### Env vars
- `SAMPLING_CRON_SECRET` (required) — shared secret the keep-alive cron sends (e.g. `X-Cron-Secret` header) to authenticate `POST /internal/sampling/run`. Fail the request `401` if absent/mismatched.
- `THEMEPARKS_BASE_URL` — already present; default `https://api.themeparks.wiki/v1`.
- `OPEN_METEO_BASE_URL` — default `https://api.open-meteo.com/v1` (keyless).
- `WEATHER_REFRESH_MS` — how long the weather client caches before re-fetching; default `86400000` (24h). Kept high because Open-Meteo rate-limits per IP and Render's free tier shares outbound IPs.
- `ROPEDROP_BASE_URL` — one-time seed only; default `https://ropedropplanner.com/api`. Used by `seedShapes.ts` to fetch `/analysis/ride/{guid}`; not on any request path.
- `CROWD_SEED_DIR` — one-time seed only; directory of saved WDW Passport month-page HTML files that `seedCrowdIndex.ts` parses locally (default `apps/api/seed-data/crowd/`). Not on any request path; the app never fetches the site.
- `ROPEDROP_BASE_URL` — default `https://ropedropplanner.com/api` (seed script only; not read at request time).
- `SEED_USER_AGENT` — identifying UA + contact for the one-time RopeDrop seed, e.g. `DisneyApp/1.0 (you@example.com)`. **Mandatory** — RopeDrop returns `403` for bare/generic user agents.
- `SEED_DELAY_MS` — polite spacing between RopeDrop analysis requests during `seedShapes`; default `2100` (RopeDrop limits `/api/analysis/*` to 30/min). One-time seed only.
- `SAMPLING_CRON_SECRET` — also required at boot for the sampling endpoint; must be present in every env file (`.env`, `.env.dev`) or the API/scripts fail to load config.

### Constants (defaults)
- **WDW location:** lat `28.3852`, lon `-81.5639` (single Open-Meteo point).
- **Sampling debounce:** at most once per `5` min, measured from the pass **start** — deliberately below the ~`10`-min keep-alive cadence so every keep-alive pass samples (R2.4). It must never equal the cron interval nor be stamped at pass completion: a `10`-min window stamped at completion drops every other `10`-min pass (~`20`-min effective rate). Refresh schedule/LL signals at most once per `24` h.
- **Core hours (crowd index):** `10:00`–`17:00` ET, operating rides only.
- **EMA:** shape/season/crowd updates use weight `alpha = 2 / (N + 1)` with `sample_count N` capped at `500` (≈ season-scale half-life; recent data dominates once mature).
- **Tier-1 reliability threshold:** a season-resolved bucket is used only at `sample_count >= 30`, else fall back to shape × crowd.
- **Crowd-index standby basket (R2.7/R2.8):** the observed Crowd_Index is computed only over Experiences that expose a posted standby queue (`isStandbyBasketEntry`), as the mean of per-ride `observed / expected` ratios; a ride is basket-eligible once its Ride_Shape has `CROWD_INDEX_MIN_SHAPE_SAMPLES = 5` samples (and expected > 0). The same standby-queue predicate gates `wait_samples` recording (R3.5), so no-standby entities (shows / dining / parades) are neither aggregated nor stored.
- **Wait-insights verdict confidence (R11.11):** high confidence at `sampleCount >= 30` and `cv <= 0.35` (prescriptive tone); low confidence at `sampleCount < 10` (soft/observational tone + "early estimate" chip); moderate otherwise. `sampleCount` and `cv` are aggregated across the day's operating-hour buckets, not a single hour.
- **Rope-drop verdict threshold:** `ROPE_DROP_ESCALATION_MINUTES = 15` — `escalationRate` (a signed minute delta) must climb at least this much from the first to second operating hour to favor a rope-drop verdict.
- **Season buckets:** 4 — Winter (Dec–Feb), Spring (Mar–May), Summer (Jun–Aug), Fall (Sep–Nov). Coarse on purpose so they densify.
- **Forecast capture lead times:** `[30, 14, 7, 3, 1]` days.
- **Weather forecast horizon:** `14` days; beyond it, weather adjustment = 1.0.
- **Bounds (clamps):** forecast index (continuous ratio, 1.0 = typical) `[0.4, 3.0]`; crowd multiplier `[0.4, 2.0]`; weather adjustment `[0.75, 1.25]`; calibration bias correction `±0.5` **ratio-scale** units. All internal crowd values share the ratio scale; `displayLevel` (`round(5 × ratio)`, clamped 1–10) is the only conversion to the display scale.
- **Standard Operating Hours fallback:** `9:00 AM`–`9:00 PM` ET.
- **Cadences:** percentiles, `experience_event_impact`, and `ride_cascade` recompute once per `24` h; sampling every pass.
- **Retention:** `wait_samples` pruned to `30` days; `crowd_forecast_log` retained until reconciled + `90` days; `experience_daily_signals` retained `400` days (year-over-year), forward window `120` days.
- **Money:** all prices stored in integer cents.
- **Historical crowd seed (WDW Passport):** convert their 1–10 level to a ratio via `crowd_index = clamp(level / 5, 0.4, 3.0)` (level 5 ≈ typical, ratio 1.0). Seeded rows use `source='seed'`, `daily_avg_wait=0`, `sample_count=0`; ~2 recent years (post-2021 to avoid COVID distortion) is ample for the comparable-dates feature.

## External Interfaces

Endpoint shapes and the id-mapping relied on. Live/schedule reads go through the existing `Live_Service`; the seed script is standalone.

### Id mapping (critical)
`experiences.upstream_entity_id` holds the **Enterprise_Id** (== ThemeParks `externalId`, e.g. `411499845;entityType=Attraction`). The ThemeParks entity **GUID** is obtained via `themeParksDirectory.resolveEntityId(enterpriseId)`. RopeDrop's `entity_id` **is** that GUID. Never join RopeDrop on `upstream_entity_id` directly.

### ThemeParks.wiki — live (`GET {THEMEPARKS_BASE_URL}/entity/{guid}/live`)
Fields used per attraction: `status` (`OPERATING`/`CLOSED`/`DOWN`/`REFURBISHMENT`), `queue.STANDBY.waitTime`, `queue.SINGLE_RIDER.waitTime`, `queue.PAID_RETURN_TIME`/`queue.RETURN_TIME` (Lightning Lane), `queue.BOARDING_GROUP` (virtual queue), `showtimes[]`, `operatingHours[]`, `forecast[]`. Prefer the park-level live feed to get all attractions in one call.

### ThemeParks.wiki — schedule (`GET {THEMEPARKS_BASE_URL}/entity/{parkGuid}/schedule`)
`schedule[]` entries: `date`, `type` (`OPERATING` | `TICKETED_EVENT`), `openingTime`, `closingTime`, `description` (`Early Entry` | `Extended Evening` | `Special Ticketed Event`), and `purchases[]` `{ id, name, type, price.amount (cents), available }`. LL Multi Pass price = the purchase named `Lightning Lane Multi Pass`; per-ride LL price = `Lightning Lane for {ride}`. Park GUIDs (MK/EPCOT/HS/AK) resolved via the directory (EPCOT is `47f90d2c-e191-4239-a466-5892ef59a88b`).

### RopeDrop — seed only (`GET {ROPEDROP_BASE_URL}/api/analysis/ride/{entity_id}`) — VERIFIED against live API
Documented at `ropedropplanner.com/developers` (no API key). **`entity_id` == the ThemeParks entity GUID** (confirmed: Space Mountain/Test Track/Rock 'n' Roller Coaster all resolve via `themeParksDirectory.resolveEntityId`), so the original mapping is correct — do NOT change it. Response fields used:
- **`best_worst_hours[]`** `{ entity_id, name, park, dow, hour_et, avg_wait, n }` — the `(day_of_week, hour)` shape. **`dow` is BigQuery `DAYOFWEEK`: 1=Sunday … 7=Saturday**, so map to our `day_of_week` (JS `getDay`, 0=Sunday) with **`day_of_week = dow - 1`**. `hour_et` is 0–23. Use `n` as the initial `sample_count`. (Feeding the raw `dow` (1–7) violates the `ride_shapes` `CHECK(0..6)` and silently zeroes the seed — that was the real seed bug, not the id.)
- Bonus fields available from the same payload (optional future use): `weather[]` (per-condition avg wait → `experience_weather_sensitivity`), `downtime_by_hour[]` (`down_rate` per hour), `cascade_as_down[]` / `cascade_as_affected[]` (→ `ride_cascade`).

Operational rules (from the developers page):
- **User-Agent is mandatory:** bare/generic UAs (`curl`, `python-requests`, empty) get **403**. Send `SEED_USER_AGENT` = `AppName/1.0 (you@example.com)`.
- **`404` is normal and expected** for entities without pre-computed analysis (minor attractions, restaurants, shops, no-standby entities) — skip and continue; it is NOT an error.
- **Rate limit `/api/analysis/*` is 30/min** with a `Retry-After` header on `429`; the seed spaces requests ~2.1s (`SEED_DELAY_MS`, default 2100) and backs off on 429. A full WDW pass takes ~30–40 min.
- Ride/park listing + live waits: `GET /api/parks/wait-times?park_id={slug}` returns an object keyed by `entity_id` (slugs: `magic_kingdom`, `epcot`, `hollywood_studios`, `animal_kingdom`). Not needed for the shape seed (we already map via the directory) but useful for verification.

### WDW Passport — historical crowd-index seed only (local HTML files, NOT a runtime fetch)
The site bot-blocks automated requests, so it is **never** contacted from the app or any request path. A developer saves the **month** pages (`https://wdwpassport.com/past-crowds/{month}-{year}`, e.g. `june-2026`) once from a browser into `CROWD_SEED_DIR`; `seedCrowdIndex.ts` parses those local files. Each month page is server-rendered HTML with one `<a href=".../past-crowds/{month}-{year}/{day}">` per day; inside, a `<ul>` lists the four parks, each as `<h4>{park}</h4>` followed by `<div class="crowd-bubble-level-{n} …">{n}</div>` — a **1–10** crowd level. Park-name map to the `Park` enum: `Magic Kingdom`→`Magic Kingdom`, `Epcot`→`EPCOT`, `Hollywood Studios`→`Hollywood Studios`, `Animal Kingdom`→`Animal Kingdom` (ignore any others). Conversion to our continuous scale: `crowd_index = clamp(level / 5, 0.4, 3.0)` (their level 5 ≈ our typical day, ratio 1.0). This is an approximation across two different index definitions, so seeded rows are marked `source='seed'` and feed only the comparable-dates history — never the park's rolling baseline (which stays on observed data). Licensing is the developer's responsibility; one-time, human-in-the-loop.

### Open-Meteo (`GET {OPEN_METEO_BASE_URL}/forecast`)
Params `latitude`, `longitude`, `current=temperature_2m,precipitation,weather_code`, `daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum`, `temperature_unit=fahrenheit`, `precipitation_unit=inch`, `timezone=America/New_York`, `timeformat=unixtime`, `forecast_days=14`. Map `weather_code` to a coarse condition (`clear` / `cloudy` / `rain` / `storm`). **Use `timeformat=unixtime`** and parse times as `new Date(seconds*1000)` — a zoneless local-time string is otherwise parsed in the *server's* timezone (wrong instant on a UTC host). **The client caches its result process-wide and refreshes at most once per `WEATHER_REFRESH_MS` (default 24h)**, de-dupes concurrent callers, retries on `429` with `Retry-After`/backoff, and serves the stale cache when a refresh fails. This matters because Open-Meteo rate-limits per IP and Render's free tier shares outbound IPs — fetching per pass/prediction triggers `429`s. Historical seeding (optional) uses the Open-Meteo archive API.

## Forecast Model (concrete starting formula)

A multiplicative model on the **continuous** crowd index (1.0 = a typical day for that park + day-of-week). Tune later; this is the explicit starting point.

```
featureModel(park, date) =
  typical(park, dowOf(date))                         // continuous baseline (history or 1.0)
  × clamp(llMultipassPrice / trailingMedianPrice, 0.7, 1.4)
  × clamp(openHours / typicalOpenHours, 0.9, 1.2)
  × (extendedEvening ? 1.1 : 1.0)
  × seasonalPrior(date)                              // holidays/breaks, ~[0.8, 1.6]

forecastIndex = w · historyEstimate(park, date-features) + (1 - w) · featureModel(park, date)
              − biasCorrection(park, leadDays)       // ratio-scale units; bias clamp ±0.5
   where w = min(1, comparableSampleCount / 20)      // lean on history as it accrues
forecastIndex = clamp(forecastIndex, 0.4, 3.0)       // continuous RATIO band — NOT [1,10], NOT floored at 1.0

crowdMultiplier(park, date) = clamp(forecastIndex / typical(park, dowOf(date)), 0.4, 2.0)

predictedWait(ride, date, hour) =
  max(0, tierValue(ride, date, hour) × crowdMultiplier × weatherAdjustment × eventAdjustment)

displayLevel(continuousIndex) = clamp(round(5 × continuousIndex), 1, 10)   // display only; sole ratio→1–10 conversion
```

**Scale convention (canonical).** Every internal crowd value — `normalizeCrowdIndex` output, `forecastIndex`, `historyEstimate`, `typical`, and the calibration bias — is on **one continuous ratio scale where 1.0 = a typical day**; quiet days are < 1.0 and must stay representable. `forecastIndex` is therefore clamped to the ratio band `[0.4, 3.0]`, never `[1, 10]` and never floored at 1.0. The 1–10 value exists only as `displayLevel`'s output and is never fed back into any calculation.

`tierValue` is the most-specific reliable tier (season-resolved direct → shape × crowd → park-typical, R1.1). `weatherAdjustment`/`eventAdjustment` default to 1.0 when unavailable or out of horizon.

## Cross-Spec Dependencies & Build Order

Build this feature **before** `day-planning-optimization`, which consumes `predictionService.getDaySnapshot()` / `crowdMultiplier()`. This feature owns migration `0020`; the day planner owns `0021`. No other spec depends on this one.
