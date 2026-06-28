// Feature: disney-world-tracker, Property 7: completion state machine has at most one completion and rejects future or combined ops
/**
 * Property-based tests for the Tracking_Service Completion routes (task 10.5).
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.5, 2.6, 2.8
 *
 * Property 7 (design.md → Correctness Properties → "Completion state machine
 * and cardinality"):
 *
 *   For any (User, Experience) pair and any sequence of `mark(date)`,
 *   `editDate(date)`, and `unmark()` operations, the resulting state has at
 *   most one Completion, where (a) `mark` followed by `unmark` returns to
 *   the no-Completion state, (b) the latest valid `mark` or `editDate`
 *   determines the stored date, (c) any operation with a date strictly
 *   later than today in the User's local time zone is rejected and leaves
 *   the prior state unchanged, and (d) any combined unmark+date-edit
 *   operation results in no Completion and no date update.
 *
 * Test strategy: a `fast-check` `commands`-style state-machine test driven
 * over the real Completion routes plugin via Fastify's `app.inject`. The
 * persistence layer is an in-memory `CompletionRepo` backed by a `Map<key,
 * CompletionDTO>` that simulates the DB's `(user_id, experience_id)` PK by
 * returning `null` from `mark` on collision (mirroring the real repo's
 * 23505 path).
 *
 * The model holds:
 *
 *   { hasCompletion: boolean, currentDate: string | null }
 *
 * which is the externally observable Completion state for a single
 * (User, Experience) pair. The clock is fixed so `today_in_user_tz` is
 * deterministic; commands target both today (valid) and `today + 10d`
 * (invalid future) so R2.6 is exercised on every operation kind.
 *
 * Commands cover the full operation space called out by the property:
 *
 *   - Mark(date)           → PUT  with a non-future date
 *   - Edit(date)           → PATCH with a non-future date
 *   - Unmark               → DELETE
 *   - MarkFuture           → PUT  with `today + 10d`        (must be rejected)
 *   - EditFuture           → PATCH with `today + 10d`        (must be rejected)
 *   - CombinedUnmarkEdit   → PATCH with `completedOn: null` (must be rejected)
 *
 * Each command compares the real route's response (status, error code) and
 * the resulting state of the in-memory store against the model's
 * prediction. Any deviation fails the property and surfaces a shrunken
 * counter-example.
 *
 * `numRuns: 100` per the spec convention.
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';
import Fastify, { type FastifyInstance } from 'fastify';

import type { CompletionDTO } from '@dwt/shared';

import { AppError } from '../../../../errors/AppError.js';
import { registerErrorHandler } from '../../../../errors/handler.js';
import { completionRoutes } from '../routes.js';
import type {
  CompletionDeleteInput,
  CompletionRepo,
  CompletionUpsertInput,
} from '../repo.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NUM_RUNS = 100;
const MAX_COMMANDS = 30;

const USER_ID = '11111111-1111-4111-8111-111111111111';
const EXPERIENCE_ID = '22222222-2222-4222-8222-222222222222';
const TZ = 'America/New_York';

/**
 * Pin the wall clock so `today_in_user_tz` is deterministic across runs.
 * Mid-afternoon UTC keeps the date consistent in the User's TZ regardless
 * of DST quirks at the boundary.
 */
const FIXED_NOW_ISO = '2024-06-15T17:00:00Z';

// ---------------------------------------------------------------------------
// In-memory CompletionRepo (simulates the (user, experience) PK)
// ---------------------------------------------------------------------------

interface InMemoryRepo extends CompletionRepo {
  readonly store: Map<string, CompletionDTO>;
}

function makeRepoKey(userId: string, experienceId: string): string {
  return `${userId}::${experienceId}`;
}

/**
 * Build a `CompletionRepo` backed by an in-memory `Map`. The semantics
 * mirror the real Postgres-backed repo:
 *
 *   - `mark`    inserts; on PK collision the real repo translates the
 *               23505 SQLSTATE to `null`. We return `null` when the key
 *               already exists.
 *   - `edit`    updates; returns `null` when no row exists for the pair.
 *   - `unmark`  deletes; returns `true` iff a row was removed.
 */
