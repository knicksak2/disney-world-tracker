/**
 * Tests for AdminRepo queries and mutations.
 *
 * Validates: Requirements 3.1, 3.4, 5.1, 5.2, 5.4, 6.1, 6.2, 6.3, 6.4, 6.5,
 *             8.1, 8.3, 9.1, 9.2, 9.3, 10.2, 10.3, 11.1, 11.4, 13.1, 13.2
 *
 * Includes:
 *   - Property 6: Lockout clear is idempotent and reports absence truthfully
 *   - Property 7: User lookup is case-insensitive and non-probing on miss
 *   - Property 8: Session revoke is scoped to exactly the target user's un-revoked sessions
 */

import { describe, expect, it } from 'vitest';
import RedisMock from 'ioredis-mock';
import fc from 'fast-check';
import {
  createAdminRepo,
  formatBytes,
  NEON_FREE_TIER_BYTES,
  UPSTASH_FREE_TIER_DAILY_COMMANDS,
} from '../repo.js';

// ---------------------------------------------------------------------------
// Fake pool implementation
// ---------------------------------------------------------------------------

interface FakeCall {
  readonly text: string;
  readonly params: ReadonlyArray<unknown>;
}

type QueryHandler = (
  text: string,
  params: ReadonlyArray<unknown>,
) => ReadonlyArray<Record<string, unknown>> | undefined;

function createFakePool(handler: QueryHandler) {
  const calls: FakeCall[] = [];
  return {
    calls,
    async query<T extends Record<string, unknown>>(
      text: string,
      params: ReadonlyArray<unknown> = [],
    ): Promise<{ rows: T[] }> {
      calls.push({ text, params });
      const rows = handler(text, params) ?? [];
      return { rows: rows as T[] };
    },
  };
}

describe('AdminRepo - Catalog Data Quality (Requirement 3.1, 3.4)', () => {
  it('getCatalogDataQuality calculates missing image, coordinates, and unresolved entities', async () => {
    const pool = createFakePool((text) => {
      if (text.includes('COUNT(*) FILTER (WHERE image_url IS NULL)')) {
        return [
          {
            missing_image_url_count: '12',
            missing_coordinates_count: '4',
          },
        ];
      }
      if (text.includes('SELECT upstream_entity_id FROM experiences')) {
        return [
          { upstream_entity_id: 'ent-1' },
          { upstream_entity_id: 'ent-2' },
          { upstream_entity_id: 'ent-3' },
          { upstream_entity_id: 'ent-unresolved' },
        ];
      }
      return [];
    });

    const redis = new RedisMock();
    const repo = createAdminRepo(pool as never, redis as never);

    const resolveMap = new Map([
      ['ent-1', 'tp-1'],
      ['ent-2', 'tp-2'],
      ['ent-3', 'tp-3'],
    ]);

    const quality = await repo.getCatalogDataQuality(resolveMap);
    expect(quality.missingImageUrlCount).toBe(12);
    expect(quality.missingCoordinatesCount).toBe(4);
    expect(quality.unresolvedEntityCount).toBe(1); // 'ent-unresolved' is missing from resolveMap
  });
});

