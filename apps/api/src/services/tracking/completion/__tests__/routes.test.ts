/**
 * Unit tests for the Tracking_Service Completion routes (task 10.1).
 *
 * The plugin is registered against an in-process Fastify instance with
 * a fake `CompletionRepo` and a stubbed `requireSession` pre-handler.
 * No real Postgres pool is involved.
 *
 * Coverage:
 *
 *   - PUT  201 success path; rejects future date (R2.6); rejects unknown
 *          IANA TZ; rejects when a Completion already exists.
 *   - PATCH 200 success path; rejects future date (R2.6); rejects
 *          combined unmark+edit body (R2.8); rejects when no Completion
 *          exists.
 *   - DELETE 204 success path; 404 when no Completion exists (R2.7).
 *   - All routes refuse anonymous traffic (`unauthorized`).
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

import { AppError } from '../../../../errors/AppError.js';
import { registerErrorHandler } from '../../../../errors/handler.js';
import { completionRoutes } from '../routes.js';
import type {
  CompletionDeleteInput,
  CompletionRepo,
  CompletionUpsertInput,
} from '../repo.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const USER_ID = '11111111-1111-4111-8111-111111111111';
const EXPERIENCE_ID = '22222222-2222-4222-8222-222222222222';
const TZ = 'America/New_York';

/** Build a fake clock pinned to a specific moment. */
function fixedClock(iso: string): () => Date {
  const at = new Date(iso);
  return () => at;
}

/**
 * Format a `Date` as `YYYY-MM-DD` in the supplied IANA TZ — duplicated
 * here so the tests verify "today_in_user_tz" without reaching into
 * `routes.ts` internals.
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

// ---------------------------------------------------------------------------
// Fake CompletionRepo
// ---------------------------------------------------------------------------

interface FakeRepo extends CompletionRepo {
  readonly markCalls: CompletionUpsertInput[];
  readonly editCalls: CompletionUpsertInput[];
  readonly unmarkCalls: CompletionDeleteInput[];
  /** When set, `mark` returns `null` to simulate a PK collision. */
  markCollision: boolean;
  /** When `true`, `edit` returns `null` to simulate "no row to update". */
  editMissing: boolean;
  /** When `true`, `unmark` returns `false` to simulate "no row to delete". */
  unmarkMissing: boolean;
}

function makeFakeRepo(): FakeRepo {
  const markCalls: CompletionUpsertInput[] = [];
  const editCalls: CompletionUpsertInput[] = [];
  const unmarkCalls: CompletionDeleteInput[] = [];
  const fake: FakeRepo = {
    markCalls,
    editCalls,
    unmarkCalls,
    markCollision: false,
    editMissing: false,
    unmarkMissing: false,
    async mark(input) {
      markCalls.push(input);
      if (fake.markCollision) return null;
      return {
        userId: input.userId,
        experienceId: input.experienceId,
        completedOn: input.completedOn,
        userTz: input.userTz,
      };
    },
    async edit(input) {
      editCalls.push(input);
      if (fake.editMissing) return null;
      return {
        userId: input.userId,
        experienceId: input.experienceId,
        completedOn: input.completedOn,
        userTz: input.userTz,
      };
    },
    async unmark(input) {
      unmarkCalls.push(input);
      return !fake.unmarkMissing;
    },
  };
  return fake;
}

// ---------------------------------------------------------------------------
// requireSession stub
// ---------------------------------------------------------------------------
//
// Reads `x-test-user-id` from the request headers; absent → 401.

function makeRequireSession(opts: { userId?: string } = {}) {
  return async function requireSession(request: {
    headers: Record<string, string | string[] | undefined>;
    userId?: string;
  }): Promise<void> {
    const headerUserId = request.headers['x-test-user-id'];
    const id =
      typeof headerUserId === 'string' && headerUserId.length > 0
        ? headerUserId
        : opts.userId;
    if (!id) {
      throw new AppError('unauthorized', 'Authentication is required.');
    }
    request.userId = id;
  };
}

// ---------------------------------------------------------------------------
// Test app builder
// ---------------------------------------------------------------------------

