/**
 * Admin repository for operational queries and maintenance actions.
 *
 * Validates: Requirements 3, 5, 6, 7, 8, 9, 10, 11, 13
 */

import type { Redis } from 'ioredis';
import type { DbPool } from '../../db/pool.js';
import type { SyncRunStatus, SyncRunOutcome } from '../catalog/repo.js';
import type { SamplingRunRow } from '../intelligence/IntelligenceRepo.js';

// ---------------------------------------------------------------------------
// Configuration & Constants (from design.md)
// ---------------------------------------------------------------------------

export const RECENT_SYNC_RUNS_LIMIT = 20;
export const RECENT_SAMPLING_RUNS_LIMIT = 20;
export const TOP_EXPERIENCE_ACCURACY_LIMIT = 50;
export const TOP_WEATHER_SENSITIVITY_LIMIT = 50;
export const TOP_RIDE_CASCADE_LIMIT = 50;
export const TOP_BASELINE_COVERAGE_LIMIT = 20;
export const CROWD_INDEX_HISTORY_DAYS = 14;
export const WAIT_FORECAST_HISTORY_LIMIT = 200;
export const RECENT_PUSH_DELIVERY_LIMIT = 100;
export const PUSH_DELIVERY_LOOKBACK_HOURS = 24;
export const GROWTH_DAILY_LOOKBACK_DAYS = 7;
export const SAMPLING_HEALTH_STALE_MINUTES = 30;
export const NEON_FREE_TIER_BYTES = 536_870_912; // 0.5 GB
export const UPSTASH_FREE_TIER_DAILY_COMMANDS = 10_000;
export const PUSH_DELIVERY_LOG_RETENTION_DAYS = 30;

// ---------------------------------------------------------------------------
// Data transfer types
// ---------------------------------------------------------------------------

export interface SyncRunRow {
  readonly id: string;
  readonly status: SyncRunStatus;
  readonly outcome: SyncRunOutcome | null;
  readonly started_at: string | Date;
  readonly completed_at: string | Date | null;
  readonly error_message: string | null;
  readonly entities_processed: number | null;
}

export interface CatalogDataQuality {
  readonly missingImageUrlCount: number;
  readonly missingCoordinatesCount: number;
  readonly unresolvedEntityCount: number;
}

export interface ForecastAccuracyRow {
  readonly park: string;
  readonly leadDays: number;
  readonly mae: number | null;
  readonly bias: number | null;
  readonly sampleCount: number;
}

export interface WaitForecastAccuracyWithNameRow {
  readonly experienceId: string;
  readonly name: string;
  readonly park: string;
  readonly leadDays: number;
  readonly mae: number | null;
  readonly bias: number | null;
  readonly sampleCount: number;
  readonly challengerMae?: number | null;
  readonly challengerBias?: number | null;
  readonly challengerSampleCount?: number | null;
}

export interface WaitForecastLogRow {
  readonly experienceId: string;
  readonly targetDate: string;
  readonly targetHour: number;
  readonly predictedWaitMinutes: number | null;
  readonly actualWaitMinutes: number | null;
  readonly errorMinutes: number | null;
}

export interface RideBaselineCoverage {
  readonly totalExperiences: number;
  readonly establishedCount: number;
  readonly coldStartCount: number;
  readonly coveragePercent: number;
  readonly topDensityExperiences: readonly {
    readonly experienceId: string;
    readonly name: string;
    readonly populatedBuckets: number;
  }[];
}

export interface WeatherSensitivityWithNameRow {
  readonly experienceId: string;
  readonly name: string;
  readonly condition: string;
  readonly waitMultiplier: number;
  readonly sampleCount: number;
}

export interface RideCascadeWithNamesRow {
  readonly downExperienceId: string;
  readonly downExperienceName: string;
  readonly affectedExperienceId: string;
  readonly affectedExperienceName: string;
  readonly waitDelta: number;
  readonly waitPctDelta: number;
  readonly baselineWait: number;
  readonly sampleCount: number;
}

export interface ShowTimePatternWithNameRow {
  readonly experienceId: string;
  readonly name: string;
  readonly dayOfWeek: number;
  readonly startMinutes: number;
  readonly frequency: number;
  readonly sampleCount: number;
}

