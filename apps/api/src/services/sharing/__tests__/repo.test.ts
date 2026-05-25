/**
 * Unit tests for the Sharing_Service repository (task 12.1).
 *
 * Drives `createSharingRepo` against a fake pool that records every SQL
 * call and routes responses by predicate matchers. Each test focuses on
 * a single repo behavior so failures map cleanly to a requirement.
 *
 * Coverage:
 *   - R9.2: createShareAtomic rejects empty list, > 50 list, duplicate ids
 *   - R9.3: createShareAtomic rejects when any recipient is not a friend
 *           (rolls back transaction; no rows persist)
 *   - R9.1, R9.3: createShareAtomic inserts share + per-recipient rows
 *           on the happy path
 *   - R9.8/R9.9: listInbox returns all rows; opened state distinguishes
 *           the wire shape (the route layer enforces the actual privacy
 *           projection but the repo carries the raw fields)
 *   - R9.9: openShare updates opened_at and returns full payload; null
 *           when no row matches
 *   - R9.10: softDeleteForRecipient updates only the recipient's row
 *           (the SQL predicate on `share_id, recipient_id` makes the
 *           sender's `shares` row and other recipient rows untouched)
 */

import { describe, expect, it } from 'vitest';

import type { SharePayload } from '@dwt/shared';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { createSharingRepo } from '../repo.js';

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

// Stable test UUIDs.
const SENDER = '11111111-1111-4111-8111-111111111111';
const REC_A = '22222222-2222-4222-8222-222222222222';
const REC_B = '33333333-3333-4333-8333-333333333333';
const REC_C = '44444444-4444-4444-8444-444444444444';
const SHARE_ID = '55555555-5555-4555-8555-555555555555';
const EXPERIENCE_ID = '66666666-6666-4666-8666-666666666666';

const EXPERIENCE_PAYLOAD: SharePayload = {
  kind: 'experience',
  experienceId: EXPERIENCE_ID,
  rating: 8,
};

// ===========================================================================
// createShareAtomic — recipient-count validation (R9.2)
// ===========================================================================

describe('createShareAtomic recipient-count validation (R9.2)', () => {
  it('rejects an empty recipient list with share_recipient_count_invalid', async () => {
    const pool = makePool(() => {
      throw new Error('should not reach DB');
    });
    const repo = createSharingRepo(asPool(pool));

    await expect(
      repo.createShareAtomic(SENDER, [], EXPERIENCE_PAYLOAD),
    ).rejects.toMatchObject({
      code: 'share_recipient_count_invalid',
      field: 'recipientIds',
    });
    expect(pool.calls).toHaveLength(0);
  });

  it('rejects a recipient list of more than 50 ids with share_recipient_count_invalid', async () => {
    const pool = makePool(() => {
      throw new Error('should not reach DB');
    });
    const repo = createSharingRepo(asPool(pool));
    const oversized = Array.from({ length: 51 }, (_, i) =>
      `aaaaaaaa-aaaa-4aaa-8aaa-${i.toString().padStart(12, '0')}`,
    );

    await expect(
      repo.createShareAtomic(SENDER, oversized, EXPERIENCE_PAYLOAD),
    ).rejects.toMatchObject({
      code: 'share_recipient_count_invalid',
    });
    expect(pool.calls).toHaveLength(0);
  });

  it('accepts a list of exactly 1 recipient (lower bound)', async () => {
    const pool = makePool(buildHappyResponder([REC_A]));
    const repo = createSharingRepo(asPool(pool));

    const result = await repo.createShareAtomic(
      SENDER,
      [REC_A],
      EXPERIENCE_PAYLOAD,
    );

    expect(result).toEqual({ shareId: SHARE_ID, deliveredTo: 1 });
  });

  it('accepts a list of exactly 50 recipients (upper bound)', async () => {
    const fifty = Array.from({ length: 50 }, (_, i) =>
      `bbbbbbbb-bbbb-4bbb-8bbb-${i.toString().padStart(12, '0')}`,
    );
    const pool = makePool(buildHappyResponder(fifty));
    const repo = createSharingRepo(asPool(pool));

    const result = await repo.createShareAtomic(
      SENDER,
      fifty,
      EXPERIENCE_PAYLOAD,
    );

    expect(result).toEqual({ shareId: SHARE_ID, deliveredTo: 50 });
  });

  it('rejects duplicate recipient ids in the list', async () => {
    const pool = makePool(() => {
      throw new Error('should not reach DB');
    });
    const repo = createSharingRepo(asPool(pool));

    await expect(
      repo.createShareAtomic(SENDER, [REC_A, REC_A], EXPERIENCE_PAYLOAD),
    ).rejects.toMatchObject({
      code: 'share_recipient_count_invalid',
    });
    expect(pool.calls).toHaveLength(0);
  });

  it('rejects a recipient list that includes the sender (R9.3)', async () => {
    const pool = makePool(() => {
      throw new Error('should not reach DB');
    });
    const repo = createSharingRepo(asPool(pool));

    await expect(
      repo.createShareAtomic(SENDER, [SENDER, REC_A], EXPERIENCE_PAYLOAD),
    ).rejects.toMatchObject({
      code: 'share_atomic_rejected',
    });
    expect(pool.calls).toHaveLength(0);
  });
});

