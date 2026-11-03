/**
 * Lightning Lane read repository for trip budgeting (Requirement 15.7, 15.8, 20.6).
 *
 * Implements readBook(keys) in exactly two SQL statements:
 * 1. Stored rows matching the requested keys from park_schedule_signals and lightning_lane_single_prices.
 * 2. Historical price rows for typical price estimation (excluding today and future dates).
 */

import type { LlPriceRef } from '@dwt/shared';
import type { DbPool } from '../../db/pool.js';
import { wdwToday } from '../trips/wdwClock.js';
import type { LlBook, LlHistoryRow, StoredLlRow } from './types.js';

function toDateStr(d: unknown): string {
  if (d instanceof Date) {
    return d.toISOString().slice(0, 10);
  }
  return String(d).slice(0, 10);
}

export interface LightningLaneReadRepo {
  readBook(
    keys: readonly LlPriceRef[],
    today?: string,
    lookbackDays?: number,
  ): Promise<LlBook>;
}

export class LightningLaneRepo implements LightningLaneReadRepo {
  constructor(private readonly pool: DbPool) {}

  async readBook(
    keys: readonly LlPriceRef[],
    today?: string,
    lookbackDays: number = 400,
  ): Promise<LlBook> {
    const todayStr = today ?? wdwToday();
    const minDate = new Date(Date.parse(`${todayStr}T12:00:00.000Z`) - lookbackDays * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const parks = Array.from(new Set(keys.map((k) => k.park)));
    const dates = Array.from(new Set(keys.map((k) => k.date)));

    // Statement 1: Storable rows for the requested keys (requires captured_at IS NOT NULL)
    const storedSql = `
      SELECT
        'multi' AS pass_type,
        park,
        date,
        NULL::uuid AS experience_id,
        NULL::text AS purchase_id,
        ll_multipass_price_cents AS cents,
        ll_multipass_available AS available,
        ll_multipass_captured_at AS captured_at
      FROM park_schedule_signals
      WHERE park = ANY($1::text[])
        AND date = ANY($2::date[])
        AND ll_multipass_price_cents IS NOT NULL
        AND ll_multipass_captured_at IS NOT NULL
      UNION ALL
      SELECT
        'premier' AS pass_type,
        park,
        date,
        NULL::uuid AS experience_id,
        NULL::text AS purchase_id,
        ll_premier_price_cents AS cents,
        ll_premier_available AS available,
        ll_premier_captured_at AS captured_at
      FROM park_schedule_signals
      WHERE park = ANY($1::text[])
        AND date = ANY($2::date[])
        AND ll_premier_price_cents IS NOT NULL
        AND ll_premier_captured_at IS NOT NULL
      UNION ALL
      SELECT
        'single' AS pass_type,
        park,
        date,
        experience_id,
        purchase_id,
        price_cents AS cents,
        available,
        captured_at
      FROM lightning_lane_single_prices
      WHERE park = ANY($1::text[])
        AND date = ANY($2::date[])
        AND price_cents IS NOT NULL
        AND captured_at IS NOT NULL
    `;

    // Statement 2: Historical price rows (date < today AND date >= minDate, price IS NOT NULL, captured_at can be NULL for legacy)
    const historySql = `
      SELECT
        'multi' AS pass_type,
        park,
        date,
        NULL::uuid AS experience_id,
        ll_multipass_price_cents AS cents
      FROM park_schedule_signals
      WHERE park = ANY($1::text[])
        AND date < $2::date
        AND date >= $3::date
        AND ll_multipass_price_cents IS NOT NULL
      UNION ALL
      SELECT
        'premier' AS pass_type,
        park,
        date,
        NULL::uuid AS experience_id,
        ll_premier_price_cents AS cents
      FROM park_schedule_signals
      WHERE park = ANY($1::text[])
        AND date < $2::date
        AND date >= $3::date
        AND ll_premier_price_cents IS NOT NULL
      UNION ALL
      SELECT
        'single' AS pass_type,
        park,
        date,
        experience_id,
        price_cents AS cents
      FROM lightning_lane_single_prices
      WHERE park = ANY($1::text[])
        AND date < $2::date
        AND date >= $3::date
        AND price_cents IS NOT NULL
    `;

    const [storedRes, historyRes] = await Promise.all([
      this.pool.query(storedSql, [parks, dates]),
      this.pool.query(historySql, [parks, todayStr, minDate]),
    ]);

    const stored: StoredLlRow[] = [];
    for (const row of storedRes.rows) {
      const rowDate = toDateStr(row.date);
      const isRequested = keys.some((k) => {
        if (k.passType !== row.pass_type || k.park !== row.park || k.date !== rowDate) {
          return false;
        }
        if (k.passType === 'single' && k.experienceId && row.experience_id) {
          return k.experienceId === row.experience_id;
        }
        return true;
      });

      if (isRequested) {
        stored.push({
          passType: row.pass_type as 'multi' | 'premier' | 'single',
          park: row.park,
          date: rowDate,
          experienceId: row.experience_id ?? null,
          purchaseId: row.purchase_id ?? null,
          cents: Number(row.cents),
          available: row.available === null ? null : Boolean(row.available),
          capturedAt: new Date(row.captured_at),
        });
      }
    }

    const history = new Map<string, LlHistoryRow[]>();
    for (const row of historyRes.rows) {
      const rowDate = toDateStr(row.date);
      const key = `${row.pass_type}|${row.park}|${row.experience_id ?? ''}`;
      const list = history.get(key) ?? [];
      list.push({
        date: rowDate,
        cents: Number(row.cents),
      });
      history.set(key, list);
    }

    for (const list of history.values()) {
      list.sort((a, b) => a.date.localeCompare(b.date));
    }

    return {
      stored,
      history,
    };
  }
}

export function createLightningLaneRepo(pool: DbPool): LightningLaneReadRepo {
  return new LightningLaneRepo(pool);
}

export const createLightningLaneReadRepo = createLightningLaneRepo;