export interface ParkCrowdIndexRow {
  readonly park: string;
  readonly date: string;
  readonly crowdIndex: number;
  readonly dailyAvgWait?: number;
  readonly sampleCount?: number;
}

export interface DatabaseTableSize {
  readonly tableName: string;
  readonly sizeBytes: number;
  readonly prettySize: string;
}

export interface DatabaseSizeSnapshot {
  readonly totalSizeBytes: number;
  readonly prettyTotalSize: string;
  readonly percentOfBudget: number;
  readonly topTables: readonly DatabaseTableSize[];
}

export interface RedisCommandBudget {
  readonly totalCommands: number;
  readonly percentOfBudget: number;
}

export interface LockoutRow {
  readonly userId: string;
  readonly email: string | null;
  readonly failedAttempts: number;
  readonly lockedUntilMs: number | null;
  readonly isPermanent: boolean;
}

export interface PushDeliveryRow {
  readonly id: string;
  readonly occurredAt: string;
  readonly userId: string;
  readonly status: 'ok' | 'device_unregistered' | 'error';
  readonly notificationKind: string;
}

export interface PushDeliveryCounts {
  readonly total: number;
  readonly ok: number;
  readonly deviceUnregistered: number;
  readonly error: number;
}

export interface AdminUserSummary {
  readonly id: string;
  readonly email: string;
  readonly createdAt: string;
  readonly displayName: string | null;
  readonly completionCount: number;
  readonly ratingCount: number;
  readonly noteCount: number;
  readonly friendCount: number;
  readonly tripCount: number;
  readonly activeSessionCount: number;
  readonly recentPushRegistrations: readonly {
    readonly id: string;
    readonly status: string;
    readonly updatedAt: string;
  }[];
}

export interface GrowthTotals {
  readonly totalUsers: number;
  readonly totalTrips: number;
  readonly totalCompletions: number;
  readonly totalRatings: number;
  readonly totalFriendships: number;
  readonly totalNotes: number;
  readonly totalFoodLogs: number;
}

export interface DailyGrowthRow {
  readonly date: string;
  readonly newUsers: number;
  readonly newCompletions: number;
  readonly newRatings: number;
  readonly newNotes: number;
  readonly newTrips: number;
  readonly newFoodLogs: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(2)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

// ---------------------------------------------------------------------------
// AdminRepo Interface
// ---------------------------------------------------------------------------

export interface AdminRepo {
  // Requirement 3 — Catalog & Sync
  getRecentSyncRuns(limit?: number): Promise<readonly SyncRunRow[]>;
  getCatalogDataQuality(
    resolveMap?: ReadonlyMap<string, string>,
  ): Promise<CatalogDataQuality>;

  // Requirement 5/6 — Intelligence
  getParkForecastAccuracies(): Promise<readonly ForecastAccuracyRow[]>;
  getTopWaitForecastAccuracies(
    limit?: number,
  ): Promise<readonly WaitForecastAccuracyWithNameRow[]>;
  getWaitForecastHistory(
    experienceId: string,
    limit?: number,
  ): Promise<readonly WaitForecastLogRow[]>;
  getRideBaselineCoverage(): Promise<RideBaselineCoverage>;
  getTopWeatherSensitivities(
    limit?: number,
  ): Promise<readonly WeatherSensitivityWithNameRow[]>;
  getTopRideCascades(
    limit?: number,
  ): Promise<readonly RideCascadeWithNamesRow[]>;
  getShowTimePatterns(): Promise<readonly ShowTimePatternWithNameRow[]>;
  getParkCrowdIndexHistory(
    park: string,
    days?: number,
  ): Promise<readonly ParkCrowdIndexRow[]>;

  // Requirement 7 — Sampling & derived-stats health
  getRecentSamplingRuns(limit?: number): Promise<readonly SamplingRunRow[]>;

  // Requirement 8 — Infra budget
  getDatabaseSizeSnapshot(): Promise<DatabaseSizeSnapshot>;
  getRedisCommandBudget(): Promise<RedisCommandBudget | null>;

  // Requirement 9 — Lockouts
  getActiveLockouts(): Promise<readonly LockoutRow[]>;
  clearLockout(userId: string): Promise<boolean>;