function makeInMemoryRepo(): InMemoryRepo {
  const store = new Map<string, CompletionDTO>();
  const repo: InMemoryRepo = {
    store,
    async mark(input: CompletionUpsertInput): Promise<CompletionDTO | null> {
      const key = makeRepoKey(input.userId, input.experienceId);
      if (store.has(key)) {
        // PK collision — caller (route) maps to validation_failed.
        return null;
      }
      const dto: CompletionDTO = {
        userId: input.userId,
        experienceId: input.experienceId,
        completedOn: input.completedOn,
        userTz: input.userTz,
      };
      store.set(key, dto);
      return dto;
    },
    async edit(input: CompletionUpsertInput): Promise<CompletionDTO | null> {
      const key = makeRepoKey(input.userId, input.experienceId);
      if (!store.has(key)) return null;
      const dto: CompletionDTO = {
        userId: input.userId,
        experienceId: input.experienceId,
        completedOn: input.completedOn,
        userTz: input.userTz,
      };
      store.set(key, dto);
      return dto;
    },
    async unmark(input: CompletionDeleteInput): Promise<boolean> {
      const key = makeRepoKey(input.userId, input.experienceId);
      return store.delete(key);
    },
    async getCompletion(
      userId: string,
      experienceId: string,
    ): Promise<CompletionDTO | null> {
      const key = makeRepoKey(userId, experienceId);
      return store.get(key) ?? null;
    },
  };
  return repo;
}

// ---------------------------------------------------------------------------
// requireSession stub
// ---------------------------------------------------------------------------

/**
 * Minimal `requireSession` implementation that always assigns `USER_ID`
 * to `request.userId`. The session lifecycle is the subject of Property
 * 14, not Property 7 — exercising it here would only add noise.
 */
