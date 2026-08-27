# 2026-10-08 — Bias or lag? The decision that picks the next model change

**This one changes code.** It has a prerequisite: the per-ride bias table at the bottom of `2026-09-10-first-accuracy-read.md` must be filled in. If it is empty, stop — take the September reading now and come back in three or four weeks. The whole method is a comparison across a crowd-level change, and there is no shortcut.

## Context

The wait model consistently read popular rides **high** by roughly 6–8 minutes each in the August analysis: Flight of Passage −7.7, Soarin' −7.4, Rise of the Resistance −7.3, TRON −6.6, Test Track −6.3, Cosmic Rewind −6.2, Space Mountain −6.1 (as `observed − shape`, so negative means the shape read high). Headliner MAE was 10.13 minutes, so a consistent ~7-minute offset is a large share of the total error — much larger than anything else identified. Removing it is the biggest remaining lever.

But there are two very different explanations, and they need opposite fixes:

- **Genuine per-ride bias.** We systematically misjudge specific rides. Fix: subtract the measured offset, exactly as the crowd forecast now does. Cheap, and the plumbing exists.
- **Lag.** The Ride_Shape is an EMA with ~21 samples of memory per `(day_of_week, hour)` bucket. On a **falling** wait trend a lagging average necessarily reads high — with no per-ride bias at all. August waits were falling. Fix: a faster or adaptive shape alpha. Subtracting a "bias" here would make things worse as soon as waits trend up.

A single window cannot separate these. What separates them is whether the sign **holds** across a crowd-level change. Late September into October is that change: summer crowds break, waits generally trend up into the autumn festival and holiday season. That is why this date was chosen.

## Step 1 — Take the second reading

```sql
SELECT e.name, a.lead_days,
       ROUND(a.mae::numeric,1)  AS mae_min,
       ROUND(a.bias::numeric,1) AS bias_min,
       a.sample_count
FROM wait_forecast_accuracy a
JOIN experiences e ON e.id = a.experience_id
WHERE a.sample_count >= 30 AND a.lead_days = 3
ORDER BY a.bias DESC;
```

Also confirm the crowd level genuinely moved, or the comparison proves nothing:

```sql
SELECT date_trunc('week', date)::date AS week, park,
       ROUND(AVG(crowd_index)::numeric,3) AS avg_index,
       ROUND(AVG(daily_avg_wait)::numeric,1) AS avg_wait
FROM park_crowd_index
WHERE source = 'observed' AND date > CURRENT_DATE - 60
GROUP BY 1, 2 ORDER BY 1, 2;
```

**If `avg_wait` has not meaningfully changed direction since September, postpone.** Waiting for a real trend change is the entire point; deciding on a flat window gives an answer you cannot trust.

## Step 2 — Compare and diagnose

For each ride, put September's `bias_min` beside October's.

| pattern across the two readings | diagnosis | action |
|---|---|---|
| Same sign, similar magnitude, on most rides | **Genuine per-ride bias** | Step 3A |
| Sign **flipped** on most rides as waits turned | **Lag** | Step 3B |
| Bias magnitude tracks the crowd index (large when the index moves, near zero when flat) | **Lag** | Step 3B |
| Mixed — stable on some rides, flipped on others | **Both** | Step 3B first (lag is the common-mode error), then re-read in a month and revisit 3A for the still-stable rides |
| Everything near zero now | It was lag, already absorbed | Do nothing. Record and close. |

Note the asymmetry: **if in doubt, do 3B.** A wrongly-applied bias term actively harms predictions when the trend turns; a slightly-too-fast alpha only makes them noisier.

## Step 3A — Genuine bias: build the shadow challenger

Do **not** change the served prediction. Write the corrected value into the challenger column and let both be scored on identical inputs. The column, the separate `challenger_mae` / `challenger_bias` / `challenger_sample_count` tally, and the isolation tests already exist.

What to add:

1. **A pure correction** in `waitMath.ts`:
   `applyWaitBiasCorrection(predicted, biasMinutes)` → `max(0, predicted − clamp(biasMinutes, ±BOUND))`. Pick a bound (start at ±15 minutes) so one bad accuracy row cannot produce an absurd prediction.