  // Requirement 10 — Push delivery
  getRecentPushDeliveries(limit?: number): Promise<readonly PushDeliveryRow[]>;
  getPushDeliveryCounts(sinceHours?: number): Promise<PushDeliveryCounts>;
  prunePushDeliveryLog(days?: number): Promise<number>;

  // Requirement 11 — User lookup
  findUserByEmail(email: string): Promise<AdminUserSummary | null>;
  revokeAllSessions(userId: string): Promise<number>;
  userExists(userId: string): Promise<boolean>;

  // Helpers
  getExperience(experienceId: string): Promise<{ id: string; name: string } | null>;

  // Requirement 13 — Growth
  getGrowthTotals(): Promise<GrowthTotals>;
  getDailyGrowth(days?: number): Promise<readonly DailyGrowthRow[]>;
}

export function createAdminRepo(pool: DbPool, redis: Redis): AdminRepo {
  return {
    async getRecentSyncRuns(limit = RECENT_SYNC_RUNS_LIMIT): Promise<readonly SyncRunRow[]> {
      const res = await pool.query<{
        id: string;
        status: SyncRunStatus;
        outcome: SyncRunOutcome | null;
        started_at: Date;
        completed_at: Date | null;
        error_message: string | null;
        entities_processed: number | null;
      }>(`
        SELECT
          id,
          status,
          outcome,
          started_at,
          finished_at AS completed_at,
          error_message,
          entities_processed
        FROM catalog_sync_runs
        ORDER BY started_at DESC
        LIMIT $1
      `, [limit]);
      return res.rows;
    },

    async getCatalogDataQuality(
      resolveMap?: ReadonlyMap<string, string>,
    ): Promise<CatalogDataQuality> {
      const result = await pool.query<{
        missing_image_url_count: string;
        missing_coordinates_count: string;
      }>(`
        SELECT
          COUNT(*) FILTER (WHERE image_url IS NULL)::int AS missing_image_url_count,
          COUNT(*) FILTER (WHERE latitude IS NULL OR longitude IS NULL)::int AS missing_coordinates_count
        FROM experiences
        WHERE active = TRUE
      `);
      const missingImageUrlCount = parseInt(result.rows[0]?.missing_image_url_count ?? '0', 10);
      const missingCoordinatesCount = parseInt(result.rows[0]?.missing_coordinates_count ?? '0', 10);

      let unresolvedEntityCount = 0;
      if (resolveMap !== undefined) {
        const experiencesResult = await pool.query<{ upstream_entity_id: string }>(`
          SELECT upstream_entity_id FROM experiences WHERE active = TRUE
        `);
        for (const row of experiencesResult.rows) {
          if (!resolveMap.has(row.upstream_entity_id)) {
            unresolvedEntityCount++;
          }
        }
      }

      return {
        missingImageUrlCount,
        missingCoordinatesCount,
        unresolvedEntityCount,
      };
    },

    async getParkForecastAccuracies(): Promise<readonly ForecastAccuracyRow[]> {
      const res = await pool.query<{
        park: string;
        lead_days: number;
        mae: number | null;
        bias: number | null;
        sample_count: number;
      }>(`
        SELECT
          park,
          lead_days,
          mae,
          bias,
          sample_count
        FROM crowd_forecast_accuracy
        ORDER BY park ASC, lead_days ASC
      `);
      return res.rows.map((r) => ({
        park: r.park,
        leadDays: r.lead_days,
        mae: r.mae !== null ? Number(r.mae) : null,
        bias: r.bias !== null ? Number(r.bias) : null,
        sampleCount: Number(r.sample_count),
      }));
    },

    async getTopWaitForecastAccuracies(
      limit = TOP_EXPERIENCE_ACCURACY_LIMIT,
    ): Promise<readonly WaitForecastAccuracyWithNameRow[]> {
      const res = await pool.query<{
        experience_id: string;
        name: string;
        park: string;
        lead_days: number;
        mae: number | null;
        bias: number | null;
        sample_count: number;
        challenger_mae: number | null;
        challenger_bias: number | null;
        challenger_sample_count: number;
      }>(`
        SELECT
          w.experience_id,
          e.name,
          e.park,
          w.lead_days,
          w.mae,
          w.bias,
          w.sample_count,
          w.challenger_mae,
          w.challenger_bias,
          w.challenger_sample_count
        FROM wait_forecast_accuracy w
        JOIN experiences e ON e.id = w.experience_id
        ORDER BY w.sample_count DESC
        LIMIT $1
      `, [limit]);
      return res.rows.map((r) => ({
        experienceId: r.experience_id,
        name: r.name,
        park: r.park,
        leadDays: r.lead_days,
        mae: r.mae !== null ? Number(r.mae) : null,
        bias: r.bias !== null ? Number(r.bias) : null,
        sampleCount: Number(r.sample_count),
        challengerMae: r.challenger_mae !== null && r.challenger_mae !== undefined ? Number(r.challenger_mae) : null,
        challengerBias: r.challenger_bias !== null && r.challenger_bias !== undefined ? Number(r.challenger_bias) : null,
        challengerSampleCount: r.challenger_sample_count !== null && r.challenger_sample_count !== undefined ? Number(r.challenger_sample_count) : null,
      }));
    },

    async getWaitForecastHistory(
      experienceId: string,
      limit = WAIT_FORECAST_HISTORY_LIMIT,
    ): Promise<readonly WaitForecastLogRow[]> {
      const res = await pool.query<{
        experience_id: string;
        target_date: string;
        target_hour: number;
        predicted_wait_minutes: number | null;
        actual_wait_minutes: number | null;
        error_minutes: number | null;
      }>(`
        SELECT
          experience_id,
          to_char(date, 'YYYY-MM-DD') AS target_date,
          hour AS target_hour,
          predicted_wait_minutes,
          observed_wait_minutes AS actual_wait_minutes,
          error AS error_minutes
        FROM wait_forecast_log
        WHERE experience_id = $1
        ORDER BY date DESC, hour DESC
        LIMIT $2
      `, [experienceId, limit]);
      return res.rows.map((r) => ({
        experienceId: r.experience_id,
        targetDate: r.target_date,
        targetHour: r.target_hour,
        predictedWaitMinutes: r.predicted_wait_minutes,
        actualWaitMinutes: r.actual_wait_minutes,
        errorMinutes: r.error_minutes,
      }));
    },

    async getExperience(experienceId: string): Promise<{ id: string; name: string } | null> {
      const res = await pool.query<{ id: string; name: string }>(
        `SELECT id, name FROM experiences WHERE id = $1`,
        [experienceId],
      );
      const row = res.rows[0];
      return row ? { id: row.id, name: row.name } : null;
    },

    async getRideBaselineCoverage(): Promise<RideBaselineCoverage> {
      const res = await pool.query<{
        id: string;
        name: string;
        established_buckets: string;
        populated_buckets: string;
      }>(`
        WITH exp AS (
          SELECT id, name FROM experiences WHERE active = TRUE AND category = 'Ride'
        ),
        counts AS (
          SELECT
            experience_id,
            COUNT(*) FILTER (WHERE baseline_wait_minutes IS NOT NULL)::int AS established_buckets,
            COUNT(*) FILTER (WHERE sample_count > 0)::int AS populated_buckets
          FROM ride_shapes
          GROUP BY experience_id
        )
        SELECT
          e.id,
          e.name,
          COALESCE(c.established_buckets, 0) AS established_buckets,
          COALESCE(c.populated_buckets, 0) AS populated_buckets
        FROM exp e
        LEFT JOIN counts c ON c.experience_id = e.id
      `);

      const totalExperiences = res.rows.length;
      let establishedCount = 0;
      for (const row of res.rows) {
        if (parseInt(row.established_buckets, 10) > 0) {
          establishedCount++;
        }
      }
      const coldStartCount = totalExperiences - establishedCount;
      const coveragePercent =
        totalExperiences > 0 ? Number(((establishedCount / totalExperiences) * 100).toFixed(1)) : 0;

      const topDensityExperiences = res.rows
        .map((r) => ({
          experienceId: r.id,
          name: r.name,
          populatedBuckets: parseInt(r.populated_buckets, 10),
        }))
        .sort((a, b) => b.populatedBuckets - a.populatedBuckets)
        .slice(0, TOP_BASELINE_COVERAGE_LIMIT);

      return {
        totalExperiences,
        establishedCount,
        coldStartCount,
        coveragePercent,
        topDensityExperiences,
      };
    },

    async getTopWeatherSensitivities(
      limit = TOP_WEATHER_SENSITIVITY_LIMIT,
    ): Promise<readonly WeatherSensitivityWithNameRow[]> {
      const res = await pool.query<{
        experience_id: string;
        name: string;
        condition: string;
        wait_multiplier: number;
        sample_count: number;
      }>(`
        SELECT
          w.experience_id,
          e.name,
          w.condition,
          w.wait_multiplier,
          w.sample_count
        FROM experience_weather_sensitivity w
        JOIN experiences e ON e.id = w.experience_id
        ORDER BY w.sample_count DESC
        LIMIT $1
      `, [limit]);
      return res.rows.map((r) => ({
        experienceId: r.experience_id,
        name: r.name,
        condition: r.condition,
        waitMultiplier: r.wait_multiplier,
        sampleCount: r.sample_count,
      }));
    },

    async getTopRideCascades(
      limit = TOP_RIDE_CASCADE_LIMIT,
    ): Promise<readonly RideCascadeWithNamesRow[]> {
      const res = await pool.query<{
        down_experience_id: string;
        down_name: string;
        affected_experience_id: string;
        affected_name: string;
        wait_delta: number;
        wait_pct_delta: number;
        baseline_wait: number;
        sample_count: number;
      }>(`
        SELECT
          c.down_experience_id,
          e1.name AS down_name,
          c.affected_experience_id,
          e2.name AS affected_name,
          c.wait_delta,
          c.wait_pct_delta,
          c.baseline_wait,
          c.sample_count
        FROM ride_cascade c
        JOIN experiences e1 ON e1.id = c.down_experience_id
        JOIN experiences e2 ON e2.id = c.affected_experience_id
        ORDER BY c.sample_count DESC
        LIMIT $1
      `, [limit]);
      return res.rows.map((r) => ({
        downExperienceId: r.down_experience_id,
        downExperienceName: r.down_name,
        affectedExperienceId: r.affected_experience_id,
        affectedExperienceName: r.affected_name,
        waitDelta: r.wait_delta,
        waitPctDelta: r.wait_pct_delta,
        baselineWait: r.baseline_wait,
        sampleCount: r.sample_count,
      }));
    },

    async getShowTimePatterns(): Promise<readonly ShowTimePatternWithNameRow[]> {
      const res = await pool.query<{
        experience_id: string;
        name: string;
        day_of_week: number;
        start_minutes: number;
        frequency: number;
        sample_count: number;
      }>(`
        SELECT
          s.experience_id,
          e.name,
          s.day_of_week,
          s.start_minutes,
          s.frequency,
          s.sample_count
        FROM show_time_patterns s
        JOIN experiences e ON e.id = s.experience_id
        ORDER BY s.sample_count DESC
      `);
      return res.rows.map((r) => ({
        experienceId: r.experience_id,
        name: r.name,
        dayOfWeek: r.day_of_week,
        startMinutes: r.start_minutes,
        frequency: r.frequency,
        sampleCount: r.sample_count,
      }));
    },

    async getParkCrowdIndexHistory(
      park: string,
      days = CROWD_INDEX_HISTORY_DAYS,
    ): Promise<readonly ParkCrowdIndexRow[]> {
      const res = await pool.query<{
        park: string;
        date: string;
        crowd_index: number;
        daily_avg_wait: number;
        sample_count: number;
      }>(`
        SELECT
          park,
          to_char(date, 'YYYY-MM-DD') AS date,
          crowd_index,
          daily_avg_wait,
          sample_count
        FROM park_crowd_index
        WHERE park = $1
        ORDER BY date DESC
        LIMIT $2
      `, [park, days]);
      return res.rows.map((r) => ({
        park: r.park,
        date: r.date,
        crowdIndex: r.crowd_index,
        dailyAvgWait: r.daily_avg_wait,
        sampleCount: r.sample_count,
      }));
    },

    async getRecentSamplingRuns(
      limit = RECENT_SAMPLING_RUNS_LIMIT,
    ): Promise<readonly SamplingRunRow[]> {
      const res = await pool.query<SamplingRunRow>(`
        SELECT
          id,
          started_at,
          completed_at,
          outcome,
          error_message,
          parks_sampled_count,
          experiences_mapped_count,
          wait_samples_recorded_count,
          unmapped_with_wait_count,
          unmapped_sample
        FROM sampling_runs
        ORDER BY started_at DESC
        LIMIT $1
      `, [limit]);
      return res.rows;
    },

    async getDatabaseSizeSnapshot(): Promise<DatabaseSizeSnapshot> {
      try {
        const sizeRes = await pool.query<{ total_size: string }>(`
          SELECT pg_database_size(current_database())::bigint AS total_size
        `);
        const totalSizeBytes = parseInt(sizeRes.rows[0]?.total_size ?? '0', 10);
        const percentOfBudget = Number(
          ((totalSizeBytes / NEON_FREE_TIER_BYTES) * 100).toFixed(2),
        );

        const tablesRes = await pool.query<{ table_name: string; size_bytes: string }>(`
          SELECT
            c.relname AS table_name,
            pg_total_relation_size(c.oid)::bigint AS size_bytes
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind = 'r'
            AND n.nspname = 'public'
          ORDER BY size_bytes DESC
          LIMIT 10
        `);

        const topTables: DatabaseTableSize[] = tablesRes.rows.map((r) => {
          const bytes = parseInt(r.size_bytes, 10);
          return {
            tableName: r.table_name,
            sizeBytes: bytes,
            prettySize: formatBytes(bytes),
          };
        });

        return {
          totalSizeBytes,
          prettyTotalSize: formatBytes(totalSizeBytes),
          percentOfBudget,
          topTables,
        };
      } catch {
        return {
          totalSizeBytes: 0,
          prettyTotalSize: '0 B',
          percentOfBudget: 0,
          topTables: [],
        };
      }
    },

    async getRedisCommandBudget(): Promise<RedisCommandBudget | null> {
      try {
        const raw = await redis.info('commandstats');
        if (!raw || typeof raw !== 'string') return null;
        let totalCommands = 0;
        const lines = raw.split('\n');
        for (const line of lines) {
          const match = /cmdstat_[^:]+:calls=(\d+)/.exec(line.trim());
          if (match && match[1]) {
            totalCommands += parseInt(match[1], 10);
          }
        }
        const percentOfBudget = Number(
          ((totalCommands / UPSTASH_FREE_TIER_DAILY_COMMANDS) * 100).toFixed(2),
        );
        return {
          totalCommands,
          percentOfBudget,
        };
      } catch {
        return null;
      }
    },

    async getActiveLockouts(): Promise<readonly LockoutRow[]> {
      try {
        const userIds = new Set<string>();

        let cursor = '0';
        do {
          const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'locked:*', 'COUNT', 100);
          cursor = nextCursor;
          for (const k of keys) {
            const parts = k.split(':');
            if (parts[1]) userIds.add(parts[1]);
          }
        } while (cursor !== '0');

        cursor = '0';
        do {
          const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'lockout:*', 'COUNT', 100);
          cursor = nextCursor;
          for (const k of keys) {
            const parts = k.split(':');
            if (parts[1]) userIds.add(parts[1]);
          }
        } while (cursor !== '0');

        if (userIds.size === 0) {
          return [];
        }

        const idList = Array.from(userIds);
        const userRows = await pool.query<{ id: string; email: string }>(`
          SELECT id, email FROM users WHERE id = ANY($1::uuid[])
        `, [idList]);
        const emailMap = new Map(userRows.rows.map((r) => [r.id, r.email]));

        const rows: LockoutRow[] = [];
        for (const userId of idList) {
          const pttl = await redis.pttl(`locked:${userId}`);
          const failedAttempts = await redis.zcard(`lockout:${userId}`);
          rows.push({
            userId,
            email: emailMap.get(userId) ?? null,
            failedAttempts,
            lockedUntilMs: pttl > 0 ? Date.now() + pttl : null,
            isPermanent: false,
          });
        }

        return rows;
      } catch {
        return [];
      }
    },

