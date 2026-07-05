/**
 * Shared data-visualization primitives for the Disney World Tracker Stats
 * experience (see the "stats-experience-redesign" spec).
 *
 * These render the redesign's rings, bars, histogram, dial, and complete badge
 * against the "Magical / Whimsical" theme (see `theme.ts`), so both the Own and
 * Friend surfaces share one visual language. They live in `charts.tsx` — a
 * sibling of `components.tsx` — so the generic UI primitives stay focused (D6).
 *
 * ## Charting approach (Decision (a) / D4, R17.1, R17.2)
 *
 * `ProgressRing` is backed by `react-native-svg` (an Expo-managed, first-party
 * dependency) so it renders a smooth gradient donut arc that matches the design
 * mockup. The component API is stable: callers pass `percent` / `size` /
 * `strokeWidth` / `color` / `complete` / `centerLabel` and never see the SVG
 * internals, so the backing could be swapped without touching a caller (R17.1).
 *
 * ## Accessibility (R15.1)
 *
 * Every data-bearing visual is exposed as a *single* accessible element
 * (`accessible` + `accessibilityLabel`) whose spoken label conveys its meaning,
 * so a screen-reader announces one coherent value rather than a pile of
 * decorative sub-views.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Svg, {
  Circle,
  Defs,
  LinearGradient as SvgLinearGradient,
  Stop,
} from 'react-native-svg';

import { theme } from './theme';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A rating distribution: each value 1..10 mapped to its count. Structurally
 * identical to the `RatingDistribution` wire type mirrored in
 * `api/statsTypes.ts`; declared locally so the chart primitives stay
 * self-contained (any `statsTypes.RatingDistribution` value satisfies this
 * shape structurally).
 */
export type RatingDistribution = Readonly<
  Record<1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10, number>
>;

const RATING_VALUES: readonly (keyof RatingDistribution)[] = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clamp an arbitrary (possibly non-finite) number into `[min, max]`. */
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Monotonically increasing suffix so each ring's SVG gradient id is unique. */
let ringGradientSeq = 0;

// ---------------------------------------------------------------------------
// ProgressRing — circular completion arc (react-native-svg)
// ---------------------------------------------------------------------------

export interface ProgressRingProps {
  /** Completion percent in `[0, 100]` (already server-rounded). */
  readonly percent: number;
  /** Diameter in px; defaults to a tile-sized ring. */
  readonly size?: number;
  /** Ring thickness in px. */
  readonly strokeWidth?: number;
  /** Indicator color; defaults to the purple brand gradient. */
  readonly color?: string;
  /** Track (unfilled) color; defaults to `theme.color.surfaceAlt`. */
  readonly trackColor?: string;
  /** Drives the celebratory gold "complete" treatment. */
  readonly complete?: boolean;
  /** Centered headline label, e.g. "42.0%". */
  readonly centerLabel?: string;
  /** Centered secondary label under `centerLabel`, e.g. "348 / 600". */
  readonly centerSubLabel?: string;
  /** Spoken label conveying the ring's meaning (required, R15.1). */
  readonly accessibilityLabel: string;
  readonly testID?: string;
}

/**
 * Circular progress ring rendered with `react-native-svg`: a track circle plus
 * a gradient-stroked arc whose sweep is `percent%`, drawn clockwise from the
 * top with a rounded cap. Exposed as one accessible element (R15.1). A custom
 * `color` produces a solid arc in that hue; the default (and the celebratory
 * `complete`) uses the brand purple / gold gradient.
 */
