// Feature: disney-world-tracker, Property 16: plaintext password never appears in any DB row, log entry, or response body
/**
 * Property-based test for Property 16 (design.md → Correctness Properties):
 *
 *   *For any* password used in registration or login, the plaintext password
 *   value does not appear in any field of any persisted database row, in any
 *   structured log entry produced during the request lifecycle, or in any
 *   API response body; only the Argon2id hash representation is persisted.
 *
 * Validates: Requirements 6.11
 *
 * Strategy: build a real `authRoutes` plugin against a fake Postgres pool
 * that captures every SQL `text` + `params` tuple, a no-op lockout, and
 * (crucially) a real pino logger configured with `loggerOptions` from
 * `apps/api/src/logger.ts` so the redactor is exercised end-to-end. For
 * each randomly generated password we register a fresh user, log in, and
 * then scan three surfaces:
 *
 *   1. Every captured SQL parameter and SQL text
 *   2. Every emitted log line (raw bytes pino wrote to the sink)
 *   3. The response body of `/auth/register` and `/auth/login`
 *
 * The plaintext must not appear as a substring on any of these surfaces.
 *
 * Generator notes:
 *
 *   - Password length is constrained to `[8, 128]` characters, matching
 *     `passwordSchema` in `@dwt/shared`.
 *   - `fc.string()` defaults to printable ASCII (0x20-0x7e) — large enough
 *     to be representative, small enough to keep JSON encoding identical to
 *     the in-memory string (no `"` or `\` to be escaped, no control bytes).
 *     A printable-ASCII password serialized as JSON re-emits as exactly the
 *     same byte sequence, so a plain `String#includes` check is a faithful
 *     test of "does the plaintext appear anywhere".
 *   - Email and display name are constants (per-run unique email via
 *     `randomUUID`) so they cannot accidentally embed the random password.
 *
 * Performance notes: each run performs one Argon2id hash (register) and
 * one Argon2id verify (login); the production parameters (m=64MiB, t=3,
 * p=1) make each operation roughly 100ms, so 100 runs ≈ 20-30s of work.
 * The vitest timeout is widened accordingly.
 */

import { Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';

import Fastify from 'fastify';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { registerErrorHandler } from '../../../errors/handler.js';
import { createLogger, loggerOptions } from '../../../logger.js';
import type { LockoutService } from '../lockout.js';
import { authRoutes, type AuthRoutesOptions } from '../routes.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NUM_RUNS = 100;
/** 4 minutes — comfortably above the worst-case 100×Argon2id wall-clock budget. */
const TEST_TIMEOUT_MS = 240_000;

// ---------------------------------------------------------------------------
// Fake pool — captures every SQL call and persists registered users in-memory
// ---------------------------------------------------------------------------

interface FakeCall {
  readonly text: string;
  readonly params: ReadonlyArray<unknown>;
}

interface FakeClient {
  query(text: string, params?: ReadonlyArray<unknown>): Promise<{ rows: unknown[] }>;
  release(): void;
}

interface UserRecord {
  readonly id: string;
  readonly email: string;
  readonly password_hash: string;
  display_name: string;
}

interface FakePool {
  readonly calls: FakeCall[];
  readonly users: Map<string, UserRecord>;
  query(text: string, params?: ReadonlyArray<unknown>): Promise<{ rows: unknown[] }>;
  connect(): Promise<FakeClient>;
}

/**
 * In-memory fake of `DbPool` that:
 *   - Records every `text` + `params` it sees on `pool.calls`.
 *   - Honors the routes' INSERT/SELECT contract well enough for register
 *     and login to round-trip:
 *       * `INSERT INTO users` stores the email + password hash and returns
 *         a generated UUID-shaped id.
 *       * `INSERT INTO profiles` stores the display name on the user row.
 *       * `INSERT INTO sessions` returns a synthetic session id.
 *       * `SELECT id, email, password_hash` for login reads the row back.
 *       * `SELECT display_name` for login reads the profile row back.
 *
 * BEGIN/COMMIT/ROLLBACK are no-ops; we don't need transactional semantics
 * for this property — we only need the same SQL stream the production code
 * would generate.
 */
function makePool(): FakePool {
  const calls: FakeCall[] = [];
  const users = new Map<string, UserRecord>();

  async function run(
    text: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<{ rows: unknown[] }> {
    calls.push({ text, params });

    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
      return { rows: [] };
    }

    if (text.startsWith('INSERT INTO users')) {
      const email = String(params[0] ?? '');
      const passwordHash = String(params[1] ?? '');
      const id = randomUUID();
      users.set(email.toLowerCase(), {
        id,
        email,
        password_hash: passwordHash,
        display_name: '',
      });
      return { rows: [{ id, email }] };
    }

    if (text.startsWith('INSERT INTO profiles')) {
      const userId = String(params[0] ?? '');
      const displayName = String(params[1] ?? '');
      for (const u of users.values()) {
        if (u.id === userId) {
          u.display_name = displayName;
          break;
        }
      }
      return { rows: [] };
    }

    if (text.startsWith('INSERT INTO sessions')) {
      return { rows: [{ id: randomUUID() }] };
    }

    if (text.startsWith('SELECT id, email, password_hash')) {
      const email = String(params[0] ?? '');
      const found = users.get(email.toLowerCase());
      return found
        ? {
            rows: [
              {
                id: found.id,
                email: found.email,
                password_hash: found.password_hash,
              },
            ],
          }
        : { rows: [] };
    }

    if (text.startsWith('SELECT display_name')) {
      const userId = String(params[0] ?? '');
      for (const u of users.values()) {
        if (u.id === userId) {
          return { rows: [{ display_name: u.display_name }] };
        }
      }
      return { rows: [] };
    }

    // The auth routes do not exercise other SQL during register/login; any
    // unexpected statement is surfaced as an empty result so the test
    // remains hermetic without misleading the SUT.
    return { rows: [] };
  }

  return {
    calls,
    users,
    query: run,
    async connect(): Promise<FakeClient> {
      return { query: run, release: () => undefined };
    },
  };
}

// ---------------------------------------------------------------------------
// Fake lockout — never locked, no observable side effects
// ---------------------------------------------------------------------------

function makeLockout(): LockoutService {
  return {
    async isLocked(): Promise<boolean> {
      return false;
    },
    async recordFailure(): Promise<boolean> {
      return false;
    },
    async clearOnSuccess(): Promise<void> {
      /* no-op */
    },
  };
}

// ---------------------------------------------------------------------------
// Property test
// ---------------------------------------------------------------------------

describe('Auth_Service — Property 16: plaintext password never appears anywhere', () => {
  /**
   * Password generator: 8-128 chars of printable ASCII. Wider Unicode would
   * also be valid input, but printable ASCII keeps JSON serialization
   * byte-identical to the in-memory string, so a substring check on the
   * raw response body is a faithful test (no escape-sequence false
   * positives or negatives to reason about).
   */
  const passwordArb = fc.string({ minLength: 8, maxLength: 128 });

  it(
    'no SQL parameter, log line, or response body contains the literal plaintext password',
    async () => {
      const pool = makePool();
      const lockout = makeLockout();

      const logLines: string[] = [];
      const logSink = new Writable({
        write(chunk, _enc, cb): void {
          logLines.push(String(chunk));
          cb();
        },
      });
      // Use the production logger options (which include the redact paths and
      // the recursive password-key scrubber from logger.ts) so this test
      // exercises the same redactor pipeline real requests flow through.
      const logger = createLogger({ ...loggerOptions, level: 'info' }, logSink);

      const app = Fastify({ logger });
      registerErrorHandler(app as unknown as Parameters<typeof registerErrorHandler>[0]);
      await app.register(
        authRoutes({
          pool: pool as unknown as AuthRoutesOptions['pool'],
          lockout,
          // None of the routes under test require a session; supply a
          // pre-handler that simply does nothing so the plugin registers.
          requireSession: async () => undefined,
        }),
      );
      await app.ready();

      try {
        await fc.assert(
          fc.asyncProperty(passwordArb, async (password) => {
            // Reset per-run state: clear captured SQL calls, logged lines,
            // and the user map. Using a unique email per run also avoids
            // duplicate-email collisions across runs.
            pool.calls.length = 0;
            logLines.length = 0;
            pool.users.clear();

            const email = `prop-${randomUUID()}@example.test`;
            const displayName = 'PropTester';

            const registerResp = await app.inject({
              method: 'POST',
              url: '/auth/register',
              payload: { email, displayName, password },
            });
            const loginResp = await app.inject({
              method: 'POST',
              url: '/auth/login',
              payload: { email, password },
            });

            // Sanity: both calls succeeded. If they didn't, the property
            // assertion below could vacuously pass on an aborted flow.
            expect(registerResp.statusCode).toBe(201);
            expect(loginResp.statusCode).toBe(200);

            // ---- Surface 1: SQL text and parameters --------------------
            for (const call of pool.calls) {
              // SQL text never embeds user input in this codebase, but
              // assert anyway so an accidental string-concatenation
              // regression would be caught here.
              expect(call.text).not.toContain(password);
              for (const param of call.params) {
                if (typeof param === 'string') {
                  expect(param).not.toContain(password);
                }
              }
            }

            // ---- Surface 2: structured log lines -----------------------
            for (const line of logLines) {
              expect(line).not.toContain(password);
            }

            // ---- Surface 3: HTTP response bodies -----------------------
            expect(registerResp.body).not.toContain(password);
            expect(loginResp.body).not.toContain(password);
          }),
          { numRuns: NUM_RUNS },
        );
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
