// Feature: resort-tracking-and-stats, Property 8: completion idempotence for resorts
/**
 * Property-based test for resort completion idempotence (task 7.2).
 *
 * Validates: Requirements 3.1, 3.2, 3.3
 *
 * Property 8 (design.md → Correctness Properties → "Completion idempotence
 * for resorts"):
 *
 *   Recording a Resort_Visit twice for the same `(user, resort)` yields
 *   exactly one Completion; removing it deletes it.
 *
 * Under Option A a Resort is completed through the *existing* per-Experience
 * completion endpoints, targeting the Resort's resort-representing
 * `experienceId`. A Resort_Visit is therefore just a Completion against that
 * representing Experience, and this property is a statement about the
 * completions write path for a single `(user, experience)` pair:
 *
 *   - PUT is idempotent at the state level: the `completions` PK on
 *     `(user_id, experience_id)` guarantees at most one Completion for the
 *     pair, so a second mark cannot create a duplicate (R3.2). The route
 *     rejects the second mark, but the persisted state stays at exactly one
 *     Completion.
 *   - DELETE removes the Completion (R3.3), returning to the no-Completion
 *     state.
 *   - The first mark records a Completion associating the User with the
 *     Resort's representing Experience (R3.1).
 *
 * Test strategy mirrors the sibling Property 7 suite: a `fast-check`
 * `commands` state-machine test drives the real Completion routes plugin via
 * Fastify's `app.inject`, backed by an in-memory `CompletionRepo` whose
 * `Map<key, CompletionDTO>` reproduces the DB's `(user_id, experience_id)` PK
 * (a second insert on the same key returns `null`, exactly as the real repo's
 * 23505 path does). The representing `experienceId` and the acting `userId`
 * are generated per run to stand in for an arbitrary `(user, resort)` pair.
 *
 * The model holds only `{ hasVisit: boolean }` — the externally observable
 * Resort_Visit state — and every command asserts the store never holds more
 * than one Completion for the pair (the at-most-one cardinality at the heart
 * of the property).
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

const TZ = 'America/New_York';

/**
 * Pin the wall clock so `today_in_user_tz` is deterministic across runs.
 * Mid-afternoon UTC keeps the date consistent in the User's TZ regardless of
 * DST quirks at the boundary. Every generated visit date is today-or-earlier,
 * so the route's future-date guard never fires — this property is about
 * idempotence, not the future-date rule (Property 7 owns that).
 */
const FIXED_NOW_ISO = '2024-06-15T17:00:00Z';
const FIXED_NOW = new Date(FIXED_NOW_ISO);

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
 * Build a `CompletionRepo` backed by an in-memory `Map`, with the same
 * semantics as the Postgres-backed repo: `mark` inserts and returns `null`
 * on PK collision, `unmark` deletes and returns whether a row was removed.
 */
