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
    expect(pool.calls[0]?.params).toEqual([
      USER_ID,
      EXPERIENCE_ID,
      'rad ride',
      null,
    ]);
  });
});

describe('createNoteRepo.upsertNote — shareable write path (R4.6, R4.7)', () => {
  // The repo encodes the "default private / preserve-on-omit" rule entirely
  // in SQL: it binds `shareable ?? null` to $4 and lets `COALESCE($4, FALSE)`
  // (insert) / `COALESCE($4, notes.shareable)` (conflict) decide the stored
  // value. These tests pin both halves: the bound parameter and the COALESCE
  // expressions that consume it.

  it('binds null for $4 and uses COALESCE so a new Note defaults to FALSE when shareable is omitted', async () => {
    const updatedAt = new Date('2024-06-01T12:00:00.000Z');
    const pool = makePool((call) => {
      // The insert branch defaults an omitted flag to FALSE.
      expect(call.text).toContain('COALESCE($4, FALSE)');
      return {
        rows: [
          {
            user_id: USER_ID,
            experience_id: EXPERIENCE_ID,
            body: 'new note',
            shareable: false,
            updated_at: updatedAt,
          },
        ],
      };
    });
    const repo = createNoteRepo(pool as unknown as DbPool);

    const dto = await repo.upsertNote(USER_ID, EXPERIENCE_ID, 'new note');

    // $4 is null (not `false`) so the SQL COALESCE — not the caller — decides
    // the default, keeping insert (FALSE) and edit (preserve) behavior in SQL.
    expect(pool.calls[0]?.params[3]).toBeNull();
    expect(dto.shareable).toBe(false);
  });

  it('binds true for $4 so an explicit shareable:true persists', async () => {
    const updatedAt = new Date('2024-06-01T12:00:00.000Z');
    const pool = makePool(() => ({
      rows: [
        {
          user_id: USER_ID,
          experience_id: EXPERIENCE_ID,
          body: 'shared note',
          shareable: true,
          updated_at: updatedAt,
        },
      ],
    }));
    const repo = createNoteRepo(pool as unknown as DbPool);

    const dto = await repo.upsertNote(USER_ID, EXPERIENCE_ID, 'shared note', true);

    expect(pool.calls[0]?.params).toEqual([
      USER_ID,
      EXPERIENCE_ID,
      'shared note',
      true,
    ]);
    expect(dto.shareable).toBe(true);
  });

  it('binds false for $4 so an explicit shareable:false persists', async () => {
    const updatedAt = new Date('2024-06-01T12:00:00.000Z');
    const pool = makePool(() => ({
      rows: [
        {
          user_id: USER_ID,
          experience_id: EXPERIENCE_ID,
          body: 'made private',
          shareable: false,
          updated_at: updatedAt,
        },
      ],
    }));
    const repo = createNoteRepo(pool as unknown as DbPool);

    const dto = await repo.upsertNote(
      USER_ID,
      EXPERIENCE_ID,
      'made private',
      false,
    );

    expect(pool.calls[0]?.params[3]).toBe(false);
    expect(dto.shareable).toBe(false);
  });

  it('binds null for $4 and uses COALESCE(..., notes.shareable) so editing without shareable preserves the prior value', async () => {
    // Simulate an edit (ON CONFLICT) that keeps a previously-stored
    // shareable=true: the caller omits the flag, $4 is null, and the conflict
    // branch's COALESCE($4, notes.shareable) keeps the existing value, which
    // the rigged RETURNING row reflects.
    const updatedAt = new Date('2024-06-03T09:15:00.000Z');
    const pool = makePool((call) => {
      expect(call.text).toContain('COALESCE($4, notes.shareable)');
      return {
        rows: [
          {
            user_id: USER_ID,
            experience_id: EXPERIENCE_ID,
            body: 'edited body only',
            shareable: true, // preserved prior value, not flipped to FALSE
            updated_at: updatedAt,
          },
        ],
      };
    });
    const repo = createNoteRepo(pool as unknown as DbPool);

    const dto = await repo.upsertNote(
      USER_ID,
      EXPERIENCE_ID,
      'edited body only',
    );

    expect(pool.calls[0]?.params[3]).toBeNull();
    expect(dto.shareable).toBe(true);
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
