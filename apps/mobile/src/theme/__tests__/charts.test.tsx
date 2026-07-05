/**
 * Unit tests for the shared Stats data-visualization primitives
 * (stats-experience-redesign spec, Task 3.3).
 *
 * Validates: Requirements 8.6, 15.1, 17.1, 17.2
 *
 * Coverage:
 *   - `ProgressRing` renders at 0% / partial / 100% completion, exposing a
 *     single accessible element with a `progressbar` value that tracks the
 *     (clamped) percent (R15.1). It always renders via the zero-dependency
 *     primitive fallback behind a fixed prop surface (R17.1, R17.2).
 *   - `ProgressBar` renders at 0% / partial / 100% as one accessible element.
 *   - `CompleteBadge` is visible and announces "Complete" (R15.1 / R15.3).
 *   - `RatingDial` shows the average to one decimal, clamps out-of-range
 *     inputs, and is one accessible element (R15.1).
 *   - `RatingHistogram` renders 1..10 as one accessible element (R15.1), and
 *     the pure `normalizeHistogram` maps the tallest non-zero bin to 1, zero
 *     bins to a baseline, and every bin to the baseline when all are zero,
 *     including the single-bin case (R8.6).
 *
 * Each render test asserts exactly ONE accessible element carries the visual's
 * spoken label (R15.1) — a screen reader announces a single coherent value
 * rather than a pile of decorative sub-views.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import {
  CompleteBadge,
  ProgressBar,
  ProgressRing,
  RatingDial,
  RatingHistogram,
  normalizeHistogram,
  type RatingDistribution,
} from '../charts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a 1..10 distribution from a partial map (missing bins → 0). */
function dist(partial: Partial<Record<number, number>>): RatingDistribution {
  const full = {} as Record<number, number>;
  for (let v = 1; v <= 10; v += 1) full[v] = partial[v] ?? 0;
  return full as RatingDistribution;
}

const BASELINE = 0.04;

// ---------------------------------------------------------------------------
// ProgressRing (R15.1, R17.1, R17.2)
// ---------------------------------------------------------------------------

