#!/usr/bin/env node
/**
 * Repeatable Vision Evaluation Script.
 *
 * Reads a folder of JPEGs plus a `labels.json`:
 * { "file.jpg": "accept" | "reject:face_visible" | "reject:not_food" | "reject:too_much_text" }
 *
 * Resizes nothing (expects prepared images).
 * Calls the Vision_Checker adapter with config from environment variables.
 * Prints per-image Vision_Fields, computed verdict, and match/mismatch status,
 * followed by a confusion summary and p50/p95 latency.
 *
 * Secrets are never committed or printed.
 *
 * Implements: Task 12.1
 * Validates: Requirement 24.1
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GeminiVisionChecker } from '../services/photos/adapters/geminiVisionChecker.js';
import {
  DEFAULT_VISION_THRESHOLDS,
  type VisionThresholds,
} from '../services/photos/domain/visionVerdict.js';
import {
  compareVisionVerdict,
  formatVisionEvalReport,
  summarizeVisionEval,
  type VisionEvalItemResult,
} from './photoVisionEvalReport.js';

export * from './photoVisionEvalReport.js';

export async function runVisionEval(options: {
  readonly folderPath: string;
  readonly labelsPath?: string;
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly fallbackModel?: string;
  readonly thresholds?: VisionThresholds;
}): Promise<{
  readonly items: readonly VisionEvalItemResult[];
  readonly report: string;
}> {
  const { folderPath, labelsPath, apiKey, baseUrl, model, fallbackModel } = options;
  const targetLabelsPath = labelsPath ?? join(folderPath, 'labels.json');

  if (!existsSync(targetLabelsPath)) {
    throw new Error(`Labels file not found at ${targetLabelsPath}`);
  }

  let labelsMap: Record<string, string>;
  try {
    const raw = readFileSync(targetLabelsPath, 'utf8');
    labelsMap = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse labels file at ${targetLabelsPath}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const thresholds: VisionThresholds = options.thresholds ?? {
    minFoodConfidence: process.env.PHOTO_VISION_MIN_FOOD_CONFIDENCE
      ? Number(process.env.PHOTO_VISION_MIN_FOOD_CONFIDENCE)
      : DEFAULT_VISION_THRESHOLDS.minFoodConfidence,
    maxProminentFaces: process.env.PHOTO_VISION_MAX_PROMINENT_FACES
      ? Number(process.env.PHOTO_VISION_MAX_PROMINENT_FACES)
      : DEFAULT_VISION_THRESHOLDS.maxProminentFaces,
    maxTextFraction: process.env.PHOTO_VISION_MAX_TEXT_FRACTION
      ? Number(process.env.PHOTO_VISION_MAX_TEXT_FRACTION)
      : DEFAULT_VISION_THRESHOLDS.maxTextFraction,
  };

  const checker = new GeminiVisionChecker({
    apiKey,
    ...(baseUrl ? { baseUrl } : {}),
    ...(model ? { model } : {}),
    ...(fallbackModel ? { fallbackModel } : {}),
  });

  const results: VisionEvalItemResult[] = [];
  const entries = Object.entries(labelsMap);

  console.log(`Evaluating ${entries.length} images from ${folderPath}...`);

  for (const [filename, expectedLabel] of entries) {
    const imgPath = join(folderPath, filename);
    if (!existsSync(imgPath)) {
      results.push({
        filename,
        expectedLabel,
        isMatch: false,
        latencyMs: 0,
        error: `File not found on disk: ${imgPath}`,
      });
      continue;
    }

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(readFileSync(imgPath));
    } catch (err) {
      results.push({
        filename,
        expectedLabel,
        isMatch: false,
        latencyMs: 0,
        error: `Could not read file: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    const t0 = performance.now();
    try {
      const outcome = await checker.check(bytes);
      const latencyMs = Math.round(performance.now() - t0);

      if (outcome.kind === 'ok') {
        const comp = compareVisionVerdict(expectedLabel, outcome.fields, thresholds);
        results.push({
          filename,
          expectedLabel,
          predictedLabel: comp.predictedLabel,
          verdict: comp.verdict,
          fields: outcome.fields,
          isMatch: comp.isMatch,
          latencyMs,
        });
      } else {
        results.push({
          filename,
          expectedLabel,
          isMatch: false,
          latencyMs,
          error: `Retryable checker error: ${outcome.code}`,
        });
      }
    } catch (err) {
      const latencyMs = Math.round(performance.now() - t0);
      results.push({
        filename,
        expectedLabel,
        isMatch: false,
        latencyMs,
        error: `Checker threw error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  const summary = summarizeVisionEval(results);
  const report = formatVisionEvalReport(results, summary);
  return { items: results, report };
}

async function main(): Promise<void> {
  const folderPath = process.argv[2];
  if (!folderPath) {
    console.error('Usage: tsx src/scripts/photoVisionEval.ts <path-to-folder-of-images> [path-to-labels.json]');
    process.exit(1);
  }

  const labelsPath = process.argv[3];
  const apiKey = process.env.PHOTO_VISION_API_KEY;
  if (!apiKey) {
    console.error('Error: PHOTO_VISION_API_KEY environment variable is required.');
    process.exit(1);
  }

  const baseUrl = process.env.PHOTO_VISION_BASE_URL;
  const model = process.env.PHOTO_VISION_MODEL;
  const fallbackModel = process.env.PHOTO_VISION_FALLBACK_MODEL;

  const { report } = await runVisionEval({
    folderPath,
    apiKey,
    ...(labelsPath ? { labelsPath } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(model ? { model } : {}),
    ...(fallbackModel ? { fallbackModel } : {}),
  });

  console.log(report);
}

if (
  process.argv[1]?.endsWith('photoVisionEval.ts') ||
  process.argv[1]?.endsWith('photoVisionEval.js')
) {
  main().catch((err) => {
    console.error('Vision evaluation crashed:', err);
    process.exit(1);
  });
}
