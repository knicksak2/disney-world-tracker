/**
 * Pure functions for photo vision evaluation:
 * - Vision verdict to evaluation label converter
 * - Vision comparator (expected label vs computed verdict)
 * - Latency percentile calculator (p50, p95)
 * - Confusion summary & confusion matrix generator
 * - Formatted report printer
 *
 * Implements: Task 12.1
 * Validates: Requirement 24.1
 */

import {
  computeVisionVerdict,
  DEFAULT_VISION_THRESHOLDS,
  type VisionFields,
  type VisionThresholds,
  type VisionVerdict,
} from '../services/photos/domain/visionVerdict.js';

export type EvalLabel =
  | 'accept'
  | 'reject:face_visible'
  | 'reject:not_food'
  | 'reject:too_much_text';

/**
 * Converts a VisionVerdict into the standardized evaluation label string.
 */
export function verdictToLabel(verdict: VisionVerdict): EvalLabel {
  if (verdict.decision === 'accept') {
    return 'accept';
  }
  return `reject:${verdict.primary}`;
}

export interface VisionComparison {
  readonly verdict: VisionVerdict;
  readonly predictedLabel: EvalLabel;
  readonly isMatch: boolean;
}

/**
 * Compares an expected evaluation label against computed vision fields and thresholds.
 */
export function compareVisionVerdict(
  expectedLabel: string,
  fields: VisionFields,
  thresholds: VisionThresholds = DEFAULT_VISION_THRESHOLDS,
): VisionComparison {
  const verdict = computeVisionVerdict(fields, thresholds);
  const predictedLabel = verdictToLabel(verdict);
  const isMatch = predictedLabel === expectedLabel;
  return {
    verdict,
    predictedLabel,
    isMatch,
  };
}

export interface VisionEvalItemResult {
  readonly filename: string;
  readonly expectedLabel: string;
  readonly predictedLabel?: EvalLabel | undefined;
  readonly verdict?: VisionVerdict | undefined;
  readonly fields?: VisionFields | undefined;
  readonly isMatch: boolean;
  readonly latencyMs: number;
  readonly error?: string | undefined;
}

/**
 * Computes a percentile rank (nearest rank method) on a numeric array.
 */
export function computePercentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (p <= 0) return sorted[0]!;
  if (p >= 100) return sorted[sorted.length - 1]!;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))]!;
}

export interface ConfusionBinaryCounts {
  readonly trueAccepts: number; // Expected accept, predicted accept (TP)
  readonly falseAccepts: number; // Expected reject, predicted accept (FP)
  readonly falseRejects: number; // Expected accept, predicted reject (FN)
  readonly trueRejects: number; // Expected reject, predicted reject (TN)
}

export interface LabelBreakdown {
  readonly expectedCount: number;
  readonly predictedCount: number;
  readonly matchCount: number;
}

export interface VisionEvalSummary {
  readonly total: number;
  readonly matches: number;
  readonly mismatches: number;
  readonly accuracy: number;
  readonly confusionMatrix: Record<string, Record<string, number>>; // [expected][predicted] = count
  readonly binaryCounts: ConfusionBinaryCounts;
  readonly perLabel: Record<string, LabelBreakdown>;
  readonly latencies: {
    readonly p50Ms: number;
    readonly p95Ms: number;
    readonly minMs: number;
    readonly maxMs: number;
    readonly avgMs: number;
  };
}

/**
 * Aggregates a list of evaluated items into confusion summary metrics and latency stats.
 */
export function summarizeVisionEval(
  items: ReadonlyArray<VisionEvalItemResult>,
): VisionEvalSummary {
  const total = items.length;
  let matches = 0;
  let mismatches = 0;
  const confusionMatrix: Record<string, Record<string, number>> = {};
  const perLabel: Record<string, { expectedCount: number; predictedCount: number; matchCount: number }> = {};
  let trueAccepts = 0;
  let falseAccepts = 0;
  let falseRejects = 0;
  let trueRejects = 0;
  const validLatencies: number[] = [];

  for (const item of items) {
    if (item.isMatch) {
      matches++;
    } else {
      mismatches++;
    }

    if (item.latencyMs >= 0) {
      validLatencies.push(item.latencyMs);
    }

    const exp = item.expectedLabel;
    const pred = item.predictedLabel ?? (item.error ? `error:${item.error}` : 'unknown');

    // Matrix [expected][predicted]
    if (!confusionMatrix[exp]) {
      confusionMatrix[exp] = {};
    }
    confusionMatrix[exp]![pred] = (confusionMatrix[exp]![pred] ?? 0) + 1;

    // Per label
    if (!perLabel[exp]) {
      perLabel[exp] = { expectedCount: 0, predictedCount: 0, matchCount: 0 };
    }
    perLabel[exp]!.expectedCount++;

    if (item.predictedLabel) {
      if (!perLabel[item.predictedLabel]) {
        perLabel[item.predictedLabel] = { expectedCount: 0, predictedCount: 0, matchCount: 0 };
      }
      perLabel[item.predictedLabel]!.predictedCount++;
    }

    if (item.isMatch) {
      perLabel[exp]!.matchCount++;
    }

    // Binary breakdown
    const isExpAccept = exp === 'accept';
    const isPredAccept = item.predictedLabel === 'accept';

    if (isExpAccept && isPredAccept) {
      trueAccepts++;
    } else if (!isExpAccept && isPredAccept) {
      falseAccepts++;
    } else if (isExpAccept && !isPredAccept) {
      falseRejects++;
    } else if (!isExpAccept && !isPredAccept) {
      trueRejects++;
    }
  }

  const p50Ms = computePercentile(validLatencies, 50);
  const p95Ms = computePercentile(validLatencies, 95);
  const minMs = validLatencies.length > 0 ? Math.min(...validLatencies) : 0;
  const maxMs = validLatencies.length > 0 ? Math.max(...validLatencies) : 0;
  const avgMs =
    validLatencies.length > 0
      ? Math.round(validLatencies.reduce((a, b) => a + b, 0) / validLatencies.length)
      : 0;

  return {
    total,
    matches,
    mismatches,
    accuracy: total > 0 ? matches / total : 0,
    confusionMatrix,
    binaryCounts: {
      trueAccepts,
      falseAccepts,
      falseRejects,
      trueRejects,
    },
    perLabel,
    latencies: {
      p50Ms,
      p95Ms,
      minMs,
      maxMs,
      avgMs,
    },
  };
}

