/**
 * Unit tests for the Completion repo (task 10.1).
 *
 * Exercises the repo against a hand-rolled fake `pg.Pool` so the SQL
 * shape, parameter ordering, and result handling are pinned down without
 * a live database. The fake drives the repo through every branch:
 *
 *   - `mark`     happy path (INSERT...RETURNING),
 *   - `mark`     PK collision → returns null,
 *   - `edit`     happy path (UPDATE...RETURNING),
 *   - `edit`     no-row     → returns null,
 *   - `unmark`   row-deleted → returns true,
 *   - `unmark`   no-row     → returns false.
 */

import { describe, expect, it } from 'vitest';

import { createCompletionRepo } from '../repo.js';

interface FakeCall {
  text: string;
  params: ReadonlyArray<unknown>;
}

interface FakeQueryResult {
  rows: unknown[];
  rowCount?: number;
}

function makePool(
  responder: (call: FakeCall) => FakeQueryResult | Error,
): {
  calls: FakeCall[];
  query: (text: string, params?: ReadonlyArray<unknown>) => Promise<FakeQueryResult>;
  connect: () => Promise<{
    query: (text: string, params?: ReadonlyArray<unknown>) => Promise<FakeQueryResult>;
    release: () => void;
  }>;
  readonly releasedCount: number;
} {
  const calls: FakeCall[] = [];
  let releasedCount = 0;
  const query = async (text: string, params: ReadonlyArray<unknown> = []): Promise<FakeQueryResult> => {
    const call: FakeCall = { text, params };
    calls.push(call);
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
      return { rows: [] };
    }
    const result = responder(call);
    if (result instanceof Error) throw result;
    return result;
  };
  return {
    calls,
    query,
    connect: async () => ({
      query,
      release: () => {
        releasedCount++;
      },
    }),
    get releasedCount() {
      return releasedCount;
    },
  };
}

const USER_ID = '11111111-1111-4111-8111-111111111111';
const EXPERIENCE_ID = '22222222-2222-4222-8222-222222222222';

