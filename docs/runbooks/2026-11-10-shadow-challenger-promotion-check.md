# 2026-11-10 — Shadow challenger promotion check

**Read-only by default.** Only becomes a code change if a challenger is clearly ahead and you decide to promote it — see "If promoting" below. About 20–30 minutes to run and record; promotion itself is a separate, deliberate follow-up.

## Context

The 2026-10-08 runbook (`2026-10-08-bias-vs-lag-decision.md`) diagnosed the per-ride wait-model error as genuine bias, not EMA lag (32/37 rides held sign Sep→Oct while waits trended up ~15–28% across all four parks). It wired **two independent shadow challengers**, both writing to `wait_forecast_accuracy.challenger_mae` / `challenger_bias` / `challenger_sample_count` (and the underlying `wait_forecast_log.challenger_wait_minutes`), never to the served `predicted_wait_minutes`:

1. **Step 3A (R18.10)** — `applyWaitBiasCorrection(predicted, bias)`: served prediction minus the measured per-`(experience_id, lead_days)` bias, clamped to `±WAIT_BIAS_CORRECTION_BOUND_MINUTES` (15 min), floored at 0. Fires when a `wait_forecast_accuracy` row exists for that cell with `sample_count >= 30`.
2. **Step 4 (R7.8)** — `crowdMultiplierVariant(predictedWaitMinutes, crowdBias)`: applies the already-measured **crowd** bias (from `crowd_forecast_accuracy`) through the wait path's `crowdMultiplier`, for Magic Kingdom and Animal Kingdom only. Tests the question R7.7 deliberately left open. Only fills a row when Step 3A left that row's challenger `null` — the two never overwrite each other on the shared column.

