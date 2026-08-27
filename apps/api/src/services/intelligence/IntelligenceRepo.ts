import type { Pool } from 'pg';
import { mergeShowtimeEntries } from './showtimePatterns.js';

/**
 * Collapses a batch to one row per conflict key, last write winning.
 *
 * Required before any `INSERT ... ON CONFLICT DO UPDATE`: Postgres refuses to
 * update the same row twice within one command and raises `21000`
 * ("ON CONFLICT DO UPDATE command cannot affect row a second time"). A
 * sampling pass can legitimately produce two entries for the same bucket, so
 * this is a correctness requirement, not a micro-optimization.
 */
function dedupeByKey<T>(rows: readonly T[], keyOf: (row: T) => string): T[] {
  const map = new Map<string, T>();
  for (const row of rows) {
    map.set(keyOf(row), row);
  }
  return Array.from(map.values());
}

/**
 * Renders a value destined for a `DATE` column as `YYYY-MM-DD`.
 *
 * Sending a `Date` straight through would serialize a full timestamp, and a
 * late-evening Eastern instant carries the FOLLOWING UTC date — so a forecast
 * captured for Tuesday would silently land on Wednesday's row. Callers pass ET
 * mid-day instants, so taking the ISO date component is correct and explicit.
 */
function toDateKey(value: Date | string): string {
  if (typeof value === 'string') return value.split('T')[0]!;
  return value.toISOString().split('T')[0]!;
}

export interface WaitForecastLogRow {
  experience_id: string;
  date: Date;
  hour: number;
  lead_days: number;
  predicted_wait_minutes: number;
  forecasted_at: Date;
  /** R18.5: a shadow model's prediction on identical inputs. Never served. */
  challenger_wait_minutes: number | null;
  observed_wait_minutes: number | null;
  error: number | null;
  challenger_error: number | null;
}

export interface WaitForecastAccuracyRow {
  experience_id: string;
  lead_days: number;
  mae: number;
  bias: number;
  sample_count: number;
  challenger_mae: number | null;
  challenger_bias: number | null;
  challenger_sample_count: number;
}

export interface RideShapeRow {
  experience_id: string;
  day_of_week: number;
  hour: number;
  avg_wait_minutes: number;
  sample_count: number;
  sr_avg_wait_minutes: number | null;
  sr_sample_count: number | null;
  stddev_wait: number;
  p50_wait: number;
  p90_wait: number;
  down_rate: number;
  /**
   * R14: slow-moving (~500-sample memory) expected wait that denominates the
   * Crowd_Index. `null` = not yet established. NEVER read by the wait
   * prediction tiers — those use the fast `avg_wait_minutes`.
   */
  baseline_wait_minutes: number | null;
  /** R14: sample count backing `baseline_wait_minutes`; gates basket eligibility. */
  baseline_sample_count: number;
}

export interface SeasonHourRow {
  experience_id: string;
  season: number;
  day_of_week: number;
  hour: number;
  avg_wait_minutes: number;
  sample_count: number;
  /**
   * R15: recency-weighted mean observed Crowd_Index of the samples that formed
   * this bucket. `null` = unknown, in which case the season tier falls back to
   * the unscaled direct average rather than asserting a level.
   */
  avg_crowd_index: number | null;
}

export interface ParkCrowdIndexRow {
  park: string;
  date: Date;
  crowd_index: number;
  daily_avg_wait: number;
  sample_count: number;
  source?: 'observed' | 'seed';
}

export interface ScheduleSignalRow {
  park: string;
  date: Date;
  open_time: Date | null;
  close_time: Date | null;
  early_entry: boolean;
  extended_evening: boolean;
  ticketed_event: boolean;
  ll_multipass_price_cents: number | null;
}

export interface ForecastLogRow {
  park: string;
  date: Date;
  lead_days: number;
  forecast_index: number;
  forecasted_at: Date;
  observed_index: number | null;
  error: number | null;
}

export interface ForecastAccuracyRow {
  park: string;
  lead_days: number;
  mae: number;
  bias: number;
  sample_count: number;
}

export interface ExperienceSignalRow {
  experience_id: string;
  has_single_rider: boolean;
  uses_virtual_queue: boolean;
  downtime_rate: number;
  ll_sellout_median_hour: number | null;
  sample_count: number;
}

export interface DailySignalRow {
  experience_id: string;
  date: Date;
  ll_price_cents: number | null;
  ll_available: boolean | null;
  used_virtual_queue: boolean | null;
  showtimes: any | null;
}

export interface ExperienceWeatherSensitivityRow {
  experience_id: string;
  condition: string;
  wait_multiplier: number;
  sample_count: number;
}

export interface ExperienceEventImpactRow {
  experience_id: string;
  event_type: string;
  wait_multiplier: number;
  sample_count: number;
}

export interface RideCascadeRow {
  down_experience_id: string;
  affected_experience_id: string;
  wait_delta: number;
  wait_pct_delta: number;
  baseline_wait: number;
  sample_count: number;
}

export interface WaitSampleRow {
  experience_id: string;
  observed_at: Date;
  wait_minutes: number;
  status: string;
}

export interface ShowTimePatternRow {
  experience_id: string;
  day_of_week: number;
  start_minutes: number;
  frequency: number;
  sample_count: number;
}

export interface DerivedStatRunRow {
  leg: string;
  last_success_at: Date | null;
  last_error_at: Date | null;
  last_error: string | null;
  consecutive_failures: number;
}

export class IntelligenceRepo {
  constructor(private pool: Pool) {}

  async getRideShapes(experienceIds: string[]): Promise<RideShapeRow[]> {
    if (experienceIds.length === 0) return [];
    const res = await this.pool.query(
      `SELECT * FROM ride_shapes WHERE experience_id = ANY($1::uuid[])`,
      [experienceIds]
    );
    return res.rows;
  }

