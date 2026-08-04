import type { Pool } from 'pg';

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
}

export interface SeasonHourRow {
  experience_id: string;
  season: number;
  day_of_week: number;
  hour: number;
  avg_wait_minutes: number;
  sample_count: number;
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
        sr_avg_wait_minutes, sr_sample_count, stddev_wait, p50_wait, p90_wait, down_rate
      )
      SELECT * FROM unnest(
        $1::uuid[], $2::int[], $3::int[], $4::real[], $5::int[],
        $6::real[], $7::int[], $8::real[], $9::real[], $10::real[], $11::real[]
      ) AS t(
        experience_id, day_of_week, hour, avg_wait_minutes, sample_count,
        sr_avg_wait_minutes, sr_sample_count, stddev_wait, p50_wait, p90_wait, down_rate
      )
      ON CONFLICT (experience_id, day_of_week, hour) DO UPDATE SET
        avg_wait_minutes = EXCLUDED.avg_wait_minutes,
        sample_count = EXCLUDED.sample_count,
        sr_avg_wait_minutes = EXCLUDED.sr_avg_wait_minutes,
        sr_sample_count = EXCLUDED.sr_sample_count,
        stddev_wait = EXCLUDED.stddev_wait,
        p50_wait = EXCLUDED.p50_wait,
        p90_wait = EXCLUDED.p90_wait,
        down_rate = EXCLUDED.down_rate
    `;

    const e = shapes.map(s => s.experience_id);
    const d = shapes.map(s => s.day_of_week);
    const h = shapes.map(s => s.hour);
    const a = shapes.map(s => s.avg_wait_minutes);
    const c = shapes.map(s => s.sample_count);
    const sra = shapes.map(s => s.sr_avg_wait_minutes);
    const src = shapes.map(s => s.sr_sample_count);
    const std = shapes.map(s => s.stddev_wait);
    const p50 = shapes.map(s => s.p50_wait);
    const p90 = shapes.map(s => s.p90_wait);
    const dr = shapes.map(s => s.down_rate);

    await this.pool.query(query, [e, d, h, a, c, sra, src, std, p50, p90, dr]);
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
        experience_id, season, day_of_week, hour, avg_wait_minutes, sample_count
      )
      SELECT * FROM unnest(
        $1::uuid[], $2::int[], $3::int[], $4::int[], $5::real[], $6::int[]
      ) AS t(experience_id, season, day_of_week, hour, avg_wait_minutes, sample_count)
      ON CONFLICT (experience_id, season, day_of_week, hour) DO UPDATE SET
        avg_wait_minutes = EXCLUDED.avg_wait_minutes,
        sample_count = EXCLUDED.sample_count
    `;
    await this.pool.query(query, [
      hours.map(h => h.experience_id),
      hours.map(h => h.season),
      hours.map(h => h.day_of_week),
      hours.map(h => h.hour),
      hours.map(h => h.avg_wait_minutes),
      hours.map(h => h.sample_count),
    ]);
  }

  async getParkCrowdIndices(park: string, dates: Date[]): Promise<ParkCrowdIndexRow[]> {
    if (dates.length === 0) return [];
    const res = await this.pool.query(
      `SELECT * FROM park_crowd_index WHERE park = $1 AND date = ANY($2::date[])`,
      [park, dates]
    );
    return res.rows;
  }

  async getComparableCrowdIndices(park: string, month: number, dow: number): Promise<number[]> {
    const res = await this.pool.query(
      `SELECT crowd_index FROM park_crowd_index 
       WHERE park = $1 
       AND EXTRACT(MONTH FROM date) = $2 
       AND EXTRACT(DOW FROM date) = $3`,
      [park, month, dow]
    );
    return res.rows.map(r => r.crowd_index);
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
    const res = await this.pool.query(
      `SELECT * FROM park_schedule_signals WHERE park = $1 AND date >= $2 AND date <= $3`,
      [park, fromDate, toDate]
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
    const query = `
      INSERT INTO experience_daily_signals (
        experience_id, date, ll_price_cents, ll_available, used_virtual_queue, showtimes
      )
      SELECT * FROM unnest(
        $1::uuid[], $2::date[], $3::int[], $4::boolean[], $5::boolean[], $6::jsonb[]
      ) AS t(experience_id, date, ll_price_cents, ll_available, used_virtual_queue, showtimes)
      ON CONFLICT (experience_id, date) DO UPDATE SET
        ll_price_cents = EXCLUDED.ll_price_cents,
        ll_available = EXCLUDED.ll_available,
        used_virtual_queue = EXCLUDED.used_virtual_queue,
        showtimes = EXCLUDED.showtimes
    `;
    await this.pool.query(query, [
      signals.map(s => s.experience_id),
      signals.map(s => s.date),
      signals.map(s => s.ll_price_cents),
      signals.map(s => s.ll_available),
      signals.map(s => s.used_virtual_queue),
      signals.map(s => s.showtimes ? JSON.stringify(s.showtimes) : null), // Note: array of jsonb strings
    ]);
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

  async getParkRollingBaseline(park: string): Promise<number | null> {
    const res = await this.pool.query(
      `SELECT AVG(daily_avg_wait) as baseline FROM park_crowd_index WHERE park = $1 AND source = 'observed'`,
      [park]
    );
    if (res.rows.length === 0 || res.rows[0].baseline == null) return null;
    return parseFloat(res.rows[0].baseline);
  }

  async getExperiencesWithUpstreamIds(): Promise<{ id: string, upstream_entity_id: string, park: string }[]> {
    const res = await this.pool.query(`SELECT id, upstream_entity_id, park FROM experiences WHERE upstream_entity_id IS NOT NULL`);
    return res.rows;
  }

  async getExperiencePark(experienceId: string): Promise<string | null> {
    const res = await this.pool.query(
      `SELECT park FROM experiences WHERE id = $1`,
      [experienceId]
    );
    return res.rows.length > 0 ? res.rows[0].park : null;
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
}
