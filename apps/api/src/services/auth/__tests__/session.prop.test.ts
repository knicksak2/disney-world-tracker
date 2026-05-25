// Feature: disney-world-tracker, Property 14: a request is authorized iff the session is non-revoked, within absolute and idle TTLs
/**
 * Property-based test for the session lifecycle middleware.
 *
 * Validates: Requirements 6.5, 6.8, 6.9, 6.10, 6.12
 *
 * Property 14 (design.md → Correctness Properties → "Session lifecycle and
 * authorization"):
 *
 *   For any User session and any sequence of authenticated requests, logout
 *   events, expiration ticks, and administrative-termination events, a
 *   request is authorized if and only if the bound session is non-revoked,
 *   the absolute expiration (24 hours of continuous activity) has not
 *   elapsed, and the idle window (30 days) has not elapsed; for any session
 *   whose lifecycle has ended for any reason, every subsequent request
 *   using that session credential is rejected as unauthorized; and any
 *   request to a protected route without a valid session is rejected as
 *   unauthorized.
 *
 * Test strategy: a `fast-check` `commands`-style state-machine test driven
 * over an injected clock. The model holds the four observable lifecycle
 * fields:
 *
 *   { nowMs, lastSeenAtMs, absoluteExpiresAtMs, revokedAtMs }
 *
 * and the three commands {`PassTime(ms)`, `Authorize`, `Revoke`} cover the
 * full transition space called out by the property: time advances, an
 * authenticated request is made, or the session is administratively
 * terminated. A fourth command `AuthorizeWithUnknownToken` checks the
 * "request without a valid session is rejected" clause directly.
 *
 * On every `Authorize`:
 *   - The model's predicate
 *       `revokedAt === null ∧ now < absoluteExpiresAt ∧ now - lastSeenAt < 30d`
 *     determines `expectedAuthorized`. Any deviation from the real
 *     middleware's accept/reject decision fails the property.
 *   - On accept, the real row's `last_seen_at` and `absolute_expires_at`
 *     are compared against the model's prediction:
 *       last_seen_at = now,
 *       absolute_expires_at = (idleGap >= 30 min) ? now + 24h : prior
 *     This pins down R6.5's "24 hours of continuous activity": within a
 *     burst (gaps < 30 min) the absolute expiry is preserved, so 24
 *     unbroken hours genuinely end the session; a >= 30-min gap closes
 *     the burst and starts a fresh 24-hour window.
 *   - On reject, the row must not have been written.
 *
 * The clock is a small mutable cell shared between model and real; commands
 * advance both in lockstep so the property's assertions are deterministic.
 *
 * `numRuns: 100` per the spec convention.
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';
import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  createSessionMiddleware,
  SESSION_BURST_DURATION_MS,
  SESSION_BURST_GAP_MS,
  SESSION_IDLE_WINDOW_MS,
  type SessionDbAdapter,
  type SessionRow,
} from '../sessionMiddleware.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NUM_RUNS = 100;
const MAX_COMMANDS = 50;

const SESSION_ID = 'sess-1';
const USER_ID = 'user-1';
/**
 * The bearer token. With an identity `hashToken`, the in-memory adapter
 * stores the row under this same key, so the Bearer header authenticates
 * against `SESSION_ID`.
 */
const TOKEN = SESSION_ID;
const T0_MS = Date.UTC(2025, 0, 1);

// `PassTime` time budget. Wide enough to clear the 30-day idle window
// (so the idle-expiry edge gets exercised in long runs) but not so wide
// that a single hop blasts past every interesting boundary in one step.
const MAX_PASS_TIME_MS = SESSION_IDLE_WINDOW_MS + 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Model and real types
// ---------------------------------------------------------------------------

interface Model {
  nowMs: number;
  lastSeenAtMs: number;
  absoluteExpiresAtMs: number;
  revokedAtMs: number | null;
}

