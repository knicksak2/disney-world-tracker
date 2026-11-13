# 2026-12-15 — Holiday check: promoted 3A (MK/HS) and shadow 3A (AK/EPCOT)

**Read-only.** About 20–30 minutes to run and record. Does not promote or roll back anything by itself; any change it suggests is a separate, deliberate follow-up.

## Context

The 2026-11-10 check (`2026-11-10-shadow-challenger-promotion-check.md`, run 2026-11-12) found:

- Step 3A (`applyWaitBiasCorrection`) clearly beat the served prediction at **Magic Kingdom** (about 6 min lower MAE, 15/15 rides) and **Hollywood Studios** (about 2 min).
- At **EPCOT** it made no real difference (−1.05 / −0.06 / +0.88 min at leads 1/3/7 on clean rows). At **Animal Kingdom** it was worse at every lead (about +2 to +4 min).
- About 26% of forecast batches were **unpaired**: `upsertWaitForecastLogs`'s `ON CONFLICT` updated only `challenger_wait_minutes`. When the daily job ran twice in one day, the stored challenger came from a different run than the stored served value.
- Step 4 (crowd-bias variant) barely ran, because it only fills rows 3A left null. It is dormant; this check does not judge it.

Decisions taken after that check:

1. Fix the pairing bug.
2. Promote 3A for MK and HS only. Score bias against the **uncorrected** model output, so the correction does not cancel itself out. Keep the promoted park list changeable without a code deploy.
3. Keep EPCOT and AK in shadow. Look at their post-fix data in mid-December as a **first look, not a decision**: December is holiday-crowd data and may not represent a normal month.

## Fill in before running

These depend on changes that had not shipped when this runbook was written. Fill them in from the commits that shipped them.

```
FIX_DATE          = 2026-11-13T06:00:00Z   (fix 4c25bbd pushed to develop ~05:20 UTC, Render
                    auto-deploys develop; the daily capture runs ~12:00 UTC, so the first fixed
                    capture is the 2026-11-13 run. Step 0 confirms the deploy actually took.)
PROMOTION_DATE    = ____   (first forecasted_at after 3A promotion deployed, UTC)
Promoted parks    = ____   (expected: Magic Kingdom, Hollywood Studios; env var name: ____)
RAW_COL / RAW_ERR = ____   (log columns holding the uncorrected prediction and its error after promotion)
```

Replace `:fix_date`, `:promotion_date`, `<RAW_COL>` and `<RAW_ERR>` in the queries below. Run against the hosted Neon DB (`apps/api/.env.dev`), using the pattern in `docs/runbooks/README.md`.

If the fix or the promotion has not shipped, do only the parts that apply and record which parts were skipped and why.

## Step 0 — Confirm the pairing fix works in production

Within one `(experience_id, lead_days, forecasted_at)` batch, 3A gives a constant `predicted − challenger` offset and Step 4 gives a constant `challenger / predicted` ratio. After the fix, there should be no batches that are neither.

```sql
WITH b AS (
  SELECT l.experience_id, l.lead_days, l.forecasted_at, e.park,
         stddev_pop(l.predicted_wait_minutes - l.challenger_wait_minutes) AS sd_diff,
         stddev_pop(CASE WHEN l.predicted_wait_minutes > 0
                         THEN l.challenger_wait_minutes / l.predicted_wait_minutes END) AS sd_ratio
  FROM wait_forecast_log l JOIN experiences e ON e.id = l.experience_id
  WHERE l.challenger_wait_minutes IS NOT NULL AND l.challenger_wait_minutes > 0
    AND l.forecasted_at >= :fix_date
    AND e.park IN ('EPCOT', 'Animal Kingdom')
  GROUP BY 1, 2, 3, 4 HAVING count(*) >= 3)
SELECT park,
  SUM(CASE WHEN sd_diff < 0.01 THEN 1 ELSE 0 END) AS batches_offset_3a,
  SUM(CASE WHEN sd_diff >= 0.01 AND sd_ratio < 0.001 THEN 1 ELSE 0 END) AS batches_ratio_step4,
  SUM(CASE WHEN sd_diff >= 0.01 AND (sd_ratio IS NULL OR sd_ratio >= 0.001) THEN 1 ELSE 0 END) AS batches_other
FROM b GROUP BY park ORDER BY park;
```

- Expected: `batches_other = 0`. (Before the fix it was 143 at EPCOT and 174 at AK.)
- If it is not 0, the fix is not working. Record the counts, skip Step 2, and treat fixing it as the priority.
- This query is scoped to the shadow parks. At promoted parks the meaning of the columns changes with promotion; Step 1 covers those.

## Step 1 — MK/HS: is the promoted correction still beating the raw model?

Compare the served (corrected) error with the raw model's error on the same rows, after promotion.

```sql
SELECT e.park, l.lead_days,
       COUNT(*) AS n,
       COUNT(DISTINCT l.experience_id) AS rides,
       ROUND(AVG(ABS(l.error))::numeric, 2)     AS served_corrected_mae,
       ROUND(AVG(ABS(l.<RAW_ERR>))::numeric, 2) AS raw_mae,
       ROUND(AVG(l.error)::numeric, 2)          AS served_corrected_bias,
       ROUND(AVG(l.<RAW_ERR>)::numeric, 2)      AS raw_bias
FROM wait_forecast_log l JOIN experiences e ON e.id = l.experience_id
WHERE l.forecasted_at >= :promotion_date
  AND e.park IN ('Magic Kingdom', 'Hollywood Studios')
  AND l.error IS NOT NULL AND l.<RAW_ERR> IS NOT NULL
GROUP BY 1, 2 ORDER BY 1, 2;
```