describe('AdminRepo - Intelligence & Forecasts (Requirements 5 & 6)', () => {
  it('getParkForecastAccuracies returns mapped park accuracies', async () => {
    const pool = createFakePool((text) => {
      if (text.includes('FROM crowd_forecast_accuracy')) {
        return [
          {
            park: 'MK',
            lead_days: 1,
            mae: '4.25',
            bias: '-1.10',
            sample_count: 150,
          },
        ];
      }
      return [];
    });

    const redis = new RedisMock();
    const repo = createAdminRepo(pool as never, redis as never);

    const rows = await repo.getParkForecastAccuracies();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      park: 'MK',
      leadDays: 1,
      mae: 4.25,
      bias: -1.1,
      sampleCount: 150,
    });
  });

  it('getTopWaitForecastAccuracies joins experience names and challenger stats', async () => {
    const pool = createFakePool((text) => {
      if (text.includes('FROM wait_forecast_accuracy')) {
        return [
          {
            experience_id: 'exp-1',
            name: 'Space Mountain',
            park: 'MK',
            lead_days: 0,
            mae: '6.50',
            bias: '0.20',
            sample_count: 500,
            challenger_mae: '5.80',
            challenger_bias: '0.10',
            challenger_sample_count: 500,
          },
        ];
      }
      return [];
    });

    const redis = new RedisMock();
    const repo = createAdminRepo(pool as never, redis as never);

    const rows = await repo.getTopWaitForecastAccuracies(10);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('Space Mountain');
    expect(rows[0]!.challengerMae).toBe(5.8);
    expect(rows[0]!.challengerSampleCount).toBe(500);
  });

  it('getWaitForecastHistory returns target date/hour logs', async () => {
    const pool = createFakePool((text, params) => {
      if (text.includes('FROM wait_forecast_log') && params[0] === 'exp-1') {
        return [
          {
            experience_id: 'exp-1',
            target_date: '2026-10-01',
            target_hour: 14,
            predicted_wait_minutes: 45,
            actual_wait_minutes: 50,
            error_minutes: 5,
          },
        ];
      }
      return [];
    });

    const redis = new RedisMock();
    const repo = createAdminRepo(pool as never, redis as never);

    const logs = await repo.getWaitForecastHistory('exp-1', 10);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toEqual({
      experienceId: 'exp-1',
      targetDate: '2026-10-01',
      targetHour: 14,
      predictedWaitMinutes: 45,
      actualWaitMinutes: 50,
      errorMinutes: 5,
    });
  });

  it('getRideBaselineCoverage calculates established vs cold-starting counts', async () => {
    const pool = createFakePool((text) => {
      if (text.includes('ride_shapes')) {
        return [
          {
            id: 'exp-1',
            name: 'Pirates of the Caribbean',
            established_buckets: '1',
            populated_buckets: '15',
          },
          {
            id: 'exp-2',
            name: 'Haunted Mansion',
            established_buckets: '0',
            populated_buckets: '0',
          },
        ];
      }
      return [];
    });

    const redis = new RedisMock();
    const repo = createAdminRepo(pool as never, redis as never);

    const cov = await repo.getRideBaselineCoverage();
    expect(cov.totalExperiences).toBe(2);
    expect(cov.establishedCount).toBe(1);
    expect(cov.coldStartCount).toBe(1);
    expect(cov.coveragePercent).toBe(50);
    expect(cov.topDensityExperiences).toHaveLength(2);
  });

  it('getTopWeatherSensitivities, getTopRideCascades, getShowTimePatterns return rows', async () => {
    const pool = createFakePool((text) => {
      if (text.includes('FROM experience_weather_sensitivity')) {
        return [
          {
            experience_id: 'exp-1',
            name: 'Big Thunder',
            condition: 'rain',
            wait_multiplier: '0.80',
            sample_count: 45,
          },
        ];
      }
      if (text.includes('FROM ride_cascade')) {
        return [
          {
            down_experience_id: 'exp-down',
            down_name: 'Seven Dwarfs Mine Train',
            affected_experience_id: 'exp-aff',
            affected_name: 'Peter Pan',
            wait_delta: '15.5',
            wait_pct_delta: '0.35',
            baseline_wait: '45.0',
            sample_count: 80,
          },
        ];
      }
      if (text.includes('FROM show_time_patterns')) {
        return [
          {
            experience_id: 'exp-show',
            name: 'Festival of Fantasy',
            day_of_week: 1,
            start_minutes: 900,
            frequency: '1.0',
            sample_count: 30,
          },
        ];
      }
      return [];
    });

    const redis = new RedisMock();
    const repo = createAdminRepo(pool as never, redis as never);

    const weather = await repo.getTopWeatherSensitivities(10);
    expect(weather).toHaveLength(1);
    expect(weather[0]!.condition).toBe('rain');

    const cascades = await repo.getTopRideCascades(10);
    expect(cascades).toHaveLength(1);
    expect(cascades[0]!.downExperienceName).toBe('Seven Dwarfs Mine Train');

    const showtimes = await repo.getShowTimePatterns();
    expect(showtimes).toHaveLength(1);
    expect(showtimes[0]!.startMinutes).toBe(900);
  });
});