// ===========================================================================
// createShareAtomic — atomic friend check (R9.3)
// ===========================================================================

describe('createShareAtomic atomic friend check (R9.3)', () => {
  it('aborts the transaction with share_atomic_rejected when one recipient is not a friend', async () => {
    // Recipients A and B; only A is friends with the sender.
    const pool = makePool((call) => {
      if (call.text === 'BEGIN' || call.text === 'ROLLBACK') return { rows: [] };
      if (call.text.startsWith('SELECT user_lo_id, user_hi_id')) {
        // The friendship lookup returns only the canonical pair for
        // (SENDER, REC_A). REC_B is missing from the result, so the
        // repo should roll back.
        const { lo, hi } = canonical(SENDER, REC_A);
        return { rows: [{ user_lo_id: lo, user_hi_id: hi }] };
      }
      throw new Error(`unexpected SQL: ${call.text}`);
    });
    const repo = createSharingRepo(asPool(pool));

    await expect(
      repo.createShareAtomic(SENDER, [REC_A, REC_B], EXPERIENCE_PAYLOAD),
    ).rejects.toMatchObject({
      code: 'share_atomic_rejected',
    });

    // We saw a BEGIN, the friendship SELECT, and a ROLLBACK; we did NOT
    // see any INSERT into shares or share_recipients.
    const texts = pool.calls.map((c) => c.text);
    expect(texts).toContain('BEGIN');
    expect(texts).toContain('ROLLBACK');
    expect(texts.some((t) => t.startsWith('INSERT INTO shares'))).toBe(false);
    expect(
      texts.some((t) => t.startsWith('INSERT INTO share_recipients')),
    ).toBe(false);
  });

  it('aborts the transaction when zero recipients are friends', async () => {
    const pool = makePool((call) => {
      if (call.text === 'BEGIN' || call.text === 'ROLLBACK') return { rows: [] };
      if (call.text.startsWith('SELECT user_lo_id, user_hi_id')) {
        return { rows: [] };
      }
      throw new Error(`unexpected SQL: ${call.text}`);
    });
    const repo = createSharingRepo(asPool(pool));

    await expect(
      repo.createShareAtomic(SENDER, [REC_A, REC_B], EXPERIENCE_PAYLOAD),
    ).rejects.toMatchObject({ code: 'share_atomic_rejected' });
  });
});

// ===========================================================================
// createShareAtomic — happy path (R9.1)
// ===========================================================================

describe('createShareAtomic happy path (R9.1)', () => {
  it('inserts one share row and one share_recipient row per recipient', async () => {
    const recipients = [REC_A, REC_B, REC_C];
    const pool = makePool(buildHappyResponder(recipients));
    const repo = createSharingRepo(asPool(pool));

    const result = await repo.createShareAtomic(
      SENDER,
      recipients,
      EXPERIENCE_PAYLOAD,
    );

    expect(result).toEqual({ shareId: SHARE_ID, deliveredTo: 3 });

    const texts = pool.calls.map((c) => c.text);
    expect(texts).toContain('BEGIN');
    expect(texts).toContain('COMMIT');
    expect(texts.some((t) => t.startsWith('INSERT INTO shares'))).toBe(true);
    expect(
      texts.some((t) => t.startsWith('INSERT INTO share_recipients')),
    ).toBe(true);

    // The recipients INSERT uses an unnest array; the params should
    // include the full list of recipient ids.
    const recipientInsert = pool.calls.find((c) =>
      c.text.startsWith('INSERT INTO share_recipients'),
    );
    expect(recipientInsert).toBeDefined();
    const recipientArr = recipientInsert!.params[1];
    expect(recipientArr).toEqual(recipients);
  });

  it('persists experience_id when payload kind is experience', async () => {
    const pool = makePool(buildHappyResponder([REC_A]));
    const repo = createSharingRepo(asPool(pool));

    await repo.createShareAtomic(SENDER, [REC_A], EXPERIENCE_PAYLOAD);

    const insertShare = pool.calls.find((c) =>
      c.text.startsWith('INSERT INTO shares'),
    );
    expect(insertShare).toBeDefined();
    // params order: senderId, experience_id, payload_kind, payload jsonb
    expect(insertShare!.params[0]).toBe(SENDER);
    expect(insertShare!.params[1]).toBe(EXPERIENCE_ID);
    expect(insertShare!.params[2]).toBe('experience');
  });

  it('persists null experience_id and full snapshot when payload kind is progress', async () => {
    const progressPayload: SharePayload = {
      kind: 'progress',
      overallPercent: 42.5,
      perParkPercent: { 'Magic Kingdom': 50 },
      perCategoryPercent: { Ride: 33.3 },
    };
    const pool = makePool(buildHappyResponder([REC_A]));
    const repo = createSharingRepo(asPool(pool));

    await repo.createShareAtomic(SENDER, [REC_A], progressPayload);

    const insertShare = pool.calls.find((c) =>
      c.text.startsWith('INSERT INTO shares'),
    );
    expect(insertShare).toBeDefined();
    expect(insertShare!.params[1]).toBeNull();
    expect(insertShare!.params[2]).toBe('progress');
    const snapshot = JSON.parse(insertShare!.params[3] as string);
    expect(snapshot).toEqual(progressPayload);
  });
});