  async upsertRideShapes(shapes: RideShapeRow[]): Promise<void> {
    if (shapes.length === 0) return;
    
    // Using unnest for bulk upsert
    const query = `
      INSERT INTO ride_shapes (
        experience_id, day_of_week, hour, avg_wait_minutes, sample_count,
        sr_avg_wait_minutes, sr_sample_count, stddev_wait, p50_wait, p90_wait, down_rate,
        baseline_wait_minutes, baseline_sample_count
      )
      SELECT * FROM unnest(
        $1::uuid[], $2::int[], $3::int[], $4::real[], $5::int[],
        $6::real[], $7::int[], $8::real[], $9::real[], $10::real[], $11::real[],
        $12::real[], $13::int[]
      ) AS t(
        experience_id, day_of_week, hour, avg_wait_minutes, sample_count,
        sr_avg_wait_minutes, sr_sample_count, stddev_wait, p50_wait, p90_wait, down_rate,
        baseline_wait_minutes, baseline_sample_count
      )
      ON CONFLICT (experience_id, day_of_week, hour) DO UPDATE SET
        avg_wait_minutes = EXCLUDED.avg_wait_minutes,
        sample_count = EXCLUDED.sample_count,
        sr_avg_wait_minutes = EXCLUDED.sr_avg_wait_minutes,
        sr_sample_count = EXCLUDED.sr_sample_count,
        stddev_wait = EXCLUDED.stddev_wait,
        p50_wait = EXCLUDED.p50_wait,
        p90_wait = EXCLUDED.p90_wait,
        down_rate = EXCLUDED.down_rate,
        baseline_wait_minutes = EXCLUDED.baseline_wait_minutes,
        baseline_sample_count = EXCLUDED.baseline_sample_count
    `;

    // Postgres refuses to update the same row twice in one command (21000), so
    // the batch must be deduped by its conflict key first. Last write wins.
    const deduped = dedupeByKey(shapes, s => `${s.experience_id}|${s.day_of_week}|${s.hour}`);

    const e = deduped.map(s => s.experience_id);
    const d = deduped.map(s => s.day_of_week);
    const h = deduped.map(s => s.hour);
    const a = deduped.map(s => s.avg_wait_minutes);
    const c = deduped.map(s => s.sample_count);
    const sra = deduped.map(s => s.sr_avg_wait_minutes);
    const src = deduped.map(s => s.sr_sample_count);
    const std = deduped.map(s => s.stddev_wait);
    const p50 = deduped.map(s => s.p50_wait);
    const p90 = deduped.map(s => s.p90_wait);
    const dr = deduped.map(s => s.down_rate);
    const bw = deduped.map(s => s.baseline_wait_minutes ?? null);
    const bc = deduped.map(s => s.baseline_sample_count ?? 0);

    await this.pool.query(query, [e, d, h, a, c, sra, src, std, p50, p90, dr, bw, bc]);
  }

  // Same pattern for season hours...
  async getSeasonHours(experienceIds: string[]): Promise<SeasonHourRow[]> {
    if (experienceIds.length === 0) return [];
    const res = await this.pool.query(
      `SELECT * FROM experience_season_hour WHERE experience_id = ANY($1::uuid[])`,
      [experienceIds]
    );
    return res.rows;
  }

  async upsertSeasonHours(hours: SeasonHourRow[]): Promise<void> {
    if (hours.length === 0) return;
    const query = `
      INSERT INTO experience_season_hour (
        experience_id, season, day_of_week, hour, avg_wait_minutes, sample_count, avg_crowd_index
      )
      SELECT * FROM unnest(
        $1::uuid[], $2::int[], $3::int[], $4::int[], $5::real[], $6::int[], $7::real[]
      ) AS t(experience_id, season, day_of_week, hour, avg_wait_minutes, sample_count, avg_crowd_index)
      ON CONFLICT (experience_id, season, day_of_week, hour) DO UPDATE SET
        avg_wait_minutes = EXCLUDED.avg_wait_minutes,
        sample_count = EXCLUDED.sample_count,
        avg_crowd_index = EXCLUDED.avg_crowd_index
    `;
    // Dedupe by conflict key before the query (Postgres 21000).
    const deduped = dedupeByKey(
      hours,
      h => `${h.experience_id}|${h.season}|${h.day_of_week}|${h.hour}`,
    );
    await this.pool.query(query, [
      deduped.map(h => h.experience_id),
      deduped.map(h => h.season),
      deduped.map(h => h.day_of_week),
      deduped.map(h => h.hour),
      deduped.map(h => h.avg_wait_minutes),
      deduped.map(h => h.sample_count),
      deduped.map(h => h.avg_crowd_index ?? null),
    ]);
  }

  async getParkCrowdIndices(park: string, dates: Date[]): Promise<ParkCrowdIndexRow[]> {
    if (dates.length === 0) return [];
    const dateStrings = dates.map(d => d.toISOString().split('T')[0]!);
    const res = await this.pool.query(
      `SELECT * FROM park_crowd_index WHERE park = $1 AND date = ANY($2::date[])`,
      [park, dateStrings]
    );
    return res.rows;
  }

  async getComparableCrowdIndices(park: string, targetDate: Date, _windowDays: number = 7): Promise<{ date: Date; crowd_index: number }[]> {
    // Fetch all park_crowd_index rows for this park, then let the caller's
    // pure selectComparableIndices do the day-of-year windowing.
    // SQL pre-filters to rows whose month is within plausible range of the target
    // (±1 month to cover the window at month boundaries), keeping the scan bounded.
    const targetMonth = targetDate.getMonth() + 1; // 1-12
    const monthLow = targetMonth === 1 ? 12 : targetMonth - 1;
    const monthHigh = targetMonth === 12 ? 1 : targetMonth + 1;

    let monthFilter: string;
    if (monthLow > monthHigh) {
      // Wraps around Dec/Jan: month IN (12, 1, 2) for a Jan target, etc.
      monthFilter = `EXTRACT(MONTH FROM date) IN (${monthLow}, ${targetMonth}, ${monthHigh})`;
    } else {
      monthFilter = `EXTRACT(MONTH FROM date) BETWEEN ${monthLow} AND ${monthHigh}`;
    }

    const res = await this.pool.query(
      `SELECT date, crowd_index FROM park_crowd_index
       WHERE park = $1
       AND ${monthFilter}`,
      [park]
    );
    return res.rows.map((r: any) => ({ date: new Date(r.date), crowd_index: r.crowd_index }));
  }