    async clearLockout(userId: string): Promise<boolean> {
      const deleted = await redis.del(`locked:${userId}`, `lockout:${userId}`);
      return deleted > 0;
    },

    async getRecentPushDeliveries(
      limit = RECENT_PUSH_DELIVERY_LIMIT,
    ): Promise<readonly PushDeliveryRow[]> {
      const res = await pool.query<{
        id: string;
        occurred_at: string;
        user_id: string;
        status: 'ok' | 'device_unregistered' | 'error';
        notification_kind: string;
      }>(`
        SELECT
          id,
          to_char(occurred_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS occurred_at,
          user_id,
          status,
          notification_kind
        FROM push_delivery_log
        ORDER BY occurred_at DESC
        LIMIT $1
      `, [limit]);
      return res.rows.map((r) => ({
        id: r.id,
        occurredAt: r.occurred_at,
        userId: r.user_id,
        status: r.status,
        notificationKind: r.notification_kind,
      }));
    },

    async getPushDeliveryCounts(
      sinceHours = PUSH_DELIVERY_LOOKBACK_HOURS,
    ): Promise<PushDeliveryCounts> {
      const res = await pool.query<{
        total: string;
        ok: string;
        device_unregistered: string;
        error: string;
      }>(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'ok')::int AS ok,
          COUNT(*) FILTER (WHERE status = 'device_unregistered')::int AS device_unregistered,
          COUNT(*) FILTER (WHERE status = 'error')::int AS error
        FROM push_delivery_log
        WHERE occurred_at >= now() - ($1 || ' hours')::interval
      `, [sinceHours]);
      const row = res.rows[0];
      return {
        total: parseInt(row?.total ?? '0', 10),
        ok: parseInt(row?.ok ?? '0', 10),
        deviceUnregistered: parseInt(row?.device_unregistered ?? '0', 10),
        error: parseInt(row?.error ?? '0', 10),
      };
    },

    async prunePushDeliveryLog(days = PUSH_DELIVERY_LOG_RETENTION_DAYS): Promise<number> {
      const res = await pool.query<{ count: string }>(`
        WITH deleted AS (
          DELETE FROM push_delivery_log
           WHERE occurred_at < now() - ($1 || ' days')::interval
          RETURNING 1
        )
        SELECT COUNT(*)::int AS count FROM deleted;
      `, [days]);
      return parseInt(res.rows[0]?.count ?? '0', 10);
    },

    async findUserByEmail(email: string): Promise<AdminUserSummary | null> {
      const userRes = await pool.query<{
        id: string;
        email: string;
        created_at: string;
        display_name: string | null;
        completion_count: string;
        rating_count: string;
        note_count: string;
        friend_count: string;
        trip_count: string;
        active_session_count: string;
      }>(`
        SELECT
          u.id,
          u.email,
          to_char(u.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
          p.display_name,
          (SELECT COUNT(*)::int FROM completions WHERE user_id = u.id) AS completion_count,
          (SELECT COUNT(*)::int FROM ratings WHERE user_id = u.id) AS rating_count,
          (SELECT COUNT(*)::int FROM notes WHERE user_id = u.id) AS note_count,
          (SELECT COUNT(*)::int FROM friendships WHERE user_lo_id = u.id OR user_hi_id = u.id) AS friend_count,
          (SELECT COUNT(DISTINCT trip_id)::int FROM (
            SELECT id AS trip_id FROM trips WHERE creator_id = u.id
            UNION
            SELECT trip_id FROM trip_memberships WHERE user_id = u.id
          ) t) AS trip_count,
          (SELECT COUNT(*)::int FROM sessions WHERE user_id = u.id AND revoked_at IS NULL AND absolute_expires_at > now()) AS active_session_count
        FROM users u
        LEFT JOIN profiles p ON p.user_id = u.id
        WHERE lower(u.email) = lower($1)
      `, [email]);

      if (userRes.rows.length === 0) {
        return null;
      }

      const row = userRes.rows[0]!;

      const pushRes = await pool.query<{
        id: string;
        status: string;
        updated_at: string;
      }>(`
        SELECT
          id,
          status,
          to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at
        FROM push_registrations
        WHERE user_id = $1
        ORDER BY updated_at DESC
        LIMIT 5
      `, [row.id]);

      return {
        id: row.id,
        email: row.email,
        createdAt: row.created_at,
        displayName: row.display_name,
        completionCount: parseInt(row.completion_count, 10),
        ratingCount: parseInt(row.rating_count, 10),
        noteCount: parseInt(row.note_count, 10),
        friendCount: parseInt(row.friend_count, 10),
        tripCount: parseInt(row.trip_count, 10),
        activeSessionCount: parseInt(row.active_session_count, 10),
        recentPushRegistrations: pushRes.rows.map((p) => ({
          id: p.id,
          status: p.status,
          updatedAt: p.updated_at,
        })),
      };
    },

    async revokeAllSessions(userId: string): Promise<number> {
      const res = await pool.query<{ count: string }>(`
        WITH updated AS (
          UPDATE sessions
             SET revoked_at = now()
           WHERE user_id = $1
             AND revoked_at IS NULL
          RETURNING 1
        )
        SELECT COUNT(*)::int AS count FROM updated;
      `, [userId]);
      return parseInt(res.rows[0]?.count ?? '0', 10);
    },

    async userExists(userId: string): Promise<boolean> {
      const res = await pool.query<{ exists: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM users WHERE id = $1) AS exists`,
        [userId],
      );
      return Boolean(res.rows[0]?.exists);
    },

