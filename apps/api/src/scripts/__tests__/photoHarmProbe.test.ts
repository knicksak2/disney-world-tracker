import { describe, it, expect } from 'vitest';
import {
  OpenAIHarmModerator,
  buildHarmRequestBody,
} from '../../services/photos/adapters/openaiHarmModerator.js';
import {
  analyzeHarmResponse,
  buildCorruptJpeg,
  formatHarmProbeReport,
  type HarmProbeResult,
} from '../photoHarmProbeReport.js';

describe('photoHarmProbe', () => {
  it('formats probe report for 2xx with all 3 fields, 2xx missing a field, 400 with error body, and network error', () => {
    // 1. 2xx with all three fields
    const res1 = analyzeHarmResponse('Good image', 200, {
      results: [
        {
          flagged: false,
          categories: { sexual: false },
          category_scores: { sexual: 0.001 },
        },
      ],
    });
    expect(res1.hasFlagged).toBe(true);
    expect(res1.hasCategories).toBe(true);
    expect(res1.hasCategoryScores).toBe(true);

    // 2. 2xx missing category_scores
    const res2 = analyzeHarmResponse('Partial 2xx', 200, {
      results: [
        {
          flagged: true,
          categories: { hate: true },
        },
      ],
    });
    expect(res2.hasFlagged).toBe(true);
    expect(res2.hasCategories).toBe(true);
    expect(res2.hasCategoryScores).toBe(false);

    // 3. 400 with error body
    const res3 = analyzeHarmResponse('Corrupt image', 400, {
      error: {
        code: 'unsupported_image',
        param: 'image',
        message: 'Could not decode image bytes',
      },
    });
    expect(res3.errorBody?.code).toBe('unsupported_image');
    expect(res3.errorBody?.param).toBe('image');
    expect(res3.errorBody?.message).toContain('Could not decode');

    // 4. Network error
    const res4: HarmProbeResult = {
      label: 'Failing probe',
      status: 0,
      networkError: 'ECONNRESET',
    };

    const report = formatHarmProbeReport([res1, res2, res3, res4]);
    expect(report).toContain('PHOTO HARM PROBE REPORT');
    expect(report).toContain('results[0].flagged present: YES');
    expect(report).toContain('results[0].category_scores present: NO');
    expect(report).toContain('error.code: unsupported_image');
    expect(report).toContain('NETWORK ERROR (ECONNRESET)');
  });

  it('corrupt-file builder keeps the length, keeps first three bytes FF D8 FF, and changes the middle', () => {
    const original = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc]);
    const corrupt = buildCorruptJpeg(original);

    // Same length
    expect(corrupt.length).toBe(original.length);

    // First three bytes match FF D8 FF
    expect(corrupt[0]).toBe(0xff);
    expect(corrupt[1]).toBe(0xd8);
    expect(corrupt[2]).toBe(0xff);

    // Middle bytes were changed
    let hasDiffInMiddle = false;
    for (let i = 3; i < original.length - 2; i++) {
      if (corrupt[i] !== original[i]) {
        hasDiffInMiddle = true;
        break;
      }
    }
    expect(hasDiffInMiddle).toBe(true);
  });

  it('request builder output equals what the adapter sends (shared code path)', async () => {
    const sampleJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x01, 0x02, 0x03]);
    const model = 'omni-moderation-latest';

    let capturedBody: unknown;
    const mockFetch: typeof fetch = async (_input, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({
          results: [{ flagged: false, categories: {}, category_scores: {} }],
        }),
        { status: 200 }
      );
    };

    const moderator = new OpenAIHarmModerator({
      apiKey: 'test-key',
      model,
      fetchFn: mockFetch,
    });

    await moderator.check(sampleJpeg);

    const probeBuiltBody = buildHarmRequestBody(model, sampleJpeg);
    expect(capturedBody).toEqual(probeBuiltBody);
  });
});
