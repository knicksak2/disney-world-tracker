/**
 * Pure math for wait times and crowd indices.
 * Property-testable, no I/O.
 */

import type { ThemeParksLiveEntry } from '../live/themeParksLiveClient.js';

/**
 * Applies an Exponential Moving Average (EMA) update.
 * @param prev The previous EMA value.
 * @param sample The new observation.
 * @param weight The EMA weight (alpha), e.g. 2 / (N + 1).
 */
export function applyEma(prev: number, sample: number, weight: number): number {
  return prev + weight * (sample - prev);
}

/**
 * Updates the streaming variance using EMA.
 * The standard deviation is the square root of this variance.
 */
export function emaVariance(
  prevVariance: number,
  prevMean: number,
  sample: number,
  weight: number
): number {
  // Welford-like EMA variance update
  return (1 - weight) * (prevVariance + weight * Math.pow(sample - prevMean, 2));
}

/**
 * Normalizes a daily average wait into a continuous crowd index.
 * For example, scaling relative to the park's all-time distribution.
 * For simplicity as a starting formula, we can assume a linear mapping based
 * on known park distribution min/max or typical values.
 */
export function normalizeCrowdIndex(
  dailyAvg: number,
  parkDistribution: { typical: number; maxTypical: number }
): number {
  if (parkDistribution.typical <= 0) return 1.0;
  // A simple continuous index centered around 5.0 for the typical day
  // bounded loosely. We'll map dailyAvg / typical roughly to 1-10.
  // Using 1.0 = typical (from formula: 1.0 = typical day).
  // Wait, the spec says featureModel typical is a continuous baseline or 1.0.
  // Let's normalize such that dailyAvg == typical -> 1.0
  const continuous = dailyAvg / parkDistribution.typical;
  return continuous;
}

/**
 * Computes the crowd multiplier from continuous indices.
 * @param forecastContinuous The forecast (or observed) continuous index.
 * @param typicalContinuous The typical continuous index for this park/day-of-week.
 */
export function crowdMultiplier(
  forecastContinuous: number,
  typicalContinuous: number
): number {
  if (typicalContinuous <= 0) return 1.0;
  const ratio = forecastContinuous / typicalContinuous;
  return clampCrowdMultiplier(ratio);
}

/**
 * Lower/upper bound on any crowd factor applied to a wait (design:
 * Configuration & Constants). Named because two *different* quantities share
 * the clamp: the tier-2 absolute factor `forecastIndex / 1.0` and the tier-1
 * relative factor `forecastIndex / seasonBucket.avgCrowdIndex` (R15.3).
 */
export const CROWD_MULTIPLIER_MIN = 0.4;
export const CROWD_MULTIPLIER_MAX = 2.0;

/** Clamps any crowd factor into the shared ratio band. */
export function clampCrowdMultiplier(ratio: number): number {
  if (!Number.isFinite(ratio)) return 1.0;
  return Math.max(CROWD_MULTIPLIER_MIN, Math.min(CROWD_MULTIPLIER_MAX, ratio));
}

/**
 * Maps a continuous crowd index to a 1-10 display integer.
 * This is the ONLY place where quantization occurs.
 */
export function displayLevel(continuousIndex: number): number {
  // Assuming continuousIndex 1.0 = typical (middle, ~5)
  // Let's map continuousIndex to [1, 10].
  // E.g., if continuousIndex is 1.0, level is 5.
  // If continuous = 2.0, level = 10.
  // Formula: level = 5 * continuousIndex
  const scaled = Math.round(5 * continuousIndex);
  return Math.max(1, Math.min(10, scaled));
}

export interface SeasonBucket {
  wait: number;
  sampleCount: number;
  /**
   * R15: the recency-weighted mean observed Crowd_Index (continuous ratio,
   * 1.0 = typical) of the samples that formed this bucket.
   *
   * A season bucket is a *direct average* over `(season, day_of_week, hour)`,
   * so it already contains the average crowd level of its own samples. Scaling
   * it by the absolute multiplier would double-count that level; scaling by
   * 1.0 (the previous behavior) made a mature bucket ignore the date entirely.
   * The correct factor is `forecastIndex / avgCrowdIndex`.
   *
   * `null`/absent means "unknown" — the tier then falls back to the raw
   * average rather than inventing a level (R15.3).
   */
  avgCrowdIndex?: number | null;
}