interface Real {
  /** Mutable clock cell shared with the middleware via the injected `clock`. */
  clockState: { nowMs: number };
  /** Backing store for the in-memory `SessionDbAdapter`. */
  rows: Map<string, SessionRow>;
  /**
   * The middleware factory returns a `preHandlerAsyncHookHandler` whose
   * call signature carries a `this: FastifyInstance` annotation. Storing
   * it as a plain `(req, reply) => Promise<unknown>` here lets the
   * commands invoke it directly without a Fastify instance, matching the
   * direct-invocation pattern in `sessionMiddleware.test.ts`.
   */
  middleware: (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Authorization predicate (the iff under test)
// ---------------------------------------------------------------------------

/**
 * Reference predicate: a request at time `m.nowMs` is authorized iff the
 * session has not been revoked, the absolute expiration has not elapsed
 * (`<` is strict — equality at the boundary is a rejection per the
 * middleware's `>=` checks), and the idle gap is strictly under 30 days.
 */
function isAuthorized(m: Model): boolean {
  if (m.revokedAtMs !== null) return false;
  if (m.nowMs >= m.absoluteExpiresAtMs) return false;
  if (m.nowMs - m.lastSeenAtMs >= SESSION_IDLE_WINDOW_MS) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(authorization?: string) {
  return {
    headers: authorization === undefined ? {} : { authorization },
  };
}

function snapshot(m: Model) {
  return {
    nowMs: m.nowMs,
    lastSeenAtMs: m.lastSeenAtMs,
    absoluteExpiresAtMs: m.absoluteExpiresAtMs,
    revokedAtMs: m.revokedAtMs,
    idleGapMs: m.nowMs - m.lastSeenAtMs,
    absoluteRemainingMs: m.absoluteExpiresAtMs - m.nowMs,
  };
}

function makeAdapter(initial: SessionRow): {
  adapter: SessionDbAdapter;
  rows: Map<string, SessionRow>;
} {
  // Same shape as the in-memory fake in `sessionMiddleware.test.ts`: rows
  // are keyed by their `id`, and the test's `hashToken` is identity, so
  // the Bearer token, the token hash, and the row id are all the same
  // string.
  const rows = new Map<string, SessionRow>();
  rows.set(initial.id, initial);
  const adapter: SessionDbAdapter = {
    async findByTokenHash(tokenHash) {
      return rows.get(tokenHash) ?? null;
    },
    async updateActivity(sessionId, now, absoluteExpiresAt) {
      const existing = rows.get(sessionId);
      if (existing) {
        rows.set(sessionId, {
          ...existing,
          last_seen_at: new Date(now.getTime()),
          absolute_expires_at: new Date(absoluteExpiresAt.getTime()),
        });
      }
    },
  };
  return { adapter, rows };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * Advance the shared clock by a non-negative delta. Both the model and the
 * real middleware see the same advance.
 */
class PassTimeCommand implements fc.AsyncCommand<Model, Real> {
  constructor(public readonly deltaMs: number) {}
  check(_m: Readonly<Model>): boolean {
    return true;
  }
  async run(m: Model, r: Real): Promise<void> {
    m.nowMs += this.deltaMs;
    r.clockState.nowMs += this.deltaMs;
  }
  toString(): string {
    return `PassTime(${this.deltaMs}ms)`;
  }
}

/**
 * Issue an authenticated request with the session's Bearer token. Asserts
 * the iff invariant and, on accept, the burst-rollover bookkeeping.
 */
class AuthorizeCommand implements fc.AsyncCommand<Model, Real> {
  check(_m: Readonly<Model>): boolean {
    return true;
  }
  async run(m: Model, r: Real): Promise<void> {
    const expectedAuthorized = isAuthorized(m);

    const req = makeRequest(`Bearer ${TOKEN}`);
    let actualAuthorized = false;
    try {
      await r.middleware(
        req as unknown as FastifyRequest,
        {} as FastifyReply,
      );
      actualAuthorized = true;
    } catch {
      actualAuthorized = false;
    }

    if (actualAuthorized !== expectedAuthorized) {
      throw new Error(
        `iff violated: expected authorized=${expectedAuthorized} but got ${actualAuthorized}; model=${JSON.stringify(snapshot(m))}`,
      );
    }

    if (actualAuthorized) {
      const idleGap = m.nowMs - m.lastSeenAtMs;
      const newAbsoluteExpiresAtMs =
        idleGap >= SESSION_BURST_GAP_MS
          ? m.nowMs + SESSION_BURST_DURATION_MS
          : m.absoluteExpiresAtMs;

      // Project the model forward.
      m.lastSeenAtMs = m.nowMs;
      m.absoluteExpiresAtMs = newAbsoluteExpiresAtMs;

      // Confirm the real row matches the projection.
      const row = r.rows.get(SESSION_ID);
      if (row === undefined) {
        throw new Error('session row vanished from in-memory adapter');
      }
      if (row.last_seen_at.getTime() !== m.lastSeenAtMs) {
        throw new Error(
          `last_seen_at not advanced to now: model=${m.lastSeenAtMs}, real=${row.last_seen_at.getTime()}`,
        );
      }
      if (row.absolute_expires_at.getTime() !== m.absoluteExpiresAtMs) {
        throw new Error(
          `absolute_expires_at mismatch: model=${m.absoluteExpiresAtMs}, real=${row.absolute_expires_at.getTime()}, idleGapMs=${idleGap}`,
        );
      }
    } else {
      // R6.10/R6.12: a rejected request must not advance bookkeeping.
      const row = r.rows.get(SESSION_ID);
      if (row !== undefined) {
        if (row.last_seen_at.getTime() !== m.lastSeenAtMs) {
          throw new Error(
            'rejected request leaked an updateActivity call (last_seen_at advanced)',
          );
        }
        if (row.absolute_expires_at.getTime() !== m.absoluteExpiresAtMs) {
          throw new Error(
            'rejected request leaked an updateActivity call (absolute_expires_at advanced)',
          );
        }
      }
    }
  }
  toString(): string {
    return 'Authorize';
  }
}

/**
 * Issue a request whose bearer token does not correspond to any stored
 * session. The middleware must reject with `unauthorized` regardless of
 * the model state — this exercises the design.md clause that "any request
 * to a protected route without a valid session is rejected as
 * unauthorized" (R6.10, R6.12).
 */
class AuthorizeWithUnknownTokenCommand
  implements fc.AsyncCommand<Model, Real>
{
  check(_m: Readonly<Model>): boolean {
    return true;
  }
  async run(_m: Model, r: Real): Promise<void> {
    const req = makeRequest('Bearer not-a-real-session-token');
    let actualAuthorized = false;
    try {
      await r.middleware(
        req as unknown as FastifyRequest,
        {} as FastifyReply,
      );
      actualAuthorized = true;
    } catch {
      actualAuthorized = false;
    }
    if (actualAuthorized) {
      throw new Error(
        'request with an unknown session token was authorized; expected unauthorized',
      );
    }
  }
  toString(): string {
    return 'AuthorizeWithUnknownToken';
  }
}

/**
 * Administratively terminate the session at the current `now`. Subsequent
 * `Authorize` commands must observe the iff predicate flipping to false
 * forever (R6.8, R6.9, R6.10).
 */
class RevokeCommand implements fc.AsyncCommand<Model, Real> {
  check(_m: Readonly<Model>): boolean {
    return true;
  }
  async run(m: Model, r: Real): Promise<void> {
    if (m.revokedAtMs === null) {
      m.revokedAtMs = m.nowMs;
    }
    const row = r.rows.get(SESSION_ID);
    if (row !== undefined && row.revoked_at === null) {
      r.rows.set(SESSION_ID, {
        ...row,
        revoked_at: new Date(m.nowMs),
      });
    }
  }
  toString(): string {
    return 'Revoke';
  }
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('sessionMiddleware — Property 14: lifecycle and authorization', () => {
  it('a request is authorized iff the session is non-revoked, within absolute TTL, and within idle TTL; bursts roll over on >= 30-min idle', async () => {
    // The PassTime budget is biased so that small hops (sub-burst-gap)
    // and medium hops (cross-burst-gap, sub-idle) are both common, but
    // large hops can also clear the 30-day idle window. The
    // `constantFrom` of "interesting" exact deltas seeds the boundary
    // points (0, 30 min, 24 h, 30 days) so shrinking can land on them.
    const interestingDeltas = fc.constantFrom(
      0,
      1,
      SESSION_BURST_GAP_MS - 1,
      SESSION_BURST_GAP_MS,
      SESSION_BURST_GAP_MS + 1,
      SESSION_BURST_DURATION_MS - 1,
      SESSION_BURST_DURATION_MS,
      SESSION_BURST_DURATION_MS + 1,
      SESSION_IDLE_WINDOW_MS - 1,
      SESSION_IDLE_WINDOW_MS,
      SESSION_IDLE_WINDOW_MS + 1,
    );
    const passTimeArb = fc
      .oneof(
        { weight: 1, arbitrary: interestingDeltas },
        {
          weight: 3,
          arbitrary: fc.integer({ min: 0, max: MAX_PASS_TIME_MS }),
        },
      )
      .map((deltaMs) => new PassTimeCommand(deltaMs));

    const authorizeArb = fc.constant(new AuthorizeCommand());
    const authorizeUnknownArb = fc.constant(
      new AuthorizeWithUnknownTokenCommand(),
    );
    const revokeArb = fc.constant(new RevokeCommand());

    // Bias the command distribution so Authorize and PassTime dominate
    // (we want long valid sequences). Revoke is rare so most runs spend
    // significant time in the non-revoked half of the iff.
    const cmdArb = fc.oneof(
      { weight: 4, arbitrary: passTimeArb },
      { weight: 5, arbitrary: authorizeArb },
      { weight: 1, arbitrary: authorizeUnknownArb },
      { weight: 1, arbitrary: revokeArb },
    );

    await fc.assert(
      fc.asyncProperty(
        fc.commands([cmdArb], { maxCommands: MAX_COMMANDS }),
        async (cmds) => {
          const setup = () => {
            const initialRow: SessionRow = {
              id: SESSION_ID,
              user_id: USER_ID,
              last_seen_at: new Date(T0_MS),
              absolute_expires_at: new Date(
                T0_MS + SESSION_BURST_DURATION_MS,
              ),
              revoked_at: null,
            };
            const { adapter, rows } = makeAdapter(initialRow);
            const clockState = { nowMs: T0_MS };
            const middleware = createSessionMiddleware({
              db: adapter,
              hashToken: (t) => t,
              clock: () => new Date(clockState.nowMs),
            });
            const real: Real = {
              clockState,
              rows,
              middleware: middleware as unknown as Real['middleware'],
            };
            const model: Model = {
              nowMs: T0_MS,
              lastSeenAtMs: T0_MS,
              absoluteExpiresAtMs: T0_MS + SESSION_BURST_DURATION_MS,
              revokedAtMs: null,
            };
            return { model, real };
          };
          await fc.asyncModelRun(setup, cmds);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
