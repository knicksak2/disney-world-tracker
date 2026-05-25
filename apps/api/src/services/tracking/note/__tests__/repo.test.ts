/**
 * Unit tests for the Note repository (task 10.3).
 *
 * The repo is exercised against an in-memory fake `pg.Pool` that captures
 * each query's SQL text and parameters and serves rigged rows. We cover:
 *
 *   - `upsertNote` issues a single INSERT...ON CONFLICT DO UPDATE keyed on
 *     `(user_id, experience_id)` and projects the RETURNING row to the
 *     shared `NoteDTO` shape, including the ISO-8601 `updatedAt` (R5.1,
 *     R5.3, R5.4, R5.5).
 *   - `deleteNote` returns `true` when a row was removed, `false` when
 *     `rowCount` is zero so the route can map the latter to 404
 *     `note_not_found` (R5.6, R5.7).
 *   - `getNote` returns `null` when no row matches.
 *
 * The fake captures every call so we can also assert the table name and
 * parameter ordering match the migration's `notes` schema.
 */

import { describe, expect, it } from 'vitest';

import type { DbPool } from '../../../../db/pool.js';
import { createNoteRepo } from '../repo.js';

interface FakeCall {
  readonly text: string;
  readonly params: ReadonlyArray<unknown>;
}

interface FakePool {
  readonly calls: FakeCall[];
  query: (
    text: string,
    params?: ReadonlyArray<unknown>,
  ) => Promise<{ rows: unknown[]; rowCount: number | null }>;
}

function makePool(
  responder: (call: FakeCall) => { rows: unknown[]; rowCount?: number | null },
): FakePool {
  const calls: FakeCall[] = [];
  return {
    calls,
    async query(text, params = []) {
      const call: FakeCall = { text, params };
      calls.push(call);
      const response = responder(call);
      return {
        rows: response.rows,
        rowCount: response.rowCount ?? response.rows.length,
      };
    },
  };
}

const USER_ID = '11111111-1111-4111-8111-111111111111';
const EXPERIENCE_ID = '22222222-2222-4222-8222-222222222222';

describe('createNoteRepo.upsertNote', () => {
  it('issues an INSERT...ON CONFLICT DO UPDATE and returns a NoteDTO', async () => {
    const updatedAt = new Date('2024-06-01T12:00:00.000Z');
    const pool = makePool((call) => {
      expect(call.text).toContain('INSERT INTO notes');
      expect(call.text).toContain('ON CONFLICT (user_id, experience_id)');
      expect(call.text).toContain('DO UPDATE');
      expect(call.text).toContain('RETURNING');
      return {
        rows: [
          {
            user_id: USER_ID,
            experience_id: EXPERIENCE_ID,
            body: 'rad ride',
            updated_at: updatedAt,
          },
        ],
      };
    });

    const repo = createNoteRepo(pool as unknown as DbPool);
    const dto = await repo.upsertNote(USER_ID, EXPERIENCE_ID, 'rad ride');

    expect(dto).toEqual({
      userId: USER_ID,
      experienceId: EXPERIENCE_ID,
      body: 'rad ride',
      updatedAt: '2024-06-01T12:00:00.000Z',
    });
    expect(pool.calls).toHaveLength(1);
    expect(pool.calls[0]?.params).toEqual([USER_ID, EXPERIENCE_ID, 'rad ride']);
  });
});

describe('createNoteRepo.deleteNote', () => {
  it('returns true when a row was removed (rowCount > 0)', async () => {
    const pool = makePool((call) => {
      expect(call.text).toContain('DELETE FROM notes');
      expect(call.text).toContain('WHERE user_id = $1');
      expect(call.text).toContain('experience_id = $2');
      return { rows: [], rowCount: 1 };
    });
    const repo = createNoteRepo(pool as unknown as DbPool);

    const removed = await repo.deleteNote(USER_ID, EXPERIENCE_ID);

    expect(removed).toBe(true);
    expect(pool.calls[0]?.params).toEqual([USER_ID, EXPERIENCE_ID]);
  });

  it('returns false when no row was removed (rowCount === 0)', async () => {
    const pool = makePool(() => ({ rows: [], rowCount: 0 }));
    const repo = createNoteRepo(pool as unknown as DbPool);

    const removed = await repo.deleteNote(USER_ID, EXPERIENCE_ID);

    expect(removed).toBe(false);
  });

  it('returns false when rowCount is null (defensive against driver shape changes)', async () => {
    const pool = makePool(() => ({ rows: [], rowCount: null }));
    const repo = createNoteRepo(pool as unknown as DbPool);

    const removed = await repo.deleteNote(USER_ID, EXPERIENCE_ID);

    expect(removed).toBe(false);
  });
});

describe('createNoteRepo.getNote', () => {
  it('returns null when no row matches', async () => {
    const pool = makePool(() => ({ rows: [] }));
    const repo = createNoteRepo(pool as unknown as DbPool);

    const dto = await repo.getNote(USER_ID, EXPERIENCE_ID);

    expect(dto).toBeNull();
  });

  it('returns the NoteDTO when a row matches', async () => {
    const updatedAt = new Date('2024-06-02T08:30:00.000Z');
    const pool = makePool(() => ({
      rows: [
        {
          user_id: USER_ID,
          experience_id: EXPERIENCE_ID,
          body: 'fave',
          updated_at: updatedAt,
        },
      ],
    }));
    const repo = createNoteRepo(pool as unknown as DbPool);

    const dto = await repo.getNote(USER_ID, EXPERIENCE_ID);

    expect(dto).toEqual({
      userId: USER_ID,
      experienceId: EXPERIENCE_ID,
      body: 'fave',
      updatedAt: '2024-06-02T08:30:00.000Z',
    });
  });
});
