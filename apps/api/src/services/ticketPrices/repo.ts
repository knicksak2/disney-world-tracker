/**
 * Ticket prices repository for PostgreSQL persistence.
 *
 * Implements:
 * - readBook(keys): Loads cached ticket price rows, set metadata, and control row.
 * - claimControl(mode, bypassCooldown, claimTimeoutMinutes, intervalHours): Atomic multi-instance claim.
 * - upgradeClaimToFull(attemptIntervalHours): Conditional claim upgrade on moved horizon.
 * - releaseControl(status, errorCode): Releases in-progress claim.
 * - recordProbe(now, horizon): Records probe timestamp and observed horizon date.
 * - block(until, reason): Authoritative circuit breaker block.
 * - upsertRows(rows): Non-destructive batch upsert using deduplication and unnest.
 * - reconcileSet(discountGroup, numDays, startDateSent, endDate, fetchedKeys): Reconciles missing rows inside fetch window.
 * - pruneBeforeToday(today): Prunes rows before today.
 * - updateSet(discountGroup, numDays, asOf, horizonDate, rowCount, windowDays): Advances set metadata and clears last_error.
 * - recordSetError(discountGroup, numDays, errorCode): Records normalized error code without touching as_of.
 * - readBlockedUntil(): Fast single-row read of current control block.
 *
 * Validates: Requirements 11.6, 11.7, 11.8, 11.14, 12.3, 12.4, 14.3, 14.4, 19.3, 20.6
 */

import type { Pool, PoolClient } from 'pg';
import { normalizeErrorCode } from './errorCodes.js';
import type {
  TicketPriceKey,
  TicketPriceRow,
  TicketPriceSetMeta,
} from './types.js';

export interface TicketControlRow {
  readonly id: number;
  readonly lastAttemptAt: Date | null;
  readonly lastProbeAt: Date | null;
  readonly blockedUntil: Date | null;
  readonly inProgressSince: Date | null;
  readonly observedHorizonDate: string | null;
  readonly lastDiagnoseAt: Date | null;
  readonly lastStatus: string | null;
  readonly lastError: string | null;
  readonly updatedAt: Date;
}

export interface TicketPriceBook {
  readonly rows: readonly TicketPriceRow[];
  readonly sets: readonly TicketPriceSetMeta[];
  readonly control: TicketControlRow | null;
}

export interface StorableTicketPriceRow {
  readonly discountGroup: 'std-gst' | 'fl-resident';
  readonly numDays: number;
  readonly ageGroup: 'adult' | 'child';
  readonly optionCode: 'base' | 'park_hopper' | 'park_hopper_plus' | 'water_parks_sports';
  readonly park: 'any' | 'mk' | 'ep' | 'hs' | 'ak';
  readonly startDate: string;
  readonly priceCents: number;
  readonly taxCents: number;
  readonly validEndDate: string;
  readonly productId: string;
}

/**
 * Pure deduplication of ticket rows by primary key.
 * (Property 12 pure half).
 */
export function dedupeByKey<T extends {
  discountGroup: string;
  numDays: number;
  ageGroup: string;
  optionCode: string;
  park: string;
  startDate: string;
}>(rows: readonly T[]): T[] {
  const map = new Map<string, T>();
  for (const row of rows) {
    const key = `${row.discountGroup}|${row.numDays}|${row.ageGroup}|${row.optionCode}|${row.park}|${row.startDate}`;
    map.set(key, row);
  }
  return Array.from(map.values());
}