// ===========================================================================
// listInbox (R9.8, R9.9)
// ===========================================================================

describe('listInbox', () => {
  it('returns unread count and items, including raw fields for opened items (R9.9)', async () => {
    const sentAt = new Date('2024-05-01T10:00:00.000Z');
    const pool = makePool(() => ({
      rows: [
        {
          share_id: 'abcde111-1111-4111-8111-111111111111',
          is_opened: true,
          sender_id: SENDER,
          payload_kind: 'experience',
          payload_snapshot: EXPERIENCE_PAYLOAD,
          sent_at: sentAt,
        },
        {
          share_id: 'abcde222-2222-4222-8222-222222222222',
          is_opened: false,
          sender_id: SENDER,
          payload_kind: 'experience',
          payload_snapshot: EXPERIENCE_PAYLOAD,
          sent_at: sentAt,
        },
      ],
    }));
    const repo = createSharingRepo(asPool(pool));

    const inbox = await repo.listInbox(REC_A);

    expect(inbox.unread).toBe(1);
    expect(inbox.items).toHaveLength(2);
    // Opened item carries sender, payload, sentAt (R9.9).
    expect(inbox.items[0]).toEqual({
      shareId: 'abcde111-1111-4111-8111-111111111111',
      isOpened: true,
      senderId: SENDER,
      payloadKind: 'experience',
      payload: EXPERIENCE_PAYLOAD,
      sentAt: sentAt.toISOString(),
    });
    // Unopened item: only shareId + isOpened (R9.8).
    expect(inbox.items[1]).toEqual({
      shareId: 'abcde222-2222-4222-8222-222222222222',
      isOpened: false,
    });
  });

  it('filters out recipient-soft-deleted rows via the SQL predicate', async () => {
    const pool = makePool((call) => {
      // The predicate must include `recipient_deleted_at IS NULL`; we
      // assert on the text rather than mocking deleted rows.
      expect(call.text).toContain('recipient_deleted_at IS NULL');
      expect(call.text).toContain('recipient_id = $1');
      return { rows: [] };
    });
    const repo = createSharingRepo(asPool(pool));

    const inbox = await repo.listInbox(REC_A);

    expect(inbox).toEqual({ unread: 0, items: [] });
  });
});

// ===========================================================================
// openShare (R9.9)
// ===========================================================================

describe('openShare', () => {
  it('updates opened_at and returns the full detail on success', async () => {
    const sentAt = new Date('2024-05-01T10:00:00.000Z');
    const pool = makePool((call) => {
      expect(call.text).toContain('UPDATE share_recipients');
      expect(call.text).toContain('opened_at = COALESCE');
      expect(call.text).toContain('recipient_deleted_at IS NULL');
      return {
        rows: [
          {
            sender_id: SENDER,
            payload_kind: 'experience',
            payload_snapshot: EXPERIENCE_PAYLOAD,
            sent_at: sentAt,
          },
        ],
      };
    });
    const repo = createSharingRepo(asPool(pool));

    const detail = await repo.openShare(REC_A, SHARE_ID);

    expect(detail).toEqual({
      shareId: SHARE_ID,
      senderId: SENDER,
      payloadKind: 'experience',
      payload: EXPERIENCE_PAYLOAD,
      sentAt: sentAt.toISOString(),
    });
  });

  it('returns null when no matching row exists', async () => {
    const pool = makePool(() => ({ rows: [] }));
    const repo = createSharingRepo(asPool(pool));

    const detail = await repo.openShare(REC_A, SHARE_ID);

    expect(detail).toBeNull();
  });
});