export interface ShapeBucket {
  wait: number;
  /** R16: sample count backing `wait`, used to weight the shrinkage blend. */
  sampleCount?: number;
}

/** Tier-1 reliability threshold: a season bucket is trusted at this many samples. */
export const TIER1_RELIABILITY_THRESHOLD = 30;

/**
 * R16: pseudo-observations of the day-of-week-pooled mean blended into every
 * weekday bucket.
 *
 * Holdout-measured, not guessed (train Aug 4-18 / test Aug 19-25 2026):
 * MAE 5.87 min at k=0 (raw weekday bucket), 5.65 at k=5 and k=10, 5.72 at
 * k=20, 5.82 at k=40, and 6.04 at k=inf (weekday ignored entirely). The
 * optimum is interior and the curve is flat across 5..10, so 8 is not a
 * knife-edge. Weekday effects are real and large (Rise of the Resistance
 * spans 63% of its own mean across weekdays) but a weekday bucket held only
 * 9.18 samples on average with 56.7% at <=10 — the signal is real, the
 * per-weekday estimate is not yet reliable, and shrinkage is how you use one
 * without over-trusting the other.
 */
export const DOW_SHRINKAGE_K = 8;

/**
 * Blends a thin weekday bucket toward the day-of-week-pooled mean for the same
 * `(experience, hour)`, weighted by the bucket's own sample count.
 *
 * Returns exactly `pooledWait` at `sampleCount = 0` and tends to `bucketWait`
 * as `sampleCount` grows, so it converges to the raw weekday estimate as data
 * accrues with no threshold flip and no code change (R16.5). The result always
 * lies within the interval spanned by its two inputs.
 */
export function shrinkToPooled(
  bucketWait: number,
  bucketSampleCount: number,
  pooledWait: number,
  k: number = DOW_SHRINKAGE_K
): number {
  const n = Number.isFinite(bucketSampleCount) && bucketSampleCount > 0 ? bucketSampleCount : 0;
  const kk = Number.isFinite(k) && k > 0 ? k : 0;
  if (n + kk <= 0) return bucketWait;
  return (bucketWait * n + pooledWait * kk) / (n + kk);
}

/**
 * Inputs to tier selection. An options object rather than positional args
 * because tier 1 and tier 2 now need genuinely different extra data
 * (`avgCrowdIndex` vs `pooledWait`/`sampleCount`) and a positional list of six
 * numbers is an invitation to transpose two of them silently.
 */
export interface TierSelectionInput {
  /** Season-resolved direct-average bucket for this (season, dow, hour), if any. */
  readonly seasonBucket?: SeasonBucket | null;
  /** Fast (day_of_week, hour) shape bucket, if any. */
  readonly shapeBucket?: ShapeBucket | null;
  /**
   * R16: mean of `avg_wait_minutes` across *all* days of week for this
   * `(experience, hour)`. The shrinkage target. Absent → no shrinkage.
   */
  readonly pooledWait?: number | null;
  /** Ride/park-typical fallback wait for tier 3. */
  readonly parkTypical: number;
  /**
   * The raw **unclamped** continuous forecast ratio (1.0 = typical). Passed
   * raw, not pre-clamped, because tier 1 divides it by the bucket's own
   * embedded crowd level before clamping (R15.3) — clamping first would
   * distort that quotient.
   */
  readonly forecastIndex: number;
  /** Tier-1 reliability threshold; defaults to {@link TIER1_RELIABILITY_THRESHOLD}. */
  readonly threshold?: number;
  /** Shrinkage pseudo-count; defaults to {@link DOW_SHRINKAGE_K}. */
  readonly shrinkageK?: number;
}

