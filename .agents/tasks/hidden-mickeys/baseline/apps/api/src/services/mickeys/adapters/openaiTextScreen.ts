/**
 * OpenAI Moderations API text harm screener (Task 5.1).
 *
 * Implements the text screening port for community submissions per design.md External Interfaces.
 * Sends { model, input: "<clue1>\n<clue2>\n<reveal>" } as a plain string input.
 * Relies on `results[0].flagged` (boolean).
 * Maps 401, 403, 429, 5xx, timeout, network error and malformed body to `{ kind: 'retryable', code }`.
 *
 * Validates: Requirements 6.3, 6.4
 */

export type TextScreenOutcome =
  | { kind: 'ok'; flagged: boolean }
  | { kind: 'retryable'; code: string };

export interface TextScreenPort {
  screen(text: string): Promise<TextScreenOutcome>;
}

export interface OpenAITextScreenOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export class OpenAITextScreen implements TextScreenPort {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: OpenAITextScreenOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? 'https://api.openai.com').replace(/\/+$/, '');
    this.model = options.model ?? 'omni-moderation-latest';
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  async screen(text: string): Promise<TextScreenOutcome> {
    const url = `${this.baseUrl}/v1/moderations`;
    const body = {
      model: this.model,
      input: text,
    };

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
      const isTimeout =
        err instanceof Error &&
        (err.name === 'TimeoutError' || err.name === 'AbortError');
      if (isTimeout) {
        return { kind: 'retryable', code: 'timeout' };
      }
      return { kind: 'retryable', code: 'network_error' };
    }

    if (!res.ok) {
      return { kind: 'retryable', code: `http_${res.status}` };
    }

    try {
      const json = (await res.json()) as {
        results?: Array<{
          flagged?: boolean;
        }>;
      };
      const result = json.results?.[0];
      if (!result || typeof result.flagged !== 'boolean') {
        return { kind: 'retryable', code: 'malformed_response' };
      }
      return { kind: 'ok', flagged: result.flagged };
    } catch {
      return { kind: 'retryable', code: 'malformed_response' };
    }
  }
}
