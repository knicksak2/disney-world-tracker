# 2026-09-10 — First real accuracy read

**Read-only, but the output must be recorded in this file.** The 2026-10-08 runbook compares against it and cannot be done without it.

## Context

Before 2026-08-27 the wait model's accuracy was unmeasurable: the only way to estimate it was to reconstruct a holdout by hand from raw samples. That was done once and produced these reference figures (train 2026-08-04..18, test 2026-08-19..25, a single low-crowd late-August window with no holiday or capacity event):

| model | MAE (min) |
|---|---|
| ride mean, no time of day | 7.40 |
| ride × hour | 6.04 |
| **ride × day-of-week × hour (what shipped)** | **5.87** |
| ceiling for those features, fitted on the test set | 5.58 |
| noise floor (perfect knowledge of that ride/date/hour) | 2.95 |

On **headliners only** (test mean wait 43.3 min): shipped **10.13** (23.4%), ceiling 9.29, floor 4.91.

Those were retrospective and partly in-sample. `wait_forecast_accuracy` now holds **forward, out-of-sample** numbers. This runbook reads them for the first time.

## Checks

### 1. Forward wait accuracy, per ride and lead time

```sql
SELECT e.name, e.park, a.lead_days,
       ROUND(a.mae::numeric,1)  AS mae_min,
       ROUND(a.bias::numeric,1) AS bias_min,
       a.sample_count
FROM wait_forecast_accuracy a
JOIN experiences e ON e.id = a.experience_id
WHERE a.sample_count >= 15
ORDER BY a.lead_days, a.mae DESC;
```

`bias = predicted − observed`. Positive bias means we read the ride **high**.

And the aggregate, which is the number to compare against the table above:

```sql
SELECT lead_days,
       COUNT(*) AS rides,
       ROUND(AVG(mae)::numeric,2)  AS mean_mae_min,
       ROUND(AVG(bias)::numeric,2) AS mean_bias_min,
       SUM(sample_count) AS scored_points
FROM wait_forecast_accuracy WHERE sample_count >= 15
GROUP BY lead_days ORDER BY lead_days;
```

**How to read it.** These are the top 40 rides by baseline, so they skew toward headliners — compare to the **10.13** headliner figure, not the 5.87 overall one. Roughly:

- mean MAE materially **below ~10** → the changes helped, or September is calmer than the sample window.
- around **10** → consistent with the holdout; nothing has regressed.
- materially **above ~12** → something regressed. The most likely culprits are the season tier activating (check 3) or the frozen baseline mispricing a ride.

Expect ~4 scored points per (ride, lead) per day, so ~2 weeks gives 40–60 per cell at lead 1. Ignore any cell under 15.

### 2. RECORD THE BIAS COLUMN — this is the whole point

Append the per-ride `bias_min` at **lead 3** (the middle lead, least contaminated by same-day correction and with more samples than lead 7) to the table at the bottom of this file. The October runbook compares the **sign** of each ride's bias against these values. Without this record that decision cannot be made.

For reference, the earlier in-sample per-ride offsets (`observed − shape`, so negative meant the shape read **high**) were:

```
Test Track -6.25   Rise of the Resistance -7.30   Flight of Passage -7.74
Cosmic Rewind -6.18   Soarin' -7.40   TRON -6.58   Space Mountain -6.10
Millennium Falcon -6.57   Tower of Terror -3.99   Kali River Rapids -4.14
Slinky Dog Dash -0.75   Toy Story Mania +0.06
```

Note the sign convention differs: those were `observed − shape`; `wait_forecast_accuracy.bias` is `predicted − observed`. A shape reading high appears as **negative** above and **positive** in the new table.

### 3. Is the season tier activating, and safely?

```sql
SELECT MAX(sample_count) AS max_n,
       ROUND(AVG(sample_count)::numeric,1) AS avg_n,
       SUM(CASE WHEN sample_count >= 30 THEN 1 ELSE 0 END) AS active_buckets,
       SUM(CASE WHEN sample_count >= 30 AND avg_crowd_index IS NULL THEN 1 ELSE 0 END) AS active_no_crowd_level,
       SUM(CASE WHEN avg_crowd_index IS NOT NULL THEN 1 ELSE 0 END) AS with_crowd_level
FROM experience_season_hour;
```