Both were built on 2026-10-13 and need forward-scored data to accrue before either can be judged — testing a bias correction against the same window the bias was measured from is circular. `wait_forecast_accuracy.sample_count >= 30` is the reliability bar used throughout this spec (R15's `TIER1_RELIABILITY_THRESHOLD`); the same bar applies to `challenger_sample_count` here.

Lead-1 forecasts reconcile daily, so those cells fill fastest (~1 month to comfortably clear 30 samples at roughly one scored point per ride per day). Lead-7 forecasts take 7 days just to reconcile once, so they're the slowest to mature — this is why the date was set four weeks out rather than one.

## Step 1 — Is there enough data to judge yet?

```sql
SELECT lead_days,
       COUNT(*) AS rides_with_accuracy_row,
       SUM(CASE WHEN challenger_sample_count >= 30 THEN 1 ELSE 0 END) AS rides_ready,
       SUM(challenger_sample_count) AS total_challenger_points
FROM wait_forecast_accuracy
GROUP BY lead_days ORDER BY lead_days;
```

- **If `rides_ready` at lead 1 is 0 or near-0**, the challenger hasn't accumulated enough scored points yet. Don't force a verdict — re-run this check in another 1–2 weeks instead. Record the postponement (real query output) in this file's "Record here" section and stop.
- Otherwise, proceed per lead time independently. Lead 1 maturing while lead 7 hasn't is expected and fine — judge each lead on its own data, don't wait for all three to be ready before looking at any.

## Step 2 — Compare served vs. challenger, per challenger, per lead

```sql
SELECT lead_days,
       ROUND(AVG(mae)::numeric,2)            AS served_mae,
       ROUND(AVG(challenger_mae)::numeric,2) AS challenger_mae,
       ROUND(AVG(bias)::numeric,2)           AS served_bias,
       ROUND(AVG(challenger_bias)::numeric,2) AS challenger_bias,
       SUM(sample_count)           AS served_n,
       SUM(challenger_sample_count) AS challenger_n,
       COUNT(*) AS rides
FROM wait_forecast_accuracy
WHERE challenger_sample_count >= 30
GROUP BY lead_days ORDER BY lead_days;
```

This mixes both challengers' contributions into one `challenger_mae` column (whichever of 3A/Step 4 wrote that row), because the serving code writes to the same shared column per row and never both. To separate the two, join against which rows plausibly came from which: Step 4 only ever applies to Magic Kingdom and Animal Kingdom, so split by park:

```sql
SELECT e.park, a.lead_days,
       ROUND(AVG(a.mae)::numeric,2)            AS served_mae,
       ROUND(AVG(a.challenger_mae)::numeric,2) AS challenger_mae,
       SUM(a.challenger_sample_count) AS challenger_n,
       COUNT(*) AS rides
FROM wait_forecast_accuracy a
JOIN experiences e ON e.id = a.experience_id
WHERE a.challenger_sample_count >= 30
GROUP BY e.park, a.lead_days ORDER BY e.park, a.lead_days;
```

Non-MK/AK parks (EPCOT, Hollywood Studios) can only have been scored by Step 3A, since Step 4 is scoped to MK/AK only — that's your clean read on 3A alone. MK/AK rows are a mix of whichever challenger actually wrote `challenger_wait_minutes` for each row; if you need a clean split there too, check `wait_forecast_log.challenger_wait_minutes` against both `applyWaitBiasCorrection(predicted, bias)` and `crowdMultiplierVariant(predicted, crowdBias)` for a sample of rows to see which formula produced the stored value, since the service always prefers 3A when both would apply.

## Step 3 — Verdict per challenger

| challenger_mae vs served_mae | verdict |
|---|---|
| Clearly lower (not just a few hundredths — look for a consistent, meaningful gap across most leads/rides, not a single lead_days row) | Promote |
| Roughly equal / mixed | Hold — not enough signal yet, or the correction isn't actually helping. Keep collecting, re-check in another 2–4 weeks, or abandon if the gap never materializes after two full check cycles. |
| Clearly higher (challenger worse) | Do not promote. Record the negative result — this is useful information, not a failure. For Step 4 specifically, a negative result here confirms R7.7's original reasoning was right and the requirement should stay exactly as it is. |

Apply this independently to Step 3A (all parks) and Step 4 (MK/AK only, where it was scored).

## If promoting (code change — do not do this casually)

**Step 3A promotion:** This is a deliberate edit to the serving path, which R18.6 requires to be a conscious decision, not automatic. It means changing whichever call site constructs the served `predicted_wait_minutes` so it goes through `applyWaitBiasCorrection` (or equivalent) before being returned/stored, rather than only writing the corrected value to the shadow column. This needs:
- A spec amendment (additive): mark R18.10 as promoted/served in `requirements.md`, update the relevant Correctness Property in `design.md` to describe the new served behavior, add a task in `tasks.md`.
- Tests at the layer that changes: whatever test currently asserts `predicted_wait_minutes` is byte-identical regardless of the challenger (`waitForecastAccuracy.test.ts`) will need to be revised to reflect the new served behavior — do not just delete it, replace its assertion deliberately and explain why in the commit.
- Decide what happens to the now-redundant shadow write — likely it can stop computing `challenger_wait_minutes` from the same formula, since served and challenger would now be identical. Don't leave dead code; either repurpose the challenger slot for the next thing to test, or stop writing to it for this cell.

**Step 4 promotion:** Same discipline, but this one also means amending R7.7 itself (which explicitly prohibits propagating crowd bias into the wait path) — not just adding a new requirement. R7.7's own text says this asymmetry "SHALL NOT be tidied up... before" R18 can score both variants; promoting means that condition has now been met, so update R7.7 to reflect the new scope (MK/AK only, per the evidence) rather than deleting its reasoning — the history of *why* the asymmetry existed is still useful context for later readers. Since this spec explicitly treats a successful result and a null result as equally legitimate outcomes to record, a "do not promote" verdict for Step 4 just means re-affirming R7.7 as-is with the evidence noted — not editing the spec at all beyond this runbook's own record.

If either verdict is "Hold," don't touch any code or spec file this run — just record the numbers and the decision to keep waiting.

## Record here

```
Date run: 2026-11-12 ET (hosted Neon DB, apps/api/.env.dev). Scored window 2026-10-14..2026-11-11, 9,496 scored log rows.
Lead-1 challenger_sample_count ready (>=30)?  rides ready = 37 of 41  total points = 3533
Lead-3 ready?  rides ready = 37 of 41  total points = 3261
Lead-7 ready?  rides ready = 37 of 41  total points = 2702
  (Not ready: Meet Ariel at Her Grotto, ~21 pts, plus 3 MNSSHP meet-and-greets that are seasonal and finished.)

Step 2 (wait_forecast_accuracy, challenger_sample_count >= 30, 37 rides, both challengers mixed):
  lead 1: served 13.78  challenger 10.81  (bias 8.28 -> 3.78)  challenger better on 32/37 rides
  lead 3: served 13.72  challenger 11.14  (bias 8.04 -> 4.31)  31/37
  lead 7: served 14.43  challenger 12.16  (bias 8.96 -> 6.03)  28/37

By park (accuracy table), served / challenger, lead 1 / 3 / 7:
  MK   16.18/10.63  15.88/11.24  17.20/12.21   (15/15 rides better at every lead)
  HS   12.90/11.12  12.91/10.82  13.62/11.82   (8/9, 8/9, 7/9)
  EPCOT 14.16/12.84 14.32/13.35  14.31/14.20   (5/6, 4/6, 4/6)
  AK    9.46/9.05    9.59/9.43    9.65/10.72   (4/7, 4/7, 2/7)

Attribution from wait_forecast_log: per (ride, lead, forecasted_at) batch, a constant
predicted-challenger offset = 3A; a constant ratio = Step 4. Row-level MAE on scored rows
in batches cleanly identified as 3A, served / challenger:
  MK    l1 17.12/10.95  l3 16.56/10.86  l7 18.94/11.65
  HS    l1 13.47/11.46  l3 14.10/12.20  l7 14.88/13.22
  EPCOT l1 14.94/13.89  l3 13.59/13.53  l7 15.31/16.19
  AK    l1  8.70/10.68  l3  8.76/11.21  l7  8.98/12.62

Step 3A (all parks) — clean read is EPCOT + HS (accuracy table above):
  lead 1: served EPCOT 14.16 / HS 12.90  challenger EPCOT 12.84 / HS 11.12
  lead 3: served EPCOT 14.32 / HS 12.91  challenger EPCOT 13.35 / HS 10.82
  lead 7: served EPCOT 14.31 / HS 13.62  challenger EPCOT 14.20 / HS 11.82
  Verdict: meets the "promote" bar overall (2.3-3.0 min lower MAE at every lead, 28-32 of
  37 rides better). The gain is not uniform: MK large, HS clear, EPCOT mixed by lead 7,
  AK WORSE at every lead on clean 3A rows. Promotion is pending the owner's decision.
  Options are all-parks promotion, or promotion excluding AK.

Step 4 (MK/AK only) — only 4 rides (1 AK, 3 MK), 132 scored rows. 3A covers every
mature ride, so Step 4 fires only on rides 3A has not reached 30 samples on.
  lead 1: served AK 7.74 / MK 28.75  challenger AK 7.06 / MK 21.21  (n=23 / 16)
  lead 3: served AK 7.40 / MK 27.91  challenger AK 6.59 / MK 20.02  (n=36 / 22)
  lead 7: served AK 6.05 / MK 17.23  challenger AK 6.48 / MK  9.89  (n=22 / 13)
  Verdict: hold. Too few rides and rows to judge.

Action taken this run: none (3A promotion decision pending with owner; no code or spec changed)
If promoted: commit(s), spec sections amended, tests changed: n/a
If held or not promoted: next check-in date: 2026-12-15, see
  2026-12-15-holiday-correction-and-shadow-parks-check.md. Decided after this run: fix the
  pairing bug, promote 3A for MK and HS only, keep EPCOT/AK in shadow. Step 4 is dormant and
  will never accrue much data while 3A owns the shared column (see anomaly 2).
Anything anomalous:
  1. Pairing defect: about 26% of batches (961 of 3,711) are neither a constant offset nor a
     constant ratio, and some show offsets above the 15-min clamp (e.g. predicted 43 ->
     challenger 16). IntelligenceRepo.upsertWaitForecastLogs ON CONFLICT updates only
     challenger_wait_minutes (COALESCE), not predicted_wait_minutes. So when the daily job
     runs twice on the same day, the stored challenger comes from a different run's
     prediction than the stored served value. Those rows are not a like-for-like comparison.
     The clean-3A table above excludes them.
  2. Step 4 starves by design: it only gets rows 3A left null. That limits it to new or
     seasonal rides (MNSSHP meet-and-greets, Ariel). Its "two cycles then abandon" rule
     will trigger from lack of data, not from a negative result.
  3. AK disagrees between sources: the accuracy table shows a small 3A gain at leads 1/3,
     while clean 3A log rows show 3A worse at all leads. The accuracy row mixes in the
     unpaired rows and Step 4 rows.
```