  async upsertParkCrowdIndices(indices: ParkCrowdIndexRow[]): Promise<void> {
    if (indices.length === 0) return;
    const query = `
      INSERT INTO park_crowd_index (
        park, date, crowd_index, daily_avg_wait, sample_count, source
      )
      SELECT * FROM unnest(
        $1::text[], $2::date[], $3::real[], $4::real[], $5::int[], $6::text[]
      ) AS t(park, date, crowd_index, daily_avg_wait, sample_count, source)
      ON CONFLICT (park, date) DO UPDATE SET
        crowd_index = CASE WHEN park_crowd_index.source = 'observed' AND EXCLUDED.source = 'seed' THEN park_crowd_index.crowd_index ELSE EXCLUDED.crowd_index END,
        daily_avg_wait = CASE WHEN park_crowd_index.source = 'observed' AND EXCLUDED.source = 'seed' THEN park_crowd_index.daily_avg_wait ELSE EXCLUDED.daily_avg_wait END,
        sample_count = CASE WHEN park_crowd_index.source = 'observed' AND EXCLUDED.source = 'seed' THEN park_crowd_index.sample_count ELSE EXCLUDED.sample_count END,
        source = CASE WHEN park_crowd_index.source = 'observed' AND EXCLUDED.source = 'seed' THEN park_crowd_index.source ELSE EXCLUDED.source END
    `;
    await this.pool.query(query, [
      indices.map(i => i.park),
      indices.map(i => i.date),
      indices.map(i => i.crowd_index),
      indices.map(i => i.daily_avg_wait),
      indices.map(i => i.sample_count),
      indices.map(i => i.source || 'observed'),
    ]);
  }

  async upsertParkScheduleSignals(signals: ScheduleSignalRow[]): Promise<void> {
    if (signals.length === 0) return;
    const query = `
      INSERT INTO park_schedule_signals (
        park, date, open_time, close_time, early_entry, extended_evening, ticketed_event, ll_multipass_price_cents
      )
      SELECT * FROM unnest(
        $1::text[], $2::date[], $3::timestamptz[], $4::timestamptz[], $5::boolean[], $6::boolean[], $7::boolean[], $8::int[]
      ) AS t(park, date, open_time, close_time, early_entry, extended_evening, ticketed_event, ll_multipass_price_cents)
      ON CONFLICT (park, date) DO UPDATE SET
        open_time = EXCLUDED.open_time,
        close_time = EXCLUDED.close_time,
        early_entry = EXCLUDED.early_entry,
        extended_evening = EXCLUDED.extended_evening,
        ticketed_event = EXCLUDED.ticketed_event,
        ll_multipass_price_cents = EXCLUDED.ll_multipass_price_cents
    `;
    await this.pool.query(query, [
      signals.map(s => s.park),
      signals.map(s => s.date),
      signals.map(s => s.open_time),
      signals.map(s => s.close_time),
      signals.map(s => s.early_entry),
      signals.map(s => s.extended_evening),
      signals.map(s => s.ticketed_event),
      signals.map(s => s.ll_multipass_price_cents),
    ]);
  }

  async getParkScheduleSignals(park: string, fromDate: Date, toDate: Date): Promise<ScheduleSignalRow[]> {
    const fromStr = fromDate.toISOString().split('T')[0]!;
    const toStr = toDate.toISOString().split('T')[0]!;
    const res = await this.pool.query(
      `SELECT * FROM park_schedule_signals WHERE park = $1 AND date >= $2 AND date <= $3`,
      [park, fromStr, toStr]
    );
    return res.rows;
  }

  async insertWaitSamples(samples: WaitSampleRow[]): Promise<void> {
    if (samples.length === 0) return;
    const query = `
      INSERT INTO wait_samples (
        experience_id, observed_at, wait_minutes, status
      )
      SELECT * FROM unnest(
        $1::uuid[], $2::timestamptz[], $3::real[], $4::text[]
      ) AS t(experience_id, observed_at, wait_minutes, status)
      ON CONFLICT (experience_id, observed_at) DO NOTHING
    `;
    await this.pool.query(query, [
      samples.map(s => s.experience_id),
      samples.map(s => s.observed_at),
      samples.map(s => s.wait_minutes),
      samples.map(s => s.status),
    ]);
  }

  async pruneWaitSamples(before: Date): Promise<void> {
    await this.pool.query(`DELETE FROM wait_samples WHERE observed_at < $1`, [before]);
  }

  /**
   * R17: fold raw `wait_samples` into the bounded `wait_archive` aggregate, one
   * row per `(experience_id, ET date, ET hour)`.
   *
   * Runs entirely server-side as a single statement — the whole point is to
   * avoid streaming ~176k rows into Node to average them. `GROUP BY` guarantees
   * one row per conflict key, so no client-side dedupe is needed here (unlike the
   * batch upserts, which can legitimately carry duplicates).
   *
   * Idempotent: re-running over the same window recomputes each aggregate from
   * the raw rows and overwrites, so a day can be archived repeatedly without
   * double-counting. Days whose raw samples have already been pruned simply
   * produce no rows and their existing archive entries are left untouched
   * (R17.6) — the `WHERE observed_at >= $1` window can only ever narrow what is
   * recomputed, never delete.
   *
   * Bucketing is by **Eastern** calendar date and hour, matching `ride_shapes`;
   * a UTC bucketing would split a park evening across two dates. This is why the
   * query needs `AT TIME ZONE`, and therefore why it cannot be covered by the
   * pg-mem suites.
   *
   * Returns the number of archive rows written.
   */
  async archiveWaitSamples(since: Date): Promise<number> {
    const res = await this.pool.query(
      `INSERT INTO wait_archive (
         experience_id, date, hour, avg_wait_minutes, sample_count, min_wait_minutes, max_wait_minutes
       )
       SELECT
         ws.experience_id,
         (ws.observed_at AT TIME ZONE 'America/New_York')::date            AS date,
         EXTRACT(HOUR FROM ws.observed_at AT TIME ZONE 'America/New_York')::int AS hour,
         AVG(ws.wait_minutes)::real                                        AS avg_wait_minutes,
         COUNT(*)::int                                                     AS sample_count,
         MIN(ws.wait_minutes)::real                                        AS min_wait_minutes,
         MAX(ws.wait_minutes)::real                                        AS max_wait_minutes
       FROM wait_samples ws
       WHERE ws.observed_at >= $1
         AND ws.status = 'OPERATING'
       GROUP BY ws.experience_id, 2, 3
       ON CONFLICT (experience_id, date, hour) DO UPDATE SET
         avg_wait_minutes = EXCLUDED.avg_wait_minutes,
         sample_count     = EXCLUDED.sample_count,
         min_wait_minutes = EXCLUDED.min_wait_minutes,
         max_wait_minutes = EXCLUDED.max_wait_minutes`,
      [since],
    );
    return res.rowCount ?? 0;
  }

