# 2026-09-03 — Verify the measurement loop is actually turning

**Read-only. No code changes expected.** About 15 minutes.

## Context

On 2026-08-27 three new kinds of bookkeeping started running inside the daily recompute:

1. `archiveWaitSamples` — folds raw `wait_samples` into the bounded `wait_archive` aggregate, so day-to-day variation survives the 30-day raw prune.
2. `captureWaitForecasts` — freezes predicted waits for the top 40 rides at lead times `[7, 3, 1]` days and hours `[10, 13, 16, 19]` ET. 480 rows per run.
3. `reconcileWaitForecasts` — scores those frozen predictions against `wait_archive` once the target day has fully elapsed.

The daily recompute is **self-scheduled from inside the sampling pass** (`if now - lastRecomputeTime > 86400000`), not from an external cron. That in-process timer resets whenever the Render dyno restarts, so "it silently never runs" is the most plausible failure mode and the reason this check exists.

The first lead-1 predictions targeted 2026-08-27, so by now there should be several days of scored rows.

## Checks

### 1. Every recompute leg ran recently

```sql
SELECT leg, last_success_at, last_error_at, consecutive_failures,
       LEFT(COALESCE(last_error, ''), 120) AS err
FROM derived_stat_runs ORDER BY leg;
```

**Expect 12 rows**, each with `last_success_at` inside the last ~24 hours and `consecutive_failures = 0`:

```
archiveWaitSamples, captureForecasts, captureWaitForecasts, learnWeatherSensitivities,
pruneCrowdForecastLog, pruneWaitArchive, pruneWaitForecastLog, pruneWeatherObservations,
recomputePercentiles, recomputeShowtimePatterns, reconcileForecasts, reconcileWaitForecasts
```

- **Fewer than 12 rows** → those legs have never run. Most likely the deploy didn't happen, or the recompute has not fired since it.
- **`last_success_at` older than ~2 days** → the recompute isn't firing. Check whether the keep-alive cron is still hitting `/internal/sampling/run`, and whether `wait_samples` is growing at all.
- **`consecutive_failures > 0`** → read `err`. Legs are isolated, so one failure doesn't stop the others, but a persistently failing `archiveWaitSamples` means data is being lost daily and is urgent.

### 2. The archive is growing

```sql
SELECT COUNT(*) AS rows, COUNT(DISTINCT experience_id) AS experiences,
       MIN(date)::text AS first_date, MAX(date)::text AS last_date,
       SUM(sample_count) AS total_samples
FROM wait_archive;
```

Baseline on 2026-08-27: **36,740 rows**, 229 experiences, `2026-08-04` to `2026-08-26`, 176,888 total samples.

Expect roughly +1,600 rows per day. `last_date` should be yesterday or today. If `last_date` is stale while `derived_stat_runs.archiveWaitSamples` looks healthy, the lookback window may not be reaching — it is 7 days (`WAIT_ARCHIVE_LOOKBACK_DAYS`).

Cross-check nothing is being dropped:

```sql
SELECT (SELECT SUM(sample_count) FROM wait_archive
        WHERE date >= (SELECT MIN(observed_at AT TIME ZONE 'America/New_York')::date FROM wait_samples)) AS archived,
       (SELECT COUNT(*) FROM wait_samples WHERE status = 'OPERATING') AS raw_operating;
```

These should be very close. Archived slightly higher is fine (it retains days whose raw rows were pruned); archived materially *lower* means the aggregation is missing rows.

### 3. Wait forecasts are being captured AND scored

```sql
SELECT lead_days,
       COUNT(*) AS rows,
       SUM(CASE WHEN observed_wait_minutes IS NOT NULL THEN 1 ELSE 0 END) AS reconciled,
       MIN(date)::text AS first_target, MAX(date)::text AS last_target
FROM wait_forecast_log
GROUP BY lead_days ORDER BY lead_days;
```

**This is the check that matters.** Expect:

- 160 rows per lead per day of capture (40 rides × 4 hours).
- `reconciled > 0` for **lead 1** — it targets tomorrow, so days from 2026-08-27 onward should be scored.
- `reconciled = 0` for lead 7 is still normal on 2026-09-03: its earliest target was 2026-09-02, only just elapsed.

If `reconciled` is **0 across all leads** while `wait_archive` is healthy, reconciliation isn't matching. The join key is `(experience_id, ET date, hour)`. Confirm the archive actually holds those hours:

```sql
SELECT l.experience_id, l.date::text, l.hour, l.predicted_wait_minutes,
       a.avg_wait_minutes AS observed
FROM wait_forecast_log l
LEFT JOIN wait_archive a
  ON a.experience_id = l.experience_id AND a.date = l.date AND a.hour = l.hour
WHERE l.observed_wait_minutes IS NULL AND l.date < CURRENT_DATE
LIMIT 20;
```

A null `observed` here is **not necessarily a bug** — a ride that wasn't operating at 10 AM has no archive row, and the design deliberately leaves those unreconciled rather than scoring a closure as a 0-minute wait. But if *every* row is null, something structural is wrong.

### 4. Sanity-check the first scored errors

```sql
SELECT e.name, l.lead_days, l.hour,
       ROUND(l.predicted_wait_minutes::numeric,0) AS predicted,
       ROUND(l.observed_wait_minutes::numeric,0)  AS observed,
       ROUND(l.error::numeric,1) AS error_min
FROM wait_forecast_log l JOIN experiences e ON e.id = l.experience_id
WHERE l.observed_wait_minutes IS NOT NULL
ORDER BY ABS(l.error) DESC LIMIT 15;
```

`error = predicted − observed`, in minutes. Positive means we over-predicted. Errors in the ±5–25 minute range on headliners are expected. Errors of ±200 suggest a units or matching bug, not a model problem — investigate rather than accept.

## Do NOT do yet

- Don't draw conclusions about model accuracy from a week of data, and don't act on `wait_forecast_accuracy` yet. That's the 2026-09-10 runbook.
- Don't build the bias-correcting challenger. That decision needs the October comparison.

## Done when

12 healthy legs, `wait_archive` growing, and at least some lead-1 rows carrying a plausible `error`. Record anything anomalous in this file so the next runbook has it.
