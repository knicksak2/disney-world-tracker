# Implementation Plan: Crowd Calendar and Wait-Time Intelligence

## Overview

This plan builds the shared prediction foundation bottom-up: the intelligence migration and shared contracts first, then the pure math (EMA, normalization, crowd forecast, tier selection) property-tested with no I/O, then the collection pass (sampling + schedule/LL ingestion) and the prediction service, then the read API and the Crowd Calendar mobile UI, and finally the one-time seed. The Day Planning feature depends on this and consumes `predictionService`.

Implementation is **TypeScript**, reusing existing infrastructure: the `Live_Service` (ThemeParks.wiki) for posted waits and the `/entity/{park}/schedule` feed for park hours, event flags, and Lightning Lane Multi Pass price; `themeParksDirectory` for the Enterprise_Id → GUID mapping; `wdwClock` for the WDW calendar day; `experiences.latitude/longitude` for coordinates. Collection is driven by the deployment's existing external cron via one `/internal/sampling/run` endpoint — no always-on worker.

## Tasks

- [ ] 1. Migration and shared contracts
  - [ ] 1.1 Add migration `0020_wait_time_intelligence.sql`
    - Create `ride_shapes` (incl. single-rider + dispersion columns: `stddev_wait`, `p50_wait`, `p90_wait`, `down_rate`), `experience_season_hour`, `park_crowd_index`, `park_schedule_signals`, `crowd_forecast_log`, `crowd_forecast_accuracy`, `experience_signals`, `experience_daily_signals`, `weather_observations`, `experience_weather_sensitivity`, `experience_event_impact`, `ride_cascade`, and bounded-retention `wait_samples`. `BEGIN/COMMIT`, CHECK constraints, composite PKs, inline comments.
    - _Requirements: 1.2, 1.4, 2.1, 3.1, 3.6, 7.1, 7.3, 9.2, 9.3, 9.4, 10.1, 10.2, 11.1, 11.3, 11.4_
  - [ ] 1.2 Add `@dwt/shared` DTOs
    - `CrowdCalendarDayDTO`, `WaitSnapshot`, and `WaitInsightsDTO` (+ Zod validators, index exports) in `packages/shared`; `WaitSnapshot` carries per-hour standby wait, single-rider wait, `isVirtualQueue`, `showtimes`, and Lightning Lane info; `CrowdCalendarDayDTO` day-detail surfaces reliability, LL sell-out hour, and showtimes; `WaitInsightsDTO` carries p50/p90, CV, best/worst hour, escalation, reliability, and event/cascade highlights.
    - _Requirements: 4.1, 6.1, 6.2, 9.5, 9.6, 11.5_

- [ ] 2. Pure math (`services/intelligence/`)
  - [ ] 2.1 `waitMath.ts` + `calibration.ts` + `derivedStats.ts` — EMA and streaming variance (stddev/CV), continuous crowd-index normalization + a separate `displayLevel` 1–10 rounding (display-only, never fed back), continuous crowd multiplier, tier selection; recency-weighted MAE/bias update and bounded bias correction; bounded, horizon-limited `weatherAdjustment` (1.0 no-op outside the forecast horizon or with no known sensitivity); pure read-time `bestWorstHours`, `escalationRate`, `peakWindow`.
    - _Requirements: 1.1, 2.1, 2.4, 3.3, 7.3, 7.4, 10.3, 10.4, 11.1, 11.2_
  - [ ] 2.2 `crowdForecast.ts` + `seasonalPrior.ts` — forecast index from Schedule_Signal + calendar features; seasonal prior computed by rule per year (nth-weekday holidays, Easter via Computus, Easter-anchored spring + summer/winter/Thanksgiving windows) — no hardcoded dates.
    - _Requirements: 2.2, 2.3, 2.5_
  - [ ] 2.3 Property tests for the pure math
    - **Property 1: Prediction picks the most specific reliable tier and is never unusable.**
    - **Property 2: EMA update is recency-weighted and bounded.**
    - **Property 3: Crowd index normalization is monotonic and bounded.**
    - **Property 4: Crowd forecast is defined with zero history.**
    - **Property 6: Calibration reconciles by key and stays bounded.**
    - **Property 7: Weather adjustment is bounded and horizon-limited.**
    - **Property 8: Derived statistics are internally consistent.**
    - _Requirements: 1.1, 2.1, 2.3, 2.4, 3.3, 7.1, 7.2, 7.3, 7.4, 10.3, 10.4, 11.1, 11.2_

- [ ] 3. Checkpoint — pure core complete
  - Ensure `waitMath` and `crowdForecast` property tests pass before wiring I/O; ask the user if questions arise.