  /** R17.4: bounded retention for the archive. */
  async pruneWaitArchive(before: Date): Promise<void> {
    await this.pool.query(`DELETE FROM wait_archive WHERE date < $1`, [before]);
  }

  // -------------------------------------------------------------------------
  // R18: wait prediction accuracy logging + shadow evaluation
  // -------------------------------------------------------------------------

  /**
   * R18.2: the Experiences whose wait accuracy is worth measuring, ranked by
   * their frozen Ride_Baseline.
   *
   * Ranked by baseline rather than by the fast shape deliberately: the fast
   * shape moves with recent conditions, so ranking on it would quietly change
   * *which* rides are tracked from week to week and make the accuracy series
   * incomparable over time. The baseline is frozen, so the tracked set is stable.
   */
  async getTopExperiencesByBaseline(
    limit: number,
  ): Promise<Array<{ experience_id: string; park: string; peak_baseline: number }>> {
    const res = await this.pool.query(
      `SELECT rs.experience_id, e.park, MAX(rs.baseline_wait_minutes)::real AS peak_baseline
       FROM ride_shapes rs
       JOIN experiences e ON e.id = rs.experience_id
       WHERE rs.baseline_wait_minutes IS NOT NULL
         AND e.park IS NOT NULL
       GROUP BY rs.experience_id, e.park
       ORDER BY peak_baseline DESC
       LIMIT $1`,
      [limit],
    );
    return res.rows;
  }

  /**
   * Freezes wait predictions (R18.1).
   *
   * `predicted_wait_minutes` and `forecasted_at` are deliberately absent from the
   * ON CONFLICT UPDATE clause: accuracy must be measured against the forecast as
   * issued, so a re-run on the same day must NOT overwrite an earlier capture
   * with a fresher number. Only the challenger column is updatable, and only
   * when a challenger value is actually supplied — `COALESCE` keeps an existing
   * challenger rather than nulling it out (R18.5).
   */
  async upsertWaitForecastLogs(rows: WaitForecastLogRow[]): Promise<void> {
    if (rows.length === 0) return;
    const deduped = dedupeByKey(
      rows,
      r => `${r.experience_id}|${toDateKey(r.date)}|${r.hour}|${r.lead_days}`,
    );
    await this.pool.query(
      `INSERT INTO wait_forecast_log (
         experience_id, date, hour, lead_days, predicted_wait_minutes, forecasted_at, challenger_wait_minutes
       )
       SELECT * FROM unnest(
         $1::uuid[], $2::date[], $3::int[], $4::int[], $5::real[], $6::timestamptz[], $7::real[]
       ) AS t(experience_id, date, hour, lead_days, predicted_wait_minutes, forecasted_at, challenger_wait_minutes)
       ON CONFLICT (experience_id, date, hour, lead_days) DO UPDATE SET
         challenger_wait_minutes =
           COALESCE(EXCLUDED.challenger_wait_minutes, wait_forecast_log.challenger_wait_minutes)`,
      [
        deduped.map(r => r.experience_id),
        deduped.map(r => toDateKey(r.date)),
        deduped.map(r => r.hour),
        deduped.map(r => r.lead_days),
        deduped.map(r => r.predicted_wait_minutes),
        deduped.map(r => r.forecasted_at),
        deduped.map(r => r.challenger_wait_minutes ?? null),
      ],
    );
  }

  /** Unreconciled frozen predictions whose target day has fully elapsed. */
  async getWaitForecastLogsToReconcile(beforeDate: Date): Promise<WaitForecastLogRow[]> {
    const res = await this.pool.query(
      `SELECT experience_id, date, hour, lead_days, predicted_wait_minutes, forecasted_at,
              challenger_wait_minutes, observed_wait_minutes, error, challenger_error
       FROM wait_forecast_log
       WHERE observed_wait_minutes IS NULL AND date <= $1`,
      [toDateKey(beforeDate)],
    );
    return res.rows;
  }

  /**
   * Writes reconciliation results. Touches ONLY the observed/error columns, so a
   * frozen prediction can never be rewritten by scoring it (Property 18).
   */
  async updateWaitForecastReconciliation(
    rows: Array<{
      experience_id: string;
      date: Date;
      hour: number;
      lead_days: number;
      observed_wait_minutes: number;
      error: number;
      challenger_error: number | null;
    }>,
  ): Promise<void> {
    if (rows.length === 0) return;
    const deduped = dedupeByKey(
      rows,
      r => `${r.experience_id}|${toDateKey(r.date)}|${r.hour}|${r.lead_days}`,
    );
    await this.pool.query(
      `UPDATE wait_forecast_log AS w SET
         observed_wait_minutes = t.observed_wait_minutes,
         error = t.error,
         challenger_error = t.challenger_error
       FROM unnest(
         $1::uuid[], $2::date[], $3::int[], $4::int[], $5::real[], $6::real[], $7::real[]
       ) AS t(experience_id, date, hour, lead_days, observed_wait_minutes, error, challenger_error)
       WHERE w.experience_id = t.experience_id
         AND w.date = t.date
         AND w.hour = t.hour
         AND w.lead_days = t.lead_days`,
      [
        deduped.map(r => r.experience_id),
        deduped.map(r => toDateKey(r.date)),
        deduped.map(r => r.hour),
        deduped.map(r => r.lead_days),
        deduped.map(r => r.observed_wait_minutes),
        deduped.map(r => r.error),
        deduped.map(r => r.challenger_error ?? null),
      ],
    );
  }

  async getWaitForecastAccuracies(experienceIds: string[]): Promise<WaitForecastAccuracyRow[]> {
    if (experienceIds.length === 0) return [];
    const res = await this.pool.query(
      `SELECT * FROM wait_forecast_accuracy WHERE experience_id = ANY($1::uuid[])`,
      [experienceIds],
    );
    return res.rows;
  }