describe('AdminRepo - Infrastructure Budget (Requirement 8)', () => {
  it('getDatabaseSizeSnapshot parses pg_database_size and relation sizes', async () => {
    const pool = createFakePool((text) => {
      if (text.includes('pg_database_size(current_database())')) {
        return [{ total_size: '53687091' }]; // ~51.2 MB (10% of 536870912)
      }
      if (text.includes('pg_total_relation_size')) {
        return [
          { table_name: 'wait_samples', size_bytes: '25000000' },
          { table_name: 'experiences', size_bytes: '5000000' },
        ];
      }
      return [];
    });

    const redis = new RedisMock();
    const repo = createAdminRepo(pool as never, redis as never);

    const snapshot = await repo.getDatabaseSizeSnapshot();
    expect(snapshot.totalSizeBytes).toBe(53687091);
    expect(snapshot.percentOfBudget).toBeCloseTo(10, 1);
    expect(snapshot.topTables).toHaveLength(2);
    expect(snapshot.topTables[0]!.tableName).toBe('wait_samples');
  });

  it('getRedisCommandBudget parses INFO commandstats calls', async () => {
    const pool = createFakePool(() => []);
    const redis = new RedisMock();
    const repo = createAdminRepo(pool as never, redis as never);

    // Rig info method
    (redis as unknown as { info: (section?: string) => Promise<string> }).info = async (section?: string) => {
      if (section === 'commandstats') {
        return `# Commandstats\r\ncmdstat_get:calls=500,usec=1200\r\ncmdstat_set:calls=250,usec=600\r\ncmdstat_zadd:calls=250,usec=500\r\n`;
      }
      return '';
    };

    const budget = await repo.getRedisCommandBudget();
    expect(budget).not.toBeNull();
    expect(budget?.totalCommands).toBe(1000);
    expect(budget?.percentOfBudget).toBe((1000 / UPSTASH_FREE_TIER_DAILY_COMMANDS) * 100);
  });

  it('getRedisCommandBudget returns null on parse failure or missing commandstats', async () => {
    const pool = createFakePool(() => []);
    const redis = new RedisMock();
    const repo = createAdminRepo(pool as never, redis as never);

    redis.info = async () => {
      throw new Error('INFO command disabled on this instance');
    };

    const budget = await repo.getRedisCommandBudget();
    expect(budget).toBeNull();
  });

  it('formatBytes formats B, KB, MB, GB correctly', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(2048)).toBe('2.00 KB');
    expect(formatBytes(10485760)).toBe('10.00 MB');
    expect(formatBytes(NEON_FREE_TIER_BYTES)).toBe('512.00 MB');
  });
});