- [ ] 4. Collection and prediction services
  - [ ] 4.1 `IntelligenceRepo` — bounded snapshot reads; EMA UPSERTs for shapes/season/crowd; schedule-signal UPSERTs; bounded `wait_samples` insert + prune.
    - _Requirements: 1.5, 3.5, 3.6_
  - [ ] 4.2 `samplingService.runSamplingPass` — read posted waits + per-ride signals (single-rider, LL return/availability, virtual-queue/boarding-group, operating status, showtimes) from Live_Service, plus schedule/LL signals and per-ride LL price (`/entity/{park}/schedule`); **per-pass** EMA-update `ride_shapes` (incl. single-rider), `experience_season_hour`, and rolling `experience_signals` — call the repo upserts, do not stub; compute `park_crowd_index` as a **running daily aggregate** (normalized average over core hours), NOT a per-slice EMA; UPSERT `park_schedule_signals` and `experience_daily_signals`; record observed weather (one `weatherClient` fetch for the WDW location — `experience_weather_sensitivity` is *learned* in 4.5, not here); update per-bucket `stddev_wait`/`down_rate` each pass; **capture** frozen forecasts at configured lead times into `crowd_forecast_log` and **reconcile** newly-closed dates into `crowd_forecast_accuracy`; skip closed/down/refurbishment reads for shape purposes; per-park failure isolation.
    - _Requirements: 3.1, 3.4, 3.5, 3.7, 7.1, 7.2, 7.3, 9.1, 9.2, 9.3, 9.4, 10.1, 11.1_
  - [ ] 4.3 `predictionService` + `weatherClient` — `getDaySnapshot` (tier selection) and `crowdMultiplier`; same-day live correction for today/tomorrow; **wire `historyEstimate` from accumulated observed `park_crowd_index` for comparable prior dates** (feature-model-only until data accrues — not hardcoded null); apply the bounded per-Experience weather adjustment for in-horizon dates (Open-Meteo forecast via `weatherClient`); `getCrowdCalendarDay` displays `displayLevel(forecast)` (imported from `waitMath`), NOT the clamped multiplier; fallback to model + Standard Operating Hours. (Event/cascade adjustments come once 4.5 populates them.)
    - _Requirements: 1.1, 2.2, 2.3, 4.1, 4.2, 4.3, 4.4, 10.3_
  - [ ] 4.4 Property test for sampling isolation + unit tests for prediction blending
    - **Property 5: Sampling failure is isolated.**
    - _Requirements: 3.5, 4.3_
  - [ ] 4.5 Reduced-cadence derived-stat recompute (daily) — percentiles (`p50`/`p90`) from retained samples, `experience_event_impact` (waits during nearby showtimes vs baseline), `ride_cascade` (same-park pairwise wait change when a ride is down), and `experience_weather_sensitivity` (per-condition wait multiplier vs clear-sky baseline, learned by joining waits to `weather_observations`). Bounded stores.
    - _Requirements: 11.3, 11.4, 10.2_

- [ ] 5. Routes
  - [ ] 5.1 `POST /internal/sampling/run` (+ `HEAD /internal/sampling/run`) — cron-authenticated (shared `x-cron-secret`); idempotent and self-throttling (sample at most once per interval, schedule refresh at most daily); returns `202` immediately and runs `runSamplingPass` asynchronously with an overlap guard + internal error handling, so a slow upstream never times out the keep-alive cron. `HEAD` shares the secret gate + async kick-off but replies headers-only (no body) so the cron's response can never be too large; `POST` returns a tiny `{status:'accepted'}`.
    - _Requirements: 3.1, 3.2, 3.9, 3.10_
  - [ ] 5.2 `GET /crowd-calendar?park&from&to` — session-authenticated; per-date forecast index, park hours, event flags, LL price, best-park picks, and observed-vs-forecast for past dates.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - [ ] 5.3 Integration tests (`server.inject`) for the routes (auth gates, prompt `202` ack, throttle skip, overlap guard, store updates, failure isolation).
    - _Requirements: 3.1, 3.7, 3.9, 3.10, 6.5_
  - [ ] 5.4 `GET /experiences/:id/wait-insights` — session-authenticated; serves `WaitInsightsDTO` (volatility/percentiles, best/worst hour, escalation, reliability, LL sell-out hour, event/cascade highlights).
    - _Requirements: 11.5_

- [ ] 6. Crowd Calendar mobile UI (`apps/mobile`)
  - [ ] 6.1 Month calendar per park (1–10 coloring) + best-park/best-days picks.
    - _Requirements: 6.1, 6.3_
  - [ ] 6.2 Day-detail view — per-park index, park hours, event flags, LL price, festival; per-ride reliability, typical LL sell-out hour, and showtimes; forecast weather for near-term dates; captured-forecast-vs-actual for past dates and a recent forecast-accuracy stat.
    - _Requirements: 6.2, 6.4, 7.5, 9.6, 10.5_
  - [ ] 6.3 "When to ride" wait-insights section on `ExperienceDetailScreen` — date-context switcher (Now / trip date / typical), a lead best-time-to-ride verdict whose certainty scales with data confidence (definitive → "usually" → soft pattern + "early estimate" chip; never self-disparaging copy), the always-visible forecast curve, Lightning Lane vs single-rider decision helpers, secondary insights (p50/p90 volatility, reliability, LL sell-out, event/cascade), an "Add to my plan" action into `TripSchedule`, and an optional wait-drop alert. Backed by `WaitInsightsDTO`.
    - _Requirements: 11.5, 11.8, 11.9, 11.10, 11.11_
  - [ ] 6.4 Component tests for calendar, day-detail, and wait-insights rendering.
    - _Requirements: 6.1, 6.2, 6.4, 11.5_

- [ ] 7. One-time seeds (`apps/api/src/scripts/`)
  - [ ] 7.1 `seedShapes.ts` — map Experiences via `themeParksDirectory.resolveEntityId` (Enterprise_Id → ThemeParks GUID == RopeDrop `entity_id`, verified), fetch `/api/analysis/ride/{entity_id}`, write `best_worst_hours` `(day_of_week, hour) → avg_wait` into `ride_shapes` with `n` as initial EMA weight. **Map `dow - 1`** (RopeDrop/BigQuery `DAYOFWEEK` 1=Sun → our 0=Sun; feeding raw `dow` breaks the `CHECK(0..6)`). Mandatory identifying User-Agent (bare UAs get 403). Treat `404` as "no analysis for this entity" and skip. Throttle ~2.1s + backoff on `429` (30/min limit). Non-fatal per ride. _(See the verified RopeDrop External Interfaces block in design.md.)_
    - _Requirements: 5.1, 5.3, 5.4_
  - [ ] 7.2 Historical crowd-index backfill (one-time, local-file importer — the input files are gathered by a human once; nothing hits the site at runtime).
    - [x] 7.2.1 Migration `0021_crowd_index_source.sql` — add `source TEXT NOT NULL DEFAULT 'observed' CHECK (source IN ('observed','seed'))` to `park_crowd_index`; `BEGIN/COMMIT`. Update `IntelligenceRepo.getParkRollingBaseline` to filter `WHERE source = 'observed'` so seeded history NEVER skews a park's own rolling baseline; `getComparableCrowdIndices` stays unfiltered so seeded history DOES feed the forecast's comparable-dates feature. Add a `upsertSeededCrowdIndices` (or extend the existing upsert) that writes `source='seed'`.
    - [x] 7.2.2 `seedCrowdIndex.ts` (+ extracted `seedCrowdIndexLogic.ts`) — parse saved WDW Passport month-page HTML files from `CROWD_SEED_DIR`; per day cell extract the date from the `/past-crowds/{month}-{year}/{day}` href and each park's 1–10 level from the `<li>`'s `<h4>{park}</h4>` + `crowd-bubble-level-{n}`; map park names to the `Park` enum (`Epcot`→`EPCOT`; skip water parks / unknown names), convert `crowd_index = clamp(level / 5, 0.4, 3.0)`, and upsert `park_crowd_index` with `source='seed'`, `daily_avg_wait=0`, `sample_count=0`. Per-file and per-row isolation (one malformed cell/file logs and continues). Extracted pure parser + unit test asserting date/park/level extraction, the `Epcot→EPCOT` map, the `level/5` clamp, and the `source='seed'` flag.
    - _Requirements: 5.2_