  async upsertWaitForecastAccuracies(rows: WaitForecastAccuracyRow[]): Promise<void> {
    if (rows.length === 0) return;
    const deduped = dedupeByKey(rows, r => `${r.experience_id}|${r.lead_days}`);
    await this.pool.query(
      `INSERT INTO wait_forecast_accuracy (
         experience_id, lead_days, mae, bias, sample_count,
         challenger_mae, challenger_bias, challenger_sample_count
       )
       SELECT * FROM unnest(
         $1::uuid[], $2::int[], $3::real[], $4::real[], $5::int[], $6::real[], $7::real[], $8::int[]
       ) AS t(experience_id, lead_days, mae, bias, sample_count,
              challenger_mae, challenger_bias, challenger_sample_count)
       ON CONFLICT (experience_id, lead_days) DO UPDATE SET
         mae = EXCLUDED.mae,
         bias = EXCLUDED.bias,
         sample_count = EXCLUDED.sample_count,
         challenger_mae = EXCLUDED.challenger_mae,
         challenger_bias = EXCLUDED.challenger_bias,
         challenger_sample_count = EXCLUDED.challenger_sample_count`,
      [
        deduped.map(r => r.experience_id),
        deduped.map(r => r.lead_days),
        deduped.map(r => r.mae),
        deduped.map(r => r.bias),
        deduped.map(r => r.sample_count),
        deduped.map(r => r.challenger_mae ?? null),
        deduped.map(r => r.challenger_bias ?? null),
        deduped.map(r => r.challenger_sample_count ?? 0),
      ],
    );
  }

  /**
   * R7.5: the forecast as ORIGINALLY ISSUED for a park+date.
   *
   * Returns the **earliest-issued** surviving capture (largest `lead_days`),
   * because that is the strongest honest claim — "this is what we said a week
   * out" — and because the shortest lead is the one most contaminated by the
   * same-day live correction of R4.3.
   */
  async getCapturedForecast(
    park: string,
    date: Date,
  ): Promise<{ forecast_index: number; lead_days: number; forecasted_at: Date } | null> {
    const res = await this.pool.query(
      `SELECT forecast_index, lead_days, forecasted_at
       FROM crowd_forecast_log
       WHERE park = $1 AND date = $2
       ORDER BY lead_days DESC
       LIMIT 1`,
      [park, toDateKey(date)],
    );
    return res.rows.length > 0 ? res.rows[0] : null;
  }

  /** R7.6: bounded retention for the crowd forecast log; scored rows only. */
  async pruneCrowdForecastLog(before: Date): Promise<void> {
    await this.pool.query(
      `DELETE FROM crowd_forecast_log
       WHERE date < $1 AND observed_index IS NOT NULL`,
      [toDateKey(before)],
    );
  }

  /** R18.7: bounded retention, only for rows that have already been scored. */
  async pruneWaitForecastLog(before: Date): Promise<void> {
    await this.pool.query(
      `DELETE FROM wait_forecast_log
       WHERE date < $1 AND observed_wait_minutes IS NOT NULL`,
      [toDateKey(before)],
    );
  }

  /**
   * Reads archived hourly means for reconciling frozen wait predictions (R18.3).
   * Sourced from the archive rather than `wait_samples` so reconciliation still
   * works after the 30-day raw prune.
   */
  async getWaitArchiveHours(
    experienceIds: string[],
    from: Date,
    to: Date,
  ): Promise<Array<{ experience_id: string; date: Date; hour: number; avg_wait_minutes: number; sample_count: number }>> {
    if (experienceIds.length === 0) return [];
    const res = await this.pool.query(
      `SELECT experience_id, date, hour, avg_wait_minutes, sample_count
       FROM wait_archive
       WHERE experience_id = ANY($1::uuid[]) AND date >= $2 AND date <= $3`,
      [experienceIds, from, to],
    );
    return res.rows;
  }

  async pruneWeatherObservations(before: Date): Promise<void> {
    await this.pool.query(`DELETE FROM weather_observations WHERE observed_at < $1`, [before]);
  }

  /**
   * Per-(Experience, weather condition) average observed standby wait, computed
   * by joining retained `wait_samples` to `weather_observations` in the same
   * clock hour. Only operating, positive-wait samples count. Drives the learned
   * `experience_weather_sensitivity` in the daily recompute (Task 4.5).
   */
  async getWaitWeatherAggregates(
    since: Date,
  ): Promise<{ experience_id: string; condition: string; avg_wait: number; sample_count: number }[]> {
    const res = await this.pool.query(
      `SELECT ws.experience_id AS experience_id,
              wo.condition       AS condition,
              AVG(ws.wait_minutes)::real AS avg_wait,
              COUNT(*)::int              AS sample_count
         FROM wait_samples ws
         JOIN weather_observations wo
           ON date_trunc('hour', ws.observed_at) = date_trunc('hour', wo.observed_at)
        WHERE ws.observed_at >= $1
          AND ws.status = 'OPERATING'
          AND ws.wait_minutes > 0
        GROUP BY ws.experience_id, wo.condition`,
      [since],
    );
    return res.rows.map((r) => ({
      experience_id: r.experience_id,
      condition: r.condition,
      avg_wait: typeof r.avg_wait === 'number' ? r.avg_wait : parseFloat(r.avg_wait),
      sample_count: typeof r.sample_count === 'number' ? r.sample_count : parseInt(r.sample_count, 10),
    }));
  }

  // A simplified fetch for recent wait samples for percentiles recompute
  async getRecentWaitSamples(experienceId: string, since: Date): Promise<WaitSampleRow[]> {
    const res = await this.pool.query(
      `SELECT * FROM wait_samples WHERE experience_id = $1 AND observed_at >= $2`,
      [experienceId, since]
    );
    return res.rows;
  }

  async getRecentPercentiles(since: Date): Promise<{ experience_id: string, day_of_week: number, hour: number, p50_wait: number, p90_wait: number }[]> {
    const res = await this.pool.query(
      `SELECT 
        experience_id, 
        EXTRACT(DOW FROM observed_at AT TIME ZONE 'America/New_York')::int as day_of_week, 
        EXTRACT(HOUR FROM observed_at AT TIME ZONE 'America/New_York')::int as hour,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY wait_minutes) as p50_wait,
        percentile_cont(0.9) WITHIN GROUP (ORDER BY wait_minutes) as p90_wait
      FROM wait_samples
      WHERE observed_at >= $1
      GROUP BY 1, 2, 3`
      , [since]
    );
    return res.rows;
  }

  async getExperienceSignals(experienceIds: string[]): Promise<ExperienceSignalRow[]> {
    if (experienceIds.length === 0) return [];
    const res = await this.pool.query(
      `SELECT * FROM experience_signals WHERE experience_id = ANY($1::uuid[])`,
      [experienceIds]
    );
    return res.rows;
  }

