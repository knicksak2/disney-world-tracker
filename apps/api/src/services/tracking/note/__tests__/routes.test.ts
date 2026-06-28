/**
 * Integration tests for the Tracking_Service note routes plugin (task 10.3).
 *
 * The plugin is registered against an in-process Fastify instance with a
 * fake `NoteRepo` and a stubbed `requireSession` pre-handler. We never
 * connect to a real database or session middleware so each test is
 * hermetic and deterministic.
 *
 * Coverage focuses on the requirements scoped to this task:
 *   - R5.3 PUT creates a Note when none exists for `(user, experience)`.
 *   - R5.4 PUT replaces an existing Note's body in place.
 *   - R5.6 DELETE removes the Note.
 *   - R5.7 DELETE returns 404 `note_not_found` when no Note exists.
 *   - R5.10 Whitespace-only and over-length bodies surface as
 *           `note_length_invalid` and the prior Note (if any) is
 *           preserved (the repo is never invoked on validation failure).
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

import type { NoteDTO } from '@dwt/shared';

import { registerErrorHandler } from '../../../../errors/handler.js';
import { AppError } from '../../../../errors/AppError.js';
import { noteRoutes, type NoteRoutesOptions } from '../routes.js';
import type { NoteRepo } from '../repo.js';

// ---------------------------------------------------------------------------
// Fake repo
// ---------------------------------------------------------------------------
//
// Records every method invocation so each test can assert what was
// (and was not) attempted against persistence. The repo is reset per test.

interface UpsertCall {
  readonly userId: string;
  readonly experienceId: string;
  readonly body: string;
}

interface DeleteCall {
  readonly userId: string;
  readonly experienceId: string;
}

interface FakeNoteRepo extends NoteRepo {
  readonly upserts: UpsertCall[];
  readonly deletes: DeleteCall[];
  upsertResult: NoteDTO;
  deleteResult: boolean;
  getResult: NoteDTO | null;
}

function makeRepo(initial: {
  upsertResult?: NoteDTO;
  deleteResult?: boolean;
  getResult?: NoteDTO | null;
} = {}): FakeNoteRepo {
  const upserts: UpsertCall[] = [];
  const deletes: DeleteCall[] = [];
  return {
    upserts,
    deletes,
    upsertResult: initial.upsertResult ?? {
      userId: 'user-1',
      experienceId: 'exp-1',
      body: 'unset',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
    deleteResult: initial.deleteResult ?? true,
    getResult: initial.getResult ?? null,
    async upsertNote(userId, experienceId, body) {
      upserts.push({ userId, experienceId, body });
      return {
        ...this.upsertResult,
        userId,
        experienceId,
        body,
      };
    },
    async deleteNote(userId, experienceId) {
      deletes.push({ userId, experienceId });
      return this.deleteResult;
    },
    async getNote() {
      return this.getResult;
    },
  };
}

// ---------------------------------------------------------------------------
// requireSession stub
// ---------------------------------------------------------------------------
//
// Reads `x-test-user-id` from the request header and assigns it to
// `request.userId`. A missing header simulates an unauthenticated
// request, which the global error hook translates to a 401.

const requireSession: NoteRoutesOptions['requireSession'] = async (request) => {
  const id = request.headers['x-test-user-id'];
  if (typeof id === 'string' && id.length > 0) {
    request.userId = id;
    return;
  }
  throw new AppError('unauthorized', 'Authentication required.');
};

// ---------------------------------------------------------------------------
// Test app builder
// ---------------------------------------------------------------------------

async function buildApp(opts: {
  repo: FakeNoteRepo;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(
    noteRoutes({
      repo: opts.repo,
      requireSession,
    }),
  );
  await app.ready();
  return app;
}

// Valid UUIDs for path parameters. The route schema rejects malformed
// values with `validation_failed` so we use a real v4-shaped string.
const USER_ID = '11111111-1111-4111-8111-111111111111';
const EXPERIENCE_ID = '22222222-2222-4222-8222-222222222222';

// ---------------------------------------------------------------------------
// GET /me/experiences/:id/note
// ---------------------------------------------------------------------------

describe('GET /me/experiences/:id/note', () => {
  it('returns 200 with the Note DTO when one exists (R5.8)', async () => {
    const repo = makeRepo({
      getResult: {
        userId: USER_ID,
        experienceId: EXPERIENCE_ID,
        body: 'great ride',
        updatedAt: '2024-06-01T12:00:00.000Z',
      },
    });
    const app = await buildApp({ repo });

    const response = await app.inject({
      method: 'GET',
      url: `/me/experiences/${EXPERIENCE_ID}/note`,
      headers: { 'x-test-user-id': USER_ID },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      userId: USER_ID,
      experienceId: EXPERIENCE_ID,
      body: 'great ride',
      updatedAt: '2024-06-01T12:00:00.000Z',
    });
  });

  it('returns 404 note_not_found when no Note exists (R5.9)', async () => {
    const repo = makeRepo({ getResult: null });
    const app = await buildApp({ repo });

    const response = await app.inject({
      method: 'GET',
      url: `/me/experiences/${EXPERIENCE_ID}/note`,
      headers: { 'x-test-user-id': USER_ID },
    });

    expect(response.statusCode).toBe(404);
    const body = response.json() as { error: { code: string } };
    expect(body.error.code).toBe('note_not_found');
  });

  it('rejects an unauthenticated GET with 401 unauthorized', async () => {
    const repo = makeRepo();
    const app = await buildApp({ repo });

    const response = await app.inject({
      method: 'GET',
      url: `/me/experiences/${EXPERIENCE_ID}/note`,
    });

    expect(response.statusCode).toBe(401);
    const body = response.json() as { error: { code: string } };
    expect(body.error.code).toBe('unauthorized');
  });

  it('rejects a malformed experience id with validation_failed', async () => {
    const repo = makeRepo();
    const app = await buildApp({ repo });

    const response = await app.inject({
      method: 'GET',
      url: '/me/experiences/not-a-uuid/note',
      headers: { 'x-test-user-id': USER_ID },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string; field?: string } };
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.field).toBe('id');
  });
});

// ---------------------------------------------------------------------------
// PUT /me/experiences/:id/note — create
// ---------------------------------------------------------------------------

describe('PUT /me/experiences/:id/note', () => {
  it('creates a new Note when none exists for the (user, experience) pair (R5.3)', async () => {
    const repo = makeRepo({
      upsertResult: {
        userId: USER_ID,
        experienceId: EXPERIENCE_ID,
        body: 'will be overridden',
        updatedAt: '2024-06-01T12:00:00.000Z',
      },
    });
    const app = await buildApp({ repo });

    const response = await app.inject({
      method: 'PUT',
      url: `/me/experiences/${EXPERIENCE_ID}/note`,
      headers: { 'x-test-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { body: 'Worth the wait, especially in the evening.' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as NoteDTO;
    expect(body).toEqual({
      userId: USER_ID,
      experienceId: EXPERIENCE_ID,
      body: 'Worth the wait, especially in the evening.',
      updatedAt: '2024-06-01T12:00:00.000Z',
    });
    expect(repo.upserts).toEqual([
      {
        userId: USER_ID,
        experienceId: EXPERIENCE_ID,
        body: 'Worth the wait, especially in the evening.',
      },
    ]);
    expect(repo.deletes).toEqual([]);
  });

  it('trims leading/trailing whitespace before persisting (R5.2)', async () => {
    const repo = makeRepo();
    const app = await buildApp({ repo });

    const response = await app.inject({
      method: 'PUT',
      url: `/me/experiences/${EXPERIENCE_ID}/note`,
      headers: { 'x-test-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { body: '   trimmed body   ' },
    });

    expect(response.statusCode).toBe(200);
    expect(repo.upserts).toEqual([
      {
        userId: USER_ID,
        experienceId: EXPERIENCE_ID,
        body: 'trimmed body',
      },
    ]);
  });

  it('replaces an existing Note in place via the same UPSERT call (R5.4)', async () => {
    // The route handler does not branch on "exists vs not"; both paths go
    // through `upsertNote`, mirroring the repo's INSERT...ON CONFLICT DO
    // UPDATE. We exercise the second-write path by issuing two PUTs and
    // asserting the repo received them both with the latest body.
    const repo = makeRepo();
    const app = await buildApp({ repo });

    const first = await app.inject({
      method: 'PUT',
      url: `/me/experiences/${EXPERIENCE_ID}/note`,
      headers: { 'x-test-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { body: 'first version' },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'PUT',
      url: `/me/experiences/${EXPERIENCE_ID}/note`,
      headers: { 'x-test-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { body: 'second version' },
    });
    expect(second.statusCode).toBe(200);
    const body = second.json() as NoteDTO;
    expect(body.body).toBe('second version');

    expect(repo.upserts).toEqual([
      { userId: USER_ID, experienceId: EXPERIENCE_ID, body: 'first version' },
      { userId: USER_ID, experienceId: EXPERIENCE_ID, body: 'second version' },
    ]);
  });

  it('rejects whitespace-only bodies with note_length_invalid and never invokes the repo (R5.10)', async () => {
    const repo = makeRepo();
    const app = await buildApp({ repo });

    const response = await app.inject({
      method: 'PUT',
      url: `/me/experiences/${EXPERIENCE_ID}/note`,
      headers: { 'x-test-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { body: '   \t\n   ' },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as {
      error: { code: string; field?: string };
    };
    expect(body.error.code).toBe('note_length_invalid');
    expect(body.error.field).toBe('body');
    // Prior state is preserved because the repo was never reached.
    expect(repo.upserts).toEqual([]);
  });

  it('rejects bodies longer than 2000 characters with note_length_invalid (R5.10)', async () => {
    const repo = makeRepo();
    const app = await buildApp({ repo });

    const tooLong = 'x'.repeat(2001);
    const response = await app.inject({
      method: 'PUT',
      url: `/me/experiences/${EXPERIENCE_ID}/note`,
      headers: { 'x-test-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { body: tooLong },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string } };
    expect(body.error.code).toBe('note_length_invalid');
    expect(repo.upserts).toEqual([]);
  });

  it('rejects an unauthenticated request with 401 unauthorized', async () => {
    const repo = makeRepo();
    const app = await buildApp({ repo });

    const response = await app.inject({
      method: 'PUT',
      url: `/me/experiences/${EXPERIENCE_ID}/note`,
      headers: { 'content-type': 'application/json' },
      payload: { body: 'something valid' },
    });

    expect(response.statusCode).toBe(401);
    const body = response.json() as { error: { code: string } };
    expect(body.error.code).toBe('unauthorized');
    expect(repo.upserts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// DELETE /me/experiences/:id/note
// ---------------------------------------------------------------------------

describe('DELETE /me/experiences/:id/note', () => {
  it('removes the Note and returns 204 (R5.6)', async () => {
    const repo = makeRepo({ deleteResult: true });
    const app = await buildApp({ repo });

    const response = await app.inject({
      method: 'DELETE',
      url: `/me/experiences/${EXPERIENCE_ID}/note`,
      headers: { 'x-test-user-id': USER_ID },
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect(repo.deletes).toEqual([
      { userId: USER_ID, experienceId: EXPERIENCE_ID },
    ]);
  });

  it('returns 404 note_not_found when no Note exists (R5.7)', async () => {
    const repo = makeRepo({ deleteResult: false });
    const app = await buildApp({ repo });

    const response = await app.inject({
      method: 'DELETE',
      url: `/me/experiences/${EXPERIENCE_ID}/note`,
      headers: { 'x-test-user-id': USER_ID },
    });

    expect(response.statusCode).toBe(404);
    const body = response.json() as { error: { code: string } };
    expect(body.error.code).toBe('note_not_found');
    // The repo IS invoked (it's the source of truth for "exists?"), but
    // no other state was touched.
    expect(repo.deletes).toEqual([
      { userId: USER_ID, experienceId: EXPERIENCE_ID },
    ]);
  });

  it('rejects an unauthenticated DELETE with 401 unauthorized', async () => {
    const repo = makeRepo();
    const app = await buildApp({ repo });

    const response = await app.inject({
      method: 'DELETE',
      url: `/me/experiences/${EXPERIENCE_ID}/note`,
    });

    expect(response.statusCode).toBe(401);
    expect(repo.deletes).toEqual([]);
  });

  it('rejects a malformed experience id with validation_failed and never invokes the repo', async () => {
    const repo = makeRepo();
    const app = await buildApp({ repo });

    const response = await app.inject({
      method: 'DELETE',
      url: '/me/experiences/not-a-uuid/note',
      headers: { 'x-test-user-id': USER_ID },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string; field?: string } };
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.field).toBe('id');
    expect(repo.deletes).toEqual([]);
  });
});