- [x] 8. Verification
  - [x] 8.1 `migration0020.test.ts` — stores, PKs, bounded retention.
    - _Requirements: 1.2, 1.4, 2.1, 3.6_
  - [x] 8.2 End-to-end manual pass — run a sampling pass against real ThemeParks data, confirm shapes/crowd/signals populate and the calendar renders sane 1–10 levels with LL-price-driven forecasts.
    - _Requirements: 2.2, 3.1, 6.1_

- [ ] 9. Crowd-index accuracy refinement — standby basket + per-ride-relative index
  - [x] 9.1 `waitMath.ts` pure additions — `isStandbyBasketEntry(liveEntry)` (true iff operating AND a numeric standby wait is posted; walk-on `0` included; false for no-standby / non-operating) and `relativeCrowdIndex(rides)` (mean of per-ride `observed / expected` ratios; exclude rides with expected ≤ 0 or Ride_Shape sample count `< CROWD_INDEX_MIN_SHAPE_SAMPLES`; `1.0` = typical). No I/O.
    - _Requirements: 2.7, 2.8, 3.5_
  - [x] 9.2 Property tests — **Property 9** (`relativeCrowdIndex` composition-robust) and **Property 10** (`isStandbyBasketEntry` selects only posted-standby entries); `fast-check` ≥100 runs, tagged `Feature: crowd-calendar, Property 9` / `Property 10`.
    - _Requirements: 2.7, 2.8, 3.5_
  - [x] 9.3 `samplingService.runSamplingPass` — gate BOTH the `park_crowd_index` contribution AND the `wait_samples` insert on `isStandbyBasketEntry`; compute the per-pass crowd slice via `relativeCrowdIndex` over the basket (expected from the in-memory Ride_Shape), keeping the day aggregate a running daily average of the slices; stop appending no-standby (show / dining / parade) rows. WHEN the basket is empty for a pass, write no index slice (no park-constant fallback). **Remove `getParkRollingBaseline` and its now-orphaned tests** (superseded — the per-ride-relative index needs no park-level typical). Redefine `daily_avg_wait` as the basket's mean posted wait (informational only; not the numerator). Per-park isolation unchanged.
    - _Requirements: 2.7, 2.8, 3.5, 3.6_
  - [x] 9.4 Repo / integration coverage — a pg-mem / `server.inject` test that a pass over a mixed park (headliner ride, walk-on 0-min ride, a show, a restaurant) records `wait_samples` only for the two rides and yields a per-ride-relative index over them. This test MUST fail against the pre-change all-entries average (the guard for the fix, per design Testing Strategy).
    - _Requirements: 2.7, 2.8, 3.5_
  - [x] 9.5 Observed-index rebuild — delete the existing `source='observed'` `park_crowd_index` rows so the index repopulates cleanly on the new per-ride-relative scale. These are **per-date** rows, not an EMA, so they do NOT age out on their own and would otherwise keep feeding `getComparableCrowdIndices` (year-over-year) and predicted-vs-actual on the old scale. Do **NOT** bulk-delete `wait_samples` — the existing 30-day prune ages structural zeros out, and they don't corrupt shape percentiles (a no-standby entity has no matching shape). Seed rows and the forward forecast are untouched and carry the calendar during the ~several-day rebuild. **Destructive step: run only with explicit approval.**
    - _Requirements: 2.8_

- [ ] 10. Date-proximity forecast comparables (R2.9)
  - [x] 10.1 Pure comparable-selection helper — add `selectComparableIndices(targetDate, history, windowDays)` to `crowdForecast.ts`: given the target date and `{date, crowd_index}[]` history, return the values within ±`COMPARABLE_DAY_WINDOW` (=7) days of the target's day-of-year (wrapping the Dec↔Jan boundary), preferring same-day-of-week when enough samples remain. No I/O.
    - _Requirements: 2.9_
  - [x] 10.2 Repo + `predictionService` wiring — change `getComparableCrowdIndices` to return **dated rows** (`date` + `crowd_index`) for the target's calendar-proximity window across years (drop the flat month+day-of-week averaging), and have `predictionService.computeRawForecast` run `selectComparableIndices` and average the result into `historyEstimate`. Preserve seed+observed inclusion and the existing blend-weight logic. Update the existing tests that stub/consume `getComparableCrowdIndices` (e.g. `predictionBlending.test.ts`) to the new dated-row shape — do not leave them failing.
    - _Requirements: 2.2, 2.9_
  - [x] 10.3 Property + integration tests — **Property 11** (comparable selection is calendar-proximate and preserves peaks), `fast-check` ≥100 runs, tagged `Feature: crowd-calendar, Property 11`. Plus a `predictionService` test: given seed rows with the late-December peak, a future Christmas-week date forecasts an elevated `displayLevel` (not diluted to green) while an early-December date stays low.
    - _Requirements: 2.9_
  - [ ] 10.4 (Optional) Seasonal-prior enrichment — extend `seasonalPrior` (by rule, per year) to lift genuinely busy windows the seed can't reach beyond its ~2.5-year span (e.g. October Food & Wine / Halloween party season, Jersey Week). Secondary to 10.1–10.3, which carry most of this once comparables are fixed.
    - _Requirements: 2.2_

