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
    { "id": 18, "tasks": ["16.1", "16.2", "16.3", "16.4"] }
  ]
}
```



