import { describe, it, expect } from 'vitest';
import {
  type VisionFields,
  type VisionThresholds,
} from '../../services/photos/domain/visionVerdict.js';
import {
  compareVisionVerdict,
  computePercentile,
  formatVisionEvalReport,
  summarizeVisionEval,
  verdictToLabel,
  type VisionEvalItemResult,
} from '../photoVisionEvalReport.js';

describe('photoVisionEval pure comparator and summary', () => {
  const goodFoodFields: VisionFields = {
    description: 'A delicious dole whip cup with pineapple swirl',
    isFoodOrDrink: true,
    foodConfidence: 0.95,
    prominentFaceCount: 0,
    minorFaceVisible: false,
    anyPersonPartVisible: false,
    largeText: false,
    textFraction: 0.02,
    textSeen: '',
  };

  const faceVisibleFields: VisionFields = {
    description: 'A guest smiling while holding a churro',
    isFoodOrDrink: true,
    foodConfidence: 0.85,
    prominentFaceCount: 1,
    minorFaceVisible: false,
    anyPersonPartVisible: true,
    largeText: false,
    textFraction: 0.0,
    textSeen: '',
  };

  const notFoodFields: VisionFields = {
    description: 'Cinderella castle in the afternoon sunlight',
    isFoodOrDrink: false,
    foodConfidence: 0.05,
    prominentFaceCount: 0,
    minorFaceVisible: false,
    anyPersonPartVisible: false,
    largeText: false,
    textFraction: 0.0,
    textSeen: '',
  };

  const textHeavyFields: VisionFields = {
    description: 'A dish photo with a giant receipt covering half the frame',
    isFoodOrDrink: true,
    foodConfidence: 0.9,
    prominentFaceCount: 0,
    minorFaceVisible: false,
    anyPersonPartVisible: false,
    largeText: true,
    textFraction: 0.45,
    textSeen: 'TOTAL $42.50 THANK YOU FOR VISITING',
  };

  describe('verdictToLabel', () => {
    it('converts accept and reject verdicts to evaluation labels', () => {
      expect(verdictToLabel({ decision: 'accept' })).toBe('accept');
      expect(
        verdictToLabel({
          decision: 'reject',
          reasons: ['face_visible'],
          primary: 'face_visible',
        }),
      ).toBe('reject:face_visible');
      expect(
        verdictToLabel({
          decision: 'reject',
          reasons: ['not_food'],
          primary: 'not_food',
        }),
      ).toBe('reject:not_food');
      expect(
        verdictToLabel({
          decision: 'reject',
          reasons: ['too_much_text'],
          primary: 'too_much_text',
        }),
      ).toBe('reject:too_much_text');
    });
  });

  describe('compareVisionVerdict', () => {
    it('matches good food fields with accept label', () => {
      const res = compareVisionVerdict('accept', goodFoodFields);
      expect(res.predictedLabel).toBe('accept');
      expect(res.verdict.decision).toBe('accept');
      expect(res.isMatch).toBe(true);
    });

    it('matches face visible fields with reject:face_visible label', () => {
      const res = compareVisionVerdict('reject:face_visible', faceVisibleFields);
      expect(res.predictedLabel).toBe('reject:face_visible');
      expect(res.verdict.decision).toBe('reject');
      expect(res.isMatch).toBe(true);
    });

    it('detects mismatch when face visible photo was expected to be accept', () => {
      const res = compareVisionVerdict('accept', faceVisibleFields);
      expect(res.predictedLabel).toBe('reject:face_visible');
      expect(res.isMatch).toBe(false);
    });

    it('matches not_food fields with reject:not_food label', () => {
      const res = compareVisionVerdict('reject:not_food', notFoodFields);
      expect(res.predictedLabel).toBe('reject:not_food');
      expect(res.isMatch).toBe(true);
    });

    it('matches too_much_text fields with reject:too_much_text label', () => {
      const res = compareVisionVerdict('reject:too_much_text', textHeavyFields);
      expect(res.predictedLabel).toBe('reject:too_much_text');
      expect(res.isMatch).toBe(true);
    });

    it('honors custom thresholds for verdict calculation', () => {
      const customThresholds: VisionThresholds = {
        minFoodConfidence: 0.99, // stricter
        maxProminentFaces: 0,
        maxTextFraction: 0.25,
      };
      // goodFoodFields has 0.95 foodConfidence, which fails 0.99
      const res = compareVisionVerdict('reject:not_food', goodFoodFields, customThresholds);
      expect(res.predictedLabel).toBe('reject:not_food');
      expect(res.isMatch).toBe(true);
    });
  });

  describe('computePercentile', () => {
    it('handles empty and single element arrays', () => {
      expect(computePercentile([], 50)).toBe(0);
      expect(computePercentile([42], 50)).toBe(42);
      expect(computePercentile([42], 95)).toBe(42);
    });

    it('computes correct nearest-rank p50 and p95 for a known series', () => {
      // 10 items from 100 to 1000
      const latencies = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
      expect(computePercentile(latencies, 50)).toBe(500);
      expect(computePercentile(latencies, 95)).toBe(1000);
      expect(computePercentile(latencies, 0)).toBe(100);
      expect(computePercentile(latencies, 100)).toBe(1000);
    });

    it('handles unsorted input correctly', () => {
      const unsorted = [500, 100, 900, 300, 700];
      expect(computePercentile(unsorted, 50)).toBe(500);
    });
  });

  describe('summarizeVisionEval and formatVisionEvalReport', () => {
    it('summarizes confusion counts, matrix, and latencies from evaluation items', () => {
      const items: VisionEvalItemResult[] = [
        // 1. True Accept (expected accept, predicted accept)
        {
          filename: 'dole_whip.jpg',
          expectedLabel: 'accept',
          predictedLabel: 'accept',
          verdict: { decision: 'accept' },
          fields: goodFoodFields,
          isMatch: true,
          latencyMs: 120,
        },
        // 2. False Reject (expected accept, predicted reject:not_food)
        {
          filename: 'dim_burger.jpg',
          expectedLabel: 'accept',
          predictedLabel: 'reject:not_food',
          verdict: { decision: 'reject', reasons: ['not_food'], primary: 'not_food' },
          fields: { ...goodFoodFields, foodConfidence: 0.4 },
          isMatch: false,
          latencyMs: 150,
        },
        // 3. True Reject (expected reject:face_visible, predicted reject:face_visible)
        {
          filename: 'selfie_with_churro.jpg',
          expectedLabel: 'reject:face_visible',
          predictedLabel: 'reject:face_visible',
          verdict: { decision: 'reject', reasons: ['face_visible'], primary: 'face_visible' },
          fields: faceVisibleFields,
          isMatch: true,
          latencyMs: 180,
        },
        // 4. False Accept (expected reject:face_visible, predicted accept)
        {
          filename: 'distant_face.jpg',
          expectedLabel: 'reject:face_visible',
          predictedLabel: 'accept',
          verdict: { decision: 'accept' },
          fields: goodFoodFields,
          isMatch: false,
          latencyMs: 110,
        },
        // 5. True Reject (expected reject:too_much_text, predicted reject:too_much_text)
        {
          filename: 'receipt.jpg',
          expectedLabel: 'reject:too_much_text',
          predictedLabel: 'reject:too_much_text',
          verdict: { decision: 'reject', reasons: ['too_much_text'], primary: 'too_much_text' },
          fields: textHeavyFields,
          isMatch: true,
          latencyMs: 220,
        },
      ];

      const summary = summarizeVisionEval(items);

      expect(summary.total).toBe(5);
      expect(summary.matches).toBe(3);
      expect(summary.mismatches).toBe(2);
      expect(summary.accuracy).toBe(0.6);

      // Binary counts
      expect(summary.binaryCounts.trueAccepts).toBe(1);
      expect(summary.binaryCounts.falseRejects).toBe(1);
      expect(summary.binaryCounts.trueRejects).toBe(2);
      expect(summary.binaryCounts.falseAccepts).toBe(1);

      // Confusion matrix counts
      expect(summary.confusionMatrix['accept']?.['accept']).toBe(1);
      expect(summary.confusionMatrix['accept']?.['reject:not_food']).toBe(1);
      expect(summary.confusionMatrix['reject:face_visible']?.['reject:face_visible']).toBe(1);
      expect(summary.confusionMatrix['reject:face_visible']?.['accept']).toBe(1);
      expect(summary.confusionMatrix['reject:too_much_text']?.['reject:too_much_text']).toBe(1);

      // Latencies
      expect(summary.latencies.minMs).toBe(110);
      expect(summary.latencies.maxMs).toBe(220);
      expect(summary.latencies.p50Ms).toBe(150);
      expect(summary.latencies.p95Ms).toBe(220);

      // Format report
      const report = formatVisionEvalReport(items, summary);
      expect(report).toContain('PHOTO VISION EVALUATION REPORT');
      expect(report).toContain('[MATCH]    dole_whip.jpg');
      expect(report).toContain('[MISMATCH] dim_burger.jpg');
      expect(report).toContain('Total Evaluated: 5');
      expect(report).toContain('Matches:         3 (60%)');
      expect(report).toContain('True Accepts  (TP): 1');
      expect(report).toContain('False Accepts (FP): 1');
      expect(report).toContain('False Rejects (FN): 1');
      expect(report).toContain('True Rejects  (TN): 2');
      expect(report).toContain('p50: 150 ms');
      expect(report).toContain('p95: 220 ms');
    });

    it('handles empty results gracefully', () => {
      const summary = summarizeVisionEval([]);
      expect(summary.total).toBe(0);
      expect(summary.matches).toBe(0);
      expect(summary.mismatches).toBe(0);
      expect(summary.accuracy).toBe(0);
      expect(summary.latencies.p50Ms).toBe(0);

      const report = formatVisionEvalReport([], summary);
      expect(report).toContain('(empty matrix)');
      expect(report).toContain('Total Evaluated: 0');
    });
  });
});