- [x] 11. Historical showtime patterns derivation and typical showtimes fallback
  - [x] 11.1 Migration `0029_show_time_patterns.sql` + `migration0029.test.ts` & recompute `show_time_patterns` in `derivedStatsService.runDailyRecompute` (`apps/api/src/services/intelligence/derivedStatsService.ts`)
    - Create `show_time_patterns(experience_id, day_of_week, start_minutes, frequency, sample_count)`.
    - Query `experience_daily_signals.showtimes` over trailing 180 days; convert canonical ISO showtime instants to minutes-from-midnight ET; bucket start times to nearest 5 minutes; group by `(experience_id, day_of_week, start_minutes)`; emit slots where `sample_count >= 3` and `frequency >= 0.5`. Dedup conflict key before upsert.
    - Unit tests in `derivedStatsService.test.ts` and fast-check Property 12 (`Feature: crowd-calendar, Property 12`).
    - _Requirements: 12.1, 12.2_
  - [x] 11.2 Fallback to typical showtimes in `getDaySnapshot` (`apps/api/src/services/intelligence/predictionService.ts`)
    - Add `showtimesAreTypical?: boolean` to `WaitSnapshot` in `@dwt/shared`.
    - When `daily?.showtimes` is absent/empty, query `repo.getShowTimePatterns(experienceIds, dow)` and format ISO strings on the requested date, setting `showtimesAreTypical: true` on `WaitSnapshot`.
    - Integration test in `predictionService.test.ts`.
    - _Requirements: 12.3, 12.4_

- [x] 12. Real-Postgres scratch DB test for percentiles
  - [x] 12.1 Live-Postgres integration test for `IntelligenceRepo.getRecentPercentiles` (`apps/api/src/services/intelligence/__tests__/intelligenceRepo.percentiles.livedb.test.ts`)
    - Create scratch database, apply all migrations verbatim, seed `experiences` and `wait_samples`.
    - Assert (a) ET bucketing (2026-10-02T02:00:00Z UTC -> Thursday 22:00 EDT, DOW 4, hour 22); (b) DST invariance (winter EST and summer EDT both land in DOW 4, hour 10); (c) Sunday day-of-week encoding (DOW = 0); (d) percentile values (p50 = 30, p90 = 46 for 10..50 distribution); (e) cutoff filter excludes older samples.
    - _Requirements: 1.1, 11.1_

- [x] 13. Daily recompute per-leg run isolation and outcome recording
  - [x] 13.1 Migration `0030_derived_stat_runs.sql` + `migration0030.test.ts`
    - Create `derived_stat_runs(leg TEXT PRIMARY KEY, last_success_at TIMESTAMPTZ, last_error_at TIMESTAMPTZ, last_error TEXT, consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0))`.
    - Unit test in `migration0030.test.ts` asserting DDL, PK, and CHECK constraints.
    - _Requirements: 13.2_
  - [x] 13.2 Repo method `IntelligenceRepo.recordDerivedStatRun` & pg-mem tests (`apps/api/src/services/intelligence/__tests__/intelligenceRepoRuns.test.ts`)
    - On success: `last_success_at = now()`, `consecutive_failures = 0`, `last_error = NULL`, preserve `last_error_at`.
    - On failure: `last_error_at = now()`, `consecutive_failures = consecutive_failures + 1`, `last_error` truncated to ≤500 characters, preserve `last_success_at`.
    - Test driving success -> failure -> failure -> success, error truncation, and cold start.
    - _Requirements: 13.2, 13.3, 13.4_
  - [x] 13.3 `derivedStatsService.runDailyRecompute` wiring and structured logging (`apps/api/src/services/intelligence/derivedStatsService.ts` & `derivedStatsService.runs.test.ts`)
    - Wrap all 6 legs with per-leg execution and outcome recording, swallow recording errors, and replace unconditional success log with structured summary logged at `warn` if any leg failed or `info` if all succeeded.
    - Unit test with fake repo verifying isolation, failure recording, and warn summary log.
    - _Requirements: 13.1, 13.5, 13.6_

- [x] 14. Checkpoint — Live DB percentiles test and recompute visibility complete
  - Verify all unit, live-db, and migration tests pass cleanly.

- [x] 15. Showtime slotting & pattern derivation shape tolerance
  - [x] 15.1 Pure showtime normalizer `normalizeShowtimeEntries` (`apps/api/src/services/intelligence/showtimePatterns.ts`)
    - Support 3 shapes: raw upstream objects (`{ startTime, endTime, type }`), projected objects (`{ start }`), and bare ISO strings. Emit canonical UTC ISO instants, ascending sort, and count unparseable entries in `skipped`.
    - Unit tests covering all 3 shapes, mixed arrays, non-array/nulls, unparseable count incrementing `skipped`, offset-bearing instant preservation, and ascending sort.
    - _Requirements: 12.1, 12.2_
  - [x] 15.2 Integrate normalizer into `getDaySnapshot` and `deriveShowTimePatterns` with skipped warnings (`predictionService.ts`, `derivedStatsService.ts`, `showtimePatterns.ts`)
    - Replace `.map(String)` in `getDaySnapshot` with `normalizeShowtimeEntries`; log at `warn` when `skipped > 0`.
    - Pass unmolested raw showtimes in `derivedStatsService.ts` and normalize in `deriveShowTimePatterns`.
    - pg-mem integration test in `showtimePatternsRecompute.integration.test.ts` inserting raw object JSONB and asserting patterns derive.
    - `predictionService.showtimes.test.ts` asserting canonical ISO instants, no `"[object Object]"`, and logger warn on skipped entries.
    - `optimizer.shows.test.ts` end-to-end test with `getDaySnapshot` output derived from raw objects.
    - _Requirements: 12.2, 12.3, 12.4_
  - [x] 15.3 Checkpoint — Showtime shape tolerance verification
    - Verify all showtime unit, integration, and optimizer tests pass cleanly.

