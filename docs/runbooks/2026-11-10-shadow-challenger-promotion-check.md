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
Date run:
Lead-1 challenger_sample_count ready (>=30)?  rides ready = ____  total points = ____
Lead-3 ready?  rides ready = ____  total points = ____
Lead-7 ready?  rides ready = ____  total points = ____

Step 3A (all parks) — served_mae vs challenger_mae by lead:
  lead 1: served ____  challenger ____
  lead 3: served ____  challenger ____
  lead 7: served ____  challenger ____
  Verdict: promote / hold / do-not-promote

Step 4 (MK/AK only) — served_mae vs challenger_mae by lead:
  lead 1: served ____  challenger ____
  lead 3: served ____  challenger ____
  lead 7: served ____  challenger ____
  Verdict: promote / hold / do-not-promote

Action taken this run: (none / 3A promoted / Step 4 promoted / both / postponed)
If promoted: commit(s), spec sections amended, tests changed:
If held or not promoted: next check-in date:
Anything anomalous:
```
