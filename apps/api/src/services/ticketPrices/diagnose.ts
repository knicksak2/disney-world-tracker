/**
 * Admin diagnose action for Disney Ticket Prices integration.
 *
 * Runs two client calls (T and P), writes zero cache rows, takes the diagnose claim.
 * Never reads TICKET_PRICES_ENABLED (runs while kill switch is false for operator verification).
 *
 * Validates: Requirements 11.13, 13.2, 19.3
 */

import type { AdminDiagnoseResult } from './adminPort.js';
import { TicketClientError, type TicketPriceClient } from './ticketPriceClient.js';
import { dollarsStringToCents } from './ticketMoney.js';
import type { TicketPricesRepo } from './repo.js';

export interface DiagnoseConfig {
  readonly claimTimeoutMinutes: number;
  readonly diagnoseMinIntervalSeconds: number;
  readonly blockCooldownMinutes: number;
  readonly requestSpacingMs?: number;
}

export type DiagnoseOutcome =
  | AdminDiagnoseResult
  | { readonly refused: 'blocked' | 'already_running' | 'too_soon'; readonly blockedUntil?: string };

interface PricingItem {
  readonly id?: unknown;
  readonly subtotal?: unknown;
}

interface DateEntry {
  readonly date?: unknown;
  readonly pricing?: unknown;
}

interface PricingCalendarEntry {
  readonly numDays?: unknown;
  readonly dates?: unknown;
}

interface PricingBody {
  readonly maxPricingCalendarDate?: unknown;
  readonly pricingCalendar?: unknown;
}