- [x] 16. Showtime persistence union, normalization in getCrowdCalendarDay, and threshold refinement
  - [x] 16.1 Fix 1: Normalize showtimes in `getCrowdCalendarDay`'s `rideSignals` (`predictionService.ts` & `predictionService.showtimes.test.ts`)
    - Replace `.map(String)` with `normalizeShowtimeEntries` and log at `warn` when `skipped > 0`.
    - Unit test seeding real upstream `{type, startTime, endTime}` objects and asserting canonical ISO instants and never `"[object Object]"`.
    - _Requirements: 12.4, 12.7_
  - [x] 16.2 Fix 2: Accumulate showtimes as a per-date UNION across sampling passes (`showtimePatterns.ts`, `IntelligenceRepo.ts`, `intelligenceRepoShowtimes.test.ts`, `showtimePatterns.test.ts`)
    - Add pure `mergeShowtimeEntries(existing, incoming)` helper with start time deduplication and chronological ordering.
    - Update `IntelligenceRepo.upsertExperienceDailySignals` to union showtimes across passes while updating non-showtime columns to newest values, deduplicating within batch to prevent Postgres error 21000.
    - Unit test `mergeShowtimeEntries` and pg-mem integration test `upsertExperienceDailySignals`.
    - _Requirements: 12.6, 12.7_
  - [x] 16.3 Fix 3: Lower `SHOWTIME_PATTERN_MIN_SAMPLES` to 2 (`showtimePatterns.ts`, `showtimePatterns.test.ts`)
    - Change threshold constant from 3 to 2; update Property 12 and unit tests.
    - _Requirements: 12.2_
  - [x] 16.4 Checkpoint — Showtime persistence and pattern derivation verification
    - Verify all showtime unit, integration, and property tests pass cleanly and run empirical dry-run verification on dev data.
  - [x] 16.5 Fix per-slot sample count duplication in `deriveShowTimePatterns` (`showtimePatterns.ts`, `showtimePatterns.test.ts`)
    - Remove duplicate per-slot `sample_count >= SHOWTIME_PATTERN_MIN_SAMPLES` check, retaining it strictly as a group gate and evaluating candidate slots by `frequency >= SHOWTIME_PATTERN_MIN_FREQUENCY`.
    - Unit tests: rewrite test 1 to assert 2-gate division, add test 2 (Thursday 4 slots emitted with 1.0 and 0.5 frequencies), test 3 (frequency gate excludes at 0.25), test 4 (group gate drops group with 1 observed date), and update Property 12 fast-check for soundness and completeness.
    - _Requirements: 12.2_
  - [x] 16.6 Checkpoint — Two-gate showtime derivation verification
    - Verify all showtime tests pass and perform empirical dry-run verification against dev database confirming Thursday derives 4 slots and all experiences produce 2,504 patterns with a mix of 1.00 and 0.50 frequencies.

- [x] 17. Migration `0033_stable_baseline_and_wait_archive.sql`

  - [x] 17.1 Add migration `0033_stable_baseline_and_wait_archive.sql` + `migration0033.test.ts`
    - `ALTER TABLE ride_shapes ADD COLUMN baseline_wait_minutes REAL`, `ADD COLUMN baseline_sample_count INTEGER NOT NULL DEFAULT 0`; backfill `baseline_wait_minutes = avg_wait_minutes` and `baseline_sample_count = LEAST(sample_count, 500)` for existing rows (R14.4 — start from the seeded absolute level, not a cold start).
    - `ALTER TABLE experience_season_hour ADD COLUMN avg_crowd_index REAL` — nullable, deliberately **not** defaulted to `1.0` (R15.2; existing buckets accumulated under an unknown crowd level).
    - `CREATE TABLE wait_archive (experience_id, date, hour, avg_wait_minutes, sample_count, min_wait_minutes, max_wait_minutes)` with PK `(experience_id, date, hour)`, `CHECK (hour BETWEEN 0 AND 23)`, `CHECK (sample_count > 0)`, `CHECK (min_wait_minutes <= max_wait_minutes)`, `ON DELETE CASCADE`.
    - `CREATE TABLE wait_forecast_log` PK `(experience_id, date, hour, lead_days)` with `predicted_wait_minutes`, `forecasted_at`, nullable `challenger_wait_minutes`, `observed_wait_minutes`, `error`, `challenger_error`; and `CREATE TABLE wait_forecast_accuracy` PK `(experience_id, lead_days)` with `mae`/`bias`/`sample_count` plus separate `challenger_mae`/`challenger_bias`/`challenger_sample_count`.
    - `BEGIN/COMMIT`, `gen_random_uuid()` where applicable, `TIMESTAMPTZ`, inline comments. Never edit an applied migration.
    - Migration test asserts every added column, the two backfills, that `avg_crowd_index` is null (not `1.0`) on a pre-existing row, and each new table's PK + CHECK constraints.
    - _Requirements: 14.1, 14.4, 15.2, 17.1, 17.4, 18.1, 18.5, 18.7_

