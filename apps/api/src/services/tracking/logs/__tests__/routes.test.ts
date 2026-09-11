/**
 * Integration tests for the Experience_Log routes plugin
 * (experience-activity-logging). The plugin is registered against an
 * in-process Fastify instance with a fake `ExperienceLogRepo` and a stubbed
 * `requireSession`, so the tests are hermetic and focus on the route layer:
 * auth gating, input validation → error codes, happy-path status codes, and
 * the delete not-found mapping. The dual-write / cascade behavior is covered
 * by the repo property tests.
 *
 * Coverage:
 *   - POST 201 happy path forwards the parsed body (rating/note/tripId) to the repo (R1.1, R1.2)
 *   - POST 401 when unauthenticated
 *   - POST 400 validation_failed on bad date / bad :id; rating_out_of_range; note_length_invalid
 *   - POST 403 trip_forbidden propagates from the repo
 *   - GET 200 returns the visit history payload (R4.1-R4.3)
 *   - GET 401 when unauthenticated
 *   - DELETE 204 on success; 404 log_not_found when the repo reports not deleted (R5.1)
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ExperienceLogDTO, ExperienceVisitHistoryDTO } from '@dwt/shared';

import { registerErrorHandler } from '../../../../errors/handler.js';
import { AppError } from '../../../../errors/AppError.js';
import {
  experienceLogRoutes,
  type ExperienceLogRoutesOptions,
} from '../routes.js';
import type {
  CreateLogInput,
  DeleteLogResult,
  ExperienceLogRepo,
} from '../repo.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const EXPERIENCE_ID = '22222222-2222-4222-8222-222222222222';
const LOG_ID = '33333333-3333-4333-8333-333333333333';
const TRIP_ID = '44444444-4444-4444-8444-444444444444';

// ---------------------------------------------------------------------------
// Fake repo
// ---------------------------------------------------------------------------

interface FakeLogRepo extends ExperienceLogRepo {
  readonly addCalls: CreateLogInput[];
  readonly deleteCalls: { userId: string; experienceId: string; logId: string }[];
  addResult: ExperienceLogDTO;
  addError: AppError | null;
  historyResult: ExperienceVisitHistoryDTO;
  deleteResult: DeleteLogResult;
}

function makeRepo(): FakeLogRepo {
  const addCalls: CreateLogInput[] = [];
  const deleteCalls: { userId: string; experienceId: string; logId: string }[] = [];
  const defaultLog: ExperienceLogDTO = {
    id: LOG_ID,
    userId: USER_ID,
    experienceId: EXPERIENCE_ID,
    visitedOn: '2026-01-02',
    userTz: 'America/New_York',
    loggedAt: '2026-01-02T15:00:00.000Z',
    rating: null,
    note: null,
  };
  return {
    addCalls,
    deleteCalls,
    addResult: defaultLog,
    addError: null,
    historyResult: {
      experienceId: EXPERIENCE_ID,
      repeatCount: 0,
      logs: [],
    },
    deleteResult: { deleted: true, completionRemoved: false },
    async addLog(input) {
      addCalls.push(input);
      if (this.addError) throw this.addError;
      return { ...this.addResult, rating: input.rating ?? null, note: input.note ?? null };
    },
    async getVisitHistory() {
      return this.historyResult;
    },
    async deleteLog(userId, experienceId, logId) {
      deleteCalls.push({ userId, experienceId, logId });
      return this.deleteResult;
    },
  };
}

// ---------------------------------------------------------------------------
// requireSession stub
// ---------------------------------------------------------------------------

const requireSession: ExperienceLogRoutesOptions['requireSession'] = async (
  request,
) => {
  const id = request.headers['x-test-user-id'];
  if (typeof id === 'string' && id.length > 0) {
    request.userId = id;
    return;
  }
  throw new AppError('unauthorized', 'Authentication required.');
};

async function buildApp(
  repo: FakeLogRepo,
  clock?: () => Date,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  // Only pass `clock` when supplied; the option is `exactOptionalPropertyTypes`
  // so `clock: undefined` would be a type error.
  await app.register(
    experienceLogRoutes(
      clock ? { repo, requireSession, clock } : { repo, requireSession },
    ),
  );
  await app.ready();
  return app;
}

/** A pinned instant so the future-date guard is deterministic. In
 * America/New_York this is 2026-06-15 08:00 EDT, i.e. today == '2026-06-15'. */
