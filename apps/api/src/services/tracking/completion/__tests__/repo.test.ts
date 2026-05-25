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
): { calls: FakeCall[]; query: (text: string, params?: ReadonlyArray<unknown>) => Promise<FakeQueryResult> } {
  const calls: FakeCall[] = [];
  return {
    calls,
    async query(text: string, params: ReadonlyArray<unknown> = []): Promise<FakeQueryResult> {
      const call: FakeCall = { text, params };
      calls.push(call);
      const result = responder(call);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

const USER_ID = '11111111-1111-4111-8111-111111111111';
const EXPERIENCE_ID = '22222222-2222-4222-8222-222222222222';

describe('CompletionRepo.mark', () => {
  it('inserts and returns the persisted DTO on success', async () => {
    const pool = makePool((call) => {
      expect(call.text).toMatch(/^INSERT INTO completions/);
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
  });

  it('returns null on a PK collision (SQLSTATE 23505)', async () => {
    const pool = makePool(() => {
      const err = new Error('duplicate key') as Error & { code?: string };
      err.code = '23505';
      return err;
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
  });

  it('serializes a Date column value back to YYYY-MM-DD', async () => {
    // `pg`'s default DATE parser returns a JS Date pinned to UTC midnight;
    // the repo must format that back to the wire date string.
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
  it('updates and returns the new DTO on success', async () => {
    const pool = makePool((call) => {
      expect(call.text).toMatch(/^UPDATE completions/);
      return {
        rows: [
          {
            user_id: USER_ID,
            experience_id: EXPERIENCE_ID,
            completed_on: '2024-06-10',
            user_tz: 'America/New_York',
          },
        ],
      };
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

    expect(dto?.completedOn).toBe('2024-06-10');
  });

  it('returns null when no row matches the (user, experience) pair', async () => {
    const pool = makePool(() => ({ rows: [] }));
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
  });
});

describe('CompletionRepo.unmark', () => {
  it('returns true when a row was deleted', async () => {
    const pool = makePool((call) => {
      expect(call.text).toMatch(/^DELETE FROM completions/);
      return { rows: [], rowCount: 1 };
    });
    const repo = createCompletionRepo(
      pool as unknown as Parameters<typeof createCompletionRepo>[0],
    );

    const removed = await repo.unmark({
      userId: USER_ID,
      experienceId: EXPERIENCE_ID,
    });

    expect(removed).toBe(true);
  });

  it('returns false when no row matched', async () => {
    const pool = makePool(() => ({ rows: [], rowCount: 0 }));
    const repo = createCompletionRepo(
      pool as unknown as Parameters<typeof createCompletionRepo>[0],
    );

    const removed = await repo.unmark({
      userId: USER_ID,
      experienceId: EXPERIENCE_ID,
    });

    expect(removed).toBe(false);
  });
});