Also check by week, to see whether the gain holds through the holiday weeks (Thanksgiving week, early December party nights):

```sql
SELECT e.park, date_trunc('week', l.date)::date AS week,
       COUNT(*) AS n,
       ROUND(AVG(ABS(l.error))::numeric, 2)     AS served_corrected_mae,
       ROUND(AVG(ABS(l.<RAW_ERR>))::numeric, 2) AS raw_mae
FROM wait_forecast_log l JOIN experiences e ON e.id = l.experience_id
WHERE l.forecasted_at >= :promotion_date
  AND e.park IN ('Magic Kingdom', 'Hollywood Studios')
  AND l.error IS NOT NULL AND l.<RAW_ERR> IS NOT NULL
GROUP BY 1, 2 ORDER BY 1, 2;
```

How to read it:

| Result | Meaning |
|---|---|
| Corrected MAE clearly below raw at most leads and weeks | The correction holds through the holidays. Keep it. |
| Gap gone or reversed only in one sharp week | The correction is probably lagging a sudden crowd shift. Note it; the ±15-min clamp limits harm. Not a reason to roll back by itself. |
| Corrected worse than raw across most weeks | Consider rolling back that park via the park list. Record the evidence first. |
| `served_corrected_bias` shrinks toward 0 **and** `raw_bias` also shrinks | Check that bias is really being scored on the raw output. If the correction's input bias tracks the corrected error, the self-cancelling loop the promotion was designed to avoid is present. |

## Step 2 — EPCOT/AK: first look at clean shadow data (no decision)

Post-fix rows only. Do **not** use `wait_forecast_accuracy` for this; it still contains pre-fix unpaired rows.

```sql
SELECT e.park, l.lead_days,
       COUNT(*) AS n,
       COUNT(DISTINCT l.experience_id) AS rides,
       ROUND(AVG(ABS(l.error))::numeric, 2)            AS served_mae,
       ROUND(AVG(ABS(l.challenger_error))::numeric, 2) AS challenger_mae,
       ROUND(AVG(l.error)::numeric, 2)                 AS served_bias,
       ROUND(AVG(l.challenger_error)::numeric, 2)      AS challenger_bias
FROM wait_forecast_log l JOIN experiences e ON e.id = l.experience_id
WHERE l.forecasted_at >= :fix_date
  AND e.park IN ('EPCOT', 'Animal Kingdom')
  AND l.error IS NOT NULL AND l.challenger_error IS NOT NULL
GROUP BY 1, 2 ORDER BY 1, 2;
```

Per-ride consistency:

```sql
WITH r AS (
  SELECT l.experience_id, e.park, l.lead_days, COUNT(*) AS n,
         AVG(ABS(l.error)) AS s, AVG(ABS(l.challenger_error)) AS c
  FROM wait_forecast_log l JOIN experiences e ON e.id = l.experience_id
  WHERE l.forecasted_at >= :fix_date
    AND e.park IN ('EPCOT', 'Animal Kingdom')
    AND l.error IS NOT NULL AND l.challenger_error IS NOT NULL
  GROUP BY 1, 2, 3)
SELECT park, lead_days, COUNT(*) AS rides,
       SUM(CASE WHEN c < s THEN 1 ELSE 0 END) AS challenger_better,
       SUM(CASE WHEN c > s THEN 1 ELSE 0 END) AS challenger_worse,
       MIN(n) AS min_rows_per_ride
FROM r GROUP BY 1, 2 ORDER BY 1, 2;
```

Expect thin data: about 3–4 weeks of clean rows, fewest at lead 7. Many rides will be under the usual 30-sample bar. Record direction, not a verdict.

| Result | What to record |
|---|---|
| Challenger clearly better at most leads/rides | "Trending positive on holiday data." Re-check mid-to-late January on non-holiday data before considering promotion. |
| Flat or mixed | "No signal yet." Re-check in January. |
| Challenger worse at most leads/rides (as in November) | Two consistent negative reads. Reasonable to mark that park "do not promote"; a negative result on noisier data is still informative. |

## Record here

```
Date run:
FIX_DATE / PROMOTION_DATE / promoted parks / raw columns used:

Step 0 — unpaired batches after fix:  EPCOT ____  AK ____   (expected 0)

Step 1 — MK/HS, corrected vs raw MAE by lead:
  MK  lead 1: ____ / ____   lead 3: ____ / ____   lead 7: ____ / ____
  HS  lead 1: ____ / ____   lead 3: ____ / ____   lead 7: ____ / ____
  Weekly: any week where the gap reversed? ____
  Bias scored on raw output (no self-cancelling)?  yes / no / unclear
  Decision: keep / roll back <park> / investigate

Step 2 — EPCOT/AK, served vs challenger MAE by lead (post-fix only):
  EPCOT lead 1: ____ / ____   lead 3: ____ / ____   lead 7: ____ / ____   better/worse rides: ____
  AK    lead 1: ____ / ____   lead 3: ____ / ____   lead 7: ____ / ____   better/worse rides: ____
  Direction: positive / no signal / negative   (per park)

Action taken this run:
Next check-in date (January, non-holiday data):
Anything anomalous:
```
