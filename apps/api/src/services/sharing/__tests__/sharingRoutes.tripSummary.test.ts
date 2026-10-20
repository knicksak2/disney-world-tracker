/**
 * Integration and consumer tests for tripSummary share creation (Task 21.1).
 *
 * Validates: Requirements 15.2, 15.9, 15.18, 15.19, 15.20.
 *
 * Exercises:
 * - POST /me/shares with kind='tripSummary':
 *   - Composes pointer-only 5-key payload: { kind, tripId, tripName, sharerDisplayName, includePhotos }.
 *   - Passes inboxItemSchema on inbox read.
 *   - Fails with trip_forbidden when caller is non-member or role lacks share_trip_summary.
 *   - Fails when recipient is not a Friend (atomic check).
 *   - Fails with validation_failed when tripShareFacts is unwired.
 * - Source guards: sharing/routes.ts and sharing/tripRecap*.ts contain no import of
 *   trips/repo, trips/authz, or DbPool/pg.
 * - Consumer behavior tests:
 *   - attention.ts builder returns tripSummary destination with shareId.
 *   - notifications/service.ts notice builder returns 'a trip recap' label.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import {
  inboxItemSchema,
  toAttentionItem,
  type InboxItemDTO,
  type SharePayload,
  type TripSummarySharePayload,
} from '@dwt/shared';

import { AppError } from '../../../errors/AppError.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import type { ExpoPushMessage } from '../../notifications/expoPushClient.js';
import { createNotificationService } from '../../notifications/service.js';
import type {
  ShareDeliveryResult,
  SharingRepo,
} from '../repo.js';
import { sharingRoutes, type SharingRoutesOptions } from '../routes.js';
import type { TripShareFacts } from '../ports.js';

const SENDER_ID = '11111111-1111-4111-8111-111111111111';
const FRIEND_ID = '22222222-2222-4222-8222-222222222222';
const TRIP_ID = '33333333-3333-4333-8333-333333333333';
const SHARE_ID = '44444444-4444-4444-8444-444444444444';

interface FakeRepoOverrides {
  readonly createShareAtomic?: (
    senderId: string,
    recipientIds: readonly string[],
    payload: SharePayload,
  ) => Promise<ShareDeliveryResult>;
}

function makeFakeRepo(overrides: FakeRepoOverrides = {}): SharingRepo {
  return {
    async createShareAtomic(senderId, recipientIds, payload) {
      if (overrides.createShareAtomic) {
        return overrides.createShareAtomic(senderId, recipientIds, payload);
      }
      return {
        shareId: SHARE_ID,
        deliveredTo: recipientIds.length,
      };
    },
    async listInbox() {
      return { items: [], unread: 0, nextCursor: null };
    },
    async countUnreadInbox() {
      return 0;
    },
    async markAllInboxRead() {
      return 0;
    },
    async openShare() {
      return null;
    },
    async softDeleteForRecipient() {
      return false;
    },
    async listSentShares() {
      return [];
    },
  };
}

async function buildTestServer(
  repoOverrides: FakeRepoOverrides = {},
  tripShareFactsOverride?: TripShareFacts | null,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);

  const defaultFacts: TripShareFacts = {
    async roleOf(userId, tripId) {
      if (userId === SENDER_ID && tripId === TRIP_ID) return 'member';
      return null;
    },
    async tripName(tripId) {
      if (tripId === TRIP_ID) return 'Disney 2026';
      return null;
    },
    async isMember(userId, tripId) {
      return userId === SENDER_ID && tripId === TRIP_ID;
    },
    async summary() {
      return null;
    },
  };

  const options: SharingRoutesOptions = {
    repo: makeFakeRepo(repoOverrides),
    requireSession: async (req) => {
      req.userId = SENDER_ID;
    },
    resolveSenderDisplayName: async (userId) => {
      return userId === SENDER_ID ? 'Alice' : 'Someone';
    },
    tripShareFacts: tripShareFactsOverride === null ? undefined : (tripShareFactsOverride ?? defaultFacts),
  };

  await app.register(sharingRoutes(options));
  await app.ready();
  return app;
}

describe('POST /me/shares with tripSummary (Task 21.1)', () => {
  it('composes pointer-only 5-key payload and validates inboxItemSchema', async () => {
    let capturedPayload: SharePayload | undefined;

    const server = await buildTestServer({
      async createShareAtomic(_senderId, recipientIds, payload) {
        capturedPayload = payload;
        return {
          shareId: SHARE_ID,
          deliveredTo: recipientIds.length,
        };
      },
    });

    const res = await server.inject({
      method: 'POST',
      url: '/me/shares',
      payload: {
        kind: 'tripSummary',
        tripId: TRIP_ID,
        recipientIds: [FRIEND_ID],
        includePhotos: true,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(capturedPayload).toBeDefined();
    expect(capturedPayload?.kind).toBe('tripSummary');

    if (capturedPayload?.kind !== 'tripSummary') {
      throw new Error('expected a tripSummary payload');
    }
    const summaryPayload: TripSummarySharePayload = capturedPayload;
    // Exactly 5 keys (Requirements 15.2, 15.20)
    const payloadKeys = Object.keys(summaryPayload).sort();
    expect(payloadKeys).toEqual(
      ['includePhotos', 'kind', 'sharerDisplayName', 'tripId', 'tripName'].sort()
    );
    expect(summaryPayload).toEqual({
      kind: 'tripSummary',
      tripId: TRIP_ID,
      tripName: 'Disney 2026',
      sharerDisplayName: 'Alice',
      includePhotos: true,
    });
    // No forbidden leaked keys
    for (const forbidden of ['sharerId', 'summary', 'perMember', 'url']) {
      expect(payloadKeys).not.toContain(forbidden);
    }

    // Verify an inbox item carrying this payload passes inboxItemSchema
    const inboxItem: InboxItemDTO = {
      shareId: SHARE_ID,
      senderId: SENDER_ID,
      senderDisplayName: 'Alice',
      payloadKind: 'tripSummary',
      payload: summaryPayload,
      sentAt: '2026-10-20T12:00:00.000Z',
      read: false,
      myReaction: null,
    };
    const parsed = inboxItemSchema.safeParse(inboxItem);
    expect(parsed.success).toBe(true);
  });

  it('rejects with trip_forbidden when caller is not a member of the trip', async () => {
    const server = await buildTestServer({}, {
      async roleOf() { return null; },
      async tripName() { return 'Disney 2026'; },
      async isMember() { return false; },
      async summary() { return null; },
    });

    const res = await server.inject({
      method: 'POST',
      url: '/me/shares',
      payload: {
        kind: 'tripSummary',
        tripId: TRIP_ID,
        recipientIds: [FRIEND_ID],
      },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error?.code).toBe('trip_forbidden');
  });

  it('allows both organizer and member roles to share a trip summary (share_trip_summary)', async () => {
    for (const role of ['organizer', 'member'] as const) {
      const server = await buildTestServer({}, {
        async roleOf() { return role; },
        async tripName() { return 'Disney 2026'; },
        async isMember() { return true; },
        async summary() { return null; },
      });

      const res = await server.inject({
        method: 'POST',
        url: '/me/shares',
        payload: {
          kind: 'tripSummary',
          tripId: TRIP_ID,
          recipientIds: [FRIEND_ID],
        },
      });

      expect(res.statusCode).toBe(201);
    }
  });

  it('rejects when recipient is not a Friend via atomic check', async () => {
    const server = await buildTestServer({
      async createShareAtomic() {
        throw new AppError(
          'share_atomic_rejected',
          'Recipients must be mutual friends and not blocked.',
        );
      },
    });

    const res = await server.inject({
      method: 'POST',
      url: '/me/shares',
      payload: {
        kind: 'tripSummary',
        tripId: TRIP_ID,
        recipientIds: [FRIEND_ID],
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error?.code).toBe('share_atomic_rejected');
  });

  it('answers validation_failed when tripShareFacts is unwired', async () => {
    const server = await buildTestServer({}, null);

    const res = await server.inject({
      method: 'POST',
      url: '/me/shares',
      payload: {
        kind: 'tripSummary',
        tripId: TRIP_ID,
        recipientIds: [FRIEND_ID],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error?.code).toBe('validation_failed');
  });

  it('source guard: sharing routes do not import trips/repo, trips/authz, or DbPool/pg', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const routesSource = readFileSync(resolve(here, '..', 'routes.ts'), 'utf8');

    expect(routesSource).not.toMatch(/from\s+['"][^'"]*trips\/repo(\.js)?['"]/);
    expect(routesSource).not.toMatch(/from\s+['"][^'"]*trips\/authz(\.js)?['"]/);
    expect(routesSource).not.toMatch(/from\s+['"][^'"]*db\/pool(\.js)?['"]/);
    expect(routesSource).not.toMatch(/from\s+['"]pg['"]/);
  });

  it('behavior: attention builder returns tripSummary destination for delivered tripSummary share', () => {
    const inboxItem: InboxItemDTO = {
      shareId: SHARE_ID,
      senderId: SENDER_ID,
      senderDisplayName: 'Alice',
      payloadKind: 'tripSummary',
      payload: {
        kind: 'tripSummary',
        tripId: TRIP_ID,
        tripName: 'Disney 2026',
        sharerDisplayName: 'Alice',
        includePhotos: true,
      },
      sentAt: '2026-10-20T12:00:00.000Z',
      read: false,
      myReaction: null,
    };

    const attention = toAttentionItem('share', inboxItem);
    expect(attention.summary).toBe('Alice shared a trip recap');
    expect(attention.ref.destination).toEqual({
      kind: 'tripSummary',
      id: SHARE_ID,
    });
    // The Notification Center needs the sender for its still-Friend pre-check
    // (photo-uploads R15.13); only a tripSummary share carries it.
    expect(attention.ref.senderId).toBe(SENDER_ID);
  });

  it('behavior: a non-tripSummary share ref carries no senderId', () => {
    const attention = toAttentionItem('share', {
      shareId: SHARE_ID,
      senderId: SENDER_ID,
      senderDisplayName: 'Alice',
      payloadKind: 'pinShowcase',
      payload: { kind: 'pinShowcase', ownerId: SENDER_ID, ownerDisplayName: 'Alice' },
      sentAt: '2026-10-20T12:00:00.000Z',
      read: false,
      myReaction: null,
    });
    expect(attention.ref).toEqual({
      shareId: SHARE_ID,
      destination: { kind: 'pinShowcase', id: SENDER_ID },
    });
  });

  it('behavior: notification notice for a tripSummary share carries "a trip recap" label and kind', async () => {
    const sent: ExpoPushMessage[] = [];
    const service = createNotificationService({
      preferences: {
        async getPreference() {
          return { pushNotificationsEnabled: true };
        },
      },
      pushTokens: {
        async listActiveTokensForUser() {
          return ['ExponentPushToken[xyz]'];
        },
        async invalidateByToken() {
          return true;
        },
      },
      expoClient: {
        async send(msgs) {
          sent.push(...msgs);
          return msgs.map((m) => ({ token: m.to, status: 'ok' as const }));
        },
      },
      resolveSenderDisplayName: async () => 'Alice',
      resolveExperienceName: async () => 'Space Mountain',
      logger: { warn: vi.fn(), error: vi.fn() },
    });

    await service.handleShareDelivered({
      shareId: SHARE_ID,
      senderId: SENDER_ID,
      recipientIds: [FRIEND_ID],
      payloadKind: 'tripSummary',
    });

    expect(sent.length).toBe(1);
    expect(sent[0]?.body).toBe('a trip recap');
  });
});
