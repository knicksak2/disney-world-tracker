import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../../errors/AppError.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import { DEFAULT_MICKEYS_CONFIG, type MickeysConfig } from '../../../config.js';
import { HuntService } from '../service.js';
import { mickeyRoutes } from '../routes.js';
import type { MickeyRepo, MickeyListFilters } from '../repo.js';
import type {
  MickeyClientConfigDTO,
  MickeyListItemDTO,
  MickeyDetailDTO,
  MickeyProgressDTO,
  MickeySummaryDTO,
} from '@dwt/shared';
import type { DbPool } from '../../../db/pool.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const FRIEND_ID = '22222222-2222-4222-8222-222222222222';
const STRANGER_ID = '33333333-3333-4333-8333-333333333333';
const MICKEY_ID = '44444444-4444-4444-8444-444444444444';
const TRIP_ID = '55555555-5555-4555-8555-555555555555';
const INVALID_UUID = 'not-a-valid-uuid';

interface FakeMickeyRepo extends MickeyRepo {
  findApprovedMickeysResult: { items: MickeyListItemDTO[]; nextCursor: string | null };
  summaryResult: MickeySummaryDTO;
  detailResult: MickeyDetailDTO | null;
  mickeyByIdResult: { id: string; status: string; official: boolean } | null;
  findResult: MickeyProgressDTO;
  recordHintCalls: Array<{ userId: string; mickeyId: string; level: number }>;
  recordFindCalls: Array<{ userId: string; mickeyId: string; tripId?: string | null }>;
  undoFindCalls: Array<{ userId: string; mickeyId: string }>;
  recordVoteCalls: Array<{ userId: string; mickeyId: string; vote: 'there' | 'gone' }>;
}

function makeFakeRepo(): FakeMickeyRepo {
  return {
    findApprovedMickeysResult: { items: [], nextCursor: null },
    summaryResult: {
      overall: { total: 10, found: 2 },
      byPark: [{ park: 'Magic Kingdom', total: 10, found: 2 }],
      community: { found: 1 },
    },
    detailResult: {
      id: MICKEY_ID,
      experienceId: '66666666-6666-4666-8666-666666666666',
      experienceName: 'Space Mountain',
      park: 'Magic Kingdom',
      land: 'Tomorrowland',
      zone: 'queue',
      difficulty: 'medium',
      clue1: 'Look near the star map above the second airlock',
      official: true,
      communityVerified: false,
      confidenceLabel: 'confirmed',
      hintLevel: 1,
      found: false,
      tripId: null,
      friendsFoundCount: 0,
    },
    mickeyByIdResult: { id: MICKEY_ID, status: 'approved', official: true },
    findResult: {
      mickeyId: MICKEY_ID,
      hintLevel: 1,
      foundAt: '2026-11-06T12:00:00.000Z',
      foundOn: '2026-11-06',
      tripId: TRIP_ID,
    },
    recordHintCalls: [],
    recordFindCalls: [],
    undoFindCalls: [],
    recordVoteCalls: [],

    async findApprovedMickeys(_filters: MickeyListFilters) {
      return this.findApprovedMickeysResult;
    },
    async getMickeyDetail(id: string, _userId?: string) {
      if (this.detailResult && this.detailResult.id === id) {
        return this.detailResult;
      }
      return null;
    },
    async recordHint(userId: string, mickeyId: string, level: 2 | 3) {
      this.recordHintCalls.push({ userId, mickeyId, level });
      if (this.detailResult) {
        this.detailResult = {
          ...this.detailResult,
          hintLevel: level,
          ...(level >= 2 ? { clue2: 'Check the constellations near sector 4' } : {}),
          ...(level >= 3 ? { reveal: 'Three small stars align as Mickey ears' } : {}),
        };
      }
      return level;
    },
    async recordFind(userId: string, mickeyId: string, tripId?: string | null) {
      this.recordFindCalls.push({ userId, mickeyId, ...(tripId !== undefined ? { tripId } : {}) });
      return this.findResult;
    },
    async undoFind(userId: string, mickeyId: string) {
      this.undoFindCalls.push({ userId, mickeyId });
    },
    async recordVote(userId: string, mickeyId: string, vote: 'there' | 'gone') {
      this.recordVoteCalls.push({ userId, mickeyId, vote });
    },
    async getSummary(_userId?: string) {
      return this.summaryResult;
    },
    async getFriendsFoundCount() {
      return 0;
    },
    async getReportCount() {
      return 0;
    },
    async findUserFinds(_userId: string, _cursor?: string, _limit?: number) {
      return {
        items: [
          {
            mickeyId: MICKEY_ID,
            clue1: 'Look near the star map above the second airlock',
            official: true,
            experienceId: '66666666-6666-4666-8666-666666666666',
            experienceName: 'Space Mountain',
            park: 'Magic Kingdom' as const,
            land: 'Tomorrowland',
            foundAt: '2026-11-06T12:00:00.000Z',
            foundOn: '2026-11-06',
          },
        ],
        nextCursor: null,
      };
    },
    async getTripMickeys(_tripId: string) {
      return {
        members: [
          {
            userId: USER_ID,
            displayName: 'Alice',
            avatarPreset: null,
            count: 1,
          },
        ],
        mickeys: [
          {
            mickeyId: MICKEY_ID,
            clue1: 'Look near the star map above the second airlock',
            official: true,
            experienceName: 'Space Mountain',
            foundByCount: 1,
          },
        ],
      };
    },
    async getMickeyById(id: string) {
      if (this.mickeyByIdResult && this.mickeyByIdResult.id === id) {
        return this.mickeyByIdResult as any;
      }
      return null;
    },
  };
}