2. **A hook in `captureWaitForecasts`** (`derivedStatsService.ts`): read `getWaitForecastAccuracies` once for the tracked 40, then set `challenger_wait_minutes` on each row where a **scored** bias exists for that `(experience_id, lead_days)` — `sample_count >= 30`. Leave it null otherwise. `upsertWaitForecastLogs` already `COALESCE`s the challenger so a later null won't wipe it.
3. **Spec, additively**: a new acceptance criterion under R18 naming this specific challenger and its bound, a Correctness Property, and a task. R18.5 spec'd the *column*, not which model fills it — so this is net-new behaviour and needs a backing requirement.
4. **Tests** — the new branch must be driven, not merely executed:
   - challenger equals `predicted − bias` when a scored bias exists;
   - challenger is null when `sample_count` is below threshold or no row exists;
   - challenger floored at 0 and clamped at the bound;
   - **the served `predicted_wait_minutes` is byte-identical whether or not a challenger exists** — this is the one that matters;
   - a non-vacuity test asserting challenger ≠ served when a bias exists, so the invariance tests can't pass by the correction being disabled.

Then wait ~4 weeks and compare:

```sql
SELECT ROUND(AVG(mae)::numeric,2)            AS served_mae,
       ROUND(AVG(challenger_mae)::numeric,2) AS challenger_mae,
       SUM(sample_count) AS served_n, SUM(challenger_sample_count) AS challenger_n
FROM wait_forecast_accuracy WHERE challenger_sample_count >= 30;
```

Promote **only** if `challenger_mae` is clearly lower. Promotion is a deliberate edit to the serving path (R18.6 forbids automatic promotion), plus a spec amendment.

## Step 3B — Lag: tune the shape's memory instead

The relevant constant is `SHAPE_EMA_MAX_SAMPLES = 20` in `waitMath.ts` (alpha floor `2/22 ≈ 0.091`, roughly 4 weeks of memory per bucket). Lag means the memory is too long for how fast waits move.

Do **not** just change the constant and hope. Re-run the holdout properly — you now have months of `wait_archive`, which is exactly what it was built for:

1. Pick a train/test split spanning the trend change (e.g. train September, test October).
2. Replay the EMA over archived hourly means at several alpha caps (10, 14, 20, 30) and score each against the held-out period.
3. Take the interior optimum, as was done for `DOW_SHRINKAGE_K` (measured: 5.87 at k=0, 5.65 at k=5 and k=10, 5.72 at k=20, 6.04 at k=∞ — an interior optimum, so 8 was chosen).

Changing the shape alpha alters the crowd index's numerator behaviour too, so after changing it re-check that the index still tracks `daily_avg_wait` (query in step 1). The frozen baseline denominator is unaffected — that's why it was frozen.

Spec: amend the `SHAPE_EMA_MAX_SAMPLES` entry in the design's Configuration & Constants with the new measured figures, and add a task. Note that `BASELINE_ESTABLISH_MIN_SHAPE_SAMPLES` is deliberately equal to `SHAPE_EMA_MAX_SAMPLES` (the point the shape's alpha saturates) — decide consciously whether it should follow the new value or stay at 20.

## Step 4 — Revisit R7.7 while you are here

R7.7 deliberately withholds the crowd bias correction from the wait path, because propagating Magic Kingdom's `+0.236` through the crowd multiplier would shift every MK wait by ~24% (about 11 minutes on a 45-minute headliner) — larger than that model's own ~10-minute MAE, with no evidence it helps.

You can now test it instead of arguing about it: run it as a **second challenger variant** through the same shadow mechanism. If MK and AK wait MAE improves with the crowd correction applied, unify the paths and amend R7.7. If not, leave R7.7 as it stands and record that it was tested — the requirement explicitly asks not to "tidy it up" without evidence.

## Record here

```
Date run:
Waits trending up / down / flat since September:
Per-ride bias Sep -> Oct (name, sep_bias, oct_bias, sign held?):

Diagnosis: bias / lag / both / resolved
Action taken (3A / 3B / none):
Mean MAE by lead now:   lead 1 = ____  lead 3 = ____  lead 7 = ____
Crowd bias lead 1 now:  MK ____  AK ____  HS ____  EPCOT ____
R7.7 tested? result:
```
