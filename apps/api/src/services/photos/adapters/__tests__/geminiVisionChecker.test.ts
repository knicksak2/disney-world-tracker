import { describe, it, expect, vi } from 'vitest';
import {
  GeminiVisionChecker,
  GEMINI_VISION_PROMPT,
  GEMINI_RESPONSE_SCHEMA,
} from '../geminiVisionChecker.js';

describe('GeminiVisionChecker adapter', () => {
  const apiKey = 'test-gemini-key-98765';
  const sampleJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x11, 0x22]);

  const validVisionJson = {
    description: 'A delicious bowl of dole whip pineapple treat.',
    is_food_or_drink: true,
    food_confidence: 0.98,
    prominent_face_count: 0,
    minor_face_visible: false,
    any_person_part_visible: false,
    large_text: false,
    text_fraction: 0.05,
    text_seen: 'Dole',
  };

  const expectedVisionFields = {
    description: 'A delicious bowl of dole whip pineapple treat.',
    isFoodOrDrink: true,
    foodConfidence: 0.98,
    prominentFaceCount: 0,
    minorFaceVisible: false,
    anyPersonPartVisible: false,
    largeText: false,
    textFraction: 0.05,
    textSeen: 'Dole',
  };

  it('pins the exact request body, header x-goog-api-key, and never puts key in URL or logs', async () => {
    let capturedUrl = '';
    let capturedOptions: RequestInit | undefined;
    const errorLogs: Array<any> = [];
    const logger = { error: vi.fn((obj) => errorLogs.push(obj)) };

    const mockFetch: typeof fetch = async (input, init) => {
      capturedUrl = input.toString();
      capturedOptions = init;
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify(validVisionJson) }],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 210,
            candidatesTokenCount: 55,
          },
        }),
        { status: 200 }
      );
    };

    const checker = new GeminiVisionChecker({
      apiKey,
      fetchFn: mockFetch,
      logger,
    });

    const outcome = await checker.check(sampleJpeg);

    // URL check: no key in URL query or path
    expect(capturedUrl).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent'
    );
    expect(capturedUrl).not.toContain(apiKey);

    // Header check
    const headers = capturedOptions?.headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe(apiKey);
    expect(headers['Content-Type']).toBe('application/json');

    // Body check
    const parsedBody = JSON.parse(capturedOptions?.body as string);
    expect(parsedBody).toEqual({
      contents: [
        {
          parts: [
            { text: GEMINI_VISION_PROMPT },
            {
              inline_data: {
                mime_type: 'image/jpeg',
                data: Buffer.from(sampleJpeg).toString('base64'),
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: GEMINI_RESPONSE_SCHEMA,
      },
    });

    // Outcome check
    expect(outcome).toEqual({
      kind: 'ok',
      fields: expectedVisionFields,
      usage: {
        promptTokens: 210,
        outputTokens: 55,
      },
    });

    // Key never in logs
    for (const log of errorLogs) {
      expect(JSON.stringify(log)).not.toContain(apiKey);
    }
  });

  it('parses a response with a leading thoughtSignature part and takes the last text part', async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { thoughtSignature: 'sig-abc-123' },
                  { text: '{"ignore":"this_is_an_intermediate_thought"}' },
                  { text: JSON.stringify(validVisionJson) },
                ],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 150,
            candidatesTokenCount: 40,
          },
        }),
        { status: 200 }
      );
    };

    const checker = new GeminiVisionChecker({
      apiKey,
      fetchFn: mockFetch,
    });

    const outcome = await checker.check(sampleJpeg);
    expect(outcome).toEqual({
      kind: 'ok',
      fields: expectedVisionFields,
      usage: {
        promptTokens: 150,
        outputTokens: 40,
      },
    });
  });

  it('returns retryable on malformed JSON or invalid schema response', async () => {
    // Malformed JSON text
    let mockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'this is not json {' }] } }],
        }),
        { status: 200 }
      );

    let checker = new GeminiVisionChecker({ apiKey, fetchFn: mockFetch });
    expect(await checker.check(sampleJpeg)).toEqual({
      kind: 'retryable',
      code: 'vision_malformed_response',
    });

    // Missing candidate parts
    mockFetch = async () =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [] } }] }), { status: 200 });
    checker = new GeminiVisionChecker({ apiKey, fetchFn: mockFetch });
    expect(await checker.check(sampleJpeg)).toEqual({
      kind: 'retryable',
      code: 'vision_malformed_response',
    });

    // Invalid schema fields (missing required fields)
    mockFetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify({ description: 'only this' }) }] } }],
        }),
        { status: 200 }
      );
    checker = new GeminiVisionChecker({ apiKey, fetchFn: mockFetch });
    expect(await checker.check(sampleJpeg)).toEqual({
      kind: 'retryable',
      code: 'vision_malformed_response',
    });
  });

  it('handles 404 on primary model with error log vision_model_unavailable and succeeds on fallback model', async () => {
    const errorLogs: Array<any> = [];
    const logger = { error: vi.fn((obj, msg) => errorLogs.push({ obj, msg })) };
    const urlsCalled: string[] = [];

    const mockFetch: typeof fetch = async (input) => {
      const url = input.toString();
      urlsCalled.push(url);
      if (url.includes('gemini-3.5-flash-lite')) {
        return new Response(JSON.stringify({ error: { code: 404, message: 'model retired' } }), {
          status: 404,
        });
      }
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(validVisionJson) }] } }],
          usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 25 },
        }),
        { status: 200 }
      );
    };

    const checker = new GeminiVisionChecker({
      apiKey,
      fetchFn: mockFetch,
      logger,
      model: 'gemini-3.5-flash-lite',
      fallbackModel: 'gemini-3.1-flash-lite',
    });

    const outcome = await checker.check(sampleJpeg);

    expect(urlsCalled.length).toBe(2);
    expect(urlsCalled[0]).toContain('gemini-3.5-flash-lite');
    expect(urlsCalled[1]).toContain('gemini-3.1-flash-lite');

    // Check error log
    const retirementLog = errorLogs.find((l) => l.obj.event === 'vision_model_unavailable');
    expect(retirementLog).toBeDefined();
    expect(retirementLog?.obj.primaryModel).toBe('gemini-3.5-flash-lite');
    expect(retirementLog?.obj.fallbackModel).toBe('gemini-3.1-flash-lite');

    expect(outcome.kind).toBe('ok');
    if (outcome.kind === 'ok') {
      expect(outcome.fields.description).toBe(validVisionJson.description);
    }
  });

  it('returns retryable when both primary and fallback models return 404', async () => {
    const mockFetch: typeof fetch = async () => new Response('', { status: 404 });
    const checker = new GeminiVisionChecker({
      apiKey,
      fetchFn: mockFetch,
    });

    const outcome = await checker.check(sampleJpeg);
    expect(outcome).toEqual({
      kind: 'retryable',
      code: 'vision_model_unavailable',
    });
  });

  it('retries on 503 then succeeds on 200 after retry delay', async () => {
    const sleepDelays: number[] = [];
    const mockSleep = async (ms: number) => {
      sleepDelays.push(ms);
    };

    let attempt = 0;
    const mockFetch: typeof fetch = async () => {
      attempt++;
      if (attempt === 1) {
        return new Response('Service Unavailable', { status: 503 });
      }
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(validVisionJson) }] } }],
          usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 },
        }),
        { status: 200 }
      );
    };

    const checker = new GeminiVisionChecker({
      apiKey,
      fetchFn: mockFetch,
      sleepFn: mockSleep,
    });

    const outcome = await checker.check(sampleJpeg);
    expect(outcome.kind).toBe('ok');
    expect(attempt).toBe(2);
    expect(sleepDelays).toEqual([500]);
  });

  it('maps timeout, network error, 429, and other http errors correctly', async () => {
    // 429
    let checker = new GeminiVisionChecker({
      apiKey,
      fetchFn: async () => new Response('', { status: 429 }),
      sleepFn: async () => {},
    });
    expect(await checker.check(sampleJpeg)).toEqual({
      kind: 'retryable',
      code: 'vision_rate_limit',
    });

    // 500
    checker = new GeminiVisionChecker({
      apiKey,
      fetchFn: async () => new Response('', { status: 500 }),
      sleepFn: async () => {},
    });
    expect(await checker.check(sampleJpeg)).toEqual({
      kind: 'retryable',
      code: 'vision_http_500',
    });

    // Timeout
    checker = new GeminiVisionChecker({
      apiKey,
      fetchFn: async () => {
        const err = new Error('Timeout');
        err.name = 'TimeoutError';
        throw err;
      },
      sleepFn: async () => {},
    });
    expect(await checker.check(sampleJpeg)).toEqual({
      kind: 'retryable',
      code: 'vision_timeout',
    });

    // Network error
    checker = new GeminiVisionChecker({
      apiKey,
      fetchFn: async () => {
        throw new Error('network down');
      },
      sleepFn: async () => {},
    });
    expect(await checker.check(sampleJpeg)).toEqual({
      kind: 'retryable',
      code: 'vision_network_error',
    });
  });
});