    async getGrowthTotals(): Promise<GrowthTotals> {
      const res = await pool.query<{
        total_users: string;
        total_trips: string;
        total_completions: string;
        total_ratings: string;
        total_friendships: string;
        total_notes: string;
        total_food_logs: string;
      }>(`
        SELECT
          (SELECT COUNT(*)::int FROM users) AS total_users,
          (SELECT COUNT(*)::int FROM trips) AS total_trips,
          (SELECT COUNT(*)::int FROM completions) AS total_completions,
          (SELECT COUNT(*)::int FROM ratings) AS total_ratings,
          (SELECT COUNT(*)::int FROM friendships) AS total_friendships,
          (SELECT COUNT(*)::int FROM notes) AS total_notes,
          (SELECT COUNT(*)::int FROM food_item_logs) AS total_food_logs;
      `);
      const row = res.rows[0];
      return {
        totalUsers: parseInt(row?.total_users ?? '0', 10),
        totalTrips: parseInt(row?.total_trips ?? '0', 10),
        totalCompletions: parseInt(row?.total_completions ?? '0', 10),
        totalRatings: parseInt(row?.total_ratings ?? '0', 10),
        totalFriendships: parseInt(row?.total_friendships ?? '0', 10),
        totalNotes: parseInt(row?.total_notes ?? '0', 10),
        totalFoodLogs: parseInt(row?.total_food_logs ?? '0', 10),
      };
    },

