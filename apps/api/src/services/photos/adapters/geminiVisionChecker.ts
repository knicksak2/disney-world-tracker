import { type VisionChecker, type VisionOutcome } from '../ports.js';
import { parseVisionFields } from '../domain/visionVerdict.js';

export interface GeminiVisionCheckerOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  fallbackModel?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
  logger?: {
    error: (obj: Record<string, unknown>, msg?: string) => void;
    warn?: (obj: Record<string, unknown>, msg?: string) => void;
  };
}

export const GEMINI_VISION_PROMPT =
  "You are screening a photo submitted to a theme-park dish gallery. Fill the fields from what is visible. prominent_face_count: the number of human faces that are clearly recognizable, including in the background. minor_face_visible: true if any visible face appears to be a child's. any_person_part_visible: true if any part of a person (hand, arm, legs) is visible. text_fraction: the approximate fraction of the image area covered by text, signs, menus, receipts or screens, from 0 to 1. text_seen: a short transcription of the most prominent text, at most 200 characters. is_food_or_drink and food_confidence: whether the main subject is food or a drink, and how sure you are, from 0 to 1. description: one short sentence.";

export const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    description: { type: 'STRING' },
    is_food_or_drink: { type: 'BOOLEAN' },
    food_confidence: { type: 'NUMBER' },
    prominent_face_count: { type: 'INTEGER' },
    minor_face_visible: { type: 'BOOLEAN' },
    any_person_part_visible: { type: 'BOOLEAN' },
    large_text: { type: 'BOOLEAN' },
    text_fraction: { type: 'NUMBER' },
    text_seen: { type: 'STRING' },
  },
  required: [
    'description',
    'is_food_or_drink',
    'food_confidence',
    'prominent_face_count',
    'minor_face_visible',
    'any_person_part_visible',
    'large_text',
    'text_fraction',
    'text_seen',
  ],
} as const;

export class GeminiVisionChecker implements VisionChecker {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fallbackModel: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly logger?: GeminiVisionCheckerOptions['logger'];

  constructor(options: GeminiVisionCheckerOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
    this.model = options.model ?? 'gemini-3.5-flash-lite';
    this.fallbackModel = options.fallbackModel ?? 'gemini-3.1-flash-lite';
    this.timeoutMs = options.timeoutMs ?? 20000;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.sleepFn = options.sleepFn ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.logger = options.logger;
  }

  async check(jpeg: Uint8Array): Promise<VisionOutcome> {
    const primaryResult = await this.callModelWithRetries(this.model, jpeg);
    if (primaryResult.status === 404) {
      this.logger?.error(
        {
          event: 'vision_model_unavailable',
          primaryModel: this.model,
          fallbackModel: this.fallbackModel,
        },
        'primary vision model retired, attempting fallback'
      );
      const fallbackResult = await this.callModelWithRetries(this.fallbackModel, jpeg);
      return this.handleCallResponse(fallbackResult);
    }
    return this.handleCallResponse(primaryResult);
  }

  private async callModelWithRetries(
    model: string,
    jpeg: Uint8Array
  ): Promise<{ status: number; data?: unknown; error?: unknown }> {
    const delays = [500, 1500];
    const url = `${this.baseUrl}/v1beta/models/${model}:generateContent`;
    const base64 = Buffer.from(jpeg).toString('base64');

    const body = {
      contents: [
        {
          parts: [
            { text: GEMINI_VISION_PROMPT },
            {
              inline_data: {
                mime_type: 'image/jpeg',
                data: base64,
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
    };

    let attempt = 0;
    while (true) {
      try {
        const res = await this.fetchFn(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.apiKey,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (res.ok) {
          const json = await res.json();
          return { status: res.status, data: json };
        }

        // On 404, don't retry same model - return immediately to trigger fallback
        if (res.status === 404) {
          return { status: 404 };
        }

        // Retryable status codes: 429, 5xx
        const isRetryableStatus = res.status === 429 || res.status >= 500;
        if (isRetryableStatus && attempt < delays.length) {
          const delay = delays[attempt]!;
          attempt++;
          await this.sleepFn(delay);
          continue;
        }

        return { status: res.status };
      } catch (err: unknown) {
        if (attempt < delays.length) {
          const delay = delays[attempt]!;
          attempt++;
          await this.sleepFn(delay);
          continue;
        }
        return { status: 0, error: err };
      }
    }
  }

  private handleCallResponse(result: { status: number; data?: unknown; error?: unknown }): VisionOutcome {
    if (result.status === 200 && result.data && typeof result.data === 'object') {
      const data = result.data as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string }>;
          };
        }>;
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
        };
      };

      const candidate = data.candidates?.[0];
      const parts = candidate?.content?.parts;
      if (!parts || !Array.isArray(parts) || parts.length === 0) {
        return { kind: 'retryable', code: 'vision_malformed_response' };
      }

      // Take the last text part (parts may include a thoughtSignature part)
      let lastTextPart: string | undefined;
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        if (p && typeof p.text === 'string') {
          lastTextPart = p.text;
          break;
        }
      }

      if (!lastTextPart) {
        return { kind: 'retryable', code: 'vision_malformed_response' };
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(lastTextPart);
      } catch {
        return { kind: 'retryable', code: 'vision_malformed_response' };
      }

      const parsedFields = parseVisionFields(parsedJson);
      if (!parsedFields.ok) {
        return { kind: 'retryable', code: 'vision_malformed_response' };
      }

      const promptTokens = data.usageMetadata?.promptTokenCount ?? 0;
      const outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0;

      return {
        kind: 'ok',
        fields: parsedFields.fields,
        usage: {
          promptTokens,
          outputTokens,
        },
      };
    }

    if (result.status === 404) {
      return { kind: 'retryable', code: 'vision_model_unavailable' };
    }

    if (result.status === 429) {
      return { kind: 'retryable', code: 'vision_rate_limit' };
    }

    if (result.status >= 500) {
      return { kind: 'retryable', code: `vision_http_${result.status}` };
    }

    if (result.status !== 0) {
      return { kind: 'retryable', code: `vision_http_${result.status}` };
    }

    const isTimeout =
      result.error instanceof Error &&
      (result.error.name === 'TimeoutError' || result.error.name === 'AbortError');
    if (isTimeout) {
      return { kind: 'retryable', code: 'vision_timeout' };
    }

    return { kind: 'retryable', code: 'vision_network_error' };
  }
}