- [x] 18. Season-tier crowd responsiveness and day-of-week shrinkage (pure math)

  - [x] 18.1 `waitMath.ts` — `shrinkToPooled(bucketWait, bucketSampleCount, pooledWait, k)` and the `selectTier` rework
    - Add `shrinkToPooled` (R16.1) and `DOW_SHRINKAGE_K = 8`, `CROWD_MULTIPLIER_MIN = 0.4`, `CROWD_MULTIPLIER_MAX = 2.0` named constants.
    - Rework `selectTier` so tier 1 scales by `clamp(forecastIndex / seasonBucket.avgCrowdIndex, MIN, MAX)` and falls back to the raw average when `avgCrowdIndex` is absent/non-finite/`<= 0` (R15.1–15.3); tier 2 shrinks the weekday bucket toward the pooled per-hour mean before applying the absolute multiplier (R16.1, R16.6); tier ordering and the park-typical fallback are unchanged so Property 1 still holds.
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 16.1, 16.2, 16.4, 16.5, 16.6_

  - [x] 18.2 `establishBaseline` + `isBaselineEstablished` in `waitMath.ts`
    - Establish-once-then-freeze, **not** an EMA: return an established baseline untouched (value and count); otherwise freeze `avg_wait_minutes` once the fast shape holds `BASELINE_ESTABLISH_MIN_SHAPE_SAMPLES = 20` samples, else leave it `null` (R14.3, R14.4). `isBaselineEstablished` gates basket eligibility on the baseline's own columns (R14.5).
    - A long-memory EMA (500-sample cap) was implemented first and rejected by its own regression test: `0.197` ratio units of drift over `100` passes, only `1.27×` better than the fast shape. Do not reintroduce it — the defect is the mechanism, not the rate.
    - _Requirements: 14.3, 14.4, 14.5_

  - [x] 18.3 Property tests — `intelligenceMath.prop.test.ts` (`fast-check`, ≥100 runs)
    - Property 15 (mature season bucket strictly increasing in `forecastIndex`, equals the raw average at `forecastIndex == avgCrowdIndex`, clamped factor) and Property 16 (shrinkage bounded by its inputs, monotone in sample count, equals pooled at `n = 0`, tends to the bucket as `n → ∞`, no effect on tiers 1/3), plus Property 14's `updateBaseline` clauses (moves strictly less than the fast EMA, seeds from the shape not the sample).
    - Tagged `// Feature: crowd-calendar, Property 14/15/16: <text>`.
    - **Must include a non-property unit case that drives tier 1 at `sample_count >= 30` and asserts two different forecast indices give different waits** (R15.5) — the existing tier tests all sit below the threshold, so the branch is otherwise executed but unasserted.
    - _Requirements: 15.5, 16.3_

- [x] 19. Stable baseline wired through collection and the crowd index

  - [x] 19.1 `samplingService` — establish the Ride_Baseline and denominate the index by it
    - **Code is written and typechecks; NOT complete — see 19.5.** The basket's baseline denominator IS asserted (via `standbyBasket.test.ts` / `waterParkCrowdIndex.test.ts`, which write no index at all when a fixture has no baseline). The `season.avg_crowd_index` EMA and the in-pass `establishBaseline` call are executed by those tests but asserted by nothing.
    - Call `establishBaseline` after the fast-shape EMA each pass (it is a no-op once established); build the standby basket's `expected` from the baseline, read **before** the shape update so it is a genuine prior expectation, and gate eligibility with `isBaselineEstablished` (R14.1, R14.5).
    - EMA `avg_crowd_index` into the season bucket using the day's running observed index (hoist the existing `getParkCrowdIndices` read above the entry loop; skip the update on the day's first pass when no index row exists yet) (R15.2).
    - _Requirements: 14.1, 14.3, 14.5, 14.6, 15.2_

  - [x] 19.2 `IntelligenceRepo` — persist the new columns
    - **Code is written and typechecks; NOT complete — see 19.6.** The widened `upsertRideShapes` / `upsertSeasonHours` SQL and the new `dedupeByKey` guard are covered by no test that runs the real query. Per the bug-fix litmus, a mocked-repo test cannot cover a column dropped from an INSERT.
    - Extend `upsertRideShapes` and `upsertSeasonHours` to carry the new columns. Dedupe every batch by its conflict key before the query (Postgres `21000`).
    - _Requirements: 14.1, 15.2_

  - [x] 19.3 `predictionService.getDaySnapshot` — supply the pooled per-hour mean and the raw forecast index to `selectTier`
    - **Code is written and typechecks; NOT complete — see 19.7.** `shrinkToPooled` and the tier-1 de-meaning are proven at the unit level, but nothing asserts that `getDaySnapshot` actually reaches them: no test drives a thin weekday bucket plus a differing pooled mean through the snapshot and checks the returned `predictedWaitMinutes`.
    - Group the already-fetched all-weekday shape rows by hour to build the pooled mean (no extra query); pass `forecastIndex` (not just the derived multiplier) so tier 1 can de-mean. Park-typical tier behavior unchanged.
    - _Requirements: 15.1, 16.1, 16.4_

  - [x] 19.5 Sampling-pass service test for the two unasserted paths
    - Drive `runSamplingPass` with a fake repo and assert: (a) a bucket whose fast shape has just crossed `BASELINE_ESTABLISH_MIN_SHAPE_SAMPLES` gets `baseline_wait_minutes` written equal to its `avg_wait_minutes`, and an already-established bucket's baseline is written back **unchanged**; (b) `season.avg_crowd_index` is EMA'd from the day's observed index when one exists, and left `null` on the day's first pass rather than defaulted to `1.0`. Both paths are currently executed but asserted by nothing.
    - _Requirements: 14.3, 14.4, 15.2_

  - [x] 19.6 Repo round-trip test for the widened upserts
    - pg-mem (or the live-Postgres harness if `AT TIME ZONE` is needed): insert via the real `upsertRideShapes` / `upsertSeasonHours` and read back `baseline_wait_minutes`, `baseline_sample_count`, `avg_crowd_index`. Include a batch containing two rows with the same conflict key to prove `dedupeByKey` prevents Postgres `21000`.
    - _Requirements: 14.1, 15.2_

  - [x] 19.7 `getDaySnapshot` wiring test for shrinkage and tier-1 de-meaning
    - Assert the snapshot's `predictedWaitMinutes` reflects the shrunk shape: a weekday bucket at a low `sample_count` with a materially different pooled per-hour mean must land between the two, not on the raw bucket. Separately, a mature season bucket with `avg_crowd_index` must produce different hourly waits for two dates with different forecasts. Unit coverage of the math does not prove the service passes the right arguments.
    - _Requirements: 15.1, 16.1, 16.4_

  - [x] 19.4 Drift regression test — `crowdIndexDrift.test.ts`
    - Run `relativeCrowdIndex` across repeated passes with observed waits held constant while the fast shape is updated toward those observations between passes; assert the index does not move. **This test must fail against the pre-change denominator** (R14.8, Property 14).
    - _Requirements: 14.2, 14.8_