describe('CompletionRepo.mark', () => {
  it('inserts into completions and dual-writes into experience_logs inside a transaction', async () => {
    const pool = makePool((call) => {
      if (call.text.startsWith('INSERT INTO completions')) {
        expect(call.params).toEqual([
          USER_ID,
          EXPERIENCE_ID,
          '2024-06-14',
          'America/New_York',
        ]);
        return {
          rows: [
            {
              user_id: USER_ID,
              experience_id: EXPERIENCE_ID,
              completed_on: '2024-06-14',
              user_tz: 'America/New_York',
            },
          ],
        };
      }
      if (call.text.startsWith('INSERT INTO experience_logs')) {
        expect(call.params).toEqual([
          USER_ID,
          EXPERIENCE_ID,
          '2024-06-14',
          'America/New_York',
        ]);
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${call.text}`);
    });
    const repo = createCompletionRepo(
      pool as unknown as Parameters<typeof createCompletionRepo>[0],
    );

    const dto = await repo.mark({
      userId: USER_ID,
      experienceId: EXPERIENCE_ID,
      completedOn: '2024-06-14',
      userTz: 'America/New_York',
    });

    expect(dto).toEqual({
      userId: USER_ID,
      experienceId: EXPERIENCE_ID,
      completedOn: '2024-06-14',
      userTz: 'America/New_York',
    });
    expect(pool.calls.map((c) => c.text.split(' ')[0])).toEqual([
      'BEGIN',
      'INSERT',
      'INSERT',
      'COMMIT',
    ]);
    expect(pool.releasedCount).toBe(1);
  });

  it('rolls back and returns null on a PK collision (SQLSTATE 23505)', async () => {
    const pool = makePool((call) => {
      if (call.text.startsWith('INSERT INTO completions')) {
        const err = new Error('duplicate key') as Error & { code?: string };
        err.code = '23505';
        return err;
      }
      throw new Error(`Unexpected query: ${call.text}`);
    });
    const repo = createCompletionRepo(
      pool as unknown as Parameters<typeof createCompletionRepo>[0],
    );

    const dto = await repo.mark({
      userId: USER_ID,
      experienceId: EXPERIENCE_ID,
      completedOn: '2024-06-14',
      userTz: 'America/New_York',
    });

    expect(dto).toBeNull();
    expect(pool.calls.map((c) => c.text.split(' ')[0])).toEqual([
      'BEGIN',
      'INSERT',
      'ROLLBACK',
    ]);
    expect(pool.releasedCount).toBe(1);
  });

  it('rolls back and re-throws when experience_logs insert fails', async () => {
    const pool = makePool((call) => {
      if (call.text.startsWith('INSERT INTO completions')) {
        return {
          rows: [
            {
              user_id: USER_ID,
              experience_id: EXPERIENCE_ID,
              completed_on: '2024-06-14',
              user_tz: 'America/New_York',
            },
          ],
        };
      }
      if (call.text.startsWith('INSERT INTO experience_logs')) {
        return new Error('disk full');
      }
      throw new Error(`Unexpected query: ${call.text}`);
    });
    const repo = createCompletionRepo(
      pool as unknown as Parameters<typeof createCompletionRepo>[0],
    );

    await expect(
      repo.mark({
        userId: USER_ID,
        experienceId: EXPERIENCE_ID,
        completedOn: '2024-06-14',
        userTz: 'America/New_York',
      }),
    ).rejects.toThrow('disk full');

    expect(pool.calls.map((c) => c.text.split(' ')[0])).toEqual([
      'BEGIN',
      'INSERT',
      'INSERT',
      'ROLLBACK',
    ]);
    expect(pool.releasedCount).toBe(1);
  });

  it('serializes a Date column value back to YYYY-MM-DD', async () => {
    const pool = makePool((call) => {
      if (call.text.startsWith('INSERT INTO completions')) {
        return {
          rows: [
            {
              user_id: USER_ID,
              experience_id: EXPERIENCE_ID,
              completed_on: new Date('2024-06-14T00:00:00Z'),
              user_tz: 'America/New_York',
            },
          ],
        };
      }
      return { rows: [] };
    });
    const repo = createCompletionRepo(
      pool as unknown as Parameters<typeof createCompletionRepo>[0],
    );

    const dto = await repo.mark({
      userId: USER_ID,
      experienceId: EXPERIENCE_ID,
      completedOn: '2024-06-14',
      userTz: 'America/New_York',
    });

    expect(dto?.completedOn).toBe('2024-06-14');
  });
});

describe('CompletionRepo.edit', () => {
  it('updates completions and syncs matching unannotated experience_logs row inside a transaction', async () => {
    const pool = makePool((call) => {
      if (call.text.startsWith('SELECT completed_on')) {
        expect(call.text).toContain('FOR UPDATE');
        return {
          rows: [{ completed_on: '2024-06-10' }],
        };
      }
      if (call.text.startsWith('UPDATE completions')) {
        return {
          rows: [
            {
              user_id: USER_ID,
              experience_id: EXPERIENCE_ID,
              completed_on: '2024-06-15',
              user_tz: 'America/New_York',
            },
          ],
        };
      }
      if (call.text.startsWith('UPDATE experience_logs')) {
        expect(call.params).toEqual([
          USER_ID,
          EXPERIENCE_ID,
          '2024-06-15',
          'America/New_York',
          '2024-06-10',
        ]);
        expect(call.text).toContain('rating IS NULL');
        expect(call.text).toContain('note IS NULL');
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${call.text}`);
    });
    const repo = createCompletionRepo(
      pool as unknown as Parameters<typeof createCompletionRepo>[0],
    );

    const dto = await repo.edit({
      userId: USER_ID,
      experienceId: EXPERIENCE_ID,
      completedOn: '2024-06-15',
      userTz: 'America/New_York',
    });

    expect(dto?.completedOn).toBe('2024-06-15');
    expect(pool.calls.map((c) => c.text.split(' ')[0])).toEqual([
      'BEGIN',
      'SELECT',
      'UPDATE',
      'UPDATE',
      'COMMIT',
    ]);
    expect(pool.releasedCount).toBe(1);
  });

  it('returns null and rolls back when no completion row matches', async () => {
    const pool = makePool((call) => {
      if (call.text.startsWith('SELECT completed_on')) {
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${call.text}`);
    });
    const repo = createCompletionRepo(
      pool as unknown as Parameters<typeof createCompletionRepo>[0],
    );

    const dto = await repo.edit({
      userId: USER_ID,
      experienceId: EXPERIENCE_ID,
      completedOn: '2024-06-10',
      userTz: 'America/New_York',
    });

    expect(dto).toBeNull();
    expect(pool.calls.map((c) => c.text.split(' ')[0])).toEqual([
      'BEGIN',
      'SELECT',
      'ROLLBACK',
    ]);
    expect(pool.releasedCount).toBe(1);
  });

  it('rolls back and re-throws when experience_logs sync query fails', async () => {
    const pool = makePool((call) => {
      if (call.text.startsWith('SELECT completed_on')) {
        return { rows: [{ completed_on: '2024-06-10' }] };
      }
      if (call.text.startsWith('UPDATE completions')) {
        return {
          rows: [
            {
              user_id: USER_ID,
              experience_id: EXPERIENCE_ID,
              completed_on: '2024-06-15',
              user_tz: 'America/New_York',
            },
          ],
        };
      }
      if (call.text.startsWith('UPDATE experience_logs')) {
        return new Error('connection closed');
      }
      throw new Error(`Unexpected query: ${call.text}`);
    });
    const repo = createCompletionRepo(
      pool as unknown as Parameters<typeof createCompletionRepo>[0],
    );

    await expect(
      repo.edit({
        userId: USER_ID,
        experienceId: EXPERIENCE_ID,
        completedOn: '2024-06-15',
        userTz: 'America/New_York',
      }),
    ).rejects.toThrow('connection closed');

    expect(pool.calls.map((c) => c.text.split(' ')[0])).toEqual([
      'BEGIN',
      'SELECT',
      'UPDATE',
      'UPDATE',
      'ROLLBACK',
    ]);
    expect(pool.releasedCount).toBe(1);
  });
});

describe('CompletionRepo.unmark', () => {
  it('deletes completions and deletes matching unannotated experience_logs row inside a transaction', async () => {
    const pool = makePool((call) => {
      if (call.text.startsWith('DELETE FROM completions')) {
        expect(call.text).toContain('RETURNING completed_on');
        return { rows: [{ completed_on: '2024-06-14' }], rowCount: 1 };
      }
      if (call.text.startsWith('DELETE FROM experience_logs')) {
        expect(call.params).toEqual([USER_ID, EXPERIENCE_ID, '2024-06-14']);
        expect(call.text).toContain('rating IS NULL');
        expect(call.text).toContain('note IS NULL');
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${call.text}`);
    });
    const repo = createCompletionRepo(
      pool as unknown as Parameters<typeof createCompletionRepo>[0],
    );

    const removed = await repo.unmark({
      userId: USER_ID,
      experienceId: EXPERIENCE_ID,
    });

    expect(removed).toBe(true);
    expect(pool.calls.map((c) => c.text.split(' ')[0])).toEqual([
      'BEGIN',
      'DELETE',
      'DELETE',
      'COMMIT',
    ]);
    expect(pool.releasedCount).toBe(1);
  });

  it('returns false and rolls back when no completions row matched', async () => {
    const pool = makePool((call) => {
      if (call.text.startsWith('DELETE FROM completions')) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected query: ${call.text}`);
    });
    const repo = createCompletionRepo(
      pool as unknown as Parameters<typeof createCompletionRepo>[0],
    );

    const removed = await repo.unmark({
      userId: USER_ID,
      experienceId: EXPERIENCE_ID,
    });

    expect(removed).toBe(false);
    expect(pool.calls.map((c) => c.text.split(' ')[0])).toEqual([
      'BEGIN',
      'DELETE',
      'ROLLBACK',
    ]);
    expect(pool.releasedCount).toBe(1);
  });

  it('rolls back and re-throws when log deletion query fails', async () => {
    const pool = makePool((call) => {
      if (call.text.startsWith('DELETE FROM completions')) {
        return { rows: [{ completed_on: '2024-06-14' }], rowCount: 1 };
      }
      if (call.text.startsWith('DELETE FROM experience_logs')) {
        return new Error('db failure');
      }
      throw new Error(`Unexpected query: ${call.text}`);
    });
    const repo = createCompletionRepo(
      pool as unknown as Parameters<typeof createCompletionRepo>[0],
    );

    await expect(
      repo.unmark({
        userId: USER_ID,
        experienceId: EXPERIENCE_ID,
      }),
    ).rejects.toThrow('db failure');

    expect(pool.calls.map((c) => c.text.split(' ')[0])).toEqual([
      'BEGIN',
      'DELETE',
      'DELETE',
      'ROLLBACK',
    ]);
    expect(pool.releasedCount).toBe(1);
  });
});

describe('CompletionRepo.getCompletion', () => {
  it('selects and returns the persisted DTO when a row exists', async () => {
    const pool = makePool((call) => {
      expect(call.text).toMatch(/^SELECT user_id, experience_id, completed_on, user_tz/);
      expect(call.params).toEqual([USER_ID, EXPERIENCE_ID]);
      return {
        rows: [
          {
            user_id: USER_ID,
            experience_id: EXPERIENCE_ID,
            completed_on: '2024-06-14',
            user_tz: 'America/New_York',
          },
        ],
      };
    });
    const repo = createCompletionRepo(
      pool as unknown as Parameters<typeof createCompletionRepo>[0],
    );

    const dto = await repo.getCompletion(USER_ID, EXPERIENCE_ID);

    expect(dto).toEqual({
      userId: USER_ID,
      experienceId: EXPERIENCE_ID,
      completedOn: '2024-06-14',
      userTz: 'America/New_York',
    });
  });

  it('serializes a Date column value back to YYYY-MM-DD', async () => {
    const pool = makePool(() => ({
      rows: [
        {
          user_id: USER_ID,
          experience_id: EXPERIENCE_ID,
          completed_on: new Date('2024-06-14T00:00:00Z'),
          user_tz: 'America/New_York',
        },
      ],
    }));
    const repo = createCompletionRepo(
      pool as unknown as Parameters<typeof createCompletionRepo>[0],
    );

    const dto = await repo.getCompletion(USER_ID, EXPERIENCE_ID);

    expect(dto?.completedOn).toBe('2024-06-14');
  });

  it('returns null when no row matches the (user, experience) pair', async () => {
    const pool = makePool(() => ({ rows: [] }));
    const repo = createCompletionRepo(
      pool as unknown as Parameters<typeof createCompletionRepo>[0],
    );

    const dto = await repo.getCompletion(USER_ID, EXPERIENCE_ID);

    expect(dto).toBeNull();
  });
});