  async upsertExperienceSignals(signals: ExperienceSignalRow[]): Promise<void> {
    if (signals.length === 0) return;
    const query = `
      INSERT INTO experience_signals (
        experience_id, has_single_rider, uses_virtual_queue, downtime_rate, ll_sellout_median_hour, sample_count
      )
      SELECT * FROM unnest(
        $1::uuid[], $2::boolean[], $3::boolean[], $4::real[], $5::real[], $6::int[]
      ) AS t(experience_id, has_single_rider, uses_virtual_queue, downtime_rate, ll_sellout_median_hour, sample_count)
      ON CONFLICT (experience_id) DO UPDATE SET
        has_single_rider = EXCLUDED.has_single_rider,
        uses_virtual_queue = EXCLUDED.uses_virtual_queue,
        downtime_rate = EXCLUDED.downtime_rate,
        ll_sellout_median_hour = EXCLUDED.ll_sellout_median_hour,
        sample_count = EXCLUDED.sample_count
    `;
    await this.pool.query(query, [
      signals.map(s => s.experience_id),
      signals.map(s => s.has_single_rider),
      signals.map(s => s.uses_virtual_queue),
      signals.map(s => s.downtime_rate),
      signals.map(s => s.ll_sellout_median_hour),
      signals.map(s => s.sample_count),
    ]);
  }

  async getExperienceDailySignals(experienceIds: string[], date: Date): Promise<DailySignalRow[]> {
    if (experienceIds.length === 0) return [];
    const res = await this.pool.query(
      `SELECT * FROM experience_daily_signals WHERE date = $2 AND experience_id = ANY($1::uuid[])`,
      [experienceIds, date]
    );
    return res.rows;
  }

