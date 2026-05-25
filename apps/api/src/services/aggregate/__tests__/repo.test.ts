/**
 * Unit tests for the Aggregate_Ratings_Service repository (task 8.3).
 *
 * The repo is exercised against a hand-rolled fake `pg.Pool` that
 * captures every `query()` call and lets each test rig the rows
 * returned for specific SQL substrings. We never connect to a real
 * database; each test is hermetic and deterministic.
 *
 * Coverage focuses on the observable behaviors the design pins on
 * this module:
 *
 *   - updateAggregate:
 *       - opens a transaction, takes the per-experience advisory lock,
 *         reads the current `(sum, count)`, applies updateMeanX10,
 *         UPSERTs the new row, and commits.
 *       - missing aggregate row is treated as `(0, 0)` so the very
 *         first event for an Experience inserts the row.
 *       - rolls back when the UPSERT fails.
 *
 *   - recomputeFromScratch:
 *       - sums and counts every row in `ratings` for the Experience,
 *         applies threshold gating to mean_x10, and UPSERTs.
 *       - even when no ratings exist the row converges to
 *         `(0, 0, NULL)`.
 *
 *   - getAggregate:
 *       - returns null when no row exists.
 *       - maps the row fields onto the public state.
 *
 *   - listExperienceIdsForReconcile:
 *       - issues a UNION over `aggregate_ratings` and `ratings`.
 *
 * Validates: Requirements 10.7 (and supporting 10.1, 10.2, 10.4,
 * 10.8, 10.9 via updateMeanX10).
 */

import { describe, expect, it } from 'vitest';

import { createAggregateRepo } from '../repo.js';

// ---------------------------------------------------------------------------
// Fake pool
// ---------------------------------------------------------------------------

interface FakeCall {
  readonly text: string;
  readonly params: ReadonlyArray<unknown>;
  /** Whether the call ran on the pool itself or an explicit client. */
  readonly via: 'pool' | 'client';
}

interface RiggedResponse {
  readonly rows?: ReadonlyArray<Record<string, unknown>>;
  readonly throw?: Error;
}

type Responder = (call: FakeCall) => RiggedResponse | undefined;

interface FakeClientHandle {
  readonly released: boolean;
}