/**
 * Selects the most specific reliable tier for a wait prediction.
 *
 * The crowd factor is applied *inside* this function, once, and differs by
 * tier — callers must NOT multiply the result by a crowd multiplier again:
 *
 *  - Tier 1 (season-resolved, `sampleCount >= threshold`): scaled by the
 *    **relative** factor `forecastIndex / avgCrowdIndex`, because the direct
 *    average already embeds its own samples' crowd level (R15).
 *  - Tier 2 (shape): the weekday bucket is first shrunk toward the pooled
 *    per-hour mean (R16), then scaled by the **absolute** factor
 *    `forecastIndex / 1.0`, because a Ride_Shape average is season-agnostic.
 *  - Tier 3 (park-typical): scaled by the absolute factor. Unchanged.
 *
 * Tier *ordering* is unchanged, so Property 1 continues to hold.
 */
export function selectTier(input: TierSelectionInput): number {
  const { seasonBucket, shapeBucket, parkTypical, forecastIndex } = input;
  const threshold = input.threshold ?? TIER1_RELIABILITY_THRESHOLD;
  const k = input.shrinkageK ?? DOW_SHRINKAGE_K;

  // --- Tier 1: season-resolved direct average, RELATIVE crowd factor -------
  if (seasonBucket && seasonBucket.sampleCount >= threshold) {
    const embedded = seasonBucket.avgCrowdIndex;
    if (typeof embedded === 'number' && Number.isFinite(embedded) && embedded > 0) {
      return seasonBucket.wait * clampCrowdMultiplier(forecastIndex / embedded);
    }
    // R15.3: embedded level unknown — use the raw average rather than
    // asserting a level we have not measured.
    return seasonBucket.wait;
  }

  // Absolute factor shared by tiers 2 and 3.
  const absolute = clampCrowdMultiplier(forecastIndex);

  const bucketWait = shapeBucket && shapeBucket.wait > 0 ? shapeBucket.wait : null;
  const pooled =
    typeof input.pooledWait === 'number' && Number.isFinite(input.pooledWait) && input.pooledWait > 0
      ? input.pooledWait
      : null;

  // --- Tier 2: day-of-week-shrunk shape, ABSOLUTE crowd factor -------------
  if (bucketWait !== null && pooled !== null) {
    const n = shapeBucket?.sampleCount ?? 0;
    return shrinkToPooled(bucketWait, n, pooled, k) * absolute;
  }
  if (bucketWait !== null) return bucketWait * absolute;
  if (pooled !== null) return pooled * absolute;

  // --- Tier 3: park-typical, ABSOLUTE crowd factor -------------------------
  return parkTypical * absolute;
}

// ---------------------------------------------------------------------------
// Stable Ride_Baseline (R14)
// ---------------------------------------------------------------------------

/**
 * Sample-count cap for the FAST Ride_Shape EMA. Alpha floor `2/22 ~= 0.091`,
 * an effective memory of ~21 samples. A `(day_of_week, hour)` bucket receives
 * roughly 5 samples per matching weekday, so this is ~4 weeks — deliberately
 * short, because predictions should track current conditions.
 */
export const SHAPE_EMA_MAX_SAMPLES = 20;

/** Capped-alpha weight for the fast Ride_Shape EMA. */
export function shapeEmaWeight(sampleCount: number): number {
  const n = Number.isFinite(sampleCount) && sampleCount > 0 ? sampleCount : 0;
  return 2 / (Math.min(n, SHAPE_EMA_MAX_SAMPLES) + 2);
}

/**
 * The fast shape must hold at least this many samples before its average is
 * frozen as the Ride_Baseline. Deliberately equal to
 * {@link SHAPE_EMA_MAX_SAMPLES}: that is the point at which the shape's own
 * capped alpha saturates and its average has settled, so freezing it is
 * freezing a considered estimate rather than a noisy one.
 */
export const BASELINE_ESTABLISH_MIN_SHAPE_SAMPLES = 20;

/**
 * Cap on the evidence count recorded alongside a frozen baseline. Matches the
 * `LEAST(sample_count, 500)` cap in migration 0033's backfill.
 */
