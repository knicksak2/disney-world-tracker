/**
 * Tests for OpenAITextScreen adapter (Task 5.1).
 *
 * Validates: Requirements 6.3, 6.4
 */

import { describe, expect, it } from 'vitest';
import { OpenAITextScreen } from '../openaiTextScreen.js';

describe('OpenAITextScreen adapter', () => {
  const API_KEY = 'test-harm-api-key';

  it('calls correct URL with Bearer auth and plain string input body', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: any = null;

    const fetchFn: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = (init?.headers as Record<string, string>) ?? {};
      capturedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ results: [{ flagged: false }] }), { status: 200 });
    };

    const screener = new OpenAITextScreen({
      apiKey: API_KEY,
      baseUrl: 'https://api.openai.com',
      fetchFn,
    });

    const result = await screener.check('Clue 1\nClue 2\nReveal');

    expect(capturedUrl).toBe('https://api.openai.com/v1/moderations');
    expect(capturedHeaders['Authorization']).toBe(`Bearer ${API_KEY}`);
    expect(capturedHeaders['Content-Type']).toBe('application/json');
    expect(capturedBody.model).toBe('omni-moderation-latest');
    expect(capturedBody.input).toBe('Clue 1\nClue 2\nReveal');
    expect(result).toEqual({ kind: 'ok', flagged: false });
  });

  it('parses flagged: true correctly', async () => {
    const fetchFn: typeof fetch = async () => {
      return new Response(JSON.stringify({ results: [{ flagged: true }] }), { status: 200 });
    };

    const screener = new OpenAITextScreen({ apiKey: API_KEY, fetchFn });
    const result = await screener.check('Harmful text');
    expect(result).toEqual({ kind: 'ok', flagged: true });
  });

  it('maps HTTP 401, 403, 429, 500, 503 to retryable', async () => {
    for (const status of [401, 403, 429, 500, 503]) {
      const fetchFn: typeof fetch = async () => {
        return new Response('Error', { status });
      };
      const screener = new OpenAITextScreen({ apiKey: API_KEY, fetchFn });
      const result = await screener.check('Some text');
      expect(result).toEqual({ kind: 'retryable', code: `http_${status}` });
    }
  });

  it('maps malformed body or missing flagged boolean to retryable', async () => {
    for (const body of ['not json', '{}', '{"results": []}', '{"results": [{}]}']) {
      const fetchFn: typeof fetch = async () => {
        return new Response(body, { status: 200 });
      };
      const screener = new OpenAITextScreen({ apiKey: API_KEY, fetchFn });
      const result = await screener.check('Some text');
      expect(result).toEqual({ kind: 'retryable', code: 'malformed_response' });
    }
  });

  it('maps timeout to retryable timeout', async () => {
    const fetchFn: typeof fetch = async () => {
      const err = new Error('Timeout');
      err.name = 'TimeoutError';
      throw err;
    };

    const screener = new OpenAITextScreen({ apiKey: API_KEY, fetchFn });
    const result = await screener.check('Some text');
    expect(result).toEqual({ kind: 'retryable', code: 'timeout' });
  });

  it('maps network error to retryable network_error', async () => {
    const fetchFn: typeof fetch = async () => {
      throw new Error('Connection reset');
    };

    const screener = new OpenAITextScreen({ apiKey: API_KEY, fetchFn });
    const result = await screener.check('Some text');
    expect(result).toEqual({ kind: 'retryable', code: 'network_error' });
  });
});