/**
 * Formats evaluated results and confusion summary into a readable evaluation report.
 */
export function formatVisionEvalReport(
  items: ReadonlyArray<VisionEvalItemResult>,
  summary: VisionEvalSummary,
): string {
  const lines: string[] = [
    '================================================================================',
    '                        PHOTO VISION EVALUATION REPORT                          ',
    '================================================================================',
    '',
    'PER-IMAGE RESULTS:',
    '--------------------------------------------------------------------------------',
  ];

  for (const item of items) {
    const statusTag = item.isMatch ? '[MATCH]   ' : '[MISMATCH]';
    lines.push(`${statusTag} ${item.filename}`);
    lines.push(`  Expected:  ${item.expectedLabel}`);
    lines.push(`  Predicted: ${item.predictedLabel ?? 'NONE'} (${item.latencyMs}ms)`);
    if (item.verdict) {
      lines.push(
        `  Verdict:   decision=${item.verdict.decision}${
          item.verdict.decision === 'reject'
            ? ` primary=${item.verdict.primary} reasons=[${item.verdict.reasons.join(', ')}]`
            : ''
        }`,
      );
    }
    if (item.fields) {
      lines.push(
        `  Fields:    foodConfidence=${item.fields.foodConfidence} isFoodOrDrink=${item.fields.isFoodOrDrink} prominentFaces=${item.fields.prominentFaceCount} minorFace=${item.fields.minorFaceVisible} textFraction=${item.fields.textFraction}`,
      );
      lines.push(`  Desc:      "${item.fields.description}"`);
      if (item.fields.textSeen) {
        lines.push(`  TextSeen:  "${item.fields.textSeen}"`);
      }
    }
    if (item.error) {
      lines.push(`  Error:     ${item.error}`);
    }
    lines.push('');
  }

  lines.push('--------------------------------------------------------------------------------');
  lines.push('CONFUSION SUMMARY:');
  lines.push(`  Total Evaluated: ${summary.total}`);
  lines.push(
    `  Matches:         ${summary.matches} (${Math.round(summary.accuracy * 1000) / 10}%)`,
  );
  lines.push(`  Mismatches:      ${summary.mismatches}`);
  lines.push('');
  lines.push('BINARY MODERATION COUNTS:');
  lines.push(`  True Accepts  (TP): ${summary.binaryCounts.trueAccepts}`);
  lines.push(`  False Accepts (FP): ${summary.binaryCounts.falseAccepts}`);
  lines.push(`  False Rejects (FN): ${summary.binaryCounts.falseRejects}`);
  lines.push(`  True Rejects  (TN): ${summary.binaryCounts.trueRejects}`);
  lines.push('');
  lines.push('CONFUSION MATRIX (rows = Expected, cols = Predicted):');
  const allLabels = Array.from(
    new Set([
      ...Object.keys(summary.confusionMatrix),
      ...Object.values(summary.confusionMatrix).flatMap((m) => Object.keys(m)),
    ]),
  ).sort();

  if (allLabels.length > 0) {
    lines.push(
      `  Expected \\ Predicted | ${allLabels.map((l) => l.padEnd(20)).join(' | ')}`,
    );
    for (const exp of allLabels) {
      const rowCounts = allLabels.map((pred) => {
        const c = summary.confusionMatrix[exp]?.[pred] ?? 0;
        return String(c).padEnd(20);
      });
      lines.push(`  ${exp.padEnd(20)} | ${rowCounts.join(' | ')}`);
    }
  } else {
    lines.push('  (empty matrix)');
  }
  lines.push('');
  lines.push('LATENCY METRICS (ms):');
  lines.push(`  p50: ${summary.latencies.p50Ms} ms`);
  lines.push(`  p95: ${summary.latencies.p95Ms} ms`);
  lines.push(`  min: ${summary.latencies.minMs} ms`);
  lines.push(`  max: ${summary.latencies.maxMs} ms`);
  lines.push(`  avg: ${summary.latencies.avgMs} ms`);
  lines.push('================================================================================');

  return lines.join('\n');
}