export const BASELINE_SAMPLE_COUNT_CAP = 500;

export interface BaselineState {
  readonly baselineWaitMinutes: number | null;
  readonly baselineSampleCount: number;
}

/**
 * Establishes the Ride_Baseline once, then leaves it **frozen** (R14.3).
 *
 * This is deliberately NOT an exponential average, however slow. A long-memory
 * EMA was implemented first and rejected by its own regression test: with a
 * 500-sample cap, a bucket at count 100 facing a persistently different
 * observed level drifted 0.197 ratio units over 100 passes — a mere 1.27x
 * better than the fast shape it was replacing, because both converge on the
 * observations in the end. And more fundamentally, any exponential memory
 * over-weights the most recent season, so it can never be season-neutral —
 * which is the one property the Crowd_Index actually needs in order to compare
 * December against August. The defect was the mechanism, not the rate.
 *
 * Genuine multi-season change (a ride's real capacity or popularity shifting)
 * is absorbed by the deliberate re-anchor of R14.9 — recomputing from a
 * trailing 365-day window of `wait_archive`, which IS season-neutral by
 * construction — not by letting observations nudge the yardstick continuously.
 *
 * Returns the existing state untouched when already established, so calling
 * this every pass is a no-op after the first.
 */
export function establishBaseline(
  prevBaseline: number | null | undefined,
  prevSampleCount: number | null | undefined,
  shapeAvgWaitMinutes: number,
  shapeSampleCount: number
): BaselineState {
  const prevCount =
    typeof prevSampleCount === 'number' && Number.isFinite(prevSampleCount) && prevSampleCount > 0
      ? prevSampleCount
      : 0;

  const alreadyEstablished =
    typeof prevBaseline === 'number' && Number.isFinite(prevBaseline) && prevBaseline > 0;

  // Frozen: value AND count returned verbatim. No later sample informs either.
  if (alreadyEstablished) {
    return { baselineWaitMinutes: prevBaseline as number, baselineSampleCount: prevCount };
  }

  const shapeSettled =
    Number.isFinite(shapeSampleCount) && shapeSampleCount >= BASELINE_ESTABLISH_MIN_SHAPE_SAMPLES;
  const shapeUsable = Number.isFinite(shapeAvgWaitMinutes) && shapeAvgWaitMinutes > 0;

  if (shapeSettled && shapeUsable) {
    return {
      baselineWaitMinutes: shapeAvgWaitMinutes,
      baselineSampleCount: Math.min(Math.floor(shapeSampleCount), BASELINE_SAMPLE_COUNT_CAP),
    };
  }

  // Not yet settled — stay unestablished rather than freezing a noisy level.
  // The ride is simply excluded from the crowd-index basket until then.
  return { baselineWaitMinutes: null, baselineSampleCount: prevCount };
}

/**
 * Basket-eligibility predicate for the Crowd_Index (R14.5), read against the
 * baseline's OWN columns rather than the fast shape's. A ride can have a dense
 * fast shape and still not have an established baseline (e.g. a bucket created
 * after migration 0033), and in that case it must stay out of the index.
 */
export function isBaselineEstablished(
  baselineWaitMinutes: number | null | undefined,
  baselineSampleCount: number | null | undefined
): boolean {
  return (
    typeof baselineWaitMinutes === 'number' &&
    Number.isFinite(baselineWaitMinutes) &&
    baselineWaitMinutes >= CROWD_INDEX_MIN_EXPECTED_MINUTES &&
    typeof baselineSampleCount === 'number' &&
    Number.isFinite(baselineSampleCount) &&
    baselineSampleCount >= CROWD_INDEX_MIN_SHAPE_SAMPLES
  );
}

/**
 * Length of the constant-wait run the R14.8 drift regression exercises. The
 * asserted baseline-denominated drift over this run is exactly `0` — the
 * baseline is frozen, so there is no tolerance to tune.
 */
export const CROWD_INDEX_DRIFT_HORIZON_PASSES = 100;

/**
 * Computes the bounded weather adjustment multiplier.
 */
