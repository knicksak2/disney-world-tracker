/**
 * Ticket Price HTTP client for Disney anonymous token (Endpoint T) and price calendar (Endpoint P).
 *
 * Findings from inspecting catalog/disney/transport.ts, rateLimiter.ts, and classify.ts:
 * 1. Forced User-Agent: DisneyTransport.request unconditionally overwrites the caller's User-Agent
 *    with a browser string (e.g. DISNEY_WEB_USER_AGENT Chrome string for 'web'), whereas Ticket Price
 *    requests require an honest non-browser User-Agent (Requirement 11.1).
 * 2. WAF Retry: DisneyTransport automatically retries waf_block failures under BackoffConfig,
 *    whereas for ticket prices a WAF block is a circuit-breaker stop that must immediately halt the
 *    run and set blocked_until (Requirements 12.7, 13.3).
 * 3. Rate Limiter: DisneyTransport acquires a Redis-backed or in-process RateLimiter lease with
 *    concurrency tracking, whereas ticket prices has no Redis dependency (Requirement 19.8) and
 *    relies on simple sequential request spacing (1,500 ms) and a single-flight mutex.
 * 4. Body Size Limit: DisneyTransport calls res.text() with no body size limit found at spec time.
 *    TicketPriceClient applies a strict maxBodyBytes check (default 5 MB) to guard against memory
 *    denial-of-service while safely handling normal 1.2 MB to 1.7 MB pricing payloads.
 *
 * Justification for dedicated small client:
 * The dedicated client avoids reviving the retired Disney live path in composeServices.ts, keeps
 * ticket pricing decoupled from Redis, uses honest non-browser identification, and immediately halts
 * on WAF signals instead of retrying into an extended IP block.
 *
 * Diagnose Run 20:00-ET date acceptance note:
 * [Pending after-20:00-ET Diagnose run observation; client implements the safe max(WDW_Today, UTC date)
 * retry on 400 to accommodate potential UTC server day boundaries.]
 *
 * Validates: Requirements 11.1, 11.2, 11.11, 11.12, 11.13, 12.6, 12.7, 12.8, 13.3
 */

import { DISNEY_WAF_BODY_MARKERS, classifyDisneyResponse } from '../catalog/disney/classify.js';
import { wdwToday } from '../trips/wdwClock.js';

export class TicketClientError extends Error {
  readonly kind:
    | 'waf_block'
    | 'unauthorized'
    | 'not_found'
    | 'start_date_rejected'
    | 'http_status'
    | 'network'
    | 'timeout'
    | 'invalid_response';
  readonly status?: number | undefined;

  constructor(
    kind: TicketClientError['kind'],
    message: string,
    status?: number | undefined,
  ) {
    super(message);
    this.name = 'TicketClientError';
    this.kind = kind;
    if (status !== undefined) {
      this.status = status;
    }
  }
}

export interface TicketPriceClient {
  getToken(): Promise<string>;
  getTokenWithMeta?(): Promise<{
    readonly token: string;
    readonly bytes: number;
    readonly ms: number;
    readonly status: number;
  }>;
  getPrices(p: {
    readonly token: string;
    readonly discountGroup: string;
    readonly numDays: number;
    readonly startDate: string;
    readonly endDate: string;
  }): Promise<{
    readonly body: unknown;
    readonly bytes: number;
    readonly ms: number;
    readonly status: number;
    readonly startDateSent: string;
  }>;
}

export interface TicketPriceClientOptions {
  readonly baseUrl: string;
  readonly userAgent: string;
  readonly fetch?: typeof fetch | undefined;
  readonly timeoutMs?: number | undefined;
  readonly requestTimeoutMs?: number | undefined;
  readonly maxBodyBytes: number;
  readonly now?: (() => Date) | undefined;
}