function makeInMemoryRepo(): InMemoryRepo {
  const store = new Map<string, CompletionDTO>();
  const repo: InMemoryRepo = {
    store,
    async mark(input: CompletionUpsertInput): Promise<CompletionDTO | null> {
      const key = makeRepoKey(input.userId, input.experienceId);
      if (store.has(key)) {
        // PK collision — the representing Experience already has a visit.
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
// Date helper
// ---------------------------------------------------------------------------

/** Format a `Date` as `YYYY-MM-DD` in the supplied IANA TZ. */
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
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear().toString().padStart(4, '0');
  const mm = (dt.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = dt.getUTCDate().toString().padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

const TODAY_IN_TZ = ymdInTz(FIXED_NOW, TZ);

// ---------------------------------------------------------------------------
// Model + Real types
// ---------------------------------------------------------------------------

interface Model {
  /** Whether a Resort_Visit exists for the (user, representing experience). */
  hasVisit: boolean;
}

interface Real {
  app: FastifyInstance;
  repo: InMemoryRepo;
  userId: string;
  /** The Resort's resort-representing Experience id (the completion target). */
  experienceId: string;
}

// ---------------------------------------------------------------------------
// requireSession stub — always authenticates as the run's userId
// ---------------------------------------------------------------------------

function makeRequireSession(userId: string) {
  return async function requireSession(request: {
    userId?: string;
  }): Promise<void> {
    request.userId = userId;
  };
}

// ---------------------------------------------------------------------------
// App builder
// ---------------------------------------------------------------------------

async function buildApp(
  repo: CompletionRepo,
  userId: string,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(
    completionRoutes({
      repo,
      requireSession: makeRequireSession(userId) as unknown as Parameters<
        typeof completionRoutes
      >[0]['requireSession'],
      clock: () => FIXED_NOW,
    }),
  );
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Injection helpers
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

async function injectMark(
  real: Real,
  date: string,
): Promise<InjectionResult> {
  const res = await real.app.inject({
    method: 'PUT',
    url: `/me/experiences/${real.experienceId}/completion`,
    payload: { completedOn: date, userTz: TZ },
  });
  return { statusCode: res.statusCode, body: bodyJson(res.body) };
}

async function injectUnmark(real: Real): Promise<InjectionResult> {
  const res = await real.app.inject({
    method: 'DELETE',
    url: `/me/experiences/${real.experienceId}/completion`,
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

/**
 * The heart of Property 8: the store never holds more than one Completion for
 * the (user, resort representing experience) pair, and its presence exactly
 * matches the model.
 */
function assertVisitCardinality(m: Model, r: Real, context: string): void {
  const key = makeRepoKey(r.userId, r.experienceId);
  const dto = r.repo.store.get(key);
  // Count Completions for exactly this pair.
  let count = 0;
  for (const stored of r.repo.store.values()) {
    if (stored.userId === r.userId && stored.experienceId === r.experienceId) {
      count += 1;
    }
  }
  if (count > 1) {
    throw new AppError(
      'internal_error',
      `resort visit cardinality violated (${context}): more than one Completion for the pair: count=${count}`,
    );
  }
  if (m.hasVisit) {
    if (dto === undefined || count !== 1) {
      throw new AppError(
        'internal_error',
        `model expected exactly one Resort_Visit (${context}) but store count=${count}`,
      );
    }
  } else if (dto !== undefined || count !== 0) {
    throw new AppError(
      'internal_error',
      `model expected no Resort_Visit (${context}) but store count=${count}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * Record a Resort_Visit (PUT against the representing experienceId).
 *
 *   - First mark on an empty pair → 201; a single Completion now exists (R3.1).
 *   - Mark on an already-visited pair → rejected (the PK forbids a duplicate);
 *     the state stays at exactly one Completion, which is the idempotence
 *     guarantee of R3.2 expressed at the persisted-state level.
 */
class MarkResortVisitCommand implements fc.AsyncCommand<Model, Real> {
  constructor(public readonly date: string) {}
  check(_m: Readonly<Model>): boolean {
    return true;
  }
  async run(m: Model, r: Real): Promise<void> {
    const result = await injectMark(r, this.date);
    if (m.hasVisit) {
      // Duplicate mark must not create a second Completion.
      if (result.statusCode !== 400) {
        throw new AppError(
          'internal_error',
          `Duplicate Resort_Visit mark should be rejected with 400; got ${result.statusCode}`,
        );
      }
      expectErrorCode(result, 'validation_failed');
      assertVisitCardinality(m, r, 'Mark on existing visit');
      return;
    }
    if (result.statusCode !== 201) {
      throw new AppError(
        'internal_error',
        `First Resort_Visit mark should succeed with 201; got ${result.statusCode}, body=${JSON.stringify(result.body)}`,
      );
    }
    m.hasVisit = true;
    assertVisitCardinality(m, r, 'First mark');
  }
  toString(): string {
    return `MarkResortVisit(${this.date})`;
  }
}

/**
 * Remove a Resort_Visit (DELETE against the representing experienceId).
 *
 *   - When a visit exists → 204 and the Completion is deleted (R3.3).
 *   - When none exists → 404 `completion_not_found`; nothing to delete.
 */
class UnmarkResortVisitCommand implements fc.AsyncCommand<Model, Real> {
  check(_m: Readonly<Model>): boolean {
    return true;
  }
  async run(m: Model, r: Real): Promise<void> {
    const result = await injectUnmark(r);
    if (!m.hasVisit) {
      if (result.statusCode !== 404) {
        throw new AppError(
          'internal_error',
          `Unmark with no visit should fail with 404; got ${result.statusCode}`,
        );
      }
      expectErrorCode(result, 'completion_not_found');
      assertVisitCardinality(m, r, 'Unmark on empty');
      return;
    }
    if (result.statusCode !== 204) {
      throw new AppError(
        'internal_error',
        `Unmark of an existing visit should succeed with 204; got ${result.statusCode}`,
      );
    }
    m.hasVisit = false;
    assertVisitCardinality(m, r, 'Unmark on existing');
  }
  toString(): string {
    return 'UnmarkResortVisit';
  }
}

// ---------------------------------------------------------------------------
// Command arbitrary
// ---------------------------------------------------------------------------

/** A visit date in the recent past (today-or-earlier) so it is always valid. */
const validDateArb: fc.Arbitrary<string> = fc
  .integer({ min: -90, max: 0 })
  .map((delta) => addDaysIso(TODAY_IN_TZ, delta));

const markCmdArb = validDateArb.map((d) => new MarkResortVisitCommand(d));
const unmarkCmdArb = fc.constant(new UnmarkResortVisitCommand());

// Bias toward marks so consecutive marks (the "record twice" case) occur
// often, while keeping enough unmarks to exercise the delete transition.
const cmdArb = fc.oneof(
  { weight: 3, arbitrary: markCmdArb },
  { weight: 2, arbitrary: unmarkCmdArb },
);

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Resort completion — Property 8: completion idempotence for resorts', () => {
  it(
    'any sequence of record/remove against a resort representing experience keeps at most one Completion; recording twice leaves exactly one and removing deletes it',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          fc.uuid(),
          fc.commands([cmdArb], { maxCommands: MAX_COMMANDS }),
          async (userId, experienceId, cmds) => {
            const repo = makeInMemoryRepo();
            const app = await buildApp(repo, userId);
            try {
              const setup = (): { model: Model; real: Real } => ({
                model: { hasVisit: false },
                real: { app, repo, userId, experienceId },
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

  it(
    'recording a Resort_Visit twice yields exactly one Completion and removing it deletes it (explicit)',
    async () => {
      await fc.assert(
        fc.asyncProperty(fc.uuid(), fc.uuid(), async (userId, experienceId) => {
          const repo = makeInMemoryRepo();
          const app = await buildApp(repo, userId);
          try {
            const real: Real = { app, repo, userId, experienceId };
            const model: Model = { hasVisit: false };

            // First record → exactly one Completion.
            const first = await injectMark(real, TODAY_IN_TZ);
            if (first.statusCode !== 201) {
              throw new AppError(
                'internal_error',
                `first mark expected 201; got ${first.statusCode}`,
              );
            }
            model.hasVisit = true;
            assertVisitCardinality(model, real, 'explicit first mark');

            // Second record for the same (user, resort) → still exactly one.
            await injectMark(real, TODAY_IN_TZ);
            assertVisitCardinality(model, real, 'explicit second mark');

            // Remove → deleted.
            const removed = await injectUnmark(real);
            if (removed.statusCode !== 204) {
              throw new AppError(
                'internal_error',
                `unmark expected 204; got ${removed.statusCode}`,
              );
            }
            model.hasVisit = false;
            assertVisitCardinality(model, real, 'explicit unmark');
          } finally {
            await app.close();
          }
        }),
        { numRuns: NUM_RUNS },
      );
    },
    60_000,
  );
});