async function buildApp(opts: {
  repo: CompletionRepo;
  clock?: () => Date;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  // Build the options object incrementally so `clock: undefined` is never
  // assigned (the option's type forbids `undefined` under
  // `exactOptionalPropertyTypes`).
  const routeOpts: Parameters<typeof completionRoutes>[0] = opts.clock
    ? {
        repo: opts.repo,
        requireSession: makeRequireSession() as unknown as Parameters<
          typeof completionRoutes
        >[0]['requireSession'],
        clock: opts.clock,
      }
    : {
        repo: opts.repo,
        requireSession: makeRequireSession() as unknown as Parameters<
          typeof completionRoutes
        >[0]['requireSession'],
      };
  await app.register(completionRoutes(routeOpts));
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// PUT /me/experiences/:id/completion
// ---------------------------------------------------------------------------

describe('PUT /me/experiences/:id/completion', () => {
  it('marks a completion with date today in the user TZ (R2.1) and returns 201', async () => {
    const repo = makeFakeRepo();
    const clock = fixedClock('2024-06-15T12:00:00Z');
    const app = await buildApp({ repo, clock });
    const today = ymdInTz(clock(), TZ);

    const res = await app.inject({
      method: 'PUT',
      url: `/me/experiences/${EXPERIENCE_ID}/completion`,
      headers: { 'x-test-user-id': USER_ID },
      payload: { completedOn: today, userTz: TZ },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      userId: USER_ID,
      experienceId: EXPERIENCE_ID,
      completedOn: today,
      userTz: TZ,
    });
    expect(repo.markCalls).toHaveLength(1);
    expect(repo.markCalls[0]).toEqual({
      userId: USER_ID,
      experienceId: EXPERIENCE_ID,
      completedOn: today,
      userTz: TZ,
    });
  });

  it('rejects a date strictly after today_in_user_tz with completion_future_date (R2.6)', async () => {
    const repo = makeFakeRepo();
    const clock = fixedClock('2024-06-15T12:00:00Z');
    const app = await buildApp({ repo, clock });

    const res = await app.inject({
      method: 'PUT',
      url: `/me/experiences/${EXPERIENCE_ID}/completion`,
      headers: { 'x-test-user-id': USER_ID },
      payload: { completedOn: '2024-12-31', userTz: TZ },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: { code: 'completion_future_date', field: 'completedOn' },
    });
    expect(repo.markCalls).toHaveLength(0);
  });

  it('rejects an unknown IANA TZ identifier with validation_failed', async () => {
    const repo = makeFakeRepo();
    const app = await buildApp({ repo, clock: fixedClock('2024-06-15T12:00:00Z') });

    const res = await app.inject({
      method: 'PUT',
      url: `/me/experiences/${EXPERIENCE_ID}/completion`,
      headers: { 'x-test-user-id': USER_ID },
      // Structurally valid TZ shape but unknown to the IANA database.
      payload: { completedOn: '2024-06-14', userTz: 'Made/Up_Zone' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: { code: 'validation_failed', field: 'userTz' },
    });
    expect(repo.markCalls).toHaveLength(0);
  });

  it('rejects a duplicate Completion with validation_failed', async () => {
    const repo = makeFakeRepo();
    repo.markCollision = true;
    const clock = fixedClock('2024-06-15T12:00:00Z');
    const app = await buildApp({ repo, clock });

    const res = await app.inject({
      method: 'PUT',
      url: `/me/experiences/${EXPERIENCE_ID}/completion`,
      headers: { 'x-test-user-id': USER_ID },
      payload: { completedOn: ymdInTz(clock(), TZ), userTz: TZ },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_failed');
  });

  it('rejects anonymous requests with unauthorized', async () => {
    const repo = makeFakeRepo();
    const app = await buildApp({ repo });

    const res = await app.inject({
      method: 'PUT',
      url: `/me/experiences/${EXPERIENCE_ID}/completion`,
      payload: { completedOn: '2024-06-14', userTz: TZ },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthorized');
  });
});

// ---------------------------------------------------------------------------
// PATCH /me/experiences/:id/completion
// ---------------------------------------------------------------------------

describe('PATCH /me/experiences/:id/completion', () => {
  it('edits an existing completion date and returns the updated DTO (R2.5)', async () => {
    const repo = makeFakeRepo();
    const clock = fixedClock('2024-06-15T12:00:00Z');
    const app = await buildApp({ repo, clock });
    const newDate = '2024-06-10';

    const res = await app.inject({
      method: 'PATCH',
      url: `/me/experiences/${EXPERIENCE_ID}/completion`,
      headers: { 'x-test-user-id': USER_ID },
      payload: { completedOn: newDate, userTz: TZ },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      userId: USER_ID,
      experienceId: EXPERIENCE_ID,
      completedOn: newDate,
      userTz: TZ,
    });
    expect(repo.editCalls).toHaveLength(1);
  });

  it('rejects a date strictly after today_in_user_tz with completion_future_date (R2.6)', async () => {
    const repo = makeFakeRepo();
    const clock = fixedClock('2024-06-15T12:00:00Z');
    const app = await buildApp({ repo, clock });

    const res = await app.inject({
      method: 'PATCH',
      url: `/me/experiences/${EXPERIENCE_ID}/completion`,
      headers: { 'x-test-user-id': USER_ID },
      payload: { completedOn: '2024-12-31', userTz: TZ },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('completion_future_date');
    expect(repo.editCalls).toHaveLength(0);
  });

  it('rejects a combined unmark+edit body with completion_combined_op_not_allowed (R2.8)', async () => {
    const repo = makeFakeRepo();
    const clock = fixedClock('2024-06-15T12:00:00Z');
    const app = await buildApp({ repo, clock });

    // Explicit `completedOn: null` is the JSON-natural way to express
    // an unmark inside an edit body. R2.8 forbids that combination.
    const res = await app.inject({
      method: 'PATCH',
      url: `/me/experiences/${EXPERIENCE_ID}/completion`,
      headers: { 'x-test-user-id': USER_ID },
      payload: { completedOn: null, userTz: TZ },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('completion_combined_op_not_allowed');
    expect(repo.editCalls).toHaveLength(0);
  });

  it('also rejects an explicit `unmark: true` flag alongside a date (R2.8)', async () => {
    const repo = makeFakeRepo();
    const clock = fixedClock('2024-06-15T12:00:00Z');
    const app = await buildApp({ repo, clock });

    const res = await app.inject({
      method: 'PATCH',
      url: `/me/experiences/${EXPERIENCE_ID}/completion`,
      headers: { 'x-test-user-id': USER_ID },
      payload: { completedOn: '2024-06-10', userTz: TZ, unmark: true },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('completion_combined_op_not_allowed');
    expect(repo.editCalls).toHaveLength(0);
  });

  it('returns completion_not_found when no row exists for the user/experience pair', async () => {
    const repo = makeFakeRepo();
    repo.editMissing = true;
    const clock = fixedClock('2024-06-15T12:00:00Z');
    const app = await buildApp({ repo, clock });

    const res = await app.inject({
      method: 'PATCH',
      url: `/me/experiences/${EXPERIENCE_ID}/completion`,
      headers: { 'x-test-user-id': USER_ID },
      payload: { completedOn: '2024-06-10', userTz: TZ },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('completion_not_found');
  });

  it('rejects anonymous requests with unauthorized', async () => {
    const repo = makeFakeRepo();
    const app = await buildApp({ repo });

    const res = await app.inject({
      method: 'PATCH',
      url: `/me/experiences/${EXPERIENCE_ID}/completion`,
      payload: { completedOn: '2024-06-14', userTz: TZ },
    });

    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// DELETE /me/experiences/:id/completion
// ---------------------------------------------------------------------------

describe('DELETE /me/experiences/:id/completion', () => {
  it('unmarks an existing completion and returns 204 (R2.2)', async () => {
    const repo = makeFakeRepo();
    const app = await buildApp({ repo });

    const res = await app.inject({
      method: 'DELETE',
      url: `/me/experiences/${EXPERIENCE_ID}/completion`,
      headers: { 'x-test-user-id': USER_ID },
    });

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(repo.unmarkCalls).toEqual([
      { userId: USER_ID, experienceId: EXPERIENCE_ID },
    ]);
  });

  it('returns completion_not_found when no row exists for the pair (R2.7)', async () => {
    const repo = makeFakeRepo();
    repo.unmarkMissing = true;
    const app = await buildApp({ repo });

    const res = await app.inject({
      method: 'DELETE',
      url: `/me/experiences/${EXPERIENCE_ID}/completion`,
      headers: { 'x-test-user-id': USER_ID },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('completion_not_found');
  });

  it('rejects anonymous requests with unauthorized', async () => {
    const repo = makeFakeRepo();
    const app = await buildApp({ repo });

    const res = await app.inject({
      method: 'DELETE',
      url: `/me/experiences/${EXPERIENCE_ID}/completion`,
    });

    expect(res.statusCode).toBe(401);
  });
});
