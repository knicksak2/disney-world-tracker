/**
 * Unit tests for the reworked `listInbox` disclosure projection (task 2.3).
 *
 * Task 2.1 reworked `listInbox` so every non-deleted delivered `Share` is
 * disclosed — sender id/display name, payload, `sentAt`, per-recipient `read`
 * (`opened_at IS NOT NULL`), and the recipient's own reaction — with `unread`
 * counting only rows whose `read` is `false` (R4.1, R6.1, R6.2). This suite
 * exercises that projection against a fake pool that returns synthetic
 * `share_recipients` rows, focusing on two backward-compatibility concerns:
 *
 *   1. Legacy `experience` payloads whose snapshot lacks the Experience name,
 *      Park, and Experience_Category still project correctly. The `experience`
 *      snapshot has only ever stored `experienceId` (+ optional rating/note),
 *      so a pre-feature Share carries no metadata; the repo returns the
 *      payload as-is and the client resolves name/Park/category at display
 *      time (R6.3, R6.4). The projection must neither require nor synthesize
 *      those fields, and must pass the snapshot through faithfully whether the
 *      jsonb column arrives as an object or as a raw JSON string.
 *
 *   2. Mixed read/unread rows produce the correct per-item `read` flags and a
 *      `unread` count equal to the number of unread rows (R6.2).
 *
 * The pattern mirrors `repo.test.ts`: a fake pool records calls and returns
 * canned rows, so the test is hermetic and deterministic.
 */

import { describe, expect, it } from 'vitest';

import type { SharePayload } from '@dwt/shared';

import type { DbPool } from '../../../db/pool.js';
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

interface FakePool {
  readonly calls: FakeCall[];
  query(text: string, params?: ReadonlyArray<unknown>): Promise<QueryResponse>;
  connect(): Promise<{
    query(text: string, params?: ReadonlyArray<unknown>): Promise<QueryResponse>;
    release(): void;
  }>;
}

/**
 * Build a fake pool whose `query` always returns the supplied rows. Every
 * call is recorded so tests can assert the recipient predicate is passed
 * through, matching the `repo.test.ts` harness.
 */
