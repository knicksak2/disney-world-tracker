/**
 * Unit tests for the Live_Service upstream-id resolution repo (task 6.3).
 *
 * The repo is exercised against a hand-rolled fake `pg.Pool` that captures
 * every `query()` call and lets each test rig the rows it returns. No real
 * database is involved; each test is hermetic and deterministic.
 *
 * Coverage focuses on the observable behaviors the design pins on this
 * module (design.md "Upstream-id resolution"):
 *
 *   - resolveUpstreamEntityId issues a single read-only SELECT against
 *     `experiences` keyed on `id`, parameterized on the Experience id.
 *   - it returns the mapped upstream id when the row exists.
 *   - it returns `null` when no row exists (drives R1.9).
 *   - it never issues a write.
 *
 * Validates: Requirements 1.1, 1.9.
 */

import { describe, expect, it } from 'vitest';

import { createLiveRepo } from '../repo.js';

// ---------------------------------------------------------------------------
// Fake pool
// ---------------------------------------------------------------------------

interface FakeCall {
  readonly text: string;
  readonly params: ReadonlyArray<unknown>;
}

interface RiggedResponse {
  readonly rows?: ReadonlyArray<Record<string, unknown>>;
}

type Responder = (call: FakeCall) => RiggedResponse | undefined;

interface FakePool {
  readonly calls: FakeCall[];
  query(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: ReadonlyArray<Record<string, unknown>> }>;
}

function makePool(responder: Responder = () => undefined): FakePool {
  const calls: FakeCall[] = [];
  return {
    calls,
    async query(text, params = []) {
      const call: FakeCall = { text, params };
      calls.push(call);
      const rigged = responder(call);
      return { rows: rigged?.rows ?? [] };
    },
  };
}

const EXP_ID = '00000000-0000-5000-8000-000000000001';

// ---------------------------------------------------------------------------
// resolveUpstreamEntityId
// ---------------------------------------------------------------------------

describe('LiveRepo.resolveUpstreamEntityId', () => {
  it('issues a read-only SELECT on experiences keyed on id', async () => {
    const pool = makePool((call) => {
      if (call.text.includes('FROM experiences')) {
        return { rows: [{ upstream_entity_id: 'wdw-attraction-123' }] };
      }
      return { rows: [] };
    });
    const repo = createLiveRepo(pool as never);

    const upstreamId = await repo.resolveUpstreamEntityId(EXP_ID);

    expect(upstreamId).toBe('wdw-attraction-123');
    expect(pool.calls).toHaveLength(1);

    const sql = pool.calls[0]?.text ?? '';
    expect(sql).toMatch(/SELECT upstream_entity_id/);
    expect(sql).toMatch(/FROM experiences/);
    expect(sql).toMatch(/WHERE id = \$1/);
    expect(pool.calls[0]?.params).toEqual([EXP_ID]);

    // Reads only: no write keywords appear in any issued SQL.
    for (const call of pool.calls) {
      expect(call.text).not.toMatch(/INSERT|UPDATE|DELETE|UPSERT/i);
    }
  });

  it('returns null when no experiences row exists (R1.9)', async () => {
    const pool = makePool(() => ({ rows: [] }));
    const repo = createLiveRepo(pool as never);

    expect(await repo.resolveUpstreamEntityId(EXP_ID)).toBeNull();
  });
});
