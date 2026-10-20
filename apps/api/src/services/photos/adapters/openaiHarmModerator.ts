import { type HarmModerator, type HarmOutcome } from '../ports.js';

export interface OpenAIHarmModeratorOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  invalidImageCodes?: readonly string[];
  badRequestAlertCount?: number;
  fetchFn?: typeof fetch;
  logger?: {
    error: (obj: Record<string, unknown>, msg?: string) => void;
    warn?: (obj: Record<string, unknown>, msg?: string) => void;
  };
}

export function buildHarmRequestBody(model: string, jpeg: Uint8Array): {
  model: string;
  input: Array<{
    type: 'image_url';
    image_url: { url: string };
  }>;
} {
  const base64 = Buffer.from(jpeg).toString('base64');
  return {
    model,
    input: [
      {
        type: 'image_url',
        image_url: {
          url: `data:image/jpeg;base64,${base64}`,
        },
      },
    ],
  };
}

export class OpenAIHarmModerator implements HarmModerator {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly invalidImageCodes: readonly string[];
  private readonly badRequestAlertCount: number;
  private readonly fetchFn: typeof fetch;
  private readonly logger?: OpenAIHarmModeratorOptions['logger'];
  private consecutiveBadRequests = 0;

  constructor(options: OpenAIHarmModeratorOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? 'https://api.openai.com').replace(/\/+$/, '');
    this.model = options.model ?? 'omni-moderation-latest';
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.invalidImageCodes = options.invalidImageCodes ?? [];
    this.badRequestAlertCount = options.badRequestAlertCount ?? 5;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.logger = options.logger;
  }

  async check(jpeg: Uint8Array): Promise<HarmOutcome> {
    const url = `${this.baseUrl}/v1/moderations`;
    const body = buildHarmRequestBody(this.model, jpeg);

    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err: unknown) {
      this.consecutiveBadRequests = 0;
      const isTimeout =
        err instanceof Error &&
        (err.name === 'TimeoutError' || err.name === 'AbortError');
      if (isTimeout) {
        return { kind: 'retryable', code: 'harm_timeout' };
      }
      return { kind: 'retryable', code: 'harm_network_error' };
    }

    if (res.ok) {
      this.consecutiveBadRequests = 0;
      try {
        const json = (await res.json()) as {
          results?: Array<{
            flagged?: boolean;
            categories?: Record<string, boolean>;
            category_scores?: Record<string, number>;
          }>;
        };
        const result = json.results?.[0];
        if (!result) {
          return { kind: 'retryable', code: 'harm_malformed_response' };
        }
        return {
          kind: 'ok',
          flagged: Boolean(result.flagged),
          categories: result.categories ?? {},
          categoryScores: result.category_scores ?? {},
        };
      } catch {
        return { kind: 'retryable', code: 'harm_malformed_response' };
      }
    }

    if (res.status === 400) {
      this.consecutiveBadRequests++;
      if (this.consecutiveBadRequests === this.badRequestAlertCount) {
        this.logger?.error({
          event: 'photos.harm.bad_request_streak',
          streak: this.consecutiveBadRequests,
        }, 'consecutive harm 400 bad requests threshold reached');
      }

      let errorBody: { error?: { code?: string; param?: string; message?: string } } = {};
      try {
        errorBody = (await res.json()) as typeof errorBody;
      } catch {
        // Ignored
      }

      const errCode = errorBody.error?.code;
      const errParam = errorBody.error?.param;
      const errMessage = errorBody.error?.message ?? '';

      const isAllowListed =
        this.invalidImageCodes.length > 0 &&
        this.invalidImageCodes.some(
          (code) =>
            Boolean(code) &&
            (errCode === code || errParam === code || errMessage.includes(code))
        );

      if (isAllowListed) {
        return { kind: 'invalid_image' };
      }

      this.logger?.error({
        event: 'photos.harm.bad_request',
        code: 'harm_bad_request',
        httpStatus: 400,
        errCode,
        errParam,
      }, 'harm request returned 400 bad request');

      return { kind: 'retryable', code: 'harm_bad_request' };
    }

    // Non-400 responses reset the streak
    this.consecutiveBadRequests = 0;

    if (res.status === 401 || res.status === 403) {
      this.logger?.error({
        event: 'photos.harm.auth_error',
        code: 'harm_auth_error',
        httpStatus: res.status,
      }, 'harm provider auth error');
      return { kind: 'retryable', code: 'harm_auth_error' };
    }

    if (res.status === 429) {
      return { kind: 'retryable', code: 'harm_rate_limit' };
    }

    if (res.status >= 500) {
      return { kind: 'retryable', code: `harm_http_${res.status}` };
    }

    // Any other status: 404, 413, 422, etc. (Requirement 6.10)
    const code = `harm_http_${res.status}`;
    this.logger?.error({
      event: 'photos.harm.http_error',
      code,
      httpStatus: res.status,
    }, 'harm provider returned non-2xx status');
    return { kind: 'retryable', code };
  }
}