describe('ProgressRing (Requirements 15.1, 17.1, 17.2)', () => {
  it('renders at 0% as a single accessible progressbar with now=0', () => {
    render(
      <ProgressRing percent={0} centerLabel="0.0%" accessibilityLabel="Overall completion 0 percent" />,
    );

    const ring = screen.getByLabelText('Overall completion 0 percent');
    expect(ring.props.accessibilityRole).toBe('progressbar');
    expect(ring.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 0 });
    // Exactly one accessible element carries the ring's spoken label (R15.1).
    expect(screen.getAllByLabelText('Overall completion 0 percent')).toHaveLength(1);
    // Center label renders inside the same element.
    expect(screen.getByText('0.0%')).toBeTruthy();
  });

  it('renders at a partial percent with now tracking the value', () => {
    render(
      <ProgressRing percent={42} centerLabel="42.0%" accessibilityLabel="Overall completion 42 percent" />,
    );

    const ring = screen.getByLabelText('Overall completion 42 percent');
    expect(ring.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 42 });
    expect(screen.getByText('42.0%')).toBeTruthy();
  });

  it('renders at 100% with now=100', () => {
    render(
      <ProgressRing
        percent={100}
        complete
        centerLabel="100.0%"
        accessibilityLabel="Overall completion 100 percent, Complete"
      />,
    );

    const ring = screen.getByLabelText('Overall completion 100 percent, Complete');
    expect(ring.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 100 });
    expect(screen.getAllByLabelText('Overall completion 100 percent, Complete')).toHaveLength(1);
  });

  it('clamps out-of-range and non-finite percents into [0, 100]', () => {
    const { rerender } = render(
      <ProgressRing percent={150} accessibilityLabel="ring" />,
    );
    expect(screen.getByLabelText('ring').props.accessibilityValue.now).toBe(100);

    rerender(<ProgressRing percent={-20} accessibilityLabel="ring" />);
    expect(screen.getByLabelText('ring').props.accessibilityValue.now).toBe(0);

    rerender(<ProgressRing percent={Number.NaN} accessibilityLabel="ring" />);
    expect(screen.getByLabelText('ring').props.accessibilityValue.now).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ProgressBar (R15.1)
// ---------------------------------------------------------------------------

describe('ProgressBar (Requirement 15.1)', () => {
  it.each([
    ['0%', 0],
    ['partial', 55],
    ['100%', 100],
  ])('renders at %s as a single accessible progressbar', (_label, percent) => {
    render(<ProgressBar percent={percent} accessibilityLabel={`Bar ${percent}`} />);

    const bar = screen.getByLabelText(`Bar ${percent}`);
    expect(bar.props.accessibilityRole).toBe('progressbar');
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 100, now: percent });
    expect(screen.getAllByLabelText(`Bar ${percent}`)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// CompleteBadge (R15.1 / R15.3)
// ---------------------------------------------------------------------------

describe('CompleteBadge (Requirement 15.1)', () => {
  it('is visible and announces "Complete" as a single accessible element', () => {
    render(<CompleteBadge />);

    expect(screen.getAllByLabelText('Complete')).toHaveLength(1);
    // The visible celebratory copy is present alongside the spoken label.
    expect(screen.getByText('Complete!')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// RatingDial (R15.1)
// ---------------------------------------------------------------------------

describe('RatingDial (Requirement 15.1)', () => {
  it('shows the average to one decimal and exposes it as a single accessible element', () => {
    render(<RatingDial average={7.3} accessibilityLabel="Average rating 7.3 out of 10" />);

    const dial = screen.getByLabelText('Average rating 7.3 out of 10');
    expect(dial.props.accessibilityRole).toBe('progressbar');
    expect(dial.props.accessibilityValue).toEqual({ min: 0, max: 10, now: 7 });
    expect(screen.getAllByLabelText('Average rating 7.3 out of 10')).toHaveLength(1);
    expect(screen.getByText('7.3')).toBeTruthy();
    expect(screen.getByText('/10')).toBeTruthy();
  });

  it('clamps out-of-range averages into [0, 10]', () => {
    const { rerender } = render(<RatingDial average={12} accessibilityLabel="dial" />);
    expect(screen.getByText('10.0')).toBeTruthy();
    expect(screen.getByLabelText('dial').props.accessibilityValue.now).toBe(10);

    rerender(<RatingDial average={-3} accessibilityLabel="dial" />);
    expect(screen.getByText('0.0')).toBeTruthy();
    expect(screen.getByLabelText('dial').props.accessibilityValue.now).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// RatingHistogram render (R15.1)
// ---------------------------------------------------------------------------

describe('RatingHistogram (Requirement 15.1)', () => {
  it('renders the 1..10 axis as a single accessible element', () => {
    render(
      <RatingHistogram
        distribution={dist({ 8: 5, 9: 3, 10: 1 })}
        accessibilityLabel="Rating distribution"
      />,
    );

    expect(screen.getAllByLabelText('Rating distribution')).toHaveLength(1);
    // All ten bin labels 1..10 render beneath the bars.
    for (let v = 1; v <= 10; v += 1) {
      expect(screen.getByText(String(v))).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// normalizeHistogram — pure normalization law (R8.6)
// ---------------------------------------------------------------------------

describe('normalizeHistogram (Requirement 8.6)', () => {
  it('maps the tallest non-zero bin to 1 and zero bins to the baseline', () => {
    const fractions = normalizeHistogram(dist({ 3: 2, 7: 10, 9: 5 }));

    expect(fractions).toHaveLength(10);
    // Tallest bin (value 7 → index 6) normalizes to exactly 1.
    expect(fractions[6]).toBe(1);
    // Proportional non-zero bins.
    expect(fractions[2]).toBeCloseTo(2 / 10); // value 3
    expect(fractions[8]).toBeCloseTo(5 / 10); // value 9
    // Zero-count bins sit at the baseline.
    expect(fractions[0]).toBe(BASELINE);
    expect(fractions[9]).toBe(BASELINE);
    // Every fraction stays within [0, 1].
    for (const f of fractions) {
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });

  it('returns all-baseline when every bin is zero', () => {
    const fractions = normalizeHistogram(dist({}));

    expect(fractions).toHaveLength(10);
    expect(fractions.every((f) => f === BASELINE)).toBe(true);
  });

  it('maps the single populated bin to 1 and the rest to baseline (single-bin case)', () => {
    const fractions = normalizeHistogram(dist({ 5: 4 }));

    expect(fractions[4]).toBe(1); // value 5 is the only non-zero bin
    fractions.forEach((f, i) => {
      if (i !== 4) expect(f).toBe(BASELINE);
    });
  });

  it('treats negative or missing counts as zero (baseline)', () => {
    const fractions = normalizeHistogram(dist({ 1: -5, 6: 8 }));

    expect(fractions[5]).toBe(1); // value 6 is the tallest
    expect(fractions[0]).toBe(BASELINE); // negative count clamped to zero → baseline
  });
});