describe('AdminRepo - Lockout Management (Requirement 9, Property 6)', () => {
  // Feature: admin-panel, Property 6: Lockout clear is idempotent and reports absence truthfully
  it('Property 6: clearLockout returns true if and only if key existed, false on repeat or missing', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), async (userId) => {
        const pool = createFakePool(() => []);
        const redis = new RedisMock();
        const repo = createAdminRepo(pool as never, redis as never);

        // 1. Initial state: key does not exist
        const initialClear = await repo.clearLockout(userId);
        expect(initialClear).toBe(false);

        // 2. Seed locked marker
        await redis.set(`locked:${userId}`, '1');
        await redis.zadd(`lockout:${userId}`, Date.now(), `${Date.now()}`);

        // 3. Clear: must return true
        const firstClear = await repo.clearLockout(userId);
        expect(firstClear).toBe(true);

        // Keys must now be gone
        const lockedExists = await redis.exists(`locked:${userId}`);
        const lockoutExists = await redis.exists(`lockout:${userId}`);
        expect(lockedExists).toBe(0);
        expect(lockoutExists).toBe(0);

        // 4. Second consecutive call: must return false (idempotent absence)
        const secondClear = await repo.clearLockout(userId);
        expect(secondClear).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('getActiveLockouts lists locked:* keys joined to users', async () => {
    const pool = createFakePool((text, params) => {
      if (text.includes('FROM users') && Array.isArray(params[0])) {
        return [
          { id: 'user-1', email: 'guest1@example.com' },
          { id: 'user-2', email: 'guest2@example.com' },
        ];
      }
      return [];
    });

    const redis = new RedisMock();
    await redis.set('locked:user-1', '1');
    await redis.set('locked:user-2', '1');

    const repo = createAdminRepo(pool as never, redis as never);
    const lockouts = await repo.getActiveLockouts();

    expect(lockouts).toHaveLength(2);
    const user1 = lockouts.find((l) => l.userId === 'user-1');
    expect(user1?.email).toBe('guest1@example.com');
  });
});

describe('AdminRepo - Push Deliveries (Requirement 10)', () => {
  it('getPushDeliveryCounts counts ok, error, and unregistered within window', async () => {
    const pool = createFakePool((text) => {
      if (text.includes('FROM push_delivery_log')) {
        return [
          {
            total: '150',
            ok: '130',
            device_unregistered: '10',
            error: '10',
          },
        ];
      }
      return [];
    });

    const redis = new RedisMock();
    const repo = createAdminRepo(pool as never, redis as never);

    const counts = await repo.getPushDeliveryCounts(24);
    expect(counts).toEqual({
      total: 150,
      ok: 130,
      deviceUnregistered: 10,
      error: 10,
    });
  });

  it('prunePushDeliveryLog executes DELETE older than threshold', async () => {
    const pool = createFakePool((text, params) => {
      if (text.includes('DELETE FROM push_delivery_log') && params[0] === 30) {
        return [{ count: 25 }];
      }
      return [];
    });

    const redis = new RedisMock();
    const repo = createAdminRepo(pool as never, redis as never);

    const pruned = await repo.prunePushDeliveryLog(30);
    expect(pruned).toBe(25);
  });
});

describe('AdminRepo - User Lookup & Session Revocation (Requirement 11, Properties 7 & 8)', () => {
  // Feature: admin-panel, Property 7: User lookup is case-insensitive and non-probing on miss
  it('Property 7: findUserByEmail is case-insensitive and returns null on miss', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 3, maxLength: 10 }).map((s) => `${s.replace(/[^a-zA-Z]/g, 'a')}@test.com`),
        async (email) => {
          const userDb: Record<string, any> = {
            id: 'uuid-1234',
            email: email.toLowerCase(),
            created_at: '2026-01-01T00:00:00Z',
            display_name: 'Test Guest',
            completion_count: '5',
            rating_count: '3',
            note_count: '2',
            friend_count: '1',
            trip_count: '2',
            active_session_count: '1',
          };

          const pool = createFakePool((text, params) => {
            if (text.includes('FROM users u') && text.includes('lower(u.email) = lower($1)')) {
              const queriedEmail = String(params[0]).toLowerCase();
              if (queriedEmail === email.toLowerCase()) {
                return [userDb];
              }
              return [];
            }
            if (text.includes('FROM push_registrations')) {
              return [{ id: 'reg-1', status: 'active', updated_at: '2026-01-02T00:00:00Z' }];
            }
            return [];
          });

          const redis = new RedisMock();
          const repo = createAdminRepo(pool as never, redis as never);

          // 1. Exact match
          const resExact = await repo.findUserByEmail(email);
          expect(resExact).not.toBeNull();
          expect(resExact?.id).toBe(userDb.id);

          // 2. Upper case match
          const resUpper = await repo.findUserByEmail(email.toUpperCase());
          expect(resUpper).not.toBeNull();
          expect(resUpper?.id).toBe(userDb.id);

          // 3. Complete miss
          const resMiss = await repo.findUserByEmail(`nonexistent_${email}`);
          expect(resMiss).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: admin-panel, Property 8: Session revoke is scoped to exactly the target user's un-revoked sessions
  it('Property 8: revokeAllSessions updates un-revoked sessions for target user only', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }), // total target user sessions
        fc.integer({ min: 0, max: 5 }),  // already revoked sessions
        async (totalSessions, alreadyRevoked) => {
          const targetUserId = 'target-user-1';
          const unrevokedCount = Math.max(0, totalSessions - alreadyRevoked);

          const pool = createFakePool((text, params) => {
            if (
              text.includes('UPDATE sessions') &&
              text.includes('revoked_at IS NULL') &&
              params[0] === targetUserId
            ) {
              return [{ count: String(unrevokedCount) }];
            }
            return [];
          });

          const redis = new RedisMock();
          const repo = createAdminRepo(pool as never, redis as never);

          const count = await repo.revokeAllSessions(targetUserId);
          expect(count).toBe(unrevokedCount);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('AdminRepo - Growth Totals & User/Experience Helpers (Requirements 5, 12, 13)', () => {
  it('getGrowthTotals sums across all tables', async () => {
    const pool = createFakePool((text) => {
      if (text.includes('SELECT') && text.includes('total_users')) {
        return [
          {
            total_users: '100',
            total_trips: '25',
            total_completions: '400',
            total_ratings: '350',
            total_friendships: '50',
            total_notes: '80',
            total_food_logs: '90',
          },
        ];
      }
      return [];
    });

    const redis = new RedisMock();
    const repo = createAdminRepo(pool as never, redis as never);

    const totals = await repo.getGrowthTotals();
    expect(totals.totalUsers).toBe(100);
    expect(totals.totalCompletions).toBe(400);
    expect(totals.totalFoodLogs).toBe(90);
  });

  it('getDailyGrowth returns per-day counts', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const pool = createFakePool((text) => {
      if (text.includes('FROM users')) {
        return [{ day: today, count: '5' }];
      }
      if (text.includes('FROM completions')) {
        return [{ day: today, count: '20' }];
      }
      return [];
    });

    const redis = new RedisMock();
    const repo = createAdminRepo(pool as never, redis as never);

    const daily = await repo.getDailyGrowth(7);
    expect(daily).toHaveLength(7);
    const todayRow = daily.find((d) => d.date === today);
    expect(todayRow?.newUsers).toBe(5);
    expect(todayRow?.newCompletions).toBe(20);
  });

  it('getExperience and userExists return truthful results', async () => {
    const pool = createFakePool((text, params) => {
      if (text.includes('FROM experiences') && params[0] === 'exp-exists') {
        return [{ id: 'exp-exists', name: 'Haunted Mansion' }];
      }
      if (text.includes('FROM users') && params[0] === 'user-exists') {
        return [{ exists: true }];
      }
      return [];
    });

    const redis = new RedisMock();
    const repo = createAdminRepo(pool as never, redis as never);

    const exp = await repo.getExperience('exp-exists');
    expect(exp?.name).toBe('Haunted Mansion');

    const expMiss = await repo.getExperience('exp-missing');
    expect(expMiss).toBeNull();

    const uExists = await repo.userExists('user-exists');
    expect(uExists).toBe(true);

    const uMiss = await repo.userExists('user-missing');
    expect(uMiss).toBe(false);
  });
});