async function requireSession(request: {
  userId?: string;
}): Promise<void> {
  request.userId = USER_ID;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/**
 * Format a `Date` as `YYYY-MM-DD` in the supplied IANA TZ. Duplicated
 * (rather than imported) so the test computes `today_in_user_tz`
 * independently of the route's internal helper.
 */
function ymdInTz(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year').padStart(4, '0')}-${get('month')}-${get('day')}`;
}

/** Add `days` whole calendar days to a `YYYY-MM-DD` date string. */
function addDaysIso(iso: string, days: number): string {
  const parts = iso.split('-').map((p) => Number.parseInt(p, 10));
  const y = parts[0] ?? 0;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  // Construct in UTC so the math doesn't drift across DST in the local TZ.
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear().toString().padStart(4, '0');
  const mm = (dt.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = dt.getUTCDate().toString().padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

const FIXED_NOW = new Date(FIXED_NOW_ISO);
const TODAY_IN_TZ = ymdInTz(FIXED_NOW, TZ);
const FUTURE_DATE = addDaysIso(TODAY_IN_TZ, 10);

// ---------------------------------------------------------------------------
// Model + Real types
// ---------------------------------------------------------------------------

interface Model {
  hasCompletion: boolean;
  currentDate: string | null;
}

interface Real {
  app: FastifyInstance;
  repo: InMemoryRepo;
}

// ---------------------------------------------------------------------------
// App builder
// ---------------------------------------------------------------------------

async function buildApp(repo: CompletionRepo): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(
    completionRoutes({
      repo,
      requireSession: requireSession as unknown as Parameters<
        typeof completionRoutes
      >[0]['requireSession'],
      clock: () => FIXED_NOW,
    }),
  );
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Helpers used by commands
// ---------------------------------------------------------------------------

interface InjectionResult {
  statusCode: number;
  body: unknown;
}

function bodyJson(body: string): unknown {
  if (body.length === 0) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

async function injectPut(
  app: FastifyInstance,
  payload: unknown,
): Promise<InjectionResult> {
  const res = await app.inject({
    method: 'PUT',
    url: `/me/experiences/${EXPERIENCE_ID}/completion`,
    payload: payload as Record<string, unknown>,
  });
  return { statusCode: res.statusCode, body: bodyJson(res.body) };
}

async function injectPatch(
  app: FastifyInstance,
  payload: unknown,
): Promise<InjectionResult> {
  const res = await app.inject({
    method: 'PATCH',
    url: `/me/experiences/${EXPERIENCE_ID}/completion`,
    payload: payload as Record<string, unknown>,
  });
  return { statusCode: res.statusCode, body: bodyJson(res.body) };
}

async function injectDelete(
  app: FastifyInstance,
): Promise<InjectionResult> {
  const res = await app.inject({
    method: 'DELETE',
    url: `/me/experiences/${EXPERIENCE_ID}/completion`,
  });
  return { statusCode: res.statusCode, body: bodyJson(res.body) };
}

function expectErrorCode(result: InjectionResult, expectedCode: string): void {
  const body = result.body;
  if (
    body === null ||
    typeof body !== 'object' ||
    !('error' in body) ||
    typeof (body as { error: unknown }).error !== 'object' ||
    (body as { error: { code: unknown } }).error.code !== expectedCode
  ) {
    throw new AppError(
      'internal_error',
      `expected error code "${expectedCode}", got status=${result.statusCode}, body=${JSON.stringify(body)}`,
    );
  }
}

function repoState(real: Real): {
  size: number;
  dto: CompletionDTO | undefined;
} {
  const dto = real.repo.store.get(makeRepoKey(USER_ID, EXPERIENCE_ID));
  return { size: real.repo.store.size, dto };
}

function assertRepoMatches(
  m: Model,
  real: Real,
  context: string,
): void {
  const { size, dto } = repoState(real);
  // Cardinality (R2.3): at most one Completion ever exists for the pair.
  // The in-memory map is keyed by `(userId, experienceId)`, so size > 1
  // would only be possible if the repo silently created an extra row;
  // we still assert to lock the invariant in.
  if (size > 1) {
    throw new AppError(
      'internal_error',
      `cardinality violated (${context}): more than one Completion stored: size=${size}`,
    );
  }
  if (m.hasCompletion) {
    if (dto === undefined) {
      throw new AppError(
        'internal_error',
        `model expected Completion present (${context}) but real repo has none`,
      );
    }
    if (dto.completedOn !== m.currentDate) {
      throw new AppError(
        'internal_error',
        `latest-write rule violated (${context}): model date=${m.currentDate}, real date=${dto.completedOn}`,
      );
    }
  } else {
    if (dto !== undefined) {
      throw new AppError(
        'internal_error',
        `model expected no Completion (${context}) but real repo has dto=${JSON.stringify(dto)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * Mark with a non-future date.
 *
 *   - When the model has no Completion: success → hasCompletion=true,
 *     currentDate = date.
 *   - When the model has a Completion: rejected with `validation_failed`
 *     (per the route's PK-collision branch). The prior state is preserved.
 */
class MarkCommand implements fc.AsyncCommand<Model, Real> {
  constructor(public readonly date: string) {}
  check(_m: Readonly<Model>): boolean {
    return true;
  }
  async run(m: Model, r: Real): Promise<void> {
    const result = await injectPut(r.app, {
      completedOn: this.date,
      userTz: TZ,
    });
    if (m.hasCompletion) {
      // Already present → mark must be rejected; state must be unchanged.
      if (result.statusCode !== 400) {
        throw new AppError(
          'internal_error',
          `Mark on existing should fail with 400; got ${result.statusCode}`,
        );
      }
      expectErrorCode(result, 'validation_failed');
      assertRepoMatches(m, r, 'Mark on existing');
      return;
    }
    if (result.statusCode !== 201) {
      throw new AppError(
        'internal_error',
        `Mark on empty should succeed with 201; got ${result.statusCode}, body=${JSON.stringify(result.body)}`,
      );
    }
    m.hasCompletion = true;
    m.currentDate = this.date;
    assertRepoMatches(m, r, 'Mark on empty');
  }
  toString(): string {
    return `Mark(${this.date})`;
  }
}

/**
 * Edit with a non-future date.
 *
 *   - When the model has a Completion: success → currentDate = date.
 *   - When the model has no Completion: rejected with
 *     `completion_not_found`. Prior state preserved.
 */
class EditCommand implements fc.AsyncCommand<Model, Real> {
  constructor(public readonly date: string) {}
  check(_m: Readonly<Model>): boolean {
    return true;
  }
  async run(m: Model, r: Real): Promise<void> {
    const result = await injectPatch(r.app, {
      completedOn: this.date,
      userTz: TZ,
    });
    if (!m.hasCompletion) {
      if (result.statusCode !== 404) {
        throw new AppError(
          'internal_error',
          `Edit on empty should fail with 404; got ${result.statusCode}`,
        );
      }
      expectErrorCode(result, 'completion_not_found');
      assertRepoMatches(m, r, 'Edit on empty');
      return;
    }
    if (result.statusCode !== 200) {
      throw new AppError(
        'internal_error',
        `Edit on existing should succeed with 200; got ${result.statusCode}, body=${JSON.stringify(result.body)}`,
      );
    }
    m.currentDate = this.date;
    assertRepoMatches(m, r, 'Edit on existing');
  }
  toString(): string {
    return `Edit(${this.date})`;
  }
}

/**
 * Unmark.
 *
 *   - When the model has a Completion: success → hasCompletion=false,
 *     currentDate=null. The route returns 204 with empty body.
 *   - When the model has no Completion: rejected with
 *     `completion_not_found` (R2.7).
 */
class UnmarkCommand implements fc.AsyncCommand<Model, Real> {
  check(_m: Readonly<Model>): boolean {
    return true;
  }
  async run(m: Model, r: Real): Promise<void> {
    const result = await injectDelete(r.app);
    if (!m.hasCompletion) {
      if (result.statusCode !== 404) {
        throw new AppError(
          'internal_error',
          `Unmark on empty should fail with 404; got ${result.statusCode}`,
        );
      }
      expectErrorCode(result, 'completion_not_found');
      assertRepoMatches(m, r, 'Unmark on empty');
      return;
    }
    if (result.statusCode !== 204) {
      throw new AppError(
        'internal_error',
        `Unmark on existing should succeed with 204; got ${result.statusCode}, body=${JSON.stringify(result.body)}`,
      );
    }
    m.hasCompletion = false;
    m.currentDate = null;
    assertRepoMatches(m, r, 'Unmark on existing');
  }
  toString(): string {
    return 'Unmark';
  }
}

/**
 * Mark with a date strictly after `today_in_user_tz` (R2.6). Always
 * rejected with `completion_future_date`; the prior state is preserved
 * regardless of whether a Completion already existed.
 */
class MarkFutureCommand implements fc.AsyncCommand<Model, Real> {
  check(_m: Readonly<Model>): boolean {
    return true;
  }
  async run(m: Model, r: Real): Promise<void> {
    const before = { ...m };
    const result = await injectPut(r.app, {
      completedOn: FUTURE_DATE,
      userTz: TZ,
    });
    if (result.statusCode !== 400) {
      throw new AppError(
        'internal_error',
        `MarkFuture should fail with 400; got ${result.statusCode}`,
      );
    }
    expectErrorCode(result, 'completion_future_date');
    // Prior state preserved.
    if (m.hasCompletion !== before.hasCompletion || m.currentDate !== before.currentDate) {
      throw new AppError(
        'internal_error',
        'MarkFuture command mutated model state; should be a no-op',
      );
    }
    assertRepoMatches(m, r, 'MarkFuture');
  }
  toString(): string {
    return `MarkFuture(${FUTURE_DATE})`;
  }
}

/**
 * Edit with a date strictly after `today_in_user_tz` (R2.6). Always
 * rejected with `completion_future_date`; the prior state is preserved.
 *
 * Note: when no Completion exists, the route still rejects with the
 * future-date error (the future-date guard runs before the DB lookup).
 * That ordering is observable here and asserted as part of "prior state
 * unchanged".
 */
class EditFutureCommand implements fc.AsyncCommand<Model, Real> {
  check(_m: Readonly<Model>): boolean {
    return true;
  }
  async run(m: Model, r: Real): Promise<void> {
    const before = { ...m };
    const result = await injectPatch(r.app, {
      completedOn: FUTURE_DATE,
      userTz: TZ,
    });
    if (result.statusCode !== 400) {
      throw new AppError(
        'internal_error',
        `EditFuture should fail with 400; got ${result.statusCode}`,
      );
    }
    expectErrorCode(result, 'completion_future_date');
    if (m.hasCompletion !== before.hasCompletion || m.currentDate !== before.currentDate) {
      throw new AppError(
        'internal_error',
        'EditFuture command mutated model state; should be a no-op',
      );
    }
    assertRepoMatches(m, r, 'EditFuture');
  }
  toString(): string {
    return `EditFuture(${FUTURE_DATE})`;
  }
}

/**
 * Combined unmark+edit (R2.8). Two encodings are exercised — `completedOn:
 * null` and `unmark: true` alongside a date — both must be rejected with
 * `completion_combined_op_not_allowed` and must leave prior state
 * untouched.
 */
class CombinedUnmarkEditCommand implements fc.AsyncCommand<Model, Real> {
  constructor(public readonly variant: 'null-date' | 'unmark-flag') {}
  check(_m: Readonly<Model>): boolean {
    return true;
  }
  async run(m: Model, r: Real): Promise<void> {
    const before = { ...m };
    const payload =
      this.variant === 'null-date'
        ? { completedOn: null, userTz: TZ }
        : { completedOn: TODAY_IN_TZ, userTz: TZ, unmark: true };
    const result = await injectPatch(r.app, payload);
    if (result.statusCode !== 400) {
      throw new AppError(
        'internal_error',
        `CombinedUnmarkEdit(${this.variant}) should fail with 400; got ${result.statusCode}`,
      );
    }
    expectErrorCode(result, 'completion_combined_op_not_allowed');
    if (m.hasCompletion !== before.hasCompletion || m.currentDate !== before.currentDate) {
      throw new AppError(
        'internal_error',
        `CombinedUnmarkEdit(${this.variant}) mutated model state; should be a no-op`,
      );
    }
    assertRepoMatches(m, r, `CombinedUnmarkEdit(${this.variant})`);
  }
  toString(): string {
    return `CombinedUnmarkEdit(${this.variant})`;
  }
}

// ---------------------------------------------------------------------------
// Command arbitrary
// ---------------------------------------------------------------------------

/**
 * Generate a date in a small window around `today_in_user_tz`. The window
 * intentionally extends to `today` and behind it (Completions in the past
 * are valid) but never strictly after — the future-date space is covered
 * by the dedicated `MarkFuture` and `EditFuture` commands so the model
 * predicate stays simple.
 */
const validDateArb: fc.Arbitrary<string> = fc
  .integer({ min: -90, max: 0 })
  .map((delta) => addDaysIso(TODAY_IN_TZ, delta));

const markCmdArb = validDateArb.map((d) => new MarkCommand(d));
const editCmdArb = validDateArb.map((d) => new EditCommand(d));
const unmarkCmdArb = fc.constant(new UnmarkCommand());
const markFutureCmdArb = fc.constant(new MarkFutureCommand());
const editFutureCmdArb = fc.constant(new EditFutureCommand());
const combinedCmdArb = fc
  .constantFrom<'null-date' | 'unmark-flag'>('null-date', 'unmark-flag')
  .map((v) => new CombinedUnmarkEditCommand(v));

// Bias the distribution so the happy-path commands dominate, ensuring
// runs reach interleaved state transitions; the rejection-path commands
// fire often enough to exercise R2.6 and R2.8 in every shrunken trace.
const cmdArb = fc.oneof(
  { weight: 4, arbitrary: markCmdArb },
  { weight: 4, arbitrary: editCmdArb },
  { weight: 3, arbitrary: unmarkCmdArb },
  { weight: 1, arbitrary: markFutureCmdArb },
  { weight: 1, arbitrary: editFutureCmdArb },
  { weight: 1, arbitrary: combinedCmdArb },
);

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Completion routes — Property 7: state machine and cardinality', () => {
  it(
    'a sequence of mark/edit/unmark plus future and combined ops preserves at-most-one cardinality and matches the model',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.commands([cmdArb], { maxCommands: MAX_COMMANDS }),
          async (cmds) => {
            const repo = makeInMemoryRepo();
            const app = await buildApp(repo);
            try {
              const setup = (): { model: Model; real: Real } => ({
                model: { hasCompletion: false, currentDate: null },
                real: { app, repo },
              });
              await fc.asyncModelRun(setup, cmds);
            } finally {
              await app.close();
            }
          },
        ),
        { numRuns: NUM_RUNS },
      );
    },
    60_000,
  );
});
