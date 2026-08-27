# 2027-08-01 — Re-anchor the Ride_Baseline from a year of archive (task 21.5 / R14.9)

**Long-dated on purpose.** This is a no-op until `wait_archive` holds a full 365 days. The archive starts at **2026-08-04**, so the earliest this can be done properly is August 2027.

## Context — why the baseline exists and why it is frozen

The observed Crowd_Index is the mean, across a park's standby basket, of each ride's `observed wait / expected wait`. Until 2026-08-27 that `expected` was `ride_shapes.avg_wait_minutes` — a fast EMA (~4 weeks of memory) updated toward the very observations forming the numerator. The ratio therefore measured its own denominator's decay. Evidence: over 2026-08-11..18 → 08-19..25 the index rose in **all four** parks (MK 0.819→0.909, HS 0.855→0.933, EPCOT 0.858→0.903, AK 0.881→0.901) while the mean posted wait **fell** (23.85→23.25).

The fix added `ride_shapes.baseline_wait_minutes` — established once from a settled shape average, then **frozen**. Not a slow EMA: that alternative was implemented first and rejected by its own regression test (0.197 ratio units of drift over 100 passes, only 1.27× better than the fast shape, because both converge on the observations eventually). More fundamentally, *any* exponential memory over-weights the most recent season, so it can never be season-neutral — and season-neutrality is the one property the index needs in order to compare December with August.

Freezing has an obvious cost: it goes stale when a ride's real capacity or popularity changes. **This runbook is how that cost is paid.**

## Why 365 days specifically

A trailing 365-day mean is **season-neutral by construction** — it contains exactly one of every season, so it cannot over-weight the current one. That is why it is the correct re-anchoring source and an EMA is not. A 180-day window would be worse than the frozen seed value, because it would bake in whichever half of the year it happened to cover.

## Step 1 — Confirm the archive really has a year

```sql
SELECT MIN(date)::text AS first_date, MAX(date)::text AS last_date,
       MAX(date) - MIN(date) AS span_days,
       COUNT(*) AS rows,
       COUNT(DISTINCT date) AS distinct_days
FROM wait_archive;
```

Require `span_days >= 365` **and** `distinct_days` close to it. A 400-day span with only 200 distinct days means large gaps, and a mean over that is not season-neutral — check `derived_stat_runs.archiveWaitSamples` history before proceeding.

Per-ride coverage matters too, since re-anchoring a ride on three months of data would be worse than leaving it frozen:

```sql
SELECT experience_id, COUNT(DISTINCT date) AS days_covered,
       COUNT(*) AS hour_rows
FROM wait_archive WHERE date > CURRENT_DATE - 365
GROUP BY experience_id ORDER BY days_covered LIMIT 20;
```

## Step 2 — Compute the candidate re-anchor and compare BEFORE writing anything

Do not overwrite in place first. Look at the deltas:

```sql
WITH candidate AS (
  SELECT wa.experience_id,
         EXTRACT(DOW  FROM wa.date)::int AS day_of_week,
         wa.hour,
         SUM(wa.avg_wait_minutes * wa.sample_count) / SUM(wa.sample_count) AS new_baseline,
         SUM(wa.sample_count) AS n,
         COUNT(DISTINCT wa.date) AS days
  FROM wait_archive wa
  WHERE wa.date > CURRENT_DATE - 365
  GROUP BY 1, 2, 3
)
SELECT e.name, c.day_of_week, c.hour,
       ROUND(rs.baseline_wait_minutes::numeric,1) AS frozen,
       ROUND(c.new_baseline::numeric,1)           AS candidate,
       ROUND((c.new_baseline - rs.baseline_wait_minutes)::numeric,1) AS delta,
       c.n, c.days
FROM candidate c
JOIN ride_shapes rs
  ON rs.experience_id = c.experience_id AND rs.day_of_week = c.day_of_week AND rs.hour = c.hour
JOIN experiences e ON e.id = c.experience_id
WHERE c.days >= 30
ORDER BY ABS(c.new_baseline - rs.baseline_wait_minutes) DESC
LIMIT 40;
```

Note the **sample-weighted** mean, not `AVG(avg_wait_minutes)` — hours with more observations should count more.