- [x] 20. Close the crowd calibration loop and surface accuracy (R7.4 / R7.5 / R7.6)

  - [x] 20.1 Apply the measured bias to the published forecast only (R7.4 + R7.7)
    - Read the stored `crowd_forecast_accuracy` bias for the target's nearest `(park, lead_days)` and apply it via the existing `applyBiasCorrection` (previously referenced only by a property test), bounded to `±0.5` ratio-scale units. Retain the existing same-day live correction (R4.3) as a separate term. Absent/unscored rows and an unavailable store yield the raw forecast, never a fabricated zero.
    - **Scope it per R7.7.** `computeRawForecast` stays uncalibrated; a separate `computeCalibratedForecast` applies the bias and is consumed by exactly two callers — `getCrowdCalendarDay`'s displayed index and `getCalibratedForecast` (which `captureForecasts` freezes) — so published accuracy describes what was shown and the loop converges. `getRawForecast`, `getCrowdMultiplier`, `getDaySnapshot` and `getWaitInsights` stay on the uncalibrated value: the bias is measured against a park-level crowd ratio, and pushing `0.236` through the multiplier moves a 45-minute headliner by ~11 minutes, which exceeds that model's own ~10-minute MAE.
    - Do this **after** task group 19: calibrating against the pre-fix drifting index would make the corrector chase an artifact.
    - _Requirements: 7.4, 7.7_

  - [x] 20.2 Populate `observedIndex` and expose recent accuracy in `getCrowdCalendarDay`
    - Set `CrowdCalendarDayDTO.observedIndex` from the finalized observed `park_crowd_index` for past dates, and surface the originally-captured forecast from `crowd_forecast_log` rather than a recomputed value (R7.5). The DTO field and Zod schema already exist.
    - _Requirements: 7.5, 6.4_

  - [x] 20.3 Prune `crowd_forecast_log` after reconciliation
    - Add the prune as an isolated daily-recompute leg per R13.1, retaining reconciled rows for the documented window.
    - _Requirements: 7.6_

  - [x] 20.4 Mobile — render captured-forecast-vs-actual and recent accuracy
    - `CrowdCalendarScreen` already renders "We predicted X/10 · actual was Y/10" behind `observedIndex != null`; that branch is currently unreachable. Add the recent-MAE surface. `@testing-library/react-native`, mocking only the query layer, asserting the real rendered output for both a past date (with actual) and a future date (without).
    - _Requirements: 7.5, 6.4_

- [ ] 21. Wait archive and wait-forecast accuracy

  - [x] 21.1 `derivedStatsService` — `archiveWaitSamples` leg
    - Aggregate `wait_samples` into `wait_archive` per `(experience_id, ET date, ET hour)` over a trailing `WAIT_ARCHIVE_LOOKBACK_DAYS = 7` window; idempotent upsert; runs as an isolated leg recorded in `derived_stat_runs` (R13.1/R13.2) and **before** the raw prune for the same day (R17.3).
    - _Requirements: 17.1, 17.2, 17.3, 17.6_

  - [x] 21.2 Repo test for the archive aggregation — live-Postgres harness
    - The aggregation groups by ET hour and therefore uses `AT TIME ZONE`, which pg-mem cannot execute; use the live-Postgres scratch-database pattern from `repo.performance.test.ts`. Insert raw samples, run the real query, read the row back and assert `avg`/`min`/`max`/`sample_count`. A mocked-repo test does not cover an aggregation bug in the SQL.
    - _Requirements: 17.1, 17.2_

  - [x] 21.3 Prediction-neutrality test
    - Assert `getDaySnapshot` and `getCrowdMultiplier` return identical results with an empty vs. populated `wait_archive` (R17.5, Property 17).
    - _Requirements: 17.5_

  - [x] 21.4 `captureWaitForecasts` + `reconcileWaitForecasts` + `pruneWaitForecastLog` legs
    - Capture frozen predicted waits for the top `WAIT_FORECAST_MAX_EXPERIENCES = 40` experiences by Ride_Baseline at `WAIT_FORECAST_LEAD_DAYS = [7, 3, 1]` × `WAIT_FORECAST_HOURS = [10, 13, 16, 19]`; reconcile against `wait_archive` (so it still works post-prune) recording `error = predicted − observed`; maintain `wait_forecast_accuracy` with the R7.3 capped-alpha EMA; prune beyond `WAIT_FORECAST_RETENTION_DAYS = 180`. Each an isolated leg (R18.8). Challenger columns written only when a challenger model is configured, and never consulted by the serving path (R18.5, R18.6).
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8_

  - [ ] 21.5 Re-anchor the Ride_Baseline from a trailing 365-day archive window (R14.9)
    - Once `wait_archive` holds ≥ 365 days, add a low-cadence leg that recomputes `baseline_wait_minutes` per `(experience_id, day_of_week, hour)` as the mean over the trailing 365 days, instead of relying on exponential memory alone. A 365-day mean is season-neutral by construction, so it is a strictly better cross-season yardstick than any EMA (which always over-weights the most recent season). Gated on the archive actually having a year of coverage — before then this leg is a no-op.
    - _Requirements: 14.9, 17.5_

  - [x] 21.6 Checkpoint — measurement in place
    - Confirm `npm run verify` is green, then confirm on the dev database that a recompute run writes `wait_archive` rows and `wait_forecast_log` captures, and that `derived_stat_runs` shows the new legs succeeding.