export interface TicketPricesRepo {
  readBook(keys: readonly TicketPriceKey[], today: string): Promise<TicketPriceBook>;
  claimControl(
    mode: 'full' | 'probe_only' | 'diagnose',
    bypassCooldown: boolean,
    claimTimeoutMinutes: number,
    intervalHours: number,
  ): Promise<boolean>;
  upgradeClaimToFull(attemptIntervalHours: number): Promise<boolean>;
  releaseControl(status: string, errorCode?: string | null): Promise<void>;
  recordProbe(now: Date, horizon: string): Promise<void>;
  block(until: Date, reason: string): Promise<void>;
  upsertRows(rows: readonly StorableTicketPriceRow[]): Promise<number>;
  reconcileSet(
    discountGroup: string,
    numDays: number,
    startDateSent: string,
    endDate: string,
    fetchedKeys: readonly {
      readonly ageGroup: string;
      readonly optionCode: string;
      readonly park: string;
      readonly startDate: string;
    }[],
  ): Promise<number>;
  pruneBeforeToday(today: string): Promise<number>;
  updateSet(
    discountGroup: string,
    numDays: number,
    asOf: Date,
    horizonDate: string,
    rowCount: number,
    windowDays: number,
  ): Promise<void>;
  recordSetError(discountGroup: string, numDays: number, errorCode: string): Promise<void>;
  readBlockedUntil(): Promise<Date | null>;
}

function toDateStr(val: unknown): string | null {
  if (val == null) return null;
  if (typeof val === 'string') return val.split('T')[0]!;
  if (val instanceof Date) return val.toISOString().split('T')[0]!;
  return String(val).split('T')[0]!;
}

