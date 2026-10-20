import { describe, it, expect, vi } from 'vitest';
import { OpenAIHarmModerator, buildHarmRequestBody } from '../openaiHarmModerator.js';

describe('OpenAIHarmModerator adapter', () => {
  const apiKey = 'test-harm-api-key-12345';
  const sampleJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02]);

  it('pins the request body and Authorization header, maps real response shape to ok', async () => {
    let capturedUrl = '';
    let capturedOptions: RequestInit | undefined;

    const mockFetch: typeof fetch = async (input, init) => {
      capturedUrl = input.toString();
      capturedOptions = init;
      return new Response(
        JSON.stringify({
          id: 'modr-123',
          model: 'omni-moderation-latest',
          results: [
            {
              flagged: false,
              categories: { hate: false, violence: false },
              category_scores: { hate: 0.001, violence: 0.02 },
            },
          ],
        }),
        { status: 200 }
      );
    };

    const moderator = new OpenAIHarmModerator({
      apiKey,
      fetchFn: mockFetch,
    });

    const outcome = await moderator.check(sampleJpeg);

    expect(capturedUrl).toBe('https://api.openai.com/v1/moderations');
    expect((capturedOptions?.headers as any)?.Authorization).toBe(`Bearer ${apiKey}`);

    const parsedBody = JSON.parse(capturedOptions?.body as string);
    expect(parsedBody.model).toBe('omni-moderation-latest');
    expect(parsedBody.input[0].type).toBe('image_url');
    expect(parsedBody.input[0].image_url.url).toContain('data:image/jpeg;base64,');

    // Also assert exported buildHarmRequestBody matches
    expect(buildHarmRequestBody('omni-moderation-latest', sampleJpeg)).toEqual(parsedBody);

    expect(outcome).toEqual({
      kind: 'ok',
      flagged: false,
      categories: { hate: false, violence: false },
      categoryScores: { hate: 0.001, violence: 0.02 },
    });
  });

  it('400 with unrecognised body is retryable harm_bad_request, not invalid_image', async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response(
        JSON.stringify({
          error: {
            message: 'Invalid image format or decoding error',
            code: 'invalid_image_data',
          },
        }),
        { status: 400 }
      );
    };

    // Default empty allow-list: every 400 is retryable
    const moderator = new OpenAIHarmModerator({
      apiKey,
      fetchFn: mockFetch,
      invalidImageCodes: [],
    });

    const outcome = await moderator.check(sampleJpeg);
    expect(outcome).toEqual({
      kind: 'retryable',
      code: 'harm_bad_request',
    });
  });

  it('400 matching allow-list entry maps to invalid_image', async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response(
        JSON.stringify({
          error: {
            message: 'Image cannot be decoded',
            code: 'unsupported_image',
          },
        }),
        { status: 400 }
      );
    };

    const moderator = new OpenAIHarmModerator({
      apiKey,
      fetchFn: mockFetch,
      invalidImageCodes: ['unsupported_image'],
    });

    const outcome = await moderator.check(sampleJpeg);
    expect(outcome).toEqual({ kind: 'invalid_image' });
  });

  it('streak event is logged on the 5th consecutive harm_bad_request and not before, 200 resets streak', async () => {
    const errorLogs: Array<{ obj: Record<string, unknown>; msg?: string }> = [];
    const logger = {
      error: vi.fn((obj, msg) => {
        errorLogs.push({ obj, msg });
      }),
    };

    let callCount = 0;
    const mockFetch: typeof fetch = async () => {
      callCount++;
      return new Response(JSON.stringify({ error: { message: 'Bad request' } }), { status: 400 });
    };

    const moderator = new OpenAIHarmModerator({
      apiKey,
      fetchFn: mockFetch,
      badRequestAlertCount: 5,
      logger,
    });

    // 4 calls: no streak event logged yet
    for (let i = 0; i < 4; i++) {
      await moderator.check(sampleJpeg);
    }
    const streakLogsBefore = errorLogs.filter((l) => l.obj.event === 'photos.harm.bad_request_streak');
    expect(streakLogsBefore.length).toBe(0);

    // 5th call: streak event logged
    await moderator.check(sampleJpeg);
    const streakLogsAfter = errorLogs.filter((l) => l.obj.event === 'photos.harm.bad_request_streak');
    expect(streakLogsAfter.length).toBe(1);

    // Now a 200 resets the streak
    const okFetch: typeof fetch = async () => {
      return new Response(
        JSON.stringify({ results: [{ flagged: false, categories: {}, category_scores: {} }] }),
        { status: 200 }
      );
    };
    (moderator as any).fetchFn = okFetch;
    await moderator.check(sampleJpeg);

    // Next 4 bad requests still do not log streak
    (moderator as any).fetchFn = mockFetch;
    for (let i = 0; i < 4; i++) {
      await moderator.check(sampleJpeg);
    }
    const streakLogsAfterReset = errorLogs.filter((l) => l.obj.event === 'photos.harm.bad_request_streak');
    expect(streakLogsAfterReset.length).toBe(1); // still 1

    // 5th bad request logs streak again
    await moderator.check(sampleJpeg);
    const streakLogsFinal = errorLogs.filter((l) => l.obj.event === 'photos.harm.bad_request_streak');
    expect(streakLogsFinal.length).toBe(2);
  });

  it('maps 401/403 to harm_auth_error, 429 to rate limit, 500 to server error, timeout to harm_timeout', async () => {
    const errorLogs: Array<any> = [];
    const logger = { error: vi.fn((obj) => errorLogs.push(obj)) };

    // 401
    let moderator = new OpenAIHarmModerator({
      apiKey,
      fetchFn: async () => new Response('', { status: 401 }),
      logger,
    });
    expect(await moderator.check(sampleJpeg)).toEqual({ kind: 'retryable', code: 'harm_auth_error' });

    // 403
    moderator = new OpenAIHarmModerator({
      apiKey,
      fetchFn: async () => new Response('', { status: 403 }),
      logger,
    });
    expect(await moderator.check(sampleJpeg)).toEqual({ kind: 'retryable', code: 'harm_auth_error' });

    // 429
    moderator = new OpenAIHarmModerator({
      apiKey,
      fetchFn: async () => new Response('', { status: 429 }),
    });
    expect(await moderator.check(sampleJpeg)).toEqual({ kind: 'retryable', code: 'harm_rate_limit' });

    // 500
    moderator = new OpenAIHarmModerator({
      apiKey,
      fetchFn: async () => new Response('', { status: 500 }),
    });
    expect(await moderator.check(sampleJpeg)).toEqual({ kind: 'retryable', code: 'harm_http_500' });

    // Other non-2xx: 404, 413, 422
    for (const status of [404, 413, 422]) {
      moderator = new OpenAIHarmModerator({
        apiKey,
        fetchFn: async () => new Response('', { status }),
      });
      expect(await moderator.check(sampleJpeg)).toEqual({ kind: 'retryable', code: `harm_http_${status}` });
    }

    // Timeout
    moderator = new OpenAIHarmModerator({
      apiKey,
      fetchFn: async () => {
        const err = new Error('The operation was aborted');
        err.name = 'TimeoutError';
        throw err;
      },
    });
    expect(await moderator.check(sampleJpeg)).toEqual({ kind: 'retryable', code: 'harm_timeout' });

    // Network error
    moderator = new OpenAIHarmModerator({
      apiKey,
      fetchFn: async () => {
        throw new Error('fetch failed');
      },
    });
    expect(await moderator.check(sampleJpeg)).toEqual({ kind: 'retryable', code: 'harm_network_error' });

    // Assert key never in logs
    for (const log of errorLogs) {
      expect(JSON.stringify(log)).not.toContain(apiKey);
    }
  });
});