export function ProgressRing({
  percent,
  size = 96,
  strokeWidth = 10,
  color,
  trackColor,
  complete = false,
  centerLabel,
  centerSubLabel,
  accessibilityLabel,
  testID,
}: ProgressRingProps): JSX.Element {
  const p = clamp(percent, 0, 100);
  const track = trackColor ?? theme.color.surfaceAlt;
  const gradientId = React.useMemo(() => {
    ringGradientSeq += 1;
    return `ringGrad${ringGradientSeq}`;
  }, []);

  // Gradient stops: gold when complete, a solid hue when an accent `color` is
  // given, otherwise the brand purple gradient.
  const [stop0, stop1] = complete
    ? theme.gradient.gold
    : color !== undefined
      ? ([color, color] as const)
      : ([theme.color.primaryLight, theme.color.primary] as const);

  const radius = (size - strokeWidth) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - p / 100);

  // Scale the center labels to the ring diameter so a small "at a glance" ring
  // and the large hero ring both read cleanly. A rounded cap looks like a
  // stray dot at near-zero percents, so use a flat cap below a small threshold.
  const labelFontSize = Math.round(size * 0.2);
  const subFontSize = Math.max(10, Math.round(size * 0.085));
  const arcCap = p >= 3 ? 'round' : 'butt';

  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(p) }}
      testID={testID}
    >
      <Svg
        width={size}
        height={size}
        style={{ transform: [{ rotate: '-90deg' }] }}
      >
        <Defs>
          <SvgLinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={stop0} />
            <Stop offset="1" stopColor={stop1} />
          </SvgLinearGradient>
        </Defs>
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={track}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {p > 0 ? (
          <Circle
            cx={center}
            cy={center}
            r={radius}
            stroke={`url(#${gradientId})`}
            strokeWidth={strokeWidth}
            strokeLinecap={arcCap}
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
          />
        ) : null}
      </Svg>
      {centerLabel !== undefined || centerSubLabel !== undefined ? (
        <View style={styles.ringCenter} pointerEvents="none">
          {centerLabel !== undefined ? (
            <Text
              style={[styles.ringCenterLabel, { fontSize: labelFontSize, lineHeight: labelFontSize + 2 }]}
              numberOfLines={1}
            >
              {centerLabel}
            </Text>
          ) : null}
          {centerSubLabel !== undefined ? (
            <Text style={[styles.ringCenterSub, { fontSize: subFontSize }]} numberOfLines={1}>
              {centerSubLabel}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// ProgressBar — horizontal ranked comparison bar
// ---------------------------------------------------------------------------

export interface ProgressBarProps {
  /** Completion percent in `[0, 100]`. */
  readonly percent: number;
  /** Fill color; defaults to `theme.color.primary`. */
  readonly color?: string;
  /** Drives the celebratory gold "complete" fill. */
  readonly complete?: boolean;
  /** Bar thickness in px (defaults to the ranked-row height). */
  readonly height?: number;
  /** Spoken label conveying the bar's meaning (required, R15.1). */
  readonly accessibilityLabel: string;
  readonly testID?: string;
}

/**
 * Horizontal progress bar: a rounded track with a fill whose width is
 * `percent%`. Complete bars use the gold gradient; others use a flat accent
 * hue (matching the mockup's ranked bars). One accessible element.
 */
export function ProgressBar({
  percent,
  color,
  complete = false,
  height = 9,
  accessibilityLabel,
  testID,
}: ProgressBarProps): JSX.Element {
  const p = clamp(percent, 0, 100);
  const fillColor = complete
    ? theme.color.success
    : color ?? theme.color.primary;
  return (
    <View
      style={[styles.barTrack, { height, borderRadius: height / 2 }]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(p) }}
      testID={testID}
    >
      {complete ? (
        <LinearGradient
          colors={theme.gradient.gold}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.barFill, { width: `${p}%`, borderRadius: height / 2 }]}
        />
      ) : (
        <View
          style={[
            styles.barFill,
            { width: `${p}%`, borderRadius: height / 2, backgroundColor: fillColor },
          ]}
        />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// RatingHistogram — 1..10 distribution
// ---------------------------------------------------------------------------

export interface RatingHistogramProps {
  /** Distribution map 1..10 → count. */
  readonly distribution: RatingDistribution;
  /** Optional bin (1..10) to emphasize; defaults to the tallest bin(s). */
  readonly highlightValue?: number;
  /** Spoken label conveying the histogram's meaning (required, R15.1). */
  readonly accessibilityLabel: string;
  readonly testID?: string;
}

/** Minimum bar height fraction so zero-count bins still read as a baseline. */
const HISTOGRAM_BASELINE_FRACTION = 0.04;

/**
 * Normalize a distribution to a per-bin fill fraction in `[0, 1]`: the tallest
 * non-zero bin maps to `1`; zero-count bins map to a small baseline. When every
 * bin is zero, all bins sit at the baseline. Exported for unit testing (R8.6).
 */
export function normalizeHistogram(
  distribution: RatingDistribution,
): readonly number[] {
  const counts = RATING_VALUES.map((v) => Math.max(distribution[v] ?? 0, 0));
  const max = counts.reduce((acc, c) => (c > acc ? c : acc), 0);
  if (max === 0) {
    return counts.map(() => HISTOGRAM_BASELINE_FRACTION);
  }
  return counts.map((c) => (c === 0 ? HISTOGRAM_BASELINE_FRACTION : c / max));
}

/**
 * Vertical 1..10 distribution histogram. Bar heights are normalized to the
 * tallest non-zero bin (baseline for zero bins). The tallest bin(s) render in
 * the gold "hot" gradient; the rest in the purple gradient — unless an explicit
 * `highlightValue` is given, in which case only that bin is gold. One
 * accessible element (R15.1).
 */
export function RatingHistogram({
  distribution,
  highlightValue,
  accessibilityLabel,
  testID,
}: RatingHistogramProps): JSX.Element {
  const fractions = normalizeHistogram(distribution);
  const anyNonZero = RATING_VALUES.some((v) => (distribution[v] ?? 0) > 0);
  return (
    <View
      style={styles.histogram}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      {RATING_VALUES.map((value, i) => {
        const fraction = fractions[i] ?? HISTOGRAM_BASELINE_FRACTION;
        // Gold the emphasized bin: the caller's `highlightValue` when given,
        // else the tallest bin(s) (fraction === 1 and there is real data).
        const hot =
          highlightValue !== undefined
            ? Math.round(highlightValue) === value
            : anyNonZero && fraction === 1;
        return (
          <View key={value} style={styles.histogramColumn}>
            <View style={styles.histogramBarArea}>
              <LinearGradient
                colors={hot ? theme.gradient.gold : theme.gradient.headerVivid}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={[styles.histogramBar, { height: `${fraction * 100}%` }]}
              />
            </View>
            <Text style={styles.histogramLabel}>{value}</Text>
          </View>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// RatingDial — average rating out of 10 (headline number + stars)
// ---------------------------------------------------------------------------

export interface RatingDialProps {
  /** Average rating in `[0, 10]`. */
  readonly average: number;
  /** Spoken label conveying the dial's meaning (required, R15.1). */
  readonly accessibilityLabel: string;
  readonly testID?: string;
}

/** Number of stars in the 0..10 star row. */
const STAR_COUNT = 10;

/**
 * Average-rating "dial": a large headline number out of 10 plus a 10-star row
 * whose filled count tracks the rounded average. One accessible element with a
 * `progressbar` value over `[0, 10]` (R15.1).
 */
export function RatingDial({
  average,
  accessibilityLabel,
  testID,
}: RatingDialProps): JSX.Element {
  const value = clamp(average, 0, 10);
  const filled = Math.round(value);
  return (
    <View
      style={styles.dial}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 10, now: filled }}
      testID={testID}
    >
      <View style={styles.dialNumberRow}>
        <Text style={styles.dialNumber}>{value.toFixed(1)}</Text>
        <Text style={styles.dialOutOf}>/10</Text>
      </View>
      <View style={styles.dialStars}>
        {Array.from({ length: STAR_COUNT }, (_, i) => (
          <Ionicons
            key={i}
            name={i < filled ? 'star' : 'star-outline'}
            size={14}
            color={theme.color.accent}
          />
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// CompleteBadge — celebratory "Complete!" chip
// ---------------------------------------------------------------------------

export interface CompleteBadgeProps {
  readonly testID?: string;
}

/**
 * The celebratory gold star chip shown when a Completion_Cell's `completeBadge`
 * is true. One accessible element announcing "Complete" (R15.3/R15.5).
 */
export function CompleteBadge({ testID }: CompleteBadgeProps): JSX.Element {
  return (
    <LinearGradient
      colors={theme.gradient.gold}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={styles.completeBadge}
      accessible
      accessibilityLabel="Complete"
      testID={testID}
    >
      <Ionicons name="star" size={12} color={theme.color.textOnAccent} />
      <Text style={styles.completeBadgeText}>Complete!</Text>
    </LinearGradient>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  ringCenter: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringCenterLabel: {
    ...theme.typography.display,
    color: theme.color.primary,
    textAlign: 'center',
  },
  ringCenterSub: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    textAlign: 'center',
    marginTop: 2,
  },
  barTrack: {
    backgroundColor: theme.color.surfaceAlt,
    overflow: 'hidden',
    width: '100%',
  },
  barFill: {
    height: '100%',
  },
  histogram: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 120,
    gap: theme.spacing.xs,
  },
  histogramColumn: {
    flex: 1,
    alignItems: 'center',
  },
  histogramBarArea: {
    height: 96,
    width: '100%',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  histogramBar: {
    width: '80%',
    borderTopLeftRadius: theme.radius.sm,
    borderTopRightRadius: theme.radius.sm,
    minHeight: 2,
  },
  histogramLabel: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    marginTop: theme.spacing.xs,
  },
  dial: {
    gap: theme.spacing.xs,
  },
  dialNumberRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  dialNumber: {
    fontSize: 40,
    fontWeight: '800',
    color: theme.color.primary,
    lineHeight: 44,
  },
  dialOutOf: {
    ...theme.typography.subtitle,
    color: theme.color.textSecondary,
    marginLeft: 2,
  },
  dialStars: {
    flexDirection: 'row',
    gap: 1,
  },
  completeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
  },
  completeBadgeText: {
    ...theme.typography.meta,
    color: theme.color.textOnAccent,
  },
});