// ===========================================================================
// softDeleteForRecipient (R9.10)
// ===========================================================================

describe('softDeleteForRecipient', () => {
  it('updates only the recipient/share row predicate (sender row untouched)', async () => {
    const pool = makePool((call) => {
      expect(call.text).toContain('UPDATE share_recipients');
      expect(call.text).toContain('SET recipient_deleted_at = now()');
      // The WHERE clause MUST scope to (share_id, recipient_id) so the
      // sender's `shares` row and other recipients' rows cannot be
      // affected (R9.10).
      expect(call.text).toContain('share_id = $1');
      expect(call.text).toContain('recipient_id = $2');
      // Should NOT touch the `shares` table at all.
      expect(call.text).not.toContain('UPDATE shares');
      expect(call.text).not.toContain('DELETE FROM shares');
      return { rows: [], rowCount: 1 };
    });
    const repo = createSharingRepo(asPool(pool));

    const removed = await repo.softDeleteForRecipient(REC_A, SHARE_ID);

    expect(removed).toBe(true);
    expect(pool.calls).toHaveLength(1);
    expect(pool.calls[0]!.params).toEqual([SHARE_ID, REC_A]);
  });

  it('returns false when no row was updated (already deleted or unknown share)', async () => {
    const pool = makePool(() => ({ rows: [], rowCount: 0 }));
    const repo = createSharingRepo(asPool(pool));

    const removed = await repo.softDeleteForRecipient(REC_A, SHARE_ID);

    expect(removed).toBe(false);
  });

  it('preserves sender row + other recipient rows when one recipient deletes (R9.10)', async () => {
    // This is structurally guaranteed by the SQL predicate (only one
    // row scoped by `(share_id, recipient_id)` is touched); the test
    // asserts that contract by recording every call and showing the
    // SQL never targets `shares` or another recipient's row.
    const recordedCalls: FakeCall[] = [];
    const pool = makePool((call) => {
      recordedCalls.push(call);
      return { rows: [], rowCount: 1 };
    });
    const repo = createSharingRepo(asPool(pool));

    await repo.softDeleteForRecipient(REC_A, SHARE_ID);

    // Exactly one statement, scoped by both share_id and recipient_id.
    expect(recordedCalls).toHaveLength(1);
    const call = recordedCalls[0]!;
    expect(call.params).toEqual([SHARE_ID, REC_A]);
    // No other recipient id appears in params.
    expect(call.params).not.toContain(REC_B);
    expect(call.params).not.toContain(SENDER);
  });
});

// ===========================================================================
// AppError instances
// ===========================================================================

describe('AppError shape', () => {
  it('throws an AppError instance for share_recipient_count_invalid', async () => {
    const pool = makePool(() => {
      throw new Error('should not reach DB');
    });
    const repo = createSharingRepo(asPool(pool));

    await expect(
      repo.createShareAtomic(SENDER, [], EXPERIENCE_PAYLOAD),
    ).rejects.toBeInstanceOf(AppError);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a happy-path responder that:
 *   - lets BEGIN/COMMIT through,
 *   - returns the full friendship set for (SENDER, recipient_i) for every
 *     recipient in `recipients`,
 *   - returns a fresh share id from the INSERT INTO shares,
 *   - lets the INSERT INTO share_recipients pass.
 */
function buildHappyResponder(
  recipients: ReadonlyArray<string>,
): Responder {
  return (call) => {
    if (call.text === 'BEGIN' || call.text === 'COMMIT' || call.text === 'ROLLBACK') {
      return { rows: [] };
    }
    if (call.text.startsWith('SELECT user_lo_id, user_hi_id')) {
      const rows = recipients.map((r) => {
        const { lo, hi } = canonical(SENDER, r);
        return { user_lo_id: lo, user_hi_id: hi };
      });
      return { rows };
    }
    if (call.text.startsWith('INSERT INTO shares')) {
      return { rows: [{ id: SHARE_ID }] };
    }
    if (call.text.startsWith('INSERT INTO share_recipients')) {
      return { rows: [], rowCount: recipients.length };
    }
    throw new Error(`unexpected SQL: ${call.text}`);
  };
}

/** Local lexicographic canonicalization (mirrors `canonicalPair.ts`). */
function canonical(a: string, b: string): { lo: string; hi: string } {
  return a < b ? { lo: a, hi: b } : { lo: b, hi: a };
}
