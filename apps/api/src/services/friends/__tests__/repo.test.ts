/**
 * Unit tests for the Friends_Service repository (task 7.2).
 *
 * Drives `createFriendsRepo` against a fake pool that records every SQL
 * call and routes responses by predicate matchers. Each test focuses on
 * a single repo method so failures map cleanly to a requirement.
 *
 * Coverage focuses on the requirements scoped to this task:
 *   - R8.1: searchUsers excludes the requester, ILIKEs both columns, caps results at 50
 *   - R8.7: sendRequest rejects existing friendship and same/reverse direction request
 *   - R8.8: sendRequest rejects self-target before any DB I/O
 *   - R8.10: sendRequest rejects unknown recipient
 *   - R8.7 (race): sendRequest translates a unique-violation into friend_duplicate_relationship
 *   - R8.4 + R8.6: acceptRequest INSERTs the canonical friendship and DELETEs the request
 *   - R8.4 (recipient gating): acceptRequest returns null when no matching request exists
 *   - R8.5: declineRequest deletes by id+recipient and reports rowCount
 *   - R8.6 + R8.11: removeFriend deletes the canonical pair and reports rowCount
 *   - R8.11 (self): removeFriend short-circuits to false on self-target
 *   - R8.9: listFriendsAndRequests bundles all three projections
 */

import { describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { createFriendsRepo } from '../repo.js';

// ---------------------------------------------------------------------------
// Fake pool
// ---------------------------------------------------------------------------

interface FakeCall {
  readonly text: string;
  readonly params: ReadonlyArray<unknown>;
}

interface QueryResponse {
  readonly rows: ReadonlyArray<unknown>;
  readonly rowCount?: number;
}

type Responder = (call: FakeCall) => QueryResponse | Error;

interface FakePool {
  readonly calls: FakeCall[];
  query(text: string, params?: ReadonlyArray<unknown>): Promise<QueryResponse>;
  connect(): Promise<{
    query(text: string, params?: ReadonlyArray<unknown>): Promise<QueryResponse>;
    release(): void;
  }>;
}

function makePool(responder: Responder): FakePool {
  const calls: FakeCall[] = [];
  const run = async (
    text: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<QueryResponse> => {
    const call: FakeCall = { text, params };
    calls.push(call);
    const result = responder(call);
    if (result instanceof Error) {
      throw result;
    }
    return result;
  };
  return {
    calls,
    query: run,
    async connect() {
      return {
        query: run,
        release: () => undefined,
      };
    },
  };
}

function asPool(pool: FakePool): DbPool {
  return pool as unknown as DbPool;
}

const REQUESTER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';

// ===========================================================================
// searchUsers (R8.1, R8.2)
// ===========================================================================

describe('searchUsers', () => {
  it('runs an ILIKE on both display_name and email, excludes the requester, and caps at 50 (R8.1)', async () => {
    const pool = makePool(() => ({
      rows: [
        {
          id: OTHER,
          display_name: 'Goofy',
          email: 'goofy@example.com',
        },
      ],
    }));
    const repo = createFriendsRepo(asPool(pool));

    const results = await repo.searchUsers(REQUESTER, 'goof');

    expect(results).toEqual([
      { id: OTHER, displayName: 'Goofy', email: 'goofy@example.com' },
    ]);
    expect(pool.calls).toHaveLength(1);
    const call = pool.calls[0]!;
    expect(call.text).toContain('ILIKE');
    expect(call.text).toContain('display_name');
    expect(call.text).toContain('email::text');
    expect(call.text).toContain('u.id <> $1');
    expect(call.text).toContain('LIMIT $3');
    // Requester id, the like pattern, and the 50 cap.
    expect(call.params[0]).toBe(REQUESTER);
    expect(call.params[1]).toBe('%goof%');
    expect(call.params[2]).toBe(50);
  });

  it('escapes SQL LIKE wildcards in the user-supplied query', async () => {
    const pool = makePool(() => ({ rows: [] }));
    const repo = createFriendsRepo(asPool(pool));

    await repo.searchUsers(REQUESTER, '%_\\');

    const params = pool.calls[0]!.params;
    // `%`, `_`, and `\` must each be escaped with a leading backslash so
    // the surrounding `%...%` wildcards remain the only wildcards in the
    // ILIKE pattern.
    expect(params[1]).toBe('%\\%\\_\\\\%');
  });

  it('clamps an oversized custom limit at the 50-row hard cap', async () => {
    const pool = makePool(() => ({ rows: [] }));
    const repo = createFriendsRepo(asPool(pool));

    await repo.searchUsers(REQUESTER, 'q', 999);

    expect(pool.calls[0]!.params[2]).toBe(50);
  });
});

// ===========================================================================
// sendRequest (R8.3, R8.7, R8.8, R8.10)
// ===========================================================================

describe('sendRequest', () => {
  it('rejects self-target before any DB I/O (R8.8)', async () => {
    const pool = makePool(() => {
      throw new Error('should not reach the pool');
    });
    const repo = createFriendsRepo(asPool(pool));

    await expect(repo.sendRequest(REQUESTER, REQUESTER)).rejects.toBeInstanceOf(
      AppError,
    );
    await expect(repo.sendRequest(REQUESTER, REQUESTER)).rejects.toMatchObject({
      code: 'friend_self_target',
      field: 'recipientId',
    });
    expect(pool.calls).toHaveLength(0);
  });

  it('rejects an unknown recipient with friend_recipient_unknown (R8.10)', async () => {
    const pool = makePool((call) => {
      if (call.text === 'BEGIN' || call.text === 'ROLLBACK') return { rows: [] };
      // Recipient lookup returns no rows.
      if (call.text.includes('FROM users WHERE id =')) return { rows: [] };
      throw new Error(`unexpected SQL: ${call.text}`);
    });
    const repo = createFriendsRepo(asPool(pool));

    await expect(repo.sendRequest(REQUESTER, OTHER)).rejects.toMatchObject({
      code: 'friend_recipient_unknown',
    });
    // We did open a transaction and roll it back.
    expect(pool.calls.map((c) => c.text)).toContain('BEGIN');
    expect(pool.calls.map((c) => c.text)).toContain('ROLLBACK');
  });

  it('rejects an existing friendship with friend_duplicate_relationship (R8.7)', async () => {
    const pool = makePool((call) => {
      if (call.text === 'BEGIN' || call.text === 'ROLLBACK') return { rows: [] };
      if (call.text.includes('FROM users WHERE id =')) {
        return { rows: [{ id: OTHER }] };
      }
      if (call.text.includes('FROM friendships')) {
        return { rows: [{ exists: true }] };
      }
      throw new Error(`unexpected SQL: ${call.text}`);
    });
    const repo = createFriendsRepo(asPool(pool));

    await expect(repo.sendRequest(REQUESTER, OTHER)).rejects.toMatchObject({
      code: 'friend_duplicate_relationship',
    });
  });

  it('rejects a same- or reverse-direction pending request with friend_duplicate_relationship (R8.7)', async () => {
    const pool = makePool((call) => {
      if (call.text === 'BEGIN' || call.text === 'ROLLBACK') return { rows: [] };
      if (call.text.includes('FROM users WHERE id =')) {
        return { rows: [{ id: OTHER }] };
      }
      if (call.text.includes('FROM friendships')) {
        return { rows: [{ exists: false }] };
      }
      if (call.text.includes('FROM friend_requests')) {
        // Both same-direction and reverse-direction pending requests trip
        // the same error code; the SELECT covers both with an OR clause.
        return { rows: [{ exists: true }] };
      }
      throw new Error(`unexpected SQL: ${call.text}`);
    });
    const repo = createFriendsRepo(asPool(pool));

    await expect(repo.sendRequest(REQUESTER, OTHER)).rejects.toMatchObject({
      code: 'friend_duplicate_relationship',
    });
  });

  it('inserts the new request and returns the persisted DTO on success (R8.3)', async () => {
    const createdAt = new Date('2024-05-01T00:00:00.000Z');
    const pool = makePool((call) => {
      if (call.text === 'BEGIN' || call.text === 'COMMIT' || call.text === 'ROLLBACK') {
        return { rows: [] };
      }
      if (call.text.includes('FROM users WHERE id =')) {
        return { rows: [{ id: OTHER }] };
      }
      if (call.text.includes('FROM friendships')) {
        return { rows: [{ exists: false }] };
      }
      if (
        call.text.includes('FROM friend_requests') &&
        !call.text.includes('INSERT')
      ) {
        return { rows: [{ exists: false }] };
      }
      if (call.text.startsWith('INSERT INTO friend_requests')) {
        return {
          rows: [
            {
              id: REQUEST_ID,
              sender_id: REQUESTER,
              recipient_id: OTHER,
              created_at: createdAt,
            },
          ],
        };
      }
      throw new Error(`unexpected SQL: ${call.text}`);
    });
    const repo = createFriendsRepo(asPool(pool));

    const dto = await repo.sendRequest(REQUESTER, OTHER);

    expect(dto).toEqual({
      id: REQUEST_ID,
      senderId: REQUESTER,
      recipientId: OTHER,
      createdAt: createdAt.toISOString(),
    });
    expect(pool.calls.map((c) => c.text)).toContain('COMMIT');
  });

  it('translates a 23505 unique-violation race into friend_duplicate_relationship (R8.7)', async () => {
    const pool = makePool((call) => {
      if (call.text === 'BEGIN' || call.text === 'ROLLBACK') return { rows: [] };
      if (call.text.includes('FROM users WHERE id =')) {
        return { rows: [{ id: OTHER }] };
      }
      if (call.text.includes('FROM friendships')) {
        return { rows: [{ exists: false }] };
      }
      if (
        call.text.includes('FROM friend_requests') &&
        !call.text.includes('INSERT')
      ) {
        return { rows: [{ exists: false }] };
      }
      if (call.text.startsWith('INSERT INTO friend_requests')) {
        const err = new Error(
          'duplicate key value violates unique constraint',
        ) as Error & { code: string };
        err.code = '23505';
        return err;
      }
      throw new Error(`unexpected SQL: ${call.text}`);
    });
    const repo = createFriendsRepo(asPool(pool));

    await expect(repo.sendRequest(REQUESTER, OTHER)).rejects.toMatchObject({
      code: 'friend_duplicate_relationship',
    });
  });
});

// ===========================================================================
// acceptRequest (R8.4, R8.6)
// ===========================================================================

describe('acceptRequest', () => {
  it('inserts the canonical friendship and deletes the request (R8.4, R8.6)', async () => {
    const inserts: FakeCall[] = [];
    const pool = makePool((call) => {
      inserts.push(call);
      if (call.text === 'BEGIN' || call.text === 'COMMIT') return { rows: [] };
      if (call.text.includes('FROM friend_requests') && !call.text.startsWith('DELETE')) {
        // Lookup of the request gated on `recipient_id`.
        return {
          rows: [{ sender_id: OTHER, recipient_id: REQUESTER }],
        };
      }
      if (call.text.startsWith('INSERT INTO friendships')) {
        return { rows: [], rowCount: 1 };
      }
      if (call.text.startsWith('DELETE FROM friend_requests')) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected SQL: ${call.text}`);
    });
    const repo = createFriendsRepo(asPool(pool));

    const result = await repo.acceptRequest(REQUESTER, REQUEST_ID);

    expect(result).not.toBeNull();
    // Canonical pair: lo < hi lexicographically. OTHER (`222...`) < REQUESTER (`111...`)?
    // No — REQUESTER `111...` < OTHER `222...`, so lo == REQUESTER.
    expect(result).toEqual({ userLoId: REQUESTER, userHiId: OTHER });

    const insertCall = inserts.find((c) =>
      c.text.startsWith('INSERT INTO friendships'),
    );
    expect(insertCall).toBeDefined();
    expect(insertCall!.params).toEqual([REQUESTER, OTHER]);

    const deleteCall = inserts.find((c) =>
      c.text.startsWith('DELETE FROM friend_requests'),
    );
    expect(deleteCall).toBeDefined();
    expect(deleteCall!.params).toEqual([REQUEST_ID]);

    expect(inserts.map((c) => c.text)).toContain('COMMIT');
  });

  it('returns null when no matching request is found (rolls back) (R8.4 gating)', async () => {
    const pool = makePool((call) => {
      if (call.text === 'BEGIN' || call.text === 'ROLLBACK') return { rows: [] };
      if (call.text.includes('FROM friend_requests')) {
        return { rows: [] };
      }
      throw new Error(`unexpected SQL: ${call.text}`);
    });
    const repo = createFriendsRepo(asPool(pool));

    const result = await repo.acceptRequest(REQUESTER, REQUEST_ID);

    expect(result).toBeNull();
    expect(pool.calls.map((c) => c.text)).toContain('ROLLBACK');
  });
});

// ===========================================================================
// declineRequest (R8.5)
// ===========================================================================

describe('declineRequest', () => {
  it('returns true and DELETEs by id+recipient on success (R8.5)', async () => {
    const pool = makePool(() => ({ rows: [], rowCount: 1 }));
    const repo = createFriendsRepo(asPool(pool));

    const removed = await repo.declineRequest(REQUESTER, REQUEST_ID);

    expect(removed).toBe(true);
    expect(pool.calls).toHaveLength(1);
    expect(pool.calls[0]!.text).toContain('DELETE FROM friend_requests');
    expect(pool.calls[0]!.text).toContain('recipient_id = $2');
    expect(pool.calls[0]!.params).toEqual([REQUEST_ID, REQUESTER]);
  });

  it('returns false when no row matched (R8.5 gating)', async () => {
    const pool = makePool(() => ({ rows: [], rowCount: 0 }));
    const repo = createFriendsRepo(asPool(pool));

    const removed = await repo.declineRequest(REQUESTER, REQUEST_ID);

    expect(removed).toBe(false);
  });
});

// ===========================================================================
// removeFriend (R8.6, R8.11)
// ===========================================================================

describe('removeFriend', () => {
  it('returns true on a canonical-pair DELETE that affected one row (R8.6)', async () => {
    const pool = makePool(() => ({ rows: [], rowCount: 1 }));
    const repo = createFriendsRepo(asPool(pool));

    const removed = await repo.removeFriend(REQUESTER, OTHER);

    expect(removed).toBe(true);
    expect(pool.calls).toHaveLength(1);
    expect(pool.calls[0]!.text).toContain('DELETE FROM friendships');
    expect(pool.calls[0]!.params).toEqual([REQUESTER, OTHER]);
  });

  it('returns false when no friendship matched the canonical pair (R8.11)', async () => {
    const pool = makePool(() => ({ rows: [], rowCount: 0 }));
    const repo = createFriendsRepo(asPool(pool));

    const removed = await repo.removeFriend(REQUESTER, OTHER);

    expect(removed).toBe(false);
  });

  it('short-circuits to false on self-target without touching the DB', async () => {
    const pool = makePool(() => {
      throw new Error('should not reach the pool');
    });
    const repo = createFriendsRepo(asPool(pool));

    const removed = await repo.removeFriend(REQUESTER, REQUESTER);

    expect(removed).toBe(false);
    expect(pool.calls).toHaveLength(0);
  });
});

// ===========================================================================
// listFriendsAndRequests (R8.9)
// ===========================================================================

describe('listFriendsAndRequests', () => {
  it('bundles friends, incoming, and outgoing into one response (R8.9)', async () => {
    const established = new Date('2024-01-01T00:00:00.000Z');
    const created = new Date('2024-02-01T00:00:00.000Z');
    const pool = makePool((call) => {
      if (call.text.includes('FROM friendships')) {
        return {
          rows: [
            {
              friend_id: OTHER,
              display_name: 'Goofy',
              avatar_preset: 'ear-balloon',
              established_at: established,
            },
          ],
        };
      }
      if (call.text.includes('WHERE fr.recipient_id = $1')) {
        return {
          rows: [
            {
              id: REQUEST_ID,
              other_user_id: OTHER,
              display_name: 'Donald',
              created_at: created,
            },
          ],
        };
      }
      if (call.text.includes('WHERE fr.sender_id = $1')) {
        return { rows: [] };
      }
      throw new Error(`unexpected SQL: ${call.text}`);
    });
    const repo = createFriendsRepo(asPool(pool));

    const bundle = await repo.listFriendsAndRequests(REQUESTER);

    expect(bundle).toEqual({
      friends: [
        {
          userId: OTHER,
          displayName: 'Goofy',
          avatarPreset: 'ear-balloon',
          establishedAt: established.toISOString(),
        },
      ],
      incomingRequests: [
        {
          id: REQUEST_ID,
          otherUserId: OTHER,
          otherDisplayName: 'Donald',
          createdAt: created.toISOString(),
        },
      ],
      outgoingRequests: [],
    });
    // Three queries — one per projection.
    expect(pool.calls).toHaveLength(3);
  });
});