function makeFakePool(): DbPool {
  return {
    query: async (sql: string, params: unknown[] = []) => {
      // Mock assertTripMember check: trip_memberships query
      if (sql.includes('FROM trip_memberships')) {
        const [tripId, userId] = params;
        if (tripId === TRIP_ID && userId === USER_ID) {
          return { rows: [{ role: 'member' }], rowCount: 1 } as any;
        }
        return { rows: [], rowCount: 0 } as any;
      }
      // Mock assertOwnerOrFriend check: active_friendships query
      if (sql.includes('active_friendships') || sql.includes('friendships')) {
        const [a, b] = params;
        const [lo, hi] = (a as string) < (b as string) ? [a, b] : [b, a];
        const [expectedLo, expectedHi] =
          USER_ID < FRIEND_ID ? [USER_ID, FRIEND_ID] : [FRIEND_ID, USER_ID];
        if (lo === expectedLo && hi === expectedHi) {
          return { rows: [{ exists: true }], rowCount: 1 } as any;
        }
        return { rows: [{ exists: false }], rowCount: 1 } as any;
      }
      return { rows: [], rowCount: 0 } as any;
    },
    connect: async () => {
      throw new Error('Not implemented');
    },
  } as unknown as DbPool;
}

function buildTestApp(options: {
  repo?: FakeMickeyRepo;
  config?: Partial<MickeysConfig>;
  authenticated?: boolean;
} = {}): { app: FastifyInstance; repo: FakeMickeyRepo } {
  const app = Fastify();
  registerErrorHandler(app);

  const repo = options.repo ?? makeFakeRepo();
  const pool = makeFakePool();
  const config: MickeysConfig = {
    ...DEFAULT_MICKEYS_CONFIG,
    ...(options.config ?? {}),
  };
  const huntService = new HuntService(pool, repo, config);

  const requireSession = async (request: any) => {
    if (options.authenticated !== false) {
      request.userId = USER_ID;
    } else {
      throw new AppError('unauthorized', 'Authentication required.');
    }
  };

  void app.register(
    mickeyRoutes({
      huntService,
      requireSession,
      config,
    }),
  );

  return { app, repo };
}

