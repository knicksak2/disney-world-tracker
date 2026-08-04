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
  - [ ] 5.1 `POST /internal/sampling/run` — cron-authenticated (shared secret); idempotent and self-throttling (sample at most once per interval, schedule refresh at most daily); returns `202` immediately and runs `runSamplingPass` asynchronously with an overlap guard + internal error handling, so a slow upstream never times out the keep-alive cron.
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

## Notes

- Test-only tasks (2.3, 4.4, 5.3, 6.3, 8.1) are optional for a faster MVP; core tasks are never optional.
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
    { "id": 7, "tasks": ["8.1", "8.2"] }
  ]
}
```