export function weatherAdjustment(
  sensitivity: number | null | undefined,
  forecastCondition: string | null | undefined
): number {
  if (!sensitivity || !forecastCondition) {
    return 1.0; // Out of horizon or no sensitivity known
  }
  return Math.max(0.75, Math.min(1.25, sensitivity));
}

// ---------------------------------------------------------------------------
// Standby-basket crowd-index refinement (R2.7 / R2.8)
// ---------------------------------------------------------------------------

/**
 * Minimum Ride_Shape sample_count before a ride is eligible for the
 * per-ride-relative crowd index. Below this threshold the shape is too
 * noisy to divide by.
 */
export const CROWD_INDEX_MIN_SHAPE_SAMPLES = 5;

/**
 * Minimum expected wait (minutes) from the Ride_Shape before a ride is
 * included in the per-ride-relative index. A ride whose shape shows
 * < 5 min expected produces wild ratios (e.g. observed 20 / expected 2
 * = 10×) that would dominate the mean.
 */
export const CROWD_INDEX_MIN_EXPECTED_MINUTES = 5;

/**
 * Per-ride observed/expected ratio is clamped to [0, MAX_RIDE_RATIO] so
 * one ride with a small expected can't dominate the park's mean index.
 */
const MAX_RIDE_RATIO = 5.0;

/**
 * Input shape for a single ride in the per-ride-relative crowd index.
 * `observed` is the current posted standby wait; `expected` is the
 * Ride_Shape's avg_wait_minutes for this (day_of_week, hour); `sampleCount`
 * is the shape bucket's sample_count.
 */
export interface RelativeCrowdRide {
  observed: number;
  expected: number;
  sampleCount: number;
}

/**
 * True iff a ThemeParks live entry is operating AND exposes a numeric
 * STANDBY queue wait (walk-on 0 included). False for non-operating entries
 * or any entry with no STANDBY queue (shows, dining, parades, walk-through
 * experiences without a posted standby line).
 *
 * Used to gate both the `wait_samples` insert and the crowd-index basket.
 * Pure — no I/O.
 */
export function isStandbyBasketEntry(entry: ThemeParksLiveEntry): boolean {
  if (entry.status !== 'OPERATING') return false;
  const waitTime = entry.queue?.STANDBY?.waitTime;
  return typeof waitTime === 'number' && !Number.isNaN(waitTime);
}

/**
 * Per-ride-relative crowd index: the mean of each ride's
 * `observed / expected` ratio, over basket-eligible rides.
 *
 * A ride is excluded when:
 *   - its Ride_Shape sample_count < CROWD_INDEX_MIN_SHAPE_SAMPLES (too noisy)
 *   - its expected <= 0 (no meaningful baseline)
 *   - its expected < CROWD_INDEX_MIN_EXPECTED_MINUTES (ratio too volatile)
 *
 * Each included ride's ratio is clamped to [0, MAX_RIDE_RATIO] so a single
 * ride with a small expected can't dominate the mean.
 *
 * Returns 1.0 when every included ride sits at its expected wait.
 * Returns NaN when the eligible basket is empty — callers MUST check
 * `Number.isNaN(result)` and skip writing the index slice.
 */
export function relativeCrowdIndex(rides: readonly RelativeCrowdRide[]): number {
  let sum = 0;
  let count = 0;

  for (const ride of rides) {
    if (ride.sampleCount < CROWD_INDEX_MIN_SHAPE_SAMPLES) continue;
    if (ride.expected <= 0) continue;
    if (ride.expected < CROWD_INDEX_MIN_EXPECTED_MINUTES) continue;

    const ratio = Math.min(ride.observed / ride.expected, MAX_RIDE_RATIO);
    // observed can be 0 (walk-on), so ratio can be 0 — that's a valid
    // low-crowd signal. Clamp floor is 0 (already guaranteed since
    // observed >= 0 and expected > 0).
    sum += Math.max(0, ratio);
    count++;
  }

  if (count === 0) return NaN;
  return sum / count;
}