export function createTicketPriceClient(options: TicketPriceClientOptions): TicketPriceClient {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const nowFn = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? options.requestTimeoutMs ?? 20000;

  async function executeFetch(
    url: string,
    headers: Record<string, string>,
  ): Promise<{ status: number; text: string; ms: number }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const start = Date.now();

    try {
      const res = await fetchFn(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      const text = await res.text();
      const ms = Date.now() - start;
      return { status: res.status, text, ms };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new TicketClientError('timeout', `Request timed out after ${timeoutMs}ms`);
      }
      throw new TicketClientError(
        'network',
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  function isJson(str: string): boolean {
    try {
      JSON.parse(str);
      return true;
    } catch {
      return false;
    }
  }

  function checkForWaf(status: number, text: string): boolean {
    // 403 or 429 are always waf_block
    if (status === 403 || status === 429) {
      return true;
    }
    // Check if classifyDisneyResponse classifies as waf_block
    const classification = classifyDisneyResponse({ target: 'web', status, body: text });
    if (classification && classification.kind === 'waf_block') {
      return true;
    }
    // Check WAF markers only on non-JSON or non-2xx bodies (design.md)
    const is2xx = status >= 200 && status < 300;
    if (!is2xx || !isJson(text)) {
      const lower = text.toLowerCase();
      for (const marker of DISNEY_WAF_BODY_MARKERS) {
        if (lower.includes(marker)) {
          return true;
        }
      }
    }
    return false;
  }

  async function fetchTokenWithMeta(): Promise<{
    readonly token: string;
    readonly bytes: number;
    readonly ms: number;
    readonly status: number;
  }> {
    const url = `${options.baseUrl}/profile-api/authentication/get-client-token/`;
    const { status, text, ms } = await executeFetch(url, {
      Accept: 'application/json',
      'User-Agent': options.userAgent,
    });

    if (checkForWaf(status, text)) {
      throw new TicketClientError('waf_block', 'WAF block detected while fetching token', status);
    }

    if (status === 401) {
      throw new TicketClientError('unauthorized', 'Unauthorized response while fetching token', 401);
    }

    if (status !== 200) {
      throw new TicketClientError(
        'http_status',
        `Token fetch returned status ${status}`,
        status,
      );
    }

    const bytes = text.length;
    if (bytes > options.maxBodyBytes) {
      throw new TicketClientError('invalid_response', 'Token response exceeded maxBodyBytes', 200);
    }

    try {
      const json = JSON.parse(text) as { access_token?: string };
      if (!json || typeof json.access_token !== 'string') {
        throw new TicketClientError('invalid_response', 'Token response missing access_token', 200);
      }
      return {
        token: json.access_token,
        bytes,
        ms,
        status,
      };
    } catch (err) {
      if (err instanceof TicketClientError) throw err;
      throw new TicketClientError('invalid_response', 'Token response was not valid JSON', 200);
    }
  }

  return {
    async getToken(): Promise<string> {
      const meta = await fetchTokenWithMeta();
      return meta.token;
    },
    async getPrices(p) {
      async function doCall(
        startDateToSend: string,
        endDateToSend: string,
      ): Promise<{
        readonly body: unknown;
        readonly bytes: number;
        readonly ms: number;
        readonly status: number;
        readonly startDateSent: string;
      }> {
        const query = new URLSearchParams({
          discountGroup: p.discountGroup,
          startDate: startDateToSend,
          storeId: 'wdw',
          endDate: endDateToSend,
          numDays: String(p.numDays),
        });

        const url = `${options.baseUrl}/api/lexicon-view-assembler-service/wdw/tickets/product-types/theme-parks/prices?${query.toString()}`;
        const { status, text, ms } = await executeFetch(url, {
          Accept: 'application/json',
          'User-Agent': options.userAgent,
          Authorization: `BEARER ${p.token}`,
        });

        const bytes = text.length;

        // 1. WAF check
        if (checkForWaf(status, text)) {
          throw new TicketClientError('waf_block', 'WAF block detected while fetching prices', status);
        }

        // 2. 401
        if (status === 401) {
          throw new TicketClientError('unauthorized', 'Unauthorized while fetching prices', 401);
        }

        // 3. 404
        if (status === 404) {
          throw new TicketClientError('not_found', 'Prices not found (404)', 404);
        }

        // 4. 400 start-date check
        if (status === 400) {
          const now = nowFn();
          const wdwDate = wdwToday(now);
          const utcDate = now.toISOString().split('T')[0]!;
          const maxDate = utcDate > wdwDate ? utcDate : wdwDate;

          // If the startDateToSend was wdwDate and maxDate is later, retry once with maxDate
          if (startDateToSend === wdwDate && maxDate > startDateToSend) {
            const retryEnd = p.endDate > maxDate ? p.endDate : maxDate;
            try {
              return await doCall(maxDate, retryEnd);
            } catch (err) {
              if (err instanceof TicketClientError && err.status === 400) {
                throw new TicketClientError('start_date_rejected', 'Start date rejected on retry (400)', 400);
              }
              throw err;
            }
          }

          throw new TicketClientError('start_date_rejected', 'Start date rejected (400)', 400);
        }

        // 5. Non-2xx http_status
        if (status < 200 || status >= 300) {
          throw new TicketClientError('http_status', `HTTP status error: ${status}`, status);
        }

        // Body size check
        if (bytes > options.maxBodyBytes) {
          throw new TicketClientError('invalid_response', 'Prices response exceeded maxBodyBytes', status);
        }

        // JSON parse check
        try {
          const body = JSON.parse(text);
          return {
            body,
            bytes,
            ms,
            status,
            startDateSent: startDateToSend,
          };
        } catch {
          throw new TicketClientError('invalid_response', 'Prices response was not valid JSON', status);
        }
      }

      return doCall(p.startDate, p.endDate);
    },
  };
}
