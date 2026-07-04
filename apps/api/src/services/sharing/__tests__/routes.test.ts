/**
 * Integration tests for the Sharing_Service routes plugin (task 12.1).
 *
 * The plugin is registered against an in-process Fastify instance with a
 * fake `SharingRepo` and a stubbed `requireSession` pre-handler. We
 * never connect to a real database or session middleware so each test
 * is hermetic and deterministic.
 *
 * Coverage:
 *   - R9.1, R9.4: POST /me/shares with rating composes payload with rating field
 *   - R9.5: POST /me/shares with no rating but includeRating=true → rating: null + ratingUnavailable
 *   - R9.6: POST /me/shares with note → payload includes note (≤ 2000 chars)
 *   - R9.7: POST /me/shares for progress includes percentages capped at 100.0
 *   - R9.2: POST /me/shares with empty/oversized recipientIds → 400 share_recipient_count_invalid
 *   - R9.3: POST /me/shares when repo throws share_atomic_rejected → 403
 *   - R9.8: GET /me/inbox returns repo bundle with privacy projection
 *   - R9.9: POST /me/inbox/:id/open returns full payload
 *   - R9.10: DELETE /me/inbox/:id returns 204; sender row preserved (asserted via repo call shape)
 *   - Authorization gate on every route
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

import type { ExperienceSharePayload, ProgressSharePayload, SharePayload } from '@dwt/shared';

import { AppError } from '../../../errors/AppError.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import type {
  InboxResponse,
  OpenedShareDetail,
  SentShareDTO,
  ShareDeliveryResult,
  SharingRepo,
} from '../repo.js';
import { sharingRoutes, type SharingRoutesOptions } from '../routes.js';

// ---------------------------------------------------------------------------
// Fake repo
// ---------------------------------------------------------------------------

interface FakeRepoEvent {
  readonly method: string;
  readonly args: ReadonlyArray<unknown>;
}

interface FakeRepo extends SharingRepo {
  readonly events: FakeRepoEvent[];
}

interface FakeRepoOverrides {
  readonly createShareAtomic?: (
    senderId: string,
    recipientIds: ReadonlyArray<string>,
    payload: SharePayload,
  ) => Promise<ShareDeliveryResult>;
  readonly listInbox?: (recipientId: string) => Promise<InboxResponse>;
  readonly openShare?: (
    recipientId: string,
    shareId: string,
  ) => Promise<OpenedShareDetail | null>;
  readonly softDeleteForRecipient?: (
    recipientId: string,
    shareId: string,
  ) => Promise<boolean>;
  readonly listSentShares?: (senderId: string) => Promise<SentShareDTO[]>;
}

function makeRepo(overrides: FakeRepoOverrides = {}): FakeRepo {
  const events: FakeRepoEvent[] = [];
  const record = (method: string, args: ReadonlyArray<unknown>): void => {
    events.push({ method, args });
  };
  return {
    events,
    async createShareAtomic(senderId, recipientIds, payload) {
      record('createShareAtomic', [senderId, recipientIds, payload]);
      if (overrides.createShareAtomic) {
        return overrides.createShareAtomic(senderId, recipientIds, payload);
      }
      return { shareId: SHARE_ID, deliveredTo: recipientIds.length };
    },
    async listInbox(recipientId) {
      record('listInbox', [recipientId]);
      if (overrides.listInbox) {
        return overrides.listInbox(recipientId);
      }
      return { unread: 0, items: [] };
    },
    async openShare(recipientId, shareId) {
      record('openShare', [recipientId, shareId]);
      if (overrides.openShare) {
        return overrides.openShare(recipientId, shareId);
      }
      return null;
    },
    async softDeleteForRecipient(recipientId, shareId) {
      record('softDeleteForRecipient', [recipientId, shareId]);
      if (overrides.softDeleteForRecipient) {
        return overrides.softDeleteForRecipient(recipientId, shareId);
      }
      return false;
    },
    async listSentShares(senderId) {
      record('listSentShares', [senderId]);
      if (overrides.listSentShares) {
        return overrides.listSentShares(senderId);
      }
      return [];
    },
  };
}

// ---------------------------------------------------------------------------
// requireSession stub
// ---------------------------------------------------------------------------

function makeRequireSession(opts: { userId?: string } = {}): SharingRoutesOptions['requireSession'] {
  return async (request) => {
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
// App builder
// ---------------------------------------------------------------------------

async function buildApp(options: {
  repo?: FakeRepo;
  defaultUserId?: string;
} = {}): Promise<{ app: FastifyInstance; repo: FakeRepo }> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  const repo = options.repo ?? makeRepo();
  const requireSession =
    options.defaultUserId !== undefined
      ? makeRequireSession({ userId: options.defaultUserId })
      : makeRequireSession();
  await app.register(sharingRoutes({ repo, requireSession }));
  await app.ready();
  return { app, repo };
}

// Stable test ids.
const SENDER = '11111111-1111-4111-8111-111111111111';
const REC_A = '22222222-2222-4222-8222-222222222222';
const REC_B = '33333333-3333-4333-8333-333333333333';
const SHARE_ID = '44444444-4444-4444-8444-444444444444';
const EXPERIENCE_ID = '55555555-5555-4555-8555-555555555555';

// ===========================================================================
// POST /me/shares — recipient-count validation (R9.2)
// ===========================================================================

describe('POST /me/shares recipient count (R9.2)', () => {
  it('rejects an empty list with share_recipient_count_invalid (400)', async () => {
    const { app, repo } = await buildApp({ defaultUserId: SENDER });

    const response = await app.inject({
      method: 'POST',
      url: '/me/shares',
      payload: {
        kind: 'experience',
        recipientIds: [],
        experienceId: EXPERIENCE_ID,
      },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string } };
    expect(body.error.code).toBe('share_recipient_count_invalid');
    expect(repo.events).toHaveLength(0);
  });

  it('rejects more than 50 recipients with share_recipient_count_invalid (400)', async () => {
    const { app, repo } = await buildApp({ defaultUserId: SENDER });
    const oversized = Array.from({ length: 51 }, (_, i) =>
      `aaaaaaaa-aaaa-4aaa-8aaa-${i.toString().padStart(12, '0')}`,
    );

    const response = await app.inject({
      method: 'POST',
      url: '/me/shares',
      payload: {
        kind: 'experience',
        recipientIds: oversized,
        experienceId: EXPERIENCE_ID,
      },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string } };
    expect(body.error.code).toBe('share_recipient_count_invalid');
    expect(repo.events).toHaveLength(0);
  });
});

// ===========================================================================
// POST /me/shares — atomic rejection (R9.3)
// ===========================================================================

describe('POST /me/shares atomic rejection (R9.3)', () => {
  it('surfaces share_atomic_rejected from the repo as 403', async () => {
    const { app } = await buildApp({
      repo: makeRepo({
        async createShareAtomic() {
          throw new AppError(
            'share_atomic_rejected',
            'Every recipient must be a friend of the sender.',
            { field: 'recipientIds' },
          );
        },
      }),
      defaultUserId: SENDER,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/me/shares',
      payload: {
        kind: 'experience',
        recipientIds: [REC_A],
        experienceId: EXPERIENCE_ID,
      },
    });

    expect(response.statusCode).toBe(403);
    const body = response.json() as { error: { code: string } };
    expect(body.error.code).toBe('share_atomic_rejected');
  });
});

// ===========================================================================
// POST /me/shares — payload composition (R9.4, R9.5, R9.6, R9.7)
// ===========================================================================

describe('POST /me/shares payload composition', () => {
  it('includes the rating value when one is supplied (R9.4)', async () => {
    let capturedPayload: SharePayload | undefined;
    const { app } = await buildApp({
      repo: makeRepo({
        async createShareAtomic(_sender, _recipients, payload) {
          capturedPayload = payload;
          return { shareId: SHARE_ID, deliveredTo: 1 };
        },
      }),
      defaultUserId: SENDER,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/me/shares',
      payload: {
        kind: 'experience',
        recipientIds: [REC_A],
        experienceId: EXPERIENCE_ID,
        rating: 8,
      },
    });

    expect(response.statusCode).toBe(201);
    const exp = capturedPayload as ExperienceSharePayload;
    expect(exp.kind).toBe('experience');
    expect(exp.experienceId).toBe(EXPERIENCE_ID);
    expect(exp.rating).toBe(8);
    expect(exp.ratingUnavailable).toBeUndefined();
  });

  it('includes rating-unavailable notice when rating is null but includeRating is true (R9.5)', async () => {
    let capturedPayload: SharePayload | undefined;
    const { app } = await buildApp({
      repo: makeRepo({
        async createShareAtomic(_sender, _recipients, payload) {
          capturedPayload = payload;
          return { shareId: SHARE_ID, deliveredTo: 1 };
        },
      }),
      defaultUserId: SENDER,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/me/shares',
      payload: {
        kind: 'experience',
        recipientIds: [REC_A],
        experienceId: EXPERIENCE_ID,
        rating: null,
        includeRating: true,
      },
    });

    expect(response.statusCode).toBe(201);
    const exp = capturedPayload as ExperienceSharePayload;
    expect(exp.rating).toBeNull();
    expect(exp.ratingUnavailable).toBe(true);
  });

  it('omits rating fields when rating is not supplied and includeRating is false', async () => {
    let capturedPayload: SharePayload | undefined;
    const { app } = await buildApp({
      repo: makeRepo({
        async createShareAtomic(_sender, _recipients, payload) {
          capturedPayload = payload;
          return { shareId: SHARE_ID, deliveredTo: 1 };
        },
      }),
      defaultUserId: SENDER,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/me/shares',
      payload: {
        kind: 'experience',
        recipientIds: [REC_A],
        experienceId: EXPERIENCE_ID,
      },
    });

    expect(response.statusCode).toBe(201);
    const exp = capturedPayload as ExperienceSharePayload;
    expect('rating' in exp).toBe(false);
    expect(exp.ratingUnavailable).toBeUndefined();
  });

  it('includes a note in the payload (R9.6)', async () => {
    let capturedPayload: SharePayload | undefined;
    const { app } = await buildApp({
      repo: makeRepo({
        async createShareAtomic(_sender, _recipients, payload) {
          capturedPayload = payload;
          return { shareId: SHARE_ID, deliveredTo: 1 };
        },
      }),
      defaultUserId: SENDER,
    });

    const noteBody = 'This was the best ride at Magic Kingdom!';
    const response = await app.inject({
      method: 'POST',
      url: '/me/shares',
      payload: {
        kind: 'experience',
        recipientIds: [REC_A],
        experienceId: EXPERIENCE_ID,
        note: noteBody,
      },
    });

    expect(response.statusCode).toBe(201);
    const exp = capturedPayload as ExperienceSharePayload;
    expect(exp.note).toBe(noteBody);
  });

  it('rejects a note longer than 2000 chars with note_length_invalid (R9.6)', async () => {
    const { app, repo } = await buildApp({ defaultUserId: SENDER });
    const overlongNote = 'x'.repeat(2001);

    const response = await app.inject({
      method: 'POST',
      url: '/me/shares',
      payload: {
        kind: 'experience',
        recipientIds: [REC_A],
        experienceId: EXPERIENCE_ID,
        note: overlongNote,
      },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string } };
    expect(body.error.code).toBe('note_length_invalid');
    expect(repo.events).toHaveLength(0);
  });

  it('composes a progress payload with overall, per-Park, and per-Category percentages capped at 100 (R9.7)', async () => {
    let capturedPayload: SharePayload | undefined;
    const { app } = await buildApp({
      repo: makeRepo({
        async createShareAtomic(_sender, _recipients, payload) {
          capturedPayload = payload;
          return { shareId: SHARE_ID, deliveredTo: 1 };
        },
      }),
      defaultUserId: SENDER,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/me/shares',
      payload: {
        kind: 'progress',
        recipientIds: [REC_A],
        statsSnapshot: {
          // 105 should be capped at 100.0 (R9.7).
          overallPercent: 105,
          perParkPercent: { 'Magic Kingdom': 50, EPCOT: 110 },
          perCategoryPercent: { Ride: 33.3, Show: -5 },
        },
      },
    });

    expect(response.statusCode).toBe(201);
    const prog = capturedPayload as ProgressSharePayload;
    expect(prog.kind).toBe('progress');
    expect(prog.overallPercent).toBe(100);
    expect(prog.perParkPercent['Magic Kingdom']).toBe(50);
    expect(prog.perParkPercent.EPCOT).toBe(100);
    expect(prog.perCategoryPercent.Ride).toBe(33.3);
    // -5 floored at 0.
    expect(prog.perCategoryPercent.Show).toBe(0);
  });

  it('returns 201 with shareId and deliveredTo on success (R9.1)', async () => {
    const { app } = await buildApp({
      repo: makeRepo({
        async createShareAtomic() {
          return { shareId: SHARE_ID, deliveredTo: 2 };
        },
      }),
      defaultUserId: SENDER,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/me/shares',
      payload: {
        kind: 'experience',
        recipientIds: [REC_A, REC_B],
        experienceId: EXPERIENCE_ID,
        rating: 7,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ shareId: SHARE_ID, deliveredTo: 2 });
  });
});

// ===========================================================================
// GET /me/inbox (R9.8)
// ===========================================================================

describe('GET /me/inbox', () => {
  it('returns the bundle from the repo (R9.8)', async () => {
    const bundle: InboxResponse = {
      unread: 1,
      items: [
        {
          shareId: SHARE_ID,
          read: false,
          senderId: SENDER,
          senderDisplayName: 'Mickey Mouse',
          payloadKind: 'experience',
          payload: { kind: 'experience', experienceId: EXPERIENCE_ID, rating: 9 },
          sentAt: '2024-05-01T10:00:00.000Z',
          myReaction: null,
        },
        {
          shareId: 'other000-0000-4000-8000-000000000000',
          read: true,
          senderId: SENDER,
          senderDisplayName: 'Mickey Mouse',
          payloadKind: 'experience',
          payload: { kind: 'experience', experienceId: EXPERIENCE_ID, rating: 9 },
          sentAt: '2024-05-01T10:00:00.000Z',
          myReaction: 'love',
        },
      ],
    };
    const { app, repo } = await buildApp({
      repo: makeRepo({
        async listInbox() {
          return bundle;
        },
      }),
      defaultUserId: REC_A,
    });

    const response = await app.inject({ method: 'GET', url: '/me/inbox' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(bundle);
    expect(repo.events).toEqual([{ method: 'listInbox', args: [REC_A] }]);
  });

  it('rejects an unauthenticated request as 401', async () => {
    const { app } = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/me/inbox' });
    expect(response.statusCode).toBe(401);
  });
});

// ===========================================================================
// GET /me/shares (Sent Shares surface, R11.7 support)
// ===========================================================================

describe('GET /me/shares', () => {
  it('returns the caller\u2019s sent shares from the repo', async () => {
    const sent: SentShareDTO[] = [
      {
        shareId: SHARE_ID,
        payloadKind: 'experience',
        payload: { kind: 'experience', experienceId: EXPERIENCE_ID, rating: 9 },
        sentAt: '2024-05-01T10:00:00.000Z',
      },
    ];
    const { app, repo } = await buildApp({
      repo: makeRepo({
        async listSentShares() {
          return sent;
        },
      }),
      defaultUserId: SENDER,
    });

    const response = await app.inject({ method: 'GET', url: '/me/shares' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(sent);
    expect(repo.events).toEqual([{ method: 'listSentShares', args: [SENDER] }]);
  });

  it('rejects an unauthenticated request as 401', async () => {
    const { app } = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/me/shares' });
    expect(response.statusCode).toBe(401);
  });
});

// ===========================================================================
// POST /me/inbox/:shareId/open (R9.9)
// ===========================================================================

describe('POST /me/inbox/:shareId/open', () => {
  it('returns the full detail on success (R9.9)', async () => {
    const detail: OpenedShareDetail = {
      shareId: SHARE_ID,
      senderId: SENDER,
      payloadKind: 'experience',
      payload: { kind: 'experience', experienceId: EXPERIENCE_ID, rating: 9 },
      sentAt: '2024-05-01T10:00:00.000Z',
    };
    const { app, repo } = await buildApp({
      repo: makeRepo({
        async openShare() {
          return detail;
        },
      }),
      defaultUserId: REC_A,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/me/inbox/${SHARE_ID}/open`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(detail);
    expect(repo.events).toEqual([
      { method: 'openShare', args: [REC_A, SHARE_ID] },
    ]);
  });

  it('returns 400 validation_failed when the share is not found in the inbox', async () => {
    const { app } = await buildApp({
      repo: makeRepo({
        async openShare() {
          return null;
        },
      }),
      defaultUserId: REC_A,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/me/inbox/${SHARE_ID}/open`,
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string } };
    expect(body.error.code).toBe('validation_failed');
  });

  it('rejects a non-UUID :shareId with validation_failed', async () => {
    const { app, repo } = await buildApp({ defaultUserId: REC_A });

    const response = await app.inject({
      method: 'POST',
      url: '/me/inbox/not-a-uuid/open',
    });

    expect(response.statusCode).toBe(400);
    expect((response.json() as { error: { code: string } }).error.code).toBe(
      'validation_failed',
    );
    expect(repo.events).toHaveLength(0);
  });
});

// ===========================================================================
// DELETE /me/inbox/:shareId (R9.10)
// ===========================================================================

describe('DELETE /me/inbox/:shareId', () => {
  it('returns 204 on success and only calls softDeleteForRecipient (R9.10)', async () => {
    const { app, repo } = await buildApp({
      repo: makeRepo({
        async softDeleteForRecipient() {
          return true;
        },
      }),
      defaultUserId: REC_A,
    });

    const response = await app.inject({
      method: 'DELETE',
      url: `/me/inbox/${SHARE_ID}`,
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    // Only the recipient-soft-delete is invoked. The repo never receives
    // any call that would touch the sender's `shares` row.
    expect(repo.events).toEqual([
      { method: 'softDeleteForRecipient', args: [REC_A, SHARE_ID] },
    ]);
  });

  it('returns 400 validation_failed when no row was updated', async () => {
    const { app } = await buildApp({
      repo: makeRepo({
        async softDeleteForRecipient() {
          return false;
        },
      }),
      defaultUserId: REC_A,
    });

    const response = await app.inject({
      method: 'DELETE',
      url: `/me/inbox/${SHARE_ID}`,
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string } };
    expect(body.error.code).toBe('validation_failed');
  });

  it('rejects an unauthenticated request as 401', async () => {
    const { app } = await buildApp();
    const response = await app.inject({
      method: 'DELETE',
      url: `/me/inbox/${SHARE_ID}`,
    });
    expect(response.statusCode).toBe(401);
  });
});