    async getDailyGrowth(days = GROWTH_DAILY_LOOKBACK_DAYS): Promise<readonly DailyGrowthRow[]> {
      const result: DailyGrowthRow[] = [];
      const now = new Date();
      const dateKeys: string[] = [];
      for (let i = 0; i < days; i++) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
        dateKeys.push(d.toISOString().slice(0, 10));
      }
      const oldestDate = dateKeys[dateKeys.length - 1]!;

      const userRes = await pool.query<{ day: string; count: string }>(`
        SELECT to_char(created_at, 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
        FROM users
        WHERE created_at >= $1::timestamptz
        GROUP BY to_char(created_at, 'YYYY-MM-DD')
      `, [oldestDate]);

      // `completions` has no insertion timestamp — only `completed_on`, the
      // (user-editable, possibly backdated) visit date. This counts
      // completions whose *visit date* falls in the window, not completions
      // actually logged in the window; there is no column that records the
      // latter. Documented here and in the rendered label (routes.ts) so the
      // distinction isn't silently lost.
      const compRes = await pool.query<{ day: string; count: string }>(`
        SELECT to_char(completed_on, 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
        FROM completions
        WHERE completed_on >= $1::date
        GROUP BY to_char(completed_on, 'YYYY-MM-DD')
      `, [oldestDate]);

      const userMap = new Map(userRes.rows.map((r) => [r.day, parseInt(r.count, 10)]));
      const compMap = new Map(compRes.rows.map((r) => [r.day, parseInt(r.count, 10)]));

      for (const date of dateKeys) {
        result.push({
          date,
          newUsers: userMap.get(date) ?? 0,
          newCompletions: compMap.get(date) ?? 0,
          newRatings: 0,
          newNotes: 0,
          newTrips: 0,
          newFoodLogs: 0,
        });
      }
      return result;
    },
  };
}
