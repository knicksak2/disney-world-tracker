#!/usr/bin/env node
/**
 * Live photo harm-check probe script.
 *
 * Sends two requests to the OpenAI Moderation endpoint:
 * (1) A known-good JPEG provided via path argument
 * (2) A deliberately corrupt JPEG (same file with middle bytes zeroed out)
 *
 * Uses the exact shared request body builder as OpenAIHarmModerator.
 * Secrets (API keys) are never logged or printed.
 *
 * Implements: Task 6.6
 * Validates: Requirements 6.2, 6.6, 24.4
 */

import { readFileSync } from 'node:fs';
import { buildHarmRequestBody } from '../services/photos/adapters/openaiHarmModerator.js';
import {
  analyzeHarmResponse,
  buildCorruptJpeg,
  formatHarmProbeReport,
  type HarmProbeResult,
} from './photoHarmProbeReport.js';

async function main(): Promise<void> {
  const apiKey = process.env.PHOTO_HARM_API_KEY;
  const baseUrl = (process.env.PHOTO_HARM_BASE_URL ?? 'https://api.openai.com').replace(/\/+$/, '');
  const model = process.env.PHOTO_HARM_MODEL ?? 'omni-moderation-latest';

  if (!apiKey) {
    console.error('Error: PHOTO_HARM_API_KEY environment variable is required.');
    process.exit(1);
  }

  const samplePath = process.argv[2];
  if (!samplePath) {
    console.error('Usage: tsx src/scripts/photoHarmProbe.ts <path-to-sample-jpeg>');
    process.exit(1);
  }

  let goodBytes: Uint8Array;
  try {
    const buf = readFileSync(samplePath);
    goodBytes = new Uint8Array(buf);
  } catch (err) {
    console.error(`Failed to read sample image at ${samplePath}:`, err);
    process.exit(1);
  }

  const corruptBytes = buildCorruptJpeg(goodBytes);
  const url = `${baseUrl}/v1/moderations`;
  const results: HarmProbeResult[] = [];

  // Probe 1: Known-good JPEG
  try {
    const body1 = buildHarmRequestBody(model, goodBytes);
    const res1 = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body1),
    });
    const data1 = await res1.json().catch(() => ({}));
    results.push(analyzeHarmResponse('Known-good JPEG', res1.status, data1));
  } catch (err) {
    results.push({
      label: 'Known-good JPEG',
      status: 0,
      networkError: err instanceof Error ? err.message : String(err),
    });
  }

  // Probe 2: Corrupt JPEG
  try {
    const body2 = buildHarmRequestBody(model, corruptBytes);
    const res2 = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body2),
    });
    const data2 = await res2.json().catch(() => ({}));
    results.push(analyzeHarmResponse('Corrupt JPEG', res2.status, data2));
  } catch (err) {
    results.push({
      label: 'Corrupt JPEG',
      status: 0,
      networkError: err instanceof Error ? err.message : String(err),
    });
  }

  console.log(formatHarmProbeReport(results));
}

if (process.argv[1]?.endsWith('photoHarmProbe.ts') || process.argv[1]?.endsWith('photoHarmProbe.js')) {
  main().catch((err) => {
    console.error('Probe crashed:', err);
    process.exit(1);
  });
}