## Notes

- Test-only tasks (2.3, 4.4, 5.3, 6.3, 8.1, 9.2, 9.4, 10.3, 12.1) are optional for a faster MVP; core tasks are never optional.
- Task group 9 refines the shipped crowd index (R2.7/R2.8, R3.5): it counts only posted-standby entries and measures them per-ride-relative, which also stops structurally-zero rows from being written to `wait_samples`. It builds on the existing sampling pass and pure math; 9.5 is an operational decision to confirm before running.
- Task group 10 fixes the future-date calendar reading uniformly green (R2.9): the forecast's historical comparable feature averaged every same-month, same-weekday date, flattening holiday/festival peaks the seed records correctly (e.g. MK Dec 26 at level 8). Selecting comparables by calendar proximity restores those peaks. It touches `crowdForecast.ts`, `getComparableCrowdIndices`, and `predictionService.computeRawForecast` only.
- Property tests reference a design Correctness Property, run ≥100 `fast-check` iterations, and are tagged `Feature: crowd-calendar, Property {n}`.
- Pure modules (`waitMath`, `crowdForecast`) carry no I/O; data is passed in as prefetched snapshots so properties run directly against the functions.
- Collection is one cron-driven pass (`/internal/sampling/run`) covering both waits and schedule/LL signals; no BullMQ worker is added.
- The Lightning Lane Multi Pass price is the strongest free forward crowd signal. The seasonal prior is computed by rule per year (never hardcoded dates, so it can't go stale) and is a weak feature — within Disney's publication window LL price already reflects break-driven demand; it mainly serves far-future dates.
- The Day Planning feature depends on this spec and consumes `predictionService`; it does not reimplement the model.
- Weather uses Open-Meteo (free, keyless); add its base URL to config with a documented default. One location fetch per pass; the near-term forecast is cached and refreshed at most daily. Weather adjusts only in-horizon (~14-day) dates and is a no-op beyond that.
- **Task groups 17–21 are the accuracy-correctness wave (R14–R18).** Their test tasks (18.3, 19.4, 20.4, 21.2, 21.3) are **not** covered by the MVP carve-out above and are mandatory: three of them (18.3's tier-1 case, 19.4, 21.2) are the only assertions that would fail against the current code, so skipping them ships the fix untested.
- **Order within the wave is load-bearing, not cosmetic.** 17 (migration) → 18 (pure math) → 19 (baseline wired + index denominated) → 20 (bias correction) → 21 (archive + wait accuracy). Group 20 **must** follow 19: the stored bias is measured against the observed Crowd_Index, and until 19 fixes that index's denominator the target is drifting (measured: all four parks' index rose while the underlying mean wait fell), so a bias corrector wired first would spend its life chasing an artifact instead of converging.
- **Group 18 is a deadline, not only an improvement.** The tier-1 season branch is dormant today purely because no `experience_season_hour` bucket has reached `sample_count >= 30` (observed max: `21`, average `14.5`). Once buckets cross the threshold, the current code silently stops applying any crowd factor to those rides' predictions. Land 18 before that crossover.
- **Expect a small measured gain from 18 and be honest about it.** The holdout ceiling for ride/hour/weekday features is `5.58` min MAE against the shipped `5.87`; R16's shrinkage recovers ~`0.22` min of that. The large remaining headroom (down to a `2.95` min noise floor) is day-level signal, which is what groups 19 and 21 make reachable rather than something the tier arithmetic can deliver.
- Group 21 deliberately builds **measurement**, not accuracy: `wait_archive` and `wait_forecast_log` change no prediction (R17.5 is property-tested). Their value is that model quality stops being invisible, and that day-level training data stops being deleted by the 30-day raw prune. This is the one item in the wave that is time-sensitive for a reason unrelated to correctness — every day it is not shipped is a day of day-to-day variation permanently lost.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1", "2.2"] },
    { "id": 1, "tasks": ["2.3"] },
    { "id": 2, "tasks": ["3"] },
    { "id": 3, "tasks": ["4.1", "4.2", "4.3"] },
    { "id": 4, "tasks": ["4.4", "4.5", "5.1", "5.2"] },
    { "id": 5, "tasks": ["5.3", "5.4", "6.1", "6.2", "6.3"] },
    { "id": 6, "tasks": ["6.4", "7.1", "7.2"] },
    { "id": 7, "tasks": ["8.1", "8.2"] },
    { "id": 8, "tasks": ["9.1"] },
    { "id": 9, "tasks": ["9.2", "9.3"] },
    { "id": 10, "tasks": ["9.4", "9.5"] },
    { "id": 11, "tasks": ["10.1"] },
    { "id": 12, "tasks": ["10.2", "10.3"] },
    { "id": 13, "tasks": ["10.4"] },
    { "id": 14, "tasks": ["11.1", "11.2"] },
    { "id": 15, "tasks": ["12.1", "13.1", "13.2", "13.3"] },
    { "id": 16, "tasks": ["14"] },
    { "id": 17, "tasks": ["15.1", "15.2", "15.3"] },
    { "id": 18, "tasks": ["16.1", "16.2", "16.3", "16.4"] },
    { "id": 19, "tasks": ["17.1"] },
    { "id": 20, "tasks": ["18.1", "18.2"] },
    { "id": 21, "tasks": ["18.3"] },
    { "id": 22, "tasks": ["19.1", "19.2", "19.3"] },
    { "id": 23, "tasks": ["19.4", "19.5", "19.6", "19.7"] },
    { "id": 24, "tasks": ["20.1", "20.2", "20.3"] },
    { "id": 25, "tasks": ["20.4"] },
    { "id": 26, "tasks": ["21.1", "21.4"] },
    { "id": 27, "tasks": ["21.2", "21.3"] },
    { "id": 28, "tasks": ["21.5"] },
    { "id": 29, "tasks": ["21.6"] }
  ]
}
```