export async function runDiagnose(
  client: TicketPriceClient,
  repo: TicketPricesRepo,
  today: string,
  nowFn: () => Date,
  cfg: DiagnoseConfig,
  sleepFn?: (ms: number) => Promise<void>,
): Promise<DiagnoseOutcome> {
  const now = nowFn();
  const sleep = sleepFn ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  // 1. Check if blocked
  const blockedUntil = await repo.readBlockedUntil();
  if (blockedUntil !== null && blockedUntil > now) {
    return { refused: 'blocked', blockedUntil: blockedUntil.toISOString() };
  }

  // 2. Claim diagnose
  const claimed = await repo.claimControl(
    'diagnose',
    false,
    cfg.claimTimeoutMinutes,
    cfg.diagnoseMinIntervalSeconds,
  );

  if (!claimed) {
    // Determine refusal reason from control row
    const book = await repo.readBook([], today);
    const ctrl = book.control;
    if (ctrl && ctrl.blockedUntil !== null && ctrl.blockedUntil > now) {
      return { refused: 'blocked', blockedUntil: ctrl.blockedUntil.toISOString() };
    }
    if (
      ctrl &&
      ctrl.inProgressSince !== null &&
      now.getTime() - ctrl.inProgressSince.getTime() < cfg.claimTimeoutMinutes * 60_000
    ) {
      return { refused: 'already_running' };
    }
    return { refused: 'too_soon' };
  }

  let wafEncountered = false;

  try {
    // Call T: get token
    const tokenStart = Date.now();
    let token: string;
    try {
      token = await client.getToken();
    } catch (tokenErr: unknown) {
      const isWaf = tokenErr instanceof TicketClientError && tokenErr.kind === 'waf_block';
      if (isWaf) {
        wafEncountered = true;
        const blockUntil = new Date(now.getTime() + cfg.blockCooldownMinutes * 60_000);
        await repo.block(blockUntil, 'waf_block');
      }
      const code =
        tokenErr instanceof TicketClientError
          ? tokenErr.kind === 'http_status'
            ? `http_status:${tokenErr.status}`
            : tokenErr.kind
          : 'network';
      return {
        token: {
          status: tokenErr instanceof TicketClientError ? (tokenErr.status ?? 0) : 0,
          bytes: 0,
          ms: Date.now() - tokenStart,
        },
        prices: {
          status: 0,
          bytes: 0,
          ms: 0,
          wafMarker: isWaf,
          startDateSent: today,
          retried: false,
        },
        maxPricingCalendarDate: null,
        adultMk1DayPriceCents: null,
        failure: {
          call: 'token',
          code,
          message: tokenErr instanceof Error ? tokenErr.message : String(tokenErr),
        },
      };
    }
    const tokenMeta = { token, bytes: token.length, ms: Date.now() - tokenStart, status: 200 };

    // Request spacing between token call and price call
    if (cfg.requestSpacingMs && cfg.requestSpacingMs > 0) {
      await sleep(cfg.requestSpacingMs);
    }

    // Call P: get prices for std-gst 1-day today
    const pricesStart = Date.now();
    let pRes: {
      readonly status: number;
      readonly bytes: number;
      readonly ms: number;
      readonly startDateSent: string;
      readonly body: unknown;
    };
    try {
      pRes = await client.getPrices({
        token: tokenMeta.token,
        discountGroup: 'std-gst',
        numDays: 1,
        startDate: today,
        endDate: today,
      });
    } catch (priceErr: unknown) {
      const isWaf = priceErr instanceof TicketClientError && priceErr.kind === 'waf_block';
      if (isWaf) {
        wafEncountered = true;
        const blockUntil = new Date(now.getTime() + cfg.blockCooldownMinutes * 60_000);
        await repo.block(blockUntil, 'waf_block');
      }
      const code =
        priceErr instanceof TicketClientError
          ? priceErr.kind === 'http_status'
            ? `http_status:${priceErr.status}`
            : priceErr.kind
          : 'network';
      return {
        token: {
          status: tokenMeta.status,
          bytes: tokenMeta.bytes,
          ms: tokenMeta.ms,
        },
        prices: {
          status: priceErr instanceof TicketClientError ? (priceErr.status ?? 0) : 0,
          bytes: 0,
          ms: Date.now() - pricesStart,
          wafMarker: isWaf,
          startDateSent: today,
          retried: false,
        },
        maxPricingCalendarDate: null,
        adultMk1DayPriceCents: null,
        failure: {
          call: 'prices',
          code,
          message: priceErr instanceof Error ? priceErr.message : String(priceErr),
        },
      };
    }

    const body =
      typeof pRes.body === 'object' && pRes.body !== null ? (pRes.body as PricingBody) : null;
    const maxPricingCalendarDate =
      typeof body?.maxPricingCalendarDate === 'string' ? body.maxPricingCalendarDate : null;

    // Extract adult 1-day MK price
    let adultMk1DayPriceCents: number | null = null;
    const pricingCalendar = Array.isArray(body?.pricingCalendar)
      ? (body.pricingCalendar as PricingCalendarEntry[])
      : [];
    const oneDayEntry = pricingCalendar.find((e) => String(e?.numDays) === '1');
    const dates = Array.isArray(oneDayEntry?.dates) ? (oneDayEntry.dates as DateEntry[]) : [];
    const dateEntry = dates.find((d) => d?.date === pRes.startDateSent);
    const pricingList = Array.isArray(dateEntry?.pricing)
      ? (dateEntry.pricing as PricingItem[])
      : [];
    const mkAdultItem = pricingList.find(
      (item) =>
        item?.id === 'theme-park_1_A_0_0_RF_AF_SOF_progenstr_mk' ||
        (typeof item?.id === 'string' &&
          item.id.includes('theme-park_1_A_0_0_RF_AF_SOF_progenstr_mk')),
    );

    if (mkAdultItem && typeof mkAdultItem.subtotal === 'string') {
      try {
        adultMk1DayPriceCents = dollarsStringToCents(mkAdultItem.subtotal);
      } catch {
        adultMk1DayPriceCents = null;
      }
    }

    return {
      token: {
        status: tokenMeta.status,
        bytes: tokenMeta.bytes,
        ms: tokenMeta.ms,
      },
      prices: {
        status: pRes.status,
        bytes: pRes.bytes,
        ms: pRes.ms,
        wafMarker: false,
        startDateSent: pRes.startDateSent,
        retried: pRes.startDateSent !== today,
      },
      maxPricingCalendarDate,
      adultMk1DayPriceCents,
    };
  } finally {
    await repo.releaseControl('diagnose_complete', wafEncountered ? 'waf_block' : null);
  }
}