export function createTicketPricesRepo(db: Pool | PoolClient): TicketPricesRepo {
  return {
    async readBook(keys: readonly TicketPriceKey[], today: string): Promise<TicketPriceBook> {
      // 1. Read control row
      const controlRes = await db.query(
        `SELECT id, last_attempt_at, last_probe_at, blocked_until, in_progress_since,
                observed_horizon_date, last_diagnose_at, last_status, last_error, updated_at
           FROM ticket_price_control
          WHERE id = 1`,
      );
      const cRow = controlRes.rows[0];
      const control: TicketControlRow | null = cRow
        ? {
            id: cRow.id,
            lastAttemptAt: cRow.last_attempt_at ? new Date(cRow.last_attempt_at) : null,
            lastProbeAt: cRow.last_probe_at ? new Date(cRow.last_probe_at) : null,
            blockedUntil: cRow.blocked_until ? new Date(cRow.blocked_until) : null,
            inProgressSince: cRow.in_progress_since ? new Date(cRow.in_progress_since) : null,
            observedHorizonDate: toDateStr(cRow.observed_horizon_date),
            lastDiagnoseAt: cRow.last_diagnose_at ? new Date(cRow.last_diagnose_at) : null,
            lastStatus: cRow.last_status ?? null,
            lastError: cRow.last_error ?? null,
            updatedAt: new Date(cRow.updated_at),
          }
        : null;

      // 2. Read sets
      const setsRes = await db.query(
        `SELECT discount_group, num_days, as_of, horizon_date, row_count, window_days,
                last_attempt_at, last_error, blocked_until
           FROM ticket_price_sets`,
      );
      const sets: TicketPriceSetMeta[] = setsRes.rows.map((s) => ({
        discountGroup: s.discount_group,
        numDays: s.num_days,
        asOf: s.as_of ? new Date(s.as_of) : null,
        horizonDate: toDateStr(s.horizon_date),
        rowCount: Number(s.row_count ?? 0),
        windowDays: Number(s.window_days ?? 0),
        lastAttemptAt: s.last_attempt_at ? new Date(s.last_attempt_at) : null,
        lastError: s.last_error ?? null,
      }));

      // 3. Read ticket rows for distinct (group, numDays, ageGroup, optionCode)
      if (keys.length === 0) {
        return { rows: [], sets, control };
      }

      // Collect distinct tuples
      interface DistinctTuple {
        readonly discountGroup: string;
        readonly numDays: number;
        readonly ageGroup: string;
        readonly optionCode: string;
      }
      const tupleMap = new Map<string, DistinctTuple>();
      const parkSet = new Set<string>();
      let hasUnparked = false;

      for (const k of keys) {
        const tupleKey = `${k.discountGroup}|${k.numDays}|${k.ageGroup}|${k.optionCode}`;
        if (!tupleMap.has(tupleKey)) {
          tupleMap.set(tupleKey, {
            discountGroup: k.discountGroup,
            numDays: k.numDays,
            ageGroup: k.ageGroup,
            optionCode: k.optionCode,
          });
        }
        if (k.numDays === 1 && k.optionCode === 'base') {
          if (!k.park || k.park === 'any') {
            hasUnparked = true;
          } else {
            parkSet.add(k.park);
          }
        }
      }

      const tuples = Array.from(tupleMap.values());
      const parkCodes = hasUnparked || parkSet.size === 0 ? ['mk', 'ep', 'hs', 'ak'] : Array.from(parkSet);

      // Build OR-of-ANDs condition (portable to pg-mem and real PostgreSQL)
      const conds: string[] = [];
      const params: unknown[] = [today, parkCodes];
      let pIdx = 3;

      for (const t of tuples) {
        conds.push(
          `(discount_group = $${pIdx} AND num_days = $${pIdx + 1} AND age_group = $${pIdx + 2} AND option_code = $${pIdx + 3})`,
        );
        params.push(t.discountGroup, t.numDays, t.ageGroup, t.optionCode);
        pIdx += 4;
      }

      const tupleClause = conds.length > 0 ? `AND (${conds.join(' OR ')})` : '';

      const query = `
        SELECT discount_group, num_days, age_group, option_code, park, start_date,
               price_cents, tax_cents, valid_end_date, product_id, changed_at
          FROM ticket_prices
         WHERE start_date >= $1::date
           ${tupleClause}
           AND (option_code <> 'base' OR num_days <> 1 OR park = ANY($2::text[]))
      `;

      const rowsRes = await db.query(query, params);

      // In-memory upper bound filtering: start_date <= horizonDate of that key's set
      const rows: TicketPriceRow[] = [];
      for (const r of rowsRes.rows) {
        const startDateStr = toDateStr(r.start_date)!;
        const set = sets.find((s) => s.discountGroup === r.discount_group && s.numDays === r.num_days);
        if (!set || set.horizonDate === null) {
          continue; // Key with no set row or no horizonDate loads nothing
        }
        if (startDateStr > set.horizonDate) {
          continue;
        }
        rows.push({
          discountGroup: r.discount_group,
          numDays: r.num_days,
          ageGroup: r.age_group,
          optionCode: r.option_code,
          park: r.park,
          startDate: startDateStr,
          priceCents: Number(r.price_cents),
          taxCents: Number(r.tax_cents),
          validEndDate: toDateStr(r.valid_end_date) ?? startDateStr,
          productId: r.product_id ?? '',
          changedAt: r.changed_at ? new Date(r.changed_at) : new Date(),
        });
      }

      return { rows, sets, control };
    },

    async claimControl(
      mode: 'full' | 'probe_only' | 'diagnose',
      bypassCooldown: boolean,
      claimTimeoutMinutes: number,
      intervalHours: number,
    ): Promise<boolean> {
      let query: string;
      let params: unknown[];

      if (mode === 'full') {
        query = `
          UPDATE ticket_price_control c
             SET in_progress_since = now(), last_attempt_at = now(), updated_at = now()
           WHERE c.id = 1
             AND (c.in_progress_since IS NULL OR c.in_progress_since < now() - make_interval(mins => $2))
             AND (c.blocked_until IS NULL OR c.blocked_until <= now())
             AND ($1::boolean OR c.last_attempt_at IS NULL OR c.last_attempt_at <= now() - make_interval(hours => $3))
          RETURNING c.id;
        `;
        params = [bypassCooldown, claimTimeoutMinutes, intervalHours];
      } else if (mode === 'probe_only') {
        query = `
          UPDATE ticket_price_control
             SET in_progress_since = now(), last_probe_at = now(), updated_at = now()
           WHERE id = 1
             AND (in_progress_since IS NULL OR in_progress_since < now() - make_interval(mins => $1))
             AND (blocked_until IS NULL OR blocked_until <= now())
             AND (last_probe_at IS NULL OR last_probe_at <= now() - make_interval(hours => $2))
          RETURNING id;
        `;
        params = [claimTimeoutMinutes, intervalHours];
      } else {
        // diagnose
        query = `
          UPDATE ticket_price_control
             SET in_progress_since = now(), last_diagnose_at = now(), updated_at = now()
           WHERE id = 1
             AND (in_progress_since IS NULL OR in_progress_since < now() - make_interval(mins => $1))
             AND (blocked_until IS NULL OR blocked_until <= now())
             AND (last_diagnose_at IS NULL OR last_diagnose_at <= now() - make_interval(secs => $2))
          RETURNING id;
        `;
        params = [claimTimeoutMinutes, intervalHours];
      }

      const res = await db.query(query, params);
      return (res.rowCount ?? 0) > 0;
    },

    async upgradeClaimToFull(attemptIntervalHours: number): Promise<boolean> {
      const query = `
        UPDATE ticket_price_control
           SET last_attempt_at = now(), updated_at = now()
         WHERE id = 1 AND in_progress_since IS NOT NULL
           AND (last_attempt_at IS NULL OR last_attempt_at <= now() - make_interval(hours => $1))
        RETURNING id;
      `;
      const res = await db.query(query, [attemptIntervalHours]);
      return (res.rowCount ?? 0) > 0;
    },

    async releaseControl(status: string, errorCode?: string | null): Promise<void> {
      const normalizedErr = errorCode ? normalizeErrorCode(errorCode) : null;
      await db.query(
        `UPDATE ticket_price_control
            SET in_progress_since = NULL,
                last_status = $1,
                last_error = CASE
                  WHEN $2::text IS NOT NULL THEN $2::text
                  WHEN $1 = 'blocked' OR (blocked_until IS NOT NULL AND blocked_until > now()) THEN last_error
                  ELSE NULL
                END,
                updated_at = now()
          WHERE id = 1`,
        [status, normalizedErr],
      );
    },

    async recordProbe(now: Date, horizon: string): Promise<void> {
      await db.query(
        `UPDATE ticket_price_control
            SET last_probe_at = $1, observed_horizon_date = $2, updated_at = now()
          WHERE id = 1`,
        [now, horizon],
      );
    },

    async block(until: Date, reason: string): Promise<void> {
      const normReason = normalizeErrorCode(reason);
      await db.query(
        `UPDATE ticket_price_control
            SET blocked_until = $1, last_error = $2, updated_at = now()
          WHERE id = 1`,
        [until, normReason],
      );
      await db.query(
        `UPDATE ticket_price_sets
            SET blocked_until = $1`,
        [until],
      );
    },

    async upsertRows(rows: readonly StorableTicketPriceRow[]): Promise<number> {
      if (rows.length === 0) return 0;
      const deduped = dedupeByKey(rows);

      // Chunk into batches of 2,000
      const CHUNK_SIZE = 2000;
      let totalUpserted = 0;

      for (let i = 0; i < deduped.length; i += CHUNK_SIZE) {
        const chunk = deduped.slice(i, i + CHUNK_SIZE);
        const discountGroups = chunk.map((r) => r.discountGroup);
        const numDays = chunk.map((r) => r.numDays);
        const ageGroups = chunk.map((r) => r.ageGroup);
        const optionCodes = chunk.map((r) => r.optionCode);
        const parks = chunk.map((r) => r.park);
        const startDates = chunk.map((r) => r.startDate);
        const prices = chunk.map((r) => r.priceCents);
        const taxes = chunk.map((r) => r.taxCents);
        const validEndDates = chunk.map((r) => r.validEndDate);
        const productIds = chunk.map((r) => r.productId);

        const query = `
          INSERT INTO ticket_prices (
            discount_group, num_days, age_group, option_code, park, start_date,
            price_cents, tax_cents, valid_end_date, product_id
          )
          SELECT * FROM unnest(
            $1::text[], $2::smallint[], $3::text[], $4::text[], $5::text[], $6::date[],
            $7::int[], $8::int[], $9::date[], $10::text[]
          )
          ON CONFLICT (discount_group, num_days, age_group, option_code, park, start_date) DO UPDATE SET
            price_cents = EXCLUDED.price_cents,
            tax_cents = EXCLUDED.tax_cents,
            valid_end_date = EXCLUDED.valid_end_date,
            product_id = EXCLUDED.product_id,
            changed_at = now()
          WHERE (ticket_prices.price_cents, ticket_prices.tax_cents, ticket_prices.valid_end_date)
                IS DISTINCT FROM (EXCLUDED.price_cents, EXCLUDED.tax_cents, EXCLUDED.valid_end_date);
        `;

        const res = await db.query(query, [
          discountGroups,
          numDays,
          ageGroups,
          optionCodes,
          parks,
          startDates,
          prices,
          taxes,
          validEndDates,
          productIds,
        ]);

        totalUpserted += res.rowCount ?? 0;
      }

      return totalUpserted;
    },

    async reconcileSet(
      discountGroup: string,
      numDays: number,
      startDateSent: string,
      endDate: string,
      fetchedKeys: readonly {
        readonly ageGroup: string;
        readonly optionCode: string;
        readonly park: string;
        readonly startDate: string;
      }[],
    ): Promise<number> {
      if (fetchedKeys.length === 0) {
        const res = await db.query(
          `DELETE FROM ticket_prices
            WHERE discount_group = $1
              AND num_days = $2
              AND start_date BETWEEN $3::date AND $4::date`,
          [discountGroup, numDays, startDateSent, endDate],
        );
        return res.rowCount ?? 0;
      }

      const ageGroups = fetchedKeys.map((k) => k.ageGroup);
      const optionCodes = fetchedKeys.map((k) => k.optionCode);
      const parks = fetchedKeys.map((k) => k.park);
      const startDates = fetchedKeys.map((k) => k.startDate);

      const query = `
        DELETE FROM ticket_prices
         WHERE discount_group = $1
           AND num_days = $2
           AND start_date BETWEEN $3::date AND $4::date
           AND NOT EXISTS (
             SELECT 1 FROM unnest($5::text[], $6::text[], $7::text[], $8::date[]) AS k(ag, oc, p, sd)
              WHERE k.ag = ticket_prices.age_group
                AND k.oc = ticket_prices.option_code
                AND k.p = ticket_prices.park
                AND k.sd = ticket_prices.start_date
           )
      `;

      const res = await db.query(query, [
        discountGroup,
        numDays,
        startDateSent,
        endDate,
        ageGroups,
        optionCodes,
        parks,
        startDates,
      ]);
      return res.rowCount ?? 0;
    },

    async pruneBeforeToday(today: string): Promise<number> {
      const res = await db.query('DELETE FROM ticket_prices WHERE start_date < $1::date', [today]);
      return res.rowCount ?? 0;
    },

    async updateSet(
      discountGroup: string,
      numDays: number,
      asOf: Date,
      horizonDate: string,
      rowCount: number,
      windowDays: number,
    ): Promise<void> {
      await db.query(
        `INSERT INTO ticket_price_sets (discount_group, num_days, as_of, horizon_date, row_count, window_days, last_error)
         VALUES ($1, $2, $3, $4::date, $5, $6, NULL)
         ON CONFLICT (discount_group, num_days) DO UPDATE SET
           as_of = EXCLUDED.as_of,
           horizon_date = EXCLUDED.horizon_date,
           row_count = EXCLUDED.row_count,
           window_days = EXCLUDED.window_days,
           last_error = NULL`,
        [discountGroup, numDays, asOf, horizonDate, rowCount, windowDays],
      );
    },

    async recordSetError(discountGroup: string, numDays: number, errorCode: string): Promise<void> {
      const normalized = normalizeErrorCode(errorCode);
      await db.query(
        `INSERT INTO ticket_price_sets (discount_group, num_days, last_error)
         VALUES ($1, $2, $3)
         ON CONFLICT (discount_group, num_days) DO UPDATE SET
           last_error = $3`,
        [discountGroup, numDays, normalized],
      );
    },

    async readBlockedUntil(): Promise<Date | null> {
      const res = await db.query(
        'SELECT blocked_until FROM ticket_price_control WHERE id = 1',
      );
      const val = res.rows[0]?.blocked_until;
      return val ? new Date(val) : null;
    },
  };
}