  async upsertExperienceDailySignals(signals: DailySignalRow[]): Promise<void> {
    if (signals.length === 0) return;

    // Deduplicate and merge within batch first to avoid Postgres error 21000
    const dedupedMap = new Map<string, DailySignalRow>();
    for (const sig of signals) {
      const dateStr = sig.date instanceof Date ? sig.date.toISOString().split('T')[0]! : String(sig.date).split('T')[0]!;
      const key = `${sig.experience_id}:${dateStr}`;
      const existingInBatch = dedupedMap.get(key);
      if (existingInBatch) {
        dedupedMap.set(key, {
          experience_id: sig.experience_id,
          date: sig.date,
          ll_price_cents: sig.ll_price_cents !== undefined ? sig.ll_price_cents : existingInBatch.ll_price_cents,
          ll_available: sig.ll_available !== undefined ? sig.ll_available : existingInBatch.ll_available,
          used_virtual_queue: sig.used_virtual_queue !== undefined ? sig.used_virtual_queue : existingInBatch.used_virtual_queue,
          showtimes: mergeShowtimeEntries(existingInBatch.showtimes, sig.showtimes),
        });
      } else {
        dedupedMap.set(key, { ...sig });
      }
    }
    const batch = Array.from(dedupedMap.values());

    // Query existing rows to union showtimes across passes
    const expIds = batch.map(s => s.experience_id);
    const dates = batch.map(s => s.date instanceof Date ? s.date.toISOString().split('T')[0]! : String(s.date).split('T')[0]!);

    const existingRes = await this.pool.query(
      `SELECT experience_id, date, showtimes FROM experience_daily_signals
       WHERE experience_id = ANY($1::uuid[]) AND date = ANY($2::date[])`,
      [expIds, dates],
    );

    const existingMap = new Map<string, any>();
    for (const row of existingRes.rows) {
      const dateStr = row.date instanceof Date ? row.date.toISOString().split('T')[0]! : String(row.date).split('T')[0]!;
      existingMap.set(`${row.experience_id}:${dateStr}`, row.showtimes);
    }

    const finalSignals = batch.map(s => {
      const dateStr = s.date instanceof Date ? s.date.toISOString().split('T')[0]! : String(s.date).split('T')[0]!;
      const existingShowtimes = existingMap.get(`${s.experience_id}:${dateStr}`);
      const mergedShowtimes = mergeShowtimeEntries(existingShowtimes, s.showtimes);
      return {
        ...s,
        showtimes: mergedShowtimes,
      };
    });

    const valuePlaceholders: string[] = [];
    const params: unknown[] = [];
    for (let i = 0; i < finalSignals.length; i++) {
      const s = finalSignals[i]!;
      const offset = i * 6;
      valuePlaceholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`);
      params.push(
        s.experience_id,
        s.date,
        s.ll_price_cents,
        s.ll_available,
        s.used_virtual_queue,
        s.showtimes ? JSON.stringify(s.showtimes) : null,
      );
    }

    const query = `
      INSERT INTO experience_daily_signals (
        experience_id, date, ll_price_cents, ll_available, used_virtual_queue, showtimes
      )
      VALUES ${valuePlaceholders.join(', ')}
      ON CONFLICT (experience_id, date) DO UPDATE SET
        ll_price_cents = EXCLUDED.ll_price_cents,
        ll_available = EXCLUDED.ll_available,
        used_virtual_queue = EXCLUDED.used_virtual_queue,
        showtimes = EXCLUDED.showtimes
    `;
    await this.pool.query(query, params);
  }


  async upsertForecastLogs(logs: ForecastLogRow[]): Promise<void> {
    if (logs.length === 0) return;
    const query = `
      INSERT INTO crowd_forecast_log (
        park, date, lead_days, forecast_index, forecasted_at, observed_index, error
      )
      SELECT * FROM unnest(
        $1::text[], $2::date[], $3::int[], $4::real[], $5::timestamptz[], $6::real[], $7::real[]
      ) AS t(park, date, lead_days, forecast_index, forecasted_at, observed_index, error)
      ON CONFLICT (park, date, lead_days) DO UPDATE SET
        forecast_index = EXCLUDED.forecast_index,
        forecasted_at = EXCLUDED.forecasted_at,
        observed_index = COALESCE(EXCLUDED.observed_index, crowd_forecast_log.observed_index),
        error = COALESCE(EXCLUDED.error, crowd_forecast_log.error)
    `;
    await this.pool.query(query, [
      logs.map(l => l.park),
      logs.map(l => l.date),
      logs.map(l => l.lead_days),
      logs.map(l => l.forecast_index),
      logs.map(l => l.forecasted_at),
      logs.map(l => l.observed_index),
      logs.map(l => l.error),
    ]);
  }

  async getForecastLogsToReconcile(park: string, date: Date): Promise<ForecastLogRow[]> {
    const res = await this.pool.query(
      `SELECT * FROM crowd_forecast_log WHERE park = $1 AND date = $2 AND observed_index IS NULL`,
      [park, date]
    );
    return res.rows;
  }

  async getForecastAccuracies(park: string): Promise<ForecastAccuracyRow[]> {
    const res = await this.pool.query(
      `SELECT * FROM crowd_forecast_accuracy WHERE park = $1`,
      [park]
    );
    return res.rows;
  }

  async upsertForecastAccuracies(accuracies: ForecastAccuracyRow[]): Promise<void> {
    if (accuracies.length === 0) return;
    const query = `
      INSERT INTO crowd_forecast_accuracy (
        park, lead_days, mae, bias, sample_count
      )
      SELECT * FROM unnest(
        $1::text[], $2::int[], $3::real[], $4::real[], $5::int[]
      ) AS t(park, lead_days, mae, bias, sample_count)
      ON CONFLICT (park, lead_days) DO UPDATE SET
        mae = EXCLUDED.mae,
        bias = EXCLUDED.bias,
        sample_count = EXCLUDED.sample_count
    `;
    await this.pool.query(query, [
      accuracies.map(a => a.park),
      accuracies.map(a => a.lead_days),
      accuracies.map(a => a.mae),
      accuracies.map(a => a.bias),
      accuracies.map(a => a.sample_count),
    ]);
  }

  async upsertWeatherObservations(obs: { observed_at: Date, temp_f: number, precip: number, condition: string }[]): Promise<void> {
    if (obs.length === 0) return;
    const query = `
      INSERT INTO weather_observations (observed_at, temp_f, precip, condition)
      SELECT * FROM unnest($1::timestamptz[], $2::real[], $3::real[], $4::text[]) AS t(observed_at, temp_f, precip, condition)
      ON CONFLICT (observed_at) DO NOTHING
    `;
    await this.pool.query(query, [
      obs.map(o => o.observed_at),
      obs.map(o => o.temp_f),
      obs.map(o => o.precip),
      obs.map(o => o.condition)
    ]);
  }

  async getWeatherSensitivities(experienceIds: string[], condition: string): Promise<ExperienceWeatherSensitivityRow[]> {
    if (experienceIds.length === 0 || !condition) return [];
    const res = await this.pool.query(
      `SELECT * FROM experience_weather_sensitivity WHERE experience_id = ANY($1::uuid[]) AND condition = $2`,
      [experienceIds, condition]
    );
    return res.rows;
  }




  async getExperiencesWithUpstreamIds(): Promise<{ id: string, upstream_entity_id: string, park: string }[]> {
    // Only ACTIVE experiences: inactive rows are no longer in the catalog and must
    // not be sampled, recomputed, or shape-seeded. This also excludes legacy rows
    // orphaned by the historical ThemeParks-GUID -> Enterprise_Id re-keying (whose
    // GUID upstream ids never resolve), so they don't churn every sampling pass or
    // inflate the pass's unresolved-experience count.
    const res = await this.pool.query(`SELECT id, upstream_entity_id, park FROM experiences WHERE upstream_entity_id IS NOT NULL AND active = true`);
    return res.rows;
  }

  async getExperiencePark(experienceId: string): Promise<string | null> {
    const res = await this.pool.query(
      `SELECT park FROM experiences WHERE id = $1`,
      [experienceId]
    );
    return res.rows.length > 0 ? res.rows[0].park : null;
  }

  async getExperiencesByPark(park: string): Promise<{ id: string; name: string; category: string }[]> {
    const res = await this.pool.query(
      `SELECT id, name, category FROM experiences WHERE park = $1 AND active = true`,
      [park]
    );
    return res.rows;
  }

  async upsertWeatherSensitivities(rows: ExperienceWeatherSensitivityRow[]): Promise<void> {
    if (rows.length === 0) return;
    const query = `
      INSERT INTO experience_weather_sensitivity (
        experience_id, condition, wait_multiplier, sample_count
      )
      SELECT * FROM unnest(
        $1::uuid[], $2::text[], $3::real[], $4::int[]
      ) AS t(experience_id, condition, wait_multiplier, sample_count)
      ON CONFLICT (experience_id, condition) DO UPDATE SET
        wait_multiplier = EXCLUDED.wait_multiplier,
        sample_count = EXCLUDED.sample_count
    `;
    await this.pool.query(query, [
      rows.map(r => r.experience_id),
      rows.map(r => r.condition),
      rows.map(r => r.wait_multiplier),
      rows.map(r => r.sample_count),
    ]);
  }

  async upsertEventImpacts(rows: ExperienceEventImpactRow[]): Promise<void> {
    if (rows.length === 0) return;
    const query = `
      INSERT INTO experience_event_impact (
        experience_id, event_type, wait_multiplier, sample_count
      )
      SELECT * FROM unnest(
        $1::uuid[], $2::text[], $3::real[], $4::int[]
      ) AS t(experience_id, event_type, wait_multiplier, sample_count)
      ON CONFLICT (experience_id, event_type) DO UPDATE SET
        wait_multiplier = EXCLUDED.wait_multiplier,
        sample_count = EXCLUDED.sample_count
    `;
    await this.pool.query(query, [
      rows.map(r => r.experience_id),
      rows.map(r => r.event_type),
      rows.map(r => r.wait_multiplier),
      rows.map(r => r.sample_count),
    ]);
  }

  async upsertRideCascades(rows: RideCascadeRow[]): Promise<void> {
    if (rows.length === 0) return;
    const query = `
      INSERT INTO ride_cascade (
        down_experience_id, affected_experience_id, wait_delta, wait_pct_delta, baseline_wait, sample_count
      )
      SELECT * FROM unnest(
        $1::uuid[], $2::uuid[], $3::real[], $4::real[], $5::real[], $6::int[]
      ) AS t(down_experience_id, affected_experience_id, wait_delta, wait_pct_delta, baseline_wait, sample_count)
      ON CONFLICT (down_experience_id, affected_experience_id) DO UPDATE SET
        wait_delta = EXCLUDED.wait_delta,
        wait_pct_delta = EXCLUDED.wait_pct_delta,
        baseline_wait = EXCLUDED.baseline_wait,
        sample_count = EXCLUDED.sample_count
    `;
    await this.pool.query(query, [
      rows.map(r => r.down_experience_id),
      rows.map(r => r.affected_experience_id),
      rows.map(r => r.wait_delta),
      rows.map(r => r.wait_pct_delta),
      rows.map(r => r.baseline_wait),
      rows.map(r => r.sample_count),
    ]);
  }

  async getTrailingShowtimeSignals(sinceDate: Date): Promise<{ experience_id: string; date: Date | string; showtimes: any }[]> {
    const res = await this.pool.query(
      `SELECT experience_id, date, showtimes
       FROM experience_daily_signals
       WHERE date >= $1 AND showtimes IS NOT NULL`,
      [sinceDate]
    );
    return res.rows;
  }

  async getShowTimePatterns(experienceIds: string[], dayOfWeek: number): Promise<ShowTimePatternRow[]> {
    if (experienceIds.length === 0) return [];
    const res = await this.pool.query(
      `SELECT experience_id, day_of_week, start_minutes, frequency, sample_count
       FROM show_time_patterns
       WHERE experience_id = ANY($1::uuid[]) AND day_of_week = $2
       ORDER BY start_minutes ASC`,
      [experienceIds, dayOfWeek]
    );
    return res.rows;
  }

  async upsertShowTimePatterns(patterns: ShowTimePatternRow[]): Promise<void> {
    if (patterns.length === 0) return;
    
    // Deduplicate by conflict key (experience_id, day_of_week, start_minutes) to avoid Postgres error 21000
    const dedupedMap = new Map<string, ShowTimePatternRow>();
    for (const p of patterns) {
      const key = `${p.experience_id}:${p.day_of_week}:${p.start_minutes}`;
      dedupedMap.set(key, p);
    }
    const deduped = Array.from(dedupedMap.values());

    const valueClauses: string[] = [];
    const params: any[] = [];
    let idx = 1;

    for (const p of deduped) {
      valueClauses.push(`($${idx++}::uuid, $${idx++}::int, $${idx++}::int, $${idx++}::real, $${idx++}::int)`);
      params.push(p.experience_id, p.day_of_week, p.start_minutes, p.frequency, p.sample_count);
    }

    const query = `
      INSERT INTO show_time_patterns (
        experience_id, day_of_week, start_minutes, frequency, sample_count
      )
      VALUES ${valueClauses.join(', ')}
      ON CONFLICT (experience_id, day_of_week, start_minutes) DO UPDATE SET
        frequency = EXCLUDED.frequency,
        sample_count = EXCLUDED.sample_count
    `;
    await this.pool.query(query, params);
  }

  async pruneStaleShowTimePatterns(
    experienceIds: string[],
    validPatterns: readonly ShowTimePatternRow[]
  ): Promise<void> {
    if (experienceIds.length === 0) return;

    if (validPatterns.length === 0) {
      await this.pool.query(
        `DELETE FROM show_time_patterns WHERE experience_id = ANY($1::uuid[])`,
        [experienceIds]
      );
      return;
    }

    const conds: string[] = [];
    const params: any[] = [experienceIds];
    let idx = 2;

    for (const p of validPatterns) {
      conds.push(`(experience_id = $${idx++}::uuid AND day_of_week = $${idx++}::int AND start_minutes = $${idx++}::int)`);
      params.push(p.experience_id, p.day_of_week, p.start_minutes);
    }

    const query = `
      DELETE FROM show_time_patterns
      WHERE experience_id = ANY($1::uuid[])
        AND NOT (${conds.join(' OR ')})
    `;
    await this.pool.query(query, params);
  }

  async recordDerivedStatRun(
    leg: string,
    outcome: { ok: true } | { ok: false; error: unknown }
  ): Promise<void> {
    if (outcome.ok) {
      await this.pool.query(
        `INSERT INTO derived_stat_runs (leg, last_success_at, last_error_at, last_error, consecutive_failures)
         VALUES ($1, NOW(), NULL, NULL, 0)
         ON CONFLICT (leg) DO UPDATE SET
           last_success_at = EXCLUDED.last_success_at,
           consecutive_failures = 0,
           last_error = NULL`,
        [leg]
      );
    } else {
      const rawMessage =
        outcome.error instanceof Error
          ? outcome.error.message
          : typeof outcome.error === 'string'
            ? outcome.error
            : String(outcome.error ?? 'Unknown error');
      const truncated = rawMessage.slice(0, 500);

      await this.pool.query(
        `INSERT INTO derived_stat_runs (leg, last_success_at, last_error_at, last_error, consecutive_failures)
         VALUES ($1, NULL, NOW(), $2, 1)
         ON CONFLICT (leg) DO UPDATE SET
           last_error_at = EXCLUDED.last_error_at,
           last_error = EXCLUDED.last_error,
           consecutive_failures = derived_stat_runs.consecutive_failures + 1`,
        [leg, truncated]
      );
    }
  }

  async getDerivedStatRun(leg: string): Promise<DerivedStatRunRow | null> {
    const res = await this.pool.query(
      `SELECT leg, last_success_at, last_error_at, last_error, consecutive_failures
       FROM derived_stat_runs
       WHERE leg = $1`,
      [leg]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      leg: r.leg,
      last_success_at: r.last_success_at ? new Date(r.last_success_at) : null,
      last_error_at: r.last_error_at ? new Date(r.last_error_at) : null,
      last_error: r.last_error ?? null,
      consecutive_failures:
        typeof r.consecutive_failures === 'number'
          ? r.consecutive_failures
          : parseInt(r.consecutive_failures, 10),
    };
  }

  async getDerivedStatRuns(): Promise<DerivedStatRunRow[]> {
    const res = await this.pool.query(
      `SELECT leg, last_success_at, last_error_at, last_error, consecutive_failures
       FROM derived_stat_runs
       ORDER BY leg ASC`
    );
    return res.rows.map((r: any) => ({
      leg: r.leg,
      last_success_at: r.last_success_at ? new Date(r.last_success_at) : null,
      last_error_at: r.last_error_at ? new Date(r.last_error_at) : null,
      last_error: r.last_error ?? null,
      consecutive_failures:
        typeof r.consecutive_failures === 'number'
          ? r.consecutive_failures
          : parseInt(r.consecutive_failures, 10),
    }));
  }
}

