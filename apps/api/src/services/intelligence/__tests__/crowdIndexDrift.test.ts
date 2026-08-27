/**
 * Feature: crowd-calendar, Property 14 — regression guard for R14.1 / R14.2 / R14.8.
 *
 * The observed Crowd_Index used to divide each ride's observed standby wait by
 * that ride's `ride_shapes.avg_wait_minutes`. That column is a FAST EMA updated
 * toward the very observations forming the index's numerator, so the ratio
 * measured its own denominator's decay rather than the day's busyness.
 *
 * The defect was visible in production data: across the sampling windows
 * Aug 11-18 -> Aug 19-25 2026 the observed index ROSE in all four parks
 * (MK 0.819->0.909, HS 0.855->0.933, EPCOT 0.858->0.903, AK 0.881->0.901)
 * while the raw mean posted wait across the same samples FELL (23.85->23.25).
 * An index cannot be correct and move opposite to the waits it summarizes.
 *
 * These tests drive `relativeCrowdIndex` across a run of passes with observed
 * waits held constant and assert the baseline-denominated index does not move
 * while the shape-denominated one collapses toward 1.0. They FAIL against the
 * pre-change denominator, which is what makes them a guard rather than a
 * restatement.
 */
import { describe, expect, it } from 'vitest';
import {
  applyEma,
  establishBaseline,
  isBaselineEstablished,
  relativeCrowdIndex,
  shapeEmaWeight,
  CROWD_INDEX_DRIFT_HORIZON_PASSES,
} from '../waitMath.js';
import type { RelativeCrowdRide } from '../waitMath.js';

interface SimulatedBucket {
  /** Constant observed standby wait for this ride, every pass. */
  readonly observed: number;
  /** Fast Ride_Shape average — moves toward `observed`. */
  shapeAvg: number;
  shapeCount: number;
  /** Frozen Ride_Baseline. */
  baseline: number | null;
  baselineCount: number;
}

function makeBuckets(): SimulatedBucket[] {
  // Three rides, each genuinely busier than its established baseline: a
  // headliner at +25%, a mid-tier at +20%, a low-wait ride at +33%. A correct
  // index should therefore read meaningfully above 1.0 and STAY there.
  return [
    { observed: 60, shapeAvg: 48, shapeCount: 120, baseline: 48, baselineCount: 120 },
    { observed: 36, shapeAvg: 30, shapeCount: 90, baseline: 30, baselineCount: 90 },
    { observed: 20, shapeAvg: 15, shapeCount: 60, baseline: 15, baselineCount: 60 },
  ];
}

/** The index as computed today: `expected` = frozen baseline. */
function baselineDenominatedIndex(buckets: readonly SimulatedBucket[]): number {
  const rides: RelativeCrowdRide[] = buckets
    .filter((b) => isBaselineEstablished(b.baseline, b.baselineCount))
    .map((b) => ({
      observed: b.observed,
      expected: b.baseline as number,
      sampleCount: b.baselineCount,
    }));
  return relativeCrowdIndex(rides);
}

/** The index as it used to be computed: `expected` = fast shape average. */
function shapeDenominatedIndex(buckets: readonly SimulatedBucket[]): number {
  const rides: RelativeCrowdRide[] = buckets.map((b) => ({
    observed: b.observed,
    expected: b.shapeAvg,
    sampleCount: b.shapeCount,
  }));
  return relativeCrowdIndex(rides);
}

/** One sampling pass: fast shape EMAs toward the observation; baseline does not. */
function runPass(buckets: SimulatedBucket[]): void {
  for (const b of buckets) {
    b.shapeAvg = applyEma(b.shapeAvg, b.observed, shapeEmaWeight(b.shapeCount));
    b.shapeCount += 1;

    const next = establishBaseline(b.baseline, b.baselineCount, b.shapeAvg, b.shapeCount);
    b.baseline = next.baselineWaitMinutes;
    b.baselineCount = next.baselineSampleCount;
  }
}

describe('Feature: crowd-calendar — Crowd_Index denominator drift (R14)', () => {
  it('holds the index exactly constant across a long run of constant-wait passes', () => {
    const buckets = makeBuckets();
    const initial = baselineDenominatedIndex(buckets);

    // Sanity: the fixture genuinely represents a busier-than-baseline park.
    // mean(60/48, 36/30, 20/15) = mean(1.25, 1.2, 1.3333) = 1.2611
    expect(initial).toBeCloseTo(1.2611, 3);

    for (let pass = 0; pass < CROWD_INDEX_DRIFT_HORIZON_PASSES; pass++) {
      runPass(buckets);
      // Exact equality on every single pass, not just at the end.
      expect(baselineDenominatedIndex(buckets)).toBe(initial);
    }
  });

  it('would collapse toward 1.0 under the old shape denominator — the behavior being fixed', () => {
    const buckets = makeBuckets();
    const initialShapeIndex = shapeDenominatedIndex(buckets);
    expect(initialShapeIndex).toBeCloseTo(1.2611, 3);

    for (let pass = 0; pass < CROWD_INDEX_DRIFT_HORIZON_PASSES; pass++) {
      runPass(buckets);
    }

    const finalShapeIndex = shapeDenominatedIndex(buckets);
    const finalBaselineIndex = baselineDenominatedIndex(buckets);

    // The old denominator erases the signal: a park reliably ~26% busier than
    // baseline reads as a typical day.
    expect(finalShapeIndex).toBeCloseTo(1.0, 2);
    expect(initialShapeIndex - finalShapeIndex).toBeGreaterThan(0.2);

    // The new one does not move at all.
    expect(finalBaselineIndex).toBe(initialShapeIndex);
    expect(finalBaselineIndex - finalShapeIndex).toBeGreaterThan(0.2);
  });

  it('reflects a real change in observed waits rather than being merely inert', () => {
    // Freezing the denominator must not make the index unresponsive — it should
    // still track genuine movement in the numerator. Same buckets, waits now
    // sitting AT baseline instead of above it.
    const buckets = makeBuckets();
    const busyIndex = baselineDenominatedIndex(buckets);

    const atBaseline = buckets.map((b) => ({ ...b, observed: b.baseline as number }));
    expect(baselineDenominatedIndex(atBaseline)).toBeCloseTo(1.0, 9);
    expect(busyIndex).toBeGreaterThan(baselineDenominatedIndex(atBaseline));

    const quiet = buckets.map((b) => ({ ...b, observed: (b.baseline as number) * 0.5 }));
    expect(baselineDenominatedIndex(quiet)).toBeCloseTo(0.5, 9);
  });

  it('excludes a ride whose baseline is not yet established, however dense its fast shape', () => {
    // A bucket created after migration 0033: 400 fast-shape samples but no
    // frozen baseline yet. It must not contribute to the index (R14.5).
    const unestablished: SimulatedBucket = {
      observed: 90,
      shapeAvg: 30,
      shapeCount: 400,
      baseline: null,
      baselineCount: 0,
    };
    const buckets = [...makeBuckets(), unestablished];

    // 90/30 = 3.0 would drag the mean well up if it were counted.
    expect(baselineDenominatedIndex(buckets)).toBeCloseTo(1.2611, 3);

    // Once a pass establishes it from the settled shape, it participates.
    runPass(buckets);
    expect(isBaselineEstablished(unestablished.baseline, unestablished.baselineCount)).toBe(true);
    expect(baselineDenominatedIndex(buckets)).toBeGreaterThan(1.4);
  });
});