interface FakePool {
  readonly calls: FakeCall[];
  readonly clients: FakeClientHandle[];
  query(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: ReadonlyArray<Record<string, unknown>> }>;
  connect(): Promise<{
    query(
      text: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<{ rows: ReadonlyArray<Record<string, unknown>> }>;
    release(): void;
  }>;
}

function makePool(responder: Responder = () => undefined): FakePool {
  const calls: FakeCall[] = [];
  const clients: FakeClientHandle[] = [];

  const dispatch = async (
    text: string,
    params: ReadonlyArray<unknown> = [],
    via: 'pool' | 'client',
  ) => {
    const call: FakeCall = { text, params, via };
    calls.push(call);
    const rigged = responder(call);
    if (rigged?.throw) {
      throw rigged.throw;
    }
    return { rows: rigged?.rows ?? [] };
  };

  return {
    calls,
    clients,
    async query(text, params) {
      return dispatch(text, params, 'pool');
    },
    async connect() {
      const handle: { released: boolean } = { released: false };
      clients.push(handle);
      return {
        async query(text, params) {
          if (handle.released) {
            throw new Error('client used after release');
          }
          return dispatch(text, params, 'client');
        },
        release() {
          handle.released = true;
        },
      };
    },
  };
}

const EXP_ID = '00000000-0000-5000-8000-000000000001';

// ---------------------------------------------------------------------------
// updateAggregate
// ---------------------------------------------------------------------------

describe('AggregateRepo.updateAggregate', () => {
  it('runs SELECT/UPSERT inside a transaction guarded by an advisory lock', async () => {
    let upsertCallCount = 0;
    const pool = makePool((call) => {
      if (call.text.includes('SELECT sum_ratings')) {
        // Existing row: sum=10, count=2, mean_x10 still null.
        return { rows: [{ sum: '10', count: 2 }] };
      }
      if (call.text.includes('INSERT INTO aggregate_ratings')) {
        upsertCallCount += 1;
        return {
          rows: [
            {
              experience_id: EXP_ID,
              // After applying (null -> 6): sum=16, count=3, mean_x10 = round(160/3) = 53.
              sum_ratings: 16,
              count_ratings: 3,
              mean_x10: 53,
              updated_at: new Date('2025-01-01T00:00:00Z'),
            },
          ],
        };
      }
      return { rows: [] };
    });
    const repo = createAggregateRepo(pool as never);

    const state = await repo.updateAggregate(EXP_ID, null, 6);

    expect(state).toEqual({
      experienceId: EXP_ID,
      sum: 16,
      count: 3,
      meanX10: 53,
      updatedAt: new Date('2025-01-01T00:00:00Z'),
    });
    expect(upsertCallCount).toBe(1);

    const sql = pool.calls.map((c) => c.text);
    expect(sql[0]).toMatch(/^BEGIN$/);
    expect(sql[1]).toMatch(/pg_advisory_xact_lock\(hashtext\(\$1::text\)::bigint\)/);
    expect(pool.calls[1]?.params).toEqual([EXP_ID]);
    expect(sql[2]).toMatch(/SELECT sum_ratings::bigint AS sum/);
    expect(sql[2]).toMatch(/FOR UPDATE/);
    expect(sql[3]).toMatch(/INSERT INTO aggregate_ratings/);
    expect(sql[3]).toMatch(/ON CONFLICT \(experience_id\) DO UPDATE/);
    expect(sql[4]).toMatch(/^COMMIT$/);

    // The UPSERT carries the new (sum, count, mean_x10) triple.
    expect(pool.calls[3]?.params).toEqual([EXP_ID, 16, 3, 53]);

    // Single client lifecycle: connect once, release once.
    expect(pool.clients).toHaveLength(1);
    expect(pool.clients[0]?.released).toBe(true);
  });

  it('treats a missing row as (0, 0) so the first event inserts', async () => {
    const pool = makePool((call) => {
      if (call.text.includes('SELECT sum_ratings')) {
        return { rows: [] }; // no aggregate row yet
      }
      if (call.text.includes('INSERT INTO aggregate_ratings')) {
        return {
          rows: [
            {
              experience_id: EXP_ID,
              sum_ratings: 7,
              count_ratings: 1,
              mean_x10: null,
              updated_at: new Date('2025-01-02T00:00:00Z'),
            },
          ],
        };
      }
      return { rows: [] };
    });
    const repo = createAggregateRepo(pool as never);

    const state = await repo.updateAggregate(EXP_ID, null, 7);

    expect(state.sum).toBe(7);
    expect(state.count).toBe(1);
    // count < 3 -> mean_x10 stays null (R10.4).
    expect(state.meanX10).toBeNull();
    // The UPSERT should carry the post-update triple.
    const upsertCall = pool.calls.find((c) =>
      c.text.includes('INSERT INTO aggregate_ratings'),
    );
    expect(upsertCall?.params).toEqual([EXP_ID, 7, 1, null]);
  });

  it('rolls back the transaction when the UPSERT fails', async () => {
    const failure = new Error('uniq constraint blew up');
    const pool = makePool((call) => {
      if (call.text.includes('SELECT sum_ratings')) {
        return { rows: [{ sum: '0', count: 0 }] };
      }
      if (call.text.includes('INSERT INTO aggregate_ratings')) {
        return { throw: failure };
      }
      return { rows: [] };
    });
    const repo = createAggregateRepo(pool as never);

    await expect(repo.updateAggregate(EXP_ID, null, 5)).rejects.toBe(failure);

    const sql = pool.calls.map((c) => c.text);
    expect(sql).toContain('ROLLBACK');
    expect(sql).not.toContain('COMMIT');
    expect(pool.clients[0]?.released).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// recomputeFromScratch
// ---------------------------------------------------------------------------

describe('AggregateRepo.recomputeFromScratch', () => {
  it('sums + counts ratings, applies threshold gating, and UPSERTs', async () => {
    const pool = makePool((call) => {
      if (call.text.includes('FROM ratings')) {
        // 4 ratings summing to 28 -> mean = 7.0 -> mean_x10 = 70.
        return { rows: [{ sum: '28', count: '4' }] };
      }
      if (call.text.includes('INSERT INTO aggregate_ratings')) {
        return {
          rows: [
            {
              experience_id: EXP_ID,
              sum_ratings: 28,
              count_ratings: 4,
              mean_x10: 70,
              updated_at: new Date('2025-01-03T00:00:00Z'),
            },
          ],
        };
      }
      return { rows: [] };
    });
    const repo = createAggregateRepo(pool as never);

    const state = await repo.recomputeFromScratch(EXP_ID);

    expect(state).toEqual({
      experienceId: EXP_ID,
      sum: 28,
      count: 4,
      meanX10: 70,
      updatedAt: new Date('2025-01-03T00:00:00Z'),
    });

    const sql = pool.calls.map((c) => c.text);
    expect(sql[0]).toMatch(/^BEGIN$/);
    expect(sql[1]).toMatch(/pg_advisory_xact_lock/);
    expect(sql[2]).toMatch(/FROM ratings\s+WHERE experience_id = \$1/);
    expect(sql[3]).toMatch(/INSERT INTO aggregate_ratings/);
    expect(sql[4]).toMatch(/^COMMIT$/);

    // The UPSERT carries the recomputed triple.
    const upsertCall = pool.calls[3]!;
    expect(upsertCall.params).toEqual([EXP_ID, 28, 4, 70]);
  });

  it('writes (0, 0, null) when no ratings exist', async () => {
    const pool = makePool((call) => {
      if (call.text.includes('FROM ratings')) {
        // COUNT(*) always returns one row; SUM is NULL when empty,
        // which COALESCE coerces to 0.
        return { rows: [{ sum: '0', count: '0' }] };
      }
      if (call.text.includes('INSERT INTO aggregate_ratings')) {
        return {
          rows: [
            {
              experience_id: EXP_ID,
              sum_ratings: 0,
              count_ratings: 0,
              mean_x10: null,
              updated_at: new Date('2025-01-04T00:00:00Z'),
            },
          ],
        };
      }
      return { rows: [] };
    });
    const repo = createAggregateRepo(pool as never);

    const state = await repo.recomputeFromScratch(EXP_ID);

    expect(state.sum).toBe(0);
    expect(state.count).toBe(0);
    expect(state.meanX10).toBeNull();

    const upsertCall = pool.calls.find((c) =>
      c.text.includes('INSERT INTO aggregate_ratings'),
    );
    expect(upsertCall?.params).toEqual([EXP_ID, 0, 0, null]);
  });

  it('rolls back when the recompute UPSERT fails', async () => {
    const failure = new Error('upsert exploded');
    const pool = makePool((call) => {
      if (call.text.includes('FROM ratings')) {
        return { rows: [{ sum: '12', count: '3' }] };
      }
      if (call.text.includes('INSERT INTO aggregate_ratings')) {
        return { throw: failure };
      }
      return { rows: [] };
    });
    const repo = createAggregateRepo(pool as never);

    await expect(repo.recomputeFromScratch(EXP_ID)).rejects.toBe(failure);

    expect(pool.calls.map((c) => c.text)).toContain('ROLLBACK');
    expect(pool.clients[0]?.released).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getAggregate
// ---------------------------------------------------------------------------

describe('AggregateRepo.getAggregate', () => {
  it('returns the row mapped to the public state', async () => {
    const pool = makePool((call) => {
      if (call.text.includes('FROM aggregate_ratings')) {
        return {
          rows: [
            {
              experience_id: EXP_ID,
              sum_ratings: 18,
              count_ratings: 3,
              mean_x10: 60,
              updated_at: new Date('2025-01-05T00:00:00Z'),
            },
          ],
        };
      }
      return { rows: [] };
    });
    const repo = createAggregateRepo(pool as never);

    const state = await repo.getAggregate(EXP_ID);
    expect(state).toEqual({
      experienceId: EXP_ID,
      sum: 18,
      count: 3,
      meanX10: 60,
      updatedAt: new Date('2025-01-05T00:00:00Z'),
    });
    expect(pool.calls).toHaveLength(1);
    expect(pool.calls[0]?.params).toEqual([EXP_ID]);
  });

  it('returns null when no row exists', async () => {
    const pool = makePool(() => ({ rows: [] }));
    const repo = createAggregateRepo(pool as never);
    expect(await repo.getAggregate(EXP_ID)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// listExperienceIdsForReconcile
// ---------------------------------------------------------------------------

describe('AggregateRepo.listExperienceIdsForReconcile', () => {
  it('issues a UNION over aggregate_ratings and ratings', async () => {
    const pool = makePool((call) => {
      if (call.text.includes('UNION')) {
        return {
          rows: [
            { experience_id: 'exp-a' },
            { experience_id: 'exp-b' },
            { experience_id: 'exp-c' },
          ],
        };
      }
      return { rows: [] };
    });
    const repo = createAggregateRepo(pool as never);

    const ids = await repo.listExperienceIdsForReconcile();
    expect(ids).toEqual(['exp-a', 'exp-b', 'exp-c']);

    const sql = pool.calls[0]?.text ?? '';
    expect(sql).toMatch(/FROM aggregate_ratings/);
    expect(sql).toMatch(/FROM ratings/);
    expect(sql).toMatch(/UNION/);
    expect(sql).toMatch(/ORDER BY experience_id ASC/);
  });
});