function makeInboxPool(rows: ReadonlyArray<unknown>): FakePool {
  const calls: FakeCall[] = [];
  const run = async (
    text: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<QueryResponse> => {
    calls.push({ text, params });
    return { rows };
  };
  return {
    calls,
    query: run,
    async connect() {
      return { query: run, release: () => undefined };
    },
  };
}

function asPool(pool: FakePool): DbPool {
  return pool as unknown as DbPool;
}

// Stable test ids.
const SENDER = '11111111-1111-4111-8111-111111111111';
const RECIPIENT = '22222222-2222-4222-8222-222222222222';
const EXPERIENCE_ID = '66666666-6666-4666-8666-666666666666';

// A pre-feature `experience` snapshot: only the identifier is stored, with no
// name/Park/category and no rating/note. The client resolves metadata later.
const LEGACY_EXPERIENCE_PAYLOAD: SharePayload = {
  kind: 'experience',
  experienceId: EXPERIENCE_ID,
};

const SENT_AT = new Date('2024-05-01T10:00:00.000Z');

/** Build one synthetic `share_recipients`-join row for the projection. */
function makeRow(overrides: {
  shareId: string;
  read: boolean;
  payloadSnapshot: unknown;
  payloadKind?: string;
  myReaction?: string | null;
  senderDisplayName?: string;
}): Record<string, unknown> {
  return {
    share_id: overrides.shareId,
    read: overrides.read,
    sender_id: SENDER,
    sender_display_name: overrides.senderDisplayName ?? 'Mickey Mouse',
    payload_kind: overrides.payloadKind ?? 'experience',
    payload_snapshot: overrides.payloadSnapshot,
    sent_at: SENT_AT,
    my_reaction: overrides.myReaction ?? null,
  };
}

// ===========================================================================
// Legacy experience payloads lacking name/Park/category (R6.3, R6.4)
// ===========================================================================

describe('listInbox legacy experience payloads (R6.3, R6.4)', () => {
  it('projects a pre-feature experience snapshot with no metadata faithfully as-is', async () => {
    const pool = makeInboxPool([
      makeRow({
        shareId: 'legacy00-0000-4000-8000-000000000001',
        read: false,
        payloadSnapshot: LEGACY_EXPERIENCE_PAYLOAD,
      }),
    ]);
    const repo = createSharingRepo(asPool(pool));

    const inbox = await repo.listInbox(RECIPIENT);

    expect(inbox.items).toHaveLength(1);
    const item = inbox.items[0]!;
    // The payload is returned exactly as stored — only `experienceId`, with
    // no name/Park/category synthesized by the repo (client resolves later).
    expect(item.payload).toEqual({
      kind: 'experience',
      experienceId: EXPERIENCE_ID,
    });
    expect(item.payloadKind).toBe('experience');
    // The projection never injects metadata keys into the payload.
    expect(item.payload).not.toHaveProperty('name');
    expect(item.payload).not.toHaveProperty('park');
    expect(item.payload).not.toHaveProperty('category');
    // Sender identity/timestamp are disclosed regardless of metadata absence.
    expect(item.senderId).toBe(SENDER);
    expect(item.senderDisplayName).toBe('Mickey Mouse');
    expect(item.sentAt).toBe(SENT_AT.toISOString());
  });

  it('parses a legacy snapshot delivered as a raw JSON string column value', async () => {
    // Some type parsers hand back the jsonb column as a string; the repo's
    // parsePayload must JSON.parse it into the same faithful payload.
    const pool = makeInboxPool([
      makeRow({
        shareId: 'legacy00-0000-4000-8000-000000000002',
        read: true,
        payloadSnapshot: JSON.stringify(LEGACY_EXPERIENCE_PAYLOAD),
      }),
    ]);
    const repo = createSharingRepo(asPool(pool));

    const inbox = await repo.listInbox(RECIPIENT);

    expect(inbox.items[0]!.payload).toEqual({
      kind: 'experience',
      experienceId: EXPERIENCE_ID,
    });
  });

  it('preserves an optional legacy rating without requiring name/Park/category', async () => {
    const pool = makeInboxPool([
      makeRow({
        shareId: 'legacy00-0000-4000-8000-000000000003',
        read: false,
        payloadSnapshot: { kind: 'experience', experienceId: EXPERIENCE_ID, rating: 7 },
      }),
    ]);
    const repo = createSharingRepo(asPool(pool));

    const inbox = await repo.listInbox(RECIPIENT);

    expect(inbox.items[0]!.payload).toEqual({
      kind: 'experience',
      experienceId: EXPERIENCE_ID,
      rating: 7,
    });
  });
});

// ===========================================================================
// Mixed read/unread rows → correct read flags and unread count (R6.2)
// ===========================================================================

describe('listInbox mixed read/unread rows (R6.2)', () => {
  it('computes unread as the count of unread rows and sets per-item read flags', async () => {
    // Five rows: 3 unread, 2 read, interleaved.
    const pool = makeInboxPool([
      makeRow({ shareId: 'aaaa0001-0000-4000-8000-000000000000', read: false, payloadSnapshot: LEGACY_EXPERIENCE_PAYLOAD }),
      makeRow({ shareId: 'aaaa0002-0000-4000-8000-000000000000', read: true, payloadSnapshot: LEGACY_EXPERIENCE_PAYLOAD, myReaction: 'like' }),
      makeRow({ shareId: 'aaaa0003-0000-4000-8000-000000000000', read: false, payloadSnapshot: LEGACY_EXPERIENCE_PAYLOAD }),
      makeRow({ shareId: 'aaaa0004-0000-4000-8000-000000000000', read: false, payloadSnapshot: LEGACY_EXPERIENCE_PAYLOAD }),
      makeRow({ shareId: 'aaaa0005-0000-4000-8000-000000000000', read: true, payloadSnapshot: LEGACY_EXPERIENCE_PAYLOAD }),
    ]);
    const repo = createSharingRepo(asPool(pool));

    const inbox = await repo.listInbox(RECIPIENT);

    expect(inbox.items).toHaveLength(5);
    // unread == number of rows with read === false.
    expect(inbox.unread).toBe(3);
    // Per-item read flags mirror the source rows exactly.
    expect(inbox.items.map((i) => i.read)).toEqual([false, true, false, false, true]);
    // The read item carries its recipient's own reaction; unread ones default null.
    expect(inbox.items[1]!.myReaction).toBe('like');
    expect(inbox.items[0]!.myReaction).toBeNull();
  });

  it('reports unread as 0 when every row is read', async () => {
    const pool = makeInboxPool([
      makeRow({ shareId: 'bbbb0001-0000-4000-8000-000000000000', read: true, payloadSnapshot: LEGACY_EXPERIENCE_PAYLOAD }),
      makeRow({ shareId: 'bbbb0002-0000-4000-8000-000000000000', read: true, payloadSnapshot: LEGACY_EXPERIENCE_PAYLOAD }),
    ]);
    const repo = createSharingRepo(asPool(pool));

    const inbox = await repo.listInbox(RECIPIENT);

    expect(inbox.unread).toBe(0);
    expect(inbox.items.every((i) => i.read)).toBe(true);
  });

  it('reports unread equal to the row count when every row is unread', async () => {
    const pool = makeInboxPool([
      makeRow({ shareId: 'cccc0001-0000-4000-8000-000000000000', read: false, payloadSnapshot: LEGACY_EXPERIENCE_PAYLOAD }),
      makeRow({ shareId: 'cccc0002-0000-4000-8000-000000000000', read: false, payloadSnapshot: LEGACY_EXPERIENCE_PAYLOAD }),
      makeRow({ shareId: 'cccc0003-0000-4000-8000-000000000000', read: false, payloadSnapshot: LEGACY_EXPERIENCE_PAYLOAD }),
    ]);
    const repo = createSharingRepo(asPool(pool));

    const inbox = await repo.listInbox(RECIPIENT);

    expect(inbox.unread).toBe(3);
    expect(inbox.items.every((i) => !i.read)).toBe(true);
  });

  it('returns an empty bundle with zero unread when the recipient has no rows', async () => {
    const pool = makeInboxPool([]);
    const repo = createSharingRepo(asPool(pool));

    const inbox = await repo.listInbox(RECIPIENT);

    expect(inbox).toEqual({ unread: 0, items: [] });
    // The recipient privacy boundary is passed to the query.
    expect(pool.calls).toHaveLength(1);
    expect(pool.calls[0]!.params).toEqual([RECIPIENT]);
  });

  it('projects a mix of legacy experience and progress payloads with correct read accounting', async () => {
    const progressPayload: SharePayload = {
      kind: 'progress',
      overallPercent: 42.5,
      perParkPercent: { 'Magic Kingdom': 50 },
      perCategoryPercent: { Ride: 33.3 },
    };
    const pool = makeInboxPool([
      makeRow({ shareId: 'dddd0001-0000-4000-8000-000000000000', read: false, payloadSnapshot: LEGACY_EXPERIENCE_PAYLOAD }),
      makeRow({
        shareId: 'dddd0002-0000-4000-8000-000000000000',
        read: true,
        payloadKind: 'progress',
        payloadSnapshot: progressPayload,
      }),
    ]);
    const repo = createSharingRepo(asPool(pool));

    const inbox = await repo.listInbox(RECIPIENT);

    expect(inbox.unread).toBe(1);
    expect(inbox.items[0]!.payloadKind).toBe('experience');
    expect(inbox.items[0]!.payload).toEqual({ kind: 'experience', experienceId: EXPERIENCE_ID });
    expect(inbox.items[1]!.payloadKind).toBe('progress');
    expect(inbox.items[1]!.payload).toEqual(progressPayload);
  });
});