Baseline on 2026-08-27: max 21, avg 14.5, **0 active buckets**, all `avg_crowd_index` null.

The tier-1 threshold is 30 samples. When a bucket crosses it, prediction switches from `shrunk shape × absolute crowd factor` to `season average × (forecast / avg_crowd_index)`.

Two things to watch:

- **`active_no_crowd_level > 0`** — those buckets fall back to the *unscaled* season average, so their prediction stops responding to the date. Not a crash, but they lose day-specificity. Acceptable transiently; a persistent nonzero count means `avg_crowd_index` isn't accumulating and needs investigating (it is EMA'd in the sampling pass only when the day's observed crowd index already exists, so it is null on each day's first pass by design).
- **Buckets that mature early have a mismatch**: their *wait* average includes samples from before 2026-08-27, taken under an unknown crowd level, while `avg_crowd_index` only reflects samples since. So the de-meaning is approximate for the first cohort. If those specific rides show a jump in `mae_min` in check 1, that mismatch is the likely cause — and the fix is patience, not code, since the window converges as samples accrue.

### 4. Is the crowd calibration converging?

```sql
SELECT park, lead_days, ROUND(mae::numeric,3) AS mae,
       ROUND(bias::numeric,3) AS bias, sample_count
FROM crowd_forecast_accuracy ORDER BY park, lead_days;
```

Baseline at lead 1 on 2026-08-27, **before** the correction was applied:

| park | mae | bias |
|---|---|---|
| Magic Kingdom | 0.266 | **+0.236** |
| Animal Kingdom | 0.220 | **−0.203** |
| Hollywood Studios | 0.139 | +0.071 |
| EPCOT | 0.109 | −0.040 |

MK and AK were ~90% systematic. The correction is now applied to the published forecast, so **bias should be shrinking toward 0** and MAE with it. This is a closed negative-feedback loop: the corrected forecast is both what's displayed and what's scored, so it converges.

- Bias shrinking → working as designed.
- Bias **growing or oscillating** → the loop is over-correcting. Check that `captureForecasts` and `getCrowdCalendarDay` are still reading the *same* value (both go through `computeCalibratedForecast`); if they diverge, accuracy is being measured against a forecast nobody saw and the loop cannot converge.

### 5. Is the crowd index behaving now that its denominator is frozen?

```sql
SELECT date, park, ROUND(crowd_index::numeric,3) AS crowd_index,
       ROUND(daily_avg_wait::numeric,1) AS avg_wait, sample_count
FROM park_crowd_index
WHERE source = 'observed' AND date > CURRENT_DATE - 21
ORDER BY date DESC, park;
```

The defect that was fixed: over 2026-08-11..18 → 08-19..25 the index rose in **all four** parks (MK 0.819→0.909, HS 0.855→0.933, EPCOT 0.858→0.903, AK 0.881→0.901) while the mean posted wait **fell** (23.85→23.25). Index and waits moving in opposite directions is the signature.

Now check they move **together**: eyeball whether `crowd_index` and `avg_wait` trend in the same direction across the window. If the index rises while `avg_wait` falls again, the fix didn't take — verify `samplingService` is reading `baseline_wait_minutes` and not `avg_wait_minutes` for the basket's `expected`.

## Do NOT do yet

- **Do not build the bias-correcting challenger.** Two weeks in one direction cannot distinguish stable bias from lag on a trending signal. That is the October decision.
- **Do not apply the crowd bias to the wait multiplier** (R7.7). Same reason.

## Record here

Fill this in — the October runbook reads it.

```
Date run:
Mean MAE by lead (min):        lead 1 = ____   lead 3 = ____   lead 7 = ____
Mean bias by lead (min):       lead 1 = ____   lead 3 = ____   lead 7 = ____
Scored points total:           ____
Season buckets active (>=30):  ____   of which no avg_crowd_index: ____
Crowd bias, lead 1:            MK ____  AK ____  HS ____  EPCOT ____
Index vs waits moving together? yes / no
Anything anomalous:

PER-RIDE BIAS AT LEAD 3 (ride -> bias_min, sample_count) — REQUIRED for October:

```