**How to read the deltas.** The frozen values were backfilled from `avg_wait_minutes` on 2026-08-27, which still carried most of the RopeDrop multi-year seed. So:

- Small deltas (±5 min) → the seed was good; re-anchoring is a refinement.
- A few large deltas on specific rides → likely genuine change (a refurb, a new ride maturing past its opening surge, a retheme). Exactly what this exists for.
- Large deltas **everywhere in the same direction** → suspect the archive, not the baseline. A uniform shift usually means a systematic collection change, and re-anchoring on it would move the yardstick for the wrong reason. Investigate before writing.

## Step 3 — Implement it as an isolated, gated leg

Per the existing pattern in `derivedStatsService.ts`:

- A new repo method `reanchorRideBaselines(since)` doing the whole thing server-side as one `UPDATE ... FROM (SELECT ... GROUP BY ...)`, mirroring `archiveWaitSamples`. It needs `AT TIME ZONE`-free arithmetic on the `date` column (already a DATE), but note `EXTRACT(DOW FROM date)` on a DATE is safe — no timezone conversion needed, unlike the raw-sample path.
- A new leg `reanchorRideBaselines` in `runDailyRecompute`, wrapped in `runLeg` for isolation and `derived_stat_runs` recording.
- **Gate it three ways**: only run when the archive spans ≥365 days; only update buckets with ≥`MIN_REANCHOR_DAYS` (start at 30) distinct days of coverage; and run at most monthly, not daily — this is a deliberate re-anchor, not a continuous adaptation. Re-anchoring nightly would quietly reintroduce exactly the drift the freeze exists to prevent.
- Update `baseline_sample_count` alongside, capped at `BASELINE_SAMPLE_COUNT_CAP = 500`.

**Requirements/design/tasks**: R14.9 already specifies this behaviour, and task 21.5 is already written. Amend the design's Configuration & Constants with the new constants (`MIN_REANCHOR_DAYS`, the cadence), extend the R13.1 leg list, and bump the `derived_stat_runs` row count in the design's migration 0030 note. Check the leg list first — it was 12 as of 2026-08-27 and may have grown.

**Tests** (live-Postgres harness — the aggregation is real SQL, and pg-mem can't host multi-array `unnest` or raise `21000`):

- sample-weighted mean is computed correctly, not a plain average;
- a bucket with fewer than `MIN_REANCHOR_DAYS` days is left **unchanged**;
- an unestablished (`NULL`) baseline is not created by re-anchoring — establishment stays the sampling pass's job;
- the leg is a no-op when the archive spans under 365 days;
- `baseline_sample_count` respects the cap.

## Step 4 — Verify the index afterwards

Re-anchoring shifts the Crowd_Index's denominator, so the index level will step. That is expected and correct, but it must be a **step, not a drift**:

```sql
SELECT date, park, ROUND(crowd_index::numeric,3) AS crowd_index,
       ROUND(daily_avg_wait::numeric,1) AS avg_wait
FROM park_crowd_index
WHERE source = 'observed' AND date > CURRENT_DATE - 30
ORDER BY date DESC, park;
```

After the step, index and `avg_wait` must still move **together**. If the index starts creeping while waits are flat, the freeze has been broken somewhere — check that the sampling pass still calls `establishBaseline` (a no-op on established buckets) rather than an update.

Also expect `crowd_forecast_accuracy` bias to move, because the target it scores against has shifted. It should re-converge within a few weeks via the R7.4 loop. If it does not, the re-anchor cadence is probably too frequent.

## Consider while you are here

With a year of archive you can also finally do the thing the archive was really built for: a **day-level crowd model** trained on the ~940 days of seeded WDW Passport levels plus a year of your own observations, using day-of-week, month, day-of-year, holiday proximity, park hours and Lightning Lane price. That is a separate spec, not this runbook — but this is the point at which it becomes possible, and the wait-forecast log means you could shadow-score it before trusting it.

## Record here

```
Date run:
Archive span (days) / distinct days:
Buckets eligible (>=30 days):
Largest deltas (ride, dow, hour, frozen -> candidate):
Uniform shift observed? yes / no  (if yes, what caused it)
Implemented? cadence chosen:
Index vs waits still moving together after the step? yes / no
Crowd bias re-converged? after how long:
```