const FIXED_NOW = new Date('2026-06-15T12:00:00Z');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('experienceLogRoutes', () => {
  let repo: FakeLogRepo;
  let app: FastifyInstance;

  beforeEach(async () => {
    repo = makeRepo();
    app = await buildApp(repo);
  });

  afterEach(async () => {
    await app.close();
  });

  // --- POST -----------------------------------------------------------------

  it('POST 201 forwards the parsed body (rating/note/tripId) to the repo', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/me/experiences/${EXPERIENCE_ID}/logs`,
      headers: { 'x-test-user-id': USER_ID },
      payload: {
        visitedOn: '2026-01-02',
        userTz: 'America/New_York',
        rating: 8,
        note: 'Great ride',
        tripId: TRIP_ID,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as ExperienceLogDTO;
    expect(body.rating).toBe(8);
    expect(body.note).toBe('Great ride');
    expect(repo.addCalls).toHaveLength(1);
    expect(repo.addCalls[0]).toMatchObject({
      userId: USER_ID,
      experienceId: EXPERIENCE_ID,
      visitedOn: '2026-01-02',
      userTz: 'America/New_York',
      rating: 8,
      note: 'Great ride',
      tripId: TRIP_ID,
    });
  });

  it('POST 201 accepts a minimal body and passes null for optional fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/me/experiences/${EXPERIENCE_ID}/logs`,
      headers: { 'x-test-user-id': USER_ID },
      payload: { visitedOn: '2026-01-02', userTz: 'America/New_York' },
    });
    expect(res.statusCode).toBe(201);
    expect(repo.addCalls[0]).toMatchObject({ rating: null, note: null, tripId: null });
  });

  // R1.5 — a visit date strictly after today in the user's TZ is rejected and
  // no repo write happens. Uses a pinned clock so "future" is deterministic.
  it('POST 400 log_future_date on a visitedOn after today in user TZ, without writing (R1.5)', async () => {
    const futureRepo = makeRepo();
    const futureApp = await buildApp(futureRepo, () => FIXED_NOW);
    try {
      const res = await futureApp.inject({
        method: 'POST',
        url: `/me/experiences/${EXPERIENCE_ID}/logs`,
        headers: { 'x-test-user-id': USER_ID },
        // 2026-06-16 is one day after today (2026-06-15) in America/New_York.
        payload: { visitedOn: '2026-06-16', userTz: 'America/New_York' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({
        error: { code: 'log_future_date', field: 'visitedOn' },
      });
      // The guard runs before any DB I/O: nothing was written.
      expect(futureRepo.addCalls).toHaveLength(0);
    } finally {
      await futureApp.close();
    }
  });

  it('POST 201 accepts today itself in the user TZ (boundary, not future) (R1.5)', async () => {
    const todayRepo = makeRepo();
    const todayApp = await buildApp(todayRepo, () => FIXED_NOW);
    try {
      const res = await todayApp.inject({
        method: 'POST',
        url: `/me/experiences/${EXPERIENCE_ID}/logs`,
        headers: { 'x-test-user-id': USER_ID },
        payload: { visitedOn: '2026-06-15', userTz: 'America/New_York' },
      });
      expect(res.statusCode).toBe(201);
      expect(todayRepo.addCalls).toHaveLength(1);
      expect(todayRepo.addCalls[0]).toMatchObject({ visitedOn: '2026-06-15' });
    } finally {
      await todayApp.close();
    }
  });

  it('POST 400 log_future_date respects the user TZ when it is a day ahead of the pinned instant (R1.5)', async () => {
    // At 2026-06-15T12:00Z it is already 2026-06-15 21:00 in Tokyo, so Tokyo's
    // "today" is still 2026-06-15 and 2026-06-16 remains future there too.
    const tzRepo = makeRepo();
    const tzApp = await buildApp(tzRepo, () => FIXED_NOW);
    try {
      const res = await tzApp.inject({
        method: 'POST',
        url: `/me/experiences/${EXPERIENCE_ID}/logs`,
        headers: { 'x-test-user-id': USER_ID },
        payload: { visitedOn: '2026-06-16', userTz: 'Asia/Tokyo' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('log_future_date');
      expect(tzRepo.addCalls).toHaveLength(0);
    } finally {
      await tzApp.close();
    }
  });

  it('POST 401 when unauthenticated', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/me/experiences/${EXPERIENCE_ID}/logs`,
      payload: { visitedOn: '2026-01-02', userTz: 'America/New_York' },
    });
    expect(res.statusCode).toBe(401);
    expect(repo.addCalls).toHaveLength(0);
  });

  it('POST 400 validation_failed on a malformed visitedOn', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/me/experiences/${EXPERIENCE_ID}/logs`,
      headers: { 'x-test-user-id': USER_ID },
      payload: { visitedOn: '01/02/2026', userTz: 'America/New_York' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_failed');
    expect(repo.addCalls).toHaveLength(0);
  });

  it('POST 400 validation_failed on a malformed experience id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/me/experiences/not-a-uuid/logs`,
      headers: { 'x-test-user-id': USER_ID },
      payload: { visitedOn: '2026-01-02', userTz: 'America/New_York' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_failed');
  });

  it('POST 400 rating_out_of_range when rating exceeds 10', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/me/experiences/${EXPERIENCE_ID}/logs`,
      headers: { 'x-test-user-id': USER_ID },
      payload: { visitedOn: '2026-01-02', userTz: 'America/New_York', rating: 11 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('rating_out_of_range');
    expect(repo.addCalls).toHaveLength(0);
  });

  it('POST 400 note_length_invalid when note exceeds 2000 chars', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/me/experiences/${EXPERIENCE_ID}/logs`,
      headers: { 'x-test-user-id': USER_ID },
      payload: {
        visitedOn: '2026-01-02',
        userTz: 'America/New_York',
        note: 'x'.repeat(2001),
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('note_length_invalid');
  });

  it('POST 403 trip_forbidden propagates from the repo', async () => {
    repo.addError = new AppError('trip_forbidden', 'not a member', {
      field: 'tripId',
    });
    const res = await app.inject({
      method: 'POST',
      url: `/me/experiences/${EXPERIENCE_ID}/logs`,
      headers: { 'x-test-user-id': USER_ID },
      payload: { visitedOn: '2026-01-02', userTz: 'America/New_York', tripId: TRIP_ID },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('trip_forbidden');
  });

  // --- GET ------------------------------------------------------------------

  it('GET 200 returns the visit history payload', async () => {
    repo.historyResult = {
      experienceId: EXPERIENCE_ID,
      repeatCount: 2,
      logs: [
        {
          id: LOG_ID,
          userId: USER_ID,
          experienceId: EXPERIENCE_ID,
          visitedOn: '2026-01-03',
          userTz: 'America/New_York',
          loggedAt: '2026-01-03T15:00:00.000Z',
          rating: 9,
          note: 'Second ride',
        },
        {
          id: '55555555-5555-4555-8555-555555555555',
          userId: USER_ID,
          experienceId: EXPERIENCE_ID,
          visitedOn: '2026-01-02',
          userTz: 'America/New_York',
          loggedAt: '2026-01-02T15:00:00.000Z',
          rating: null,
          note: null,
        },
      ],
    };
    const res = await app.inject({
      method: 'GET',
      url: `/me/experiences/${EXPERIENCE_ID}/logs`,
      headers: { 'x-test-user-id': USER_ID },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ExperienceVisitHistoryDTO;
    expect(body.repeatCount).toBe(2);
    expect(body.logs).toHaveLength(2);
    expect(body.logs[0]?.visitedOn).toBe('2026-01-03');
  });

  it('GET 200 returns an empty history with repeatCount 0', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/me/experiences/${EXPERIENCE_ID}/logs`,
      headers: { 'x-test-user-id': USER_ID },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().repeatCount).toBe(0);
  });

  it('GET 401 when unauthenticated', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/me/experiences/${EXPERIENCE_ID}/logs`,
    });
    expect(res.statusCode).toBe(401);
  });

  // --- DELETE ---------------------------------------------------------------

  it('DELETE 204 on success and forwards ids to the repo', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/me/experiences/${EXPERIENCE_ID}/logs/${LOG_ID}`,
      headers: { 'x-test-user-id': USER_ID },
    });
    expect(res.statusCode).toBe(204);
    expect(repo.deleteCalls[0]).toEqual({
      userId: USER_ID,
      experienceId: EXPERIENCE_ID,
      logId: LOG_ID,
    });
  });

  it('DELETE 404 log_not_found when the repo reports not deleted', async () => {
    repo.deleteResult = { deleted: false, completionRemoved: false };
    const res = await app.inject({
      method: 'DELETE',
      url: `/me/experiences/${EXPERIENCE_ID}/logs/${LOG_ID}`,
      headers: { 'x-test-user-id': USER_ID },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('log_not_found');
  });

  it('DELETE 400 validation_failed on a malformed logId', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/me/experiences/${EXPERIENCE_ID}/logs/not-a-uuid`,
      headers: { 'x-test-user-id': USER_ID },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_failed');
  });

  it('DELETE 401 when unauthenticated', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/me/experiences/${EXPERIENCE_ID}/logs/${LOG_ID}`,
    });
    expect(res.statusCode).toBe(401);
  });
});