describe('Mickey HTTP User routes (Task 3.3, 3.5)', () => {
  let app: FastifyInstance;
  let repo: FakeMickeyRepo;

  beforeEach(async () => {
    const built = buildTestApp({ authenticated: true });
    app = built.app;
    repo = built.repo;
    await app.ready();
  });

  describe('Authentication Gate (401 on every user route)', () => {
    it.each([
      ['GET', '/mickeys'],
      ['GET', '/mickeys/summary'],
      ['GET', `/mickeys/${MICKEY_ID}`],
      ['POST', `/me/mickeys/${MICKEY_ID}/hint`],
      ['POST', `/me/mickeys/${MICKEY_ID}/find`],
      ['DELETE', `/me/mickeys/${MICKEY_ID}/find`],
      ['PUT', `/me/mickeys/${MICKEY_ID}/vote`],
    ])('rejects anonymous %s %s with 401', async (method, url) => {
      const { app: unauthApp } = buildTestApp({ authenticated: false });
      await unauthApp.ready();

      const response = await unauthApp.inject({
        method: method as any,
        url,
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.error?.code).toBe('unauthorized');
    });

    it('GET /mickeys/config is accessible anonymously (Requirement 14.3)', async () => {
      const { app: unauthApp } = buildTestApp({ authenticated: false });
      await unauthApp.ready();

      const response = await unauthApp.inject({
        method: 'GET',
        url: '/mickeys/config',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as MickeyClientConfigDTO;
      expect(body.enabled).toBe(true);
      expect(body.submissionsEnabled).toBe(true);
    });
  });

  describe('Kill Switch (MICKEYS_ENABLED=false)', () => {
    it('GET /mickeys/config still returns 200 with enabled: false', async () => {
      const { app: disabledApp } = buildTestApp({
        config: { enabled: false },
        authenticated: true,
      });
      await disabledApp.ready();

      const response = await disabledApp.inject({
        method: 'GET',
        url: '/mickeys/config',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        enabled: false,
        submissionsEnabled: true,
      });
    });

    it.each([
      ['GET', '/mickeys'],
      ['GET', '/mickeys/summary'],
      ['GET', `/mickeys/${MICKEY_ID}`],
      ['POST', `/me/mickeys/${MICKEY_ID}/hint`],
      ['POST', `/me/mickeys/${MICKEY_ID}/find`],
      ['DELETE', `/me/mickeys/${MICKEY_ID}/find`],
      ['PUT', `/me/mickeys/${MICKEY_ID}/vote`],
    ])('rejects %s %s with 503 mickey_feature_disabled when MICKEYS_ENABLED=false', async (method, url) => {
      const { app: disabledApp } = buildTestApp({
        config: { enabled: false },
        authenticated: true,
      });
      await disabledApp.ready();

      const injectOpts: Record<string, unknown> = {
        method,
        url,
      };
      if (method === 'POST' || method === 'PUT') {
        injectOpts.payload = {};
      }
      const response = await disabledApp.inject(injectOpts as any);

      expect(response.statusCode).toBe(503);
      const body = response.json();
      expect(body.error?.code).toBe('mickey_feature_disabled');
    });
  });

  describe('Static routes not captured by parametric /mickeys/:id', () => {
    it('routes /mickeys/summary to summary handler, not :id', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/mickeys/summary',
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.overall).toBeDefined();
      expect(body.byPark).toBeDefined();
    });

    it('routes /mickeys/config to config handler, not :id', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/mickeys/config',
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.enabled).toBe(true);
    });
  });

  describe('Happy paths', () => {
    it('GET /mickeys returns 200 with list and nextCursor', async () => {
      repo.findApprovedMickeysResult = {
        items: [
          {
            id: MICKEY_ID,
            experienceId: '66666666-6666-4666-8666-666666666666',
            experienceName: 'Space Mountain',
            park: 'Magic Kingdom',
            land: 'Tomorrowland',
            zone: 'queue',
            difficulty: 'medium',
            clue1: 'Look near the star map',
            official: true,
            communityVerified: false,
            confidenceLabel: 'confirmed',
            hintLevel: 1,
            found: false,
          },
        ],
        nextCursor: null,
      };

      const response = await app.inject({
        method: 'GET',
        url: '/mickeys?zone=queue&limit=10',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].id).toBe(MICKEY_ID);
      expect(body.nextCursor).toBeNull();
    });

    it('GET /mickeys/summary?for=<friendId> checks assertOwnerOrFriend and succeeds', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/mickeys/summary?for=${FRIEND_ID}`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().overall).toEqual({ total: 10, found: 2 });
    });

    it('POST /me/mickeys/:id/hint updates hint level and returns detail', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/me/mickeys/${MICKEY_ID}/hint`,
        payload: { level: 2 },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.hintLevel).toBe(2);
      expect(body.clue1).toBeDefined();
      expect(body.clue2).toBeDefined();
      expect(body.reveal).toBeUndefined();
    });

    it('POST /me/mickeys/:id/find with valid tripId succeeds', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/me/mickeys/${MICKEY_ID}/find`,
        payload: { tripId: TRIP_ID },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.mickeyId).toBe(MICKEY_ID);
      expect(body.foundAt).toBeDefined();
      expect(body.tripId).toBe(TRIP_ID);
    });

    it('DELETE /me/mickeys/:id/find returns 204', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/me/mickeys/${MICKEY_ID}/find`,
      });

      expect(response.statusCode).toBe(204);
      expect(repo.undoFindCalls).toEqual([{ userId: USER_ID, mickeyId: MICKEY_ID }]);
    });

    it('PUT /me/mickeys/:id/vote returns 204', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/me/mickeys/${MICKEY_ID}/vote`,
        payload: { vote: 'there' },
      });

      expect(response.statusCode).toBe(204);
      expect(repo.recordVoteCalls).toEqual([
        { userId: USER_ID, mickeyId: MICKEY_ID, vote: 'there' },
      ]);
    });
  });

  describe('Validation failures (400 validation_failed)', () => {
    it('rejects POST hint with level: 1', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/me/mickeys/${MICKEY_ID}/hint`,
        payload: { level: 1 },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error?.code).toBe('validation_failed');
    });

    it('rejects GET /mickeys with invalid zone', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/mickeys?zone=invalid_zone',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error?.code).toBe('validation_failed');
    });

    it('rejects GET /mickeys with unexpected query parameters', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/mickeys?unrecognizedField=foo',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error?.code).toBe('validation_failed');
    });

    it('rejects request with invalid UUID param', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/mickeys/${INVALID_UUID}`,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error?.code).toBe('validation_failed');
    });

    it('rejects PUT /me/mickeys/:id/vote with unknown fields', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/me/mickeys/${MICKEY_ID}/vote`,
        payload: { vote: 'there', extra: 'bad' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error?.code).toBe('validation_failed');
    });
  });

  describe('Error paths and security gates', () => {
    it('returns 404 mickey_not_found for non-existent or unapproved mickey', async () => {
      repo.mickeyByIdResult = null;
      repo.detailResult = null;

      const response = await app.inject({
        method: 'GET',
        url: `/mickeys/${MICKEY_ID}`,
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error?.code).toBe('mickey_not_found');
    });

    it('returns 403 trip_forbidden when caller is not a member of tripId (Property 18)', async () => {
      const nonMemberTripId = '99999999-9999-4999-8999-999999999999';

      const response = await app.inject({
        method: 'POST',
        url: `/me/mickeys/${MICKEY_ID}/find`,
        payload: { tripId: nonMemberTripId },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error?.code).toBe('trip_forbidden');
    });

    it('returns 403 profile_forbidden when requesting summary for stranger', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/mickeys/summary?for=${STRANGER_ID}`,
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error?.code).toBe('profile_forbidden');
    });
  });

  describe('Spoiler gating through real handlers (Requirement 3)', () => {
    it('returns clue1 only at hint level 1 when unfound', async () => {
      repo.detailResult = {
        id: MICKEY_ID,
        experienceId: '66666666-6666-4666-8666-666666666666',
        experienceName: 'Space Mountain',
        park: 'Magic Kingdom',
        land: 'Tomorrowland',
        zone: 'queue',
        difficulty: 'medium',
        clue1: 'Look near the star map',
        official: true,
        communityVerified: false,
        confidenceLabel: 'confirmed',
        hintLevel: 1,
        found: false,
        tripId: null,
        friendsFoundCount: 0,
      };

      const response = await app.inject({
        method: 'GET',
        url: `/mickeys/${MICKEY_ID}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.clue1).toBe('Look near the star map');
      expect(body.clue2).toBeUndefined();
      expect(body.reveal).toBeUndefined();
    });

    it('returns clue1 and clue2 at hint level 2 when unfound', async () => {
      repo.detailResult = {
        id: MICKEY_ID,
        experienceId: '66666666-6666-4666-8666-666666666666',
        experienceName: 'Space Mountain',
        park: 'Magic Kingdom',
        land: 'Tomorrowland',
        zone: 'queue',
        difficulty: 'medium',
        clue1: 'Look near the star map',
        clue2: 'Check constellations near sector 4',
        official: true,
        communityVerified: false,
        confidenceLabel: 'confirmed',
        hintLevel: 2,
        found: false,
        tripId: null,
        friendsFoundCount: 0,
      };

      const response = await app.inject({
        method: 'GET',
        url: `/mickeys/${MICKEY_ID}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.clue1).toBeDefined();
      expect(body.clue2).toBeDefined();
      expect(body.reveal).toBeUndefined();
    });

    it('returns all layers at hint level 3 or after find', async () => {
      repo.detailResult = {
        id: MICKEY_ID,
        experienceId: '66666666-6666-4666-8666-666666666666',
        experienceName: 'Space Mountain',
        park: 'Magic Kingdom',
        land: 'Tomorrowland',
        zone: 'queue',
        difficulty: 'medium',
        clue1: 'Look near the star map',
        clue2: 'Check constellations near sector 4',
        reveal: 'Three small stars align as Mickey ears',
        official: true,
        communityVerified: false,
        confidenceLabel: 'confirmed',
        hintLevel: 1,
        found: true,
        tripId: null,
        friendsFoundCount: 0,
      };

      const response = await app.inject({
        method: 'GET',
        url: `/mickeys/${MICKEY_ID}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.clue1).toBeDefined();
      expect(body.clue2).toBeDefined();
      expect(body.reveal).toBeDefined();
    });
  });

  describe('GET /users/:userId/mickeys/finds', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app: unauthApp } = buildTestApp({ authenticated: false });
      const response = await unauthApp.inject({
        method: 'GET',
        url: `/users/${USER_ID}/mickeys/finds`,
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns 200 and finds page for self', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/users/${USER_ID}/mickeys/finds`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].clue1).toBeDefined();
      expect(body.items[0].clue2).toBeUndefined();
      expect(body.items[0].reveal).toBeUndefined();
    });

    it('returns 200 and finds page for friend', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/users/${FRIEND_ID}/mickeys/finds`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items).toBeDefined();
    });

    it('returns 403 profile_forbidden for stranger', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/users/${STRANGER_ID}/mickeys/finds`,
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error?.code).toBe('profile_forbidden');
    });

    it('returns 400 validation_failed for invalid userId', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/users/${INVALID_UUID}/mickeys/finds`,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error?.code).toBe('validation_failed');
    });
  });
});
