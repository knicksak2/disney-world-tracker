/**
 * Unit test: no analytics/audit/telemetry on the owner-or-friend deny path
 * (task 2.3).
 *
 * The shared `assertOwnerOrFriend` gate must deny a non-owner, non-friend read
 * with `AppError('profile_forbidden')` and record **nothing** about the
 * viewing attempt — no analytics event, no audit row, no telemetry write
 * (R1.4). The only side-effect channel the helper has is the injected
 * `DbPool`, so this test injects a *recording* fake pool (whose friendship
 * lookup resolves `exists: false`) plus standalone logger and analytics spies,
 * then drives several denied requests through the helper and asserts that
 * across all of them:
 *
 *   - every request rejects with `profile_forbidden` carrying no data,
 *   - the only SQL issued is the single read-only friendship existence check,
 *   - zero viewing-attempt events are written (no INSERT / analytics / audit /
 *     telemetry / event statements), and
 *   - the logger and analytics spies are never invoked.
 *
 * _Requirements: 1.4_
 */

import { describe, expect, it, vi } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { assertOwnerOrFriend } from '../ownerOrFriend.js';

// ---------------------------------------------------------------------------
// Recording fake pool
// ---------------------------------------------------------------------------

interface RecordedCall {
  readonly text: string;
  readonly params: ReadonlyArray<unknown>;
}

interface RecordingPool {
  readonly calls: RecordedCall[];
  query(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: ReadonlyArray<unknown> }>;
}

/**
 * A pool whose friendship existence lookup always resolves `exists: false`
 * (i.e. the requester is not a Friend of the target) while recording every
 * SQL statement it is asked to run.
 */
function makeRecordingPool(): RecordingPool {
  const calls: RecordedCall[] = [];
  return {
    calls,
    async query(text: string, params: ReadonlyArray<unknown> = []) {
      calls.push({ text, params });
      return { rows: [{ exists: false }] };
    },
  };
}

function asPool(pool: RecordingPool): DbPool {
  return pool as unknown as DbPool;
}

// Statements that would constitute recording a viewing attempt. None of these
// should ever appear on the deny path.
const VIEWING_ATTEMPT_PATTERNS = [
  /\bINSERT\b/i,
  /\bUPDATE\b/i,
  /analytics/i,
  /audit/i,
  /telemetry/i,
  /\bevents?\b/i,
];

// A handful of distinct requesting/target pairs, all of which are non-friends.
const DENIED_PAIRS: ReadonlyArray<readonly [string, string]> = [
  [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
  ],
  [
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  ],
  [
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
  ],
  // Unknown target (the lookup still resolves exists: false and must not be
  // distinguishable from the plain non-friend case).
  [
    '55555555-5555-4555-8555-555555555555',
    '66666666-6666-4666-8666-666666666666',
  ],
];

describe('assertOwnerOrFriend — no analytics on deny (R1.4)', () => {
  it('records zero viewing-attempt events across several denied requests', async () => {
    const pool = makeRecordingPool();

    // Spies for any side channel the helper might (must not) reach for.
    const logger = {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
    };
    const analytics = {
      track: vi.fn(),
      record: vi.fn(),
      emit: vi.fn(),
    };

    for (const [requesterId, targetId] of DENIED_PAIRS) {
      // Each denied request rejects with the opaque profile_forbidden error.
      const error = await assertOwnerOrFriend(asPool(pool), requesterId, targetId)
        .then(() => null)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: 'profile_forbidden' });
      // The error carries no data about the target.
      expect((error as AppError).details).toBeUndefined();
    }

    // The helper touched the pool only for the read-only friendship lookups —
    // exactly one per denied request — and nothing else.
    expect(pool.calls).toHaveLength(DENIED_PAIRS.length);
    for (const call of pool.calls) {
      expect(call.text).toContain('SELECT EXISTS');
      expect(call.text).toContain('FROM friendships');
      for (const pattern of VIEWING_ATTEMPT_PATTERNS) {
        expect(call.text).not.toMatch(pattern);
      }
    }

    // No analytics, audit, or telemetry event was recorded through any spy.
    for (const spy of [
      ...Object.values(logger),
      ...Object.values(analytics),
    ]) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
