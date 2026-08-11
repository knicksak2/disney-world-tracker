# Requirements Document

## Introduction

The Crowd Calendar and Wait-Time Intelligence feature is the shared data foundation that predicts how busy each Walt Disney World park will be on any date and how long any attraction's line will be at any hour. It is both a **user-facing feature** (a browsable crowd calendar with per-park busyness, best-day-to-visit guidance, park hours, and events) and the **prediction service** that the Day Planning feature consumes to optimize a touring plan.

Accuracy is bounded by data, so the design makes the most of free sources. It **factors** a wait into a per-ride intra-day **shape** (a stable `day-of-week × hour` curve) and a per-date **crowd multiplier** (a park's busy/quiet dial). The shape learns fast; the crowd multiplier carries the season/holiday/event effect and is the high-value thing accumulated over time. The crowd forecast for future dates leans on strong free forward signals — most notably Disney's own **Lightning Lane Multi Pass price** (a money-backed demand forecast published months ahead) and **published park hours and event flags** — plus calendar features. The model is optionally seeded once from a free public source and refined continuously by a cron-triggered sampling pass, with recent observations weighted more heavily.

This feature owns data collection, the wait-time model, the crowd index and forecast, the wait-prediction service, and the crowd calendar UI. The Day Planning feature depends on it and consumes `getDaySnapshot()` / `crowdMultiplier()`; it does not reimplement any of this.

## Glossary

- **Wait_Time_Model**: The factored predictor `predicted_wait = ride_shape × crowd_multiplier`, selected from the most specific reliable tier.
- **Ride_Shape**: A per-Experience expected posted standby wait by `(day_of_week, hour)`; the stable, fast-learning factor.
- **Crowd_Index**: A per-Park, per-date busyness value derived from that day's posted waits, stored and used as a **continuous** real number. The 1–10 scale is a **display-only** rounding of it, never the value fed back into any calculation.
- **Crowd_Multiplier**: The continuous factor applied to a Ride_Shape to specialize it to a date, computed from continuous underlying values (the day's average-wait ratio), not from the display-rounded 1–10.
- **Crowd_Forecast**: The predicted Crowd_Index for a future date, from calendar features and Disney's published signals.
- **Schedule_Signal**: Disney's forward-looking per-date data from ThemeParks.wiki `/entity/{park}/schedule` — park hours, Early Entry / Extended Evening / Special Ticketed Event flags, and Lightning Lane Multi Pass price.
- **Sampling_Job**: The cron-triggered pass that records current posted waits and ingests Schedule_Signals into the model.
- **Model_Seed**: A one-time bootstrap of Ride_Shape (and optionally historical Crowd_Index) from a free public source, used only to avoid a cold start.
- **Prediction_Service**: The consumable API — `getDaySnapshot(experienceIds, date, park)` and `crowdMultiplier(park, date)` — used by the Day Planning feature and the Crowd Calendar UI.

## Requirements

### Requirement 1: Wait-Time Model

**User Story:** As a Trip_Member, I want the app to predict a ride's wait at any hour of a future date, so that plans and calendars are built on realistic waits rather than only the current wait.

#### Acceptance Criteria

1. THE System SHALL predict a standby wait for an Experience on a date and hour as its most specific reliable estimate, in posted minutes: (a) a season-resolved direct average `(experience, season, day_of_week, hour)` when its sample count meets a reliability threshold; else (b) `Ride_Shape(experience, day_of_week, hour) × Crowd_Multiplier(park, date)`; else (c) a Park-typical shape × Crowd_Multiplier.
2. THE Ride_Shape store SHALL hold, per Experience, an expected posted wait for each `(day_of_week, hour)` bucket.
3. THE System SHALL model all waits as **posted** waits (consistent with the Live_Service source) and SHALL NOT mix posted and actual waits in one store.
4. THE season-resolved store SHALL be accumulated from the System's own sampling from day one, so it can densify and take precedence over time, even though the Model_Seed provides only the `day_of_week × hour` Ride_Shape.
5. THE Wait_Time_Model SHALL be queryable for a full day of an Experience (all operating hours) with a single bounded lookup suitable for a 2-second optimization budget.

### Requirement 2: Crowd Index and Forecast

**User Story:** As a Trip_Member, I want an accurate per-park busyness level for any date, so that I can pick better days and get better wait predictions.

#### Acceptance Criteria

1. THE System SHALL compute an observed Crowd_Index per Park per date from that day's posted waits across the Park's **standby basket** during core hours (excluding downtime) — see R2.7 for the basket and R2.8 for the per-ride-relative method — retained as a **continuous ratio** where **1.0 = a typical day** for that Park and day-of-week. Values below 1.0 are quieter-than-typical and MUST remain representable. THE `typical` baseline SHALL be **each Park's own** rolling reference (derived from that Park's accumulated `daily_avg_wait`), NOT a single global constant shared across all parks — so the index reflects how busy a day is *for that park*; a shared default MAY be used only as a cold-start seed until a Park accrues its own baseline. THE 1–10 scale is a display-only rounding derived from this ratio (via `displayLevel`); the continuous ratio is what is stored and used in all downstream calculations.
2. THE System SHALL produce a Crowd_Forecast for a future date per Park from features: the Lightning Lane Multi Pass price (Schedule_Signal), park hours length and Extended Evening / Special Ticketed Event flags, month, week-of-year, day-of-week, proximity to US public holidays, a **rule-computed seasonal prior** (holidays and Easter derived by algorithm per year — never hardcoded dates — with Easter-anchored spring, summer, winter, and Thanksgiving windows), and — once accumulated — the recency-weighted observed Crowd_Index for prior comparable dates.
5. THE seasonal prior SHALL be a weak feature relative to the Schedule_Signal within Disney's publication window (where LL price and park hours already reflect real break-driven demand); it SHALL primarily serve dates beyond that window, alongside year-over-year observed history.
3. THE Crowd_Forecast SHALL be usable with zero observed history (day one) from the Schedule_Signal and calendar features alone, and SHALL improve as observed Crowd_Index accumulates.
4. THE Crowd_Multiplier for a date SHALL be computed from **continuous** values — the ratio of the forecast day's expected level to the Park's typical level for that day-of-week (i.e., the underlying average-wait ratio), never the display-rounded 1–10 integer — and SHALL fall back to a neutral multiplier of 1.0 when neither forecast nor history is available.
5. THE predicted wait SHALL be a continuous minute value; the 1–10 Crowd_Index granularity SHALL never quantize a wait prediction, and increasing the display granularity SHALL NOT be treated as a way to improve prediction accuracy.
6. ALL internal crowd values — the observed Crowd_Index, the Crowd_Forecast, and the calibration bias correction — SHALL use the **same continuous ratio scale (1.0 = typical)**, NOT the 1–10 display scale. The Crowd_Forecast SHALL be clamped to a ratio band (default `[0.4, 3.0]`) and SHALL NOT be floored at 1.0, so quieter-than-typical days are forecastable. Conversion to 1–10 occurs only at display time via `displayLevel`; no calculation consumes `displayLevel`'s output.

7. THE observed Crowd_Index SHALL be computed only from Experiences that expose a posted **standby** queue in the Live_Service feed for the pass (the Park's **standby basket**). Experiences with no standby queue — shows (which use showtimes), table- and quick-service dining, parades, and walkthrough / meet experiences without a posted standby line — SHALL be excluded from the Crowd_Index so that structurally-zero, non-queue entries can neither dilute the index nor compress its dynamic range. A ride that is operating at a walk-on **0-minute** standby IS part of the basket (a genuine low-crowd signal); exclusion is by **absence of a standby queue**, NOT by a zero value.

8. THE observed Crowd_Index SHALL be a **per-ride-relative** aggregate: the (recency-weighted) mean across the standby basket of each ride's observed standby wait divided by that ride's **own expected wait** for the same `(day_of_week, hour)` (its Ride_Shape), so that neither the wide range of absolute waits between rides nor changes in *which* rides happen to be operating biases the index. On this scale **1.0 = every ride at its typical level for the time**; above 1.0 is busier-than-typical, below is quieter. A ride whose expected baseline is not yet established (Ride_Shape sample count below `CROWD_INDEX_MIN_SHAPE_SAMPLES`, default `5`, or an expected ≤ 0) SHALL be excluded from the ratio until it has one, so an unlearned ride cannot swing the index. THE per-Park `daily_avg_wait` MAY still be retained as an informational signal but SHALL NOT be the index numerator.

### Requirement 3: Data Collection and Schedule Ingestion

**User Story:** As an App Developer, I want the model to stay current on free infrastructure, so that accuracy improves over time without recurring cost or an always-on worker.

#### Acceptance Criteria

1. THE System SHALL expose a single authenticated Sampling_Job endpoint that, when invoked, (a) reads current posted waits for all catalog Experiences via the existing Live_Service and (b) ingests Schedule_Signals (park hours, event flags, Lightning Lane Multi Pass price) from ThemeParks.wiki `/entity/{park}/schedule` for the forward window.
2. THE Sampling_Job SHALL be triggerable by an external scheduler — reusing the deployment's existing keep-alive cron by pointing it at the Sampling_Job endpoint — and SHALL NOT require an always-on background worker process or a separate in-process timer.
3. THE data collection SHALL be independent of app usage: it is driven solely by the scheduled Sampling_Job and SHALL NOT depend on any user opening the app or on user-initiated reads.
4. THE Sampling_Job SHALL be invoked at a regular sub-hourly cadence across the parks' full operating window — from before Early Entry through after Extended Evening close — so that the intra-day Ride_Shape and the daily Crowd_Index are captured. The deployment's existing keep-alive runs every ~10 minutes, which comfortably exceeds the needed resolution; the System SHALL sample on each pass (multiple samples per hour simply strengthen that hour's bucket) while Schedule_Signal refresh MAY occur at most once per day (or when stale).
5. WHEN recording a sample, THE System SHALL update the affected Ride_Shape and season-resolved bucket for that `(day_of_week, hour)` via a per-pass recency-weighted (EMA / capped-count) update so recent observations dominate. THE **day's Crowd_Index is a per-day aggregate**, NOT a per-slice EMA: it SHALL be derived from that day's operating-hour samples (a running daily average over core hours, normalized to the ratio scale of R2.1), finalized once the day's samples exist. THE System SHALL record a wait sample for an Experience **if and only if** it is operating AND the Live_Service feed exposes a **standby queue** for it (a numeric standby wait is posted) — a walk-on **0-minute** standby counts and SHALL be recorded (it is real low-crowd signal). Experiences with **no standby queue** (shows, dining, parades, walkthrough / meet without a posted standby line) SHALL NOT produce a wait sample, and closed / down reads SHALL NOT be recorded as wait values (they MAY inform downtime metadata). This keeps structurally-zero, non-queue rows out of both the aggregates (R2.7) and the raw `wait_samples` store, which also bounds `wait_samples` growth (R3.6 / R8.3).
6. THE System's stored size SHALL be bounded: Ride_Shape, season-resolved, and Crowd_Index stores are fixed-shape aggregates; Schedule_Signals are keyed by park and date; any raw sample retention SHALL be pruned to a bounded recent window.
7. IF a per-park Live_Service or schedule fetch fails during a pass, THE System SHALL skip that park for the pass, log it, and still update the others.
8. IF individual passes or an entire day are missed, THE System SHALL degrade gracefully: existing aggregates are retained unchanged and only the missing time-slices are absent; no prior data is lost.
9. THE Sampling_Job endpoint SHALL be idempotent and self-throttling: it records a wait sample at most once per configured interval and refreshes Schedule_Signals at most once per day, so the existing keep-alive cron may invoke it at that cron's own (possibly higher) frequency without over-sampling or added cost.
10. THE Sampling_Job endpoint SHALL acknowledge the trigger promptly (return within a small fixed bound, e.g., `202 Accepted`) and execute the pass asynchronously within the same process, so a slow upstream never delays, times out, or fails the calling cron. A pass in progress SHALL prevent a concurrent pass (overlap guard), each pass SHALL be bounded by the Live_Service deadline, and errors SHALL be handled and logged internally rather than surfaced to the caller.

### Requirement 4: Prediction Service (consumed by Day Planning)

**User Story:** As the Day Planning feature, I want a single service that returns a day's predicted waits and a date's crowd multiplier, so that the optimizer does not reimplement the model.

#### Acceptance Criteria

1. THE Prediction_Service SHALL expose `getDaySnapshot(experienceIds, date, park)` returning a per-Experience, per-hour predicted posted wait for the date's operating hours, selecting the tier per Requirement 1.
2. THE Prediction_Service SHALL expose `crowdMultiplier(park, date)` per Requirement 2.
3. WHEN the date is the current or next WDW calendar day, THE Prediction_Service SHALL correct the day's Crowd_Multiplier from observed-versus-expected live waits (via the Live_Service) and apply it to the remaining hours, rather than using only the instantaneous live value.
4. THE Prediction_Service SHALL treat Live_Service calls as best-effort within the Live_Service's existing deadline and SHALL fall back to the model and Standard Operating Hours (default 9 AM–9 PM local) on timeout or failure.

### Requirement 5: Model Seeding

**User Story:** As an App Developer, I want the model useful on day one, so that predictions are reasonable before the app has collected its own history.

#### Acceptance Criteria

1. THE System SHALL provide a one-time, developer-run Model_Seed that populates the Ride_Shape store per Experience from a free public source (RopeDrop `/api/analysis/ride`), mapping each Experience via the existing ThemeParks directory resolver (Enterprise_Id → ThemeParks entity GUID == the source's entity id).
2. THE Model_Seed MAY additionally seed historical Crowd_Index from a free date-resolved source when available.
3. THE Model_Seed SHALL be optional: WHEN no seed is available, THE System SHALL start from Park-typical shapes and a Schedule_Signal + calendar Crowd_Forecast, and refine from its own sampling.
4. THE Model_Seed SHALL identify the app via a User-Agent and record source attribution; it SHALL NOT be part of any request path.

### Requirement 6: Crowd Calendar UI

**User Story:** As a Trip_Member, I want to browse how busy each park is by date, so that I can choose the best days to visit.

#### Acceptance Criteria

1. THE App SHALL provide a Crowd Calendar screen showing a month view with each date's forecast Crowd_Index per Park (or a resort rollup), on a 1–10 scale.
2. THE Crowd Calendar SHALL provide a day-detail view showing per-Park Crowd_Index, park hours, Early Entry / Extended Evening / Special Ticketed Event flags, the Lightning Lane Multi Pass price, and any known festival window.
3. THE Crowd Calendar SHALL recommend the least-busy Park for a given date and highlight the least-busy days within a date range.
4. WHERE an observed Crowd_Index exists for a past date, THE Crowd Calendar SHALL show predicted-versus-actual for transparency.
5. THE Crowd Calendar reads SHALL be served by an authenticated endpoint backed by the Prediction_Service and the Crowd_Index/Schedule_Signal stores.

### Requirement 7: Forecast Accuracy and Calibration

**User Story:** As an App Developer, I want to measure how close our crowd forecasts were to reality and correct for systematic error, so that the forecast improves over time instead of only accumulating data.

#### Acceptance Criteria

1. THE System SHALL capture a frozen Crowd_Forecast snapshot for each upcoming date at defined lead times (e.g., 30/14/7/1 days out), stored with the timestamp it was made, so accuracy is measured against the forecast as it was actually issued — never a value recomputed with hindsight.
2. WHEN a date has closed and its observed Crowd_Index is finalized, THE System SHALL reconcile each captured forecast for that date against the observed index and record the signed error.
3. THE System SHALL maintain a recency-weighted accuracy summary per Park and lead time — at least mean absolute error and mean bias.
4. THE System SHALL apply the measured systematic bias as a correction to future Crowd_Forecasts, in continuous ratio-scale units and bounded so the corrected forecast stays within the ratio band (R2.6), closing the calibration loop.
5. THE Crowd Calendar SHALL surface forecast accuracy (e.g., recent mean absolute error) and, for a past date, the originally-captured forecast versus the actual — not a recomputed forecast.
6. THE forecast-log storage SHALL be bounded, pruned after reconciliation beyond a retention window.

### Requirement 8: Hosting and Cost Constraints

**User Story:** As an App Developer, I want this to run within the project's free-tier hosting, so that it adds no recurring cost.

#### Acceptance Criteria

1. THE feature SHALL NOT introduce an always-on background worker; all collection is driven by the existing external cron hitting the Sampling_Job endpoint.
2. THE feature SHALL keep Redis usage within the project's existing patterns and SHALL NOT rely on continuous queue polling.
3. THE stored data SHALL fit comfortably within the project's Postgres free-tier budget and SHALL be bounded over time per Requirement 3.6.

### Requirement 9: Additional Ride Signals

**User Story:** As a Trip_Member, I want the app to capture Lightning Lane, single-rider, virtual-queue, show, and reliability data, so that predictions and plans handle each ride type correctly rather than assuming every attraction has a standby line.

#### Acceptance Criteria

1. THE Sampling_Job SHALL capture, per Experience, from the Live_Service feed: single-rider wait (when present), Lightning Lane return time and availability, virtual-queue / boarding-group status, current operating status, and showtimes (for show-type experiences).
2. THE System SHALL maintain rolling per-Experience signals: `has_single_rider`, `uses_virtual_queue`, a downtime/reliability rate, and the typical Lightning Lane sell-out hour, updated recency-weighted.
3. THE Sampling_Job SHALL capture per-Experience, per-date signals from the schedule feed: the individual Lightning Lane price and availability, and (for shows) the day's showtimes.
4. THE Ride_Shape model SHALL additionally track a single-rider wait shape for Experiences that offer single-rider.
5. THE Prediction_Service snapshot SHALL expose these per-Experience signals (standby wait, single-rider wait, virtual-queue status, showtimes, Lightning Lane info) so consumers can model each experience type correctly.
6. THE Crowd Calendar day-detail SHALL surface per-ride reliability, typical Lightning Lane sell-out timing, and showtimes where available.
7. Weather signals SHALL be captured and applied to near-term predictions per Requirement 10.
8. All added stores SHALL remain bounded per Requirement 3.6 (fixed-shape aggregates and per-date rows pruned to a retention window).

### Requirement 10: Weather Integration

**User Story:** As a Trip_Member, I want near-term wait predictions to account for the weather, so that a rainy or scorching day's effect on lines is reflected in my plan and the crowd calendar.

#### Acceptance Criteria

1. THE Sampling_Job SHALL capture observed weather for the Walt Disney World location each pass from a free, keyless source (Open-Meteo): temperature, precipitation, and a coarse condition (e.g., clear / cloudy / rain), keyed by time. The fetch SHALL be one location per pass, not per Experience.
2. THE System SHALL maintain a per-Experience weather sensitivity — a relative wait adjustment by condition versus a clear-sky baseline — learned recency-weighted from observed weather-versus-wait, acknowledging that outdoor and indoor Experiences may react oppositely.
3. WHEN a date falls within the weather forecast horizon (~up to 14 days), THE Prediction_Service SHALL apply the per-Experience weather adjustment to predicted waits using the forecast; beyond the horizon, no weather adjustment SHALL be applied (weather cannot inform far-future planning).
4. THE weather forecast SHALL be refreshed at most once per day; the weather adjustment SHALL be bounded so a single condition cannot distort a prediction beyond a sane limit.
5. THE Crowd Calendar day-detail MAY surface the forecast weather for near-term dates.
6. THE weather stores SHALL remain bounded per Requirement 3.6.

### Requirement 11: Derived Statistics and Cross-Ride Effects

**User Story:** As a Trip_Member, I want richer touring insights — how variable a ride's wait is, how fast it fills after open, when a park peaks, and how ride breakdowns or shows shift waits — so that I can time my day well and trust the app's guidance.

#### Acceptance Criteria

1. THE System SHALL maintain, per Experience and `(day_of_week, hour)` bucket, dispersion statistics beyond the mean: a standard deviation / coefficient of variation and representative percentiles (at least p50 and p90), plus a per-bucket downtime rate.
2. THE System SHALL derive read-time insights from the Ride_Shape without extra storage: each Experience's best and worst hours, its morning escalation (rope-drop value — how quickly the wait climbs after open), and each Park's peak window.
3. THE System SHALL learn an event-window wait impact: the relative change in an Experience's wait during nearby entertainment windows (fireworks, parades, shows) versus its baseline, derived from captured showtimes and waits.
4. THE System SHALL learn cascade effects: when an Experience is down, the average wait change on other Experiences in the same Park, with sample counts. Cascade and event-impact recomputation MAY run at a reduced cadence (e.g., once daily) given cost.
5. THE Prediction_Service and read API SHALL expose these statistics, and the app SHALL surface them (per-ride volatility, reliability, best-hour and rope-drop value; per-park peak windows; event and cascade insights).
6. WHERE sufficient data exists, the Prediction_Service MAY apply bounded event-window and cascade adjustments to same-day predictions.
7. All derived stores SHALL remain bounded per Requirement 3.6.
8. THE "When to ride" wait-insights surface SHALL be date-contextual — defaulting to the most relevant date (today when in-park, else the user's upcoming trip date, else the typical day-of-week pattern) and allowing the user to switch among them — and SHALL NOT default to an arbitrary fixed date.
9. THE wait-insights surface SHALL lead with an actionable best-time-to-ride recommendation, present decision helpers comparing standby versus Lightning Lane (estimated time saved vs. price) and single-rider (estimated time saved), and offer to add the Experience to a Trip's Schedule at its recommended time.
10. THE wait-insights surface MAY offer a wait-drop alert (notify when the predicted/live wait falls below a threshold), reusing the app's existing notification mechanism where available.
11. THE best-time-to-ride recommendation SHALL scale its certainty to the underlying data confidence (bucket sample count and wait volatility): a definitive, prescriptive verdict when confidence is high (e.g., "Ride after 8 PM"), graded hedging ("usually" / "typically") when moderate, and a soft, observational pattern statement when low (e.g., "Evenings are usually calmer"). It SHALL always give the best available guidance and SHALL hedge the confidence of the *claim* without disparaging the app — no doubt-inducing or apologetic copy (e.g., "still learning", "not enough data"); a low-confidence state MAY show a small neutral "early estimate" indicator. THE forecast chart SHALL remain visible as evidence at every confidence level, carrying any genuine uncertainty rather than the headline.
